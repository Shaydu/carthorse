import { Pool } from 'pg';

export interface MissedIntersectionDetectionResult {
  success: boolean;
  intersectionsFound: number;
  trailsSplit: number;
  error?: string;
}

export interface MissedIntersection {
  visitorTrailUuid: string;
  visitorTrailName: string;
  visitedTrailUuid: string;
  visitedTrailName: string;
  intersectionPoint: any;
  distanceMeters: number;
  intersectionType: 'endpoint_to_trail' | 'trail_to_endpoint';
}

export class MissedIntersectionDetectionService {
  private stagingSchema: string;
  private pgClient: Pool;

  constructor(config: { stagingSchema: string; pgClient: Pool }) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
  }

  /**
   * Detect and fix missed intersections that the standard intersection detection missed
   * This service focuses on cases where trails are very close but don't intersect geometrically
   */
  async detectAndFixMissedIntersections(): Promise<MissedIntersectionDetectionResult> {
    try {
      console.log('🔍 Starting missed intersection detection...');
      
      // Step 1: Find potential missed intersections
      const missedIntersections = await this.findMissedIntersections();
      
      console.log(`🔍 Found ${missedIntersections.length} potential missed intersections`);
      
      if (missedIntersections.length === 0) {
        return {
          success: true,
          intersectionsFound: 0,
          trailsSplit: 0
        };
      }

      // Step 2: Process each missed intersection
      let trailsSplit = 0;
      for (const intersection of missedIntersections) {
        console.log(`🔗 Processing missed intersection: ${intersection.visitorTrailName} → ${intersection.visitedTrailName} (${intersection.distanceMeters.toFixed(3)}m)`);
        
        const splitSuccess = await this.splitTrailAtIntersection(intersection);
        if (splitSuccess) {
          trailsSplit++;
        }
      }

      console.log(`✅ Missed intersection detection completed: ${trailsSplit} trails split`);

      return {
        success: true,
        intersectionsFound: missedIntersections.length,
        trailsSplit
      };

    } catch (error) {
      console.error('❌ Error in missed intersection detection:', error);
      return {
        success: false,
        intersectionsFound: 0,
        trailsSplit: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Find potential missed intersections using enhanced detection logic
   * Focuses on endpoint-to-trail intersections where one trail's endpoint
   * is very close to another trail's path (not just endpoints)
   */
  private async findMissedIntersections(): Promise<MissedIntersection[]> {
    console.log('🔍 Searching for missed intersections...');

    // Use a more aggressive tolerance for missed intersection detection
    const toleranceMeters = 5.0; // 5 meter tolerance - increased to catch more intersections
    const toleranceDegrees = toleranceMeters / 111000; // Rough conversion to degrees

    const query = `
      WITH trail_pairs AS (
        SELECT DISTINCT
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t2.geometry as trail2_geom
        FROM ${this.stagingSchema}.trails t1
        CROSS JOIN ${this.stagingSchema}.trails t2
        WHERE t1.app_uuid < t2.app_uuid  -- Avoid duplicate pairs
          AND ST_DWithin(t1.geometry, t2.geometry, $1)  -- Within tolerance
          AND NOT ST_Intersects(t1.geometry, t2.geometry)  -- Don't already intersect
      ),
      endpoint_to_trail_distances AS (
        SELECT 
          trail1_uuid, trail1_name, trail1_geom,
          trail2_uuid, trail2_name, trail2_geom,
          -- Distance from trail1 endpoints to trail2 (trail1 is visitor)
          ST_Distance(ST_StartPoint(trail1_geom), trail2_geom) as t1_start_to_t2,
          ST_Distance(ST_EndPoint(trail1_geom), trail2_geom) as t1_end_to_t2,
          -- Distance from trail2 endpoints to trail1 (trail2 is visitor)
          ST_Distance(ST_StartPoint(trail2_geom), trail1_geom) as t2_start_to_t1,
          ST_Distance(ST_EndPoint(trail2_geom), trail1_geom) as t2_end_to_t1
        FROM trail_pairs
      ),
      closest_endpoint_distances AS (
        SELECT 
          trail1_uuid, trail1_name, trail1_geom,
          trail2_uuid, trail2_name, trail2_geom,
          -- Find minimum distance from trail1 endpoints to trail2
          LEAST(t1_start_to_t2, t1_end_to_t2) as t1_endpoint_to_t2_distance,
          -- Find minimum distance from trail2 endpoints to trail1
          LEAST(t2_start_to_t1, t2_end_to_t1) as t2_endpoint_to_t1_distance,
          -- Determine which endpoint of trail1 is closest to trail2
          CASE 
            WHEN t1_start_to_t2 <= t1_end_to_t2 THEN ST_StartPoint(trail1_geom)
            ELSE ST_EndPoint(trail1_geom)
          END as t1_closest_endpoint,
          -- Determine which endpoint of trail2 is closest to trail1
          CASE 
            WHEN t2_start_to_t1 <= t2_end_to_t1 THEN ST_StartPoint(trail2_geom)
            ELSE ST_EndPoint(trail2_geom)
          END as t2_closest_endpoint
        FROM endpoint_to_trail_distances
      )
      SELECT 
        -- Choose the trail with the closest endpoint as the visitor
        CASE 
          WHEN t1_endpoint_to_t2_distance < t2_endpoint_to_t1_distance THEN trail1_uuid
          ELSE trail2_uuid
        END as visitor_trail_uuid,
        CASE 
          WHEN t1_endpoint_to_t2_distance < t2_endpoint_to_t1_distance THEN trail1_name
          ELSE trail2_name
        END as visitor_trail_name,
        CASE 
          WHEN t1_endpoint_to_t2_distance < t2_endpoint_to_t1_distance THEN trail2_uuid
          ELSE trail1_uuid
        END as visited_trail_uuid,
        CASE 
          WHEN t1_endpoint_to_t2_distance < t2_endpoint_to_t1_distance THEN trail2_name
          ELSE trail1_name
        END as visited_trail_name,
        CASE 
          WHEN t1_endpoint_to_t2_distance < t2_endpoint_to_t1_distance THEN t1_closest_endpoint
          ELSE t2_closest_endpoint
        END as visitor_endpoint,
        LEAST(t1_endpoint_to_t2_distance, t2_endpoint_to_t1_distance) as distance_meters,
        'endpoint_to_trail' as intersection_type
      FROM closest_endpoint_distances
      WHERE LEAST(t1_endpoint_to_t2_distance, t2_endpoint_to_t1_distance) <= $2  -- Within tolerance
      ORDER BY LEAST(t1_endpoint_to_t2_distance, t2_endpoint_to_t1_distance)
      LIMIT 50  -- Process most promising intersections first
    `;

    const result = await this.pgClient.query(query, [toleranceDegrees, toleranceMeters]);
    
    console.log(`🔍 Found ${result.rows.length} potential missed intersections`);
    if (result.rows.length > 0) {
      console.log('   Top intersections:');
      result.rows.slice(0, 5).forEach((row, i) => {
        console.log(`   ${i+1}. ${row.visitor_trail_name} → ${row.visited_trail_name} (${parseFloat(row.distance_meters).toFixed(3)}m)`);
      });
    }
    
    return result.rows.map(row => ({
      visitorTrailUuid: row.visitor_trail_uuid,
      visitorTrailName: row.visitor_trail_name,
      visitedTrailUuid: row.visited_trail_uuid,
      visitedTrailName: row.visited_trail_name,
      intersectionPoint: row.visitor_endpoint, // This is the visitor's endpoint
      distanceMeters: parseFloat(row.distance_meters),
      intersectionType: row.intersection_type as 'endpoint_to_trail' | 'trail_to_endpoint'
    }));
  }

  /**
   * Split a trail at the intersection point
   * Logic: Find closest point on visited trail to visitor's endpoint,
   * snap visitor endpoint to that point, then split visited trail
   */
  private async splitTrailAtIntersection(intersection: MissedIntersection): Promise<boolean> {
    try {
      console.log(`   🔧 Processing intersection: ${intersection.visitorTrailName} endpoint → ${intersection.visitedTrailName}`);

      // Step 1: Get both trail geometries
      const [visitedTrailResult, visitorTrailResult] = await Promise.all([
        this.pgClient.query(`
          SELECT geometry, name, trail_type, surface, difficulty,
                 length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                 bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                 source, source_tags, osm_id, original_trail_uuid
          FROM ${this.stagingSchema}.trails 
          WHERE app_uuid = $1
        `, [intersection.visitedTrailUuid]),
        this.pgClient.query(`
          SELECT geometry, name
          FROM ${this.stagingSchema}.trails 
          WHERE app_uuid = $1
        `, [intersection.visitorTrailUuid])
      ]);

      if (visitedTrailResult.rows.length === 0) {
        console.log(`   ⚠️ Visited trail not found: ${intersection.visitedTrailUuid}`);
        return false;
      }

      if (visitorTrailResult.rows.length === 0) {
        console.log(`   ⚠️ Visitor trail not found: ${intersection.visitorTrailUuid}`);
        return false;
      }

      const visitedTrail = visitedTrailResult.rows[0];
      const visitorTrail = visitorTrailResult.rows[0];

      // Step 2: Find the closest point on the visited trail to the visitor's endpoint
      const closestPointResult = await this.pgClient.query(`
        SELECT ST_Force3D(ST_ClosestPoint($1::geometry, $2::geometry)) as closest_point
      `, [visitedTrail.geometry, intersection.intersectionPoint]);

      if (closestPointResult.rows.length === 0) {
        console.log(`   ⚠️ Could not find closest point on ${intersection.visitedTrailName}`);
        return false;
      }

      const closestPoint = closestPointResult.rows[0].closest_point;

      if (!closestPoint) {
        console.log(`   ⚠️ Closest point is null for ${intersection.visitedTrailName}`);
        return false;
      }

      console.log(`   📍 Found closest point on ${intersection.visitedTrailName} to ${intersection.visitorTrailName} endpoint`);

      // Step 3: Snap the visitor trail's endpoint to the closest point
      const snappedVisitorResult = await this.pgClient.query(`
        SELECT ST_Force3D(ST_Snap($1::geometry, $2::geometry, 1e-6)) as snapped_geometry
      `, [visitorTrail.geometry, closestPoint]);

      const snappedVisitorGeometry = snappedVisitorResult.rows[0].snapped_geometry;

      // Step 4: Update the visitor trail with snapped geometry
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.trails 
        SET geometry = $1
        WHERE app_uuid = $2
      `, [snappedVisitorGeometry, intersection.visitorTrailUuid]);

      console.log(`   🔗 Snapped ${intersection.visitorTrailName} endpoint to closest point on ${intersection.visitedTrailName}`);

      // Step 5: Split the visited trail at the closest point
      // Use ST_LineLocatePoint to find the position along the line, then use ST_LineSubstring
      const splitResult = await this.pgClient.query(`
        WITH line_info AS (
          SELECT 
            $1::geometry as line_geom,
            $2::geometry as split_point,
            ST_LineLocatePoint($1::geometry, $2::geometry) as split_position,
            ST_Length($1::geometry) as line_length
        ),
        valid_split AS (
          SELECT 
            line_geom,
            split_point,
            split_position,
            line_length,
            CASE 
              WHEN split_position < 0.01 THEN 0.01  -- Minimum 1% from start
              WHEN split_position > 0.99 THEN 0.99  -- Maximum 99% from start
              ELSE split_position
            END as actual_split_position
          FROM line_info
        )
        SELECT 
          ST_Force3D(ST_LineSubstring(line_geom, 0, actual_split_position)) as segment1,
          ST_Force3D(ST_LineSubstring(line_geom, actual_split_position, 1)) as segment2
        FROM valid_split
        WHERE actual_split_position > 0.01 AND actual_split_position < 0.99
      `, [visitedTrail.geometry, closestPoint]);

      if (splitResult.rows.length === 0) {
        // Get the split position and calculate distances for better logging
        const splitPositionResult = await this.pgClient.query(`
          SELECT 
            ST_LineLocatePoint($1::geometry, $2::geometry) as split_position,
            ST_Length($1::geometry) as line_length,
            ST_StartPoint($1::geometry) as start_point,
            ST_EndPoint($1::geometry) as end_point,
            $2::geometry as split_point
        `, [visitedTrail.geometry, closestPoint]);
        
        if (splitPositionResult.rows.length > 0) {
          const row = splitPositionResult.rows[0];
          const splitPosition = parseFloat(row.split_position);
          const lineLength = parseFloat(row.line_length);
          const distanceFromStart = splitPosition * lineLength;
          const distanceFromEnd = lineLength - distanceFromStart;
          
          console.log(`   ⚠️ Trail could not be split (split position too close to endpoints)`);
          if (closestPoint && closestPoint.coordinates) {
            console.log(`      Split coordinate: [${closestPoint.coordinates[0].toFixed(6)}, ${closestPoint.coordinates[1].toFixed(6)}]`);
          }
          if (row.start_point && row.start_point.coordinates) {
            console.log(`      Start endpoint: [${row.start_point.coordinates[0].toFixed(6)}, ${row.start_point.coordinates[1].toFixed(6)}]`);
          }
          if (row.end_point && row.end_point.coordinates) {
            console.log(`      End endpoint: [${row.end_point.coordinates[0].toFixed(6)}, ${row.end_point.coordinates[1].toFixed(6)}]`);
          }
          console.log(`      Distance from start: ${distanceFromStart.toFixed(2)}m, Distance from end: ${distanceFromEnd.toFixed(2)}m`);
        } else {
          console.log(`   ⚠️ Trail could not be split (split position too close to endpoints)`);
        }
        return false;
      }

      const segments = [
        splitResult.rows[0].segment1,
        splitResult.rows[0].segment2
      ].filter(segment => segment);

      // Step 6: Delete the original visited trail
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.trails WHERE app_uuid = $1
      `, [intersection.visitedTrailUuid]);

      // Step 7: Insert the split segments
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        
        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.trails (
            app_uuid, name, geometry, trail_type, surface, difficulty,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            source, source_tags, osm_id, original_trail_uuid
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10, $11,
            $12, $13, $14, $15,
            $16, $17, $18, $19
          )
        `, [
          visitedTrail.name, // Keep original name
          segment,           // Split geometry
          visitedTrail.trail_type,
          visitedTrail.surface,
          visitedTrail.difficulty,
          visitedTrail.length_km,
          visitedTrail.elevation_gain,
          visitedTrail.elevation_loss,
          visitedTrail.max_elevation,
          visitedTrail.min_elevation,
          visitedTrail.avg_elevation,
          visitedTrail.bbox_min_lng,
          visitedTrail.bbox_max_lng,
          visitedTrail.bbox_min_lat,
          visitedTrail.bbox_max_lat,
          visitedTrail.source,
          visitedTrail.source_tags,
          visitedTrail.osm_id,
          visitedTrail.original_trail_uuid
        ]);
      }

      console.log(`   ✅ Successfully processed intersection:`);
      console.log(`      - Snapped ${intersection.visitorTrailName} endpoint to closest point`);
      console.log(`      - Split ${intersection.visitedTrailName} into ${splitResult.rows.length} segments`);
      return true;

    } catch (error) {
      console.error(`   ❌ Error processing intersection ${intersection.visitorTrailName} → ${intersection.visitedTrailName}:`, error);
      return false;
    }
  }

  /**
   * Get statistics about the current trail network
   */
  async getNetworkStatistics(): Promise<{
    totalTrails: number;
    averageTrailLength: number;
    trailsWithIntersections: number;
  }> {
    const statsResult = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        AVG(ST_Length(geometry::geography)) as avg_length_meters,
        COUNT(CASE WHEN original_trail_uuid IS NOT NULL THEN 1 END) as trails_with_intersections
      FROM ${this.stagingSchema}.trails
    `);

    const stats = statsResult.rows[0];
    return {
      totalTrails: parseInt(stats.total_trails),
      averageTrailLength: parseFloat(stats.avg_length_meters) || 0,
      trailsWithIntersections: parseInt(stats.trails_with_intersections)
    };
  }
}
