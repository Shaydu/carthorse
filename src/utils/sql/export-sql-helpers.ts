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
        node_uuid,
        lat,
        lng,
        elevation,
        node_type,
        connected_trails,
        trail_ids,
        ST_AsGeoJSON(ST_SetSRID(ST_MakePoint(lng, lat), 4326)) as geojson
      FROM ${this.stagingSchema}.routing_nodes
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
   * Export route recommendations for GeoJSON
   */
  async exportRouteRecommendationsForGeoJSON(): Promise<any[]> {
    const recommendationsResult = await this.pgClient.query(`
      SELECT 
        r.route_uuid,
        r.route_name,
        r.route_type,
        r.route_shape,
        r.input_distance_km,
        r.input_elevation_gain,
        r.recommended_distance_km,
        r.recommended_elevation_gain,
        r.route_path,
        r.route_edges,
        r.trail_count,
        r.route_score,
        r.similarity_score,
        r.region,
        -- Extract constituent trails from route_edges JSON (which now includes UUID mapping)
        (
          SELECT json_agg(
            DISTINCT jsonb_build_object(
              'app_uuid', edge->>'app_uuid',
              'trail_name', edge->>'trail_name',
              'trail_type', edge->>'trail_type',
              'surface', edge->>'surface',
              'difficulty', edge->>'difficulty',
              'length_km', (edge->>'trail_length_km')::float,
              'elevation_gain', (edge->>'trail_elevation_gain')::float,
              'elevation_loss', (edge->>'elevation_loss')::float,
              'max_elevation', (edge->>'max_elevation')::float,
              'min_elevation', (edge->>'min_elevation')::float,
              'avg_elevation', (edge->>'avg_elevation')::float
            )
          )
          FROM jsonb_array_elements(r.route_edges::jsonb) as edge
          WHERE edge->>'app_uuid' IS NOT NULL
        ) as constituent_trails,
        ST_AsGeoJSON(
          ST_Simplify(
            ST_LineMerge(
              ST_Collect(
                ARRAY(
                  SELECT e.geometry 
                  FROM ${this.stagingSchema}.routing_edges e 
                  WHERE e.id = ANY(
                    ARRAY(
                      SELECT (json_array_elements_text(r.route_edges::json)::json->>'id')::int
                    )
                  )
                )
              )
            ),
            0.0001  -- Simplify tolerance (approximately 10 meters)
          )
        ) as geojson
      FROM ${this.stagingSchema}.route_recommendations r
      WHERE r.route_edges IS NOT NULL AND r.route_edges != ''
      ORDER BY route_score DESC
    `);
    
    return recommendationsResult.rows;
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
} 