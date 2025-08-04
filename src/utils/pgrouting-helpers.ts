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
      // Create ways view (edges) with integer IDs
      await this.pgClient.query(`
        CREATE OR REPLACE VIEW ${this.stagingSchema}.ways AS
        SELECT 
          ROW_NUMBER() OVER (ORDER BY id) as gid,
          ROW_NUMBER() OVER (ORDER BY source) as source,
          ROW_NUMBER() OVER (ORDER BY target) as target,
          length_km * 1000 as cost,
          length_km * 1000 as reverse_cost,
          geometry as the_geom
        FROM ${this.stagingSchema}.routing_edges
        WHERE geometry IS NOT NULL
      `);

      // Create ways_vertices_pgr view (nodes) with integer IDs
      await this.pgClient.query(`
        CREATE OR REPLACE VIEW ${this.stagingSchema}.ways_vertices_pgr AS
        SELECT 
          ROW_NUMBER() OVER (ORDER BY id) as id,
          ST_SetSRID(ST_MakePoint(lng, lat), 4326) as the_geom,
          0 as cnt,
          0 as chk
        FROM ${this.stagingSchema}.routing_nodes
        WHERE lng IS NOT NULL AND lat IS NOT NULL
      `);

      console.log('✅ Created pgRouting views with integer IDs');
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

  async findShortestPath(startNode: number, endNode: number, directed: boolean = false): Promise<PgRoutingResult> {
    try {
      const result = await this.pgClient.query(`
        SELECT * FROM pgr_dijkstra(
          'SELECT gid, source, target, cost, reverse_cost FROM ${this.stagingSchema}.ways',
          $1, $2, $3
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
      // Get all nodes as potential start/end points
      const nodesResult = await this.pgClient.query(`
        SELECT id FROM ${this.stagingSchema}.routing_nodes 
        WHERE lat IS NOT NULL AND lng IS NOT NULL
        ORDER BY RANDOM()
        LIMIT 20
      `);

      const routes: any[] = [];
      const nodes = nodesResult.rows;

      // Generate routes between random node pairs
      for (let i = 0; i < Math.min(maxRoutes, nodes.length - 1); i++) {
        const startNode = i + 1; // Integer ID
        const endNode = i + 2;   // Integer ID

        const pathResult = await this.findShortestPath(startNode, endNode, false);
        
        if (pathResult.success && pathResult.routes && pathResult.routes.length > 0) {
          // Calculate total distance and elevation
          let totalDistance = 0;
          let totalElevation = 0;

          for (const edge of pathResult.routes) {
            // Get edge details from original table
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
              start_node: startNode,
              end_node: endNode,
              distance_km: totalDistance,
              elevation_m: totalElevation,
              path_edges: pathResult.routes.map((r: any) => r.edge)
            });
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
      await this.pgClient.query(`DROP VIEW IF EXISTS ${this.stagingSchema}.ways`);
      await this.pgClient.query(`DROP VIEW IF EXISTS ${this.stagingSchema}.ways_vertices_pgr`);
      console.log('✅ Cleaned up pgRouting views');
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