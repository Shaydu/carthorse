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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SQLiteExportStrategy = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs = __importStar(require("fs"));
class SQLiteExportStrategy {
    constructor(pgClient, config, stagingSchema) {
        this.pgClient = pgClient;
        this.config = config;
        this.stagingSchema = stagingSchema;
    }
    log(message) {
        if (this.config.verbose) {
            console.log(`[SQLite Export] ${message}`);
        }
    }
    /**
     * Export all data from staging schema to SQLite
     */
    async exportFromStaging() {
        console.log(`📦 Exporting from staging schema to SQLite: ${this.config.outputPath}`);
        const result = {
            trailsExported: 0,
            nodesExported: 0,
            edgesExported: 0,
            dbSizeMB: 0,
            isValid: false,
            errors: []
        };
        try {
            // Create SQLite database
            const sqliteDb = new better_sqlite3_1.default(this.config.outputPath);
            // Create tables first
            this.createSqliteTables(sqliteDb);
            // Clear existing data
            sqliteDb.exec(`
        DELETE FROM trails;
        DELETE FROM routing_nodes;
        DELETE FROM routing_edges;
        DELETE FROM route_recommendations;
        DELETE FROM route_trails;
        DELETE FROM route_summaries;
        DELETE FROM region_metadata;
        DELETE FROM schema_version;
      `);
            // Export trails
            if (this.config.includeTrails !== false) {
                result.trailsExported = await this.exportTrails(sqliteDb);
                this.log(`✅ Exported ${result.trailsExported} trails`);
            }
            // Export nodes
            if (this.config.includeNodes) {
                result.nodesExported = await this.exportNodes(sqliteDb);
                this.log(`✅ Exported ${result.nodesExported} nodes`);
            }
            // Export edges
            if (this.config.includeEdges) {
                result.edgesExported = await this.exportEdges(sqliteDb);
                this.log(`✅ Exported ${result.edgesExported} edges`);
            }
            // Export recommendations
            if (this.config.includeRecommendations) {
                result.recommendationsExported = await this.exportRecommendations(sqliteDb);
                this.log(`✅ Exported ${result.recommendationsExported} recommendations`);
            }
            // Export route_trails relationships
            if (this.config.includeRecommendations) {
                const routeTrailsExported = await this.exportRouteTrails(sqliteDb);
                this.log(`✅ Exported ${routeTrailsExported} route_trails relationships`);
            }
            else {
                const routeTrailsExported = 0;
            }
            // Export route summaries with pre-calculated statistics
            if (this.config.includeRecommendations) {
                const routeSummariesExported = await this.exportRouteSummaries(sqliteDb);
                this.log(`✅ Exported ${routeSummariesExported} route summaries`);
            }
            else {
                const routeSummariesExported = 0;
            }
            // Insert region metadata
            await this.insertRegionMetadata(sqliteDb, result);
            // Insert schema version
            this.insertSchemaVersion(sqliteDb);
            // Close SQLite database
            sqliteDb.close();
            // Check database size
            const stats = fs.statSync(this.config.outputPath);
            result.dbSizeMB = stats.size / (1024 * 1024);
            console.log(`✅ SQLite export completed:`);
            console.log(`   - Trails: ${result.trailsExported}`);
            console.log(`   - Nodes: ${result.nodesExported}`);
            console.log(`   - Edges: ${result.edgesExported}`);
            if (result.recommendationsExported) {
                console.log(`   - Route Recommendations: ${result.recommendationsExported}`);
            }
            console.log(`   - Size: ${result.dbSizeMB.toFixed(2)} MB`);
            result.isValid = true;
        }
        catch (error) {
            const errorMsg = `SQLite export failed: ${error instanceof Error ? error.message : String(error)}`;
            console.error(`❌ ${errorMsg}`);
            result.errors.push(errorMsg);
            result.isValid = false;
        }
        return result;
    }
    /**
     * Create SQLite tables
     */
    createSqliteTables(db) {
        // Create trails table (v14 schema)
        db.exec(`
      CREATE TABLE IF NOT EXISTS trails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        osm_id TEXT,
        osm_type TEXT,
        length_km REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        difficulty TEXT,
        surface_type TEXT,
        trail_type TEXT,
        geojson TEXT,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        created_at TEXT,
        updated_at TEXT
      )
    `);
        // Create routing_nodes table (v14 schema)
        db.exec(`
      CREATE TABLE IF NOT EXISTS routing_nodes (
        id INTEGER PRIMARY KEY,
        node_uuid TEXT UNIQUE,
        lat REAL,
        lng REAL,
        elevation REAL,
        node_type TEXT,
        connected_trails TEXT,
        geojson TEXT,
        created_at TEXT
      )
    `);
        // Create routing_edges table
        db.exec(`
      CREATE TABLE IF NOT EXISTS routing_edges (
        id INTEGER PRIMARY KEY,
        source INTEGER NOT NULL,
        target INTEGER NOT NULL,
        trail_id TEXT NOT NULL,
        trail_name TEXT NOT NULL,
        length_km REAL NOT NULL,
        elevation_gain REAL,
        elevation_loss REAL,
        geojson TEXT,
        created_at TEXT
      )
    `);
        // Create route_recommendations table (v14 schema)
        db.exec(`
      CREATE TABLE IF NOT EXISTS route_recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_uuid TEXT UNIQUE NOT NULL,
        region TEXT NOT NULL,
        input_length_km REAL,
        input_elevation_gain REAL,
        recommended_length_km REAL,
        recommended_elevation_gain REAL,
        route_elevation_loss REAL,
        route_score REAL,
        route_type TEXT,
        route_name TEXT,
        route_shape TEXT,
        trail_count INTEGER,
        route_path TEXT,
        route_edges TEXT,
        similarity_score REAL,
        created_at TEXT,
        input_distance_tolerance REAL,
        input_elevation_tolerance REAL,
        expires_at TEXT,
        usage_count INTEGER,
        complete_route_data TEXT,
        trail_connectivity_data TEXT,
        request_hash TEXT,
        route_gain_rate REAL,
        route_trail_count INTEGER,
        route_max_elevation REAL,
        route_min_elevation REAL,
        route_avg_elevation REAL,
        route_difficulty TEXT,
        route_estimated_time_hours REAL,
        route_connectivity_score REAL
      )
    `);
        // Create route_trails table (links routes to their constituent trails)
        db.exec(`
      CREATE TABLE IF NOT EXISTS route_trails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_uuid TEXT NOT NULL,
        trail_id TEXT NOT NULL,
        trail_name TEXT,
        segment_order INTEGER NOT NULL,
        segment_distance_km REAL,
        segment_elevation_gain REAL,
        segment_elevation_loss REAL,
        created_at TEXT
      )
    `);
        // Create region_metadata table (v14 schema)
        db.exec(`
      CREATE TABLE IF NOT EXISTS region_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        region TEXT UNIQUE NOT NULL,
        total_trails INTEGER,
        total_nodes INTEGER,
        total_edges INTEGER,
        total_routes INTEGER,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        created_at TEXT,
        updated_at TEXT
      )
    `);
        // Create schema_version table (v14 schema)
        db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER UNIQUE NOT NULL,
        description TEXT,
        created_at TEXT
      )
    `);
        // Create performance indexes
        db.exec(`
      CREATE INDEX IF NOT EXISTS idx_trails_name ON trails(name);
      CREATE INDEX IF NOT EXISTS idx_trails_length ON trails(length_km);
      CREATE INDEX IF NOT EXISTS idx_trails_elevation ON trails(elevation_gain);
      CREATE INDEX IF NOT EXISTS idx_routing_nodes_coords ON routing_nodes(lat, lng);
      CREATE INDEX IF NOT EXISTS idx_routing_nodes_elevation ON routing_nodes(elevation);
      CREATE INDEX IF NOT EXISTS idx_routing_nodes_type ON routing_nodes(node_type);
      CREATE INDEX IF NOT EXISTS idx_routing_edges_source_target ON routing_edges(source, target);
      CREATE INDEX IF NOT EXISTS idx_routing_edges_trail ON routing_edges(trail_id);
      CREATE INDEX IF NOT EXISTS idx_routing_edges_length ON routing_edges(length_km);
    `);
        // Create route_summaries table for pre-calculated route statistics
        db.exec(`
      CREATE TABLE IF NOT EXISTS route_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_uuid TEXT UNIQUE NOT NULL,
        route_name TEXT NOT NULL,
        total_distance_km REAL NOT NULL,
        total_elevation_gain REAL NOT NULL,
        total_elevation_loss REAL NOT NULL,
        unique_trail_count INTEGER NOT NULL,
        total_trail_segments INTEGER NOT NULL,
        route_type TEXT NOT NULL,
        route_shape TEXT NOT NULL,
        route_score REAL NOT NULL,
        out_and_back_distance_km REAL NOT NULL,
        out_and_back_elevation_gain REAL NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (route_uuid) REFERENCES route_recommendations(route_uuid)
      )
    `);
        // Create indexes for route_summaries
        db.exec(`
      CREATE INDEX IF NOT EXISTS idx_route_summaries_distance ON route_summaries(total_distance_km);
      CREATE INDEX IF NOT EXISTS idx_route_summaries_elevation ON route_summaries(total_elevation_gain);
      CREATE INDEX IF NOT EXISTS idx_route_summaries_trail_count ON route_summaries(unique_trail_count);
      CREATE INDEX IF NOT EXISTS idx_route_summaries_type ON route_summaries(route_type);
      CREATE INDEX IF NOT EXISTS idx_route_summaries_shape ON route_summaries(route_shape);
    `);
    }
    /**
     * Export trails from staging schema
     */
    async exportTrails(db) {
        const trailsResult = await this.pgClient.query(`
      SELECT DISTINCT ON (app_uuid)
        app_uuid, name, region, osm_id, 'way' as osm_type, trail_type, surface as surface_type, 
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
      ORDER BY app_uuid, name
    `, [this.config.region]);
        if (trailsResult.rows.length === 0) {
            throw new Error('No trails found to export');
        }
        // Insert trails into SQLite
        const insertTrails = db.prepare(`
      INSERT INTO trails (
        app_uuid, name, region, osm_id, osm_type, length_km, elevation_gain, elevation_loss, 
        max_elevation, min_elevation, avg_elevation, difficulty, surface_type, trail_type,
        geojson, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const insertMany = db.transaction((trails) => {
            for (const trail of trails) {
                insertTrails.run(trail.app_uuid, trail.name, trail.region, trail.osm_id, trail.osm_type, trail.length_km, trail.elevation_gain, trail.elevation_loss, trail.max_elevation, trail.min_elevation, trail.avg_elevation, trail.difficulty, trail.surface_type, trail.trail_type, trail.geojson, trail.bbox_min_lng, trail.bbox_max_lng, trail.bbox_min_lat, trail.bbox_max_lat, trail.created_at ? (typeof trail.created_at === 'string' ? trail.created_at : trail.created_at.toISOString()) : new Date().toISOString(), trail.updated_at ? (typeof trail.updated_at === 'string' ? trail.updated_at : trail.updated_at.toISOString()) : new Date().toISOString());
            }
        });
        insertMany(trailsResult.rows);
        return trailsResult.rows.length;
    }
    /**
     * Export nodes from staging schema
     */
    async exportNodes(db) {
        try {
            this.log(`🔍 Attempting to export nodes from ${this.stagingSchema}.ways_noded_vertices_pgr`);
            // First, let's check if the table exists
            const tableCheck = await this.pgClient.query(`
        SELECT COUNT(*) as table_count 
        FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'ways_noded_vertices_pgr'
      `, [this.stagingSchema]);
            this.log(`🔍 Table check result: ${tableCheck.rows[0].table_count} tables found`);
            const nodesResult = await this.pgClient.query(`
        SELECT 
          id, 
          id as node_uuid, 
          ST_Y(the_geom) as lat, 
          ST_X(the_geom) as lng, 
          0 as elevation, 
          'intersection' as node_type, 
          '' as connected_trails,
          ST_AsGeoJSON(the_geom, 6, 1) as geojson,
          NOW() as created_at
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr
        ORDER BY id
      `);
            if (nodesResult.rows.length === 0) {
                this.log(`⚠️  No nodes found in ways_noded_vertices_pgr`);
                return 0;
            }
            // Insert nodes into SQLite
            const insertNodes = db.prepare(`
        INSERT INTO routing_nodes (
          id, node_uuid, lat, lng, elevation, node_type, connected_trails, geojson, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            const insertMany = db.transaction((nodes) => {
                for (const node of nodes) {
                    insertNodes.run(node.id, node.node_uuid, node.lat, node.lng, node.elevation, node.node_type, node.connected_trails, node.geojson, node.created_at ? (typeof node.created_at === 'string' ? node.created_at : node.created_at.toISOString()) : new Date().toISOString());
                }
            });
            insertMany(nodesResult.rows);
            return nodesResult.rows.length;
        }
        catch (error) {
            this.log(`⚠️  ways_noded_vertices_pgr table not found, skipping nodes export`);
            return 0;
        }
    }
    /**
     * Export edges from staging schema
     */
    async exportEdges(db) {
        try {
            this.log(`🔍 Attempting to export edges from ${this.stagingSchema}.ways_noded`);
            // First, let's check if the table exists
            const tableCheck = await this.pgClient.query(`
        SELECT COUNT(*) as table_count 
        FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'ways_noded'
      `, [this.stagingSchema]);
            this.log(`🔍 Table check result: ${tableCheck.rows[0].table_count} tables found`);
            if (tableCheck.rows[0].table_count === 0) {
                this.log(`⚠️  ways_noded table not found, creating edges from trails data`);
                // Create edges from trails data as a fallback
                const edgesResult = await this.pgClient.query(`
          SELECT 
            ROW_NUMBER() OVER (ORDER BY app_uuid) as id,
            1 as source,
            2 as target,
            app_uuid as trail_id, 
            name as trail_name,
            length_km, 
            elevation_gain, 
            elevation_loss,
            ST_AsGeoJSON(geometry, 6, 1) as geojson,
            NOW() as created_at
          FROM ${this.stagingSchema}.trails
          WHERE region = $1 AND geometry IS NOT NULL
          ORDER BY app_uuid
        `, [this.config.region]);
                if (edgesResult.rows.length === 0) {
                    this.log(`⚠️  No trails found to create edges from`);
                    return 0;
                }
                // Insert edges into SQLite
                const insertEdges = db.prepare(`
          INSERT INTO routing_edges (
            id, source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geojson, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
                const insertMany = db.transaction((edges) => {
                    for (const edge of edges) {
                        insertEdges.run(edge.id, edge.source, edge.target, edge.trail_id, edge.trail_name, edge.length_km, edge.elevation_gain, edge.elevation_loss, edge.geojson, edge.created_at ? (typeof edge.created_at === 'string' ? edge.created_at : edge.created_at.toISOString()) : new Date().toISOString());
                    }
                });
                insertMany(edgesResult.rows);
                this.log(`✅ Created ${edgesResult.rows.length} edges from trails data`);
                return edgesResult.rows.length;
            }
            const edgesResult = await this.pgClient.query(`
        SELECT 
          id, source, target, app_uuid as trail_id, name as trail_name,
          length_km, elevation_gain, elevation_loss,
          ST_AsGeoJSON(the_geom, 6, 1) as geojson,
          NOW() as created_at
        FROM ${this.stagingSchema}.ways_noded
        ORDER BY id
      `);
            if (edgesResult.rows.length === 0) {
                this.log(`⚠️  No edges found in ways_noded`);
                return 0;
            }
            // Insert edges into SQLite
            const insertEdges = db.prepare(`
        INSERT INTO routing_edges (
          id, source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geojson, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            const insertMany = db.transaction((edges) => {
                for (const edge of edges) {
                    insertEdges.run(edge.id, edge.source, edge.target, edge.trail_id, edge.trail_name, edge.length_km, edge.elevation_gain, edge.elevation_loss, edge.geojson, edge.created_at ? (typeof edge.created_at === 'string' ? edge.created_at : edge.created_at.toISOString()) : new Date().toISOString());
                }
            });
            insertMany(edgesResult.rows);
            return edgesResult.rows.length;
        }
        catch (error) {
            this.log(`⚠️  ways_noded table not found, skipping edges export`);
            return 0;
        }
    }
    /**
     * Export recommendations from staging schema
     */
    async exportRecommendations(db) {
        try {
            this.log(`🔍 Attempting to export recommendations from ${this.stagingSchema}.route_recommendations`);
            // First, let's check if the table exists
            const tableCheck = await this.pgClient.query(`
        SELECT COUNT(*) as table_count 
        FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'route_recommendations'
      `, [this.stagingSchema]);
            this.log(`🔍 Recommendations table check result: ${tableCheck.rows[0].table_count} tables found`);
            const recommendationsResult = await this.pgClient.query(`
        SELECT 
          route_uuid, region, input_length_km, input_elevation_gain,
          recommended_length_km, recommended_elevation_gain, 0 as route_elevation_loss,
          route_score, route_type, route_name, route_shape, trail_count,
          route_path, route_edges, 0.0 as similarity_score, created_at,
          0.0 as input_distance_tolerance, 0.0 as input_elevation_tolerance, NULL as expires_at,
          0 as usage_count, '' as complete_route_data, '' as trail_connectivity_data,
          '' as request_hash, 0.0 as route_gain_rate, trail_count as route_trail_count,
          0.0 as route_max_elevation, 0.0 as route_min_elevation, 0.0 as route_avg_elevation,
          'moderate' as route_difficulty, 0.0 as route_estimated_time_hours, 0.0 as route_connectivity_score
        FROM ${this.stagingSchema}.route_recommendations
        ORDER BY created_at DESC
      `);
            if (recommendationsResult.rows.length === 0) {
                this.log(`⚠️  No recommendations found in route_recommendations`);
                return 0;
            }
            // Insert recommendations into SQLite
            const insertRecommendations = db.prepare(`
        INSERT INTO route_recommendations (
          route_uuid, region, input_length_km, input_elevation_gain,
          recommended_length_km, recommended_elevation_gain, route_elevation_loss,
          route_score, route_type, route_name, route_shape, trail_count,
          route_path, route_edges, similarity_score, created_at,
          input_distance_tolerance, input_elevation_tolerance, expires_at,
          usage_count, complete_route_data, trail_connectivity_data,
          request_hash, route_gain_rate, route_trail_count,
          route_max_elevation, route_min_elevation, route_avg_elevation,
          route_difficulty, route_estimated_time_hours, route_connectivity_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            const insertMany = db.transaction((recommendations) => {
                for (const rec of recommendations) {
                    insertRecommendations.run(rec.route_uuid, rec.region, rec.input_length_km, rec.input_elevation_gain, rec.recommended_length_km, rec.recommended_elevation_gain, rec.route_elevation_loss, rec.route_score, rec.route_type, rec.route_name, rec.route_shape, rec.trail_count, rec.route_path ? JSON.stringify(rec.route_path) : null, rec.route_edges ? JSON.stringify(rec.route_edges) : null, rec.similarity_score, rec.created_at ? (typeof rec.created_at === 'string' ? rec.created_at : rec.created_at.toISOString()) : new Date().toISOString(), rec.input_distance_tolerance, rec.input_elevation_tolerance, rec.expires_at ? (typeof rec.expires_at === 'string' ? rec.expires_at : rec.expires_at.toISOString()) : null, rec.usage_count, rec.complete_route_data, rec.trail_connectivity_data, rec.request_hash, rec.route_gain_rate, rec.route_trail_count, rec.route_max_elevation, rec.route_min_elevation, rec.route_avg_elevation, rec.route_difficulty, rec.route_estimated_time_hours, rec.route_connectivity_score);
                }
            });
            insertMany(recommendationsResult.rows);
            return recommendationsResult.rows.length;
        }
        catch (error) {
            this.log(`⚠️  route_recommendations table not found, skipping recommendations export`);
            return 0;
        }
    }
    /**
     * Export route_trails relationships
     */
    async exportRouteTrails(db) {
        try {
            this.log(`🔍 Attempting to export route_trails relationships`);
            // Get routes with their edge data
            const routesResult = await this.pgClient.query(`
        SELECT route_uuid, route_edges, route_path
        FROM ${this.stagingSchema}.route_recommendations
        WHERE route_edges IS NOT NULL AND route_edges != 'null'
        LIMIT 1000
      `);
            if (routesResult.rows.length === 0) {
                this.log(`⚠️  No routes with edge data found`);
                return 0;
            }
            // Get all trails for lookup
            const trailsResult = await this.pgClient.query(`
        SELECT app_uuid, name, length_km, elevation_gain, elevation_loss
        FROM ${this.stagingSchema}.trails
        WHERE region = $1
      `, [this.config.region]);
            const trailsMap = new Map();
            trailsResult.rows.forEach(trail => {
                trailsMap.set(trail.app_uuid, trail);
            });
            // Get all edge_trails relationships for lookup
            const edgeTrailsResult = await this.pgClient.query(`
        SELECT et.edge_id, et.trail_id, et.trail_order, et.trail_segment_length_km, et.trail_segment_elevation_gain
        FROM ${this.stagingSchema}.edge_trails et
        JOIN ${this.stagingSchema}.ways_noded wn ON et.edge_id = wn.id
        WHERE et.trail_id IS NOT NULL
      `);
            const edgeTrailsMap = new Map();
            edgeTrailsResult.rows.forEach(et => {
                if (!edgeTrailsMap.has(et.edge_id)) {
                    edgeTrailsMap.set(et.edge_id, []);
                }
                edgeTrailsMap.get(et.edge_id).push(et);
            });
            // Insert route_trails into SQLite
            const insertRouteTrails = db.prepare(`
        INSERT INTO route_trails (
          route_uuid, trail_id, trail_name, segment_order, segment_distance_km, segment_elevation_gain, segment_elevation_loss, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
            let totalRelationships = 0;
            const insertMany = db.transaction((routeTrails) => {
                for (const rt of routeTrails) {
                    insertRouteTrails.run(rt.route_uuid, rt.trail_id, rt.trail_name, rt.segment_order, rt.segment_distance_km, rt.segment_elevation_gain, rt.segment_elevation_loss, rt.created_at);
                }
            });
            const routeTrailsToInsert = [];
            for (const route of routesResult.rows) {
                try {
                    // Parse route_edges JSON to get edge IDs
                    let routeEdges;
                    if (typeof route.route_edges === 'string') {
                        routeEdges = JSON.parse(route.route_edges);
                    }
                    else {
                        routeEdges = route.route_edges;
                    }
                    if (!routeEdges || !Array.isArray(routeEdges)) {
                        continue;
                    }
                    // Extract unique trail IDs from route edges using edge_trails table
                    const trailIds = new Set();
                    const trailSegmentData = new Map();
                    for (const edge of routeEdges) {
                        if (edge.id && edgeTrailsMap.has(edge.id)) {
                            // Get all trails for this edge from edge_trails table
                            const edgeTrails = edgeTrailsMap.get(edge.id);
                            edgeTrails.forEach((et) => {
                                if (et.trail_id && trailsMap.has(et.trail_id)) {
                                    trailIds.add(et.trail_id);
                                    // Accumulate trail segment data
                                    if (!trailSegmentData.has(et.trail_id)) {
                                        trailSegmentData.set(et.trail_id, { length_km: 0, elevation_gain: 0 });
                                    }
                                    const data = trailSegmentData.get(et.trail_id);
                                    if (data) {
                                        data.length_km += et.trail_segment_length_km || 0;
                                        data.elevation_gain += et.trail_segment_elevation_gain || 0;
                                    }
                                }
                            });
                        }
                    }
                    // Create route-trail relationships
                    let segmentOrder = 1;
                    for (const trailId of trailIds) {
                        const trail = trailsMap.get(trailId);
                        const segmentData = trailSegmentData.get(trailId);
                        if (trail) {
                            routeTrailsToInsert.push({
                                route_uuid: route.route_uuid,
                                trail_id: trailId,
                                trail_name: trail.name,
                                segment_order: segmentOrder++,
                                segment_distance_km: segmentData ? segmentData.length_km : trail.length_km,
                                segment_elevation_gain: segmentData ? segmentData.elevation_gain : trail.elevation_gain,
                                segment_elevation_loss: trail.elevation_loss,
                                created_at: new Date().toISOString()
                            });
                        }
                    }
                }
                catch (error) {
                    this.log(`⚠️  Failed to parse route_edges for route ${route.route_uuid}: ${error}`);
                    continue;
                }
            }
            if (routeTrailsToInsert.length > 0) {
                insertMany(routeTrailsToInsert);
                totalRelationships = routeTrailsToInsert.length;
                this.log(`✅ Created ${totalRelationships} route-trail relationships`);
            }
            else {
                this.log(`⚠️  No valid route-trail relationships found`);
            }
            return totalRelationships;
        }
        catch (error) {
            this.log(`⚠️  route_trails export failed: ${error}`);
            return 0;
        }
    }
    /**
     * Export route summaries with pre-calculated statistics
     */
    async exportRouteSummaries(db) {
        try {
            this.log(`🔍 Exporting route summaries...`);
            // Get route recommendations with their basic info
            const routesResult = await this.pgClient.query(`
        SELECT 
          route_uuid, route_name, recommended_length_km, recommended_elevation_gain,
          route_type, route_shape, route_score, trail_count
        FROM ${this.stagingSchema}.route_recommendations
        WHERE route_uuid IS NOT NULL
        ORDER BY created_at DESC
      `);
            if (routesResult.rows.length === 0) {
                this.log(`⚠️  No routes found for summary export`);
                return 0;
            }
            // Insert route summaries into SQLite
            const insertRouteSummary = db.prepare(`
        INSERT INTO route_summaries (
          route_uuid, route_name, total_distance_km, total_elevation_gain, total_elevation_loss,
          unique_trail_count, total_trail_segments, route_type, route_shape, route_score,
          out_and_back_distance_km, out_and_back_elevation_gain, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            let totalSummaries = 0;
            const insertMany = db.transaction((summaries) => {
                for (const summary of summaries) {
                    insertRouteSummary.run(summary.route_uuid, summary.route_name, summary.total_distance_km, summary.total_elevation_gain, summary.total_elevation_loss, summary.unique_trail_count, summary.total_trail_segments, summary.route_type, summary.route_shape, summary.route_score, summary.out_and_back_distance_km, summary.out_and_back_elevation_gain, summary.created_at);
                }
            });
            const summariesToInsert = [];
            for (const route of routesResult.rows) {
                // Use the recommended values from route_recommendations
                const outAndBackDistance = (route.recommended_length_km || 0) * 2;
                const outAndBackElevation = (route.recommended_elevation_gain || 0) * 2;
                summariesToInsert.push({
                    route_uuid: route.route_uuid,
                    route_name: route.route_name,
                    total_distance_km: route.recommended_length_km || 0,
                    total_elevation_gain: route.recommended_elevation_gain || 0,
                    total_elevation_loss: route.recommended_elevation_gain || 0, // Use gain as approximation
                    unique_trail_count: route.trail_count || 0,
                    total_trail_segments: route.trail_count || 0, // Use trail_count as approximation
                    route_type: route.route_type || 'out-and-back',
                    route_shape: route.route_shape || 'out-and-back',
                    route_score: route.route_score || 100,
                    out_and_back_distance_km: outAndBackDistance,
                    out_and_back_elevation_gain: outAndBackElevation,
                    created_at: new Date().toISOString()
                });
            }
            if (summariesToInsert.length > 0) {
                insertMany(summariesToInsert);
                totalSummaries = summariesToInsert.length;
                this.log(`✅ Created ${totalSummaries} route summaries with route analysis data`);
            }
            else {
                this.log(`⚠️  No valid route summaries found`);
            }
            return totalSummaries;
        }
        catch (error) {
            this.log(`⚠️  route_summaries export failed: ${error}`);
            return 0;
        }
    }
    /**
     * Insert region metadata
     */
    async insertRegionMetadata(db, result) {
        // Get trail statistics
        const statsResult = await this.pgClient.query(`
      SELECT 
        COUNT(*) as trail_count,
        SUM(length_km) as total_length_km,
        SUM(elevation_gain) as total_elevation_gain,
        MIN(bbox_min_lng) as bbox_min_lng,
        MAX(bbox_max_lng) as bbox_max_lng,
        MIN(bbox_min_lat) as bbox_min_lat,
        MAX(bbox_max_lat) as bbox_max_lat
      FROM ${this.stagingSchema}.trails
      WHERE region = $1
    `, [this.config.region]);
        const stats = statsResult.rows[0];
        const insertMetadata = db.prepare(`
      INSERT INTO region_metadata (
        region, total_trails, total_nodes, total_edges, total_routes,
        bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        insertMetadata.run(this.config.region, result.trailsExported, result.nodesExported, result.edgesExported, result.recommendationsExported || 0, stats.bbox_min_lat, stats.bbox_max_lat, stats.bbox_min_lng, stats.bbox_max_lng, new Date().toISOString(), new Date().toISOString());
    }
    /**
     * Insert schema version
     */
    insertSchemaVersion(db) {
        const insertVersion = db.prepare(`
      INSERT INTO schema_version (version, description, created_at) VALUES (?, ?, ?)
    `);
        insertVersion.run(14, 'Carthorse v14 SQLite schema', new Date().toISOString());
    }
}
exports.SQLiteExportStrategy = SQLiteExportStrategy;
//# sourceMappingURL=sqlite-export-strategy.js.map