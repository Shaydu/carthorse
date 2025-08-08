import { Pool } from 'pg';
import { getPgRoutingTolerances } from './config-loader';
import { NetworkCreationService } from './services/network-creation/network-creation-service';
import { NetworkConfig } from './services/network-creation/types/network-types';

export interface PgRoutingConfig {
  stagingSchema: string;
  pgClient: Pool;
  usePgNodeNetwork?: boolean; // Enable pgr_nodeNetwork() processing
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
  private usePgNodeNetwork: boolean;

  constructor(config: PgRoutingConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
    this.usePgNodeNetwork = config.usePgNodeNetwork || false;
  }

  private async analyzeRoutingTables(stage: string): Promise<void> {
    const s = this.stagingSchema;
    console.log(`📊 Running ANALYZE (${stage}) on routing tables...`);
    const start = Date.now();
    try {
      await this.pgClient.query(`ANALYZE ${s}.ways_noded_vertices_pgr`);
      await this.pgClient.query(`ANALYZE ${s}.ways_noded`);
      await this.pgClient.query(`ANALYZE ${s}.routing_nodes`);
      await this.pgClient.query(`ANALYZE ${s}.routing_edges`);
      await this.pgClient.query(`ANALYZE ${s}.node_mapping`);
      await this.pgClient.query(`ANALYZE ${s}.edge_mapping`);
      console.log(`✅ ANALYZE (${stage}) completed in ${(Date.now() - start)}ms`);
    } catch (e) {
      console.log(`⚠️  ANALYZE (${stage}) failed: ${e}`);
    }
  }

  private async createRoutingIndexes(): Promise<void> {
    const s = this.stagingSchema;
    console.log('⚙️  Creating indexes to optimize routefinding...');
    const start = Date.now();
    try {
      // ways_noded
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_ways_noded_source ON ${s}.ways_noded(source)`);
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_ways_noded_target ON ${s}.ways_noded(target)`);
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_ways_noded_source_target ON ${s}.ways_noded(source, target)`);
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_ways_noded_id ON ${s}.ways_noded(id)`);
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_ways_noded_length ON ${s}.ways_noded(length_km)`);
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_ways_noded_geom ON ${s}.ways_noded USING GIST(the_geom)`);

      // ways_noded_vertices_pgr
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_vertices_id ON ${s}.ways_noded_vertices_pgr(id)`);
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_vertices_geom ON ${s}.ways_noded_vertices_pgr USING GIST(the_geom)`);
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_vertices_cnt ON ${s}.ways_noded_vertices_pgr(cnt)`);

      // node_mapping / edge_mapping
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_node_mapping_pg_id ON ${s}.node_mapping(pg_id)`);
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_node_mapping_type ON ${s}.node_mapping(node_type)`);
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_node_mapping_degree ON ${s}.node_mapping(connection_count)`);
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_edge_mapping_pg_id ON ${s}.edge_mapping(pg_id)`);

      // routing_edges / routing_nodes
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_routing_edges_source ON ${s}.routing_edges(source)`);
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_routing_edges_target ON ${s}.routing_edges(target)`);
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_routing_edges_source_target ON ${s}.routing_edges(source, target)`);
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_routing_edges_geom ON ${s}.routing_edges USING GIST(geometry)`);
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${s}_routing_nodes_id ON ${s}.routing_nodes(id)`);

      console.log(`✅ Index creation completed in ${(Date.now() - start)}ms`);
    } catch (e) {
      console.log(`⚠️  Index creation failed: ${e}`);
    }
  }

  async createPgRoutingViews(): Promise<boolean> {
    try {
      console.log('🔄 Starting pgRouting network creation from trail data...');
      
      // Get configurable tolerance settings
      const tolerances = getPgRoutingTolerances();
      console.log(`📏 Using pgRouting tolerances:`, tolerances);
      
      // Drop existing pgRouting tables if they exist
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways_noded_vertices_pgr`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.node_mapping`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.edge_mapping`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways_noded`);
      
      console.log('✅ Dropped existing pgRouting tables');

      // Check if trails table exists and has data (these are now the split segments)
      const trailsResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      `);
      
      if (trailsResult.rows[0].count === 0) {
        throw new Error('trails table is empty. Trail splitting must be completed first.');
      }
      
      console.log(`📊 Found ${trailsResult.rows[0].count} segments in trails table`);
      
      // Use trails table directly as ways_noded (since they're already split)
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.ways_noded AS
        SELECT 
          id,
          id as old_id,  -- Use id as old_id for consistency
          app_uuid,
          geometry as the_geom,
          ST_Length(geometry::geography) / 1000 as length_km,
          COALESCE(elevation_gain, 0) as elevation_gain,
          COALESCE(elevation_loss, 0) as elevation_loss,
          COALESCE(trail_type, 'hiking') as trail_type,
          COALESCE(surface, 'dirt') as surface,
          COALESCE(difficulty, 'moderate') as difficulty,
          COALESCE(name, 'Unnamed Trail') as name
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL AND ST_NumPoints(geometry) >= 2
      `);
      
      console.log(`✅ Created ways_noded table with ${trailsResult.rows[0].count} edges from trails`);
      
      // Create vertices table from only the start and end points of ways_noded
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.ways_noded_vertices_pgr AS
        SELECT 
          ROW_NUMBER() OVER (ORDER BY point_geom) as id,
          point_geom as the_geom,
          COUNT(*) OVER (PARTITION BY point_geom) as cnt
        FROM (
          SELECT ST_StartPoint(the_geom) as point_geom FROM ${this.stagingSchema}.ways_noded
          UNION ALL
          SELECT ST_EndPoint(the_geom) as point_geom FROM ${this.stagingSchema}.ways_noded
        ) endpoints
      `);
      
      console.log(`✅ Created ways_noded_vertices_pgr table from start/end points (intersection nodes created automatically when endpoints are within tolerance)`);
      
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
            WHERE ST_DWithin(ST_StartPoint(wn.the_geom), v.the_geom, ${tolerances.edgeToVertexTolerance})
            LIMIT 1
          ),
          target = (
            SELECT v.id 
            FROM ${this.stagingSchema}.ways_noded_vertices_pgr v 
            WHERE ST_DWithin(ST_EndPoint(wn.the_geom), v.the_geom, ${tolerances.edgeToVertexTolerance})
            LIMIT 1
          )
      `);

      // Remove edges that couldn't be connected to vertices
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.ways_noded 
        WHERE source IS NULL OR target IS NULL
      `);
      console.log('✅ Connected edges to vertices');
      
      // Create routing edges from ways_noded
      console.log(`🛤️ Creating routing edges in ${this.stagingSchema}.routing_edges...`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.routing_edges`);
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.routing_edges AS
        SELECT 
          wn.id,
          wn.source,
          wn.target,
          wn.app_uuid as trail_id,
          COALESCE(wn.name, 'Trail ' || wn.app_uuid) as trail_name,
          wn.length_km as length_km,
          wn.elevation_gain,
          COALESCE(wn.elevation_loss, 0) as elevation_loss,
          true as is_bidirectional,
          wn.the_geom as geometry,
          ST_AsGeoJSON(wn.the_geom) as geojson
        FROM ${this.stagingSchema}.ways_noded wn
        WHERE wn.source IS NOT NULL AND wn.target IS NOT NULL
      `);
      console.log('✅ Created routing edges');
      
      // Create routing nodes from vertices
      console.log(`📍 Creating routing nodes in ${this.stagingSchema}.routing_nodes...`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.routing_nodes`);
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.routing_nodes AS
        SELECT 
          v.id,
          v.id as node_uuid,
          ST_Y(v.the_geom) as lat,
          ST_X(v.the_geom) as lng,
          COALESCE(ST_Z(v.the_geom), 0) as elevation,
          CASE 
            WHEN v.cnt >= 2 THEN 'intersection'
            WHEN v.cnt = 1 THEN 'endpoint'
            ELSE 'endpoint'
          END as node_type,
          '' as connected_trails,
          ST_AsGeoJSON(v.the_geom, 6, 0) as geojson
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        WHERE v.the_geom IS NOT NULL
      `);
      console.log('✅ Created routing nodes');
      
      // Analyze key tables BEFORE index creation to capture baseline
      await this.analyzeRoutingTables('pre-index');

      // Populate split_trails table by mapping directly from ways_noded edges
      console.log('🔄 Populating split_trails table by mapping from ways_noded edges...');
      
      // Clear existing split_trails
      await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.split_trails`);
      
      // Map each edge from ways_noded to a corresponding split_trail
      // Join with original trails to get full metadata
      const splitTrailsResult = await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.split_trails (
          original_trail_id, segment_number, app_uuid, name, trail_type, surface, difficulty,
          source_tags, osm_id, elevation_gain, elevation_loss, max_elevation, min_elevation, 
          avg_elevation, length_km, source, geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, 
          bbox_max_lat, created_at, updated_at
        )
        SELECT 
          wn.old_id as original_trail_id,
          ROW_NUMBER() OVER (PARTITION BY wn.old_id ORDER BY wn.id) as segment_number,
          t.app_uuid,
          COALESCE(wn.name, t.name, 'Unnamed Trail') as name,
          COALESCE(t.trail_type, 'hiking') as trail_type,
          COALESCE(t.surface, 'dirt') as surface,
          COALESCE(t.difficulty, 'moderate') as difficulty,
          t.source_tags,
          t.osm_id,
          COALESCE(t.elevation_gain, 0) as elevation_gain,
          COALESCE(t.elevation_loss, 0) as elevation_loss,
          COALESCE(t.max_elevation, 0) as max_elevation,
          COALESCE(t.min_elevation, 0) as min_elevation,
          COALESCE(t.avg_elevation, 0) as avg_elevation,
          wn.length_km,
          'pgrouting' as source,
          wn.the_geom as geometry,
          ST_XMin(wn.the_geom) as bbox_min_lng,
          ST_XMax(wn.the_geom) as bbox_max_lng,
          ST_YMin(wn.the_geom) as bbox_min_lat,
          ST_YMax(wn.the_geom) as bbox_max_lat,
          t.created_at,
          t.updated_at
        FROM ${this.stagingSchema}.ways_noded wn
        LEFT JOIN ${this.stagingSchema}.trails t ON wn.old_id = t.id
        WHERE wn.the_geom IS NOT NULL AND ST_NumPoints(wn.the_geom) >= 2
        ORDER BY wn.id
      `);
      
      console.log(`✅ Created ${splitTrailsResult.rowCount} split trails from ways_noded edges`);
      
      // Verify the split_trails table has data
      const splitTrailsCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.split_trails
      `);
      console.log(`📊 Split trails table now contains ${splitTrailsCount.rows[0].count} segments`);
      
      if (splitTrailsCount.rows[0].count === 0) {
        throw new Error('Failed to populate split_trails table. No segments were created.');
      }
      
      console.log('✅ Split trails table populated with full trail data split at nodes');

      // Analyze graph connectivity
      console.log('🔍 Analyzing graph connectivity...');
      const analyzeResult = await this.pgClient.query(`
        SELECT pgr_analyzeGraph('${this.stagingSchema}.ways_noded', ${tolerances.graphAnalysisTolerance}, 'the_geom', 'id', 'source', 'target')
      `);
      console.log('✅ Graph analysis completed');

      // Create node mapping table to map pgRouting integer IDs back to our UUIDs
      const nodeMappingResult = await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.node_mapping AS
        SELECT 
          v.id as pg_id,
          v.cnt as connection_count,
          CASE 
            WHEN v.cnt >= 2 THEN 'intersection'
            WHEN v.cnt = 1 THEN 'endpoint'
            WHEN v.cnt = 0 THEN 'endpoint'  -- Isolated nodes should be endpoints
            ELSE 'endpoint'  -- Default to endpoint for any edge cases
          END as node_type
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
      `);
      console.log(`✅ Created node mapping table with ${nodeMappingResult.rowCount} rows`);

      // Create edge mapping table to map pgRouting integer IDs back to trail metadata
      const edgeMappingResult = await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.edge_mapping AS
        SELECT 
          wn.id as pg_id,
          wn.old_id as original_trail_id,
          wn.app_uuid as app_uuid,
          COALESCE(wn.name, 'Unnamed Trail') as trail_name,
          wn.length_km as length_km,
          wn.elevation_gain as elevation_gain,
          wn.elevation_loss as elevation_loss,
          'hiking' as trail_type,
          'dirt' as surface,
          'moderate' as difficulty,
          0 as max_elevation,
          0 as min_elevation,
          0 as avg_elevation
        FROM ${this.stagingSchema}.ways_noded wn
      `);
      console.log(`✅ Created edge mapping table with ${edgeMappingResult.rowCount} rows`);

      // Create performance indexes to speed up routing queries
      await this.createRoutingIndexes();

      // Analyze again AFTER adding indexes so the planner has up-to-date stats
      await this.analyzeRoutingTables('post-index');

      // Validate edge mapping coverage
      const edgeMappingCoverage = await this.pgClient.query(`
        SELECT 
          COUNT(DISTINCT wn.id) as total_edges,
          COUNT(DISTINCT em.pg_id) as mapped_edges,
          COUNT(DISTINCT wn.id) - COUNT(DISTINCT em.pg_id) as unmapped_edges,
          CASE 
            WHEN COUNT(DISTINCT wn.id) > 0 
            THEN (COUNT(DISTINCT em.pg_id)::float / COUNT(DISTINCT wn.id)::float) * 100
            ELSE 0
          END as coverage_percent
        FROM ${this.stagingSchema}.ways_noded wn
        LEFT JOIN ${this.stagingSchema}.edge_mapping em ON wn.id = em.pg_id
      `);
      
      const coverage = edgeMappingCoverage.rows[0];
      console.log(`📊 Edge mapping coverage: ${coverage.mapped_edges}/${coverage.total_edges} edges mapped (${coverage.coverage_percent}%)`);
      
      if (coverage.unmapped_edges > 0) {
        console.warn(`⚠️  ${coverage.unmapped_edges} edges without metadata - using fallback values`);
      } else {
        console.log(`✅ 100% edge mapping coverage achieved!`);
      }

      return true;
    } catch (error) {
      console.error(`❌ Failed to create pgRouting nodeNetwork: ${error}`);
      throw error;
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
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr n
        WHERE NOT EXISTS (
          SELECT 1 FROM ${this.stagingSchema}.ways_noded e
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

export function createPgRoutingHelpers(stagingSchema: string, pgClient: Pool, usePgNodeNetwork: boolean = false): PgRoutingHelpers {
  return new PgRoutingHelpers({
    stagingSchema,
    pgClient,
    usePgNodeNetwork
  });
} 