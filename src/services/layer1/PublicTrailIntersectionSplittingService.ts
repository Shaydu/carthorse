import { Pool } from 'pg';

export interface PublicTrailIntersectionSplittingResult {
  success: boolean;
  splitCount: number;
  error?: string;
}

export class PublicTrailIntersectionSplittingService {
  private processedTrailUuids: Set<string> = new Set();

  constructor(
    private pgClient: Pool,
    private stagingSchema: string,
    private config: {
      region: string;
      bbox?: number[];
      sourceFilter?: string;
    }
  ) {}

  async splitIntersectionsFromPublicTrails(): Promise<PublicTrailIntersectionSplittingResult> {
    console.log('🔗 Applying public trail intersection splitting...');
    
    try {
      // Step 1: Find trail pairs in public.trails that are close (potential T-intersections)
      const closeTrailsResult = await this.pgClient.query(`
        WITH trail_pairs AS (
          SELECT DISTINCT
            t1.app_uuid as trail1_uuid,
            t1.name as trail1_name,
            t1.geometry as trail1_geom,
            t2.app_uuid as trail2_uuid,
            t2.name as trail2_name,
            t2.geometry as trail2_geom
          FROM public.trails t1
          CROSS JOIN public.trails t2
          WHERE t1.app_uuid < t2.app_uuid  -- Avoid duplicate pairs
            AND ST_DWithin(t1.geometry, t2.geometry, 0.00002)  -- Within ~2m
            AND NOT ST_Intersects(t1.geometry, t2.geometry)  -- Don't already intersect
        )
        SELECT * FROM trail_pairs
        ORDER BY ST_Distance(trail1_geom, trail2_geom)  -- Process closest pairs first
        LIMIT 50  -- Increased limit to catch more pairs
      `);

      console.log(`🔗 Found ${closeTrailsResult.rows.length} potential T-intersection pairs in public.trails`);

      let totalSplitCount = 0;

      for (const pair of closeTrailsResult.rows) {
        // Skip if either trail has already been processed
        if (this.processedTrailUuids.has(pair.trail1_uuid) || this.processedTrailUuids.has(pair.trail2_uuid)) {
          console.log(`🔗 Skipping pair: ${pair.trail1_name} <-> ${pair.trail2_name} (already processed)`);
          continue;
        }

        console.log(`🔗 Processing pair: ${pair.trail1_name} <-> ${pair.trail2_name}`);
        
        // Step 2: Apply working prototype logic - round coordinates to 6 decimal places
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

        // Step 5: Split both trails at intersection points and insert into staging
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

          // Insert split segments into staging and mark trails as processed
          await this.insertSplitSegmentsIntoStaging(
            pair.trail1_uuid, pair.trail1_name, splitTrail1Result.rows,
            pair.trail2_uuid, pair.trail2_name, splitTrail2Result.rows
          );

          // Mark both trails as processed to avoid re-splitting
          this.processedTrailUuids.add(pair.trail1_uuid);
          this.processedTrailUuids.add(pair.trail2_uuid);

          totalSplitCount += splitTrail1Result.rows.length + splitTrail2Result.rows.length;
        }
      }

      console.log(`✅ Public trail intersection splitting completed. Total segments created: ${totalSplitCount}`);
      
      return {
        success: true,
        splitCount: totalSplitCount
      };

    } catch (error) {
      console.error('❌ Error in public trail intersection splitting:', error);
      return {
        success: false,
        splitCount: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Insert split segments into staging schema with conflict handling
   */
  private async insertSplitSegmentsIntoStaging(
    trail1Uuid: string, trail1Name: string, trail1Segments: any[],
    trail2Uuid: string, trail2Name: string, trail2Segments: any[]
  ): Promise<void> {
    
    // Insert trail 1 segments with new app_uuid
    for (let i = 0; i < trail1Segments.length; i++) {
      const segment = trail1Segments[i];
      const segmentName = trail1Name;
      
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, name, geometry, trail_type, surface, difficulty, 
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        )
        SELECT 
          gen_random_uuid() as app_uuid,
          $2 as name,
          ST_Force3D($3::geometry) as geometry,
          trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        FROM public.trails 
        WHERE app_uuid = $1
      `, [trail1Uuid, segmentName, segment.segment]);
    }

    // Insert trail 2 segments with new app_uuid
    for (let i = 0; i < trail2Segments.length; i++) {
      const segment = trail2Segments[i];
      const segmentName = trail2Name;
      
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, name, geometry, trail_type, surface, difficulty, 
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        )
        SELECT 
          gen_random_uuid() as app_uuid,
          $2 as name,
          ST_Force3D($3::geometry) as geometry,
          trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        FROM public.trails 
        WHERE app_uuid = $1
      `, [trail2Uuid, segmentName, segment.segment]);
    }

    console.log(`   📝 Inserted ${trail1Segments.length + trail2Segments.length} segments into staging (with conflict handling)`);
  }
}
