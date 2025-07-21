// Helper for staging schema SQL DDL and PostGIS function loading
import * as fs from 'fs';
import * as path from 'path';

export function getStagingSchemaSql(schemaName: string): string {
  return `
    CREATE SCHEMA IF NOT EXISTS ${schemaName};
    CREATE TABLE ${schemaName}.trails (
      id SERIAL PRIMARY KEY,
      app_uuid TEXT UNIQUE NOT NULL,
      osm_id TEXT,
      name TEXT NOT NULL,
      trail_type TEXT,
      surface TEXT,
      difficulty TEXT,
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
      source TEXT,
      region TEXT,
      geometry GEOMETRY(LINESTRINGZ, 4326),
      geometry_text TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE ${schemaName}.trail_hashes (
      trail_id TEXT PRIMARY KEY,
      geometry_hash TEXT NOT NULL,
      elevation_hash TEXT NOT NULL,
      metadata_hash TEXT NOT NULL,
      last_processed TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE ${schemaName}.intersection_points (
      id SERIAL PRIMARY KEY,
      point GEOMETRY(POINT, 4326),
      point_3d GEOMETRY(POINTZ, 4326),
      trail1_id INTEGER,
      trail2_id INTEGER,
      distance_meters REAL,
      created_at TIMESTAMP DEFAULT NOW()
    );
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
      geometry GEOMETRY(LINESTRINGZ, 4326),
      bbox_min_lng REAL,
      bbox_max_lng REAL,
      bbox_min_lat REAL,
      bbox_max_lat REAL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
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
    CREATE TABLE ${schemaName}.routing_edges (
      id SERIAL PRIMARY KEY,
      from_node_id INTEGER,
      to_node_id INTEGER,
      trail_id TEXT,
      trail_name TEXT,
      distance_km REAL,
      elevation_gain REAL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;
}

export function getStagingIndexesSql(schemaName: string): string {
  return `
    CREATE INDEX IF NOT EXISTS idx_staging_trails_osm_id ON ${schemaName}.trails(osm_id);
    CREATE INDEX IF NOT EXISTS idx_staging_trails_bbox ON ${schemaName}.trails(bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);
    CREATE INDEX IF NOT EXISTS idx_staging_trails_geometry ON ${schemaName}.trails USING GIST(geometry);
    CREATE INDEX IF NOT EXISTS idx_staging_split_trails_geometry ON ${schemaName}.split_trails USING GIST(geometry);
    CREATE INDEX IF NOT EXISTS idx_staging_intersection_points_point ON ${schemaName}.intersection_points USING GIST(point);
  `;
}

export function getSchemaQualifiedPostgisFunctionsSql(schemaName: string, functionsSql: string): string {
  return functionsSql
    .replace(/CREATE OR REPLACE FUNCTION build_routing_nodes/g, `CREATE OR REPLACE FUNCTION ${schemaName}.build_routing_nodes`)
    .replace(/CREATE OR REPLACE FUNCTION build_routing_edges/g, `CREATE OR REPLACE FUNCTION ${schemaName}.build_routing_edges`)
    .replace(/CREATE OR REPLACE FUNCTION detect_trail_intersections/g, `CREATE OR REPLACE FUNCTION ${schemaName}.detect_trail_intersections`)
    .replace(/CREATE OR REPLACE FUNCTION get_intersection_stats/g, `CREATE OR REPLACE FUNCTION ${schemaName}.get_intersection_stats`)
    .replace(/CREATE OR REPLACE FUNCTION validate_intersection_detection/g, `CREATE OR REPLACE FUNCTION ${schemaName}.validate_intersection_detection`)
    .replace(/CREATE OR REPLACE FUNCTION validate_spatial_data_integrity/g, `CREATE OR REPLACE FUNCTION ${schemaName}.validate_spatial_data_integrity`)
    .replace(/CREATE OR REPLACE FUNCTION split_trails_at_intersections/g, `CREATE OR REPLACE FUNCTION ${schemaName}.split_trails_at_intersections`);
} 