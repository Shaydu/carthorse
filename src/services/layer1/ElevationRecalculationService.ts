/**
 * Elevation Recalculation Service
 * 
 * This service recalculates elevation statistics for all trails in a staging schema
 * after all trail splitting operations are complete. This ensures accurate elevation
 * data for split trail segments.
 */

import { Pool } from 'pg';
import { getElevationRecalculationFunctionSql, getUpdateTrailElevationStatsSql } from '../../utils/sql/elevation-recalculation';

export interface ElevationRecalculationConfig {
  pgClient: Pool;
  stagingSchema: string;
  region: string;
}

export interface ElevationRecalculationResult {
  success: boolean;
  trailsProcessed: number;
  trailsWithValidElevation: number;
  trailsWithInvalidElevation: number;
  processingTimeMs: number;
  errors: string[];
}

export class ElevationRecalculationService {
  private pgClient: Pool;
  private stagingSchema: string;
  private region: string;

  constructor(config: ElevationRecalculationConfig) {
    this.pgClient = config.pgClient;
    this.stagingSchema = config.stagingSchema;
    this.region = config.region;
  }

  /**
   * Recalculate elevation statistics for all trails in the staging schema
   */
  async recalculateElevationStats(): Promise<ElevationRecalculationResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    try {
      console.log('📈 Starting elevation statistics recalculation...');

      // Step 1: Get initial statistics
      const initialStats = await this.getElevationStats();
      console.log(`   📊 Initial elevation stats: ${initialStats.trailsWithValidElevation}/${initialStats.totalTrails} trails have valid elevation`);

      // Step 2: Recalculate elevation statistics for all trails using direct SQL
      console.log('   🔄 Recalculating elevation statistics...');
      const updateResult = await this.pgClient.query(getUpdateTrailElevationStatsSql(this.stagingSchema));
      
      // Step 4: Get final statistics
      const finalStats = await this.getElevationStats();
      console.log(`   📊 Final elevation stats: ${finalStats.trailsWithValidElevation}/${finalStats.totalTrails} trails have valid elevation`);

      const processingTimeMs = Date.now() - startTime;
      const trailsProcessed = finalStats.totalTrails;
      const trailsWithValidElevation = finalStats.trailsWithValidElevation;
      const trailsWithInvalidElevation = finalStats.totalTrails - finalStats.trailsWithValidElevation;

      console.log(`✅ Elevation recalculation completed in ${processingTimeMs}ms`);
      console.log(`   - Trails processed: ${trailsProcessed}`);
      console.log(`   - Trails with valid elevation: ${trailsWithValidElevation}`);
      console.log(`   - Trails with invalid elevation: ${trailsWithInvalidElevation}`);

      return {
        success: true,
        trailsProcessed,
        trailsWithValidElevation,
        trailsWithInvalidElevation,
        processingTimeMs,
        errors
      };

    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const errorMessage = `Elevation recalculation failed: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMessage);
      console.error(`❌ ${errorMessage}`);

      return {
        success: false,
        trailsProcessed: 0,
        trailsWithValidElevation: 0,
        trailsWithInvalidElevation: 0,
        processingTimeMs,
        errors
      };
    }
  }

  /**
   * Get current elevation statistics for the staging schema
   */
  private async getElevationStats(): Promise<{
    totalTrails: number;
    trailsWithValidElevation: number;
    trailsWithInvalidElevation: number;
  }> {
    const result = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(*) FILTER (WHERE min_elevation > 0 AND max_elevation > 0 AND avg_elevation > 0) as trails_with_valid_elevation,
        COUNT(*) FILTER (WHERE min_elevation = 0 OR max_elevation = 0 OR avg_elevation = 0 OR min_elevation IS NULL OR max_elevation IS NULL OR avg_elevation IS NULL) as trails_with_invalid_elevation
      FROM ${this.stagingSchema}.trails
    `);

    const row = result.rows[0];
    return {
      totalTrails: parseInt(row.total_trails),
      trailsWithValidElevation: parseInt(row.trails_with_valid_elevation),
      trailsWithInvalidElevation: parseInt(row.trails_with_invalid_elevation)
    };
  }

  /**
   * Validate that elevation data is properly calculated
   */
  async validateElevationData(): Promise<{
    isValid: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];

    try {
      // Check for trails with zero elevation
      const zeroElevationResult = await this.pgClient.query(`
        SELECT COUNT(*) as count
        FROM ${this.stagingSchema}.trails
        WHERE min_elevation = 0 OR max_elevation = 0
      `);
      
      const zeroElevationCount = parseInt(zeroElevationResult.rows[0].count);
      if (zeroElevationCount > 0) {
        issues.push(`${zeroElevationCount} trails have zero elevation values`);
      }

      // Check for trails with invalid elevation relationships
      const invalidElevationResult = await this.pgClient.query(`
        SELECT COUNT(*) as count
        FROM ${this.stagingSchema}.trails
        WHERE min_elevation > max_elevation
      `);
      
      const invalidElevationCount = parseInt(invalidElevationResult.rows[0].count);
      if (invalidElevationCount > 0) {
        issues.push(`${invalidElevationCount} trails have min_elevation > max_elevation`);
      }

      // Check for trails with missing elevation data
      const missingElevationResult = await this.pgClient.query(`
        SELECT COUNT(*) as count
        FROM ${this.stagingSchema}.trails
        WHERE min_elevation IS NULL OR max_elevation IS NULL OR avg_elevation IS NULL
      `);
      
      const missingElevationCount = parseInt(missingElevationResult.rows[0].count);
      if (missingElevationCount > 0) {
        issues.push(`${missingElevationCount} trails have NULL elevation values`);
      }

      return {
        isValid: issues.length === 0,
        issues
      };

    } catch (error) {
      issues.push(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
      return {
        isValid: false,
        issues
      };
    }
  }
}
