--
-- PostgreSQL database dump
--

-- Dumped from database version 14.18 (Homebrew)
-- Dumped by pg_dump version 14.18 (Homebrew)

-- Started on 2025-07-29 15:26:57 MDT

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
-- TOC entry 9 (class 2615 OID 164706)
-- Name: osm_boulder; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA osm_boulder;


--
-- TOC entry 11 (class 2615 OID 7962843)
-- Name: staging_boulder_1753750759428; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1753750759428;


--
-- TOC entry 13 (class 2615 OID 7966668)
-- Name: staging_boulder_1753750866110; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1753750866110;


--
-- TOC entry 15 (class 2615 OID 7971354)
-- Name: staging_boulder_1753750899097; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1753750899097;


--
-- TOC entry 16 (class 2615 OID 7977976)
-- Name: staging_boulder_1753751096706; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1753751096706;


--
-- TOC entry 7 (class 2615 OID 7980884)
-- Name: staging_boulder_1753751126664; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1753751126664;


--
-- TOC entry 10 (class 2615 OID 7983921)
-- Name: staging_boulder_1753751363911; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1753751363911;


--
-- TOC entry 12 (class 2615 OID 7986841)
-- Name: staging_boulder_1753751589033; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1753751589033;


--
-- TOC entry 14 (class 2615 OID 7992942)
-- Name: staging_boulder_1753752594710; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1753752594710;


--
-- TOC entry 3 (class 3079 OID 16393)
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- TOC entry 6391 (class 0 OID 0)
-- Dependencies: 3
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- TOC entry 4 (class 3079 OID 7953632)
-- Name: pgrouting; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgrouting WITH SCHEMA public;


--
-- TOC entry 6392 (class 0 OID 0)
-- Dependencies: 4
-- Name: EXTENSION pgrouting; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgrouting IS 'pgRouting Extension';


--
-- TOC entry 2 (class 3079 OID 22006)
-- Name: postgis_raster; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_raster WITH SCHEMA public;


--
-- TOC entry 6393 (class 0 OID 0)
-- Dependencies: 2
-- Name: EXTENSION postgis_raster; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis_raster IS 'PostGIS raster types and functions';


--
-- TOC entry 1660 (class 1255 OID 4984364)
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
-- TOC entry 6394 (class 0 OID 0)
-- Dependencies: 1660
-- Name: FUNCTION auto_calculate_bbox(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.auto_calculate_bbox() IS 'Automatically calculates bounding box from geometry';


--
-- TOC entry 1661 (class 1255 OID 4984366)
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
-- TOC entry 6395 (class 0 OID 0)
-- Dependencies: 1661
-- Name: FUNCTION auto_calculate_length(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.auto_calculate_length() IS 'Automatically calculates trail length from geometry';


--
-- TOC entry 1657 (class 1255 OID 4984346)
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
-- TOC entry 1663 (class 1255 OID 4984391)
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
-- TOC entry 6396 (class 0 OID 0)
-- Dependencies: 1663
-- Name: FUNCTION check_database_integrity(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.check_database_integrity() IS 'Comprehensive database integrity check';


--
-- TOC entry 1969 (class 1255 OID 9819345)
-- Name: copy_and_split_trails_to_staging_native(text, text, text, real, real, real, real, integer, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.copy_and_split_trails_to_staging_native(staging_schema text, source_table text, region_filter text, bbox_min_lng real DEFAULT NULL::real, bbox_min_lat real DEFAULT NULL::real, bbox_max_lng real DEFAULT NULL::real, bbox_max_lat real DEFAULT NULL::real, trail_limit integer DEFAULT NULL::integer, tolerance_meters real DEFAULT 2.0) RETURNS TABLE(original_count integer, split_count integer, intersection_count integer, success boolean, message text)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    original_count_var integer := 0;
    split_count_var integer := 0;
    intersection_count_var integer := 0;
    source_query text;
    limit_clause text := '';
BEGIN
    -- Clear existing data
    EXECUTE format('DELETE FROM %I.trails', staging_schema);
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);
    
    -- Build source query with filters
    source_query := format('SELECT * FROM %I WHERE region = %L', source_table, region_filter);
    
    -- Add bbox filter if provided
    IF bbox_min_lng IS NOT NULL AND bbox_min_lat IS NOT NULL AND bbox_max_lng IS NOT NULL AND bbox_max_lat IS NOT NULL THEN
        source_query := source_query || format(' AND ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))', bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat);
    END IF;
    
    -- Add limit
    IF trail_limit IS NOT NULL THEN
        limit_clause := format(' LIMIT %s', trail_limit);
    END IF;
    
    -- Add limit
    source_query := source_query || limit_clause;
    
    -- Step 1: Copy and split trails using native PostGIS ST_Split
    EXECUTE format($f$
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source, 
            geometry, created_at, updated_at
        )
        WITH trail_intersections AS (
            -- Find all intersection points between trails using 3D coordinates
            SELECT DISTINCT
                t1.app_uuid as trail1_uuid,
                t2.app_uuid as trail2_uuid,
                ST_Intersection(t1.geometry, t2.geometry) as intersection_point
            FROM (%s) t1
            JOIN (%s) t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ),
        all_trails AS (
            -- Get all source trails
            SELECT * FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        ),
        trails_with_intersections AS (
            -- Get trails that have intersections
            SELECT 
                at.*,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).geom as split_geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).path[1] as segment_order
            FROM all_trails at
            JOIN trail_intersections ti ON at.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
        ),
        trails_without_intersections AS (
            -- Get trails that don't have intersections (keep original)
            SELECT 
                at.*,
                at.geometry as split_geometry,
                1 as segment_order
            FROM all_trails at
            WHERE at.app_uuid NOT IN (
                SELECT DISTINCT trail1_uuid FROM trail_intersections
                UNION
                SELECT DISTINCT trail2_uuid FROM trail_intersections
            )
        ),
        processed_trails AS (
            -- Combine both sets
            SELECT * FROM trails_with_intersections
            UNION ALL
            SELECT * FROM trails_without_intersections
        )
        SELECT 
            gen_random_uuid() as app_uuid,  -- Generate new UUID for all segments
            osm_id,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            source_tags,
            ST_XMin(split_geometry) as bbox_min_lng,
            ST_XMax(split_geometry) as bbox_max_lng,
            ST_YMin(split_geometry) as bbox_min_lat,
            ST_YMax(split_geometry) as bbox_max_lat,
            ST_Length(split_geometry::geography) / 1000.0 as length_km,
            -- Keep original elevation data
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            split_geometry as geometry,
            NOW() as created_at,
            NOW() as updated_at
        FROM processed_trails pt
        WHERE ST_IsValid(pt.split_geometry)  -- Only include valid geometries
          AND pt.app_uuid IS NOT NULL    -- Ensure app_uuid is not null
    $f$, staging_schema, source_query, source_query, source_query);
    
    GET DIAGNOSTICS split_count_var = ROW_COUNT;
    
    -- Get original count from source query
    EXECUTE format('SELECT COUNT(*) FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)', source_query) INTO original_count_var;
    
    -- Step 2: Detect intersections between split trail segments
    PERFORM detect_trail_intersections(staging_schema, tolerance_meters);
    
    -- Get intersection count
    EXECUTE format('SELECT COUNT(*) FROM %I.intersection_points', staging_schema) INTO intersection_count_var;
    
    -- Clear routing data in staging schema since it needs to be regenerated from split trails
    -- This ensures all UUID references are consistent after splitting
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Create optimized spatial indexes
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geometry ON %I.trails USING GIST(geometry)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON %I.trails(app_uuid)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_name ON %I.trails(name)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_intersection_points ON %I.intersection_points USING GIST(point)', staging_schema);
    
    -- Return results
    RETURN QUERY SELECT 
        original_count_var,
        split_count_var,
        intersection_count_var,
        true as success,
        format('Successfully copied and split %s trails into %s segments with %s intersections', 
               original_count_var, split_count_var, intersection_count_var) as message;
    
    RAISE NOTICE 'Native PostgreSQL copy and split: % original trails -> % split segments with % intersections', 
        original_count_var, split_count_var, intersection_count_var;
        
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, 0, 0, false, 
        format('Error during copy and split: %s', SQLERRM) as message;
    
    RAISE NOTICE 'Error during native PostgreSQL copy and split: %', SQLERRM;
END;
$_$;


--
-- TOC entry 1970 (class 1255 OID 9819347)
-- Name: detect_trail_intersections(text, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_trail_intersections(staging_schema text, tolerance_meters real DEFAULT 1.0) RETURNS void
    LANGUAGE plpgsql
    AS $_$
DECLARE
    intersection_count integer := 0;
BEGIN
    -- Clear existing intersection points
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);
    
    -- Detect intersections between trails
    EXECUTE format($f$
        INSERT INTO %I.intersection_points (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT DISTINCT
            intersection_point as point,
            ST_Force3D(intersection_point) as point_3d,
            ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
            ARRAY[t1.name, t2.name] as connected_trail_names,
            'intersection' as node_type,
            $1 as distance_meters
        FROM (
            SELECT 
                (ST_Dump(ST_Intersection(t1.geometry, t2.geometry))).geom as intersection_point,
                t1.app_uuid as t1_uuid,
                t2.app_uuid as t2_uuid
            FROM %I.trails t1
            JOIN %I.trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5  -- Reduced from 10 to 5 meters
              AND ST_Length(t2.geometry::geography) > 5  -- Reduced from 10 to 5 meters
        ) intersections
        JOIN %I.trails t1 ON t1.app_uuid = intersections.t1_uuid
        JOIN %I.trails t2 ON t2.app_uuid = intersections.t2_uuid
        WHERE ST_Length(intersection_point::geography) = 0  -- Point intersections only
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_meters;
    
    GET DIAGNOSTICS intersection_count = ROW_COUNT;
    RAISE NOTICE 'Detected % intersection points', intersection_count;
END;
$_$;


--
-- TOC entry 1812 (class 1255 OID 9819343)
-- Name: generate_app_uuid(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_app_uuid() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN IF NEW.app_uuid IS NULL OR NEW.app_uuid = '' THEN NEW.app_uuid := gen_random_uuid(); END IF; RETURN NEW; END; $$;


--
-- TOC entry 1972 (class 1255 OID 9819349)
-- Name: generate_routing_edges_native(text, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_routing_edges_native(staging_schema text, tolerance_meters real DEFAULT 1.0) RETURNS TABLE(edge_count integer, success boolean, message text)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    edge_count_var integer := 0;
    node_count_var integer := 0;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Get node count for validation
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count_var;
    
    -- Generate routing edges from trail segments
    -- Use exact point matching instead of ST_DWithin with LIMIT 1
    EXECUTE format($f$
        INSERT INTO %I.routing_edges (source, target, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geometry, geojson)
        WITH elevation_calculated AS (
            -- Calculate elevation data from geometry using PostGIS function
            -- If existing elevation data is NULL, calculate from geometry
            -- If calculation fails, preserve NULL (don''t default to 0)
            SELECT 
                t.*,
                CASE 
                    WHEN t.elevation_gain IS NOT NULL THEN t.elevation_gain
                    ELSE (SELECT elevation_gain FROM recalculate_elevation_data(ST_Force3D(t.geometry)))
                END as calculated_elevation_gain,
                CASE 
                    WHEN t.elevation_loss IS NOT NULL THEN t.elevation_loss
                    ELSE (SELECT elevation_loss FROM recalculate_elevation_data(ST_Force3D(t.geometry)))
                END as calculated_elevation_loss
            FROM %I.trails t
            WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry) AND t.length_km > 0
        )
        SELECT 
            source_node.id as source,
            target_node.id as target,
            ec.app_uuid as trail_id,
            ec.name as trail_name,
            ec.length_km as distance_km,
            -- Preserve NULL elevation values - don''t default to 0
            ec.calculated_elevation_gain as elevation_gain,
            ec.calculated_elevation_loss as elevation_loss,
            ec.geometry,
            ST_AsGeoJSON(ec.geometry, 6, 0) as geojson
        FROM elevation_calculated ec
        CROSS JOIN LATERAL (
            SELECT id FROM %I.routing_nodes 
            WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_StartPoint(ec.geometry), $1)
            ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_StartPoint(ec.geometry))
            LIMIT 1
        ) source_node
        CROSS JOIN LATERAL (
            SELECT id FROM %I.routing_nodes 
            WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_EndPoint(ec.geometry), $1)
            ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_EndPoint(ec.geometry))
            LIMIT 1
        ) target_node
        WHERE source_node.id IS NOT NULL
          AND target_node.id IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_meters;
    
    GET DIAGNOSTICS edge_count_var = ROW_COUNT;
    
    -- Return results
    RETURN QUERY SELECT 
        edge_count_var,
        true as success,
        format('Successfully generated %s routing edges from %s nodes', edge_count_var, node_count_var) as message;
    
    RAISE NOTICE 'Generated % routing edges from % nodes', edge_count_var, node_count_var;
        
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing edges generation: %s', SQLERRM) as message;
    
    RAISE NOTICE 'Error during routing edges generation: %', SQLERRM;
END;
$_$;


--
-- TOC entry 1974 (class 1255 OID 7953994)
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
-- TOC entry 1971 (class 1255 OID 9819348)
-- Name: generate_routing_nodes_native(text, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_routing_nodes_native(staging_schema text, tolerance_meters real DEFAULT 1.0) RETURNS TABLE(node_count integer, success boolean, message text)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    node_count_var integer := 0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Generate routing nodes from trail start and end points
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails)
        SELECT DISTINCT
            gen_random_uuid() as node_uuid,
            ST_Y(point) as lat,
            ST_X(point) as lng,
            ST_Z(point) as elevation,
            'trail_endpoint' as node_type,
            'trail_endpoint' as connected_trails
        FROM (
            -- Start points of all trails
            SELECT ST_StartPoint(geometry) as point FROM %I.trails WHERE geometry IS NOT NULL
            UNION
            -- End points of all trails
            SELECT ST_EndPoint(geometry) as point FROM %I.trails WHERE geometry IS NOT NULL
        ) trail_points
        WHERE point IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema);
    
    GET DIAGNOSTICS node_count_var = ROW_COUNT;
    
    -- Return results
    RETURN QUERY SELECT 
        node_count_var,
        true as success,
        format('Successfully generated %s routing nodes from trail endpoints', node_count_var) as message;
    
    RAISE NOTICE 'Generated % routing nodes from trail endpoints', node_count_var;
        
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing nodes generation: %s', SQLERRM) as message;
    
    RAISE NOTICE 'Error during routing nodes generation: %', SQLERRM;
END;
$_$;


--
-- TOC entry 1968 (class 1255 OID 9819344)
-- Name: recalculate_elevation_data(public.geometry); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalculate_elevation_data(trail_geometry public.geometry) RETURNS TABLE(elevation_gain double precision, elevation_loss double precision, max_elevation double precision, min_elevation double precision, avg_elevation double precision)
    LANGUAGE plpgsql
    AS $$
DECLARE
    points record;
    prev_elevation double precision := NULL;
    current_elevation double precision;
    total_gain double precision := 0;
    total_loss double precision := 0;
    max_elev double precision := -9999;
    min_elev double precision := 9999;
    total_elev double precision := 0;
    point_count integer := 0;
BEGIN
    -- Extract all points from the geometry
    FOR points IN 
        SELECT (ST_DumpPoints(trail_geometry)).geom as point
    LOOP
        -- Get elevation from the point (Z coordinate)
        current_elevation := ST_Z(points.point);
        
        -- Skip if no elevation data
        IF current_elevation IS NULL THEN
            CONTINUE;
        END IF;
        
        -- Update min/max elevation
        IF current_elevation > max_elev THEN
            max_elev := current_elevation;
        END IF;
        IF current_elevation < min_elev THEN
            min_elev := current_elevation;
        END IF;
        
        -- Calculate gain/loss
        IF prev_elevation IS NOT NULL THEN
            IF current_elevation > prev_elevation THEN
                total_gain := total_gain + (current_elevation - prev_elevation);
            ELSIF current_elevation < prev_elevation THEN
                total_loss := total_loss + (prev_elevation - current_elevation);
            END IF;
        END IF;
        
        -- Update running totals
        total_elev := total_elev + current_elevation;
        point_count := point_count + 1;
        prev_elevation := current_elevation;
    END LOOP;
    
    -- Return calculated elevation data
    RETURN QUERY SELECT 
        total_gain,
        total_loss,
        CASE WHEN max_elev = -9999 THEN NULL ELSE max_elev END,
        CASE WHEN min_elev = 9999 THEN NULL ELSE min_elev END,
        CASE WHEN point_count = 0 THEN NULL ELSE total_elev / point_count END;
END;
$$;


--
-- TOC entry 1967 (class 1255 OID 7953995)
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
-- TOC entry 1656 (class 1255 OID 4984344)
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
-- TOC entry 1973 (class 1255 OID 9819350)
-- Name: validate_intersection_detection(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_intersection_detection(staging_schema text) RETURNS TABLE(total_intersections integer, total_nodes integer, total_edges integer, avg_connections real, has_intersections boolean)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE format($f$
        SELECT 
            (SELECT COUNT(*)::integer FROM %I.intersection_points) as total_intersections,
            (SELECT COUNT(*)::integer FROM %I.routing_nodes) as total_nodes,
            (SELECT COUNT(*)::integer FROM %I.routing_edges) as total_edges,
            (SELECT AVG(array_length(connected_trail_ids, 1))::real FROM %I.intersection_points),
            (SELECT EXISTS (SELECT 1 FROM %I.intersection_points LIMIT 1))
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema);
END;
$_$;


--
-- TOC entry 1662 (class 1255 OID 4984368)
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
-- TOC entry 1652 (class 1255 OID 4984144)
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
-- TOC entry 1667 (class 1255 OID 4984362)
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
-- TOC entry 6397 (class 0 OID 0)
-- Dependencies: 1667
-- Name: FUNCTION validate_trail_completeness(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.validate_trail_completeness() IS 'Ensures complete trails have all required elevation and geometry data';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 248 (class 1259 OID 164707)
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
-- TOC entry 233 (class 1259 OID 17503)
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
-- TOC entry 6398 (class 0 OID 0)
-- Dependencies: 233
-- Name: TABLE elevation_points; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.elevation_points IS 'Elevation data points from TIFF files';


--
-- TOC entry 232 (class 1259 OID 17502)
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
-- TOC entry 6399 (class 0 OID 0)
-- Dependencies: 232
-- Name: elevation_points_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.elevation_points_id_seq OWNED BY public.elevation_points.id;


--
-- TOC entry 231 (class 1259 OID 17489)
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
-- TOC entry 6400 (class 0 OID 0)
-- Dependencies: 231
-- Name: TABLE trails; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.trails IS 'Master trails table with 3D geometry and elevation data';


--
-- TOC entry 6401 (class 0 OID 0)
-- Dependencies: 231
-- Name: COLUMN trails.elevation_gain; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trails.elevation_gain IS 'Total elevation gain in meters (must be >= 0)';


--
-- TOC entry 6402 (class 0 OID 0)
-- Dependencies: 231
-- Name: COLUMN trails.length_km; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trails.length_km IS 'Trail length in kilometers (must be > 0)';


--
-- TOC entry 6403 (class 0 OID 0)
-- Dependencies: 231
-- Name: COLUMN trails.elevation_loss; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trails.elevation_loss IS 'Total elevation loss in meters (must be >= 0)';


--
-- TOC entry 6404 (class 0 OID 0)
-- Dependencies: 231
-- Name: COLUMN trails.geometry; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trails.geometry IS '3D LineString geometry with elevation data (SRID: 4326)';


--
-- TOC entry 249 (class 1259 OID 4984373)
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
-- TOC entry 252 (class 1259 OID 4984386)
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
-- TOC entry 256 (class 1259 OID 7824669)
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
-- TOC entry 6405 (class 0 OID 0)
-- Dependencies: 256
-- Name: TABLE intersection_points; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.intersection_points IS 'Stores intersection points between trails for routing and analysis';


--
-- TOC entry 6406 (class 0 OID 0)
-- Dependencies: 256
-- Name: COLUMN intersection_points.connected_trail_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.intersection_points.connected_trail_ids IS 'Array of trail IDs that connect at this intersection';


--
-- TOC entry 6407 (class 0 OID 0)
-- Dependencies: 256
-- Name: COLUMN intersection_points.connected_trail_names; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.intersection_points.connected_trail_names IS 'Array of trail names that connect at this intersection';


--
-- TOC entry 255 (class 1259 OID 7824668)
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
-- TOC entry 6408 (class 0 OID 0)
-- Dependencies: 255
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.intersection_points_id_seq OWNED BY public.intersection_points.id;


--
-- TOC entry 251 (class 1259 OID 4984382)
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
-- TOC entry 237 (class 1259 OID 17677)
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
-- TOC entry 236 (class 1259 OID 17676)
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
-- TOC entry 6409 (class 0 OID 0)
-- Dependencies: 236
-- Name: regions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.regions_id_seq OWNED BY public.regions.id;


--
-- TOC entry 235 (class 1259 OID 17551)
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
-- TOC entry 6410 (class 0 OID 0)
-- Dependencies: 235
-- Name: TABLE route_recommendations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.route_recommendations IS 'GPX-based route recommendations';


--
-- TOC entry 234 (class 1259 OID 17550)
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
-- TOC entry 6411 (class 0 OID 0)
-- Dependencies: 234
-- Name: route_recommendations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.route_recommendations_id_seq OWNED BY public.route_recommendations.id;


--
-- TOC entry 357 (class 1259 OID 7995936)
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
-- TOC entry 260 (class 1259 OID 7954010)
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
-- TOC entry 259 (class 1259 OID 7954009)
-- Name: routing_edges_vertices_pgr_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.routing_edges_vertices_pgr_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6412 (class 0 OID 0)
-- Dependencies: 259
-- Name: routing_edges_vertices_pgr_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.routing_edges_vertices_pgr_id_seq OWNED BY public.routing_edges_vertices_pgr.id;


--
-- TOC entry 358 (class 1259 OID 7995959)
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
-- TOC entry 229 (class 1259 OID 17480)
-- Name: schema_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_version (
    id integer NOT NULL,
    version integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- TOC entry 228 (class 1259 OID 17479)
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
-- TOC entry 6413 (class 0 OID 0)
-- Dependencies: 228
-- Name: schema_version_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.schema_version_id_seq OWNED BY public.schema_version.id;


--
-- TOC entry 254 (class 1259 OID 7824656)
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
-- TOC entry 6414 (class 0 OID 0)
-- Dependencies: 254
-- Name: TABLE split_trails; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.split_trails IS 'Stores individual trail segments created by splitting trails at intersections';


--
-- TOC entry 6415 (class 0 OID 0)
-- Dependencies: 254
-- Name: COLUMN split_trails.original_trail_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.split_trails.original_trail_id IS 'Reference to the original unsplit trail';


--
-- TOC entry 6416 (class 0 OID 0)
-- Dependencies: 254
-- Name: COLUMN split_trails.segment_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.split_trails.segment_number IS 'Sequential segment number (1, 2, 3...) within the original trail';


--
-- TOC entry 253 (class 1259 OID 7824655)
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
-- TOC entry 6417 (class 0 OID 0)
-- Dependencies: 253
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.split_trails_id_seq OWNED BY public.split_trails.id;


--
-- TOC entry 258 (class 1259 OID 7824679)
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
-- TOC entry 6418 (class 0 OID 0)
-- Dependencies: 258
-- Name: TABLE trail_hashes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.trail_hashes IS 'Cache table for trail geometry hashes to avoid duplicate processing';


--
-- TOC entry 6419 (class 0 OID 0)
-- Dependencies: 258
-- Name: COLUMN trail_hashes.geometry_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trail_hashes.geometry_hash IS 'Hash of trail geometry for duplicate detection';


--
-- TOC entry 257 (class 1259 OID 7824678)
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
-- TOC entry 6420 (class 0 OID 0)
-- Dependencies: 257
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trail_hashes_id_seq OWNED BY public.trail_hashes.id;


--
-- TOC entry 230 (class 1259 OID 17488)
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
-- TOC entry 6421 (class 0 OID 0)
-- Dependencies: 230
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trails_id_seq OWNED BY public.trails.id;


--
-- TOC entry 250 (class 1259 OID 4984378)
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
-- TOC entry 266 (class 1259 OID 7962870)
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE TABLE staging_boulder_1753750759428.intersection_points (
    id integer NOT NULL,
    point public.geometry(Point,4326),
    point_3d public.geometry(PointZ,4326),
    connected_trail_ids text[],
    connected_trail_names text[],
    node_type text,
    distance_meters real,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 265 (class 1259 OID 7962869)
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750759428.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6422 (class 0 OID 0)
-- Dependencies: 265
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750759428.intersection_points_id_seq OWNED BY staging_boulder_1753750759428.intersection_points.id;


--
-- TOC entry 272 (class 1259 OID 7962905)
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE TABLE staging_boulder_1753750759428.routing_edges (
    id integer NOT NULL,
    from_node_id integer NOT NULL,
    to_node_id integer NOT NULL,
    trail_id text NOT NULL,
    trail_name text NOT NULL,
    distance_km real NOT NULL,
    elevation_gain real DEFAULT 0 NOT NULL,
    elevation_loss real DEFAULT 0 NOT NULL,
    is_bidirectional boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geojson text
);


--
-- TOC entry 271 (class 1259 OID 7962904)
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750759428.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6423 (class 0 OID 0)
-- Dependencies: 271
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750759428.routing_edges_id_seq OWNED BY staging_boulder_1753750759428.routing_edges.id;


--
-- TOC entry 270 (class 1259 OID 7962893)
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE TABLE staging_boulder_1753750759428.routing_nodes (
    id integer NOT NULL,
    node_uuid text,
    lat real,
    lng real,
    elevation real,
    node_type text,
    connected_trails text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 269 (class 1259 OID 7962892)
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750759428.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6424 (class 0 OID 0)
-- Dependencies: 269
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750759428.routing_nodes_id_seq OWNED BY staging_boulder_1753750759428.routing_nodes.id;


--
-- TOC entry 268 (class 1259 OID 7962880)
-- Name: split_trails; Type: TABLE; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE TABLE staging_boulder_1753750759428.split_trails (
    id integer NOT NULL,
    original_trail_id integer,
    segment_number integer,
    app_uuid text NOT NULL,
    name text,
    trail_type text,
    surface text,
    difficulty text,
    source_tags text,
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
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 267 (class 1259 OID 7962879)
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750759428.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6425 (class 0 OID 0)
-- Dependencies: 267
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750759428.split_trails_id_seq OWNED BY staging_boulder_1753750759428.split_trails.id;


--
-- TOC entry 264 (class 1259 OID 7962860)
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE TABLE staging_boulder_1753750759428.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 263 (class 1259 OID 7962859)
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750759428.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6426 (class 0 OID 0)
-- Dependencies: 263
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750759428.trail_hashes_id_seq OWNED BY staging_boulder_1753750759428.trail_hashes.id;


--
-- TOC entry 262 (class 1259 OID 7962845)
-- Name: trails; Type: TABLE; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE TABLE staging_boulder_1753750759428.trails (
    id integer NOT NULL,
    app_uuid text NOT NULL,
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
    elevation_gain real DEFAULT 0,
    elevation_loss real DEFAULT 0,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    source text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geometry_text text,
    geometry_hash text NOT NULL
);


--
-- TOC entry 261 (class 1259 OID 7962844)
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750759428.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6427 (class 0 OID 0)
-- Dependencies: 261
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750759428.trails_id_seq OWNED BY staging_boulder_1753750759428.trails.id;


--
-- TOC entry 278 (class 1259 OID 7966695)
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE TABLE staging_boulder_1753750866110.intersection_points (
    id integer NOT NULL,
    point public.geometry(Point,4326),
    point_3d public.geometry(PointZ,4326),
    connected_trail_ids text[],
    connected_trail_names text[],
    node_type text,
    distance_meters real,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 277 (class 1259 OID 7966694)
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750866110.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6428 (class 0 OID 0)
-- Dependencies: 277
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750866110.intersection_points_id_seq OWNED BY staging_boulder_1753750866110.intersection_points.id;


--
-- TOC entry 284 (class 1259 OID 7966730)
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE TABLE staging_boulder_1753750866110.routing_edges (
    id integer NOT NULL,
    from_node_id integer NOT NULL,
    to_node_id integer NOT NULL,
    trail_id text NOT NULL,
    trail_name text NOT NULL,
    distance_km real NOT NULL,
    elevation_gain real DEFAULT 0 NOT NULL,
    elevation_loss real DEFAULT 0 NOT NULL,
    is_bidirectional boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geojson text
);


--
-- TOC entry 283 (class 1259 OID 7966729)
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750866110.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6429 (class 0 OID 0)
-- Dependencies: 283
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750866110.routing_edges_id_seq OWNED BY staging_boulder_1753750866110.routing_edges.id;


--
-- TOC entry 282 (class 1259 OID 7966718)
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE TABLE staging_boulder_1753750866110.routing_nodes (
    id integer NOT NULL,
    node_uuid text,
    lat real,
    lng real,
    elevation real,
    node_type text,
    connected_trails text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 281 (class 1259 OID 7966717)
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750866110.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6430 (class 0 OID 0)
-- Dependencies: 281
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750866110.routing_nodes_id_seq OWNED BY staging_boulder_1753750866110.routing_nodes.id;


--
-- TOC entry 280 (class 1259 OID 7966705)
-- Name: split_trails; Type: TABLE; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE TABLE staging_boulder_1753750866110.split_trails (
    id integer NOT NULL,
    original_trail_id integer,
    segment_number integer,
    app_uuid text NOT NULL,
    name text,
    trail_type text,
    surface text,
    difficulty text,
    source_tags text,
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
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 279 (class 1259 OID 7966704)
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750866110.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6431 (class 0 OID 0)
-- Dependencies: 279
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750866110.split_trails_id_seq OWNED BY staging_boulder_1753750866110.split_trails.id;


--
-- TOC entry 276 (class 1259 OID 7966685)
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE TABLE staging_boulder_1753750866110.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 275 (class 1259 OID 7966684)
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750866110.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6432 (class 0 OID 0)
-- Dependencies: 275
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750866110.trail_hashes_id_seq OWNED BY staging_boulder_1753750866110.trail_hashes.id;


--
-- TOC entry 274 (class 1259 OID 7966670)
-- Name: trails; Type: TABLE; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE TABLE staging_boulder_1753750866110.trails (
    id integer NOT NULL,
    app_uuid text NOT NULL,
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
    elevation_gain real DEFAULT 0,
    elevation_loss real DEFAULT 0,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    source text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geometry_text text,
    geometry_hash text NOT NULL
);


--
-- TOC entry 273 (class 1259 OID 7966669)
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750866110.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6433 (class 0 OID 0)
-- Dependencies: 273
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750866110.trails_id_seq OWNED BY staging_boulder_1753750866110.trails.id;


--
-- TOC entry 290 (class 1259 OID 7971381)
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE TABLE staging_boulder_1753750899097.intersection_points (
    id integer NOT NULL,
    point public.geometry(Point,4326),
    point_3d public.geometry(PointZ,4326),
    connected_trail_ids text[],
    connected_trail_names text[],
    node_type text,
    distance_meters real,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 289 (class 1259 OID 7971380)
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750899097.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6434 (class 0 OID 0)
-- Dependencies: 289
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750899097.intersection_points_id_seq OWNED BY staging_boulder_1753750899097.intersection_points.id;


--
-- TOC entry 296 (class 1259 OID 7971416)
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE TABLE staging_boulder_1753750899097.routing_edges (
    id integer NOT NULL,
    from_node_id integer NOT NULL,
    to_node_id integer NOT NULL,
    trail_id text NOT NULL,
    trail_name text NOT NULL,
    distance_km real NOT NULL,
    elevation_gain real DEFAULT 0 NOT NULL,
    elevation_loss real DEFAULT 0 NOT NULL,
    is_bidirectional boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geojson text
);


--
-- TOC entry 295 (class 1259 OID 7971415)
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750899097.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6435 (class 0 OID 0)
-- Dependencies: 295
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750899097.routing_edges_id_seq OWNED BY staging_boulder_1753750899097.routing_edges.id;


--
-- TOC entry 294 (class 1259 OID 7971404)
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE TABLE staging_boulder_1753750899097.routing_nodes (
    id integer NOT NULL,
    node_uuid text,
    lat real,
    lng real,
    elevation real,
    node_type text,
    connected_trails text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 293 (class 1259 OID 7971403)
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750899097.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6436 (class 0 OID 0)
-- Dependencies: 293
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750899097.routing_nodes_id_seq OWNED BY staging_boulder_1753750899097.routing_nodes.id;


--
-- TOC entry 292 (class 1259 OID 7971391)
-- Name: split_trails; Type: TABLE; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE TABLE staging_boulder_1753750899097.split_trails (
    id integer NOT NULL,
    original_trail_id integer,
    segment_number integer,
    app_uuid text NOT NULL,
    name text,
    trail_type text,
    surface text,
    difficulty text,
    source_tags text,
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
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 291 (class 1259 OID 7971390)
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750899097.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6437 (class 0 OID 0)
-- Dependencies: 291
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750899097.split_trails_id_seq OWNED BY staging_boulder_1753750899097.split_trails.id;


--
-- TOC entry 288 (class 1259 OID 7971371)
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE TABLE staging_boulder_1753750899097.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 287 (class 1259 OID 7971370)
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750899097.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6438 (class 0 OID 0)
-- Dependencies: 287
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750899097.trail_hashes_id_seq OWNED BY staging_boulder_1753750899097.trail_hashes.id;


--
-- TOC entry 286 (class 1259 OID 7971356)
-- Name: trails; Type: TABLE; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE TABLE staging_boulder_1753750899097.trails (
    id integer NOT NULL,
    app_uuid text NOT NULL,
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
    elevation_gain real DEFAULT 0,
    elevation_loss real DEFAULT 0,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    source text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geometry_text text,
    geometry_hash text NOT NULL
);


--
-- TOC entry 285 (class 1259 OID 7971355)
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750899097.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6439 (class 0 OID 0)
-- Dependencies: 285
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750899097.trails_id_seq OWNED BY staging_boulder_1753750899097.trails.id;


--
-- TOC entry 302 (class 1259 OID 7978003)
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE TABLE staging_boulder_1753751096706.intersection_points (
    id integer NOT NULL,
    point public.geometry(Point,4326),
    point_3d public.geometry(PointZ,4326),
    connected_trail_ids text[],
    connected_trail_names text[],
    node_type text,
    distance_meters real,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 301 (class 1259 OID 7978002)
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751096706.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6440 (class 0 OID 0)
-- Dependencies: 301
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751096706.intersection_points_id_seq OWNED BY staging_boulder_1753751096706.intersection_points.id;


--
-- TOC entry 308 (class 1259 OID 7978038)
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE TABLE staging_boulder_1753751096706.routing_edges (
    id integer NOT NULL,
    from_node_id integer NOT NULL,
    to_node_id integer NOT NULL,
    trail_id text NOT NULL,
    trail_name text NOT NULL,
    distance_km real NOT NULL,
    elevation_gain real DEFAULT 0 NOT NULL,
    elevation_loss real DEFAULT 0 NOT NULL,
    is_bidirectional boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geojson text
);


--
-- TOC entry 307 (class 1259 OID 7978037)
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751096706.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6441 (class 0 OID 0)
-- Dependencies: 307
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751096706.routing_edges_id_seq OWNED BY staging_boulder_1753751096706.routing_edges.id;


--
-- TOC entry 306 (class 1259 OID 7978026)
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE TABLE staging_boulder_1753751096706.routing_nodes (
    id integer NOT NULL,
    node_uuid text,
    lat real,
    lng real,
    elevation real,
    node_type text,
    connected_trails text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 305 (class 1259 OID 7978025)
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751096706.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6442 (class 0 OID 0)
-- Dependencies: 305
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751096706.routing_nodes_id_seq OWNED BY staging_boulder_1753751096706.routing_nodes.id;


--
-- TOC entry 304 (class 1259 OID 7978013)
-- Name: split_trails; Type: TABLE; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE TABLE staging_boulder_1753751096706.split_trails (
    id integer NOT NULL,
    original_trail_id integer,
    segment_number integer,
    app_uuid text NOT NULL,
    name text,
    trail_type text,
    surface text,
    difficulty text,
    source_tags text,
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
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 303 (class 1259 OID 7978012)
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751096706.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6443 (class 0 OID 0)
-- Dependencies: 303
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751096706.split_trails_id_seq OWNED BY staging_boulder_1753751096706.split_trails.id;


--
-- TOC entry 300 (class 1259 OID 7977993)
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE TABLE staging_boulder_1753751096706.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 299 (class 1259 OID 7977992)
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751096706.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6444 (class 0 OID 0)
-- Dependencies: 299
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751096706.trail_hashes_id_seq OWNED BY staging_boulder_1753751096706.trail_hashes.id;


--
-- TOC entry 298 (class 1259 OID 7977978)
-- Name: trails; Type: TABLE; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE TABLE staging_boulder_1753751096706.trails (
    id integer NOT NULL,
    app_uuid text NOT NULL,
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
    elevation_gain real DEFAULT 0,
    elevation_loss real DEFAULT 0,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    source text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geometry_text text,
    geometry_hash text NOT NULL
);


--
-- TOC entry 297 (class 1259 OID 7977977)
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751096706.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6445 (class 0 OID 0)
-- Dependencies: 297
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751096706.trails_id_seq OWNED BY staging_boulder_1753751096706.trails.id;


--
-- TOC entry 314 (class 1259 OID 7980911)
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE TABLE staging_boulder_1753751126664.intersection_points (
    id integer NOT NULL,
    point public.geometry(Point,4326),
    point_3d public.geometry(PointZ,4326),
    connected_trail_ids text[],
    connected_trail_names text[],
    node_type text,
    distance_meters real,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 313 (class 1259 OID 7980910)
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751126664.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6446 (class 0 OID 0)
-- Dependencies: 313
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751126664.intersection_points_id_seq OWNED BY staging_boulder_1753751126664.intersection_points.id;


--
-- TOC entry 320 (class 1259 OID 7980946)
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE TABLE staging_boulder_1753751126664.routing_edges (
    id integer NOT NULL,
    from_node_id integer NOT NULL,
    to_node_id integer NOT NULL,
    trail_id text NOT NULL,
    trail_name text NOT NULL,
    distance_km real NOT NULL,
    elevation_gain real DEFAULT 0 NOT NULL,
    elevation_loss real DEFAULT 0 NOT NULL,
    is_bidirectional boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geojson text
);


--
-- TOC entry 319 (class 1259 OID 7980945)
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751126664.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6447 (class 0 OID 0)
-- Dependencies: 319
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751126664.routing_edges_id_seq OWNED BY staging_boulder_1753751126664.routing_edges.id;


--
-- TOC entry 318 (class 1259 OID 7980934)
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE TABLE staging_boulder_1753751126664.routing_nodes (
    id integer NOT NULL,
    node_uuid text,
    lat real,
    lng real,
    elevation real,
    node_type text,
    connected_trails text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 317 (class 1259 OID 7980933)
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751126664.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6448 (class 0 OID 0)
-- Dependencies: 317
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751126664.routing_nodes_id_seq OWNED BY staging_boulder_1753751126664.routing_nodes.id;


--
-- TOC entry 316 (class 1259 OID 7980921)
-- Name: split_trails; Type: TABLE; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE TABLE staging_boulder_1753751126664.split_trails (
    id integer NOT NULL,
    original_trail_id integer,
    segment_number integer,
    app_uuid text NOT NULL,
    name text,
    trail_type text,
    surface text,
    difficulty text,
    source_tags text,
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
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 315 (class 1259 OID 7980920)
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751126664.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6449 (class 0 OID 0)
-- Dependencies: 315
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751126664.split_trails_id_seq OWNED BY staging_boulder_1753751126664.split_trails.id;


--
-- TOC entry 312 (class 1259 OID 7980901)
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE TABLE staging_boulder_1753751126664.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 311 (class 1259 OID 7980900)
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751126664.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6450 (class 0 OID 0)
-- Dependencies: 311
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751126664.trail_hashes_id_seq OWNED BY staging_boulder_1753751126664.trail_hashes.id;


--
-- TOC entry 310 (class 1259 OID 7980886)
-- Name: trails; Type: TABLE; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE TABLE staging_boulder_1753751126664.trails (
    id integer NOT NULL,
    app_uuid text NOT NULL,
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
    elevation_gain real DEFAULT 0,
    elevation_loss real DEFAULT 0,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    source text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geometry_text text,
    geometry_hash text NOT NULL
);


--
-- TOC entry 309 (class 1259 OID 7980885)
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751126664.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6451 (class 0 OID 0)
-- Dependencies: 309
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751126664.trails_id_seq OWNED BY staging_boulder_1753751126664.trails.id;


--
-- TOC entry 326 (class 1259 OID 7983948)
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE TABLE staging_boulder_1753751363911.intersection_points (
    id integer NOT NULL,
    point public.geometry(Point,4326),
    point_3d public.geometry(PointZ,4326),
    connected_trail_ids text[],
    connected_trail_names text[],
    node_type text,
    distance_meters real,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 325 (class 1259 OID 7983947)
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751363911.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6452 (class 0 OID 0)
-- Dependencies: 325
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751363911.intersection_points_id_seq OWNED BY staging_boulder_1753751363911.intersection_points.id;


--
-- TOC entry 332 (class 1259 OID 7983983)
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE TABLE staging_boulder_1753751363911.routing_edges (
    id integer NOT NULL,
    from_node_id integer NOT NULL,
    to_node_id integer NOT NULL,
    trail_id text NOT NULL,
    trail_name text NOT NULL,
    distance_km real NOT NULL,
    elevation_gain real DEFAULT 0 NOT NULL,
    elevation_loss real DEFAULT 0 NOT NULL,
    is_bidirectional boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geojson text
);


--
-- TOC entry 331 (class 1259 OID 7983982)
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751363911.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6453 (class 0 OID 0)
-- Dependencies: 331
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751363911.routing_edges_id_seq OWNED BY staging_boulder_1753751363911.routing_edges.id;


--
-- TOC entry 330 (class 1259 OID 7983971)
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE TABLE staging_boulder_1753751363911.routing_nodes (
    id integer NOT NULL,
    node_uuid text,
    lat real,
    lng real,
    elevation real,
    node_type text,
    connected_trails text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 329 (class 1259 OID 7983970)
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751363911.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6454 (class 0 OID 0)
-- Dependencies: 329
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751363911.routing_nodes_id_seq OWNED BY staging_boulder_1753751363911.routing_nodes.id;


--
-- TOC entry 328 (class 1259 OID 7983958)
-- Name: split_trails; Type: TABLE; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE TABLE staging_boulder_1753751363911.split_trails (
    id integer NOT NULL,
    original_trail_id integer,
    segment_number integer,
    app_uuid text NOT NULL,
    name text,
    trail_type text,
    surface text,
    difficulty text,
    source_tags text,
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
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 327 (class 1259 OID 7983957)
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751363911.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6455 (class 0 OID 0)
-- Dependencies: 327
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751363911.split_trails_id_seq OWNED BY staging_boulder_1753751363911.split_trails.id;


--
-- TOC entry 324 (class 1259 OID 7983938)
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE TABLE staging_boulder_1753751363911.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 323 (class 1259 OID 7983937)
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751363911.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6456 (class 0 OID 0)
-- Dependencies: 323
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751363911.trail_hashes_id_seq OWNED BY staging_boulder_1753751363911.trail_hashes.id;


--
-- TOC entry 322 (class 1259 OID 7983923)
-- Name: trails; Type: TABLE; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE TABLE staging_boulder_1753751363911.trails (
    id integer NOT NULL,
    app_uuid text NOT NULL,
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
    elevation_gain real DEFAULT 0,
    elevation_loss real DEFAULT 0,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    source text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geometry_text text,
    geometry_hash text NOT NULL
);


--
-- TOC entry 321 (class 1259 OID 7983922)
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751363911.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6457 (class 0 OID 0)
-- Dependencies: 321
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751363911.trails_id_seq OWNED BY staging_boulder_1753751363911.trails.id;


--
-- TOC entry 338 (class 1259 OID 7986868)
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE TABLE staging_boulder_1753751589033.intersection_points (
    id integer NOT NULL,
    point public.geometry(Point,4326),
    point_3d public.geometry(PointZ,4326),
    connected_trail_ids text[],
    connected_trail_names text[],
    node_type text,
    distance_meters real,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 337 (class 1259 OID 7986867)
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751589033.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6458 (class 0 OID 0)
-- Dependencies: 337
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751589033.intersection_points_id_seq OWNED BY staging_boulder_1753751589033.intersection_points.id;


--
-- TOC entry 344 (class 1259 OID 7986903)
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE TABLE staging_boulder_1753751589033.routing_edges (
    id integer NOT NULL,
    from_node_id integer NOT NULL,
    to_node_id integer NOT NULL,
    trail_id text NOT NULL,
    trail_name text NOT NULL,
    distance_km real NOT NULL,
    elevation_gain real DEFAULT 0 NOT NULL,
    elevation_loss real DEFAULT 0 NOT NULL,
    is_bidirectional boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geojson text
);


--
-- TOC entry 343 (class 1259 OID 7986902)
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751589033.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6459 (class 0 OID 0)
-- Dependencies: 343
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751589033.routing_edges_id_seq OWNED BY staging_boulder_1753751589033.routing_edges.id;


--
-- TOC entry 342 (class 1259 OID 7986891)
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE TABLE staging_boulder_1753751589033.routing_nodes (
    id integer NOT NULL,
    node_uuid text,
    lat real,
    lng real,
    elevation real,
    node_type text,
    connected_trails text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 341 (class 1259 OID 7986890)
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751589033.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6460 (class 0 OID 0)
-- Dependencies: 341
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751589033.routing_nodes_id_seq OWNED BY staging_boulder_1753751589033.routing_nodes.id;


--
-- TOC entry 340 (class 1259 OID 7986878)
-- Name: split_trails; Type: TABLE; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE TABLE staging_boulder_1753751589033.split_trails (
    id integer NOT NULL,
    original_trail_id integer,
    segment_number integer,
    app_uuid text NOT NULL,
    name text,
    trail_type text,
    surface text,
    difficulty text,
    source_tags text,
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
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 339 (class 1259 OID 7986877)
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751589033.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6461 (class 0 OID 0)
-- Dependencies: 339
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751589033.split_trails_id_seq OWNED BY staging_boulder_1753751589033.split_trails.id;


--
-- TOC entry 336 (class 1259 OID 7986858)
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE TABLE staging_boulder_1753751589033.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 335 (class 1259 OID 7986857)
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751589033.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6462 (class 0 OID 0)
-- Dependencies: 335
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751589033.trail_hashes_id_seq OWNED BY staging_boulder_1753751589033.trail_hashes.id;


--
-- TOC entry 334 (class 1259 OID 7986843)
-- Name: trails; Type: TABLE; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE TABLE staging_boulder_1753751589033.trails (
    id integer NOT NULL,
    app_uuid text NOT NULL,
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
    elevation_gain real DEFAULT 0,
    elevation_loss real DEFAULT 0,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    source text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geometry_text text,
    geometry_hash text NOT NULL
);


--
-- TOC entry 333 (class 1259 OID 7986842)
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE SEQUENCE staging_boulder_1753751589033.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6463 (class 0 OID 0)
-- Dependencies: 333
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER SEQUENCE staging_boulder_1753751589033.trails_id_seq OWNED BY staging_boulder_1753751589033.trails.id;


--
-- TOC entry 350 (class 1259 OID 7993009)
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE TABLE staging_boulder_1753752594710.intersection_points (
    id integer NOT NULL,
    point public.geometry(Point,4326),
    point_3d public.geometry(PointZ,4326),
    connected_trail_ids text[],
    connected_trail_names text[],
    node_type text,
    distance_meters real,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 349 (class 1259 OID 7993008)
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE SEQUENCE staging_boulder_1753752594710.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6464 (class 0 OID 0)
-- Dependencies: 349
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER SEQUENCE staging_boulder_1753752594710.intersection_points_id_seq OWNED BY staging_boulder_1753752594710.intersection_points.id;


--
-- TOC entry 356 (class 1259 OID 7993092)
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE TABLE staging_boulder_1753752594710.routing_edges (
    id integer NOT NULL,
    from_node_id integer NOT NULL,
    to_node_id integer NOT NULL,
    trail_id text NOT NULL,
    trail_name text NOT NULL,
    distance_km real NOT NULL,
    elevation_gain real DEFAULT 0 NOT NULL,
    elevation_loss real DEFAULT 0 NOT NULL,
    is_bidirectional boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geojson text
);


--
-- TOC entry 355 (class 1259 OID 7993090)
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE SEQUENCE staging_boulder_1753752594710.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6465 (class 0 OID 0)
-- Dependencies: 355
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER SEQUENCE staging_boulder_1753752594710.routing_edges_id_seq OWNED BY staging_boulder_1753752594710.routing_edges.id;


--
-- TOC entry 354 (class 1259 OID 7993067)
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE TABLE staging_boulder_1753752594710.routing_nodes (
    id integer NOT NULL,
    node_uuid text,
    lat real,
    lng real,
    elevation real,
    node_type text,
    connected_trails text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 353 (class 1259 OID 7993065)
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE SEQUENCE staging_boulder_1753752594710.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6466 (class 0 OID 0)
-- Dependencies: 353
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER SEQUENCE staging_boulder_1753752594710.routing_nodes_id_seq OWNED BY staging_boulder_1753752594710.routing_nodes.id;


--
-- TOC entry 352 (class 1259 OID 7993036)
-- Name: split_trails; Type: TABLE; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE TABLE staging_boulder_1753752594710.split_trails (
    id integer NOT NULL,
    original_trail_id integer,
    segment_number integer,
    app_uuid text NOT NULL,
    name text,
    trail_type text,
    surface text,
    difficulty text,
    source_tags text,
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
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 351 (class 1259 OID 7993028)
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE SEQUENCE staging_boulder_1753752594710.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6467 (class 0 OID 0)
-- Dependencies: 351
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER SEQUENCE staging_boulder_1753752594710.split_trails_id_seq OWNED BY staging_boulder_1753752594710.split_trails.id;


--
-- TOC entry 348 (class 1259 OID 7992983)
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE TABLE staging_boulder_1753752594710.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 347 (class 1259 OID 7992980)
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE SEQUENCE staging_boulder_1753752594710.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6468 (class 0 OID 0)
-- Dependencies: 347
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER SEQUENCE staging_boulder_1753752594710.trail_hashes_id_seq OWNED BY staging_boulder_1753752594710.trail_hashes.id;


--
-- TOC entry 346 (class 1259 OID 7992945)
-- Name: trails; Type: TABLE; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE TABLE staging_boulder_1753752594710.trails (
    id integer NOT NULL,
    app_uuid text NOT NULL,
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
    elevation_gain real DEFAULT 0,
    elevation_loss real DEFAULT 0,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    source text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geometry_text text,
    geometry_hash text NOT NULL
);


--
-- TOC entry 345 (class 1259 OID 7992944)
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE SEQUENCE staging_boulder_1753752594710.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 6469 (class 0 OID 0)
-- Dependencies: 345
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER SEQUENCE staging_boulder_1753752594710.trails_id_seq OWNED BY staging_boulder_1753752594710.trails.id;


--
-- TOC entry 5722 (class 2604 OID 17506)
-- Name: elevation_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.elevation_points ALTER COLUMN id SET DEFAULT nextval('public.elevation_points_id_seq'::regclass);


--
-- TOC entry 5745 (class 2604 OID 7824672)
-- Name: intersection_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intersection_points ALTER COLUMN id SET DEFAULT nextval('public.intersection_points_id_seq'::regclass);


--
-- TOC entry 5733 (class 2604 OID 17680)
-- Name: regions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions ALTER COLUMN id SET DEFAULT nextval('public.regions_id_seq'::regclass);


--
-- TOC entry 5727 (class 2604 OID 17554)
-- Name: route_recommendations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_recommendations ALTER COLUMN id SET DEFAULT nextval('public.route_recommendations_id_seq'::regclass);


--
-- TOC entry 5754 (class 2604 OID 7954013)
-- Name: routing_edges_vertices_pgr id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_edges_vertices_pgr ALTER COLUMN id SET DEFAULT nextval('public.routing_edges_vertices_pgr_id_seq'::regclass);


--
-- TOC entry 5706 (class 2604 OID 17483)
-- Name: schema_version id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_version ALTER COLUMN id SET DEFAULT nextval('public.schema_version_id_seq'::regclass);


--
-- TOC entry 5736 (class 2604 OID 7824659)
-- Name: split_trails id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.split_trails ALTER COLUMN id SET DEFAULT nextval('public.split_trails_id_seq'::regclass);


--
-- TOC entry 5752 (class 2604 OID 7824682)
-- Name: trail_hashes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_hashes ALTER COLUMN id SET DEFAULT nextval('public.trail_hashes_id_seq'::regclass);


--
-- TOC entry 5709 (class 2604 OID 17492)
-- Name: trails id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trails ALTER COLUMN id SET DEFAULT nextval('public.trails_id_seq'::regclass);


--
-- TOC entry 5762 (class 2604 OID 7962873)
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750759428.intersection_points_id_seq'::regclass);


--
-- TOC entry 5769 (class 2604 OID 7962908)
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750759428.routing_edges_id_seq'::regclass);


--
-- TOC entry 5767 (class 2604 OID 7962896)
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750759428.routing_nodes_id_seq'::regclass);


--
-- TOC entry 5764 (class 2604 OID 7962883)
-- Name: split_trails id; Type: DEFAULT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750759428.split_trails_id_seq'::regclass);


--
-- TOC entry 5760 (class 2604 OID 7962863)
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750759428.trail_hashes_id_seq'::regclass);


--
-- TOC entry 5755 (class 2604 OID 7962848)
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750759428.trails_id_seq'::regclass);


--
-- TOC entry 5781 (class 2604 OID 7966698)
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750866110.intersection_points_id_seq'::regclass);


--
-- TOC entry 5788 (class 2604 OID 7966733)
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750866110.routing_edges_id_seq'::regclass);


--
-- TOC entry 5786 (class 2604 OID 7966721)
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750866110.routing_nodes_id_seq'::regclass);


--
-- TOC entry 5783 (class 2604 OID 7966708)
-- Name: split_trails id; Type: DEFAULT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750866110.split_trails_id_seq'::regclass);


--
-- TOC entry 5779 (class 2604 OID 7966688)
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750866110.trail_hashes_id_seq'::regclass);


--
-- TOC entry 5774 (class 2604 OID 7966673)
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750866110.trails_id_seq'::regclass);


--
-- TOC entry 5800 (class 2604 OID 7971384)
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750899097.intersection_points_id_seq'::regclass);


--
-- TOC entry 5807 (class 2604 OID 7971419)
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750899097.routing_edges_id_seq'::regclass);


--
-- TOC entry 5805 (class 2604 OID 7971407)
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750899097.routing_nodes_id_seq'::regclass);


--
-- TOC entry 5802 (class 2604 OID 7971394)
-- Name: split_trails id; Type: DEFAULT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750899097.split_trails_id_seq'::regclass);


--
-- TOC entry 5798 (class 2604 OID 7971374)
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750899097.trail_hashes_id_seq'::regclass);


--
-- TOC entry 5793 (class 2604 OID 7971359)
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750899097.trails_id_seq'::regclass);


--
-- TOC entry 5819 (class 2604 OID 7978006)
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751096706.intersection_points_id_seq'::regclass);


--
-- TOC entry 5826 (class 2604 OID 7978041)
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751096706.routing_edges_id_seq'::regclass);


--
-- TOC entry 5824 (class 2604 OID 7978029)
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751096706.routing_nodes_id_seq'::regclass);


--
-- TOC entry 5821 (class 2604 OID 7978016)
-- Name: split_trails id; Type: DEFAULT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751096706.split_trails_id_seq'::regclass);


--
-- TOC entry 5817 (class 2604 OID 7977996)
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751096706.trail_hashes_id_seq'::regclass);


--
-- TOC entry 5812 (class 2604 OID 7977981)
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751096706.trails_id_seq'::regclass);


--
-- TOC entry 5838 (class 2604 OID 7980914)
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751126664.intersection_points_id_seq'::regclass);


--
-- TOC entry 5845 (class 2604 OID 7980949)
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751126664.routing_edges_id_seq'::regclass);


--
-- TOC entry 5843 (class 2604 OID 7980937)
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751126664.routing_nodes_id_seq'::regclass);


--
-- TOC entry 5840 (class 2604 OID 7980924)
-- Name: split_trails id; Type: DEFAULT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751126664.split_trails_id_seq'::regclass);


--
-- TOC entry 5836 (class 2604 OID 7980904)
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751126664.trail_hashes_id_seq'::regclass);


--
-- TOC entry 5831 (class 2604 OID 7980889)
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751126664.trails_id_seq'::regclass);


--
-- TOC entry 5857 (class 2604 OID 7983951)
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751363911.intersection_points_id_seq'::regclass);


--
-- TOC entry 5864 (class 2604 OID 7983986)
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751363911.routing_edges_id_seq'::regclass);


--
-- TOC entry 5862 (class 2604 OID 7983974)
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751363911.routing_nodes_id_seq'::regclass);


--
-- TOC entry 5859 (class 2604 OID 7983961)
-- Name: split_trails id; Type: DEFAULT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751363911.split_trails_id_seq'::regclass);


--
-- TOC entry 5855 (class 2604 OID 7983941)
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751363911.trail_hashes_id_seq'::regclass);


--
-- TOC entry 5850 (class 2604 OID 7983926)
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751363911.trails_id_seq'::regclass);


--
-- TOC entry 5876 (class 2604 OID 7986871)
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751589033.intersection_points_id_seq'::regclass);


--
-- TOC entry 5883 (class 2604 OID 7986906)
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751589033.routing_edges_id_seq'::regclass);


--
-- TOC entry 5881 (class 2604 OID 7986894)
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751589033.routing_nodes_id_seq'::regclass);


--
-- TOC entry 5878 (class 2604 OID 7986881)
-- Name: split_trails id; Type: DEFAULT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751589033.split_trails_id_seq'::regclass);


--
-- TOC entry 5874 (class 2604 OID 7986861)
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751589033.trail_hashes_id_seq'::regclass);


--
-- TOC entry 5869 (class 2604 OID 7986846)
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753751589033.trails_id_seq'::regclass);


--
-- TOC entry 5895 (class 2604 OID 7993016)
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753752594710.intersection_points_id_seq'::regclass);


--
-- TOC entry 5902 (class 2604 OID 7993095)
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753752594710.routing_edges_id_seq'::regclass);


--
-- TOC entry 5900 (class 2604 OID 7993071)
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753752594710.routing_nodes_id_seq'::regclass);


--
-- TOC entry 5897 (class 2604 OID 7993040)
-- Name: split_trails id; Type: DEFAULT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753752594710.split_trails_id_seq'::regclass);


--
-- TOC entry 5893 (class 2604 OID 7992988)
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753752594710.trail_hashes_id_seq'::regclass);


--
-- TOC entry 5888 (class 2604 OID 7992948)
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753752594710.trails_id_seq'::regclass);


--
-- TOC entry 5962 (class 2606 OID 164713)
-- Name: ways ways_pkey; Type: CONSTRAINT; Schema: osm_boulder; Owner: -
--

ALTER TABLE ONLY osm_boulder.ways
    ADD CONSTRAINT ways_pkey PRIMARY KEY (osm_id);


--
-- TOC entry 5945 (class 2606 OID 17513)
-- Name: elevation_points elevation_points_lat_lng_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.elevation_points
    ADD CONSTRAINT elevation_points_lat_lng_key UNIQUE (lat, lng);


--
-- TOC entry 5947 (class 2606 OID 17511)
-- Name: elevation_points elevation_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.elevation_points
    ADD CONSTRAINT elevation_points_pkey PRIMARY KEY (id);


--
-- TOC entry 5976 (class 2606 OID 7824677)
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- TOC entry 5956 (class 2606 OID 30432)
-- Name: regions regions_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_id_unique UNIQUE (id);


--
-- TOC entry 5958 (class 2606 OID 17686)
-- Name: regions regions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (id);


--
-- TOC entry 5960 (class 2606 OID 17688)
-- Name: regions regions_region_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_region_key_key UNIQUE (region_key);


--
-- TOC entry 5952 (class 2606 OID 17559)
-- Name: route_recommendations route_recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_recommendations
    ADD CONSTRAINT route_recommendations_pkey PRIMARY KEY (id);


--
-- TOC entry 5982 (class 2606 OID 7954015)
-- Name: routing_edges_vertices_pgr routing_edges_vertices_pgr_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_edges_vertices_pgr
    ADD CONSTRAINT routing_edges_vertices_pgr_pkey PRIMARY KEY (id);


--
-- TOC entry 5910 (class 2606 OID 17487)
-- Name: schema_version schema_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_version
    ADD CONSTRAINT schema_version_pkey PRIMARY KEY (id);


--
-- TOC entry 5969 (class 2606 OID 7824667)
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 5971 (class 2606 OID 7824665)
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- TOC entry 5980 (class 2606 OID 7824687)
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- TOC entry 5935 (class 2606 OID 17501)
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 5937 (class 2606 OID 17589)
-- Name: trails trails_osm_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trails
    ADD CONSTRAINT trails_osm_id_unique UNIQUE (osm_id);


--
-- TOC entry 5939 (class 2606 OID 17499)
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- TOC entry 5941 (class 2606 OID 4984067)
-- Name: trails uk_trails_app_uuid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trails
    ADD CONSTRAINT uk_trails_app_uuid UNIQUE (app_uuid);


--
-- TOC entry 5943 (class 2606 OID 4984069)
-- Name: trails uk_trails_osm_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trails
    ADD CONSTRAINT uk_trails_osm_id UNIQUE (osm_id);


--
-- TOC entry 5995 (class 2606 OID 7962878)
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- TOC entry 6011 (class 2606 OID 7962916)
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- TOC entry 6005 (class 2606 OID 7962903)
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- TOC entry 6007 (class 2606 OID 7962901)
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- TOC entry 5999 (class 2606 OID 7962891)
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 6001 (class 2606 OID 7962889)
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- TOC entry 5991 (class 2606 OID 7962868)
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- TOC entry 5987 (class 2606 OID 7962858)
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 5989 (class 2606 OID 7962856)
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- TOC entry 6023 (class 2606 OID 7966703)
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- TOC entry 6039 (class 2606 OID 7966741)
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- TOC entry 6033 (class 2606 OID 7966728)
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- TOC entry 6035 (class 2606 OID 7966726)
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- TOC entry 6027 (class 2606 OID 7966716)
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 6029 (class 2606 OID 7966714)
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- TOC entry 6019 (class 2606 OID 7966693)
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- TOC entry 6015 (class 2606 OID 7966683)
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 6017 (class 2606 OID 7966681)
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- TOC entry 6051 (class 2606 OID 7971389)
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- TOC entry 6067 (class 2606 OID 7971427)
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- TOC entry 6061 (class 2606 OID 7971414)
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- TOC entry 6063 (class 2606 OID 7971412)
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- TOC entry 6055 (class 2606 OID 7971402)
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 6057 (class 2606 OID 7971400)
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- TOC entry 6047 (class 2606 OID 7971379)
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- TOC entry 6043 (class 2606 OID 7971369)
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 6045 (class 2606 OID 7971367)
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- TOC entry 6079 (class 2606 OID 7978011)
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- TOC entry 6095 (class 2606 OID 7978049)
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- TOC entry 6089 (class 2606 OID 7978036)
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- TOC entry 6091 (class 2606 OID 7978034)
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- TOC entry 6083 (class 2606 OID 7978024)
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 6085 (class 2606 OID 7978022)
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- TOC entry 6075 (class 2606 OID 7978001)
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- TOC entry 6071 (class 2606 OID 7977991)
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 6073 (class 2606 OID 7977989)
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- TOC entry 6107 (class 2606 OID 7980919)
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- TOC entry 6123 (class 2606 OID 7980957)
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- TOC entry 6117 (class 2606 OID 7980944)
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- TOC entry 6119 (class 2606 OID 7980942)
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- TOC entry 6111 (class 2606 OID 7980932)
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 6113 (class 2606 OID 7980930)
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- TOC entry 6103 (class 2606 OID 7980909)
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- TOC entry 6099 (class 2606 OID 7980899)
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 6101 (class 2606 OID 7980897)
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- TOC entry 6135 (class 2606 OID 7983956)
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- TOC entry 6151 (class 2606 OID 7983994)
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- TOC entry 6145 (class 2606 OID 7983981)
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- TOC entry 6147 (class 2606 OID 7983979)
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- TOC entry 6139 (class 2606 OID 7983969)
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 6141 (class 2606 OID 7983967)
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- TOC entry 6131 (class 2606 OID 7983946)
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- TOC entry 6127 (class 2606 OID 7983936)
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 6129 (class 2606 OID 7983934)
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- TOC entry 6163 (class 2606 OID 7986876)
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- TOC entry 6179 (class 2606 OID 7986914)
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- TOC entry 6173 (class 2606 OID 7986901)
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- TOC entry 6175 (class 2606 OID 7986899)
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- TOC entry 6167 (class 2606 OID 7986889)
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 6169 (class 2606 OID 7986887)
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- TOC entry 6159 (class 2606 OID 7986866)
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- TOC entry 6155 (class 2606 OID 7986856)
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 6157 (class 2606 OID 7986854)
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- TOC entry 6191 (class 2606 OID 7993026)
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- TOC entry 6207 (class 2606 OID 7993104)
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- TOC entry 6201 (class 2606 OID 7993088)
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- TOC entry 6203 (class 2606 OID 7993085)
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- TOC entry 6195 (class 2606 OID 7993062)
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 6197 (class 2606 OID 7993059)
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- TOC entry 6187 (class 2606 OID 7993003)
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- TOC entry 6183 (class 2606 OID 7992973)
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- TOC entry 6185 (class 2606 OID 7992967)
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- TOC entry 5948 (class 1259 OID 4984327)
-- Name: idx_elevation_points_elevation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_elevation_points_elevation ON public.elevation_points USING btree (elevation);


--
-- TOC entry 5949 (class 1259 OID 4984326)
-- Name: idx_elevation_points_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_elevation_points_location ON public.elevation_points USING btree (lat, lng);


--
-- TOC entry 5950 (class 1259 OID 4984328)
-- Name: idx_elevation_points_spatial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_elevation_points_spatial ON public.elevation_points USING gist (public.st_setsrid(public.st_point((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 5972 (class 1259 OID 7824695)
-- Name: idx_intersection_points_node_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_intersection_points_node_type ON public.intersection_points USING btree (node_type);


--
-- TOC entry 5973 (class 1259 OID 7824693)
-- Name: idx_intersection_points_point; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_intersection_points_point ON public.intersection_points USING gist (point);


--
-- TOC entry 5974 (class 1259 OID 7824694)
-- Name: idx_intersection_points_point_3d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_intersection_points_point_3d ON public.intersection_points USING gist (point_3d);


--
-- TOC entry 5953 (class 1259 OID 17690)
-- Name: idx_regions_bbox; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_regions_bbox ON public.regions USING gist (public.st_makeenvelope((bbox_min_lng)::double precision, (bbox_min_lat)::double precision, (bbox_max_lng)::double precision, (bbox_max_lat)::double precision));


--
-- TOC entry 5954 (class 1259 OID 17689)
-- Name: idx_regions_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_regions_key ON public.regions USING btree (region_key);


--
-- TOC entry 6208 (class 1259 OID 7995964)
-- Name: idx_routing_edges_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routing_edges_geom ON public.routing_edges USING gist (geom);


--
-- TOC entry 6213 (class 1259 OID 7995965)
-- Name: idx_routing_nodes_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routing_nodes_geom ON public.routing_nodes USING gist (the_geom);


--
-- TOC entry 5963 (class 1259 OID 7824690)
-- Name: idx_split_trails_app_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_split_trails_app_uuid ON public.split_trails USING btree (app_uuid);


--
-- TOC entry 5964 (class 1259 OID 7824692)
-- Name: idx_split_trails_bbox; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_split_trails_bbox ON public.split_trails USING gist (public.st_makeenvelope((bbox_min_lng)::double precision, (bbox_min_lat)::double precision, (bbox_max_lng)::double precision, (bbox_max_lat)::double precision));


--
-- TOC entry 5965 (class 1259 OID 7824691)
-- Name: idx_split_trails_geometry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_split_trails_geometry ON public.split_trails USING gist (geometry);


--
-- TOC entry 5966 (class 1259 OID 7824688)
-- Name: idx_split_trails_original_trail_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_split_trails_original_trail_id ON public.split_trails USING btree (original_trail_id);


--
-- TOC entry 5967 (class 1259 OID 7824689)
-- Name: idx_split_trails_segment_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_split_trails_segment_number ON public.split_trails USING btree (segment_number);


--
-- TOC entry 5977 (class 1259 OID 7824696)
-- Name: idx_trail_hashes_app_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trail_hashes_app_uuid ON public.trail_hashes USING btree (app_uuid);


--
-- TOC entry 5978 (class 1259 OID 7824697)
-- Name: idx_trail_hashes_geometry_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trail_hashes_geometry_hash ON public.trail_hashes USING btree (geometry_hash);


--
-- TOC entry 5911 (class 1259 OID 4984371)
-- Name: idx_trails_3d_geometry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_3d_geometry ON public.trails USING gist (geometry) WHERE (public.st_ndims(geometry) = 3);


--
-- TOC entry 5912 (class 1259 OID 9820860)
-- Name: idx_trails_3d_geometry_complete; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_3d_geometry_complete ON public.trails USING gist (geometry) WHERE (public.st_ndims(geometry) = 3);


--
-- TOC entry 5913 (class 1259 OID 4984314)
-- Name: idx_trails_app_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_app_uuid ON public.trails USING btree (app_uuid);


--
-- TOC entry 5914 (class 1259 OID 4984317)
-- Name: idx_trails_bbox; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_bbox ON public.trails USING gist (public.st_makeenvelope((bbox_min_lng)::double precision, (bbox_min_lat)::double precision, (bbox_max_lng)::double precision, (bbox_max_lat)::double precision));


--
-- TOC entry 5915 (class 1259 OID 4984323)
-- Name: idx_trails_bbox_coords; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_bbox_coords ON public.trails USING btree (bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);


--
-- TOC entry 5916 (class 1259 OID 4984322)
-- Name: idx_trails_bbox_spatial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_bbox_spatial ON public.trails USING gist (public.st_envelope(geometry));


--
-- TOC entry 5917 (class 1259 OID 4984372)
-- Name: idx_trails_bbox_validation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_bbox_validation ON public.trails USING btree (bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat) WHERE (bbox_min_lng IS NOT NULL);


--
-- TOC entry 5918 (class 1259 OID 9820859)
-- Name: idx_trails_complete_elevation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_complete_elevation ON public.trails USING btree (region, length_km, elevation_gain) WHERE ((elevation_gain IS NOT NULL) AND (max_elevation IS NOT NULL));


--
-- TOC entry 5919 (class 1259 OID 4984370)
-- Name: idx_trails_completeness_check; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_completeness_check ON public.trails USING btree (elevation_gain, max_elevation, min_elevation, avg_elevation) WHERE (elevation_gain IS NOT NULL);


--
-- TOC entry 5920 (class 1259 OID 4984319)
-- Name: idx_trails_elevation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_elevation ON public.trails USING btree (elevation_gain);


--
-- TOC entry 5921 (class 1259 OID 4984318)
-- Name: idx_trails_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_geom ON public.trails USING gist (geometry);


--
-- TOC entry 5922 (class 1259 OID 4984338)
-- Name: idx_trails_geom_spatial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_geom_spatial ON public.trails USING gist (geometry);


--
-- TOC entry 5923 (class 1259 OID 17652)
-- Name: idx_trails_geometry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_geometry ON public.trails USING gist (geometry);


--
-- TOC entry 5924 (class 1259 OID 4984341)
-- Name: idx_trails_geometry_gist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_geometry_gist ON public.trails USING gist (geometry);


--
-- TOC entry 5925 (class 1259 OID 4984315)
-- Name: idx_trails_osm_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_osm_id ON public.trails USING btree (osm_id);


--
-- TOC entry 5926 (class 1259 OID 4984316)
-- Name: idx_trails_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region ON public.trails USING btree (region);


--
-- TOC entry 5927 (class 1259 OID 4984324)
-- Name: idx_trails_region_bbox; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region_bbox ON public.trails USING btree (region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);


--
-- TOC entry 5928 (class 1259 OID 4984325)
-- Name: idx_trails_region_elevation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region_elevation ON public.trails USING btree (region, elevation_gain);


--
-- TOC entry 5929 (class 1259 OID 9820856)
-- Name: idx_trails_region_elevation_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region_elevation_composite ON public.trails USING btree (region, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation);


--
-- TOC entry 5930 (class 1259 OID 9820857)
-- Name: idx_trails_region_length_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region_length_composite ON public.trails USING btree (region, length_km, elevation_gain);


--
-- TOC entry 5931 (class 1259 OID 9820858)
-- Name: idx_trails_region_surface_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region_surface_composite ON public.trails USING btree (region, surface, trail_type);


--
-- TOC entry 5932 (class 1259 OID 4984320)
-- Name: idx_trails_surface; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_surface ON public.trails USING btree (surface);


--
-- TOC entry 5933 (class 1259 OID 4984321)
-- Name: idx_trails_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_type ON public.trails USING btree (trail_type);


--
-- TOC entry 6209 (class 1259 OID 7995949)
-- Name: routing_edges_geom_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX routing_edges_geom_idx ON public.routing_edges USING gist (geom);


--
-- TOC entry 6210 (class 1259 OID 7995946)
-- Name: routing_edges_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX routing_edges_id_idx ON public.routing_edges USING btree (id);


--
-- TOC entry 6211 (class 1259 OID 7995947)
-- Name: routing_edges_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX routing_edges_source_idx ON public.routing_edges USING btree (source);


--
-- TOC entry 6212 (class 1259 OID 7995948)
-- Name: routing_edges_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX routing_edges_target_idx ON public.routing_edges USING btree (target);


--
-- TOC entry 5983 (class 1259 OID 7954018)
-- Name: routing_edges_vertices_pgr_the_geom_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX routing_edges_vertices_pgr_the_geom_idx ON public.routing_edges_vertices_pgr USING gist (the_geom);


--
-- TOC entry 5992 (class 1259 OID 7962929)
-- Name: idx_staging_boulder_1753750759428_intersection_points; Type: INDEX; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750759428_intersection_points ON staging_boulder_1753750759428.intersection_points USING gist (point);


--
-- TOC entry 6008 (class 1259 OID 7962931)
-- Name: idx_staging_boulder_1753750759428_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750759428_routing_edges_geometry ON staging_boulder_1753750759428.routing_edges USING gist (geometry);


--
-- TOC entry 6002 (class 1259 OID 7962930)
-- Name: idx_staging_boulder_1753750759428_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750759428_routing_nodes_location ON staging_boulder_1753750759428.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 5996 (class 1259 OID 7962928)
-- Name: idx_staging_boulder_1753750759428_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750759428_split_trails_geometry ON staging_boulder_1753750759428.split_trails USING gist (geometry);


--
-- TOC entry 5984 (class 1259 OID 7962927)
-- Name: idx_staging_boulder_1753750759428_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750759428_trails_geometry ON staging_boulder_1753750759428.trails USING gist (geometry);


--
-- TOC entry 5993 (class 1259 OID 7962934)
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1753750759428.intersection_points USING gist (point);


--
-- TOC entry 6009 (class 1259 OID 7962936)
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1753750759428.routing_edges USING gist (geometry);


--
-- TOC entry 6003 (class 1259 OID 7962935)
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1753750759428.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 5997 (class 1259 OID 7962933)
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_boulder_1753750759428.split_trails USING gist (geometry);


--
-- TOC entry 5985 (class 1259 OID 7962932)
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750759428; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1753750759428.trails USING gist (geometry);


--
-- TOC entry 6020 (class 1259 OID 7966754)
-- Name: idx_staging_boulder_1753750866110_intersection_points; Type: INDEX; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750866110_intersection_points ON staging_boulder_1753750866110.intersection_points USING gist (point);


--
-- TOC entry 6036 (class 1259 OID 7966756)
-- Name: idx_staging_boulder_1753750866110_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750866110_routing_edges_geometry ON staging_boulder_1753750866110.routing_edges USING gist (geometry);


--
-- TOC entry 6030 (class 1259 OID 7966755)
-- Name: idx_staging_boulder_1753750866110_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750866110_routing_nodes_location ON staging_boulder_1753750866110.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 6024 (class 1259 OID 7966753)
-- Name: idx_staging_boulder_1753750866110_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750866110_split_trails_geometry ON staging_boulder_1753750866110.split_trails USING gist (geometry);


--
-- TOC entry 6012 (class 1259 OID 7966752)
-- Name: idx_staging_boulder_1753750866110_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750866110_trails_geometry ON staging_boulder_1753750866110.trails USING gist (geometry);


--
-- TOC entry 6021 (class 1259 OID 7966759)
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1753750866110.intersection_points USING gist (point);


--
-- TOC entry 6037 (class 1259 OID 7966761)
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1753750866110.routing_edges USING gist (geometry);


--
-- TOC entry 6031 (class 1259 OID 7966760)
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1753750866110.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 6025 (class 1259 OID 7966758)
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_boulder_1753750866110.split_trails USING gist (geometry);


--
-- TOC entry 6013 (class 1259 OID 7966757)
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750866110; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1753750866110.trails USING gist (geometry);


--
-- TOC entry 6048 (class 1259 OID 7971440)
-- Name: idx_staging_boulder_1753750899097_intersection_points; Type: INDEX; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750899097_intersection_points ON staging_boulder_1753750899097.intersection_points USING gist (point);


--
-- TOC entry 6064 (class 1259 OID 7971442)
-- Name: idx_staging_boulder_1753750899097_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750899097_routing_edges_geometry ON staging_boulder_1753750899097.routing_edges USING gist (geometry);


--
-- TOC entry 6058 (class 1259 OID 7971441)
-- Name: idx_staging_boulder_1753750899097_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750899097_routing_nodes_location ON staging_boulder_1753750899097.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 6052 (class 1259 OID 7971439)
-- Name: idx_staging_boulder_1753750899097_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750899097_split_trails_geometry ON staging_boulder_1753750899097.split_trails USING gist (geometry);


--
-- TOC entry 6040 (class 1259 OID 7971438)
-- Name: idx_staging_boulder_1753750899097_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750899097_trails_geometry ON staging_boulder_1753750899097.trails USING gist (geometry);


--
-- TOC entry 6049 (class 1259 OID 7971445)
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1753750899097.intersection_points USING gist (point);


--
-- TOC entry 6065 (class 1259 OID 7971447)
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1753750899097.routing_edges USING gist (geometry);


--
-- TOC entry 6059 (class 1259 OID 7971446)
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1753750899097.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 6053 (class 1259 OID 7971444)
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_boulder_1753750899097.split_trails USING gist (geometry);


--
-- TOC entry 6041 (class 1259 OID 7971443)
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750899097; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1753750899097.trails USING gist (geometry);


--
-- TOC entry 6076 (class 1259 OID 7978062)
-- Name: idx_staging_boulder_1753751096706_intersection_points; Type: INDEX; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751096706_intersection_points ON staging_boulder_1753751096706.intersection_points USING gist (point);


--
-- TOC entry 6092 (class 1259 OID 7978064)
-- Name: idx_staging_boulder_1753751096706_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751096706_routing_edges_geometry ON staging_boulder_1753751096706.routing_edges USING gist (geometry);


--
-- TOC entry 6086 (class 1259 OID 7978063)
-- Name: idx_staging_boulder_1753751096706_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751096706_routing_nodes_location ON staging_boulder_1753751096706.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 6080 (class 1259 OID 7978061)
-- Name: idx_staging_boulder_1753751096706_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751096706_split_trails_geometry ON staging_boulder_1753751096706.split_trails USING gist (geometry);


--
-- TOC entry 6068 (class 1259 OID 7978060)
-- Name: idx_staging_boulder_1753751096706_trails_geometry; Type: INDEX; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751096706_trails_geometry ON staging_boulder_1753751096706.trails USING gist (geometry);


--
-- TOC entry 6077 (class 1259 OID 7978067)
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1753751096706.intersection_points USING gist (point);


--
-- TOC entry 6093 (class 1259 OID 7978069)
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1753751096706.routing_edges USING gist (geometry);


--
-- TOC entry 6087 (class 1259 OID 7978068)
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1753751096706.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 6081 (class 1259 OID 7978066)
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_boulder_1753751096706.split_trails USING gist (geometry);


--
-- TOC entry 6069 (class 1259 OID 7978065)
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1753751096706; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1753751096706.trails USING gist (geometry);


--
-- TOC entry 6104 (class 1259 OID 7980970)
-- Name: idx_staging_boulder_1753751126664_intersection_points; Type: INDEX; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751126664_intersection_points ON staging_boulder_1753751126664.intersection_points USING gist (point);


--
-- TOC entry 6120 (class 1259 OID 7980972)
-- Name: idx_staging_boulder_1753751126664_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751126664_routing_edges_geometry ON staging_boulder_1753751126664.routing_edges USING gist (geometry);


--
-- TOC entry 6114 (class 1259 OID 7980971)
-- Name: idx_staging_boulder_1753751126664_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751126664_routing_nodes_location ON staging_boulder_1753751126664.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 6108 (class 1259 OID 7980969)
-- Name: idx_staging_boulder_1753751126664_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751126664_split_trails_geometry ON staging_boulder_1753751126664.split_trails USING gist (geometry);


--
-- TOC entry 6096 (class 1259 OID 7980968)
-- Name: idx_staging_boulder_1753751126664_trails_geometry; Type: INDEX; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751126664_trails_geometry ON staging_boulder_1753751126664.trails USING gist (geometry);


--
-- TOC entry 6105 (class 1259 OID 7980975)
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1753751126664.intersection_points USING gist (point);


--
-- TOC entry 6121 (class 1259 OID 7980977)
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1753751126664.routing_edges USING gist (geometry);


--
-- TOC entry 6115 (class 1259 OID 7980976)
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1753751126664.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 6109 (class 1259 OID 7980974)
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_boulder_1753751126664.split_trails USING gist (geometry);


--
-- TOC entry 6097 (class 1259 OID 7980973)
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1753751126664; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1753751126664.trails USING gist (geometry);


--
-- TOC entry 6132 (class 1259 OID 7984007)
-- Name: idx_staging_boulder_1753751363911_intersection_points; Type: INDEX; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751363911_intersection_points ON staging_boulder_1753751363911.intersection_points USING gist (point);


--
-- TOC entry 6148 (class 1259 OID 7984009)
-- Name: idx_staging_boulder_1753751363911_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751363911_routing_edges_geometry ON staging_boulder_1753751363911.routing_edges USING gist (geometry);


--
-- TOC entry 6142 (class 1259 OID 7984008)
-- Name: idx_staging_boulder_1753751363911_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751363911_routing_nodes_location ON staging_boulder_1753751363911.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 6136 (class 1259 OID 7984006)
-- Name: idx_staging_boulder_1753751363911_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751363911_split_trails_geometry ON staging_boulder_1753751363911.split_trails USING gist (geometry);


--
-- TOC entry 6124 (class 1259 OID 7984005)
-- Name: idx_staging_boulder_1753751363911_trails_geometry; Type: INDEX; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751363911_trails_geometry ON staging_boulder_1753751363911.trails USING gist (geometry);


--
-- TOC entry 6133 (class 1259 OID 7984012)
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1753751363911.intersection_points USING gist (point);


--
-- TOC entry 6149 (class 1259 OID 7984014)
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1753751363911.routing_edges USING gist (geometry);


--
-- TOC entry 6143 (class 1259 OID 7984013)
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1753751363911.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 6137 (class 1259 OID 7984011)
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_boulder_1753751363911.split_trails USING gist (geometry);


--
-- TOC entry 6125 (class 1259 OID 7984010)
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1753751363911; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1753751363911.trails USING gist (geometry);


--
-- TOC entry 6160 (class 1259 OID 7986927)
-- Name: idx_staging_boulder_1753751589033_intersection_points; Type: INDEX; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751589033_intersection_points ON staging_boulder_1753751589033.intersection_points USING gist (point);


--
-- TOC entry 6176 (class 1259 OID 7986929)
-- Name: idx_staging_boulder_1753751589033_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751589033_routing_edges_geometry ON staging_boulder_1753751589033.routing_edges USING gist (geometry);


--
-- TOC entry 6170 (class 1259 OID 7986928)
-- Name: idx_staging_boulder_1753751589033_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751589033_routing_nodes_location ON staging_boulder_1753751589033.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 6164 (class 1259 OID 7986926)
-- Name: idx_staging_boulder_1753751589033_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751589033_split_trails_geometry ON staging_boulder_1753751589033.split_trails USING gist (geometry);


--
-- TOC entry 6152 (class 1259 OID 7986925)
-- Name: idx_staging_boulder_1753751589033_trails_geometry; Type: INDEX; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE INDEX idx_staging_boulder_1753751589033_trails_geometry ON staging_boulder_1753751589033.trails USING gist (geometry);


--
-- TOC entry 6161 (class 1259 OID 7986932)
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1753751589033.intersection_points USING gist (point);


--
-- TOC entry 6177 (class 1259 OID 7986934)
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1753751589033.routing_edges USING gist (geometry);


--
-- TOC entry 6171 (class 1259 OID 7986933)
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1753751589033.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 6165 (class 1259 OID 7986931)
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_boulder_1753751589033.split_trails USING gist (geometry);


--
-- TOC entry 6153 (class 1259 OID 7986930)
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1753751589033; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1753751589033.trails USING gist (geometry);


--
-- TOC entry 6188 (class 1259 OID 7993118)
-- Name: idx_staging_boulder_1753752594710_intersection_points; Type: INDEX; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE INDEX idx_staging_boulder_1753752594710_intersection_points ON staging_boulder_1753752594710.intersection_points USING gist (point);


--
-- TOC entry 6204 (class 1259 OID 7993123)
-- Name: idx_staging_boulder_1753752594710_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE INDEX idx_staging_boulder_1753752594710_routing_edges_geometry ON staging_boulder_1753752594710.routing_edges USING gist (geometry);


--
-- TOC entry 6198 (class 1259 OID 7993121)
-- Name: idx_staging_boulder_1753752594710_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE INDEX idx_staging_boulder_1753752594710_routing_nodes_location ON staging_boulder_1753752594710.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 6192 (class 1259 OID 7993117)
-- Name: idx_staging_boulder_1753752594710_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE INDEX idx_staging_boulder_1753752594710_split_trails_geometry ON staging_boulder_1753752594710.split_trails USING gist (geometry);


--
-- TOC entry 6180 (class 1259 OID 7993115)
-- Name: idx_staging_boulder_1753752594710_trails_geometry; Type: INDEX; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE INDEX idx_staging_boulder_1753752594710_trails_geometry ON staging_boulder_1753752594710.trails USING gist (geometry);


--
-- TOC entry 6189 (class 1259 OID 7993127)
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1753752594710.intersection_points USING gist (point);


--
-- TOC entry 6205 (class 1259 OID 7993129)
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1753752594710.routing_edges USING gist (geometry);


--
-- TOC entry 6199 (class 1259 OID 7993128)
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1753752594710.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- TOC entry 6193 (class 1259 OID 7993126)
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_boulder_1753752594710.split_trails USING gist (geometry);


--
-- TOC entry 6181 (class 1259 OID 7993125)
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1753752594710; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1753752594710.trails USING gist (geometry);


--
-- TOC entry 6234 (class 2620 OID 4984365)
-- Name: trails trigger_auto_calculate_bbox; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_auto_calculate_bbox BEFORE INSERT OR UPDATE ON public.trails FOR EACH ROW EXECUTE FUNCTION public.auto_calculate_bbox();


--
-- TOC entry 6235 (class 2620 OID 4984367)
-- Name: trails trigger_auto_calculate_length; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_auto_calculate_length BEFORE INSERT OR UPDATE ON public.trails FOR EACH ROW EXECUTE FUNCTION public.auto_calculate_length();


--
-- TOC entry 6233 (class 2620 OID 4984363)
-- Name: trails trigger_validate_trail_completeness; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_validate_trail_completeness BEFORE INSERT OR UPDATE ON public.trails FOR EACH ROW EXECUTE FUNCTION public.validate_trail_completeness();


--
-- TOC entry 6232 (class 2620 OID 4984345)
-- Name: trails update_trails_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_trails_updated_at BEFORE UPDATE ON public.trails FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 6215 (class 2606 OID 7824698)
-- Name: split_trails fk_split_trails_original_trail; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.split_trails
    ADD CONSTRAINT fk_split_trails_original_trail FOREIGN KEY (original_trail_id) REFERENCES public.trails(id) ON DELETE CASCADE;


--
-- TOC entry 6214 (class 2606 OID 17692)
-- Name: trails fk_trails_region; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trails
    ADD CONSTRAINT fk_trails_region FOREIGN KEY (region) REFERENCES public.regions(region_key);


--
-- TOC entry 6216 (class 2606 OID 7962917)
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_boulder_1753750759428.routing_nodes(id) ON DELETE CASCADE;


--
-- TOC entry 6217 (class 2606 OID 7962922)
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750759428; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750759428.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_boulder_1753750759428.routing_nodes(id) ON DELETE CASCADE;


--
-- TOC entry 6218 (class 2606 OID 7966742)
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_boulder_1753750866110.routing_nodes(id) ON DELETE CASCADE;


--
-- TOC entry 6219 (class 2606 OID 7966747)
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750866110; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750866110.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_boulder_1753750866110.routing_nodes(id) ON DELETE CASCADE;


--
-- TOC entry 6220 (class 2606 OID 7971428)
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_boulder_1753750899097.routing_nodes(id) ON DELETE CASCADE;


--
-- TOC entry 6221 (class 2606 OID 7971433)
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750899097; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750899097.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_boulder_1753750899097.routing_nodes(id) ON DELETE CASCADE;


--
-- TOC entry 6222 (class 2606 OID 7978050)
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_boulder_1753751096706.routing_nodes(id) ON DELETE CASCADE;


--
-- TOC entry 6223 (class 2606 OID 7978055)
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753751096706; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751096706.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_boulder_1753751096706.routing_nodes(id) ON DELETE CASCADE;


--
-- TOC entry 6224 (class 2606 OID 7980958)
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_boulder_1753751126664.routing_nodes(id) ON DELETE CASCADE;


--
-- TOC entry 6225 (class 2606 OID 7980963)
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753751126664; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751126664.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_boulder_1753751126664.routing_nodes(id) ON DELETE CASCADE;


--
-- TOC entry 6226 (class 2606 OID 7983995)
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_boulder_1753751363911.routing_nodes(id) ON DELETE CASCADE;


--
-- TOC entry 6227 (class 2606 OID 7984000)
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753751363911; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751363911.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_boulder_1753751363911.routing_nodes(id) ON DELETE CASCADE;


--
-- TOC entry 6228 (class 2606 OID 7986915)
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_boulder_1753751589033.routing_nodes(id) ON DELETE CASCADE;


--
-- TOC entry 6229 (class 2606 OID 7986920)
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753751589033; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753751589033.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_boulder_1753751589033.routing_nodes(id) ON DELETE CASCADE;


--
-- TOC entry 6230 (class 2606 OID 7993105)
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_boulder_1753752594710.routing_nodes(id) ON DELETE CASCADE;


--
-- TOC entry 6231 (class 2606 OID 7993110)
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753752594710; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753752594710.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_boulder_1753752594710.routing_nodes(id) ON DELETE CASCADE;


-- Completed on 2025-07-29 15:26:57 MDT

--
-- PostgreSQL database dump complete
--

