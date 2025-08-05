import { Pool } from 'pg';
import { PgRoutingHelpers } from '../utils/pgrouting-helpers';
import { ExportService } from '../utils/export/export-service';
import { KspRouteGeneratorService } from '../utils/services/ksp-route-generator-service';
import { RouteSummaryService } from '../utils/services/route-summary-service';

export interface CarthorseOrchestratorConfig {
  region: string;
  bbox?: [number, number, number, number];
  outputPath: string;
  stagingSchema?: string;
  noCleanup?: boolean;
}

export class CarthorseOrchestrator {
  private pgClient: Pool;
  private config: CarthorseOrchestratorConfig;
  public readonly stagingSchema: string;

  constructor(config: CarthorseOrchestratorConfig) {
    this.config = config;
    this.stagingSchema = config.stagingSchema || `carthorse_${Date.now()}`;
    
    this.pgClient = new Pool({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'trail_master_db',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD,
      max: 20, // Maximum connections
      idleTimeoutMillis: 30000 // Close idle connections after 30s
    });
  }

  /**
   * Main entry point - generate KSP routes and export
   */
  async generateKspRoutes(): Promise<void> {
    console.log('🧭 Starting KSP route generation...');
    
    try {
      console.log('✅ Using connection pool');

      // Step 1: Create staging environment
      await this.createStagingEnvironment();

      // Step 2: Copy trail data with bbox filter
      await this.copyTrailData();

      // Step 3: Create pgRouting network
      await this.createPgRoutingNetwork();

      // Step 4: Add length and elevation columns
      await this.addLengthAndElevationColumns();

      // Step 5: Generate KSP routes using modular service
      await this.generateKspRoutesWithService();

      // Step 6: Generate summary
      await this.generateSummary();

      // Step 7: Export results
      await this.exportResults();

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
        max_elevation, min_elevation, avg_elevation
      )
      SELECT 
        app_uuid::text, name, trail_type, surface, difficulty,
        geometry, length_km, elevation_gain, elevation_loss,
        max_elevation, min_elevation, avg_elevation
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
   * Generate KSP routes using the modular service
   */
  private async generateKspRoutesWithService(): Promise<void> {
    console.log('🎯 Generating KSP routes using modular service...');
    
    const kspService = new KspRouteGeneratorService(this.pgClient, {
      stagingSchema: this.stagingSchema,
      region: this.config.region,
      targetRoutesPerPattern: 5,
      minDistanceBetweenRoutes: 2.0
    });

    const recommendations = await kspService.generateKspRoutes();
    await kspService.storeRouteRecommendations(recommendations);
  }

  /**
   * Generate summary using the summary service
   */
  private async generateSummary(): Promise<void> {
    console.log('📊 Generating route summary...');
    
    const summaryService = new RouteSummaryService(this.pgClient);
    const summary = await summaryService.generateRouteSummary(this.stagingSchema);
    
    console.log(`📊 Summary: ${summary.totalRoutes} routes generated`);
    console.log(`📊 Average distance: ${summary.averageDistance.toFixed(1)}km`);
    console.log(`📊 Average elevation: ${summary.averageElevation.toFixed(0)}m`);
    
    if (summary.totalRoutes > 0) {
      console.log('📋 Routes by pattern:');
      Object.entries(summary.routesByPattern).forEach(([pattern, count]) => {
        console.log(`  - ${pattern}: ${count} routes`);
      });
    }

    // Generate constituent trail analysis
    console.log('\n🔍 Generating constituent trail analysis...');
    const { ConstituentTrailAnalysisService } = await import('../utils/services/constituent-trail-analysis-service');
    const constituentService = new ConstituentTrailAnalysisService(this.pgClient);
    
    const analyses = await constituentService.analyzeAllRoutes(this.stagingSchema);
    
    if (analyses.length > 0) {
      console.log(`\n📊 CONSTITUENT TRAIL ANALYSIS SUMMARY:`);
      console.log(`Total routes analyzed: ${analyses.length}`);
      
      const avgTrailsPerRoute = analyses.reduce((sum, route) => sum + route.unique_trail_count, 0) / analyses.length;
      console.log(`Average trails per route: ${avgTrailsPerRoute.toFixed(1)}`);
      
      // Show top routes by unique trail count
      const topRoutes = analyses
        .sort((a, b) => b.unique_trail_count - a.unique_trail_count)
        .slice(0, 5);
      
      console.log(`\n🏆 Top 5 routes by trail diversity:`);
      topRoutes.forEach((route, index) => {
        console.log(`  ${index + 1}. ${route.route_name}`);
        console.log(`     Trails: ${route.unique_trail_count} unique trails`);
        console.log(`     Distance: ${route.out_and_back_distance_km.toFixed(2)}km`);
        console.log(`     Elevation: ${route.out_and_back_elevation_gain_m.toFixed(0)}m`);
      });
      
      // Export constituent analysis to JSON
      const outputPath = this.config.outputPath.replace(/\.[^.]+$/, '-constituent-analysis.json');
      await constituentService.exportConstituentAnalysis(analyses, outputPath);
    }
  }

  /**
   * Export results using the export service
   */
  private async exportResults(): Promise<void> {
    console.log('📤 Exporting results...');
    
    const exportService = new ExportService();
    
    // Determine format based on output file extension
    const outputPath = this.config.outputPath;
    const isGeoJSON = outputPath.toLowerCase().endsWith('.geojson');
    const format: 'geojson' | 'sqlite' = isGeoJSON ? 'geojson' : 'sqlite';
    
    console.log(`📤 Exporting to ${format.toUpperCase()} format: ${outputPath}`);
    
    const result = await exportService.export(
      format,
      this.pgClient,
      {
        outputPath,
        stagingSchema: this.stagingSchema
      }
    );
    
    if (result.success) {
      console.log(`✅ ${format.toUpperCase()} export completed: ${outputPath}`);
    } else {
      console.error(`❌ ${format.toUpperCase()} export failed: ${result.message}`);
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