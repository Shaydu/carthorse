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
   * Apply the working COTREX prototype logic to detect and split T-intersections
   * Uses the exact same approach as the working prototype: round to 6 decimal places, snap with 0.0001, intersect, split with buffer
   * ONLY splits the "visited" trail, leaves the "visiting" trail unchanged
   */
  async splitTrailsAtIntersections(): Promise<IntersectionSplittingResult> {
    console.log('🔗 Applying working COTREX prototype intersection splitting logic...');
    
    try {
      // Step 1: Find trail pairs that are geometrically close (potential T-intersections)
      const closeTrailsResult = await this.pgClient.query(`
        WITH trail_pairs AS (
          SELECT DISTINCT
            t1.id as trail1_id,
            t1.app_uuid as trail1_uuid,
            t1.name as trail1_name,
            t1.geometry as trail1_geom,
            t2.id as trail2_id,
            t2.app_uuid as trail2_uuid,
            t2.name as trail2_name,
            t2.geometry as trail2_geom
          FROM ${this.stagingSchema}.trails t1
          CROSS JOIN ${this.stagingSchema}.trails t2
          WHERE t1.id < t2.id  -- Avoid duplicate pairs
            AND ST_DWithin(t1.geometry, t2.geometry, 0.0001)  -- Within ~11m (COTREX tolerance)
            AND t1.name NOT LIKE '%Segment%'  -- Skip already processed segments
            AND t2.name NOT LIKE '%Segment%'  -- Skip already processed segments
        )
        SELECT * FROM trail_pairs
        ORDER BY ST_Distance(trail1_geom, trail2_geom)  -- Process closest pairs first
        LIMIT 50  -- Process in batches
      `);

      console.log(`🔗 Found ${closeTrailsResult.rows.length} potential T-intersection pairs`);

      let totalSplitCount = 0;
      let totalIntersectionsFound = 0;
      let visitedTrailSplit = false;
      let visitingTrailUnchanged = true;

      for (const pair of closeTrailsResult.rows) {
        console.log(`🔗 Processing pair: ${pair.trail1_name} <-> ${pair.trail2_name}`);
        
        // Step 2: Apply prototype logic - round coordinates to 6 decimal places (exactly like working prototype)
        const roundedResult = await this.pgClient.query(`
          WITH rounded_trails AS (
            SELECT 
              ST_GeomFromText(
                'LINESTRING(' || 
                string_agg(
                  ROUND(ST_X(pt1)::numeric, 6) || ' ' || ROUND(ST_Y(pt1)::numeric, 6),
                  ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText(ST_AsText($1::geometry)), pt1)
                ) || 
                ')'
              ) as trail1_rounded,
              ST_GeomFromText(
                'LINESTRING(' || 
                string_agg(
                  ROUND(ST_X(pt2)::numeric, 6) || ' ' || ROUND(ST_Y(pt2)::numeric, 6),
                  ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText(ST_AsText($2::geometry)), pt2)
                ) || 
                ')'
              ) as trail2_rounded
            FROM 
              (SELECT (ST_DumpPoints(ST_GeomFromText(ST_AsText($1::geometry)))).geom AS pt1) as points1,
              (SELECT (ST_DumpPoints(ST_GeomFromText(ST_AsText($2::geometry)))).geom AS pt2) as points2
          )
          SELECT trail1_rounded, trail2_rounded FROM rounded_trails
        `, [pair.trail1_geom, pair.trail2_geom]);

        if (roundedResult.rows.length === 0) continue;
        
        const trail1Rounded = roundedResult.rows[0].trail1_rounded;
        const trail2Rounded = roundedResult.rows[0].trail2_rounded;

        // Step 3: Snap trails with 0.0001 tolerance (exactly like working COTREX prototype)
        const tolerance = 0.0001; // ~11m in degrees
        const snappedResult = await this.pgClient.query(`
          SELECT 
            ST_Snap($1::geometry, $2::geometry, $3) AS trail1_snapped,
            ST_Snap($2::geometry, $1::geometry, $3) AS trail2_snapped
        `, [trail1Rounded, trail2Rounded, tolerance]);

        const trail1Snapped = snappedResult.rows[0].trail1_snapped;
        const trail2Snapped = snappedResult.rows[0].trail2_snapped;

        // Step 4: Find intersections (exactly like prototype)
        const intersectionResult = await this.pgClient.query(`
          SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt
        `, [trail1Snapped, trail2Snapped]);

        if (intersectionResult.rows.length === 0) {
          console.log(`   ⚠️ No intersections found for ${pair.trail1_name} <-> ${pair.trail2_name}`);
          continue;
        }

        console.log(`   ✅ Found ${intersectionResult.rows.length} intersection(s) for ${pair.trail1_name} <-> ${pair.trail2_name}`);
        totalIntersectionsFound += intersectionResult.rows.length;

        // Step 5: Split ONLY the visited trail (trail1) at the first intersection point using buffer method
        const splitPoint = intersectionResult.rows[0].pt; // Use first intersection only
        
        // Use buffer method to handle linear intersections - ONLY split trail1 (visited trail)
        const bufferSize = 0.000001; // Very small buffer to avoid linear intersection error
        console.log(`   🔧 Using buffer method with size ${bufferSize} to avoid linear intersection error`);
        
        // Split ONLY trail1 (visited trail)
        const splitTrail1Result = await this.pgClient.query(`
          SELECT 
            (ST_Dump(ST_Split($1::geometry, ST_Buffer($2::geometry, $3)))).geom AS segment
        `, [trail1Snapped, splitPoint, bufferSize]);

        // Insert split segments for trail1 and delete original
        const validSegments = await this.insertSplitSegmentsAndDeleteOriginal(
          pair.trail1_id, pair.trail1_uuid, pair.trail1_name, splitTrail1Result.rows
        );

        totalSplitCount += validSegments;
        visitedTrailSplit = true;
        
        // Trail2 (visiting trail) remains UNCHANGED
        console.log(`   🚫 ${pair.trail2_name} (visiting trail) remains UNCHANGED`);
      }

      console.log(`✅ Working COTREX prototype intersection splitting completed. Total segments created: ${totalSplitCount}`);
      
      return {
        success: true,
        splitCount: totalSplitCount,
        details: {
          intersectionsFound: totalIntersectionsFound,
          segmentsCreated: totalSplitCount,
          toleranceUsed: 0.0001,
          visitedTrailSplit,
          visitingTrailUnchanged
        }
      };

    } catch (error) {
      console.error('❌ Error in working COTREX prototype intersection splitting:', error);
      return {
        success: false,
        splitCount: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Insert split segments and delete the original trail (for visited trail only)
   */
  private async insertSplitSegmentsAndDeleteOriginal(
    trailId: number, trailUuid: string, trailName: string, segments: any[]
  ): Promise<number> {
    
    let validSegmentsInserted = 0;
    
    // Insert segments (skip zero-length segments)
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      
      // Check if segment has meaningful length (skip zero-length/point segments)
      const lengthResult = await this.pgClient.query(`
        SELECT ST_Length($1::geometry::geography) as length_meters
      `, [segment.segment]);
      
      const lengthMeters = lengthResult.rows[0].length_meters;
      if (lengthMeters <= 1) { // Minimum 1 meter for COTREX
        console.log(`   ⏭️ Skipping short segment ${i + 1} (${lengthMeters}m)`);
        continue;
      }
      
      const segmentName = segments.length > 1 ? `${trailName} (Segment ${i + 1})` : trailName;
      
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, name, geometry, trail_type, surface, difficulty, 
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
        )
        SELECT 
          gen_random_uuid() as app_uuid,
          $1 as name,
          ST_Force3D($2::geometry) as geometry,
          trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
        FROM ${this.stagingSchema}.trails 
        WHERE id = $3
      `, [segmentName, segment.segment, trailId]);
      
      validSegmentsInserted++;
      console.log(`   📝 Inserted segment ${i + 1}: ${Math.round(lengthMeters)}m`);
    }

    // Delete original trail
    await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails WHERE id = $1
    `, [trailId]);

    console.log(`   ✅ Inserted ${validSegmentsInserted} valid segments, deleted original trail`);
    return validSegmentsInserted;
  }

  /**
   * Legacy method for backward compatibility
   */
  async splitTrailAtSplitter(targetTrailUuid: string, splitterTrailUuid: string): Promise<void> {
    console.log(`🔗 Legacy splitTrailAtSplitter called - redirecting to new logic`);
    const result = await this.splitTrailsAtIntersections();
    if (!result.success) {
      throw new Error(`Intersection splitting failed: ${result.error}`);
    }
  }

  /**
   * Cleanup method for compatibility with PgRoutingSplittingService
   */
  async cleanup(): Promise<void> {
    console.log('🔗 IntersectionSplittingService cleanup - no cleanup needed');
  }
}
