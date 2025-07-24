-- Carthorse SQLite Export Schema v8

-- Trails table (geometry as GeoJSON only)
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

-- Routing nodes table (no geometry column, just lat/lng)
CREATE TABLE routing_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_uuid TEXT UNIQUE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  elevation REAL,
  node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
  connected_trails TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Routing edges table (geometry as GeoJSON only)
CREATE TABLE routing_edges (
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

-- Region metadata table
CREATE TABLE region_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_name TEXT NOT NULL,
  bbox_min_lng REAL,
  bbox_max_lng REAL,
  bbox_min_lat REAL,
  bbox_max_lat REAL,
  trail_count INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Schema version table
CREATE TABLE schema_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON trails(app_uuid);
CREATE INDEX IF NOT EXISTS idx_trails_name ON trails(name);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_node_uuid ON routing_nodes(node_uuid);
CREATE INDEX IF NOT EXISTS idx_routing_edges_trail_id ON routing_edges(trail_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_from_node_id ON routing_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_to_node_id ON routing_edges(to_node_id); 