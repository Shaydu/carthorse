import { Pool } from 'pg';

export interface PgRoutingConfig {
  stagingSchema: string;
  pgClient: Pool;
}

export interface PgRoutingResult {
  success: boolean;
  error?: string;
  analysis?: any;
  routes?: any[];
}

export class PgRoutingHelpers {
  private stagingSchema: string;
  private pgClient: Pool;

  constructor(config: PgRoutingConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
  }

  async createPgRoutingViews(): Promise<boolean> {
    try {
      console.log('🔄 Starting pgRouting view creation...');
      
      // Drop existing tables if they exist
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways_vertices_pgr`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.node_mapping`);
      
      console.log('✅ Dropped existing tables');

      // Create a proper node mapping table
      const mappingResult = await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.node_mapping AS
        SELECT 
          id as original_uuid,
          ROW_NUMBER() OVER (ORDER BY id) as pg_id
        FROM ${this.stagingSchema}.routing_nodes
        WHERE lat IS NOT NULL AND lng IS NOT NULL
      `);
      console.log(`✅ Created node mapping table with ${mappingResult.rowCount} rows`);

      // Create ways table (edges) with proper integer mapping
      const waysResult = await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.ways AS
        SELECT 
          ROW_NUMBER() OVER (ORDER BY e.id) as gid,
          sm.pg_id as source,
          tm.pg_id as target,
          e.length_km * 1000 as cost,
          e.length_km * 1000 as reverse_cost,
          e.geometry as the_geom
        FROM ${this.stagingSchema}.routing_edges e
        JOIN ${this.stagingSchema}.node_mapping sm ON e.source = sm.original_uuid
        JOIN ${this.stagingSchema}.node_mapping tm ON e.target = tm.original_uuid
        WHERE e.geometry IS NOT NULL
      `);
      console.log(`✅ Created ways table with ${waysResult.rowCount} rows`);

      // Create ways_vertices_pgr table (nodes) with proper integer mapping
      const verticesResult = await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.ways_vertices_pgr AS
        SELECT 
          nm.pg_id as id,
          ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326) as the_geom,
          0 as cnt,
          0 as chk
        FROM ${this.stagingSchema}.routing_nodes n
        JOIN ${this.stagingSchema}.node_mapping nm ON n.id = nm.original_uuid
        WHERE n.lng IS NOT NULL AND n.lat IS NOT NULL
      `);
      console.log(`✅ Created ways_vertices_pgr table with ${verticesResult.rowCount} rows`);

      console.log('✅ Created pgRouting tables with proper UUID to integer mapping');
      return true;
    } catch (error) {
      console.error('❌ Failed to create pgRouting views:', error);
      return false;
    }
  }

  async analyzeGraph(): Promise<PgRoutingResult> {
    try {
      const result = await this.pgClient.query(`
        SELECT * FROM pgr_analyzeGraph('${this.stagingSchema}.ways', 0.000001)
      `);
      
      return {
        success: true,
        analysis: result.rows[0]
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async findKShortestPaths(startNode: number, endNode: number, k: number = 3, directed: boolean = false): Promise<PgRoutingResult> {
    try {
      const result = await this.pgClient.query(`
        SELECT * FROM pgr_ksp(
          'SELECT gid, source, target, cost FROM ${this.stagingSchema}.ways',
          $1::integer, $2::integer, $3::integer, directed := $4::boolean
        )
      `, [startNode, endNode, k, directed]);
      
      return {
        success: true,
        routes: result.rows
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async findShortestPath(startNode: number, endNode: number, directed: boolean = false): Promise<PgRoutingResult> {
    try {
      const result = await this.pgClient.query(`
        SELECT * FROM pgr_ksp(
          'SELECT gid, source, target, cost FROM ${this.stagingSchema}.ways',
          $1::integer, $2::integer, 3, directed := $3::boolean
        )
      `, [startNode, endNode, directed]);
      
      return {
        success: true,
        routes: result.rows
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async findRoutesWithinDistance(startNode: number, distance: number): Promise<PgRoutingResult> {
    try {
      const result = await this.pgClient.query(`
        SELECT * FROM pgr_drivingDistance(
          'SELECT gid, source, target, cost, reverse_cost FROM ${this.stagingSchema}.ways',
          $1, $2, false
        )
      `, [startNode, distance]);
      
      return {
        success: true,
        routes: result.rows
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async generateRouteRecommendations(targetDistance: number, targetElevation: number, maxRoutes: number = 10): Promise<PgRoutingResult> {
    try {
      // Get intersection nodes as potential start/end points
      const nodesResult = await this.pgClient.query(`
        SELECT nm.pg_id, n.node_type, n.lat, n.lng
        FROM ${this.stagingSchema}.routing_nodes n
        JOIN ${this.stagingSchema}.node_mapping nm ON n.id = nm.original_uuid
        WHERE n.node_type = 'intersection' 
          AND n.lat IS NOT NULL AND n.lng IS NOT NULL
        ORDER BY RANDOM()
        LIMIT 20
      `);

      const routes: any[] = [];
      const nodes = nodesResult.rows;

      // Generate routes between intersection nodes using K-Shortest Paths
      for (let i = 0; i < Math.min(maxRoutes, nodes.length - 1); i++) {
        const startNode = nodes[i]?.pg_id;
        const endNode = nodes[i + 1]?.pg_id;

        if (!startNode || !endNode || startNode === endNode) continue;

        // Use pgr_ksp to find multiple path alternatives
        const kspResult = await this.findKShortestPaths(startNode, endNode, 3, false);
        
        if (kspResult.success && kspResult.routes && kspResult.routes.length > 0) {
          // Group routes by path_id (each path_id represents one alternative route)
          const pathGroups = new Map<number, any[]>();
          
          for (const edge of kspResult.routes) {
            if (!pathGroups.has(edge.path_id)) {
              pathGroups.set(edge.path_id, []);
            }
            pathGroups.get(edge.path_id)!.push(edge);
          }

          // Process each alternative route
          for (const [pathId, pathEdges] of pathGroups) {
            let totalDistance = 0;
            let totalElevation = 0;

            for (const edge of pathEdges) {
              // Get edge details using the gid
              const edgeResult = await this.pgClient.query(`
                SELECT length_km, elevation_gain, elevation_loss 
                FROM ${this.stagingSchema}.routing_edges 
                ORDER BY id 
                LIMIT 1 OFFSET $1
              `, [edge.edge - 1]);

              if (edgeResult.rows.length > 0) {
                const edgeData = edgeResult.rows[0];
                totalDistance += edgeData.length_km || 0;
                totalElevation += edgeData.elevation_gain || 0;
              }
            }

            // Only include routes that are close to target distance/elevation
            const distanceDiff = Math.abs(totalDistance - targetDistance);
            const elevationDiff = Math.abs(totalElevation - targetElevation);

            if (distanceDiff <= targetDistance * 0.5 && elevationDiff <= targetElevation * 0.5) {
              routes.push({
                path_id: pathId,
                start_node: startNode,
                end_node: endNode,
                distance_km: totalDistance,
                elevation_m: totalElevation,
                path_edges: pathEdges.map((e: any) => e.edge),
                start_coords: [nodes[i].lng, nodes[i].lat],
                end_coords: [nodes[i + 1].lng, nodes[i + 1].lat]
              });

              if (routes.length >= maxRoutes) break;
            }
          }
        }
      }

      return {
        success: true,
        routes: routes
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async validateNetwork(): Promise<PgRoutingResult> {
    try {
      // Check for isolated nodes
      const isolatedResult = await this.pgClient.query(`
        SELECT COUNT(*) as isolated_count
        FROM ${this.stagingSchema}.routing_nodes n
        WHERE NOT EXISTS (
          SELECT 1 FROM ${this.stagingSchema}.routing_edges e
          WHERE e.source = n.id OR e.target = n.id
        )
      `);

      // Check for disconnected components
      const componentsResult = await this.pgClient.query(`
        SELECT * FROM pgr_strongComponents(
          'SELECT gid, source, target FROM ${this.stagingSchema}.ways'
        )
      `);

      return {
        success: true,
        analysis: {
          isolated_nodes: isolatedResult.rows[0]?.isolated_count || 0,
          components: componentsResult.rows
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async cleanupViews(): Promise<void> {
    try {
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways_vertices_pgr`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.node_mapping`);
      console.log('✅ Cleaned up pgRouting tables and mapping table');
    } catch (error) {
      console.error('❌ Failed to cleanup views:', error);
    }
  }
}

export function createPgRoutingHelpers(stagingSchema: string, pgClient: Pool): PgRoutingHelpers {
  return new PgRoutingHelpers({
    stagingSchema,
    pgClient
  });
} 