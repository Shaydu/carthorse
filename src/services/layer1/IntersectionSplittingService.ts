import { Pool } from 'pg';

export interface IntersectionSplittingResult {
  success: boolean;
  splitCount: number;
  error?: string;
}

export class IntersectionSplittingService {
  constructor(
    private pgClient: Pool,
    private stagingSchema: string
  ) {}

  /**
   * Apply the working prototype logic to detect and split T-intersections
   * Uses the exact same approach as the working prototype: round to 6 decimal places, snap with 1e-6, intersect, split
   */
  async splitTrailsAtIntersections(): Promise<IntersectionSplittingResult> {
    console.log('🔗 Applying prototype intersection splitting logic...');
    
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
                   AND ST_DWithin(t1.geometry, t2.geometry, 0.00002)  -- Within ~2m
                   -- AND NOT ST_Intersects(t1.geometry, t2.geometry)  -- Temporarily disabled
               )
               SELECT * FROM trail_pairs
               ORDER BY ST_Distance(trail1_geom, trail2_geom)  -- Process closest pairs first
               LIMIT 50  -- Increased limit to catch more pairs
             `);

      console.log(`🔗 Found ${closeTrailsResult.rows.length} potential T-intersection pairs`);

      let totalSplitCount = 0;

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

        // Step 3: Snap trails with 1e-6 tolerance (exactly like working prototype)
        const snappedResult = await this.pgClient.query(`
          SELECT 
            ST_Snap($1::geometry, $2::geometry, 1e-6) AS trail1_snapped,
            ST_Snap($2::geometry, $1::geometry, 1e-6) AS trail2_snapped
        `, [trail1Rounded, trail2Rounded]);

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

        // Step 5: Split both trails at intersection points and insert new segments
        for (const intersection of intersectionResult.rows) {
          const splitPoint = intersection.pt;
          
          // Split trail 1
          const splitTrail1Result = await this.pgClient.query(`
            SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
          `, [trail1Snapped, splitPoint]);
          
          // Split trail 2
          const splitTrail2Result = await this.pgClient.query(`
            SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
          `, [trail2Snapped, splitPoint]);

          // Insert split segments and delete originals
          await this.insertSplitSegmentsAndDeleteOriginals(
            pair.trail1_id, pair.trail1_uuid, pair.trail1_name, splitTrail1Result.rows,
            pair.trail2_id, pair.trail2_uuid, pair.trail2_name, splitTrail2Result.rows
          );

          totalSplitCount += splitTrail1Result.rows.length + splitTrail2Result.rows.length;
        }
      }

      console.log(`✅ Prototype intersection splitting completed. Total segments created: ${totalSplitCount}`);
      
      return {
        success: true,
        splitCount: totalSplitCount
      };

    } catch (error) {
      console.error('❌ Error in prototype intersection splitting:', error);
      return {
        success: false,
        splitCount: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Insert split segments and delete the original trails
   */
  private async insertSplitSegmentsAndDeleteOriginals(
    trail1Id: number, trail1Uuid: string, trail1Name: string, trail1Segments: any[],
    trail2Id: number, trail2Uuid: string, trail2Name: string, trail2Segments: any[]
  ): Promise<void> {
    
    // Insert trail 1 segments
    for (let i = 0; i < trail1Segments.length; i++) {
      const segment = trail1Segments[i];
      const segmentName = trail1Segments.length > 1 ? `${trail1Name} (Segment ${i + 1})` : trail1Name;
      
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
      `, [segmentName, segment.segment, trail1Id]);
    }

    // Insert trail 2 segments
    for (let i = 0; i < trail2Segments.length; i++) {
      const segment = trail2Segments[i];
      const segmentName = trail2Segments.length > 1 ? `${trail2Name} (Segment ${i + 1})` : trail2Name;
      
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
      `, [segmentName, segment.segment, trail2Id]);
    }

    // Delete original trails
    await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails WHERE id IN ($1, $2)
    `, [trail1Id, trail2Id]);

    console.log(`   📝 Inserted ${trail1Segments.length + trail2Segments.length} segments, deleted 2 originals`);
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
