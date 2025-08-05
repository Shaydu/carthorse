import { Pool } from 'pg';
import { PgRoutingHelpers } from '../utils/pgrouting-helpers';
import { RouteGenerationOrchestratorService } from '../utils/services/route-generation-orchestrator-service';
import { RouteAnalysisAndExportService } from '../utils/services/route-analysis-and-export-service';
import { RouteSummaryService } from '../utils/services/route-summary-service';
import { ConstituentTrailAnalysisService } from '../utils/services/constituent-trail-analysis-service';
import { ExportService } from '../utils/export/export-service';
import { getDatabasePoolConfig } from '../utils/config-loader';
import { validateDatabase } from '../utils/validation/database-validation-helpers';

export interface CarthorseOrchestratorConfig {
  region: string;
  bbox?: [number, number, number, number];
  outputPath: string;
  stagingSchema?: string;
  noCleanup?: boolean;
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

      // Step 4: Create pgRouting network
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
    } finally {
      if (!this.config.noCleanup) {
        await this.cleanup();
      }
      await this.pgClient.end();
    }
  }

  /**
   * Create staging environment
   */
  private async createStagingEnvironment(): Promise<void> {
    console.log(`📁 Creating staging schema: ${this.stagingSchema}`);
    
    // Drop existing schema if it exists
    await this.pgClient.query(`DROP SCHEMA IF EXISTS ${this.stagingSchema} CASCADE`);
    await this.pgClient.query(`CREATE SCHEMA ${this.stagingSchema}`);
    
    // Create trails table
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT,
        name TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        length_km REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        region TEXT,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        geometry GEOMETRY(LINESTRINGZ, 4326)
      )
    `);

    // Create route_recommendations table
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.route_recommendations (
        id SERIAL PRIMARY KEY,
        route_uuid TEXT UNIQUE NOT NULL,
        route_name TEXT NOT NULL,
        route_type TEXT,
        route_shape TEXT,
        input_distance_km REAL,
        input_elevation_gain REAL,
        recommended_distance_km REAL,
        recommended_elevation_gain REAL,
        route_path TEXT,
        route_edges TEXT,
        trail_count INTEGER,
        route_score REAL,
        similarity_score REAL,
        region TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

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
    
    const pgrouting = new PgRoutingHelpers({
      stagingSchema: this.stagingSchema,
      pgClient: this.pgClient
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
   * Generate all routes using the route generation orchestrator service
   */
  private async generateAllRoutesWithService(): Promise<void> {
    console.log('🎯 Generating all routes using route generation orchestrator service...');
    
    const routeGenerationService = new RouteGenerationOrchestratorService(this.pgClient, {
      stagingSchema: this.stagingSchema,
      region: this.config.region,
      targetRoutesPerPattern: 5,
      minDistanceBetweenRoutes: 2.0,
      generateKspRoutes: true,
      generateLoopRoutes: true,
      loopConfig: {
        useHawickCircuits: true,
        targetRoutesPerPattern: 3
      }
    });

    const result = await routeGenerationService.generateAllRoutes();
    console.log(`✅ Route generation completed: ${result.totalRoutes} total routes`);
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

  // Legacy compatibility methods
  async export(outputFormat: 'geojson' | 'sqlite' | 'trails-only' = 'sqlite'): Promise<void> {
    await this.generateKspRoutes();
  }

  async exportSqlite(): Promise<void> {
    await this.generateKspRoutes();
  }

  async exportGeoJSON(): Promise<void> {
    await this.generateKspRoutes();
  }
} 