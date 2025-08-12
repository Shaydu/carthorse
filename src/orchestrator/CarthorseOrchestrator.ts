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
   * Main entry point - generate KSP routes and export
   */
  async generateKspRoutes(): Promise<void> {
    console.log('🧭 GENERATEKSPROUTES METHOD CALLED - Starting KSP route generation...');
    console.log('🔍 DEBUG: generateKspRoutes method called');
    
    try {
      console.log('✅ Using connection pool');

      // Step 1: Validate database environment (schema version and functions only)
      await this.validateDatabaseEnvironment();

      // Step 2: Create staging environment (always create new schema with timestamp)
      await this.createStagingEnvironment();

      // Step 3: Copy trail data with bbox filter
      await this.copyTrailData();

      // Step 4: Split trails at intersections (if enabled)
      console.log('🔄 Step 4: About to split trails at intersections...');
      if (this.config.useSplitTrails !== false) {
        await this.splitTrailsAtIntersections();
        console.log('✅ Step 4: Trail splitting completed');
      } else {
        console.log('⏭️ Step 4: Trail splitting skipped');
      }

      // Step 5: Fix trail gaps (extend trails to meet nearby endpoints) - BEFORE creating network
      console.log('🔄 Step 5: About to fix trail gaps...');
      await this.fixTrailGaps();
      console.log('✅ Step 5: Trail gap fixing completed');

      // Step 6: Create pgRouting network (now with connected trails)
      console.log('🔄 Step 6: About to create pgRouting network...');
      try {
        await this.createPgRoutingNetwork();
        console.log('✅ Step 6: pgRouting network creation completed');
      } catch (error) {
        console.error('❌ Step 6: pgRouting network creation failed:', error);
        throw error;
      }

      // Step 7: Add length and elevation columns
      await this.addLengthAndElevationColumns();

      // Step 7: Validate routing network (after network is created)
      console.log('🔍 DEBUG: About to validate routing network...');
      await this.validateRoutingNetwork();
      console.log('🔍 DEBUG: Routing network validation completed');

      // Step 7.5: Merge degree 2 chains to consolidate network before route generation
      // This should run regardless of whether we're using existing or new staging schema
      console.log('🔍 DEBUG: About to call mergeDegree2Chains...');
      await this.mergeDegree2Chains();
      console.log('🔍 DEBUG: mergeDegree2Chains completed');

      // Step 8: Generate all routes using route generation orchestrator service
      console.log('🔍 DEBUG: About to call generateAllRoutesWithService...');
      await this.generateAllRoutesWithService();
      console.log('🔍 DEBUG: generateAllRoutesWithService completed');

      // Step 9: Generate analysis only (export will be handled separately)
      await this.generateRouteAnalysis();

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
    const { getStagingSchemaSql } = await import('../utils/sql/staging-schema');
    
    // Drop existing schema if it exists
    await this.pgClient.query(`DROP SCHEMA IF EXISTS ${this.stagingSchema} CASCADE`);
    await this.pgClient.query(`CREATE SCHEMA ${this.stagingSchema}`);
    
    // Create staging tables using the proper schema creation function
    const stagingSchemaSql = getStagingSchemaSql(this.stagingSchema);
    await this.pgClient.query(stagingSchemaSql);
    
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
      // Call the build_routing_edges function to create merged trail chains
      const result = await this.pgClient.query(`
        SELECT build_routing_edges($1, 'trails', 20.0)
      `, [this.stagingSchema]);
      
      return result.rows[0].build_routing_edges || 0;
    } catch (error) {
      console.error('❌ Failed to create merged trail chains:', error);
      return 0;
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
   * Split trails at intersections using TrailSplitter
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
    
    console.log(`✅ Trail splitting completed:`);
    console.log(`   📊 Segments created: ${result.finalSegmentCount}`);
    console.log(`   🔗 Remaining intersections: ${result.intersectionCount}`);
    
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
    console.log(`   - Intersection tolerance: ${routeDiscoveryConfig.routing.intersectionTolerance}m`);
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
    
    // Step 1: Populate staging schema and generate routes
    console.log('🚀 About to call generateKspRoutes()...');
    try {
      await this.generateKspRoutes();
      console.log('🚀 generateKspRoutes() completed');
    } catch (error) {
      console.error('❌ generateKspRoutes() failed:', error);
      throw error;
    }
    
    // Step 2: Determine output strategy by format option or filename autodetection
    const detectedFormat = this.determineOutputFormat(outputFormat);
    
    // Step 3: Export using appropriate strategy
    await this.exportUsingStrategy(detectedFormat);
    
    // Cleanup staging schema and end connection at the very end
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

} 