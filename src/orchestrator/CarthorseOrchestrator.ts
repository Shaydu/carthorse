import { Pool } from 'pg';
import { PgRoutingHelpers } from '../utils/pgrouting-helpers';
import { RouteGenerationOrchestratorService } from '../utils/services/route-generation-orchestrator-service';
import { RouteAnalysisAndExportService } from '../utils/services/route-analysis-and-export-service';
import { RouteSummaryService } from '../utils/services/route-summary-service';
import { ConstituentTrailAnalysisService } from '../utils/services/constituent-trail-analysis-service';

import { getDatabasePoolConfig } from '../utils/config-loader';
import { GeoJSONExportStrategy, GeoJSONExportConfig } from '../utils/export/geojson-export-strategy';
import { getExportConfig } from '../utils/config-loader';
import { SQLiteExportStrategy, SQLiteExportConfig } from '../utils/export/sqlite-export-strategy';
import { validateDatabase } from '../utils/validation/database-validation-helpers';
import { TrailSplitter, TrailSplitterConfig } from '../utils/trail-splitter';
import { mergeDegree2Chains, deduplicateSharedVertices } from '../utils/services/network-creation/merge-degree2-chains';
import { detectAndFixGaps, validateGapDetection } from '../utils/services/network-creation/gap-detection-service';

export interface CarthorseOrchestratorConfig {
  region: string;
  bbox?: [number, number, number, number];
  outputPath: string;
  stagingSchema?: string;
  noCleanup?: boolean;
  useSplitTrails?: boolean; // Enable trail splitting at intersections
  minTrailLengthMeters?: number; // Minimum length for trail segments
  trailheadsEnabled?: boolean; // Enable trailhead-based route generation (alias for trailheads.enabled)
  skipValidation?: boolean; // Skip database validation
  verbose?: boolean; // Enable verbose logging
  exportConfig?: {
    includeTrails?: boolean;
    includeNodes?: boolean;
    includeEdges?: boolean;
    includeRoutes?: boolean;
  };
}

export class CarthorseOrchestrator {
  private pgClient: Pool;
  private config: CarthorseOrchestratorConfig;
  public readonly stagingSchema: string;
  private exportAlreadyCompleted: boolean = false;

  constructor(config: CarthorseOrchestratorConfig) {
    this.config = config;
    this.stagingSchema = config.stagingSchema || `carthorse_${Date.now()}`;
    
    // Get database configuration from config file
    const dbConfig = getDatabasePoolConfig();
    
    this.pgClient = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
      max: dbConfig.max,
      idleTimeoutMillis: dbConfig.idleTimeoutMillis,
      connectionTimeoutMillis: dbConfig.connectionTimeoutMillis
    });
  }

  /**
   * Main orchestrator method for KSP route generation
   */
  async generateKspRoutes(): Promise<void> {
    console.log('🚀 Starting KSP route generation...');
    
    try {
      // Track initial network connectivity
      console.log('🔍 Measuring initial network connectivity...');
      const initialConnectivity = await this.measureNetworkConnectivity('INITIAL');
      
      // Step 1: Create staging environment
      console.log('🔄 Step 1: Creating staging environment...');
      await this.createStagingEnvironment();
      console.log('✅ Step 1: Staging environment created');

      // Step 2: Copy trail data with bbox filter
      console.log('🔄 Step 2: Copying trail data...');
      await this.copyTrailData();
      console.log('✅ Step 2: Trail data copied');

      // Step 3: Split trails at intersections (if enabled)
      console.log('🔄 Step 3: About to split trails at intersections...');
      if (this.config.useSplitTrails !== false) {
        await this.splitTrailsAtIntersections();
        console.log('✅ Step 3: Trail splitting completed');
      } else {
        console.log('⏭️ Step 3: Trail splitting skipped');
      }

      // Step 4: Create pgRouting network first
      console.log('🔄 Step 4: About to create pgRouting network...');
      try {
        await this.createPgRoutingNetwork();
        console.log('✅ Step 4: pgRouting network creation completed');
      } catch (error) {
        console.error('❌ Step 4: pgRouting network creation failed:', error);
        throw error;
      }

      // Step 5: Add length and elevation columns (after network is created)
      console.log('🔄 Step 5: Adding length and elevation columns...');
      await this.addLengthAndElevationColumns();
      console.log('✅ Step 5: Length and elevation columns added');

      // Step 6: Iterative network optimization: Bridge → Deduplication → Degree-2 merge → Cleanup → Repeat
      console.log('🔄 Step 6: Starting iterative network optimization...');
      await this.iterativeNetworkOptimization();
      console.log('✅ Step 6: Iterative network optimization completed');

      // Step 7: Validate routing network (after network is created)
      console.log('🔍 DEBUG: About to validate routing network...');
      await this.validateRoutingNetwork();
      console.log('🔍 DEBUG: Routing network validation completed');

      // Step 8: REMOVED - Degree-2 merge is now handled in iterative optimization
      // The iterative optimization loop (Step 6) handles all degree-2 merging until convergence
      console.log('🔍 DEBUG: Degree-2 merge will be handled in iterative optimization...');

      // Step 9: REMOVED - Redundant iterative deduplication and merging
      // This was causing double processing of the network. Degree-2 merge is now handled
      // only in the iterativeNetworkOptimization method (Step 6)
      console.log('🔍 DEBUG: Iterative deduplication and merging removed - handled in Step 6');

      // Step 10: Clean up orphan nodes in pgRouting network
      console.log('🔄 Step 10: Cleaning up orphan nodes...');
      await this.cleanupOrphanNodes();
      console.log('✅ Step 10: Orphan node cleanup completed');

      // Step 11: Generate all routes using route generation orchestrator service
      console.log('🔍 DEBUG: About to call generateAllRoutesWithService...');
      await this.generateAllRoutesWithService();
      console.log('🔍 DEBUG: generateAllRoutesWithService completed');

      // Step 12: Generate analysis only (export will be handled separately)
      await this.generateRouteAnalysis();

      // Track final network connectivity
      console.log('🔍 Measuring final network connectivity...');
      const finalConnectivity = await this.measureNetworkConnectivity('FINAL');

      // Report connectivity summary
      console.log('\n📊 NETWORK CONNECTIVITY SUMMARY:');
      console.log('================================');
      console.log(`Initial connectivity: ${initialConnectivity.connectivityPercentage.toFixed(1)}% (${initialConnectivity.reachableNodes}/${initialConnectivity.totalNodes} nodes reachable)`);
      console.log(`Final connectivity:   ${finalConnectivity.connectivityPercentage.toFixed(1)}% (${finalConnectivity.reachableNodes}/${finalConnectivity.totalNodes} nodes reachable)`);
      
      const connectivityChange = finalConnectivity.connectivityPercentage - initialConnectivity.connectivityPercentage;
      if (connectivityChange > 0) {
        console.log(`✅ Connectivity IMPROVED by ${connectivityChange.toFixed(1)} percentage points`);
      } else if (connectivityChange < 0) {
        console.log(`❌ Connectivity DECREASED by ${Math.abs(connectivityChange).toFixed(1)} percentage points`);
      } else {
        console.log(`➡️  Connectivity remained UNCHANGED`);
      }
      
      console.log(`\nNetwork statistics:`);
      console.log(`  Initial: ${initialConnectivity.edgeCount} edges, ${initialConnectivity.vertexCount} vertices`);
      console.log(`  Final:   ${finalConnectivity.edgeCount} edges, ${finalConnectivity.vertexCount} vertices`);
      console.log(`  Change:  ${finalConnectivity.edgeCount - initialConnectivity.edgeCount} edges, ${finalConnectivity.vertexCount - initialConnectivity.vertexCount} vertices`);

      console.log('✅ KSP route generation completed successfully!');

    } catch (error) {
      console.error('❌ KSP route generation failed:', error);
      throw error;
    }
  }

  // Removed validateExistingStagingSchema method - always create new schemas

  /**
   * Create staging environment
   */
  private async createStagingEnvironment(): Promise<void> {
    console.log(`📁 Creating staging schema: ${this.stagingSchema}`);
    
    // Import the staging schema creation function
    const { getStagingSchemaSql, getSchemaQualifiedPostgisFunctionsSql } = await import('../utils/sql/staging-schema');
    
    // Drop existing schema if it exists
    await this.pgClient.query(`DROP SCHEMA IF EXISTS ${this.stagingSchema} CASCADE`);
    await this.pgClient.query(`CREATE SCHEMA ${this.stagingSchema}`);
    
    // Create staging tables using the proper schema creation function
    const stagingSchemaSql = getStagingSchemaSql(this.stagingSchema);
    await this.pgClient.query(stagingSchemaSql);
    
    // Create PostGIS functions in the staging schema
    console.log('🔧 Installing PostGIS functions in staging schema...');
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    
    try {
      // Read the orchestrator functions SQL file
      const functionsSqlPath = join(__dirname, '../../sql/carthorse-current-orchestrator-functions.sql');
      const functionsSql = readFileSync(functionsSqlPath, 'utf8');
      
      // Rewrite functions to use staging schema
      const stagingFunctionsSql = getSchemaQualifiedPostgisFunctionsSql(this.stagingSchema, functionsSql);
      
      // Execute the functions SQL
      await this.pgClient.query(stagingFunctionsSql);
      console.log('✅ PostGIS functions installed in staging schema');
      
      // Verify that the build_routing_edges function was installed
      const functionCheck = await this.pgClient.query(`
        SELECT proname, proargtypes::regtype[] as arg_types
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = $1 AND proname = 'build_routing_edges'
      `, [this.stagingSchema]);
      
      if (functionCheck.rows.length === 0) {
        throw new Error(`build_routing_edges function not found in schema ${this.stagingSchema}`);
      }
      
      const argTypes = functionCheck.rows[0].arg_types;
      const signature = Array.isArray(argTypes) ? argTypes.join(', ') : String(argTypes);
      console.log(`✅ Verified build_routing_edges function exists with signature: ${signature}`);
    } catch (error) {
      console.error('❌ Failed to install PostGIS functions in staging schema:', error);
      console.error('   This will cause issues with routing edge creation');
      throw error; // Re-throw to prevent silent failures
    }
    
    console.log('✅ Staging environment created');
  }

  /**
   * Copy trail data with bbox filter
   */
  private async copyTrailData(): Promise<void> {
    console.log('📊 Copying trail data...');
    
    let bboxParams: any[] = [];
    let bboxFilter = '';
    let bboxFilterWithAlias = '';
    
    if (this.config.bbox && this.config.bbox.length === 4) {
      const [minLng, minLat, maxLng, maxLat] = this.config.bbox;
      
      // Expand bbox by 0.01 degrees (~1km) to include connected trail segments
      // This ensures trails that intersect the bbox have their proper endpoints included
      const expansion = 0.01;
      const expandedMinLng = minLng - expansion;
      const expandedMaxLng = maxLng + expansion;
      const expandedMinLat = minLat - expansion;
      const expandedMaxLat = maxLat + expansion;
      
      bboxParams = [expandedMinLng, expandedMinLat, expandedMaxLng, expandedMaxLat];
      bboxFilter = `AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))`;
      bboxFilterWithAlias = `AND ST_Intersects(p.geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))`;
      
      console.log(`🗺️ Using expanded bbox filter: [${expandedMinLng}, ${expandedMinLat}, ${expandedMaxLng}, ${expandedMaxLat}] (original: [${minLng}, ${minLat}, ${maxLng}, ${maxLat}])`);
    } else {
      console.log('🗺️ Using region filter (no bbox specified)');
      bboxFilter = `AND region = $1`;
      bboxFilterWithAlias = `AND p.region = $1`;
      bboxParams = [this.config.region];
    }
    
    // First, check how many trails should be copied
    const expectedTrailsQuery = `
      SELECT COUNT(*) as count FROM public.trails 
      WHERE geometry IS NOT NULL ${bboxFilter}
    `;
    const expectedTrailsResult = await this.pgClient.query(expectedTrailsQuery, bboxParams);
    const expectedCount = parseInt(expectedTrailsResult.rows[0].count);
    console.log(`📊 Expected trails to copy: ${expectedCount}`);

    try {
      // Temporarily disable conflict check to isolate the issue
      console.log('🔍 Skipping conflict check for now...');
      
      // Temporarily disable validation check to isolate the issue
      console.log('🔍 Skipping validation check for now...');
      
      console.log(`🔍 About to execute INSERT for ${expectedCount} trails...`);
      
      // Debug: Check if our specific missing trail is in the source data
      const debugTrailQuery = `
        SELECT app_uuid, name, length_km, ST_AsText(ST_StartPoint(geometry)) as start_point
        FROM public.trails
        WHERE geometry IS NOT NULL ${bboxFilter}
        AND ST_AsText(ST_StartPoint(geometry)) LIKE 'POINT(-105.283366%39.969589%'
        ORDER BY name
      `;
      const debugTrailCheck = await this.pgClient.query(debugTrailQuery, bboxParams);
      
      if (debugTrailCheck.rowCount && debugTrailCheck.rowCount > 0) {
        console.log('🔍 DEBUG: Found our target trail in source data:');
        debugTrailCheck.rows.forEach((trail: any) => {
          console.log(`   - ${trail.name} (${trail.app_uuid}): ${trail.length_km}km, starts at ${trail.start_point}`);
        });
      } else {
        console.log('🔍 DEBUG: Target trail NOT found in source data with current bbox filter');
      }

      const insertQuery = `
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, name, trail_type, surface, difficulty,
          geometry, length_km, elevation_gain, elevation_loss,
          max_elevation, min_elevation, avg_elevation, region,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        )
        SELECT
          app_uuid::text, name, trail_type, surface, difficulty,
          geometry, length_km, elevation_gain, elevation_loss,
          max_elevation, min_elevation, avg_elevation, region,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        FROM public.trails
        WHERE geometry IS NOT NULL ${bboxFilter}
      `;
      
      console.log('🔍 DEBUG: About to execute INSERT query:');
      console.log(insertQuery);
      console.log('🔍 DEBUG: With parameters:', bboxParams);
      
      const insertResult = await this.pgClient.query(insertQuery, bboxParams);
      console.log(`📊 Insert result: ${insertResult.rowCount} rows inserted`);
      console.log(`🔍 Insert result details:`, insertResult);
      
      // Debug: Check if our specific trail made it into staging
      const debugStagingCheck = await this.pgClient.query(`
        SELECT app_uuid, name, length_km, ST_AsText(ST_StartPoint(geometry)) as start_point
        FROM ${this.stagingSchema}.trails
        WHERE ST_AsText(ST_StartPoint(geometry)) LIKE 'POINT(-105.283366%39.969589%'
        ORDER BY name
      `);
      if (debugStagingCheck.rowCount && debugStagingCheck.rowCount > 0) {
        console.log('🔍 DEBUG: Target trail successfully copied to staging:');
        debugStagingCheck.rows.forEach((trail: any) => {
          console.log(`   - ${trail.name} (${trail.app_uuid}): ${trail.length_km}km, starts at ${trail.start_point}`);
        });
      } else {
        console.log('🔍 DEBUG: Target trail NOT found in staging schema after insert');
      }
      
      if (insertResult.rowCount !== expectedCount) {
        console.error(`❌ ERROR: Expected ${expectedCount} trails but inserted ${insertResult.rowCount}`);
        
        // Find exactly which trails failed to copy
        const missingTrails = await this.pgClient.query(`
          SELECT app_uuid, name, region, length_km 
          FROM public.trails p
          WHERE p.geometry IS NOT NULL ${bboxFilterWithAlias}
          AND p.app_uuid::text NOT IN (
            SELECT app_uuid FROM ${this.stagingSchema}.trails
          )
          ORDER BY name, length_km
        `);
        
        if (missingTrails.rowCount && missingTrails.rowCount > 0) {
          console.error('❌ ERROR: The following trails failed to copy:');
          missingTrails.rows.forEach((trail: any) => {
            console.error(`   - ${trail.name} (${trail.app_uuid}): ${trail.length_km}km`);
          });
        }
        
        throw new Error(`Trail copying failed: expected ${expectedCount} trails but inserted ${insertResult.rowCount}. ${missingTrails.rowCount || 0} trails are missing.`);
      } else {
        console.log(`✅ Successfully copied all ${expectedCount} trails to staging schema`);
      }
    } catch (error) {
      console.error('❌ CRITICAL ERROR during trail copying:');
      console.error('   This indicates a data integrity issue or system problem.');
      console.error('   The export cannot proceed until this is resolved.');
      console.error('   Error details:', error);
      throw error;
    }

    const trailsCount = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.trails`);
    const actualCount = trailsCount.rows[0].count;
    console.log(`✅ Copied ${actualCount} trails to staging`);
    
    // Verify that all expected trails were copied
    if (actualCount < expectedCount) {
      console.warn(`⚠️ Warning: Only ${actualCount}/${expectedCount} trails were copied to staging`);
      
      // Log specific missing trails for debugging
      const missingTrails = await this.pgClient.query(`
        SELECT app_uuid, name, region, length_km 
        FROM public.trails p
        WHERE p.geometry IS NOT NULL ${bboxFilterWithAlias}
        AND p.app_uuid::text NOT IN (
          SELECT app_uuid FROM ${this.stagingSchema}.trails
        )
        ORDER BY name, length_km
      `);
      
      if (missingTrails.rowCount && missingTrails.rowCount > 0) {
        console.warn(`⚠️ Missing trails that should have been copied:`);
        missingTrails.rows.forEach((trail: any) => {
          console.warn(`   - ${trail.name} (${trail.app_uuid}): ${trail.length_km}km`);
        });
      }
    }
  }

  /**
   * Create pgRouting network
   */
  private async createPgRoutingNetwork(): Promise<void> {
    console.log('🔄 Creating pgRouting network...');
    
    if (this.config.verbose) {
      console.log('📊 Building routing network from split trail segments...');
    }
    
    // Check if trails exist before creating network
    const trailsCheck = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails WHERE geometry IS NOT NULL
    `);
    console.log(`📊 Found ${trailsCheck.rows[0].count} trails with geometry for pgRouting network creation`);
    
    if (trailsCheck.rows[0].count === 0) {
      console.warn('⚠️  No trails found for pgRouting network creation');
      return;
    }
    
    // Standard approach
    const pgrouting = new PgRoutingHelpers({
      stagingSchema: this.stagingSchema,
      pgClient: this.pgClient
    });

    console.log('🔄 Calling pgrouting.createPgRoutingViews()...');
    const networkCreated = await pgrouting.createPgRoutingViews();
    console.log(`🔄 pgrouting.createPgRoutingViews() returned: ${networkCreated}`);
    
    if (!networkCreated) {
      throw new Error('Failed to create pgRouting network');
    }

    // Check if tables were actually created
    const tablesCheck = await this.pgClient.query(`
      SELECT 
        EXISTS(SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded') as ways_noded_exists,
        EXISTS(SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded_vertices_pgr') as ways_noded_vertices_pgr_exists
    `, [this.stagingSchema]);
    
    console.log(`📊 Table existence check:`);
    console.log(`   - ways_noded: ${tablesCheck.rows[0].ways_noded_exists}`);
    console.log(`   - ways_noded_vertices_pgr: ${tablesCheck.rows[0].ways_noded_vertices_pgr_exists}`);

    // Get network statistics
    const statsResult = await this.pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded) as edges,
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded_vertices_pgr) as vertices
    `);
    console.log(`📊 Network created: ${statsResult.rows[0].edges} edges, ${statsResult.rows[0].vertices} vertices`);

    // Create merged trail chains from individual edges
    console.log('🔗 Creating merged trail chains...');
    const edgeCount = await this.createMergedTrailChains();
    console.log(`✅ Created ${edgeCount} merged trail chains`);
  }

  /**
   * Create merged trail chains from individual routing edges
   */
  private async createMergedTrailChains(): Promise<number> {
    try {
      console.log('🔗 Creating merged trail chains from routing edges...');
      
      // Call the build_routing_edges function to create merged trail chains
      const result = await this.pgClient.query(`
        SELECT ${this.stagingSchema}.build_routing_edges($1, 'trails')
      `, [this.stagingSchema]);
      
      const edgeCount = result.rows[0].build_routing_edges || 0;
      console.log(`✅ Created ${edgeCount} merged trail chains`);
      return edgeCount;
    } catch (error) {
      console.error('❌ Failed to create merged trail chains:', error);
      throw new Error(`Failed to create merged trail chains: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Detect and fix gaps in the trail network
   */
  private async detectAndFixGaps(): Promise<void> {
    console.log('🔍 Detecting and fixing gaps in trail network...');
    
    // Get gap detection tolerance from config (default 20 meters)
    const gapToleranceMeters = 20; // TODO: Make this configurable from YAML
    
    const gapConfig = {
      toleranceMeters: gapToleranceMeters,
      maxBridgesToCreate: 100 // Limit to prevent too many connections
    };
    
    // Validate gap detection before running
    const validation = await validateGapDetection(this.pgClient, this.stagingSchema, gapConfig);
    console.log(`📊 Gap detection validation:`);
    console.log(`   Total vertices: ${validation.totalVertices}`);
    console.log(`   Degree-1 vertices: ${validation.degree1Vertices}`);
    console.log(`   Degree-2+ vertices: ${validation.degree2PlusVertices}`);
    console.log(`   Potential gaps: ${validation.potentialGaps}`);
    
    // Run gap detection and fixing
    const result = await detectAndFixGaps(this.pgClient, this.stagingSchema, gapConfig);
    
    console.log(`🔍 Gap detection results:`);
    console.log(`   Gaps found: ${result.gapsFound}`);
    console.log(`   Bridges created: ${result.bridgesCreated}`);
    
    if (result.details.length > 0) {
      console.log(`   Bridge details:`);
      result.details.forEach((detail, index) => {
        console.log(`     ${index + 1}. Vertex ${detail.node1_id} → Vertex ${detail.node2_id} (${detail.distance_meters.toFixed(2)}m)`);
      });
    }
  }

  /**
   * Add length and elevation columns to ways_noded
   */
  private async addLengthAndElevationColumns(): Promise<void> {
    console.log('📏 Adding length and elevation columns to ways_noded...');
    
    // Add length_km column
    await this.pgClient.query(`
      ALTER TABLE ${this.stagingSchema}.ways_noded 
      ADD COLUMN IF NOT EXISTS length_km DOUBLE PRECISION
    `);
    
    // Calculate length in kilometers
    await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.ways_noded 
      SET length_km = ST_Length(the_geom::geography) / 1000
    `);
    
    // Add elevation_gain column
    await this.pgClient.query(`
      ALTER TABLE ${this.stagingSchema}.ways_noded 
      ADD COLUMN IF NOT EXISTS elevation_gain DOUBLE PRECISION DEFAULT 0
    `);
    
    // Calculate elevation gain by joining with trail data
    await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.ways_noded w
      SET elevation_gain = COALESCE(t.elevation_gain, 0)
      FROM ${this.stagingSchema}.trails t
      WHERE w.old_id = t.id
    `);
    
    console.log('✅ Added length_km and elevation_gain columns to ways_noded');
    console.log('⏭️ Skipping connectivity fixes to preserve trail-only routing');
  }

  /**
   * Split trails at intersections using the consolidated TrailSplitter
   */
  private async splitTrailsAtIntersections(): Promise<void> {
    console.log('🔪 Splitting trails at intersections...');
    
    // Get minimum trail length from config or use default
    const minTrailLengthMeters = this.config.minTrailLengthMeters || 100.0;
    
    // Create trail splitter configuration
    const splitterConfig: TrailSplitterConfig = {
      minTrailLengthMeters,
      verbose: this.config.verbose
    };
    
    // Create trail splitter instance
    const trailSplitter = new TrailSplitter(this.pgClient, this.stagingSchema, splitterConfig);
    
    // Build source query for trails in staging
    const sourceQuery = `SELECT * FROM ${this.stagingSchema}.trails WHERE geometry IS NOT NULL AND ST_IsValid(geometry)`;
    const params: any[] = [];
    
    // Execute trail splitting
    const result = await trailSplitter.splitTrails(sourceQuery, params);
    
    if (result.success) {
      console.log(`✅ Trail splitting completed:`);
      console.log(`   📊 Original trails: ${result.originalCount}`);
      console.log(`   ✂️ Split segments: ${result.splitCount}`);
      console.log(`   🔗 Merged overlaps: ${result.mergedOverlaps}`);
      console.log(`   🧹 Short segments removed: ${result.shortSegmentsRemoved}`);
      console.log(`   📈 Final segments: ${result.finalCount}`);
    } else {
      console.log(`❌ Trail splitting failed`);
    }
    
    if (this.config.verbose) {
      console.log('🔍 Trail splitting phase complete, proceeding to pgRouting network creation...');
    }
  }

  /**
   * Generate all routes using the route generation orchestrator service
   */
  private async generateAllRoutesWithService(): Promise<void> {
    console.log('🎯 Generating all routes using route generation orchestrator service...');
    
    // Load route discovery configuration
    const { RouteDiscoveryConfigLoader } = await import('../config/route-discovery-config-loader');
    const configLoader = RouteDiscoveryConfigLoader.getInstance();
    const routeDiscoveryConfig = configLoader.loadConfig();
    
    console.log(`📋 Route discovery configuration:`);
    console.log(`   - KSP K value: ${routeDiscoveryConfig.routing.kspKValue}`);
    console.log(`   - Degree2 merge tolerance: ${routeDiscoveryConfig.routing.degree2MergeTolerance}m`);
    console.log(`   - Edge tolerance: ${routeDiscoveryConfig.routing.edgeTolerance}m`);
    console.log(`   - Min distance between routes: ${routeDiscoveryConfig.routing.minDistanceBetweenRoutes}km`);
    console.log(`   - Trailhead enabled: ${routeDiscoveryConfig.trailheads.enabled}`);
    console.log(`   - Trailhead strategy: ${routeDiscoveryConfig.trailheads.selectionStrategy}`);
    console.log(`   - Max trailheads: ${routeDiscoveryConfig.trailheads.maxTrailheads}`);
    console.log(`   - Tolerance levels:`);
    console.log(`     - Strict: ${routeDiscoveryConfig.recommendationTolerances.strict.distance}% distance, ${routeDiscoveryConfig.recommendationTolerances.strict.elevation}% elevation`);
    console.log(`     - Medium: ${routeDiscoveryConfig.recommendationTolerances.medium.distance}% distance, ${routeDiscoveryConfig.recommendationTolerances.medium.elevation}% elevation`);
    console.log(`     - Wide: ${routeDiscoveryConfig.recommendationTolerances.wide.distance}% distance, ${routeDiscoveryConfig.recommendationTolerances.wide.elevation}% elevation`);
    console.log(`   - Custom: ${routeDiscoveryConfig.recommendationTolerances.custom.distance}% distance, ${routeDiscoveryConfig.recommendationTolerances.custom.elevation}% elevation`);

    const routeGenerationService = new RouteGenerationOrchestratorService(this.pgClient, {
      stagingSchema: this.stagingSchema,
      region: this.config.region,
      targetRoutesPerPattern: routeDiscoveryConfig.routeGeneration?.ksp?.targetRoutesPerPattern || 100,
      minDistanceBetweenRoutes: routeDiscoveryConfig.routing.minDistanceBetweenRoutes,
      kspKValue: routeDiscoveryConfig.routing.kspKValue, // Use KSP K value from YAML config
      generateKspRoutes: true,
      generateLoopRoutes: true,
              useTrailheadsOnly: this.config.trailheadsEnabled, // Use explicit trailheads configuration from CLI
      loopConfig: {
        useHawickCircuits: routeDiscoveryConfig.routeGeneration?.loops?.useHawickCircuits !== false,
        targetRoutesPerPattern: routeDiscoveryConfig.routeGeneration?.loops?.targetRoutesPerPattern || 50
      }
    });

    await routeGenerationService.generateAllRoutes();
  }

  /**
   * Generate route analysis using the analysis and export service
   */
  private async generateRouteAnalysis(): Promise<void> {
    console.log('📊 Generating route analysis using analysis and export service...');
    
    const analysisAndExportService = new RouteAnalysisAndExportService(this.pgClient, {
      stagingSchema: this.stagingSchema,
      outputPath: this.config.outputPath,
      exportConfig: this.config.exportConfig
    });

    const result = await analysisAndExportService.generateRouteAnalysis();
    
    console.log(`✅ Route analysis completed:`);
    console.log(`   📊 Routes analyzed: ${result.constituentAnalysis.totalRoutesAnalyzed}`);
  }




  /**
   * Validate database environment (schema version, required functions)
   */
  private async validateDatabaseEnvironment(): Promise<void> {
    // Skip validation if skipValidation is enabled
    if (this.config.skipValidation) {
      console.log('⏭️ Skipping database validation (--skip-validation flag used)');
      return;
    }
    
    console.log('🔍 Validating database environment...');
    
    try {
      // Only validate schema version and functions, not network (which doesn't exist yet)
      const { checkMasterSchemaVersion, checkRequiredSqlFunctions } = await import('../utils/validation/database-validation-helpers');
      
      const schemaResult = await checkMasterSchemaVersion(this.pgClient);
      const functionsResult = await checkRequiredSqlFunctions(this.pgClient);
      
      const results = [schemaResult, functionsResult];
      const failedValidations = results.filter(result => !result.success);
      
      if (failedValidations.length > 0) {
        console.error('❌ Database validation failed:');
        failedValidations.forEach(result => {
          console.error(`   ${result.message}`);
          if (result.details) {
            console.error(`   Details:`, result.details);
          }
        });
        throw new Error('Database validation failed');
      }
      
      console.log('✅ Database environment validation passed');
    } catch (error) {
      console.error('❌ Database environment validation failed:', error);
      throw error;
    }
  }

  /**
   * Validate routing network topology
   */
  private async validateRoutingNetwork(): Promise<void> {
    console.log('🔍 Validating routing network topology...');
    
    try {
      const { validateRoutingNetwork } = await import('../utils/validation/database-validation-helpers');
      const result = await validateRoutingNetwork(this.pgClient, this.stagingSchema);
      
      if (!result.success) {
        console.error(`❌ Network validation failed: ${result.message}`);
        if (result.details) {
          console.error('   Details:', result.details);
        }
        throw new Error('Routing network validation failed');
      }
      
      console.log('✅ Routing network validation passed');
    } catch (error) {
      console.error('❌ Routing network validation failed:', error);
      throw error;
    }
  }

  /**
   * Cleanup staging environment
   */
  private async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up staging environment...');
    
    const pgrouting = new PgRoutingHelpers({
      stagingSchema: this.stagingSchema,
      pgClient: this.pgClient
    });
    
    await pgrouting.cleanupViews();
    await this.pgClient.query(`DROP SCHEMA IF EXISTS ${this.stagingSchema} CASCADE`);
    
    console.log('✅ Cleanup completed');
  }

  /**
   * End database connection
   */
  private async endConnection(): Promise<void> {
    await this.pgClient.end();
    console.log('✅ Database connection closed');
  }

  // Legacy compatibility methods
  async export(outputFormat?: 'geojson' | 'sqlite' | 'trails-only'): Promise<void> {
    console.log('🚀 EXPORT METHOD CALLED - Starting export process');
    
    try {
      // Step 1: Populate staging schema and generate routes
      console.log('🚀 About to call generateKspRoutes()...');
      await this.generateKspRoutes();
      console.log('🚀 generateKspRoutes() completed');
      
      // Step 2: Determine output strategy by format option or filename autodetection
      const detectedFormat = this.determineOutputFormat(outputFormat);
      
      // Step 3: Export using appropriate strategy
      await this.exportUsingStrategy(detectedFormat);
      
      console.log('✅ Export completed successfully');
    } catch (error) {
      console.error('❌ Export failed:', error);
      
      // Always attempt cleanup and connection closure, even on error
      try {
        if (!this.config.noCleanup) {
          console.log('🧹 Attempting cleanup after error...');
          await this.cleanup();
        }
      } catch (cleanupError) {
        console.warn('⚠️ Cleanup failed after error:', cleanupError);
      }
      
      try {
        console.log('🔌 Closing database connection after error...');
        await this.endConnection();
      } catch (connectionError) {
        console.warn('⚠️ Database connection closure failed after error:', connectionError);
      }
      
      // Re-throw the original error to ensure the CLI exits with error code
      throw error;
    }
    
    // Cleanup staging schema and end connection on success
    if (!this.config.noCleanup) {
      await this.cleanup();
    }
    await this.endConnection();
  }

  private determineOutputFormat(explicitFormat?: 'geojson' | 'sqlite' | 'trails-only'): 'geojson' | 'sqlite' | 'trails-only' {
    // If format is explicitly specified, use it
    if (explicitFormat) {
      return explicitFormat;
    }
    
    // Auto-detect format from file extension
    if (this.config.outputPath.endsWith('.geojson') || this.config.outputPath.endsWith('.json')) {
      console.log(`🔍 Auto-detected GeoJSON format from file extension: ${this.config.outputPath}`);
      return 'geojson';
    } else if (this.config.outputPath.endsWith('.db')) {
      console.log(`🔍 Auto-detected SQLite format from file extension: ${this.config.outputPath}`);
      return 'sqlite';
    } else {
      console.log(`🔍 Using default SQLite format for: ${this.config.outputPath}`);
      return 'sqlite';
    }
  }

  private async exportUsingStrategy(format: 'geojson' | 'sqlite' | 'trails-only'): Promise<void> {
    switch (format) {
      case 'sqlite':
        if (this.exportAlreadyCompleted) {
          console.log('⏭️  SQLite export already completed during analysis phase, skipping duplicate export');
        } else {
          await this.exportToSqlite();
        }
        break;
      case 'geojson':
        await this.exportToGeoJSON();
        break;
      case 'trails-only':
        await this.exportTrailsOnly();
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  private async exportToSqlite(): Promise<void> {
    console.log('📤 Exporting to SQLite format...');
    
    const poolClient = await this.pgClient.connect();
    
    try {
      // Use unified SQLite export strategy
      const sqliteConfig: SQLiteExportConfig = {
        region: this.config.region,
        outputPath: this.config.outputPath,
        includeTrails: true,
        includeNodes: this.config.exportConfig?.includeNodes || false,
        includeEdges: this.config.exportConfig?.includeEdges || false,
        includeRecommendations: this.config.exportConfig?.includeRoutes !== false, // Default to true if routes were generated
        verbose: this.config.verbose
      };
      
      const sqliteExporter = new SQLiteExportStrategy(poolClient as any, sqliteConfig, this.stagingSchema);
      const result = await sqliteExporter.exportFromStaging();
      
      if (!result.isValid) {
        throw new Error(`SQLite export failed: ${result.errors.join(', ')}`);
      }
      
      // Summary will be shown by analysis and export service
    } finally {
      poolClient.release();
    }
  }

  private async exportToGeoJSON(): Promise<void> {
    if (this.exportAlreadyCompleted) {
      console.log('⏭️  GeoJSON export already completed during analysis phase, skipping duplicate export');
      return;
    }
    
    console.log('📤 Exporting to GeoJSON format...');
    
    const poolClient = await this.pgClient.connect();
    
    try {
      // Honor YAML layer config as the source of truth
      const projectExport = getExportConfig();
      const layers = projectExport.geojson?.layers || {};
      const includeTrails = !!layers.trails;
      const includeNodes = !!layers.edgeNetworkVertices;
      const includeEdges = !!layers.edges;
      const includeRoutes = !!layers.routes;

      // Use unified GeoJSON export strategy
      const geojsonConfig: GeoJSONExportConfig = {
        region: this.config.region,
        outputPath: this.config.outputPath,
        includeTrails,
        includeNodes,
        includeEdges,
        includeRecommendations: includeRoutes,
        verbose: this.config.verbose
      };
      
      const geojsonExporter = new GeoJSONExportStrategy(poolClient as any, geojsonConfig, this.stagingSchema);
      await geojsonExporter.exportFromStaging();
      
      // Completion message is handled by the export strategy
    } finally {
      poolClient.release();
    }
  }

  private async exportTrailsOnly(): Promise<void> {
    if (this.exportAlreadyCompleted) {
      console.log('⏭️  Trails-only export already completed during analysis phase, skipping duplicate export');
      return;
    }
    
    console.log('📤 Exporting trails only to GeoJSON format...');
    
    const poolClient = await this.pgClient.connect();
    
    try {
      // Use unified GeoJSON export strategy for trails-only export
      const geojsonConfig: GeoJSONExportConfig = {
        region: this.config.region,
        outputPath: this.config.outputPath,
        includeTrails: true,
        includeNodes: false,
        includeEdges: false,
        includeRecommendations: false,
        verbose: this.config.verbose
      };
      
      const geojsonExporter = new GeoJSONExportStrategy(poolClient as any, geojsonConfig, this.stagingSchema);
      await geojsonExporter.exportFromStaging();
      
      console.log(`✅ Trails-only export completed: ${this.config.outputPath}`);
    } finally {
      poolClient.release();
    }
  }

  /**
   * Fix trail gaps by extending trails to meet nearby endpoints
   */
  private async fixTrailGaps(): Promise<void> {
    console.log('🔗 Fixing trail gaps...');
    
    try {
      // Check if gap fixing is enabled in config
      const { loadConfig } = await import('../utils/config-loader');
      const config = loadConfig();
      const gapFixingConfig = config.constants?.gapFixing;
      
      if (!gapFixingConfig?.enabled) {
        console.log('⏭️ Trail gap fixing is disabled in configuration');
        return;
      }

      const { TrailGapFixingService } = await import('../utils/services/trail-gap-fixing-service');
      
      const gapFixingService = new TrailGapFixingService(
        this.pgClient,
        this.stagingSchema,
        {
          minGapDistance: gapFixingConfig.minGapDistanceMeters || 1,
          maxGapDistance: gapFixingConfig.maxGapDistanceMeters || 10,
          verbose: this.config.verbose
        }
      );

      const result = await gapFixingService.fixTrailGaps();
      
      if (!result.success) {
        console.error('❌ Trail gap fixing failed:', result.errors.join(', '));
      } else if (this.config.verbose) {
        console.log(`✅ Trail gap fixing completed: ${result.gapsFixed} gaps fixed out of ${result.gapsFound} found`);
      }

    } catch (error) {
      console.error('❌ Error in trail gap fixing:', error);
      // Don't throw - this is a non-critical enhancement
    }
  }

  /**
   * Merge degree 2 chains to consolidate network before route generation
   */
  private async mergeDegree2Chains(): Promise<void> {
    console.log('🔗 Merging degree 2 chains to consolidate network...');
    try {
      const { mergeDegree2Chains } = await import('../utils/services/network-creation/merge-degree2-chains');
      
      const result = await mergeDegree2Chains(this.pgClient, this.stagingSchema);
      
      console.log(`✅ Degree 2 chain merging completed: ${result.chainsMerged} chains merged, ${result.edgesRemoved} edges removed, ${result.bridgeEdgesMerged} bridge edges merged, ${result.finalEdges} final edges`);
      
    } catch (error) {
      console.error('❌ Error in degree 2 chain merging:', error);
      console.error('❌ Error details:', error instanceof Error ? error.stack : String(error));
      // Don't throw - this is a non-critical enhancement
    }
  }

  /**
   * Iterative deduplication and degree-2 chain merging
   */
  private async iterativeDeduplicationAndMerging(): Promise<void> {
    console.log('🔄 [Degree2 Chaining] Starting iterative deduplication and merging...');
    
    const maxIterations = 10; // Prevent infinite loops
    let iteration = 1;
    let totalDeduplicated = 0;
    let totalMerged = 0;
    let totalVertexDeduped = 0;
    
    while (iteration <= maxIterations) {
      console.log(`🔄 [Degree2 Chaining] Iteration ${iteration}/${maxIterations}...`);
      
      // Step 1: Deduplicate overlaps in trails table
      const dedupeResult = await this.deduplicateOverlaps();
      console.log(`   [Overlap] Deduplicated ${dedupeResult.overlapsRemoved} overlaps`);
      
      // Step 2: Deduplicate shared vertices in ways_noded table
      const vertexDedupResult = await deduplicateSharedVertices(this.pgClient, this.stagingSchema);
      console.log(`   [Vertex Dedup] Removed ${vertexDedupResult.edgesRemoved} duplicate edges with shared vertices`);
      
      // Step 3: Merge degree-2 chains
      const mergeResult = await this.mergeDegree2ChainsIteration();
      console.log(`   [Degree2] Merged ${mergeResult.chainsMerged} degree-2 chains`);
      
      totalDeduplicated += dedupeResult.overlapsRemoved;
      totalVertexDeduped += vertexDedupResult.edgesRemoved;
      totalMerged += mergeResult.chainsMerged;
      
      // Comprehensive verification step: check if any overlaps or degree-2 chains remain
      const verificationResult = await this.verifyNoOverlapsOrDegree2Chains();
      console.log(`   [Verification] ${verificationResult.remainingOverlaps} overlaps, ${verificationResult.remainingDegree2Chains} degree-2 chains remain`);
      
      // Check for convergence (no more changes AND no remaining issues)
      if (dedupeResult.overlapsRemoved === 0 && vertexDedupResult.edgesRemoved === 0 && mergeResult.chainsMerged === 0 && 
          verificationResult.remainingOverlaps === 0 && verificationResult.remainingDegree2Chains === 0) {
        console.log(`✅ [Degree2 Chaining] Convergence reached after ${iteration} iterations - no overlaps or degree-2 chains remain`);
        break;
      }
      
      // If we're not making progress, stop to avoid infinite loops
      if (dedupeResult.overlapsRemoved === 0 && vertexDedupResult.edgesRemoved === 0 && mergeResult.chainsMerged === 0) {
        console.log(`⚠️  [Degree2 Chaining] No progress made in iteration ${iteration}, but issues remain. Stopping to avoid infinite loop.`);
        console.log(`   [Degree2 Chaining] Remaining issues: ${verificationResult.remainingOverlaps} overlaps, ${verificationResult.remainingDegree2Chains} degree-2 chains`);
        break;
      }
      
      iteration++;
    }
    
    if (iteration > maxIterations) {
      console.log(`⚠️  [Degree2 Chaining] Reached maximum iterations (${maxIterations}), stopping`);
    }
    
    console.log(`📊 [Degree2 Chaining] Total results: ${totalDeduplicated} overlaps removed, ${totalVertexDeduped} vertex duplicates removed, ${totalMerged} chains merged`);
  }

  /**
   * [Overlap] Deduplicate overlaps in the current trails table
   */
  private async deduplicateOverlaps(): Promise<{ overlapsRemoved: number }> {
    console.log('   🔍 [Overlap] STAGE 1: Detecting overlaps...');
    
    // Debug: Check for overlapping segments before processing
    const debugOverlapsSql = `
      SELECT 
        t1.id as id1, 
        t2.id as id2,
        t1.name as name1,
        t2.name as name2,
        ST_Length(t1.geometry::geography) as length1,
        ST_Length(t2.geometry::geography) as length2,
        ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) as overlap_length,
        -- Use PostGIS native overlap functions
        ST_Overlaps(t1.geometry, t2.geometry) as has_overlap,
        ST_Contains(t1.geometry, t2.geometry) as t1_contains_t2,
        ST_Contains(t2.geometry, t1.geometry) as t2_contains_t1,
        ST_Covers(t1.geometry, t2.geometry) as t1_covers_t2,
        ST_Covers(t2.geometry, t1.geometry) as t2_covers_t1
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE (
        -- Use PostGIS native overlap detection
        ST_Overlaps(t1.geometry, t2.geometry) OR
        ST_Contains(t1.geometry, t2.geometry) OR
        ST_Contains(t2.geometry, t1.geometry) OR
        ST_Covers(t1.geometry, t2.geometry) OR
        ST_Covers(t2.geometry, t1.geometry)
      )
      AND NOT ST_Equals(t1.geometry, t2.geometry)  -- Not identical
      ORDER BY overlap_length DESC
      LIMIT 10;
    `;
    
    const debugResult = await this.pgClient.query(debugOverlapsSql);
    
    console.log(`   📊 [Overlap] STAGE 1 RESULTS: Found ${debugResult.rows.length} overlapping segment pairs`);
    if (debugResult.rows.length > 0) {
      console.log('   📋 [Overlap] Overlap details:');
      debugResult.rows.forEach((row, index) => {
        const overlapType = row.t1_contains_t2 ? 'CONTAINS' : 
                           row.t2_contains_t1 ? 'CONTAINED' : 
                           row.has_overlap ? 'OVERLAPS' : 'OTHER';
        console.log(`      ${index + 1}. ${row.name1} (${row.id1}, ${row.length1.toFixed(2)}m) ${overlapType} ${row.name2} (${row.id2}, ${row.length2.toFixed(2)}m) - overlap: ${row.overlap_length.toFixed(2)}m`);
      });
    }
    
    if (debugResult.rows.length === 0) {
      console.log('   ✅ [Overlap] No overlaps detected, skipping deduplication');
      return { overlapsRemoved: 0 };
    }
    
    console.log('   🧹 [Overlap] STAGE 2: Deduplicating overlaps...');
    
    // Deduplicate overlapping segments by removing overlaps from the shorter edge
        const deduplicateOverlapsSql = `
      WITH overlapping_segments AS (
        -- Find segments that have significant overlap using PostGIS native functions
        SELECT
          t1.id as id1, t1.geometry as geom1,
          t2.id as id2, t2.geometry as geom2,
          ST_Intersection(t1.geometry, t2.geometry) as overlap_geom,
          ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) as overlap_length
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
        WHERE (
          -- Use PostGIS native overlap detection
          ST_Overlaps(t1.geometry, t2.geometry) OR
          ST_Contains(t1.geometry, t2.geometry) OR
          ST_Contains(t2.geometry, t1.geometry)
        )
        AND NOT ST_Equals(t1.geometry, t2.geometry)  -- Not identical
      ),
      deduplicated_geometries AS (
        -- Remove overlap from the shorter edge (keep the longer one intact)
        SELECT 
          id1,
          CASE 
            WHEN ST_Length(geom1::geography) <= ST_Length(geom2::geography) THEN
              -- Remove overlap from the shorter edge
              ST_Difference(geom1, overlap_geom)
            ELSE geom1
            END as deduplicated_geom,
          overlap_length
        FROM overlapping_segments
        WHERE ST_IsValid(
          CASE 
            WHEN ST_Length(geom1::geography) <= ST_Length(geom2::geography) THEN
              ST_Difference(geom1, overlap_geom)
            ELSE geom1
          END
        )
      )
      UPDATE ${this.stagingSchema}.trails t
      SET 
        geometry = dg.deduplicated_geom,
        length_km = ST_Length(dg.deduplicated_geom::geography) / 1000.0,
        bbox_min_lng = ST_XMin(dg.deduplicated_geom),
        bbox_max_lng = ST_XMax(dg.deduplicated_geom),
        bbox_min_lat = ST_YMin(dg.deduplicated_geom),
        bbox_max_lat = ST_YMax(dg.deduplicated_geom)
      FROM deduplicated_geometries dg
      WHERE t.id = dg.id1;
    `;
    
    const dedupeResult = await this.pgClient.query(deduplicateOverlapsSql);
    const overlapsRemoved = dedupeResult.rowCount || 0;
    console.log(`   ✅ [Overlap] STAGE 2 RESULTS: Deduplicated ${overlapsRemoved} overlapping segments`);
    return { overlapsRemoved };
  }

  /**
   * Single iteration of degree-2 chain merging
   */
  private async mergeDegree2ChainsIteration(): Promise<{ chainsMerged: number }> {
    console.log('   🔗 STAGE 3: Detecting degree-2 connections...');
    
    // First, let's debug what degree-2 connections we're finding
    const debugDegree2Sql = `
      SELECT 
        t1.id as trail1_id, t1.name as trail1_name,
        t2.id as trail2_id, t2.name as trail2_name,
        ST_Length(t1.geometry::geography) as length1,
        ST_Length(t2.geometry::geography) as length2,
        CASE
          WHEN ST_DWithin(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.001) THEN 'end_to_start'
          WHEN ST_DWithin(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.001) THEN 'end_to_end'
          WHEN ST_DWithin(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.001) THEN 'start_to_start'
          WHEN ST_DWithin(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.001) THEN 'start_to_end'
        END as connection_type
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE (
        ST_DWithin(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.001) OR
        ST_DWithin(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.001) OR
        ST_DWithin(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.001) OR
        ST_DWithin(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.001)
      )
      ORDER BY t1.name, t2.name
      LIMIT 10;
    `;
    
    const debugResult = await this.pgClient.query(debugDegree2Sql);
    console.log(`   📊 [Degree2] Found ${debugResult.rows.length} potential degree-2 connections`);
    if (debugResult.rows.length > 0) {
      console.log('   📋 [Degree2] Connection details:');
      debugResult.rows.forEach((row, index) => {
        console.log(`      ${index + 1}. ${row.trail1_name} (${row.trail1_id}, ${row.length1.toFixed(2)}m) ${row.connection_type} ${row.trail2_name} (${row.trail2_id}, ${row.length2.toFixed(2)}m)`);
      });
    }
    
    // Find and merge degree-2 chains
    const mergeDegree2ChainsSql = `
      WITH degree2_connections AS (
        -- Find trails that connect end-to-end (potential degree-2 chains)
        SELECT 
          t1.id as trail1_id, t1.geometry as trail1_geom,
          t2.id as trail2_id, t2.geometry as trail2_geom,
          CASE
            -- End of t1 connects to start of t2
            WHEN ST_DWithin(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.001) THEN 'end_to_start'
            -- End of t1 connects to end of t2  
            WHEN ST_DWithin(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.001) THEN 'end_to_end'
            -- Start of t1 connects to start of t2
            WHEN ST_DWithin(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.001) THEN 'start_to_start'
            -- Start of t1 connects to end of t2
            WHEN ST_DWithin(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.001) THEN 'start_to_end'
          END as connection_type
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
        WHERE (
          ST_DWithin(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.001) OR
          ST_DWithin(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.001) OR
          ST_DWithin(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.001) OR
          ST_DWithin(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.001)
        )
      ),
      chain_geometries AS (
        -- Merge the geometries of degree-2 chains
        SELECT 
          trail1_id,
          CASE
            WHEN connection_type = 'end_to_start' THEN 
              CASE 
                WHEN ST_GeometryType(ST_LineMerge(ST_Union(trail1_geom, trail2_geom))) = 'ST_LineString' THEN ST_LineMerge(ST_Union(trail1_geom, trail2_geom))
                ELSE ST_GeometryN(ST_LineMerge(ST_Union(trail1_geom, trail2_geom)), 1)
              END
            WHEN connection_type = 'end_to_end' THEN 
              CASE 
                WHEN ST_GeometryType(ST_LineMerge(ST_Union(trail1_geom, ST_Reverse(trail2_geom)))) = 'ST_LineString' THEN ST_LineMerge(ST_Union(trail1_geom, ST_Reverse(trail2_geom)))
                ELSE ST_GeometryN(ST_LineMerge(ST_Union(trail1_geom, ST_Reverse(trail2_geom))), 1)
              END
            WHEN connection_type = 'start_to_start' THEN 
              CASE 
                WHEN ST_GeometryType(ST_LineMerge(ST_Union(ST_Reverse(trail1_geom), trail2_geom))) = 'ST_LineString' THEN ST_LineMerge(ST_Union(ST_Reverse(trail1_geom), trail2_geom))
                ELSE ST_GeometryN(ST_LineMerge(ST_Union(ST_Reverse(trail1_geom), trail2_geom)), 1)
              END
            WHEN connection_type = 'start_to_end' THEN 
              CASE 
                WHEN ST_GeometryType(ST_LineMerge(ST_Union(ST_Reverse(trail1_geom), ST_Reverse(trail2_geom)))) = 'ST_LineString' THEN ST_LineMerge(ST_Union(ST_Reverse(trail1_geom), ST_Reverse(trail2_geom)))
                ELSE ST_GeometryN(ST_LineMerge(ST_Union(ST_Reverse(trail1_geom), ST_Reverse(trail2_geom))), 1)
              END
          END as chain_geom
        FROM degree2_connections
        WHERE ST_IsValid(
          CASE
            WHEN connection_type = 'end_to_start' THEN 
              CASE 
                WHEN ST_GeometryType(ST_LineMerge(ST_Union(trail1_geom, trail2_geom))) = 'ST_LineString' THEN ST_LineMerge(ST_Union(trail1_geom, trail2_geom))
                ELSE ST_GeometryN(ST_LineMerge(ST_Union(trail1_geom, trail2_geom)), 1)
              END
            WHEN connection_type = 'end_to_end' THEN 
              CASE 
                WHEN ST_GeometryType(ST_LineMerge(ST_Union(trail1_geom, ST_Reverse(trail2_geom)))) = 'ST_LineString' THEN ST_LineMerge(ST_Union(trail1_geom, ST_Reverse(trail2_geom)))
                ELSE ST_GeometryN(ST_LineMerge(ST_Union(trail1_geom, ST_Reverse(trail2_geom))), 1)
              END
            WHEN connection_type = 'start_to_start' THEN 
              CASE 
                WHEN ST_GeometryType(ST_LineMerge(ST_Union(ST_Reverse(trail1_geom), trail2_geom))) = 'ST_LineString' THEN ST_LineMerge(ST_Union(ST_Reverse(trail1_geom), trail2_geom))
                ELSE ST_GeometryN(ST_LineMerge(ST_Union(ST_Reverse(trail1_geom), trail2_geom)), 1)
              END
            WHEN connection_type = 'start_to_end' THEN 
              CASE 
                WHEN ST_GeometryType(ST_LineMerge(ST_Union(ST_Reverse(trail1_geom), ST_Reverse(trail2_geom)))) = 'ST_LineString' THEN ST_LineMerge(ST_Union(ST_Reverse(trail1_geom), ST_Reverse(trail2_geom)))
                ELSE ST_GeometryN(ST_LineMerge(ST_Union(ST_Reverse(trail1_geom), ST_Reverse(trail2_geom))), 1)
              END
          END
        )
      ),
      merged_trails AS (
        -- Update the first trail with the merged geometry
        UPDATE ${this.stagingSchema}.trails t
        SET 
          geometry = cg.chain_geom,
          length_km = ST_Length(cg.chain_geom::geography) / 1000.0,
          bbox_min_lng = ST_XMin(cg.chain_geom),
          bbox_max_lng = ST_XMax(cg.chain_geom),
          bbox_min_lat = ST_YMin(cg.chain_geom),
          bbox_max_lat = ST_YMax(cg.chain_geom)
        FROM chain_geometries cg
        WHERE t.id = cg.trail1_id
        RETURNING t.id
      ),
      deleted_trails AS (
        -- Delete the second trail (now merged into the first)
        DELETE FROM ${this.stagingSchema}.trails t
        WHERE t.id IN (
          SELECT dc.trail2_id 
          FROM degree2_connections dc
          JOIN merged_trails mt ON dc.trail1_id = mt.id
        )
        RETURNING t.id
      )
      SELECT 
        (SELECT COUNT(*) FROM merged_trails) as chains_merged,
        (SELECT COUNT(*) FROM deleted_trails) as trails_deleted;
    `;
    
    const mergeResult = await this.pgClient.query(mergeDegree2ChainsSql);
    const chainsMerged = Number(mergeResult.rows[0]?.chains_merged || 0);
    const trailsDeleted = Number(mergeResult.rows[0]?.trails_deleted || 0);
    
    console.log(`   ✅ STAGE 3 RESULTS: Merged ${chainsMerged} degree-2 chains, deleted ${trailsDeleted} redundant trails`);
    return { chainsMerged };
  }

  /**
   * Clean up orphan nodes in the pgRouting network
   */
  private async cleanupOrphanNodes(): Promise<void> {
    console.log('🧹 Checking for orphan nodes...');
    
    // First, let's see what orphan nodes we have
    const orphanCheckSql = `
      SELECT 
        v.id,
        v.cnt as degree,
        v.the_geom,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat
      FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
      WHERE NOT EXISTS (
        SELECT 1 FROM ${this.stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
      ORDER BY v.id;
    `;
    
    const orphanResult = await this.pgClient.query(orphanCheckSql);
    const orphanCount = orphanResult.rowCount || 0;
    
    console.log(`📊 Found ${orphanCount} orphan nodes`);
    if (orphanCount > 0) {
      console.log('📋 Orphan node details:');
      orphanResult.rows.forEach((row, index) => {
        console.log(`   ${index + 1}. Node ${row.id} (degree ${row.degree}) at (${row.lng.toFixed(6)}, ${row.lat.toFixed(6)})`);
      });
      
      // Remove orphan nodes
      const deleteOrphansSql = `
        DELETE FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        WHERE NOT EXISTS (
          SELECT 1 FROM ${this.stagingSchema}.ways_noded e
          WHERE e.source = v.id OR e.target = v.id
        );
      `;
      
      const deleteResult = await this.pgClient.query(deleteOrphansSql);
      console.log(`✅ Removed ${deleteResult.rowCount || 0} orphan nodes`);
    } else {
      console.log('✅ No orphan nodes found');
    }
  }

  /**
   * Verify that no overlaps or degree-2 chains remain
   */
  private async verifyNoOverlapsOrDegree2Chains(): Promise<{ remainingOverlaps: number; remainingDegree2Chains: number }> {
    // Check for remaining overlaps
    const overlapsResult = await this.pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND NOT ST_Touches(t1.geometry, t2.geometry)
    `);
    const remainingOverlaps = parseInt(overlapsResult.rows[0].count);

    // Check for remaining degree-2 chains
    const degree2Result = await this.pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
      WHERE v.cnt = 2
    `);
    const remainingDegree2Chains = parseInt(degree2Result.rows[0].count);

    return { remainingOverlaps, remainingDegree2Chains };
  }

  /**
   * Iterative network optimization: Bridge → Deduplication → Degree-2 merge → Cleanup → Repeat
   */
  private async iterativeNetworkOptimization(): Promise<void> {
    console.log('🔄 Starting iterative network optimization...');

    const maxIterations = 10; // Prevent infinite loops
    let iteration = 1;
    let totalBridgesCreated = 0;
    let totalDegree2Merged = 0;
    let totalOrphanNodesRemoved = 0;
    let totalEdgesDeduplicated = 0;

    // Track connectivity for each iteration
    const connectivityHistory: Array<{
      iteration: number;
      connectivityPercentage: number;
      reachableNodes: number;
      totalNodes: number;
      edgeCount: number;
      vertexCount: number;
      bridgesCreated: number;
      edgesDeduplicated: number;
      chainsMerged: number;
      orphanNodesRemoved: number;
    }> = [];

    // Get initial connectivity
    const initialConnectivity = await this.measureNetworkConnectivity('ITERATION_0');
    connectivityHistory.push({
      iteration: 0,
      connectivityPercentage: initialConnectivity.connectivityPercentage,
      reachableNodes: initialConnectivity.reachableNodes,
      totalNodes: initialConnectivity.totalNodes,
      edgeCount: initialConnectivity.edgeCount,
      vertexCount: initialConnectivity.vertexCount,
      bridgesCreated: 0,
      edgesDeduplicated: 0,
      chainsMerged: 0,
      orphanNodesRemoved: 0
    });

    // Check if network is large enough to skip detailed connectivity tracking
    const isLargeNetwork = initialStats.edgeCount > 1000 || initialStats.vertexCount > 500;
    
    if (isLargeNetwork) {
      console.log('\n⚠️  Large network detected - skipping detailed connectivity tracking for performance');
      console.log(`   Edges: ${initialStats.edgeCount}, Vertices: ${initialStats.vertexCount}`);
      console.log('   Use --verbose flag to enable detailed tracking (may take 2+ minutes)');
    } else {
      // Print connectivity table header
      console.log('\n📊 ITERATIVE OPTIMIZATION CONNECTIVITY TRACKING:');
      console.log('================================================');
      console.log('Iter | Conn% | Reach/Tot | Edges | Vertices | Total Length | Routes | Features | Bridges | Dedup | Merges | Orphans');
      console.log('-----|-------|-----------|-------|----------|-------------|--------|----------|---------|-------|--------|--------');
      
      // Get initial network stats and object counts (cache total distance)
      const initialCounts = await this.getObjectCounts();
      const totalDistance = await this.getTotalTrailDistance(); // Calculate once
      console.log(`  ${0}  | ${initialConnectivity.connectivityPercentage.toFixed(1).padStart(4)}% | ${initialConnectivity.reachableNodes.toString().padStart(3)}/${initialConnectivity.totalNodes.toString().padStart(2)} | ${initialStats.edgeCount.toString().padStart(5)} | ${initialStats.vertexCount.toString().padStart(8)} | ${totalDistance.toFixed(2).padStart(11)}km | ${initialCounts.routes.toString().padStart(6)} | ${initialCounts.features.toString().padStart(8)} | ${'0'.padStart(7)} | ${'0'.padStart(5)} | ${'0'.padStart(6)} | ${'0'.padStart(7)}`);
    }



    while (iteration <= maxIterations) {
      console.log(`\n🔄 Iteration ${iteration}/${maxIterations}...`);

      // Step 1: Detect and fix gaps (bridges)
      console.log('🔄 Step 1: Detecting and fixing gaps...');
      const { runGapMidpointBridging } = await import('../utils/services/network-creation/gap-midpoint-bridging');
      const { getBridgingConfig } = await import('../utils/config-loader');
      const bridgingConfig = getBridgingConfig();
      const bridgingResult = await runGapMidpointBridging(this.pgClient, this.stagingSchema, bridgingConfig.trailBridgingToleranceMeters);
      console.log(`✅ Step 1: Gap bridging completed - ${bridgingResult.bridgesInserted} bridges created`);
      totalBridgesCreated += bridgingResult.bridgesInserted; // Track actual bridges created
      console.log('✅ Step 1: Gap detection and fixing completed');

      // Step 2: Edge deduplication (remove edges that share more than a single point geometry)
      console.log('🔄 Step 2: Edge deduplication...');
      const { deduplicateSharedVertices } = await import('../utils/services/network-creation/merge-degree2-chains');
      const dedupResult = await deduplicateSharedVertices(this.pgClient, this.stagingSchema);
      console.log(`✅ Step 2: Edge deduplication completed - ${dedupResult.edgesRemoved} duplicate edges removed`);
      totalEdgesDeduplicated += dedupResult.edgesRemoved;

      // Step 3: Merge degree-2 chains
      console.log('🔄 Step 3: Merging degree-2 chains...');
      await this.mergeDegree2Chains();
      totalDegree2Merged += 1; // Increment for each iteration
      console.log('✅ Step 3: Degree-2 chain merging completed');

      // Step 4: Clean up orphan nodes
      console.log('🔄 Step 4: Cleaning up orphan nodes...');
      await this.cleanupOrphanNodes();
      totalOrphanNodesRemoved += 1; // Increment for each iteration
      console.log('✅ Step 4: Orphan node cleanup completed');

      // Step 5: Verify results (check only ways_noded table since that's what we're optimizing)
      console.log('🔄 Step 5: Verifying results...');
      const verificationResult = await this.verifyNoOverlapsOrDegree2Chains();
      console.log(`   [Verification] ${verificationResult.remainingOverlaps} overlaps, ${verificationResult.remainingDegree2Chains} degree-2 chains remain`);

      // Measure connectivity after this iteration
      const iterationConnectivity = await this.measureNetworkConnectivity(`ITERATION_${iteration}`);
      
      // Check if connectivity decreased from previous iteration
      const previousConnectivity = connectivityHistory[connectivityHistory.length - 1];
      const connectivityDecrease = previousConnectivity.connectivityPercentage - iterationConnectivity.connectivityPercentage;
      
      if (connectivityDecrease > 0) {
        console.error(`❌ [ITERATION_${iteration}] CRITICAL: Network connectivity DECREASED by ${connectivityDecrease.toFixed(1)} percentage points!`);
        console.error(`   Previous: ${previousConnectivity.connectivityPercentage.toFixed(1)}% -> Current: ${iterationConnectivity.connectivityPercentage.toFixed(1)}%`);
        console.error(`   This indicates the optimization process is breaking network topology`);
      }
      
      connectivityHistory.push({
        iteration,
        connectivityPercentage: iterationConnectivity.connectivityPercentage,
        reachableNodes: iterationConnectivity.reachableNodes,
        totalNodes: iterationConnectivity.totalNodes,
        edgeCount: iterationConnectivity.edgeCount,
        vertexCount: iterationConnectivity.vertexCount,
        bridgesCreated: bridgingResult.bridgesInserted,
        edgesDeduplicated: dedupResult.edgesRemoved,
        chainsMerged: 0, // Simplified for now
        orphanNodesRemoved: 0 // Simplified for now
      });

      // Get network stats and object counts for this iteration
      const iterationStats = await this.getNetworkStats();
      const iterationCounts = await this.getObjectCounts();
      
      // Print connectivity for this iteration (use cached total distance)
      console.log(`  ${iteration.toString().padStart(2)}  | ${iterationConnectivity.connectivityPercentage.toFixed(1).padStart(4)}% | ${iterationConnectivity.reachableNodes.toString().padStart(3)}/${iterationConnectivity.totalNodes.toString().padStart(2)} | ${iterationStats.edgeCount.toString().padStart(5)} | ${iterationStats.vertexCount.toString().padStart(8)} | ${totalDistance.toFixed(2).padStart(11)}km | ${iterationCounts.routes.toString().padStart(6)} | ${iterationCounts.features.toString().padStart(8)} | ${bridgingResult.bridgesInserted.toString().padStart(7)} | ${dedupResult.edgesRemoved.toString().padStart(5)} | ${'0'.padStart(6)} | ${'0'.padStart(7)}`);

      // Check for convergence (no more changes AND no remaining issues)
      if (bridgingResult.bridgesInserted === 0 && dedupResult.edgesRemoved === 0 && 
          verificationResult.remainingOverlaps === 0 && verificationResult.remainingDegree2Chains === 0) {
        console.log(`✅ Iterative optimization converged after ${iteration} iterations - no more changes needed`);
        break;
      }

      // If we're not making progress, stop to avoid infinite loops
      if (bridgingResult.bridgesInserted === 0 && dedupResult.edgesRemoved === 0) {
        console.log(`⚠️  Iterative optimization reached maximum iterations (${maxIterations}), but issues remain. Stopping.`);
        console.log(`   Remaining issues: ${verificationResult.remainingOverlaps} overlaps, ${verificationResult.remainingDegree2Chains} degree-2 chains`);
        break;
      }

      iteration++;
    }

    if (iteration > maxIterations) {
      console.log(`⚠️  Reached maximum iterations (${maxIterations}) without convergence.`);
    }

    // Print final connectivity summary
    console.log('\n📊 ITERATIVE OPTIMIZATION SUMMARY:');
    console.log('==================================');
    console.log(`   Bridges created: ${totalBridgesCreated}`);
    console.log(`   Edges deduplicated: ${totalEdgesDeduplicated}`);
    console.log(`   Degree-2 chains merged: ${totalDegree2Merged}`);
    console.log(`   Orphan nodes removed: ${totalOrphanNodesRemoved}`);
    
    // Calculate connectivity improvement
    const initialConn = connectivityHistory[0].connectivityPercentage;
    const finalConn = connectivityHistory[connectivityHistory.length - 1].connectivityPercentage;
    const connectivityChange = finalConn - initialConn;
    
    console.log(`\n🔗 CONNECTIVITY IMPACT:`);
    console.log(`   Initial connectivity: ${initialConn.toFixed(1)}%`);
    console.log(`   Final connectivity:   ${finalConn.toFixed(1)}%`);
    if (connectivityChange > 0) {
      console.log(`   ✅ Connectivity IMPROVED by ${connectivityChange.toFixed(1)} percentage points`);
    } else if (connectivityChange < 0) {
      console.log(`   ❌ Connectivity DECREASED by ${Math.abs(connectivityChange).toFixed(1)} percentage points`);
    } else {
      console.log(`   ➡️  Connectivity remained UNCHANGED`);
    }
  }

  /**
   * Gets network statistics (optimized - only counts, no expensive SUM)
   */
  private async getNetworkStats(): Promise<{
    edgeCount: number;
    vertexCount: number;
  }> {
    try {
      const statsResult = await this.pgClient.query(`
        SELECT COUNT(*) as edge_count FROM ${this.stagingSchema}.ways_noded
      `);
      
      const vertexResult = await this.pgClient.query(`
        SELECT COUNT(*) as vertex_count FROM ${this.stagingSchema}.ways_noded_vertices_pgr
      `);
      
      return {
        edgeCount: parseInt(statsResult.rows[0].edge_count),
        vertexCount: parseInt(vertexResult.rows[0].vertex_count)
      };
    } catch (error) {
      console.warn('⚠️ Failed to get network stats:', error);
      return { edgeCount: 0, vertexCount: 0 };
    }
  }

  /**
   * Gets total trail distance (expensive - only call once)
   */
  private async getTotalTrailDistance(): Promise<number> {
    try {
      const result = await this.pgClient.query(`
        SELECT COALESCE(SUM(length_km), 0) as total_length_km
        FROM ${this.stagingSchema}.ways_noded
      `);
      return parseFloat(result.rows[0].total_length_km);
    } catch (error) {
      console.warn('⚠️ Failed to get total trail distance:', error);
      return 0;
    }
  }

  /**
   * Measures network connectivity by checking reachability from a starting vertex
   */
  private async measureNetworkConnectivity(phase: string): Promise<{
    totalNodes: number;
    reachableNodes: number;
    edgeCount: number;
    vertexCount: number;
    connectivityPercentage: number;
  }> {
    try {
      console.log(`🔍 Measuring network connectivity in phase: ${phase}`);

      // Check if the staging schema and tables exist
      const schemaExistsResult = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.schemata 
          WHERE schema_name = $1
        ) as schema_exists
      `, [this.stagingSchema]);
      
      if (!schemaExistsResult.rows[0].schema_exists) {
        console.log(`   ⚠️  Schema ${this.stagingSchema} does not exist yet - skipping connectivity measurement`);
        return {
          totalNodes: 0,
          reachableNodes: 0,
          edgeCount: 0,
          vertexCount: 0,
          connectivityPercentage: 0
        };
      }

      // Check if the ways_noded_vertices_pgr table exists
      const tableExistsResult = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = $1 AND table_name = 'ways_noded_vertices_pgr'
        ) as table_exists
      `, [this.stagingSchema]);
      
      if (!tableExistsResult.rows[0].table_exists) {
        console.log(`   ⚠️  ways_noded_vertices_pgr table does not exist yet - skipping connectivity measurement`);
        return {
          totalNodes: 0,
          reachableNodes: 0,
          edgeCount: 0,
          vertexCount: 0,
          connectivityPercentage: 0
        };
      }

      const totalNodesResult = await this.pgClient.query(`
        SELECT COUNT(*) as total_nodes FROM ${this.stagingSchema}.ways_noded_vertices_pgr
      `);
      const totalNodes = parseInt(totalNodesResult.rows[0].total_nodes);
      console.log(`   Total vertices: ${totalNodes}`);

      if (totalNodes === 0) {
        console.log(`   ⚠️  No vertices found - skipping connectivity measurement`);
        return {
          totalNodes: 0,
          reachableNodes: 0,
          edgeCount: 0,
          vertexCount: 0,
          connectivityPercentage: 0
        };
      }

      // Use pgRouting's pgr_dijkstra to find reachable nodes from the first vertex
      const reachableNodesResult = await this.pgClient.query(`
        WITH reachable_nodes AS (
          SELECT DISTINCT node
          FROM pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded',
            (SELECT id FROM ${this.stagingSchema}.ways_noded_vertices_pgr LIMIT 1),
            (SELECT array_agg(id) FROM ${this.stagingSchema}.ways_noded_vertices_pgr),
            false
          )
          WHERE node IS NOT NULL
        )
        SELECT COUNT(*) as reachable_count FROM reachable_nodes
      `);
      const reachableNodes = parseInt(reachableNodesResult.rows[0].reachable_count);
      console.log(`   Reachable vertices: ${reachableNodes}`);

      const totalEdgesResult = await this.pgClient.query(`
        SELECT COUNT(*) as total_edges FROM ${this.stagingSchema}.ways_noded
      `);
      const totalEdges = parseInt(totalEdgesResult.rows[0].total_edges);
      console.log(`   Total edges: ${totalEdges}`);

      const vertexCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as vertex_count FROM ${this.stagingSchema}.ways_noded_vertices_pgr
      `);
      const vertexCount = parseInt(vertexCountResult.rows[0].vertex_count);
      console.log(`   Total vertices (ways_noded_vertices_pgr): ${vertexCount}`);

      const connectivityPercentage = totalNodes > 0 ? (reachableNodes / totalNodes) * 100 : 0;
      console.log(`   Connectivity percentage: ${connectivityPercentage.toFixed(1)}%`);

      return {
        totalNodes,
        reachableNodes,
        edgeCount: totalEdges,
        vertexCount,
        connectivityPercentage,
      };
    } catch (error) {
      console.warn(`⚠️  Error measuring network connectivity in phase ${phase}:`, error);
      return {
        totalNodes: 0,
        reachableNodes: 0,
        edgeCount: 0,
        vertexCount: 0,
        connectivityPercentage: 0
      };
    }
  }

  /**
   * Get object counts for the current staging schema
   */
  private async getObjectCounts(): Promise<{ routes: number; features: number }> {
    try {
      // Count routes
      const routesResult = await this.pgClient.query(`
        SELECT COUNT(*) as route_count FROM ${this.stagingSchema}.routes
      `);
      const routes = parseInt(routesResult.rows[0].route_count) || 0;

      // Count total features (routes + edges + vertices)
      const edgesResult = await this.pgClient.query(`
        SELECT COUNT(*) as edge_count FROM ${this.stagingSchema}.ways_noded
      `);
      const edges = parseInt(edgesResult.rows[0].edge_count) || 0;

      const verticesResult = await this.pgClient.query(`
        SELECT COUNT(*) as vertex_count FROM ${this.stagingSchema}.ways_noded_vertices_pgr
      `);
      const vertices = parseInt(verticesResult.rows[0].vertex_count) || 0;

      const features = routes + edges + vertices;

      return { routes, features };
    } catch (error) {
      console.warn('⚠️  Error getting object counts:', error);
      return { routes: 0, features: 0 };
    }
  }

} 