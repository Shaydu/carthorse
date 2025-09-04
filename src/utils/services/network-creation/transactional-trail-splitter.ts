import { Pool } from 'pg';
import { TrailSplitValidation } from '../../validation/trail-split-validation';

export interface TrailSplitConfig {
  stagingSchema: string;
  intersectionToleranceMeters: number;
  minSegmentLengthMeters: number;
  preserveOriginalTrailNames: boolean;
  validationToleranceMeters: number;
  validationTolerancePercentage: number;
}

export interface TrailSplitResult {
  success: boolean;
  originalTrailId: string;
  originalTrailName: string;
  segmentsCreated: number;
  totalLengthKm: number;
  originalLengthKm: number;
  lengthDifferenceKm: number;
  lengthDifferencePercentage: number;
  error?: string;
}

export interface TrailSplitOperation {
  originalTrailId: string;
  originalTrailName: string;
  originalGeometry: string;
  originalLengthKm: number;
  originalElevationGain: number;
  originalElevationLoss: number;
  splitPoints: Array<{
    lng: number;
    lat: number;
    distance: number;
  }>;
}

export class TransactionalTrailSplitter {
  private pgClient: Pool;
  private config: TrailSplitConfig;
  private validation: TrailSplitValidation;

  constructor(pgClient: Pool, config: TrailSplitConfig) {
    this.pgClient = pgClient;
    this.config = config;
    this.validation = new TrailSplitValidation(
      config.validationToleranceMeters,
      config.validationTolerancePercentage
    );
  }

  /**
   * Split a single trail atomically with validation and rollback
   */
  async splitTrailAtomically(operation: TrailSplitOperation): Promise<TrailSplitResult> {
    const client = await this.pgClient.connect();
    
    try {
      await client.query('BEGIN');
      
      console.log(`🔄 Starting atomic split for trail "${operation.originalTrailName}" (${operation.originalTrailId})`);
      console.log(`   📍 Split points: ${operation.splitPoints.length}`);
      console.log(`   📏 Original length: ${operation.originalLengthKm.toFixed(3)}km`);
      
      // Step 1: Create split segments
      const segments = await this.createSplitSegments(client, operation);
      
      if (segments.length <= 1) {
        await client.query('ROLLBACK');
        return {
          success: true,
          originalTrailId: operation.originalTrailId,
          originalTrailName: operation.originalTrailName,
          segmentsCreated: 1,
          totalLengthKm: operation.originalLengthKm,
          originalLengthKm: operation.originalLengthKm,
          lengthDifferenceKm: 0,
          lengthDifferencePercentage: 0
        };
      }
      
      // Step 2: Validate split segments before committing
      const validationResult = await this.validateSplitSegments(client, operation, segments);
      
      if (!validationResult.isValid) {
        // Log detailed error information before rollback
        console.error(`\n🚨 FATAL VALIDATION ERROR - ROLLING BACK TRANSACTION`);
        console.error(`   Trail: "${operation.originalTrailName}" (${operation.originalTrailId})`);
        console.error(`   Original Length: ${operation.originalLengthKm.toFixed(3)}km`);
        console.error(`   Segments Created: ${segments.length}`);
        console.error(`   Validation Error: ${validationResult.errorMessage}`);
        console.error(`   ⚠️  This trail will NOT be deleted to prevent data loss`);
        console.error(`   🔄 Rolling back transaction...\n`);
        
        await client.query('ROLLBACK');
        
        return {
          success: false,
          originalTrailId: operation.originalTrailId,
          originalTrailName: operation.originalTrailName,
          segmentsCreated: 0,
          totalLengthKm: 0,
          originalLengthKm: operation.originalLengthKm,
          lengthDifferenceKm: 0,
          lengthDifferencePercentage: 0,
          error: validationResult.errorMessage
        };
      }
      
      // Step 3: Insert new segments
      const segmentIds = await this.insertSplitSegments(client, operation, segments);
      
      // Step 4: Delete original trail
      await this.deleteOriginalTrail(client, operation.originalTrailId);
      
      // Step 5: Commit transaction
      await client.query('COMMIT');
      
      const totalLengthKm = segments.reduce((sum, seg) => sum + seg.lengthKm, 0);
      const lengthDifferenceKm = Math.abs(totalLengthKm - operation.originalLengthKm);
      const lengthDifferencePercentage = (lengthDifferenceKm / operation.originalLengthKm) * 100;
      
      console.log(`✅ Successfully split "${operation.originalTrailName}" into ${segments.length} segments`);
      console.log(`   📏 Total length: ${totalLengthKm.toFixed(3)}km (diff: ${lengthDifferenceKm.toFixed(3)}km, ${lengthDifferencePercentage.toFixed(2)}%)`);
      
      return {
        success: true,
        originalTrailId: operation.originalTrailId,
        originalTrailName: operation.originalTrailName,
        segmentsCreated: segments.length,
        totalLengthKm,
        originalLengthKm: operation.originalLengthKm,
        lengthDifferenceKm,
        lengthDifferencePercentage
      };
      
    } catch (error) {
      // Log detailed error information before rollback
      console.error(`\n🚨 FATAL TRANSACTION ERROR - ROLLING BACK TRANSACTION`);
      console.error(`   Trail: "${operation.originalTrailName}" (${operation.originalTrailId})`);
      console.error(`   Original Length: ${operation.originalLengthKm.toFixed(3)}km`);
      console.error(`   Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`);
      console.error(`   Error Message: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        console.error(`   Stack Trace: ${error.stack}`);
      }
      console.error(`   ⚠️  This trail will NOT be deleted to prevent data loss`);
      console.error(`   🔄 Rolling back transaction...\n`);
      
      await client.query('ROLLBACK');
      
      return {
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
    } finally {
      client.release();
    }
  }

  /**
   * Create split segments from original trail geometry
   */
  private async createSplitSegments(client: any, operation: TrailSplitOperation): Promise<Array<{
    geometry: string;
    lengthKm: number;
    elevationGain: number;
    elevationLoss: number;
  }>> {
    if (operation.splitPoints.length === 0) {
      return [{
        geometry: operation.originalGeometry,
        lengthKm: operation.originalLengthKm,
        elevationGain: operation.originalElevationGain,
        elevationLoss: operation.originalElevationLoss
      }];
    }

    // Sort intersection points by distance along the trail
    const sortedPoints = [...operation.splitPoints].sort((a, b) => a.distance - b.distance);
    
    let currentGeometry = operation.originalGeometry;
    const segments = [];
    
    for (const point of sortedPoints) {
      const pointWKT = `POINT(${point.lng} ${point.lat})`;
      
      // Find the closest point on the trail to the intersection point
      const closestPointQuery = `
        SELECT ST_ClosestPoint($1::geometry, ST_GeomFromText($2, 4326)) as closest_point
      `;
      
      const closestPointResult = await client.query(closestPointQuery, [
        currentGeometry,
        pointWKT
      ]);
      
      const closestPoint = closestPointResult.rows[0].closest_point;
      
      // Split the current geometry at the closest point
      const splitQuery = `
        SELECT 
          (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom as segment,
          (ST_Dump(ST_Split($1::geometry, $2::geometry))).path[1] as segment_id
        FROM (SELECT $1::geometry as geom) as g
      `;
      
      const splitResult = await client.query(splitQuery, [
        currentGeometry,
        closestPoint
      ]);
      
      if (splitResult.rows.length >= 2) {
        // Add the first segment to our results
        const firstSegment = splitResult.rows[0];
        const segmentLength = await this.calculateSegmentLength(client, firstSegment.segment);
        
        if (segmentLength >= this.config.minSegmentLengthMeters / 1000) { // Convert to km
          const lengthRatio = segmentLength / operation.originalLengthKm;
          segments.push({
            geometry: firstSegment.segment,
            lengthKm: segmentLength,
            elevationGain: operation.originalElevationGain * lengthRatio,
            elevationLoss: operation.originalElevationLoss * lengthRatio
          });
        }
        
        // Continue with the second segment for further splitting
        currentGeometry = splitResult.rows[1].segment;
      }
    }
    
    // Add the final segment
    const finalLength = await this.calculateSegmentLength(client, currentGeometry);
    if (finalLength >= this.config.minSegmentLengthMeters / 1000) { // Convert to km
      const lengthRatio = finalLength / operation.originalLengthKm;
      segments.push({
        geometry: currentGeometry,
        lengthKm: finalLength,
        elevationGain: operation.originalElevationGain * lengthRatio,
        elevationLoss: operation.originalElevationLoss * lengthRatio
      });
    }
    
    return segments;
  }

  /**
   * Calculate the length of a segment in kilometers
   */
  private async calculateSegmentLength(client: any, geometry: string): Promise<number> {
    const lengthQuery = `
      SELECT ST_Length($1::geometry::geography) / 1000.0 as length_km
    `;
    
    const result = await client.query(lengthQuery, [geometry]);
    return parseFloat(result.rows[0].length_km);
  }

  /**
   * Validate split segments before committing - ensures FULL geometry representation
   */
  private async validateSplitSegments(
    client: any, 
    operation: TrailSplitOperation, 
    segments: Array<{ geometry: string; lengthKm: number; elevationGain: number; elevationLoss: number; }>
  ): Promise<{ isValid: boolean; errorMessage?: string }> {
    try {
      console.log(`🔍 Validating split segments for "${operation.originalTrailName}"`);
      console.log(`   📊 Segments to validate: ${segments.length}`);
      
      // Step 1: Length validation
      const totalLengthKm = segments.reduce((sum, seg) => sum + seg.lengthKm, 0);
      const lengthDifferenceKm = Math.abs(totalLengthKm - operation.originalLengthKm);
      const lengthDifferencePercentage = (lengthDifferenceKm / operation.originalLengthKm) * 100;
      
      console.log(`   📏 Length check: Original ${operation.originalLengthKm.toFixed(3)}km, Split total ${totalLengthKm.toFixed(3)}km, Difference ${lengthDifferenceKm.toFixed(3)}km (${lengthDifferencePercentage.toFixed(2)}%)`);
      
      // Use the validation service to check if the split is valid
      const validationResult = this.validation.validateSplitLengths(
        operation.originalLengthKm,
        segments.map(s => s.lengthKm),
        operation.originalTrailName
      );
      
      if (!validationResult.isValid) {
        const errorMessage = `Length validation failed: Original ${operation.originalLengthKm.toFixed(3)}km, Split total ${totalLengthKm.toFixed(3)}km, Difference ${lengthDifferenceKm.toFixed(3)}km (${lengthDifferencePercentage.toFixed(2)}%)`;
        console.error(`   ❌ ${errorMessage}`);
        return { isValid: false, errorMessage };
      }
      
      // Step 2: Geometry coverage validation - ensure segments cover the full original geometry
      const geometryCoverageResult = await this.validateGeometryCoverage(client, operation, segments);
      if (!geometryCoverageResult.isValid) {
        console.error(`   ❌ Geometry coverage validation failed: ${geometryCoverageResult.errorMessage}`);
        return { isValid: false, errorMessage: geometryCoverageResult.errorMessage };
      }
      
      // Step 3: Ensure no gaps or overlaps in the split segments
      const continuityResult = await this.validateSegmentContinuity(client, operation, segments);
      if (!continuityResult.isValid) {
        console.error(`   ❌ Segment continuity validation failed: ${continuityResult.errorMessage}`);
        return { isValid: false, errorMessage: continuityResult.errorMessage };
      }
      
      console.log(`   ✅ All validations passed for "${operation.originalTrailName}"`);
      return { isValid: true };
      
    } catch (error) {
      const errorMessage = `Validation error: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`   ❌ ${errorMessage}`);
      return { isValid: false, errorMessage };
    }
  }

  /**
   * Validate that split segments cover the full original geometry
   */
  private async validateGeometryCoverage(
    client: any,
    operation: TrailSplitOperation,
    segments: Array<{ geometry: string; lengthKm: number; elevationGain: number; elevationLoss: number; }>
  ): Promise<{ isValid: boolean; errorMessage?: string }> {
    try {
      // Create parameterized query with proper WKB geometry conversion
      const segmentGeometryParams = segments.map((_, i) => `ST_GeomFromWKB(decode($${i + 2}, 'hex'))`).join(', ');
      
      // Check if the union of segments covers the original geometry
      const coverageQuery = `
        WITH segment_union AS (
          SELECT ST_Union(ARRAY[${segmentGeometryParams}]) as union_geom
        ),
        coverage_check AS (
          SELECT 
            ST_Area(ST_Difference($1, segment_union.union_geom)) as uncovered_area,
            ST_Length(ST_Difference($1, segment_union.union_geom)) as uncovered_length
          FROM segment_union
        )
        SELECT 
          uncovered_area,
          uncovered_length,
          CASE 
            WHEN uncovered_area > 0.000001 OR uncovered_length > 0.001 
            THEN false 
            ELSE true 
          END as is_fully_covered
        FROM coverage_check
      `;
      
      // Prepare parameters: original geometry first, then all segment geometries
      const params = [operation.originalGeometry, ...segments.map(s => s.geometry)];
      const result = await client.query(coverageQuery, params);
      const { uncovered_area, uncovered_length, is_fully_covered } = result.rows[0];
      
      if (!is_fully_covered) {
        return {
          isValid: false,
          errorMessage: `Geometry coverage validation failed: Uncovered area ${uncovered_area}, Uncovered length ${uncovered_length}m`
        };
      }
      
      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        errorMessage: `Geometry coverage validation error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Validate segment continuity - ensure no gaps or overlaps
   */
  private async validateSegmentContinuity(
    client: any,
    operation: TrailSplitOperation,
    segments: Array<{ geometry: string; lengthKm: number; elevationGain: number; elevationLoss: number; }>
  ): Promise<{ isValid: boolean; errorMessage?: string }> {
    try {
      if (segments.length <= 1) {
        return { isValid: true };
      }
      
      // Check for overlaps between segments
      for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
          const overlapQuery = `
            SELECT ST_Area(ST_Intersection(ST_GeomFromWKB(decode($1, 'hex')), ST_GeomFromWKB(decode($2, 'hex')))) as overlap_area
          `;
          
          const result = await client.query(overlapQuery, [segments[i].geometry, segments[j].geometry]);
          const overlapArea = parseFloat(result.rows[0].overlap_area);
          
          if (overlapArea > 0.000001) { // Allow tiny overlaps due to precision
            return {
              isValid: false,
              errorMessage: `Segment overlap detected between segments ${i + 1} and ${j + 1}: ${overlapArea} square meters`
            };
          }
        }
      }
      
      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        errorMessage: `Segment continuity validation error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Insert split segments into the database
   */
  private async insertSplitSegments(
    client: any, 
    operation: TrailSplitOperation, 
    segments: Array<{ geometry: string; lengthKm: number; elevationGain: number; elevationLoss: number; }>
  ): Promise<string[]> {
    const segmentIds: string[] = [];
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      // Generate a proper UUID for each segment
      const segmentUuidResult = await client.query('SELECT gen_random_uuid() as uuid');
      const segmentUuid = segmentUuidResult.rows[0].uuid;
      const segmentName = this.config.preserveOriginalTrailNames 
        ? `${operation.originalTrailName} Segment ${i + 1}`
        : `${operation.originalTrailName}_${i + 1}`;
      
      await client.query(`
        INSERT INTO ${this.config.stagingSchema}.trails (
          app_uuid, 
          original_trail_uuid,
          name, 
          geometry, 
          length_km, 
          elevation_gain, 
          elevation_loss,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        ) VALUES ($1, $2, $3, $4::geometry, $5, $6, $7, 
                  ST_XMin($4::geometry), ST_XMax($4::geometry), ST_YMin($4::geometry), ST_YMax($4::geometry))
      `, [
        segmentUuid,
        operation.originalTrailId, // Set original_trail_uuid for tracking
        segmentName,
        segment.geometry,
        segment.lengthKm,
        segment.elevationGain,
        segment.elevationLoss
      ]);
      
      segmentIds.push(segmentUuid);
    }
    
    return segmentIds;
  }

  /**
   * Delete the original trail
   */
  private async deleteOriginalTrail(client: any, originalTrailId: string): Promise<void> {
    await client.query(
      `DELETE FROM ${this.config.stagingSchema}.trails WHERE app_uuid = $1`,
      [originalTrailId]
    );
  }

  /**
   * Split multiple trails atomically
   */
  async splitMultipleTrailsAtomically(operations: TrailSplitOperation[]): Promise<TrailSplitResult[]> {
    const results: TrailSplitResult[] = [];
    
    console.log(`🔄 Starting atomic splitting of ${operations.length} trails`);
    
    for (const operation of operations) {
      const result = await this.splitTrailAtomically(operation);
      results.push(result);
      
      if (!result.success) {
        console.error(`❌ Failed to split trail "${operation.originalTrailName}": ${result.error}`);
      }
    }
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`📊 Atomic splitting complete: ${successful} successful, ${failed} failed`);
    
    return results;
  }

  /**
   * Get detailed logging information about a split operation
   */
  async getSplitLoggingInfo(originalTrailId: string): Promise<{
    originalTrail: any;
    splitSegments: any[];
    totalLengthKm: number;
    originalLengthKm: number;
    lengthDifferenceKm: number;
    lengthDifferencePercentage: number;
  } | null> {
    try {
      // Get original trail info (if it still exists)
      const originalQuery = `
        SELECT * FROM ${this.config.stagingSchema}.trails 
        WHERE app_uuid = $1
      `;
      const originalResult = await this.pgClient.query(originalQuery, [originalTrailId]);
      
      // Get split segments
      const segmentsQuery = `
        SELECT * FROM ${this.config.stagingSchema}.trails 
        WHERE original_trail_uuid = $1
        ORDER BY name
      `;
      const segmentsResult = await this.pgClient.query(segmentsQuery, [originalTrailId]);
      
      if (segmentsResult.rows.length === 0) {
        return null; // No split segments found
      }
      
      const totalLengthKm = segmentsResult.rows.reduce((sum, seg) => sum + (seg.length_km || 0), 0);
      const originalLengthKm = originalResult.rows[0]?.length_km || totalLengthKm;
      const lengthDifferenceKm = Math.abs(totalLengthKm - originalLengthKm);
      const lengthDifferencePercentage = originalLengthKm > 0 ? (lengthDifferenceKm / originalLengthKm) * 100 : 0;
      
      return {
        originalTrail: originalResult.rows[0] || null,
        splitSegments: segmentsResult.rows,
        totalLengthKm,
        originalLengthKm,
        lengthDifferenceKm,
        lengthDifferencePercentage
      };
      
    } catch (error) {
      console.error('Error getting split logging info:', error);
      return null;
    }
  }
}
