// SQLite export helpers for Carthorse
// These functions create tables and insert data using regular SQLite without spatial extensions.
// Geometry is stored as WKT (Well-Known Text) strings.

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// Schema version for SQLite exports
export const CARTHORSE_SCHEMA_VERSION = 12;

/**
 * Create SQLite tables with v12 schema (pgRouting optimized + deduplication).
 */
export function createSqliteTables(db: Database.Database, dbPath?: string) {
  console.log('[SQLITE] Creating tables with v12 schema (pgRouting optimized + deduplication)...');
  
  // Create trails table (v12 schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS trails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_uuid TEXT UNIQUE NOT NULL,
      osm_id TEXT,
      name TEXT NOT NULL,
      source TEXT,
      trail_type TEXT,
      surface TEXT,
      difficulty TEXT,
      geojson TEXT NOT NULL,
      source_tags TEXT,
      bbox_min_lng REAL,
      bbox_max_lng REAL,
      bbox_min_lat REAL,
      bbox_max_lat REAL,
      length_km REAL CHECK(length_km > 0),
      elevation_gain REAL DEFAULT 0 CHECK(elevation_gain >= 0),
      elevation_loss REAL DEFAULT 0 CHECK(elevation_loss >= 0),
      max_elevation REAL DEFAULT 0,
      min_elevation REAL DEFAULT 0,
      avg_elevation REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create routing_nodes table (v12 schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS routing_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      elevation REAL,
      cnt INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create routing_edges table (v12 schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS routing_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source INTEGER NOT NULL,
      target INTEGER NOT NULL,
      trail_id TEXT,
      trail_name TEXT,
      distance_km REAL CHECK(distance_km > 0),
      geojson TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create region_metadata table (v12 schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS region_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      region_name TEXT NOT NULL,
      bbox_min_lng REAL,
      bbox_max_lng REAL,
      bbox_min_lat REAL,
      bbox_max_lat REAL,
      trail_count INTEGER CHECK(trail_count >= 0),
      processing_config TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create schema_version table (v12 schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create route_recommendations table (v12 schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS route_recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_uuid TEXT UNIQUE,
      region TEXT NOT NULL,
      gpx_distance_km REAL CHECK(gpx_distance_km >= 0),
      gpx_elevation_gain REAL CHECK(gpx_elevation_gain >= 0),
      gpx_name TEXT,
      recommended_distance_km REAL CHECK(recommended_distance_km >= 0),
      recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
      route_type TEXT,
      route_edges TEXT,
      route_path TEXT,
      similarity_score REAL CHECK(similarity_score >= 0 AND similarity_score <= 1),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      input_distance_km REAL CHECK(input_distance_km >= 0),
      input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
      input_distance_tolerance REAL CHECK(input_distance_tolerance >= 0),
      input_elevation_tolerance REAL CHECK(input_elevation_tolerance >= 0),
      expires_at DATETIME,
      usage_count INTEGER DEFAULT 0 CHECK(usage_count >= 0),
      complete_route_data TEXT,
      trail_connectivity_data TEXT,
      request_hash TEXT
    )
  `);

  // Create indexes for pgRouting optimized structure
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON trails(app_uuid);
    CREATE INDEX IF NOT EXISTS idx_trails_name ON trails(name);
    CREATE INDEX IF NOT EXISTS idx_trails_osm_id ON trails(osm_id) WHERE osm_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_routing_nodes_coords ON routing_nodes(lat, lng);
    CREATE INDEX IF NOT EXISTS idx_routing_nodes_elevation ON routing_nodes(elevation) WHERE elevation IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_routing_nodes_cnt ON routing_nodes(cnt);
    CREATE INDEX IF NOT EXISTS idx_routing_edges_source ON routing_edges(source);
    CREATE INDEX IF NOT EXISTS idx_routing_edges_target ON routing_edges(target);
    CREATE INDEX IF NOT EXISTS idx_routing_edges_source_target ON routing_edges(source, target);
    CREATE INDEX IF NOT EXISTS idx_routing_edges_trail_id ON routing_edges(trail_id);
    CREATE INDEX IF NOT EXISTS idx_routing_edges_route_finding ON routing_edges(source, target, distance_km);
  `);

  // Create deduplication triggers
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS deduplicate_trails_trigger
    AFTER INSERT ON trails
    FOR EACH ROW
    BEGIN
      DELETE FROM trails 
      WHERE id != NEW.id 
      AND app_uuid = NEW.app_uuid 
      AND geojson = NEW.geojson;
    END;

    CREATE TRIGGER IF NOT EXISTS deduplicate_routing_nodes_trigger
    AFTER INSERT ON routing_nodes
    FOR EACH ROW
    BEGIN
      DELETE FROM routing_nodes 
      WHERE id != NEW.id 
      AND lat = NEW.lat 
      AND lng = NEW.lng 
      AND elevation = NEW.elevation;
    END;

    CREATE TRIGGER IF NOT EXISTS deduplicate_routing_edges_trigger
    AFTER INSERT ON routing_edges
    FOR EACH ROW
    BEGIN
      DELETE FROM routing_edges 
      WHERE id != NEW.id 
      AND source = NEW.source 
      AND target = NEW.target 
      AND trail_id = NEW.trail_id;
    END;
  `);

  // Apply SQLite optimizations
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA cache_size = -64000;
    PRAGMA temp_store = MEMORY;
    PRAGMA mmap_size = 268435456;
    PRAGMA optimize;
  `);

  console.log('[SQLITE] Tables created with v12 schema successfully.');
}

/**
 * Insert trails data into SQLite table.
 */
export function insertTrails(db: Database.Database, trails: any[], dbPath?: string) {
  console.log(`[SQLITE] Inserting ${trails.length} trails...`);
  
  // Validate that all trails have bbox values before insertion
  const trailsWithoutBbox = trails.filter(trail => 
    !trail.bbox_min_lng || !trail.bbox_max_lng || !trail.bbox_min_lat || !trail.bbox_max_lat
  );
  
  if (trailsWithoutBbox.length > 0) {
    const missingTrailNames = trailsWithoutBbox.map(t => t.name || t.app_uuid).slice(0, 5);
    throw new Error(`❌ BBOX VALIDATION FAILED: ${trailsWithoutBbox.length} trails are missing bbox values. Cannot proceed with SQLite export. Sample trails: ${missingTrailNames.join(', ')}`);
  }
  
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO trails (
      app_uuid, osm_id, name, source, trail_type, surface, difficulty,
      geojson, source_tags,
      bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
      length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((trails: any[]) => {
    for (const trail of trails) {
      // Enforce geojson is present and a string
      let geojson = trail.geojson;
      if (!geojson || typeof geojson !== 'string' || geojson.trim().length < 10) {
        throw new Error(`[FATAL] geojson is required and must be a valid string for all trails. Offending trail: ${JSON.stringify(trail)}`);
      }
      // Optionally, parse and re-stringify to ensure valid JSON
      try {
        JSON.parse(geojson);
      } catch (e) {
        throw new Error(`[FATAL] geojson is not valid JSON for trail: ${JSON.stringify(trail)}`);
      }
      
      // Enforce source_tags is JSON-encoded string
      let source_tags = trail.source_tags;
      if (source_tags && typeof source_tags !== 'string') source_tags = JSON.stringify(source_tags);
      insertStmt.run(
        trail.app_uuid || null,
        trail.osm_id || null,
        trail.name || null,
        trail.source || null,
        trail.trail_type || null,
        trail.surface || null,
        trail.difficulty || null,
        geojson,
        source_tags || null,
        trail.bbox_min_lng || null,
        trail.bbox_max_lng || null,
        trail.bbox_min_lat || null,
        trail.bbox_max_lat || null,
        trail.length_km || null,
        trail.elevation_gain || 0,
        trail.elevation_loss || 0,
        trail.max_elevation || 0,
        trail.min_elevation || 0,
        trail.avg_elevation || 0,
        trail.created_at ? (typeof trail.created_at === 'string' ? trail.created_at : trail.created_at.toISOString()) : new Date().toISOString(),
        trail.updated_at ? (typeof trail.updated_at === 'string' ? trail.updated_at : trail.updated_at.toISOString()) : new Date().toISOString()
      );
    }
  });

  insertMany(trails);
  console.log(`[SQLITE] Inserted ${trails.length} trails successfully.`);
}

/**
 * Insert routing nodes data into SQLite table (v12 schema).
 * @param db SQLite database instance
 * @param nodes Array of routing node objects
 * @param dbPath Optional database path for logging
 */
export function insertRoutingNodes(db: Database.Database, nodes: any[], dbPath?: string) {
  console.log(`[SQLITE] Inserting ${nodes.length} routing nodes...`);
  
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO routing_nodes (
      lat, lng, elevation, cnt, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((nodes: any[]) => {
    for (const node of nodes) {
      insertStmt.run(
        node.lat || 0,
        node.lng || 0,
        node.elevation || 0,
        node.cnt || 1,
        node.created_at ? (typeof node.created_at === 'string' ? node.created_at : node.created_at.toISOString()) : new Date().toISOString()
      );
    }
  });
  
  insertMany(nodes);
  console.log(`[SQLITE] Inserted ${nodes.length} routing nodes successfully.`);
}

/**
 * Insert routing edges data into SQLite table (v12 schema).
 * @param db SQLite database instance
 * @param edges Array of routing edge objects
 * @param dbPath Optional database path for logging
 */
export function insertRoutingEdges(db: Database.Database, edges: any[], dbPath?: string) {
  console.log(`[SQLITE] Inserting ${edges.length} routing edges...`);

  // Debug: Print actual schema of routing_edges table
  const tableInfo = db.prepare('PRAGMA table_info(routing_edges)').all();
  console.log('[DEBUG] Actual routing_edges table schema:', tableInfo);
  
  if (edges.length > 0) {
    console.log('[DEBUG] First edge object:', edges[0]);
    console.log('[DEBUG] Edge object keys:', Object.keys(edges[0]));
  }

  try {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO routing_edges (
        source, target, trail_id, trail_name, distance_km, geojson, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const edge of edges) {
      insertStmt.run(
        edge.source,
        edge.target,
        edge.trail_id,
        edge.trail_name,
        edge.distance_km,
        edge.geojson,
        edge.created_at ? (typeof edge.created_at === 'string' ? edge.created_at : edge.created_at.toISOString()) : new Date().toISOString()
      );
    }
  } catch (err) {
    console.error('[DEBUG] Error inserting routing edges:', err);
    if (err && typeof err === 'object' && 'stack' in err) {
      console.error('[DEBUG] Error stack trace:', (err as Error).stack);
    }
    throw err;
  }

  console.log(`[SQLITE] Inserted ${edges.length} routing edges successfully.`);
}

/**
 * Insert region metadata into SQLite table.
 */
export function insertRegionMetadata(db: Database.Database, metadata: any, dbPath?: string) {
  console.log('[SQLITE] Inserting region metadata...');
  
  const insertStmt = db.prepare(`
    INSERT INTO region_metadata (
      region_name, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
      trail_count, processing_config, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertStmt.run(
    metadata.region_name || null,
    metadata.bbox_min_lng || null,
    metadata.bbox_max_lng || null,
    metadata.bbox_min_lat || null,
    metadata.bbox_max_lat || null,
    metadata.trail_count || 0,
    metadata.processing_config ? JSON.stringify(metadata.processing_config) : null,
    metadata.created_at ? (typeof metadata.created_at === 'string' ? metadata.created_at : metadata.created_at.toISOString()) : new Date().toISOString()
  );

  console.log('[SQLITE] Inserted region metadata successfully.');
}

/**
 * Build region metadata object from trails data.
 */
export function buildRegionMeta(trails: any[], regionName: string, bbox?: any) {
  const trailCount = trails.length;
  
  // Calculate bbox from trails if not provided
  let calculatedBbox = bbox;
  if (!bbox && trails.length > 0) {
    const lngs = trails.flatMap(t => [t.bbox_min_lng, t.bbox_max_lng]).filter(Boolean);
    const lats = trails.flatMap(t => [t.bbox_min_lat, t.bbox_max_lat]).filter(Boolean);
    
    if (lngs.length > 0 && lats.length > 0) {
      calculatedBbox = {
        bbox_min_lng: Math.min(...lngs),
        bbox_max_lng: Math.max(...lngs),
        bbox_min_lat: Math.min(...lats),
        bbox_max_lat: Math.max(...lats)
      };
    }
  }

  return {
    region_name: regionName,
    trail_count: trailCount,
    ...calculatedBbox,
    created_at: new Date().toISOString()
  };
}

/**
 * Insert schema version into SQLite table.
 */
export function insertSchemaVersion(db: Database.Database, version: number, description?: string, dbPath?: string) {
  console.log(`[SQLITE] Inserting schema version ${version}: ${description || 'Carthorse SQLite Export v' + version}`);
  
  const insertStmt = db.prepare(`
    INSERT INTO schema_version (version, description, created_at)
    VALUES (?, ?, ?)
  `);

  insertStmt.run(
    version,
    description || `Carthorse SQLite Export v${version}`,
    new Date().toISOString()
  );

  console.log(`[SQLITE] Inserted schema version ${version} successfully.`);
}

/**
 * Validate schema version in SQLite database.
 */
export function validateSchemaVersion(db: Database.Database, expectedVersion: number): boolean {
  try {
    const result = db.prepare(`
      SELECT version, description FROM schema_version 
      ORDER BY created_at DESC LIMIT 1
    `).get() as { version?: number; description?: string } | undefined;
    
    if (!result || typeof result.version !== 'number') {
      console.warn('[SQLITE] No schema version found in database');
      return false;
    }
    
    if (result.version !== expectedVersion) {
      console.warn(`[SQLITE] Schema version mismatch: expected ${expectedVersion}, found ${result.version}`);
      return false;
    }
    
    console.log(`[SQLITE] Schema version validated: ${result.version} (${result.description || 'No description'})`);
    return true;
  } catch (error) {
    console.error('[SQLITE] Error validating schema version:', error);
    return false;
  }
}