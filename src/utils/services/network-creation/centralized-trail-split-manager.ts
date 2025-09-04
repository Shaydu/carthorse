import { Pool } from 'pg';
import { TransactionalTrailSplitter, TrailSplitConfig, TrailSplitOperation, TrailSplitResult } from './transactional-trail-splitter';

// Re-export TrailSplitOperation for use by other services
export { TrailSplitOperation, TrailSplitResult } from './transactional-trail-splitter';
import { TrailSplitValidation } from '../../validation/trail-split-validation';
import { GeometryTrackingSystem, GeometryRecord, GeometryValidationResult } from './geometry-tracking-system';

export interface CentralizedSplitConfig {
  stagingSchema: string;
  intersectionToleranceMeters: number;
  minSegmentLengthMeters: number;
  preserveOriginalTrailNames: boolean;
  validationToleranceMeters: number;
  validationTolerancePercentage: number;
}

export interface SplitOperationLog {
  operationId: string;
  timestamp: Date;
  serviceName: string;
  operationType: 'split' | 'snap' | 'merge' | 'delete';
  originalTrailId: string;
  originalTrailName: string;
  result: TrailSplitResult;
  metadata?: any;
}

export interface SplitManagerStats {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  totalTrailsSplit: number;
  totalSegmentsCreated: number;
  totalLengthDifferenceKm: number;
  averageLengthDifferencePercentage: number;
  operationsByService: Record<string, number>;
  operationsByType: Record<string, number>;
}

/**
 * Centralized manager for all trail splitting operations across all services
 * Ensures atomic operations with proper validation and comprehensive logging
 */
export class CentralizedTrailSplitManager {
  private static instance: CentralizedTrailSplitManager;
  private pgClient: Pool;
  private config: CentralizedSplitConfig;
  private transactionalSplitter: TransactionalTrailSplitter;
  private geometryTracker: GeometryTrackingSystem;
  private operationLogs: SplitOperationLog[] = [];
  private stats: SplitManagerStats = {
    totalOperations: 0,
    successfulOperations: 0,
    failedOperations: 0,
    totalTrailsSplit: 0,
    totalSegmentsCreated: 0,
    totalLengthDifferenceKm: 0,
    averageLengthDifferencePercentage: 0,
    operationsByService: {},
    operationsByType: {}
  };

  private constructor(pgClient: Pool, config: CentralizedSplitConfig) {
    this.pgClient = pgClient;
    this.config = config;
    
    const trailSplitConfig: TrailSplitConfig = {
      stagingSchema: config.stagingSchema,
      intersectionToleranceMeters: config.intersectionToleranceMeters,
      minSegmentLengthMeters: config.minSegmentLengthMeters,
      preserveOriginalTrailNames: config.preserveOriginalTrailNames,
      validationToleranceMeters: config.validationToleranceMeters,
      validationTolerancePercentage: config.validationTolerancePercentage
    };
    
    this.transactionalSplitter = new TransactionalTrailSplitter(pgClient, trailSplitConfig);
    this.geometryTracker = GeometryTrackingSystem.getInstance(pgClient, config.stagingSchema);
  }

  /**
   * Get singleton instance of the centralized split manager
   */
  static getInstance(pgClient?: Pool, config?: CentralizedSplitConfig): CentralizedTrailSplitManager {
    if (!CentralizedTrailSplitManager.instance) {
      if (!pgClient || !config) {
        throw new Error('CentralizedTrailSplitManager must be initialized with pgClient and config on first call');
      }
      CentralizedTrailSplitManager.instance = new CentralizedTrailSplitManager(pgClient, config);
    }
    return CentralizedTrailSplitManager.instance;
  }

  /**
   * Split a single trail atomically with comprehensive logging
   */
  async splitTrailAtomically(
    operation: TrailSplitOperation,
    serviceName: string,
    operationType: 'split' | 'snap' | 'merge' = 'split',
    metadata?: any
  ): Promise<TrailSplitResult> {
    const operationId = this.generateOperationId();
    const timestamp = new Date();
    
    console.log(`🔄 [${serviceName}] Starting atomic split operation ${operationId} for trail "${operation.originalTrailName}"`);
    console.log(`   📍 Split points: ${operation.splitPoints.length}`);
    console.log(`   📏 Original length: ${operation.originalLengthKm.toFixed(3)}km`);
    
    try {
      // Execute the atomic split
      const result = await this.transactionalSplitter.splitTrailAtomically(operation);
      
      // Log the operation
      const logEntry: SplitOperationLog = {
        operationId,
        timestamp,
        serviceName,
        operationType,
        originalTrailId: operation.originalTrailId,
        originalTrailName: operation.originalTrailName,
        result,
        metadata
      };
      
      this.operationLogs.push(logEntry);
      this.updateStats(logEntry);
      
      if (result.success) {
        console.log(`✅ [${serviceName}] Atomic split operation ${operationId} completed successfully`);
        console.log(`   📊 Segments created: ${result.segmentsCreated}`);
        console.log(`   📏 Length validation: ${result.originalLengthKm.toFixed(3)}km → ${result.totalLengthKm.toFixed(3)}km (diff: ${result.lengthDifferenceKm.toFixed(3)}km, ${result.lengthDifferencePercentage.toFixed(2)}%)`);
      } else {
        console.error(`❌ [${serviceName}] Atomic split operation ${operationId} failed: ${result.error}`);
      }
      
      return result;
      
    } catch (error) {
      const errorResult: TrailSplitResult = {
        success: false,
        originalTrailId: operation.originalTrailId,
        originalTrailName: operation.originalTrailName,
        segmentsCreated: 0,
        totalLengthKm: 0,
        originalLengthKm: operation.originalLengthKm,
        lengthDifferenceKm: 0,
        lengthDifferencePercentage: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      
      const logEntry: SplitOperationLog = {
        operationId,
        timestamp,
        serviceName,
        operationType,
        originalTrailId: operation.originalTrailId,
        originalTrailName: operation.originalTrailName,
        result: errorResult,
        metadata
      };
      
      this.operationLogs.push(logEntry);
      this.updateStats(logEntry);
      
      console.error(`❌ [${serviceName}] Atomic split operation ${operationId} failed with exception:`, error);
      return errorResult;
    }
  }

  /**
   * Split multiple trails atomically with comprehensive logging
   */
  async splitMultipleTrailsAtomically(
    operations: TrailSplitOperation[],
    serviceName: string,
    operationType: 'split' | 'snap' | 'merge' = 'split',
    metadata?: any
  ): Promise<TrailSplitResult[]> {
    console.log(`🔄 [${serviceName}] Starting batch atomic split of ${operations.length} trails`);
    
    const results: TrailSplitResult[] = [];
    
    for (const operation of operations) {
      const result = await this.splitTrailAtomically(operation, serviceName, operationType, metadata);
      results.push(result);
    }
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`📊 [${serviceName}] Batch atomic split completed: ${successful} successful, ${failed} failed`);
    
    return results;
  }

  /**
   * Log a non-split operation (snap, merge, delete) for comprehensive tracking
   */
  async logOperation(
    serviceName: string,
    operationType: 'snap' | 'merge' | 'delete',
    originalTrailId: string,
    originalTrailName: string,
    success: boolean,
    segmentsCreated: number = 0,
    error?: string,
    metadata?: any
  ): Promise<void> {
    const operationId = this.generateOperationId();
    const timestamp = new Date();
    
    const result: TrailSplitResult = {
      success,
      originalTrailId,
      originalTrailName,
      segmentsCreated,
      totalLengthKm: 0,
      originalLengthKm: 0,
      lengthDifferenceKm: 0,
      lengthDifferencePercentage: 0,
      error
    };
    
    const logEntry: SplitOperationLog = {
      operationId,
      timestamp,
      serviceName,
      operationType,
      originalTrailId,
      originalTrailName,
      result,
      metadata
    };
    
    this.operationLogs.push(logEntry);
    this.updateStats(logEntry);
    
    if (success) {
      console.log(`✅ [${serviceName}] ${operationType} operation ${operationId} completed for trail "${originalTrailName}"`);
    } else {
      console.error(`❌ [${serviceName}] ${operationType} operation ${operationId} failed for trail "${originalTrailName}": ${error}`);
    }
  }

  /**
   * Get comprehensive statistics about all operations
   */
  getStats(): SplitManagerStats {
    return { ...this.stats };
  }

  /**
   * Get detailed operation logs
   */
  getOperationLogs(): SplitOperationLog[] {
    return [...this.operationLogs];
  }

  /**
   * Get operation logs filtered by service
   */
  getOperationLogsByService(serviceName: string): SplitOperationLog[] {
    return this.operationLogs.filter(log => log.serviceName === serviceName);
  }

  /**
   * Get operation logs filtered by operation type
   */
  getOperationLogsByType(operationType: string): SplitOperationLog[] {
    return this.operationLogs.filter(log => log.operationType === operationType);
  }

  /**
   * Get failed operations for debugging
   */
  getFailedOperations(): SplitOperationLog[] {
    return this.operationLogs.filter(log => !log.result.success);
  }

  /**
   * Generate a unique operation ID
   */
  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update statistics based on operation result
   */
  private updateStats(logEntry: SplitOperationLog): void {
    this.stats.totalOperations++;
    
    if (logEntry.result.success) {
      this.stats.successfulOperations++;
      this.stats.totalTrailsSplit++;
      this.stats.totalSegmentsCreated += logEntry.result.segmentsCreated;
      this.stats.totalLengthDifferenceKm += logEntry.result.lengthDifferenceKm;
    } else {
      this.stats.failedOperations++;
    }
    
    // Update service stats
    if (!this.stats.operationsByService[logEntry.serviceName]) {
      this.stats.operationsByService[logEntry.serviceName] = 0;
    }
    this.stats.operationsByService[logEntry.serviceName]++;
    
    // Update operation type stats
    if (!this.stats.operationsByType[logEntry.operationType]) {
      this.stats.operationsByType[logEntry.operationType] = 0;
    }
    this.stats.operationsByType[logEntry.operationType]++;
    
    // Calculate average length difference percentage
    if (this.stats.successfulOperations > 0) {
      this.stats.averageLengthDifferencePercentage = 
        this.stats.totalLengthDifferenceKm / this.stats.successfulOperations;
    }
  }

  /**
   * Print comprehensive summary of all operations
   */
  printSummary(): void {
    console.log('\n📊 CENTRALIZED TRAIL SPLIT MANAGER SUMMARY');
    console.log('=' .repeat(50));
    console.log(`Total Operations: ${this.stats.totalOperations}`);
    console.log(`Successful: ${this.stats.successfulOperations}`);
    console.log(`Failed: ${this.stats.failedOperations}`);
    console.log(`Success Rate: ${((this.stats.successfulOperations / this.stats.totalOperations) * 100).toFixed(1)}%`);
    console.log(`Total Trails Split: ${this.stats.totalTrailsSplit}`);
    console.log(`Total Segments Created: ${this.stats.totalSegmentsCreated}`);
    console.log(`Total Length Difference: ${this.stats.totalLengthDifferenceKm.toFixed(3)}km`);
    console.log(`Average Length Difference: ${this.stats.averageLengthDifferencePercentage.toFixed(3)}km`);
    
    console.log('\n📈 Operations by Service:');
    Object.entries(this.stats.operationsByService).forEach(([service, count]) => {
      console.log(`  ${service}: ${count}`);
    });
    
    console.log('\n🔧 Operations by Type:');
    Object.entries(this.stats.operationsByType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
    
    if (this.stats.failedOperations > 0) {
      console.log('\n❌ Failed Operations:');
      this.getFailedOperations().forEach(log => {
        console.log(`  [${log.serviceName}] ${log.operationType}: "${log.originalTrailName}" - ${log.result.error}`);
      });
    }
    
    console.log('=' .repeat(50));
  }

  /**
   * Insert a trail with automatic original_trail_uuid setting for validation tracking
   */
  async insertTrail(
    trailData: {
      app_uuid?: string;
      name: string;
      geometry: any;
      trail_type?: string;
      surface?: string;
      difficulty?: string;
      elevation_gain?: number;
      elevation_loss?: number;
      max_elevation?: number;
      min_elevation?: number;
      avg_elevation?: number;
      source?: string;
      source_tags?: any;
      osm_id?: string;
      bbox_min_lng?: number;
      bbox_max_lng?: number;
      bbox_min_lat?: number;
      bbox_max_lat?: number;
      length_km?: number;
      original_trail_uuid?: string;
    },
    serviceName: string = 'Unknown',
    isReplacementTrail: boolean = false,
    originalTrailId?: string
  ): Promise<string> {
    // Debug logging for Shadow Canyon Trail
    if (trailData.name.includes('Shadow Canyon') || trailData.original_trail_uuid === 'e393e414-b14f-46a1-9734-e6e582c602ac') {
      console.log(`🔍 DEBUG: CentralizedTrailSplitManager.insertTrail called for Shadow Canyon Trail:`);
      console.log(`   - Name: ${trailData.name}`);
      console.log(`   - Original UUID: ${trailData.original_trail_uuid}`);
      console.log(`   - Service: ${serviceName}`);
      console.log(`   - Is Replacement: ${isReplacementTrail}`);
      console.log(`   - Original Trail ID: ${originalTrailId}`);
    }
    const client = await this.pgClient.connect();
    
    try {
      // Generate UUID if not provided
      const app_uuid = trailData.app_uuid || (await client.query('SELECT gen_random_uuid() as uuid')).rows[0].uuid;
      
      // Always recalculate length from geometry to ensure accuracy
      const lengthResult = await client.query('SELECT ST_Length($1::geography) / 1000.0 as length_km', [trailData.geometry]);
      const length_km = lengthResult.rows[0].length_km;

      // Set original_trail_uuid for validation tracking
      const original_trail_uuid = trailData.original_trail_uuid || (isReplacementTrail && originalTrailId ? originalTrailId : null);

      // Insert the trail with all required fields
      await client.query(`
        INSERT INTO ${this.config.stagingSchema}.trails (
          app_uuid, original_trail_uuid, name, trail_type, surface, difficulty,
          geometry, length_km, elevation_gain, elevation_loss,
          max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      `, [
        app_uuid,
        original_trail_uuid,
        trailData.name,
        trailData.trail_type || 'unknown',
        trailData.surface || 'unknown',
        trailData.difficulty || 'unknown',
        trailData.geometry,
        length_km,
        trailData.elevation_gain || 0,
        trailData.elevation_loss || 0,
        trailData.max_elevation || 0,
        trailData.min_elevation || 0,
        trailData.avg_elevation || 0,
        trailData.bbox_min_lng || 0,
        trailData.bbox_max_lng || 0,
        trailData.bbox_min_lat || 0,
        trailData.bbox_max_lat || 0,
        trailData.source || 'unknown',
        trailData.source_tags || null,
        trailData.osm_id || null
      ]);

      // Record geometry insertion for tracking
      await this.geometryTracker.recordGeometryInsertion(
        app_uuid,
        trailData.name,
        trailData.geometry,
        serviceName,
        original_trail_uuid || undefined,
        {
          isReplacementTrail,
          originalTrailId,
          lengthKm: length_km
        }
      );

      // Log the insertion
      this.logOperation(
        serviceName,
        'insert' as any, // insert is not in the union type, but we need it
        original_trail_uuid || app_uuid,
        trailData.name,
        true, // success
        1, // segmentsCreated
        undefined, // error
        {
          isReplacementTrail,
          originalTrailId,
          lengthKm: length_km
        }
      );

      return app_uuid;

    } finally {
      client.release();
    }
  }

  /**
   * Validate geometry integrity and throw error if any geometries are missing or mismatched
   * This should be called after all splitting operations to ensure no data loss
   */
  async validateGeometryIntegrity(): Promise<void> {
    const validation = await this.geometryTracker.validateGeometryIntegrity();
    
    if (!validation.isValid) {
      // Print detailed report
      await this.geometryTracker.printGeometryReport();
      
      // Throw comprehensive error with all issues
      const errorMessage = [
        'GEOMETRY INTEGRITY VALIDATION FAILED!',
        '',
        'The following issues were found:',
        ...validation.errors.map((error, index) => `${index + 1}. ${error}`),
        '',
        'This indicates that some trail geometries were deleted but not properly replaced.',
        'The transaction should be rolled back to prevent data loss.'
      ].join('\n');
      
      throw new Error(errorMessage);
    }
    
    console.log('✅ Geometry integrity validation passed - all deleted geometries have proper replacements');
  }

  /**
   * Get geometry tracking summary
   */
  async getGeometrySummary() {
    return await this.geometryTracker.getGeometrySummary();
  }

  /**
   * Print detailed geometry tracking report
   */
  async printGeometryReport(): Promise<void> {
    await this.geometryTracker.printGeometryReport();
  }

  /**
   * Reset all logs and statistics (useful for testing)
   */
  reset(): void {
    this.operationLogs = [];
    this.geometryTracker.reset();
    this.stats = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      totalTrailsSplit: 0,
      totalSegmentsCreated: 0,
      totalLengthDifferenceKm: 0,
      averageLengthDifferencePercentage: 0,
      operationsByService: {},
      operationsByType: {}
    };
  }
}
