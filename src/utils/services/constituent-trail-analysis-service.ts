import { Pool } from 'pg';

export interface ConstituentTrail {
  app_uuid: string;
  name: string;
  trail_type: string;
  surface: string;
  difficulty: string;
  length_km: number;
  elevation_gain: number;
  elevation_loss: number;
  max_elevation: number;
  min_elevation: number;
  avg_elevation: number;
}

export interface RouteConstituentAnalysis {
  route_uuid: string;
  route_name: string;
  edge_count: number;
  unique_trail_count: number;
  constituent_trails: ConstituentTrail[];
  total_trail_distance_km: number;
  total_trail_elevation_gain_m: number;
  total_trail_elevation_loss_m: number;
  out_and_back_distance_km: number;
  out_and_back_elevation_gain_m: number;
  out_and_back_elevation_loss_m: number;
}

export class ConstituentTrailAnalysisService {
  constructor(private pgClient: Pool) {}

  /**
   * Analyze constituent trails for a route
   */
  async analyzeRouteConstituentTrails(
    stagingSchema: string,
    routeEdges: any[]
  ): Promise<RouteConstituentAnalysis> {
    // Extract unique trails from route edges
    const uniqueTrails = this.extractUniqueTrails(routeEdges);
    
    // Calculate totals
    const totalTrailDistance = uniqueTrails.reduce((sum, trail) => sum + (trail.length_km || 0), 0);
    const totalTrailElevationGain = uniqueTrails.reduce((sum, trail) => sum + (trail.elevation_gain || 0), 0);
    const totalTrailElevationLoss = uniqueTrails.reduce((sum, trail) => sum + (trail.elevation_loss || 0), 0);
    
    // For out-and-back routes, double the metrics
    const outAndBackDistance = totalTrailDistance * 2;
    const outAndBackElevationGain = totalTrailElevationGain * 2;
    const outAndBackElevationLoss = totalTrailElevationLoss * 2;

    return {
      route_uuid: routeEdges[0]?.route_uuid || 'unknown',
      route_name: routeEdges[0]?.route_name || 'unknown',
      edge_count: routeEdges.length,
      unique_trail_count: uniqueTrails.length,
      constituent_trails: uniqueTrails,
      total_trail_distance_km: totalTrailDistance,
      total_trail_elevation_gain_m: totalTrailElevationGain,
      total_trail_elevation_loss_m: totalTrailElevationLoss,
      out_and_back_distance_km: outAndBackDistance,
      out_and_back_elevation_gain_m: outAndBackElevationGain,
      out_and_back_elevation_loss_m: outAndBackElevationLoss
    };
  }

  /**
   * Extract unique trails from route edges
   */
  private extractUniqueTrails(routeEdges: any[]): ConstituentTrail[] {
    const trailMap = new Map<string, ConstituentTrail>();
    
    for (const edge of routeEdges) {
      if (edge.app_uuid && edge.trail_name) {
        if (!trailMap.has(edge.app_uuid)) {
          trailMap.set(edge.app_uuid, {
            app_uuid: edge.app_uuid,
            name: edge.trail_name,
            trail_type: edge.trail_type || 'N/A',
            surface: edge.surface || 'N/A',
            difficulty: edge.difficulty || 'N/A',
            length_km: edge.trail_length_km || 0,
            elevation_gain: edge.trail_elevation_gain || 0,
            elevation_loss: edge.elevation_loss || 0,
            max_elevation: edge.max_elevation || 0,
            min_elevation: edge.min_elevation || 0,
            avg_elevation: edge.avg_elevation || 0
          });
        }
      }
    }
    
    return Array.from(trailMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Generate comprehensive route report
   */
  async generateRouteReport(
    stagingSchema: string,
    routeAnalysis: RouteConstituentAnalysis
  ): Promise<void> {
    console.log(`\n🏃 ROUTE ANALYSIS: ${routeAnalysis.route_name}`);
    console.log(`   Edge Count: ${routeAnalysis.edge_count}`);
    console.log(`   Unique Trails: ${routeAnalysis.unique_trail_count}`);
    console.log(`   Total Trail Distance: ${routeAnalysis.total_trail_distance_km.toFixed(2)}km`);
    console.log(`   Total Trail Elevation Gain: ${routeAnalysis.total_trail_elevation_gain_m.toFixed(0)}m`);
    console.log(`   Out-and-Back Distance: ${routeAnalysis.out_and_back_distance_km.toFixed(2)}km`);
    console.log(`   Out-and-Back Elevation Gain: ${routeAnalysis.out_and_back_elevation_gain_m.toFixed(0)}m`);
    
    if (routeAnalysis.constituent_trails.length > 0) {
      console.log(`   Constituent Trails:`);
      routeAnalysis.constituent_trails.forEach((trail, index) => {
        console.log(`     ${index + 1}. ${trail.name}`);
        console.log(`        Distance: ${trail.length_km.toFixed(2)}km`);
        console.log(`        Elevation Gain: ${trail.elevation_gain.toFixed(0)}m`);
        console.log(`        Type: ${trail.trail_type}`);
        console.log(`        Surface: ${trail.surface}`);
        console.log(`        Difficulty: ${trail.difficulty}`);
      });
    }
  }

  /**
   * Analyze all routes in a staging schema
   */
  async analyzeAllRoutes(stagingSchema: string): Promise<RouteConstituentAnalysis[]> {
    console.log(`🔍 Analyzing constituent trails for all routes in ${stagingSchema}...`);
    
    // Get all route recommendations
    const routesResult = await this.pgClient.query(`
      SELECT 
        route_uuid, route_name, route_edges
      FROM ${stagingSchema}.route_recommendations
      WHERE route_edges IS NOT NULL
      ORDER BY route_name, created_at DESC
    `);

    const allAnalyses: RouteConstituentAnalysis[] = [];
    
    for (const route of routesResult.rows) {
      const routeEdges = typeof route.route_edges === 'string' 
        ? JSON.parse(route.route_edges) 
        : route.route_edges;
      
      // Add route metadata to edges
      const edgesWithMetadata = routeEdges.map((edge: any) => ({
        ...edge,
        route_uuid: route.route_uuid,
        route_name: route.route_name
      }));
      
      const analysis = await this.analyzeRouteConstituentTrails(stagingSchema, edgesWithMetadata);
      allAnalyses.push(analysis);
      
      // Generate report for this route
      await this.generateRouteReport(stagingSchema, analysis);
    }
    
    return allAnalyses;
  }

  /**
   * Export constituent trail analysis to JSON
   */
  async exportConstituentAnalysis(
    analyses: RouteConstituentAnalysis[],
    outputPath: string
  ): Promise<void> {
    const fs = require('fs');
    const path = require('path');
    
    fs.writeFileSync(outputPath, JSON.stringify(analyses, null, 2));
    console.log(`📄 Constituent trail analysis exported to: ${outputPath}`);
  }
} 