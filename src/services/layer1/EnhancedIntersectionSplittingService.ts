import { Pool } from 'pg';

export interface EnhancedIntersectionSplittingResult {
  trailsProcessed: number;
  segmentsCreated: number;
  originalTrailsDeleted: number;
  intersectionCount: number;
}

export class EnhancedIntersectionSplittingService {
  constructor(
    private pgClient: Pool,
    private stagingSchema: string,
    private config: any
  ) {}

  /**
   * Apply enhanced intersection splitting to trails
   * This splits trails at their actual intersection points and properly deletes unsplit versions
   * Only applies splitting when geometry is not simple (has actual intersections)
   */
  async applyEnhancedIntersectionSplitting(): Promise<EnhancedIntersectionSplittingResult> {
    console.log('🔗 Applying enhanced intersection splitting...');
    
    // Increase minimum trail length to prevent over-splitting
    const minLength = 50.0; // Increased from 5.0 to 50.0 meters to prevent tiny segments
    
    // Use a transaction for atomic operations
    const client = await this.pgClient.connect();
    
    try {
      await client.query('BEGIN');
      
      // Step 1: Find all trail intersections with more conservative filtering
      // Only consider trails that have non-simple geometry (actual intersections)
      console.log('   🔍 Finding trail intersections...');
      const intersectionResult = await client.query(`
        WITH trail_intersections AS (
          SELECT DISTINCT
            t1.app_uuid as trail1_uuid,
            t2.app_uuid as trail2_uuid,
            ST_Intersection(t1.geometry, t2.geometry) as intersection_point
          FROM ${this.stagingSchema}.trails t1
          JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
          WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
            AND ST_Length(t1.geometry::geography) > $1
            AND ST_Length(t2.geometry::geography) > $1
            -- Skip trails that are already split segments
            AND t1.name NOT LIKE '%Segment%'
            AND t2.name NOT LIKE '%Segment%'
            -- Skip trails that already have original_trail_uuid set (already processed)
            AND t1.original_trail_uuid IS NULL
            AND t2.original_trail_uuid IS NULL
            -- Only split trails that are long enough to be meaningful
            AND ST_Length(t1.geometry::geography) > 200.0
            AND ST_Length(t2.geometry::geography) > 200.0
            -- Only split if the intersection is not at the very beginning or end of the trail
            AND ST_LineLocatePoint(t1.geometry, ST_Intersection(t1.geometry, t2.geometry)) > 0.05
            AND ST_LineLocatePoint(t1.geometry, ST_Intersection(t1.geometry, t2.geometry)) < 0.95
            AND ST_LineLocatePoint(t2.geometry, ST_Intersection(t1.geometry, t2.geometry)) > 0.05
            AND ST_LineLocatePoint(t2.geometry, ST_Intersection(t1.geometry, t2.geometry)) < 0.95
            -- Only split trails that have non-simple geometry (actual intersections, not just touching)
            AND NOT ST_IsSimple(ST_Union(t1.geometry, t2.geometry))
        )
        SELECT COUNT(*) as intersection_count
        FROM trail_intersections
      `, [minLength]);
      
      const intersectionCount = intersectionResult.rows[0]?.intersection_count || 0;
      console.log(`   🔍 Found ${intersectionCount} trail intersections`);
      
      if (intersectionCount === 0) {
        await client.query('COMMIT');
        return {
          trailsProcessed: 0,
          segmentsCreated: 0,
          originalTrailsDeleted: 0,
          intersectionCount: 0
        };
      }
      
      // Step 2: Create split segments with additional validation
      console.log('   ✂️ Creating split segments...');
      const splitResult = await client.query(`
        WITH trail_intersections AS (
          SELECT DISTINCT
            t1.app_uuid as trail1_uuid,
            t2.app_uuid as trail2_uuid,
            ST_Intersection(t1.geometry, t2.geometry) as intersection_point
          FROM ${this.stagingSchema}.trails t1
          JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
          WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
            AND ST_Length(t1.geometry::geography) > $1
            AND ST_Length(t2.geometry::geography) > $1
            -- Skip trails that are already split segments
            AND t1.name NOT LIKE '%Segment%'
            AND t2.name NOT LIKE '%Segment%'
            -- Skip trails that already have original_trail_uuid set (already processed)
            AND t1.original_trail_uuid IS NULL
            AND t2.original_trail_uuid IS NULL
            -- Only split trails that are long enough to be meaningful
            AND ST_Length(t1.geometry::geography) > 200.0
            AND ST_Length(t2.geometry::geography) > 200.0
            -- Only split if the intersection is not at the very beginning or end of the trail
            AND ST_LineLocatePoint(t1.geometry, ST_Intersection(t1.geometry, t2.geometry)) > 0.05
            AND ST_LineLocatePoint(t1.geometry, ST_Intersection(t1.geometry, t2.geometry)) < 0.95
            AND ST_LineLocatePoint(t2.geometry, ST_Intersection(t1.geometry, t2.geometry)) > 0.05
            AND ST_LineLocatePoint(t2.geometry, ST_Intersection(t1.geometry, t2.geometry)) < 0.95
            -- Only split trails that have non-simple geometry (actual intersections, not just touching)
            AND NOT ST_IsSimple(ST_Union(t1.geometry, t2.geometry))
        ),
        split_trails AS (
          SELECT
            t.id, t.app_uuid as original_trail_uuid, t.name, t.trail_type, t.surface, t.difficulty,
            t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
            t.source, t.source_tags, t.osm_id, t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
            t.geometry,
            (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).geom as split_geometry,
            (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).path[1] as segment_order
          FROM ${this.stagingSchema}.trails t
          JOIN trail_intersections ti ON t.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
        ),
        valid_segments AS (
          SELECT *
          FROM split_trails
          WHERE ST_GeometryType(split_geometry) = 'ST_LineString'
            AND ST_Length(split_geometry::geography) > $1
            -- Additional filter to prevent tiny segments
            AND ST_Length(split_geometry::geography) > 100.0
        )
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, original_trail_uuid, name, trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          source, source_tags, osm_id, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          geometry, length_km
        )
        SELECT
          gen_random_uuid()::uuid as app_uuid,
          original_trail_uuid,
          CASE 
            WHEN segment_order = 1 THEN name || ' (Segment 1)'
            WHEN segment_order = 2 THEN name || ' (Segment 2)'
            WHEN segment_order = 3 THEN name || ' (Segment 3)'
            ELSE name || ' (Segment ' || segment_order || ')'
          END as name,
          trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          source, source_tags, osm_id, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          split_geometry as geometry,
          ST_Length(split_geometry::geography) / 1000.0 as length_km
        FROM valid_segments
        RETURNING app_uuid
      `, [minLength]);
      
      const segmentsCreated = splitResult.rowCount || 0;
      console.log(`   ✂️ Created ${segmentsCreated} split segments`);
      
      // Step 3: Delete original trails that were split
      console.log('   🗑️ Deleting original trails that were split...');
      const deleteResult = await client.query(`
        DELETE FROM ${this.stagingSchema}.trails
        WHERE app_uuid IN (
          SELECT DISTINCT original_trail_uuid 
          FROM ${this.stagingSchema}.trails 
          WHERE original_trail_uuid IS NOT NULL
        )
      `);
      
      const originalTrailsDeleted = deleteResult.rowCount || 0;
      console.log(`   🗑️ Deleted ${originalTrailsDeleted} original trails that were split`);
      
      // Commit the transaction
      await client.query('COMMIT');
      
      return {
        trailsProcessed: intersectionCount,
        segmentsCreated,
        originalTrailsDeleted,
        intersectionCount
      };
      
    } catch (error) {
      // Rollback on error
      await client.query('ROLLBACK');
      console.error('❌ Error in enhanced intersection splitting:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}
