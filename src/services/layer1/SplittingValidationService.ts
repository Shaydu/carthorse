import { Pool } from 'pg';

export interface ValidationResult {
  success: boolean;
  accuracyPercentage: number;
  originalLength: number;
  splitLength: number;
  lengthDifference: number;
  missingSections: number;
  extraSections: number;
  geometryValidation: {
    validGeometries: number;
    invalidGeometries: number;
    duplicateGeometries: number;
  };
  errors: string[];
  warnings: string[];
}

export interface TrailValidationConfig {
  stagingSchema: string;
  pgClient: Pool;
  minAccuracyPercentage: number; // Default 98%
  toleranceMeters: number; // Default 1 meter
  verbose?: boolean;
}

/**
 * Service to validate that split trails maintain geometric and length accuracy
 * Ensures no dropped sections or missing sections during splitting operations
 */
export class SplittingValidationService {
  constructor(private config: TrailValidationConfig) {}

  /**
   * Validate that split trails maintain at least 98% accuracy compared to originals
   */
  async validateSplittingAccuracy(
    originalTrailIds: string[], 
    splitTrailIds: string[]
  ): Promise<ValidationResult> {
    const { stagingSchema, pgClient, minAccuracyPercentage = 98, toleranceMeters = 1, verbose = false } = this.config;

    console.log(`🔍 Validating splitting accuracy (min: ${minAccuracyPercentage}%)...`);
    console.log(`   📊 Original trails: ${originalTrailIds.length}`);
    console.log(`   📊 Split trails: ${splitTrailIds.length}`);

    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Step 1: Calculate total original length
      const originalLengthResult = await pgClient.query(`
        SELECT 
          SUM(ST_Length(geometry::geography)) as total_length_meters,
          COUNT(*) as trail_count
        FROM ${stagingSchema}.trails
        WHERE app_uuid = ANY($1)
          AND geometry IS NOT NULL
          AND ST_IsValid(geometry)
      `, [originalTrailIds]);

      const originalLength = parseFloat(originalLengthResult.rows[0].total_length_meters || '0');
      const originalCount = parseInt(originalLengthResult.rows[0].trail_count || '0');

      // Step 2: Calculate total split length
      const splitLengthResult = await pgClient.query(`
        SELECT 
          SUM(ST_Length(geometry::geography)) as total_length_meters,
          COUNT(*) as trail_count
        FROM ${stagingSchema}.trails
        WHERE app_uuid = ANY($1)
          AND geometry IS NOT NULL
          AND ST_IsValid(geometry)
      `, [splitTrailIds]);

      const splitLength = parseFloat(splitLengthResult.rows[0].total_length_meters || '0');
      const splitCount = parseInt(splitLengthResult.rows[0].trail_count || '0');

      // Step 3: Calculate accuracy percentage
      const lengthDifference = Math.abs(originalLength - splitLength);
      const accuracyPercentage = originalLength > 0 ? 
        ((originalLength - lengthDifference) / originalLength) * 100 : 100;
      
      // Round to avoid floating point precision issues
      const roundedAccuracy = Math.round(accuracyPercentage * 100) / 100;

      // Step 4: Validate geometries
      const geometryValidation = await this.validateGeometries(splitTrailIds);

      // Step 5: Check for missing or extra sections
      const { missingSections, extraSections } = await this.checkForMissingOrExtraSections(
        originalTrailIds, 
        splitTrailIds
      );

      // Step 6: Validate spatial coverage
      const spatialValidation = await this.validateSpatialCoverage(originalTrailIds, splitTrailIds);

      // Step 7: Generate validation results
      if (roundedAccuracy < minAccuracyPercentage) {
        errors.push(`Accuracy ${roundedAccuracy.toFixed(2)}% is below minimum ${minAccuracyPercentage}%`);
      }

      if (lengthDifference > toleranceMeters) {
        errors.push(`Length difference ${lengthDifference.toFixed(2)}m exceeds tolerance ${toleranceMeters}m`);
      }

      if (missingSections > 0) {
        errors.push(`${missingSections} sections appear to be missing after splitting`);
      }

      if (extraSections > 0) {
        warnings.push(`${extraSections} extra sections detected (may be valid splits)`);
      }

      if (geometryValidation.invalidGeometries > 0) {
        errors.push(`${geometryValidation.invalidGeometries} invalid geometries found`);
      }

      if (geometryValidation.duplicateGeometries > 0) {
        warnings.push(`${geometryValidation.duplicateGeometries} duplicate geometries found`);
      }

      if (!spatialValidation.success) {
        errors.push(`Spatial coverage validation failed: ${spatialValidation.error}`);
      }

      const success = errors.length === 0 && accuracyPercentage >= minAccuracyPercentage;

      if (verbose) {
        console.log(`   📏 Original length: ${originalLength.toFixed(2)}m (${originalCount} trails)`);
        console.log(`   📏 Split length: ${splitLength.toFixed(2)}m (${splitCount} trails)`);
        console.log(`   📊 Length difference: ${lengthDifference.toFixed(2)}m`);
        console.log(`   🎯 Accuracy: ${accuracyPercentage.toFixed(2)}%`);
        console.log(`   🔍 Missing sections: ${missingSections}`);
        console.log(`   ➕ Extra sections: ${extraSections}`);
        console.log(`   ✅ Valid geometries: ${geometryValidation.validGeometries}`);
        console.log(`   ❌ Invalid geometries: ${geometryValidation.invalidGeometries}`);
        console.log(`   🔄 Duplicate geometries: ${geometryValidation.duplicateGeometries}`);
      }

      return {
        success,
        accuracyPercentage,
        originalLength,
        splitLength,
        lengthDifference,
        missingSections,
        extraSections,
        geometryValidation,
        errors,
        warnings
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      errors.push(`Validation failed: ${errorMessage}`);
      
      return {
        success: false,
        accuracyPercentage: 0,
        originalLength: 0,
        splitLength: 0,
        lengthDifference: 0,
        missingSections: 0,
        extraSections: 0,
        geometryValidation: {
          validGeometries: 0,
          invalidGeometries: 0,
          duplicateGeometries: 0
        },
        errors,
        warnings: []
      };
    }
  }

  /**
   * Validate geometries for validity and duplicates
   */
  private async validateGeometries(trailIds: string[]): Promise<{
    validGeometries: number;
    invalidGeometries: number;
    duplicateGeometries: number;
  }> {
    const { stagingSchema, pgClient } = this.config;

    // Check for invalid geometries
    const invalidResult = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${stagingSchema}.trails
      WHERE app_uuid = ANY($1)
        AND (geometry IS NULL OR NOT ST_IsValid(geometry))
    `, [trailIds]);

    const invalidGeometries = parseInt(invalidResult.rows[0].count || '0');

    // Check for duplicate geometries
    const duplicateResult = await pgClient.query(`
      WITH geometry_groups AS (
        SELECT 
          ST_AsText(geometry) as geom_text,
          COUNT(*) as count
        FROM ${stagingSchema}.trails
        WHERE app_uuid = ANY($1)
          AND geometry IS NOT NULL
          AND ST_IsValid(geometry)
        GROUP BY ST_AsText(geometry)
        HAVING COUNT(*) > 1
      )
      SELECT SUM(count - 1) as duplicate_count
      FROM geometry_groups
    `, [trailIds]);

    const duplicateGeometries = parseInt(duplicateResult.rows[0].duplicate_count || '0');

    // Count valid geometries
    const validResult = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${stagingSchema}.trails
      WHERE app_uuid = ANY($1)
        AND geometry IS NOT NULL
        AND ST_IsValid(geometry)
    `, [trailIds]);

    const validGeometries = parseInt(validResult.rows[0].count || '0');

    return {
      validGeometries,
      invalidGeometries,
      duplicateGeometries
    };
  }

  /**
   * Check for missing or extra sections by comparing spatial coverage
   */
  private async checkForMissingOrExtraSections(
    originalTrailIds: string[], 
    splitTrailIds: string[]
  ): Promise<{ missingSections: number; extraSections: number }> {
    const { stagingSchema, pgClient, toleranceMeters = 1 } = this.config;

    try {
      // Create union of original geometries
      const originalUnionResult = await pgClient.query(`
        SELECT ST_Union(geometry) as original_union
        FROM ${stagingSchema}.trails
        WHERE app_uuid = ANY($1)
          AND geometry IS NOT NULL
          AND ST_IsValid(geometry)
      `, [originalTrailIds]);

      // Create union of split geometries
      const splitUnionResult = await pgClient.query(`
        SELECT ST_Union(geometry) as split_union
        FROM ${stagingSchema}.trails
        WHERE app_uuid = ANY($1)
          AND geometry IS NOT NULL
          AND ST_IsValid(geometry)
      `, [splitTrailIds]);

      if (!originalUnionResult.rows[0].original_union || !splitUnionResult.rows[0].split_union) {
        return { missingSections: 0, extraSections: 0 };
      }

      // Find areas covered by original but not by split (missing sections)
      const missingResult = await pgClient.query(`
        SELECT 
          ST_Area(ST_Difference($1::geometry, $2::geometry)::geography) as missing_area
      `, [originalUnionResult.rows[0].original_union, splitUnionResult.rows[0].split_union]);

      // Find areas covered by split but not by original (extra sections)
      const extraResult = await pgClient.query(`
        SELECT 
          ST_Area(ST_Difference($1::geometry, $2::geometry)::geography) as extra_area
      `, [splitUnionResult.rows[0].split_union, originalUnionResult.rows[0].original_union]);

      const missingArea = parseFloat(missingResult.rows[0].missing_area || '0');
      const extraArea = parseFloat(extraResult.rows[0].extra_area || '0');

      // Convert area to approximate section count (rough estimate)
      const missingSections = Math.round(missingArea / (toleranceMeters * toleranceMeters));
      const extraSections = Math.round(extraArea / (toleranceMeters * toleranceMeters));

      return { missingSections, extraSections };

    } catch (error) {
      console.warn('Error checking for missing/extra sections:', error);
      return { missingSections: 0, extraSections: 0 };
    }
  }

  /**
   * Validate spatial coverage to ensure no gaps or overlaps
   */
  private async validateSpatialCoverage(
    originalTrailIds: string[], 
    splitTrailIds: string[]
  ): Promise<{ success: boolean; error?: string }> {
    const { stagingSchema, pgClient, toleranceMeters = 1 } = this.config;

    try {
      // Check for significant gaps in coverage
      const gapResult = await pgClient.query(`
        WITH original_union AS (
          SELECT ST_Union(geometry) as geom
          FROM ${stagingSchema}.trails
          WHERE app_uuid = ANY($1)
            AND geometry IS NOT NULL
            AND ST_IsValid(geometry)
        ),
        split_union AS (
          SELECT ST_Union(geometry) as geom
          FROM ${stagingSchema}.trails
          WHERE app_uuid = ANY($2)
            AND geometry IS NOT NULL
            AND ST_IsValid(geometry)
        ),
        coverage_diff AS (
          SELECT ST_Difference(ou.geom, su.geom) as missing_coverage
          FROM original_union ou, split_union su
        )
        SELECT 
          ST_Area(missing_coverage::geography) as gap_area,
          ST_Length(missing_coverage::geography) as gap_length
        FROM coverage_diff
        WHERE missing_coverage IS NOT NULL
      `, [originalTrailIds, splitTrailIds]);

      if (gapResult.rows.length > 0) {
        const gapArea = parseFloat(gapResult.rows[0].gap_area || '0');
        const gapLength = parseFloat(gapResult.rows[0].gap_length || '0');

        if (gapLength > toleranceMeters * 10) { // Allow small gaps
          return {
            success: false,
            error: `Significant gaps detected: ${gapLength.toFixed(2)}m length, ${gapArea.toFixed(2)}m² area`
          };
        }
      }

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown spatial validation error'
      };
    }
  }

  /**
   * Validate a single trail's splitting accuracy
   */
  async validateSingleTrailSplitting(
    originalTrailId: string, 
    splitTrailIds: string[]
  ): Promise<ValidationResult> {
    return this.validateSplittingAccuracy([originalTrailId], splitTrailIds);
  }

  /**
   * Get validation statistics for all trails in staging
   */
  async getValidationStatistics(): Promise<{
    totalTrails: number;
    validTrails: number;
    invalidTrails: number;
    totalLength: number;
    averageLength: number;
  }> {
    const { stagingSchema, pgClient } = this.config;

    const statsResult = await pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN geometry IS NOT NULL AND ST_IsValid(geometry) THEN 1 END) as valid_trails,
        COUNT(CASE WHEN geometry IS NULL OR NOT ST_IsValid(geometry) THEN 1 END) as invalid_trails,
        SUM(ST_Length(geometry::geography)) as total_length,
        AVG(ST_Length(geometry::geography)) as average_length
      FROM ${stagingSchema}.trails
    `);

    const row = statsResult.rows[0];
    return {
      totalTrails: parseInt(row.total_trails || '0'),
      validTrails: parseInt(row.valid_trails || '0'),
      invalidTrails: parseInt(row.invalid_trails || '0'),
      totalLength: parseFloat(row.total_length || '0'),
      averageLength: parseFloat(row.average_length || '0')
    };
  }
}
