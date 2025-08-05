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
      console.log('🔄 Starting pgRouting nodeNetwork creation from trail data...');
      
      // Drop existing pgRouting tables if they exist
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways_noded_vertices_pgr`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.node_mapping`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.edge_mapping`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways_noded`);
      
      console.log('✅ Dropped existing pgRouting tables');

      // Create a trails table for pgRouting from our existing trail data (PURE INTEGER DOMAIN with app_uuid sidecar)
      // Fix non-simple geometries to prevent pgr_nodeNetwork errors
      const trailsTableResult = await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.ways AS
        SELECT 
          ROW_NUMBER() OVER (ORDER BY id) as id,
          app_uuid,  -- Sidecar data for metadata lookup
          name,
          length_km,
          elevation_gain,
          elevation_loss,
          CASE 
            WHEN ST_IsSimple(geometry) THEN ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
            ELSE ST_Force2D(ST_SimplifyPreserveTopology(ST_MakeValid(geometry), 0.00001))
          END as the_geom
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry) 
          AND ST_Length(geometry) > 0.001
          AND ST_GeometryType(geometry) IN ('ST_LineString', 'ST_MultiLineString')
      `);
      console.log(`✅ Created ways table with ${trailsTableResult.rowCount} rows from trail data`);

      // No ID mapping needed - pure integer domain
      console.log('✅ Using pure integer IDs in pgRouting domain');

      // Clean up any problematic geometries before nodeNetwork
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways 
        SET the_geom = ST_LineMerge(ST_CollectionHomogenize(the_geom))
        WHERE ST_GeometryType(the_geom) = 'ST_GeometryCollection'
      `);
      
      // Remove any remaining problematic geometries
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.ways 
        WHERE ST_GeometryType(the_geom) != 'ST_LineString'
          OR NOT ST_IsSimple(the_geom)
          OR ST_IsEmpty(the_geom)
      `);
      
      // Additional geometry cleanup for self-intersecting lines
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways 
        SET the_geom = ST_MakeValid(the_geom)
        WHERE NOT ST_IsValid(the_geom)
      `);
      
      // Convert any remaining MultiLineStrings to LineStrings
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways 
        SET the_geom = ST_LineMerge(the_geom)
        WHERE ST_GeometryType(the_geom) = 'ST_MultiLineString'
      `);
      
      // Final cleanup - remove any geometries that are still not LineStrings
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.ways 
        WHERE ST_GeometryType(the_geom) != 'ST_LineString'
      `);
      
      console.log('✅ Cleaned up geometries for pgRouting');

      // Use pgRouting's nodeNetwork to split trails at intersections for maximum routing flexibility
      // Reduced tolerance to avoid geometry intersection issues (was 0.0001)
      const nodeNetworkResult = await this.pgClient.query(`
        SELECT pgr_nodeNetwork('${this.stagingSchema}.ways', 0.00001, 'id', 'the_geom')
      `);
      console.log('✅ Created pgRouting nodeNetwork with trail splitting');

      // MANUAL TOPOLOGY CREATION - Work around deprecated function bugs
      console.log('🔄 Creating manual topology (workaround for deprecated function bugs)...');
      
      // Create vertices table manually
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.ways_noded_vertices_pgr AS
        SELECT DISTINCT 
          ROW_NUMBER() OVER (ORDER BY point) as id,
          point as the_geom,
          COUNT(*) as cnt,
          'f' as chk,
          COUNT(CASE WHEN is_start THEN 1 END) as ein,
          COUNT(CASE WHEN is_end THEN 1 END) as eout
        FROM (
          SELECT 
            ST_StartPoint(the_geom) as point,
            true as is_start,
            false as is_end
          FROM ${this.stagingSchema}.ways_noded
          UNION ALL
          SELECT 
            ST_EndPoint(the_geom) as point,
            false as is_start,
            true as is_end
          FROM ${this.stagingSchema}.ways_noded
        ) points
        GROUP BY point
      `);
      console.log('✅ Created vertices table manually');

      // Update ways_noded with source and target IDs
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways_noded 
        SET 
          source = v1.id,
          target = v2.id
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v1, ${this.stagingSchema}.ways_noded_vertices_pgr v2
        WHERE 
          ST_Equals(ST_StartPoint(ways_noded.the_geom), v1.the_geom) AND
          ST_Equals(ST_EndPoint(ways_noded.the_geom), v2.the_geom)
      `);
      console.log('✅ Updated edges with source and target IDs');

      // Create node mapping table to map pgRouting integer IDs back to our UUIDs
      const nodeMappingResult = await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.node_mapping AS
        SELECT 
          v.id as pg_id,
          v.cnt as connection_count,
          CASE 
            WHEN v.cnt = 1 THEN 'dead_end'
            WHEN v.cnt = 2 THEN 'simple_connection'
            WHEN v.cnt >= 3 THEN 'intersection'
            ELSE 'unknown'
          END as node_type
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
      `);
      console.log(`✅ Created node mapping table with ${nodeMappingResult.rowCount} rows`);

      // Create edge mapping table to map pgRouting integer IDs back to trail metadata (with app_uuid sidecar)
      const edgeMappingResult = await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.edge_mapping AS
        SELECT 
          w.id as pg_id,
          w.old_id as original_trail_id,
          t.app_uuid as app_uuid,  -- Sidecar data for metadata lookup
          t.name as trail_name
        FROM ${this.stagingSchema}.ways_noded w
        JOIN ${this.stagingSchema}.trails t ON w.old_id = t.id
        WHERE t.name IS NOT NULL
      `);
      console.log(`✅ Created edge mapping table with ${edgeMappingResult.rowCount} rows`);

      console.log('✅ Created pgRouting nodeNetwork with trail splitting for maximum routing flexibility');
      return true;
    } catch (error) {
      console.error('❌ Failed to create pgRouting nodeNetwork:', error);
      return false;
    }
  }

  async analyzeGraph(): Promise<PgRoutingResult> {
    try {
      const result = await this.pgClient.query(`
        SELECT * FROM pgr_analyzeGraph('${this.stagingSchema}.ways_noded', 0.000001, 'the_geom', 'id', 'source', 'target')
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

  // Internal method - expects integer IDs (for pgRouting)
  private async _findKShortestPaths(startNodeId: number, endNodeId: number, k: number = 3, directed: boolean = false): Promise<PgRoutingResult> {
    try {
      const result = await this.pgClient.query(`
        SELECT * FROM pgr_ksp(
          'SELECT id, source, target, (length_km * 1000) + (elevation_gain * 10) as cost FROM ${this.stagingSchema}.ways_noded',
          $1::integer, $2::integer, $3::integer, directed := $4::boolean
        )
      `, [startNodeId, endNodeId, k, directed]);
      
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

  // Public method - accepts UUIDs and handles mapping at boundary
  async findKShortestPaths(startNodeUuid: string, endNodeUuid: string, k: number = 3, directed: boolean = false): Promise<PgRoutingResult> {
    try {
      // Map UUIDs to integer IDs using the ID mapping table
      const startNodeMapping = await this.pgClient.query(`
        SELECT pgrouting_id FROM ${this.stagingSchema}.id_mapping WHERE app_uuid = $1
      `, [startNodeUuid]);
      
      const endNodeMapping = await this.pgClient.query(`
        SELECT pgrouting_id FROM ${this.stagingSchema}.id_mapping WHERE app_uuid = $1
      `, [endNodeUuid]);

      if (startNodeMapping.rows.length === 0 || endNodeMapping.rows.length === 0) {
        return {
          success: false,
          error: 'Could not map UUIDs to integer IDs'
        };
      }

      const startNodeId = startNodeMapping.rows[0].pgrouting_id;
      const endNodeId = endNodeMapping.rows[0].pgrouting_id;

      // Call internal method with integer IDs
      return await this._findKShortestPaths(startNodeId, endNodeId, k, directed);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Public method - accepts integer IDs directly (for internal use)
  async findKShortestPathsById(startNodeId: number, endNodeId: number, k: number = 3, directed: boolean = false): Promise<PgRoutingResult> {
    return await this._findKShortestPaths(startNodeId, endNodeId, k, directed);
  }

  // Internal method - expects integer IDs (for pgRouting)
  private async _findShortestPath(startNodeId: number, endNodeId: number, directed: boolean = false): Promise<PgRoutingResult> {
    try {
      const result = await this.pgClient.query(`
        SELECT * FROM pgr_ksp(
          'SELECT id, source, target, length_km * 1000 as cost FROM ${this.stagingSchema}.ways_noded',
          $1::integer, $2::integer, 3::integer, directed := $3::boolean
        )
      `, [startNodeId, endNodeId, directed]);
      
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

  // Public method - accepts UUIDs and handles mapping at boundary
  async findShortestPath(startNodeUuid: string, endNodeUuid: string, directed: boolean = false): Promise<PgRoutingResult> {
    try {
      // Map UUIDs to integer IDs using the ID mapping table
      const startNodeMapping = await this.pgClient.query(`
        SELECT pgrouting_id FROM ${this.stagingSchema}.id_mapping WHERE app_uuid = $1
      `, [startNodeUuid]);
      
      const endNodeMapping = await this.pgClient.query(`
        SELECT pgrouting_id FROM ${this.stagingSchema}.id_mapping WHERE app_uuid = $1
      `, [endNodeUuid]);

      if (startNodeMapping.rows.length === 0 || endNodeMapping.rows.length === 0) {
        return {
          success: false,
          error: 'Could not map UUIDs to integer IDs'
        };
      }

      const startNodeId = startNodeMapping.rows[0].pgrouting_id;
      const endNodeId = endNodeMapping.rows[0].pgrouting_id;

      // Call internal method with integer IDs
      return await this._findShortestPath(startNodeId, endNodeId, directed);
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
          'SELECT id, source, target, length_km * 1000 as cost FROM ${this.stagingSchema}.ways_noded',
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
    console.log(`🛤️ Generating route recommendations with pgRouting: target ${targetDistance}km, ${targetElevation}m elevation, max ${maxRoutes} routes`);
    try {
      // Get connected pairs of nodes for route generation from ways_noded
      const connectedPairsResult = await this.pgClient.query(`
        SELECT DISTINCT 
          w.source as start_node,
          w.target as end_node,
          ST_X(v1.the_geom) as start_lng,
          ST_Y(v1.the_geom) as start_lat,
          ST_X(v2.the_geom) as end_lng,
          ST_Y(v2.the_geom) as end_lat,
          v1.id as start_node_id,
          v2.id as end_node_id
        FROM ${this.stagingSchema}.ways_noded w
        JOIN ${this.stagingSchema}.ways_noded_vertices_pgr v1 ON v1.id = w.source
        JOIN ${this.stagingSchema}.ways_noded_vertices_pgr v2 ON v2.id = w.target
        WHERE v1.cnt >= 2 AND v2.cnt >= 2  -- Only use intersection nodes
        ORDER BY w.source, w.target
        LIMIT 20
      `);

      const routes: any[] = [];
      const connectedPairs = connectedPairsResult.rows;

      // Generate routes between connected pairs using K-Shortest Paths
      for (let i = 0; i < Math.min(maxRoutes, connectedPairs.length); i++) {
        const startNodeId = connectedPairs[i]?.start_node; // Integer ID from ways_noded table
        const endNodeId = connectedPairs[i]?.end_node;     // Integer ID from ways_noded table

        // Use internal method with integer IDs (no UUID mapping needed)
        const kspResult = await this._findKShortestPaths(startNodeId, endNodeId, 3, false);
        
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

            const routeEdgeIds: number[] = [];
            
            for (const edge of pathEdges) {
              routeEdgeIds.push(edge.edge);
              
              // Get edge details from ways_noded table (integer IDs)
              const edgeResult = await this.pgClient.query(`
                SELECT length_km
                FROM ${this.stagingSchema}.ways_noded 
                WHERE id = $1
              `, [edge.edge]);

              if (edgeResult.rows.length > 0) {
                const edgeData = edgeResult.rows[0];
                totalDistance += edgeData.length_km || 0;
                // For now, use a simple estimate for elevation
                totalElevation += (edgeData.length_km || 0) * 50; // Rough estimate: 50m per km
              }
            }

            // Only include routes that are close to target distance/elevation
            const distanceDiff = Math.abs(totalDistance - targetDistance);
            const elevationDiff = Math.abs(totalElevation - targetElevation);

            if (distanceDiff <= targetDistance * 0.5 && elevationDiff <= targetElevation * 0.5) {
                          // Map integer IDs back to coordinates at the boundary
            const startNodeId = connectedPairs[i].start_node_id;
            const endNodeId = connectedPairs[i].end_node_id;
              
              routes.push({
                path_id: pathId,
                start_node: startNodeId,  // Integer ID for pgRouting
                end_node: endNodeId,      // Integer ID for pgRouting
                distance_km: totalDistance,
                elevation_m: totalElevation,
                path_edges: routeEdgeIds,   // Integer IDs for pgRouting
                start_coords: [connectedPairs[i].start_lng, connectedPairs[i].start_lat],
                end_coords: [connectedPairs[i].end_lng, connectedPairs[i].end_lat]
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
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways_noded_vertices_pgr`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways_noded`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.node_mapping`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.edge_mapping`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.id_mapping`);
      console.log('✅ Cleaned up pgRouting nodeNetwork tables and mapping tables');
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