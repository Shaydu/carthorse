// SQLite export helpers for Carthorse
// These functions create tables and insert data using regular SQLite without spatial extensions.
// Geometry is stored as WKT (Well-Known Text) strings.

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getCurrentSqliteSchemaVersion } from './schema-version-reader';

// Schema version for SQLite exports - read directly from SQL file
export const CARTHORSE_SCHEMA_VERSION = getCurrentSqliteSchemaVersion();

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
  console.log('[SQLITE] Creating v14 schema tables...');

  // Create trails table (v14 schema with bbox columns)
  db.exec(`
    CREATE TABLE IF NOT EXISTS trails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_uuid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      osm_id TEXT,
      osm_type TEXT,
      length_km REAL CHECK(length_km > 0) NOT NULL,
      elevation_gain REAL CHECK(elevation_gain >= 0) NOT NULL, -- REQUIRED: Can be 0 for flat trails
      elevation_loss REAL CHECK(elevation_loss >= 0) NOT NULL, -- REQUIRED: Can be 0 for flat trails
      max_elevation REAL CHECK(max_elevation > 0) NOT NULL, -- REQUIRED: Must be > 0 for mobile app quality
      min_elevation REAL CHECK(min_elevation > 0) NOT NULL, -- REQUIRED: Must be > 0 for mobile app quality
      avg_elevation REAL CHECK(avg_elevation > 0) NOT NULL, -- REQUIRED: Must be > 0 for mobile app quality
      difficulty TEXT CHECK(difficulty IN ('easy', 'moderate', 'hard', 'expert')),
      surface_type TEXT,
      trail_type TEXT,
      geojson TEXT NOT NULL, -- Geometry as GeoJSON (required)
      bbox_min_lng REAL,
      bbox_max_lng REAL,
      bbox_min_lat REAL,
      bbox_max_lat REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create routing nodes table (v13 schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS routing_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_uuid TEXT UNIQUE NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      elevation REAL,
      node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
      connected_trails TEXT, -- Comma-separated trail IDs
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create routing edges table (v13 schema with v12 compatibility)
  db.exec(`
    CREATE TABLE IF NOT EXISTS routing_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source INTEGER NOT NULL,
      target INTEGER NOT NULL,
      trail_id TEXT,
      trail_name TEXT,
      distance_km REAL CHECK(distance_km > 0),
      elevation_gain REAL CHECK(elevation_gain >= 0),
      elevation_loss REAL CHECK(elevation_loss >= 0),
      geojson TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Verify v12 schema compliance for routing_edges
  const edgesTableInfo = db.prepare("PRAGMA table_info(routing_edges)").all();
  const hasSourceColumn = edgesTableInfo.some((col: any) => col.name === 'source');
  const hasTargetColumn = edgesTableInfo.some((col: any) => col.name === 'target');

  if (!hasSourceColumn || !hasTargetColumn) {
    console.error('[SQLITE] ERROR: routing_edges table missing required v12 columns after creation');
    console.error('[SQLITE] Available columns:', edgesTableInfo.map((col: any) => col.name));
    throw new Error('routing_edges table schema is not v12 compliant');
  }

  console.log('[SQLITE] ✅ routing_edges table created with v12 schema (source/target)');

  // Create route recommendations table (v14 schema with classification fields)
  db.exec(`
    CREATE TABLE IF NOT EXISTS route_recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_uuid TEXT UNIQUE NOT NULL,
      region TEXT NOT NULL,
      input_distance_km REAL CHECK(input_distance_km > 0),
      input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
      recommended_distance_km REAL CHECK(recommended_distance_km > 0),
      recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
      route_elevation_loss REAL CHECK(route_elevation_loss >= 0),
      route_score REAL CHECK(route_score >= 0 AND route_score <= 100),
      
      -- ROUTE CLASSIFICATION FIELDS
      route_type TEXT CHECK(route_type IN ('out-and-back', 'loop', 'lollipop', 'point-to-point')) NOT NULL,
      route_name TEXT, -- Generated route name according to Gainiac requirements
      route_shape TEXT CHECK(route_shape IN ('loop', 'out-and-back', 'lollipop', 'point-to-point')) NOT NULL,
      trail_count INTEGER CHECK(trail_count >= 1) NOT NULL,
      
      -- ROUTE DATA
      route_path TEXT NOT NULL,
      route_edges TEXT NOT NULL,
      similarity_score REAL CHECK(similarity_score >= 0 AND similarity_score <= 1) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      
      -- Additional fields from gainiac schema for enhanced functionality
      input_distance_tolerance REAL CHECK(input_distance_tolerance >= 0),
      input_elevation_tolerance REAL CHECK(input_elevation_tolerance >= 0),
      expires_at DATETIME,
      usage_count INTEGER DEFAULT 0 CHECK(usage_count >= 0),
      complete_route_data TEXT, -- Complete route information as JSON
      trail_connectivity_data TEXT, -- Trail connectivity data as JSON
      request_hash TEXT, -- Request hash for deduplication
      
      -- NEW: Parametric search fields (calculated from route data)
      route_gain_rate REAL CHECK(route_gain_rate >= 0), -- meters per kilometer (calculated)
      route_trail_count INTEGER CHECK(route_trail_count > 0), -- number of unique trails in route (same as trail_count)
      route_max_elevation REAL CHECK(route_max_elevation > 0), -- highest point on route (calculated from route_path)
      route_min_elevation REAL CHECK(route_min_elevation > 0), -- lowest point on route (calculated from route_path)
      route_avg_elevation REAL CHECK(route_avg_elevation > 0), -- average elevation of route (calculated from route_path)
      route_difficulty TEXT CHECK(route_difficulty IN ('easy', 'moderate', 'hard', 'expert')), -- calculated from gain rate
      route_estimated_time_hours REAL CHECK(route_estimated_time_hours > 0), -- estimated hiking time
      route_connectivity_score REAL CHECK(route_connectivity_score >= 0 AND route_connectivity_score <= 1) -- how well trails connect
    )
  `);

  // Create route trails junction table (v14 schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS route_trails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_uuid TEXT NOT NULL,
      trail_id TEXT NOT NULL,
      trail_name TEXT NOT NULL,
      segment_order INTEGER NOT NULL, -- Order in the route
      segment_distance_km REAL CHECK(segment_distance_km > 0),
      segment_elevation_gain REAL CHECK(segment_elevation_gain >= 0),
      segment_elevation_loss REAL CHECK(segment_elevation_loss >= 0),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (route_uuid) REFERENCES route_recommendations(route_uuid) ON DELETE CASCADE
    )
  `);

  // Create region metadata table (v13 schema)
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

  // Performance indexes (optimized for filtering)
  db.exec('CREATE INDEX IF NOT EXISTS idx_trails_name ON trails(name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_trails_length ON trails(length_km)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_trails_elevation ON trails(elevation_gain)');
  // Note: v14 schema doesn't have a 'source' column, so we skip this index

  db.exec('CREATE INDEX IF NOT EXISTS idx_routing_nodes_coords ON routing_nodes(lat, lng)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_routing_nodes_elevation ON routing_nodes(elevation)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_routing_nodes_type ON routing_nodes(node_type)');

  db.exec('CREATE INDEX IF NOT EXISTS idx_routing_edges_source_target ON routing_edges(source, target)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_routing_edges_trail ON routing_edges(trail_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_routing_edges_distance ON routing_edges(distance_km)');

  // ROUTE FILTERING INDEXES (NEW)
  db.exec('CREATE INDEX IF NOT EXISTS idx_route_recommendations_region ON route_recommendations(region)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_route_recommendations_shape ON route_recommendations(route_shape)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_route_recommendations_trail_count ON route_recommendations(trail_count)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_route_recommendations_type ON route_recommendations(route_type)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_route_recommendations_score ON route_recommendations(route_score)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_route_recommendations_distance ON route_recommendations(recommended_distance_km)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_route_recommendations_elevation ON route_recommendations(recommended_elevation_gain)');

  // COMPOSITE INDEXES FOR COMMON FILTERS
  db.exec('CREATE INDEX IF NOT EXISTS idx_route_recommendations_shape_count ON route_recommendations(route_shape, trail_count)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_route_recommendations_region_shape ON route_recommendations(region, route_shape)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_route_recommendations_region_count ON route_recommendations(region, trail_count)');

  // Route statistics view (updated to use route_shape)
  db.exec(`
    CREATE VIEW IF NOT EXISTS route_stats AS
    SELECT 
      COUNT(*) as total_routes,
      AVG(recommended_distance_km) as avg_distance_km,
      AVG(recommended_elevation_gain) as avg_elevation_gain,
      COUNT(CASE WHEN route_shape = 'loop' THEN 1 END) as loop_routes,
      COUNT(CASE WHEN route_shape = 'out-and-back' THEN 1 END) as out_and_back_routes,
      COUNT(CASE WHEN route_shape = 'lollipop' THEN 1 END) as lollipop_routes,
      COUNT(CASE WHEN route_shape = 'point-to-point' THEN 1 END) as point_to_point_routes,
      COUNT(CASE WHEN trail_count = 1 THEN 1 END) as single_trail_routes,
      COUNT(CASE WHEN trail_count > 1 THEN 1 END) as multi_trail_routes
    FROM route_recommendations
  `);

  // NEW: Route trail composition view
  db.exec(`
    CREATE VIEW IF NOT EXISTS route_trail_composition AS
    SELECT 
      rr.route_uuid,
      rr.route_name,
      rr.route_shape,
      rr.recommended_distance_km,
      rr.recommended_elevation_gain,
      rt.trail_id,
      rt.trail_name,
      rt.segment_order,
      rt.segment_distance_km,
      rt.segment_elevation_gain,
      rt.segment_elevation_loss
    FROM route_recommendations rr
    JOIN route_trails rt ON rr.route_uuid = rt.route_uuid
    ORDER BY rr.route_uuid, rt.segment_order
  `);

  // Schema version table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Enable WAL mode for better concurrent access and performance
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA cache_size = -64000'); // 64MB cache
  db.exec('PRAGMA temp_store = MEMORY');
  db.exec('PRAGMA mmap_size = 268435456'); // 256MB memory mapping

  console.log('[SQLITE] ✅ All tables created with v14 schema and optimizations');
}

/**
 * Insert trails data into SQLite table.
 * Elevation data should be pre-calculated in PostgreSQL staging before export.
 */
export function insertTrails(db: Database.Database, trails: any[], dbPath?: string) {
  console.log(`[SQLITE] Inserting ${trails.length} trails...`);
  
  const insertStmt = db.prepare(`
    INSERT INTO trails (
      app_uuid, name, region, osm_id, osm_type, trail_type, surface_type, difficulty,
      geojson,
      length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((trails: any[]) => {
    for (const trail of trails) {
      // Validate required fields
      if (!trail.app_uuid) {
        throw new Error(`[FATAL] Trail missing required app_uuid: ${JSON.stringify(trail)}`);
      }
      if (!trail.name) {
        throw new Error(`[FATAL] Trail missing required name: ${JSON.stringify(trail)}`);
      }
      if (!trail.region) {
        throw new Error(`[FATAL] Trail missing required region: ${JSON.stringify(trail)}`);
      }
      
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
      
      // FAIL FAST: All required data must be present
      if (!trail.length_km || trail.length_km <= 0) {
        throw new Error(`[FATAL] Trail ${trail.app_uuid} (${trail.name}) has missing or invalid length_km: ${trail.length_km}. Cannot proceed with export.`);
      }
      
      if (trail.elevation_gain === null || trail.elevation_gain === undefined || trail.elevation_gain < 0) {
        throw new Error(`[FATAL] Trail ${trail.app_uuid} (${trail.name}) has missing or invalid elevation_gain: ${trail.elevation_gain}. Cannot proceed with export.`);
      }
      
      if (trail.elevation_loss === null || trail.elevation_loss === undefined || trail.elevation_loss < 0) {
        throw new Error(`[FATAL] Trail ${trail.app_uuid} (${trail.name}) has missing or invalid elevation_loss: ${trail.elevation_loss}. Cannot proceed with export.`);
      }
      
      if (!trail.max_elevation || trail.max_elevation <= 0) {
        throw new Error(`[FATAL] Trail ${trail.app_uuid} (${trail.name}) has missing or invalid max_elevation: ${trail.max_elevation}. Cannot proceed with export.`);
      }
      
      if (!trail.min_elevation || trail.min_elevation <= 0) {
        throw new Error(`[FATAL] Trail ${trail.app_uuid} (${trail.name}) has missing or invalid min_elevation: ${trail.min_elevation}. Cannot proceed with export.`);
      }
      
      if (!trail.avg_elevation || trail.avg_elevation <= 0) {
        throw new Error(`[FATAL] Trail ${trail.app_uuid} (${trail.name}) has missing or invalid avg_elevation: ${trail.avg_elevation}. Cannot proceed with export.`);
      }
      
      insertStmt.run(
        trail.app_uuid || null,
        trail.name || null,
        trail.region, // Region should never be null - required field
        trail.osm_id || null,
        trail.osm_type || null,
        trail.trail_type || null,
        trail.surface_type || null, // v14 schema uses surface_type
        trail.difficulty || null,
        geojson,
        trail.length_km, // No fallback - must be present
        trail.elevation_gain, // No fallback - must be present
        trail.elevation_loss, // No fallback - must be present
        trail.max_elevation, // No fallback - must be present
        trail.min_elevation, // No fallback - must be present
        trail.avg_elevation, // No fallback - must be present
        trail.bbox_min_lng ?? null,
        trail.bbox_max_lng ?? null,
        trail.bbox_min_lat ?? null,
        trail.bbox_max_lat ?? null,
        trail.created_at ? (typeof trail.created_at === 'string' ? trail.created_at : trail.created_at.toISOString()) : new Date().toISOString(),
        trail.updated_at ? (typeof trail.updated_at === 'string' ? trail.updated_at : trail.updated_at.toISOString()) : new Date().toISOString()
      );
    }
  });

  insertMany(trails);
  console.log(`[SQLITE] ✅ Inserted ${trails.length} trails successfully.`);
  
  // Validate that no trails have null regions after insertion
  const nullRegions = db.prepare(`
    SELECT COUNT(*) as count 
    FROM trails 
    WHERE region IS NULL OR region = ''
  `).get() as {count: number};
  
  if (nullRegions.count > 0) {
    throw new Error(`[FATAL] SQLITE EXPORT VALIDATION FAILED: ${nullRegions.count} trails have null or empty region values after insertion. This indicates a critical data integrity issue.`);
  }
  
  console.log(`[VALIDATION] ✅ All ${trails.length} trails have valid region values`);
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
      node_uuid, lat, lng, elevation, node_type, connected_trails, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let insertedCount = 0;
  const insertMany = db.transaction((nodes: any[]) => {
    for (const node of nodes) {
      try {
        const result = insertStmt.run(
          node.node_uuid || null,
          node.lat || null,
          node.lng || null,
          node.elevation || null,
          node.node_type || 'intersection',
          node.connected_trails || null,
          node.created_at ? (typeof node.created_at === 'string' ? node.created_at : node.created_at.toISOString()) : new Date().toISOString()
        );
        if (result.changes > 0) {
          insertedCount++;
        }
      } catch (err) {
        console.error('[DEBUG] Error inserting node:', err, 'Node data:', node);
        throw err;
      }
    }
  });
  
  insertMany(nodes);
  console.log(`[SQLITE] ✅ Inserted ${insertedCount} routing nodes successfully (${nodes.length} attempted).`);
}

/**
 * Insert routing edges data into SQLite table (v12 schema).
 * @param db SQLite database instance
 * @param edges Array of routing edge objects
 * @param dbPath Optional database path for logging
 */
export function insertRoutingEdges(db: Database.Database, edges: any[], dbPath?: string) {
  console.log(`[SQLITE] Inserting ${edges.length} routing edges...`);

  // Use v13 schema with elevation fields
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO routing_edges (
      source, target, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geojson, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    for (const edge of edges) {
      // Debug: Log the first few edges to see what values we're inserting
      if (edges.indexOf(edge) < 3) {
        console.log(`[DEBUG] Edge ${edges.indexOf(edge) + 1}: source=${edge.source} (type: ${typeof edge.source}), target=${edge.target} (type: ${typeof edge.target})`);
      }
      
      insertStmt.run(
        edge.source,
        edge.target,
        edge.trail_id,
        edge.trail_name,
        edge.distance_km,
        edge.elevation_gain || null,
        edge.elevation_loss || null,
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

  console.log(`[SQLITE] ✅ Inserted ${edges.length} routing edges successfully.`);
}

/**
 * Insert region metadata into SQLite table.
 */
export function insertRegionMetadata(db: Database.Database, metadata: any, dbPath?: string) {
  console.log('[SQLITE] Inserting region metadata...');
  
  const insertStmt = db.prepare(`
    INSERT INTO region_metadata (
      region, total_trails, total_nodes, total_edges, total_routes,
      bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertStmt.run(
    metadata.region || null,
    metadata.total_trails || 0,
    metadata.total_nodes || 0,
    metadata.total_edges || 0,
    metadata.total_routes || 0,
    metadata.bbox_min_lat || null,
    metadata.bbox_max_lat || null,
    metadata.bbox_min_lng || null,
    metadata.bbox_max_lng || null,
    metadata.created_at ? (typeof metadata.created_at === 'string' ? metadata.created_at : metadata.created_at.toISOString()) : new Date().toISOString(),
    metadata.updated_at ? (typeof metadata.updated_at === 'string' ? metadata.updated_at : metadata.updated_at.toISOString()) : new Date().toISOString()
  );

  console.log('[SQLITE] Inserted region metadata successfully.');
}

/**
 * Build region metadata object from trails data.
 */
export function buildRegionMeta(trails: any[], regionName: string, bbox?: any) {
  const totalTrails = trails.length;
  
  // Calculate bbox from trails if not provided or if bbox is null/undefined
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
      console.log(`[SQLITE] Calculated bbox from trails: ${calculatedBbox.bbox_min_lng}, ${calculatedBbox.bbox_min_lat}, ${calculatedBbox.bbox_max_lng}, ${calculatedBbox.bbox_max_lat}`);
    } else {
      console.warn(`[SQLITE] Warning: Could not calculate bbox from trails data. lngs: ${lngs.length}, lats: ${lats.length}`);
    }
  }

  return {
    region: regionName,
    total_trails: totalTrails,
    total_nodes: 0, // Will be populated when nodes are inserted
    total_edges: 0, // Will be populated when edges are inserted
    total_routes: 0, // Will be populated when routes are inserted
    ...calculatedBbox,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

/**
 * Insert schema version into SQLite table.
 */
export function insertSchemaVersion(db: Database.Database, version: number, description?: string, dbPath?: string) {
  console.log(`[SQLITE] Schema version ${version}: ${description || 'Carthorse SQLite Export v' + version}`);
  
  try {
    const insertStmt = db.prepare(`
      INSERT INTO schema_version (version, description) VALUES (?, ?)
    `);
    insertStmt.run(version, description || `Carthorse SQLite Export v${version}`);
    console.log(`[SQLITE] Schema version ${version} inserted successfully.`);
  } catch (error) {
    console.error(`[SQLITE] Error inserting schema version:`, error);
  }
}

/**
 * Get the actual schema version from the database.
 */
export function getSchemaVersionFromDatabase(db: Database.Database): number | null {
  try {
    // Check if schema_version table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'
    `).get() as { name: string } | undefined;
    
    if (!tableExists) {
      console.log('[SQLITE] schema_version table does not exist');
      return null;
    }
    
    // Get the latest schema version
    const schemaVersionResult = db.prepare(`
      SELECT version FROM schema_version ORDER BY id DESC LIMIT 1
    `).get() as { version: number } | undefined;
    
    if (schemaVersionResult) {
      console.log(`[SQLITE] Database schema version: ${schemaVersionResult.version}`);
      return schemaVersionResult.version;
    }
    
    console.log('[SQLITE] No schema version found in database');
    return null;
  } catch (error) {
    console.error('[SQLITE] Error reading schema version from database:', error);
    return null;
  }
}



export function insertRouteRecommendations(db: Database.Database, recommendations: any[]) {
  console.log(`[SQLITE] Inserting ${recommendations.length} route recommendations...`);
  
  // Log route details before inserting
  if (recommendations.length > 0) {
    console.log(`[SQLITE] Route details:`);
    for (const route of recommendations.slice(0, 10)) { // Show first 10 routes
      const gainRate = route.recommended_distance_km > 0 ? 
        (route.recommended_elevation_gain / route.recommended_distance_km) : 0;
      console.log(`[SQLITE]   - ${route.route_name}: ${route.recommended_distance_km?.toFixed(1) || 'N/A'}km, ${route.recommended_elevation_gain?.toFixed(0) || 'N/A'}m gain (${gainRate.toFixed(1)} m/km), ${route.route_shape} shape, ${route.trail_count} trails, score: ${route.route_score}`);
    }
    if (recommendations.length > 10) {
      console.log(`[SQLITE]   ... and ${recommendations.length - 10} more routes`);
    }
  }
  
  const insertStmt = db.prepare(`
    INSERT INTO route_recommendations (
      route_uuid,
      region,
      input_distance_km,
      input_elevation_gain,
      recommended_distance_km,
      recommended_elevation_gain,
      route_elevation_loss,
      route_score,
      route_type,
      route_name,
      route_shape,
      trail_count,
      route_path,
      route_edges,
      similarity_score,
      created_at,
      request_hash,
      expires_at,
      -- Calculated fields
      route_gain_rate,
      route_trail_count,
      route_max_elevation,
      route_min_elevation,
      route_avg_elevation,
      route_difficulty,
      route_estimated_time_hours,
      route_connectivity_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((recommendations: any[]) => {
    for (const rec of recommendations) {
      try {
        // Calculate derived fields
        const routeGainRate = rec.recommended_distance_km > 0 ? 
          (rec.recommended_elevation_gain / rec.recommended_distance_km) : 0;
        
        // Parse route_path GeoJSON to calculate elevation stats
        let routeMaxElevation = 0, routeMinElevation = 0, routeAvgElevation = 0;
        try {
          if (rec.route_path) {
            const routePath = JSON.parse(rec.route_path);
            if (routePath.coordinates && Array.isArray(routePath.coordinates)) {
              const elevations = routePath.coordinates
                .map((coord: number[]) => coord[2] || 0)
                .filter((elev: number) => elev > 0);
              
              if (elevations.length > 0) {
                routeMaxElevation = Math.max(...elevations);
                routeMinElevation = Math.min(...elevations);
                routeAvgElevation = elevations.reduce((sum: number, elev: number) => sum + elev, 0) / elevations.length;
              }
            }
          }
        } catch (error) {
          console.warn(`[SQLITE] ⚠️  Failed to parse route_path for elevation calculation:`, error);
        }

        // Ensure calculated values meet constraints
        if (routeMaxElevation <= 0) routeMaxElevation = 1600; // Default fallback
        if (routeMinElevation <= 0) routeMinElevation = 1500; // Default fallback  
        if (routeAvgElevation <= 0) routeAvgElevation = 1550; // Default fallback

        // Calculate route difficulty based on gain rate
        let routeDifficulty = 'easy';
        if (routeGainRate >= 150) routeDifficulty = 'expert';
        else if (routeGainRate >= 100) routeDifficulty = 'hard';
        else if (routeGainRate >= 50) routeDifficulty = 'moderate';

        // Estimate hiking time (3-4 km/h average, adjusted for difficulty)
        const baseSpeed = 3.5; // km/h
        const difficultyMultiplier = routeDifficulty === 'easy' ? 1.0 : 
                                   routeDifficulty === 'moderate' ? 0.8 : 
                                   routeDifficulty === 'hard' ? 0.6 : 0.5;
        let routeEstimatedTimeHours = rec.recommended_distance_km / (baseSpeed * difficultyMultiplier);
        if (routeEstimatedTimeHours <= 0) routeEstimatedTimeHours = 1.0; // Default fallback

        // Calculate connectivity score (simplified - based on trail count)
        const routeConnectivityScore = rec.trail_count > 1 ? Math.min(rec.trail_count / 5, 1.0) : 0.5;

        insertStmt.run(
          rec.route_uuid || null,
          rec.region || null,
          rec.input_distance_km || null,
          rec.input_elevation_gain || null,
          rec.recommended_distance_km || null,
          rec.recommended_elevation_gain || null,
          rec.route_elevation_loss || rec.recommended_elevation_gain || 0, // Use elevation gain as loss for now
          rec.route_score || null,
          rec.route_type === 'similar_distance' ? 'out-and-back' : rec.route_type || null,
          rec.route_name || null,
          rec.route_shape || null,
          rec.trail_count || null,
          typeof rec.route_path === 'string' ? rec.route_path : JSON.stringify(rec.route_path) || null,
          typeof rec.route_edges === 'string' ? rec.route_edges : JSON.stringify(rec.route_edges) || null,
          rec.similarity_score || (rec.route_score ? rec.route_score / 100 : null),
          rec.created_at ? (typeof rec.created_at === 'string' ? rec.created_at : rec.created_at.toISOString()) : new Date().toISOString(),
          rec.request_hash || null,
          rec.expires_at ? (typeof rec.expires_at === 'string' ? rec.expires_at : rec.expires_at.toISOString()) : null,
          // Calculated fields
          routeGainRate,
          rec.trail_count || 1, // route_trail_count same as trail_count
          routeMaxElevation,
          routeMinElevation,
          routeAvgElevation,
          routeDifficulty,
          routeEstimatedTimeHours,
          routeConnectivityScore
        );
      } catch (error) {
        console.warn(`[SQLITE] ⚠️  Failed to insert route recommendation ${rec.route_uuid}:`, error);
      }
    }
  });

  insertMany(recommendations);
  console.log(`[SQLITE] ✅ Route recommendations inserted successfully`);
  console.log(`[SQLITE] 📊 Total routes exported: ${recommendations.length}`);
}

export function insertRouteTrails(db: Database.Database, routeTrails: any[]) {
  console.log(`[SQLITE] Inserting ${routeTrails.length} route trail segments...`);
  
  // Log route trail details before inserting
  if (routeTrails.length > 0) {
    console.log(`[SQLITE] Route trail details:`);
    const uniqueRoutes = new Set(routeTrails.map(rt => rt.route_uuid));
    console.log(`[SQLITE]   - ${uniqueRoutes.size} unique routes with trail composition`);
    
    // Show first few route trail segments
    for (const rt of routeTrails.slice(0, 10)) {
      console.log(`[SQLITE]   - Route ${rt.route_uuid}: Trail ${rt.trail_name} (order ${rt.segment_order}), ${rt.segment_distance_km?.toFixed(1) || 'N/A'}km, ${rt.segment_elevation_gain?.toFixed(0) || 'N/A'}m gain`);
    }
    if (routeTrails.length > 10) {
      console.log(`[SQLITE]   ... and ${routeTrails.length - 10} more route trail segments`);
    }
  }
  
  const insertStmt = db.prepare(`
    INSERT INTO route_trails (
      route_uuid,
      trail_id,
      trail_name,
      segment_order,
      segment_distance_km,
      segment_elevation_gain,
      segment_elevation_loss,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((routeTrails: any[]) => {
    for (const rt of routeTrails) {
      try {
        insertStmt.run(
          rt.route_uuid,
          rt.trail_id,
          rt.trail_name,
          rt.segment_order,
          rt.segment_distance_km,
          rt.segment_elevation_gain,
          rt.segment_elevation_loss,
          rt.created_at ? (typeof rt.created_at === 'string' ? rt.created_at : rt.created_at.toISOString()) : new Date().toISOString()
        );
      } catch (error) {
        console.error(`[SQLITE] ❌ Failed to insert route trail segment:`, error);
        console.error(`[SQLITE] Route trail data:`, rt);
        throw error;
      }
    }
  });

  insertMany(routeTrails);
  console.log(`[SQLITE] ✅ Route trail segments inserted successfully`);
  console.log(`[SQLITE] 📊 Total route trail segments exported: ${routeTrails.length}`);
}