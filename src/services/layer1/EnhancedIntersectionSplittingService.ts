import { Pool } from 'pg';
import { CentralizedTrailSplitManager, CentralizedSplitConfig, TrailSplitOperation } from '../../utils/services/network-creation/centralized-trail-split-manager';
import { TrailSplitValidation } from '../../utils/validation/trail-split-validation';

export interface EnhancedIntersectionSplittingResult {
  trailsProcessed: number;
  segmentsCreated: number;
  originalTrailsDeleted: number;
  intersectionCount: number;
  validationResults: {
    totalTrailsValidated: number;
    successfulValidations: number;
    failedValidations: number;
    totalLengthDifferenceKm: number;
    averageLengthDifferencePercentage: number;
    validationErrors: string[];
  };
}

export class EnhancedIntersectionSplittingService {
  private splitManager: CentralizedTrailSplitManager;
  private validation: TrailSplitValidation;

  constructor(
    private pgClient: Pool,
    private stagingSchema: string,
    private config: any
  ) {
    // Initialize centralized split manager
    const centralizedConfig: CentralizedSplitConfig = {
      stagingSchema: stagingSchema,
      intersectionToleranceMeters: config?.intersectionTolerance || 5.0,
      minSegmentLengthMeters: 5.0,
      preserveOriginalTrailNames: true,
      validationToleranceMeters: 1.0,
      validationTolerancePercentage: 0.1
    };
    
    this.splitManager = CentralizedTrailSplitManager.getInstance(pgClient, centralizedConfig);
    
    // Initialize validation with strict tolerances for intersection splitting
    this.validation = new TrailSplitValidation(1.0, 0.1);
  }

  /**
   * Apply enhanced intersection splitting to trails using T/Y intersection detection
   * This splits trails at endpoint-to-trail intersections (T and Y patterns) to ensure proper network connectivity
   * Uses the same logic as the intersection preview script for consistent detection
   */
  async applyEnhancedIntersectionSplitting(): Promise<EnhancedIntersectionSplittingResult> {
    console.log('🔗 Applying enhanced T/Y intersection splitting...');
    
    const client = await this.pgClient.connect();
    const tolerance = this.config?.intersectionTolerance || 5; // Default 5m tolerance
    
    try {
      await client.query('BEGIN');
      
      // Step 1: Find T/Y intersections using endpoint-to-trail detection
      console.log(`   🔍 Finding T/Y intersections with ${tolerance}m tolerance...`);
      await client.query(`
        CREATE TEMP TABLE temp_intersection_points AS
        WITH trail_endpoints AS (
          SELECT 
            id as trail_id,
            app_uuid as trail_uuid,
            name as trail_name,
            'start' as endpoint,
            ST_AsText(ST_StartPoint(geometry)) as endpoint_geom,
            geometry as trail_geom
          FROM ${this.stagingSchema}.trails
          WHERE geometry IS NOT NULL 
            AND ST_IsValid(geometry)
            AND ST_Length(geometry::geography) > 5.0
            AND name NOT LIKE '%Segment%'
            AND original_trail_uuid IS NULL
          UNION ALL
          SELECT 
            id as trail_id,
            app_uuid as trail_uuid,
            name as trail_name,
            'end' as endpoint,
            ST_AsText(ST_EndPoint(geometry)) as endpoint_geom,
            geometry as trail_geom
          FROM ${this.stagingSchema}.trails
          WHERE geometry IS NOT NULL 
            AND ST_IsValid(geometry)
            AND ST_Length(geometry::geography) > 5.0
            AND name NOT LIKE '%Segment%'
            AND original_trail_uuid IS NULL
        ),
        intersections AS (
          SELECT 
            te1.trail_id as visitor_trail_id,
            te1.trail_uuid as visitor_trail_uuid,
            te1.trail_name as visitor_trail_name,
            te1.endpoint as visitor_endpoint,
            te2.id as visited_trail_id,
            te2.app_uuid as visited_trail_uuid,
            te2.name as visited_trail_name,
            te1.endpoint_geom as intersection_point,
            ST_Distance(ST_GeomFromText(te1.endpoint_geom, 4326)::geography, te2.geometry::geography) as distance_meters,
            CASE 
              WHEN te1.trail_id = te2.id THEN 'Y'  -- Same trail, different endpoints
              ELSE 'T'  -- Different trails
            END as intersection_type
          FROM trail_endpoints te1
          JOIN ${this.stagingSchema}.trails te2 ON te1.trail_id != te2.id
          WHERE ST_DWithin(ST_GeomFromText(te1.endpoint_geom, 4326)::geography, te2.geometry::geography, $1)
            AND NOT ST_Touches(ST_GeomFromText(te1.endpoint_geom, 4326), te2.geometry)
            AND ST_Distance(ST_GeomFromText(te1.endpoint_geom, 4326)::geography, te2.geometry::geography) <= $1
            AND te2.original_trail_uuid IS NULL
        ),
        snapped_intersections AS (
          SELECT 
            visitor_trail_id,
            visitor_trail_uuid,
            visitor_trail_name,
            visitor_endpoint,
            visited_trail_id,
            visited_trail_uuid,
            visited_trail_name,
            intersection_point,
            distance_meters,
            intersection_type,
            -- Snap to the nearest point on the visited trail
            ST_ClosestPoint(t.geometry, ST_GeomFromText(intersection_point, 4326)) as snapped_point
          FROM intersections i
          JOIN ${this.stagingSchema}.trails t ON i.visited_trail_id = t.id
        )
        SELECT 
          ROW_NUMBER() OVER () as point_id,
          snapped_point as the_geom,
          intersection_type,
          distance_meters,
          visitor_trail_id,
          visitor_trail_name,
          visited_trail_id,
          visited_trail_name
        FROM snapped_intersections
        ORDER BY distance_meters ASC
      `, [tolerance]);
      
      const intersectionCount = await client.query(`SELECT COUNT(*) as count FROM temp_intersection_points`);
      console.log(`   🔍 Found ${intersectionCount.rows[0].count} T/Y intersection points`);
      
      if (intersectionCount.rows[0].count === 0) {
        await client.query('COMMIT');
        return {
          trailsProcessed: 0,
          segmentsCreated: 0,
          originalTrailsDeleted: 0,
          intersectionCount: 0,
          validationResults: {
            totalTrailsValidated: 0,
            successfulValidations: 0,
            failedValidations: 0,
            totalLengthDifferenceKm: 0,
            averageLengthDifferencePercentage: 0,
            validationErrors: []
          }
        };
      }
      
      // Log intersection details
      const intersectionDetails = await client.query(`
        SELECT intersection_type, COUNT(*) as count 
        FROM temp_intersection_points 
        GROUP BY intersection_type
      `);
      for (const detail of intersectionDetails.rows) {
        console.log(`   📊 ${detail.intersection_type}-intersections: ${detail.count}`);
      }
      
      // Step 2: Get trails to split and prepare split operations
      console.log('   ✂️ Preparing split operations for T/Y intersection points...');
      const trailsToSplit = await client.query(`
        WITH trails_to_split AS (
          SELECT DISTINCT visited_trail_id as trail_id
          FROM temp_intersection_points
        )
        SELECT 
          t.id as original_trail_id,
          t.app_uuid as original_trail_uuid,
          t.name as original_trail_name,
          t.geometry as original_geometry,
          t.length_km,
          t.elevation_gain,
          t.elevation_loss,
          t.trail_type,
          t.surface,
          t.difficulty,
          t.source,
          -- Get all intersection points for this trail
          ARRAY_AGG(ip.the_geom ORDER BY ST_LineLocatePoint(t.geometry, ip.the_geom)) as intersection_points
        FROM ${this.stagingSchema}.trails t
        JOIN trails_to_split tts ON t.id = tts.trail_id
        JOIN temp_intersection_points ip ON t.id = ip.visited_trail_id
        WHERE t.original_trail_uuid IS NULL
        GROUP BY t.id, t.app_uuid, t.name, t.geometry, t.length_km, t.elevation_gain, t.elevation_loss, t.trail_type, t.surface, t.difficulty, t.source
      `);
      
      console.log(`   📍 Found ${trailsToSplit.rows.length} trails to split at intersections`);
      
      // Step 3: Process each trail using centralized split manager with validation
      let totalSegmentsCreated = 0;
      let totalTrailsProcessed = 0;
      const validationResults = {
        totalTrailsValidated: 0,
        successfulValidations: 0,
        failedValidations: 0,
        totalLengthDifferenceKm: 0,
        averageLengthDifferencePercentage: 0,
        validationErrors: [] as string[]
      };
      
      for (const trail of trailsToSplit.rows) {
        try {
          console.log(`   🔄 Processing trail: ${trail.original_trail_name} (${trail.original_trail_uuid})`);
          
          // Pre-split validation: Check original trail length
          const originalLengthKm = trail.length_km || 0;
          if (originalLengthKm <= 0) {
            console.warn(`   ⚠️ Skipping trail ${trail.original_trail_name}: Invalid length ${originalLengthKm}km`);
            continue;
          }
          
          console.log(`   📏 Original trail length: ${originalLengthKm.toFixed(3)}km`);
          
          // Convert intersection points to split points
          const splitPoints = [];
          for (const intersectionPoint of trail.intersection_points) {
            // Get coordinates of intersection point
            const pointResult = await client.query(`
              SELECT ST_X($1) as lng, ST_Y($1) as lat, 
                     ST_LineLocatePoint($2, $1) * ST_Length($2::geography) as distance_m
            `, [intersectionPoint, trail.original_geometry]);
            
            const point = pointResult.rows[0];
            splitPoints.push({
              lng: point.lng,
              lat: point.lat,
              distance: point.distance_m / 1000.0 // Convert to km
            });
          }
          
          // Create split operation
          const splitOperation: TrailSplitOperation = {
            originalTrailId: trail.original_trail_uuid,
            originalTrailName: trail.original_trail_name,
            originalGeometry: trail.original_geometry,
            originalLengthKm: originalLengthKm,
            originalElevationGain: trail.elevation_gain || 0,
            originalElevationLoss: trail.elevation_loss || 0,
            splitPoints: splitPoints
          };
          
          // Execute atomic split with validation
          const splitResult = await this.splitManager.splitTrailAtomically(
            splitOperation,
            'EnhancedIntersectionSplittingService',
            'split',
            { intersectionPoints: trail.intersection_points }
          );
          
          // Track validation results
          validationResults.totalTrailsValidated++;
          if (splitResult.success) {
            validationResults.successfulValidations++;
            totalSegmentsCreated += splitResult.segmentsCreated;
            totalTrailsProcessed++;
            validationResults.totalLengthDifferenceKm += Math.abs(splitResult.lengthDifferenceKm);
            
            console.log(`   ✅ Successfully split ${trail.original_trail_name}: ${splitResult.segmentsCreated} segments, length diff: ${splitResult.lengthDifferenceKm.toFixed(3)}km (${splitResult.lengthDifferencePercentage.toFixed(2)}%)`);
          } else {
            validationResults.failedValidations++;
            validationResults.validationErrors.push(`${trail.original_trail_name}: ${splitResult.error}`);
            console.error(`   ❌ Failed to split ${trail.original_trail_name}: ${splitResult.error}`);
          }
          
        } catch (error) {
          validationResults.failedValidations++;
          const errorMsg = `Error processing trail ${trail.original_trail_name}: ${error instanceof Error ? error.message : String(error)}`;
          validationResults.validationErrors.push(errorMsg);
          console.error(`   ❌ ${errorMsg}`);
        }
      }
      
      // Calculate average length difference percentage
      if (validationResults.successfulValidations > 0) {
        validationResults.averageLengthDifferencePercentage = 
          validationResults.totalLengthDifferenceKm / validationResults.successfulValidations;
      }
      
      await client.query('COMMIT');
      
      // Print centralized split manager summary
      this.splitManager.printSummary();
      
      // Print validation summary
      console.log('\n📊 ENHANCED INTERSECTION SPLITTING VALIDATION SUMMARY');
      console.log('=' .repeat(60));
      console.log(`Total Trails Validated: ${validationResults.totalTrailsValidated}`);
      console.log(`Successful Validations: ${validationResults.successfulValidations}`);
      console.log(`Failed Validations: ${validationResults.failedValidations}`);
      console.log(`Success Rate: ${((validationResults.successfulValidations / validationResults.totalTrailsValidated) * 100).toFixed(1)}%`);
      console.log(`Total Length Difference: ${validationResults.totalLengthDifferenceKm.toFixed(3)}km`);
      console.log(`Average Length Difference: ${validationResults.averageLengthDifferencePercentage.toFixed(3)}km`);
      
      if (validationResults.validationErrors.length > 0) {
        console.log('\n❌ Validation Errors:');
        validationResults.validationErrors.forEach((error, index) => {
          console.log(`  ${index + 1}. ${error}`);
        });
      }
      console.log('=' .repeat(60));
      
      return {
        trailsProcessed: totalTrailsProcessed,
        segmentsCreated: totalSegmentsCreated,
        originalTrailsDeleted: totalTrailsProcessed,
        intersectionCount: intersectionCount.rows[0].count,
        validationResults
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error in enhanced intersection splitting:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}
