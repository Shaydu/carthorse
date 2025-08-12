import { Pool } from 'pg';
import * as fs from 'fs';
import { getExportConfig } from '../config-loader';

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
  private exportConfig: any;

  constructor(pgClient: Pool, config: GeoJSONExportConfig, stagingSchema: string) {
    this.pgClient = pgClient;
    this.config = config;
    this.stagingSchema = stagingSchema;
    this.exportConfig = getExportConfig();
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
    const layers = this.exportConfig.geojson?.layers || {
      trails: true,
      edges: true,
      edgeNetworkVertices: true,
      trailVertices: false,
      routes: true
    };
    
    // Export trails
    if (layers.trails && this.config.includeTrails !== false) {
      const trailFeatures = await this.exportTrails();
      features.push(...trailFeatures);
      this.log(`✅ Exported ${trailFeatures.length} trails`);
    }
    
    // Export edge network vertices (pgRouting nodes)
    if (layers.edgeNetworkVertices && this.config.includeNodes) {
      const nodeFeatures = await this.exportNodes();
      features.push(...nodeFeatures);
      this.log(`✅ Exported ${nodeFeatures.length} edge network vertices`);
    }
    
    // Export trail vertices (original trail endpoints)
    if (layers.trailVertices && this.config.includeNodes) {
      const trailVertexFeatures = await this.exportTrailVertices();
      features.push(...trailVertexFeatures);
      this.log(`✅ Exported ${trailVertexFeatures.length} trail vertices`);
    }
    
    // Export edges
    if (layers.edges && this.config.includeEdges) {
      const edgeFeatures = await this.exportEdges();
      features.push(...edgeFeatures);
      this.log(`✅ Exported ${edgeFeatures.length} edges`);
    }
    
    // Export recommendations/routes
    if (layers.routes && this.config.includeRecommendations) {
      const recommendationFeatures = await this.exportRecommendations();
      features.push(...recommendationFeatures);
      this.log(`✅ Exported ${recommendationFeatures.length} routes`);
    }
    
    // Write to file using streaming to handle large datasets
    console.log(`📝 Writing ${features.length} features to GeoJSON file...`);
    
    const writeStream = fs.createWriteStream(this.config.outputPath);
    
    // Write GeoJSON header
    writeStream.write('{\n');
    writeStream.write('  "type": "FeatureCollection",\n');
    writeStream.write('  "features": [\n');
    
    // Write features one by one
    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      const isLast = i === features.length - 1;
      
      // Write feature with proper formatting
      const featureJson = JSON.stringify(feature, null, 2)
        .split('\n')
        .map((line, index) => index === 0 ? `    ${line}` : `    ${line}`)
        .join('\n');
      
      writeStream.write(featureJson);
      
      if (!isLast) {
        writeStream.write(',\n');
      }
      
      // Progress indicator for large datasets
      if (features.length > 1000 && i % 1000 === 0) {
        console.log(`   - Progress: ${i}/${features.length} features written`);
      }
    }
    
    // Write GeoJSON footer
    writeStream.write('\n  ]\n');
    writeStream.write('}\n');
    
    // Close the stream
    writeStream.end();
    
    // Wait for the stream to finish
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', () => resolve());
      writeStream.on('error', reject);
    });
    
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
    
    const trailStyling = this.exportConfig.geojson?.styling?.trails || {
      color: "#228B22",
      stroke: "#228B22",
      strokeWidth: 2,
      fillOpacity: 0.6
    };
    
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
        updated_at: trail.updated_at,
        type: 'trail',
        color: trailStyling.color,
        stroke: trailStyling.stroke,
        strokeWidth: trailStyling.strokeWidth,
        fillOpacity: trailStyling.fillOpacity
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
          v.id,
          v.cnt,
          ST_Y(v.the_geom) as lat,
          ST_X(v.the_geom) as lng,
          ST_AsGeoJSON(v.the_geom, 6, 1) as geojson,
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
        ORDER BY v.id
      `);
      
      const endpointStyling = this.exportConfig.geojson?.styling?.edgeNetworkVertices || {
        color: "#FF0000",
        stroke: "#FF0000",
        strokeWidth: 2,
        fillOpacity: 0.8,
        radius: 5
      };
      
      return nodesResult.rows.map((node: any) => ({
        type: 'Feature',
        properties: {
          id: parseInt(node.id),           // Convert to integer (pgRouting domain)
          node_uuid: parseInt(node.id),    // Convert to integer (pgRouting domain)
          lat: parseFloat(node.lat),
          lng: parseFloat(node.lng),
          elevation: 0,
          node_type: ((): string => {
            const c = Number(node.cnt || 0);
            if (c >= 3) return 'intersection';
            if (c === 2) return 'connector';
            if (c === 1) return 'endpoint';
            return 'unknown';
          })(),
          degree: parseInt(node.degree),   // Add degree count to properties
          type: 'endpoint',
          color: endpointStyling.color,
          stroke: endpointStyling.stroke,
          strokeWidth: endpointStyling.strokeWidth,
          fillOpacity: endpointStyling.fillOpacity,
          radius: endpointStyling.radius
        },
        geometry: JSON.parse(node.geojson)
      }));
    } catch (error) {
      this.log(`⚠️  ways_noded_vertices_pgr table not found, skipping nodes export`);
      return [];
    }
  }

  /**
   * Export original trail vertices from staging schema
   */
  private async exportTrailVertices(): Promise<GeoJSONFeature[]> {
    try {
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
      
      const trailVertexStyling = this.exportConfig.geojson?.styling?.trailVertices || {
        color: "#FFD700",
        stroke: "#FFD700",
        strokeWidth: 1,
        fillOpacity: 0.6,
        radius: 3
      };
      
      return verticesResult.rows.map((vertex: any) => ({
        type: 'Feature',
        properties: {
          id: parseInt(vertex.id),
          node_uuid: vertex.node_uuid,
          lat: parseFloat(vertex.lat),
          lng: parseFloat(vertex.lng),
          elevation: 0,
          node_type: vertex.node_type,
          connected_trails: vertex.connected_trails,
          degree: parseInt(vertex.degree),
          type: 'trail_vertex',
          color: trailVertexStyling.color,
          stroke: trailVertexStyling.stroke,
          strokeWidth: trailVertexStyling.strokeWidth,
          fillOpacity: trailVertexStyling.fillOpacity,
          radius: trailVertexStyling.radius
        },
        geometry: JSON.parse(vertex.geojson)
      }));
    } catch (error) {
      this.log(`⚠️  trails table not found, skipping trail vertices export`);
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
          id,
          source,
          target,
          app_uuid as trail_id,
          name as trail_name,
          COALESCE(length_km, ST_Length(the_geom::geography) / 1000.0) AS length_km,
          COALESCE(elevation_gain, 0) AS elevation_gain,
          COALESCE(elevation_loss, 0) AS elevation_loss,
          ST_AsGeoJSON(the_geom, 6, 0) as geojson
        FROM ${this.stagingSchema}.ways_noded
        WHERE source IS NOT NULL AND target IS NOT NULL
        ORDER BY id
      `);
      
      const edgeStyling = this.exportConfig.geojson?.styling?.edges || {
        color: "#4169E1",
        stroke: "#4169E1",
        strokeWidth: 1,
        fillOpacity: 0.4
      };
      
      return edgesResult.rows.map((edge: any) => ({
        type: 'Feature',
        properties: {
          id: parseInt(edge.id),           // Convert to integer (pgRouting domain)
          source: parseInt(edge.source),   // Convert to integer (pgRouting domain)
          target: parseInt(edge.target),   // Convert to integer (pgRouting domain)
          trail_id: edge.trail_id,
          trail_name: edge.trail_name,
          length_km: parseFloat(edge.length_km),
          elevation_gain: parseFloat(edge.elevation_gain),
          elevation_loss: parseFloat(edge.elevation_loss),
          type: 'edge',
          color: edgeStyling.color,
          stroke: edgeStyling.stroke,
          strokeWidth: edgeStyling.strokeWidth,
          fillOpacity: edgeStyling.fillOpacity
        },
        geometry: JSON.parse(edge.geojson)
      }));
    } catch (error) {
      this.log(`⚠️  ways_noded table not found, skipping edges export`);
      return [];
    }
  }

  /**
   * Export recommendations from staging schema
   */
  private async exportRecommendations(): Promise<GeoJSONFeature[]> {
    try {
      console.log(`[GeoJSON Export] 🔍 Checking for route_recommendations in schema: ${this.stagingSchema}`);
      
      // First check if the table exists
      const tableExists = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = $1 AND table_name = 'route_recommendations'
        );
      `, [this.stagingSchema]);
      
      console.log(`[GeoJSON Export] Table exists check result:`, tableExists.rows[0]);
      
      // Limit recommendations to prevent memory issues with large datasets
      const maxRecommendations = 5000; // Limit to prevent JSON.stringify overflow
      
      const recommendationsResult = await this.pgClient.query(`
        SELECT 
          route_uuid, region, input_length_km, input_elevation_gain,
          recommended_length_km, recommended_elevation_gain,
          route_score, route_type, route_name, route_shape, trail_count,
          route_path, route_edges, created_at
        FROM ${this.stagingSchema}.route_recommendations
        ORDER BY created_at DESC
        LIMIT $1
      `, [maxRecommendations]);
      
      console.log(`[GeoJSON Export] Found ${recommendationsResult.rows.length} route recommendations`);
      
      if (recommendationsResult.rows.length === maxRecommendations) {
        console.log(`[GeoJSON Export] ⚠️  Limited to ${maxRecommendations} recommendations to prevent memory issues`);
      }
      
      const routeStyling = this.exportConfig.geojson?.styling?.routes || {
        color: "#FF8C00",
        stroke: "#FF8C00",
        strokeWidth: 3,
        fillOpacity: 0.8
      };
      
      const features: GeoJSONFeature[] = [];
      
      for (const rec of recommendationsResult.rows) {
        // Extract coordinates from ways_noded table using edge IDs from route_path
        let coordinates: number[][] = [];
        
        try {
          if (rec.route_path) {
            // route_path is already a JavaScript object, not a JSON string
            const routePath = typeof rec.route_path === 'string' ? JSON.parse(rec.route_path) : rec.route_path;
            const edgeIds = this.extractEdgeIdsFromRoutePath(routePath);
            
            if (edgeIds.length > 0) {
              // Query ways_noded directly for the route geometry and combine using PostGIS
              // Use CASE statement to preserve the order of edges as they appear in the route
              const edgesResult = await this.pgClient.query(`
                SELECT ST_AsGeoJSON(
                  ST_LineMerge(
                    ST_Collect(
                      the_geom ORDER BY 
                      CASE id 
                        ${edgeIds.map((id, index) => `WHEN ${id} THEN ${index}`).join(' ')}
                        ELSE 999999
                      END
                    )
                  ), 6, 0
                ) as geojson 
                FROM ${this.stagingSchema}.ways_noded 
                WHERE id = ANY($1::integer[])
              `, [edgeIds]);
              
              // Extract coordinates from the combined geometry
              if (edgesResult.rows.length > 0 && edgesResult.rows[0].geojson) {
                const geom = JSON.parse(edgesResult.rows[0].geojson);
                if (geom.coordinates && Array.isArray(geom.coordinates)) {
                  coordinates = geom.coordinates;
                }
              }
            }
          }
        } catch (error) {
          this.log(`⚠️  Failed to extract coordinates for route ${rec.route_uuid}: ${error}`);
          // Skip this route - no fallback coordinates
          continue;
        }

        features.push({
          type: 'Feature',
          properties: {
            id: rec.route_uuid,
            route_uuid: rec.route_uuid,
            region: rec.region,
            input_length_km: rec.input_length_km,
            input_elevation_gain: rec.input_elevation_gain,
            recommended_length_km: rec.recommended_length_km,
            recommended_elevation_gain: rec.recommended_elevation_gain,
            route_score: rec.route_score,
            route_type: rec.route_type,
            route_name: rec.route_name,
            route_shape: rec.route_shape,
            trail_count: rec.trail_count,
            route_path: rec.route_path,
            route_edges: rec.route_edges,
            created_at: rec.created_at,
            type: 'route',
            color: routeStyling.color,
            stroke: routeStyling.stroke,
            strokeWidth: routeStyling.strokeWidth,
            fillOpacity: routeStyling.fillOpacity
          },
          geometry: {
            type: 'LineString',
            coordinates: coordinates
          }
        });
      }
      
      return features;
    } catch (error) {
      this.log(`⚠️  route_recommendations table not found, skipping recommendations export`);
      this.log(`⚠️  Error details: ${error}`);
      return [];
    }
  }

  /**
   * Extract edge IDs from route path JSON
   */
  private extractEdgeIdsFromRoutePath(routePath: any): number[] {
    try {
      if (routePath.steps && Array.isArray(routePath.steps)) {
        return routePath.steps
          .map((step: any) => step.edge)
          .filter((edge: number) => edge !== -1 && edge !== null && edge !== undefined);
      }
      return [];
    } catch (error) {
      this.log(`⚠️  Failed to extract edge IDs from route path: ${error}`);
      return [];
    }
  }
}