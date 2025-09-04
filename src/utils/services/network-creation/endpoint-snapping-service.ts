import { Pool } from 'pg';

export interface EndpointSnappingConfig {
  stagingSchema: string;
  snapToleranceMeters: number; // Default 2-3 meters
  minTrailLengthMeters: number; // Minimum trail length to consider
  maxSnapDistanceMeters: number; // Maximum distance to snap endpoints
  preserveOriginalTrails: boolean; // Whether to keep original trails
}

export interface EndpointSnappingResult {
  success: boolean;
  trailsSnapped: number;
  newConnectorTrails: number;
  endpointsProcessed: number;
  connectivityImprovements: number;
  error?: string;
  details?: {
    snappedEndpoints: Array<{
      trailId: string;
      trailName: string;
      endpointType: 'start' | 'end';
      snappedToTrailId: string;
      snappedToTrailName: string;
      distanceMeters: number;
      splitPoint: { lat: number; lng: number };
    }>;
    splitTrails: Array<{
      originalTrailId: string;
      originalTrailName: string;
      splitPoint: { lat: number; lng: number };
      newSegmentIds: string[];
    }>;
  };
}

export class EndpointSnappingService {
  private pgClient: Pool;
  private config: EndpointSnappingConfig;

  constructor(pgClient: Pool, config: EndpointSnappingConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  /**
   * Main method to snap trail endpoints and create proper routable edges
   */
  async snapEndpointsAndSplitTrails(): Promise<EndpointSnappingResult> {
    console.log(`🔗 Starting endpoint snapping with ${this.config.snapToleranceMeters}m tolerance...`);
    
    try {
      // Step 1: Find all trail endpoints that are close to other trails
      const endpointsToProcess = await this.findEndpointsNearTrails();
      console.log(`📍 Found ${endpointsToProcess.length} endpoints near other trails`);

      // Step 2: Process each endpoint and split trails as needed
      const result = await this.processEndpoints(endpointsToProcess);
      
      console.log(`✅ Endpoint snapping completed: ${result.trailsSnapped} trails snapped, ${result.newConnectorTrails} new connectors`);
      return result;
      
    } catch (error) {
      console.error('❌ Error in endpoint snapping:', error);
      return {
        success: false,
        trailsSnapped: 0,
        newConnectorTrails: 0,
        endpointsProcessed: 0,
        connectivityImprovements: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Find trail endpoints that are within tolerance of other trails
   */
  private async findEndpointsNearTrails(): Promise<Array<{
    trailId: string;
    trailName: string;
    endpointType: 'start' | 'end';
    endpointGeom: string;
    nearbyTrails: Array<{
      trailId: string;
      trailName: string;
      distanceMeters: number;
      closestPoint: string;
    }>;
  }>> {
          const query = `
      WITH trail_endpoints AS (
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          geometry as trail_geom,
          ST_Length(geometry::geography) as length_meters
        FROM ${this.config.stagingSchema}.trails
        WHERE ST_Length(geometry::geography) >= $1
      ),
      nearby_trails AS (
        SELECT 
          e1.trail_id,
          e1.trail_name,
          'start' as endpoint_type,
          e1.start_point as endpoint_geom,
          e2.trail_id as nearby_trail_id,
          e2.trail_name as nearby_trail_name,
          ST_Distance(e1.start_point::geography, e2.trail_geom::geography) as distance_meters,
          ST_ClosestPoint(e2.trail_geom, e1.start_point) as closest_point
        FROM trail_endpoints e1
        CROSS JOIN trail_endpoints e2
        WHERE e1.trail_id != e2.trail_id
          AND ST_Distance(e1.start_point::geography, e2.trail_geom::geography) <= $2
          AND ST_Distance(e1.start_point::geography, e2.trail_geom::geography) > 0
          
        UNION ALL
        
        SELECT 
          e1.trail_id,
          e1.trail_name,
          'end' as endpoint_type,
          e1.end_point as endpoint_geom,
          e2.trail_id as nearby_trail_id,
          e2.trail_name as nearby_trail_name,
          ST_Distance(e1.end_point::geography, e2.trail_geom::geography) as distance_meters,
          ST_ClosestPoint(e2.trail_geom, e1.end_point) as closest_point
        FROM trail_endpoints e1
        CROSS JOIN trail_endpoints e2
        WHERE e1.trail_id != e2.trail_id
          AND ST_Distance(e1.end_point::geography, e2.trail_geom::geography) <= $2
          AND ST_Distance(e1.end_point::geography, e2.trail_geom::geography) > 0
      )
      SELECT 
        trail_id,
        trail_name,
        endpoint_type,
        ST_AsText(endpoint_geom) as endpoint_geom,
        json_agg(
          json_build_object(
            'trailId', nearby_trail_id,
            'trailName', nearby_trail_name,
            'distanceMeters', distance_meters,
            'closestPoint', ST_AsText(closest_point)
          ) ORDER BY distance_meters
        ) as nearby_trails
      FROM nearby_trails
      GROUP BY trail_id, trail_name, endpoint_type, endpoint_geom
      ORDER BY trail_name, endpoint_type
    `;

    const result = await this.pgClient.query(query, [
      this.config.minTrailLengthMeters,
      this.config.snapToleranceMeters
    ]);

    return result.rows.map(row => ({
      trailId: row.trail_id,
      trailName: row.trail_name,
      endpointType: row.endpoint_type,
      endpointGeom: row.endpoint_geom,
      nearbyTrails: row.nearby_trails
    }));
  }

  /**
   * Process endpoints and split trails as needed
   */
  private async processEndpoints(endpointsToProcess: any[]): Promise<EndpointSnappingResult> {
    const snappedEndpoints: any[] = [];
    const splitTrails: any[] = [];
    const processedTrails = new Set<string>(); // Track trails that have been split
    let trailsSnapped = 0;
    let newConnectorTrails = 0;
    let connectivityImprovements = 0;

    for (const endpoint of endpointsToProcess) {
      console.log(`🔍 Processing ${endpoint.trailName} ${endpoint.endpointType} endpoint...`);
      
      // Find the closest trail that hasn't been split yet
      const closestUnsplitTrail = endpoint.nearbyTrails.find((nearby: any) => 
        !processedTrails.has(nearby.trailId) && 
        nearby.trailId !== endpoint.trailId // Don't split the trail we're testing
      );

      if (!closestUnsplitTrail) {
        console.log(`  ⏭️  No unsplit trails found for ${endpoint.trailName}`);
        continue;
      }

      // Split the nearby trail at the closest point
      const splitResult = await this.splitTrailAtPoint(
        closestUnsplitTrail.trailId,
        closestUnsplitTrail.closestPoint,
        endpoint.trailId,
        endpoint.trailName
      );

      if (splitResult.success) {
        // Mark this trail as processed (only split once)
        processedTrails.add(closestUnsplitTrail.trailId);
        
        // Create connector trail from endpoint to split point
        const connectorResult = await this.createConnectorTrail(
          endpoint.trailId,
          endpoint.endpointGeom,
          closestUnsplitTrail.closestPoint,
          endpoint.trailName,
          closestUnsplitTrail.trailName
        );

        if (connectorResult.success) {
          trailsSnapped++;
          newConnectorTrails++;
          connectivityImprovements++;
          
          snappedEndpoints.push({
            trailId: endpoint.trailId,
            trailName: endpoint.trailName,
            endpointType: endpoint.endpointType,
            snappedToTrailId: closestUnsplitTrail.trailId,
            snappedToTrailName: closestUnsplitTrail.trailName,
            distanceMeters: closestUnsplitTrail.distanceMeters,
            splitPoint: this.parsePoint(closestUnsplitTrail.closestPoint)
          });

          splitTrails.push({
            originalTrailId: closestUnsplitTrail.trailId,
            originalTrailName: closestUnsplitTrail.trailName,
            splitPoint: this.parsePoint(closestUnsplitTrail.closestPoint),
            newSegmentIds: splitResult.newSegmentIds
          });

          console.log(`  ✅ Split ${closestUnsplitTrail.trailName} and created connector`);
        }
      }
    }

    return {
      success: true,
      trailsSnapped,
      newConnectorTrails,
      endpointsProcessed: endpointsToProcess.length,
      connectivityImprovements,
      details: {
        snappedEndpoints,
        splitTrails
      }
    };
  }

  /**
   * Split a trail at a specific point
   */
  private async splitTrailAtPoint(
    trailId: string, 
    splitPoint: string, 
    connectingTrailId: string,
    connectingTrailName: string
  ): Promise<{ success: boolean; newSegmentIds?: string[]; error?: string }> {
    try {
                    // Get the original trail
        const trailQuery = `
          SELECT app_uuid, name, geometry, length_km, elevation_gain, elevation_loss
          FROM ${this.config.stagingSchema}.trails
          WHERE app_uuid = $1
        `;
      
      const trailResult = await this.pgClient.query(trailQuery, [trailId]);
      if (trailResult.rows.length === 0) {
        return { success: false, error: 'Trail not found' };
      }

             const trail = trailResult.rows[0];
       
       // Split the trail at the point
       const splitQuery = `
         WITH split_geometries AS (
           SELECT 
             (ST_Dump(ST_Split(trail.geometry, ST_Buffer(split_point, 0.0001)))).geom as split_geom
           FROM (SELECT $1::geometry as geometry) as trail,
                (SELECT $2::geometry as split_point) as split_point
           WHERE ST_DWithin(trail.geometry, split_point, $3)
         )
        SELECT 
          ST_AsText(geom) as geometry_text,
          ST_Length(geom::geography) as length_meters
        FROM split_geometries
        WHERE ST_Length(geom::geography) > 1  -- Filter out tiny segments
        ORDER BY ST_Length(geom::geography) DESC
      `;

             const splitResult = await this.pgClient.query(splitQuery, [
         trail.geometry,
         splitPoint,
         this.config.snapToleranceMeters / 111000 // Convert meters to degrees
       ]);

      if (splitResult.rows.length < 2) {
        return { success: false, error: 'Split did not create enough segments' };
      }

             // Delete the original trail
       await this.pgClient.query(
         `DELETE FROM ${this.config.stagingSchema}.trails WHERE app_uuid = $1`,
         [trailId]
       );

      // Insert the new split segments
      const newSegmentIds: string[] = [];
      for (let i = 0; i < splitResult.rows.length; i++) {
        const segment = splitResult.rows[i];
        const newSegmentId = `${trailId}_split_${i + 1}`;
        
                 await this.pgClient.query(`
           INSERT INTO ${this.config.stagingSchema}.trails (
             app_uuid, name, geometry, length_km, elevation_gain, elevation_loss
           ) VALUES ($1, $2, ST_GeomFromText($3), $4, $5, $6)
         `, [
          newSegmentId,
          trail.name,
          segment.geometry_text,
          segment.length_meters / 1000, // Convert to km
          trail.elevation_gain * (segment.length_meters / (trail.length_km * 1000)), // Proportional elevation
          trail.elevation_loss * (segment.length_meters / (trail.length_km * 1000))
        ]);

        newSegmentIds.push(newSegmentId);
      }

      return { success: true, newSegmentIds };

    } catch (error) {
      console.error('Error splitting trail:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Create a connector trail from endpoint to split point
   */
  private async createConnectorTrail(
    sourceTrailId: string,
    endpointGeom: string,
    splitPoint: string,
    sourceTrailName: string,
    targetTrailName: string
  ): Promise<{ success: boolean; connectorId?: string; error?: string }> {
    try {
      const connectorId = `connector_${sourceTrailId}_${Date.now()}`;
      const connectorName = `Connector: ${sourceTrailName} to ${targetTrailName}`;
      
             // Create straight line connector
       const connectorQuery = `
         INSERT INTO ${this.config.stagingSchema}.trails (
           app_uuid, name, geometry, length_km, elevation_gain, elevation_loss
         ) VALUES ($1, $2, ST_MakeLine($3::geometry, $4::geometry), $5, 0, 0)
       `;

      const distanceMeters = await this.pgClient.query(`
        SELECT ST_Distance($1::geography, $2::geography) as distance
      `, [endpointGeom, splitPoint]);

      await this.pgClient.query(connectorQuery, [
        connectorId,
        connectorName,
        endpointGeom,
        splitPoint,
        distanceMeters.rows[0].distance / 1000 // Convert to km
      ]);

      return { success: true, connectorId };

    } catch (error) {
      console.error('Error creating connector trail:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Parse point string to lat/lng object
   */
  private parsePoint(pointText: string): { lat: number; lng: number } {
    const match = pointText.match(/POINT\(([^)]+)\)/);
    if (match) {
      const [lng, lat] = match[1].split(' ').map(Number);
      return { lat, lng };
    }
    return { lat: 0, lng: 0 };
  }
}
