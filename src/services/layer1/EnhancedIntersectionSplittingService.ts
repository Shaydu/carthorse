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
          intersectionCount: 0
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
      
      // Step 2: Split trails at intersection points using the same logic as preview script
      console.log('   ✂️ Splitting trails at T/Y intersection points...');
      await client.query(`
        CREATE TEMP TABLE temp_split_segments AS
        WITH trails_to_split AS (
          SELECT DISTINCT visited_trail_id as trail_id
          FROM temp_intersection_points
        ),
        split_segments AS (
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
        ),
        all_segments AS (
          SELECT 
            ss.original_trail_id,
            ss.original_trail_uuid,
            ss.original_trail_name,
            ss.length_km,
            ss.elevation_gain,
            ss.elevation_loss,
            ss.trail_type,
            ss.surface,
            ss.difficulty,
            ss.source,
            -- Split the trail at intersection points
            (ST_Dump(ST_Split(ss.original_geometry, ST_Union(ss.intersection_points)))).geom as segment_geometry,
            (ST_Dump(ST_Split(ss.original_geometry, ST_Union(ss.intersection_points)))).path[1] as segment_index,
            ST_Length((ST_Dump(ST_Split(ss.original_geometry, ST_Union(ss.intersection_points)))).geom::geography) as segment_length_m
          FROM split_segments ss
          WHERE array_length(ss.intersection_points, 1) IS NOT NULL 
            AND array_length(ss.intersection_points, 1) > 0
        )
        SELECT 
          original_trail_id,
          original_trail_uuid,
          original_trail_name,
          segment_geometry as geometry,
          length_km,
          elevation_gain,
          elevation_loss,
          trail_type,
          surface,
          difficulty,
          source,
          segment_length_m
        FROM all_segments
        WHERE ST_GeometryType(segment_geometry) = 'ST_LineString'
          AND segment_length_m > 5.0  -- Minimum 5m segments
        ORDER BY original_trail_id, segment_index
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
