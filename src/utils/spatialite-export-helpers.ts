// SpatiaLite export helpers for Carthorse
// These functions encapsulate table creation and data insertion for SpatiaLite exports.
// All helpers match the canonical region schema (see orchestrator-README.md)

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

/**
 * Create all required SpatiaLite tables and geometry columns.
 */
export function createSpatiaLiteTables(db: Database.Database) {
  try {
    // Check if SpatiaLite extension is loaded
    let spatialiteLoaded = false;
    try {
      const version = db.prepare('SELECT spatialite_version() as v').get() as { v?: string };
      if (version && version.v) {
        spatialiteLoaded = true;
        console.log('[SPATIALITE] SpatiaLite extension loaded, version:', version.v);
      }
    } catch (err) {
      console.warn('[SPATIALITE] WARNING: SpatiaLite extension does NOT appear to be loaded! Geometry columns may fail.');
    }
    console.log('[SPATIALITE] Creating trails table...');
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
        coordinates TEXT,
        geojson TEXT,
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
    `);
    console.log('[SPATIALITE] Created trails table.');
    try {
      db.exec(`SELECT AddGeometryColumn('trails', 'geometry', 4326, 'LINESTRING', 3);`);
      console.log('[SPATIALITE] Added geometry column to trails.');
    } catch (err) {
      console.error('[SPATIALITE] Failed to add geometry column to trails:', err);
      throw err;
    }

    // Routing nodes table: create without geometry column, then add geometry column
    try {
      db.exec(`DROP TABLE IF EXISTS routing_nodes;`);
      db.exec(`CREATE TABLE routing_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_uuid TEXT UNIQUE,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        elevation REAL,
        node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
        connected_trails TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`);
      console.log('[SPATIALITE] Created routing_nodes table (no geometry column).');
      try {
        db.exec(`SELECT AddGeometryColumn('routing_nodes', 'coordinate', 4326, 'POINT', 3);`);
        console.log('[SPATIALITE] Added coordinate geometry column to routing_nodes.');
      } catch (err) {
        console.error('[SPATIALITE] Failed to add coordinate geometry column to routing_nodes:', err);
        throw err;
      }
    } catch (err) {
      console.error('[SPATIALITE] Error creating routing_nodes table:', err);
      throw err;
    }

    // Routing edges table: create without geometry column, then add geometry column
    try {
      db.exec(`DROP TABLE IF EXISTS routing_edges;`);
      db.exec(`CREATE TABLE routing_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_node_id INTEGER,
        to_node_id INTEGER,
        trail_id TEXT,
        trail_name TEXT,
        distance_km REAL,
        elevation_gain REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`);
      console.log('[SPATIALITE] Created routing_edges table (no geometry column).');
      try {
        db.exec(`SELECT AddGeometryColumn('routing_edges', 'geometry', 4326, 'LINESTRING', 3);`);
        console.log('[SPATIALITE] Added geometry column to routing_edges.');
      } catch (err) {
        console.error('[SPATIALITE] Failed to add geometry column to routing_edges:', err);
        throw err;
      }
    } catch (err) {
      console.error('[SPATIALITE] Error creating routing_edges table:', err);
      throw err;
    }

    console.log('[SPATIALITE] Creating schema_version table...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        description TEXT
      );
    `);
    console.log('[SPATIALITE] Created schema_version table.');

    console.log('[SPATIALITE] Creating regions table...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS regions (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        bbox TEXT,
        initial_view_bbox TEXT,
        center TEXT,
        metadata TEXT
      );
    `);
    console.log('[SPATIALITE] Created regions table.');
    // Force commit after all DDL
    try {
      db.exec('COMMIT;');
      console.log('[SPATIALITE] Forced COMMIT after table/geometry column creation.');
    } catch (err) {
      console.error('[SPATIALITE] Error during forced COMMIT:', err);
    }
    // Log DB path and table list
    try {
      const absPath = (db as any).name || '[unknown path]';
      console.log(`[SPATIALITE] DB absolute path: ${absPath}`);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table';").all().map((row: any) => row.name);
      console.log('[SPATIALITE] Tables after creation:', tables);
    } catch (err) {
      console.error('[SPATIALITE] Error listing tables after creation:', err);
    }
    // Create a simple test table to verify DDL works
    try {
      db.exec(`DROP TABLE IF EXISTS test_nodes; CREATE TABLE test_nodes (id INTEGER PRIMARY KEY, name TEXT);`);
      console.log('[SPATIALITE] Created test_nodes table.');
      const testTables = db.prepare("SELECT name FROM sqlite_master WHERE name='test_nodes';").all();
      if (testTables.length > 0) {
        console.log('[SPATIALITE] test_nodes table exists after creation.');
      } else {
        console.error('[SPATIALITE] test_nodes table does NOT exist after creation!');
      }
    } catch (err) {
      console.error('[SPATIALITE] Error creating test_nodes table:', err);
    }
  } catch (err) {
    console.error('[SPATIALITE] Error creating SpatiaLite tables:', err);
    throw err;
  }
}

/**
 * Insert trails into the SpatiaLite trails table.
 */
export function insertTrails(db: Database.Database, trails: any[]) {
  // SpatiaLite extension and metadata are assumed to be loaded/initialized before this function is called
  console.log('[DEBUG] insertTrails: function entered');
  const insertTrail = db.prepare(`
    INSERT INTO trails (
      app_uuid, osm_id, name, source, trail_type, surface, difficulty,
      coordinates, geojson, bbox, source_tags,
      bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
      length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      created_at, updated_at, geometry
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GeomFromText(?, 4326))
  `);
  console.log(`\n[INFO] insertTrails called with ${trails.length} trails`);
  for (const trail of trails) {
    const wkt = trail.geometry_wkt ?? null;
    if (!wkt || wkt === 'NULL' || wkt === '') {
      console.warn(`[WARN] Trail app_uuid=${trail.app_uuid} name=${trail.name} has missing or empty geometry_wkt!`);
    }
    const values = [
      trail.app_uuid ?? null,
      trail.osm_id ?? null,
      trail.name ?? null,
      trail.source ?? null,
      trail.trail_type ?? null,
      trail.surface ?? null,
      trail.difficulty ?? null,
      typeof trail.coordinates === 'object' ? JSON.stringify(trail.coordinates) : (trail.coordinates ?? null),
      typeof trail.geojson === 'object' ? JSON.stringify(trail.geojson) : (trail.geojson ?? null),
      typeof trail.bbox === 'object' ? JSON.stringify(trail.bbox) : (trail.bbox ?? null),
      typeof trail.source_tags === 'object' ? JSON.stringify(trail.source_tags) : (trail.source_tags ?? null),
      typeof trail.bbox_min_lng === 'number' ? trail.bbox_min_lng : (trail.bbox_min_lng ?? null),
      typeof trail.bbox_max_lng === 'number' ? trail.bbox_max_lng : (trail.bbox_max_lng ?? null),
      typeof trail.bbox_min_lat === 'number' ? trail.bbox_min_lat : (trail.bbox_min_lat ?? null),
      typeof trail.bbox_max_lat === 'number' ? trail.bbox_max_lat : (trail.bbox_max_lat ?? null),
      typeof trail.length_km === 'number' ? trail.length_km : (trail.length_km ?? null),
      typeof trail.elevation_gain === 'number' ? trail.elevation_gain : (trail.elevation_gain ?? null),
      typeof trail.elevation_loss === 'number' ? trail.elevation_loss : (trail.elevation_loss ?? null),
      typeof trail.max_elevation === 'number' ? trail.max_elevation : (trail.max_elevation ?? null),
      typeof trail.min_elevation === 'number' ? trail.min_elevation : (trail.min_elevation ?? null),
      typeof trail.avg_elevation === 'number' ? trail.avg_elevation : (trail.avg_elevation ?? null),
      trail.created_at instanceof Date ? trail.created_at.toISOString() : (typeof trail.created_at === 'string' ? trail.created_at : null),
      trail.updated_at instanceof Date ? trail.updated_at.toISOString() : (typeof trail.updated_at === 'string' ? trail.updated_at : null),
      wkt
    ];
    try {
      insertTrail.run(...values);
    } catch (err) {
      console.error(`[ERROR] Failed to insert app_uuid=${trail.app_uuid}:`, err, '\ngeometry_wkt:', wkt);
    }
  }
  console.log(`[INFO] insertTrails finished`);
}

/**
 * Insert routing nodes into the SpatiaLite routing_nodes table.
 */
export function insertRoutingNodes(db: Database.Database, nodes: any[]) {
  const insertNode = db.prepare(`
    INSERT INTO routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails, coordinate)
    VALUES (?, ?, ?, ?, ?, ?, GeomFromText(?, 4326))
  `);
  for (const node of nodes) {
    insertNode.run(
      node.node_uuid, node.lat, node.lng, node.elevation, node.node_type, node.connected_trails, node.coordinate
    );
  }
}

/**
 * Insert routing edges into the SpatiaLite routing_edges table.
 */
export function insertRoutingEdges(db: Database.Database, edges: any[]) {
  const insertEdge = db.prepare(`
    INSERT INTO routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, geometry)
    VALUES (?, ?, ?, ?, ?, ?, GeomFromText(?, 4326))
  `);
  for (const edge of edges) {
    insertEdge.run(
      edge.from_node_id, edge.to_node_id, edge.trail_id, edge.trail_name, edge.distance_km, edge.elevation_gain, edge.geometry
    );
  }
}

/**
 * Insert region metadata into the SpatiaLite regions table.
 */
export function insertRegionMetadata(db: Database.Database, regionMeta: any) {
  db.prepare(`
    INSERT OR REPLACE INTO regions (id, name, description, bbox, initial_view_bbox, center, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    regionMeta.id, regionMeta.name, regionMeta.description, regionMeta.bbox, regionMeta.initialViewBbox, regionMeta.center, regionMeta.metadata
  );
}

/**
 * Build region metadata object for SpatiaLite export.
 */
export function buildRegionMeta(config: any, regionBbox: any) {
  return {
    id: config.region,
    name: config.region,
    description: '',
    bbox: regionBbox ? JSON.stringify({
      minLng: regionBbox.minLng,
      maxLng: regionBbox.maxLng,
      minLat: regionBbox.minLat,
      maxLat: regionBbox.maxLat
    }) : null,
    initialViewBbox: null,
    center: regionBbox ? JSON.stringify({
      lng: (regionBbox.minLng + regionBbox.maxLng) / 2,
      lat: (regionBbox.minLat + regionBbox.maxLat) / 2
    }) : null,
    metadata: JSON.stringify({
      version: 1,
      lastUpdated: new Date().toISOString(),
      coverage: 'unknown'
    })
  };
}

/**
 * Insert schema version into SpatiaLite export.
 */
export function insertSchemaVersion(db: Database.Database, version: number, description: string) {
  db.exec(`
    INSERT OR REPLACE INTO schema_version (version, description)
    VALUES (${version}, '${description.replace(/'/g, "''")}')
  `);
} 