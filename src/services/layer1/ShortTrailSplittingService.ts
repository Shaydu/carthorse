import { Pool } from 'pg';
import { SplittingService, SplittingResult } from './ModularSplittingOrchestrator';

export interface ShortTrailSplittingResult extends SplittingResult {
  trailsProcessed: number;
  trailsSplit: number;
  segmentsCreated: number;
  tIntersectionsHandled: number;
  xIntersectionsHandled: number;
}

export interface ShortTrailSplittingConfig {
  stagingSchema: string;
  pgClient: Pool;
  maxTrailLengthKm: number; // Only process trails under this length (default 0.5km)
  minSegmentLengthMeters: number;
  verbose?: boolean;
  intersectionToleranceMeters?: number;
}

/**
 * Service specifically for splitting short trails (under 0.5km) with enhanced T-intersection and X-intersection handling
 * Based on the working logic from commit 1d42491b that successfully handled North Sky and Foothills intersection
 */
export class ShortTrailSplittingService implements SplittingService {
  readonly serviceName = 'ShortTrailSplittingService';

  constructor(private config: ShortTrailSplittingConfig) {}

  /**
   * Execute the short trail splitting service
   */
  async execute(): Promise<ShortTrailSplittingResult> {
    return this.splitShortTrails();
  }

  /**
   * Split short trails with enhanced intersection detection and handling
   */
  async splitShortTrails(): Promise<ShortTrailSplittingResult> {
    console.log(`🔗 Splitting short trails (under ${this.config.maxTrailLengthKm}km) with enhanced intersection handling...`);
    
    try {
      const { stagingSchema, pgClient, maxTrailLengthKm, minSegmentLengthMeters, verbose = false } = this.config;
      
      // Step 1: Detect intersections specifically for short trails
      console.log('   🔍 Step 1: Detecting intersections for short trails...');
      await this.detectShortTrailIntersections();
      
      // Step 2: Get intersection points (process T-intersections first, then X-intersections)
      const intersectionPoints = await pgClient.query(`
        SELECT 
          intersection_point,
          intersection_point_3d,
          connected_trail_names,
          node_type
        FROM ${stagingSchema}.intersection_points
        WHERE node_type IN ('intersection', 't_intersection', 'x_intersection')
        ORDER BY node_type DESC, intersection_point
      `);

      if (intersectionPoints.rows.length === 0) {
        console.log('   ℹ️ No intersection points found for short trails');
        return {
          success: true,
          serviceName: this.serviceName,
          trailsProcessed: 0,
          trailsSplit: 0,
          segmentsCreated: 0,
          tIntersectionsHandled: 0,
          xIntersectionsHandled: 0
        };
      }

      console.log(`   📍 Found ${intersectionPoints.rows.length} intersection points to process`);

      let totalTrailsSplit = 0;
      let totalSegmentsCreated = 0;
      let tIntersectionsHandled = 0;
      let xIntersectionsHandled = 0;

      // Step 3: Process each intersection point
      for (const intersection of intersectionPoints.rows) {
        const intersectionPoint = intersection.intersection_point;
        const connectedTrailNames = intersection.connected_trail_names;
        
        if (verbose) {
          console.log(`   🔍 Processing ${intersection.node_type}: ${connectedTrailNames.join(' × ')}`);
        }

        // Find short trails that pass through this intersection point
        const trailsToSplit = await pgClient.query(`
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
            length_km
          FROM ${stagingSchema}.trails
          WHERE ST_Intersects(geometry, $1)
            AND ST_Length(geometry::geography) > $2
            AND length_km < $3
        `, [intersectionPoint, minSegmentLengthMeters, maxTrailLengthKm]);

        if (trailsToSplit.rows.length === 0) {
          if (verbose) {
            console.log(`      ⚠️ No short trails found to split at this intersection`);
          }
          continue;
        }

        if (verbose) {
          console.log(`      📍 Found ${trailsToSplit.rows.length} short trails to split`);
        }

        // Handle different intersection types
        if (intersection.node_type === 't_intersection') {
          const tIntersectionResult = await this.handleTIntersection(intersectionPoint, connectedTrailNames);
          
          if (tIntersectionResult.success) {
            totalTrailsSplit += tIntersectionResult.trailsSplit;
            totalSegmentsCreated += tIntersectionResult.segmentsCreated;
            tIntersectionsHandled++;
            
            if (verbose) {
              console.log(`      ✂️ T-intersection: Split ${tIntersectionResult.trailsSplit} trails, created ${tIntersectionResult.segmentsCreated} segments`);
            }
          } else {
            if (verbose) {
              console.log(`      ⚠️ T-intersection: Could not process: ${tIntersectionResult.error}`);
            }
          }
        } else if (intersection.node_type === 'x_intersection') {
          // For X-intersections: Split all trails at the intersection point
          for (const trail of trailsToSplit.rows) {
            const splitResult = await this.splitTrailAtPoint(trail, intersectionPoint);
            
            if (splitResult.success) {
              totalTrailsSplit++;
              totalSegmentsCreated += splitResult.segmentsCreated;
            }
          }
          xIntersectionsHandled++;
          
          if (verbose) {
            console.log(`      ✂️ X-intersection: Split ${trailsToSplit.rows.length} trails`);
          }
        } else {
          // For regular intersections: Split all trails at the intersection point
          for (const trail of trailsToSplit.rows) {
            const splitResult = await this.splitTrailAtPoint(trail, intersectionPoint);
            
            if (splitResult.success) {
              totalTrailsSplit++;
              totalSegmentsCreated += splitResult.segmentsCreated;
            }
          }
          
          if (verbose) {
            console.log(`      ✂️ Regular intersection: Split ${trailsToSplit.rows.length} trails`);
          }
        }
      }

      console.log(`✅ Short trail splitting completed:`);
      console.log(`   📍 Intersection points processed: ${intersectionPoints.rows.length}`);
      console.log(`   🔺 T-intersections handled: ${tIntersectionsHandled}`);
      console.log(`   ❌ X-intersections handled: ${xIntersectionsHandled}`);
      console.log(`   ✂️ Trails split: ${totalTrailsSplit}`);
      console.log(`   📊 Segments created: ${totalSegmentsCreated}`);

      return {
        success: true,
        serviceName: this.serviceName,
        trailsProcessed: intersectionPoints.rows.length,
        trailsSplit: totalTrailsSplit,
        segmentsCreated: totalSegmentsCreated,
        tIntersectionsHandled,
        xIntersectionsHandled
      };

    } catch (error) {
      console.error('❌ Error in short trail splitting:', error);
      return {
        success: false,
        serviceName: this.serviceName,
        trailsProcessed: 0,
        trailsSplit: 0,
        segmentsCreated: 0,
        tIntersectionsHandled: 0,
        xIntersectionsHandled: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Detect intersections specifically for short trails with enhanced X-intersection detection
   */
  private async detectShortTrailIntersections(): Promise<void> {
    const { stagingSchema, pgClient, maxTrailLengthKm, intersectionToleranceMeters = 2.0 } = this.config;
    
    // Clear existing intersection points
    await pgClient.query(`DELETE FROM ${stagingSchema}.intersection_points`);

    // Enhanced intersection detection that includes X-intersections
    await pgClient.query(`
      INSERT INTO ${stagingSchema}.intersection_points (
        intersection_point, intersection_point_3d, connected_trail_names, node_type, distance_meters
      )
      WITH short_trails AS (
        SELECT 
          app_uuid,
          name,
          geometry,
          length_km
        FROM ${stagingSchema}.trails
        WHERE length_km < $1
          AND geometry IS NOT NULL 
          AND ST_IsValid(geometry)
      ),
      trail_intersections AS (
        SELECT 
          ST_Intersection(t1.geometry, t2.geometry) as intersection_geom,
          ST_Force3D(ST_Intersection(t1.geometry, t2.geometry)) as intersection_geom_3d,
          ARRAY[t1.name, t2.name] as connected_trail_names,
          ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
          ST_NumGeometries(ST_Intersection(t1.geometry, t2.geometry)) as intersection_count
        FROM short_trails t1
        JOIN short_trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_Intersection(t1.geometry, t2.geometry) IS NOT NULL
      ),
      classified_intersections AS (
        SELECT 
          intersection_geom,
          intersection_geom_3d,
          connected_trail_names,
          CASE 
            WHEN intersection_type = 'ST_Point' THEN 't_intersection'
            WHEN intersection_type = 'ST_MultiPoint' AND intersection_count = 2 THEN 'x_intersection'
            WHEN intersection_type = 'ST_MultiPoint' AND intersection_count > 2 THEN 'complex_intersection'
            WHEN intersection_type = 'ST_LineString' THEN 'overlapping_intersection'
            ELSE 'unknown_intersection'
          END as node_type,
          $2 as distance_meters
        FROM trail_intersections
        WHERE intersection_geom IS NOT NULL
      )
      SELECT 
        intersection_geom,
        intersection_geom_3d,
        connected_trail_names,
        node_type,
        distance_meters
      FROM classified_intersections
      WHERE node_type IN ('t_intersection', 'x_intersection', 'intersection')
    `, [maxTrailLengthKm, intersectionToleranceMeters]);
  }

  /**
   * Handle T-intersection by splitting the visited trail and snapping the visitor trail
   * Based on the working logic from commit 1d42491b
   */
  private async handleTIntersection(intersectionPoint: any, connectedTrailNames: string[]): Promise<{success: boolean, trailsSplit: number, segmentsCreated: number, error?: string}> {
    const { stagingSchema, pgClient, minSegmentLengthMeters } = this.config;

    try {
      // Find the visited trail (the trail being intersected) and visitor trail (the trail ending near it)
      const trailAnalysis = await this.analyzeTIntersectionTrails(intersectionPoint, connectedTrailNames);
      
      if (!trailAnalysis.visitedTrail || !trailAnalysis.visitorTrail) {
        return {
          success: false,
          trailsSplit: 0,
          segmentsCreated: 0,
          error: 'Could not identify visited and visitor trails'
        };
      }

      let totalTrailsSplit = 0;
      let totalSegmentsCreated = 0;

      // Step 1: Split the visited trail at the intersection point
      const visitedSplitResult = await this.splitTrailAtPoint(trailAnalysis.visitedTrail, intersectionPoint);
      if (visitedSplitResult.success) {
        totalTrailsSplit++;
        totalSegmentsCreated += visitedSplitResult.segmentsCreated;
      }

      // Step 2: Snap the visitor trail to the visited trail at the intersection point
      const snapResult = await this.snapVisitorTrailToVisitedTrail(trailAnalysis.visitorTrail, trailAnalysis.visitedTrail, intersectionPoint);
      if (snapResult.success) {
        totalTrailsSplit++;
        totalSegmentsCreated += snapResult.segmentsCreated;
      }

      return {
        success: true,
        trailsSplit: totalTrailsSplit,
        segmentsCreated: totalSegmentsCreated
      };

    } catch (error) {
      return {
        success: false,
        trailsSplit: 0,
        segmentsCreated: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Analyze T-intersection to identify visited and visitor trails
   * Based on the working logic from commit 1d42491b
   */
  private async analyzeTIntersectionTrails(intersectionPoint: any, connectedTrailNames: string[]): Promise<{visitedTrail: any, visitorTrail: any}> {
    const { stagingSchema, pgClient, minSegmentLengthMeters } = this.config;

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

    return { visitedTrail, visitorTrail };
  }

  /**
   * Snap visitor trail to visited trail at intersection point
   * Based on the working logic from commit 1d42491b
   */
  private async snapVisitorTrailToVisitedTrail(visitorTrail: any, visitedTrail: any, intersectionPoint: any): Promise<{success: boolean, segmentsCreated: number}> {
    const { stagingSchema, pgClient, minSegmentLengthMeters } = this.config;

    try {
      // Find which endpoint of the visitor trail is closer to the intersection point
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

      // Create a new trail segment that extends from the visitor trail's endpoint to the intersection point
      const extendedTrailResult = await pgClient.query(`
        SELECT ST_MakeLine(${endpointToExtend}($1), $2) as extended_geometry
      `, [visitorTrail.geometry, intersectionPoint]);

      const extendedGeometry = extendedTrailResult.rows[0].extended_geometry;

      // Check if the extended segment is long enough
      const lengthResult = await pgClient.query(`
        SELECT ST_Length($1::geography) as length_meters
      `, [extendedGeometry]);

      const lengthMeters = lengthResult.rows[0].length_meters;

      if (lengthMeters < minSegmentLengthMeters) {
        return { success: false, segmentsCreated: 0 };
      }

      // Insert the extended trail segment
      const insertResult = await pgClient.query(`
        INSERT INTO ${stagingSchema}.trails (
          app_uuid, name, geometry, trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        )
        SELECT 
          gen_random_uuid() as app_uuid,
          $1 as name,
          ST_Force3D($2::geometry) as geometry,
          trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        FROM ${stagingSchema}.trails 
        WHERE app_uuid = $3
      `, [visitorTrail.name, extendedGeometry, visitorTrail.app_uuid]); // Keep original name without modification

      // Delete the original visitor trail
      await pgClient.query(`
        DELETE FROM ${stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [visitorTrail.app_uuid]);

      return { success: true, segmentsCreated: 1 };

    } catch (error) {
      console.error('Error snapping visitor trail to visited trail:', error);
      return { success: false, segmentsCreated: 0 };
    }
  }

  /**
   * Split a single trail at a specific intersection point
   * Based on the working logic from commit 1d42491b
   */
  private async splitTrailAtPoint(trail: any, intersectionPoint: any): Promise<{success: boolean, segmentsCreated: number}> {
    const { stagingSchema, pgClient, minSegmentLengthMeters } = this.config;

    try {
      // Find the closest point on the trail geometry to the intersection point
      const closestPointResult = await pgClient.query(`
        SELECT ST_ClosestPoint($1::geometry, $2::geometry) as closest_point
      `, [trail.geometry, intersectionPoint]);
      
      const closestPoint = closestPointResult.rows[0].closest_point;
      
      // Split the trail geometry at the closest point on the trail
      const splitResult = await pgClient.query(`
        SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
      `, [trail.geometry, closestPoint]);

      if (splitResult.rows.length <= 1) {
        // No splitting occurred (trail doesn't pass through the point or only one segment)
        return { success: false, segmentsCreated: 0 };
      }

      // Delete the original trail
      await pgClient.query(`
        DELETE FROM ${stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [trail.app_uuid]);

      // Insert the split segments
      let segmentsCreated = 0;
      for (let i = 0; i < splitResult.rows.length; i++) {
        const segment = splitResult.rows[i];
        
        // Check segment length
        const lengthResult = await pgClient.query(`
          SELECT ST_Length($1::geography) as length_meters
        `, [segment.segment]);

        if (lengthResult.rows[0].length_meters >= minSegmentLengthMeters) {
          await pgClient.query(`
            INSERT INTO ${stagingSchema}.trails (
              app_uuid, name, geometry, trail_type, surface, difficulty,
              elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
              bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
              source, source_tags, osm_id
            ) VALUES (
              gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
            )
          `, [
            trail.name, // Keep original name without modification
            trail.trail_type,
            trail.surface,
            trail.difficulty,
            trail.elevation_gain,
            trail.elevation_loss,
            trail.max_elevation,
            trail.min_elevation,
            trail.avg_elevation,
            trail.bbox_min_lng,
            trail.bbox_max_lng,
            trail.bbox_min_lat,
            trail.bbox_max_lat,
            trail.source,
            trail.source_tags,
            trail.osm_id,
            segment.segment
          ]);
          segmentsCreated++;
        }
      }

      return { success: true, segmentsCreated };

    } catch (error) {
      console.error(`❌ Error splitting trail ${trail.name}:`, error);
      return { success: false, segmentsCreated: 0 };
    }
  }
}
