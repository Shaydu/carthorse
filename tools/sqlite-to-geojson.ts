#!/usr/bin/env ts-node
/**
 * SQLite to GeoJSON Extractor
 * 
 * Simple tool to extract GeoJSON from exported Carthorse SQLite databases
 * for visualization and debugging of routes, trails, and network data.
 * 
 * Usage:
 *   npx ts-node tools/sqlite-to-geojson.ts --db data/boulder.db --output routes.geojson --layer routes
 *   npx ts-node tools/sqlite-to-geojson.ts --db data/boulder.db --route "loop-12345" --output debug-route.geojson
 *   npx ts-node tools/sqlite-to-geojson.ts --db data/boulder.db --output network.geojson --layer all
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

interface GeoJSONFeature {
  type: 'Feature';
  properties: any;
  geometry: any;
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

interface ExtractorOptions {
  dbPath: string;
  outputPath: string;
  layer: 'routes' | 'trails' | 'nodes' | 'edges' | 'all';
  routeId?: string;
  verbose?: boolean;
}

class SQLiteGeoJSONExtractor {
  private db: Database.Database;
  private options: ExtractorOptions;

  constructor(options: ExtractorOptions) {
    this.options = options;
    
    if (!fs.existsSync(options.dbPath)) {
      throw new Error(`Database file not found: ${options.dbPath}`);
    }
    
    this.db = new Database(options.dbPath);
    this.log(`📁 Opened database: ${options.dbPath}`);
  }

  private log(message: string): void {
    if (this.options.verbose) {
      console.log(message);
    }
  }

  async extract(): Promise<void> {
    const geojson: GeoJSONCollection = {
      type: 'FeatureCollection',
      features: []
    };

    try {
      if (this.options.routeId) {
        // Extract specific route with its trail composition
        await this.extractSpecificRoute(geojson, this.options.routeId);
      } else {
        // Extract by layer type
        switch (this.options.layer) {
          case 'routes':
            await this.extractRoutes(geojson);
            break;
          case 'trails':
            await this.extractTrails(geojson);
            break;
          case 'nodes':
            await this.extractNodes(geojson);
            break;
          case 'edges':
            await this.extractEdges(geojson);
            break;
          case 'all':
            await this.extractTrails(geojson);
            await this.extractNodes(geojson);
            await this.extractEdges(geojson);
            await this.extractRoutes(geojson);
            break;
        }
      }

      // Write GeoJSON to file
      const outputDir = path.dirname(this.options.outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      fs.writeFileSync(this.options.outputPath, JSON.stringify(geojson, null, 2));
      
      // Count features by layer
      const layerCounts = geojson.features.reduce((counts: any, feature) => {
        const layer = feature.properties.layer || 'unknown';
        counts[layer] = (counts[layer] || 0) + 1;
        return counts;
      }, {});
      
      console.log(`✅ Export completed successfully!`);
      console.log(`📁 Output: ${this.options.outputPath}`);
      console.log(`📊 Exported:`);
      
      if (layerCounts.trails) console.log(`   - Trails: ${layerCounts.trails}`);
      if (layerCounts.nodes) console.log(`   - Nodes: ${layerCounts.nodes}`);
      if (layerCounts.edges) console.log(`   - Edges: ${layerCounts.edges}`);
      if (layerCounts.routes) console.log(`   - Routes: ${layerCounts.routes}`);
      if (layerCounts.route_trails) console.log(`   - Route Trails: ${layerCounts.route_trails}`);
      
      const fileSizeKB = Math.round(fs.statSync(this.options.outputPath).size / 1024);
      console.log(`📏 File size: ${fileSizeKB} KB`);
      console.log(`🌐 Tip: Upload to geojson.io for visualization`);
      
    } finally {
      this.db.close();
    }
  }

  private async extractTrails(geojson: GeoJSONCollection): Promise<void> {
    try {
      const trails = this.db.prepare(`
        SELECT 
          app_uuid as id, app_uuid, name, region, length_km, elevation_gain, elevation_loss,
          max_elevation, min_elevation, avg_elevation, difficulty, surface_type, 
          trail_type, geojson as geometry_json
        FROM trails 
        ORDER BY name
      `).all();

      this.log(`📍 Found ${trails.length} trails`);

      for (const trail of trails) {
        const t = trail as any;
        if (t.geometry_json) {
          const geometry = JSON.parse(t.geometry_json);
          
          geojson.features.push({
            type: 'Feature',
            properties: {
              layer: 'trails',
              id: t.id,
              app_uuid: t.app_uuid,
              name: t.name,
              region: t.region,
              length_km: t.length_km,
              elevation_gain: t.elevation_gain,
              elevation_loss: t.elevation_loss,
              max_elevation: t.max_elevation,
              min_elevation: t.min_elevation,
              avg_elevation: t.avg_elevation,
              difficulty: t.difficulty,
              surface_type: t.surface_type,
              trail_type: t.trail_type,
              // Styling
              color: this.getTrailColor(t.difficulty),
              stroke: this.getTrailColor(t.difficulty),
              'stroke-width': 3,
              'stroke-opacity': 0.8
            },
            geometry
          });
        }
      }
    } catch (error) {
      this.log(`⚠️ No trails table found or error reading trails: ${error}`);
    }
  }

  private async extractNodes(geojson: GeoJSONCollection): Promise<void> {
    try {
      const nodes = this.db.prepare(`
        SELECT 
          id, node_uuid, lat, lng, elevation, node_type, connected_trails
        FROM routing_nodes 
        ORDER BY id
      `).all();

      this.log(`📍 Found ${nodes.length} nodes`);

      for (const node of nodes) {
        const n = node as any;
        geojson.features.push({
          type: 'Feature',
          properties: {
            layer: 'nodes',
            id: n.id,
            node_uuid: n.node_uuid,
            elevation: n.elevation,
            node_type: n.node_type,
            connected_trails: n.connected_trails,
            // Styling
            color: n.node_type === 'intersection' ? '#000000' : '#FF0000',
            'marker-color': n.node_type === 'intersection' ? '#000000' : '#FF0000',
            'marker-size': n.node_type === 'intersection' ? 'large' : 'medium',
            'marker-symbol': n.node_type === 'intersection' ? 'circle' : 'circle'
          },
          geometry: {
            type: 'Point',
            coordinates: [n.lng, n.lat]
          }
        });
      }
    } catch (error) {
      this.log(`⚠️ No routing_nodes table found or error reading nodes: ${error}`);
    }
  }

  private async extractEdges(geojson: GeoJSONCollection): Promise<void> {
    try {
      const edges = this.db.prepare(`
        SELECT 
          id, source, target, trail_id, trail_name, length_km, 
          elevation_gain, elevation_loss, geojson as geometry_json
        FROM routing_edges 
        ORDER BY id
      `).all();

      this.log(`📍 Found ${edges.length} edges`);

      for (const edge of edges) {
        const e = edge as any;
        if (e.geometry_json) {
          const geometry = JSON.parse(e.geometry_json);
          
          geojson.features.push({
            type: 'Feature',
            properties: {
              layer: 'edges',
              id: e.id,
              source: e.source,
              target: e.target,
              trail_id: e.trail_id,
              trail_name: e.trail_name,
              length_km: e.length_km,
              elevation_gain: e.elevation_gain,
              elevation_loss: e.elevation_loss,
              // Styling
              color: '#4169E1',
              stroke: '#4169E1',
              'stroke-width': 2,
              'stroke-opacity': 0.6
            },
            geometry
          });
        }
      }
    } catch (error) {
      this.log(`⚠️ No routing_edges table found or error reading edges: ${error}`);
    }
  }

  private async extractRoutes(geojson: GeoJSONCollection): Promise<void> {
    try {
      const routes = this.db.prepare(`
        SELECT 
          route_uuid as id, route_uuid, region, input_length_km, input_elevation_gain,
          recommended_length_km, recommended_elevation_gain, recommended_elevation_loss,
          route_score, route_type, route_name, route_shape, trail_count,
          route_path, route_edges, created_at
        FROM route_recommendations 
        ORDER BY route_score DESC
      `).all();

      this.log(`📍 Found ${routes.length} routes`);

      for (const route of routes) {
        const r = route as any;
        if (r.route_path) {
          try {
            const routePath = JSON.parse(r.route_path);
            
            // Build route geometry from edge steps using PostGIS-style approach
            let routeCoordinates: number[][] = [];
            
            if (routePath.steps && Array.isArray(routePath.steps)) {
              // Collect all edge geometries first
              const edgeGeometries: any[] = [];
              
              for (const step of routePath.steps) {
                if (step.edge && step.edge !== "-1") {
                  const edge = this.db.prepare(`
                    SELECT geojson, source, target FROM routing_edges WHERE id = ?
                  `).get(step.edge);
                  
                  if (edge && (edge as any).geojson) {
                    const edgeGeom = JSON.parse((edge as any).geojson);
                    if (edgeGeom.coordinates && edgeGeom.coordinates.length > 0) {
                      edgeGeometries.push({
                        id: step.edge,
                        coordinates: edgeGeom.coordinates,
                        source: (edge as any).source,
                        target: (edge as any).target
                      });
                    }
                  }
                }
              }
              
              // Sort edges by their order in the route path
              const orderedEdgeIds = routePath.steps
                .filter((step: any) => step.edge && step.edge !== "-1")
                .map((step: any) => step.edge);
              
              edgeGeometries.sort((a, b) => {
                const aIndex = orderedEdgeIds.indexOf(a.id);
                const bIndex = orderedEdgeIds.indexOf(b.id);
                return aIndex - bIndex;
              });
              
              // Build continuous route geometry
              for (let i = 0; i < edgeGeometries.length; i++) {
                const edgeGeom = edgeGeometries[i];
                let edgeCoords = [...edgeGeom.coordinates];
                
                if (routeCoordinates.length > 0) {
                  // Find the best connection point
                  const lastCoord = routeCoordinates[routeCoordinates.length - 1];
                  const firstCoord = edgeCoords[0];
                  const lastCoord2 = edgeCoords[edgeCoords.length - 1];
                  
                  // Calculate distances to both ends
                  const distToFirst = Math.sqrt(
                    Math.pow(lastCoord[0] - firstCoord[0], 2) + 
                    Math.pow(lastCoord[1] - firstCoord[1], 2)
                  );
                  const distToLast = Math.sqrt(
                    Math.pow(lastCoord[0] - lastCoord2[0], 2) + 
                    Math.pow(lastCoord[1] - lastCoord2[1], 2)
                  );
                  
                  // Use a small tolerance for coordinate matching
                  const tolerance = 0.000001; // ~1 meter
                  
                  if (distToLast < tolerance && distToFirst > tolerance) {
                    // Last coordinate connects - reverse the edge
                    edgeCoords = edgeCoords.reverse();
                  } else if (distToFirst > tolerance && distToLast > tolerance) {
                    // Neither end connects well - this might be a gap
                    // Add a small line segment to connect
                    routeCoordinates.push([lastCoord[0], lastCoord[1]]);
                  }
                  
                  // Add all coordinates except the first (to avoid duplication)
                  routeCoordinates.push(...edgeCoords.slice(1));
                } else {
                  // First edge - add all coordinates
                  routeCoordinates.push(...edgeCoords);
                }
              }
            }
            
            // Only create geometry if we have coordinates
            if (routeCoordinates.length < 2) {
              continue; // Skip routes without valid geometry
            }
            
            const geometry = {
              type: 'LineString',
              coordinates: routeCoordinates
            };
            
            // Get trail composition for this route
            const trailComposition = this.getRouteTrailComposition(r.route_uuid);
            
            geojson.features.push({
              type: 'Feature',
              properties: {
                layer: 'routes',
                id: r.id,
                route_uuid: r.route_uuid,
                region: r.region,
                route_name: r.route_name,
                route_type: r.route_type,
                route_shape: r.route_shape,
                input_length_km: r.input_length_km,
                input_elevation_gain: r.input_elevation_gain,
                recommended_length_km: r.recommended_length_km,
                recommended_elevation_gain: r.recommended_elevation_gain,
                route_elevation_loss: r.route_elevation_loss,
                route_score: r.route_score,
                similarity_score: r.similarity_score,
                trail_count: r.trail_count,
                trail_composition: trailComposition.map(t => t.trail_name).join(' → '),
                trails_used: trailComposition,
                created_at: r.created_at,
                // Styling based on route quality
                color: this.getRouteColor(r.route_score),
                stroke: this.getRouteColor(r.route_score),
                'stroke-width': Math.max(2, Math.min(6, r.route_score / 20)),
                'stroke-opacity': 0.8
              },
              geometry
            });
          } catch (pathError) {
            this.log(`⚠️ Could not parse route path for route ${r.route_uuid}: ${pathError}`);
          }
        }
      }
    } catch (error) {
      this.log(`⚠️ No route_recommendations table found or error reading routes: ${error}`);
    }
  }

  private async extractSpecificRoute(geojson: GeoJSONCollection, routeId: string): Promise<void> {
    try {
      const route = this.db.prepare(`
        SELECT * FROM route_recommendations WHERE route_uuid = ?
      `).get(routeId);

      if (!route) {
        throw new Error(`Route not found: ${routeId}`);
      }

      this.log(`📍 Found route: ${(route as any).route_name || (route as any).route_uuid}`);

      // Extract the specific route
      if ((route as any).route_path) {
        const routePath = JSON.parse((route as any).route_path);
        const trailComposition = this.getRouteTrailComposition((route as any).route_uuid);
        
        geojson.features.push({
          type: 'Feature',
          properties: {
            layer: 'route',
            ...route,
            trail_composition: trailComposition.map(t => t.trail_name).join(' → '),
            trails_used: trailComposition,
            color: '#FF6B35',
            stroke: '#FF6B35',
            'stroke-width': 4,
            'stroke-opacity': 1.0
          },
          geometry: {
            type: 'LineString',
            coordinates: routePath
          }
        });
      }

      // Extract constituent trails for this route
      const routeTrails = this.getRouteTrailComposition((route as any).route_uuid);
      for (let i = 0; i < routeTrails.length; i++) {
        const rt = routeTrails[i];
        
        // Get trail geometry from trails table
        const trail = this.db.prepare(`
          SELECT geojson FROM trails WHERE app_uuid = ?
        `).get(rt.trail_id);
        
        if (trail && (trail as any).geojson) {
          const geometry = JSON.parse((trail as any).geojson);
          
          geojson.features.push({
            type: 'Feature',
            properties: {
              layer: 'route_trails',
              route_uuid: (route as any).route_uuid,
              trail_name: rt.trail_name,
              segment_order: rt.segment_order,
              segment_distance_km: rt.segment_distance_km,
              segment_elevation_gain: rt.segment_elevation_gain,
              segment_elevation_loss: rt.segment_elevation_loss,
              color: this.getSegmentColor(i, routeTrails.length),
              stroke: this.getSegmentColor(i, routeTrails.length),
              'stroke-width': 3,
              'stroke-opacity': 0.9
            },
            geometry
          });
        }
      }

    } catch (error) {
      this.log(`❌ Error extracting specific route: ${error}`);
      throw error;
    }
  }

  private getRouteTrailComposition(routeUuid: string): any[] {
    try {
      // First try the new route_analysis table
      const analysisStmt = this.db.prepare(`
        SELECT * FROM route_analysis WHERE route_uuid = ?
      `);
      
      const analysisResult = analysisStmt.get(routeUuid) as any;
      
      if (analysisResult && analysisResult.constituent_analysis_json) {
        const analysis = JSON.parse(analysisResult.constituent_analysis_json);
        
        // Map constituent trails to the expected format
        return analysis.constituent_trails?.map((trail: any, index: number) => ({
          trail_id: trail.app_uuid,
          trail_name: trail.name,
          segment_order: index + 1,
          segment_distance_km: trail.length_km,
          segment_elevation_gain: trail.elevation_gain,
          segment_elevation_loss: trail.elevation_loss,
          trail_type: trail.trail_type,
          surface: trail.surface,
          difficulty: trail.difficulty
        })) || [];
      }
      
      // Fallback to route_trails table
      return this.db.prepare(`
        SELECT 
          trail_id, trail_name, segment_order, segment_distance_km,
          segment_elevation_gain, segment_elevation_loss
        FROM route_trails 
        WHERE route_uuid = ? 
        ORDER BY segment_order
      `).all(routeUuid);
      
    } catch (error) {
      this.log(`⚠️ No route composition data found for route ${routeUuid}`);
      return [];
    }
  }

  private getTrailColor(difficulty: string): string {
    switch (difficulty?.toLowerCase()) {
      case 'easy': return '#28A745';
      case 'moderate': return '#FFC107';
      case 'hard': return '#FD7E14';
      case 'expert': return '#DC3545';
      default: return '#6C757D';
    }
  }

  private getRouteColor(score: number): string {
    if (score >= 80) return '#28A745'; // High quality - green
    if (score >= 60) return '#FFC107'; // Medium quality - yellow
    if (score >= 40) return '#FD7E14'; // Low quality - orange
    return '#DC3545'; // Poor quality - red
  }

  private getSegmentColor(index: number, total: number): string {
    const colors = [
      '#FF6B35', '#F7931E', '#FFD23F', '#06FFA5', 
      '#118AB2', '#073B4C', '#A663CC', '#FF1744'
    ];
    return colors[index % colors.length];
  }
}

// CLI handling
function parseArgs(): ExtractorOptions {
  const args = process.argv.slice(2);
  
  const getArg = (flag: string, defaultValue?: string): string => {
    const index = args.indexOf(flag);
    if (index !== -1 && index + 1 < args.length) {
      return args[index + 1];
    }
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required argument: ${flag}`);
  };

  const hasFlag = (flag: string): boolean => args.includes(flag);

  return {
    dbPath: getArg('--db'),
    outputPath: getArg('--output'),
    layer: getArg('--layer', 'all') as any,
    routeId: args.includes('--route') ? getArg('--route') : undefined,
    verbose: hasFlag('--verbose') || hasFlag('-v')
  };
}

function showUsage(): void {
  console.log(`
🗺️  SQLite to GeoJSON Extractor

Usage:
  npx ts-node tools/sqlite-to-geojson.ts --db <database> --output <file> [options]

Options:
  --db <path>         SQLite database file path
  --output <path>     Output GeoJSON file path
  --layer <type>      Layer to extract: routes, trails, nodes, edges, all (default: all)
  --route <id>        Extract specific route by UUID or ID
  --verbose, -v       Enable verbose logging

Examples:
  # Extract all routes
  npx ts-node tools/sqlite-to-geojson.ts --db data/boulder.db --output routes.geojson --layer routes

  # Extract specific route with trail composition
  npx ts-node tools/sqlite-to-geojson.ts --db data/boulder.db --route "loop-12345" --output debug-route.geojson

  # Extract full network
  npx ts-node tools/sqlite-to-geojson.ts --db data/boulder.db --output network.geojson --layer all

  # Extract just trails
  npx ts-node tools/sqlite-to-geojson.ts --db data/boulder.db --output trails.geojson --layer trails
`);
}

// Main execution
async function main(): Promise<void> {
  try {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      showUsage();
      return;
    }

    const options = parseArgs();
    const extractor = new SQLiteGeoJSONExtractor(options);
    await extractor.extract();
    
  } catch (error) {
    console.error(`❌ Error: ${(error as Error).message}`);
    console.log(`\nUse --help for usage information.`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
