// Helper for staging schema SQL DDL and PostGIS function loading
import * as fs from 'fs';
import * as path from 'path';

export function getStagingSchemaSql(schemaName: string): string {
  const dropTablesSql = [
    'trails',
    'trail_hashes',
    'intersection_points',
    'split_trails',
    'routing_nodes',
    'routing_edges'
  ].map(table => `DROP TABLE IF EXISTS ${schemaName}.${table} CASCADE;`).join('\n');
  
  const routingEdgesSql = `CREATE TABLE ${schemaName}.routing_edges (
      id SERIAL PRIMARY KEY,
      from_node_id INTEGER NOT NULL,
      to_node_id INTEGER NOT NULL,
      trail_id TEXT NOT NULL,
      trail_name TEXT NOT NULL,
      distance_km REAL NOT NULL,
      elevation_gain REAL NOT NULL DEFAULT 0,
      elevation_loss REAL NOT NULL DEFAULT 0,
      is_bidirectional BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      geo2 geometry(LineString, 4326),
      FOREIGN KEY (from_node_id) REFERENCES ${schemaName}.routing_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (to_node_id) REFERENCES ${schemaName}.routing_nodes(id) ON DELETE CASCADE
    );`;
  console.log('[DEBUG] CREATE TABLE routing_edges SQL:', routingEdgesSql);
  
  return `
    ${dropTablesSql}
    
    -- Staging trails table
    CREATE TABLE ${schemaName}.trails (
      id SERIAL PRIMARY KEY,
      app_uuid TEXT UNIQUE NOT NULL,
      osm_id TEXT,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      trail_type TEXT,
      surface TEXT,
      difficulty TEXT,
      source_tags JSONB,
      bbox_min_lng REAL,
      bbox_max_lng REAL,
      bbox_min_lat REAL,
      bbox_max_lat REAL,
      length_km REAL,
      elevation_gain REAL DEFAULT 0,
      elevation_loss REAL DEFAULT 0,
      max_elevation REAL,
      min_elevation REAL,
      avg_elevation REAL,
      source TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      geo2 GEOMETRY(LINESTRINGZ, 4326),
      geo2_text TEXT,
      geo2_hash TEXT NOT NULL
    );

    -- Trail hash cache table
    CREATE TABLE ${schemaName}.trail_hashes (
      id SERIAL PRIMARY KEY,
      trail_id INTEGER REFERENCES ${schemaName}.trails(id) ON DELETE CASCADE,
      geo2_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Intersection points table
    CREATE TABLE ${schemaName}.intersection_points (
      id SERIAL PRIMARY KEY,
      point GEOMETRY(POINT, 4326),
      point_3d GEOMETRY(POINTZ, 4326),
      connected_trail_ids TEXT[],
      connected_trail_names TEXT[],
      node_type TEXT,
      distance_meters REAL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Split trails table
    CREATE TABLE ${schemaName}.split_trails (
      id SERIAL PRIMARY KEY,
      original_trail_id INTEGER,
      segment_number INTEGER,
      app_uuid TEXT UNIQUE NOT NULL,
      name TEXT,
      trail_type TEXT,
      surface TEXT,
      difficulty TEXT,
      source_tags TEXT,
      osm_id TEXT,
      elevation_gain REAL,
      elevation_loss REAL,
      max_elevation REAL,
      min_elevation REAL,
      avg_elevation REAL,
      length_km REAL,
      source TEXT,
      geo2 GEOMETRY(LINESTRINGZ, 4326),
      bbox_min_lng REAL,
      bbox_max_lng REAL,
      bbox_min_lat REAL,
      bbox_max_lat REAL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Routing nodes table
    CREATE TABLE ${schemaName}.routing_nodes (
      id SERIAL PRIMARY KEY,
      node_uuid TEXT UNIQUE,
      lat REAL,
      lng REAL,
      elevation REAL,
      node_type TEXT,
      connected_trails TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    ${routingEdgesSql}

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_geo2 ON ${schemaName}.trails USING GIST(geo2);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_split_trails_geo2 ON ${schemaName}.split_trails USING GIST(geo2);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_intersection_points ON ${schemaName}.intersection_points USING GIST(point);
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_routing_nodes_location ON ${schemaName}.routing_nodes USING GIST(ST_SetSRID(ST_MakePoint(lng, lat), 4326));
    CREATE INDEX IF NOT EXISTS idx_${schemaName}_routing_edges_geo2 ON ${schemaName}.routing_edges USING GIST(geo2);
  `;
}

export function getStagingIndexesSql(schemaName: string): string {
  return `
    CREATE INDEX IF NOT EXISTS idx_staging_trails_osm_id ON ${schemaName}.trails(osm_id);
    CREATE INDEX IF NOT EXISTS idx_staging_trails_bbox ON ${schemaName}.trails(bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);
    CREATE INDEX IF NOT EXISTS idx_staging_trails_geometry ON ${schemaName}.trails USING GIST(geometry);
    CREATE INDEX IF NOT EXISTS idx_staging_split_trails_geometry ON ${schemaName}.split_trails USING GIST(geometry);
    CREATE INDEX IF NOT EXISTS idx_staging_intersection_points_point ON ${schemaName}.intersection_points USING GIST(point);
    CREATE INDEX IF NOT EXISTS idx_staging_routing_nodes_geometry ON ${schemaName}.routing_nodes USING GIST(ST_SetSRID(ST_MakePoint(lng, lat), 4326));
    CREATE INDEX IF NOT EXISTS idx_staging_routing_edges_geometry ON ${schemaName}.routing_edges USING GIST(geometry);
  `;
}

export function getSchemaQualifiedPostgisFunctionsSql(schemaName: string, functionsSql: string): string {
  return functionsSql
    // Rewrite all function definitions to use the staging schema (including those explicitly in public schema)
    .replace(/CREATE OR REPLACE FUNCTION public\.detect_trail_intersections/g, `CREATE OR REPLACE FUNCTION ${schemaName}.detect_trail_intersections`)
    .replace(/CREATE OR REPLACE FUNCTION public\.build_routing_nodes/g, `CREATE OR REPLACE FUNCTION ${schemaName}.build_routing_nodes`)
    .replace(/CREATE OR REPLACE FUNCTION public\.build_routing_edges/g, `CREATE OR REPLACE FUNCTION ${schemaName}.build_routing_edges`)
    .replace(/CREATE OR REPLACE FUNCTION public\.get_intersection_stats/g, `CREATE OR REPLACE FUNCTION ${schemaName}.get_intersection_stats`)
    .replace(/CREATE OR REPLACE FUNCTION public\.validate_intersection_detection/g, `CREATE OR REPLACE FUNCTION ${schemaName}.validate_intersection_detection`)
    .replace(/CREATE OR REPLACE FUNCTION public\.validate_spatial_data_integrity/g, `CREATE OR REPLACE FUNCTION ${schemaName}.validate_spatial_data_integrity`)
    .replace(/CREATE OR REPLACE FUNCTION public\.split_trails_at_intersections/g, `CREATE OR REPLACE FUNCTION ${schemaName}.split_trails_at_intersections`)
    // Also handle functions without explicit schema (default to public)
    .replace(/CREATE OR REPLACE FUNCTION detect_trail_intersections/g, `CREATE OR REPLACE FUNCTION ${schemaName}.detect_trail_intersections`)
    .replace(/CREATE OR REPLACE FUNCTION build_routing_nodes/g, `CREATE OR REPLACE FUNCTION ${schemaName}.build_routing_nodes`)
    .replace(/CREATE OR REPLACE FUNCTION build_routing_edges/g, `CREATE OR REPLACE FUNCTION ${schemaName}.build_routing_edges`)
    .replace(/CREATE OR REPLACE FUNCTION get_intersection_stats/g, `CREATE OR REPLACE FUNCTION ${schemaName}.get_intersection_stats`)
    .replace(/CREATE OR REPLACE FUNCTION validate_intersection_detection/g, `CREATE OR REPLACE FUNCTION ${schemaName}.validate_intersection_detection`)
    .replace(/CREATE OR REPLACE FUNCTION validate_spatial_data_integrity/g, `CREATE OR REPLACE FUNCTION ${schemaName}.validate_spatial_data_integrity`)
    .replace(/CREATE OR REPLACE FUNCTION split_trails_at_intersections/g, `CREATE OR REPLACE FUNCTION ${schemaName}.split_trails_at_intersections`)
    // Also replace any references to public schema functions within the function bodies
    .replace(/public\.detect_trail_intersections\(/g, `${schemaName}.detect_trail_intersections(`)
    .replace(/public\.build_routing_nodes\(/g, `${schemaName}.build_routing_nodes(`)
    .replace(/public\.build_routing_edges\(/g, `${schemaName}.build_routing_edges(`)
    .replace(/public\.get_intersection_stats\(/g, `${schemaName}.get_intersection_stats(`)
    .replace(/public\.validate_intersection_detection\(/g, `${schemaName}.validate_intersection_detection(`)
    .replace(/public\.validate_spatial_data_integrity\(/g, `${schemaName}.validate_spatial_data_integrity(`)
    .replace(/public\.split_trails_at_intersections\(/g, `${schemaName}.split_trails_at_intersections(`)
    // Also replace unqualified function calls within function bodies
    .replace(/detect_trail_intersections\(/g, `${schemaName}.detect_trail_intersections(`)
    .replace(/build_routing_nodes\(/g, `${schemaName}.build_routing_nodes(`)
    .replace(/build_routing_edges\(/g, `${schemaName}.build_routing_edges(`)
    .replace(/get_intersection_stats\(/g, `${schemaName}.get_intersection_stats(`)
    .replace(/validate_intersection_detection\(/g, `${schemaName}.validate_intersection_detection(`)
    .replace(/validate_spatial_data_integrity\(/g, `${schemaName}.validate_spatial_data_integrity(`)
    .replace(/split_trails_at_intersections\(/g, `${schemaName}.split_trails_at_intersections(`);
} 