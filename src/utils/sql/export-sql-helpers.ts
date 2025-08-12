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
        v.id, 
        v.id as node_uuid, 
        ST_Y(v.the_geom) as lat, 
        ST_X(v.the_geom) as lng, 
        0 as elevation, 
        v.node_type, 
        '' as connected_trails, 
        ARRAY[]::text[] as trail_ids, 
        ST_AsGeoJSON(v.the_geom) as geojson,
        COALESCE(degree_counts.degree, 0) as degree
      FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
      LEFT JOIN (
        SELECT 
          vertex_id,
          COUNT(*) as degree
        FROM (
          SELECT source as vertex_id FROM ${this.stagingSchema}.ways_noded WHERE source IS NOT NULL
          UNION ALL
          SELECT target as vertex_id FROM ${this.stagingSchema}.ways_noded WHERE target IS NOT NULL
        ) all_vertices
        GROUP BY vertex_id
      ) degree_counts ON v.id = degree_counts.vertex_id
      WHERE v.the_geom IS NOT NULL
      ORDER BY v.id
    `);
    
    // Convert string IDs to integers for nodes too
    const convertedNodes = nodesResult.rows.map(row => ({
      ...row,
      id: parseInt(row.id),
      node_uuid: parseInt(row.node_uuid),
      degree: parseInt(row.degree)
    }));
    
    console.log(`[Export Debug] Converting ${nodesResult.rows.length} nodes, first node ID: ${nodesResult.rows[0]?.id} -> ${convertedNodes[0]?.id}`);
    return convertedNodes;
  }

  /**
   * Export original trail vertices for GeoJSON
   */
  async exportTrailVerticesForGeoJSON(): Promise<any[]> {
    const verticesResult = await this.pgClient.query(`
      WITH trail_vertices AS (
        SELECT 
          t.id as trail_id,
          t.app_uuid as trail_uuid,
          t.name as trail_name,
          ST_StartPoint(t.geometry) as start_pt,
          ST_EndPoint(t.geometry) as end_pt,
          ST_AsText(ST_StartPoint(t.geometry)) as start_coords,
          ST_AsText(ST_EndPoint(t.geometry)) as end_coords
        FROM ${this.stagingSchema}.trails t
        WHERE t.geometry IS NOT NULL
      ),
      all_vertices AS (
        SELECT 
          trail_id,
          trail_uuid,
          trail_name,
          'start' as vertex_type,
          start_pt as the_geom,
          start_coords as coords
        FROM trail_vertices
        UNION ALL
        SELECT 
          trail_id,
          trail_uuid,
          trail_name,
          'end' as vertex_type,
          end_pt as the_geom,
          end_coords as coords
        FROM trail_vertices
      )
      SELECT 
        ROW_NUMBER() OVER (ORDER BY trail_id, vertex_type) as id,
        trail_uuid as node_uuid,
        ST_Y(the_geom) as lat,
        ST_X(the_geom) as lng,
        0 as elevation,
        vertex_type as node_type,
        trail_name as connected_trails,
        ARRAY[trail_uuid] as trail_ids,
        ST_AsGeoJSON(the_geom) as geojson,
        0 as degree  -- Original trail vertices don't have network degree
      FROM all_vertices
      WHERE the_geom IS NOT NULL
      ORDER BY trail_id, vertex_type
    `);
    
    // Convert string IDs to integers for vertices
    const convertedVertices = verticesResult.rows.map(row => ({
      ...row,
      id: parseInt(row.id),
      degree: parseInt(row.degree)
    }));
    
    console.log(`[Export Debug] Converting ${verticesResult.rows.length} trail vertices, first vertex ID: ${verticesResult.rows[0]?.id} -> ${convertedVertices[0]?.id}`);
    return convertedVertices;
  }

  /**
   * Export routing edges for GeoJSON (reads directly from ways_noded - single source of truth)
   */
  async exportRoutingEdgesForGeoJSON(): Promise<any[]> {
    const edgesResult = await this.pgClient.query(`
      SELECT 
        id,
        source,
        target,
        app_uuid as trail_id,
        name as trail_name,
        length_km,
        elevation_gain,
        elevation_loss,
        true as is_bidirectional,
        ST_AsGeoJSON(the_geom) as geojson
      FROM ${this.stagingSchema}.ways_noded
      WHERE source IS NOT NULL AND target IS NOT NULL
      ORDER BY id
    `);
    
    // Convert string IDs to integers (pgRouting domain uses integers)
    const convertedRows = edgesResult.rows.map(row => ({
      ...row,
      id: parseInt(row.id),
      source: parseInt(row.source),
      target: parseInt(row.target),
      length_km: parseFloat(row.length_km),
      elevation_gain: parseFloat(row.elevation_gain),
      elevation_loss: parseFloat(row.elevation_loss)
    }));
    
    console.log(`[Export Debug] Converting ${edgesResult.rows.length} edges, first edge ID: ${edgesResult.rows[0]?.id} -> ${convertedRows[0]?.id}`);
    return convertedRows;
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