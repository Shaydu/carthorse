import { Pool } from 'pg';
import { SplittingService, SplittingResult } from './ModularSplittingOrchestrator';

export interface ComplexIntersectionSplittingResult extends SplittingResult {
  trailsSplit: number;
  segmentsCreated: number;
  tIntersectionsProcessed: number;
  yIntersectionsProcessed: number;
  complexIntersectionsProcessed: number;
}

export interface ComplexIntersectionSplittingConfig {
  stagingSchema: string;
  pgClient: Pool;
  minSegmentLengthMeters: number;
  verbose?: boolean;
  tIntersectionToleranceMeters?: number;
  yIntersectionToleranceMeters?: number;
}

/**
 * Service to handle complex intersection splitting, specifically designed for
 * North Sky and Foothills North type intersections where:
 * - One trail's endpoint is close to another trail's midpoint
 * - T-intersections need special handling (split visited trail, snap visitor trail)
 * - Y-intersections need different handling than standard X-intersections
 */
export class ComplexIntersectionSplittingService implements SplittingService {
  readonly serviceName = 'ComplexIntersectionSplittingService';

  constructor(private config: ComplexIntersectionSplittingConfig) {}

  /**
   * Execute the complex intersection splitting service
   */
  async execute(): Promise<ComplexIntersectionSplittingResult> {
    return this.splitComplexIntersections();
  }

  /**
   * Split trails at complex intersections (T-intersections and Y-intersections)
   */
  async splitComplexIntersections(): Promise<ComplexIntersectionSplittingResult> {
    console.log('🔗 Processing complex intersections (T-intersections and Y-intersections)...');
    
    try {
      const { stagingSchema, pgClient, minSegmentLengthMeters, verbose = false } = this.config;
      const tTolerance = this.config.tIntersectionToleranceMeters || 5.0;
      const yTolerance = this.config.yIntersectionToleranceMeters || 3.0;
      
      let totalTrailsSplit = 0;
      let totalSegmentsCreated = 0;
      let tIntersectionsProcessed = 0;
      let yIntersectionsProcessed = 0;
      let complexIntersectionsProcessed = 0;

      // Step 1: Process T-intersections (North Sky/Foothills North type)
      console.log('   🔍 Step 1: Processing T-intersections...');
      const tIntersectionResult = await this.processTIntersections(tTolerance);
      totalTrailsSplit += tIntersectionResult.trailsSplit;
      totalSegmentsCreated += tIntersectionResult.segmentsCreated;
      tIntersectionsProcessed = tIntersectionResult.intersectionsProcessed;

      // Step 2: Process Y-intersections (acute angle intersections)
      console.log('   🔍 Step 2: Processing Y-intersections...');
      const yIntersectionResult = await this.processYIntersections(yTolerance);
      totalTrailsSplit += yIntersectionResult.trailsSplit;
      totalSegmentsCreated += yIntersectionResult.segmentsCreated;
      yIntersectionsProcessed = yIntersectionResult.intersectionsProcessed;

      complexIntersectionsProcessed = tIntersectionsProcessed + yIntersectionsProcessed;

      console.log(`✅ Complex intersection splitting completed:`);
      console.log(`   🔗 T-intersections processed: ${tIntersectionsProcessed}`);
      console.log(`   🔗 Y-intersections processed: ${yIntersectionsProcessed}`);
      console.log(`   ✂️ Total trails split: ${totalTrailsSplit}`);
      console.log(`   📊 Total segments created: ${totalSegmentsCreated}`);

      return {
        success: true,
        serviceName: this.serviceName,
        trailsSplit: totalTrailsSplit,
        segmentsCreated: totalSegmentsCreated,
        tIntersectionsProcessed,
        yIntersectionsProcessed,
        complexIntersectionsProcessed
      };

    } catch (error) {
      console.error('❌ Error in complex intersection splitting:', error);
      return {
        success: false,
        serviceName: this.serviceName,
        trailsSplit: 0,
        segmentsCreated: 0,
        tIntersectionsProcessed: 0,
        yIntersectionsProcessed: 0,
        complexIntersectionsProcessed: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Process T-intersections (North Sky/Foothills North type)
   * Logic: Split the visited trail and snap the visitor trail to the intersection point
   */
  private async processTIntersections(toleranceMeters: number): Promise<{trailsSplit: number, segmentsCreated: number, intersectionsProcessed: number}> {
    const { stagingSchema, pgClient, minSegmentLengthMeters, verbose = false } = this.config;

    // Find T-intersections: trails where one endpoint is close to another trail's path
    const tIntersections = await pgClient.query(`
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as visitor_trail_id,
          t1.name as visitor_trail_name,
          t1.geometry as visitor_geometry,
          t2.app_uuid as visited_trail_id,
          t2.name as visited_trail_name,
          t2.geometry as visited_geometry,
          ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry)) as intersection_point_start,
          ST_ClosestPoint(t2.geometry, ST_EndPoint(t1.geometry)) as intersection_point_end,
          ST_Distance(t2.geometry::geography, ST_StartPoint(t1.geometry)::geography) as start_distance,
          ST_Distance(t2.geometry::geography, ST_EndPoint(t1.geometry)::geography) as end_distance,
          ST_LineLocatePoint(t2.geometry, ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry))) as start_position,
          ST_LineLocatePoint(t2.geometry, ST_ClosestPoint(t2.geometry, ST_EndPoint(t1.geometry))) as end_position
        FROM ${stagingSchema}.trails t1
        JOIN ${stagingSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
        WHERE ST_DWithin(t2.geometry::geography, ST_StartPoint(t1.geometry)::geography, $1)
           OR ST_DWithin(t2.geometry::geography, ST_EndPoint(t1.geometry)::geography, $1)
      ),
      valid_t_intersections AS (
        SELECT *
        FROM trail_pairs
        WHERE (start_distance <= $1 AND start_position > 0.05 AND start_position < 0.95)
           OR (end_distance <= $1 AND end_position > 0.05 AND end_position < 0.95)
      )
      SELECT 
        visitor_trail_id,
        visitor_trail_name,
        visitor_geometry,
        visited_trail_id,
        visited_trail_name,
        visited_geometry,
        CASE 
          WHEN start_distance <= end_distance THEN intersection_point_start
          ELSE intersection_point_end
        END as intersection_point,
        CASE 
          WHEN start_distance <= end_distance THEN start_distance
          ELSE end_distance
        END as distance_meters,
        CASE 
          WHEN start_distance <= end_distance THEN start_position
          ELSE end_position
        END as position_along_visited_trail
      FROM valid_t_intersections
      ORDER BY distance_meters
    `, [toleranceMeters]);

    if (verbose) {
      console.log(`      📍 Found ${tIntersections.rows.length} T-intersections to process`);
    }

    let trailsSplit = 0;
    let segmentsCreated = 0;
    let intersectionsProcessed = 0;

    for (const intersection of tIntersections.rows) {
      if (verbose) {
        console.log(`      🔍 Processing T-intersection: ${intersection.visitor_trail_name} → ${intersection.visited_trail_name} (${intersection.distance_meters.toFixed(2)}m)`);
      }

      // Step 1: Split the visited trail at the intersection point
      const visitedSplitResult = await this.splitTrailAtPoint(
        intersection.visited_trail_id,
        intersection.visited_trail_name,
        intersection.visited_geometry,
        intersection.intersection_point
      );

      if (visitedSplitResult.success) {
        trailsSplit++;
        segmentsCreated += visitedSplitResult.segmentsCreated;
      }

      // Step 2: Snap the visitor trail to the intersection point
      const snapResult = await this.snapVisitorTrailToIntersection(
        intersection.visitor_trail_id,
        intersection.visitor_trail_name,
        intersection.visitor_geometry,
        intersection.intersection_point
      );

      if (snapResult.success) {
        trailsSplit++;
        segmentsCreated += snapResult.segmentsCreated;
      }

      intersectionsProcessed++;
    }

    return { trailsSplit, segmentsCreated, intersectionsProcessed };
  }

  /**
   * Process Y-intersections (acute angle intersections)
   */
  private async processYIntersections(toleranceMeters: number): Promise<{trailsSplit: number, segmentsCreated: number, intersectionsProcessed: number}> {
    const { stagingSchema, pgClient, minSegmentLengthMeters, verbose = false } = this.config;

    // Find Y-intersections: trails that intersect at acute angles
    const yIntersections = await pgClient.query(`
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t1.geometry as trail1_geometry,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          t2.geometry as trail2_geometry,
          ST_Intersection(t1.geometry, t2.geometry) as intersection_geom
        FROM ${stagingSchema}.trails t1
        JOIN ${stagingSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
      ),
      valid_y_intersections AS (
        SELECT *
        FROM trail_pairs
        WHERE ABS(ST_Azimuth(ST_StartPoint(trail1_geometry), ST_EndPoint(trail1_geometry)) - 
                   ST_Azimuth(ST_StartPoint(trail2_geometry), ST_EndPoint(trail2_geometry))) BETWEEN 15 AND 165
      )
      SELECT 
        trail1_id, trail1_name, trail1_geometry,
        trail2_id, trail2_name, trail2_geometry,
        (ST_Dump(intersection_geom)).geom as intersection_point
      FROM valid_y_intersections
      WHERE ST_GeometryType((ST_Dump(intersection_geom)).geom) = 'ST_Point'
    `);

    if (verbose) {
      console.log(`      📍 Found ${yIntersections.rows.length} Y-intersections to process`);
    }

    let trailsSplit = 0;
    let segmentsCreated = 0;
    let intersectionsProcessed = 0;

    for (const intersection of yIntersections.rows) {
      if (verbose) {
        console.log(`      🔍 Processing Y-intersection: ${intersection.trail1_name} × ${intersection.trail2_name}`);
      }

      // Split both trails at the intersection point
      const trail1SplitResult = await this.splitTrailAtPoint(
        intersection.trail1_id,
        intersection.trail1_name,
        intersection.trail1_geometry,
        intersection.intersection_point
      );

      if (trail1SplitResult.success) {
        trailsSplit++;
        segmentsCreated += trail1SplitResult.segmentsCreated;
      }

      const trail2SplitResult = await this.splitTrailAtPoint(
        intersection.trail2_id,
        intersection.trail2_name,
        intersection.trail2_geometry,
        intersection.intersection_point
      );

      if (trail2SplitResult.success) {
        trailsSplit++;
        segmentsCreated += trail2SplitResult.segmentsCreated;
      }

      intersectionsProcessed++;
    }

    return { trailsSplit, segmentsCreated, intersectionsProcessed };
  }

  /**
   * Split a trail at a specific point
   */
  private async splitTrailAtPoint(trailId: string, trailName: string, trailGeometry: any, intersectionPoint: any): Promise<{success: boolean, segmentsCreated: number}> {
    const { stagingSchema, pgClient, minSegmentLengthMeters } = this.config;

    try {
      // Find the closest point on the trail to the intersection point
      const closestPointResult = await pgClient.query(`
        SELECT ST_ClosestPoint($1::geometry, $2::geometry) as closest_point
      `, [trailGeometry, intersectionPoint]);
      
      const closestPoint = closestPointResult.rows[0].closest_point;
      
      // Split the trail at the closest point
      const splitResult = await pgClient.query(`
        SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
      `, [trailGeometry, closestPoint]);

      if (splitResult.rows.length <= 1) {
        return { success: false, segmentsCreated: 0 };
      }

      // Filter out segments that are too short
      const validSegments = [];
      for (const row of splitResult.rows) {
        const lengthResult = await pgClient.query(`
          SELECT ST_Length($1::geography) as length_meters
        `, [row.segment]);
        
        const lengthMeters = lengthResult.rows[0].length_meters;
        if (lengthMeters >= minSegmentLengthMeters) {
          validSegments.push(row.segment);
        }
      }

      if (validSegments.length <= 1) {
        return { success: false, segmentsCreated: 0 };
      }

      // Delete the original trail
      await pgClient.query(`
        DELETE FROM ${stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [trailId]);

      // Insert the new segments
      for (let i = 0; i < validSegments.length; i++) {
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
            ST_Force3D($2::geometry) as geometry,
            trail_type, surface, difficulty,
            elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            source, source_tags, osm_id
          FROM ${stagingSchema}.trails 
          WHERE app_uuid = $3
        `, [trailName, validSegments[i], trailId]);
      }

      return { success: true, segmentsCreated: validSegments.length };

    } catch (error) {
      console.error(`❌ Error splitting trail ${trailName}:`, error);
      return { success: false, segmentsCreated: 0 };
    }
  }

  /**
   * Snap visitor trail to intersection point (North Sky/Foothills North logic)
   */
  private async snapVisitorTrailToIntersection(visitorTrailId: string, visitorTrailName: string, visitorGeometry: any, intersectionPoint: any): Promise<{success: boolean, segmentsCreated: number}> {
    const { stagingSchema, pgClient, minSegmentLengthMeters } = this.config;

    try {
      // Find which endpoint of the visitor trail is closer to the intersection point
      const endpointAnalysis = await pgClient.query(`
        SELECT 
          ST_Distance(ST_StartPoint($1), $2::geography) as start_distance,
          ST_Distance(ST_EndPoint($1), $2::geography) as end_distance
      `, [visitorGeometry, intersectionPoint]);

      const startDistance = endpointAnalysis.rows[0].start_distance;
      const endDistance = endpointAnalysis.rows[0].end_distance;
      
      // Determine which endpoint to extend
      const extendFromStart = startDistance < endDistance;
      const endpointToExtend = extendFromStart ? 'ST_StartPoint' : 'ST_EndPoint';

      // Create a new trail segment that extends from the visitor trail's endpoint to the intersection point
      const extendedTrailResult = await pgClient.query(`
        SELECT ST_MakeLine(${endpointToExtend}($1), $2) as extended_geometry
      `, [visitorGeometry, intersectionPoint]);

      const extendedGeometry = extendedTrailResult.rows[0].extended_geometry;

      // Check if the extended segment is long enough
      const lengthResult = await pgClient.query(`
        SELECT ST_Length($1::geography) as length_meters
      `, [extendedGeometry]);

      const lengthMeters = lengthResult.rows[0].length_meters;

      if (lengthMeters < minSegmentLengthMeters) {
        return { success: false, segmentsCreated: 0 };
      }

      // Insert the extended trail segment
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
          ST_Force3D($2::geometry) as geometry,
          trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        FROM ${stagingSchema}.trails 
        WHERE app_uuid = $3
      `, [visitorTrailName, extendedGeometry, visitorTrailId]);

      // Delete the original visitor trail
      await pgClient.query(`
        DELETE FROM ${stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [visitorTrailId]);

      return { success: true, segmentsCreated: 1 };

    } catch (error) {
      console.error(`❌ Error snapping visitor trail ${visitorTrailName}:`, error);
      return { success: false, segmentsCreated: 0 };
    }
  }
}
