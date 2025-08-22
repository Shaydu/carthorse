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
   * This splits trails at ALL node intersections to ensure proper network connectivity
   * Uses a node-based approach rather than just self-intersections
   */
  async applyEnhancedIntersectionSplitting(): Promise<EnhancedIntersectionSplittingResult> {
    console.log('🔗 Applying enhanced intersection splitting (node-based approach)...');
    
    const client = await this.pgClient.connect();
    
    try {
      await client.query('BEGIN');
      
      // Step 1: Create a temporary table of all intersection points from trail crossings
      console.log('   🔍 Creating intersection points from trail crossings...');
      await client.query(`
        CREATE TEMP TABLE temp_intersection_points AS
        WITH trail_crossings AS (
          SELECT DISTINCT
            ST_Intersection(t1.geometry, t2.geometry) as intersection_point
          FROM ${this.stagingSchema}.trails t1
          JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
          WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
            AND ST_Length(t1.geometry::geography) > 5.0  -- Minimum 5m segments
            AND ST_Length(t2.geometry::geography) > 5.0
            -- Skip trails that are already split segments
            AND t1.name NOT LIKE '%Segment%'
            AND t2.name NOT LIKE '%Segment%'
            -- Skip trails that already have original_trail_uuid set (already processed)
            AND t1.original_trail_uuid IS NULL
            AND t2.original_trail_uuid IS NULL
        ),
        dumped_points AS (
          SELECT (ST_Dump(intersection_point)).geom as point_geom
          FROM trail_crossings
        ),
        unique_points AS (
          SELECT ST_SnapToGrid(point_geom, 0.00001) as snapped_point
          FROM dumped_points
          GROUP BY ST_SnapToGrid(point_geom, 0.00001)
        )
        SELECT 
          ROW_NUMBER() OVER () as point_id,
          snapped_point as the_geom
        FROM unique_points
      `);
      
      const intersectionCount = await client.query(`SELECT COUNT(*) as count FROM temp_intersection_points`);
      console.log(`   🔍 Found ${intersectionCount.rows[0].count} unique intersection points`);
      
      if (intersectionCount.rows[0].count === 0) {
        await client.query('COMMIT');
        return {
          trailsProcessed: 0,
          segmentsCreated: 0,
          originalTrailsDeleted: 0,
          intersectionCount: 0
        };
      }
      
      // Step 2: Split trails at all intersection points
      console.log('   ✂️ Splitting trails at intersection points...');
      await client.query(`
        CREATE TEMP TABLE temp_split_segments AS
        WITH trail_segments AS (
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
            -- Find all intersection points that lie on this trail
            ARRAY_AGG(ip.the_geom ORDER BY ST_LineLocatePoint(t.geometry, ip.the_geom)) as intersection_points
          FROM ${this.stagingSchema}.trails t
          CROSS JOIN temp_intersection_points ip
          WHERE ST_DWithin(t.geometry, ip.the_geom, 0.00001)  -- 1m tolerance
            AND ST_Length(t.geometry::geography) > 5.0
            AND t.name NOT LIKE '%Segment%'
            AND t.original_trail_uuid IS NULL
          GROUP BY t.id, t.app_uuid, t.name, t.geometry, t.length_km, t.elevation_gain, t.elevation_loss, t.trail_type, t.surface, t.difficulty, t.source
        )
        -- Handle trails that need to be split
        SELECT 
          ts.original_trail_id,
          ts.original_trail_uuid,
          ts.original_trail_name,
          COALESCE(split_geom, ts.original_geometry) as geometry,
          ts.length_km,
          ts.elevation_gain,
          ts.elevation_loss,
          ts.trail_type,
          ts.surface,
          ts.difficulty,
          ts.source,
          ST_Length(COALESCE(split_geom, ts.original_geometry)::geography) as segment_length_m
        FROM trail_segments ts
        LEFT JOIN LATERAL (
          SELECT (ST_Dump(ST_Split(ts.original_geometry, ST_Union(ts.intersection_points)))).geom as split_geom
          WHERE array_length(ts.intersection_points, 1) IS NOT NULL AND array_length(ts.intersection_points, 1) > 0
        ) split_result ON true
        WHERE ST_Length(COALESCE(split_geom, ts.original_geometry)::geography) > 5.0  -- Minimum 5m segments
      `);
      
      const segmentsCreated = await client.query(`SELECT COUNT(*) as count FROM temp_split_segments`);
      console.log(`   ✂️ Created ${segmentsCreated.rows[0].count} split segments`);
      
      // Step 3: Insert split segments into trails table
      console.log('   📝 Inserting split segments...');
      await client.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, name, geometry, length_km, elevation_gain, elevation_loss,
          trail_type, surface, difficulty, source, original_trail_uuid
        )
        SELECT 
          gen_random_uuid()::uuid as app_uuid,
          original_trail_name || ' Segment' as name,
          geometry,
          ST_Length(geometry::geography) / 1000.0 as length_km,
          elevation_gain,
          elevation_loss,
          trail_type,
          surface,
          difficulty,
          source,
          original_trail_uuid
        FROM temp_split_segments
        ORDER BY original_trail_id, segment_length_m DESC
      `);
      
      // Step 4: Delete original unsplit trails
      console.log('   🗑️ Deleting original unsplit trails...');
      const deleteResult = await client.query(`
        DELETE FROM ${this.stagingSchema}.trails 
        WHERE id IN (
          SELECT DISTINCT original_trail_id 
          FROM temp_split_segments
        )
      `);
      
      const trailsProcessed = deleteResult.rowCount || 0;
      console.log(`   🗑️ Deleted ${trailsProcessed} original trails`);
      
      await client.query('COMMIT');
      
      return {
        trailsProcessed,
        segmentsCreated: segmentsCreated.rows[0].count,
        originalTrailsDeleted: trailsProcessed,
        intersectionCount: intersectionCount.rows[0].count
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
