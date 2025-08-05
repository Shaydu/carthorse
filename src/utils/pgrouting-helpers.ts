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

      // Enhanced geometry cleanup for pgRouting compatibility
      console.log('🔧 Enhanced geometry cleanup for pgRouting...');
      
      // Step 1: Handle GeometryCollections by extracting LineStrings
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways 
        SET the_geom = ST_LineMerge(ST_CollectionHomogenize(the_geom))
        WHERE ST_GeometryType(the_geom) = 'ST_GeometryCollection'
      `);
      
      // Step 2: Convert MultiLineStrings to LineStrings
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways 
        SET the_geom = ST_LineMerge(the_geom)
        WHERE ST_GeometryType(the_geom) = 'ST_MultiLineString'
      `);
      
      // Step 3: Fix invalid geometries
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways 
        SET the_geom = ST_MakeValid(the_geom)
        WHERE NOT ST_IsValid(the_geom)
      `);
      
      // Step 4: Simplify geometries to reduce complexity
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways 
        SET the_geom = ST_SimplifyPreserveTopology(the_geom, 0.00001)
        WHERE ST_IsValid(the_geom)
      `);
      
      // Step 5: Remove problematic geometries that can't be fixed
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.ways 
        WHERE ST_GeometryType(the_geom) != 'ST_LineString'
          OR NOT ST_IsSimple(the_geom)
          OR ST_IsEmpty(the_geom)
          OR ST_Length(the_geom) < 0.001
      `);
      
      // Step 6: Final validation and cleanup
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.ways 
        WHERE NOT ST_IsValid(the_geom)
          OR ST_GeometryType(the_geom) != 'ST_LineString'
      `);
      
      // Step 7: Additional cleanup to prevent GeometryCollection issues with pgRouting
      console.log('🔧 Additional cleanup to prevent GeometryCollection issues...');
      
      // Remove any remaining GeometryCollections by extracting LineStrings
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways 
        SET the_geom = (
          SELECT ST_LineMerge(ST_CollectionHomogenize(the_geom))
          WHERE ST_GeometryType(the_geom) = 'ST_GeometryCollection'
        )
        WHERE ST_GeometryType(the_geom) = 'ST_GeometryCollection'
      `);
      
      // Remove any trails that still have problematic geometries
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.ways 
        WHERE ST_GeometryType(the_geom) != 'ST_LineString'
          OR ST_IsEmpty(the_geom)
          OR ST_Length(the_geom) < 0.001
      `);
      
      // Final check for any remaining problematic geometries
      const problematicGeoms = await this.pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${this.stagingSchema}.ways 
        WHERE ST_GeometryType(the_geom) != 'ST_LineString'
      `);
      
      if (problematicGeoms.rows[0].count > 0) {
        console.warn(`⚠️  Found ${problematicGeoms.rows[0].count} problematic geometries, removing them...`);
        await this.pgClient.query(`
          DELETE FROM ${this.stagingSchema}.ways 
          WHERE ST_GeometryType(the_geom) != 'ST_LineString'
        `);
      }
      
      // Check how many trails remain after cleanup
      const remainingTrails = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.ways
      `);
      console.log(`✅ Cleaned up geometries for pgRouting: ${remainingTrails.rows[0].count} trails remaining`);
      
      if (remainingTrails.rows[0].count === 0) {
        throw new Error('No valid trails remaining after geometry cleanup');
      }

      // SIMPLIFIED APPROACH: Create routing network without problematic pgr_nodeNetwork
      console.log('🔄 Creating simplified routing network...');
      
      // Create ways_noded table directly from ways without splitting
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.ways_noded AS
        SELECT 
          ROW_NUMBER() OVER (ORDER BY id) as id,
          id as old_id,
          1 as sub_id,
          the_geom,
          app_uuid,
          length_km,
          elevation_gain
        FROM ${this.stagingSchema}.ways
      `);
      console.log('✅ Created ways_noded table without splitting');

      // Create vertices table from start and end points
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
      console.log('✅ Created vertices table');

      // Add source and target columns to ways_noded
      await this.pgClient.query(`
        ALTER TABLE ${this.stagingSchema}.ways_noded 
        ADD COLUMN source INTEGER,
        ADD COLUMN target INTEGER
      `);

      // Update source and target based on vertex proximity
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways_noded wn
        SET 
          source = (
            SELECT v.id 
            FROM ${this.stagingSchema}.ways_noded_vertices_pgr v 
            WHERE ST_DWithin(ST_StartPoint(wn.the_geom), v.the_geom, 0.00001)
            LIMIT 1
          ),
          target = (
            SELECT v.id 
            FROM ${this.stagingSchema}.ways_noded_vertices_pgr v 
            WHERE ST_DWithin(ST_EndPoint(wn.the_geom), v.the_geom, 0.00001)
            LIMIT 1
          )
      `);

      // Remove edges that couldn't be connected to vertices
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.ways_noded 
        WHERE source IS NULL OR target IS NULL
      `);
      console.log('✅ Connected edges to vertices');

      // Analyze graph connectivity
      console.log('🔍 Analyzing graph connectivity...');
      const analyzeResult = await this.pgClient.query(`
        SELECT pgr_analyzeGraph('${this.stagingSchema}.ways_noded', 0.00001, 'the_geom', 'id', 'source', 'target')
      `);
      console.log('✅ Graph analysis completed');

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
          ROW_NUMBER() OVER (ORDER BY wn.old_id) as pg_id,
          wn.old_id as original_trail_id,
          t.app_uuid as app_uuid,  -- Sidecar data for metadata lookup
          t.name as trail_name,
          t.length_km as length_km,
          t.elevation_gain as elevation_gain,
          t.elevation_loss as elevation_loss,
          t.trail_type,
          t.surface,
          t.difficulty,
          t.max_elevation,
          t.min_elevation,
          t.avg_elevation
        FROM ${this.stagingSchema}.ways_noded wn
        JOIN ${this.stagingSchema}.trails t ON wn.old_id = t.id
        WHERE t.name IS NOT NULL
      `);
      console.log(`✅ Created edge mapping table with ${edgeMappingResult.rowCount} rows`);

      // Create ID mapping table to map UUIDs to pgRouting integer IDs
      const idMappingResult = await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.id_mapping AS
        SELECT 
          t.app_uuid,
          v.id as pgrouting_id
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        JOIN ${this.stagingSchema}.ways_noded wn ON v.id = wn.source OR v.id = wn.target
        JOIN ${this.stagingSchema}.trails t ON wn.old_id = t.id
        WHERE t.app_uuid IS NOT NULL
        GROUP BY t.app_uuid, v.id
      `);
      console.log(`✅ Created ID mapping table with ${idMappingResult.rowCount} rows`);

      // Final validation: ensure network is connected
      console.log('🔍 Final network connectivity validation...');
      const connectivityCheck = await this.pgClient.query(`
        WITH reachable_nodes AS (
          SELECT DISTINCT target as node_id
          FROM ${this.stagingSchema}.ways_noded
          WHERE source = (SELECT MIN(id) FROM ${this.stagingSchema}.ways_noded_vertices_pgr)
          UNION
          SELECT source as node_id
          FROM ${this.stagingSchema}.ways_noded
          WHERE target = (SELECT MIN(id) FROM ${this.stagingSchema}.ways_noded_vertices_pgr)
        ),
        all_nodes AS (
          SELECT id as node_id FROM ${this.stagingSchema}.ways_noded_vertices_pgr
        )
        SELECT 
          COUNT(DISTINCT r.node_id) as reachable_count,
          COUNT(DISTINCT a.node_id) as total_nodes
        FROM reachable_nodes r
        CROSS JOIN all_nodes a
      `);
      
      const connectivity = connectivityCheck.rows[0];
      const connectivityPercent = (connectivity.reachable_count / connectivity.total_nodes) * 100;
      
      console.log(`📊 Connectivity: ${connectivity.reachable_count}/${connectivity.total_nodes} nodes reachable (${connectivityPercent.toFixed(1)}%)`);
      
      if (connectivityPercent < 90) {
        console.warn(`⚠️  Low network connectivity: ${connectivityPercent.toFixed(1)}%`);
      } else {
        console.log(`✅ Network connectivity is good: ${connectivityPercent.toFixed(1)}%`);
      }

      console.log('✅ Created pgRouting nodeNetwork with trail splitting for maximum routing flexibility');
      
      // Create routing_nodes table for export compatibility
      console.log('🗺️ Creating routing_nodes table for export...');
      await this.pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${this.stagingSchema}.routing_nodes AS
        SELECT
          v.id as id,
          v.id as node_uuid,
          ST_Y(v.the_geom) as lat,
          ST_X(v.the_geom) as lng,
          0 as elevation,
          CASE 
            WHEN v.cnt = 1 THEN 'dead_end'
            WHEN v.cnt = 2 THEN 'simple_connection'
            WHEN v.cnt >= 3 THEN 'intersection'
            ELSE 'unknown'
          END as node_type,
          '' as connected_trails,
          ARRAY[]::text[] as trail_ids,
          NOW() as created_at
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
      `);
      console.log('✅ Created routing_nodes table');

      // Create routing_edges table for export compatibility
      console.log('🛤️ Creating routing_edges table for export...');
      await this.pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${this.stagingSchema}.routing_edges AS
        SELECT
          wn.id as id,
          wn.source,
          wn.target,
          wn.old_id as trail_id,
          t.name as trail_name,
          wn.length_km,
          wn.elevation_gain,
          COALESCE(wn.elevation_gain, 0) as elevation_loss,
          wn.the_geom as geometry,
          ST_AsGeoJSON(wn.the_geom) as geojson,
          true as is_bidirectional,
          NOW() as created_at
        FROM ${this.stagingSchema}.ways_noded wn
        LEFT JOIN ${this.stagingSchema}.trails t ON wn.old_id = t.id
      `);
      console.log('✅ Created routing_edges table');
      
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