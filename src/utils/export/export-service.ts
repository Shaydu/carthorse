import { Pool } from 'pg';
import * as fs from 'fs';
import { ExportSqlHelpers } from '../sql/export-sql-helpers';

export interface ExportConfig {
  outputPath: string;
  stagingSchema: string;
  includeTrails?: boolean;
  includeNodes?: boolean;
  includeEdges?: boolean;
  includeRoutes?: boolean;
}

export interface ExportResult {
  success: boolean;
  message: string;
  data?: any;
}

/**
 * Base export strategy interface
 */
export interface ExportStrategy {
  export(pgClient: Pool, config: ExportConfig): Promise<ExportResult>;
}

/**
 * GeoJSON Export Strategy
 */
export class GeoJSONExportStrategy implements ExportStrategy {
  async export(pgClient: Pool, config: ExportConfig): Promise<ExportResult> {
    try {
      console.log('🗺️ Starting GeoJSON export...');
      
      const sqlHelpers = new ExportSqlHelpers(pgClient, config.stagingSchema);
      
      // Export all data from staging schema
      const { trails, nodes, edges } = await sqlHelpers.exportAllDataForGeoJSON();
      const routeRecommendations = await sqlHelpers.exportRouteRecommendationsForGeoJSON();
      
      // Create GeoJSON features based on configuration
      const trailFeatures = config.includeTrails !== false ? trails.map(row => ({
        type: 'Feature',
        properties: {
          id: row.app_uuid,
          name: row.name,
          trail_type: row.trail_type,
          surface: row.surface,
          difficulty: row.difficulty,
          length_km: row.length_km,
          elevation_gain: row.elevation_gain,
          elevation_loss: row.elevation_loss,
          max_elevation: row.max_elevation,
          min_elevation: row.min_elevation,
          avg_elevation: row.avg_elevation,
          color: '#00ff00', // Green for trails
          size: 2
        },
        geometry: JSON.parse(row.geojson)
      })) : [];

      const nodeFeatures = config.includeNodes !== false ? nodes.map(row => {
        let color = '#0000ff'; // Blue for trail nodes
        let size = 2;
        
        if (row.node_type === 'intersection') {
          color = '#ff0000'; // Red for intersections
          size = 3;
        } else if (row.node_type === 'endpoint') {
          color = '#00ff00'; // Green for endpoints
          size = 3;
        }
        
        return {
          type: 'Feature',
          properties: {
            id: row.id,
            node_uuid: row.node_uuid,
            node_type: row.node_type,
            connected_trails: row.connected_trails,
            trail_ids: row.trail_ids,
            color,
            size
          },
          geometry: JSON.parse(row.geojson)
        };
      }) : [];

      const edgeFeatures = config.includeEdges !== false ? edges.map(row => ({
        type: 'Feature',
        properties: {
          id: row.id,
          source: row.source,
          target: row.target,
          trail_id: row.trail_id,
          trail_name: row.trail_name,
          length_km: row.length_km,
          elevation_gain: row.elevation_gain,
          elevation_loss: row.elevation_loss,
          is_bidirectional: row.is_bidirectional,
          color: '#ff00ff', // Magenta for edges
          size: 1
        },
        geometry: JSON.parse(row.geojson)
      })) : [];

      const routeFeatures = config.includeRoutes !== false ? routeRecommendations.map(row => ({
        type: 'Feature',
        properties: {
          id: row.route_uuid,
          route_name: row.route_name,
          route_type: row.route_type,
          route_shape: row.route_shape,
          recommended_distance_km: row.recommended_distance_km,
          recommended_elevation_gain: row.recommended_elevation_gain,
          trail_count: row.trail_count,
          route_score: row.route_score,
          similarity_score: row.similarity_score,
          region: row.region,
          constituent_trails: row.constituent_trails || [],
          color: '#ff8800', // Orange for route recommendations
          size: 20, // Even wider for maximum visibility
          lineStyle: 'dotted', // Dotted line style
          weight: 20, // Additional weight property for some viewers
          strokeWidth: 20, // Stroke width for some viewers
          strokeColor: '#ff8800', // Explicit stroke color
          strokeOpacity: 1.0, // Full opacity
          strokeDasharray: '10,5' // Explicit dotted pattern
        },
        geometry: JSON.parse(row.geojson)
      })) : [];

      // Create GeoJSON collection
      const geojson = {
        type: 'FeatureCollection',
        features: [...trailFeatures, ...nodeFeatures, ...edgeFeatures, ...routeFeatures]
      };

      // Write to file
      fs.writeFileSync(config.outputPath, JSON.stringify(geojson, null, 2));
      
      console.log(`✅ GeoJSON export completed:`);
      console.log(`   📁 File: ${config.outputPath}`);
      console.log(`   🗺️ Trails: ${trailFeatures.length}`);
      console.log(`   📍 Nodes: ${nodeFeatures.length}`);
      console.log(`   🛤️ Edges: ${edgeFeatures.length}`);
      console.log(`   🛣️ Routes: ${routeFeatures.length}`);
      console.log(`   🎨 Colors: Trails (green), Nodes (blue/red), Edges (magenta), Routes (orange, dotted, 3x width)`);

      return {
        success: true,
        message: `GeoJSON export completed successfully`,
        data: {
          trails: trailFeatures.length,
          nodes: nodeFeatures.length,
          edges: edgeFeatures.length,
          routes: routeFeatures.length
        }
      };

    } catch (error) {
      console.error('❌ Error during GeoJSON export:', error);
      return {
        success: false,
        message: `GeoJSON export failed: ${error}`
      };
    }
  }
}

/**
 * SQLite Export Strategy
 */
export class SQLiteExportStrategy implements ExportStrategy {
  async export(pgClient: Pool, config: ExportConfig): Promise<ExportResult> {
    try {
      console.log('🗄️ Starting SQLite export...');
      
      // Import SQLite helpers dynamically to avoid circular dependencies
      const { createSqliteTables, insertTrails, insertRoutingNodes, insertRoutingEdges } = await import('../sqlite-export-helpers');
      
      // Export data from staging schema
      const sqlHelpers = new ExportSqlHelpers(pgClient, config.stagingSchema);
      
      // Get all data from staging schema
      const trails = await sqlHelpers.exportTrailsForGeoJSON();
      const nodes = await sqlHelpers.exportRoutingNodesForGeoJSON();
      const edges = await sqlHelpers.exportRoutingEdgesForGeoJSON();
      const routeRecommendations = await sqlHelpers.exportRouteRecommendationsForGeoJSON();
      
      // Create SQLite database
      const db = new (await import('better-sqlite3')).default(config.outputPath);
      
      // Create tables
      createSqliteTables(db);
      
      // Insert data into SQLite
      insertTrails(db, trails.map(t => ({
        ...t,
        geometry: JSON.parse(t.geojson)
      })));
      insertRoutingNodes(db, nodes.map(n => ({
        ...n,
        geometry: JSON.parse(n.geojson)
      })));
      insertRoutingEdges(db, edges.map(e => ({
        ...e,
        geometry: JSON.parse(e.geojson)
      })));
      
      db.close();
      
      console.log(`✅ SQLite export completed:`);
      console.log(`   📁 File: ${config.outputPath}`);
      console.log(`   🗺️ Trails: ${trails.length}`);
      console.log(`   📍 Nodes: ${nodes.length}`);
      console.log(`   🛤️ Edges: ${edges.length}`);

      return {
        success: true,
        message: `SQLite export completed successfully`,
        data: {
          trails: trails.length,
          nodes: nodes.length,
          edges: edges.length
        }
      };

    } catch (error) {
      console.error('❌ Error during SQLite export:', error);
      return {
        success: false,
        message: `SQLite export failed: ${error}`
      };
    }
  }
}

/**
 * Trails-Only Export Strategy (subset of GeoJSON)
 */
export class TrailsOnlyExportStrategy implements ExportStrategy {
  async export(pgClient: Pool, config: ExportConfig): Promise<ExportResult> {
    try {
      console.log('🗺️ Starting trails-only export...');
      
      const sqlHelpers = new ExportSqlHelpers(pgClient, config.stagingSchema);
      
      // Export only trails from staging schema
      const trails = await sqlHelpers.exportTrailSegmentsOnly();

      // Create GeoJSON features for trails only
      const trailFeatures = trails.map(row => ({
        type: 'Feature',
        properties: {
          id: row.app_uuid,
          name: row.name,
          trail_type: row.trail_type,
          surface: row.surface,
          difficulty: row.difficulty,
          length_km: row.length_km,
          elevation_gain: row.elevation_gain,
          elevation_loss: row.elevation_loss,
          max_elevation: row.max_elevation,
          min_elevation: row.min_elevation,
          avg_elevation: row.avg_elevation,
          color: '#00ff00', // Green for trails
          size: 2
        },
        geometry: JSON.parse(row.geojson)
      }));

      // Create GeoJSON collection
      const geojson = {
        type: 'FeatureCollection',
        features: trailFeatures
      };

      // Write to file
      fs.writeFileSync(config.outputPath, JSON.stringify(geojson, null, 2));
      
      console.log(`✅ Trails-only export completed:`);
      console.log(`   📁 File: ${config.outputPath}`);
      console.log(`   🗺️ Trails: ${trailFeatures.length}`);
      console.log(`   🎨 Colors: Trails (green)`);

      return {
        success: true,
        message: `Trails-only export completed successfully`,
        data: {
          trails: trailFeatures.length
        }
      };

    } catch (error) {
      console.error('❌ Error during trails-only export:', error);
      return {
        success: false,
        message: `Trails-only export failed: ${error}`
      };
    }
  }
}

/**
 * Main Export Service
 */
export class ExportService {
  private strategies: Map<string, ExportStrategy> = new Map();

  constructor() {
    // Register export strategies
    this.strategies.set('geojson', new GeoJSONExportStrategy());
    this.strategies.set('sqlite', new SQLiteExportStrategy());
    this.strategies.set('trails-only', new TrailsOnlyExportStrategy());
  }

  /**
   * Export data using the specified strategy
   */
  async export(
    format: 'geojson' | 'sqlite' | 'trails-only',
    pgClient: Pool,
    config: ExportConfig
  ): Promise<ExportResult> {
    const strategy = this.strategies.get(format);
    
    if (!strategy) {
      return {
        success: false,
        message: `Unsupported export format: ${format}`
      };
    }

    return await strategy.export(pgClient, config);
  }

  /**
   * Register a new export strategy
   */
  registerStrategy(name: string, strategy: ExportStrategy): void {
    this.strategies.set(name, strategy);
  }

  /**
   * Get available export formats
   */
  getAvailableFormats(): string[] {
    return Array.from(this.strategies.keys());
  }
} 