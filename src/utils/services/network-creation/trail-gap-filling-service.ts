import { Pool } from 'pg';

export interface TrailGapFillingResult {
  gapsFound: number;
  connectorTrailsCreated: number;
  details: Array<{
    trail1_id: string;
    trail2_id: string;
    trail1_name: string;
    trail2_name: string;
    distance_meters: number;
    connector_geom: any;
  }>;
}

export interface TrailGapFillingConfig {
  toleranceMeters: number;
  maxConnectorsToCreate: number;
  minConnectorLengthMeters?: number;
}

/**
 * Detects gaps between trail endpoints and creates connector trails
 * 
 * A gap is defined as:
 * - Two trail endpoints that are within tolerance distance of each other
 * - Where no trail currently connects them
 * - And the gap is small enough to warrant a connector
 */
export class TrailGapFillingService {
  constructor(
    private pgClient: Pool,
    private stagingSchema: string
  ) {}

  /**
   * Detect and fill gaps between trail endpoints
   */
  async detectAndFillTrailGaps(config: TrailGapFillingConfig): Promise<TrailGapFillingResult> {
    console.log('🔍 Detecting gaps between trail endpoints...');
    
    const toleranceDegrees = config.toleranceMeters / 111320; // Convert meters to degrees
    const minConnectorLength = config.minConnectorLengthMeters || 1.0; // Minimum 1m connector
    
    // Find trail endpoint pairs that should be connected
    const gapDetectionResult = await this.pgClient.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          ST_AsText(ST_StartPoint(geometry)) as start_text,
          ST_AsText(ST_EndPoint(geometry)) as end_text
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) > 0
      ),
      endpoint_pairs AS (
        SELECT 
          t1.trail_id as trail1_id,
          t2.trail_id as trail2_id,
          t1.trail_name as trail1_name,
          t2.trail_name as trail2_name,
          t1.start_point as point1,
          t2.start_point as point2,
          'start-start' as connection_type,
          ST_Distance(t1.start_point::geography, t2.start_point::geography) as distance_meters
        FROM trail_endpoints t1
        CROSS JOIN trail_endpoints t2
        WHERE t1.trail_id < t2.trail_id
          AND ST_DWithin(t1.start_point, t2.start_point, $1)
          AND ST_Distance(t1.start_point::geography, t2.start_point::geography) >= $2
          AND ST_Distance(t1.start_point::geography, t2.start_point::geography) <= $3
        
        UNION ALL
        
        SELECT 
          t1.trail_id as trail1_id,
          t2.trail_id as trail2_id,
          t1.trail_name as trail1_name,
          t2.trail_name as trail2_name,
          t1.start_point as point1,
          t2.end_point as point2,
          'start-end' as connection_type,
          ST_Distance(t1.start_point::geography, t2.end_point::geography) as distance_meters
        FROM trail_endpoints t1
        CROSS JOIN trail_endpoints t2
        WHERE t1.trail_id < t2.trail_id
          AND ST_DWithin(t1.start_point, t2.end_point, $1)
          AND ST_Distance(t1.start_point::geography, t2.end_point::geography) >= $2
          AND ST_Distance(t1.start_point::geography, t2.end_point::geography) <= $3
        
        UNION ALL
        
        SELECT 
          t1.trail_id as trail1_id,
          t2.trail_id as trail2_id,
          t1.trail_name as trail1_name,
          t2.trail_name as trail2_name,
          t1.end_point as point1,
          t2.start_point as point2,
          'end-start' as connection_type,
          ST_Distance(t1.end_point::geography, t2.start_point::geography) as distance_meters
        FROM trail_endpoints t1
        CROSS JOIN trail_endpoints t2
        WHERE t1.trail_id < t2.trail_id
          AND ST_DWithin(t1.end_point, t2.start_point, $1)
          AND ST_Distance(t1.end_point::geography, t2.start_point::geography) >= $2
          AND ST_Distance(t1.end_point::geography, t2.start_point::geography) <= $3
        
        UNION ALL
        
        SELECT 
          t1.trail_id as trail1_id,
          t2.trail_id as trail2_id,
          t1.trail_name as trail1_name,
          t2.trail_name as trail2_name,
          t1.end_point as point1,
          t2.end_point as point2,
          'end-end' as connection_type,
          ST_Distance(t1.end_point::geography, t2.end_point::geography) as distance_meters
        FROM trail_endpoints t1
        CROSS JOIN trail_endpoints t2
        WHERE t1.trail_id < t2.trail_id
          AND ST_DWithin(t1.end_point, t2.end_point, $1)
          AND ST_Distance(t1.end_point::geography, t2.end_point::geography) >= $2
          AND ST_Distance(t1.end_point::geography, t2.end_point::geography) <= $3
      )
      SELECT 
        trail1_id,
        trail2_id,
        trail1_name,
        trail2_name,
        connection_type,
        distance_meters,
        ST_MakeLine(point1, point2) as connector_geom,
        ST_AsText(point1) as point1_text,
        ST_AsText(point2) as point2_text
      FROM endpoint_pairs
      ORDER BY distance_meters
      LIMIT $4
    `, [toleranceDegrees, minConnectorLength, config.toleranceMeters, config.maxConnectorsToCreate]);
    
    const gapsFound = gapDetectionResult.rows.length;
    console.log(`🔍 Found ${gapsFound} gaps between trail endpoints`);
    
    if (gapsFound === 0) {
      return {
        gapsFound: 0,
        connectorTrailsCreated: 0,
        details: []
      };
    }
    
    // Create connector trails for each detected gap
    let connectorsCreated = 0;
    const details: TrailGapFillingResult['details'] = [];
    
    for (const gap of gapDetectionResult.rows) {
      try {
        // Create a connector trail
        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.trails (
            app_uuid, name, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, source, geometry
          ) VALUES (
            gen_random_uuid(),
            $1,
            'connector',
            'unknown',
            'unknown',
            '{"gap_filler": true}'::jsonb,
            ST_XMin(ST_Force2D($2)),
            ST_XMax(ST_Force2D($2)),
            ST_YMin(ST_Force2D($2)),
            ST_YMax(ST_Force2D($2)),
            ST_Length($2::geography) / 1000.0,
            0,
            0,
            'gap_filler',
            $2
          )
        `, [
          `Connector: ${gap.trail1_name} ↔ ${gap.trail2_name}`,
          gap.connector_geom
        ]);
        
        connectorsCreated++;
        details.push({
          trail1_id: gap.trail1_id,
          trail2_id: gap.trail2_id,
          trail1_name: gap.trail1_name,
          trail2_name: gap.trail2_name,
          distance_meters: gap.distance_meters,
          connector_geom: gap.connector_geom
        });
        
        console.log(`🔗 Created connector: ${gap.trail1_name} ↔ ${gap.trail2_name} (${gap.distance_meters.toFixed(2)}m, ${gap.connection_type})`);
        
      } catch (error) {
        console.error(`❌ Failed to create connector between ${gap.trail1_name} and ${gap.trail2_name}:`, error);
      }
    }
    
    console.log(`✅ Created ${connectorsCreated} connector trails to fill gaps`);
    
    return {
      gapsFound,
      connectorTrailsCreated: connectorsCreated,
      details
    };
  }

  /**
   * Validate trail gap detection
   */
  async validateTrailGapDetection(config: TrailGapFillingConfig): Promise<{
    totalTrails: number;
    totalEndpoints: number;
    potentialGaps: number;
  }> {
    const stats = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(*) * 2 as total_endpoints
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND ST_Length(geometry::geography) > 0
    `);
    
    const toleranceDegrees = config.toleranceMeters / 111320;
    const minConnectorLength = config.minConnectorLengthMeters || 1.0;
    
    const potentialGaps = await this.pgClient.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid as trail_id,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) > 0
      )
      SELECT COUNT(*) as count
      FROM trail_endpoints t1
      CROSS JOIN trail_endpoints t2
      WHERE t1.trail_id < t2.trail_id
        AND (
          (ST_DWithin(t1.start_point, t2.start_point, $1) AND 
           ST_Distance(t1.start_point::geography, t2.start_point::geography) >= $2 AND
           ST_Distance(t1.start_point::geography, t2.start_point::geography) <= $3) OR
          (ST_DWithin(t1.start_point, t2.end_point, $1) AND 
           ST_Distance(t1.start_point::geography, t2.end_point::geography) >= $2 AND
           ST_Distance(t1.start_point::geography, t2.end_point::geography) <= $3) OR
          (ST_DWithin(t1.end_point, t2.start_point, $1) AND 
           ST_Distance(t1.end_point::geography, t2.start_point::geography) >= $2 AND
           ST_Distance(t1.end_point::geography, t2.start_point::geography) <= $3) OR
          (ST_DWithin(t1.end_point, t2.end_point, $1) AND 
           ST_Distance(t1.end_point::geography, t2.end_point::geography) >= $2 AND
           ST_Distance(t1.end_point::geography, t2.end_point::geography) <= $3)
        )
    `, [toleranceDegrees, minConnectorLength, config.toleranceMeters]);
    
    return {
      totalTrails: stats.rows[0].total_trails,
      totalEndpoints: stats.rows[0].total_endpoints,
      potentialGaps: potentialGaps.rows[0].count
    };
  }
}
