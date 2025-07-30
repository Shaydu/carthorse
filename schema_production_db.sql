--
-- PostgreSQL database dump
--

-- Dumped from database version 14.18 (Homebrew)
-- Dumped by pg_dump version 14.18 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: osm_boulder; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA osm_boulder;


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: pgrouting; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgrouting WITH SCHEMA public;


--
-- Name: EXTENSION pgrouting; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgrouting IS 'pgRouting Extension';


--
-- Name: postgis_raster; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_raster WITH SCHEMA public;


--
-- Name: EXTENSION postgis_raster; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis_raster IS 'PostGIS raster types and functions';


--
-- Name: auto_calculate_bbox(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_calculate_bbox() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.geometry IS NOT NULL AND 
     (NEW.bbox_min_lng IS NULL OR NEW.bbox_max_lng IS NULL OR 
      NEW.bbox_min_lat IS NULL OR NEW.bbox_max_lat IS NULL) THEN
    
    NEW.bbox_min_lng := ST_XMin(NEW.geometry);
    NEW.bbox_max_lng := ST_XMax(NEW.geometry);
    NEW.bbox_min_lat := ST_YMin(NEW.geometry);
    NEW.bbox_max_lat := ST_YMax(NEW.geometry);
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION auto_calculate_bbox(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.auto_calculate_bbox() IS 'Automatically calculates bounding box from geometry';


--
-- Name: auto_calculate_length(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_calculate_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.geometry IS NOT NULL AND (NEW.length_km IS NULL OR NEW.length_km <= 0) THEN
    NEW.length_km := ST_Length(NEW.geometry, true) / 1000.0; -- Convert meters to kilometers
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION auto_calculate_length(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.auto_calculate_length() IS 'Automatically calculates trail length from geometry';


--
-- Name: calculate_trail_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_trail_stats() RETURNS TABLE(total_trails bigint, total_length_km double precision, avg_elevation_gain double precision, regions_count bigint)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_trails,
        COALESCE(SUM(length_km), 0) as total_length_km,
        COALESCE(AVG(elevation_gain), 0) as avg_elevation_gain,
        COUNT(DISTINCT region) as regions_count
    FROM trails;
END;
$$;


--
-- Name: check_database_integrity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_database_integrity() RETURNS TABLE(check_name text, status text, count bigint, details text)
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Check incomplete trails
  RETURN QUERY
  SELECT 
    'Incomplete Trails'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
    COUNT(*),
    'Trails missing required data'::TEXT
  FROM incomplete_trails;
  
  -- Check 2D geometries
  RETURN QUERY
  SELECT 
    '2D Geometries'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END::TEXT,
    COUNT(*),
    'Trails with 2D geometry (should be 3D)'::TEXT
  FROM trails_with_2d_geometry;
  
  -- Check invalid geometries
  RETURN QUERY
  SELECT 
    'Invalid Geometries'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
    COUNT(*),
    'Trails with invalid geometry'::TEXT
  FROM invalid_geometries;
  
  -- Check inconsistent elevation data
  RETURN QUERY
  SELECT 
    'Inconsistent Elevation'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
    COUNT(*),
    'Trails with inconsistent elevation data'::TEXT
  FROM inconsistent_elevation_data;
  
  -- Check orphaned routing edges
  RETURN QUERY
  SELECT 
    'Orphaned Routing Edges'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
    COUNT(*),
    'Routing edges referencing non-existent trails'::TEXT
  FROM routing_edges re
  WHERE NOT EXISTS (SELECT 1 FROM trails t WHERE t.app_uuid = re.trail_id);
END;
$$;


--
-- Name: FUNCTION check_database_integrity(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.check_database_integrity() IS 'Comprehensive database integrity check';


--
-- Name: generate_routing_graph(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_routing_graph() RETURNS TABLE(edges_count integer, nodes_count integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Drop existing tables
  DROP TABLE IF EXISTS public.routing_edges CASCADE;
  DROP TABLE IF EXISTS public.routing_nodes CASCADE;
  
  -- Create routing edges (one edge per trail)
  CREATE TABLE public.routing_edges AS
  SELECT
    id,
    app_uuid,
    name,
    trail_type,
    length_km,
    elevation_gain,
    elevation_loss,
    -- Use simplified geometry for routing
            ST_SimplifyPreserveTopology(geometry, 0.0001) AS geom
  FROM public.trails
  WHERE geometry IS NOT NULL;

  -- Add routing topology columns
  ALTER TABLE public.routing_edges ADD COLUMN source INTEGER;
  ALTER TABLE public.routing_edges ADD COLUMN target INTEGER;

  -- Create topology using pgRouting
  PERFORM pgr_createTopology('public.routing_edges', 0.0001, 'geom', 'id');

  -- Create nodes table from topology
  CREATE TABLE public.routing_nodes AS
  SELECT 
    id,
    the_geom,
    cnt,
    ST_X(the_geom) as lng,
    ST_Y(the_geom) as lat,
    ST_Z(the_geom) as elevation
  FROM public.routing_edges_vertices_pgr;

  -- Add spatial indexes for performance
  CREATE INDEX IF NOT EXISTS idx_routing_edges_geom ON public.routing_edges USING GIST (geom);
  CREATE INDEX IF NOT EXISTS idx_routing_nodes_geom ON public.routing_nodes USING GIST (the_geom);

  -- Return counts
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*)::INTEGER FROM public.routing_edges) as edges_count,
    (SELECT COUNT(*)::INTEGER FROM public.routing_nodes) as nodes_count;
END;
$$;


--
-- Name: show_routing_summary(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.show_routing_summary() RETURNS TABLE(type text, count bigint)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    'Routing Edges (One per trail)' as type,
    COUNT(*) as count
  FROM public.routing_edges
  UNION ALL
  SELECT 
    'Routing Nodes (Intersections)' as type,
    COUNT(*) as count
  FROM public.routing_nodes;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


--
-- Name: validate_routing_edge_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_routing_edge_consistency() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Ensure trail_id references a valid trail
  IF NOT EXISTS (SELECT 1 FROM trails WHERE app_uuid = NEW.trail_id) THEN
    RAISE EXCEPTION 'trail_id must reference a valid trail in trails table';
  END IF;
  
  -- Ensure nodes exist
  IF NOT EXISTS (SELECT 1 FROM routing_nodes WHERE id = NEW.from_node_id) THEN
    RAISE EXCEPTION 'from_node_id must reference a valid node in routing_nodes table';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM routing_nodes WHERE id = NEW.to_node_id) THEN
    RAISE EXCEPTION 'to_node_id must reference a valid node in routing_nodes table';
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: validate_spatial_data_integrity(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_spatial_data_integrity(staging_schema text) RETURNS TABLE(validation_check text, status text, details text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Geometry validity
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Geometry validity'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' invalid geometries found'' as details
        FROM %I.trails 
        WHERE geometry IS NOT NULL AND NOT ST_IsValid(geometry)
    ', staging_schema);

    -- Coordinate system consistency (SRID 4326)
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Coordinate system consistency'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' geometries with wrong SRID'' as details
        FROM %I.trails 
        WHERE geometry IS NOT NULL AND ST_SRID(geometry) != 4326
    ', staging_schema);

    -- Intersection node connections
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Intersection node connections'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' intersection nodes with <2 connected trails'' as details
        FROM %I.routing_nodes 
        WHERE node_type = ''intersection'' AND 
              array_length(string_to_array(connected_trails, '',''), 1) < 2
    ', staging_schema);

    -- Edge connectivity
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Edge connectivity'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' edges with invalid node connections'' as details
        FROM %I.routing_edges e
        LEFT JOIN %I.routing_nodes n1 ON e.from_node_id = n1.id
        LEFT JOIN %I.routing_nodes n2 ON e.to_node_id = n2.id
        WHERE n1.id IS NULL OR n2.id IS NULL
    ', staging_schema, staging_schema, staging_schema);

    -- Spatial containment (move aggregates to a subquery)
    RETURN QUERY EXECUTE format('
        WITH bbox AS (
            SELECT 
                MIN(bbox_min_lng) AS min_lng,
                MIN(bbox_min_lat) AS min_lat,
                MAX(bbox_max_lng) AS max_lng,
                MAX(bbox_max_lat) AS max_lat
            FROM %I.trails
        )
        SELECT 
            ''Spatial containment'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''WARNING'' END as status,
            COUNT(*)::text || '' trails outside region bbox'' as details
        FROM %I.trails t, bbox
        WHERE t.geometry IS NOT NULL AND NOT ST_Within(
            t.geometry, 
            ST_MakeEnvelope(bbox.min_lng, bbox.min_lat, bbox.max_lng, bbox.max_lat, 4326)
        )
    ', staging_schema, staging_schema);
END;
$$;


--
-- Name: validate_trail_completeness(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_trail_completeness() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Ensure complete trails have all required elevation data
  IF NEW.geometry IS NOT NULL AND 
     (NEW.elevation_gain IS NULL OR NEW.max_elevation IS NULL OR 
      NEW.min_elevation IS NULL OR NEW.avg_elevation IS NULL) THEN
    RAISE EXCEPTION 'Complete trails must have all elevation data (elevation_gain, max_elevation, min_elevation, avg_elevation)';
  END IF;
  
  -- Ensure 3D geometry has elevation data
  IF NEW.geometry IS NOT NULL AND ST_NDims(NEW.geometry) = 3 AND 
     (NEW.elevation_gain IS NULL OR NEW.elevation_gain = 0) THEN
    RAISE EXCEPTION '3D geometry must have valid elevation_gain data';
  END IF;
  
  -- Ensure bbox is calculated if geometry exists
  IF NEW.geometry IS NOT NULL AND 
     (NEW.bbox_min_lng IS NULL OR NEW.bbox_max_lng IS NULL OR 
      NEW.bbox_min_lat IS NULL OR NEW.bbox_max_lat IS NULL) THEN
    RAISE EXCEPTION 'Trails with geometry must have calculated bounding box';
  END IF;
  
  -- Ensure length is calculated if geometry exists
  IF NEW.geometry IS NOT NULL AND (NEW.length_km IS NULL OR NEW.length_km <= 0) THEN
    RAISE EXCEPTION 'Trails with geometry must have calculated length_km';
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION validate_trail_completeness(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.validate_trail_completeness() IS 'Ensures complete trails have all required elevation and geometry data';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ways; Type: TABLE; Schema: osm_boulder; Owner: -
--

CREATE TABLE osm_boulder.ways (
    osm_id bigint NOT NULL,
    name text,
    highway text,
    route text,
    surface text,
    difficulty text,
    tags jsonb,
    way_geom public.geometry(LineString,4326)
);


--
-- Name: elevation_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.elevation_points (
    id integer NOT NULL,
    lat real NOT NULL,
    lng real NOT NULL,
    elevation integer NOT NULL,
    source_file text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_elevation_points_elevation_range CHECK (((elevation >= '-1000'::integer) AND (elevation <= 9000))),
    CONSTRAINT chk_elevation_points_lat_range CHECK (((lat >= ('-90'::integer)::double precision) AND (lat <= (90)::double precision))),
    CONSTRAINT chk_elevation_points_lng_range CHECK (((lng >= ('-180'::integer)::double precision) AND (lng <= (180)::double precision)))
);


--
-- Name: TABLE elevation_points; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.elevation_points IS 'Elevation data points from TIFF files';


--
-- Name: elevation_points_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.elevation_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: elevation_points_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.elevation_points_id_seq OWNED BY public.elevation_points.id;


--
-- Name: trails; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: TABLE trails; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.trails IS 'Master trails table with 3D geometry and elevation data';


--
-- Name: COLUMN trails.elevation_gain; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trails.elevation_gain IS 'Total elevation gain in meters (must be >= 0)';


--
-- Name: COLUMN trails.length_km; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trails.length_km IS 'Trail length in kilometers (must be > 0)';


--
-- Name: COLUMN trails.elevation_loss; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trails.elevation_loss IS 'Total elevation loss in meters (must be >= 0)';


--
-- Name: COLUMN trails.geometry; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trails.geometry IS '3D LineString geometry with elevation data (SRID: 4326)';


--
-- Name: incomplete_trails; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.incomplete_trails AS
 SELECT trails.id,
    trails.app_uuid,
    trails.name,
    trails.region,
        CASE
            WHEN (trails.geometry IS NULL) THEN 'Missing geometry'::text
            WHEN (trails.elevation_gain IS NULL) THEN 'Missing elevation_gain'::text
            WHEN (trails.max_elevation IS NULL) THEN 'Missing max_elevation'::text
            WHEN (trails.min_elevation IS NULL) THEN 'Missing min_elevation'::text
            WHEN (trails.avg_elevation IS NULL) THEN 'Missing avg_elevation'::text
            WHEN ((trails.length_km IS NULL) OR (trails.length_km <= (0)::double precision)) THEN 'Missing or invalid length'::text
            WHEN (trails.bbox_min_lng IS NULL) THEN 'Missing bbox'::text
            ELSE 'Other'::text
        END AS missing_data
   FROM public.trails
  WHERE ((trails.geometry IS NULL) OR (trails.elevation_gain IS NULL) OR (trails.max_elevation IS NULL) OR (trails.min_elevation IS NULL) OR (trails.avg_elevation IS NULL) OR (trails.length_km IS NULL) OR (trails.length_km <= (0)::double precision) OR (trails.bbox_min_lng IS NULL));


--
-- Name: inconsistent_elevation_data; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inconsistent_elevation_data AS
 SELECT trails.id,
    trails.app_uuid,
    trails.name,
    trails.region,
    trails.max_elevation,
    trails.min_elevation,
    trails.avg_elevation,
    trails.elevation_gain,
        CASE
            WHEN (trails.max_elevation < trails.min_elevation) THEN 'max_elevation < min_elevation'::text
            WHEN (trails.avg_elevation < trails.min_elevation) THEN 'avg_elevation < min_elevation'::text
            WHEN (trails.avg_elevation > trails.max_elevation) THEN 'avg_elevation > max_elevation'::text
            ELSE 'Other'::text
        END AS inconsistency_type
   FROM public.trails
  WHERE ((trails.max_elevation IS NOT NULL) AND (trails.min_elevation IS NOT NULL) AND (trails.avg_elevation IS NOT NULL) AND ((trails.max_elevation < trails.min_elevation) OR (trails.avg_elevation < trails.min_elevation) OR (trails.avg_elevation > trails.max_elevation)));


--
-- Name: intersection_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intersection_points (
    id integer NOT NULL,
    point public.geometry(Point,4326),
    point_3d public.geometry(PointZ,4326),
    connected_trail_ids text[],
    connected_trail_names text[],
    node_type text,
    distance_meters real,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_intersection_points_distance_positive CHECK (((distance_meters IS NULL) OR (distance_meters >= (0)::double precision))),
    CONSTRAINT chk_intersection_points_node_type_valid CHECK (((node_type IS NULL) OR (node_type = ANY (ARRAY['intersection'::text, 'endpoint'::text, 'trailhead'::text])))),
    CONSTRAINT chk_intersection_points_valid_point CHECK (public.st_isvalid(point)),
    CONSTRAINT chk_intersection_points_valid_point_3d CHECK (((point_3d IS NULL) OR public.st_isvalid(point_3d)))
);


--
-- Name: TABLE intersection_points; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.intersection_points IS 'Stores intersection points between trails for routing and analysis';


--
-- Name: COLUMN intersection_points.connected_trail_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.intersection_points.connected_trail_ids IS 'Array of trail IDs that connect at this intersection';


--
-- Name: COLUMN intersection_points.connected_trail_names; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.intersection_points.connected_trail_names IS 'Array of trail names that connect at this intersection';


--
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.intersection_points_id_seq OWNED BY public.intersection_points.id;


--
-- Name: invalid_geometries; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.invalid_geometries AS
 SELECT trails.id,
    trails.app_uuid,
    trails.name,
    trails.region,
    public.st_isvalidreason(trails.geometry) AS validity_reason
   FROM public.trails
  WHERE ((trails.geometry IS NOT NULL) AND (NOT public.st_isvalid(trails.geometry)));


--
-- Name: regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regions (
    id integer NOT NULL,
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


--
-- Name: regions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.regions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: regions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.regions_id_seq OWNED BY public.regions.id;


--
-- Name: route_recommendations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.route_recommendations (
    id integer NOT NULL,
    gpx_distance_km real,
    gpx_elevation_gain real,
    gpx_name text,
    recommended_distance_km real,
    recommended_elevation_gain real,
    route_type text,
    route_edges jsonb,
    route_path jsonb,
    similarity_score real,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_route_recommendations_distance_positive CHECK (((gpx_distance_km IS NULL) OR (gpx_distance_km > (0)::double precision))),
    CONSTRAINT chk_route_recommendations_elevation_gain_non_negative CHECK (((gpx_elevation_gain IS NULL) OR (gpx_elevation_gain >= (0)::double precision))),
    CONSTRAINT chk_route_recommendations_route_type_valid CHECK (((route_type IS NULL) OR (route_type = ANY (ARRAY['exact_match'::text, 'similar_distance'::text, 'similar_elevation'::text, 'similar_profile'::text, 'custom'::text])))),
    CONSTRAINT chk_route_recommendations_similarity_score_range CHECK (((similarity_score IS NULL) OR ((similarity_score >= (0)::double precision) AND (similarity_score <= (1)::double precision))))
);


--
-- Name: TABLE route_recommendations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.route_recommendations IS 'GPX-based route recommendations';


--
-- Name: route_recommendations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.route_recommendations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: route_recommendations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.route_recommendations_id_seq OWNED BY public.route_recommendations.id;


--
-- Name: routing_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routing_edges (
    id integer,
    app_uuid text,
    name text,
    trail_type text,
    length_km real,
    elevation_gain real,
    elevation_loss real,
    geom public.geometry,
    source integer,
    target integer
);


--
-- Name: routing_edges_vertices_pgr; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routing_edges_vertices_pgr (
    id bigint NOT NULL,
    cnt integer,
    chk integer,
    ein integer,
    eout integer,
    the_geom public.geometry(Point,4326)
);


--
-- Name: routing_edges_vertices_pgr_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.routing_edges_vertices_pgr_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_vertices_pgr_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.routing_edges_vertices_pgr_id_seq OWNED BY public.routing_edges_vertices_pgr.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routing_nodes (
    id bigint,
    the_geom public.geometry(Point,4326),
    cnt integer,
    lng double precision,
    lat double precision,
    elevation double precision
);


--
-- Name: schema_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_version (
    id integer NOT NULL,
    version integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: schema_version_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.schema_version_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: schema_version_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.schema_version_id_seq OWNED BY public.schema_version.id;


--
-- Name: split_trails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.split_trails (
    id integer NOT NULL,
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
    geometry public.geometry(LineStringZ,4326),
    bbox_min_lng real,
    bbox_max_lng real,
    bbox_min_lat real,
    bbox_max_lat real,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_split_trails_elevation_gain_non_negative CHECK ((elevation_gain >= (0)::double precision)),
    CONSTRAINT chk_split_trails_elevation_loss_non_negative CHECK ((elevation_loss >= (0)::double precision)),
    CONSTRAINT chk_split_trails_elevation_order CHECK ((max_elevation >= min_elevation)),
    CONSTRAINT chk_split_trails_min_points CHECK ((public.st_npoints(geometry) >= 2)),
    CONSTRAINT chk_split_trails_segment_number_positive CHECK ((segment_number > 0)),
    CONSTRAINT chk_split_trails_valid_geometry CHECK (public.st_isvalid(geometry))
);


--
-- Name: TABLE split_trails; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.split_trails IS 'Stores individual trail segments created by splitting trails at intersections';


--
-- Name: COLUMN split_trails.original_trail_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.split_trails.original_trail_id IS 'Reference to the original unsplit trail';


--
-- Name: COLUMN split_trails.segment_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.split_trails.segment_number IS 'Sequential segment number (1, 2, 3...) within the original trail';


--
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.split_trails_id_seq OWNED BY public.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_trail_hashes_hash_not_empty CHECK ((geometry_hash <> ''::text))
);


--
-- Name: TABLE trail_hashes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.trail_hashes IS 'Cache table for trail geometry hashes to avoid duplicate processing';


--
-- Name: COLUMN trail_hashes.geometry_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trail_hashes.geometry_hash IS 'Hash of trail geometry for duplicate detection';


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trail_hashes_id_seq OWNED BY public.trail_hashes.id;


--
-- Name: trails_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trails_id_seq OWNED BY public.trails.id;


--
-- Name: trails_with_2d_geometry; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.trails_with_2d_geometry AS
 SELECT trails.id,
    trails.app_uuid,
    trails.name,
    trails.region,
    public.st_ndims(trails.geometry) AS dimensions,
    public.st_geometrytype(trails.geometry) AS geometry_type
   FROM public.trails
  WHERE ((trails.geometry IS NOT NULL) AND (public.st_ndims(trails.geometry) = 2));


--
-- Name: elevation_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.elevation_points ALTER COLUMN id SET DEFAULT nextval('public.elevation_points_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intersection_points ALTER COLUMN id SET DEFAULT nextval('public.intersection_points_id_seq'::regclass);


--
-- Name: regions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions ALTER COLUMN id SET DEFAULT nextval('public.regions_id_seq'::regclass);


--
-- Name: route_recommendations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_recommendations ALTER COLUMN id SET DEFAULT nextval('public.route_recommendations_id_seq'::regclass);


--
-- Name: routing_edges_vertices_pgr id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_edges_vertices_pgr ALTER COLUMN id SET DEFAULT nextval('public.routing_edges_vertices_pgr_id_seq'::regclass);


--
-- Name: schema_version id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_version ALTER COLUMN id SET DEFAULT nextval('public.schema_version_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.split_trails ALTER COLUMN id SET DEFAULT nextval('public.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_hashes ALTER COLUMN id SET DEFAULT nextval('public.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trails ALTER COLUMN id SET DEFAULT nextval('public.trails_id_seq'::regclass);


--
-- Name: ways ways_pkey; Type: CONSTRAINT; Schema: osm_boulder; Owner: -
--

ALTER TABLE ONLY osm_boulder.ways
    ADD CONSTRAINT ways_pkey PRIMARY KEY (osm_id);


--
-- Name: elevation_points elevation_points_lat_lng_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.elevation_points
    ADD CONSTRAINT elevation_points_lat_lng_key UNIQUE (lat, lng);


--
-- Name: elevation_points elevation_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.elevation_points
    ADD CONSTRAINT elevation_points_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: regions regions_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_id_unique UNIQUE (id);


--
-- Name: regions regions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (id);


--
-- Name: regions regions_region_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_region_key_key UNIQUE (region_key);


--
-- Name: route_recommendations route_recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_recommendations
    ADD CONSTRAINT route_recommendations_pkey PRIMARY KEY (id);


--
-- Name: routing_edges_vertices_pgr routing_edges_vertices_pgr_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_edges_vertices_pgr
    ADD CONSTRAINT routing_edges_vertices_pgr_pkey PRIMARY KEY (id);


--
-- Name: schema_version schema_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_version
    ADD CONSTRAINT schema_version_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_osm_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trails
    ADD CONSTRAINT trails_osm_id_unique UNIQUE (osm_id);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: trails uk_trails_app_uuid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trails
    ADD CONSTRAINT uk_trails_app_uuid UNIQUE (app_uuid);


--
-- Name: trails uk_trails_osm_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trails
    ADD CONSTRAINT uk_trails_osm_id UNIQUE (osm_id);


--
-- Name: idx_elevation_points_elevation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_elevation_points_elevation ON public.elevation_points USING btree (elevation);


--
-- Name: idx_elevation_points_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_elevation_points_location ON public.elevation_points USING btree (lat, lng);


--
-- Name: idx_elevation_points_spatial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_elevation_points_spatial ON public.elevation_points USING gist (public.st_setsrid(public.st_point((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_intersection_points_node_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_intersection_points_node_type ON public.intersection_points USING btree (node_type);


--
-- Name: idx_intersection_points_point; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_intersection_points_point ON public.intersection_points USING gist (point);


--
-- Name: idx_intersection_points_point_3d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_intersection_points_point_3d ON public.intersection_points USING gist (point_3d);


--
-- Name: idx_regions_bbox; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_regions_bbox ON public.regions USING gist (public.st_makeenvelope((bbox_min_lng)::double precision, (bbox_min_lat)::double precision, (bbox_max_lng)::double precision, (bbox_max_lat)::double precision));


--
-- Name: idx_regions_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_regions_key ON public.regions USING btree (region_key);


--
-- Name: idx_routing_edges_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routing_edges_geom ON public.routing_edges USING gist (geom);


--
-- Name: idx_routing_nodes_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routing_nodes_geom ON public.routing_nodes USING gist (the_geom);


--
-- Name: idx_split_trails_app_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_split_trails_app_uuid ON public.split_trails USING btree (app_uuid);


--
-- Name: idx_split_trails_bbox; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_split_trails_bbox ON public.split_trails USING gist (public.st_makeenvelope((bbox_min_lng)::double precision, (bbox_min_lat)::double precision, (bbox_max_lng)::double precision, (bbox_max_lat)::double precision));


--
-- Name: idx_split_trails_geometry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_split_trails_geometry ON public.split_trails USING gist (geometry);


--
-- Name: idx_split_trails_original_trail_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_split_trails_original_trail_id ON public.split_trails USING btree (original_trail_id);


--
-- Name: idx_split_trails_segment_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_split_trails_segment_number ON public.split_trails USING btree (segment_number);


--
-- Name: idx_trail_hashes_app_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trail_hashes_app_uuid ON public.trail_hashes USING btree (app_uuid);


--
-- Name: idx_trail_hashes_geometry_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trail_hashes_geometry_hash ON public.trail_hashes USING btree (geometry_hash);


--
-- Name: idx_trails_3d_geometry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_3d_geometry ON public.trails USING gist (geometry) WHERE (public.st_ndims(geometry) = 3);


--
-- Name: idx_trails_app_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_app_uuid ON public.trails USING btree (app_uuid);


--
-- Name: idx_trails_bbox; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_bbox ON public.trails USING gist (public.st_makeenvelope((bbox_min_lng)::double precision, (bbox_min_lat)::double precision, (bbox_max_lng)::double precision, (bbox_max_lat)::double precision));


--
-- Name: idx_trails_bbox_coords; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_bbox_coords ON public.trails USING btree (bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);


--
-- Name: idx_trails_bbox_spatial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_bbox_spatial ON public.trails USING gist (public.st_envelope(geometry));


--
-- Name: idx_trails_bbox_validation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_bbox_validation ON public.trails USING btree (bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat) WHERE (bbox_min_lng IS NOT NULL);


--
-- Name: idx_trails_completeness_check; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_completeness_check ON public.trails USING btree (elevation_gain, max_elevation, min_elevation, avg_elevation) WHERE (elevation_gain IS NOT NULL);


--
-- Name: idx_trails_elevation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_elevation ON public.trails USING btree (elevation_gain);


--
-- Name: idx_trails_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_geom ON public.trails USING gist (geometry);


--
-- Name: idx_trails_geom_spatial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_geom_spatial ON public.trails USING gist (geometry);


--
-- Name: idx_trails_geometry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_geometry ON public.trails USING gist (geometry);


--
-- Name: idx_trails_geometry_gist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_geometry_gist ON public.trails USING gist (geometry);


--
-- Name: idx_trails_osm_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_osm_id ON public.trails USING btree (osm_id);


--
-- Name: idx_trails_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region ON public.trails USING btree (region);


--
-- Name: idx_trails_region_bbox; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region_bbox ON public.trails USING btree (region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);


--
-- Name: idx_trails_region_elevation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region_elevation ON public.trails USING btree (region, elevation_gain);


--
-- Name: idx_trails_surface; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_surface ON public.trails USING btree (surface);


--
-- Name: idx_trails_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_type ON public.trails USING btree (trail_type);


--
-- Name: routing_edges_geom_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX routing_edges_geom_idx ON public.routing_edges USING gist (geom);


--
-- Name: routing_edges_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX routing_edges_id_idx ON public.routing_edges USING btree (id);


--
-- Name: routing_edges_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX routing_edges_source_idx ON public.routing_edges USING btree (source);


--
-- Name: routing_edges_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX routing_edges_target_idx ON public.routing_edges USING btree (target);


--
-- Name: routing_edges_vertices_pgr_the_geom_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX routing_edges_vertices_pgr_the_geom_idx ON public.routing_edges_vertices_pgr USING gist (the_geom);


--
-- Name: trails trigger_auto_calculate_bbox; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_auto_calculate_bbox BEFORE INSERT OR UPDATE ON public.trails FOR EACH ROW EXECUTE FUNCTION public.auto_calculate_bbox();


--
-- Name: trails trigger_auto_calculate_length; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_auto_calculate_length BEFORE INSERT OR UPDATE ON public.trails FOR EACH ROW EXECUTE FUNCTION public.auto_calculate_length();


--
-- Name: trails trigger_validate_trail_completeness; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_validate_trail_completeness BEFORE INSERT OR UPDATE ON public.trails FOR EACH ROW EXECUTE FUNCTION public.validate_trail_completeness();


--
-- Name: trails update_trails_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_trails_updated_at BEFORE UPDATE ON public.trails FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: split_trails fk_split_trails_original_trail; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.split_trails
    ADD CONSTRAINT fk_split_trails_original_trail FOREIGN KEY (original_trail_id) REFERENCES public.trails(id) ON DELETE CASCADE;


--
-- Name: trails fk_trails_region; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trails
    ADD CONSTRAINT fk_trails_region FOREIGN KEY (region) REFERENCES public.regions(region_key);


--
-- PostgreSQL database dump complete
--

