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
  routeTrailsExported?: number;
  routeAnalysisExported?: number;
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
      // Calculate export fields in staging schema before export
      console.log(`🔧 Calculating export fields in staging schema...`);
      await this.calculateExportFields();
      
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
      
      // Export route recommendations (unified from both lollipop_routes and route_recommendations)
      if (this.config.includeRecommendations) {
        result.recommendationsExported = await this.exportRouteRecommendations(sqliteDb);
      }
      
      // Export route trails junction table
      if (this.config.includeRouteTrails) {
        result.routeTrailsExported = await this.exportRouteTrails(sqliteDb);
      }
      
      // Export route analysis (always include if we have recommendations)
      if (this.config.includeRecommendations) {
        result.routeAnalysisExported = await this.exportRouteAnalysis(sqliteDb);
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
    console.log(`🔧 [DEBUG] Creating SQLite tables...`);
    
    // Create trails table (v15 schema)
    // Drop the table first to ensure clean creation
    db.exec(`DROP TABLE IF EXISTS trails`);
    
    db.exec(`
      CREATE TABLE trails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        osm_id TEXT,
        osm_type TEXT,
        length_km REAL NOT NULL,
        elevation_gain REAL NOT NULL,
        elevation_loss REAL NOT NULL,
        max_elevation REAL NOT NULL,
        min_elevation REAL NOT NULL,
        avg_elevation REAL NOT NULL,
        difficulty TEXT,
        surface_type TEXT,
        trail_type TEXT,
        source TEXT,
        geojson TEXT NOT NULL,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create routing_nodes table (v15 schema)
    // Drop the table first to ensure clean creation
    db.exec(`DROP TABLE IF EXISTS routing_nodes`);
    
    db.exec(`
      CREATE TABLE routing_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_uuid TEXT UNIQUE NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        elevation REAL,
        node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
        connected_trails TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create routing_edges table (v15 schema)
    // Drop the table first to ensure clean creation
    db.exec(`DROP TABLE IF EXISTS routing_edges`);
    
    db.exec(`
      CREATE TABLE routing_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source INTEGER NOT NULL,
        target INTEGER NOT NULL,
        trail_id TEXT,
        trail_name TEXT NOT NULL,
        length_km REAL NOT NULL,
        elevation_gain REAL,
        elevation_loss REAL,
        geojson TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create route_recommendations table (v15 schema)
    console.log(`🔧 [DEBUG] Creating route_recommendations table...`);
    
    // Drop the table first to ensure clean creation
    db.exec(`DROP TABLE IF EXISTS route_recommendations`);
    
    db.exec(`
      CREATE TABLE route_recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_uuid TEXT UNIQUE NOT NULL,
        region TEXT NOT NULL,
        input_length_km REAL CHECK(input_length_km > 0),
        input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
        recommended_length_km REAL CHECK(recommended_length_km > 0),
        recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
        route_elevation_loss REAL CHECK(route_elevation_loss >= 0),
        route_score REAL CHECK(route_score >= 0 AND route_score <= 100),
        route_type TEXT CHECK(route_type IN ('out-and-back', 'loop', 'lollipop', 'point-to-point')),
        route_name TEXT,
        route_shape TEXT CHECK(route_shape IN ('loop', 'out-and-back', 'lollipop', 'point-to-point')),
        trail_count INTEGER CHECK(trail_count >= 1),
        route_path TEXT NOT NULL,
        route_edges TEXT NOT NULL,
        similarity_score REAL CHECK(similarity_score >= 0 AND similarity_score <= 1),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        input_distance_tolerance REAL CHECK(input_distance_tolerance >= 0),
        input_elevation_tolerance REAL CHECK(input_elevation_tolerance >= 0),
        expires_at DATETIME,
        usage_count INTEGER DEFAULT 0 CHECK(usage_count >= 0),
        complete_route_data TEXT,
        trail_connectivity_data TEXT,
        request_hash TEXT,
        route_gain_rate REAL CHECK(route_gain_rate >= 0),
        route_trail_count INTEGER CHECK(route_trail_count > 0),
        route_max_elevation REAL,
        route_min_elevation REAL,
        route_avg_elevation REAL,
        route_difficulty TEXT,
        route_estimated_time_hours REAL CHECK(route_estimated_time_hours > 0),
        route_connectivity_score REAL CHECK(route_connectivity_score >= 0 AND route_connectivity_score <= 1)
      )
    `);
    
    // Verify the table was created with the correct columns
    console.log(`🔧 [DEBUG] Verifying route_recommendations table structure...`);
    const tableInfo = db.prepare("PRAGMA table_info(route_recommendations)").all() as any[];
    console.log(`🔧 [DEBUG] route_recommendations columns:`, tableInfo.map((col: any) => col.name));
    
    // Check specifically for route_gain_rate column
    const hasRouteGainRate = tableInfo.some((col: any) => col.name === 'route_gain_rate');
    if (!hasRouteGainRate) {
      throw new Error('route_gain_rate column is missing from route_recommendations table');
    }
    console.log(`✅ [DEBUG] route_gain_rate column verified in route_recommendations table`);

    // Create route_trails junction table (v15 schema)
    db.exec(`
      CREATE TABLE IF NOT EXISTS route_trails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_uuid TEXT NOT NULL,
        trail_id TEXT NOT NULL,
        trail_name TEXT NOT NULL,
        segment_order INTEGER NOT NULL,
        segment_distance_km REAL CHECK(segment_distance_km > 0),
        segment_elevation_gain REAL CHECK(segment_elevation_gain >= 0),
        segment_elevation_loss REAL CHECK(segment_elevation_loss >= 0),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (route_uuid) REFERENCES route_recommendations(route_uuid) ON DELETE CASCADE
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Note: route_trails table already created above

    // Create region_metadata table (v15 schema)
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
        bbox_max_lng REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create schema_version table (drop and recreate to ensure correct schema)
    db.exec(`
      DROP TABLE IF EXISTS schema_version;
      CREATE TABLE schema_version (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create v15 indexes for performance (comprehensive parametric search support)
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_trails_name ON trails(name);
      CREATE INDEX IF NOT EXISTS idx_trails_length ON trails(length_km);
      CREATE INDEX IF NOT EXISTS idx_trails_elevation ON trails(elevation_gain);
      CREATE INDEX IF NOT EXISTS idx_trails_source ON trails(source);
      CREATE INDEX IF NOT EXISTS idx_routing_nodes_coords ON routing_nodes(lat, lng);
      CREATE INDEX IF NOT EXISTS idx_routing_nodes_elevation ON routing_nodes(elevation);
      CREATE INDEX IF NOT EXISTS idx_routing_nodes_type ON routing_nodes(node_type);
      CREATE INDEX IF NOT EXISTS idx_routing_edges_source_target ON routing_edges(source, target);
      CREATE INDEX IF NOT EXISTS idx_routing_edges_trail ON routing_edges(trail_id);
      CREATE INDEX IF NOT EXISTS idx_routing_edges_length ON routing_edges(length_km);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_region ON route_recommendations(region);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_shape ON route_recommendations(route_shape);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_trail_count ON route_recommendations(trail_count);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_type ON route_recommendations(route_type);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_score ON route_recommendations(route_score);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_length ON route_recommendations(recommended_length_km);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_elevation ON route_recommendations(recommended_elevation_gain);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_gain_rate ON route_recommendations(route_gain_rate);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_trail_count ON route_recommendations(route_trail_count);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_difficulty ON route_recommendations(route_difficulty);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_elevation_range ON route_recommendations(route_min_elevation, route_max_elevation);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_type ON route_recommendations(route_type);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_score ON route_recommendations(similarity_score);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_uuid ON route_recommendations(route_uuid);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_region ON route_recommendations(region);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_input ON route_recommendations(input_length_km, input_elevation_gain);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_length_gain_rate ON route_recommendations(recommended_length_km, route_gain_rate);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_difficulty_length ON route_recommendations(route_difficulty, recommended_length_km);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_elevation_range_difficulty ON route_recommendations(route_min_elevation, route_max_elevation, route_difficulty);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_shape_count ON route_recommendations(route_shape, trail_count);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_region_shape ON route_recommendations(region, route_shape);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_region_count ON route_recommendations(region, trail_count);
      CREATE INDEX IF NOT EXISTS idx_route_trails_route_uuid ON route_trails(route_uuid);
      CREATE INDEX IF NOT EXISTS idx_route_trails_trail_id ON route_trails(trail_id);
      CREATE INDEX IF NOT EXISTS idx_route_trails_segment_order ON route_trails(segment_order);
      CREATE INDEX IF NOT EXISTS idx_route_trails_composite ON route_trails(route_uuid, segment_order);
    `);

    // Create v15 views
    db.exec(`
      CREATE VIEW IF NOT EXISTS route_stats AS
      SELECT 
        COUNT(*) as total_routes,
        AVG(recommended_length_km) as avg_length_km,
        AVG(recommended_elevation_gain) as avg_elevation_gain,
        COUNT(CASE WHEN route_shape = 'loop' THEN 1 END) as loop_routes,
        COUNT(CASE WHEN route_shape = 'out-and-back' THEN 1 END) as out_and_back_routes,
        COUNT(CASE WHEN route_shape = 'lollipop' THEN 1 END) as lollipop_routes,
        COUNT(CASE WHEN route_shape = 'point-to-point' THEN 1 END) as point_to_point_routes,
        COUNT(CASE WHEN trail_count = 1 THEN 1 END) as single_trail_routes,
        COUNT(CASE WHEN trail_count > 1 THEN 1 END) as multi_trail_routes
      FROM route_recommendations;
    `);

    db.exec(`
      CREATE VIEW IF NOT EXISTS route_trail_composition AS
      SELECT 
        rr.route_uuid,
        rr.route_name,
        rr.route_shape,
        rr.recommended_length_km,
        rr.recommended_elevation_gain,
        rt.trail_id,
        rt.trail_name,
        rt.segment_order,
        rt.segment_distance_km,
        rt.segment_elevation_gain,
        rt.segment_elevation_loss
      FROM route_recommendations rr
      JOIN route_trails rt ON rr.route_uuid = rt.route_uuid
      ORDER BY rr.route_uuid, rt.segment_order;
    `);

    // Enable WAL mode for better performance
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA cache_size = -64000;
      PRAGMA temp_store = MEMORY;
      PRAGMA mmap_size = 268435456;
    `);
  }

  /**
   * Export trails from staging schema
   */
  private async exportTrails(db: Database.Database): Promise<number> {
    const trailsResult = await this.pgClient.query(`
      SELECT DISTINCT ON (app_uuid)
        app_uuid, name, '${this.config.region}' as region, osm_id, 
        COALESCE(trail_type, 'unknown') as trail_type, 
        COALESCE(surface, 'unknown') as surface_type, 
        CASE 
          WHEN difficulty = 'unknown' OR difficulty IS NULL THEN 'moderate'
          ELSE difficulty
        END as difficulty,
        COALESCE(source, 'unknown') as source,
        ST_AsGeoJSON(geometry, 6, 0) as geojson,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      FROM ${this.stagingSchema}.trails
      ORDER BY app_uuid, name
    `);
    
    if (trailsResult.rows.length === 0) {
      throw new Error('No trails found to export');
    }
    
    // Insert trails into SQLite (use INSERT OR REPLACE to handle duplicate app_uuid)
    const insertTrails = db.prepare(`
      INSERT OR REPLACE INTO trails (
        app_uuid, name, region, osm_id, trail_type, surface_type, difficulty, source,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        geojson
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertMany = db.transaction((trails: any[]) => {
      for (const trail of trails) {
        insertTrails.run(
          trail.app_uuid,
          trail.name,
          trail.region,
          trail.osm_id,
          trail.trail_type,
          trail.surface_type,
          trail.difficulty,
          trail.source,
          trail.length_km,
          trail.elevation_gain,
          trail.elevation_loss,
          trail.max_elevation,
          trail.min_elevation,
          trail.avg_elevation,
          trail.bbox_min_lng,
          trail.bbox_max_lng,
          trail.bbox_min_lat,
          trail.bbox_max_lat,
          trail.geojson
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
      // Debug: List all tables in the staging schema
      const allTablesResult = await this.pgClient.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = '${this.stagingSchema}'
        ORDER BY table_name
      `);
      
      const availableTables = allTablesResult.rows.map(row => row.table_name);
      this.log(`🔍 Available tables in ${this.stagingSchema}: ${availableTables.join(', ')}`);
      
      // Check if routing_nodes table exists (our custom routing table)
      const tableExists = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = '${this.stagingSchema}' 
          AND table_name = 'routing_nodes'
        );
      `);
      
      if (!tableExists.rows[0].exists) {
        this.log(`⚠️  routing_nodes table does not exist in ${this.stagingSchema}`);
        this.log(`⚠️  Available tables: ${availableTables.join(', ')}`);
        return 0;
      }

      const nodesResult = await this.pgClient.query(`
        SELECT 
          id, 
          node_uuid, 
          lat, 
          lng, 
          COALESCE(elevation, 0) as elevation, 
          COALESCE(node_type, 'unknown') as node_type, 
          COALESCE(connected_trails::text, '0') as connected_trails,
          ST_AsGeoJSON(ST_SetSRID(ST_MakePoint(lng, lat), 4326), 6, 1) as geojson
        FROM ${this.stagingSchema}.routing_nodes
        ORDER BY id
      `);
      
      if (nodesResult.rows.length === 0) {
        this.log(`⚠️  No nodes found in routing_nodes`);
        return 0;
      }
      
      this.log(`✅ Found ${nodesResult.rows.length} routing nodes to export`);
      
      // Insert nodes into SQLite (use INSERT OR REPLACE to handle duplicates)
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
      this.log(`✅ Exported ${nodesResult.rows.length} routing nodes`);
      return nodesResult.rows.length;
    } catch (error) {
      this.log(`⚠️  Node export failed: ${error}`);
      this.log(`⚠️  Trying to query: ${this.stagingSchema}.routing_nodes`);
      return 0;
    }
  }

  /**
   * Export edges from staging schema
   */
  private async exportEdges(db: Database.Database): Promise<number> {
    try {
      // Check if routing_edges table exists (our custom routing table)
      const tableExists = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = '${this.stagingSchema}' 
          AND table_name = 'routing_edges'
        );
      `);
      
      if (!tableExists.rows[0].exists) {
        this.log(`⚠️  routing_edges table does not exist in ${this.stagingSchema}`);
        return 0;
      }

       // Export from routing_edges table (our custom routing table)
       const edgesResult = await this.pgClient.query(`
         SELECT 
           id, 
           source, 
           target, 
           COALESCE(trail_id, '') as trail_id, 
           COALESCE(trail_name, '') as trail_name,
           COALESCE(length_km, 0) as length_km, 
           COALESCE(elevation_gain, 0) as elevation_gain, 
           COALESCE(elevation_loss, 0) as elevation_loss,
           ST_AsGeoJSON(geometry, 6, 1) as geojson
         FROM ${this.stagingSchema}.routing_edges
         ORDER BY id
       `);
      
      if (edgesResult.rows.length === 0) {
        this.log(`⚠️  No edges found in routing_edges`);
        return 0;
      }
      
      this.log(`✅ Found ${edgesResult.rows.length} routing edges to export`);
      
      // Insert edges into SQLite (use INSERT OR REPLACE to handle duplicates)
      const insertEdges = db.prepare(`
        INSERT OR REPLACE INTO routing_edges (
          id, source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geojson
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            edge.geojson
          );
        }
      });
      
      insertMany(edgesResult.rows);
      this.log(`✅ Exported ${edgesResult.rows.length} routing edges`);
      return edgesResult.rows.length;
    } catch (error) {
      this.log(`⚠️  Unexpected error during edges export: ${error}`);
      return 0;
    }
  }


  /**
   * Export route recommendations from staging schema (v14 schema)
   */
  private async exportRouteRecommendations(db: Database.Database): Promise<number> {
    let totalExported = 0;
    
    try {
      // Export from lollipop_routes table (convert to route_recommendations format)
      const lollipopCount = await this.exportFromLollipopRoutes(db);
      totalExported += lollipopCount;
      
      // Export from route_recommendations table
      const recommendationsCount = await this.exportFromRouteRecommendations(db);
      totalExported += recommendationsCount;
      
      this.log(`✅ Exported ${totalExported} route recommendations (${lollipopCount} from lollipop_routes + ${recommendationsCount} from route_recommendations)`);
      return totalExported;
    } catch (error) {
      this.log(`⚠️  Route recommendations export failed: ${error}`);
      return totalExported;
    }
  }

  /**
   * Export from lollipop_routes table to unified route_recommendations table
   */
  private async exportFromLollipopRoutes(db: Database.Database): Promise<number> {
    try {
      // Check if route_recommendations table exists
      const tableExists = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = '${this.stagingSchema}' 
          AND table_name = 'route_recommendations'
        );
      `);
      
      if (!tableExists.rows[0].exists) {
        this.log(`⚠️  route_recommendations table does not exist in ${this.stagingSchema}`);
        return 0;
      }

      // Use the same query as GeoJSON export - getExportRoutes
      const lollipopRoutesResult = await this.pgClient.query(`
        SELECT 
          id,
          route_uuid,
          region,
          input_length_km,
          input_elevation_gain,
          recommended_length_km,
          recommended_elevation_gain,
          route_elevation_loss,
          route_score,
          route_name,
          route_shape,
          trail_count,
          route_edges,
          similarity_score,
          created_at,
          input_distance_tolerance,
          input_elevation_tolerance,
          expires_at,
          usage_count,
          complete_route_data,
          trail_connectivity_data,
          request_hash,
          route_gain_rate,
          route_trail_count,
          route_max_elevation,
          route_min_elevation,
          route_avg_elevation,
          route_difficulty,
          route_estimated_time_hours,
          route_connectivity_score,
          route_geometry_geojson as route_path
        FROM ${this.stagingSchema}.route_recommendations 
        WHERE route_geometry_geojson IS NOT NULL
        ORDER BY route_score DESC, created_at DESC
      `);
      
      if (lollipopRoutesResult.rows.length === 0) {
        this.log(`⚠️  No routes found to export`);
        return 0;
      }
      
      // Insert routes into SQLite route_recommendations table
      const insertRoute = db.prepare(`
        INSERT OR REPLACE INTO route_recommendations (
          route_uuid, region, input_length_km, input_elevation_gain, recommended_length_km,
          recommended_elevation_gain, route_elevation_loss, route_score, route_name,
          route_shape, trail_count, route_path, route_edges, similarity_score, created_at,
          input_distance_tolerance, input_elevation_tolerance, expires_at, usage_count,
          complete_route_data, trail_connectivity_data, request_hash, route_gain_rate,
          route_trail_count, route_max_elevation, route_min_elevation, route_avg_elevation,
          route_difficulty, route_estimated_time_hours, route_connectivity_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = db.transaction((routes: any[]) => {
        for (const route of routes) {
          const values = [
            route.route_uuid, route.region, route.input_length_km, route.input_elevation_gain,
            route.recommended_length_km, route.recommended_elevation_gain, route.route_elevation_loss,
            route.route_score, route.route_name, route.route_shape, route.trail_count,
            route.route_path, 
            typeof route.route_edges === 'object' ? JSON.stringify(route.route_edges) : route.route_edges,
            route.similarity_score, 
            typeof route.created_at === 'object' ? route.created_at.toISOString() : route.created_at,
            route.input_distance_tolerance, route.input_elevation_tolerance, 
            typeof route.expires_at === 'object' ? route.expires_at?.toISOString() : route.expires_at,
            route.usage_count, 
            typeof route.complete_route_data === 'object' ? JSON.stringify(route.complete_route_data) : route.complete_route_data,
            typeof route.trail_connectivity_data === 'object' ? JSON.stringify(route.trail_connectivity_data) : route.trail_connectivity_data,
            route.request_hash, route.route_gain_rate, route.route_trail_count, route.route_max_elevation,
            route.route_min_elevation, route.route_avg_elevation, route.route_difficulty,
            route.route_estimated_time_hours, route.route_connectivity_score
          ];
          
          console.log(`🔧 [DEBUG] Inserting route with ${values.length} values`);
          console.log(`🔧 [DEBUG] First few values:`, values.slice(0, 5));
          
          insertRoute.run(...values);
        }
      });
      
      insertMany(lollipopRoutesResult.rows);
      this.log(`✅ Exported ${lollipopRoutesResult.rows.length} routes`);
      return lollipopRoutesResult.rows.length;
    } catch (error) {
      this.log(`⚠️  Routes export failed: ${error}`);
      return 0;
    }
  }

  /**
   * Export from route_recommendations table to unified route_recommendations table
   */
  private async exportFromRouteRecommendations(db: Database.Database): Promise<number> {
    try {
      // Check if route_recommendations table exists
      const tableExists = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = '${this.stagingSchema}' 
          AND table_name = 'route_recommendations'
        );
      `);
      
      if (!tableExists.rows[0].exists) {
        this.log(`⚠️  route_recommendations table does not exist in ${this.stagingSchema}`);
        return 0;
      }

      const recommendationsResult = await this.pgClient.query(`
        SELECT 
          route_uuid,
          region,
          input_length_km,
          input_elevation_gain,
          recommended_length_km,
          recommended_elevation_gain,
          route_elevation_loss,
          route_score,
          route_name,
          route_shape,
          trail_count,
          ST_AsGeoJSON(route_geometry, 6, 1) as route_path,
          route_edges,
          similarity_score,
          created_at,
          input_distance_tolerance,
          input_elevation_tolerance,
          expires_at,
          usage_count,
          complete_route_data,
          trail_connectivity_data,
          request_hash,
          COALESCE(route_gain_rate, 
            CASE 
              WHEN recommended_length_km > 0 AND recommended_elevation_gain IS NOT NULL 
              THEN (recommended_elevation_gain / recommended_length_km) 
              ELSE 0 
            END) as route_gain_rate,
          COALESCE(route_trail_count, trail_count) as route_trail_count,
          route_max_elevation,
          route_min_elevation,
          route_avg_elevation,
          route_difficulty,
          COALESCE(route_estimated_time_hours,
            CASE 
              WHEN recommended_length_km > 0 
              THEN (recommended_length_km / 3.0) 
              ELSE 0 
            END) as route_estimated_time_hours,
          COALESCE(route_connectivity_score, 0.9) as route_connectivity_score
        FROM ${this.stagingSchema}.route_recommendations
        ORDER BY recommended_length_km DESC
      `);
      
      if (recommendationsResult.rows.length === 0) {
        this.log(`⚠️  No route recommendations found`);
        return 0;
      }
      
      // Insert recommendations into v14 route_recommendations table
      console.log(`🔧 [DEBUG] Preparing INSERT statement for route_recommendations...`);
      
      // First, verify the table structure before preparing the INSERT
      const tableInfo = db.prepare("PRAGMA table_info(route_recommendations)").all() as any[];
      console.log(`🔧 [DEBUG] Current route_recommendations columns:`, tableInfo.map((col: any) => col.name));
      
      const insertRoute = db.prepare(`
        INSERT OR REPLACE INTO route_recommendations (
          route_uuid, region, input_length_km, input_elevation_gain, recommended_length_km,
          recommended_elevation_gain, route_elevation_loss, route_score, route_name,
          route_shape, trail_count, route_path, route_edges, similarity_score, created_at,
          input_distance_tolerance, input_elevation_tolerance, expires_at, usage_count,
          complete_route_data, trail_connectivity_data, request_hash, route_gain_rate,
          route_trail_count, route_max_elevation, route_min_elevation, route_avg_elevation,
          route_difficulty, route_estimated_time_hours, route_connectivity_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      console.log(`✅ [DEBUG] INSERT statement prepared successfully`);
      
      const insertMany = db.transaction((routes: any[]) => {
        for (const route of routes) {
          const values = [
            route.route_uuid, route.region, route.input_length_km, route.input_elevation_gain,
            route.recommended_length_km, route.recommended_elevation_gain, route.route_elevation_loss,
            route.route_score, route.route_name, route.route_shape, route.trail_count,
            route.route_path, 
            typeof route.route_edges === 'object' ? JSON.stringify(route.route_edges) : route.route_edges,
            route.similarity_score, 
            typeof route.created_at === 'object' ? route.created_at.toISOString() : route.created_at,
            route.input_distance_tolerance, route.input_elevation_tolerance, 
            typeof route.expires_at === 'object' ? route.expires_at?.toISOString() : route.expires_at,
            route.usage_count, 
            typeof route.complete_route_data === 'object' ? JSON.stringify(route.complete_route_data) : route.complete_route_data,
            typeof route.trail_connectivity_data === 'object' ? JSON.stringify(route.trail_connectivity_data) : route.trail_connectivity_data,
            route.request_hash, route.route_gain_rate, route.route_trail_count, route.route_max_elevation,
            route.route_min_elevation, route.route_avg_elevation, route.route_difficulty,
            route.route_estimated_time_hours, route.route_connectivity_score
          ];
          
          console.log(`🔧 [DEBUG] Inserting route with ${values.length} values`);
          console.log(`🔧 [DEBUG] First few values:`, values.slice(0, 5));
          
          insertRoute.run(...values);
        }
      });
      
      insertMany(recommendationsResult.rows);
      this.log(`✅ Exported ${recommendationsResult.rows.length} route recommendations to unified table`);
      return recommendationsResult.rows.length;
    } catch (error) {
      this.log(`⚠️  Route recommendations export failed: ${error}`);
      return 0;
    }
  }

  /**
   * Insert region metadata
   */
  private async insertRegionMetadata(db: Database.Database, result: SQLiteExportResult): Promise<void> {
    // Get trail statistics (staging trails table doesn't have region column)
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
    `);
    
    const stats = statsResult.rows[0];
    
    const insertMetadata = db.prepare(`
      INSERT OR REPLACE INTO region_metadata (
        region, total_trails, total_nodes, total_edges, total_routes,
        bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    insertMetadata.run(
      this.config.region,
      result.trailsExported,
      result.nodesExported,
      result.edgesExported,
      result.recommendationsExported || 0, // total_routes
      stats.bbox_min_lat,
      stats.bbox_max_lat,
      stats.bbox_min_lng,
      stats.bbox_max_lng
    );
  }

  /**
   * Export route analysis data
   */
  private async exportRouteAnalysis(db: Database.Database): Promise<number> {
    try {
      // No need to clear existing data - this is a fresh SQLite database

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
        constituent_analysis_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          JSON.stringify(analysis),
          new Date().toISOString()
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
      // No need to clear existing data - this is a fresh SQLite database

      // Check if route_trails table exists
      const tableExists = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = '${this.stagingSchema}' 
          AND table_name = 'route_trails'
        );
      `);
      
      if (!tableExists.rows[0].exists) {
        this.log(`⚠️  route_trails table does not exist in ${this.stagingSchema}`);
        return 0;
      }

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

      const insertMany = db.transaction((trails: any[]) => {
        for (const trail of trails) {
          insertRouteTrail.run(
            trail.route_uuid,
            trail.trail_id,
            trail.trail_name,
            trail.segment_order,
            trail.segment_distance_km,
            trail.segment_elevation_gain,
            trail.segment_elevation_loss,
            trail.created_at
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
    
    insertVersion.run(15, 'Carthorse SQLite Export v15.0 (Enhanced Route Recommendations + Comprehensive Parametric Search)');
  }

  /**
   * Calculate export fields in staging schema before export
   */
  private async calculateExportFields(): Promise<void> {
    try {
      console.log(`🔍 [DEBUG] Checking staging schema: ${this.stagingSchema}`);
      
      // Check if route_recommendations table exists
      const tableExists = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = '${this.stagingSchema}' 
          AND table_name = 'route_recommendations'
        );
      `);
      
      console.log(`🔍 [DEBUG] route_recommendations table exists: ${tableExists.rows[0].exists}`);
      
      if (!tableExists.rows[0].exists) {
        this.log(`⚠️  route_recommendations table does not exist in ${this.stagingSchema}, skipping export field calculation`);
        return;
      }

      // Check what columns exist in the table
      const columnsResult = await this.pgClient.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = '${this.stagingSchema}' 
        AND table_name = 'route_recommendations'
        ORDER BY column_name;
      `);
      
      console.log(`🔍 [DEBUG] Existing columns in route_recommendations:`, columnsResult.rows.map(r => r.column_name));

      // Check if route_gain_rate column exists - if not, add it
      const hasRouteGainRate = columnsResult.rows.some(r => r.column_name === 'route_gain_rate');
      if (!hasRouteGainRate) {
        console.log(`🔍 [DEBUG] route_gain_rate column missing, adding it...`);
        await this.ensureExportColumnsExist();
      } else {
        console.log(`✅ [DEBUG] route_gain_rate column already exists, skipping column addition`);
      }
      
      // Export fields are now calculated upstream during route generation
      this.log(`✅ Export fields are calculated upstream during route generation`);
    } catch (error) {
      console.error(`❌ [DEBUG] Failed to prepare export fields:`, error);
      this.log(`⚠️  Failed to prepare export fields: ${error instanceof Error ? error.message : String(error)}`);
      // Don't throw - continue with export even if export field preparation fails
    }
  }

  /**
   * Ensure export columns exist in route_recommendations table
   */
  private async ensureExportColumnsExist(): Promise<void> {
    const exportColumns = [
      'route_gain_rate REAL',
      'route_trail_count INTEGER',
      'route_max_elevation REAL',
      'route_min_elevation REAL',
      'route_avg_elevation REAL',
      'route_difficulty TEXT',
      'route_estimated_time_hours REAL',
      'route_connectivity_score REAL',
      'route_elevation_loss REAL',
      'input_distance_tolerance REAL',
      'input_elevation_tolerance REAL',
      'expires_at TIMESTAMP',
      'usage_count INTEGER',
      'complete_route_data JSONB',
      'trail_connectivity_data JSONB',
      'request_hash TEXT'
    ];

    console.log(`🔍 [DEBUG] Adding missing export columns...`);
    
    for (const columnDef of exportColumns) {
      const [columnName] = columnDef.split(' ');
      try {
        console.log(`🔍 [DEBUG] Adding column: ${columnName}`);
        await this.pgClient.query(`
          ALTER TABLE ${this.stagingSchema}.route_recommendations 
          ADD COLUMN IF NOT EXISTS ${columnName} ${columnDef.substring(columnName.length + 1)}
        `);
        console.log(`✅ [DEBUG] Added column: ${columnName}`);
      } catch (error) {
        console.error(`❌ [DEBUG] Failed to add column ${columnName}:`, error);
        this.log(`⚠️  Failed to add column ${columnName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
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