// SQLite export helpers for Carthorse
// These functions create tables and insert data using regular SQLite without spatial extensions.
// Geometry is stored as WKT (Well-Known Text) strings.

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { SCHEMA_VERSION } from '../constants';

// Schema version for SQLite exports (deprecated - use SCHEMA_VERSION.CURRENT)
export const CARTHORSE_SCHEMA_VERSION = SCHEMA_VERSION.CURRENT;

/**
 * Check if a table has a specific column
 */
function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  try {
    const result = db.prepare("PRAGMA table_info(?)").all(tableName);
    return result.some((col: any) => col.name === columnName);
  } catch (error) {
    return false;
  }
}

/**
 * Create SQLite tables with v12 schema (pgRouting optimized + deduplication).
 */
export function createSqliteTables(db: Database.Database, dbPath?: string) {
  console.log('[SQLITE] Creating tables with v12 schema (pgRouting optimized + deduplication)...');
  
  // Force drop and recreate tables to ensure v12 schema
  console.log('[SQLITE] Dropping existing tables to ensure v12 schema...');
  db.exec('DROP TABLE IF EXISTS routing_edges');
  db.exec('DROP TABLE IF EXISTS routing_nodes');
  db.exec('DROP TABLE IF EXISTS trails');
  db.exec('DROP TABLE IF EXISTS region_metadata');
  db.exec('DROP TABLE IF EXISTS schema_version');
  db.exec('DROP TABLE IF EXISTS route_recommendations');
  
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
      elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
      elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
      max_elevation REAL,
      min_elevation REAL,
      avg_elevation REAL,
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
  
  // Verify the table was created with correct v12 schema
  const edgesTableInfo = db.prepare('PRAGMA table_info(routing_edges)').all();
  const hasSourceColumn = edgesTableInfo.some((col: any) => col.name === 'source');
  const hasTargetColumn = edgesTableInfo.some((col: any) => col.name === 'target');
  
  if (!hasSourceColumn || !hasTargetColumn) {
    console.error('[SQLITE] ERROR: routing_edges table missing required v12 columns after creation');
    console.error('[SQLITE] Available columns:', edgesTableInfo.map((col: any) => col.name));
    throw new Error('routing_edges table schema is not v12 compliant');
  }

  console.log('[SQLITE] ✅ routing_edges table created with v12 schema (source/target)');

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

  // Create v12 indexes
  console.log('[SQLITE] Creating v12 indexes...');
  
  // Core indexes
  db.exec('CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON trails(app_uuid)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_trails_name ON trails(name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_trails_osm_id ON trails(osm_id) WHERE osm_id IS NOT NULL');
  
  // pgRouting optimized indexes
  db.exec('CREATE INDEX IF NOT EXISTS idx_routing_nodes_coords ON routing_nodes(lat, lng)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_routing_nodes_elevation ON routing_nodes(elevation) WHERE elevation IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_routing_nodes_cnt ON routing_nodes(cnt)');
  
  // pgRouting edge indexes
  db.exec('CREATE INDEX IF NOT EXISTS idx_routing_edges_source ON routing_edges(source)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_routing_edges_target ON routing_edges(target)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_routing_edges_source_target ON routing_edges(source, target)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_routing_edges_trail_id ON routing_edges(trail_id)');
  
  // Composite indexes
  db.exec('CREATE INDEX IF NOT EXISTS idx_routing_edges_route_finding ON routing_edges(source, target, distance_km)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_trails_bbox ON trails(bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat)');
  
  // Partial indexes
  db.exec('CREATE INDEX IF NOT EXISTS idx_routing_nodes_intersections ON routing_nodes(id, lat, lng) WHERE cnt > 1');
  
  // Performance indices
  db.exec('CREATE INDEX IF NOT EXISTS idx_trails_length ON trails(length_km)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_trails_elevation ON trails(elevation_gain)');

  // Enable SQLite optimizations for v12
  console.log('[SQLITE] Applying v12 optimizations...');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA cache_size = -64000');
  db.exec('PRAGMA temp_store = MEMORY');
  db.exec('PRAGMA mmap_size = 268435456');
  db.exec('PRAGMA optimize');

  console.log('[SQLITE] ✅ All tables created with v12 schema and optimizations');
}

/**
 * Insert trails data into SQLite table.
 * Elevation data should be pre-calculated in PostgreSQL staging before export.
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
      
      // CRITICAL: Validate that GeoJSON coordinates have proper elevation data (not 0)
      try {
        const geojsonObj = JSON.parse(geojson);
        const coordinates = geojsonObj.geometry?.coordinates || geojsonObj.coordinates;
        
        if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) {
          throw new Error(`[FATAL] Invalid coordinates structure for trail: ${trail.name || trail.app_uuid}`);
        }
        
        // Check if coordinates have 3D structure and non-zero elevation
        const has3DCoordinates = coordinates.every((coord: any) => 
          Array.isArray(coord) && coord.length === 3 && typeof coord[2] === 'number'
        );
        
        if (!has3DCoordinates) {
          throw new Error(`[FATAL] Trail coordinates are not 3D for trail: ${trail.name || trail.app_uuid}`);
        }
        
        // Check for zero elevation values
        const zeroElevationCoords = coordinates.filter((coord: any) => coord[2] === 0);
        if (zeroElevationCoords.length > 0) {
          const sampleCoords = zeroElevationCoords.slice(0, 3).map((c: any) => `[${c.join(', ')}]`);
          throw new Error(`[FATAL] ELEVATION VALIDATION FAILED: Trail "${trail.name || trail.app_uuid}" has ${zeroElevationCoords.length} coordinates with 0 elevation. Sample coordinates: ${sampleCoords.join(', ')}. This indicates the export process is not preserving 3D elevation data correctly.`);
        }
        
        // Validate that elevation values are reasonable (not negative, not extremely high)
        const invalidElevations = coordinates.filter((coord: any) => 
          coord[2] < 0 || coord[2] > 10000 // Above 10km elevation is suspicious
        );
        if (invalidElevations.length > 0) {
          const sampleCoords = invalidElevations.slice(0, 3).map((c: any) => `[${c.join(', ')}]`);
          throw new Error(`[FATAL] ELEVATION VALIDATION FAILED: Trail "${trail.name || trail.app_uuid}" has ${invalidElevations.length} coordinates with invalid elevation values. Sample coordinates: ${sampleCoords.join(', ')}. Elevation should be between 0 and 10000 meters.`);
        }
        
        console.log(`[VALIDATION] ✅ Trail "${trail.name || trail.app_uuid}" has valid 3D coordinates with elevation data`);
        
      } catch (error) {
        if (error instanceof Error && error.message.includes('[FATAL]')) {
          throw error; // Re-throw our validation errors
        }
        throw new Error(`[FATAL] Failed to validate GeoJSON coordinates for trail "${trail.name || trail.app_uuid}": ${error instanceof Error ? error.message : String(error)}`);
      }
      
      // Enforce source_tags is JSON-encoded string
      let source_tags = trail.source_tags;
      if (source_tags && typeof source_tags !== 'string') source_tags = JSON.stringify(source_tags);
      
      // Elevation data should be pre-calculated in PostgreSQL staging
      // No calculation here - just transfer the pre-calculated values
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
        trail.elevation_gain !== undefined ? trail.elevation_gain : null,
        trail.elevation_loss !== undefined ? trail.elevation_loss : null,
        trail.max_elevation !== undefined ? trail.max_elevation : null,
        trail.min_elevation !== undefined ? trail.min_elevation : null,
        trail.avg_elevation !== undefined ? trail.avg_elevation : null,
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

  // Always use v12 schema (source/target)
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO routing_edges (
      source, target, trail_id, trail_name, distance_km, geojson, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  try {
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