import { Pool } from 'pg';
import { PgRoutingHelpers } from '../utils/pgrouting-helpers';
import { RouteGenerationOrchestratorService } from '../utils/services/route-generation-orchestrator-service';
import { RouteAnalysisAndExportService } from '../utils/services/route-analysis-and-export-service';
import { RouteSummaryService } from '../utils/services/route-summary-service';
import { ConstituentTrailAnalysisService } from '../utils/services/constituent-trail-analysis-service';

import { getDatabasePoolConfig, getNetworkRefinementConfig, getNetworkCacheConfig } from '../utils/config-loader';
import { GeoJSONExportStrategy, GeoJSONExportConfig } from '../utils/export/geojson-export-strategy';
import { SQLiteExportStrategy, SQLiteExportConfig } from '../utils/export/sqlite-export-strategy';
import { computeNetworkMetrics } from '../utils/network/metrics';
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
  trailheadsEnabled?: boolean; // Enable trailhead-based route generation (alias for trailheads.enabled)
  skipValidation?: boolean; // Skip database validation
  verbose?: boolean; // Enable verbose logging
  // Connectivity refinement
  connectorToleranceMeters?: number; // Create connectors when endpoints are within this tolerance
  minDeadEndMeters?: number; // Remove dead-end edges shorter than this threshold (except connectors)
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
      console.log(`📁 Using staging schema: ${this.stagingSchema}`);

      // Step 1: Validate database environment (schema version and functions only)
      await this.validateDatabaseEnvironment();

      // Step 2: Create staging environment (always create new for full process)
      await this.createStagingEnvironment();

      // Step 3: Copy trail data with bbox filter
      await this.copyTrailData();

      // Step 4: Split trails at intersections (if enabled)
      if (this.config.useSplitTrails !== false) {
        await this.splitTrailsAtIntersections();
      }

      // Step 5: Create pgRouting network
      await this.createPgRoutingNetwork();

      // Snapshot metrics before refinement
      try {
        const pre = await computeNetworkMetrics(this.pgClient, this.stagingSchema);
        console.log(`📈 Pre-refinement metrics:`);
        console.log(`   - Edges: ${pre.edges}, Vertices: ${pre.vertices}`);
        console.log(`   - Isolates: ${pre.isolates}, Endpoints: ${pre.endpoints}, Intersections: ${pre.intersections}`);
        console.log(`   - Avg degree: ${pre.avgDegree ?? 'n/a'}`);
        console.log(`   - Components: ${pre.componentsCount ?? 'n/a'}, Giant component: ${pre.giantComponentSize ?? 'n/a'}`);
        console.log(`   - Bridges: ${pre.bridges ?? 'n/a'}, Articulation points: ${pre.articulationPoints ?? 'n/a'}`);
        console.log(`   - Cyclomatic number: ${pre.cyclomaticNumber ?? 'n/a'}`);
        console.log(`   - Avg reachable (<=25 km): ${pre.avgReachableKm25 ?? 'n/a'} km`);
      } catch (e) {
        console.log(`⚠️  Failed to compute pre-refinement metrics: ${e}`);
      }

      // Step 5: Add length and elevation columns
      await this.addLengthAndElevationColumns();

      // Step 6: Validate routing network (after network is created)
      await this.validateRoutingNetwork();

      // Step 7: Generate all routes using route generation orchestrator service
      console.log('🔍 DEBUG: About to call generateAllRoutesWithService...');
      await this.generateAllRoutesWithService();
      console.log('🔍 DEBUG: generateAllRoutesWithService completed');

      // Step 8: (analysis optional) — skip in-run export to avoid double exports
      // If analysis logs are desired, we can run analysis only without exporting.
      try {
        const analysisAndExportService = new RouteAnalysisAndExportService(this.pgClient, {
          stagingSchema: this.stagingSchema,
          outputPath: this.config.outputPath,
          exportConfig: this.config.exportConfig
        });
        await analysisAndExportService.generateRouteAnalysis();
      } catch {}

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
      usePgNodeNetwork: this.config.usePgNodeNetwork || false
    });

    const networkCreated = await pgrouting.createPgRoutingViews();
    if (!networkCreated) {
      throw new Error('Failed to create pgRouting network');
    }

    // Get network statistics
    const statsResult = await this.pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded) as edges,
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded_vertices_pgr) as vertices
    `);
    console.log(`📊 Network created: ${statsResult.rows[0].edges} edges, ${statsResult.rows[0].vertices} vertices`);

    // Enforce NOT NULL on id to prevent null ids on later inserts
    try {
      await this.pgClient.query(`ALTER TABLE ${this.stagingSchema}.ways_noded ALTER COLUMN id SET NOT NULL`);
    } catch (e) {
      console.log(`⚠️  Could not enforce NOT NULL on ways_noded.id (may already be set): ${e}`);
    }

    // Option A: Apply cached connectors from master DB into staging
    try {
      const refCfg = getNetworkRefinementConfig();
      if (refCfg.applyCachedConnectors) {
        console.log('🔌 Applying cached connectors from master database...');
        await this.applyCachedConnectors();
      }
    } catch (e) {
      console.log(`⚠️  Failed applying cached connectors: ${e}`);
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
    
    // Clean up duplicate edges and orphaned nodes (also builds new connectors)
    await this.cleanupRoutingNetwork();

    // Option A: Persist discovered connectors back to master cache
    try {
      const refCfg = getNetworkRefinementConfig();
      if (refCfg.persistDiscoveredConnectors) {
        console.log('💾 Persisting discovered connectors to master cache...');
        await this.persistDiscoveredConnectors();
      }
    } catch (e) {
      console.log(`⚠️  Failed persisting discovered connectors: ${e}`);
    }

    // Snapshot metrics after refinement
    try {
      const post = await computeNetworkMetrics(this.pgClient, this.stagingSchema);
      console.log(`📈 Post-refinement metrics:`);
      console.log(`   - Edges: ${post.edges}, Vertices: ${post.vertices}`);
      console.log(`   - Isolates: ${post.isolates}, Endpoints: ${post.endpoints}, Intersections: ${post.intersections}`);
      console.log(`   - Avg degree: ${post.avgDegree ?? 'n/a'}`);
      console.log(`   - Components: ${post.componentsCount ?? 'n/a'}, Giant component: ${post.giantComponentSize ?? 'n/a'}`);
      console.log(`   - Bridges: ${post.bridges ?? 'n/a'}, Articulation points: ${post.articulationPoints ?? 'n/a'}`);
      console.log(`   - Cyclomatic number: ${post.cyclomaticNumber ?? 'n/a'}`);
      console.log(`   - Avg reachable (<=25 km): ${post.avgReachableKm25 ?? 'n/a'} km`);
    } catch (e) {
      console.log(`⚠️  Failed to compute post-refinement metrics: ${e}`);
    }
    
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
    console.log(`   - KSP K value: ${routeDiscoveryConfig.algorithms?.ksp?.k}`);
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
      kspKValue: routeDiscoveryConfig.algorithms?.ksp?.k || 3,
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
      // Use unified SQLite export strategy (single export path)
      const sqliteConfig: SQLiteExportConfig = {
        region: this.config.region,
        outputPath: this.config.outputPath,
        includeTrails: true,
        includeNodes: this.config.exportConfig?.includeNodes !== false,
        includeEdges: this.config.exportConfig?.includeEdges !== false,
        includeRecommendations: this.config.exportConfig?.includeRoutes !== false,
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
      if (typeof result.recommendationsExported === 'number') {
        console.log(`   - Route Recommendations: ${result.recommendationsExported}`);
      }
      if (typeof result.routeTrailsExported === 'number') {
        console.log(`   - Route Trail Segments: ${result.routeTrailsExported}`);
      }
      console.log(`   - Size: ${result.dbSizeMB.toFixed(2)} MB`);

      // Post-export metrics snapshot (same staging, printed for convenience)
      try {
        const m = await computeNetworkMetrics(this.pgClient, this.stagingSchema);
        console.log(`📈 Post-export metrics:`);
        console.log(`   - Edges: ${m.edges}, Vertices: ${m.vertices}`);
        console.log(`   - Isolates: ${m.isolates}, Endpoints: ${m.endpoints}, Intersections: ${m.intersections}`);
        console.log(`   - Avg degree: ${m.avgDegree ?? 'n/a'}`);
        console.log(`   - Components: ${m.componentsCount ?? 'n/a'}, Giant component: ${m.giantComponentSize ?? 'n/a'}`);
        console.log(`   - Bridges: ${m.bridges ?? 'n/a'}, Articulation points: ${m.articulationPoints ?? 'n/a'}`);
        console.log(`   - Cyclomatic number: ${m.cyclomaticNumber ?? 'n/a'}`);
        console.log(`   - Avg reachable (<=25 km): ${m.avgReachableKm25 ?? 'n/a'} km`);
      } catch (e) {
        console.log(`⚠️  Failed to compute post-export metrics: ${e}`);
      }
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
        includeNodes: this.config.exportConfig?.includeNodes,
        includeEdges: this.config.exportConfig?.includeEdges,
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

  /**
   * Static method to export production functions to a SQL file
   */
  static async exportProductionFunctions(outputPath: string): Promise<void> {
    console.log('💾 Exporting production functions...');
    
    // Get database configuration from config file
    const dbConfig = getDatabasePoolConfig();
    
    const pool = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
      max: dbConfig.max,
      idleTimeoutMillis: dbConfig.idleTimeoutMillis,
      connectionTimeoutMillis: dbConfig.connectionTimeoutMillis
    });

    try {
      const client = await pool.connect();
      
      // Get all function definitions from the database
      const result = await client.query(`
        SELECT 
          p.proname as function_name,
          pg_get_functiondef(p.oid) as function_definition
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
        AND p.proname LIKE 'carthorse_%'
        ORDER BY p.proname
      `);

      if (result.rows.length === 0) {
        console.log('⚠️  No carthorse functions found in the database');
        return;
      }

      // Write functions to file
      const fs = require('fs');
      const path = require('path');
      
      // Ensure directory exists
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let sqlContent = `-- Carthorse Production Functions Export\n`;
      sqlContent += `-- Generated on: ${new Date().toISOString()}\n\n`;

      for (const row of result.rows) {
        sqlContent += `-- Function: ${row.function_name}\n`;
        sqlContent += `${row.function_definition};\n\n`;
      }

      fs.writeFileSync(outputPath, sqlContent);
      console.log(`✅ Exported ${result.rows.length} functions to ${outputPath}`);
      
    } finally {
      await pool.end();
    }
  }

  /**
   * Static method to install functions from a SQL file
   */
  static async installFunctions(inputPath: string): Promise<void> {
    console.log('🔧 Installing functions from SQL file...');
    
    // Get database configuration from config file
    const dbConfig = getDatabasePoolConfig();
    
    const pool = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
      max: dbConfig.max,
      idleTimeoutMillis: dbConfig.idleTimeoutMillis,
      connectionTimeoutMillis: dbConfig.connectionTimeoutMillis
    });

    try {
      const client = await pool.connect();
      
      // Read and execute the SQL file
      const fs = require('fs');
      const sqlContent = fs.readFileSync(inputPath, 'utf8');
      
      await client.query(sqlContent);
      console.log(`✅ Functions installed successfully from ${inputPath}`);
      
    } finally {
      await pool.end();
    }
  }

  /**
   * Clean up duplicate edges and orphaned nodes in the routing network
   * This should be called after pgr_nodeNetwork creates the network
   */
  private async cleanupRoutingNetwork(): Promise<void> {
    console.log('🧹 Cleaning up routing network (deduplicating edges and removing orphaned nodes)...');
    
    const netRef = getNetworkRefinementConfig();
    const connectorTolerance = this.config.connectorToleranceMeters ?? netRef.connectorToleranceMeters ?? 1.0;
    const minDeadEndMeters = this.config.minDeadEndMeters ?? netRef.minDeadEndMeters ?? 10.0;

    try {
      // Run all refinement steps atomically
      await this.pgClient.query('BEGIN');

      // Pre-analysis stats
      const preCounts = await this.pgClient.query(`
        WITH deg AS (
          SELECT v.id,
                 COALESCE(src.cnt,0) + COALESCE(tgt.cnt,0) AS degree
          FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
          LEFT JOIN (
            SELECT source AS id, COUNT(*) AS cnt FROM ${this.stagingSchema}.ways_noded GROUP BY source
          ) src ON src.id = v.id
          LEFT JOIN (
            SELECT target AS id, COUNT(*) AS cnt FROM ${this.stagingSchema}.ways_noded GROUP BY target
          ) tgt ON tgt.id = v.id
        )
        SELECT 
          (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded) AS edges,
          (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded_vertices_pgr) AS vertices,
          COUNT(*) FILTER (WHERE degree = 0) AS isolates,
          COUNT(*) FILTER (WHERE degree = 1) AS endpoints,
          COUNT(*) FILTER (WHERE degree >= 3) AS intersections,
          AVG(degree::float) AS avg_degree
        FROM deg
      `);

      const pre = preCounts.rows[0];
      console.log(`📊 Pre-refinement — edges: ${pre.edges}, vertices: ${pre.vertices}, isolates: ${pre.isolates}, endpoints: ${pre.endpoints}, intersections: ${pre.intersections}, avg_degree: ${Number(pre.avg_degree).toFixed(2)}`);

      // Step 1: Remove duplicate edges (keep only one canonical direction)
      const duplicateEdgesResult = await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.ways_noded w1
        WHERE EXISTS (
          SELECT 1 FROM ${this.stagingSchema}.ways_noded w2
          WHERE w1.source = w2.target 
            AND w1.target = w2.source
            AND w1.source > w1.target
        )
      `);
      console.log(`✅ Removed ${duplicateEdgesResult.rowCount} duplicate edges`);

      // Step 1a: Endpoint-to-edge snapping with split (adds shared vertex on target edge)
      try {
        const snapToleranceMeters = connectorTolerance; // reuse small meter-scale tolerance
        console.log(`🔧 Endpoint-to-edge snapping within ${snapToleranceMeters} m`);
        // Corridor predicate for snapping (optional)
        const { RouteDiscoveryConfigLoader } = await import('../config/route-discovery-config-loader');
        const cfg = RouteDiscoveryConfigLoader.getInstance().loadConfig();
        const applyCorr = cfg.corridor?.enabled;
        const corridorGeom = (() => {
          if (!applyCorr) return '';
          const c = cfg.corridor!;
          if (c.mode === 'polyline-buffer' && c.polyline && c.polyline.length >= 2) {
            const coords = c.polyline.map(p => `${p[0]} ${p[1]}`).join(', ');
            const buf = c.bufferMeters || 200;
            return `ST_Buffer(ST_SetSRID(ST_GeomFromText('LINESTRING(${coords})'), 4326)::geography, ${buf})::geometry`;
          }
          if (c.bbox && c.bbox.length === 4) {
            const [minLng, minLat, maxLng, maxLat] = c.bbox;
            return `ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)`;
          }
          return '';
        })();
        const corridorSnap = applyCorr && corridorGeom ? ` AND ST_Intersects(ep.the_geom, ${corridorGeom}) AND ST_Intersects(e.the_geom, ${corridorGeom})` : '';
        const snapSql = `
          WITH deg AS (
            SELECT v.id,
                   COALESCE(src.cnt,0) + COALESCE(tgt.cnt,0) AS degree,
                   v.the_geom
            FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
            LEFT JOIN (
              SELECT source AS id, COUNT(*) AS cnt FROM ${this.stagingSchema}.ways_noded GROUP BY source
            ) src ON src.id = v.id
            LEFT JOIN (
              SELECT target AS id, COUNT(*) AS cnt FROM ${this.stagingSchema}.ways_noded GROUP BY target
            ) tgt ON tgt.id = v.id
          ),
          endpoints AS (
            SELECT id, the_geom FROM deg WHERE degree = 1
          ),
          cand AS (
            SELECT 
              ep.id AS endpoint_id,
              e.id  AS edge_id,
              ST_ClosestPoint(e.the_geom, ep.the_geom) AS snap_pt,
              ST_Distance(ep.the_geom::geography, e.the_geom::geography) AS dist_m,
              ST_LineLocatePoint(e.the_geom, ep.the_geom) AS t
            FROM endpoints ep
            JOIN ${this.stagingSchema}.ways_noded e ON e.source <> ep.id AND e.target <> ep.id
            WHERE ST_DWithin(ep.the_geom::geography, e.the_geom::geography, ${snapToleranceMeters})
              ${corridorSnap}
          ),
          best AS (
            SELECT DISTINCT ON (endpoint_id) endpoint_id, edge_id, snap_pt, dist_m, t
            FROM cand
            WHERE t > 0.01 AND t < 0.99
            ORDER BY endpoint_id, dist_m ASC
          ),
          newv AS (
            SELECT 
              (SELECT COALESCE(MAX(id),0) FROM ${this.stagingSchema}.ways_noded_vertices_pgr) + ROW_NUMBER() OVER () AS new_id,
              edge_id,
              endpoint_id,
              snap_pt AS the_geom
            FROM best
          ),
          insv AS (
            INSERT INTO ${this.stagingSchema}.ways_noded_vertices_pgr (id, the_geom, cnt)
            SELECT new_id, the_geom, 0 FROM newv
            RETURNING id
          ),
          split_edges AS (
            SELECT 
              b.edge_id,
              ST_Split(e.the_geom, b.snap_pt) AS gc,
              e.trail_type, e.surface, e.difficulty, e.name
            FROM best b
            JOIN ${this.stagingSchema}.ways_noded e ON e.id = b.edge_id
          ),
          parts AS (
            SELECT edge_id, (ST_Dump(gc)).geom AS geom, trail_type, surface, difficulty, name
            FROM split_edges
          ),
          del AS (
            DELETE FROM ${this.stagingSchema}.ways_noded w WHERE w.id IN (SELECT DISTINCT edge_id FROM parts)
            RETURNING 1
          )
          INSERT INTO ${this.stagingSchema}.ways_noded (
            id, old_id, app_uuid, the_geom, length_km, elevation_gain, elevation_loss, trail_type, surface, difficulty, name, source, target
          )
          SELECT 
            COALESCE((SELECT MAX(id) FROM ${this.stagingSchema}.ways_noded), 0) + ROW_NUMBER() OVER () AS id,
            COALESCE((SELECT MAX(old_id) FROM ${this.stagingSchema}.ways_noded), 0) + ROW_NUMBER() OVER () AS old_id,
            'snap_' || edge_id || '_' || ROW_NUMBER() OVER () AS app_uuid,
            geom,
            ST_Length(geom::geography) / 1000.0 AS length_km,
            0, 0,
            COALESCE(trail_type, 'hiking'),
            COALESCE(surface, 'dirt'),
            COALESCE(difficulty, 'moderate'),
            COALESCE(name, 'Trail'),
            (SELECT v.id FROM ${this.stagingSchema}.ways_noded_vertices_pgr v ORDER BY v.the_geom <-> ST_StartPoint(geom) LIMIT 1) AS source,
            (SELECT v.id FROM ${this.stagingSchema}.ways_noded_vertices_pgr v ORDER BY v.the_geom <-> ST_EndPoint(geom) LIMIT 1) AS target
          FROM parts
        `;
        const snapRes = await this.pgClient.query(snapSql);
        console.log(`🔗 Snapped endpoints to edges; new segments: ${snapRes.rowCount ?? 0}`);
      } catch (e) {
        console.log(`⚠️  Endpoint-to-edge snapping skipped due to error: ${e}`);
      }

      // Step 1b: At-grade crossing splitting — insert nodes where lines cross on same grade
      try {
        const netRef = getNetworkRefinementConfig();
        const atGradeTol = (netRef as any).atGradeToleranceMeters ?? 1.0;
        if ((netRef as any).enableAtGradeCrossings) {
          console.log('➕ At-grade crossing splitting enabled');
          const splitSql = `
            WITH pairs AS (
              SELECT e1.id AS id1, e2.id AS id2, e1.the_geom AS g1, e2.the_geom AS g2
              FROM ${this.stagingSchema}.ways_noded e1
              JOIN ${this.stagingSchema}.ways_noded e2 ON e1.id < e2.id
              WHERE ST_DWithin(e1.the_geom, e2.the_geom, ${atGradeTol})
                AND ST_Crosses(e1.the_geom, e2.the_geom)
            ),
            points AS (
              SELECT id1, id2, ST_Intersection(g1, g2) AS p
              FROM pairs
            ),
            valid AS (
              SELECT id1, id2, (CASE WHEN GeometryType(p) = 'POINT' THEN p ELSE ST_PointOnSurface(p) END) AS p
              FROM points
              WHERE NOT ST_IsEmpty(p)
            ),
            split1 AS (
              SELECT e1.id, ST_Split(e1.the_geom, v.p) AS g
              FROM valid v
              JOIN ${this.stagingSchema}.ways_noded e1 ON e1.id = v.id1
            ),
            split2 AS (
              SELECT e2.id, ST_Split(e2.the_geom, v.p) AS g
              FROM valid v
              JOIN ${this.stagingSchema}.ways_noded e2 ON e2.id = v.id2
            )
            SELECT 1
          `;
          // Execute split in smaller steps: collect intersections, then split and reinsert would need more plumbing.
          // For now, log intent to avoid partial write without full rewire implementation.
          console.log('ℹ️  At-grade splitting planned; full rewire implementation pending.');
        }
      } catch (e) {
        console.log(`⚠️  At-grade crossing splitting step failed (non-fatal): ${e}`);
      }

      // Step 2: Create short connector edges (<= tolerance) when they increase degree
      const { RouteDiscoveryConfigLoader } = await import('../config/route-discovery-config-loader');
      const cfg2 = RouteDiscoveryConfigLoader.getInstance().loadConfig();
      const applyCorr2 = cfg2.corridor?.enabled;
      const corridorGeom2 = (() => {
        if (!applyCorr2) return '';
        const c = cfg2.corridor!;
        if (c.mode === 'polyline-buffer' && c.polyline && c.polyline.length >= 2) {
          const coords = c.polyline.map(p => `${p[0]} ${p[1]}`).join(', ');
          const buf = c.bufferMeters || 200;
          return `ST_Buffer(ST_SetSRID(ST_GeomFromText('LINESTRING(${coords})'), 4326)::geography, ${buf})::geometry`;
        }
        if (c.bbox && c.bbox.length === 4) {
          const [minLng, minLat, maxLng, maxLat] = c.bbox;
          return `ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)`;
        }
        return '';
      })();
      const corridorConn = applyCorr2 && corridorGeom2 ? ` AND ST_Intersects(v1.the_geom, ${corridorGeom2}) AND ST_Intersects(v2.the_geom, ${corridorGeom2})` : '';
      const connectorsResult = await this.pgClient.query(`
        WITH deg AS (
          SELECT v.id,
                 COALESCE(src.cnt,0) + COALESCE(tgt.cnt,0) AS degree
          FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
          LEFT JOIN (
            SELECT source AS id, COUNT(*) AS cnt FROM ${this.stagingSchema}.ways_noded GROUP BY source
          ) src ON src.id = v.id
          LEFT JOIN (
            SELECT target AS id, COUNT(*) AS cnt FROM ${this.stagingSchema}.ways_noded GROUP BY target
          ) tgt ON tgt.id = v.id
        ),
        pairs AS (
          SELECT d1.id AS v1, d2.id AS v2,
                 ST_ShortestLine(v1.the_geom, v2.the_geom) AS geom,
                 ST_Length(ST_ShortestLine(v1.the_geom, v2.the_geom)::geography) AS len_m
          FROM ${this.stagingSchema}.ways_noded_vertices_pgr v1
          JOIN ${this.stagingSchema}.ways_noded_vertices_pgr v2 ON v1.id < v2.id
          JOIN deg d1 ON d1.id = v1.id
          JOIN deg d2 ON d2.id = v2.id
          WHERE ST_DWithin(v1.the_geom, v2.the_geom, ${connectorTolerance})
            AND NOT EXISTS (
              SELECT 1 FROM ${this.stagingSchema}.ways_noded e
              WHERE (e.source = v1.id AND e.target = v2.id) OR (e.source = v2.id AND e.target = v1.id)
            )
            AND (d1.degree IN (0,1) OR d2.degree IN (0,1)) -- increases degree at at least one endpoint (allow isolates)
            AND ST_LineLocatePoint(ST_MakeLine(v1.the_geom, v2.the_geom), v1.the_geom) > 0.0
            AND ST_LineLocatePoint(ST_MakeLine(v1.the_geom, v2.the_geom), v2.the_geom) < 1.0
            ${corridorConn}
        )
        INSERT INTO ${this.stagingSchema}.ways_noded (
          id, old_id, app_uuid, the_geom, length_km, elevation_gain, elevation_loss, trail_type, surface, difficulty, name, source, target
        )
        SELECT 
          COALESCE((SELECT MAX(id) FROM ${this.stagingSchema}.ways_noded), 0) + ROW_NUMBER() OVER () AS id,
          COALESCE((SELECT MAX(old_id) FROM ${this.stagingSchema}.ways_noded), 0) + ROW_NUMBER() OVER () AS old_id,
          ('connector_' || v1 || '_' || v2) AS app_uuid,
          geom AS the_geom,
          len_m / 1000.0 AS length_km,
          0 AS elevation_gain,
          0 AS elevation_loss,
          'connector' AS trail_type,
          'unknown' AS surface,
          'unknown' AS difficulty,
          'Connector' AS name,
          v1 AS source,
          v2 AS target
        FROM pairs
        RETURNING 1
      `);
      console.log(`➕ Added ${connectorsResult.rowCount} connector edges (≤ ${connectorTolerance} m)`);

      // Step 3: Remove short dead-ends (< threshold) excluding connectors
      const deadEndsResult = await this.pgClient.query(`
        WITH deg AS (
          SELECT v.id,
                 COALESCE(src.cnt,0) + COALESCE(tgt.cnt,0) AS degree
          FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
          LEFT JOIN (
            SELECT source AS id, COUNT(*) AS cnt FROM ${this.stagingSchema}.ways_noded GROUP BY source
          ) src ON src.id = v.id
          LEFT JOIN (
            SELECT target AS id, COUNT(*) AS cnt FROM ${this.stagingSchema}.ways_noded GROUP BY target
          ) tgt ON tgt.id = v.id
        )
        DELETE FROM ${this.stagingSchema}.ways_noded e
        USING deg d1, deg d2
        WHERE e.source = d1.id AND e.target = d2.id
          AND (d1.degree = 1 OR d2.degree = 1)
          AND ST_Length(e.the_geom::geography) < ${minDeadEndMeters}
          AND COALESCE(e.trail_type, '') <> 'connector'
        RETURNING 1
      `);
      console.log(`🗑️ Removed ${deadEndsResult.rowCount} short dead-end edges (< ${minDeadEndMeters} m)`);

      // Step 4: Remove orphaned nodes (no incident edges)
      const orphanedNodesResult = await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        WHERE v.id NOT IN (
          SELECT DISTINCT source FROM ${this.stagingSchema}.ways_noded 
          UNION
          SELECT DISTINCT target FROM ${this.stagingSchema}.ways_noded 
        )
      `);
      console.log(`🧽 Removed ${orphanedNodesResult.rowCount} orphaned nodes`);

      // Post-analysis stats
      const postCounts = await this.pgClient.query(`
        WITH deg AS (
          SELECT v.id,
                 COALESCE(src.cnt,0) + COALESCE(tgt.cnt,0) AS degree
          FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
          LEFT JOIN (
            SELECT source AS id, COUNT(*) AS cnt FROM ${this.stagingSchema}.ways_noded GROUP BY source
          ) src ON src.id = v.id
          LEFT JOIN (
            SELECT target AS id, COUNT(*) AS cnt FROM ${this.stagingSchema}.ways_noded GROUP BY target
          ) tgt ON tgt.id = v.id
        )
        SELECT 
          (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded) AS edges,
          (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded_vertices_pgr) AS vertices,
          COUNT(*) FILTER (WHERE degree = 0) AS isolates,
          COUNT(*) FILTER (WHERE degree = 1) AS endpoints,
          COUNT(*) FILTER (WHERE degree >= 3) AS intersections,
          AVG(degree::float) AS avg_degree
        FROM deg
      `);

      const post = postCounts.rows[0];
      console.log(`📊 Post-refinement — edges: ${post.edges}, vertices: ${post.vertices}, isolates: ${post.isolates}, endpoints: ${post.endpoints}, intersections: ${post.intersections}, avg_degree: ${Number(post.avg_degree).toFixed(2)}`);

      // Commit
      await this.pgClient.query('COMMIT');

      // Delta summary
      const delta = (a: any, b: any) => Number(b) - Number(a);
      console.log(`Δ edges: ${delta(pre.edges, post.edges)}, Δ vertices: ${delta(pre.vertices, post.vertices)}, Δ isolates: ${delta(pre.isolates, post.isolates)}, Δ endpoints: ${delta(pre.endpoints, post.endpoints)}, Δ intersections: ${delta(pre.intersections, post.intersections)}, Δ avg_degree: ${(Number(post.avg_degree) - Number(pre.avg_degree)).toFixed(2)}`);

    } catch (error) {
      await this.pgClient.query('ROLLBACK');
      console.log(`⚠️  Routing network cleanup failed and was rolled back: ${error}`);
    }
  }

  /**
   * Apply cached connectors from master DB (public.connector_edges) into the staging network
   */
  private async applyCachedConnectors(): Promise<void> {
    // Insert connector edges by snapping to nearest existing vertices for source/target
    const bbox = this.config.bbox;
    const bboxFilter = bbox && bbox.length === 4
      ? `AND ce.geom && ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)`
      : '';
    // Optional corridor filter for cached connectors
    const { RouteDiscoveryConfigLoader } = await import('../config/route-discovery-config-loader');
    const cfg = RouteDiscoveryConfigLoader.getInstance().loadConfig();
    const applyCorr = cfg.corridor?.enabled;
    const corridorGeom = (() => {
      if (!applyCorr) return '';
      const c = cfg.corridor!;
      if (c.mode === 'polyline-buffer' && c.polyline && c.polyline.length >= 2) {
        const coords = c.polyline.map(p => `${p[0]} ${p[1]}`).join(', ');
        const buf = c.bufferMeters || 200;
        return `ST_Buffer(ST_SetSRID(ST_GeomFromText('LINESTRING(${coords})'), 4326)::geography, ${buf})::geometry`;
      }
      if (c.bbox && c.bbox.length === 4) {
        const [minLng, minLat, maxLng, maxLat] = c.bbox;
        return `ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)`;
      }
      return '';
    })();
    const corridorFilter = applyCorr && corridorGeom ? ` AND ST_Intersects(ce.geom, ${corridorGeom})` : '';

    await this.pgClient.query('BEGIN');
    try {
      const insertSql = `
        WITH candidates AS (
          SELECT ce.geom, ce.length_m
          FROM public.connector_edges ce
          WHERE ce.region = $1
          ${bboxFilter}
          ${corridorFilter}
        ),
        endpoints AS (
          SELECT 
            ST_StartPoint(geom) AS a,
            ST_EndPoint(geom) AS b,
            geom,
            length_m
          FROM candidates
        ),
        snapped AS (
          SELECT 
            e.geom,
            e.length_m,
            (SELECT v1.id FROM ${this.stagingSchema}.ways_noded_vertices_pgr v1 ORDER BY v1.the_geom <-> e.a LIMIT 1) AS source,
            (SELECT v2.id FROM ${this.stagingSchema}.ways_noded_vertices_pgr v2 ORDER BY v2.the_geom <-> e.b LIMIT 1) AS target
          FROM endpoints e
        ),
        filtered AS (
          SELECT * FROM snapped s
          WHERE s.source IS NOT NULL AND s.target IS NOT NULL AND s.source <> s.target
            AND NOT EXISTS (
              SELECT 1 FROM ${this.stagingSchema}.ways_noded w
              WHERE (w.source = s.source AND w.target = s.target) OR (w.source = s.target AND w.target = s.source)
            )
        )
        INSERT INTO ${this.stagingSchema}.ways_noded (
          id, old_id, app_uuid, the_geom, length_km, elevation_gain, elevation_loss, trail_type, surface, difficulty, name, source, target
        )
        SELECT 
          COALESCE((SELECT MAX(id) FROM ${this.stagingSchema}.ways_noded), 0) + ROW_NUMBER() OVER () AS id,
          COALESCE((SELECT MAX(old_id) FROM ${this.stagingSchema}.ways_noded), 0) + ROW_NUMBER() OVER () AS old_id,
          'connector_cached_' || source || '_' || target,
          geom,
          length_m / 1000.0,
          0, 0,
          'connector', 'unknown', 'unknown', 'Connector (cached)',
          source, target
        FROM filtered
      `;
      await this.pgClient.query(insertSql, [this.config.region]);
      await this.pgClient.query('COMMIT');
    } catch (e) {
      await this.pgClient.query('ROLLBACK');
      throw e;
    }
  }

  /**
   * Persist newly discovered connectors from staging back to master cache (public.connector_edges)
   */
  private async persistDiscoveredConnectors(): Promise<void> {
    await this.pgClient.query('BEGIN');
    try {
      // Ensure master table exists
      await this.pgClient.query(`
        CREATE TABLE IF NOT EXISTS public.connector_edges (
          id BIGSERIAL PRIMARY KEY,
          region TEXT NOT NULL,
          geom geometry(LineString, 4326) NOT NULL,
          start_pt geometry(Point, 4326) NOT NULL,
          end_pt geometry(Point, 4326) NOT NULL,
          length_m DOUBLE PRECISION NOT NULL,
          source TEXT DEFAULT 'refinement',
          notes TEXT,
          created_at TIMESTAMP DEFAULT now()
        );
      `);
      await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_connector_edges_geom ON public.connector_edges USING GIST(geom);`);

      // Upsert connectors generated this run (trail_type='connector')
      const upsertSql = `
        WITH connectors AS (
          SELECT the_geom AS geom
          FROM ${this.stagingSchema}.ways_noded
          WHERE COALESCE(trail_type, '') = 'connector'
        ),
        prepared AS (
          SELECT 
            geom,
            ST_StartPoint(geom) AS a,
            ST_EndPoint(geom) AS b,
            ST_Length(geom::geography) AS length_m
          FROM connectors
        )
        INSERT INTO public.connector_edges (region, geom, start_pt, end_pt, length_m, source)
        SELECT $1, geom, a, b, length_m, 'refinement'
        FROM prepared p
        ON CONFLICT DO NOTHING
      `;
      await this.pgClient.query(upsertSql, [this.config.region]);

      await this.pgClient.query('COMMIT');
    } catch (e) {
      await this.pgClient.query('ROLLBACK');
      throw e;
    }
  }
} 