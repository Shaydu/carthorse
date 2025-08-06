import { Pool } from 'pg';

export interface ExportData {
  trails: any[];
  nodes: any[];
  edges: any[];
}

export class ExportSqlHelpers {
  constructor(
    private pgClient: Pool,
    private stagingSchema: string
  ) {}

  /**
   * Export trail data for GeoJSON
   */
  async exportTrailsForGeoJSON(): Promise<any[]> {
    const trailsResult = await this.pgClient.query(`
      SELECT 
        app_uuid,
        name,
        region,
        trail_type,
        surface,
        difficulty,
        length_km,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        bbox_min_lng,
        bbox_max_lng,
        bbox_min_lat,
        bbox_max_lat,
        ST_AsGeoJSON(geometry, 6, 0) as geojson
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL
      ORDER BY name
    `);
    
    return trailsResult.rows;
  }

  /**
   * Export routing nodes for GeoJSON
   */
  async exportRoutingNodesForGeoJSON(): Promise<any[]> {
    const nodesResult = await this.pgClient.query(`
      SELECT 
        id,
        id as node_uuid,
        ST_Y(the_geom) as lat,
        ST_X(the_geom) as lng,
        0 as elevation,
        node_type,
        '' as connected_trails,
        ARRAY[]::text[] as trail_ids,
        ST_AsGeoJSON(the_geom) as geojson
      FROM ${this.stagingSchema}.ways_noded_vertices_pgr
      ORDER BY id
    `);
    
    return nodesResult.rows;
  }

  /**
   * Export routing edges for GeoJSON
   */
  async exportRoutingEdgesForGeoJSON(): Promise<any[]> {
    const edgesResult = await this.pgClient.query(`
      SELECT 
        id,
        source,
        target,
        trail_id,
        trail_name,
        length_km,
        elevation_gain,
        elevation_loss,
        is_bidirectional,
        ST_AsGeoJSON(geometry) as geojson
      FROM ${this.stagingSchema}.routing_edges
      ORDER BY id
    `);
    
    return edgesResult.rows;
  }



  /**
   * Export all data for GeoJSON
   */
  async exportAllDataForGeoJSON(): Promise<ExportData> {
    const [trails, nodes, edges] = await Promise.all([
      this.exportTrailsForGeoJSON(),
      this.exportRoutingNodesForGeoJSON(),
      this.exportRoutingEdgesForGeoJSON()
    ]);

    return { trails, nodes, edges };
  }

  /**
   * Export trail segments only (for trails-only export)
   */
  async exportTrailSegmentsOnly(): Promise<any[]> {
    const trailsResult = await this.pgClient.query(`
      SELECT 
        app_uuid,
        name,
        trail_type,
        surface,
        difficulty,
        length_km,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        ST_AsGeoJSON(geometry) as geojson
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL
      ORDER BY name
    `);
    
    return trailsResult.rows;
  }

  /**
   * Export route recommendations for both GeoJSON and SQLite strategies
   */
  async exportRouteRecommendations(): Promise<any[]> {
    // First check if there are any routes to export
    const countResult = await this.pgClient.query(`
      SELECT COUNT(*) as route_count 
      FROM ${this.stagingSchema}.route_recommendations 
      WHERE route_edges IS NOT NULL AND route_edges != 'null'
    `);
    
    const routeCount = parseInt(countResult.rows[0].route_count);
    
    if (routeCount === 0) {
      console.log('📊 No routes to export - returning empty array');
      return [];
    }
    
    const recommendationsResult = await this.pgClient.query(`
      SELECT 
        r.route_uuid,
        r.route_name,
        r.route_type,
        r.route_shape,
        r.input_length_km,
        r.input_elevation_gain,
        r.recommended_length_km,
        r.recommended_elevation_gain,
        r.route_path,
        r.route_edges,
        r.trail_count,
        r.route_score,
        r.similarity_score,
        r.region,
        r.created_at
      FROM ${this.stagingSchema}.route_recommendations r
      WHERE r.route_edges IS NOT NULL AND r.route_edges != 'null'
      ORDER BY r.route_score DESC
    `);
    
    return recommendationsResult.rows;
  }
} 