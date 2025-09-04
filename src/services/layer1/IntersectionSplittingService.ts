import { Pool } from 'pg';

export interface IntersectionSplittingResult {
  success: boolean;
  splitCount: number;
  error?: string;
  details?: {
    intersectionsFound: number;
    segmentsCreated: number;
    toleranceUsed: number;
    visitedTrailSplit: boolean;
    visitingTrailUnchanged: boolean;
  };
}

export class IntersectionSplittingService {
  constructor(
    private pgClient: Pool,
    private stagingSchema: string
  ) {}

  /**
   * Apply simplified T-intersection splitting logic
   * Uses the rule: "Does another trail's endpoint come within 3 meters of the path?"
   * Splits visited trails at intersection points to create proper routing graph segments
   */
  async splitTrailsAtIntersections(): Promise<IntersectionSplittingResult> {
    try {
      console.log('🔍 Starting simplified T-intersection splitting...');
      
      let totalIntersectionsFound = 0;
      let totalSplitCount = 0;
      let visitedTrailSplit = false;
      let visitingTrailUnchanged = false;

      // Step 1: Find trail pairs where one trail's endpoint is within 3 meters of another trail
      const tIntersectionPairs = await this.findTIntersectionPairs();
      
      console.log(`Found ${tIntersectionPairs.length} potential T-intersection pairs`);

      for (const pair of tIntersectionPairs) {
        console.log(`\n🔍 Processing T-intersection: ${pair.visitor_name} → ${pair.visited_name} (distance: ${pair.distance.toFixed(2)}m)`);
        
        // Step 2: Apply the simplified splitting logic
        const splitSuccess = await this.splitTIntersection(pair);
        
        if (splitSuccess) {
          totalIntersectionsFound++;
          visitedTrailSplit = true;
          visitingTrailUnchanged = true;
        }
      }

      totalSplitCount = await this.countSplitSegments();

      console.log(`✅ T-intersection splitting completed:`);
      console.log(`   - T-intersections found: ${totalIntersectionsFound}`);
      console.log(`   - Segments created: ${totalSplitCount}`);

      return {
        success: true,
        splitCount: totalSplitCount,
        details: {
          intersectionsFound: totalIntersectionsFound,
          segmentsCreated: totalSplitCount,
          toleranceUsed: 3.0,
          visitedTrailSplit,
          visitingTrailUnchanged
        }
      };

    } catch (error) {
      console.error('❌ Error in T-intersection splitting:', error);
      return {
        success: false,
        splitCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Find trail pairs that form T-intersections (endpoint within 3 meters of another trail)
   */
  private async findTIntersectionPairs(): Promise<any[]> {
    const result = await this.pgClient.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          geometry as trail_geom
        FROM ${this.stagingSchema}.trails
      ),
      endpoint_distances AS (
        SELECT 
          t1.trail_id as visitor_id,
          t1.trail_name as visitor_name,
          t2.trail_id as visited_id,
          t2.trail_name as visited_name,
          LEAST(
            ST_Distance(t1.start_point, t2.trail_geom),
            ST_Distance(t1.end_point, t2.trail_geom)
          ) as distance,
          CASE 
            WHEN ST_Distance(t1.start_point, t2.trail_geom) < ST_Distance(t1.end_point, t2.trail_geom)
            THEN t1.start_point
            ELSE t1.end_point
          END as closest_endpoint
        FROM trail_endpoints t1
        JOIN trail_endpoints t2 ON t1.trail_id != t2.trail_id
        WHERE LEAST(
          ST_Distance(t1.start_point, t2.trail_geom),
          ST_Distance(t1.end_point, t2.trail_geom)
        ) <= 3.0 -- 3 meter tolerance
      )
      SELECT 
        visitor_id,
        visitor_name,
        visited_id,
        visited_name,
        distance,
        closest_endpoint
      FROM endpoint_distances
      ORDER BY distance ASC
    `);

    return result.rows;
  }

  /**
   * Split a T-intersection using the simplified approach
   */
  private async splitTIntersection(pair: any): Promise<boolean> {
    try {
      // Step 1: Get the trail geometries
      const visitorTrail = await this.pgClient.query(`
        SELECT geometry, name FROM ${this.stagingSchema}.trails WHERE app_uuid = $1
      `, [pair.visitor_id]);

      const visitedTrail = await this.pgClient.query(`
        SELECT geometry, name FROM ${this.stagingSchema}.trails WHERE app_uuid = $2
      `, [pair.visited_id]);

      if (visitorTrail.rows.length === 0 || visitedTrail.rows.length === 0) {
        return false;
      }

      const visitorGeom = visitorTrail.rows[0].geometry;
      const visitedGeom = visitedTrail.rows[0].geometry;
      const visitorName = visitorTrail.rows[0].name;
      const visitedName = visitedTrail.rows[0].name;

      // Step 2: Find the closest point on the visited trail to the visitor endpoint
      const closestPointResult = await this.pgClient.query(`
        SELECT ST_ClosestPoint($1::geometry, $2::geometry) as closest_point
      `, [visitedGeom, pair.closest_endpoint]);

      const closestPoint = closestPointResult.rows[0].closest_point;

      // Step 3: Create a line from visitor endpoint to closest point on visited trail
      const extensionLineResult = await this.pgClient.query(`
        SELECT ST_MakeLine($1::geometry, $2::geometry) as extension_line
      `, [pair.closest_endpoint, closestPoint]);

      const extensionLine = extensionLineResult.rows[0].extension_line;

      // Step 4: Find where the extension line intersects the visited trail
      const intersectionResult = await this.pgClient.query(`
        SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS intersection_point
      `, [visitedGeom, extensionLine]);

      if (intersectionResult.rows.length === 0) {
        console.log(`   ❌ No intersection found for ${visitorName} → ${visitedName}`);
        return false;
      }

      const intersectionPoint = intersectionResult.rows[0].intersection_point;

      // Step 5: Split the visited trail at the intersection point
      const splitResult = await this.pgClient.query(`
        SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
      `, [visitedGeom, intersectionPoint]);

      const segments = splitResult.rows;
      
      if (segments.length > 1) {
        console.log(`   ✅ Split ${visitedName} into ${segments.length} segments`);
        
        // Insert split segments and delete original
        await this.insertSplitSegmentsAndDeleteOriginal(
          pair.visited_id,
          segments,
          visitedName
        );
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`Error splitting T-intersection ${pair.visitor_name} → ${pair.visited_name}:`, error);
      return false;
    }
  }

  /**
   * Insert split segments and delete the original trail
   */
  private async insertSplitSegmentsAndDeleteOriginal(
    originalTrailId: string,
    segments: any[],
    originalName: string
  ): Promise<void> {
    // Get original trail data
    const originalTrail = await this.pgClient.query(`
      SELECT * FROM ${this.stagingSchema}.trails WHERE app_uuid = $1
    `, [originalTrailId]);

    if (originalTrail.rows.length === 0) return;

    const trail = originalTrail.rows[0];

    // Insert split segments (filter out very small segments)
    for (let i = 0; i < segments.length; i++) {
      const segmentGeom = segments[i].segment;
      
      const length = await this.pgClient.query(`
        SELECT ST_Length($1::geography) as length_m
      `, [segmentGeom]);

      // Only insert segments longer than 5 meters
      if (length.rows[0].length_m > 5) {
        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.trails (
            app_uuid, name, source, geometry, trail_type, surface_type, 
            difficulty, length_meters, elevation_gain, elevation_loss, 
            max_elevation, min_elevation, avg_elevation, bbox_min_lng, 
            bbox_max_lng, bbox_min_lat, bbox_max_lat
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
          )
        `, [
          originalName,
          trail.source,
          segmentGeom,
          trail.trail_type,
          trail.surface_type,
          trail.difficulty,
          length.rows[0].length_m,
          trail.elevation_gain,
          trail.elevation_loss,
          trail.max_elevation,
          trail.min_elevation,
          trail.avg_elevation,
          trail.bbox_min_lng,
          trail.bbox_max_lng,
          trail.bbox_min_lat,
          trail.bbox_max_lat
        ]);
      } else {
        console.log(`   ⚠️ Skipped small segment ${i + 1}: ${length.rows[0].length_m.toFixed(1)}m`);
      }
    }

    // Delete original trail
    await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails WHERE app_uuid = $1
    `, [originalTrailId]);
  }

  /**
   * Count the total number of split segments
   */
  private async countSplitSegments(): Promise<number> {
    const result = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails WHERE name LIKE '%(Segment %'
    `);
    return parseInt(result.rows[0].count);
  }

  /**
   * Cleanup method
   */
  async cleanup(): Promise<void> {
    // Any cleanup needed
  }
}
