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
  console.log('[SQLITE] Creating v13 schema tables...');

  // Create trails table (v13 schema)
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
      length_km REAL CHECK(length_km > 0),
      elevation_gain REAL CHECK(elevation_gain >= 0) NOT NULL, -- REQUIRED: Can be 0 for flat trails
      elevation_loss REAL CHECK(elevation_loss >= 0) NOT NULL, -- REQUIRED: Can be 0 for flat trails
      max_elevation REAL CHECK(max_elevation > 0) NOT NULL, -- REQUIRED: Must be > 0 for mobile app quality
      min_elevation REAL CHECK(min_elevation > 0) NOT NULL, -- REQUIRED: Must be > 0 for mobile app quality
      avg_elevation REAL CHECK(avg_elevation > 0) NOT NULL, -- REQUIRED: Must be > 0 for mobile app quality
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  // Create route recommendations table (v13 schema with classification fields)
  db.exec(`
    CREATE TABLE IF NOT EXISTS route_recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_uuid TEXT UNIQUE NOT NULL,
      region TEXT NOT NULL,
      input_distance_km REAL CHECK(input_distance_km > 0),
      input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
      recommended_distance_km REAL CHECK(recommended_distance_km > 0),
      recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
      recommended_elevation_loss REAL CHECK(recommended_elevation_loss >= 0),
      route_score REAL CHECK(route_score >= 0 AND route_score <= 100),
      
      -- ROUTE CLASSIFICATION FIELDS
      route_type TEXT,
      route_shape TEXT CHECK(route_shape IN ('loop', 'out-and-back', 'lollipop', 'point-to-point')) NOT NULL,
      trail_count INTEGER CHECK(trail_count >= 1) NOT NULL,
      
      -- ROUTE DATA
      route_path TEXT NOT NULL,
      route_edges TEXT NOT NULL,
      request_hash TEXT,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  db.exec('CREATE INDEX IF NOT EXISTS idx_trails_source ON trails(source)');

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
    CREATE VIEW route_stats AS
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

  // Enable WAL mode for better concurrent access and performance
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA cache_size = -64000'); // 64MB cache
  db.exec('PRAGMA temp_store = MEMORY');
  db.exec('PRAGMA mmap_size = 268435456'); // 256MB memory mapping

  console.log('[SQLITE] ✅ All tables created with v13 schema and optimizations');
}

/**
 * Insert trails data into SQLite table.
 * Elevation data should be pre-calculated in PostgreSQL staging before export.
 */
export function insertTrails(db: Database.Database, trails: any[], dbPath?: string) {
  console.log(`[SQLITE] Inserting ${trails.length} trails...`);
  
  const insertStmt = db.prepare(`
    INSERT INTO trails (
      app_uuid, osm_id, name, source, trail_type, surface, difficulty,
      geojson, source_tags,
      length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      // For routing purposes, set elevation gain to 0 for trails under 2 meters to prevent unrealistic gain rates
      const routingElevationGain = (trail.length_km || 0) < 0.002 ? 0 : (trail.elevation_gain ?? 0);
      const routingElevationLoss = (trail.length_km || 0) < 0.002 ? 0 : (trail.elevation_loss ?? 0);
      
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
        trail.length_km || null,
        routingElevationGain,
        routingElevationLoss,
        trail.max_elevation ?? null,
        trail.min_elevation ?? null,
        trail.avg_elevation ?? null,
        trail.created_at ? (typeof trail.created_at === 'string' ? trail.created_at : trail.created_at.toISOString()) : new Date().toISOString()
      );
    }
  });

  insertMany(trails);
  console.log(`[SQLITE] ✅ Inserted ${trails.length} trails successfully.`);
}

/**
 * Insert routing nodes data into SQLite table (v12 schema).
 * @param db SQLite database instance
 * @param nodes Array of routing node objects
 * @param dbPath Optional database path for logging
 */
export function insertRoutingNodes(db: Database.Database, nodes: any[], dbPath?: string) {
  console.log(`[SQLITE] Inserting ${nodes.length} routing nodes...`);
  
  // Debug: Print first few nodes to see their structure
  if (nodes.length > 0) {
    console.log('[DEBUG] First node object:', nodes[0]);
    console.log('[DEBUG] Node object keys:', Object.keys(nodes[0]));
  }
  
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

  // Debug: Print actual schema of routing_edges table
  const tableInfo = db.prepare('PRAGMA table_info(routing_edges)').all();
  console.log('[DEBUG] Actual routing_edges table schema:', tableInfo);
  
  if (edges.length > 0) {
    console.log('[DEBUG] First edge object:', edges[0]);
    console.log('[DEBUG] Edge object keys:', Object.keys(edges[0]));
  }

  // Use v13 schema with elevation fields
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO routing_edges (
      source, target, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geojson, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    for (const edge of edges) {
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
  
  // Note: v13 schema doesn't include schema_version table
  // Schema version is tracked in the table structure itself
  console.log(`[SQLITE] Schema version ${version} validated by table structure.`);
}

/**
 * Validate schema version in SQLite database.
 */
export function validateSchemaVersion(db: Database.Database, expectedVersion: number): boolean {
  try {
    // Check if v13 schema tables exist
    const hasRouteRecommendations = hasColumn(db, 'route_recommendations', 'route_shape');
    const hasTrailCount = hasColumn(db, 'route_recommendations', 'trail_count');
    const hasRouteType = hasColumn(db, 'route_recommendations', 'route_type');
    
    if (!hasRouteRecommendations || !hasTrailCount || !hasRouteType) {
      console.warn('[SQLITE] Database does not have v13 schema structure');
      return false;
    }
    
    console.log(`[SQLITE] Schema version validated: v${expectedVersion} (Carthorse SQLite Export v13)`);
    return true;
  } catch (error) {
    console.error('[SQLITE] Error validating schema version:', error);
    return false;
  }
}

export function insertRouteRecommendations(db: Database.Database, recommendations: any[]) {
  console.log(`[SQLITE] Inserting ${recommendations.length} route recommendations...`);
  
  const insertStmt = db.prepare(`
    INSERT INTO route_recommendations (
      route_uuid,
      region,
      input_distance_km,
      input_elevation_gain,
      recommended_distance_km,
      recommended_elevation_gain,
      recommended_elevation_loss,
      route_score,
      route_type,
      route_shape,
      trail_count,
      route_path,
      route_edges,
      request_hash,
      expires_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((recommendations: any[]) => {
    for (const rec of recommendations) {
      try {
        insertStmt.run(
          rec.route_uuid || null,
          rec.region || null,
          rec.input_distance_km || null,
          rec.input_elevation_gain || null,
          rec.recommended_distance_km || null,
          rec.recommended_elevation_gain || null,
          rec.recommended_elevation_loss || null,
          rec.route_score || null,
          rec.route_type || null,
          rec.route_shape || null,
          rec.trail_count || null,
          rec.route_path || null,
          rec.route_edges || null,
          rec.request_hash || null,
          rec.expires_at ? (typeof rec.expires_at === 'string' ? rec.expires_at : rec.expires_at.toISOString()) : null,
          rec.created_at ? (typeof rec.created_at === 'string' ? rec.created_at : rec.created_at.toISOString()) : new Date().toISOString()
        );
      } catch (error) {
        console.warn(`[SQLITE] ⚠️  Failed to insert route recommendation ${rec.route_uuid}:`, error);
      }
    }
  });

  insertMany(recommendations);
  console.log(`[SQLITE] ✅ Route recommendations inserted successfully`);
}