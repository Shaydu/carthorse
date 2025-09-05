import { Pool } from 'pg';

export interface EndpointAnalysis {
  nodeId: string;
  nodeUuid: string;
  lat: number;
  lng: number;
  elevation: number;
  nearbyTrails: NearbyTrail[];
}

export interface NearbyTrail {
  trailUuid: string;
  trailName: string;
  distanceMeters: number;
  closestPoint: string;
  positionAlongLine: number;
  shouldSnap: boolean;
}

export class EndpointSnappingAnalysisService {
  constructor(
    private stagingSchema: string,
    private pgClient: Pool
  ) {}

  /**
   * Analyze all degree 1 endpoints to find nearby trails that should be snapped to
   */
  async analyzeEndpoints(): Promise<EndpointAnalysis[]> {
    console.log('🔍 Analyzing degree 1 endpoints for nearby trails...');

    // First, get all degree 1 endpoints from the network
    const endpointsQuery = `
      SELECT 
        id,
        node_uuid,
        lat,
        lng,
        elevation
      FROM ${this.stagingSchema}.network_vertices
      WHERE degree = 1
      ORDER BY id;
    `;

    const endpointsResult = await this.pgClient.query(endpointsQuery);
    console.log(`📊 Found ${endpointsResult.rows.length} degree 1 endpoints`);

    const analyses: EndpointAnalysis[] = [];

    for (const endpoint of endpointsResult.rows) {
      const analysis = await this.analyzeEndpoint(endpoint);
      if (analysis.nearbyTrails.length > 0) {
        analyses.push(analysis);
      }
    }

    console.log(`🎯 Found ${analyses.length} endpoints with nearby trails`);
    return analyses;
  }

  /**
   * Analyze a single endpoint to find nearby trails
   */
  private async analyzeEndpoint(endpoint: any): Promise<EndpointAnalysis> {
    const lat = parseFloat(endpoint.lat);
    const lng = parseFloat(endpoint.lng);
    const toleranceDegrees = 1.0 / 111000; // 1 meter in degrees

    const nearbyTrailsQuery = `
      WITH endpoint_point AS (
        SELECT ST_GeomFromText('POINT(' || $1::text || ' ' || $2::text || ')', 4326) as point_geom
      ),
      nearby_trails AS (
        SELECT 
          app_uuid,
          name,
          ST_Distance(geometry, (SELECT point_geom FROM endpoint_point)) as distance_meters,
          ST_AsText(ST_ClosestPoint(geometry, (SELECT point_geom FROM endpoint_point))) as closest_point,
          ST_LineLocatePoint(geometry, (SELECT point_geom FROM endpoint_point)) as position_along_line
        FROM ${this.stagingSchema}.trails
        WHERE ST_DWithin(geometry, (SELECT point_geom FROM endpoint_point), $3)
      )
      SELECT 
        app_uuid,
        name,
        ROUND(distance_meters::numeric, 6) as distance_m,
        closest_point,
        ROUND(position_along_line::numeric, 6) as position
      FROM nearby_trails
      ORDER BY distance_meters
      LIMIT 5;
    `;

    const result = await this.pgClient.query(nearbyTrailsQuery, [lng, lat, toleranceDegrees]);

    const nearbyTrails: NearbyTrail[] = result.rows.map(row => ({
      trailUuid: row.app_uuid,
      trailName: row.name,
      distanceMeters: parseFloat(row.distance_m),
      closestPoint: row.closest_point,
      positionAlongLine: parseFloat(row.position),
      shouldSnap: parseFloat(row.distance_m) < 2.0 && parseFloat(row.position) > 0.01 && parseFloat(row.position) < 0.99
    }));

    return {
      nodeId: endpoint.id,
      nodeUuid: endpoint.node_uuid,
      lat: lat,
      lng: lng,
      elevation: parseFloat(endpoint.elevation),
      nearbyTrails: nearbyTrails
    };
  }

  /**
   * Generate a summary report of all endpoints that should be snapped
   */
  async generateReport(): Promise<void> {
    const analyses = await this.analyzeEndpoints();

    console.log('\n📋 ENDPOINT SNAPPING ANALYSIS REPORT');
    console.log('=====================================');

    let totalSnapCandidates = 0;

    for (const analysis of analyses) {
      const snapCandidates = analysis.nearbyTrails.filter(trail => trail.shouldSnap);
      
      if (snapCandidates.length > 0) {
        totalSnapCandidates++;
        console.log(`\n🎯 Node ${analysis.nodeId} (${analysis.nodeUuid})`);
        console.log(`   Location: ${analysis.lat}, ${analysis.lng}`);
        console.log(`   Elevation: ${analysis.elevation}m`);
        
        for (const trail of snapCandidates) {
          console.log(`   📍 Should snap to: ${trail.trailName}`);
          console.log(`      Distance: ${trail.distanceMeters}m`);
          console.log(`      Position: ${(trail.positionAlongLine * 100).toFixed(1)}% along trail`);
          console.log(`      Closest point: ${trail.closestPoint}`);
        }
      }
    }

    console.log(`\n📊 SUMMARY:`);
    console.log(`   Total degree 1 endpoints: ${analyses.length}`);
    console.log(`   Endpoints needing snapping: ${totalSnapCandidates}`);
    console.log(`   Total snap operations needed: ${analyses.reduce((sum, a) => sum + a.nearbyTrails.filter(t => t.shouldSnap).length, 0)}`);
  }

  /**
   * Export results to JSON file
   */
  async exportToJson(filename: string): Promise<void> {
    const analyses = await this.analyzeEndpoints();
    const fs = require('fs');
    
    const exportData = {
      timestamp: new Date().toISOString(),
      stagingSchema: this.stagingSchema,
      totalEndpoints: analyses.length,
      endpoints: analyses
    };

    fs.writeFileSync(filename, JSON.stringify(exportData, null, 2));
    console.log(`📁 Exported analysis to: ${filename}`);
  }
}
