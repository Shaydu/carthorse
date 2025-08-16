import { Pool } from 'pg';
import { TrailProcessingService } from './TrailProcessingService';
import { TrailSplittingService2 } from './ImprovedTrailSplittingService';
import { PgRoutingSeparateTouchingService } from './PgRoutingSeparateTouchingService';

export interface TrailProcessingOrchestratorConfig {
  stagingSchema: string;
  pgClient: Pool;
  region: string;
  bbox?: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  sourceFilter?: string; // e.g., 'cotrex', 'osm', etc.
  useSplitTrails?: boolean;
  usePgRoutingSplitting?: boolean;
  useTrailSplittingV2?: boolean;
  splittingMethod?: 'postgis' | 'pgrouting';
  enableGapFilling?: boolean;
  enableDeduplication?: boolean;
  enableIntersectionSplitting?: boolean;
}

export interface TrailProcessingOrchestratorResult {
  trailsCopied: number;
  trailsProcessed: number;
  trailsSplit: number;
  gapsFixed: number;
  overlapsRemoved: number;
  connectivityMetrics?: any;
  success: boolean;
  errors?: string[];
}

export class TrailProcessingOrchestratorService {
  private stagingSchema: string;
  private pgClient: Pool;
  private config: TrailProcessingOrchestratorConfig;

  constructor(config: TrailProcessingOrchestratorConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
    this.config = config;
  }

  /**
   * Process Layer 1: Complete trail processing pipeline
   */
  async processTrails(): Promise<TrailProcessingOrchestratorResult> {
    console.log('🛤️ LAYER 1: TRAILS - Complete trail processing pipeline...');
    
    const result: TrailProcessingOrchestratorResult = {
      trailsCopied: 0,
      trailsProcessed: 0,
      trailsSplit: 0,
      gapsFixed: 0,
      overlapsRemoved: 0,
      success: false,
      errors: []
    };

    try {
      // Step 1: Create staging environment
      await this.createStagingEnvironment();
      
      // Step 2: Copy trails from production with filters
      result.trailsCopied = await this.copyTrailsFromProduction();
      
      // Step 3: Process trails using the comprehensive TrailProcessingService
      const processingResult = await this.processTrailsComprehensive();
      result.trailsProcessed = processingResult.trailsCleaned;
      result.trailsSplit = processingResult.trailsSplit;
      result.gapsFixed = processingResult.gapsFixed;
      result.overlapsRemoved = processingResult.overlapsRemoved;
      result.connectivityMetrics = processingResult.connectivityMetrics;
      
      result.success = true;
      
      console.log('✅ LAYER 1 COMPLETE: Clean trail network ready for Layer 2');
      console.log(`📊 Layer 1 Results: ${result.trailsCopied} trails copied, ${result.trailsProcessed} processed, ${result.trailsSplit} split, ${result.gapsFixed} gaps fixed, ${result.overlapsRemoved} overlaps removed`);
      
    } catch (error) {
      console.error('❌ Layer 1 failed:', error);
      result.errors = [error instanceof Error ? error.message : String(error)];
      result.success = false;
    }

    return result;
  }

  /**
   * Create staging environment
   */
  private async createStagingEnvironment(): Promise<void> {
    console.log(`🏗️ Creating staging environment: ${this.stagingSchema}`);
    
    await this.pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${this.stagingSchema}`);
    console.log(`✅ Staging schema created: ${this.stagingSchema}`);
  }

  /**
   * Copy trails from production with filters
   */
  private async copyTrailsFromProduction(): Promise<number> {
    console.log('📋 Copying trails from production...');
    
    // Build the WHERE clause with all applicable filters
    const conditions: string[] = [`region = $1`];
    const params: any[] = [this.config.region];
    let paramIndex = 2;
    
    // Add source filter if specified
    if (this.config.sourceFilter) {
      conditions.push(`source = $${paramIndex}`);
      params.push(this.config.sourceFilter);
      console.log(`🔍 Applying source filter: ${this.config.sourceFilter}`);
      paramIndex++;
    }
    
    // Add bbox filter if specified
    if (this.config.bbox) {
      const [minLng, minLat, maxLng, maxLat] = this.config.bbox;
      conditions.push(`ST_Intersects(geometry, ST_MakeEnvelope($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, 4326))`);
      params.push(minLng, minLat, maxLng, maxLat);
      console.log(`📍 Applying bbox filter: [${minLng}, ${minLat}, ${maxLng}, ${maxLat}]`);
      paramIndex += 4;
    }
    
    const whereClause = conditions.join(' AND ');
    console.log(`🔍 WHERE clause: ${whereClause}`);
    
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.trails AS 
      SELECT * FROM public.trails 
      WHERE ${whereClause}
    `, params);

    const result = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
    `);
    
    const trailCount = parseInt(result.rows[0].count);
    console.log(`✅ Copied ${trailCount} trails from production`);
    
    return trailCount;
  }

  /**
   * Process trails using comprehensive TrailProcessingService
   */
  private async processTrailsComprehensive(): Promise<{
    trailsCleaned: number;
    trailsSplit: number;
    gapsFixed: number;
    overlapsRemoved: number;
    connectivityMetrics?: any;
  }> {
    console.log('🔧 Processing trails with comprehensive service...');
    
    const trailProcessingConfig = {
      stagingSchema: this.stagingSchema,
      pgClient: this.pgClient,
      region: this.config.region,
      bbox: this.config.bbox,
      sourceFilter: this.config.sourceFilter,
      usePgRoutingSplitting: this.config.usePgRoutingSplitting,
      useTrailSplittingV2: this.config.useTrailSplittingV2,
      splittingMethod: this.config.splittingMethod
    };

    const trailService = new TrailProcessingService(trailProcessingConfig);
    const processingResult = await trailService.processTrails();
    
    return {
      trailsCleaned: processingResult.trailsCleaned,
      trailsSplit: processingResult.trailsSplit,
      gapsFixed: processingResult.gapsFixed,
      overlapsRemoved: processingResult.overlapsRemoved,
      connectivityMetrics: processingResult.connectivityMetrics
    };
  }

  /**
   * Get trail statistics for validation
   */
  async getTrailStatistics(): Promise<{
    totalTrails: number;
    totalLength: number;
    avgLength: number;
    sourceBreakdown: Record<string, number>;
  }> {
    const stats = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        SUM(ST_Length(ST_Transform(geometry, 3857)) / 1000) as total_length_km,
        AVG(ST_Length(ST_Transform(geometry, 3857)) / 1000) as avg_length_km
      FROM ${this.stagingSchema}.trails
    `);

    const sourceBreakdown = await this.pgClient.query(`
      SELECT 
        source,
        COUNT(*) as count
      FROM ${this.stagingSchema}.trails
      GROUP BY source
      ORDER BY count DESC
    `);

    const breakdown: Record<string, number> = {};
    sourceBreakdown.rows.forEach(row => {
      breakdown[row.source] = parseInt(row.count);
    });

    return {
      totalTrails: parseInt(stats.rows[0].total_trails),
      totalLength: parseFloat(stats.rows[0].total_length_km || '0'),
      avgLength: parseFloat(stats.rows[0].avg_length_km || '0'),
      sourceBreakdown: breakdown
    };
  }

  /**
   * Validate Layer 1 output is ready for Layer 2
   */
  async validateLayer1Output(): Promise<{
    isValid: boolean;
    issues: string[];
    statistics: {
      totalTrails: number;
      validGeometries: number;
      invalidGeometries: number;
    };
  }> {
    console.log('🔍 Validating Layer 1 output...');
    
    const validation = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN ST_IsValid(geometry) THEN 1 END) as valid_geometries,
        COUNT(CASE WHEN NOT ST_IsValid(geometry) THEN 1 END) as invalid_geometries
      FROM ${this.stagingSchema}.trails
    `);

    const stats = validation.rows[0];
    const issues: string[] = [];
    
    if (parseInt(stats.total_trails) === 0) {
      issues.push('No trails found in staging schema');
    }
    
    if (parseInt(stats.invalid_geometries) > 0) {
      issues.push(`${stats.invalid_geometries} trails have invalid geometries`);
    }

    const isValid = issues.length === 0;
    
    console.log(`✅ Layer 1 validation: ${isValid ? 'PASSED' : 'FAILED'}`);
    if (issues.length > 0) {
      console.log(`❌ Issues found: ${issues.join(', ')}`);
    }
    
    return {
      isValid,
      issues,
      statistics: {
        totalTrails: parseInt(stats.total_trails),
        validGeometries: parseInt(stats.valid_geometries),
        invalidGeometries: parseInt(stats.invalid_geometries)
      }
    };
  }
}
