import { Pool } from 'pg';
import { CentralizedTrailSplitManager, CentralizedSplitConfig, TrailSplitOperation } from '../../utils/services/network-creation/centralized-trail-split-manager';
import { SplittingService, SplittingResult } from './ModularSplittingOrchestrator';

export interface IntersectionBasedSplittingResult extends SplittingResult {
  trailsSplit: number;
  segmentsCreated: number;
  intersectionPointsUsed: number;
}

export interface IntersectionBasedSplittingConfig {
  stagingSchema: string;
  pgClient: Pool;
  minSegmentLengthMeters: number;
  verbose?: boolean;
  validationToleranceMeters?: number;
  validationTolerancePercentage?: number;
}

/**
 * Service to split trails at detected intersection points
 * This ensures that trails are properly split where they intersect each other
 */
export class IntersectionBasedTrailSplitter implements SplittingService {
  readonly serviceName = 'IntersectionBasedTrailSplitter';
  private splitManager: CentralizedTrailSplitManager;

  constructor(private config: IntersectionBasedSplittingConfig) {
    // Initialize centralized split manager with conservative config for longer trails
    const centralizedConfig: CentralizedSplitConfig = {
      stagingSchema: config.stagingSchema,
      intersectionToleranceMeters: 2.0, // Reduced from 3.0 to be more precise
      minSegmentLengthMeters: Math.min(config.minSegmentLengthMeters, 1.0), // Use more conservative minimum
      preserveOriginalTrailNames: true, // Keep original trail names
      validationToleranceMeters: config.validationToleranceMeters || 1.0, // Reduced from 2.0
      validationTolerancePercentage: config.validationTolerancePercentage || 0.05 // Reduced from 0.1
    };
    
    this.splitManager = CentralizedTrailSplitManager.getInstance(config.pgClient, centralizedConfig);
  }

  /**
   * Execute the intersection-based trail splitting service
   */
  async execute(): Promise<IntersectionBasedSplittingResult> {
    return this.splitTrailsAtIntersections();
  }

  /**
   * Split trails at all detected intersection points
   */
  async splitTrailsAtIntersections(): Promise<IntersectionBasedSplittingResult> {
    console.log('🔗 Splitting trails at detected intersection points...');
    
    try {
      const { stagingSchema, pgClient, minSegmentLengthMeters, verbose = false } = this.config;
      
          // Step 1: Get all intersection points (process T-intersections first, then X-intersections)
      const intersectionPoints = await pgClient.query(`
        SELECT 
          point as intersection_point,
          point_3d as intersection_point_3d,
          connected_trail_names,
          node_type
        FROM ${stagingSchema}.intersection_points
        WHERE node_type IN ('intersection', 't_intersection')
        ORDER BY node_type DESC, point
      `);

      if (intersectionPoints.rows.length === 0) {
        console.log('   ℹ️ No intersection points found to split trails at');
        return {
          success: true,
          serviceName: this.serviceName,
          trailsSplit: 0,
          segmentsCreated: 0,
          intersectionPointsUsed: 0
        };
      }

      console.log(`   📍 Found ${intersectionPoints.rows.length} intersection points to process`);

      let totalTrailsSplit = 0;
      let totalSegmentsCreated = 0;
      let intersectionPointsUsed = 0;

      // Step 2: For each intersection point, find trails that pass through it and split them
      for (const intersection of intersectionPoints.rows) {
        const intersectionPoint = intersection.intersection_point;
        const connectedTrailNames = intersection.connected_trail_names;
        
        if (verbose) {
          console.log(`   🔍 Processing intersection: ${connectedTrailNames.join(' × ')}`);
        }

        // Find trails that pass through this intersection point
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
            osm_id
          FROM ${stagingSchema}.trails
          WHERE ST_Intersects(geometry, $1)
            AND ST_Length(geometry::geography) > $2
        `, [intersectionPoint, minSegmentLengthMeters]);

        if (trailsToSplit.rows.length === 0) {
          if (verbose) {
            console.log(`      ⚠️ No trails found to split at this intersection`);
          }
          continue;
        }

        if (verbose) {
          console.log(`      📍 Found ${trailsToSplit.rows.length} trails to split`);
        }

        // Handle T-intersections differently from X-intersections
        if (intersection.node_type === 't_intersection') {
          // For T-intersections: 
          // 1. Split the visited trail (the trail being intersected)
          // 2. Snap the visitor trail to the visited trail at the intersection point
          const tIntersectionResult = await this.handleTIntersection(intersectionPoint, connectedTrailNames);
          
          if (tIntersectionResult.success) {
            totalTrailsSplit += tIntersectionResult.trailsSplit;
            totalSegmentsCreated += tIntersectionResult.segmentsCreated;
            
            if (verbose) {
              console.log(`      ✂️ T-intersection: Split ${tIntersectionResult.trailsSplit} trails, created ${tIntersectionResult.segmentsCreated} segments`);
            }
          } else {
            if (verbose) {
              console.log(`      ⚠️ T-intersection: Could not process T-intersection: ${tIntersectionResult.error}`);
            }
          }
        } else {
          // For X-intersections: Split all trails at the intersection point
          for (const trail of trailsToSplit.rows) {
            const splitResult = await this.splitTrailAtPoint(trail, intersectionPoint);
            
            if (splitResult.success) {
              totalTrailsSplit++;
              totalSegmentsCreated += splitResult.segmentsCreated;
              
              if (verbose) {
                console.log(`      ✂️ X-intersection: Split ${trail.name}: ${splitResult.segmentsCreated} segments created`);
              }
            }
          }
        }

        intersectionPointsUsed++;
      }

      console.log(`✅ Intersection-based splitting completed:`);
      console.log(`   📍 Intersection points processed: ${intersectionPointsUsed}`);
      console.log(`   ✂️ Trails split: ${totalTrailsSplit}`);
      console.log(`   📊 Segments created: ${totalSegmentsCreated}`);

      // Print centralized split manager summary
      this.splitManager.printSummary();

      return {
        success: true,
        serviceName: this.serviceName,
        trailsSplit: totalTrailsSplit,
        segmentsCreated: totalSegmentsCreated,
        intersectionPointsUsed
      };

    } catch (error) {
      console.error('❌ Error in intersection-based trail splitting:', error);
      return {
        success: false,
        serviceName: this.serviceName,
        trailsSplit: 0,
        segmentsCreated: 0,
        intersectionPointsUsed: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Handle T-intersection by splitting the visited trail and snapping the visitor trail
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
   * Find the visited trail (the trail being intersected) for a T-intersection
   * In a T-intersection, one trail's endpoint is close to another trail's midpoint
   * The visited trail is the one that has the intersection point on its geometry
   */
  private async findVisitedTrailForTIntersection(intersectionPoint: any, connectedTrailNames: string[]): Promise<any> {
    const { stagingSchema, pgClient, minSegmentLengthMeters } = this.config;

    // Find trails that pass through the intersection point
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
        osm_id
      FROM ${stagingSchema}.trails
      WHERE name = ANY($1)
        AND ST_Intersects(geometry, $2)
        AND ST_Length(geometry::geography) > $3
      ORDER BY ST_Length(geometry::geography) DESC
    `, [connectedTrailNames, intersectionPoint, minSegmentLengthMeters]);

    if (trailsResult.rows.length === 0) {
      return null;
    }

    // For T-intersections, the visited trail is typically the longer trail
    // that passes through the intersection point
    return trailsResult.rows[0];
  }

  /**
   * Split a single trail at a specific intersection point
   */
  private async splitTrailAtPoint(trail: any, intersectionPoint: any): Promise<{success: boolean, segmentsCreated: number}> {
    const { stagingSchema, pgClient, minSegmentLengthMeters } = this.config;

    try {
      // Find the closest point on the trail geometry to the intersection point
      const closestPointResult = await pgClient.query(`
        SELECT ST_ClosestPoint($1::geometry, $2::geometry) as closest_point
      `, [trail.geometry, intersectionPoint]);
      
      const closestPoint = closestPointResult.rows[0].closest_point;
      
      // Get the coordinates of the closest point for the split operation
      const pointCoords = await pgClient.query(`
        SELECT ST_X($1::geometry) as lng, ST_Y($1::geometry) as lat
      `, [closestPoint]);
      
      const point = pointCoords.rows[0];
      
      // Calculate the distance along the trail to this point
      const distanceResult = await pgClient.query(`
        SELECT ST_LineLocatePoint($1::geometry, $2::geometry) * ST_Length($1::geometry::geography) as distance_m
      `, [trail.geometry, closestPoint]);
      
      const distance = distanceResult.rows[0].distance_m;
      
      // Calculate original length from geometry if length_km is NULL
      let originalLengthKm = trail.length_km;
      if (!originalLengthKm) {
        const lengthResult = await this.config.pgClient.query('SELECT ST_Length($1::geography) / 1000.0 as length_km', [trail.geometry]);
        originalLengthKm = lengthResult.rows[0].length_km;
      }

      // Create split operation for transactional processing
      const splitOperation: TrailSplitOperation = {
        originalTrailId: trail.app_uuid,
        originalTrailName: trail.name,
        originalGeometry: trail.geometry,
        originalLengthKm: originalLengthKm,
        originalElevationGain: trail.elevation_gain || 0,
        originalElevationLoss: trail.elevation_loss || 0,
        splitPoints: [{
          lng: point.lng,
          lat: point.lat,
          distance: distance
        }]
      };
      
      // Execute atomic split with validation using centralized manager
      const result = await this.splitManager.splitTrailAtomically(
        splitOperation, 
        'IntersectionBasedTrailSplitter', 
        'split',
        { intersectionPoint: intersectionPoint }
      );
      
      return { success: result.success, segmentsCreated: result.segmentsCreated };

    } catch (error) {
      console.error(`❌ Error splitting trail ${trail.name}:`, error);
      return { success: false, segmentsCreated: 0 };
    }
  }
}
