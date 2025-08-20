import { Pool } from 'pg';
import * as fs from 'fs';
import { getExportConfig } from '../config-loader';
import { ExportQueries } from '../../sql/queries/export-queries';

// GeoJSON validation interface
interface GeoJSONValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface GeoJSONExportConfig {
  region: string;
  outputPath: string;
  includeNodes?: boolean;
  includeEdges?: boolean;
  includeTrails?: boolean;
  includeRecommendations?: boolean;
  includeCompositionData?: boolean;
  verbose?: boolean;
  networkAnalysisPath?: string;
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
   * Check if pgRouting tables exist in the staging schema (no export-ready tables needed)
   */
  async createExportTables(): Promise<boolean> {
    this.log('Checking for pgRouting tables in staging schema...');
    
    try {
      // Check if pgRouting tables exist
      const pgRoutingTablesExist = await this.checkPgRoutingTablesExist();
      
      if (pgRoutingTablesExist) {
        this.log('✅ pgRouting tables found - will read directly from source tables');
      } else {
        this.log('⚠️  pgRouting tables not found, skipping nodes and edges export');
      }
      
      return pgRoutingTablesExist;
      
    } catch (error) {
      this.log(`⚠️  Error checking pgRouting tables: ${error}`);
      throw error;
    }
  }

  /**
   * Check if pgRouting tables exist in the staging schema
   */
  private async checkPgRoutingTablesExist(): Promise<boolean> {
    try {
      this.log(`🔍 Checking for pgRouting tables in schema: ${this.stagingSchema}`);
      
      // First check if ways_split tables exist (these are what we're using for consistency)
      const waysSplitResult = await this.pgClient.query(`
        SELECT 
          (EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = $1 
            AND table_name = 'ways_split_vertices_pgr'
          ) AND EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = $1 
            AND table_name = 'ways_split'
          )) as ways_split_exists
      `, [this.stagingSchema]);
      
      const waysSplitExists = waysSplitResult.rows[0].ways_split_exists;
      
      if (waysSplitExists) {
        this.log(`🔍 ways_split tables exist - using these for consistency`);
        return true;
      }
      
      // Fall back to checking unified network tables exist (they have trail_uuid column)
      const unifiedNetworkResult = await this.pgClient.query(`
        SELECT 
          (EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = $1 
            AND table_name = 'ways_noded_vertices_pgr'
          ) AND EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = $1 
            AND table_name = 'ways_noded'
          ) AND EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = $1 
            AND table_name = 'ways_noded' 
            AND column_name = 'trail_uuid'
          )) as unified_network_exists
      `, [this.stagingSchema]);
      
      const unifiedNetworkExists = unifiedNetworkResult.rows[0].unified_network_exists;
      
      if (unifiedNetworkExists) {
        this.log(`🔍 Unified network tables exist with trail_uuid column`);
        return true;
      }
      
      // Debug: Check what columns actually exist in ways_noded
      const columnsResult = await this.pgClient.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = $1 
        AND table_name = 'ways_noded'
        ORDER BY column_name
      `, [this.stagingSchema]);
      
      const columns = columnsResult.rows.map(row => row.column_name);
      this.log(`🔍 Available columns in ways_noded: ${columns.join(', ')}`);
      
      // Fall back to checking standard pgRouting tables
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
      this.log(`🔍 Standard pgRouting tables exist: ${exists}`);
      
      // Also check individually for debugging
      const verticesResult = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = $1 
          AND table_name = 'ways_split_vertices_pgr'
        )
      `, [this.stagingSchema]);
      
      const edgesResult = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = $1 
          AND table_name = 'ways_split'
        )
      `, [this.stagingSchema]);
      
      this.log(`🔍 ways_split_vertices_pgr exists: ${verticesResult.rows[0].exists}`);
      this.log(`🔍 ways_split exists: ${edgesResult.rows[0].exists}`);
      
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
   * Export all data from staging schema to layer-specific GeoJSON files
   */
  async exportFromStaging(): Promise<void> {
    console.log('📤 Exporting from staging schema to layer-specific GeoJSON files...');
    
    // Note: We no longer create export-ready tables, we export directly from source tables
    
    const layers = this.exportConfig.geojson?.layers || {};
    const combinedLayerExport = this.exportConfig.geojson?.combinedLayerExport !== false; // Default to true
    
    // Get base filename without extension
    const basePath = this.config.outputPath.replace(/\.(geojson|json)$/i, '');
    
    // Track exported files for summary
    const exportedFiles: Array<{layer: string, path: string, featureCount: number}> = [];
    
    // Export Layer 1: Trails (if enabled)
    if (layers.trails) {
      const trailFeatures = await this.exportTrails();
      const trailFilePath = `${basePath}-layer1-trails.geojson`;
      await this.writeLayerToFile(trailFeatures, trailFilePath, 'trails');
      exportedFiles.push({layer: 'Layer 1: Trails', path: trailFilePath, featureCount: trailFeatures.length});
    } else {
      this.log('⏭️ Skipping trails export (Layer 1 disabled in config)');
    }
    
    // Export Layer 1: Trail vertices (if enabled)
    if (layers.trailVertices) {
      const trailVertexFeatures = await this.exportTrailVertices();
      const trailVerticesFilePath = `${basePath}-layer1-trail-vertices.geojson`;
      await this.writeLayerToFile(trailVertexFeatures, trailVerticesFilePath, 'trail vertices');
      exportedFiles.push({layer: 'Layer 1: Trail Vertices', path: trailVerticesFilePath, featureCount: trailVertexFeatures.length});
    } else {
      this.log('⏭️ Skipping trail vertices export (Layer 1 disabled in config)');
    }
    
    // Export Layer 2: Combined nodes and edges (if enabled and enhanced tables exist)
    if (layers.edgeNetworkVertices || layers.edges) {
      // Check if the enhanced tables that pgRouting actually uses exist
      const pgRoutingTablesExist = await this.checkPgRoutingTablesExist();
      
      if (pgRoutingTablesExist) {
        const layer2Features: GeoJSONFeature[] = [];
        
        // Add nodes if enabled
        if (layers.edgeNetworkVertices) {
          const nodeFeatures = await this.exportNodes();
          layer2Features.push(...nodeFeatures);
          this.log(`📊 Added ${nodeFeatures.length} nodes to Layer 2 combined file`);
        }
        
        // Add edges if enabled
        if (layers.edges) {
          const edgeFeatures = await this.exportEdges();
          layer2Features.push(...edgeFeatures);
          this.log(`📊 Added ${edgeFeatures.length} edges to Layer 2 combined file`);
        }
        
        // Write combined Layer 2 file
        const layer2FilePath = `${basePath}-layer2-network.geojson`;
        await this.writeLayerToFile(layer2Features, layer2FilePath, 'Layer 2 network');
        exportedFiles.push({layer: 'Layer 2: Network (Nodes + Edges)', path: layer2FilePath, featureCount: layer2Features.length});
      } else {
        this.log('⏭️ Skipping Layer 2 export - enhanced pgRouting tables not found (waiting for Layer 3 to complete)');
      }
    } else {
      this.log('⏭️ Skipping Layer 2 export (Layer 2 disabled in config)');
    }
    
    // Export Layer 3: Routes (if enabled)
    if (layers.routes) {
      const recommendationFeatures = await this.exportRecommendations();
      const routesFilePath = `${basePath}-layer3-routes.geojson`;
      await this.writeLayerToFile(recommendationFeatures, routesFilePath, 'routes');
      exportedFiles.push({layer: 'Layer 3: Routes', path: routesFilePath, featureCount: recommendationFeatures.length});
    } else {
      this.log('⏭️ Skipping routes export (Layer 3 disabled in config)');
    }
    
    // Create combined file only if combinedLayerExport is enabled
    if (combinedLayerExport) {
      this.log('🔗 Creating combined file with all enabled layers...');
      
      const allFeatures: GeoJSONFeature[] = [];
      
      if (layers.trails) {
        const trailFeatures = await this.exportTrails();
        allFeatures.push(...trailFeatures);
      }
      
      if (layers.trailVertices) {
        const trailVertexFeatures = await this.exportTrailVertices();
        allFeatures.push(...trailVertexFeatures);
      }
      
      // Add Layer 2 features (nodes and edges) if enabled and pgRouting tables exist
      if (layers.edgeNetworkVertices || layers.edges) {
        const pgRoutingTablesExist = await this.checkPgRoutingTablesExist();
        if (pgRoutingTablesExist) {
          if (layers.edgeNetworkVertices) {
            const nodeFeatures = await this.exportNodes();
            allFeatures.push(...nodeFeatures);
          }
          
          if (layers.edges) {
            const edgeFeatures = await this.exportEdges();
            allFeatures.push(...edgeFeatures);
          }
        }
      }
      
      if (layers.routes) {
        const recommendationFeatures = await this.exportRecommendations();
        allFeatures.push(...recommendationFeatures);
      }
      
      // Write combined file
      await this.writeLayerToFile(allFeatures, this.config.outputPath, 'combined');
      exportedFiles.push({layer: 'Combined: All Layers', path: this.config.outputPath, featureCount: allFeatures.length});
    } else {
      this.log('⏭️ Skipping combined file export (combinedLayerExport disabled in config)');
    }
    
    // Show consolidated summary of all exported files
    console.log('\n📁 GEOJSON EXPORT SUMMARY:');
    console.log('==========================');
    exportedFiles.forEach(file => {
      console.log(`✅ ${file.layer}: ${file.path} (${file.featureCount} features)`);
    });
    
    // Add network analysis file if available
    if (this.config.networkAnalysisPath && fs.existsSync(this.config.networkAnalysisPath)) {
      const stats = fs.statSync(this.config.networkAnalysisPath);
      console.log(`🔍 Network Analysis: ${this.config.networkAnalysisPath} (${(stats.size / 1024).toFixed(1)} KB)`);
    }
    
    console.log(`\n🎯 Total files exported: ${exportedFiles.length + (this.config.networkAnalysisPath && fs.existsSync(this.config.networkAnalysisPath) ? 1 : 0)}`);
    console.log(`📊 Total features across all files: ${exportedFiles.reduce((sum, file) => sum + file.featureCount, 0)}`);
  }

  /**
   * Write a layer's features to a GeoJSON file
   */
  private async writeLayerToFile(features: GeoJSONFeature[], filePath: string, layerName: string): Promise<void> {
    // Validate features before writing
    console.log(`🔍 Validating ${layerName} GeoJSON features...`);
    const validationResult = this.validateGeoJSON(features);
    if (!validationResult.isValid) {
      console.log(`❌ ${layerName} GeoJSON validation failed!`);
      validationResult.errors.forEach(error => console.log(`  - ${error}`));
      throw new Error(`${layerName} GeoJSON validation failed - see errors above`);
    }
    if (validationResult.warnings.length > 0) {
      console.log(`⚠️  ${layerName} GeoJSON validation warnings:`);
      validationResult.warnings.forEach(warning => console.log(`   - ${warning}`));
    }
    console.log(`✅ ${layerName} GeoJSON validation passed`);
    
    // Write to file using streaming to handle large datasets
    console.log(`📝 Writing ${features.length} ${layerName} features to GeoJSON file...`);
    
    const writeStream = fs.createWriteStream(filePath);
    
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
    
    // Validate the written file
    console.log(`🔍 Validating written ${layerName} GeoJSON file...`);
    const fileValidationResult = await this.validateGeoJSONFile(filePath);
    if (!fileValidationResult.isValid) {
      console.log(`❌ ${layerName} file validation failed!`);
      fileValidationResult.errors.forEach(error => console.log(`   - ${error}`));
      throw new Error(`${layerName} GeoJSON file validation failed - see errors above`);
    }
    
    // Only show validation result, not completion message (that's shown in summary)
    if (!fileValidationResult.isValid) {
      console.log(`   - File validation: FAILED`);
    }
  }

  /**
   * Export trails from staging schema
   */
  private async exportTrails(): Promise<GeoJSONFeature[]> {
    const trailsResult = await this.pgClient.query(`
      SELECT DISTINCT ON (ST_AsText(ST_Force2D(geometry))) 
        app_uuid, name, 
        trail_type, surface as surface_type, 
        CASE 
          WHEN difficulty = 'unknown' THEN 'moderate'
          ELSE difficulty
        END as difficulty,
        ST_AsGeoJSON(geometry, 6, 0) as geojson,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL
        AND ST_NumPoints(geometry) >= 2
        AND ST_Length(geometry::geography) > 0
      ORDER BY ST_AsText(ST_Force2D(geometry)), app_uuid
    `);
    
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
        source_identifier: trail.app_uuid, // Use app_uuid as generic source identifier
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
   * Export nodes from pgRouting tables directly
   */
  private async exportNodes(): Promise<GeoJSONFeature[]> {
    try {
      // Use ways_noded_vertices_pgr tables directly for consistency with route generation
      const nodesResult = await this.pgClient.query(`
        SELECT 
          v.id, 
          'node-' || v.id::text as node_uuid, 
          ST_Y(v.the_geom) as lat, 
          ST_X(v.the_geom) as lng, 
          COALESCE(ST_Z(v.the_geom), 0) as elevation, 
          CASE 
            WHEN v.cnt >= 3 THEN 'intersection'
            WHEN v.cnt = 2 THEN 'connector'
            WHEN v.cnt = 1 THEN 'endpoint'
            ELSE 'unknown'
          END as node_type, 
          '' as connected_trails, 
          ARRAY[]::text[] as trail_ids, 
          ST_AsGeoJSON(v.the_geom, 6, 0) as geojson,
          v.cnt as degree
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        WHERE v.the_geom IS NOT NULL
        ORDER BY v.id
      `);
      
      return nodesResult.rows.map((node: any) => {
        // Color-code nodes by degree
        const degree = parseInt(node.degree) || 0;
        let color, stroke, strokeWidth, fillOpacity, radius;
        
        if (degree === 1) {
          // Endpoints (degree 1) - Green
          color = "#00FF00";
          stroke = "#00FF00";
          strokeWidth = 2;
          fillOpacity = 0.8;
          radius = 4;
        } else if (degree === 2) {
          // Connectors (degree 2) - Blue
          color = "#0000FF";
          stroke = "#0000FF";
          strokeWidth = 2;
          fillOpacity = 0.8;
          radius = 5;
        } else {
          // Intersections (degree ≥3) - Red
          color = "#FF0000";
          stroke = "#FF0000";
          strokeWidth = 3;
          fillOpacity = 0.9;
          radius = 6;
        }
        
        return {
          type: 'Feature',
          geometry: JSON.parse(node.geojson),
          properties: {
            id: node.id,
            node_uuid: node.node_uuid,
            lat: node.lat,
            lng: node.lng,
            elevation: node.elevation,
            node_type: node.node_type,
            degree: node.degree,
            type: 'edge_network_vertex',
            color: color,
            stroke: stroke,
            strokeWidth: strokeWidth,
            fillOpacity: fillOpacity,
            radius: radius
          }
        };
      });
    } catch (error) {
      this.log(`⚠️  Error exporting nodes from pgRouting tables: ${error}`);
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
   * Export edges from pgRouting tables directly
   */
  private async exportEdges(): Promise<GeoJSONFeature[]> {
    try {
      // Use ways_noded instead of ways_split
      // This is the table that pgRouting actually uses for route generation
      const edgesResult = await this.pgClient.query(`
        SELECT 
          w.id,
          w.source,
          w.target,
          w.length_km,
          w.elevation_gain,
          w.elevation_loss,
          w.app_uuid as trail_uuid,
          w.name as trail_name,
          ST_AsGeoJSON(w.the_geom, 6, 0) as geojson,
          'edge-' || w.id as edge_uuid,
          'trail_segment' as edge_type,
          'edge' as type,
          '#0000FF' as color,
          '#0000FF' as stroke,
          2 as strokeWidth,
          0.6 as fillOpacity
        FROM ${this.stagingSchema}.ways_noded w
        WHERE w.the_geom IS NOT NULL
        ORDER BY w.id
      `);
      
      const edgeStyling = this.exportConfig.geojson?.styling?.edges || {
        color: "#4169E1",
        stroke: "#4169E1",
        strokeWidth: 1,
        fillOpacity: 0.4
      };
      
      return edgesResult.rows.map((edge: any) => ({
        type: 'Feature',
        geometry: JSON.parse(edge.geojson),
        properties: {
          id: edge.id,
          edge_uuid: edge.edge_uuid,
          source: edge.source,
          target: edge.target,
          length_km: edge.length_km,
          elevation_gain: edge.elevation_gain,
          elevation_loss: edge.elevation_loss,
          trail_uuid: edge.trail_uuid,
          trail_name: edge.trail_name,
          edge_type: edge.edge_type,
          type: edge.type,
          color: edgeStyling.color,
          stroke: edgeStyling.stroke,
          strokeWidth: edgeStyling.strokeWidth,
          fillOpacity: edgeStyling.fillOpacity
        }
      }));
    } catch (error) {
      this.log(`⚠️  Error exporting edges from pgRouting tables: ${error}`);
      return [];
    }
  }

  /**
   * Export recommendations from export-ready table
   */
  private async exportRecommendations(): Promise<GeoJSONFeature[]> {
    try {
      // First, create the export_routes table from route_recommendations if it doesn't exist
      this.log('📋 Creating export_routes table from route_recommendations...');
      await this.pgClient.query(ExportQueries.createExportRoutesTable(this.stagingSchema));
      this.log('✅ export_routes table created/updated');
      
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
            // Convert PostGIS geometry to GeoJSON coordinates using ST_Dump to handle nested coordinates
            const geometryResult = await this.pgClient.query(`
              SELECT ST_AsGeoJSON((ST_Dump($1::geometry)).geom, 6, 0) as geojson
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

  /**
   * Validate GeoJSON structure and content
   */
  private validateGeoJSON(features: GeoJSONFeature[]): GeoJSONValidationResult {
    const result: GeoJSONValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    // Check if we have any features
    if (features.length === 0) {
      result.warnings.push('No features found in GeoJSON');
    }

    // Validate each feature
    features.forEach((feature, index) => {
      // Check required top-level properties
      if (!feature.type || feature.type !== 'Feature') {
        result.errors.push(`Feature ${index}: Missing or invalid 'type' property (must be 'Feature')`);
        result.isValid = false;
      }

      if (!feature.geometry) {
        result.errors.push(`Feature ${index}: Missing 'geometry' property`);
        result.isValid = false;
      } else {
        // Validate geometry structure
        if (!feature.geometry.type) {
          result.errors.push(`Feature ${index}: Missing geometry 'type' property`);
          result.isValid = false;
        }

        if (!feature.geometry.coordinates) {
          result.errors.push(`Feature ${index}: Missing geometry 'coordinates' property`);
          result.isValid = false;
        } else {
          // Validate coordinates structure
          if (!Array.isArray(feature.geometry.coordinates)) {
            result.errors.push(`Feature ${index}: Geometry coordinates must be an array`);
            result.isValid = false;
          } else {
            // Check for empty coordinates
            if (feature.geometry.coordinates.length === 0) {
              result.warnings.push(`Feature ${index}: Empty coordinates array`);
            }

            // Validate coordinate values
            const validateCoordinates = (coords: any[]): boolean => {
              if (!Array.isArray(coords)) return false;
              
              for (const coord of coords) {
                if (Array.isArray(coord)) {
                  if (!validateCoordinates(coord)) return false;
                } else {
                  if (typeof coord !== 'number' || isNaN(coord) || !isFinite(coord)) {
                    return false;
                  }
                }
              }
              return true;
            };

            if (!validateCoordinates(feature.geometry.coordinates)) {
              result.errors.push(`Feature ${index}: Invalid coordinate values (must be finite numbers)`);
              result.isValid = false;
            }
          }
        }
      }

      // Validate properties
      if (!feature.properties) {
        result.warnings.push(`Feature ${index}: Missing 'properties' object`);
      } else {
        // Check for problematic property values
        Object.entries(feature.properties).forEach(([key, value]) => {
          if (value === null) {
            result.warnings.push(`Feature ${index}: Property '${key}' has null value`);
          } else if (value === undefined) {
            result.errors.push(`Feature ${index}: Property '${key}' has undefined value`);
            result.isValid = false;
          } else if (typeof value === 'string' && value.includes('\n')) {
            result.warnings.push(`Feature ${index}: Property '${key}' contains newlines which may cause rendering issues`);
          } else if (typeof value === 'string' && value.length > 1000) {
            result.warnings.push(`Feature ${index}: Property '${key}' is very long (${value.length} characters)`);
          }
        });
      }
    });

    return result;
  }

  /**
   * Validate complete GeoJSON file after writing
   */
  private async validateGeoJSONFile(filePath: string): Promise<GeoJSONValidationResult> {
    const result: GeoJSONValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    try {
      // Read the file
      const fileContent = fs.readFileSync(filePath, 'utf8');
      
      // Try to parse as JSON
      let geojson: any;
      try {
        geojson = JSON.parse(fileContent);
      } catch (parseError) {
        result.errors.push(`JSON parse error: ${parseError}`);
        result.isValid = false;
        return result;
      }

      // Validate GeoJSON structure
      if (!geojson.type || geojson.type !== 'FeatureCollection') {
        result.errors.push('Root object must have type "FeatureCollection"');
        result.isValid = false;
      }

      if (!geojson.features || !Array.isArray(geojson.features)) {
        result.errors.push('Root object must have "features" array');
        result.isValid = false;
      }

      // Check file size
      const fileSizeMB = fs.statSync(filePath).size / (1024 * 1024);
      if (fileSizeMB > 100) {
        result.warnings.push(`Large file size: ${fileSizeMB.toFixed(1)}MB (may cause rendering issues)`);
      }

      // Validate each feature
      geojson.features.forEach((feature: any, index: number) => {
        if (!feature.type || feature.type !== 'Feature') {
          result.errors.push(`Feature ${index}: Invalid type "${feature.type}" (must be "Feature")`);
          result.isValid = false;
        }

        if (!feature.geometry) {
          result.errors.push(`Feature ${index}: Missing geometry`);
          result.isValid = false;
        } else {
          if (!feature.geometry.type) {
            result.errors.push(`Feature ${index}: Missing geometry type`);
            result.isValid = false;
          }

          if (!feature.geometry.coordinates) {
            result.errors.push(`Feature ${index}: Missing coordinates`);
            result.isValid = false;
          }
        }

        if (!feature.properties) {
          result.warnings.push(`Feature ${index}: Missing properties object`);
        }
      });

      console.log(`🔍 GeoJSON validation: ${result.isValid ? '✅ VALID' : '❌ INVALID'}`);
      if (result.errors.length > 0) {
        console.log(`❌ Errors (${result.errors.length}):`);
        result.errors.forEach(error => console.log(`   - ${error}`));
      }
      if (result.warnings.length > 0) {
        console.log(`⚠️  Warnings (${result.warnings.length}):`);
        result.warnings.forEach(warning => console.log(`   - ${warning}`));
      }

    } catch (error) {
      result.errors.push(`File validation error: ${error}`);
      result.isValid = false;
    }

    return result;
  }
}