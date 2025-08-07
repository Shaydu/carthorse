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
  verbose?: boolean;
}

export interface SQLiteExportResult {
  trailsExported: number;
  nodesExported: number;
  edgesExported: number;
  recommendationsExported?: number;
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

  private log(message: string) {
    if (this.config.verbose) {
      console.log(`[SQLite Export] ${message}`);
    }
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
        version TEXT PRIMARY KEY,
        created_at TEXT
      )
    `);
  }

  /**
   * Export trails from staging schema
   */
  private async exportTrails(db: Database.Database): Promise<number> {
    try {
      const trailsResult = await this.pgClient.query(`
        SELECT 
          app_uuid, name, region, osm_id, trail_type, surface as surface_type, 
          CASE 
            WHEN difficulty = 'unknown' THEN 'moderate'
            ELSE difficulty
          END as difficulty,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          created_at, updated_at
        FROM ${this.stagingSchema}.split_trails
        WHERE region = $1
        ORDER BY name
      `, [this.config.region]);
      
      if (trailsResult.rows.length === 0) {
        this.log(`⚠️  No trails found in split_trails`);
        return 0;
      }
      
      // Insert trails into SQLite
      const insertTrails = db.prepare(`
        INSERT INTO trails (
          app_uuid, name, region, osm_id, trail_type, surface_type, difficulty,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      let insertedCount = 0;
      for (const trail of trailsResult.rows) {
        try {
          insertTrails.run(
            trail.app_uuid,
            trail.name,
            trail.region,
            trail.osm_id,
            trail.trail_type,
            trail.surface_type,
            trail.difficulty,
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
            trail.created_at,
            trail.updated_at
          );
          insertedCount++;
        } catch (error) {
          this.log(`⚠️  Failed to insert trail ${trail.app_uuid}: ${error}`);
        }
      }
      
      this.log(`✅ Exported ${insertedCount} split trails (1:1 with edges)`);
      return insertedCount;
    } catch (error) {
      this.log(`❌ Error exporting trails: ${error}`);
      throw error;
    }
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
          COALESCE(ST_Z(the_geom), 0) as elevation, 
          CASE 
            WHEN cnt >= 2 THEN 'intersection'
            WHEN cnt = 1 THEN 'endpoint'
            ELSE 'endpoint'
          END as node_type,
          '' as connected_trails,
          created_at
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
          id, node_uuid, lat, lng, elevation, node_type, connected_trails, created_at
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
            node.created_at ? (typeof node.created_at === 'string' ? node.created_at : node.created_at.toISOString()) : new Date().toISOString()
          );
        }
      });
      
      insertMany(nodesResult.rows);
      return nodesResult.rows.length;
    } catch (error) {
      this.log(`⚠️  ways_noded_vertices_pgr table not found, skipping nodes export: ${error}`);
      return 0;
    }
  }

  /**
   * Export edges from staging schema
   */
  private async exportEdges(db: Database.Database): Promise<number> {
    try {
      const edgesResult = await this.pgClient.query(`
        SELECT 
          id, 
          source, 
          target, 
          app_uuid as trail_id, 
          name as trail_name,
          COALESCE(length_km, ST_Length(the_geom::geography) / 1000) as length_km, 
          COALESCE(elevation_gain, 0) as elevation_gain, 
          COALESCE(elevation_loss, 0) as elevation_loss,
          ST_AsGeoJSON(the_geom, 6, 0) as geojson,
          created_at
        FROM ${this.stagingSchema}.ways_noded
        WHERE source IS NOT NULL AND target IS NOT NULL
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
      this.log(`⚠️  ways_noded table not found, skipping edges export: ${error}`);
      return 0;
    }
  }

  /**
   * Export recommendations from staging schema
   */
  private async exportRecommendations(db: Database.Database): Promise<number> {
    try {
      const recommendationsResult = await this.pgClient.query(`
        SELECT 
          route_uuid, region, input_length_km, input_elevation_gain,
          recommended_length_km, recommended_elevation_gain, recommended_elevation_loss,
          route_score, route_type, route_name, route_shape, trail_count,
          route_path, route_edges, request_hash, expires_at, created_at
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
      
      const insertMany = db.transaction((recommendations: any[]) => {
        for (const rec of recommendations) {
          insertRecommendations.run(
            rec.route_uuid,
            rec.region,
            rec.input_length_km,
            rec.input_elevation_gain,
            rec.recommended_length_km,
            rec.recommended_elevation_gain,
            rec.recommended_elevation_loss,
            rec.route_score,
            rec.route_type,
            rec.route_name,
            rec.route_shape,
            rec.trail_count,
            rec.route_path ? JSON.stringify(rec.route_path) : null,
            rec.route_edges ? JSON.stringify(rec.route_edges) : null,
            rec.request_hash,
            rec.expires_at ? (typeof rec.expires_at === 'string' ? rec.expires_at : rec.expires_at.toISOString()) : null,
            rec.created_at ? (typeof rec.created_at === 'string' ? rec.created_at : rec.created_at.toISOString()) : new Date().toISOString()
          );
        }
      });
      
      insertMany(recommendationsResult.rows);
      return recommendationsResult.rows.length;
    } catch (error) {
      this.log(`⚠️  route_recommendations table not found, skipping recommendations export`);
      return 0;
    }
  }

  /**
   * Insert region metadata
   */
  private async insertRegionMetadata(db: Database.Database, result: SQLiteExportResult): Promise<void> {
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
    
    insertMetadata.run(
      this.config.region,
      result.trailsExported,
      result.nodesExported,
      result.edgesExported,
      stats.total_length_km || 0,
      stats.total_elevation_gain || 0,
      stats.bbox_min_lng,
      stats.bbox_max_lng,
      stats.bbox_min_lat,
      stats.bbox_max_lat,
      new Date().toISOString()
    );
  }

  /**
   * Insert schema version
   */
  private insertSchemaVersion(db: Database.Database): void {
    const insertVersion = db.prepare(`
      INSERT INTO schema_version (version, created_at) VALUES (?, ?)
    `);
    
    insertVersion.run('v1.0.0', new Date().toISOString());
  }
} 