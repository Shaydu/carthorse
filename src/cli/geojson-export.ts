#!/usr/bin/env npx ts-node

import { Command } from 'commander';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: number[][];
  };
  properties: Record<string, any>;
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

interface ExportOptions {
  input: string;
  output: string;
  includeNodes: boolean;
  includeEdges: boolean;
  includeTrails: boolean;
  includeRecommendations: boolean;
  nodeTypes: string[];
  routeTypes: string[];
  verbose: boolean;
}

class GeoJSONExporter {
  private db: Database.Database;
  private options: ExportOptions;

  constructor(dbPath: string, options: ExportOptions) {
    this.db = new Database(dbPath, { readonly: true });
    this.options = options;
  }

  private log(message: string) {
    if (this.options.verbose) {
      console.log(`[GeoJSON] ${message}`);
    }
  }

  private parseGeometry(geometryText: string): number[][] {
    try {
      // Handle both WKT and GeoJSON geometry formats
      if (geometryText.startsWith('{"type"')) {
        const geoJson = JSON.parse(geometryText);
        return geoJson.coordinates;
      } else if (geometryText.startsWith('LINESTRING')) {
        // Parse WKT LINESTRING format
        const coords = geometryText
          .replace('LINESTRING(', '')
          .replace(')', '')
          .split(',')
          .map(coord => coord.trim().split(' ').map(Number));
        return coords;
      }
      return [];
    } catch (error) {
      this.log(`⚠️ Failed to parse geometry: ${geometryText}`);
      return [];
    }
  }

  private createPointFeature(coordinates: number[], properties: Record<string, any>): GeoJSONFeature {
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: coordinates as any // Point coordinates are number[], not number[][]
      },
      properties
    };
  }

  private createLineStringFeature(coordinates: number[][], properties: Record<string, any>): GeoJSONFeature {
    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: coordinates
      },
      properties
    };
  }

  exportNodes(): GeoJSONFeature[] {
    if (!this.options.includeNodes) return [];

    this.log('📍 Exporting nodes...');
    const features: GeoJSONFeature[] = [];

    try {
      const nodes = this.db.prepare(`
        SELECT 
          id, node_uuid, node_type, 
          latitude, longitude,
          elevation, 
          created_at,
          degree
        FROM nodes 
        WHERE node_type IN (${this.options.nodeTypes.map(() => '?').join(',')})
        ORDER BY id
      `).all(...this.options.nodeTypes);

      this.log(`Found ${nodes.length} nodes`);

      for (const node of nodes as any[]) {
        const coordinates = [node.longitude, node.latitude];
        const properties = {
          id: node.id,
          node_uuid: node.node_uuid,
          node_type: node.node_type,
          elevation: node.elevation,
          created_at: node.created_at,
          degree: node.degree
        };

        features.push(this.createPointFeature(coordinates, properties));
      }
    } catch (error) {
      this.log(`❌ Error exporting nodes: ${error}`);
    }

    return features;
  }

  exportEdges(): GeoJSONFeature[] {
    if (!this.options.includeEdges) return [];

    this.log('🛤️ Exporting edges...');
    const features: GeoJSONFeature[] = [];

    try {
      const edges = this.db.prepare(`
        SELECT 
          id, edge_uuid, source_node_id, target_node_id,
          geometry, cost, reverse_cost,
          created_at
        FROM edges 
        ORDER BY id
      `).all();

      this.log(`Found ${edges.length} edges`);

      for (const edge of edges as any[]) {
        const coordinates = this.parseGeometry(edge.geometry);
        if (coordinates.length > 0) {
          const properties = {
            id: edge.id,
            edge_uuid: edge.edge_uuid,
            source_node_id: edge.source_node_id,
            target_node_id: edge.target_node_id,
            cost: edge.cost,
            reverse_cost: edge.reverse_cost,
            created_at: edge.created_at
          };

          features.push(this.createLineStringFeature(coordinates, properties));
        }
      }
    } catch (error) {
      this.log(`❌ Error exporting edges: ${error}`);
    }

    return features;
  }

  exportTrails(): GeoJSONFeature[] {
    if (!this.options.includeTrails) return [];

    this.log('🏔️ Exporting trails...');
    const features: GeoJSONFeature[] = [];

    try {
      const trails = this.db.prepare(`
        SELECT 
          id, app_uuid, name, region, trail_type, surface, difficulty,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          geometry, created_at
        FROM trails 
        ORDER BY id
      `).all();

      this.log(`Found ${trails.length} trails`);

      for (const trail of trails as any[]) {
        const coordinates = this.parseGeometry(trail.geometry);
        if (coordinates.length > 0) {
                  const properties = {
          id: trail.id,
          app_uuid: trail.app_uuid,
          name: trail.name,
          region: trail.region,
          trail_type: trail.trail_type,
          surface: trail.surface,
          difficulty: trail.difficulty,
          length_km: trail.length_km,
          elevation_gain: trail.elevation_gain,
          elevation_loss: trail.elevation_loss,
          max_elevation: trail.max_elevation,
          min_elevation: trail.min_elevation,
          avg_elevation: trail.avg_elevation,
          created_at: trail.created_at
        };

          features.push(this.createLineStringFeature(coordinates, properties));
        }
      }
    } catch (error) {
      this.log(`❌ Error exporting trails: ${error}`);
    }

    return features;
  }

  exportRecommendations(): GeoJSONFeature[] {
    if (!this.options.includeRecommendations) return [];

    this.log('🗺️ Exporting route recommendations...');
    const features: GeoJSONFeature[] = [];

    try {
      const recommendations = this.db.prepare(`
        SELECT 
          r.id, r.route_uuid, r.name, r.route_type, r.route_score,
          r.total_distance_km, r.total_elevation_gain, r.total_elevation_loss,
          r.geometry, r.created_at,
          GROUP_CONCAT(rt.trail_name, ' → ') as trail_composition
        FROM route_recommendations r
        LEFT JOIN route_trails rt ON r.route_uuid = rt.route_uuid
        WHERE r.route_type IN (${this.options.routeTypes.map(() => '?').join(',')})
        GROUP BY r.route_uuid
        ORDER BY r.route_score DESC
      `).all(...this.options.routeTypes);

      this.log(`Found ${recommendations.length} route recommendations`);

      for (const rec of recommendations as any[]) {
        const coordinates = this.parseGeometry(rec.geometry);
        if (coordinates.length > 0) {
          const properties = {
            id: rec.id,
            route_uuid: rec.route_uuid,
            name: rec.name,
            route_type: rec.route_type,
            route_score: rec.route_score,
            total_distance_km: rec.total_distance_km,
            total_elevation_gain: rec.total_elevation_gain,
            total_elevation_loss: rec.total_elevation_loss,
            trail_composition: rec.trail_composition,
            created_at: rec.created_at
          };

          features.push(this.createLineStringFeature(coordinates, properties));
        }
      }
    } catch (error) {
      this.log(`❌ Error exporting recommendations: ${error}`);
    }

    return features;
  }

  exportAll(): GeoJSONCollection {
    this.log('🚀 Starting comprehensive GeoJSON export...');

    const allFeatures: GeoJSONFeature[] = [];

    // Export each layer
    allFeatures.push(...this.exportNodes());
    allFeatures.push(...this.exportEdges());
    allFeatures.push(...this.exportTrails());
    allFeatures.push(...this.exportRecommendations());

    this.log(`✅ Export complete: ${allFeatures.length} total features`);

    return {
      type: 'FeatureCollection',
      features: allFeatures
    };
  }

  close() {
    this.db.close();
  }
}

// CLI Setup
const program = new Command();

program
  .name('geojson-export')
  .description('Export SQLite database to GeoJSON for visualization')
  .version('1.0.0');

program
  .command('export')
  .description('Export SQLite database to GeoJSON')
  .requiredOption('-i, --input <path>', 'Input SQLite database path')
  .requiredOption('-o, --output <path>', 'Output GeoJSON file path')
  .option('--include-nodes', 'Include nodes (endpoints and intersections)', true)
  .option('--include-edges', 'Include edges (routing network)', true)
  .option('--include-trails', 'Include trails', true)
  .option('--include-recommendations', 'Include route recommendations', true)
  .option('--node-types <types>', 'Node types to include (comma-separated)', 'endpoint,intersection')
  .option('--route-types <types>', 'Route types to include (comma-separated)', 'ksp,loop,out-and-back,point-to-point')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .action(async (options) => {
    try {
      console.log('🗺️ Starting GeoJSON export...');
      
      const exportOptions: ExportOptions = {
        input: options.input,
        output: options.output,
        includeNodes: options.includeNodes,
        includeEdges: options.includeEdges,
        includeTrails: options.includeTrails,
        includeRecommendations: options.includeRecommendations,
        nodeTypes: options.nodeTypes.split(','),
        routeTypes: options.routeTypes.split(','),
        verbose: options.verbose
      };

      console.log(`📁 Input database: ${exportOptions.input}`);
      console.log(`📄 Output file: ${exportOptions.output}`);
      console.log(`📍 Include nodes: ${exportOptions.includeNodes}`);
      console.log(`🛤️ Include edges: ${exportOptions.includeEdges}`);
      console.log(`🏔️ Include trails: ${exportOptions.includeTrails}`);
      console.log(`🗺️ Include recommendations: ${exportOptions.includeRecommendations}`);
      console.log(`🎯 Node types: ${exportOptions.nodeTypes.join(', ')}`);
      console.log(`🛣️ Route types: ${exportOptions.routeTypes.join(', ')}`);

      const exporter = new GeoJSONExporter(exportOptions.input, exportOptions);
      const geojson = exporter.exportAll();
      exporter.close();

      // Write to file
      fs.writeFileSync(exportOptions.output, JSON.stringify(geojson, null, 2));
      
      console.log(`✅ GeoJSON export complete!`);
      console.log(`📊 Total features: ${geojson.features.length}`);
      console.log(`📄 Output file: ${exportOptions.output}`);
      
      // Show feature breakdown
      const nodeFeatures = geojson.features.filter(f => f.geometry.type === 'Point');
      const lineFeatures = geojson.features.filter(f => f.geometry.type === 'LineString');
      
      console.log(`📍 Points (nodes): ${nodeFeatures.length}`);
      console.log(`🛤️ Lines (edges/trails/routes): ${lineFeatures.length}`);

    } catch (error) {
      console.error(`❌ Export failed: ${error}`);
      process.exit(1);
    }
  });

program
  .command('info')
  .description('Show information about SQLite database')
  .requiredOption('-i, --input <path>', 'Input SQLite database path')
  .action(async (options) => {
    try {
      console.log('📊 Database Information...');
      
      const db = new Database(options.input, { readonly: true });
      
      // Get table information
      const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' 
        ORDER BY name
      `).all();
      
      console.log(`📋 Tables found: ${tables.length}`);
      
      for (const table of tables as any[]) {
        const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get() as any;
        console.log(`  - ${table.name}: ${count.count} rows`);
        
        // Show sample columns for key tables
        if (['nodes', 'edges', 'trails', 'route_recommendations'].includes(table.name)) {
          const columns = db.prepare(`PRAGMA table_info(${table.name})`).all() as any[];
          const columnNames = columns.map((c: any) => c.name).join(', ');
          console.log(`    Columns: ${columnNames}`);
        }
      }
      
      db.close();
      
    } catch (error) {
      console.error(`❌ Info failed: ${error}`);
      process.exit(1);
    }
  });

if (require.main === module) {
  program.parse();
}

// Export the GeoJSONExporter class for use in other modules
export { GeoJSONExporter, ExportOptions }; 