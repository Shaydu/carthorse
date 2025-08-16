import { Pool } from 'pg';
import { getPgRoutingTolerances, getConstants, getPgRoutingConfig } from './config-loader';

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
      // Check if we should use pgRouting direct topology
      const pgroutingConfig = getPgRoutingConfig();
      
      if (pgroutingConfig.enableDirectTopology) {
        console.log('🔄 Using pgRouting direct topology creation...');
        return this.createPgRoutingViewsWithDirectTopology();
      }
      
      console.log('🔄 Starting pgRouting network creation from trail data...');
      
      // Get configurable tolerance settings
      const tolerances = getPgRoutingTolerances();
      console.log(`📏 Using pgRouting tolerances:`, tolerances);

      // Trail-level bridging moved to Layer 1 trail processing service
      console.log('🧵 Trail-level bridging: DISABLED - moved to Layer 1 trail processing service');
      
      // Drop existing pgRouting tables if they exist
      console.log('🗑️  Dropping existing pgRouting tables...');
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways_noded_vertices_pgr`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.node_mapping`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.edge_mapping`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways_noded`);
      
      console.log('✅ Dropped existing pgRouting tables');

      // Create a trails table for pgRouting from our existing trail data (including connectors)
      console.log('📊 Creating ways table from trail data...');
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
            WHEN ST_IsSimple(geometry) THEN ST_Force2D(geometry)
            ELSE ST_Force2D(ST_MakeValid(geometry))
          END as the_geom
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      `);
      console.log(`✅ Created ways table with ${trailsTableResult.rowCount} rows from trail data`);
      
      // Check if ways table has data
      const waysCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.ways`);
      console.log(`📊 Ways table contains ${waysCount.rows[0].count} rows`);
      
      if (waysCount.rows[0].count === 0) {
        console.error('❌ Ways table is empty - no valid trails found');
        return false;
      }

      // Enhanced geometry cleanup for pgRouting compatibility (preserving coordinates)
      console.log('🔧 Enhanced geometry cleanup for pgRouting (preserving coordinates)...');
      
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
      
      // Step 3: Fix invalid geometries (minimal processing to preserve coordinates)
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways 
        SET the_geom = ST_MakeValid(the_geom)
        WHERE NOT ST_IsValid(the_geom)
      `);
      
      // Step 4: Remove problematic geometries that can't be fixed
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.ways 
        WHERE ST_GeometryType(the_geom) != 'ST_LineString'
          OR NOT ST_IsSimple(the_geom)
          OR ST_IsEmpty(the_geom)
          OR ST_Length(the_geom::geography) < 1.0  -- Minimum 1 meter
      `);
      
      // Step 5: Final validation and cleanup
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.ways 
        WHERE NOT ST_IsValid(the_geom)
          OR ST_GeometryType(the_geom) != 'ST_LineString'
      `);
      
      // Step 6: Enhanced cleanup to prevent GeometryCollection issues with pgRouting
      console.log('🔧 Enhanced cleanup to prevent GeometryCollection issues...');
      
      // First, try to extract LineStrings from GeometryCollections
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways 
        SET the_geom = (
          SELECT ST_LineMerge(ST_CollectionHomogenize(the_geom))
          WHERE ST_GeometryType(the_geom) = 'ST_GeometryCollection'
            AND ST_NumGeometries(ST_CollectionHomogenize(the_geom)) = 1
        )
        WHERE ST_GeometryType(the_geom) = 'ST_GeometryCollection'
          AND ST_NumGeometries(ST_CollectionHomogenize(the_geom)) = 1
      `);
      
      // For GeometryCollections with multiple geometries, extract the longest LineString
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways 
        SET the_geom = (
          SELECT ST_LineMerge(geom)
          FROM (
            SELECT ST_CollectionHomogenize(the_geom) as collection
            FROM ${this.stagingSchema}.ways w2
            WHERE w2.id = ${this.stagingSchema}.ways.id
              AND ST_GeometryType(w2.the_geom) = 'ST_GeometryCollection'
          ) sub,
          LATERAL (
            SELECT geom, ST_Length(geom::geography) as len
            FROM ST_Dump(collection)
            WHERE ST_GeometryType(geom) = 'ST_LineString'
            ORDER BY ST_Length(geom::geography) DESC
            LIMIT 1
          ) longest
        )
        WHERE ST_GeometryType(the_geom) = 'ST_GeometryCollection'
      `);
      
      // Remove any trails that still have problematic geometries
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.ways 
        WHERE ST_GeometryType(the_geom) != 'ST_LineString'
          OR ST_IsEmpty(the_geom)
          OR ST_Length(the_geom::geography) < 0.0001  -- Allow shorter segments (0.1m instead of 1m)
          OR NOT ST_IsValid(the_geom)
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
      
      // Additional validation: ensure all geometries are simple LineStrings
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.ways 
        WHERE NOT ST_IsSimple(the_geom)
          OR ST_NumPoints(the_geom) < 2
      `);
      
      // Check how many trails remain after cleanup
      const remainingTrails = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.ways
      `);
      console.log(`✅ Enhanced geometry cleanup for pgRouting: ${remainingTrails.rows[0].count} trails remaining`);
      
      if (remainingTrails.rows[0].count === 0) {
        throw new Error('No valid trails remaining after geometry cleanup');
      }

      // Legacy network creation service removed - using direct pgRouting topology instead
      console.log('🔄 Using direct pgRouting topology creation...');

      // Step 1: Create routing edges table directly from trails
      console.log('📊 Creating routing edges from trails...');
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.routing_edges AS
        SELECT 
          id,
          app_uuid,
          name,
          trail_type,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_SimplifyPreserveTopology(ST_Force2D(geometry), 0.0001) as geom
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND length_km > 0
      `);

      // Step 2: Add routing topology columns
      await this.pgClient.query(`
        ALTER TABLE ${this.stagingSchema}.routing_edges 
        ADD COLUMN source INTEGER,
        ADD COLUMN target INTEGER
      `);

      // Step 3: Create pgRouting topology directly
      const topologyTolerance = 0.001; // 111 meters
      console.log(`🔗 Creating pgRouting topology with ${topologyTolerance} tolerance...`);
      const topologyResult = await this.pgClient.query(`
        SELECT pgr_createTopology('${this.stagingSchema}.routing_edges', ${topologyTolerance}, 'geom', 'id')
      `);
      console.log('✅ pgRouting topology created');

      // Step 4: Create ways_noded table from routing_edges (for compatibility)
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.ways_noded AS
        SELECT 
          id,
          app_uuid as old_id,
          app_uuid,  -- Keep app_uuid for route generation services
          name,
          trail_type,
          length_km,
          elevation_gain,
          elevation_loss,
          geom as the_geom,
          source,
          target
        FROM ${this.stagingSchema}.routing_edges
      `);

      // Step 5: Create ways_noded_vertices_pgr table from topology
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.ways_noded_vertices_pgr AS
        SELECT 
          id,
          the_geom,
          cnt
        FROM ${this.stagingSchema}.routing_edges_vertices_pgr
      `);

      // Step 6: Analyze graph connectivity
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
          wn.old_id as app_uuid,  -- Use old_id as app_uuid since we don't have app_uuid in ways_noded
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

      // Composition tracking is now initialized in PostgisNodeStrategy after ways_noded creation
      console.log('📋 Composition tracking already initialized in network creation strategy');

      // Create ID mapping table to map trail IDs to pgRouting integer IDs
      const idMappingResult = await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.id_mapping AS
        SELECT 
          wn.old_id::text as trail_id,
          v.id as pgrouting_id
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        JOIN ${this.stagingSchema}.ways_noded wn ON v.id = wn.source OR v.id = wn.target
        GROUP BY wn.old_id, v.id
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
      console.log('✅ Node type classification integrated directly into ways_noded_vertices_pgr');

      // ✅ No longer need routing_edges table - using ways_noded as single source of truth
      console.log('✅ Using ways_noded as single source of truth for routing');
      
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

  /**
   * Fast graph analysis using custom queries instead of pgr_analyzeGraph
   * This is much faster than pgr_analyzeGraph for large networks
   */
  async fastAnalyzeGraph(): Promise<PgRoutingResult> {
    try {
      console.log('🔍 Running fast graph analysis...');
      
      // Check for dead ends (nodes with degree 1)
      const deadEndsResult = await this.pgClient.query(`
        WITH node_degrees AS (
          SELECT 
            id as node_id,
            (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded WHERE source = v.id OR target = v.id) as degree
          FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        )
        SELECT COUNT(*) as dead_ends
        FROM node_degrees 
        WHERE degree = 1
      `);
      
      // Check for isolated segments (nodes with degree 0)
      const isolatedResult = await this.pgClient.query(`
        WITH node_degrees AS (
          SELECT 
            id as node_id,
            (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded WHERE source = v.id OR target = v.id) as degree
          FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        )
        SELECT COUNT(*) as isolated_segments
        FROM node_degrees 
        WHERE degree = 0
      `);
      
      // Check for invalid source/target references
      const invalidSourceResult = await this.pgClient.query(`
        SELECT COUNT(*) as invalid_source
        FROM ${this.stagingSchema}.ways_noded w
        LEFT JOIN ${this.stagingSchema}.ways_noded_vertices_pgr v ON w.source = v.id
        WHERE v.id IS NULL
      `);
      
      const invalidTargetResult = await this.pgClient.query(`
        SELECT COUNT(*) as invalid_target
        FROM ${this.stagingSchema}.ways_noded w
        LEFT JOIN ${this.stagingSchema}.ways_noded_vertices_pgr v ON w.target = v.id
        WHERE v.id IS NULL
      `);
      
      // Check network connectivity (number of connected components)
      const connectivityResult = await this.pgClient.query(`
        WITH RECURSIVE connected_components AS (
          SELECT DISTINCT source as node_id, 1 as component_id
          FROM ${this.stagingSchema}.ways_noded
          WHERE source = (SELECT MIN(id) FROM ${this.stagingSchema}.ways_noded_vertices_pgr)
          
          UNION ALL
          
          SELECT DISTINCT w.source, cc.component_id
          FROM ${this.stagingSchema}.ways_noded w
          JOIN connected_components cc ON w.target = cc.node_id
          
          UNION ALL
          
          SELECT DISTINCT w.target, cc.component_id
          FROM ${this.stagingSchema}.ways_noded w
          JOIN connected_components cc ON w.source = cc.node_id
        )
        SELECT COUNT(DISTINCT component_id) as connected_components
        FROM connected_components
      `);
      
      const analysis = {
        dead_ends: parseInt(deadEndsResult.rows[0].dead_ends),
        isolated_segments: parseInt(isolatedResult.rows[0].isolated_segments),
        invalid_source: parseInt(invalidSourceResult.rows[0].invalid_source),
        invalid_target: parseInt(invalidTargetResult.rows[0].invalid_target),
        connected_components: parseInt(connectivityResult.rows[0].connected_components),
        analysis_method: 'fast_custom_analysis'
      };
      
      return {
        success: true,
        analysis
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Ultra-fast connectivity check - just counts connected components
   * Use this when you only need basic connectivity info
   */
  async quickConnectivityCheck(): Promise<PgRoutingResult> {
    try {
      const result = await this.pgClient.query(`
        WITH RECURSIVE reachable AS (
          SELECT source as node_id
          FROM ${this.stagingSchema}.ways_noded
          WHERE source = (SELECT MIN(id) FROM ${this.stagingSchema}.ways_noded_vertices_pgr)
          
          UNION ALL
          
          SELECT w.source
          FROM ${this.stagingSchema}.ways_noded w
          JOIN reachable r ON w.target = r.node_id
          
          UNION ALL
          
          SELECT w.target
          FROM ${this.stagingSchema}.ways_noded w
          JOIN reachable r ON w.source = r.node_id
        ),
        total_nodes AS (
          SELECT COUNT(*) as count FROM ${this.stagingSchema}.ways_noded_vertices_pgr
        )
        SELECT 
          COUNT(DISTINCT r.node_id) as reachable_nodes,
          t.count as total_nodes
        FROM reachable r, total_nodes t
      `);
      
      const reachable = parseInt(result.rows[0].reachable_nodes);
      const total = parseInt(result.rows[0].total_nodes);
      const connectivity_percentage = total > 0 ? (reachable / total * 100).toFixed(1) : '0.0';
      
      return {
        success: true,
        analysis: {
          reachable_nodes: reachable,
          total_nodes: total,
          connectivity_percentage: `${connectivity_percentage}%`,
          is_fully_connected: reachable === total,
          analysis_method: 'quick_connectivity_check'
        }
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

  /**
   * Create pgRouting views using direct topology creation
   * This bypasses custom node/edge generation and lets pgRouting handle everything
   */
  private async createPgRoutingViewsWithDirectTopology(): Promise<boolean> {
    try {
      const pgroutingConfig = getPgRoutingConfig();
      
      console.log('🛤️ Creating pgRouting views with direct topology...');
      console.log(`📋 Configuration:`);
      console.log(`   - Topology tolerance: ${pgroutingConfig.topologyTolerance || 0.001} degrees (${((pgroutingConfig.topologyTolerance || 0.001) * 111000).toFixed(1)}m)`);
      console.log(`   - Use Layer 2 network: ${pgroutingConfig.useLayer2Network || false}`);

      // Drop existing pgRouting tables if they exist
      console.log('🗑️  Dropping existing pgRouting tables...');
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways_noded_vertices_pgr`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways_noded`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.node_mapping`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.edge_mapping`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.id_mapping`);
      
      console.log('✅ Dropped existing pgRouting tables');

      // Create ways table from trails (simplified approach)
      console.log('📊 Creating ways table from trail data...');
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.ways AS
        SELECT 
          id,
          app_uuid,
          name,
          trail_type,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_SimplifyPreserveTopology(ST_Force2D(geometry), 0.0001) as the_geom
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND length_km > 0
      `);

      const waysCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.ways`);
      console.log(`✅ Created ways table with ${waysCount.rows[0].count} trails`);

      if (waysCount.rows[0].count === 0) {
        throw new Error('No valid trails found for pgRouting topology creation');
      }

      // Create pgRouting topology directly
      const topologyTolerance = pgroutingConfig.topologyTolerance || 0.001;
      console.log(`🔗 Creating pgRouting topology with ${topologyTolerance} tolerance...`);
      const topologyResult = await this.pgClient.query(`
        SELECT pgr_createTopology('${this.stagingSchema}.ways', ${topologyTolerance}, 'the_geom', 'id')
      `);
      
      if (topologyResult.rows[0].pgr_createtopology !== 'OK') {
        throw new Error(`pgRouting topology creation failed: ${topologyResult.rows[0].pgr_createtopology}`);
      }
      
      console.log('✅ pgRouting topology created successfully');

      // Get vertices table name
      const tablesResult = await this.pgClient.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = '${this.stagingSchema}' 
        AND table_name LIKE '%vertices%'
      `);

      if (tablesResult.rows.length === 0) {
        throw new Error('No vertices table found after pgRouting topology creation');
      }

      const verticesTableName = `${this.stagingSchema}.${tablesResult.rows[0].table_name}`;
      console.log(`✅ Vertices table: ${verticesTableName}`);

      // Create ways_noded table from the topology
      console.log('📊 Creating ways_noded table from topology...');
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.ways_noded AS
        SELECT 
          id,
          source,
          target,
          app_uuid,
          name,
          trail_type,
          length_km,
          elevation_gain,
          elevation_loss,
          the_geom
        FROM ${this.stagingSchema}.ways
        WHERE source IS NOT NULL AND target IS NOT NULL
      `);

      // Create ways_noded_vertices_pgr table from vertices
      console.log('📍 Creating ways_noded_vertices_pgr table from vertices...');
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.ways_noded_vertices_pgr AS
        SELECT 
          id,
          the_geom,
          cnt
        FROM ${verticesTableName}
      `);

      const nodeCount = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded_vertices_pgr`);
      const edgeCount = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded`);
      
      console.log(`✅ Created ${nodeCount.rows[0].count} nodes and ${edgeCount.rows[0].count} edges`);

      // Create mapping tables for compatibility
      console.log('📋 Creating mapping tables...');
      
      // Node mapping
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.node_mapping AS
        SELECT 
          v.id as pg_id,
          v.cnt as connection_count,
          CASE 
            WHEN v.cnt >= 3 THEN 'intersection'
            WHEN v.cnt = 2 THEN 'pass_through'
            WHEN v.cnt = 1 THEN 'endpoint'
            ELSE 'endpoint'
          END as node_type
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
      `);

      // Edge mapping
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.edge_mapping AS
        SELECT 
          wn.id as pg_id,
          wn.id as original_trail_id,
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

      // ID mapping
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.id_mapping AS
        SELECT 
          t.app_uuid,
          v.id as pgrouting_id
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        JOIN ${this.stagingSchema}.ways_noded wn ON v.id = wn.source OR v.id = wn.target
        JOIN ${this.stagingSchema}.trails t ON wn.id = t.id
        WHERE t.app_uuid IS NOT NULL
        GROUP BY t.app_uuid, v.id
      `);

      console.log('✅ Mapping tables created');

      // Test connectivity
      console.log('🔍 Testing connectivity...');
      const connectivityResult = await this.pgClient.query(`
        SELECT 
          component,
          COUNT(*) as node_count
        FROM pgr_connectedComponents(
          'SELECT id, source, target, length_km * 1000 as cost FROM ${this.stagingSchema}.ways_noded WHERE length_km > 0'
        )
        GROUP BY component
        ORDER BY node_count DESC
      `);

      const componentCount = connectivityResult.rows.length;
      console.log(`📊 Found ${componentCount} connected components:`);
      connectivityResult.rows.forEach((comp, i) => {
        console.log(`   Component ${i + 1}: ${comp.node_count} nodes`);
      });

      if (componentCount === 1) {
        console.log('✅ SUCCESS: Network is fully connected!');
      } else {
        console.log(`⚠️  Network has ${componentCount} components - some trails may be disconnected`);
      }

      return true;

    } catch (error) {
      console.error('❌ pgRouting direct topology creation failed:', error);
      return false;
    }
  }
}

export function createPgRoutingHelpers(stagingSchema: string, pgClient: Pool): PgRoutingHelpers {
  return new PgRoutingHelpers({
    stagingSchema,
    pgClient
  });
} 