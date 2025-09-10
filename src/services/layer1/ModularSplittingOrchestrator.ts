import { Pool } from 'pg';
import { TIntersectionSplittingService, TIntersectionSplittingConfig } from './TIntersectionSplittingService';
import { ShortTrailSplittingService, ShortTrailSplittingConfig } from './ShortTrailSplittingService';
import { IntersectionBasedTrailSplitter, IntersectionBasedSplittingConfig } from './IntersectionBasedTrailSplitter';
import { SplittingValidationService, ValidationResult } from './SplittingValidationService';

// Common interface for all splitting services
export interface SplittingService {
  readonly serviceName: string;
  execute(): Promise<SplittingResult>;
}

export interface SplittingResult {
  success: boolean;
  serviceName: string;
  trailsProcessed?: number;
  trailsSplit?: number;
  segmentsCreated?: number;
  intersectionsFound?: number;
  tIntersectionsHandled?: number;
  xIntersectionsHandled?: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface SplittingStep {
  service: SplittingService;
  enabled: boolean;
  description: string;
  config?: any;
  metadata?: Record<string, any>;
}

export interface ModularSplittingConfig {
  stagingSchema: string;
  pgClient: Pool;
  verbose?: boolean;
  enableValidation?: boolean;
  stopOnError?: boolean;
  exportDebugData?: boolean;
  debugOutputPath?: string;
  minAccuracyPercentage?: number; // Default 98%
  validationToleranceMeters?: number; // Default 1 meter
  fatalOnValidationFailure?: boolean; // Default true - stop on any validation failure
  minSegmentLengthMeters?: number; // Default 5.0 meters
}

/**
 * Modular splitting orchestrator that allows chaining and independent debugging of splitting services
 * Each service can be enabled/disabled independently and run in sequence
 */
export class ModularSplittingOrchestrator {
  private steps: SplittingStep[] = [];
  private results: SplittingResult[] = [];
  private config: ModularSplittingConfig;
  private validationService: SplittingValidationService;
  private preStepTrailIds: string[] = [];
  private postStepTrailIds: string[] = [];

  constructor(config: ModularSplittingConfig) {
    this.config = {
      enableValidation: true,
      stopOnError: true,
      exportDebugData: false,
      minAccuracyPercentage: 98,
      validationToleranceMeters: 1,
      fatalOnValidationFailure: true,
      ...config
    };
    
    this.validationService = new SplittingValidationService({
      stagingSchema: this.config.stagingSchema,
      pgClient: this.config.pgClient,
      minAccuracyPercentage: this.config.minAccuracyPercentage!,
      toleranceMeters: this.config.validationToleranceMeters!,
      verbose: this.config.verbose
    });
    
    this.initializeDefaultSteps();
  }

  /**
   * Initialize default splitting steps
   */
  private initializeDefaultSteps(): void {
    const { stagingSchema, pgClient, verbose = false } = this.config;

    // Step 1: T-Intersection Splitting (from holy grail branch)
    this.addStep({
      service: new TIntersectionSplittingService({
        stagingSchema,
        pgClient,
        toleranceMeters: 3.0,
        minSegmentLengthMeters: this.config.minSegmentLengthMeters || 5.0,
        verbose,
        batchSize: 50
      }),
      enabled: true,
      description: 'T-Intersection Splitting (holy grail logic)',
      config: {
        toleranceMeters: 3.0,
        minSegmentLengthMeters: this.config.minSegmentLengthMeters || 5.0,
        batchSize: 50
      }
    });

    // Step 2: Short Trail Splitting (under 0.5km with enhanced intersection detection)
    this.addStep({
      service: new ShortTrailSplittingService({
        stagingSchema,
        pgClient,
        maxTrailLengthKm: 0.5,
        minSegmentLengthMeters: this.config.minSegmentLengthMeters || 5.0,
        verbose,
        intersectionToleranceMeters: 2.0
      }),
      enabled: true,
      description: 'Short Trail Splitting (under 0.5km)',
      config: {
        maxTrailLengthKm: 0.5,
        minSegmentLengthMeters: this.config.minSegmentLengthMeters || 5.0,
        intersectionToleranceMeters: 2.0
      }
    });

    // Step 3: General Intersection-Based Splitting (X-intersections and complex cases)
    this.addStep({
      service: new IntersectionBasedTrailSplitter({
        stagingSchema,
        pgClient,
        minSegmentLengthMeters: this.config.minSegmentLengthMeters || 5.0,
        verbose,
        validationToleranceMeters: 1.0,
        validationTolerancePercentage: 0.05
      }),
      enabled: true,
      description: 'General Intersection-Based Splitting (X-intersections)',
      config: {
        minSegmentLengthMeters: this.config.minSegmentLengthMeters || 5.0,
        validationToleranceMeters: 1.0,
        validationTolerancePercentage: 0.05
      }
    });
  }

  /**
   * Add a splitting step to the orchestrator
   */
  addStep(step: SplittingStep): void {
    this.steps.push(step);
  }

  /**
   * Remove a splitting step by service name
   */
  removeStep(serviceName: string): void {
    this.steps = this.steps.filter(step => step.service.serviceName !== serviceName);
  }

  /**
   * Enable/disable a specific step
   */
  setStepEnabled(serviceName: string, enabled: boolean): void {
    const step = this.steps.find(s => s.service.serviceName === serviceName);
    if (step) {
      step.enabled = enabled;
    }
  }

  /**
   * Get all available steps
   */
  getSteps(): SplittingStep[] {
    return [...this.steps];
  }

  /**
   * Get enabled steps only
   */
  getEnabledSteps(): SplittingStep[] {
    return this.steps.filter(step => step.enabled);
  }

  /**
   * Execute all enabled splitting steps in sequence
   */
  async executeAll(): Promise<SplittingResult[]> {
    console.log('🚀 Starting Modular Splitting Orchestrator...');
    console.log(`📋 ${this.getEnabledSteps().length} steps enabled out of ${this.steps.length} total steps`);
    
    this.results = [];
    const enabledSteps = this.getEnabledSteps();

    for (let i = 0; i < enabledSteps.length; i++) {
      const step = enabledSteps[i];
      console.log(`\n🔄 Step ${i + 1}/${enabledSteps.length}: ${step.description}`);
      console.log(`   Service: ${step.service.serviceName}`);
      
      try {
        // Pre-step validation
        if (this.config.enableValidation) {
          await this.validateBeforeStep(step, i);
        }

        // Export debug data before step if enabled
        if (this.config.exportDebugData) {
          await this.exportDebugData(`before_${step.service.serviceName}`, i);
        }

        // Execute the step
        const startTime = Date.now();
        const result = await step.service.execute();
        const duration = Date.now() - startTime;

        // Add metadata
        result.metadata = {
          ...result.metadata,
          stepNumber: i + 1,
          duration: duration,
          timestamp: new Date().toISOString()
        };

        this.results.push(result);

        // Log results
        this.logStepResult(result, duration);

        // Post-step validation
        if (this.config.enableValidation) {
          await this.validateAfterStep(step, result, i);
        }

        // Export debug data after step if enabled
        if (this.config.exportDebugData) {
          await this.exportDebugData(`after_${step.service.serviceName}`, i);
        }

        // Stop on error if configured
        if (!result.success && this.config.stopOnError) {
          console.error(`❌ Stopping execution due to error in ${step.service.serviceName}`);
          break;
        }

      } catch (error) {
        const errorResult: SplittingResult = {
          success: false,
          serviceName: step.service.serviceName,
          error: error instanceof Error ? error.message : 'Unknown error',
          metadata: {
            stepNumber: i + 1,
            timestamp: new Date().toISOString(),
            errorType: 'execution_error'
          }
        };

        this.results.push(errorResult);
        console.error(`❌ Error in step ${i + 1} (${step.service.serviceName}):`, error);

        if (this.config.stopOnError) {
          console.error(`❌ Stopping execution due to error in ${step.service.serviceName}`);
          break;
        }
      }
    }

    // Print final summary
    this.printFinalSummary();
    return this.results;
  }

  /**
   * Execute a single step by service name
   */
  async executeStep(serviceName: string): Promise<SplittingResult | null> {
    const step = this.steps.find(s => s.service.serviceName === serviceName);
    if (!step) {
      console.error(`❌ Step not found: ${serviceName}`);
      return null;
    }

    if (!step.enabled) {
      console.error(`❌ Step is disabled: ${serviceName}`);
      return null;
    }

    console.log(`🔄 Executing single step: ${step.description}`);
    console.log(`   Service: ${step.service.serviceName}`);

    try {
      const startTime = Date.now();
      const result = await step.service.execute();
      const duration = Date.now() - startTime;

      result.metadata = {
        ...result.metadata,
        duration: duration,
        timestamp: new Date().toISOString(),
        singleStepExecution: true
      };

      this.logStepResult(result, duration);
      return result;

    } catch (error) {
      const errorResult: SplittingResult = {
        success: false,
        serviceName: step.service.serviceName,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          timestamp: new Date().toISOString(),
          errorType: 'execution_error',
          singleStepExecution: true
        }
      };

      console.error(`❌ Error in single step execution (${step.service.serviceName}):`, error);
      return errorResult;
    }
  }

  /**
   * Get results from the last execution
   */
  getResults(): SplittingResult[] {
    return [...this.results];
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalSteps: number;
    enabledSteps: number;
    successfulSteps: number;
    failedSteps: number;
    totalTrailsProcessed: number;
    totalTrailsSplit: number;
    totalSegmentsCreated: number;
    totalIntersectionsFound: number;
  } {
    const enabledSteps = this.getEnabledSteps();
    const successfulResults = this.results.filter(r => r.success);
    const failedResults = this.results.filter(r => !r.success);

    return {
      totalSteps: this.steps.length,
      enabledSteps: enabledSteps.length,
      successfulSteps: successfulResults.length,
      failedSteps: failedResults.length,
      totalTrailsProcessed: this.results.reduce((sum, r) => sum + (r.trailsProcessed || 0), 0),
      totalTrailsSplit: this.results.reduce((sum, r) => sum + (r.trailsSplit || 0), 0),
      totalSegmentsCreated: this.results.reduce((sum, r) => sum + (r.segmentsCreated || 0), 0),
      totalIntersectionsFound: this.results.reduce((sum, r) => sum + (r.intersectionsFound || 0), 0)
    };
  }

  /**
   * Log step result
   */
  private logStepResult(result: SplittingResult, duration: number): void {
    if (result.success) {
      console.log(`   ✅ ${result.serviceName} completed in ${duration}ms`);
      if (result.trailsProcessed) console.log(`      📊 Trails processed: ${result.trailsProcessed}`);
      if (result.trailsSplit) console.log(`      ✂️ Trails split: ${result.trailsSplit}`);
      if (result.segmentsCreated) console.log(`      📏 Segments created: ${result.segmentsCreated}`);
      if (result.intersectionsFound) console.log(`      🔍 Intersections found: ${result.intersectionsFound}`);
      if (result.tIntersectionsHandled) console.log(`      🔺 T-intersections handled: ${result.tIntersectionsHandled}`);
      if (result.xIntersectionsHandled) console.log(`      ❌ X-intersections handled: ${result.xIntersectionsHandled}`);
    } else {
      console.log(`   ❌ ${result.serviceName} failed in ${duration}ms`);
      if (result.error) console.log(`      Error: ${result.error}`);
    }
  }

  /**
   * Print final summary
   */
  private printFinalSummary(): void {
    const summary = this.getSummary();
    
    console.log('\n📊 MODULAR SPLITTING SUMMARY:');
    console.log(`   📋 Total steps: ${summary.totalSteps}`);
    console.log(`   ✅ Enabled steps: ${summary.enabledSteps}`);
    console.log(`   🎯 Successful steps: ${summary.successfulSteps}`);
    console.log(`   ❌ Failed steps: ${summary.failedSteps}`);
    console.log(`   📊 Total trails processed: ${summary.totalTrailsProcessed}`);
    console.log(`   ✂️ Total trails split: ${summary.totalTrailsSplit}`);
    console.log(`   📏 Total segments created: ${summary.totalSegmentsCreated}`);
    console.log(`   🔍 Total intersections found: ${summary.totalIntersectionsFound}`);
    
    if (summary.failedSteps > 0) {
      console.log('\n❌ Failed steps:');
      this.results.filter(r => !r.success).forEach(result => {
        console.log(`   - ${result.serviceName}: ${result.error}`);
      });
    }
  }

  /**
   * Validate before step execution - capture trail IDs for validation
   */
  private async validateBeforeStep(step: SplittingStep, stepIndex: number): Promise<void> {
    const { stagingSchema, pgClient } = this.config;
    
    // Get all trail IDs before step
    const trailIdsResult = await pgClient.query(`
      SELECT app_uuid, name, ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      ORDER BY app_uuid
    `);
    
    this.preStepTrailIds = trailIdsResult.rows.map(row => row.app_uuid);
    const trailCount = trailIdsResult.rows.length;
    const totalLength = trailIdsResult.rows.reduce((sum, row) => sum + parseFloat(row.length_meters || '0'), 0);
    
    console.log(`   🔍 Pre-step validation: ${trailCount} trails, ${totalLength.toFixed(2)}m total length`);
    
    if (this.config.verbose) {
      console.log(`   📋 Pre-step trails: ${trailIdsResult.rows.map(r => `${r.name}(${r.length_meters?.toFixed(1)}m)`).join(', ')}`);
    }
    
    // Store for post-step comparison
    step.metadata = {
      ...step.metadata,
      preStepTrailCount: trailCount,
      preStepTrailIds: [...this.preStepTrailIds],
      preStepTotalLength: totalLength
    };
  }

  /**
   * Validate after step execution with strict accuracy validation
   */
  private async validateAfterStep(step: SplittingStep, result: SplittingResult, stepIndex: number): Promise<void> {
    const { stagingSchema, pgClient } = this.config;
    
    // Get all trail IDs after step
    const trailIdsResult = await pgClient.query(`
      SELECT app_uuid, name, ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      ORDER BY app_uuid
    `);
    
    this.postStepTrailIds = trailIdsResult.rows.map(row => row.app_uuid);
    const trailCount = trailIdsResult.rows.length;
    const totalLength = trailIdsResult.rows.reduce((sum, row) => sum + parseFloat(row.length_meters || '0'), 0);
    
    const preStepCount = step.metadata?.preStepTrailCount || 0;
    const preStepLength = step.metadata?.preStepTotalLength || 0;
    const trailCountChange = trailCount - preStepCount;
    const lengthChange = totalLength - preStepLength;
    
    console.log(`   🔍 Post-step validation: ${trailCount} trails (${trailCountChange >= 0 ? '+' : ''}${trailCountChange}), ${totalLength.toFixed(2)}m total (${lengthChange >= 0 ? '+' : ''}${lengthChange.toFixed(2)}m)`);
    
    if (this.config.verbose) {
      console.log(`   📋 Post-step trails: ${trailIdsResult.rows.map(r => `${r.name}(${r.length_meters?.toFixed(1)}m)`).join(', ')}`);
    }
    
    // CRITICAL VALIDATION: Check accuracy if trails were split
    if (result.success && result.segmentsCreated && result.segmentsCreated > 0) {
      console.log(`   🎯 Validating splitting accuracy (min: ${this.config.minAccuracyPercentage}%)...`);
      
      try {
        const validationResult = await this.validationService.validateSplittingAccuracy(
          this.preStepTrailIds,
          this.postStepTrailIds
        );
        
        // Log detailed validation results
        console.log(`   📊 Validation Results:`);
        console.log(`      🎯 Accuracy: ${validationResult.accuracyPercentage.toFixed(2)}%`);
        console.log(`      📏 Original length: ${validationResult.originalLength.toFixed(2)}m`);
        console.log(`      📏 Split length: ${validationResult.splitLength.toFixed(2)}m`);
        console.log(`      📊 Length difference: ${validationResult.lengthDifference.toFixed(2)}m`);
        console.log(`      🔍 Missing sections: ${validationResult.missingSections}`);
        console.log(`      ➕ Extra sections: ${validationResult.extraSections}`);
        console.log(`      ✅ Valid geometries: ${validationResult.geometryValidation.validGeometries}`);
        console.log(`      ❌ Invalid geometries: ${validationResult.geometryValidation.invalidGeometries}`);
        console.log(`      🔄 Duplicate geometries: ${validationResult.geometryValidation.duplicateGeometries}`);
        
        // Log errors and warnings
        if (validationResult.errors.length > 0) {
          console.log(`   ❌ Validation Errors:`);
          validationResult.errors.forEach(error => {
            console.log(`      - ${error}`);
          });
        }
        
        if (validationResult.warnings.length > 0) {
          console.log(`   ⚠️ Validation Warnings:`);
          validationResult.warnings.forEach(warning => {
            console.log(`      - ${warning}`);
          });
        }
        
        // FATAL ERROR: Stop execution if validation fails
        if (!validationResult.success && this.config.fatalOnValidationFailure) {
          const errorMessage = `FATAL VALIDATION ERROR in ${step.service.serviceName}: ${validationResult.errors.join(', ')}`;
          
          console.error(`\n❌ ${errorMessage}`);
          console.error(`   📊 Detailed failure information:`);
          console.error(`      - Step: ${step.description}`);
          console.error(`      - Service: ${step.service.serviceName}`);
          console.error(`      - Original trails: ${this.preStepTrailIds.length}`);
          console.error(`      - Split trails: ${this.postStepTrailIds.length}`);
          console.error(`      - Expected segments: ${result.segmentsCreated}`);
          console.error(`      - Actual trail count change: ${trailCountChange}`);
          console.error(`      - Length accuracy: ${validationResult.accuracyPercentage.toFixed(2)}%`);
          console.error(`      - Missing sections: ${validationResult.missingSections}`);
          console.error(`      - Invalid geometries: ${validationResult.geometryValidation.invalidGeometries}`);
          
          if (this.config.verbose) {
            console.error(`   📋 Failed trails:`);
            const failedTrails = await this.getFailedTrailDetails();
            failedTrails.forEach(trail => {
              console.error(`      - ${trail.name} (${trail.app_uuid}): ${trail.length_meters?.toFixed(1)}m`);
            });
          }
          
          throw new Error(errorMessage);
        }
        
        // Store validation results in step metadata
        step.metadata = {
          ...step.metadata,
          postStepTrailCount: trailCount,
          postStepTrailIds: [...this.postStepTrailIds],
          postStepTotalLength: totalLength,
          validationResult
        };
        
      } catch (error) {
        if (this.config.fatalOnValidationFailure) {
          const errorMessage = `FATAL VALIDATION ERROR in ${step.service.serviceName}: ${error instanceof Error ? error.message : 'Unknown validation error'}`;
          console.error(`\n❌ ${errorMessage}`);
          throw new Error(errorMessage);
        } else {
          console.warn(`   ⚠️ Validation failed but continuing: ${error}`);
        }
      }
    }
    
    // Basic validation: Check that the step made expected changes
    if (result.success && result.segmentsCreated && Math.abs(trailCountChange - result.segmentsCreated) > 1) {
      const warningMessage = `Warning: Expected ${result.segmentsCreated} segments, but trail count changed by ${trailCountChange}`;
      console.warn(`   ⚠️ ${warningMessage}`);
      
      if (this.config.fatalOnValidationFailure) {
        throw new Error(`FATAL ERROR: ${warningMessage}`);
      }
    }
  }

  /**
   * Get detailed information about failed trails
   */
  private async getFailedTrailDetails(): Promise<Array<{
    app_uuid: string;
    name: string;
    length_meters: number;
    geometry_valid: boolean;
  }>> {
    const { stagingSchema, pgClient } = this.config;
    
    try {
      const result = await pgClient.query(`
        SELECT 
          app_uuid,
          name,
          ST_Length(geometry::geography) as length_meters,
          ST_IsValid(geometry) as geometry_valid
        FROM ${stagingSchema}.trails
        WHERE app_uuid = ANY($1)
        ORDER BY name
      `, [this.postStepTrailIds]);
      
      return result.rows;
    } catch (error) {
      console.warn('Failed to get trail details:', error);
      return [];
    }
  }

  /**
   * Export debug data
   */
  private async exportDebugData(suffix: string, stepIndex: number): Promise<void> {
    if (!this.config.exportDebugData || !this.config.debugOutputPath) {
      return;
    }

    const { stagingSchema, pgClient } = this.config;
    
    try {
      // Export trails as GeoJSON
      const trailsResult = await pgClient.query(`
        SELECT 
          app_uuid,
          name,
          ST_AsGeoJSON(geometry, 6, 0) as geometry,
          length_km,
          trail_type,
          surface,
          difficulty
        FROM ${stagingSchema}.trails
        WHERE geometry IS NOT NULL
        ORDER BY name
      `);

      const geojson = {
        type: 'FeatureCollection',
        features: trailsResult.rows.map(row => ({
          type: 'Feature',
          properties: {
            app_uuid: row.app_uuid,
            name: row.name,
            length_km: row.length_km,
            trail_type: row.trail_type,
            surface: row.surface,
            difficulty: row.difficulty
          },
          geometry: JSON.parse(row.geometry)
        }))
      };

      const filename = `${this.config.debugOutputPath}/debug_trails_${suffix}_step${stepIndex + 1}.geojson`;
      const fs = await import('fs/promises');
      await fs.writeFile(filename, JSON.stringify(geojson, null, 2));
      
      console.log(`   💾 Debug data exported: ${filename} (${trailsResult.rows.length} trails)`);
      
    } catch (error) {
      console.warn(`   ⚠️ Failed to export debug data: ${error}`);
    }
  }
}
