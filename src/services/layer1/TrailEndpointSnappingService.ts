import { Pool } from 'pg';

export interface TrailEndpointSnappingResult {
  success: boolean;
  endpointsProcessed: number;
  endpointsSnapped: number;
  trailsSplit: number;
  errors: string[];
}

export interface TrailEndpointSnapOperation {
  trailUuid: string;
  trailName: string;
  endpointType: 'start' | 'end';
  endpointGeom: string;
  targetTrailUuid: string;
  targetTrailName: string;
  distanceMeters: number;
  closestPoint: string;
  positionAlongLine: number;
  snapped: boolean;
  trailSplit: boolean;
  error?: string;
}

export class TrailEndpointSnappingService {
  constructor(
    private stagingSchema: string,
    private pgClient: Pool,
    private snapToleranceMeters: number = 5.0
  ) {}

  /**
   * Process all trail endpoints: find closest trails, snap to them, and split them
   */
  async processAllTrailEndpoints(): Promise<TrailEndpointSnappingResult> {
    console.log('🔍 Starting trail endpoint snapping and splitting...');

    const result: TrailEndpointSnappingResult = {
      success: true,
      endpointsProcessed: 0,
      endpointsSnapped: 0,
      trailsSplit: 0,
      errors: []
    };

    try {
      // Get all trail endpoints
      const endpointsQuery = `
        SELECT 
          app_uuid as trail_uuid,
          name as trail_name,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          geometry as trail_geom
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) >= 50.0  -- Minimum 50m trail length
        ORDER BY app_uuid
      `;

      const endpointsResult = await this.pgClient.query(endpointsQuery);
      console.log(`📊 Found ${endpointsResult.rows.length} trails to process for endpoint snapping`);

      const operations: TrailEndpointSnapOperation[] = [];

      // Process each trail's endpoints
      for (const trail of endpointsResult.rows) {
        // Process start point
        const startOperation = await this.processTrailEndpoint(
          trail.trail_uuid,
          trail.trail_name,
          'start',
          trail.start_point,
          trail.trail_geom
        );
        operations.push(startOperation);
        result.endpointsProcessed++;

        if (startOperation.snapped) {
          result.endpointsSnapped++;
        }
        if (startOperation.trailSplit) {
          result.trailsSplit++;
        }
        if (startOperation.error) {
          result.errors.push(`Start point of ${trail.trail_name}: ${startOperation.error}`);
        }

        // Process end point
        const endOperation = await this.processTrailEndpoint(
          trail.trail_uuid,
          trail.trail_name,
          'end',
          trail.end_point,
          trail.trail_geom
        );
        operations.push(endOperation);
        result.endpointsProcessed++;

        if (endOperation.snapped) {
          result.endpointsSnapped++;
        }
        if (endOperation.trailSplit) {
          result.trailsSplit++;
        }
        if (endOperation.error) {
          result.errors.push(`End point of ${trail.trail_name}: ${endOperation.error}`);
        }
      }

      // Log summary
      console.log(`\n📊 TRAIL ENDPOINT SNAPPING SUMMARY:`);
      console.log(`   Endpoints processed: ${result.endpointsProcessed}`);
      console.log(`   Endpoints snapped: ${result.endpointsSnapped}`);
      console.log(`   Trails split: ${result.trailsSplit}`);
      console.log(`   Errors: ${result.errors.length}`);

      // Show successful operations
      const successfulOps = operations.filter(op => op.snapped && op.trailSplit);
      if (successfulOps.length > 0) {
        console.log(`\n✅ SUCCESSFUL SNAPPING OPERATIONS:`);
        successfulOps.forEach(op => {
          console.log(`   ${op.trailName} (${op.endpointType}) → ${op.targetTrailName} (${op.distanceMeters}m, position ${op.positionAlongLine})`);
        });
      }

      if (result.errors.length > 0) {
        console.log(`\n❌ Errors encountered:`);
        result.errors.forEach(error => console.log(`   - ${error}`));
      }

      return result;

    } catch (error) {
      result.success = false;
      result.errors.push(`Service error: ${error}`);
      console.error('❌ Service error:', error);
      return result;
    }
  }

  /**
   * Process a single trail endpoint: find closest trail, snap to it, and split it
   */
  private async processTrailEndpoint(
    trailUuid: string,
    trailName: string,
    endpointType: 'start' | 'end',
    endpointGeom: any,
    trailGeom: any
  ): Promise<TrailEndpointSnapOperation> {
    const toleranceDegrees = this.snapToleranceMeters / 111000; // Convert meters to degrees

    const operation: TrailEndpointSnapOperation = {
      trailUuid,
      trailName,
      endpointType,
      endpointGeom: endpointGeom.toString(),
      targetTrailUuid: '',
      targetTrailName: '',
      distanceMeters: 0,
      closestPoint: '',
      positionAlongLine: 0,
      snapped: false,
      trailSplit: false
    };

    try {
      // Find the closest trail within tolerance (excluding the same trail)
      const closestTrailQuery = `
        WITH endpoint_point AS (
          SELECT $1::geometry as point_geom
        ),
        nearby_trails AS (
          SELECT 
            app_uuid,
            name,
            geometry,
            ST_Distance(geometry, (SELECT point_geom FROM endpoint_point)) as distance_meters,
            ST_ClosestPoint(geometry, (SELECT point_geom FROM endpoint_point)) as closest_point,
            ST_LineLocatePoint(geometry, (SELECT point_geom FROM endpoint_point)) as position_along_line
          FROM ${this.stagingSchema}.trails
          WHERE app_uuid != $2  -- Exclude the same trail
            AND ST_DWithin(geometry, (SELECT point_geom FROM endpoint_point), $3)
            AND ST_Length(geometry::geography) >= 50.0  -- Minimum 50m trail length
        )
        SELECT 
          app_uuid,
          name,
          geometry,
          ROUND(distance_meters::numeric, 6) as distance_m,
          ST_AsText(closest_point) as closest_point_wkt,
          ROUND(position_along_line::numeric, 6) as position
        FROM nearby_trails
        ORDER BY distance_meters
        LIMIT 1;
      `;

      const trailResult = await this.pgClient.query(closestTrailQuery, [endpointGeom, trailUuid, toleranceDegrees]);

      if (trailResult.rows.length === 0) {
        operation.error = `No nearby trails found within ${this.snapToleranceMeters}m tolerance`;
        return operation;
      }

      const trail = trailResult.rows[0];
      const distanceMeters = parseFloat(trail.distance_m);
      const positionAlongLine = parseFloat(trail.position);

      // Check if this is a valid snapping candidate
      if (distanceMeters > this.snapToleranceMeters) {
        operation.error = `Closest trail is ${distanceMeters}m away (too far)`;
        return operation;
      }

      // Log the potential snapping for visibility
      console.log(`📍 ${trailName} (${endpointType}) near ${trail.name}: ${distanceMeters}m away, position ${positionAlongLine}`);

      // Check if the closest point is too close to trail endpoints (avoid very short segments)
      if (positionAlongLine <= 0.001 || positionAlongLine >= 0.999) {
        operation.error = `Closest point is too close to trail endpoints (position: ${positionAlongLine})`;
        return operation;
      }

      // Update operation with target trail info
      operation.targetTrailUuid = trail.app_uuid;
      operation.targetTrailName = trail.name;
      operation.distanceMeters = distanceMeters;
      operation.closestPoint = trail.closest_point_wkt;
      operation.positionAlongLine = positionAlongLine;

      // Perform the snapping and splitting
      const snapResult = await this.snapAndSplitTrail(
        trailUuid,
        trailName,
        endpointGeom,
        trail.app_uuid,
        trail.name,
        trail.geometry,
        positionAlongLine
      );

      operation.snapped = snapResult.snapped;
      operation.trailSplit = snapResult.trailSplit;
      operation.error = snapResult.error;

      return operation;

    } catch (error) {
      operation.error = `Processing error: ${error}`;
      return operation;
    }
  }

  /**
   * Snap trail endpoint to target trail and split the target trail
   */
  private async snapAndSplitTrail(
    sourceTrailUuid: string,
    sourceTrailName: string,
    endpointGeom: any,
    targetTrailUuid: string,
    targetTrailName: string,
    targetTrailGeom: any,
    positionAlongLine: number
  ): Promise<{ snapped: boolean; trailSplit: boolean; error?: string }> {
    try {
      // Step 1: Create intersection point at the snap location
      const intersectionPoint = await this.pgClient.query(`
        SELECT ST_LineInterpolatePoint($1::geometry, $2) as intersection_point
      `, [targetTrailGeom, positionAlongLine]);

      const intersectionGeom = intersectionPoint.rows[0].intersection_point;

      // Step 2: Split the target trail at the intersection point
      const splitResult = await this.pgClient.query(`
        WITH split_segments AS (
          SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom as segment_geom
        )
        SELECT 
          ST_AsText(segment_geom) as segment_wkt,
          ST_Length(segment_geom::geography) as segment_length_m
        FROM split_segments
        WHERE ST_GeometryType(segment_geom) = 'ST_LineString'
        ORDER BY segment_length_m DESC
      `, [targetTrailGeom, intersectionGeom]);

      if (splitResult.rows.length < 2) {
        return { snapped: false, trailSplit: false, error: 'Failed to split target trail' };
      }

      // Step 3: Delete the original target trail
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [targetTrailUuid]);

      // Step 4: Insert the split segments
      for (const segment of splitResult.rows) {
        const segmentLengthKm = parseFloat(segment.segment_length_m) / 1000.0;
        
        // Only insert segments that are long enough
        if (segmentLengthKm >= 0.05) { // 50m minimum
          await this.pgClient.query(`
            INSERT INTO ${this.stagingSchema}.trails (
              original_trail_uuid, app_uuid, name, trail_type, surface, difficulty,
              geometry, length_km, elevation_gain, elevation_loss,
              max_elevation, min_elevation, avg_elevation,
              bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
              source, source_tags, osm_id
            )
            SELECT 
              original_trail_uuid, 
              gen_random_uuid(),  -- New UUID for split segment
              name || ' (segment)', 
              trail_type, surface, difficulty,
              ST_GeomFromText($1, 4326), 
              $2, 
              elevation_gain, elevation_loss,
              max_elevation, min_elevation, avg_elevation,
              bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
              source, source_tags, osm_id
            FROM ${this.stagingSchema}.trails 
            WHERE app_uuid = $3
            LIMIT 1
          `, [segment.segment_wkt, segmentLengthKm, sourceTrailUuid]);
        }
      }

      console.log(`   ✅ Split ${targetTrailName} into ${splitResult.rows.length} segments`);

      return { snapped: true, trailSplit: true };

    } catch (error) {
      return { snapped: false, trailSplit: false, error: `Snap and split error: ${error}` };
    }
  }
}
