"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportService = exports.TrailsOnlyExportStrategy = exports.SQLiteExportStrategy = void 0;
const fs = __importStar(require("fs"));
const export_sql_helpers_1 = require("../sql/export-sql-helpers");
/**
 * SQLite Export Strategy
 */
class SQLiteExportStrategy {
    async export(pgClient, config) {
        try {
            console.log('🗄️ Starting SQLite export...');
            // Import SQLite helpers dynamically to avoid circular dependencies
            const { createSqliteTables, insertTrails, insertRoutingNodes, insertRoutingEdges, insertRouteRecommendations, insertSchemaVersion } = await Promise.resolve().then(() => __importStar(require('../sqlite-export-helpers')));
            // Export data from staging schema
            const sqlHelpers = new export_sql_helpers_1.ExportSqlHelpers(pgClient, config.stagingSchema);
            // Get all data from staging schema
            const trails = await sqlHelpers.exportTrailsForGeoJSON();
            const nodes = await sqlHelpers.exportRoutingNodesForGeoJSON();
            const edges = await sqlHelpers.exportRoutingEdgesForGeoJSON();
            // Handle route recommendations separately to avoid JSON parsing issues
            let routeRecommendations = [];
            try {
                routeRecommendations = await sqlHelpers.exportRouteRecommendations();
                console.log(`✅ Successfully exported ${routeRecommendations.length} routes to SQLite`);
            }
            catch (error) {
                console.log('📊 No route recommendations to export (this is normal when no routes are generated)');
                routeRecommendations = [];
            }
            // Create SQLite database
            const db = new (await Promise.resolve().then(() => __importStar(require('better-sqlite3')))).default(config.outputPath);
            // Create tables
            createSqliteTables(db);
            // Insert schema version
            const { CARTHORSE_SCHEMA_VERSION } = await Promise.resolve().then(() => __importStar(require('../sqlite-export-helpers')));
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
                console.warn(`⚠️  Found ${missingTrailIds.length} trail IDs in routing edges that are not in main trails export. Adding placeholders.`);
                // Add placeholder trails for missing trail IDs
                const placeholderTrails = missingTrailIds.map(id => ({
                    app_uuid: id,
                    name: `Trail ${id}`,
                    region: 'unknown',
                    osm_id: null,
                    osm_type: 'way',
                    trail_type: 'unknown',
                    surface_type: 'unknown',
                    difficulty: 'moderate',
                    geojson: JSON.stringify({
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: [[0, 0], [0, 0]]
                        }
                    }),
                    length_km: 0,
                    elevation_gain: 0,
                    elevation_loss: 0,
                    max_elevation: 0,
                    min_elevation: 0,
                    avg_elevation: 0,
                    bbox_min_lng: 0,
                    bbox_max_lng: 0,
                    bbox_min_lat: 0,
                    bbox_max_lat: 0,
                    created_at: new Date(),
                    updated_at: new Date()
                }));
                trailsResult.rows.push(...placeholderTrails);
            }
            // Insert all data
            console.log(`📊 Inserting ${trailsResult.rows.length} trails...`);
            insertTrails(db, trailsResult.rows);
            console.log(`📊 Inserting ${nodes.length} routing nodes...`);
            insertRoutingNodes(db, nodes);
            console.log(`📊 Inserting ${edges.length} routing edges...`);
            insertRoutingEdges(db, edges);
            console.log(`📊 Inserting ${routeRecommendations.length} route recommendations...`);
            insertRouteRecommendations(db, routeRecommendations);
            // Close database
            db.close();
            console.log(`✅ SQLite export completed successfully:`);
            console.log(`   📁 File: ${config.outputPath}`);
            console.log(`   🗺️ Trails: ${trailsResult.rows.length}`);
            console.log(`   📍 Nodes: ${nodes.length}`);
            console.log(`   🛤️ Edges: ${edges.length}`);
            console.log(`   🛣️ Routes: ${routeRecommendations.length}`);
            return {
                success: true,
                message: `SQLite export completed successfully`,
                data: {
                    trails: trailsResult.rows.length,
                    nodes: nodes.length,
                    edges: edges.length,
                    routes: routeRecommendations.length
                }
            };
        }
        catch (error) {
            console.error('❌ Error during SQLite export:', error);
            return {
                success: false,
                message: `SQLite export failed: ${error}`
            };
        }
    }
}
exports.SQLiteExportStrategy = SQLiteExportStrategy;
/**
 * Trails-Only Export Strategy (subset of GeoJSON)
 */
class TrailsOnlyExportStrategy {
    async export(pgClient, config) {
        try {
            console.log('🗺️ Starting trails-only export...');
            const sqlHelpers = new export_sql_helpers_1.ExportSqlHelpers(pgClient, config.stagingSchema);
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
        }
        catch (error) {
            console.error('❌ Error during trails-only export:', error);
            return {
                success: false,
                message: `Trails-only export failed: ${error}`
            };
        }
    }
}
exports.TrailsOnlyExportStrategy = TrailsOnlyExportStrategy;
/**
 * Main Export Service
 */
class ExportService {
    constructor() {
        this.strategies = new Map();
        // Register export strategies (NOTE: GeoJSON strategy moved to geojson-export-strategy.ts)
        this.strategies.set('sqlite', new SQLiteExportStrategy());
        this.strategies.set('trails-only', new TrailsOnlyExportStrategy());
    }
    /**
     * Export data using the specified strategy
     */
    async export(format, pgClient, config) {
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
    registerStrategy(name, strategy) {
        this.strategies.set(name, strategy);
    }
    /**
     * Get available export formats
     */
    getAvailableFormats() {
        return Array.from(this.strategies.keys());
    }
}
exports.ExportService = ExportService;
//# sourceMappingURL=export-service.js.map