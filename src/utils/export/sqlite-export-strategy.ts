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
    const result: SQLiteExportResult = {
      trailsExported: 0,
      nodesExported: 0,
      edgesExported: 0,
      dbSizeMB: 0,
      isValid: false,
      errors: []
    };

    try {
      this.log(`📦 Starting SQLite export to: ${this.config.outputPath}`);
      
      // Create SQLite database
      const db = new Database(this.config.outputPath);
      
      // Create tables
      this.createSqliteTables(db);
      
      // Export data
      if (this.config.includeTrails !== false) {
        result.trailsExported = await this.exportTrails(db);
      }
      
      if (this.config.includeNodes !== false) {
        result.nodesExported = await this.exportNodes(db);
      }
      
      if (this.config.includeEdges !== false) {
        result.edgesExported = await this.exportEdges(db);
      }
      
      if (this.config.includeRecommendations !== false) {
        result.recommendationsExported = await this.exportRecommendations(db);
      }
      
      // Insert metadata
      await this.insertRegionMetadata(db, result);
      this.insertSchemaVersion(db);
      
      // Close database
      db.close();
      
      // Calculate file size
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
        geojson TEXT
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
        geojson TEXT
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
      // Only export from split_trails - no fallback to original trails
      const trailsResult = await this.pgClient.query(`
        SELECT 
          app_uuid, name, osm_id, trail_type, surface as surface_type, 
          CASE 
            WHEN difficulty = 'unknown' THEN 'moderate'
            ELSE difficulty
          END as difficulty,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, original_trail_id,
          ST_AsGeoJSON(geometry, 6, 0) as geojson
        FROM ${this.stagingSchema}.split_trails
        WHERE geometry IS NOT NULL
        ORDER BY name
      `);
      
      if (trailsResult.rows.length === 0) {
        this.log(`❌ No trails found in split_trails table. Trail splitting must be completed before export.`);
        throw new Error('split_trails table is empty. Trail splitting must be completed before export.');
      }
      
      // Check if we have valid GeoJSON data
      const trailsWithGeoJSON = trailsResult.rows.filter(trail => trail.geojson && trail.geojson !== 'null');
      const trailsWithoutGeoJSON = trailsResult.rows.filter(trail => !trail.geojson || trail.geojson === 'null');
      
      this.log(`📊 Found ${trailsResult.rows.length} total split trails`);
      this.log(`📊 Trails with GeoJSON: ${trailsWithGeoJSON.length}`);
      this.log(`📊 Trails without GeoJSON: ${trailsWithoutGeoJSON.length}`);
      
      if (trailsWithoutGeoJSON.length > 0) {
        this.log(`⚠️  Some trails are missing GeoJSON data. This may cause API validation issues.`);
      }
      
      // Insert trails into SQLite
      const insertTrails = db.prepare(`
        INSERT OR REPLACE INTO trails (
          app_uuid, name, region, osm_id, trail_type, surface_type, difficulty,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, geojson
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = db.transaction((trails: any[]) => {
        for (const trail of trails) {
          try {
            // Use the original app_uuid from split_trails to maintain 1:1 mapping with edges
            insertTrails.run(
              trail.app_uuid,
              trail.name || '',
              this.config.region,
              trail.osm_id || '',
              trail.trail_type || 'hiking',
              trail.surface_type || 'dirt',
              trail.difficulty || 'moderate',
              trail.length_km || 0,
              trail.elevation_gain || 0,
              trail.elevation_loss || 0,
              trail.max_elevation || 0,
              trail.min_elevation || 0,
              trail.avg_elevation || 0,
              trail.bbox_min_lng || 0,
              trail.bbox_max_lng || 0,
              trail.bbox_min_lat || 0,
              trail.bbox_max_lat || 0,
              trail.geojson || '' // Use actual GeoJSON from geometry
            );
          } catch (error) {
            this.log(`⚠️  Failed to insert trail ${trail.app_uuid}: ${error}`);
          }
        }
      });
      
      insertMany(trailsResult.rows);
      return trailsResult.rows.length;
    } catch (error) {
      this.log(`❌ Error during trails export: ${error}`);
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
          node_uuid, 
          lat, 
          lng, 
          COALESCE(elevation, 0) as elevation, 
          COALESCE(node_type, 'intersection') as node_type,
          COALESCE(connected_trails, '') as connected_trails,
          ST_AsGeoJSON(geometry, 6, 0) as geojson
        FROM ${this.stagingSchema}.routing_nodes
        WHERE geometry IS NOT NULL
        ORDER BY id
      `);
      
      if (nodesResult.rows.length === 0) {
        this.log(`⚠️  No nodes found in ways_noded_vertices_pgr`);
        return 0;
      }
      
      // Check if we have valid GeoJSON data
      const nodesWithGeoJSON = nodesResult.rows.filter(node => node.geojson && node.geojson !== 'null');
      const nodesWithoutGeoJSON = nodesResult.rows.filter(node => !node.geojson || node.geojson === 'null');
      
      this.log(`📊 Found ${nodesResult.rows.length} total nodes`);
      this.log(`📊 Nodes with GeoJSON: ${nodesWithGeoJSON.length}`);
      this.log(`📊 Nodes without GeoJSON: ${nodesWithoutGeoJSON.length}`);
      
      if (nodesWithoutGeoJSON.length > 0) {
        this.log(`⚠️  Some nodes are missing GeoJSON data. This may cause API validation issues.`);
      }
      
      // Insert nodes into SQLite
      const insertNodes = db.prepare(`
        INSERT INTO routing_nodes (
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
      this.log(`⚠️  routing_nodes table not found, skipping nodes export: ${error}`);
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
          from_node_id as source, 
          to_node_id as target, 
          trail_id, 
          trail_name,
          COALESCE(distance_km, 0) as length_km, 
          COALESCE(elevation_gain, 0) as elevation_gain, 
          COALESCE(elevation_loss, 0) as elevation_loss,
          ST_AsGeoJSON(geometry, 6, 0) as geojson
        FROM ${this.stagingSchema}.routing_edges
        WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL
        ORDER BY id
      `);
      
      if (edgesResult.rows.length === 0) {
        this.log(`⚠️  No edges found in ways_noded`);
        return 0;
      }
      
      // Check if we have valid GeoJSON data
      const edgesWithGeoJSON = edgesResult.rows.filter(edge => edge.geojson && edge.geojson !== 'null');
      const edgesWithoutGeoJSON = edgesResult.rows.filter(edge => !edge.geojson || edge.geojson === 'null');
      
      this.log(`📊 Found ${edgesResult.rows.length} total edges`);
      this.log(`📊 Edges with GeoJSON: ${edgesWithGeoJSON.length}`);
      this.log(`📊 Edges without GeoJSON: ${edgesWithoutGeoJSON.length}`);
      
      if (edgesWithoutGeoJSON.length > 0) {
        this.log(`⚠️  Some edges are missing GeoJSON data. This may cause API validation issues.`);
      }
      
      // Insert edges into SQLite
      const insertEdges = db.prepare(`
        INSERT INTO routing_edges (
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
      return edgesResult.rows.length;
    } catch (error) {
      this.log(`⚠️  routing_edges table not found, skipping edges export: ${error}`);
      return 0;
    }
  }

  /**
   * Export recommendations from staging schema
   */
  private async exportRecommendations(db: Database.Database): Promise<number> {
    try {
      this.log(`🔍 Looking for route_recommendations in staging schema: ${this.stagingSchema}`);
      
      const recommendationsResult = await this.pgClient.query(`
        SELECT 
          route_uuid, region, input_length_km, input_elevation_gain,
          recommended_length_km, recommended_elevation_gain,
          route_score, route_type, route_name, route_shape, trail_count,
          route_path, route_edges, created_at
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
          recommended_length_km, recommended_elevation_gain,
          route_score, route_type, route_name, route_shape, trail_count,
          route_path, route_edges, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            rec.route_score,
            rec.route_type,
            rec.route_name,
            rec.route_shape,
            rec.trail_count,
            rec.route_path ? JSON.stringify(rec.route_path) : null,
            rec.route_edges ? JSON.stringify(rec.route_edges) : null,
            rec.created_at ? (typeof rec.created_at === 'string' ? rec.created_at : rec.created_at.toISOString()) : new Date().toISOString()
          );
        }
      });
      
      insertMany(recommendationsResult.rows);
      return recommendationsResult.rows.length;
    } catch (error) {
      this.log(`⚠️  route_recommendations table not found in schema ${this.stagingSchema}, skipping recommendations export`);
      return 0;
    }
  }

  /**
   * Insert region metadata
   */
  private async insertRegionMetadata(db: Database.Database, result: SQLiteExportResult): Promise<void> {
    // Get trail statistics from split_trails (no region column needed)
    const statsResult = await this.pgClient.query(`
      SELECT 
        COUNT(*) as trail_count,
        SUM(length_km) as total_length_km,
        SUM(elevation_gain) as total_elevation_gain,
        MIN(bbox_min_lng) as bbox_min_lng,
        MAX(bbox_max_lng) as bbox_max_lng,
        MIN(bbox_min_lat) as bbox_min_lat,
        MAX(bbox_max_lat) as bbox_max_lat
      FROM ${this.stagingSchema}.split_trails
    `);
    
    const stats = statsResult.rows[0];
    
    const insertMetadata = db.prepare(`
      INSERT OR REPLACE INTO region_metadata (
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
      stats.bbox_min_lng || 0,
      stats.bbox_max_lng || 0,
      stats.bbox_min_lat || 0,
      stats.bbox_max_lat || 0,
      new Date().toISOString()
    );
  }

  /**
   * Insert schema version
   */
  private insertSchemaVersion(db: Database.Database): void {
    const insertVersion = db.prepare(`
      INSERT OR REPLACE INTO schema_version (version, created_at) VALUES (?, ?)
    `);
    
    insertVersion.run('v14', new Date().toISOString());
  }
} 