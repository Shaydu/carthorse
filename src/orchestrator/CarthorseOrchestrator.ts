import { Pool } from 'pg';
import { PgRoutingHelpers } from '../utils/pgrouting-helpers';
import { RouteGenerationOrchestratorService } from '../utils/services/route-generation-orchestrator-service';
import { RouteAnalysisAndExportService } from '../utils/services/route-analysis-and-export-service';
import { RouteSummaryService } from '../utils/services/route-summary-service';
import { ConstituentTrailAnalysisService } from '../utils/services/constituent-trail-analysis-service';

import { getDatabasePoolConfig } from '../utils/config-loader';
import { GeoJSONExportStrategy, GeoJSONExportConfig } from '../utils/export/geojson-export-strategy';
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
  usePgNodeNetwork?: boolean; // Enable pgr_nodeNetwork() processing
  networkStrategy?: 'pgnn' | 'postgis';
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
    console.log('🧭 Starting KSP route generation...');
    
    try {
      console.log('✅ Using connection pool');

      // Step 1: Validate database environment (schema version and functions only)
      await this.validateDatabaseEnvironment();

      // Step 2: Create staging environment
      await this.createStagingEnvironment();

      // Step 3: Copy trail data with bbox filter
      await this.copyTrailData();

      // Step 4: Split trails at intersections (if enabled)
      if (this.config.useSplitTrails !== false) {
        await this.splitTrailsAtIntersections();
      }

      // Step 5: Create pgRouting network
      await this.createPgRoutingNetwork();

      // Step 5: Add length and elevation columns
      await this.addLengthAndElevationColumns();

      // Step 6: Validate routing network (after network is created)
      await this.validateRoutingNetwork();

      // Step 7: Generate all routes using route generation orchestrator service
      console.log('🔍 DEBUG: About to call generateAllRoutesWithService...');
      await this.generateAllRoutesWithService();
      console.log('🔍 DEBUG: generateAllRoutesWithService completed');

      // Step 8: Generate analysis and export
      await this.generateAnalysisAndExport();

      console.log('✅ KSP route generation completed successfully!');

    } catch (error) {
      console.error('❌ KSP route generation failed:', error);
      throw error;
    }
  }

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
    
    let bboxFilter = '';
    if (this.config.bbox && this.config.bbox.length === 4) {
      const [minLng, minLat, maxLng, maxLat] = this.config.bbox;
      bboxFilter = `
        AND ST_Intersects(geometry, ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326))
      `;
      console.log(`🗺️ Using bbox filter: [${minLng}, ${minLat}, ${maxLng}, ${maxLat}]`);
    } else {
      console.log('🗺️ Using region filter (no bbox specified)');
      bboxFilter = `AND region = '${this.config.region}'`;
    }
    
    await this.pgClient.query(`
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
    `);

    const trailsCount = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.trails`);
    console.log(`✅ Copied ${trailsCount.rows[0].count} trails to staging`);

    // Optional: pre-bridge at trail level so split/network will include connectors
    if (process.env.PRE_BRIDGE_TRAILS === '1') {
      await this.preBridgeTrailEndpoints();
      // Midpoint variant: extend each trail to shared midpoint to remove gaps before splitting
      try {
        const tolMeters = parseFloat(process.env.BRIDGE_TOL_METERS || '20');
        const tolDeg = tolMeters / 111000.0;
        const maxPairs = parseInt(process.env.PRE_BRIDGE_MAX || '200', 10);
        console.log(`🧩 Pre-bridging to midpoint (≤ ${tolMeters} m, max ${maxPairs})...`);
        const res = await this.pgClient.query(
          `SELECT public.carthorse_bridge_endpoints_midpoint_v1($1, $2, $3) AS inserted`,
          [this.stagingSchema, tolDeg, maxPairs]
        );
        console.log(`✅ Midpoint bridge trail segments inserted: ${res.rows?.[0]?.inserted ?? 0}`);
      } catch (e) {
        console.warn('⚠️ Pre-bridge midpoint failed (continuing):', e instanceof Error ? e.message : String(e));
      }
      // Optional: snap existing trail endpoints directly to midpoint (modifies geometries) for perfect vertex joining
      if (process.env.SNAP_TRAIL_ENDPOINTS === '1') {
        try {
          const tolMeters = parseFloat(process.env.BRIDGE_TOL_METERS || '20');
          const tolDeg = tolMeters / 111000.0;
          const maxPairs = parseInt(process.env.PRE_BRIDGE_MAX || '200', 10);
          console.log(`🧲 Snapping trail endpoints to midpoint (≤ ${tolMeters} m, max ${maxPairs})...`);
          const res2 = await this.pgClient.query(
            `SELECT public.carthorse_snap_endpoints_to_midpoint_v1($1, $2, $3) AS updated`,
            [this.stagingSchema, tolDeg, maxPairs]
          );
          console.log(`✅ Trails snapped to midpoint: ${res2.rows?.[0]?.updated ?? 0}`);
        } catch (e) {
          console.warn('⚠️ Snap endpoints to midpoint failed (continuing):', e instanceof Error ? e.message : String(e));
        }
      }
    }
  }

  /**
   * Materialize short bridge segments directly into staging.trails by connecting
   * nearest trail endpoints within tolerance. This happens before splitting so
   * the connectors become part of the routing network for all strategies.
   */
  private async preBridgeTrailEndpoints(): Promise<void> {
    try {
      const tolMeters = parseFloat(process.env.BRIDGE_TOL_METERS || '20');
      const tolDeg = tolMeters / 111000.0;
      const maxBridges = parseInt(process.env.PRE_BRIDGE_MAX || '50', 10);
      console.log(`🧩 Pre-bridging trail endpoints in staging (≤ ${tolMeters} m, max ${maxBridges})...`);

      const result = await this.pgClient.query(
        `WITH params AS (
           SELECT $1::double precision AS tol_deg, $2::integer AS cap
         ),
         endpoints AS (
           SELECT app_uuid, name, ST_StartPoint(geometry) AS pt FROM ${this.stagingSchema}.trails
           UNION ALL
           SELECT app_uuid, name, ST_EndPoint(geometry)   AS pt FROM ${this.stagingSchema}.trails
           WHERE geometry IS NOT NULL
         ),
         candidates AS (
           SELECT e1.app_uuid AS a_uuid, e2.app_uuid AS b_uuid,
                  e1.pt AS p1, e2.pt AS p2,
                  ST_Distance(e1.pt::geography, e2.pt::geography) AS meters
           FROM endpoints e1
           JOIN endpoints e2 ON e1.app_uuid <> e2.app_uuid
           WHERE ST_DWithin(e1.pt, e2.pt, (SELECT tol_deg FROM params))
           ORDER BY meters ASC
           LIMIT (SELECT cap FROM params)
         ),
         ins AS (
           INSERT INTO ${this.stagingSchema}.trails (
             app_uuid, name, trail_type, surface, difficulty,
             geometry, length_km, elevation_gain, elevation_loss,
             max_elevation, min_elevation, avg_elevation, region, created_at, updated_at
           )
           SELECT gen_random_uuid()::text AS app_uuid,
                  'Bridge'::text AS name,
                  'link'::text AS trail_type,
                  'unknown'::text AS surface,
                  'moderate'::text AS difficulty,
                  ST_MakeLine(c.p1, c.p2) AS geometry,
                  c.meters/1000.0 AS length_km,
                  0, 0,
                  0, 0, 0,
                  $3::text AS region,
                  NOW(), NOW()
           FROM candidates c
           -- Avoid inserting zero-length or existing overlapping bridges
           WHERE c.meters > 0.1
           RETURNING 1
         )
         SELECT COUNT(*)::int AS inserted FROM ins;`,
        [tolDeg, maxBridges, this.config.region]
      );
      const inserted = result.rows?.[0]?.inserted ?? 0;
      console.log(`✅ Pre-bridged trail connectors inserted: ${inserted}`);
    } catch (e) {
      console.warn('⚠️ Pre-bridge trail endpoints failed (continuing):', e instanceof Error ? e.message : String(e));
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
    
    // Standard approach
    const pgrouting = new PgRoutingHelpers({
      stagingSchema: this.stagingSchema,
      pgClient: this.pgClient,
      usePgNodeNetwork: this.config.usePgNodeNetwork || false,
      networkStrategy: this.config.networkStrategy
    });

    const networkCreated = await pgrouting.createPgRoutingViews();
    if (!networkCreated) {
      throw new Error('Failed to create pgRouting network');
    }

    // Optional bridging pass to snap close endpoints and remove tiny gaps (opt-in)
    if (process.env.BRIDGE_ENDPOINTS === '1') {
      try {
        const tolMeters = parseFloat(process.env.BRIDGE_TOL_METERS || '5');
        const tolDeg = tolMeters / 111320; // rough conversion
        const sameName = (process.env.BRIDGE_REQUIRE_SAME_NAME || 'true').toLowerCase() !== 'false';
        console.log(`🧩 Bridging close endpoints (≤ ${tolMeters} m)...`);
        const res = await this.pgClient.query(
          `SELECT public.carthorse_bridge_endpoints_v1($1, $2, $3) AS added`,
          [this.stagingSchema, tolDeg, sameName]
        );
        console.log(`✅ Bridged connectors added: ${res.rows?.[0]?.added ?? 0}`);

        if (process.env.BRIDGE_TO_EDGE === '1') {
          console.log(`🧩 Bridging endpoint-to-edge (≤ ${tolMeters} m)...`);
          const res2 = await this.pgClient.query(
            `SELECT public.carthorse_bridge_endpoint_to_edge_v1($1, $2) AS added`,
            [this.stagingSchema, tolDeg]
          );
          console.log(`✅ Endpoint-to-edge connectors added: ${res2.rows?.[0]?.added ?? 0}`);
        }
      } catch (e) {
        console.warn('⚠️ Bridging pass failed (continuing):', e instanceof Error ? e.message : String(e));
      }
    }

    // Greedy proximity bridges: materialize short connectors between nearest vertex pairs
    if (process.env.GREEDY_BRIDGES === '1') {
      try {
        const tolMeters = parseFloat(process.env.BRIDGE_TOL_METERS || '20');
        const maxBridges = parseInt(process.env.GREEDY_MAX_BRIDGES || '50', 10);
        console.log(`🧩 Greedy bridge materialization: ≤ ${tolMeters} m (max ${maxBridges})`);
        const result = await this.pgClient.query(
          `WITH params AS (
             SELECT $1::double precision AS tol_m, $2::integer AS cap
           ),
           base_id AS (
             SELECT COALESCE(MAX(id),0) AS id FROM ${this.stagingSchema}.ways_noded
           ),
           pairs AS (
             SELECT v1.id AS a, v2.id AS b,
                    ST_Distance(v1.the_geom::geography, v2.the_geom::geography) AS meters
             FROM ${this.stagingSchema}.ways_noded_vertices_pgr v1
             JOIN ${this.stagingSchema}.ways_noded_vertices_pgr v2 ON v1.id < v2.id
             WHERE ST_DWithin(
                     v1.the_geom,
                     v2.the_geom,
                     (SELECT tol_m FROM params)/111000.0
                   )
               AND NOT EXISTS (
                     SELECT 1 FROM ${this.stagingSchema}.ways_noded e
                     WHERE (e.source = v1.id AND e.target = v2.id)
                        OR (e.source = v2.id AND e.target = v1.id)
                   )
             ORDER BY meters ASC
             LIMIT (SELECT cap FROM params)
           ),
           ins AS (
             INSERT INTO ${this.stagingSchema}.ways_noded
               (id, old_id, sub_id, the_geom, app_uuid, name, length_km, elevation_gain, elevation_loss, source, target)
             SELECT (SELECT id FROM base_id) + ROW_NUMBER() OVER () AS id,
                    NULL, 1,
                    ST_MakeLine(v1.the_geom, v2.the_geom) AS the_geom,
                    'bridge'::text AS app_uuid,
                    'Bridge'::text AS name,
                    p.meters/1000.0 AS length_km,
                    0, 0,
                    p.a, p.b
             FROM pairs p
             JOIN ${this.stagingSchema}.ways_noded_vertices_pgr v1 ON v1.id = p.a
             JOIN ${this.stagingSchema}.ways_noded_vertices_pgr v2 ON v2.id = p.b
             RETURNING 1
           )
           SELECT COUNT(*)::int AS inserted FROM ins;`
          , [tolMeters, maxBridges]
        );
        const inserted = result.rows?.[0]?.inserted ?? 0;
        console.log(`✅ Greedy bridges inserted: ${inserted}`);
      } catch (e) {
        console.warn('⚠️ Greedy bridge materialization failed (continuing):', e instanceof Error ? e.message : String(e));
      }
    }

    // Get network statistics
    const statsResult = await this.pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded) as edges,
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded_vertices_pgr) as vertices
    `);
    console.log(`📊 Network created: ${statsResult.rows[0].edges} edges, ${statsResult.rows[0].vertices} vertices`);
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
   * Generate analysis and export using the analysis and export service
   */
  private async generateAnalysisAndExport(): Promise<void> {
    console.log('📊 Generating analysis and export using analysis and export service...');
    
    const analysisAndExportService = new RouteAnalysisAndExportService(this.pgClient, {
      stagingSchema: this.stagingSchema,
      outputPath: this.config.outputPath,
      exportConfig: this.config.exportConfig
    });

    const result = await analysisAndExportService.generateAnalysisAndExport();
    
    console.log(`✅ Analysis and export completed:`);
    console.log(`   📊 Routes analyzed: ${result.analysis.constituentAnalysis.totalRoutesAnalyzed}`);
    console.log(`   📤 Export success: ${result.export.success}`);
    console.log(`   🔍 Validation passed: ${result.export.validationPassed}`);
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
    // Step 1: Populate staging schema and generate routes
    await this.generateKspRoutes();
    
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
        await this.exportToSqlite();
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
      
      console.log(`✅ SQLite export completed: ${this.config.outputPath}`);
      console.log(`   - Trails: ${result.trailsExported}`);
      console.log(`   - Nodes: ${result.nodesExported}`);
      console.log(`   - Edges: ${result.edgesExported}`);
      console.log(`   - Size: ${result.dbSizeMB.toFixed(2)} MB`);
    } finally {
      poolClient.release();
    }
  }

  private async exportToGeoJSON(): Promise<void> {
    console.log('📤 Exporting to GeoJSON format...');
    
    const poolClient = await this.pgClient.connect();
    
    try {
      // Use unified GeoJSON export strategy
      const geojsonConfig: GeoJSONExportConfig = {
        region: this.config.region,
        outputPath: this.config.outputPath,
        includeTrails: true,
        includeNodes: this.config.exportConfig?.includeNodes || false,
        includeEdges: this.config.exportConfig?.includeEdges || false,
        includeRecommendations: this.config.exportConfig?.includeRoutes !== false, // Default to true if routes were generated
        verbose: this.config.verbose
      };
      
      const geojsonExporter = new GeoJSONExportStrategy(poolClient as any, geojsonConfig, this.stagingSchema);
      await geojsonExporter.exportFromStaging();
      
      console.log(`✅ GeoJSON export completed: ${this.config.outputPath}`);
    } finally {
      poolClient.release();
    }
  }

  private async exportTrailsOnly(): Promise<void> {
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
} 