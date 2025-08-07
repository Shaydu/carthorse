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
      
      // Export route_trails (always include if recommendations are included)
      if (this.config.includeRecommendations !== false) {
        result.routeTrailsExported = await this.exportRouteTrails(db);
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
      if (result.routeTrailsExported) {
        console.log(`   - Route Trail Segments: ${result.routeTrailsExported}`);
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
    // Create trails table (v14 schema)
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
        difficulty TEXT CHECK(difficulty IN ('easy', 'moderate', 'hard', 'expert', 'unknown')),
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

    // Create routing_nodes table (v14 schema - API service compatible)
    db.exec(`
      CREATE TABLE IF NOT EXISTS routing_nodes (
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

    // Create routing_edges table (v14 schema)
    db.exec(`
      CREATE TABLE IF NOT EXISTS routing_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source INTEGER NOT NULL,
        target INTEGER NOT NULL,
        trail_id TEXT,
        trail_name TEXT NOT NULL,
        length_km REAL CHECK(length_km > 0) NOT NULL,
        elevation_gain REAL CHECK(elevation_gain >= 0),
        elevation_loss REAL CHECK(elevation_loss >= 0),
        geojson TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create route_recommendations table (v14 schema)
    db.exec(`
      CREATE TABLE IF NOT EXISTS route_recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_uuid TEXT UNIQUE NOT NULL,
        region TEXT NOT NULL,
        input_length_km REAL CHECK(input_length_km > 0),
        input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
        recommended_length_km REAL CHECK(recommended_length_km > 0),
        recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
        route_score REAL CHECK(route_score >= 0 AND route_score <= 100),
        route_type TEXT CHECK(route_type IN ('out-and-back', 'loop', 'lollipop', 'point-to-point', 'unknown')) NOT NULL,
        route_name TEXT,
        route_shape TEXT CHECK(route_shape IN ('loop', 'out-and-back', 'lollipop', 'point-to-point')) NOT NULL,
        trail_count INTEGER CHECK(trail_count >= 1) NOT NULL,
        route_path TEXT NOT NULL,
        route_edges TEXT NOT NULL,
        similarity_score REAL CHECK(similarity_score >= 0 AND similarity_score <= 1) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        complete_route_data TEXT
      )
    `);

    // Create route_trails table (v14 schema)
    db.exec(`
      CREATE TABLE IF NOT EXISTS route_trails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_uuid TEXT NOT NULL,
        trail_id TEXT NOT NULL,
        trail_name TEXT NOT NULL,
        segment_order INTEGER NOT NULL,
        segment_length_km REAL CHECK(segment_length_km > 0),
        segment_elevation_gain REAL CHECK(segment_elevation_gain >= 0),
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create region_metadata table (v14 schema)
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

    // Create schema_version table (v14 schema)
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for optimal performance
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON trails(app_uuid);
      CREATE INDEX IF NOT EXISTS idx_trails_region ON trails(region);
      CREATE INDEX IF NOT EXISTS idx_routing_nodes_uuid ON routing_nodes(node_uuid);
      CREATE INDEX IF NOT EXISTS idx_routing_nodes_location ON routing_nodes(lat, lng);
      CREATE INDEX IF NOT EXISTS idx_routing_edges_source ON routing_edges(source);
      CREATE INDEX IF NOT EXISTS idx_routing_edges_target ON routing_edges(target);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_region ON route_recommendations(region);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_uuid ON route_recommendations(route_uuid);
      CREATE INDEX IF NOT EXISTS idx_route_trails_route_uuid ON route_trails(route_uuid);
      CREATE INDEX IF NOT EXISTS idx_route_trails_trail_id ON route_trails(trail_id);
    `);

    // Enable WAL mode for better performance
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA cache_size = -64000;
      PRAGMA temp_store = MEMORY;
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
   * Export nodes from staging schema (using ways_noded_vertices_pgr)
   */
  private async exportNodes(db: Database.Database): Promise<number> {
    try {
      // Get unique nodes from ways_noded_vertices_pgr
      const nodesResult = await this.pgClient.query(`
        SELECT DISTINCT
          v.id,
          ST_X(v.the_geom) as lng,
          ST_Y(v.the_geom) as lat,
          COALESCE(ST_Z(v.the_geom), 0) as elevation,
          CASE 
            WHEN v.cnt > 2 THEN 'intersection'
            ELSE 'endpoint'
          END as node_type,
          '' as connected_trails
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        ORDER BY v.id
      `);
      
      if (nodesResult.rows.length === 0) {
        this.log(`⚠️  No nodes found in ways_noded_vertices_pgr`);
        return 0;
      }
      
      this.log(`📊 Found ${nodesResult.rows.length} routing nodes`);
      
      // Insert nodes into SQLite (let SQLite auto-generate id to avoid duplicate ID conflicts)
      const insertNodes = db.prepare(`
        INSERT INTO routing_nodes (
          node_uuid, lat, lng, elevation, node_type, connected_trails
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = db.transaction((nodes: any[]) => {
        for (const node of nodes) {
          // Generate a UUID for the node
          const nodeUuid = `node_${node.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          insertNodes.run(
            nodeUuid,
            node.lat,
            node.lng,
            node.elevation,
            node.node_type,
            node.connected_trails
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
   * Export edges from staging schema (using ways_noded with simplification)
   */
  private async exportEdges(db: Database.Database): Promise<number> {
    try {
      const edgesResult = await this.pgClient.query(`
        SELECT 
          w.source, 
          w.target, 
          w.app_uuid as trail_id, 
          w.name as trail_name,
          COALESCE(w.length_km, 0) as length_km, 
          COALESCE(w.elevation_gain, 0) as elevation_gain, 
          COALESCE(w.elevation_loss, 0) as elevation_loss,
          -- Simplify geometry while preserving start/end points for routing connectivity
          ST_AsGeoJSON(
            ST_SimplifyPreserveTopology(
              ST_Force2D(w.the_geom), -- Convert to 2D for routing edges
              0.0001 -- Simplify tolerance (about 10 meters)
            )
          ) as geojson
        FROM ${this.stagingSchema}.ways_noded w
        WHERE w.source IS NOT NULL AND w.target IS NOT NULL
        ORDER BY w.source, w.target
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
      
      // Insert edges into SQLite (let SQLite auto-generate id to avoid duplicate ID conflicts)
      const insertEdges = db.prepare(`
        INSERT INTO routing_edges (
          source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geojson
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = db.transaction((edges: any[]) => {
        for (const edge of edges) {
          insertEdges.run(
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
      this.log(`⚠️  ways_noded table not found, skipping edges export: ${error}`);
      return 0;
    }
  }

  /**
   * Export recommendations from staging schema
   */
  private async exportRecommendations(db: Database.Database): Promise<number> {
    try {
      this.log(`🔍 Looking for route_recommendations in staging schema: ${this.stagingSchema}`);
      this.log(`🔍 About to execute query on ${this.stagingSchema}.route_recommendations`);
      
      const recommendationsResult = await this.pgClient.query(`
        SELECT 
          route_uuid, region, input_length_km, input_elevation_gain,
          recommended_length_km, recommended_elevation_gain,
          route_score, route_type, route_name, route_shape, trail_count,
          route_path, route_edges, similarity_score, created_at,
          complete_route_data
        FROM ${this.stagingSchema}.route_recommendations
        ORDER BY created_at DESC
      `);
      
      this.log(`✅ Query executed successfully, found ${recommendationsResult.rows.length} recommendations`);
      
      if (recommendationsResult.rows.length === 0) {
        this.log(`⚠️  No recommendations found in route_recommendations`);
        return 0;
      }
      
      // Insert recommendations into SQLite
      this.log(`🔍 Preparing SQLite INSERT statement for route_recommendations`);
      const insertRecommendations = db.prepare(`
        INSERT INTO route_recommendations (
          route_uuid, region, input_length_km, input_elevation_gain,
          recommended_length_km, recommended_elevation_gain,
          route_score, route_type, route_name, route_shape, trail_count,
          route_path, route_edges, similarity_score, created_at,
          complete_route_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this.log(`✅ SQLite INSERT statement prepared successfully`);
      
      const insertMany = db.transaction((recommendations: any[]) => {
        for (const rec of recommendations) {
          // Generate complete_route_data in the required format if not already present
          let completeRouteData = rec.complete_route_data;
          if (!completeRouteData) {
            completeRouteData = {
              routeId: rec.route_uuid,
              routeName: rec.route_name,
              routeType: rec.trail_count === 1 ? 'single' : 'multi',
              totalDistance: rec.recommended_length_km,
              totalElevationGain: rec.recommended_elevation_gain,
              routeShape: rec.route_shape,
              similarityScore: rec.similarity_score,
              trailSegments: rec.route_edges ? rec.route_edges.map((edge: any, index: number) => ({
                trailId: edge.trail_id || edge.trail_uuid,
                appUuid: edge.app_uuid,
                osmId: edge.osm_id,
                name: edge.trail_name || edge.name,
                geometry: edge.geometry || edge.the_geom,
                distance: edge.distance_km || edge.length_km,
                elevationGain: edge.elevation_gain,
                elevationLoss: edge.elevation_loss
              })) : [],
              connectivity: {
                segmentConnections: [],
                routeContinuity: true,
                gaps: []
              },
              combinedPath: rec.route_path,
              combinedBbox: null,
              createdAt: rec.created_at ? (typeof rec.created_at === 'string' ? rec.created_at : rec.created_at.toISOString()) : new Date().toISOString(),
              region: rec.region,
              inputParameters: {
                targetDistance: rec.input_length_km,
                targetElevationGain: rec.input_elevation_gain,
                distanceTolerance: 10,
                elevationTolerance: 20
              }
            };
          }
          
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
            rec.similarity_score,
            rec.created_at ? (typeof rec.created_at === 'string' ? rec.created_at : rec.created_at.toISOString()) : new Date().toISOString(),
            typeof completeRouteData === 'string' ? completeRouteData : JSON.stringify(completeRouteData)
          );
        }
      });
      
      insertMany(recommendationsResult.rows);
      return recommendationsResult.rows.length;
    } catch (error) {
      this.log(`❌ Error during route_recommendations export: ${error}`);
      this.log(`❌ Error details: ${JSON.stringify(error, null, 2)}`);
      this.log(`⚠️  route_recommendations table not found in schema ${this.stagingSchema}, skipping recommendations export`);
      return 0;
    }
  }

  /**
   * Export route_trails from staging schema
   */
  private async exportRouteTrails(db: Database.Database): Promise<number> {
    try {
      const routeTrailsResult = await this.pgClient.query(`
        SELECT 
          route_uuid, trail_id, trail_name, segment_order,
          segment_length_km, segment_elevation_gain, trail_type, surface, difficulty, created_at
        FROM ${this.stagingSchema}.route_trails
        ORDER BY route_uuid, segment_order
      `);
      
      if (routeTrailsResult.rows.length === 0) {
        this.log(`⚠️  No route trails found in route_trails`);
        return 0;
      }
      
      // Insert route trails into SQLite (let SQLite auto-generate id)
      const insertRouteTrails = db.prepare(`
        INSERT INTO route_trails (
          route_uuid, trail_id, trail_name, segment_order,
          segment_length_km, segment_elevation_gain, trail_type, surface, difficulty, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = db.transaction((routeTrails: any[]) => {
        for (const rt of routeTrails) {
          insertRouteTrails.run(
            rt.route_uuid,
            rt.trail_id,
            rt.trail_name,
            rt.segment_order,
            rt.segment_length_km,
            rt.segment_elevation_gain,
            rt.trail_type,
            rt.surface,
            rt.difficulty,
            rt.created_at ? (typeof rt.created_at === 'string' ? rt.created_at : rt.created_at.toISOString()) : new Date().toISOString()
          );
        }
      });
      
      insertMany(routeTrailsResult.rows);
      this.log(`✅ Exported ${routeTrailsResult.rows.length} route trail segments`);
      return routeTrailsResult.rows.length;
    } catch (error) {
      this.log(`⚠️  route_trails table not found in schema ${this.stagingSchema}, skipping route trails export`);
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
        COUNT(*) as total_trails,
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
        region, total_trails, total_nodes, total_edges, total_routes,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    insertMetadata.run(
      this.config.region,
      result.trailsExported,
      result.nodesExported,
      result.edgesExported,
      result.recommendationsExported || 0,
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
      INSERT OR REPLACE INTO schema_version (version, description, created_at) VALUES (?, ?, ?)
    `);
    
    insertVersion.run(14, 'Carthorse SQLite Export v14.0 (Enhanced Route Recommendations + Trail Composition)', new Date().toISOString());
  }
} 