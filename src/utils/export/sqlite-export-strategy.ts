import { Pool } from 'pg';
import Database from 'better-sqlite3';
import * as fs from 'fs';

export interface SQLiteExportConfig {
  region: string;
  outputPath: string;
  includeNodes?: boolean;
  includeEdges?: boolean;
  includeTrails?: boolean;
  includeRecommendations?: boolean;
  includeRouteTrails?: boolean;  // Legacy route_trails table (default: false, use route_analysis instead)
  verbose?: boolean;
}

export interface SQLiteExportResult {
  trailsExported: number;
  nodesExported: number;
  edgesExported: number;
  recommendationsExported?: number;
  routeAnalysisExported?: number;
  routeTrailsExported?: number;
  dbSizeMB: number;
  isValid: boolean;
  errors: string[];
}

export class SQLiteExportStrategy {
  private pgClient: Pool;
  private config: SQLiteExportConfig;
  private stagingSchema: string;

  constructor(pgClient: Pool, config: SQLiteExportConfig, stagingSchema: string) {
    this.pgClient = pgClient;
    this.config = config;
    this.stagingSchema = stagingSchema;
  }

  /**
   * Export all data from staging schema to SQLite
   */
  async exportFromStaging(): Promise<SQLiteExportResult> {
    console.log(`📦 Exporting from staging schema to SQLite: ${this.config.outputPath}`);
    
    const result: SQLiteExportResult = {
      trailsExported: 0,
      nodesExported: 0,
      edgesExported: 0,
      dbSizeMB: 0,
      isValid: false,
      errors: []
    };

    try {
      // Create SQLite database
      const sqliteDb = new Database(this.config.outputPath);
      
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
      
    } catch (error) {
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
  private createSqliteTables(db: Database.Database): void {
    // Drop existing tables to ensure schema compatibility
    db.exec(`DROP TABLE IF EXISTS route_analysis`);
    db.exec(`DROP TABLE IF EXISTS route_recommendations`);
    db.exec(`DROP TABLE IF EXISTS routing_edges`);
    db.exec(`DROP TABLE IF EXISTS routing_nodes`);
    db.exec(`DROP TABLE IF EXISTS trails`);
    db.exec(`DROP TABLE IF EXISTS region_metadata`);
    
    // Create trails table matching v14 schema exactly
    db.exec(`
      CREATE TABLE IF NOT EXISTS trails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        osm_id TEXT,
        osm_type TEXT,
        length_km REAL CHECK(length_km > 0) NOT NULL,
        elevation_gain REAL CHECK(elevation_gain >= 0) NOT NULL,
        elevation_loss REAL CHECK(elevation_loss >= 0) NOT NULL,
        max_elevation REAL CHECK(max_elevation > 0) NOT NULL,
        min_elevation REAL CHECK(min_elevation > 0) NOT NULL,
        avg_elevation REAL CHECK(avg_elevation > 0) NOT NULL,
        difficulty TEXT CHECK(difficulty IN ('easy', 'moderate', 'hard', 'expert')),
        surface_type TEXT,
        trail_type TEXT,
        geojson TEXT NOT NULL,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    // Create routing_edges table using staging schema ways_noded primary keys
    db.exec(`
      CREATE TABLE IF NOT EXISTS routing_edges (
        id INTEGER PRIMARY KEY,  -- Use staging schema ways_noded.id
        source INTEGER NOT NULL,
        target INTEGER NOT NULL,
        trail_id INTEGER NOT NULL,  -- Reference to trails.id (staging schema PK)
        trail_name TEXT NOT NULL,
        length_km REAL NOT NULL,
        elevation_gain REAL,
        elevation_loss REAL,
        geojson TEXT,
        created_at TEXT,
        FOREIGN KEY (trail_id) REFERENCES trails(id)
      )
    `);

    // Create route_recommendations table matching v14 schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS route_recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_uuid TEXT UNIQUE,
        region TEXT NOT NULL,
        gpx_distance_km REAL,
        gpx_elevation_gain REAL,
        gpx_name TEXT,
        recommended_distance_km REAL,
        recommended_elevation_gain REAL,
        route_type TEXT,
        route_edges TEXT,
        route_path TEXT,
        similarity_score REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        input_distance_km REAL,
        input_elevation_gain REAL,
        input_distance_tolerance REAL,
        input_elevation_tolerance REAL,
        expires_at DATETIME,
        usage_count INTEGER DEFAULT 0,
        complete_route_data TEXT,
        trail_connectivity_data TEXT,
        request_hash TEXT
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
        constituent_analysis_json TEXT
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
          FOREIGN KEY (route_uuid) REFERENCES route_recommendations(route_uuid) ON DELETE CASCADE
        )
      `);
    }

    // Create region_metadata table
    db.exec(`
      CREATE TABLE IF NOT EXISTS region_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        region TEXT UNIQUE NOT NULL,
        total_trails INTEGER CHECK(total_trails >= 0),
        total_nodes INTEGER CHECK(total_nodes >= 0),
        total_edges INTEGER CHECK(total_edges >= 0),
        total_routes INTEGER CHECK(total_routes >= 0),
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        bbox_min_lng REAL,
        bbox_max_lng REAL
      )
    `);

    // Create schema_version table
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        description TEXT
      )
    `);

    // Create indexes for optimal performance
    db.exec(`CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON trails(app_uuid)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_trails_length ON trails(length_km)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_trails_elevation_gain ON trails(elevation_gain)`);
  }

  /**
   * Export trails from staging schema
   */
  private async exportTrails(db: Database.Database): Promise<number> {
    // Since staging schema is region-specific, export all trails without region filter
    // Use the config region since staging schema doesn't have a region column
    const trailsResult = await this.pgClient.query(`
      SELECT 
        app_uuid, name, osm_id,
        COALESCE(trail_type, 'unknown') as trail_type, 
        COALESCE(surface, 'unknown') as surface_type, 
        CASE 
          WHEN difficulty = 'unknown' OR difficulty IS NULL THEN 'moderate'
          ELSE difficulty
        END as difficulty,
        ST_AsGeoJSON(geometry, 6, 0) as geojson,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        '${this.config.region}' as region
      FROM ${this.stagingSchema}.trails
      ORDER BY id
    `);
    
    if (trailsResult.rows.length === 0) {
      throw new Error('No trails found in staging schema to export');
    }
    
    // Insert trails into SQLite matching v14 schema (let SQLite auto-increment the id)
    const insertTrails = db.prepare(`
      INSERT OR REPLACE INTO trails (
        app_uuid, name, region, osm_id, trail_type, surface_type, difficulty,
        geojson, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertMany = db.transaction((trails: any[]) => {
      for (const trail of trails) {
        // Calculate bbox from geometry if null/missing
        let bbox = {
          bbox_min_lng: trail.bbox_min_lng,
          bbox_max_lng: trail.bbox_max_lng,
          bbox_min_lat: trail.bbox_min_lat,
          bbox_max_lat: trail.bbox_max_lat
        };
        
        // If any bbox value is null, try to calculate from geometry
        if (bbox.bbox_min_lng === null || bbox.bbox_max_lng === null || 
            bbox.bbox_min_lat === null || bbox.bbox_max_lat === null) {
          try {
            const geometry = JSON.parse(trail.geojson);
            if (geometry && geometry.coordinates && geometry.coordinates.length > 0) {
              const coords = geometry.coordinates.flat();
              const lngs = coords.filter((_: any, i: number) => i % 2 === 0);
              const lats = coords.filter((_: any, i: number) => i % 2 === 1);
              
              if (lngs.length > 0 && lats.length > 0) {
                bbox = {
                  bbox_min_lng: Math.min(...lngs),
                  bbox_max_lng: Math.max(...lngs),
                  bbox_min_lat: Math.min(...lats),
                  bbox_max_lat: Math.max(...lats)
                };
              } else {
                // Default fallback values
                bbox = {
                  bbox_min_lng: 0,
                  bbox_max_lng: 0,
                  bbox_min_lat: 0,
                  bbox_max_lat: 0
                };
              }
            }
          } catch (error) {
            console.warn(`⚠️ Failed to calculate bbox for trail ${trail.app_uuid}:`, error);
            // Default fallback values
            bbox = {
              bbox_min_lng: 0,
              bbox_max_lng: 0,
              bbox_min_lat: 0,
              bbox_max_lat: 0
            };
          }
        }
        
        insertTrails.run(
          trail.app_uuid,
          trail.name,
          trail.region,
          trail.osm_id,
          trail.trail_type,
          trail.surface_type,
          trail.difficulty,
          trail.geojson,
          trail.length_km,
          trail.elevation_gain,
          trail.elevation_loss,
          trail.max_elevation,
          trail.min_elevation,
          trail.avg_elevation,
          trail.bbox_min_lng,
          trail.bbox_max_lng,
          trail.bbox_min_lat,
          trail.bbox_max_lat
        );
      }
    });
    
    insertMany(trailsResult.rows);
    return trailsResult.rows.length;
  }

  /**
   * Export nodes from staging schema
   */
  private async exportNodes(db: Database.Database): Promise<number> {
    try {
      const nodesResult = await this.pgClient.query(`
        SELECT 
          id, 
          id as node_uuid, 
          ST_Y(the_geom) as lat, 
          ST_X(the_geom) as lng, 
          0 as elevation, 
          'unknown' as node_type, 
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
        INSERT OR REPLACE INTO routing_nodes (
          id, node_uuid, lat, lng, elevation, node_type, connected_trails, geojson
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = db.transaction((nodes: any[]) => {
        for (const node of nodes) {
          insertNodes.run(
            node.id,
            node.node_uuid,
            node.lat,
            node.lng,
            node.elevation,
            node.node_type,
            node.connected_trails,
            node.geojson
          );
        }
      });
      
      insertMany(nodesResult.rows);
      return nodesResult.rows.length;
    } catch (error) {
      this.log(`⚠️  Node export failed: ${error}`);
      this.log(`⚠️  Trying to query: ${this.stagingSchema}.ways_noded_vertices_pgr`);
      return 0;
    }
  }

  /**
   * Export edges from staging schema using ways_noded
   */
  private async exportEdges(db: Database.Database): Promise<number> {
    try {
      const edgesResult = await this.pgClient.query(`
        SELECT 
          wn.id, wn.source, wn.target, 
          t.app_uuid as trail_id, wn.name as trail_name,
          wn.length_km, wn.elevation_gain, wn.elevation_loss,
          ST_AsGeoJSON(wn.the_geom, 6, 1) as geojson,
          NOW() as created_at
        FROM ${this.stagingSchema}.ways_noded wn
        JOIN ${this.stagingSchema}.trails t ON wn.trail_uuid = t.app_uuid
        WHERE wn.source IS NOT NULL AND wn.target IS NOT NULL
        ORDER BY wn.id
      `);
      
      if (edgesResult.rows.length === 0) {
        this.log(`⚠️  No edges found in routing tables`);
        return 0;
      }
      
      // Insert edges into SQLite
      const insertEdges = db.prepare(`
        INSERT OR REPLACE INTO routing_edges (
          id, source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geojson, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = db.transaction((edges: any[]) => {
        for (const edge of edges) {
          insertEdges.run(
            edge.id,
            edge.source,
            edge.target,
            edge.trail_id,
            edge.trail_name,
            edge.length_km,
            edge.elevation_gain,
            edge.elevation_loss,
            edge.geojson,
            edge.created_at ? (typeof edge.created_at === 'string' ? edge.created_at : edge.created_at.toISOString()) : new Date().toISOString()
          );
        }
      });
      
      insertMany(edgesResult.rows);
      return edgesResult.rows.length;
    } catch (error) {
      this.log(`⚠️  Unexpected error during edges export: ${error}`);
      return 0;
    }
  }

  /**
   * Export recommendations from staging schema
   */
  private async exportRecommendations(db: Database.Database): Promise<number> {
    try {
      // Query directly from route_recommendations table in staging schema
      const recommendationsResult = await this.pgClient.query(`
        SELECT 
          route_uuid,
          input_length_km,
          input_elevation_gain,
          recommended_length_km,
          recommended_elevation_gain,
          route_score,
          route_name,
          route_shape,
          trail_count,
          route_path,
          route_edges,
          route_geometry,
          similarity_score,
          created_at
        FROM ${this.stagingSchema}.route_recommendations
        ORDER BY created_at DESC
      `);
      
      if (recommendationsResult.rows.length === 0) {
        this.log(`⚠️  No recommendations found in ${this.stagingSchema}.route_recommendations`);
        return 0;
      }
      
      // Insert recommendations into SQLite matching v14 schema
      const insertRecommendations = db.prepare(`
        INSERT OR REPLACE INTO route_recommendations (
          route_uuid, region, input_distance_km, input_elevation_gain,
          recommended_distance_km, recommended_elevation_gain,
          route_type, route_edges, route_path, similarity_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      // Process route geometries outside of transaction
      const processedRecommendations = await Promise.all(recommendationsResult.rows.map(async (rec: any) => {
        // Convert route_geometry to GeoJSON if it exists
        let routeGeometryGeoJSON = null;
        if (rec.route_geometry) {
          try {
            const geometryResult = await this.pgClient.query(`
              SELECT ST_AsGeoJSON($1::geometry, 6, 0) as geojson
            `, [rec.route_geometry]);
            
            if (geometryResult.rows[0]?.geojson) {
              routeGeometryGeoJSON = geometryResult.rows[0].geojson;
            }
          } catch (error) {
            this.log(`⚠️ Failed to convert route geometry for route ${rec.route_uuid}: ${error}`);
          }
        }
        
        return {
          ...rec,
          routeGeometryGeoJSON
        };
      }));
      
      const insertMany = db.transaction((recommendations: any[]) => {
        for (const rec of recommendations) {
          insertRecommendations.run(
            rec.route_uuid,
            this.config.region,
            rec.input_length_km,
            rec.input_elevation_gain,
            rec.recommended_length_km,
            rec.recommended_elevation_gain,
            rec.route_shape || 'unknown',
            rec.route_edges ? JSON.stringify(rec.route_edges) : null,
            rec.route_path ? JSON.stringify(rec.route_path) : null,
            rec.similarity_score
          );
        }
      });
      
      insertMany(processedRecommendations);
      return recommendationsResult.rows.length;
    } catch (error) {
      this.log(`⚠️  Route recommendations export failed: ${error}`);
      this.log(`⚠️  Trying to query: ${this.stagingSchema}.route_recommendations`);
      return 0;
    }
  }

  /**
   * Insert region metadata
   */
  private async insertRegionMetadata(db: Database.Database, result: SQLiteExportResult): Promise<void> {
    // Get trail statistics from staging schema (region-specific)
    const statsResult = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        MIN(bbox_min_lng) as bbox_min_lng,
        MAX(bbox_max_lng) as bbox_max_lng,
        MIN(bbox_min_lat) as bbox_min_lat,
        MAX(bbox_max_lat) as bbox_max_lat
      FROM ${this.stagingSchema}.trails
    `);
    
    const stats = statsResult.rows[0];
    
    const insertMetadata = db.prepare(`
      INSERT OR REPLACE INTO region_metadata (
        region, total_trails, total_nodes, total_edges, total_routes,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    insertMetadata.run(
      this.config.region,
      stats.total_trails || 0,
      result.nodesExported,
      result.edgesExported,
      0, // total_routes - not calculated yet
      stats.bbox_min_lng || 0,
      stats.bbox_max_lng || 0,
      stats.bbox_min_lat || 0,
      stats.bbox_max_lat || 0
    );
  }

  /**
   * Export route analysis data
   */
  private async exportRouteAnalysis(db: Database.Database): Promise<number> {
    try {
      // Clear existing route analysis
      db.exec(`DELETE FROM route_analysis`);
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
      
    } catch (error) {
      this.log(`⚠️  route analysis export failed: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  /**
   * Find constituent analysis files
   */
  private async findConstituentAnalysisFiles(): Promise<string[]> {
    const fs = require('fs');
    const path = require('path');
    
    // Look for constituent analysis files in the project root
    const files = fs.readdirSync('.');
    return files
      .filter((file: string) => file.includes('constituent-analysis.json'))
      .map((file: string) => path.resolve(file))
      .slice(0, 1); // Take the most recent one for now
  }

  /**
   * Load constituent analysis file
   */
  private async loadConstituentAnalysisFile(filePath: string): Promise<any[]> {
    const fs = require('fs');
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  }

  /**
   * Insert route analysis data into SQLite
   */
  private async insertRouteAnalysisData(db: Database.Database, analysisData: any[]): Promise<number> {
    const insertAnalysis = db.prepare(`
      INSERT OR REPLACE INTO route_analysis (
        route_uuid, route_name, edge_count, unique_trail_count,
        total_distance_km, total_elevation_gain_m,
        out_and_back_distance_km, out_and_back_elevation_gain_m,
        constituent_analysis_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((analyses: any[]) => {
      for (const analysis of analyses) {
        insertAnalysis.run(
          analysis.route_uuid,
          analysis.route_name,
          analysis.edge_count,
          analysis.unique_trail_count,
          analysis.total_trail_distance_km,
          analysis.total_trail_elevation_gain_m,
          analysis.out_and_back_distance_km,
          analysis.out_and_back_elevation_gain_m,
          JSON.stringify(analysis)
        );
      }
    });

    insertMany(analysisData);
    return analysisData.length;
  }

  /**
   * Export legacy route_trails data
   */
  private async exportRouteTrails(db: Database.Database): Promise<number> {
    try {
      // Clear existing route trails
      db.exec(`DELETE FROM route_trails`);
      this.log(`🗑️  Cleared existing route trails for region: ${this.config.region}`);

      // Get route trails from staging schema (if populated)
      const routeTrailsResult = await this.pgClient.query(`
        SELECT 
          route_uuid, trail_id, trail_name, segment_order,
          segment_distance_km, segment_elevation_gain, segment_elevation_loss
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
          segment_distance_km, segment_elevation_gain, segment_elevation_loss
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction((trails: any[]) => {
        for (const trail of trails) {
          insertRouteTrail.run(
            trail.route_uuid,
            trail.trail_id,
            trail.trail_name,
            trail.segment_order,
            trail.segment_distance_km,
            trail.segment_elevation_gain,
            trail.segment_elevation_loss
          );
        }
      });

      insertMany(routeTrailsResult.rows);
      this.log(`✅ Exported ${routeTrailsResult.rows.length} route trail segments`);
      return routeTrailsResult.rows.length;
      
    } catch (error) {
      this.log(`⚠️  route_trails table not found in staging schema, skipping export`);
      return 0;
    }
  }

  /**
   * Insert schema version
   */
  private insertSchemaVersion(db: Database.Database): void {
    const insertVersion = db.prepare(`
      INSERT OR REPLACE INTO schema_version (version, description) VALUES (?, ?)
    `);
    
    insertVersion.run(14, 'Carthorse SQLite Export v14.0 (Enhanced Route Recommendations + Trail Composition)');
  }

  /**
   * Log message if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[SQLite Export] ${message}`);
    }
  }
} 