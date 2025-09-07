import { PoolClient } from 'pg';

export interface YIntersectionResult {
  intersectionsProcessed: number;
  trailsSplit: number;
  iterationsRun: number;
}

export class YIntersectionSnappingService {
  constructor(
    private pgClient: PoolClient,
    private stagingSchema: string
  ) {}

  /**
   * Process Y-intersections using comprehensive iterative approach from c51486d1
   * This implements the unified Y-intersection snapping and splitting logic
   */
  async processYIntersections(): Promise<YIntersectionResult> {
    console.log('🔄 Processing Y-intersections with comprehensive iterative approach...');
    
    const result: YIntersectionResult = {
      intersectionsProcessed: 0,
      trailsSplit: 0,
      iterationsRun: 0
    };

    const maxIterations = 10;
    let iteration = 1;
    let hasMoreIntersections = true;
    
    while (hasMoreIntersections && iteration <= maxIterations) {
      console.log(`   🔄 Iteration ${iteration}/${maxIterations}:`);
      
      // Find all geometric intersections
      const intersections = await this.findAllIntersections();
      console.log(`      📍 Found ${intersections.length} intersections to process`);
      
      if (intersections.length === 0) {
        console.log('      ✅ No more intersections found');
        hasMoreIntersections = false;
        break;
      }
      
      // Process each intersection
      let processedCount = 0;
      for (const intersection of intersections) {
        const success = await this.splitAtIntersection(intersection);
        if (success) {
          processedCount++;
          result.trailsSplit += 2; // Each intersection splits 2 trails
        }
      }
      
      console.log(`      ✅ Successfully processed ${processedCount}/${intersections.length} intersections`);
      result.intersectionsProcessed += processedCount;
      
      if (processedCount === 0) {
        console.log('      ⚠️ No intersections were successfully processed');
        hasMoreIntersections = false;
      }
      
      iteration++;
    }
    
    result.iterationsRun = iteration - 1;
    console.log(`   📊 Y-intersection processing complete: ${result.iterationsRun} iterations, ${result.intersectionsProcessed} intersections processed`);
    
    return result;
  }

  /**
   * Find all geometric intersections between trails
   * Based on c51486d1 comprehensive approach
   */
  private async findAllIntersections(): Promise<any[]> {
    const query = `
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          t2.geometry as trail2_geom
        FROM ${this.stagingSchema}.trails t1
        CROSS JOIN ${this.stagingSchema}.trails t2
        WHERE t1.app_uuid < t2.app_uuid  -- Avoid duplicate pairs
          AND ST_Length(t1.geometry::geography) >= 5  -- Min length filter
          AND ST_Length(t2.geometry::geography) >= 5
          AND ST_IsValid(t1.geometry)
          AND ST_IsValid(t2.geometry)
          AND ST_Intersects(t1.geometry, t2.geometry)
      ),
      -- X-intersections: both trails intersect at midpoints
      x_intersections AS (
        SELECT 
          trail1_id,
          trail1_name,
          trail1_geom,
          trail2_id,
          trail2_name,
          trail2_geom,
          dump.geom as intersection_point,
          dump.path[1] as point_number,
          'x_intersection' as intersection_type,
          NULL as endpoint_type,
          0 as distance
        FROM trail_pairs,
        LATERAL ST_Dump(ST_Intersection(trail1_geom, trail2_geom)) dump
        WHERE ST_GeometryType(dump.geom) = 'ST_Point'
      ),
      -- T-intersections: one trail endpoint is close to another trail's midpoint
      t_intersections AS (
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          t2.geometry as trail2_geom,
          ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry)) as intersection_point,
          1 as point_number,
          't_intersection' as intersection_type,
          'trail1_start' as endpoint_type,
          ST_Distance(ST_StartPoint(t1.geometry)::geography, t2.geometry::geography) as distance
        FROM ${this.stagingSchema}.trails t1
        CROSS JOIN ${this.stagingSchema}.trails t2
        WHERE t1.app_uuid < t2.app_uuid
          AND ST_Length(t1.geometry::geography) >= 5
          AND ST_Length(t2.geometry::geography) >= 5
          AND ST_IsValid(t1.geometry)
          AND ST_IsValid(t2.geometry)
          AND ST_Distance(ST_StartPoint(t1.geometry)::geography, t2.geometry::geography) <= 10.0
          AND ST_LineLocatePoint(t2.geometry, ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry))) > 0.05
          AND ST_LineLocatePoint(t2.geometry, ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry))) < 0.95
          
        UNION ALL
        
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          t2.geometry as trail2_geom,
          ST_ClosestPoint(t2.geometry, ST_EndPoint(t1.geometry)) as intersection_point,
          1 as point_number,
          't_intersection' as intersection_type,
          'trail1_end' as endpoint_type,
          ST_Distance(ST_EndPoint(t1.geometry)::geography, t2.geometry::geography) as distance
        FROM ${this.stagingSchema}.trails t1
        CROSS JOIN ${this.stagingSchema}.trails t2
        WHERE t1.app_uuid < t2.app_uuid
          AND ST_Length(t1.geometry::geography) >= 5
          AND ST_Length(t2.geometry::geography) >= 5
          AND ST_IsValid(t1.geometry)
          AND ST_IsValid(t2.geometry)
          AND ST_Distance(ST_EndPoint(t1.geometry)::geography, t2.geometry::geography) <= 10.0
          AND ST_LineLocatePoint(t2.geometry, ST_ClosestPoint(t2.geometry, ST_EndPoint(t1.geometry))) > 0.05
          AND ST_LineLocatePoint(t2.geometry, ST_ClosestPoint(t2.geometry, ST_EndPoint(t1.geometry))) < 0.95
          
        UNION ALL
        
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          t2.geometry as trail2_geom,
          ST_ClosestPoint(t1.geometry, ST_StartPoint(t2.geometry)) as intersection_point,
          1 as point_number,
          't_intersection' as intersection_type,
          'trail2_start' as endpoint_type,
          ST_Distance(ST_StartPoint(t2.geometry)::geography, t1.geometry::geography) as distance
        FROM ${this.stagingSchema}.trails t1
        CROSS JOIN ${this.stagingSchema}.trails t2
        WHERE t1.app_uuid < t2.app_uuid
          AND ST_Length(t1.geometry::geography) >= 5
          AND ST_Length(t2.geometry::geography) >= 5
          AND ST_IsValid(t1.geometry)
          AND ST_IsValid(t2.geometry)
          AND ST_Distance(ST_StartPoint(t2.geometry)::geography, t1.geometry::geography) <= 10.0
          AND ST_LineLocatePoint(t1.geometry, ST_ClosestPoint(t1.geometry, ST_StartPoint(t2.geometry))) > 0.05
          AND ST_LineLocatePoint(t1.geometry, ST_ClosestPoint(t1.geometry, ST_StartPoint(t2.geometry))) < 0.95
          
        UNION ALL
        
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          t2.geometry as trail2_geom,
          ST_ClosestPoint(t1.geometry, ST_EndPoint(t2.geometry)) as intersection_point,
          1 as point_number,
          't_intersection' as intersection_type,
          'trail2_end' as endpoint_type,
          ST_Distance(ST_EndPoint(t2.geometry)::geography, t1.geometry::geography) as distance
        FROM ${this.stagingSchema}.trails t1
        CROSS JOIN ${this.stagingSchema}.trails t2
        WHERE t1.app_uuid < t2.app_uuid
          AND ST_Length(t1.geometry::geography) >= 5
          AND ST_Length(t2.geometry::geography) >= 5
          AND ST_IsValid(t1.geometry)
          AND ST_IsValid(t2.geometry)
          AND ST_Distance(ST_EndPoint(t2.geometry)::geography, t1.geometry::geography) <= 10.0
          AND ST_LineLocatePoint(t1.geometry, ST_ClosestPoint(t1.geometry, ST_EndPoint(t2.geometry))) > 0.05
          AND ST_LineLocatePoint(t1.geometry, ST_ClosestPoint(t1.geometry, ST_EndPoint(t2.geometry))) < 0.95
      ),
      all_intersections AS (
        SELECT * FROM x_intersections
        UNION ALL
        SELECT * FROM t_intersections
      ),
      valid_intersections AS (
        SELECT 
          *,
          CASE 
            WHEN intersection_type = 'x_intersection' THEN ST_LineLocatePoint(trail1_geom, intersection_point)
            ELSE NULL
          END as trail1_split_ratio,
          CASE 
            WHEN intersection_type = 'x_intersection' THEN ST_LineLocatePoint(trail2_geom, intersection_point)
            ELSE ST_LineLocatePoint(
              CASE 
                WHEN endpoint_type IN ('trail1_start', 'trail1_end') THEN trail2_geom
                ELSE trail1_geom
              END, 
              intersection_point
            )
          END as trail2_split_ratio
        FROM all_intersections
      )
      SELECT 
        trail1_id,
        trail1_name,
        trail2_id,
        trail2_name,
        ST_AsGeoJSON(intersection_point)::json as intersection_point_json,
        trail1_split_ratio,
        trail2_split_ratio,
        intersection_type,
        endpoint_type,
        distance
      FROM valid_intersections
      ORDER BY 
        CASE WHEN intersection_type = 't_intersection' THEN 0 ELSE 1 END,  -- Process T-intersections first
        trail1_name, trail2_name, point_number
      LIMIT 50  -- Process in batches to avoid overwhelming
    `;
    
    const result = await this.pgClient.query(query);
    return result.rows;
  }

  /**
   * Split trails at intersection point
   * Based on c51486d1 approach
   * Now handles both X-intersections and T-intersections
   */
  private async splitAtIntersection(intersection: any): Promise<boolean> {
    try {
      // Get the full trail geometries
      const trail1Result = await this.pgClient.query(
        `SELECT * FROM ${this.stagingSchema}.trails WHERE app_uuid = $1`,
        [intersection.trail1_id]
      );
      
      const trail2Result = await this.pgClient.query(
        `SELECT * FROM ${this.stagingSchema}.trails WHERE app_uuid = $1`,
        [intersection.trail2_id]
      );
      
      if (trail1Result.rows.length === 0 || trail2Result.rows.length === 0) {
        return false; // Trails may have been deleted in previous iteration
      }
      
      const trail1 = trail1Result.rows[0];
      const trail2 = trail2Result.rows[0];
      
      const intersectionPoint = `ST_SetSRID(POINT(${intersection.intersection_point_json.coordinates[0]} ${intersection.intersection_point_json.coordinates[1]}), 4326)`;
      
      if (intersection.intersection_type === 't_intersection') {
        // Handle T-intersection: split visited trail and snap visitor trail
        return await this.handleTIntersection(trail1, trail2, intersectionPoint, intersection);
      } else {
        // Handle X-intersection: split both trails at the intersection point
        await this.splitTrailAtPoint(trail1, intersectionPoint, intersection.trail1_split_ratio);
        await this.splitTrailAtPoint(trail2, intersectionPoint, intersection.trail2_split_ratio);
        return true;
      }
      
    } catch (error) {
      console.log(`      ❌ Failed to split intersection: ${intersection.trail1_name} × ${intersection.trail2_name}`);
      console.log(`         Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Handle T-intersection: split visited trail and snap visitor trail endpoint
   * This implements the core requirement: snap visitor trail's endpoint to visited trail's midpoint
   */
  private async handleTIntersection(trail1: any, trail2: any, intersectionPoint: string, intersection: any): Promise<boolean> {
    try {
      // Determine which trail is the visitor (has endpoint close to intersection) and which is visited
      let visitorTrail, visitedTrail, visitorEndpoint;
      
      if (intersection.endpoint_type === 'trail1_start') {
        visitorTrail = trail1;
        visitedTrail = trail2;
        visitorEndpoint = 'start';
      } else if (intersection.endpoint_type === 'trail1_end') {
        visitorTrail = trail1;
        visitedTrail = trail2;
        visitorEndpoint = 'end';
      } else if (intersection.endpoint_type === 'trail2_start') {
        visitorTrail = trail2;
        visitedTrail = trail1;
        visitorEndpoint = 'start';
      } else if (intersection.endpoint_type === 'trail2_end') {
        visitorTrail = trail2;
        visitedTrail = trail1;
        visitorEndpoint = 'end';
      } else {
        console.log(`      ❌ Unknown endpoint type: ${intersection.endpoint_type}`);
        return false;
      }
      
      console.log(`      🔗 T-intersection: ${visitorTrail.name} (${visitorEndpoint}) → ${visitedTrail.name} (midpoint)`);
      
      // Step 1: Split the visited trail at the intersection point
      await this.splitTrailAtPoint(visitedTrail, intersectionPoint, intersection.trail2_split_ratio);
      
      // Step 2: Snap the visitor trail's endpoint to the intersection point
      await this.snapVisitorTrailEndpoint(visitorTrail, intersectionPoint, visitorEndpoint);
      
      return true;
      
    } catch (error) {
      console.log(`      ❌ Failed to handle T-intersection: ${trail1.name} × ${trail2.name}`);
      console.log(`         Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Snap visitor trail's endpoint to the intersection point
   * This extends the visitor trail to connect to the visited trail's midpoint
   */
  private async snapVisitorTrailEndpoint(visitorTrail: any, intersectionPoint: string, endpointType: string): Promise<void> {
    // Parse the intersection point coordinates from the string
    const coords = intersectionPoint.match(/POINT\(([^)]+)\)/);
    if (!coords) {
      throw new Error(`Invalid intersection point format: ${intersectionPoint}`);
    }
    
    const [lng, lat] = coords[1].split(' ').map(Number);
    
    // Create the new snapped geometry by replacing the endpoint
    let snappedGeometryQuery;
    if (endpointType === 'start') {
      // Replace the start point with the intersection point
      snappedGeometryQuery = `
        ST_SetPoint(geometry, 0, ST_SetSRID(ST_MakePoint($1, $2), 4326))
      `;
    } else {
      // Replace the end point with the intersection point
      snappedGeometryQuery = `
        ST_SetPoint(geometry, ST_NumPoints(geometry) - 1, ST_SetSRID(ST_MakePoint($1, $2), 4326))
      `;
    }
    
    // Update the visitor trail with the snapped geometry
    await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET 
        geometry = ${snappedGeometryQuery},
        length_km = ST_Length(${snappedGeometryQuery}::geography) / 1000.0
      WHERE app_uuid = $3
    `, [lng, lat, visitorTrail.app_uuid]);
    
    console.log(`      ✅ Snapped ${visitorTrail.name} ${endpointType} endpoint to intersection point (${lng}, ${lat})`);
  }

  /**
   * Split a trail at a specific point using split ratio
   * Based on c51486d1 approach
   */
  private async splitTrailAtPoint(trail: any, intersectionPoint: string, splitRatio: number): Promise<void> {
    // Parse the intersection point coordinates from the string
    const coords = intersectionPoint.match(/POINT\(([^)]+)\)/);
    if (!coords) {
      throw new Error(`Invalid intersection point format: ${intersectionPoint}`);
    }
    
    const [lng, lat] = coords[1].split(' ').map(Number);
    // Create two segments from the original trail
    const segment1Query = `
      SELECT 
        ST_LineSubstring(geometry, 0.0, $1) as segment_geom,
        ST_Length(ST_LineSubstring(geometry, 0.0, $1)::geography) as segment_length
      FROM ${this.stagingSchema}.trails 
      WHERE app_uuid = $2
    `;
    
    const segment2Query = `
      SELECT 
        ST_LineSubstring(geometry, $1, 1.0) as segment_geom,
        ST_Length(ST_LineSubstring(geometry, $1, 1.0)::geography) as segment_length
      FROM ${this.stagingSchema}.trails 
      WHERE app_uuid = $2
    `;
    
    const seg1Result = await this.pgClient.query(segment1Query, [splitRatio, trail.app_uuid]);
    const seg2Result = await this.pgClient.query(segment2Query, [splitRatio, trail.app_uuid]);
    
    if (seg1Result.rows.length === 0 || seg2Result.rows.length === 0) {
      throw new Error('Failed to create segments');
    }
    
    const segment1 = seg1Result.rows[0];
    const segment2 = seg2Result.rows[0];
    
    // Only create segments that are long enough (> 1m)
    const segments = [];
    if (segment1.segment_length > 1.0) {
      segments.push({
        geom: segment1.segment_geom,
        length_km: segment1.segment_length / 1000.0,
        suffix: 'Segment A'
      });
    }
    
    if (segment2.segment_length > 1.0) {
      segments.push({
        geom: segment2.segment_geom,
        length_km: segment2.segment_length / 1000.0,
        suffix: 'Segment B'
      });
    }
    
    if (segments.length === 0) {
      return; // Trail too short to split meaningfully
    }
    
    // Insert new segments - keep original name without modification
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, name, trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          source, source_tags, osm_id, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          length_km, geometry, original_trail_uuid
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
      `, [
        trail.name, // Keep original name without modification
        trail.trail_type, trail.surface, trail.difficulty,
        trail.elevation_gain, trail.elevation_loss, trail.max_elevation, trail.min_elevation, trail.avg_elevation,
        trail.source, trail.source_tags, trail.osm_id,
        trail.bbox_min_lng, trail.bbox_max_lng, trail.bbox_min_lat, trail.bbox_max_lat,
        segment.length_km, segment.geom, trail.app_uuid
      ]);
    }
    
    // Delete the original trail
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.trails WHERE app_uuid = $1`, [trail.app_uuid]);
  }
}