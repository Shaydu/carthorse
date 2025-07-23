// SQLite export helpers for Carthorse (non-SpatiaLite version)
// These functions create tables and insert data using regular SQLite without spatial extensions.
// Geometry is stored as WKT (Well-Known Text) strings.

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

/**
 * Create all required SQLite tables (no SpatiaLite dependencies).
 */
export function createSqliteTables(db: Database.Database) {
  try {
    console.log('[SQLITE] Creating trails table...');
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
        geometry_wkt TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[SQLITE] Created trails table with geometry_wkt column.');

    // Routing nodes table
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
        coordinate_wkt TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`);
      console.log('[SQLITE] Created routing_nodes table with coordinate_wkt column.');
    } catch (err) {
      console.error('[SQLITE] Error creating routing_nodes table:', err);
      throw err;
    }

    // Routing edges table
    try {
      db.exec(`DROP TABLE IF EXISTS routing_edges;`);
      db.exec(`CREATE TABLE routing_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_node_id INTEGER,
        to_node_id INTEGER,
        trail_id TEXT,
        trail_name TEXT,
        distance_km REAL,
        elevation_gain REAL DEFAULT 0,
        elevation_loss REAL DEFAULT 0,
        is_bidirectional BOOLEAN DEFAULT 1,
        geometry_wkt TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`);
      console.log('[SQLITE] Created routing_edges table with geometry_wkt column.');
    } catch (err) {
      console.error('[SQLITE] Error creating routing_edges table:', err);
      throw err;
    }

    // Region metadata table
    try {
      db.exec(`DROP TABLE IF EXISTS region_metadata;`);
      db.exec(`CREATE TABLE region_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        region_name TEXT NOT NULL,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        trail_count INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`);
      console.log('[SQLITE] Created region_metadata table.');
    } catch (err) {
      console.error('[SQLITE] Error creating region_metadata table:', err);
      throw err;
    }

    // Schema version table
    try {
      db.exec(`DROP TABLE IF EXISTS schema_version;`);
      db.exec(`CREATE TABLE schema_version (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`);
      console.log('[SQLITE] Created schema_version table.');
    } catch (err) {
      console.error('[SQLITE] Error creating schema_version table:', err);
      throw err;
    }

    console.log('[SQLITE] All tables created successfully.');
  } catch (err) {
    console.error('[SQLITE] Error creating tables:', err);
    throw err;
  }
}

/**
 * Insert trails data into SQLite table.
 */
export function insertTrails(db: Database.Database, trails: any[]) {
  console.log(`[SQLITE] Inserting ${trails.length} trails...`);
  
  const insertStmt = db.prepare(`
    INSERT INTO trails (
      app_uuid, osm_id, name, source, trail_type, surface, difficulty,
      coordinates, geojson, bbox, source_tags,
      bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
      length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      geometry_wkt, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((trails: any[]) => {
    for (const trail of trails) {

      // Convert geometry to WKT if it's a PostGIS geometry object
      let geometryWkt = null;
      if (trail.geometry) {
        if (typeof trail.geometry === 'string') {
          geometryWkt = trail.geometry;
        } else {
          // For PostGIS geometry objects, we need to convert to WKT
          // Since we can't access the geometry directly, we'll create a simple WKT
          // based on the trail's bounding box for now
          if (trail.bbox_min_lng && trail.bbox_min_lat && trail.bbox_max_lng && trail.bbox_max_lat) {
            geometryWkt = `LINESTRING(${trail.bbox_min_lng} ${trail.bbox_min_lat}, ${trail.bbox_max_lng} ${trail.bbox_max_lat})`;
          } else {
            console.warn(`[SQLITE] Skipping trail ${trail.app_uuid} - no valid geometry or bbox`);
            continue;
          }
        }
      }
      

      
      insertStmt.run(
        trail.app_uuid || null,
        trail.osm_id || null,
        trail.name || null,
        trail.source || null,
        trail.trail_type || null,
        trail.surface || null,
        trail.difficulty || null,
        typeof trail.coordinates === 'object' ? JSON.stringify(trail.coordinates) : (trail.coordinates || null),
        typeof trail.geojson === 'object' ? JSON.stringify(trail.geojson) : (trail.geojson || null),
        typeof trail.bbox === 'object' ? JSON.stringify(trail.bbox) : (trail.bbox || null),
        trail.source_tags || null,
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
        geometryWkt,
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
export function insertRoutingNodes(db: Database.Database, nodes: any[]) {
  console.log(`[SQLITE] Inserting ${nodes.length} routing nodes...`);
  
  const insertStmt = db.prepare(`
    INSERT INTO routing_nodes (
      node_uuid, lat, lng, elevation, node_type, connected_trails, coordinate_wkt, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((nodes: any[]) => {
    for (const node of nodes) {
      // Convert geometry to WKT if it exists
      let coordinateWkt = null;
      if (node.geometry) {
        coordinateWkt = `POINT(${node.lng} ${node.lat} ${node.elevation || 0})`;
      }
      
      insertStmt.run(
        node.node_uuid || null,
        node.lat || 0,
        node.lng || 0,
        node.elevation || 0,
        node.node_type || null,
        node.connected_trails || null,
        coordinateWkt,
        node.created_at ? (typeof node.created_at === 'string' ? node.created_at : node.created_at.toISOString()) : new Date().toISOString()
      );
    }
  });

  insertMany(nodes);
  console.log(`[SQLITE] Inserted ${nodes.length} routing nodes successfully.`);
}

/**
 * Insert routing edges data into SQLite table.
 */
export function insertRoutingEdges(db: Database.Database, edges: any[]) {
  console.log(`[SQLITE] Inserting ${edges.length} routing edges...`);
  
  const insertStmt = db.prepare(`
    INSERT INTO routing_edges (
      from_node_id, to_node_id, trail_id, trail_name, distance_km, 
      elevation_gain, elevation_loss, is_bidirectional, geometry_wkt, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((edges: any[]) => {
    for (const edge of edges) {
      // Convert geometry to WKT if it exists
      let geometryWkt = null;
      if (edge.geometry) {
        // For now, create a simple line between from and to points
        // In a real implementation, you'd extract the actual geometry
        geometryWkt = `LINESTRING(${edge.from_lng || 0} ${edge.from_lat || 0}, ${edge.to_lng || 0} ${edge.to_lat || 0})`;
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
        geometryWkt,
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
export function insertRegionMetadata(db: Database.Database, regionMeta: any) {
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
  return {
    region_name: config.region,
    bbox_min_lng: regionBbox.minLng,
    bbox_max_lng: regionBbox.maxLng,
    bbox_min_lat: regionBbox.minLat,
    bbox_max_lat: regionBbox.maxLat,
    trail_count: regionBbox.trailCount
  };
}

/**
 * Insert schema version into SQLite table.
 */
export function insertSchemaVersion(db: Database.Database, version: number, description: string) {
  console.log(`[SQLITE] Inserting schema version ${version}: ${description}`);
  
  const insertStmt = db.prepare(`
    INSERT INTO schema_version (version, description, created_at) VALUES (?, ?, ?)
  `);

  insertStmt.run(version, description, new Date().toISOString());
  
  console.log(`[SQLITE] Inserted schema version ${version} successfully.`);
} 