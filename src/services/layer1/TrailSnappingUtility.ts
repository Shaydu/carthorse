import { Pool } from 'pg';

export interface SnappingResult {
  success: boolean;
  segmentsCreated: number;
  snappedGeometry?: any;
  error?: string;
}

export interface TrailSnappingConfig {
  stagingSchema: string;
  pgClient: Pool;
  minSegmentLengthMeters: number;
  snappingToleranceMeters?: number; // Default 1e-6
  verbose?: boolean;
}

/**
 * Utility class for standardizing endpoint-to-midpoint snapping across all splitting services
 * This ensures consistent T-intersection handling throughout the system
 */
export class TrailSnappingUtility {
  constructor(private config: TrailSnappingConfig) {}

  /**
   * Snap a visitor trail's endpoint to a visited trail at an intersection point
   * This is the core T-intersection snapping logic used by all splitting services
   */
  async snapVisitorTrailToVisitedTrail(
    visitorTrail: any, 
    visitedTrail: any, 
    intersectionPoint: any
  ): Promise<SnappingResult> {
    const { stagingSchema, pgClient, minSegmentLengthMeters, snappingToleranceMeters = 1e-6, verbose = false } = this.config;

    try {
      if (verbose) {
        console.log(`      🔗 Snapping ${visitorTrail.name} to ${visitedTrail.name} at intersection`);
      }

      // Step 1: Find which endpoint of the visitor trail is closer to the intersection point
      const endpointAnalysis = await pgClient.query(`
        SELECT 
          ST_Distance(ST_StartPoint($1), $2::geography) as start_distance,
          ST_Distance(ST_EndPoint($1), $2::geography) as end_distance
      `, [visitorTrail.geometry, intersectionPoint]);

      const startDistance = endpointAnalysis.rows[0].start_distance;
      const endDistance = endpointAnalysis.rows[0].end_distance;
      
      // Determine which endpoint to extend
      const extendFromStart = startDistance < endDistance;
      const endpointToExtend = extendFromStart ? 'ST_StartPoint' : 'ST_EndPoint';

      if (verbose) {
        console.log(`      📍 Extending from ${extendFromStart ? 'start' : 'end'} point (distances: ${startDistance.toFixed(3)}m vs ${endDistance.toFixed(3)}m)`);
      }

      // Step 2: Create a new trail segment that extends from the visitor trail's endpoint to the intersection point
      const extendedTrailResult = await pgClient.query(`
        SELECT ST_Force3D(ST_MakeLine(${endpointToExtend}($1), $2)) as extended_geometry
      `, [visitorTrail.geometry, intersectionPoint]);

      const extendedGeometry = extendedTrailResult.rows[0].extended_geometry;

      // Step 3: Check if the extended segment is long enough
      const lengthResult = await pgClient.query(`
        SELECT ST_Length($1::geography) as length_meters
      `, [extendedGeometry]);

      const lengthMeters = lengthResult.rows[0].length_meters;

      if (lengthMeters < minSegmentLengthMeters) {
        if (verbose) {
          console.log(`      ⚠️ Extended segment too short: ${lengthMeters.toFixed(3)}m < ${minSegmentLengthMeters}m`);
        }
        return { success: false, segmentsCreated: 0 };
      }

      // Step 4: Insert the extended trail segment
      await pgClient.query(`
        INSERT INTO ${stagingSchema}.trails (
          app_uuid, name, geometry, trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        )
        SELECT 
          gen_random_uuid() as app_uuid,
          $1 as name,
          $2::geometry as geometry,
          trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        FROM ${stagingSchema}.trails 
        WHERE app_uuid = $3
      `, [visitorTrail.name, extendedGeometry, visitorTrail.app_uuid]);

      // Step 5: Delete the original visitor trail
      await pgClient.query(`
        DELETE FROM ${stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [visitorTrail.app_uuid]);

      if (verbose) {
        console.log(`      ✅ Successfully snapped ${visitorTrail.name} (${lengthMeters.toFixed(3)}m extended segment)`);
      }

      return { 
        success: true, 
        segmentsCreated: 1,
        snappedGeometry: extendedGeometry
      };

    } catch (error) {
      console.error(`❌ Error snapping visitor trail ${visitorTrail.name} to visited trail ${visitedTrail.name}:`, error);
      return { 
        success: false, 
        segmentsCreated: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Find the closest point on a trail to an intersection point
   * Used for precise splitting operations
   */
  async findClosestPointOnTrail(trail: any, intersectionPoint: any): Promise<any> {
    const { pgClient } = this.config;

    const closestPointResult = await pgClient.query(`
      SELECT ST_Force3D(ST_ClosestPoint($1::geometry, $2::geometry)) as closest_point
    `, [trail.geometry, intersectionPoint]);
    
    return closestPointResult.rows[0].closest_point;
  }

  /**
   * Analyze T-intersection to identify visited and visitor trails
   * Standardized logic for determining which trail is being intersected vs which is ending near it
   */
  async analyzeTIntersectionTrails(intersectionPoint: any, connectedTrailNames: string[]): Promise<{visitedTrail: any, visitorTrail: any}> {
    const { stagingSchema, pgClient, minSegmentLengthMeters, verbose = false } = this.config;

    // Find trails based on spatial proximity to intersection point, not by name
    const trailsResult = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        geometry,
        trail_type,
        surface,
        difficulty,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        bbox_min_lng,
        bbox_max_lng,
        bbox_min_lat,
        bbox_max_lat,
        source,
        source_tags,
        osm_id,
        ST_Distance(geometry, $1::geography) as distance_to_intersection,
        ST_Intersects(geometry, $1) as intersects_intersection,
        ST_Distance(ST_StartPoint(geometry), $1::geography) as start_distance,
        ST_Distance(ST_EndPoint(geometry), $1::geography) as end_distance
      FROM ${stagingSchema}.trails
      WHERE ST_DWithin(geometry, $1::geography, 10.0)
        AND ST_Length(geometry::geography) > $2
      ORDER BY distance_to_intersection
    `, [intersectionPoint, minSegmentLengthMeters]);

    if (trailsResult.rows.length < 2) {
      if (verbose) {
        console.log(`      ⚠️ Not enough trails found for T-intersection analysis (${trailsResult.rows.length} trails)`);
      }
      return { visitedTrail: null, visitorTrail: null };
    }

    // The visited trail is the one that intersects the intersection point (or is closest to it)
    // The visitor trail is the one that has an endpoint close to the intersection point
    let visitedTrail = null;
    let visitorTrail = null;

    for (const trail of trailsResult.rows) {
      if (trail.intersects_intersection || trail.distance_to_intersection < 0.1) {
        // This trail passes through or very close to the intersection point
        if (!visitedTrail || trail.distance_to_intersection < visitedTrail.distance_to_intersection) {
          visitedTrail = trail;
        }
      } else if (Math.min(trail.start_distance, trail.end_distance) < 10.0) {
        // This trail has an endpoint close to the intersection point (increased tolerance)
        if (!visitorTrail || Math.min(trail.start_distance, trail.end_distance) < Math.min(visitorTrail.start_distance, visitorTrail.end_distance)) {
          visitorTrail = trail;
        }
      }
    }

    // If we still don't have both trails, try a more flexible approach
    if (!visitedTrail || !visitorTrail) {
      // Sort trails by distance to intersection point
      const sortedTrails = trailsResult.rows.sort((a, b) => a.distance_to_intersection - b.distance_to_intersection);
      
      if (sortedTrails.length >= 2) {
        // The closest trail is likely the visited trail
        if (!visitedTrail) {
          visitedTrail = sortedTrails[0];
        }
        // The second closest trail is likely the visitor trail
        if (!visitorTrail) {
          visitorTrail = sortedTrails[1];
        }
      }
    }

    if (verbose) {
      if (visitedTrail && visitorTrail) {
        console.log(`      📍 T-intersection analysis: visited=${visitedTrail.name}, visitor=${visitorTrail.name}`);
      } else {
        console.log(`      ⚠️ T-intersection analysis failed: visited=${!!visitedTrail}, visitor=${!!visitorTrail}`);
      }
    }

    return { visitedTrail, visitorTrail };
  }

  /**
   * Enhanced snapping with precision handling for complex intersections
   * Uses ST_SnapToGrid and ST_Snap for better intersection detection
   */
  async snapWithPrecision(trail1: any, trail2: any, toleranceMeters: number = 1e-6): Promise<{trail1Snapped: any, trail2Snapped: any}> {
    const { pgClient } = this.config;

    // Step 1: Round coordinates to avoid precision issues
    const roundedResult = await pgClient.query(`
      SELECT 
        ST_SnapToGrid($1::geometry, 1e-6) AS trail1_rounded,
        ST_SnapToGrid($2::geometry, 1e-6) AS trail2_rounded
    `, [trail1.geometry, trail2.geometry]);
    
    const trail1Rounded = roundedResult.rows[0].trail1_rounded;
    const trail2Rounded = roundedResult.rows[0].trail2_rounded;
    
    // Step 2: Snap with tolerance for better intersection detection
    const snappedResult = await pgClient.query(`
      SELECT 
        ST_Snap($1::geometry, $2::geometry, 1e-6) AS trail1_snapped,
        ST_Snap($2::geometry, $1::geometry, 1e-6) AS trail2_snapped
    `, [trail1Rounded, trail2Rounded]);
    
    return {
      trail1Snapped: snappedResult.rows[0].trail1_snapped,
      trail2Snapped: snappedResult.rows[0].trail2_snapped
    };
  }
}
