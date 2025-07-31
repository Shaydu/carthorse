-- Carthorse Table Schemas
-- Generated: 2025-07-31T20:30:18.454Z

-- Table: elevation_points
CREATE TABLE IF NOT EXISTS elevation_points (
  id integer NOT NULL DEFAULT nextval('elevation_points_id_seq'::regclass),
  lat real NOT NULL,
  lng real NOT NULL,
  elevation integer NOT NULL,
  source_file text,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: geography_columns
CREATE TABLE IF NOT EXISTS geography_columns (
  f_table_catalog name,
  f_table_schema name,
  f_table_name name,
  f_geography_column name,
  coord_dimension integer,
  srid integer,
  type text
);

-- Table: geometry_columns
CREATE TABLE IF NOT EXISTS geometry_columns (
  f_table_catalog character varying,
  f_table_schema name,
  f_table_name name,
  f_geometry_column name,
  coord_dimension integer,
  srid integer,
  type character varying
);

-- Table: incomplete_trails
CREATE TABLE IF NOT EXISTS incomplete_trails (
  id integer,
  app_uuid text,
  name text,
  region text,
  missing_data text
);

-- Table: inconsistent_elevation_data
CREATE TABLE IF NOT EXISTS inconsistent_elevation_data (
  id integer,
  app_uuid text,
  name text,
  region text,
  max_elevation real,
  min_elevation real,
  avg_elevation real,
  elevation_gain real,
  inconsistency_type text
);

-- Table: intersection_points
CREATE TABLE IF NOT EXISTS intersection_points (
  id integer NOT NULL DEFAULT nextval('intersection_points_id_seq'::regclass),
  point USER-DEFINED,
  point_3d USER-DEFINED,
  connected_trail_ids ARRAY,
  connected_trail_names ARRAY,
  node_type text,
  distance_meters real,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: invalid_geometries
CREATE TABLE IF NOT EXISTS invalid_geometries (
  id integer,
  app_uuid text,
  name text,
  region text,
  validity_reason text
);

-- Table: raster_columns
CREATE TABLE IF NOT EXISTS raster_columns (
  r_table_catalog name,
  r_table_schema name,
  r_table_name name,
  r_raster_column name,
  srid integer,
  scale_x double precision,
  scale_y double precision,
  blocksize_x integer,
  blocksize_y integer,
  same_alignment boolean,
  regular_blocking boolean,
  num_bands integer,
  pixel_types ARRAY,
  nodata_values ARRAY,
  out_db ARRAY,
  extent USER-DEFINED,
  spatial_index boolean
);

-- Table: raster_overviews
CREATE TABLE IF NOT EXISTS raster_overviews (
  o_table_catalog name,
  o_table_schema name,
  o_table_name name,
  o_raster_column name,
  r_table_catalog name,
  r_table_schema name,
  r_table_name name,
  r_raster_column name,
  overview_factor integer
);

-- Table: regions
CREATE TABLE IF NOT EXISTS regions (
  id integer NOT NULL DEFAULT nextval('regions_id_seq'::regclass),
  region_key text NOT NULL,
  name text NOT NULL,
  description text,
  api_url text,
  bbox_min_lng real,
  bbox_max_lng real,
  bbox_min_lat real,
  bbox_max_lat real,
  initial_view_bbox_min_lng real,
  initial_view_bbox_max_lng real,
  initial_view_bbox_min_lat real,
  initial_view_bbox_max_lat real,
  center_lng real,
  center_lat real,
  metadata_source text,
  metadata_last_updated text,
  metadata_version text,
  metadata_coverage text,
  metadata_trail_count text,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  initial_view_bbox jsonb,
  trail_count integer,
  last_updated timestamp without time zone
);

-- Table: route_patterns
CREATE TABLE IF NOT EXISTS route_patterns (
  id integer NOT NULL DEFAULT nextval('route_patterns_id_seq'::regclass),
  pattern_name text NOT NULL,
  target_distance_km double precision NOT NULL,
  target_elevation_gain double precision NOT NULL,
  route_shape text NOT NULL,
  tolerance_percent double precision NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: route_recommendations
CREATE TABLE IF NOT EXISTS route_recommendations (
  id integer NOT NULL DEFAULT nextval('route_recommendations_id_seq'::regclass),
  gpx_distance_km real,
  gpx_elevation_gain real,
  gpx_name text,
  recommended_distance_km real,
  recommended_elevation_gain real,
  route_type text,
  route_edges jsonb,
  route_path jsonb,
  similarity_score real,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: routing_edges
CREATE TABLE IF NOT EXISTS routing_edges (
  id integer,
  app_uuid text,
  name text,
  trail_type text,
  length_km real,
  elevation_gain real,
  elevation_loss real,
  geom USER-DEFINED,
  source integer,
  target integer
);

-- Table: routing_edges_vertices_pgr
CREATE TABLE IF NOT EXISTS routing_edges_vertices_pgr (
  id bigint NOT NULL DEFAULT nextval('routing_edges_vertices_pgr_id_seq'::regclass),
  cnt integer,
  chk integer,
  ein integer,
  eout integer,
  the_geom USER-DEFINED
);

-- Table: routing_nodes
CREATE TABLE IF NOT EXISTS routing_nodes (
  id bigint,
  the_geom USER-DEFINED,
  cnt integer,
  lng double precision,
  lat double precision,
  elevation double precision
);

-- Table: schema_version
CREATE TABLE IF NOT EXISTS schema_version (
  id integer NOT NULL DEFAULT nextval('schema_version_id_seq'::regclass),
  version integer NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: spatial_ref_sys
CREATE TABLE IF NOT EXISTS spatial_ref_sys (
  srid integer NOT NULL,
  auth_name character varying,
  auth_srid integer,
  srtext character varying,
  proj4text character varying
);

-- Table: split_trails
CREATE TABLE IF NOT EXISTS split_trails (
  id integer NOT NULL DEFAULT nextval('split_trails_id_seq'::regclass),
  original_trail_id integer NOT NULL,
  segment_number integer NOT NULL,
  app_uuid text NOT NULL,
  name text,
  trail_type text,
  surface text,
  difficulty text,
  source_tags jsonb,
  osm_id text,
  elevation_gain real,
  elevation_loss real,
  max_elevation real,
  min_elevation real,
  avg_elevation real,
  length_km real,
  source text,
  geometry USER-DEFINED,
  bbox_min_lng real,
  bbox_max_lng real,
  bbox_min_lat real,
  bbox_max_lat real,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: trail_hashes
CREATE TABLE IF NOT EXISTS trail_hashes (
  id integer NOT NULL DEFAULT nextval('trail_hashes_id_seq'::regclass),
  app_uuid text NOT NULL,
  geometry_hash text NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: trails
CREATE TABLE IF NOT EXISTS trails (
  id integer NOT NULL DEFAULT nextval('trails_id_seq'::regclass),
  app_uuid text NOT NULL,
  osm_id text,
  source text DEFAULT 'osm'::text,
  name text NOT NULL,
  trail_type text,
  surface text,
  difficulty text,
  elevation_gain real NOT NULL,
  max_elevation real NOT NULL,
  min_elevation real NOT NULL,
  avg_elevation real NOT NULL,
  length_km real,
  source_tags jsonb,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  bbox_min_lng real,
  bbox_max_lng real,
  bbox_min_lat real,
  bbox_max_lat real,
  elevation_loss real NOT NULL,
  region text NOT NULL,
  geometry USER-DEFINED NOT NULL,
  geojson_cached text
);

-- Table: trails_with_2d_geometry
CREATE TABLE IF NOT EXISTS trails_with_2d_geometry (
  id integer,
  app_uuid text,
  name text,
  region text,
  dimensions smallint,
  geometry_type text
);

