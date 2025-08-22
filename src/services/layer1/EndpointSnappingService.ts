import { Pool } from 'pg';

export interface EndpointSnappingConfig {
  stagingSchema: string;
  pgClient: Pool;
  region: string;
  bbox?: number[];
  sourceFilter?: string;
  snappingTolerance?: number; // Distance in meters to snap endpoints
  minTrailLength?: number; // Minimum trail length to consider for snapping
  trailheadTolerance?: number; // Distance in meters to detect trailheads
  preserveTrailheads?: boolean; // Whether to preserve known trailhead endpoints
  preserveDeadEnds?: boolean; // Whether to preserve legitimate dead end trails
}

export interface EndpointSnappingResult {
  endpointsProcessed: number;
  trailsSplit: number;
  newSegmentsCreated: number;
  gapsFixed: number;
}

export class EndpointSnappingService {
  private stagingSchema: string;
  private pgClient: Pool;
  private config: EndpointSnappingConfig;

  constructor(config: EndpointSnappingConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
    this.config = config;
  }

  /**
   * Apply endpoint snapping to fix degree 1 endpoints at T and Y intersections
   */
  async applyEndpointSnapping(): Promise<EndpointSnappingResult> {
    console.log('🔗 Applying endpoint snapping to fix degree 1 endpoints...');
    
    const result: EndpointSnappingResult = {
      endpointsProcessed: 0,
      trailsSplit: 0,
      newSegmentsCreated: 0,
      gapsFixed: 0
    };

    try {
      // Step 1: Identify degree 1 endpoints (trail endpoints that don't connect to other trails)
      const allDegree1Endpoints = await this.identifyDegree1Endpoints();
      console.log(`   📍 Found ${allDegree1Endpoints.length} total degree 1 endpoints`);

      if (allDegree1Endpoints.length === 0) {
        console.log('   ✅ No degree 1 endpoints found - no snapping needed');
        return result;
      }

      // Step 1.5: Filter out legitimate endpoints (trailheads, dead ends)
      console.log('   🏁 Step 1.5: Filtering out legitimate endpoints...');
      const degree1Endpoints = await this.filterLegitimateEndpoints(allDegree1Endpoints);
      console.log(`   📍 After filtering: ${degree1Endpoints.length} endpoints need snapping`);

      if (degree1Endpoints.length === 0) {
        console.log('   ✅ All degree 1 endpoints are legitimate - no snapping needed');
        return result;
      }

      // Step 2: Find nearby trail paths for each endpoint
      const snappingCandidates = await this.findSnappingCandidates(degree1Endpoints);
      console.log(`   🔍 Found ${snappingCandidates.length} snapping candidates`);

      // Step 3: Apply snapping and splitting
      const snappingResult = await this.applySnappingAndSplitting(snappingCandidates);
      
      result.endpointsProcessed = degree1Endpoints.length;
      result.trailsSplit = snappingResult.trailsSplit;
      result.newSegmentsCreated = snappingResult.newSegmentsCreated;
      result.gapsFixed = snappingResult.gapsFixed;

      console.log(`   ✅ Endpoint snapping completed:`);
      console.log(`      📍 Endpoints processed: ${result.endpointsProcessed}`);
      console.log(`      ✂️ Trails split: ${result.trailsSplit}`);
      console.log(`      🔗 New segments created: ${result.newSegmentsCreated}`);
      console.log(`      🔧 Gaps fixed: ${result.gapsFixed}`);

      return result;

    } catch (error) {
      console.error('❌ Endpoint snapping failed:', error);
      throw error;
    }
  }

  /**
   * Step 1: Identify degree 1 endpoints (trail endpoints that don't connect to other trails)
   */
  private async identifyDegree1Endpoints(): Promise<any[]> {
    const tolerance = this.config.snappingTolerance || 5; // Default 5 meters - conservative tolerance
    
    const sql = `
      WITH trail_endpoints AS (
        -- Get start points of all trails
        SELECT 
          app_uuid,
          name,
          ST_StartPoint(geometry) as endpoint_geom,
          'start' as endpoint_type,
          geometry as trail_geom
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) > ${this.config.minTrailLength || 50}
        
        UNION ALL
        
        -- Get end points of all trails
        SELECT 
          app_uuid,
          name,
          ST_EndPoint(geometry) as endpoint_geom,
          'end' as endpoint_type,
          geometry as trail_geom
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) > ${this.config.minTrailLength || 50}
      ),
      degree1_endpoints AS (
        -- Find endpoints that don't have nearby connections to other trails
        SELECT DISTINCT
          te.app_uuid,
          te.name,
          te.endpoint_geom,
          te.endpoint_type,
          te.trail_geom,
          ST_X(te.endpoint_geom) as lng,
          ST_Y(te.endpoint_geom) as lat
        FROM trail_endpoints te
        WHERE NOT EXISTS (
          -- Check if this endpoint is close to any other trail (not its own)
          SELECT 1 
          FROM ${this.stagingSchema}.trails t2
          WHERE t2.app_uuid != te.app_uuid
            AND t2.geometry IS NOT NULL 
            AND ST_IsValid(t2.geometry)
            AND ST_DWithin(
              te.endpoint_geom, 
              t2.geometry, 
              ${tolerance}
            )
        )
      )
      SELECT * FROM degree1_endpoints
      ORDER BY name, endpoint_type;
    `;

    const result = await this.pgClient.query(sql);
    return result.rows;
  }

  /**
   * Step 1.5: Filter out legitimate endpoints (trailheads, dead ends)
   */
  private async filterLegitimateEndpoints(degree1Endpoints: any[]): Promise<any[]> {
    const legitimateEndpoints: any[] = [];
    
    for (const endpoint of degree1Endpoints) {
      // Check if this endpoint is likely a legitimate trailhead or dead end
      const isLegitimate = await this.isLegitimateEndpoint(endpoint);
      
      if (!isLegitimate) {
        legitimateEndpoints.push(endpoint);
      } else {
        console.log(`   🏁 Preserving legitimate endpoint: ${endpoint.name} (${endpoint.endpoint_type})`);
      }
    }
    
    return legitimateEndpoints;
  }

  /**
   * Determine if an endpoint is legitimate (trailhead, dead end, etc.)
   */
  private async isLegitimateEndpoint(endpoint: any): Promise<boolean> {
    // Check if endpoint is near a road (likely a trailhead)
    const roadCheckSql = `
      SELECT COUNT(*) as road_count
      FROM ${this.stagingSchema}.trails t
      WHERE (t.name ILIKE '%road%' 
        OR t.name ILIKE '%street%' 
        OR t.name ILIKE '%highway%'
        OR t.name ILIKE '%parking%'
        OR t.name ILIKE '%trailhead%')
        AND ST_DWithin(
          ST_GeomFromText('POINT(${endpoint.lng} ${endpoint.lat})', 4326),
          t.geometry,
          50 -- 50m tolerance for road detection
        )
    `;
    
    const roadResult = await this.pgClient.query(roadCheckSql);
    const hasNearbyRoad = roadResult.rows[0].road_count > 0;
    
    // Check if trail name suggests it's a dead end or out-and-back
    const isDeadEndTrail = endpoint.name.toLowerCase().includes('dead end') || 
                          endpoint.name.toLowerCase().includes('out and back') ||
                          endpoint.name.toLowerCase().includes('loop');
    
    // Check if trail is very short (likely a spur or connector) - use SQL query
    const shortTrailCheckSql = `
      SELECT ST_Length(geometry::geography) as trail_length
      FROM ${this.stagingSchema}.trails
      WHERE app_uuid = '${endpoint.app_uuid}'
    `;
    
    const shortTrailResult = await this.pgClient.query(shortTrailCheckSql);
    const trailLength = shortTrailResult.rows[0]?.trail_length || 0;
    const isShortTrail = trailLength < 100; // Less than 100m
    
    return hasNearbyRoad || isDeadEndTrail || isShortTrail;
  }

  /**
   * Step 2: Find nearby trail paths for each endpoint
   */
  private async findSnappingCandidates(degree1Endpoints: any[]): Promise<any[]> {
    const tolerance = this.config.snappingTolerance || 5; // Default 5 meters - conservative tolerance
    const candidates: any[] = [];

    for (const endpoint of degree1Endpoints) {
      // Find nearby trails that this endpoint could snap to
      const nearbyTrailsSql = `
        SELECT 
          t.app_uuid,
          t.name,
          t.geometry,
          ST_Distance(endpoint_geom, t.geometry) as distance,
          ST_ClosestPoint(t.geometry, endpoint_geom) as closest_point,
          ST_LineLocatePoint(t.geometry, ST_ClosestPoint(t.geometry, endpoint_geom)) as split_ratio
        FROM ${this.stagingSchema}.trails t,
        (SELECT ST_GeomFromText('POINT(${endpoint.lng} ${endpoint.lat})', 4326) as endpoint_geom) ep
        WHERE t.app_uuid != '${endpoint.app_uuid}'
          AND t.geometry IS NOT NULL 
          AND ST_IsValid(t.geometry)
          AND ST_Length(t.geometry::geography) > ${this.config.minTrailLength || 50}
          AND ST_DWithin(ep.endpoint_geom, t.geometry, ${tolerance})
        ORDER BY ST_Distance(ep.endpoint_geom, t.geometry)
        LIMIT 3; -- Consider top 3 closest trails
      `;

      const nearbyTrails = await this.pgClient.query(nearbyTrailsSql);
      
      if (nearbyTrails.rows.length > 0) {
        // Select the closest trail for snapping
        const bestCandidate = nearbyTrails.rows[0];
        candidates.push({
          endpoint,
          targetTrail: bestCandidate,
          distance: bestCandidate.distance
        });
      }
    }

    return candidates;
  }

  /**
   * Step 3: Apply snapping and splitting
   */
  private async applySnappingAndSplitting(snappingCandidates: any[]): Promise<{trailsSplit: number, newSegmentsCreated: number, gapsFixed: number}> {
    let trailsSplit = 0;
    let newSegmentsCreated = 0;
    let gapsFixed = 0;

    for (const candidate of snappingCandidates) {
      try {
        const result = await this.snapEndpointToTrail(candidate);
        if (result.success) {
          trailsSplit += result.trailsSplit;
          newSegmentsCreated += result.newSegmentsCreated;
          gapsFixed += result.gapsFixed;
        }
      } catch (error) {
        console.warn(`⚠️ Failed to snap endpoint ${candidate.endpoint.app_uuid}:`, error);
      }
    }

    return { trailsSplit, newSegmentsCreated, gapsFixed };
  }

  /**
   * Snap a single endpoint to a target trail and split the trail
   */
  private async snapEndpointToTrail(candidate: any): Promise<{success: boolean, trailsSplit: number, newSegmentsCreated: number, gapsFixed: number}> {
    const { endpoint, targetTrail } = candidate;
    
    try {
      // Step 1: Split the target trail at the closest point
      const splitResult = await this.splitTrailAtPoint(targetTrail, targetTrail.closest_point);
      
      if (!splitResult.success) {
        return { success: false, trailsSplit: 0, newSegmentsCreated: 0, gapsFixed: 0 };
      }

      // Step 2: Create a new connecting segment from endpoint to split point
      const connectionResult = await this.createConnectingSegment(endpoint, targetTrail.closest_point);
      
      if (!connectionResult.success) {
        return { success: false, trailsSplit: 0, newSegmentsCreated: 0, gapsFixed: 0 };
      }

      return {
        success: true,
        trailsSplit: splitResult.segmentsCreated,
        newSegmentsCreated: connectionResult.segmentsCreated,
        gapsFixed: 1
      };

    } catch (error) {
      console.error('Error in snapEndpointToTrail:', error);
      return { success: false, trailsSplit: 0, newSegmentsCreated: 0, gapsFixed: 0 };
    }
  }

  /**
   * Split a trail at a specific point
   */
  private async splitTrailAtPoint(trail: any, splitPoint: any): Promise<{success: boolean, segmentsCreated: number}> {
    try {
      // Use ST_Split to split the trail at the closest point
      const splitSql = `
        WITH split_result AS (
          SELECT (ST_Dump(ST_Split(geometry, ST_GeomFromText('${splitPoint}', 4326)))).geom as split_geom
          FROM ${this.stagingSchema}.trails
          WHERE app_uuid = '${trail.app_uuid}'
        ),
        valid_segments AS (
          SELECT split_geom
          FROM split_result
          WHERE ST_GeometryType(split_geom) = 'ST_LineString'
            AND ST_Length(split_geom::geography) > ${this.config.minTrailLength || 50}
        )
        SELECT COUNT(*) as segment_count
        FROM valid_segments;
      `;

      const splitCount = await this.pgClient.query(splitSql);
      const segmentsCreated = parseInt(splitCount.rows[0].segment_count);

      if (segmentsCreated > 1) {
        // Replace the original trail with split segments
        const replaceSql = `
          WITH split_result AS (
            SELECT (ST_Dump(ST_Split(geometry, ST_GeomFromText('${splitPoint}', 4326)))).geom as split_geom
            FROM ${this.stagingSchema}.trails
            WHERE app_uuid = '${trail.app_uuid}'
          ),
          valid_segments AS (
            SELECT 
              gen_random_uuid() as app_uuid,
              '${trail.name}' as name,
              split_geom as geometry,
              ST_Length(split_geom::geography) / 1000.0 as length_km
            FROM split_result
            WHERE ST_GeometryType(split_geom) = 'ST_LineString'
              AND ST_Length(split_geom::geography) > ${this.config.minTrailLength || 50}
          )
          INSERT INTO ${this.stagingSchema}.trails (app_uuid, name, geometry, length_km)
          SELECT app_uuid, name, geometry, length_km
          FROM valid_segments;
        `;

        // Delete the original trail
        await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.trails WHERE app_uuid = '${trail.app_uuid}'`);
        
        // Insert the split segments
        await this.pgClient.query(replaceSql);

        return { success: true, segmentsCreated };
      }

      return { success: false, segmentsCreated: 0 };

    } catch (error) {
      console.error('Error in splitTrailAtPoint:', error);
      return { success: false, segmentsCreated: 0 };
    }
  }

  /**
   * Create a connecting segment from endpoint to split point
   */
  private async createConnectingSegment(endpoint: any, splitPoint: any): Promise<{success: boolean, segmentsCreated: number}> {
    try {
      const connectionSql = `
        INSERT INTO ${this.stagingSchema}.trails (app_uuid, name, geometry, length_km)
        VALUES (
          gen_random_uuid(),
          '${endpoint.name}_connection',
          ST_GeomFromText('LINESTRING(${endpoint.lng} ${endpoint.lat}, ${splitPoint})', 4326),
          ST_Length(ST_GeomFromText('LINESTRING(${endpoint.lng} ${endpoint.lat}, ${splitPoint})', 4326)::geography) / 1000.0
        )
        WHERE ST_Length(ST_GeomFromText('LINESTRING(${endpoint.lng} ${endpoint.lat}, ${splitPoint})', 4326)::geography) > ${this.config.minTrailLength || 50};
      `;

      const result = await this.pgClient.query(connectionSql);
      const segmentsCreated = result.rowCount || 0;

      return { success: true, segmentsCreated };

    } catch (error) {
      console.error('Error in createConnectingSegment:', error);
      return { success: false, segmentsCreated: 0 };
    }
  }
}
