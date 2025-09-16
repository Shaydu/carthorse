import { Pool } from 'pg';

export interface SnappingResult {
  success: boolean;
  endpointsProcessed: number;
  endpointsSnapped: number;
  trailsSplit: number;
  errors: string[];
}

export interface EndpointSnapOperation {
  nodeId: string;
  nodeUuid: string;
  lat: number;
  lng: number;
  elevation: number;
  targetTrailUuid: string;
  targetTrailName: string;
  distanceMeters: number;
  closestPoint: string;
  positionAlongLine: number;
  snapped: boolean;
  trailSplit: boolean;
  error?: string;
}

export class EndpointSnappingService {
  constructor(
    private stagingSchema: string,
    private pgClient: Pool
  ) {}

  /**
   * Process all degree 1 endpoints: find closest trails, snap to them, and split them
   */
  async processAllEndpoints(): Promise<SnappingResult> {
    console.log('🔍 Starting comprehensive endpoint snapping and splitting...');

    const result: SnappingResult = {
      success: true,
      endpointsProcessed: 0,
      endpointsSnapped: 0,
      trailsSplit: 0,
      errors: []
    };

    try {
      // Get all degree 1 endpoints (connected_trails = 1)
      const endpointsQuery = `
        SELECT 
          id,
          node_uuid,
          lat,
          lng,
          elevation,
          node_type,
          connected_trails
        FROM ${this.stagingSchema}.routing_nodes
        WHERE connected_trails = 1
        ORDER BY id;
      `;

      const endpointsResult = await this.pgClient.query(endpointsQuery);
      console.log(`📊 Found ${endpointsResult.rows.length} degree 1 endpoints to process`);

      const operations: EndpointSnapOperation[] = [];

      // Process each endpoint
      for (const endpoint of endpointsResult.rows) {
        result.endpointsProcessed++;
        
        try {
          const operation = await this.processEndpoint(endpoint);
          operations.push(operation);
          
          if (operation.snapped) {
            result.endpointsSnapped++;
          }
          if (operation.trailSplit) {
            result.trailsSplit++;
          }
          
          if (operation.error) {
            result.errors.push(`Node ${operation.nodeId}: ${operation.error}`);
          }
          
        } catch (error) {
          const errorMsg = `Node ${endpoint.id}: ${error}`;
          result.errors.push(errorMsg);
          console.error(`❌ ${errorMsg}`);
        }
      }

      // Log summary
      console.log(`\n📊 ENDPOINT SNAPPING SUMMARY:`);
      console.log(`   Endpoints processed: ${result.endpointsProcessed}`);
      console.log(`   Endpoints snapped: ${result.endpointsSnapped}`);
      console.log(`   Trails split: ${result.trailsSplit}`);
      console.log(`   Errors: ${result.errors.length}`);

      // Show successful intersections
      const successfulOps = operations.filter(op => op.snapped && op.trailSplit);
      if (successfulOps.length > 0) {
        console.log(`\n✅ SUCCESSFUL INTERSECTIONS:`);
        successfulOps.forEach(op => {
          console.log(`   Node ${op.nodeId} → ${op.targetTrailName} (${op.distanceMeters}m, position ${op.positionAlongLine})`);
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
   * Process a single endpoint: find closest trail, snap to it, and split it
   */
  private async processEndpoint(endpoint: any): Promise<EndpointSnapOperation> {
    const lat = parseFloat(endpoint.lat);
    const lng = parseFloat(endpoint.lng);
    const toleranceDegrees = 5.0 / 111000; // 5 meters in degrees

    const operation: EndpointSnapOperation = {
      nodeId: endpoint.id,
      nodeUuid: endpoint.node_uuid,
      lat: lat,
      lng: lng,
      elevation: parseFloat(endpoint.elevation),
      targetTrailUuid: '',
      targetTrailName: '',
      distanceMeters: 0,
      closestPoint: '',
      positionAlongLine: 0,
      snapped: false,
      trailSplit: false
    };

    try {
      // Find the closest trail within tolerance
      const closestTrailQuery = `
        WITH endpoint_point AS (
          SELECT ST_GeomFromText('POINT(' || $1::text || ' ' || $2::text || ')', 4326) as point_geom
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
          WHERE ST_DWithin(geometry, (SELECT point_geom FROM endpoint_point), $3)
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

      const trailResult = await this.pgClient.query(closestTrailQuery, [lng, lat, toleranceDegrees]);

      if (trailResult.rows.length === 0) {
        operation.error = 'No nearby trails found within 5m tolerance';
        return operation;
      }

      const trail = trailResult.rows[0];
      const distanceMeters = parseFloat(trail.distance_m);
      const positionAlongLine = parseFloat(trail.position);

      // Check if this is a valid snapping candidate
      if (distanceMeters > 5.0) {
        operation.error = `Closest trail is ${distanceMeters}m away (too far)`;
        return operation;
      }

      // Log the potential intersection for visibility
      console.log(`📍 Node ${operation.nodeId} near ${trail.name}: ${distanceMeters}m away, position ${positionAlongLine}`);

      if (positionAlongLine <= 0.001 || positionAlongLine >= 0.999) {
        operation.error = `Closest point is too close to trail endpoints (position: ${positionAlongLine})`;
        return operation;
      }

      operation.targetTrailUuid = trail.app_uuid;
      operation.targetTrailName = trail.name;
      operation.distanceMeters = distanceMeters;
      operation.closestPoint = trail.closest_point_wkt;
      operation.positionAlongLine = positionAlongLine;

      console.log(`🔗 Processing node ${operation.nodeId}: ${operation.distanceMeters}m from ${operation.targetTrailName}`);

      // Step 1: Snap the endpoint to the closest point on the trail
      await this.snapEndpointToTrail(operation);
      operation.snapped = true;

      // Step 2: Split the trail at the closest point
      await this.splitTrailAtPoint(operation);
      operation.trailSplit = true;

      console.log(`   ✅ Snapped and split successfully`);

      return operation;

    } catch (error) {
      operation.error = `Processing error: ${error}`;
      return operation;
    }
  }

  /**
   * Snap an endpoint to the closest point on a trail
   */
  private async snapEndpointToTrail(operation: EndpointSnapOperation): Promise<void> {
    // Find the trail that has this endpoint
    const endpointTrailQuery = `
      SELECT app_uuid, name, geometry
      FROM ${this.stagingSchema}.trails
      WHERE ST_DWithin(
        geometry,
        ST_GeomFromText('POINT(' || $1::text || ' ' || $2::text || ')', 4326),
        0.001
      )
      LIMIT 1;
    `;

    const endpointTrailResult = await this.pgClient.query(endpointTrailQuery, [operation.lng, operation.lat]);

    if (endpointTrailResult.rows.length === 0) {
      throw new Error('Could not find trail containing this endpoint');
    }

    const endpointTrail = endpointTrailResult.rows[0];

    // Snap the endpoint trail to the closest point on the target trail
    const snapQuery = `
      UPDATE ${this.stagingSchema}.trails
      SET geometry = ST_Force3D(ST_Snap(
        geometry,
        ST_GeomFromText($1, 4326),
        1e-6
      ))
      WHERE app_uuid = $2;
    `;

    await this.pgClient.query(snapQuery, [operation.closestPoint, endpointTrail.app_uuid]);
  }

  /**
   * Split a trail at the specified point
   */
  private async splitTrailAtPoint(operation: EndpointSnapOperation): Promise<void> {
    // Get the trail to split
    const trailQuery = `
      SELECT geometry, name, trail_type, surface, difficulty,
             length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
             bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
             source, source_tags, osm_id, original_trail_uuid
      FROM ${this.stagingSchema}.trails 
      WHERE app_uuid = $1
    `;

    const trailResult = await this.pgClient.query(trailQuery, [operation.targetTrailUuid]);

    if (trailResult.rows.length === 0) {
      throw new Error('Target trail not found');
    }

    const trail = trailResult.rows[0];

    // Split the trail using ST_LineSubstring
    const splitQuery = `
      WITH line_info AS (
        SELECT 
          $1::geometry as line_geom,
          $2::numeric as split_position
      )
      SELECT 
        ST_LineSubstring(line_geom, 0, split_position) as segment1,
        ST_LineSubstring(line_geom, split_position, 1) as segment2
      FROM line_info
      WHERE split_position > 0.001 AND split_position < 0.999
    `;

    const splitResult = await this.pgClient.query(splitQuery, [trail.geometry, operation.positionAlongLine]);

    if (splitResult.rows.length === 0) {
      throw new Error('Could not split trail (position too close to endpoints)');
    }

    const segments = [
      splitResult.rows[0].segment1,
      splitResult.rows[0].segment2
    ].filter(segment => segment);

    if (segments.length < 2) {
      throw new Error('Split did not produce 2 valid segments');
    }

        // Delete the original trail
    await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails WHERE app_uuid = $1
    `, [operation.targetTrailUuid]);
        
        // Insert the split segments
    for (let i = 0; i < segments.length; i++) {
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
        trail.name,
        segments[i],
        trail.trail_type,
        trail.surface,
        trail.difficulty,
        trail.length_km,
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
        trail.original_trail_uuid
      ]);
    }
  }
}