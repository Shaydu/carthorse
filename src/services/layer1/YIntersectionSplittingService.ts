import { Pool } from 'pg';

export interface YIntersectionSplittingResult {
  success: boolean;
  splitCount: number;
  intersectionsFound: number;
  error?: string;
  details?: {
    toleranceUsed: number;
    segmentsCreated: number;
  };
}

export class YIntersectionSplittingService {
  constructor(
    private pgClient: Pool,
    private stagingSchema: string
  ) {}

  /**
   * Detect and split Y/T intersections where trails intersect at midpoints
   * This handles cases where trails cross each other at non-endpoint locations
   */
  async splitYIntersections(toleranceMeters: number = 5.0): Promise<YIntersectionSplittingResult> {
    try {
      console.log('🔍 Starting Y/T intersection detection and splitting...');
      
      let totalIntersectionsFound = 0;
      let totalSplitCount = 0;

      // Step 1: Find trail pairs that intersect at midpoints (not endpoints)
      const yIntersectionPairs = await this.findYIntersectionPairs(toleranceMeters);
      
      console.log(`Found ${yIntersectionPairs.length} potential Y/T intersection pairs`);

      for (const pair of yIntersectionPairs) {
        console.log(`\n🔍 Processing Y/T intersection: ${pair.trail1_name} ↔ ${pair.trail2_name} (distance: ${pair.distance.toFixed(2)}m)`);
        
        // Step 2: Split both trails at the intersection point
        const splitSuccess = await this.splitYIntersection(pair);
        
        if (splitSuccess) {
          totalIntersectionsFound++;
          totalSplitCount += 2; // Each intersection creates 2 split points
        }
      }

      console.log(`✅ Y/T intersection splitting completed:`);
      console.log(`   - Y/T intersections found: ${totalIntersectionsFound}`);
      console.log(`   - Split points created: ${totalSplitCount}`);

      return {
        success: true,
        splitCount: totalSplitCount,
        intersectionsFound: totalIntersectionsFound,
        details: {
          toleranceUsed: toleranceMeters,
          segmentsCreated: totalSplitCount
        }
      };

    } catch (error) {
      console.error('❌ Error in Y/T intersection splitting:', error);
      return {
        success: false,
        splitCount: 0,
        intersectionsFound: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Find trail pairs that form Y/T intersections (midpoint intersections)
   */
  private async findYIntersectionPairs(toleranceMeters: number): Promise<any[]> {
    const result = await this.pgClient.query(`
      WITH trail_geometries AS (
        SELECT 
          trail_uuid as trail_id,
          trail_name as trail_name,
          the_geom as trail_geom,
          ST_StartPoint(the_geom) as start_point,
          ST_EndPoint(the_geom) as end_point
        FROM ${this.stagingSchema}.ways
      ),
      intersection_pairs AS (
        SELECT 
          t1.trail_id as trail1_id,
          t1.trail_name as trail1_name,
          t1.trail_geom as trail1_geom,
          t2.trail_id as trail2_id,
          t2.trail_name as trail2_name,
          t2.trail_geom as trail2_geom,
          ST_Intersection(t1.trail_geom, t2.trail_geom) as intersection_point
        FROM trail_geometries t1
        JOIN trail_geometries t2 ON t1.trail_id < t2.trail_id
        WHERE ST_Intersects(t1.trail_geom, t2.trail_geom)
          AND ST_GeometryType(ST_Intersection(t1.trail_geom, t2.trail_geom)) = 'ST_Point'
      ),
      filtered_intersections AS (
        SELECT 
          trail1_id,
          trail1_name,
          trail1_geom,
          trail2_id,
          trail2_name,
          trail2_geom,
          intersection_point,
          -- Check if intersection is far from endpoints (midpoint intersection)
          LEAST(
            ST_Distance(ST_StartPoint(trail1_geom), intersection_point),
            ST_Distance(ST_EndPoint(trail1_geom), intersection_point)
          ) as trail1_distance_to_endpoint,
          LEAST(
            ST_Distance(ST_StartPoint(trail2_geom), intersection_point),
            ST_Distance(ST_EndPoint(trail2_geom), intersection_point)
          ) as trail2_distance_to_endpoint
        FROM intersection_pairs
      )
      SELECT 
        trail1_id,
        trail1_name,
        trail1_geom,
        trail2_id,
        trail2_name,
        trail2_geom,
        intersection_point,
        trail1_distance_to_endpoint as distance
      FROM filtered_intersections
      WHERE trail1_distance_to_endpoint > $1  -- Intersection is far from trail1 endpoints
        AND trail2_distance_to_endpoint > $1  -- Intersection is far from trail2 endpoints
      ORDER BY trail1_distance_to_endpoint ASC
    `, [toleranceMeters]);

    return result.rows;
  }

  /**
   * Split both trails at the Y/T intersection point
   */
  private async splitYIntersection(pair: any): Promise<boolean> {
    try {
      console.log(`   🔧 Splitting ${pair.trail1_name} and ${pair.trail2_name} at intersection point`);

      // Split trail 1 at the intersection point
      const trail1Split = await this.splitTrailAtPoint(
        pair.trail1_id,
        pair.trail1_name,
        pair.trail1_geom,
        pair.intersection_point
      );

      // Split trail 2 at the intersection point
      const trail2Split = await this.splitTrailAtPoint(
        pair.trail2_id,
        pair.trail2_name,
        pair.trail2_geom,
        pair.intersection_point
      );

      return trail1Split && trail2Split;
    } catch (error) {
      console.error(`Error splitting Y/T intersection ${pair.trail1_name} ↔ ${pair.trail2_name}:`, error);
      return false;
    }
  }

  /**
   * Split a specific trail at the intersection point
   */
  private async splitTrailAtPoint(
    trailId: string,
    trailName: string,
    trailGeom: any,
    intersectionPoint: any
  ): Promise<boolean> {
    try {
      // Create a small buffer around the intersection point for splitting
      const bufferRadius = 0.1; // 0.1 meters
      const bufferQuery = `
        SELECT ST_Buffer($1::geography, $2)::geometry as buffer_geom
      `;
      
      const bufferResult = await this.pgClient.query(bufferQuery, [intersectionPoint, bufferRadius]);
      const bufferGeom = bufferResult.rows[0].buffer_geom;

      // Split the trail using the buffer
      const splitResult = await this.pgClient.query(`
        SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
      `, [trailGeom, bufferGeom]);

      const segments = splitResult.rows;
      
      if (segments.length > 1) {
        console.log(`   ✅ Split ${trailName} into ${segments.length} segments`);
        
        // Insert split segments and delete original
        await this.insertSplitSegmentsAndDeleteOriginal(
          trailId,
          segments,
          trailName
        );
        
        return true;
      } else {
        console.log(`   ⚠️ No split needed for ${trailName} (only ${segments.length} segment)`);
        return false;
      }
    } catch (error) {
      console.error(`Error splitting trail ${trailName}:`, error);
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
      SELECT * FROM ${this.stagingSchema}.ways WHERE trail_uuid = $1
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
          INSERT INTO ${this.stagingSchema}.ways (
            trail_uuid, trail_name, trail_type, length_km, elevation_gain, elevation_loss, 
            the_geom, source, target, cost, reverse_cost
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
          )
        `, [
          `${originalName} (Y-Split ${i + 1})`,
          trail.trail_type,
          length.rows[0].length_m / 1000, // Convert to km
          trail.elevation_gain,
          trail.elevation_loss,
          segmentGeom,
          trail.source,
          trail.target,
          trail.cost,
          trail.reverse_cost
        ]);
      } else {
        console.log(`   ⚠️ Skipped small segment ${i + 1}: ${length.rows[0].length_m.toFixed(1)}m`);
      }
    }

    // Delete original trail
    await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.ways WHERE trail_uuid = $1
    `, [originalTrailId]);
  }

  /**
   * Count the total number of Y-split segments
   */
  async countYSplitSegments(): Promise<number> {
    const result = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.ways WHERE trail_name LIKE '%(Y-Split %'
    `);
    return parseInt(result.rows[0].count);
  }
}
