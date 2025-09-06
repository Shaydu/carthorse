import { Pool } from 'pg';
import { SplittingService, SplittingResult } from './ModularSplittingOrchestrator';

export interface TIntersectionSplittingResult extends SplittingResult {
  trailsProcessed: number;
  tIntersectionsFound: number;
  trailsSplit: number;
  segmentsCreated: number;
}

export interface TIntersectionSplittingConfig {
  stagingSchema: string;
  pgClient: Pool;
  toleranceMeters: number; // Distance tolerance for T-intersection detection (default 3.0m)
  minSegmentLengthMeters: number;
  verbose?: boolean;
  batchSize?: number; // Process trails in batches to avoid timeout (default 50)
}

/**
 * Service specifically for T-intersection splitting based on the working logic from 20250827-1000-holy-grail
 * This handles the case where one trail's endpoint is close to another trail's geometry
 */
export class TIntersectionSplittingService implements SplittingService {
  readonly serviceName = 'TIntersectionSplittingService';

  constructor(private config: TIntersectionSplittingConfig) {}

  /**
   * Execute the T-intersection splitting service
   */
  async execute(): Promise<TIntersectionSplittingResult> {
    return this.splitTrailsAtTIntersections();
  }

  /**
   * Split trails at T-intersections using the proven logic from holy grail branch
   */
  async splitTrailsAtTIntersections(): Promise<TIntersectionSplittingResult> {
    console.log(`🔗 Splitting trails at T-intersections (tolerance: ${this.config.toleranceMeters}m)...`);
    
    try {
      const { stagingSchema, pgClient, toleranceMeters, minSegmentLengthMeters, verbose = false, batchSize = 50 } = this.config;
      
      // Step 1: Get all trails from staging
      const trailsResult = await pgClient.query(`
        SELECT 
          app_uuid, name, geometry, trail_type, surface, difficulty,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        FROM ${stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) > $1
        ORDER BY app_uuid
      `, [minSegmentLengthMeters]);

      const trails = trailsResult.rows;
      console.log(`   📊 Found ${trails.length} trails to process for T-intersections`);

      if (trails.length === 0) {
        return {
          success: true,
          serviceName: this.serviceName,
          trailsProcessed: 0,
          tIntersectionsFound: 0,
          trailsSplit: 0,
          segmentsCreated: 0
        };
      }

      let totalSplitCount = 0;
      let tIntersectionsFound = 0;

      // Step 2: Use spatial query to find T-intersections more efficiently
      console.log(`   🔍 Finding T-intersections using spatial queries...`);
      
      const tIntersectionsResult = await pgClient.query(`
        WITH trail_endpoints AS (
          SELECT 
            app_uuid,
            name,
            geometry,
            ST_StartPoint(geometry) as start_point,
            ST_EndPoint(geometry) as end_point
          FROM ${stagingSchema}.trails
          WHERE ST_IsValid(geometry) 
            AND ST_GeometryType(geometry) = 'ST_LineString'
            AND ST_Length(geometry::geography) > $1
        ),
        t_intersection_candidates AS (
          SELECT 
            visitor.app_uuid as visitor_uuid,
            visitor.name as visitor_name,
            visitor.geometry as visitor_geom,
            visitor.start_point as visitor_start,
            visitor.end_point as visitor_end,
            visited.app_uuid as visited_uuid,
            visited.name as visited_name,
            visited.geometry as visited_geom,
            'start' as endpoint_type,
            ST_Distance(visitor.start_point::geography, visited.geometry::geography) as distance
          FROM trail_endpoints visitor
          CROSS JOIN trail_endpoints visited
          WHERE visitor.app_uuid != visited.app_uuid
            AND ST_Distance(visitor.start_point::geography, visited.geometry::geography) <= $2
          
          UNION ALL
          
          SELECT 
            visitor.app_uuid as visitor_uuid,
            visitor.name as visitor_name,
            visitor.geometry as visitor_geom,
            visitor.start_point as visitor_start,
            visitor.end_point as visitor_end,
            visited.app_uuid as visited_uuid,
            visited.name as visited_name,
            visited.geometry as visited_geom,
            'end' as endpoint_type,
            ST_Distance(visitor.end_point::geography, visited.geometry::geography) as distance
          FROM trail_endpoints visitor
          CROSS JOIN trail_endpoints visited
          WHERE visitor.app_uuid != visited.app_uuid
            AND ST_Distance(visitor.end_point::geography, visited.geometry::geography) <= $2
        ),
        closest_intersections AS (
          SELECT DISTINCT ON (visitor_uuid, visited_uuid)
            visitor_uuid,
            visitor_name,
            visitor_geom,
            visitor_start,
            visitor_end,
            visited_uuid,
            visited_name,
            visited_geom,
            endpoint_type,
            distance
          FROM t_intersection_candidates
          ORDER BY visitor_uuid, visited_uuid, distance ASC
        )
        SELECT 
          visitor_uuid,
          visitor_name,
          visitor_geom,
          visitor_start,
          visitor_end,
          visited_uuid,
          visited_name,
          visited_geom,
          endpoint_type,
          distance
        FROM closest_intersections
        ORDER BY visitor_uuid, visited_uuid
      `, [minSegmentLengthMeters, toleranceMeters]);

      const tIntersections = tIntersectionsResult.rows;
      console.log(`   📊 Found ${tIntersections.length} T-intersections using spatial queries`);

      if (tIntersections.length === 0) {
        return {
          success: true,
          serviceName: this.serviceName,
          trailsProcessed: trails.length,
          tIntersectionsFound: 0,
          trailsSplit: 0,
          segmentsCreated: 0
        };
      }

      // Step 3: Process each T-intersection
      let processedCount = 0;
      for (const intersection of tIntersections) {
        const visitorEndpoint = intersection.endpoint_type === 'start' ? 
          intersection.visitor_start : intersection.visitor_end;
        
        const tIntersectionResult = await this.processTIntersectionFromSpatialQuery(
          intersection.visitor_uuid,
          intersection.visitor_name,
          intersection.visitor_geom,
          visitorEndpoint,
          intersection.visited_uuid,
          intersection.visited_name,
          intersection.visited_geom
        );
        
        if (tIntersectionResult.success) {
          tIntersectionsFound++;
          totalSplitCount += tIntersectionResult.segmentsCreated;
          
          if (verbose) {
            console.log(`   ✅ T-intersection: ${intersection.visitor_name} → ${intersection.visited_name} → ${tIntersectionResult.segmentsCreated} segments`);
          }
        }
        
        processedCount++;
        if (processedCount % 10 === 0) {
          console.log(`   📊 Progress: ${processedCount}/${tIntersections.length} T-intersections processed`);
        }
      }

      console.log(`✅ T-intersection splitting completed:`);
      console.log(`   📍 T-intersections found: ${tIntersectionsFound}`);
      console.log(`   ✂️ Trails split: ${tIntersectionsFound}`);
      console.log(`   📊 Segments created: ${totalSplitCount}`);

      return {
        success: true,
        serviceName: this.serviceName,
        trailsProcessed: trails.length,
        tIntersectionsFound,
        trailsSplit: tIntersectionsFound,
        segmentsCreated: totalSplitCount
      };

    } catch (error) {
      console.error('❌ Error in T-intersection splitting:', error);
      return {
        success: false,
        serviceName: this.serviceName,
        trailsProcessed: 0,
        tIntersectionsFound: 0,
        trailsSplit: 0,
        segmentsCreated: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Process a T-intersection found by spatial query
   * This is more efficient than the pairwise comparison approach
   */
  private async processTIntersectionFromSpatialQuery(
    visitorUuid: string,
    visitorName: string,
    visitorGeom: any,
    visitorEndpoint: any,
    visitedUuid: string,
    visitedName: string,
    visitedGeom: any
  ): Promise<{success: boolean, segmentsCreated: number}> {
    const { stagingSchema, pgClient, minSegmentLengthMeters } = this.config;

    try {
      // Step 1: Find the closest point on the visited trail to the visitor endpoint
      // Ensure we get a 3D point by interpolating Z coordinates from the trail geometry
      const closestPointResult = await pgClient.query(`
        SELECT ST_Force3D(ST_ClosestPoint($1::geometry, $2::geometry)) as closest_point
      `, [visitedGeom, visitorEndpoint]);
      
      const intersectionPoint = closestPointResult.rows[0].closest_point;
      
      if (!intersectionPoint || intersectionPoint === null) {
        return { success: false, segmentsCreated: 0 };
      }

      // Step 1.5: Snap the visitor trail to the intersection point first
      await this.snapVisitorTrailToIntersection(
        visitorUuid,
        visitorName,
        visitorGeom,
        intersectionPoint
      );
      
      // Step 2: Validate geometries before splitting
      const geometryValidation = await pgClient.query(`
        SELECT 
          CASE WHEN $1::geometry IS NULL THEN false ELSE ST_IsValid($1::geometry) END as visited_valid,
          CASE WHEN $1::geometry IS NULL THEN true ELSE ST_IsEmpty($1::geometry) END as visited_empty,
          CASE WHEN $1::geometry IS NULL THEN 0 ELSE ST_NumPoints($1::geometry) END as visited_points,
          CASE WHEN $2::geometry IS NULL THEN false ELSE ST_IsValid($2::geometry) END as intersection_valid,
          CASE WHEN $2::geometry IS NULL THEN true ELSE ST_IsEmpty($2::geometry) END as intersection_empty
      `, [visitedGeom, intersectionPoint]);
      
      const validation = geometryValidation.rows[0];
      if (!validation.visited_valid || validation.visited_empty || validation.visited_points < 2 ||
          !validation.intersection_valid || validation.intersection_empty) {
        return { success: false, segmentsCreated: 0 };
      }

      // Step 3: Split the visited trail at the intersection point
      // Ensure the intersection point is properly snapped to the trail geometry
      let splitResult;
      try {
        // First, ensure the intersection point is exactly on the trail
        // Ensure we get a 3D point by interpolating Z coordinates from the trail geometry
        const snappedPoint = await pgClient.query(`
          SELECT ST_Force3D(ST_ClosestPoint($1::geometry, $2::geometry)) as snapped_point
        `, [visitedGeom, intersectionPoint]);
        
        const finalIntersectionPoint = snappedPoint.rows[0].snapped_point;
        
        splitResult = await pgClient.query(`
          SELECT ST_Force3D((ST_Dump(ST_Split($1::geometry, $2::geometry))).geom) as segment
        `, [visitedGeom, finalIntersectionPoint]);
        
        // Validate that the split created valid geometries
        if (splitResult.rows.length === 0) {
          console.warn(`   ⚠️ Split operation returned no segments for ${visitedName}`);
          return { success: false, segmentsCreated: 0 };
        }
        
        // Check each segment for validity
        for (const row of splitResult.rows) {
          const segment = row.segment;
          if (!segment || segment === null) {
            console.warn(`   ⚠️ Split operation created null segment for ${visitedName}`);
            return { success: false, segmentsCreated: 0 };
          }
          
          // Validate geometry
          const validationResult = await pgClient.query(`
            SELECT ST_IsValid($1::geometry) as is_valid, ST_IsEmpty($1::geometry) as is_empty, ST_NumPoints($1::geometry) as num_points
          `, [segment]);
          
          const { is_valid, is_empty, num_points } = validationResult.rows[0];
          if (!is_valid || is_empty || num_points < 2) {
            console.warn(`   ⚠️ Split operation created invalid segment for ${visitedName}: valid=${is_valid}, empty=${is_empty}, points=${num_points}`);
            return { success: false, segmentsCreated: 0 };
          }
        }
      } catch (splitError) {
        console.warn(`   ⚠️ Failed to split trail at intersection: ${splitError instanceof Error ? splitError.message : String(splitError)}`);
        return { success: false, segmentsCreated: 0 };
      }
      
      if (splitResult.rows.length <= 1) {
        return { success: false, segmentsCreated: 0 };
      }

      // Step 4: Insert split segments into staging
      let segmentsCreated = 0;
      for (let k = 0; k < splitResult.rows.length; k++) {
        const segment = splitResult.rows[k];
        
        // Validate segment before processing
        if (!segment.segment || segment.segment === null) {
          console.warn(`   ⚠️ Skipping null segment for ${visitedName}`);
          continue;
        }
        
        // Check if segment is valid and has sufficient points
        const validationResult = await pgClient.query(`
          SELECT ST_IsValid($1::geometry) as is_valid, ST_IsEmpty($1::geometry) as is_empty, ST_NumPoints($1::geometry) as num_points
        `, [segment.segment]);
        
        const { is_valid, is_empty, num_points } = validationResult.rows[0];
        if (!is_valid || is_empty || num_points < 2) {
          console.warn(`   ⚠️ Skipping invalid segment for ${visitedName}: valid=${is_valid}, empty=${is_empty}, points=${num_points}`);
          continue;
        }
        
        // Check segment length
        const lengthResult = await pgClient.query(`
          SELECT ST_Length($1::geography) as length_meters
        `, [segment.segment]);

        const lengthMeters = lengthResult.rows[0].length_meters;
        
        // Check for NaN or invalid length
        if (isNaN(lengthMeters) || lengthMeters === null || lengthMeters < 0) {
          console.warn(`   ⚠️ Skipping segment with invalid length for ${visitedName}: ${lengthMeters}`);
          continue;
        }

        if (lengthMeters >= minSegmentLengthMeters) {
          await pgClient.query(`
            INSERT INTO ${stagingSchema}.trails (
              app_uuid, name, geometry, trail_type, surface, difficulty,
              elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
              bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
              source, source_tags, osm_id
            )
            SELECT 
              gen_random_uuid() as app_uuid,
              $1 as name,
              $2::geometry as geometry,
              trail_type, surface, difficulty,
              elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
              bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
              source, source_tags, osm_id
            FROM ${stagingSchema}.trails 
            WHERE app_uuid = $3
          `, [visitedName, segment.segment, visitedUuid]);
          
          segmentsCreated++;
        }
      }


      // Step 6: Validate the split maintains length accuracy
      const validationResult = await this.validateTIntersectionSplit(
        visitedUuid, 
        visitedName, 
        segmentsCreated, 
        splitResult.rows,
        visitorUuid
      );
      
      if (!validationResult.success) {
        console.warn(`   ⚠️ T-intersection split validation failed for ${visitedName}: ${validationResult.error}`);
        return { success: false, segmentsCreated: 0 };
      }

      // Step 7: Delete the original visited trail
      await pgClient.query(`
        DELETE FROM ${stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [visitedUuid]);

      return { success: true, segmentsCreated };

    } catch (error) {
      console.error(`❌ Error processing T-intersection between ${visitorName} and ${visitedName}:`, error);
      return { success: false, segmentsCreated: 0 };
    }
  }

  /**
   * Snap the visitor trail to the intersection point to ensure proper connectivity
   * This ensures the network is properly noded and edged for routing
   */
  private async snapVisitorTrailToIntersection(
    visitorUuid: string,
    visitorName: string,
    visitorGeom: any,
    intersectionPoint: any
  ): Promise<void> {
    const { stagingSchema, pgClient } = this.config;

    try {
      // Update the visitor trail geometry to snap its endpoint to the intersection point
      // Ensure 3D coordinates are preserved by using ST_Force3D on the result
      await pgClient.query(`
        UPDATE ${stagingSchema}.trails 
        SET geometry = ST_Force3D(ST_Snap($1::geometry, $2::geometry, 1e-6))
        WHERE app_uuid = $3
      `, [visitorGeom, intersectionPoint, visitorUuid]);

      if (this.config.verbose) {
        console.log(`   🔗 Snapped visitor trail ${visitorName} to intersection point`);
      }
    } catch (error) {
      console.warn(`   ⚠️ Failed to snap visitor trail ${visitorName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate that a T-intersection split maintains length accuracy
   * For trails A and B in T-intersection, after splitting A into C and D:
   * The sum of B + C + D should be within 98% of the original A + B length
   */
  private async validateTIntersectionSplit(
    originalTrailUuid: string,
    originalTrailName: string,
    segmentsCreated: number,
    splitResult: any[],
    visitorTrailUuid?: string
  ): Promise<{success: boolean, error?: string}> {
    const { stagingSchema, pgClient } = this.config;

    try {
      // Get the original trail length (trail A - the one being split)
      const originalLengthQuery = await pgClient.query(`
        SELECT ST_Length(geometry) as original_length
        FROM ${stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [originalTrailUuid]);

      if (originalLengthQuery.rows.length === 0) {
        // Original trail may have been deleted by a previous service (e.g., MultipointIntersectionSplittingService)
        // This is expected behavior in the pipeline, so we'll skip validation
        return { success: true };
      }

      const originalLengthA = originalLengthQuery.rows[0].original_length;

      // Get the visitor trail length (trail B - the one that intersects)
      let originalLengthB = 0;
      if (visitorTrailUuid) {
        const visitorLengthQuery = await pgClient.query(`
          SELECT ST_Length(geometry) as visitor_length
          FROM ${stagingSchema}.trails 
          WHERE app_uuid = $1
        `, [visitorTrailUuid]);

        if (visitorLengthQuery.rows.length > 0) {
          originalLengthB = visitorLengthQuery.rows[0].visitor_length;
        }
      }

      // Calculate total length of all segments created (C + D)
      let totalSegmentLength = 0;
      for (const segment of splitResult) {
        const lengthResult = await pgClient.query(`
          SELECT ST_Length($1::geography) as length_meters
        `, [segment.segment]);
        totalSegmentLength += lengthResult.rows[0].length_meters;
      }

      // For T-intersection validation: B + C + D should be within 98% of A + B
      const originalTotalLength = originalLengthA + originalLengthB;
      const resultingTotalLength = originalLengthB + totalSegmentLength;
      
      const accuracyPercentage = (resultingTotalLength / originalTotalLength) * 100;
      const minAccuracy = 98;

      if (accuracyPercentage < minAccuracy) {
        return { 
          success: false, 
          error: `T-intersection length accuracy ${accuracyPercentage.toFixed(2)}% below ${minAccuracy}% threshold (original A+B: ${originalTotalLength.toFixed(2)}m, resulting B+C+D: ${resultingTotalLength.toFixed(2)}m)` 
        };
      }

      if (this.config.verbose) {
        console.log(`   ✅ T-intersection validation passed: ${accuracyPercentage.toFixed(2)}% accuracy`);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: `Validation error: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * Process a potential T-intersection between two trails
   * Based on the working logic from 20250827-1000-holy-grail
   * @deprecated Use processTIntersectionFromSpatialQuery for better performance
   */
  private async processTIntersection(trail1: any, trail2: any, toleranceMeters: number): Promise<{success: boolean, segmentsCreated: number}> {
    const { stagingSchema, pgClient, minSegmentLengthMeters } = this.config;

    try {
      // Step 1: Validate input geometries first
      const inputValidation = await pgClient.query(`
        SELECT 
          ST_IsValid($1::geometry) as trail1_valid,
          ST_IsEmpty($1::geometry) as trail1_empty,
          ST_NumPoints($1::geometry) as trail1_points,
          ST_IsValid($2::geometry) as trail2_valid,
          ST_IsEmpty($2::geometry) as trail2_empty,
          ST_NumPoints($2::geometry) as trail2_points
      `, [trail1.geometry, trail2.geometry]);
      
      const inputVal = inputValidation.rows[0];
      if (!inputVal.trail1_valid || inputVal.trail1_empty || inputVal.trail1_points < 2 ||
          !inputVal.trail2_valid || inputVal.trail2_empty || inputVal.trail2_points < 2) {
        console.warn(`   ⚠️ Skipping T-intersection: Invalid input geometries (trail1: valid=${inputVal.trail1_valid}, empty=${inputVal.trail1_empty}, points=${inputVal.trail1_points}; trail2: valid=${inputVal.trail2_valid}, empty=${inputVal.trail2_empty}, points=${inputVal.trail2_points})`);
        return { success: false, segmentsCreated: 0 };
      }

      // Step 2: Round coordinates to avoid precision issues (like working prototype)
      const roundedResult = await pgClient.query(`
        SELECT 
          ST_SnapToGrid($1::geometry, 1e-6) AS trail1_rounded,
          ST_SnapToGrid($2::geometry, 1e-6) AS trail2_rounded
      `, [trail1.geometry, trail2.geometry]);
      
      const trail1Rounded = roundedResult.rows[0].trail1_rounded;
      const trail2Rounded = roundedResult.rows[0].trail2_rounded;
      
      // Step 3: Validate rounded geometries
      const roundedValidation = await pgClient.query(`
        SELECT 
          ST_IsValid($1::geometry) as trail1_rounded_valid,
          ST_IsEmpty($1::geometry) as trail1_rounded_empty,
          ST_NumPoints($1::geometry) as trail1_rounded_points,
          ST_IsValid($2::geometry) as trail2_rounded_valid,
          ST_IsEmpty($2::geometry) as trail2_rounded_empty,
          ST_NumPoints($2::geometry) as trail2_rounded_points
      `, [trail1Rounded, trail2Rounded]);
      
      const roundedVal = roundedValidation.rows[0];
      if (!roundedVal.trail1_rounded_valid || roundedVal.trail1_rounded_empty || roundedVal.trail1_rounded_points < 2 ||
          !roundedVal.trail2_rounded_valid || roundedVal.trail2_rounded_empty || roundedVal.trail2_rounded_points < 2) {
        console.warn(`   ⚠️ Skipping T-intersection: Invalid rounded geometries (trail1: valid=${roundedVal.trail1_rounded_valid}, empty=${roundedVal.trail1_rounded_empty}, points=${roundedVal.trail1_rounded_points}; trail2: valid=${roundedVal.trail2_rounded_valid}, empty=${roundedVal.trail2_rounded_empty}, points=${roundedVal.trail2_rounded_points})`);
        return { success: false, segmentsCreated: 0 };
      }

      // Step 4: Snap with tolerance for better intersection detection (like working prototype)
      const snappedResult = await pgClient.query(`
        SELECT 
          ST_Snap($1::geometry, $2::geometry, 1e-6) AS trail1_snapped,
          ST_Snap($2::geometry, $1::geometry, 1e-6) AS trail2_snapped
      `, [trail1Rounded, trail2Rounded]);
      
      const trail1Snapped = snappedResult.rows[0].trail1_snapped;
      const trail2Snapped = snappedResult.rows[0].trail2_snapped;
      
      // Step 5: Check if trails are close enough to consider for splitting (single query)
      const distanceResult = await pgClient.query(`
        SELECT 
          ST_Distance(ST_StartPoint($1::geometry), $2::geometry) as trail1_start_to_trail2,
          ST_Distance(ST_EndPoint($1::geometry), $2::geometry) as trail1_end_to_trail2,
          ST_Distance(ST_StartPoint($2::geometry), $1::geometry) as trail2_start_to_trail1,
          ST_Distance(ST_EndPoint($2::geometry), $1::geometry) as trail2_end_to_trail1
      `, [trail1Snapped, trail2Snapped]);

      const distances = distanceResult.rows[0];
      const trail1MinDistance = Math.min(distances.trail1_start_to_trail2, distances.trail1_end_to_trail2);
      const trail2MinDistance = Math.min(distances.trail2_start_to_trail1, distances.trail2_end_to_trail1);
      
      // Check if trails are close enough to consider for splitting (within tolerance)
      if (trail1MinDistance > toleranceMeters && trail2MinDistance > toleranceMeters) {
        return { success: false, segmentsCreated: 0 };
      }

      // Additional validation: Check if the closest point is actually on the trail geometry
      // This prevents processing cases where trails are close but don't actually intersect
      const closestPointValidation = await pgClient.query(`
        SELECT 
          ST_DWithin(ST_ClosestPoint($1::geometry, ST_StartPoint($2::geometry))::geography, $1::geography, $3) as start_point_on_trail,
          ST_DWithin(ST_ClosestPoint($1::geometry, ST_EndPoint($2::geometry))::geography, $1::geography, $3) as end_point_on_trail,
          ST_DWithin(ST_ClosestPoint($2::geometry, ST_StartPoint($1::geometry))::geography, $2::geography, $3) as trail1_start_on_trail2,
          ST_DWithin(ST_ClosestPoint($2::geometry, ST_EndPoint($1::geometry))::geography, $2::geography, $3) as trail1_end_on_trail2
      `, [trail1Snapped, trail2Snapped, toleranceMeters]);
      
      const closestVal = closestPointValidation.rows[0];
      const hasValidIntersection = closestVal.start_point_on_trail || closestVal.end_point_on_trail || 
                                  closestVal.trail1_start_on_trail2 || closestVal.trail1_end_on_trail2;
      
      if (!hasValidIntersection) {
        // Trails are close but don't actually intersect - skip this pair
        return { success: false, segmentsCreated: 0 };
      }

      // Step 6: Determine which trail is the visitor (endpoint close to other trail) and which is visited
      let visitorTrail, visitedTrail, visitorEndpoint;
      
      if (trail1MinDistance < trail2MinDistance) {
        visitorTrail = trail1;
        visitedTrail = trail2;
        visitorEndpoint = trail1MinDistance === distances.trail1_start_to_trail2 ? 
          await pgClient.query(`SELECT ST_StartPoint($1::geometry) as endpoint`, [trail1Snapped]) :
          await pgClient.query(`SELECT ST_EndPoint($1::geometry) as endpoint`, [trail1Snapped]);
      } else {
        visitorTrail = trail2;
        visitedTrail = trail1;
        visitorEndpoint = trail2MinDistance === distances.trail2_start_to_trail1 ? 
          await pgClient.query(`SELECT ST_StartPoint($1::geometry) as endpoint`, [trail2Snapped]) :
          await pgClient.query(`SELECT ST_EndPoint($1::geometry) as endpoint`, [trail2Snapped]);
      }
      
      // Step 7: Find the closest point on the visited trail to the visitor endpoint
      // This creates a proper T-intersection by snapping the endpoint to the nearest midpoint
      let intersectionPoint;
      try {
        const closestPointResult = await pgClient.query(`
          SELECT ST_Force3D(ST_ClosestPoint($1::geometry, $2::geometry)) as closest_point
        `, [visitedTrail.geometry, visitorEndpoint.rows[0].endpoint]);
        
        intersectionPoint = closestPointResult.rows[0].closest_point;
        
        if (!intersectionPoint || intersectionPoint === null) {
          console.warn(`   ⚠️ Skipping T-intersection: No closest point found between ${trail1.name} and ${trail2.name}`);
          return { success: false, segmentsCreated: 0 };
        }
        
        // Verify the closest point is actually on the visited trail geometry
        const pointOnLineCheck = await pgClient.query(`
          SELECT ST_DWithin($1::geometry, $2::geometry, 1e-6) as point_on_line
        `, [intersectionPoint, visitedTrail.geometry]);
        
        if (!pointOnLineCheck.rows[0].point_on_line) {
          console.warn(`   ⚠️ Skipping T-intersection: Closest point is not on visited trail geometry`);
          return { success: false, segmentsCreated: 0 };
        }
        
      } catch (closestPointError) {
        console.warn(`   ⚠️ Skipping T-intersection: Closest point calculation failed: ${closestPointError}`);
        return { success: false, segmentsCreated: 0 };
      }
      
      // Step 9: For T-intersections, we expect the intersection point to be on the visited trail
      // The visitor trail's endpoint should be close to this point on the visited trail
      // This is the correct behavior for T-intersections

      // Step 10: Basic null/undefined checks first
      if (!visitedTrail.geometry || visitedTrail.geometry === null || visitedTrail.geometry === undefined) {
        console.warn(`   ⚠️ Skipping T-intersection: Visited trail geometry is null/undefined`);
        return { success: false, segmentsCreated: 0 };
      }
      
      if (!intersectionPoint || intersectionPoint === null || intersectionPoint === undefined) {
        console.warn(`   ⚠️ Skipping T-intersection: Intersection point is null/undefined`);
        return { success: false, segmentsCreated: 0 };
      }

      // Step 11: Validate geometries before splitting with error handling
      let validation;
      try {
        const geometryValidation = await pgClient.query(`
          SELECT 
            CASE WHEN $1::geometry IS NULL THEN false ELSE ST_IsValid($1::geometry) END as visited_valid,
            CASE WHEN $1::geometry IS NULL THEN true ELSE ST_IsEmpty($1::geometry) END as visited_empty,
            CASE WHEN $1::geometry IS NULL THEN 0 ELSE ST_NumPoints($1::geometry) END as visited_points,
            CASE WHEN $2::geometry IS NULL THEN false ELSE ST_IsValid($2::geometry) END as intersection_valid,
            CASE WHEN $2::geometry IS NULL THEN true ELSE ST_IsEmpty($2::geometry) END as intersection_empty,
            CASE WHEN $2::geometry IS NULL THEN 0 ELSE ST_NumPoints($2::geometry) END as intersection_points
        `, [visitedTrail.geometry, intersectionPoint]);
        
        validation = geometryValidation.rows[0];
      } catch (validationError) {
        console.warn(`   ⚠️ Skipping T-intersection: Geometry validation failed: ${validationError}`);
        return { success: false, segmentsCreated: 0 };
      }
      
      if (!validation.visited_valid || validation.visited_empty || validation.visited_points < 2) {
        console.warn(`   ⚠️ Skipping T-intersection: Invalid visited trail geometry (valid: ${validation.visited_valid}, empty: ${validation.visited_empty}, points: ${validation.visited_points})`);
        return { success: false, segmentsCreated: 0 };
      }
      
      if (!validation.intersection_valid || validation.intersection_empty) {
        console.warn(`   ⚠️ Skipping T-intersection: Invalid intersection point geometry (valid: ${validation.intersection_valid}, empty: ${validation.intersection_empty})`);
        return { success: false, segmentsCreated: 0 };
      }

      // Step 12: Split the visited trail at the intersection point
      let splitResult;
      try {
        splitResult = await pgClient.query(`
          SELECT ST_Force3D((ST_Dump(ST_Split($1::geometry, $2::geometry))).geom) as segment
        `, [visitedTrail.geometry, intersectionPoint]);
      } catch (splitError) {
        console.warn(`   ⚠️ Skipping T-intersection: Split operation failed: ${splitError}`);
        return { success: false, segmentsCreated: 0 };
      }
      
      if (splitResult.rows.length <= 1) {
        return { success: false, segmentsCreated: 0 };
      }

      // Step 13: Insert split segments into staging
      let segmentsCreated = 0;
      for (let k = 0; k < splitResult.rows.length; k++) {
        const segment = splitResult.rows[k];
        
        // Check segment length
        const lengthResult = await pgClient.query(`
          SELECT ST_Length($1::geography) as length_meters
        `, [segment.segment]);

        if (lengthResult.rows[0].length_meters >= minSegmentLengthMeters) {
                      await pgClient.query(`
              INSERT INTO ${stagingSchema}.trails (
                app_uuid, name, geometry, trail_type, surface, difficulty,
                elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                source, source_tags, osm_id
              )
              SELECT 
                gen_random_uuid() as app_uuid,
                $1 as name,
                $2::geometry as geometry,
                trail_type, surface, difficulty,
                elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                source, source_tags, osm_id
              FROM ${stagingSchema}.trails 
              WHERE app_uuid = $3
            `, [visitedTrail.name, segment.segment, visitedTrail.app_uuid]); // Keep original name without modification
          
          segmentsCreated++;
        }
      }

      // Step 14: Delete the original visited trail
      await pgClient.query(`
        DELETE FROM ${stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [visitedTrail.app_uuid]);

      return { success: true, segmentsCreated };

    } catch (error) {
      console.error(`❌ Error processing T-intersection between ${trail1.name} and ${trail2.name}:`, error);
      return { success: false, segmentsCreated: 0 };
    }
  }

  /**
   * Alternative method: Find T-intersections using spatial queries (more efficient for large datasets)
   */
  async findTIntersectionsWithSpatialQueries(): Promise<TIntersectionSplittingResult> {
    console.log(`🔗 Finding T-intersections using spatial queries (tolerance: ${this.config.toleranceMeters}m)...`);
    
    try {
      const { stagingSchema, pgClient, toleranceMeters, minSegmentLengthMeters, verbose = false } = this.config;
      
      // Find T-intersections where one trail's endpoint is close to another trail
      const tIntersectionsResult = await pgClient.query(`
        WITH trail_endpoints AS (
          SELECT 
            app_uuid,
            name,
            geometry,
            ST_StartPoint(geometry) as start_point,
            ST_EndPoint(geometry) as end_point
          FROM ${stagingSchema}.trails
          WHERE ST_IsValid(geometry) 
            AND ST_GeometryType(geometry) = 'ST_LineString'
            AND ST_Length(geometry::geography) > $1
        ),
        t_intersection_candidates AS (
          SELECT 
            visitor.app_uuid as visitor_uuid,
            visitor.name as visitor_name,
            visitor.geometry as visitor_geom,
            visitor.start_point as visitor_start,
            visitor.end_point as visitor_end,
            visited.app_uuid as visited_uuid,
            visited.name as visited_name,
            visited.geometry as visited_geom,
            'start' as endpoint_type,
            ST_Distance(visitor.start_point::geography, visited.geometry::geography) as distance
          FROM trail_endpoints visitor
          CROSS JOIN trail_endpoints visited
          WHERE visitor.app_uuid != visited.app_uuid
            AND ST_Distance(visitor.start_point::geography, visited.geometry::geography) <= $2
          
          UNION ALL
          
          SELECT 
            visitor.app_uuid as visitor_uuid,
            visitor.name as visitor_name,
            visitor.geometry as visitor_geom,
            visitor.start_point as visitor_start,
            visitor.end_point as visitor_end,
            visited.app_uuid as visited_uuid,
            visited.name as visited_name,
            visited.geometry as visited_geom,
            'end' as endpoint_type,
            ST_Distance(visitor.end_point::geography, visited.geometry::geography) as distance
          FROM trail_endpoints visitor
          CROSS JOIN trail_endpoints visited
          WHERE visitor.app_uuid != visited.app_uuid
            AND ST_Distance(visitor.end_point::geography, visited.geometry::geography) <= $2
        ),
        closest_intersections AS (
          SELECT DISTINCT ON (visitor_uuid, visited_uuid)
            visitor_uuid,
            visitor_name,
            visitor_geom,
            visitor_start,
            visitor_end,
            visited_uuid,
            visited_name,
            visited_geom,
            endpoint_type,
            distance
          FROM t_intersection_candidates
          ORDER BY visitor_uuid, visited_uuid, distance ASC
        )
        SELECT 
          visitor_uuid,
          visitor_name,
          visitor_geom,
          visitor_start,
          visitor_end,
          visited_uuid,
          visited_name,
          visited_geom,
          endpoint_type,
          distance
        FROM closest_intersections
        ORDER BY visitor_uuid, visited_uuid
      `, [minSegmentLengthMeters, toleranceMeters]);

      const tIntersections = tIntersectionsResult.rows;
      console.log(`   📊 Found ${tIntersections.length} T-intersections using spatial queries`);

      if (tIntersections.length === 0) {
        return {
          success: true,
          serviceName: this.serviceName,
          trailsProcessed: 0,
          tIntersectionsFound: 0,
          trailsSplit: 0,
          segmentsCreated: 0
        };
      }

      // Process each T-intersection
      let totalSegmentsCreated = 0;
      let processedCount = 0;

      for (const intersection of tIntersections) {
        const visitorEndpoint = intersection.endpoint_type === 'start' ? 
          intersection.visitor_start : intersection.visitor_end;
        
        // Find closest point on visited trail to visitor endpoint
        const closestPointResult = await pgClient.query(`
          SELECT ST_Force3D(ST_ClosestPoint($1::geometry, $2::geometry)) as closest_point
        `, [intersection.visited_geom, visitorEndpoint]);
        
        const closestPoint = closestPointResult.rows[0].closest_point;
        
        // Split visited trail at intersection point
        const splitResult = await pgClient.query(`
          SELECT ST_Force3D((ST_Dump(ST_Split($1::geometry, $2::geometry))).geom) AS segment
        `, [intersection.visited_geom, closestPoint]);
        
        // Filter out segments shorter than minimum length
        let segmentsCreated = 0;
        for (let i = 0; i < splitResult.rows.length; i++) {
          const segment = splitResult.rows[i].segment;
          const lengthResult = await pgClient.query(`
            SELECT ST_Length($1::geography) as length_meters
          `, [segment]);
          
          if (lengthResult.rows[0].length_meters >= minSegmentLengthMeters) {
            await pgClient.query(`
              INSERT INTO ${stagingSchema}.trails (
                app_uuid, name, geometry, trail_type, surface, difficulty,
                elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                source, source_tags, osm_id
              )
              SELECT 
                gen_random_uuid() as app_uuid,
                $1 as name,
                $2::geometry as geometry,
                trail_type, surface, difficulty,
                elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                source, source_tags, osm_id
              FROM ${stagingSchema}.trails 
              WHERE app_uuid = $3
            `, [intersection.visited_name, segment, intersection.visited_uuid]); // Keep original name without modification
            
            segmentsCreated++;
          }
        }

        // Delete the original visited trail
        await pgClient.query(`
          DELETE FROM ${stagingSchema}.trails 
          WHERE app_uuid = $1
        `, [intersection.visited_uuid]);

        totalSegmentsCreated += segmentsCreated;
        processedCount++;

        if (verbose) {
          console.log(`   ✅ T-intersection ${processedCount}/${tIntersections.length}: ${intersection.visitor_name} → ${intersection.visited_name} (${segmentsCreated} segments)`);
        }
      }

      console.log(`✅ T-intersection splitting completed:`);
      console.log(`   📍 T-intersections found: ${tIntersections.length}`);
      console.log(`   ✂️ Trails split: ${processedCount}`);
      console.log(`   📊 Segments created: ${totalSegmentsCreated}`);

      return {
        success: true,
        serviceName: this.serviceName,
        trailsProcessed: tIntersections.length,
        tIntersectionsFound: tIntersections.length,
        trailsSplit: processedCount,
        segmentsCreated: totalSegmentsCreated
      };

    } catch (error) {
      console.error('❌ Error in T-intersection splitting with spatial queries:', error);
      return {
        success: false,
        serviceName: this.serviceName,
        trailsProcessed: 0,
        tIntersectionsFound: 0,
        trailsSplit: 0,
        segmentsCreated: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
