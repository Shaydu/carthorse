// SQLite export helpers for Carthorse (non-SpatiaLite version)
// These functions create tables and insert data using regular SQLite without spatial extensions.
// Geometry is stored as WKT (Well-Known Text) strings.

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export const CARTHORSE_SCHEMA_VERSION = 9;

/**
 * Create all required SQLite tables (no SpatiaLite dependencies).
 */
export function createSqliteTables(db: Database.Database, dbPath?: string) {
  try {
    db.exec(`
      DROP TABLE IF EXISTS trails;
      CREATE TABLE IF NOT EXISTS trails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_uuid TEXT UNIQUE NOT NULL,
        osm_id TEXT,
        name TEXT NOT NULL,
        source TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        geojson TEXT NOT NULL, -- All geometry as GeoJSON (required)
        bbox TEXT,
        source_tags TEXT,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        length_km REAL,
        elevation_gain REAL DEFAULT 0,
        elevation_loss REAL DEFAULT 0,
        max_elevation REAL DEFAULT 0,
        min_elevation REAL DEFAULT 0,
        avg_elevation REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      DROP TABLE IF EXISTS routing_nodes;
      CREATE TABLE IF NOT EXISTS routing_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_uuid TEXT UNIQUE,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        elevation REAL,
        node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
        connected_trails TEXT, -- JSON array as TEXT
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      DROP TABLE IF EXISTS routing_edges;
      CREATE TABLE IF NOT EXISTS routing_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_node_id INTEGER,
        to_node_id INTEGER,
        trail_id TEXT,
        trail_name TEXT,
        distance_km REAL,
        elevation_gain REAL DEFAULT 0,
        elevation_loss REAL DEFAULT 0,
        is_bidirectional BOOLEAN DEFAULT 1,
        geojson TEXT NOT NULL, -- All geometry as GeoJSON (required)
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      DROP TABLE IF EXISTS region_metadata;
      CREATE TABLE IF NOT EXISTS region_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        region_name TEXT NOT NULL,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        trail_count INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      DROP TABLE IF EXISTS schema_version;
      CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      DROP TABLE IF EXISTS route_recommendations;
      CREATE TABLE IF NOT EXISTS route_recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_uuid TEXT UNIQUE,
        region TEXT NOT NULL, -- Region identifier for multi-region support
        gpx_distance_km REAL,
        gpx_elevation_gain REAL,
        gpx_name TEXT,
        recommended_distance_km REAL,
        recommended_elevation_gain REAL,
        route_type TEXT,
        route_edges TEXT, -- JSON array of trail segments
        route_path TEXT, -- JSON array of coordinate points
        similarity_score REAL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        -- Additional fields from gainiac schema for enhanced functionality
        input_distance_km REAL, -- Input distance for recommendations
        input_elevation_gain REAL, -- Input elevation for recommendations
        input_distance_tolerance REAL, -- Distance tolerance
        input_elevation_tolerance REAL, -- Elevation tolerance
        expires_at TIMESTAMP, -- Expiration timestamp
        usage_count INTEGER DEFAULT 0, -- Usage tracking
        complete_route_data TEXT, -- Complete route information as JSON
        trail_connectivity_data TEXT, -- Trail connectivity data as JSON
        request_hash TEXT -- Request hash for deduplication
      );
      CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON trails(app_uuid);
      CREATE INDEX IF NOT EXISTS idx_trails_name ON trails(name);
      CREATE INDEX IF NOT EXISTS idx_routing_nodes_node_uuid ON routing_nodes(node_uuid);
      CREATE INDEX IF NOT EXISTS idx_routing_edges_trail_id ON routing_edges(trail_id);
      CREATE INDEX IF NOT EXISTS idx_routing_edges_from_node_id ON routing_edges(from_node_id);
      CREATE INDEX IF NOT EXISTS idx_routing_edges_to_node_id ON routing_edges(to_node_id);
      -- Route recommendations indexes (enhanced v9)
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_distance ON route_recommendations(gpx_distance_km, recommended_distance_km);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_elevation ON route_recommendations(gpx_elevation_gain, recommended_elevation_gain);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_type ON route_recommendations(route_type);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_score ON route_recommendations(similarity_score);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_uuid ON route_recommendations(route_uuid);
      -- Additional indexes from gainiac schema for enhanced query performance
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_region ON route_recommendations(region);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_input ON route_recommendations(input_distance_km, input_elevation_gain);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_created ON route_recommendations(created_at);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_expires ON route_recommendations(expires_at);
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_request_hash ON route_recommendations(request_hash);
      
      -- NEW: Performance indices from gainiac schema-v9-with-optimizations.md (purely additive optimizations)
      
      -- Trails Indices (NEW)
      CREATE INDEX IF NOT EXISTS idx_trails_length ON trails(length_km);
      CREATE INDEX IF NOT EXISTS idx_trails_elevation ON trails(elevation_gain);
      
      -- Enhanced Route Recommendations Indices (NEW)
      CREATE INDEX IF NOT EXISTS idx_route_recommendations_region_hash ON route_recommendations(region, request_hash);
      
      -- Routing Indices (NEW - Most Critical for Performance)
      CREATE INDEX IF NOT EXISTS idx_routing_nodes_coords ON routing_nodes(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_routing_nodes_elevation ON routing_nodes(elevation) WHERE elevation IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_routing_nodes_route_finding ON routing_nodes(id, lat, lng, elevation);
      CREATE INDEX IF NOT EXISTS idx_routing_edges_from_node ON routing_edges(from_node_id, to_node_id);
      CREATE INDEX IF NOT EXISTS idx_routing_edges_trail_distance ON routing_edges(trail_id, distance_km);
      CREATE INDEX IF NOT EXISTS idx_routing_edges_elevation ON routing_edges(elevation_gain, elevation_loss);
      CREATE INDEX IF NOT EXISTS idx_routing_edges_route_finding ON routing_edges(from_node_id, to_node_id, trail_id, distance_km, elevation_gain);
    `);
    // Fail-loud check: ensure geojson column exists in both tables
    const trailsColCheck = db.prepare('PRAGMA table_info(trails)').all();
    const edgesColCheck = db.prepare('PRAGMA table_info(routing_edges)').all();
    const trailsHasGeojson = trailsColCheck.some(col => (col as any).name === 'geojson');
    const edgesHasGeojson = edgesColCheck.some(col => (col as any).name === 'geojson');
    if (!trailsHasGeojson) {
      const fs = require('fs');
      let stats = null;
      try {
        stats = fs.statSync(dbPath || db.name || '[unknown path]');
      } catch (e) {
        stats = { error: (e as Error).message };
      }
      throw new Error(`[FATAL] trails table missing geojson column after creation!\ntest db path: ${dbPath}\nStats: ${JSON.stringify(stats, null, 2)}`);
    }
    if (!edgesHasGeojson) {
      const fs = require('fs');
      let stats = null;
      try {
        stats = fs.statSync(dbPath || db.name || '[unknown path]');
      } catch (e) {
        stats = { error: (e as Error).message };
      }
      throw new Error(`[FATAL] routing_edges table missing geojson column after creation!\ntest db path: ${dbPath}\nStats: ${JSON.stringify(stats, null, 2)}`);
    }
  } catch (err) {
    console.error('[SQLITE] Error creating tables:', err);
    throw err;
  }
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
    INSERT INTO trails (
      app_uuid, osm_id, name, source, trail_type, surface, difficulty,
      geojson, bbox, source_tags,
      bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
      length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      

      
      // Enforce bbox and source_tags are JSON-encoded strings
      let bbox = trail.bbox;
      if (bbox && typeof bbox !== 'string') bbox = JSON.stringify(bbox);
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
        bbox || null,
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
 * Insert routing nodes data into SQLite table.
 */
export function insertRoutingNodes(db: Database.Database, nodes: any[], dbPath?: string) {
  console.log(`[SQLITE] Inserting ${nodes.length} routing nodes...`);
  // Fail-loud: Check for duplicate IDs in source data
  const idSet = new Set();
  for (const node of nodes) {
    if (idSet.has(node.id)) {
      throw new Error(`[FATAL] Duplicate node id in source data: ${node.id}`);
    }
    idSet.add(node.id);
  }
  const insertStmt = db.prepare(`
    INSERT INTO routing_nodes (
      id, node_uuid, lat, lng, elevation, node_type, connected_trails, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((nodes: any[]) => {
    for (const node of nodes) {
      // Enforce connected_trails is a JSON-encoded string
      let connected_trails = node.connected_trails;
      if (connected_trails && typeof connected_trails !== 'string') connected_trails = JSON.stringify(connected_trails);
      insertStmt.run(
        node.id || null,
        node.node_uuid || null,
        node.lat || 0,
        node.lng || 0,
        node.elevation || 0,
        node.node_type || null,
        connected_trails || null,
        node.created_at ? (typeof node.created_at === 'string' ? node.created_at : node.created_at.toISOString()) : new Date().toISOString()
      );
    }
  });
  insertMany(nodes);
  // Fail-loud: Check all expected IDs are present in the SQLite DB
  const dbIds = db.prepare('SELECT id FROM routing_nodes').all().map((row: any) => row.id);
  const missingIds = Array.from(idSet).filter(id => !dbIds.includes(id));
  if (missingIds.length > 0) {
    throw new Error(`[FATAL] Missing node IDs in SQLite DB after insert: ${missingIds}`);
  }
  console.log(`[SQLITE] Inserted ${nodes.length} routing nodes successfully.`);
}

/**
 * Insert routing edges data into SQLite table.
 */
export function insertRoutingEdges(db: Database.Database, edges: any[], dbPath?: string) {
  console.log(`[SQLITE] Inserting ${edges.length} routing edges...`);
  
  const insertStmt = db.prepare(`
    INSERT INTO routing_edges (
      from_node_id, to_node_id, trail_id, trail_name, distance_km, 
      elevation_gain, elevation_loss, is_bidirectional, geojson, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((edges: any[]) => {
    for (const edge of edges) {
      // Require geojson for each edge
      let geojson = edge.geojson;
      if (!geojson || typeof geojson !== 'string' || geojson.trim().length < 10) {
        throw new Error(`[FATAL] geojson is required and must be a valid string for all routing edges. Offending edge: ${JSON.stringify(edge)}`);
      }
      try {
        JSON.parse(geojson);
      } catch (e) {
        throw new Error(`[FATAL] geojson is not valid JSON for routing edge: ${JSON.stringify(edge)}`);
      }
      insertStmt.run(
        edge.from_node_id || null,
        edge.to_node_id || null,
        edge.trail_id || null,
        edge.trail_name || null,
        edge.distance_km || 0,
        edge.elevation_gain || 0,
        edge.elevation_loss || 0,
        edge.is_bidirectional ? 1 : 0,
        geojson,
        edge.created_at ? (typeof edge.created_at === 'string' ? edge.created_at : edge.created_at.toISOString()) : new Date().toISOString()
      );
    }
  });

  insertMany(edges);
  console.log(`[SQLITE] Inserted ${edges.length} routing edges successfully.`);
}

/**
 * Insert region metadata into SQLite table.
 */
export function insertRegionMetadata(db: Database.Database, regionMeta: any, dbPath?: string) {
  console.log('[SQLITE] Inserting region metadata...');
  
  const insertStmt = db.prepare(`
    INSERT INTO region_metadata (
      region_name, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, 
      trail_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertStmt.run(
    regionMeta.region_name,
    regionMeta.bbox_min_lng,
    regionMeta.bbox_max_lng,
    regionMeta.bbox_min_lat,
    regionMeta.bbox_max_lat,
    regionMeta.trail_count,
    new Date().toISOString()
  );
  
  console.log('[SQLITE] Inserted region metadata successfully.');
}

/**
 * Build region metadata object.
 */
export function buildRegionMeta(config: any, regionBbox: any) {
  // Handle null regionBbox gracefully
  const bbox = regionBbox || {
    minLng: null,
    maxLng: null,
    minLat: null,
    maxLat: null,
    trailCount: 0
  };
  
  return {
    region_name: config.region,
    bbox_min_lng: bbox.minLng,
    bbox_max_lng: bbox.maxLng,
    bbox_min_lat: bbox.minLat,
    bbox_max_lat: bbox.maxLat,
    trail_count: bbox.trailCount
  };
}

/**
 * Insert schema version into SQLite table.
 */
export function insertSchemaVersion(db: Database.Database, version: number, description: string, dbPath?: string) {
  console.log(`[SQLITE] Inserting schema version ${version}: ${description}`);
  db.prepare('DELETE FROM schema_version').run();
  const insertStmt = db.prepare(`
    INSERT INTO schema_version (version, description, created_at) VALUES (?, ?, ?)
  `);
  insertStmt.run(version, description, new Date().toISOString());
  console.log(`[SQLITE] Inserted schema version ${version} successfully.`);
}

/**
 * Insert route recommendations into SQLite table (v9 schema).
 * This table starts empty and is populated by the API service at runtime.
 */
export function insertRouteRecommendations(db: Database.Database, recommendations: any[], dbPath?: string) {
  if (!recommendations || recommendations.length === 0) {
    console.log('[SQLITE] No route recommendations to insert (table will be populated by API service)');
    return;
  }

  console.log(`[SQLITE] Inserting ${recommendations.length} route recommendations...`);
  
  const insertStmt = db.prepare(`
    INSERT INTO route_recommendations (
      route_uuid, region, gpx_distance_km, gpx_elevation_gain, gpx_name,
      recommended_distance_km, recommended_elevation_gain, route_type,
      route_edges, route_path, similarity_score, created_at,
      input_distance_km, input_elevation_gain, input_distance_tolerance,
      input_elevation_tolerance, expires_at, usage_count,
      complete_route_data, trail_connectivity_data, request_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((recs: any[]) => {
    for (const rec of recs) {
      insertStmt.run(
        rec.route_uuid || null,
        rec.region || null,
        rec.gpx_distance_km || null,
        rec.gpx_elevation_gain || null,
        rec.gpx_name || null,
        rec.recommended_distance_km || null,
        rec.recommended_elevation_gain || null,
        rec.route_type || null,
        rec.route_edges ? JSON.stringify(rec.route_edges) : null,
        rec.route_path ? JSON.stringify(rec.route_path) : null,
        rec.similarity_score || null,
        rec.created_at ? (typeof rec.created_at === 'string' ? rec.created_at : rec.created_at.toISOString()) : new Date().toISOString(),
        rec.input_distance_km || null,
        rec.input_elevation_gain || null,
        rec.input_distance_tolerance || null,
        rec.input_elevation_tolerance || null,
        rec.expires_at || null,
        rec.usage_count || 0,
        rec.complete_route_data ? JSON.stringify(rec.complete_route_data) : null,
        rec.trail_connectivity_data ? JSON.stringify(rec.trail_connectivity_data) : null,
        rec.request_hash || null
      );
    }
  });

  insertMany(recommendations);
  console.log(`[SQLITE] Inserted ${recommendations.length} route recommendations successfully.`);
}

/**
 * Validate that the exported SQLite database has the correct schema version.
 */
export function validateSchemaVersion(db: Database.Database, expectedVersion: number = CARTHORSE_SCHEMA_VERSION): void {
  console.log(`[SQLITE] Validating schema version (expected: ${expectedVersion})...`);
  
  try {
    const result = db.prepare(`
      SELECT version, description 
      FROM schema_version 
      ORDER BY version DESC 
      LIMIT 1
    `).get() as any;

    if (!result) {
      throw new Error('No schema version found in database');
    }

    const actualVersion = result.version;
    const description = result.description;

    if (actualVersion !== expectedVersion) {
      throw new Error(`Schema version mismatch. Expected: ${expectedVersion}, Actual: ${actualVersion}. Description: ${description}`);
    }

    console.log(`✅ Schema version validation passed: ${actualVersion} (${description})`);
  } catch (error) {
    console.error(`❌ Schema version validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
} 