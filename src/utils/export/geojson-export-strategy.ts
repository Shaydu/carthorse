import { Pool } from 'pg';
import * as fs from 'fs';

export interface GeoJSONExportConfig {
  region: string;
  outputPath: string;
  includeNodes?: boolean;
  includeEdges?: boolean;
  includeTrails?: boolean;
  includeRecommendations?: boolean;
  verbose?: boolean;
}

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: number[][];
  };
  properties: Record<string, any>;
}

export interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

export class GeoJSONExportStrategy {
  private pgClient: Pool;
  private config: GeoJSONExportConfig;
  private stagingSchema: string;

  constructor(pgClient: Pool, config: GeoJSONExportConfig, stagingSchema: string) {
    this.pgClient = pgClient;
    this.config = config;
    this.stagingSchema = stagingSchema;
  }

  private log(message: string) {
    if (this.config.verbose) {
      console.log(`[GeoJSON Export] ${message}`);
    }
  }

  /**
   * Export all data from staging schema to GeoJSON
   */
  async exportFromStaging(): Promise<void> {
    console.log('📤 Exporting from staging schema to GeoJSON...');
    
    const features: GeoJSONFeature[] = [];
    
    // Export trails
    if (this.config.includeTrails !== false) {
      const trailFeatures = await this.exportTrails();
      features.push(...trailFeatures);
      this.log(`✅ Exported ${trailFeatures.length} trails`);
    }
    
    // Export nodes
    if (this.config.includeNodes) {
      const nodeFeatures = await this.exportNodes();
      features.push(...nodeFeatures);
      this.log(`✅ Exported ${nodeFeatures.length} nodes`);
    }
    
    // Export edges
    if (this.config.includeEdges) {
      const edgeFeatures = await this.exportEdges();
      features.push(...edgeFeatures);
      this.log(`✅ Exported ${edgeFeatures.length} edges`);
    }
    
    // Export recommendations
    if (this.config.includeRecommendations) {
      const recommendationFeatures = await this.exportRecommendations();
      features.push(...recommendationFeatures);
      this.log(`✅ Exported ${recommendationFeatures.length} recommendations`);
    }
    
    // Create GeoJSON collection
    const geojson: GeoJSONCollection = {
      type: 'FeatureCollection',
      features: features
    };
    
    // Write to file
    fs.writeFileSync(this.config.outputPath, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ GeoJSON export completed: ${this.config.outputPath}`);
    console.log(`   - Total features: ${features.length}`);
  }

  /**
   * Export trails from staging schema
   */
  private async exportTrails(): Promise<GeoJSONFeature[]> {
    const trailsResult = await this.pgClient.query(`
      SELECT 
        app_uuid, name, region, osm_id, trail_type, surface as surface_type, 
        CASE 
          WHEN difficulty = 'unknown' THEN 'moderate'
          ELSE difficulty
        END as difficulty,
        ST_AsGeoJSON(geometry, 6, 0) as geojson,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        created_at, updated_at
      FROM ${this.stagingSchema}.trails
      WHERE region = $1
      ORDER BY name
    `, [this.config.region]);
    
    if (trailsResult.rows.length === 0) {
      throw new Error('No trails found to export');
    }
    
    return trailsResult.rows.map((trail: any) => ({
      type: 'Feature',
      properties: {
        id: trail.app_uuid,
        name: trail.name,
        region: trail.region,
        osm_id: trail.osm_id,
        trail_type: trail.trail_type,
        surface_type: trail.surface_type,
        difficulty: trail.difficulty,
        length_km: trail.length_km,
        elevation_gain: trail.elevation_gain,
        elevation_loss: trail.elevation_loss,
        max_elevation: trail.max_elevation,
        min_elevation: trail.min_elevation,
        avg_elevation: trail.avg_elevation,
        bbox_min_lng: trail.bbox_min_lng,
        bbox_max_lng: trail.bbox_max_lng,
        bbox_min_lat: trail.bbox_min_lat,
        bbox_max_lat: trail.bbox_max_lat,
        created_at: trail.created_at,
        updated_at: trail.updated_at
      },
      geometry: JSON.parse(trail.geojson)
    }));
  }

  /**
   * Export nodes from staging schema
   */
  private async exportNodes(): Promise<GeoJSONFeature[]> {
    try {
      const nodesResult = await this.pgClient.query(`
        SELECT 
          id, 
          id as node_uuid, 
          ST_Y(the_geom) as lat, 
          ST_X(the_geom) as lng, 
          0 as elevation, 
          node_type, 
          '' as connected_trails,
          ST_AsGeoJSON(the_geom, 6, 1) as geojson
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr
        ORDER BY id
      `);
      
      return nodesResult.rows.map((node: any) => ({
        type: 'Feature',
        properties: {
          id: node.id,
          node_uuid: node.node_uuid,
          lat: node.lat,
          lng: node.lng,
          elevation: node.elevation,
          node_type: node.node_type,
          connected_trails: node.connected_trails
        },
        geometry: JSON.parse(node.geojson)
      }));
    } catch (error) {
      this.log(`⚠️  ways_noded_vertices_pgr table not found, skipping nodes export`);
      return [];
    }
  }

  /**
   * Export edges from staging schema
   */
  private async exportEdges(): Promise<GeoJSONFeature[]> {
    try {
      const edgesResult = await this.pgClient.query(`
        SELECT 
          id, source, target, trail_id, trail_name,
          length_km, elevation_gain, elevation_loss,
          ST_AsGeoJSON(geometry, 6, 1) as geojson,
          created_at
        FROM ${this.stagingSchema}.routing_edges
        ORDER BY id
      `);
      
      return edgesResult.rows.map((edge: any) => ({
        type: 'Feature',
        properties: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          trail_id: edge.trail_id,
          trail_name: edge.trail_name,
          length_km: edge.length_km,
          elevation_gain: edge.elevation_gain,
          elevation_loss: edge.elevation_loss,
          created_at: edge.created_at
        },
        geometry: JSON.parse(edge.geojson)
      }));
    } catch (error) {
      this.log(`⚠️  routing_edges table not found, skipping edges export`);
      return [];
    }
  }

  /**
   * Export recommendations from staging schema
   */
  private async exportRecommendations(): Promise<GeoJSONFeature[]> {
    try {
      const recommendationsResult = await this.pgClient.query(`
        SELECT 
          route_uuid, region, input_length_km, input_elevation_gain,
          recommended_length_km, recommended_elevation_gain, recommended_elevation_loss,
          route_score, route_type, route_name, route_shape, trail_count,
          route_path, route_edges, request_hash, expires_at, created_at
        FROM ${this.stagingSchema}.route_recommendations
        ORDER BY created_at DESC
      `);
      
      return recommendationsResult.rows.map((rec: any) => ({
        type: 'Feature',
        properties: {
          route_uuid: rec.route_uuid,
          region: rec.region,
          input_length_km: rec.input_length_km,
          input_elevation_gain: rec.input_elevation_gain,
          recommended_length_km: rec.recommended_length_km,
          recommended_elevation_gain: rec.recommended_elevation_gain,
          recommended_elevation_loss: rec.recommended_elevation_loss,
          route_score: rec.route_score,
          route_type: rec.route_type,
          route_name: rec.route_name,
          route_shape: rec.route_shape,
          trail_count: rec.trail_count,
          route_path: rec.route_path,
          route_edges: rec.route_edges,
          request_hash: rec.request_hash,
          expires_at: rec.expires_at,
          created_at: rec.created_at
        },
        geometry: {
          type: 'LineString',
          coordinates: [] // Recommendations don't have geometry
        }
      }));
    } catch (error) {
      this.log(`⚠️  route_recommendations table not found, skipping recommendations export`);
      return [];
    }
  }
} 