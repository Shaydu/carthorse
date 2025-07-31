-- Create a new test database with exact production schema
-- This script will recreate trail_master_db_test with production structure

-- First, drop the existing test database if it exists
DROP DATABASE IF EXISTS trail_master_db_test;

-- Create new test database
CREATE DATABASE trail_master_db_test;

-- Connect to the new database and recreate all production structure
\c trail_master_db_test;

-- Create all schemas
CREATE SCHEMA IF NOT EXISTS osm_boulder;
CREATE SCHEMA IF NOT EXISTS topology;

-- Create all tables with exact production structure
CREATE TABLE public.trails (
    id integer NOT NULL,
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
    geometry public.geometry(LineStringZ,4326) NOT NULL,
    CONSTRAINT trails_3d_geometry CHECK ((public.st_ndims(geometry) = 3)),
    CONSTRAINT trails_avg_elevation_range CHECK (((avg_elevation >= min_elevation) AND (avg_elevation <= max_elevation))),
    CONSTRAINT trails_elevation_gain_positive CHECK ((elevation_gain >= (0)::double precision)),
    CONSTRAINT trails_elevation_loss_positive CHECK ((elevation_loss >= (0)::double precision)),
    CONSTRAINT trails_elevation_order CHECK ((max_elevation >= min_elevation)),
    CONSTRAINT trails_max_elevation_valid CHECK ((max_elevation > (0)::double precision)),
    CONSTRAINT trails_min_elevation_valid CHECK ((min_elevation > (0)::double precision)),
    CONSTRAINT trails_min_points CHECK ((public.st_npoints(geometry) >= 2)),
    CONSTRAINT trails_valid_geometry CHECK (public.st_isvalid(geometry))
);

-- Create all other tables with production structure
CREATE TABLE public.elevation_points (
    id integer NOT NULL,
    lat real NOT NULL,
    lng real NOT NULL,
    elevation real NOT NULL,
    source text DEFAULT 'srtm'::text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.intersection_points (
    id integer NOT NULL,
    point public.geometry(Point,4326),
    point_3d public.geometry(PointZ,4326),
    connected_trail_ids text[],
    connected_trail_names text[],
    node_type text,
    distance_meters real,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.regions (
    id integer NOT NULL,
    region_key text NOT NULL,
    region_name text NOT NULL,
    bbox_min_lng real,
    bbox_max_lng real,
    bbox_min_lat real,
    bbox_max_lat real,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.route_recommendations (
    id integer NOT NULL,
    route_uuid text NOT NULL,
    region text NOT NULL,
    input_distance_km real,
    input_elevation_gain real,
    recommended_distance_km real,
    recommended_elevation_gain real,
    route_type text,
    route_shape text,
    trail_count integer,
    route_score integer,
    route_path text,
    route_edges text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.routing_edges (
    id integer NOT NULL,
    source integer NOT NULL,
    target integer NOT NULL,
    trail_id text NOT NULL,
    trail_name text NOT NULL,
    distance_km real NOT NULL,
    elevation_gain real,
    elevation_loss real,
    is_bidirectional boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    geom public.geometry(LineStringZ,4326),
    geojson text
);

CREATE TABLE public.routing_edges_vertices_pgr (
    id integer NOT NULL,
    cnt integer,
    chk integer,
    ein integer,
    eout integer,
    the_geom public.geometry(Point,4326)
);

CREATE TABLE public.routing_nodes (
    id integer NOT NULL,
    node_uuid text,
    lat real,
    lng real,
    elevation real,
    node_type text,
    connected_trails text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    the_geom public.geometry(Point,4326)
);

CREATE TABLE public.schema_version (
    id integer NOT NULL,
    version integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.split_trails (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    original_trail_id integer NOT NULL,
    segment_number integer NOT NULL,
    osm_id text,
    name text NOT NULL,
    region text NOT NULL,
    trail_type text,
    surface text,
    difficulty text,
    source_tags jsonb,
    bbox_min_lng real,
    bbox_max_lng real,
    bbox_min_lat real,
    bbox_max_lat real,
    length_km real,
    elevation_gain real,
    elevation_loss real,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    source text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    geometry public.geometry(LineStringZ,4326)
);

CREATE TABLE public.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Create all indexes with production structure
CREATE INDEX idx_elevation_points_elevation ON public.elevation_points USING btree (elevation);
CREATE INDEX idx_elevation_points_location ON public.elevation_points USING btree (lat, lng);
CREATE INDEX idx_elevation_points_spatial ON public.elevation_points USING gist (public.st_setsrid(public.st_point((lng)::double precision, (lat)::double precision), 4326));
CREATE INDEX idx_intersection_points_node_type ON public.intersection_points USING btree (node_type);
CREATE INDEX idx_intersection_points_point ON public.intersection_points USING gist (point);
CREATE INDEX idx_intersection_points_point_3d ON public.intersection_points USING gist (point_3d);
CREATE INDEX idx_regions_bbox ON public.regions USING gist (public.st_makeenvelope((bbox_min_lng)::double precision, (bbox_min_lat)::double precision, (bbox_max_lng)::double precision, (bbox_max_lat)::double precision));
CREATE INDEX idx_regions_key ON public.regions USING btree (region_key);
CREATE INDEX idx_routing_edges_geom ON public.routing_edges USING gist (geom);
CREATE INDEX idx_routing_nodes_geom ON public.routing_nodes USING gist (the_geom);
CREATE INDEX idx_split_trails_app_uuid ON public.split_trails USING btree (app_uuid);
CREATE INDEX idx_split_trails_bbox ON public.split_trails USING gist (public.st_makeenvelope((bbox_min_lng)::double precision, (bbox_min_lat)::double precision, (bbox_max_lng)::double precision, (bbox_max_lat)::double precision));
CREATE INDEX idx_split_trails_geometry ON public.split_trails USING gist (geometry);
CREATE INDEX idx_split_trails_original_trail_id ON public.split_trails USING btree (original_trail_id);
CREATE INDEX idx_split_trails_segment_number ON public.split_trails USING btree (segment_number);
CREATE INDEX idx_trail_hashes_app_uuid ON public.trail_hashes USING btree (app_uuid);
CREATE INDEX idx_trail_hashes_geometry_hash ON public.trail_hashes USING btree (geometry_hash);
CREATE INDEX idx_trails_3d_geometry ON public.trails USING gist (geometry) WHERE (public.st_ndims(geometry) = 3);
CREATE INDEX idx_trails_3d_geometry_complete ON public.trails USING gist (geometry) WHERE (public.st_ndims(geometry) = 3);
CREATE INDEX idx_trails_app_uuid ON public.trails USING btree (app_uuid);
CREATE INDEX idx_trails_bbox ON public.trails USING gist (public.st_makeenvelope((bbox_min_lng)::double precision, (bbox_min_lat)::double precision, (bbox_max_lng)::double precision, (bbox_max_lat)::double precision));
CREATE INDEX idx_trails_bbox_coords ON public.trails USING btree (bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);
CREATE INDEX idx_trails_bbox_spatial ON public.trails USING gist (public.st_envelope(geometry));
CREATE INDEX idx_trails_bbox_validation ON public.trails USING btree (bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat) WHERE (bbox_min_lng IS NOT NULL);
CREATE INDEX idx_trails_complete_elevation ON public.trails USING btree (region, length_km, elevation_gain) WHERE ((elevation_gain IS NOT NULL) AND (max_elevation IS NOT NULL));
CREATE INDEX idx_trails_completeness_check ON public.trails USING btree (elevation_gain, max_elevation, min_elevation, avg_elevation) WHERE (elevation_gain IS NOT NULL);
CREATE INDEX idx_trails_elevation ON public.trails USING btree (elevation_gain);
CREATE INDEX idx_trails_geom ON public.trails USING gist (geometry);
CREATE INDEX idx_trails_geom_spatial ON public.trails USING gist (geometry);
CREATE INDEX idx_trails_geometry ON public.trails USING gist (geometry);
CREATE INDEX idx_trails_geometry_gist ON public.trails USING gist (geometry);
CREATE INDEX idx_trails_osm_id ON public.trails USING btree (osm_id);
CREATE INDEX idx_trails_region ON public.trails USING btree (region);
CREATE INDEX idx_trails_region_bbox ON public.trails USING btree (region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);
CREATE INDEX idx_trails_region_elevation ON public.trails USING btree (region, elevation_gain);
CREATE INDEX idx_trails_region_elevation_composite ON public.trails USING btree (region, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation);
CREATE INDEX idx_trails_region_length_composite ON public.trails USING btree (region, length_km, elevation_gain);
CREATE INDEX idx_trails_region_surface_composite ON public.trails USING btree (region, surface, trail_type);
CREATE INDEX idx_trails_surface ON public.trails USING btree (surface);
CREATE INDEX idx_trails_type ON public.trails USING btree (trail_type);
CREATE INDEX routing_edges_geom_idx ON public.routing_edges USING gist (geom);
CREATE INDEX routing_edges_id_idx ON public.routing_edges USING btree (id);
CREATE INDEX routing_edges_source_idx ON public.routing_edges USING btree (source);
CREATE INDEX routing_edges_target_idx ON public.routing_edges USING btree (target);
CREATE INDEX routing_edges_vertices_pgr_the_geom_idx ON public.routing_edges_vertices_pgr USING gist (the_geom);

-- Insert schema version
INSERT INTO public.schema_version (version, created_at, updated_at) VALUES (7, NOW(), NOW());

-- Create all production functions
-- Note: We'll need to copy the actual function definitions from production
-- This is a placeholder - the actual functions will be copied in the next step 