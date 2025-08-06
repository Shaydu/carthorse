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
      
      // Handle route recommendations separately to avoid JSON parsing issues
      let routeRecommendations: any[] = [];
      try {
        routeRecommendations = await sqlHelpers.exportRouteRecommendations();
        
        // Add GeoJSON-specific processing for routes
        if (routeRecommendations.length > 0) {
          // Add constituent trails and geometry for GeoJSON
          const enrichedRoutes = await Promise.all(routeRecommendations.map(async (route) => {
            // Extract constituent trails from route_edges JSONB (already parsed by PostgreSQL)
            const constituentTrails = route.route_edges ? 
              route.route_edges
                .filter((edge: any) => edge.app_uuid)
                .map((edge: any) => ({
                  app_uuid: edge.app_uuid,
                  trail_name: edge.trail_name,
                  trail_type: edge.trail_type,
                  surface: edge.surface,
                  difficulty: edge.difficulty,
                  length_km: edge.trail_length_km,
                  elevation_gain: edge.trail_elevation_gain,
                  elevation_loss: edge.elevation_loss,
                  max_elevation: edge.max_elevation,
                  min_elevation: edge.min_elevation,
                  avg_elevation: edge.avg_elevation
                })) : [];

            // Generate geometry from route edges
            const edgeIds = route.route_edges ? 
              route.route_edges.map((edge: any) => edge.id) : [];
            
            let geometry = null;
            if (edgeIds.length > 0) {
              const geometryResult = await pgClient.query(`
                SELECT ST_AsGeoJSON(
                  ST_Simplify(
                    ST_LineMerge(
                      ST_Collect(
                        ARRAY(
                          SELECT e.geometry 
                          FROM ${config.stagingSchema}.routing_edges e 
                          WHERE e.id = ANY($1::int[])
                        )
                      )
                    ),
                    0.0001
                  )
                ) as geojson
              `, [edgeIds]);
              
              geometry = geometryResult.rows[0]?.geojson;
            }

            return {
              ...route,
              constituent_trails: constituentTrails,
              geojson: geometry
            };
          }));

          routeRecommendations = enrichedRoutes;
          console.log(`✅ Successfully exported ${routeRecommendations.length} routes with GeoJSON geometry`);
        }
              } catch (error) {
          console.log('📊 No route recommendations to export (this is normal when no routes are generated)');
          console.log('Error details:', error instanceof Error ? error.message : String(error));
          routeRecommendations = [];
        }
      
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
        let size = 1; // 50% smaller (was 2)
        
        if (row.node_type === 'intersection') {
          color = '#ff0000'; // Red for intersections
          size = 1.5; // 50% smaller (was 3)
        } else if (row.node_type === 'endpoint') {
          color = '#00ff00'; // Green for endpoints
          size = 1.5; // 50% smaller (was 3)
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
          recommended_length_km: row.recommended_length_km,
          recommended_elevation_gain: row.recommended_elevation_gain,
          trail_count: row.trail_count,
          route_score: row.route_score,
          similarity_score: row.similarity_score,
          region: row.region,
          constituent_trails: row.constituent_trails || [],
          color: '#ff8800', // Orange for route recommendations
          size: 50, // Much wider for maximum visibility
          lineStyle: 'dotted', // Dotted line style
          weight: 50, // Additional weight property for some viewers
          strokeWidth: 50, // Stroke width for some viewers
          strokeColor: '#ff8800', // Explicit stroke color
          strokeOpacity: 1.0, // Full opacity
          strokeDasharray: '20,10', // Larger dotted pattern
          zIndex: 1000, // Ensure routes are on top
          opacity: 1.0, // Full opacity
          fillOpacity: 0.8 // Fill opacity for some viewers
        },
        geometry: JSON.parse(row.geojson)
      })) : [];

      // Create GeoJSON collection - ROUTES FIRST for top layer visibility
      const geojson = {
        type: 'FeatureCollection',
        features: [...routeFeatures, ...trailFeatures, ...nodeFeatures, ...edgeFeatures]
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
      const { createSqliteTables, insertTrails, insertRoutingNodes, insertRoutingEdges, insertRouteRecommendations, insertSchemaVersion } = await import('../sqlite-export-helpers');
      
      // Export data from staging schema
      const sqlHelpers = new ExportSqlHelpers(pgClient, config.stagingSchema);
      
      // Get all data from staging schema
      const trails = await sqlHelpers.exportTrailsForGeoJSON();
      const nodes = await sqlHelpers.exportRoutingNodesForGeoJSON();
      const edges = await sqlHelpers.exportRoutingEdgesForGeoJSON();
      
      // Handle route recommendations separately to avoid JSON parsing issues
      let routeRecommendations: any[] = [];
      try {
        routeRecommendations = await sqlHelpers.exportRouteRecommendations();
        console.log(`✅ Successfully exported ${routeRecommendations.length} routes to SQLite`);
      } catch (error) {
        console.log('📊 No route recommendations to export (this is normal when no routes are generated)');
        routeRecommendations = [];
      }
      
      // Create SQLite database
      const db = new (await import('better-sqlite3')).default(config.outputPath);
      
      // Create tables
      createSqliteTables(db);
      
      // Insert schema version
      const { CARTHORSE_SCHEMA_VERSION } = await import('../sqlite-export-helpers');
      insertSchemaVersion(db, CARTHORSE_SCHEMA_VERSION, 'Carthorse SQLite Export v14.0 (Enhanced Route Recommendations + Trail Composition)');
      
      // Export trails from staging schema
      const trailsResult = await pgClient.query(`
        SELECT 
          app_uuid, name, region, osm_id, 'way' as osm_type, trail_type, surface as surface_type, 
          CASE 
            WHEN difficulty = 'unknown' THEN 'moderate'
            ELSE difficulty
          END as difficulty,
          ST_AsGeoJSON(geometry, 6, 1) as geojson,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          created_at, updated_at
        FROM ${config.stagingSchema}.trails
        WHERE geometry IS NOT NULL
        ORDER BY name
      `);
      
      // Also get all unique trail IDs from routing edges to ensure we export all referenced trails
      const routingTrailsResult = await pgClient.query(`
        SELECT DISTINCT trail_id as app_uuid
        FROM ${config.stagingSchema}.routing_edges
        WHERE trail_id IS NOT NULL AND trail_id != ''
      `);
      
      const routingTrailIds = new Set(routingTrailsResult.rows.map(row => row.app_uuid));
      const exportedTrailIds = new Set(trailsResult.rows.map(row => row.app_uuid));
      
      // Find trails that are in routing edges but not in the main trails export
      const missingTrailIds = Array.from(routingTrailIds).filter(id => !exportedTrailIds.has(id));
      
      if (missingTrailIds.length > 0) {
        console.log(`[SQLITE] Found ${missingTrailIds.length} trails referenced in routing edges that need to be exported`);
        
        // Get the missing trails from the routing edges (with trail metadata)
        const missingTrailsResult = await pgClient.query(`
          SELECT DISTINCT
            re.trail_id as app_uuid,
            re.trail_name as name,
            'unknown' as region,
            NULL as osm_id,
            'way' as osm_type,
            'hiking' as trail_type,
            'unknown' as surface_type,
            'moderate' as difficulty,
            ST_AsGeoJSON(re.geometry, 6, 1) as geojson,
            re.length_km,
            re.elevation_gain,
            COALESCE(re.elevation_loss, 0) as elevation_loss,
            0 as max_elevation,
            0 as min_elevation,
            0 as avg_elevation,
            NULL as bbox_min_lng,
            NULL as bbox_max_lng,
            NULL as bbox_min_lat,
            NULL as bbox_max_lat,
            NOW() as created_at,
            NOW() as updated_at
          FROM ${config.stagingSchema}.routing_edges re
          WHERE re.trail_id = ANY($1)
        `, [missingTrailIds]);
        
        if (missingTrailsResult.rows.length > 0) {
          // Combine all trails
          const allTrails = [...trailsResult.rows, ...missingTrailsResult.rows];
          insertTrails(db, allTrails);
          console.log(`[SQLITE] ✅ Exported ${allTrails.length} total trails (${trailsResult.rows.length} from main table + ${missingTrailsResult.rows.length} from routing edges)`);
        } else {
          insertTrails(db, trailsResult.rows);
          console.log(`[SQLITE] ✅ Exported ${trailsResult.rows.length} trails from main table`);
        }
      } else {
        insertTrails(db, trailsResult.rows);
        console.log(`[SQLITE] ✅ Exported ${trailsResult.rows.length} trails from main table`);
      }
      
      insertRoutingNodes(db, nodes.map(n => ({
        ...n,
        geometry: JSON.parse(n.geojson)
      })));
      insertRoutingEdges(db, edges.map(e => ({
        ...e,
        geometry: JSON.parse(e.geojson)
      })));
      
      // Insert route recommendations and constituent trail data
      if (routeRecommendations.length > 0) {
        const { insertRouteRecommendations, insertRouteTrails } = await import('../sqlite-export-helpers');
        
        // Insert route recommendations
        insertRouteRecommendations(db, routeRecommendations);
        
        // Extract and insert constituent trail data for each route
        const routeTrails: any[] = [];
        
        // Get unique trail UUIDs that need name lookup
        const trailUuids = new Set<string>();
        for (const route of routeRecommendations) {
          if (route.constituent_trails && Array.isArray(route.constituent_trails)) {
            route.constituent_trails.forEach((trail: any) => {
              if (trail.app_uuid && (!trail.name || trail.name.startsWith('Trail '))) {
                trailUuids.add(trail.app_uuid);
              }
            });
          }
        }
        
        // Lookup trail names from public database if needed
        let trailNameMap = new Map<string, string>();
        if (trailUuids.size > 0) {
          console.log(`🔍 Looking up ${trailUuids.size} trail names from public database...`);
          const trailNamesResult = await pgClient.query(`
            SELECT app_uuid, name 
            FROM public.trails 
            WHERE app_uuid = ANY($1::uuid[])
          `, [Array.from(trailUuids)]);
          
          trailNamesResult.rows.forEach((row: any) => {
            trailNameMap.set(row.app_uuid, row.name);
          });
          console.log(`✅ Found ${trailNameMap.size} trail names`);
        }
        
        // Get all trail IDs that exist in the SQLite database
        const existingTrailIds = new Set(trails.map(t => t.app_uuid));
        console.log(`[SQLITE] Found ${existingTrailIds.size} unique trail IDs in database`);
        
        for (const route of routeRecommendations) {
          if (route.constituent_trails && Array.isArray(route.constituent_trails)) {
            route.constituent_trails.forEach((trail: any, index: number) => {
              // Only include trails that exist in the SQLite database
              if (!existingTrailIds.has(trail.app_uuid)) {
                console.log(`[SQLITE] ⚠️ Skipping route trail segment for non-existent trail: ${trail.app_uuid}`);
                return;
              }
              
              // Use existing name, lookup from public DB, or fallback to UUID
              let trailName = trail.name;
              if (!trailName || trailName.startsWith('Trail ')) {
                trailName = trailNameMap.get(trail.app_uuid) || `Trail ${trail.app_uuid || 'Unknown'}`;
              }
              
              routeTrails.push({
                route_uuid: route.route_uuid,
                trail_id: trail.app_uuid, // Use app_uuid consistently since that's what's in the trails table
                trail_name: trailName,
                segment_order: index + 1,
                segment_distance_km: trail.distance_km || trail.length_km,
                segment_elevation_gain: trail.elevation_gain,
                segment_elevation_loss: trail.elevation_loss || 0,
                created_at: new Date().toISOString()
              });
            });
          }
        }
        
        if (routeTrails.length > 0) {
          insertRouteTrails(db, routeTrails);
        }
      }
      
      db.close();
      
      console.log(`✅ SQLite export completed:`);
      console.log(`   📁 File: ${config.outputPath}`);
      console.log(`   🗺️ Trails: ${trails.length}`);
      console.log(`   📍 Nodes: ${nodes.length}`);
      console.log(`   🛤️ Edges: ${edges.length}`);
      console.log(`   🛣️ Routes: ${routeRecommendations.length}`);

      return {
        success: true,
        message: `SQLite export completed successfully`,
        data: {
          trails: trails.length,
          nodes: nodes.length,
          edges: edges.length,
          routes: routeRecommendations.length
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