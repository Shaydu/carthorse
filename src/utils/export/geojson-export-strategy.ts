import { Pool } from 'pg';
import * as fs from 'fs';
import { getExportConfig } from '../config-loader';
import { ExportQueries } from '../../sql/queries/export-queries';

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
    // Load YAML config as the source of truth for layer visibility
    this.exportConfig = getExportConfig();
  }

  private log(message: string) {
    if (this.config.verbose) {
      console.log(`[GeoJSON Export] ${message}`);
    }
  }

  /**
   * Create export-ready tables in staging schema
   */
  async createExportTables(): Promise<boolean> {
    this.log('Creating export-ready tables in staging schema...');
    
    try {
      // Check if pgRouting tables exist
      const pgRoutingTablesExist = await this.checkPgRoutingTablesExist();
      
      if (pgRoutingTablesExist) {
        // Create export-ready nodes table
        await this.pgClient.query(ExportQueries.createExportReadyTables(this.stagingSchema));
        this.log('✅ Created export_nodes table');
        
        // Create export-ready edges table
        await this.pgClient.query(ExportQueries.createExportEdgesTable(this.stagingSchema));
        this.log('✅ Created export_edges table');
      } else {
        this.log('⚠️  pgRouting tables not found, skipping nodes and edges export');
      }
      
      // Create export-ready trail vertices table (doesn't depend on pgRouting)
      await this.pgClient.query(ExportQueries.createExportTrailVerticesTable(this.stagingSchema));
      this.log('✅ Created export_trail_vertices table');
      
      // Create export-ready routes table
      await this.pgClient.query(ExportQueries.createExportRoutesTable(this.stagingSchema));
      this.log('✅ Created export_routes table');
      
      return pgRoutingTablesExist;
      
    } catch (error) {
      this.log(`⚠️  Error creating export tables: ${error}`);
      throw error;
    }
  }

  /**
   * Check if pgRouting tables exist in the staging schema
   */
  private async checkPgRoutingTablesExist(): Promise<boolean> {
    try {
      this.log(`🔍 Checking for pgRouting tables in schema: ${this.stagingSchema}`);
      
      const result = await this.pgClient.query(`
        SELECT 
          (EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = $1 
            AND table_name = 'ways_noded_vertices_pgr'
          ) AND EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = $1 
            AND table_name = 'ways_noded'
          )) as both_exist
      `, [this.stagingSchema]);
      
      const exists = result.rows[0].both_exist;
      this.log(`🔍 pgRouting tables exist: ${exists}`);
      
      // Also check individually for debugging
      const verticesResult = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = $1 
          AND table_name = 'ways_noded_vertices_pgr'
        )
      `, [this.stagingSchema]);
      
      const edgesResult = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = $1 
          AND table_name = 'ways_noded'
        )
      `, [this.stagingSchema]);
      
      this.log(`🔍 ways_noded_vertices_pgr exists: ${verticesResult.rows[0].exists}`);
      this.log(`🔍 ways_noded exists: ${edgesResult.rows[0].exists}`);
      
      return exists;
    } catch (error) {
      this.log(`⚠️  Error checking pgRouting tables: ${error}`);
      return false;
    }
  }

  /**
   * Check what routing-related tables exist in the staging schema
   */
  private async checkAvailableTables(): Promise<{
    hasPgRoutingTables: boolean;
    hasRoutingNodes: boolean;
    hasRoutingEdges: boolean;
    availableTables: string[];
  }> {
    try {
      const result = await this.pgClient.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = $1 
        AND table_name IN (
          'ways_noded_vertices_pgr', 'ways_noded',
          'routing_nodes', 'routing_edges',
          'trails', 'route_recommendations'
        )
        ORDER BY table_name
      `, [this.stagingSchema]);
      
      const availableTables = result.rows.map(row => row.table_name);
      const hasPgRoutingTables = availableTables.includes('ways_noded_vertices_pgr') && availableTables.includes('ways_noded');
      const hasRoutingNodes = availableTables.includes('routing_nodes');
      const hasRoutingEdges = availableTables.includes('routing_edges');
      
      this.log(`📊 Available tables in ${this.stagingSchema}: ${availableTables.join(', ')}`);
      
      return {
        hasPgRoutingTables,
        hasRoutingNodes,
        hasRoutingEdges,
        availableTables
      };
    } catch (error) {
      this.log(`⚠️  Error checking available tables: ${error}`);
      return {
        hasPgRoutingTables: false,
        hasRoutingNodes: false,
        hasRoutingEdges: false,
        availableTables: []
      };
    }
  }

  /**
   * Export all data from staging schema to GeoJSON
   */
  async exportFromStaging(): Promise<void> {
    console.log('📤 Exporting from staging schema to GeoJSON...');
    
    // First, create the export-ready tables
    const pgRoutingTablesExist = await this.createExportTables();
    
    const features: GeoJSONFeature[] = [];
    
    const layers = this.exportConfig.geojson?.layers || {};
    
    // Export trails - respect YAML config
    if (layers.trails && this.config.includeTrails !== false) {
      const trailFeatures = await this.exportTrails();
      features.push(...trailFeatures);
      this.log(`✅ Exported ${trailFeatures.length} trails`);
    }
    
    // Export edge network vertices (pgRouting nodes) - only if pgRouting tables exist
    if (pgRoutingTablesExist && layers.edgeNetworkVertices && this.config.includeNodes) {
      const nodeFeatures = await this.exportNodes();
      features.push(...nodeFeatures);
      this.log(`✅ Exported ${nodeFeatures.length} edge network vertices`);
    }
    
    // Export trail vertices (original trail endpoints) - respect YAML config
    if (layers.trailVertices && this.config.includeNodes) {
      const trailVertexFeatures = await this.exportTrailVertices();
      features.push(...trailVertexFeatures);
      this.log(`✅ Exported ${trailVertexFeatures.length} trail vertices`);
    }
    
    // Export edges - only if pgRouting tables exist
    if (pgRoutingTablesExist && layers.edges && this.config.includeEdges) {
      const edgeFeatures = await this.exportEdges();
      features.push(...edgeFeatures);
      this.log(`✅ Exported ${edgeFeatures.length} edges`);
    }
    
    // Export recommendations/routes - respect YAML config
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
   * Export nodes from export-ready table
   */
  private async exportNodes(): Promise<GeoJSONFeature[]> {
    try {
      const nodesResult = await this.pgClient.query(ExportQueries.getExportNodes(this.stagingSchema));
      
      return nodesResult.rows.map((node: any) => ({
        type: 'Feature',
        geometry: JSON.parse(node.geojson),
        properties: {
          id: node.id,
          node_uuid: node.node_uuid,
          lat: node.lat,
          lng: node.lng,
          elevation: node.elevation,
          node_type: node.node_type,
          degree: node.degree
        }
      }));
    } catch (error) {
      this.log(`⚠️  Error exporting nodes: ${error}`);
      return [];
    }
  }

  /**
   * Export trail vertices from export-ready table
   */
  private async exportTrailVertices(): Promise<GeoJSONFeature[]> {
    try {
      const verticesResult = await this.pgClient.query(ExportQueries.getExportTrailVertices(this.stagingSchema));
      
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
      this.log(`⚠️  export_trail_vertices table not found, skipping trail vertices export`);
      return [];
    }
  }

  /**
   * Export edges from export-ready table
   */
  private async exportEdges(): Promise<GeoJSONFeature[]> {
    try {
      const edgesResult = await this.pgClient.query(ExportQueries.getExportEdges(this.stagingSchema));
      
      return edgesResult.rows.map((edge: any) => ({
        type: 'Feature',
        geometry: JSON.parse(edge.geojson),
        properties: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          trail_id: edge.trail_id,
          trail_name: edge.trail_name,
          length_km: edge.length_km,
          elevation_gain: edge.elevation_gain,
          elevation_loss: edge.elevation_loss
        }
      }));
    } catch (error) {
      this.log(`⚠️  Error exporting edges: ${error}`);
      return [];
    }
  }

  /**
   * Export recommendations from export-ready table
   */
  private async exportRecommendations(): Promise<GeoJSONFeature[]> {
    try {
      const routesResult = await this.pgClient.query(ExportQueries.getExportRoutes(this.stagingSchema));
      
      const routeStyling = this.exportConfig.geojson?.styling?.routes || {
        color: "#FF8C00",
        stroke: "#FF8C00",
        strokeWidth: 3,
        fillOpacity: 0.8
      };
      
      const validRoutes = await Promise.all(routesResult.rows.map(async (route: any) => {
        let coordinates: number[][] = [];
        
        // Use pre-computed route geometry if available
        if (route.route_geometry) {
          try {
            // Convert PostGIS geometry to GeoJSON coordinates
            const geometryResult = await this.pgClient.query(`
              SELECT ST_AsGeoJSON($1::geometry, 6, 0) as geojson
            `, [route.route_geometry]);
            
            if (geometryResult.rows[0]?.geojson) {
              const geojson = JSON.parse(geometryResult.rows[0].geojson);
              coordinates = geojson.coordinates || [];
            }
          } catch (error) {
            this.log(`⚠️ Failed to convert route geometry for route ${route.route_uuid}: ${error}`);
          }
        }

        return {
          type: 'Feature' as const,
          properties: {
            id: route.route_uuid,
            route_uuid: route.route_uuid,
            region: route.region,
            input_length_km: route.input_length_km,
            input_elevation_gain: route.input_elevation_gain,
            recommended_length_km: route.recommended_length_km,
            recommended_elevation_gain: route.recommended_elevation_gain,
            route_score: route.route_score,
            route_type: route.route_type,
            route_name: route.route_name,
            route_shape: route.route_shape,
            trail_count: route.trail_count,
            route_path: route.route_path,
            route_edges: route.route_edges,
            created_at: route.created_at,
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
        };
      })).then(features => features.filter((feature) => {
        // Filter out features with empty geometries to ensure valid GeoJSON
        const coords = feature.geometry.coordinates;
        return coords && Array.isArray(coords) && coords.length > 0;
      }));

      this.log(`✅ Exported ${validRoutes.length} routes (filtered out ${routesResult.rows.length - validRoutes.length} routes with empty geometries)`);
      return validRoutes;
    } catch (error) {
      this.log(`⚠️  export_routes table not found, skipping recommendations export`);
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