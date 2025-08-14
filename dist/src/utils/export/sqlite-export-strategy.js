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
            // Create tables
            this.createSqliteTables(sqliteDb);
            // Export trails
            if (this.config.includeTrails !== false) {
                result.trailsExported = await this.exportTrails(sqliteDb);
            }
            // Export nodes
            if (this.config.includeNodes) {
                result.nodesExported = await this.exportNodes(sqliteDb);
            }
            // Export edges
            if (this.config.includeEdges) {
                result.edgesExported = await this.exportEdges(sqliteDb);
            }
            // Export recommendations
            if (this.config.includeRecommendations) {
                result.recommendationsExported = await this.exportRecommendations(sqliteDb);
            }
            // Export route analysis (always include if we have recommendations)
            if (this.config.includeRecommendations) {
                result.routeAnalysisExported = await this.exportRouteAnalysis(sqliteDb);
            }
            // Export legacy route_trails if requested
            if (this.config.includeRouteTrails) {
                result.routeTrailsExported = await this.exportRouteTrails(sqliteDb);
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
            // Final summary will be printed by orchestrator
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
        // Create trails table
        db.exec(`
      CREATE TABLE IF NOT EXISTS trails (
        app_uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        osm_id TEXT,
        trail_type TEXT,
        surface_type TEXT,
        difficulty TEXT,
        length_km REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        geojson TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `);
        // Create routing_nodes table
        db.exec(`
      CREATE TABLE IF NOT EXISTS routing_nodes (
        id INTEGER PRIMARY KEY,
        node_uuid TEXT UNIQUE,
        lat REAL,
        lng REAL,
        elevation REAL,
        node_type TEXT,
        connected_trails TEXT,
        geojson TEXT
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
        // Create route_recommendations table
        db.exec(`
      CREATE TABLE IF NOT EXISTS route_recommendations (
        route_uuid TEXT PRIMARY KEY,
        region TEXT NOT NULL,
        input_length_km REAL,
        input_elevation_gain REAL,
        recommended_length_km REAL,
        recommended_elevation_gain REAL,
        recommended_elevation_loss REAL,
        route_score REAL,
        route_type TEXT,
        route_name TEXT,
        route_shape TEXT,
        trail_count INTEGER,
        route_path TEXT,
        route_edges TEXT,
        request_hash TEXT,
        expires_at TEXT,
        created_at TEXT
      )
    `);
        // Create route_analysis table for lightweight trail composition
        db.exec(`
      CREATE TABLE IF NOT EXISTS route_analysis (
        route_uuid TEXT PRIMARY KEY,
        route_name TEXT,
        edge_count INTEGER,
        unique_trail_count INTEGER,
        total_distance_km REAL,
        total_elevation_gain_m REAL,
        out_and_back_distance_km REAL,
        out_and_back_elevation_gain_m REAL,
        constituent_analysis_json TEXT,
        created_at TEXT
      )
    `);
        // Create legacy route_trails table if requested
        if (this.config.includeRouteTrails) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS route_trails (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          route_uuid TEXT NOT NULL,
          trail_id TEXT NOT NULL,
          trail_name TEXT NOT NULL,
          segment_order INTEGER NOT NULL,
          segment_distance_km REAL,
          segment_elevation_gain REAL,
          segment_elevation_loss REAL,
          created_at TEXT,
          FOREIGN KEY (route_uuid) REFERENCES route_recommendations(route_uuid) ON DELETE CASCADE
        )
      `);
        }
        // Create region_metadata table
        db.exec(`
      CREATE TABLE IF NOT EXISTS region_metadata (
        region TEXT PRIMARY KEY,
        trail_count INTEGER,
        node_count INTEGER,
        edge_count INTEGER,
        total_length_km REAL,
        total_elevation_gain REAL,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        created_at TEXT
      )
    `);
        // Create schema_version table
        db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL,
        created_at TEXT
      )
    `);
    }
    /**
     * Export trails from staging schema
     */
    async exportTrails(db) {
        const trailsResult = await this.pgClient.query(`
      SELECT DISTINCT ON (app_uuid)
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
      ORDER BY app_uuid, name
    `, [this.config.region]);
        if (trailsResult.rows.length === 0) {
            throw new Error('No trails found to export');
        }
        // Insert trails into SQLite
        const insertTrails = db.prepare(`
      INSERT INTO trails (
        app_uuid, name, region, osm_id, trail_type, surface_type, difficulty,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        geojson, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const insertMany = db.transaction((trails) => {
            for (const trail of trails) {
                insertTrails.run(trail.app_uuid, trail.name, trail.region, trail.osm_id, trail.trail_type, trail.surface_type, trail.difficulty, trail.length_km, trail.elevation_gain, trail.elevation_loss, trail.max_elevation, trail.min_elevation, trail.avg_elevation, trail.bbox_min_lng, trail.bbox_max_lng, trail.bbox_min_lat, trail.bbox_max_lat, trail.geojson, trail.created_at ? (typeof trail.created_at === 'string' ? trail.created_at : trail.created_at.toISOString()) : new Date().toISOString(), trail.updated_at ? (typeof trail.updated_at === 'string' ? trail.updated_at : trail.updated_at.toISOString()) : new Date().toISOString());
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
            const nodesResult = await this.pgClient.query(`
        SELECT 
          id, 
          id as node_uuid, 
          ST_Y(the_geom) as lat, 
          ST_X(the_geom) as lng, 
          0 as elevation, 
          COALESCE(node_type, 'unknown') as node_type, 
          '' as connected_trails,
          ST_AsGeoJSON(the_geom, 6, 1) as geojson
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
          id, node_uuid, lat, lng, elevation, node_type, connected_trails, geojson
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
            const insertMany = db.transaction((nodes) => {
                for (const node of nodes) {
                    insertNodes.run(node.id, node.node_uuid, node.lat, node.lng, node.elevation, node.node_type, node.connected_trails, node.geojson);
                }
            });
            insertMany(nodesResult.rows);
            return nodesResult.rows.length;
        }
        catch (error) {
            this.log(`⚠️  Node export failed: ${error}`);
            this.log(`⚠️  Trying to query: ${this.stagingSchema}.ways_noded_vertices_pgr`);
            return 0;
        }
    }
    /**
     * Export edges from staging schema
     */
    async exportEdges(db) {
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
            if (edgesResult.rows.length === 0) {
                this.log(`⚠️  No edges found in routing tables`);
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
            this.log(`⚠️  Unexpected error during edges export: ${error}`);
            return 0;
        }
    }
    /**
     * Export recommendations from staging schema
     */
    async exportRecommendations(db) {
        try {
            const recommendationsResult = await this.pgClient.query(`
        SELECT 
          route_uuid, region, input_length_km, input_elevation_gain,
          recommended_length_km, recommended_elevation_gain, 
          recommended_elevation_loss,
          route_score, route_type, route_name, route_shape, trail_count,
          route_path, route_edges, 
          request_hash,
          expires_at,
          created_at
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
          recommended_length_km, recommended_elevation_gain, recommended_elevation_loss,
          route_score, route_type, route_name, route_shape, trail_count,
          route_path, route_edges, request_hash, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            const insertMany = db.transaction((recommendations) => {
                for (const rec of recommendations) {
                    insertRecommendations.run(rec.route_uuid, rec.region, rec.input_length_km, rec.input_elevation_gain, rec.recommended_length_km, rec.recommended_elevation_gain, rec.recommended_elevation_loss, rec.route_score, rec.route_type, rec.route_name, rec.route_shape, rec.trail_count, rec.route_path ? JSON.stringify(rec.route_path) : null, rec.route_edges ? JSON.stringify(rec.route_edges) : null, rec.request_hash, rec.expires_at ? (typeof rec.expires_at === 'string' ? rec.expires_at : rec.expires_at.toISOString()) : null, rec.created_at ? (typeof rec.created_at === 'string' ? rec.created_at : rec.created_at.toISOString()) : new Date().toISOString());
                }
            });
            insertMany(recommendationsResult.rows);
            return recommendationsResult.rows.length;
        }
        catch (error) {
            this.log(`⚠️  Route recommendations export failed: ${error}`);
            this.log(`⚠️  Trying to query: ${this.stagingSchema}.route_recommendations`);
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
        region, trail_count, node_count, edge_count, total_length_km, total_elevation_gain,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        insertMetadata.run(this.config.region, result.trailsExported, result.nodesExported, result.edgesExported, stats.total_length_km || 0, stats.total_elevation_gain || 0, stats.bbox_min_lng, stats.bbox_max_lng, stats.bbox_min_lat, stats.bbox_max_lat, new Date().toISOString());
    }
    /**
     * Export route analysis data
     */
    async exportRouteAnalysis(db) {
        try {
            // Clear existing route analysis for this region
            db.exec(`DELETE FROM route_analysis WHERE route_uuid IN (
        SELECT route_uuid FROM route_recommendations WHERE region = '${this.config.region}'
      )`);
            this.log(`🗑️  Cleared existing route analysis for region: ${this.config.region}`);
            // Check if constituent analysis service exists in the staging schema
            const constituentFiles = await this.findConstituentAnalysisFiles();
            if (constituentFiles.length === 0) {
                this.log(`⚠️  No constituent analysis files found, skipping route analysis export`);
                return 0;
            }
            // Load and insert constituent analysis data
            let totalInserted = 0;
            for (const filePath of constituentFiles) {
                const analysisData = await this.loadConstituentAnalysisFile(filePath);
                totalInserted += await this.insertRouteAnalysisData(db, analysisData);
            }
            this.log(`✅ Exported ${totalInserted} route analysis records`);
            return totalInserted;
        }
        catch (error) {
            this.log(`⚠️  route analysis export failed: ${error instanceof Error ? error.message : String(error)}`);
            return 0;
        }
    }
    /**
     * Find constituent analysis files
     */
    async findConstituentAnalysisFiles() {
        const fs = require('fs');
        const path = require('path');
        // Look for constituent analysis files in the project root
        const files = fs.readdirSync('.');
        return files
            .filter((file) => file.includes('constituent-analysis.json'))
            .map((file) => path.resolve(file))
            .slice(0, 1); // Take the most recent one for now
    }
    /**
     * Load constituent analysis file
     */
    async loadConstituentAnalysisFile(filePath) {
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content);
    }
    /**
     * Insert route analysis data into SQLite
     */
    async insertRouteAnalysisData(db, analysisData) {
        const insertAnalysis = db.prepare(`
      INSERT OR REPLACE INTO route_analysis (
        route_uuid, route_name, edge_count, unique_trail_count,
        total_distance_km, total_elevation_gain_m,
        out_and_back_distance_km, out_and_back_elevation_gain_m,
        constituent_analysis_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const insertMany = db.transaction((analyses) => {
            for (const analysis of analyses) {
                insertAnalysis.run(analysis.route_uuid, analysis.route_name, analysis.edge_count, analysis.unique_trail_count, analysis.total_trail_distance_km, analysis.total_trail_elevation_gain_m, analysis.out_and_back_distance_km, analysis.out_and_back_elevation_gain_m, JSON.stringify(analysis), new Date().toISOString());
            }
        });
        insertMany(analysisData);
        return analysisData.length;
    }
    /**
     * Export legacy route_trails data
     */
    async exportRouteTrails(db) {
        try {
            // Clear existing route trails for this region
            db.exec(`DELETE FROM route_trails WHERE route_uuid IN (
        SELECT route_uuid FROM route_recommendations WHERE region = '${this.config.region}'
      )`);
            this.log(`🗑️  Cleared existing route trails for region: ${this.config.region}`);
            // Get route trails from staging schema (if populated)
            const routeTrailsResult = await this.pgClient.query(`
        SELECT 
          route_uuid, trail_id, trail_name, segment_order,
          segment_distance_km, segment_elevation_gain, segment_elevation_loss,
          created_at
        FROM ${this.stagingSchema}.route_trails
        ORDER BY route_uuid, segment_order
      `);
            if (routeTrailsResult.rows.length === 0) {
                this.log(`⚠️  No route trails found in staging schema, skipping route_trails export`);
                return 0;
            }
            // Insert route trails into SQLite
            const insertRouteTrail = db.prepare(`
        INSERT OR REPLACE INTO route_trails (
          route_uuid, trail_id, trail_name, segment_order,
          segment_distance_km, segment_elevation_gain, segment_elevation_loss,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
            const insertMany = db.transaction((trails) => {
                for (const trail of trails) {
                    insertRouteTrail.run(trail.route_uuid, trail.trail_id, trail.trail_name, trail.segment_order, trail.segment_distance_km, trail.segment_elevation_gain, trail.segment_elevation_loss, trail.created_at);
                }
            });
            insertMany(routeTrailsResult.rows);
            this.log(`✅ Exported ${routeTrailsResult.rows.length} route trail segments`);
            return routeTrailsResult.rows.length;
        }
        catch (error) {
            this.log(`⚠️  route_trails table not found in staging schema, skipping export`);
            return 0;
        }
    }
    /**
     * Insert schema version
     */
    insertSchemaVersion(db) {
        const insertVersion = db.prepare(`
      INSERT OR REPLACE INTO schema_version (version, created_at) VALUES (?, ?)
    `);
        insertVersion.run('v14', new Date().toISOString());
    }
    /**
     * Log message if verbose mode is enabled
     */
    log(message) {
        if (this.config.verbose) {
            console.log(`[SQLite Export] ${message}`);
        }
    }
}
exports.SQLiteExportStrategy = SQLiteExportStrategy;
//# sourceMappingURL=sqlite-export-strategy.js.map