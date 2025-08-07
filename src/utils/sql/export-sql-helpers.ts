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
   * Create optimized indices for export queries
   */
  async createExportIndices(): Promise<void> {
    console.log(`🔧 Creating optimized indices for export queries in ${this.stagingSchema}...`);
    
    try {
      // Indices for trails table
      await this.pgClient.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${this.stagingSchema}_trails_geometry_export 
        ON ${this.stagingSchema}.trails USING GIST(geometry) 
        WHERE geometry IS NOT NULL
      `);
      
      await this.pgClient.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${this.stagingSchema}_trails_name_export 
        ON ${this.stagingSchema}.trails(name) 
        WHERE geometry IS NOT NULL
      `);

      // Indices for routing nodes table
      await this.pgClient.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${this.stagingSchema}_routing_nodes_geometry_export 
        ON ${this.stagingSchema}.ways_noded_vertices_pgr USING GIST(the_geom) 
        WHERE the_geom IS NOT NULL
      `);
      
      await this.pgClient.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${this.stagingSchema}_routing_nodes_id_export 
        ON ${this.stagingSchema}.ways_noded_vertices_pgr(id)
      `);

      // Indices for routing edges table
      await this.pgClient.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${this.stagingSchema}_routing_edges_geometry_export 
        ON ${this.stagingSchema}.routing_edges USING GIST(geometry) 
        WHERE geometry IS NOT NULL
      `);
      
      await this.pgClient.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${this.stagingSchema}_routing_edges_id_export 
        ON ${this.stagingSchema}.routing_edges(id)
      `);

      // Indices for route recommendations table
      await this.pgClient.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${this.stagingSchema}_route_recommendations_edges_export 
        ON ${this.stagingSchema}.route_recommendations(route_edges) 
        WHERE route_edges IS NOT NULL AND route_edges != 'null'
      `);
      
      await this.pgClient.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${this.stagingSchema}_route_recommendations_score_export 
        ON ${this.stagingSchema}.route_recommendations(route_score DESC) 
        WHERE route_edges IS NOT NULL AND route_edges != 'null'
      `);

      console.log('✅ Created optimized indices for export queries');
    } catch (error) {
      console.error('❌ Failed to create export indices:', error);
      throw error;
    }
  }

  /**
   * Export trail data for GeoJSON
   */
  async exportTrailsForGeoJSON(): Promise<any[]> {
    // Ensure indices are created for optimal performance
    await this.createExportIndices();
    
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
    // Ensure indices are created for optimal performance
    await this.createExportIndices();
    
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
    // Ensure indices are created for optimal performance
    await this.createExportIndices();
    
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
    // Ensure indices are created for optimal performance
    await this.createExportIndices();
    
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
    // Ensure indices are created for optimal performance
    await this.createExportIndices();
    
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
    // Ensure indices are created for optimal performance
    await this.createExportIndices();
    
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