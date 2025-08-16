import { Pool } from 'pg';
import { TrailProcessingService } from '../services/layer1/TrailProcessingService';
import { NodeEdgeProcessingService } from '../services/layer2/NodeEdgeProcessingService';
import { RouteGenerationService } from '../services/layer3/RouteGenerationService';
import { SQLiteExportStrategy } from '../utils/export/sqlite-export-strategy';
import { GeoJSONExportStrategy } from '../utils/export/geojson-export-strategy';
import * as fs from 'fs';
import * as path from 'path';

export interface LayeredOrchestratorConfig {
  region: string;
  outputPath: string;
  stagingSchema?: string;
  verbose?: boolean;
  skipValidation?: boolean;
  noCleanup?: boolean;
  generateKspRoutes?: boolean;
  generateLoopRoutes?: boolean;
  useTrailheadsOnly?: boolean;
  bbox?: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  sourceFilter?: string; // e.g., 'cotrex', 'osm', etc.
  exportConfig?: {
    includeNodes?: boolean;
    includeEdges?: boolean;
    includeRoutes?: boolean;
  };
  // Layer-specific configs
  layer1?: {
    usePgRoutingSplitting?: boolean;
    useTrailSplittingV2?: boolean;
    splittingMethod?: 'postgis' | 'pgrouting';
    enableGapFilling?: boolean;
    enableDeduplication?: boolean;
    enableIntersectionSplitting?: boolean;
  };
  layer2?: {
    enableChainMerging?: boolean;
    enableNetworkOptimization?: boolean;
  };
  layer3?: {
    targetRoutesPerPattern?: number;
    minDistanceBetweenRoutes?: number;
    kspKValue?: number;
    loopConfig?: {
      useHawickCircuits: boolean;
      targetRoutesPerPattern: number;
    };
  };
}

export interface LayeredOrchestratorResult {
  layer1: {
    success: boolean;
    trailsCopied: number;
    trailsProcessed: number;
    trailsSplit: number;
    gapsFixed: number;
    overlapsRemoved: number;
    errors?: string[];
  };
  layer2: {
    success: boolean;
    nodesCreated: number;
    edgesCreated: number;
    chainsMerged: number;
    connectivityMetrics: {
      totalNodes: number;
      totalEdges: number;
      isolatedNodes: number;
      avgDegree: number;
      maxDegree: number;
    };
    errors?: string[];
  };
  layer3: {
    success: boolean;
    totalRoutes: number;
    kspRoutes: number;
    loopRoutes: number;
    errors?: string[];
  };
  export: {
    success: boolean;
    format: string;
    fileSize: number;
    errors?: string[];
  };
  overallSuccess: boolean;
}

export class LayeredCarthorseOrchestrator {
  private pgClient: Pool;
  private stagingSchema: string;
  private config: LayeredOrchestratorConfig;

  constructor(config: LayeredOrchestratorConfig) {
    this.config = config;
    this.stagingSchema = config.stagingSchema || `staging_${Date.now()}`;
    
    this.pgClient = new Pool({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      user: 'carthorse',
      password: process.env.PGPASSWORD || 'your_password_here',
      database: 'trail_master_db'
    });
  }

  async export(outputFormat?: 'geojson' | 'sqlite' | 'trails-only'): Promise<LayeredOrchestratorResult> {
    const result: LayeredOrchestratorResult = {
      layer1: { success: false, trailsCopied: 0, trailsProcessed: 0, trailsSplit: 0, gapsFixed: 0, overlapsRemoved: 0 },
      layer2: { success: false, nodesCreated: 0, edgesCreated: 0, chainsMerged: 0, connectivityMetrics: { totalNodes: 0, totalEdges: 0, isolatedNodes: 0, avgDegree: 0, maxDegree: 0 } },
      layer3: { success: false, totalRoutes: 0, kspRoutes: 0, loopRoutes: 0 },
      export: { success: false, format: '', fileSize: 0 },
      overallSuccess: false
    };

    try {
      console.log('🚀 Starting Layered Carthorse export process...');
      console.log(`📋 Configuration:`);
      console.log(`   - Region: ${this.config.region}`);
      console.log(`   - Output: ${this.config.outputPath}`);
      console.log(`   - Staging schema: ${this.stagingSchema}`);
      console.log(`   - Verbose: ${this.config.verbose || false}`);

      // Layer 1: Trail Processing
      console.log('\n🛤️ LAYER 1: TRAIL PROCESSING');
      const layer1Result = await this.processLayer1();
      result.layer1 = layer1Result;
      
      if (!layer1Result.success) {
        throw new Error(`Layer 1 failed: ${layer1Result.errors?.join(', ')}`);
      }

      // Layer 2: Node/Edge Processing
      console.log('\n🛤️ LAYER 2: NODE/EDGE PROCESSING');
      const layer2Result = await this.processLayer2();
      result.layer2 = layer2Result;
      
      if (!layer2Result.success) {
        throw new Error(`Layer 2 failed: ${layer2Result.errors?.join(', ')}`);
      }

      // Layer 3: Route Generation (optional)
      console.log('\n🎯 LAYER 3: ROUTE GENERATION');
      const layer3Result = await this.processLayer3();
      result.layer3 = layer3Result;
      
      // Export using detected format
      console.log('\n📤 EXPORT');
      const detectedFormat = this.determineOutputFormat(outputFormat);
      const exportResult = await this.exportUsingStrategy(detectedFormat);
      result.export = exportResult;

      result.overallSuccess = true;
      console.log('\n✅ Layered export process completed successfully!');

    } catch (error) {
      console.error('❌ Layered export process failed:', error);
      result.overallSuccess = false;
    } finally {
      // Cleanup
      if (!this.config.noCleanup) {
        await this.cleanup();
      }
      await this.endConnection();
    }

    return result;
  }

  /**
   * Process Layer 1: Trail processing
   */
  private async processLayer1(): Promise<LayeredOrchestratorResult['layer1']> {
    const layer1Config = {
      stagingSchema: this.stagingSchema,
      pgClient: this.pgClient,
      region: this.config.region,
      bbox: this.config.bbox,
      sourceFilter: this.config.sourceFilter,
      // useSplitTrails removed - trail splitting is always enabled
      usePgRoutingSplitting: this.config.layer1?.usePgRoutingSplitting,
      useTrailSplittingV2: this.config.layer1?.useTrailSplittingV2,
      splittingMethod: this.config.layer1?.splittingMethod,
      enableGapFilling: this.config.layer1?.enableGapFilling,
      enableDeduplication: this.config.layer1?.enableDeduplication,
      enableIntersectionSplitting: this.config.layer1?.enableIntersectionSplitting
    };

          const layer1Service = new TrailProcessingService(layer1Config);
    const layer1Result = await layer1Service.processTrails();

    return {
      success: true, // TrailProcessingService doesn't return success, assume success if no exception
      trailsCopied: layer1Result.trailsCopied,
      trailsProcessed: layer1Result.trailsCleaned, // Map trailsCleaned to trailsProcessed
      trailsSplit: layer1Result.trailsSplit,
      gapsFixed: layer1Result.gapsFixed,
      overlapsRemoved: layer1Result.overlapsRemoved,
      errors: [] // TrailProcessingService doesn't return errors array
    };
  }

  /**
   * Process Layer 2: Node/Edge processing
   */
  private async processLayer2(): Promise<LayeredOrchestratorResult['layer2']> {
    const layer2Config = {
      stagingSchema: this.stagingSchema,
      pgClient: this.pgClient,
      region: this.config.region,
      enableChainMerging: this.config.layer2?.enableChainMerging,
      enableNetworkOptimization: this.config.layer2?.enableNetworkOptimization
    };

    const layer2Service = new NodeEdgeProcessingService(layer2Config);
    const layer2Result = await layer2Service.processNodesAndEdges();

    return {
      success: layer2Result.success,
      nodesCreated: layer2Result.nodesCreated,
      edgesCreated: layer2Result.edgesCreated,
      chainsMerged: layer2Result.chainsMerged,
      connectivityMetrics: layer2Result.connectivityMetrics,
      errors: layer2Result.errors
    };
  }

  /**
   * Process Layer 3: Route generation
   */
  private async processLayer3(): Promise<LayeredOrchestratorResult['layer3']> {
    const layer3Config = {
      stagingSchema: this.stagingSchema,
      pgClient: this.pgClient,
      region: this.config.region,
      generateKspRoutes: this.config.generateKspRoutes,
      generateLoopRoutes: this.config.generateLoopRoutes,
      useTrailheadsOnly: this.config.useTrailheadsOnly,
      targetRoutesPerPattern: this.config.layer3?.targetRoutesPerPattern,
      minDistanceBetweenRoutes: this.config.layer3?.minDistanceBetweenRoutes,
      kspKValue: this.config.layer3?.kspKValue,
      loopConfig: this.config.layer3?.loopConfig
    };

    const layer3Service = new RouteGenerationService(layer3Config);
    const layer3Result = await layer3Service.processRoutes();

    return {
      success: layer3Result.success,
      totalRoutes: layer3Result.totalRoutes,
      kspRoutes: layer3Result.kspRoutes.length,
      loopRoutes: layer3Result.loopRoutes.length,
      errors: layer3Result.errors
    };
  }

  /**
   * Determine output format
   */
  private determineOutputFormat(explicitFormat?: 'geojson' | 'sqlite' | 'trails-only'): 'geojson' | 'sqlite' | 'trails-only' {
    if (explicitFormat) {
      return explicitFormat;
    }

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

  /**
   * Export using the appropriate strategy
   */
  private async exportUsingStrategy(format: 'geojson' | 'sqlite' | 'trails-only'): Promise<LayeredOrchestratorResult['export']> {
    console.log(`📤 Exporting using ${format} strategy...`);

    const poolClient = await this.pgClient.connect();

    try {
      switch (format) {
        case 'sqlite':
          return await this.exportToSqlite(poolClient);
        case 'geojson':
          return await this.exportToGeoJSON(poolClient);
        case 'trails-only':
          return await this.exportTrailsOnly(poolClient);
        default:
          throw new Error(`Unsupported export format: ${format}`);
      }
    } finally {
      poolClient.release();
    }
  }

  /**
   * Export to SQLite
   */
  private async exportToSqlite(poolClient: any): Promise<LayeredOrchestratorResult['export']> {
    console.log('📤 Exporting to SQLite...');

    const sqliteConfig = {
      region: this.config.region,
      outputPath: this.config.outputPath,
      includeTrails: true,
      includeNodes: this.config.exportConfig?.includeNodes || false,
      includeEdges: this.config.exportConfig?.includeEdges || false,
      includeRecommendations: this.config.exportConfig?.includeRoutes !== false,
      verbose: this.config.verbose
    };

    const sqliteExporter = new SQLiteExportStrategy(poolClient, sqliteConfig, this.stagingSchema);
    const result = await sqliteExporter.exportFromStaging();

    if (!result.isValid) {
      return {
        success: false,
        format: 'sqlite',
        fileSize: 0,
        errors: result.errors
      };
    }

    if (!fs.existsSync(this.config.outputPath)) {
      return {
        success: false,
        format: 'sqlite',
        fileSize: 0,
        errors: ['SQLite export file was not created']
      };
    }

    const stats = fs.statSync(this.config.outputPath);
    console.log(`✅ SQLite export completed successfully: ${this.config.outputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

    return {
      success: true,
      format: 'sqlite',
      fileSize: stats.size,
      errors: []
    };
  }

  /**
   * Export to GeoJSON
   */
  private async exportToGeoJSON(poolClient: any): Promise<LayeredOrchestratorResult['export']> {
    console.log('📤 Exporting to GeoJSON...');

    const geojsonConfig = {
      region: this.config.region,
      outputPath: this.config.outputPath,
      bbox: this.config.bbox ? `${this.config.bbox[0]},${this.config.bbox[1]},${this.config.bbox[2]},${this.config.bbox[3]}` : undefined,
      includeTrails: true,
      includeNodes: this.config.exportConfig?.includeNodes || false,
      includeEdges: this.config.exportConfig?.includeEdges || false,
      includeRecommendations: this.config.exportConfig?.includeRoutes !== false,
      verbose: this.config.verbose
    };

    const geojsonExporter = new GeoJSONExportStrategy(poolClient, geojsonConfig, this.stagingSchema);
    await geojsonExporter.exportFromStaging();

    if (!fs.existsSync(this.config.outputPath)) {
      return {
        success: false,
        format: 'geojson',
        fileSize: 0,
        errors: ['GeoJSON export file was not created']
      };
    }

    const stats = fs.statSync(this.config.outputPath);
    console.log(`✅ GeoJSON export completed successfully: ${this.config.outputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

    // Verify file is valid JSON
    try {
      const content = fs.readFileSync(this.config.outputPath, 'utf8');
      JSON.parse(content);
      console.log('✅ GeoJSON file is valid JSON');
    } catch (error) {
      console.warn('⚠️ GeoJSON file may not be valid JSON');
    }

    return {
      success: true,
      format: 'geojson',
      fileSize: stats.size,
      errors: []
    };
  }

  /**
   * Export trails only
   */
  private async exportTrailsOnly(poolClient: any): Promise<LayeredOrchestratorResult['export']> {
    console.log('📤 Exporting trails only...');

    const geojsonConfig = {
      region: this.config.region,
      outputPath: this.config.outputPath,
      includeTrails: true,
      includeNodes: false,
      includeEdges: false,
      includeRecommendations: false,
      verbose: this.config.verbose
    };

    const geojsonExporter = new GeoJSONExportStrategy(poolClient, geojsonConfig, this.stagingSchema);
    await geojsonExporter.exportFromStaging();

    if (!fs.existsSync(this.config.outputPath)) {
      return {
        success: false,
        format: 'trails-only',
        fileSize: 0,
        errors: ['Trails-only export file was not created']
      };
    }

    const stats = fs.statSync(this.config.outputPath);
    console.log(`✅ Trails-only export completed successfully: ${this.config.outputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

    return {
      success: true,
      format: 'trails-only',
      fileSize: stats.size,
      errors: []
    };
  }

  /**
   * Cleanup staging environment
   */
  private async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up staging environment...');
    
    try {
      await this.pgClient.query(`DROP SCHEMA IF EXISTS ${this.stagingSchema} CASCADE`);
    } catch (error) {
      console.warn('⚠️ Failed to drop staging schema:', error);
    }

    console.log('✅ Cleanup completed');
  }

  /**
   * End database connection
   */
  private async endConnection(): Promise<void> {
    try {
      if (this.pgClient && !this.pgClient.ended) {
        await this.pgClient.end();
        console.log('✅ Database connection closed');
      }
    } catch (error) {
      console.warn('⚠️ Failed to close database connection:', error);
    }
  }
}
