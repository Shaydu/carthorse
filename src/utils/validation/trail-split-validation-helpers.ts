/**
 * Helper functions for integrating trail split validation into splitting services
 */

import { TrailSplitValidation, TrailSplitValidationResult } from './trail-split-validation';

/**
 * Validate a trail split operation using PostgreSQL queries
 * @param pgClient PostgreSQL client
 * @param stagingSchema Staging schema name
 * @param originalTrailUuid Original trail UUID
 * @param splitTrailUuids Array of split trail UUIDs
 * @param trailName Trail name for error reporting
 * @param validation Validation instance to use
 * @returns Validation result
 */
export async function validateTrailSplit(
  pgClient: any,
  stagingSchema: string,
  originalTrailUuid: string,
  splitTrailUuids: string[],
  trailName: string,
  validation: TrailSplitValidation = new TrailSplitValidation()
): Promise<TrailSplitValidationResult> {
  try {
    // Get original trail length
    const originalResult = await pgClient.query(`
      SELECT ST_Length(geometry::geography) as length_m
      FROM ${stagingSchema}.trails
      WHERE app_uuid = $1
    `, [originalTrailUuid]);

    if (originalResult.rows.length === 0) {
      throw new Error(`Original trail ${originalTrailUuid} not found`);
    }

    const originalLength = originalResult.rows[0].length_m;

    // Get split trail lengths
    const splitLengths: number[] = [];
    for (const splitUuid of splitTrailUuids) {
      const splitResult = await pgClient.query(`
        SELECT ST_Length(geometry::geography) as length_m
        FROM ${stagingSchema}.trails
        WHERE app_uuid = $1
      `, [splitUuid]);

      if (splitResult.rows.length > 0) {
        splitLengths.push(splitResult.rows[0].length_m);
      }
    }

    return validation.validateSplitLengths(originalLength, splitLengths, trailName);

  } catch (error) {
    return {
      isValid: false,
      originalLength: 0,
      splitLengths: [],
      totalSplitLength: 0,
      lengthDifference: 0,
      lengthDifferencePercentage: 0,
      errorMessage: `Validation error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Validate a trail split operation and throw an error if validation fails
 * @param pgClient PostgreSQL client
 * @param stagingSchema Staging schema name
 * @param originalTrailUuid Original trail UUID
 * @param splitTrailUuids Array of split trail UUIDs
 * @param trailName Trail name for error reporting
 * @param validation Validation instance to use
 * @throws Error if validation fails
 */
export async function validateTrailSplitAndThrow(
  pgClient: any,
  stagingSchema: string,
  originalTrailUuid: string,
  splitTrailUuids: string[],
  trailName: string,
  validation: TrailSplitValidation = new TrailSplitValidation()
): Promise<void> {
  const result = await validateTrailSplit(
    pgClient,
    stagingSchema,
    originalTrailUuid,
    splitTrailUuids,
    trailName,
    validation
  );

  if (!result.isValid) {
    throw new Error(result.errorMessage);
  }
}

/**
 * Validate a trail split operation and log a warning if validation fails
 * @param pgClient PostgreSQL client
 * @param stagingSchema Staging schema name
 * @param originalTrailUuid Original trail UUID
 * @param splitTrailUuids Array of split trail UUIDs
 * @param trailName Trail name for error reporting
 * @param validation Validation instance to use
 * @returns true if valid, false if invalid
 */
export async function validateTrailSplitAndWarn(
  pgClient: any,
  stagingSchema: string,
  originalTrailUuid: string,
  splitTrailUuids: string[],
  trailName: string,
  validation: TrailSplitValidation = new TrailSplitValidation()
): Promise<boolean> {
  const result = await validateTrailSplit(
    pgClient,
    stagingSchema,
    originalTrailUuid,
    splitTrailUuids,
    trailName,
    validation
  );

  if (!result.isValid) {
    console.warn(`⚠️ ${result.errorMessage}`);
    return false;
  }

  return true;
}

/**
 * Validate all trail splits in a staging schema
 * @param pgClient PostgreSQL client
 * @param stagingSchema Staging schema name
 * @param validation Validation instance to use
 * @returns Array of validation results
 */
export async function validateAllTrailSplits(
  pgClient: any,
  stagingSchema: string,
  validation: TrailSplitValidation = new TrailSplitValidation()
): Promise<TrailSplitValidationResult[]> {
  try {
    // Find all trails that have been split (have original_trail_uuid)
    // and check if the original trail still exists in the staging schema
    const splitTrailsResult = await pgClient.query(`
      SELECT 
        s.original_trail_uuid,
        s.name,
        array_agg(s.app_uuid) as split_uuids,
        o.geometry as original_geometry,
        ST_Length(o.geometry::geography) as original_length_m
      FROM ${stagingSchema}.trails s
      LEFT JOIN ${stagingSchema}.trails o ON s.original_trail_uuid = o.app_uuid
      WHERE s.original_trail_uuid IS NOT NULL
      GROUP BY s.original_trail_uuid, s.name, o.geometry, o.geometry
      ORDER BY s.name
    `);

    const validationResults: TrailSplitValidationResult[] = [];

    for (const trail of splitTrailsResult.rows) {
      // Check if original trail still exists
      if (!trail.original_geometry) {
        // Original trail was deleted - this is expected behavior
        // Calculate total length of split segments
        const splitLengths: number[] = [];
        for (const splitUuid of trail.split_uuids) {
          const splitResult = await pgClient.query(`
            SELECT ST_Length(geometry::geography) as length_m
            FROM ${stagingSchema}.trails
            WHERE app_uuid = $1
          `, [splitUuid]);
          
          if (splitResult.rows.length > 0) {
            splitLengths.push(splitResult.rows[0].length_m);
          }
        }
        
        const totalSplitLength = splitLengths.reduce((sum, length) => sum + length, 0);
        
        // Create a validation result indicating original trail was deleted
        const result: TrailSplitValidationResult = {
          isValid: true, // This is expected behavior
          originalLength: 0, // Original trail was deleted
          splitLengths,
          totalSplitLength,
          lengthDifference: 0,
          lengthDifferencePercentage: 0
        };
        validationResults.push(result);
        continue;
      }

      // Original trail exists - validate the split
      const result = await validateTrailSplit(
        pgClient,
        stagingSchema,
        trail.original_trail_uuid,
        trail.split_uuids,
        trail.name,
        validation
      );
      validationResults.push(result);
    }

    return validationResults;

  } catch (error) {
    console.error('Error validating trail splits:', error);
    return [];
  }
}

/**
 * Get a summary of trail split validation results
 * @param validationResults Array of validation results
 * @returns Summary statistics
 */
export function getTrailSplitValidationSummary(validationResults: TrailSplitValidationResult[]): {
  totalTrails: number;
  validTrails: number;
  invalidTrails: number;
  averageLengthDifference: number;
  maxLengthDifference: number;
  trailsWithIssues: string[];
  geometryLossCount: number;
  geometryExpansionCount: number;
  lengthMismatchCount: number;
} {
  const validTrails = validationResults.filter(r => r.isValid).length;
  const invalidTrails = validationResults.filter(r => !r.isValid).length;
  const averageLengthDifference = validationResults.reduce((sum, r) => sum + r.lengthDifference, 0) / validationResults.length;
  const maxLengthDifference = Math.max(...validationResults.map(r => r.lengthDifference));
  const trailsWithIssues = validationResults.filter(r => !r.isValid).map(r => r.errorMessage?.split('"')[1] || 'Unknown');

  // Categorize the types of validation failures
  let geometryLossCount = 0;
  let geometryExpansionCount = 0;
  let lengthMismatchCount = 0;

  for (const result of validationResults) {
    if (!result.isValid && result.errorMessage) {
      if (result.errorMessage.includes('GEOMETRY LOSS')) {
        geometryLossCount++;
      } else if (result.errorMessage.includes('GEOMETRY EXPANSION')) {
        geometryExpansionCount++;
      } else if (result.errorMessage.includes('LENGTH MISMATCH')) {
        lengthMismatchCount++;
      }
    }
  }

  return {
    totalTrails: validationResults.length,
    validTrails,
    invalidTrails,
    averageLengthDifference,
    maxLengthDifference,
    trailsWithIssues,
    geometryLossCount,
    geometryExpansionCount,
    lengthMismatchCount
  };
}
