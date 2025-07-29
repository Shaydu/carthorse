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
-- Name: staging_boulder_1753750357844; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1753750357844;


--
-- Name: staging_boulder_1753750358170; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1753750358170;


--
-- Name: staging_boulder_1753750422402; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1753750422402;


--
-- Name: staging_boulder_1753750422846; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1753750422846;


--
-- Name: staging_boulder_1753750467330; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1753750467330;


--
-- Name: staging_boulder_1753750467617; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1753750467617;


--
-- Name: staging_boulder_1753750552692; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1753750552692;


--
-- Name: staging_boulder_1753750552888; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1753750552888;


--
-- Name: staging_seattle_1753750361222; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750361222;


--
-- Name: staging_seattle_1753750362437; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750362437;


--
-- Name: staging_seattle_1753750365906; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750365906;


--
-- Name: staging_seattle_1753750367114; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750367114;


--
-- Name: staging_seattle_1753750368341; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750368341;


--
-- Name: staging_seattle_1753750372953; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750372953;


--
-- Name: staging_seattle_1753750378967; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750378967;


--
-- Name: staging_seattle_1753750380156; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750380156;


--
-- Name: staging_seattle_1753750382409; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750382409;


--
-- Name: staging_seattle_1753750383587; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750383587;


--
-- Name: staging_seattle_1753750387012; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750387012;


--
-- Name: staging_seattle_1753750389371; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750389371;


--
-- Name: staging_seattle_1753750398553; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750398553;


--
-- Name: staging_seattle_1753750399762; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750399762;


--
-- Name: staging_seattle_1753750402156; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750402156;


--
-- Name: staging_seattle_1753750403371; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750403371;


--
-- Name: staging_seattle_1753750406858; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750406858;


--
-- Name: staging_seattle_1753750409210; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750409210;


--
-- Name: staging_seattle_1753750410481; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750410481;


--
-- Name: staging_seattle_1753750411680; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750411680;


--
-- Name: staging_seattle_1753750415131; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750415131;


--
-- Name: staging_seattle_1753750416323; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750416323;


--
-- Name: staging_seattle_1753750417519; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750417519;


--
-- Name: staging_seattle_1753750422219; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750422219;


--
-- Name: staging_seattle_1753750442417; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750442417;


--
-- Name: staging_seattle_1753750443990; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750443990;


--
-- Name: staging_seattle_1753750446394; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750446394;


--
-- Name: staging_seattle_1753750447593; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750447593;


--
-- Name: staging_seattle_1753750451225; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750451225;


--
-- Name: staging_seattle_1753750453617; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750453617;


--
-- Name: staging_seattle_1753750454912; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750454912;


--
-- Name: staging_seattle_1753750456121; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750456121;


--
-- Name: staging_seattle_1753750459662; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750459662;


--
-- Name: staging_seattle_1753750460968; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750460968;


--
-- Name: staging_seattle_1753750462159; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750462159;


--
-- Name: staging_seattle_1753750466862; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750466862;


--
-- Name: staging_seattle_1753750527633; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750527633;


--
-- Name: staging_seattle_1753750528914; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750528914;


--
-- Name: staging_seattle_1753750531246; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750531246;


--
-- Name: staging_seattle_1753750532511; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750532511;


--
-- Name: staging_seattle_1753750535980; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750535980;


--
-- Name: staging_seattle_1753750538290; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750538290;


--
-- Name: staging_seattle_1753750539526; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750539526;


--
-- Name: staging_seattle_1753750540696; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750540696;


--
-- Name: staging_seattle_1753750544229; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750544229;


--
-- Name: staging_seattle_1753750545409; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750545409;


--
-- Name: staging_seattle_1753750546595; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750546595;


--
-- Name: staging_seattle_1753750551060; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_seattle_1753750551060;


--
-- Name: staging_test_1753750373186; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_test_1753750373186;


--
-- Name: staging_test_1753750423704; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_test_1753750423704;


--
-- Name: staging_test_1753750468790; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_test_1753750468790;


--
-- Name: staging_test_1753750553463; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_test_1753750553463;


--
-- Name: test_e2e_1753707593169; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA test_e2e_1753707593169;


--
-- Name: topology; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA topology;


--
-- Name: SCHEMA topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA topology IS 'PostGIS Topology schema';


--
-- Name: fuzzystrmatch; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;


--
-- Name: EXTENSION fuzzystrmatch; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION fuzzystrmatch IS 'determine similarities and distance between strings';


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
-- Name: postgis_topology; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_topology WITH SCHEMA topology;


--
-- Name: EXTENSION postgis_topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis_topology IS 'PostGIS topology spatial types and functions';


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
-- Name: build_routing_edges(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.build_routing_edges(staging_schema text, trails_table text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    edge_count integer;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Insert routing edges using optimized PostGIS spatial functions
    EXECUTE format('
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain)
        WITH trail_segments AS (
            -- Get all trail segments with validated geometry
            SELECT 
                id,
                app_uuid,
                name,
                ST_Force2D(geometry) as geometry,
                length_km,
                elevation_gain,
                ST_StartPoint(ST_Force2D(geometry)) as start_point,
                ST_EndPoint(ST_Force2D(geometry)) as end_point
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        node_connections AS (
            -- Find which nodes connect to each trail segment using spatial functions
            SELECT 
                ts.id as trail_id,
                ts.app_uuid as trail_uuid,
                ts.name as trail_name,
                ts.length_km,
                ts.elevation_gain,
                ts.geometry,
                -- Find start node using spatial proximity
                (SELECT n.id 
                 FROM %I.routing_nodes n 
                 WHERE ST_DWithin(ST_Force2D(ts.start_point), ST_Force2D(ST_SetSRID(ST_Point(n.lng, n.lat), 4326)), GREATEST(0.001, 0.001))
                 ORDER BY ST_Distance(ST_Force2D(ts.start_point), ST_Force2D(ST_SetSRID(ST_Point(n.lng, n.lat), 4326)))
                 LIMIT 1) as from_node_id,
                -- Find end node using spatial proximity
                (SELECT n.id 
                 FROM %I.routing_nodes n 
                 WHERE ST_DWithin(ST_Force2D(ts.end_point), ST_Force2D(ST_SetSRID(ST_Point(n.lng, n.lat), 4326)), GREATEST(0.001, 0.001))
                 ORDER BY ST_Distance(ST_Force2D(ts.end_point), ST_Force2D(ST_SetSRID(ST_Point(n.lng, n.lat), 4326)))
                 LIMIT 1) as to_node_id
            FROM trail_segments ts
        ),
        valid_edges AS (
            -- Only include edges where both nodes are found
            SELECT 
                trail_id,
                trail_uuid,
                trail_name,
                length_km,
                elevation_gain,
                geometry,
                from_node_id,
                to_node_id
            FROM node_connections
            WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL
        ),
        edge_metrics AS (
            -- Calculate accurate distances and validate spatial relationships
            SELECT 
                trail_id,
                trail_uuid,
                trail_name,
                from_node_id,
                to_node_id,
                COALESCE(length_km, ST_Length(geometry::geography) / 1000) as distance_km,
                COALESCE(elevation_gain, 0) as elevation_gain,
                -- Validate that nodes are actually connected to the trail
                ST_DWithin(
                    ST_Force2D(ST_SetSRID(ST_Point(
                        (SELECT lng FROM %I.routing_nodes WHERE id = from_node_id),
                        (SELECT lat FROM %I.routing_nodes WHERE id = from_node_id)
                    ), 4326)),
                    geometry,
                    GREATEST(0.001, 0.001)
                ) as start_connected,
                ST_DWithin(
                    ST_Force2D(ST_SetSRID(ST_Point(
                        (SELECT lng FROM %I.routing_nodes WHERE id = to_node_id),
                        (SELECT lat FROM %I.routing_nodes WHERE id = to_node_id)
                    ), 4326)),
                    geometry,
                    GREATEST(0.001, 0.001)
                ) as end_connected
            FROM valid_edges
        )
        SELECT 
            from_node_id,
            to_node_id,
            trail_uuid as trail_id,
            trail_name,
            distance_km,
            elevation_gain
        FROM edge_metrics
        WHERE start_connected AND end_connected
        ORDER BY trail_id
    ', staging_schema, staging_schema, trails_table, staging_schema, staging_schema, staging_schema, staging_schema);
    
    -- Get the count of inserted edges
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    RETURN edge_count;
END;
$$;


--
-- Name: build_routing_nodes(text, text, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.build_routing_nodes(staging_schema text, trails_table text, intersection_tolerance_meters double precision DEFAULT 2.0) RETURNS integer
    LANGUAGE plpgsql
    AS $_$
DECLARE
    node_count integer;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Insert routing nodes using optimized PostGIS spatial functions
    EXECUTE format('
        INSERT INTO %I.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails)
        WITH trail_endpoints AS (
            -- Extract start and end points of all trails using PostGIS functions
            SELECT 
                ST_StartPoint(ST_Force2D(geometry)) as start_point,
                ST_EndPoint(ST_Force2D(geometry)) as end_point,
                app_uuid,
                name
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        intersection_points AS (
            -- Use the enhanced intersection detection function
            SELECT 
                intersection_point,
                intersection_point_3d,
                connected_trail_ids,
                connected_trail_names,
                node_type,
                distance_meters
            FROM public.detect_trail_intersections(''%I'', ''%I'', GREATEST($1, 0.001))
            WHERE array_length(connected_trail_ids, 1) > 1  -- Only true intersections
        ),
        all_nodes AS (
            -- Combine intersection points and trail endpoints
            SELECT 
                intersection_point as point,
                intersection_point_3d as point_3d,
                connected_trail_names as connected_trails,
                ''intersection'' as node_type
            FROM intersection_points
            
            UNION ALL
            
            -- Trail start points
            SELECT 
                start_point as point,
                ST_Force3D(start_point) as point_3d,
                ARRAY[name] as connected_trails,
                ''endpoint'' as node_type
            FROM trail_endpoints
            
            UNION ALL
            
            -- Trail end points
            SELECT 
                end_point as point,
                ST_Force3D(end_point) as point_3d,
                ARRAY[name] as connected_trails,
                ''endpoint'' as node_type
            FROM trail_endpoints
        ),
        grouped_nodes AS (
            -- Group nearby nodes to avoid duplicates using spatial clustering
            SELECT 
                ST_X(point) as lng,
                ST_Y(point) as lat,
                COALESCE(ST_Z(point_3d), 0) as elevation,
                array_agg(DISTINCT unnest(connected_trails)) as all_connected_trails,
                CASE 
                    WHEN array_length(array_agg(DISTINCT unnest(connected_trails)), 1) > 1 THEN ''intersection''
                    ELSE ''endpoint''
                END as node_type,
                point,
                point_3d
            FROM all_nodes
            GROUP BY point, point_3d
        ),
        final_nodes AS (
            -- Remove duplicate nodes within tolerance distance
            SELECT DISTINCT ON (ST_SnapToGrid(point, GREATEST($1, 0.001)/1000))
                lng,
                lat,
                elevation,
                all_connected_trails,
                node_type
            FROM grouped_nodes
            ORDER BY ST_SnapToGrid(point, GREATEST($1, 0.001)/1000), array_length(all_connected_trails, 1) DESC
        )
        SELECT 
            gen_random_uuid()::text as node_uuid,
            lat,
            lng,
            elevation,
            node_type,
            array_to_string(all_connected_trails, '','') as connected_trails
        FROM final_nodes
        WHERE array_length(all_connected_trails, 1) > 0
    ', staging_schema, staging_schema, trails_table, staging_schema, trails_table)
    USING intersection_tolerance_meters;
    
    -- Get the count of inserted nodes
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    
    RETURN node_count;
END;
$_$;


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
-- Name: complete_trail_processing(text, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_trail_processing(p_region text, p_tolerance real DEFAULT 2.0) RETURNS TABLE(step text, count integer, message text)
    LANGUAGE plpgsql
    AS $$ DECLARE intersection_count INTEGER; node_count INTEGER; split_count INTEGER; edge_count INTEGER; BEGIN SELECT detect_trail_intersections(p_region, p_tolerance) INTO intersection_count; RETURN QUERY SELECT 'intersections'::text, intersection_count, 'Intersection points detected'::text; SELECT create_intersection_nodes(p_region) INTO node_count; RETURN QUERY SELECT 'intersection_nodes'::text, node_count, 'Intersection nodes created'::text; SELECT create_trailhead_nodes(p_region) INTO node_count; RETURN QUERY SELECT 'trailhead_nodes'::text, node_count, 'Trailhead nodes created'::text; SELECT split_trails_at_nodes(p_region) INTO split_count; RETURN QUERY SELECT 'split_segments'::text, split_count, 'Trail segments created'::text; SELECT build_routing_edges(p_region) INTO edge_count; RETURN QUERY SELECT 'routing_edges'::text, edge_count, 'Routing edges created'::text; END; $$;


--
-- Name: create_trailhead_nodes(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_trailhead_nodes(p_region text) RETURNS integer
    LANGUAGE plpgsql
    AS $$ DECLARE node_count INTEGER := 0; BEGIN INSERT INTO routing_nodes (node_id, lat, lng, geometry, node_type) SELECT 'start-' || t.app_uuid, ST_Y(ST_StartPoint(t.geometry)) as lat, ST_X(ST_StartPoint(t.geometry)) as lng, ST_Force2D(ST_StartPoint(t.geometry)) as geometry, 'trailhead' as node_type FROM trails t WHERE t.region = p_region UNION ALL SELECT 'end-' || t.app_uuid, ST_Y(ST_EndPoint(t.geometry)) as lat, ST_X(ST_EndPoint(t.geometry)) as lng, ST_Force2D(ST_EndPoint(t.geometry)) as geometry, 'trailhead' as node_type FROM trails t WHERE t.region = p_region; GET DIAGNOSTICS node_count = ROW_COUNT; RETURN node_count; END; $$;


--
-- Name: detect_trail_intersections(text, text, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_trail_intersections(trails_schema text, trails_table text, intersection_tolerance_meters double precision DEFAULT 1.0) RETURNS TABLE(intersection_point public.geometry, intersection_point_3d public.geometry, connected_trail_ids integer[], connected_trail_names text[], node_type text, distance_meters double precision)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE format('
        WITH noded_trails AS (
            -- Use ST_Node to split all trails at intersections (network topology)
            SELECT id, name, (ST_Dump(ST_Node(ST_Force2D(geometry)))).geom as noded_geom
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        true_intersections AS (
            -- True geometric intersections (where two trails cross/touch)
            SELECT 
                ST_Intersection(ST_Force2D(t1.noded_geom), ST_Force2D(t2.noded_geom)) as intersection_point,
                ST_Force3D(ST_Intersection(ST_Force2D(t1.noded_geom), ST_Force2D(t2.noded_geom))) as intersection_point_3d,
                ARRAY[t1.id, t2.id] as connected_trail_ids,
                ARRAY[t1.name, t2.name] as connected_trail_names,
                ''intersection'' as node_type,
                0.0 as distance_meters
            FROM noded_trails t1
            JOIN noded_trails t2 ON (t1.id < t2.id)
            WHERE ST_Intersects(ST_Force2D(t1.noded_geom), ST_Force2D(t2.noded_geom))
              AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.noded_geom), ST_Force2D(t2.noded_geom))) = ''ST_Point''
        ),
        endpoint_near_miss AS (
            -- Endpoints within a tight threshold (1.0 meter)
            SELECT 
                ST_EndPoint(ST_Force2D(t1.noded_geom)) as intersection_point,
                ST_Force3D(ST_EndPoint(ST_Force2D(t1.noded_geom))) as intersection_point_3d,
                ARRAY[t1.id, t2.id] as connected_trail_ids,
                ARRAY[t1.name, t2.name] as connected_trail_names,
                ''endpoint_near_miss'' as node_type,
                ST_Distance(ST_EndPoint(ST_Force2D(t1.noded_geom)), ST_EndPoint(ST_Force2D(t2.noded_geom))) as distance_meters
            FROM noded_trails t1
            JOIN noded_trails t2 ON (t1.id < t2.id)
            WHERE ST_DWithin(ST_EndPoint(ST_Force2D(t1.noded_geom)), ST_EndPoint(ST_Force2D(t2.noded_geom)), GREATEST($1, 0.001))
        ),
        all_intersections AS (
            SELECT * FROM true_intersections
            UNION ALL
            SELECT * FROM endpoint_near_miss
        )
        SELECT 
            intersection_point,
            intersection_point_3d,
            connected_trail_ids,
            connected_trail_names,
            node_type,
            distance_meters
        FROM all_intersections
        ORDER BY distance_meters, intersection_point
    ', trails_schema, trails_table)
    USING intersection_tolerance_meters;
END;
$_$;


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
    ST_SimplifyPreserveTopology(ST_Force2D(geometry), 0.0001) AS geom
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
-- Name: get_intersection_stats(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_intersection_stats(staging_schema text) RETURNS TABLE(total_nodes integer, intersection_nodes integer, endpoint_nodes integer, total_edges integer, node_to_trail_ratio double precision, processing_time_ms integer)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    start_time timestamp;
    end_time timestamp;
    trail_count integer;
BEGIN
    start_time := clock_timestamp();
    
    -- Get trail count
    EXECUTE format('SELECT COUNT(*) FROM %I.trails', staging_schema) INTO trail_count;
    
    -- Get node and edge counts
    RETURN QUERY EXECUTE format('
        SELECT 
            (SELECT COUNT(*) FROM %I.routing_nodes) as total_nodes,
            (SELECT COUNT(*) FROM %I.routing_nodes WHERE node_type = ''intersection'') as intersection_nodes,
            (SELECT COUNT(*) FROM %I.routing_nodes WHERE node_type = ''endpoint'') as endpoint_nodes,
            (SELECT COUNT(*) FROM %I.routing_edges) as total_edges,
            CASE 
                WHEN $1 > 0 THEN (SELECT COUNT(*) FROM %I.routing_nodes)::float / $1
                ELSE 0
            END as node_to_trail_ratio,
            EXTRACT(EPOCH FROM (clock_timestamp() - $2::timestamp)) * 1000 as processing_time_ms
    ', staging_schema, staging_schema, staging_schema, staging_schema, staging_schema)
    USING trail_count, start_time;
    
    end_time := clock_timestamp();
END;
$_$;


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
-- Name: validate_intersection_detection(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_intersection_detection(staging_schema text) RETURNS TABLE(validation_check text, status text, details text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if nodes exist
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Nodes exist'' as validation_check,
            CASE WHEN COUNT(*) > 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' nodes found'' as details
        FROM %I.routing_nodes
    ', staging_schema);
    
    -- Check if edges exist
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Edges exist'' as validation_check,
            CASE WHEN COUNT(*) > 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' edges found'' as details
        FROM %I.routing_edges
    ', staging_schema);
    
    -- Check node types
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Node types valid'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' invalid node types found'' as details
        FROM %I.routing_nodes 
        WHERE node_type NOT IN (''intersection'', ''endpoint'')
    ', staging_schema);
    
    -- Check for self-loops
    RETURN QUERY EXECUTE format('
        SELECT 
            ''No self-loops'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' self-loops found'' as details
        FROM %I.routing_edges 
        WHERE from_node_id = to_node_id
    ', staging_schema);
    
    -- Check node-to-trail ratio
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Node-to-trail ratio'' as validation_check,
            CASE 
                WHEN ratio <= 0.5 THEN ''PASS''
                WHEN ratio <= 1.0 THEN ''WARNING''
                ELSE ''FAIL''
            END as status,
            ROUND(ratio * 100, 1)::text || ''%% ratio (target: <50%%)'' as details
        FROM (
            SELECT 
                (SELECT COUNT(*) FROM %I.routing_nodes)::float / 
                (SELECT COUNT(*) FROM %I.trails) as ratio
        ) ratios
    ', staging_schema, staging_schema);
END;
$$;


--
-- Name: validate_spatial_data_integrity(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_spatial_data_integrity(staging_schema text) RETURNS TABLE(validation_check text, status text, details text, severity text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Validate all geometries are valid using ST_IsValid()
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Geometry validity'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' invalid geometries found'' as details,
            ''ERROR'' as severity
        FROM %I.trails 
        WHERE geometry IS NOT NULL AND NOT ST_IsValid(geometry)
    ', staging_schema);
    
    -- Ensure coordinate system consistency (SRID 4326)
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Coordinate system consistency'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' geometries with wrong SRID'' as details,
            ''ERROR'' as severity
        FROM %I.trails 
        WHERE geometry IS NOT NULL AND ST_SRID(geometry) != 4326
    ', staging_schema);
    
    -- Validate intersection nodes have proper trail connections
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Intersection node connections'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' intersection nodes with <2 connected trails'' as details,
            ''ERROR'' as severity
        FROM %I.routing_nodes 
        WHERE node_type = ''intersection'' AND 
              array_length(string_to_array(connected_trails, '',''), 1) < 2
    ', staging_schema);
    
    -- Check for spatial containment issues
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Spatial containment'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''WARNING'' END as status,
            COUNT(*)::text || '' trails outside region bbox'' as details,
            ''WARNING'' as severity
        FROM %I.trails t
        WHERE geometry IS NOT NULL AND NOT ST_Within(
            geometry, 
            ST_MakeEnvelope(
                MIN(bbox_min_lng), MIN(bbox_min_lat), 
                MAX(bbox_max_lng), MAX(bbox_max_lat), 4326
            )
        )
    ', staging_schema);
    
    -- Validate elevation data consistency
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Elevation data consistency'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''WARNING'' END as status,
            COUNT(*)::text || '' trails with inconsistent elevation data'' as details,
            ''WARNING'' as severity
        FROM %I.trails 
        WHERE geometry IS NOT NULL AND ST_NDims(geometry) = 3 AND
              (elevation_gain IS NULL OR elevation_loss IS NULL OR 
               max_elevation IS NULL OR min_elevation IS NULL)
    ', staging_schema);
    
    -- Check for duplicate nodes within tolerance
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Node uniqueness'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''WARNING'' END as status,
            COUNT(*)::text || '' duplicate nodes within tolerance'' as details,
            ''WARNING'' as severity
        FROM (
            SELECT COUNT(*) as dup_count
            FROM %I.routing_nodes n1
            JOIN %I.routing_nodes n2 ON (
                n1.id != n2.id AND
                ST_DWithin(
                    ST_SetSRID(ST_Point(n1.lng, n1.lat), 4326),
                    ST_SetSRID(ST_Point(n2.lng, n2.lat), 4326),
                    0.001
                )
            )
        ) duplicates
        WHERE dup_count > 0
    ', staging_schema, staging_schema);
    
    -- Validate edge connectivity
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Edge connectivity'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' edges with invalid node connections'' as details,
            ''ERROR'' as severity
        FROM %I.routing_edges e
        LEFT JOIN %I.routing_nodes n1 ON e.from_node_id = n1.id
        LEFT JOIN %I.routing_nodes n2 ON e.to_node_id = n2.id
        WHERE n1.id IS NULL OR n2.id IS NULL
    ', staging_schema, staging_schema, staging_schema);
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
-- Name: region_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.region_metadata (
    id integer NOT NULL,
    region_name text NOT NULL,
    bbox_min_lng real,
    bbox_max_lng real,
    bbox_min_lat real,
    bbox_max_lat real,
    trail_count integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT region_metadata_trail_count_check CHECK ((trail_count >= 0))
);


--
-- Name: region_metadata_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.region_metadata_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: region_metadata_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.region_metadata_id_seq OWNED BY public.region_metadata.id;


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
-- Name: TABLE routing_edges; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.routing_edges IS 'Trail segments connecting routing nodes';


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
-- Name: TABLE routing_nodes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.routing_nodes IS 'Intersection and endpoint nodes for routing';


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
    CONSTRAINT chk_split_trails_valid_geometry CHECK (public.st_isvalid(geometry)),
    CONSTRAINT split_trails_elevation_gain_check CHECK ((elevation_gain >= (0)::double precision)),
    CONSTRAINT split_trails_elevation_loss_check CHECK ((elevation_loss >= (0)::double precision)),
    CONSTRAINT split_trails_length_km_check CHECK ((length_km > (0)::double precision))
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
-- Name: trails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trails (
    id integer NOT NULL,
    original_trail_id integer,
    segment_number integer,
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
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    region text DEFAULT 'boulder'::text,
    CONSTRAINT trails_elevation_gain_check CHECK ((elevation_gain >= (0)::double precision)),
    CONSTRAINT trails_elevation_loss_check CHECK ((elevation_loss >= (0)::double precision)),
    CONSTRAINT trails_length_km_check CHECK ((length_km > (0)::double precision))
);


--
-- Name: TABLE trails; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.trails IS 'Master trails table with 3D geo2 and elevation data';


--
-- Name: COLUMN trails.elevation_gain; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trails.elevation_gain IS 'Total elevation gain in meters';


--
-- Name: COLUMN trails.elevation_loss; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trails.elevation_loss IS 'Total elevation loss in meters';


--
-- Name: COLUMN trails.length_km; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trails.length_km IS 'Trail length in kilometers';


--
-- Name: temp_split_trails_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.temp_split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: temp_split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.temp_split_trails_id_seq OWNED BY public.trails.id;


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
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE TABLE staging_boulder_1753750357844.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750357844.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750357844.intersection_points_id_seq OWNED BY staging_boulder_1753750357844.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE TABLE staging_boulder_1753750357844.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750357844.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750357844.routing_edges_id_seq OWNED BY staging_boulder_1753750357844.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE TABLE staging_boulder_1753750357844.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750357844.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750357844.routing_nodes_id_seq OWNED BY staging_boulder_1753750357844.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE TABLE staging_boulder_1753750357844.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750357844.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750357844.split_trails_id_seq OWNED BY staging_boulder_1753750357844.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE TABLE staging_boulder_1753750357844.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750357844.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750357844.trail_hashes_id_seq OWNED BY staging_boulder_1753750357844.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE TABLE staging_boulder_1753750357844.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750357844.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750357844.trails_id_seq OWNED BY staging_boulder_1753750357844.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE TABLE staging_boulder_1753750358170.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750358170.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750358170.intersection_points_id_seq OWNED BY staging_boulder_1753750358170.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE TABLE staging_boulder_1753750358170.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750358170.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750358170.routing_edges_id_seq OWNED BY staging_boulder_1753750358170.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE TABLE staging_boulder_1753750358170.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750358170.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750358170.routing_nodes_id_seq OWNED BY staging_boulder_1753750358170.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE TABLE staging_boulder_1753750358170.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750358170.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750358170.split_trails_id_seq OWNED BY staging_boulder_1753750358170.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE TABLE staging_boulder_1753750358170.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750358170.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750358170.trail_hashes_id_seq OWNED BY staging_boulder_1753750358170.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE TABLE staging_boulder_1753750358170.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750358170.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750358170.trails_id_seq OWNED BY staging_boulder_1753750358170.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE TABLE staging_boulder_1753750422402.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750422402.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750422402.intersection_points_id_seq OWNED BY staging_boulder_1753750422402.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE TABLE staging_boulder_1753750422402.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750422402.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750422402.routing_edges_id_seq OWNED BY staging_boulder_1753750422402.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE TABLE staging_boulder_1753750422402.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750422402.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750422402.routing_nodes_id_seq OWNED BY staging_boulder_1753750422402.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE TABLE staging_boulder_1753750422402.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750422402.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750422402.split_trails_id_seq OWNED BY staging_boulder_1753750422402.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE TABLE staging_boulder_1753750422402.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750422402.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750422402.trail_hashes_id_seq OWNED BY staging_boulder_1753750422402.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE TABLE staging_boulder_1753750422402.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750422402.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750422402.trails_id_seq OWNED BY staging_boulder_1753750422402.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE TABLE staging_boulder_1753750422846.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750422846.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750422846.intersection_points_id_seq OWNED BY staging_boulder_1753750422846.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE TABLE staging_boulder_1753750422846.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750422846.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750422846.routing_edges_id_seq OWNED BY staging_boulder_1753750422846.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE TABLE staging_boulder_1753750422846.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750422846.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750422846.routing_nodes_id_seq OWNED BY staging_boulder_1753750422846.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE TABLE staging_boulder_1753750422846.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750422846.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750422846.split_trails_id_seq OWNED BY staging_boulder_1753750422846.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE TABLE staging_boulder_1753750422846.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750422846.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750422846.trail_hashes_id_seq OWNED BY staging_boulder_1753750422846.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE TABLE staging_boulder_1753750422846.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750422846.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750422846.trails_id_seq OWNED BY staging_boulder_1753750422846.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE TABLE staging_boulder_1753750467330.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750467330.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750467330.intersection_points_id_seq OWNED BY staging_boulder_1753750467330.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE TABLE staging_boulder_1753750467330.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750467330.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750467330.routing_edges_id_seq OWNED BY staging_boulder_1753750467330.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE TABLE staging_boulder_1753750467330.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750467330.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750467330.routing_nodes_id_seq OWNED BY staging_boulder_1753750467330.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE TABLE staging_boulder_1753750467330.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750467330.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750467330.split_trails_id_seq OWNED BY staging_boulder_1753750467330.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE TABLE staging_boulder_1753750467330.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750467330.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750467330.trail_hashes_id_seq OWNED BY staging_boulder_1753750467330.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE TABLE staging_boulder_1753750467330.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750467330.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750467330.trails_id_seq OWNED BY staging_boulder_1753750467330.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE TABLE staging_boulder_1753750467617.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750467617.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750467617.intersection_points_id_seq OWNED BY staging_boulder_1753750467617.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE TABLE staging_boulder_1753750467617.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750467617.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750467617.routing_edges_id_seq OWNED BY staging_boulder_1753750467617.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE TABLE staging_boulder_1753750467617.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750467617.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750467617.routing_nodes_id_seq OWNED BY staging_boulder_1753750467617.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE TABLE staging_boulder_1753750467617.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750467617.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750467617.split_trails_id_seq OWNED BY staging_boulder_1753750467617.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE TABLE staging_boulder_1753750467617.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750467617.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750467617.trail_hashes_id_seq OWNED BY staging_boulder_1753750467617.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE TABLE staging_boulder_1753750467617.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750467617.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750467617.trails_id_seq OWNED BY staging_boulder_1753750467617.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE TABLE staging_boulder_1753750552692.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750552692.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750552692.intersection_points_id_seq OWNED BY staging_boulder_1753750552692.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE TABLE staging_boulder_1753750552692.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750552692.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750552692.routing_edges_id_seq OWNED BY staging_boulder_1753750552692.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE TABLE staging_boulder_1753750552692.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750552692.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750552692.routing_nodes_id_seq OWNED BY staging_boulder_1753750552692.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE TABLE staging_boulder_1753750552692.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750552692.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750552692.split_trails_id_seq OWNED BY staging_boulder_1753750552692.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE TABLE staging_boulder_1753750552692.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750552692.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750552692.trail_hashes_id_seq OWNED BY staging_boulder_1753750552692.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE TABLE staging_boulder_1753750552692.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750552692.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750552692.trails_id_seq OWNED BY staging_boulder_1753750552692.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE TABLE staging_boulder_1753750552888.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750552888.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750552888.intersection_points_id_seq OWNED BY staging_boulder_1753750552888.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE TABLE staging_boulder_1753750552888.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750552888.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750552888.routing_edges_id_seq OWNED BY staging_boulder_1753750552888.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE TABLE staging_boulder_1753750552888.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750552888.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750552888.routing_nodes_id_seq OWNED BY staging_boulder_1753750552888.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE TABLE staging_boulder_1753750552888.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750552888.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750552888.split_trails_id_seq OWNED BY staging_boulder_1753750552888.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE TABLE staging_boulder_1753750552888.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750552888.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750552888.trail_hashes_id_seq OWNED BY staging_boulder_1753750552888.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE TABLE staging_boulder_1753750552888.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE SEQUENCE staging_boulder_1753750552888.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER SEQUENCE staging_boulder_1753750552888.trails_id_seq OWNED BY staging_boulder_1753750552888.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE TABLE staging_seattle_1753750361222.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750361222.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750361222.intersection_points_id_seq OWNED BY staging_seattle_1753750361222.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE TABLE staging_seattle_1753750361222.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750361222.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750361222.routing_edges_id_seq OWNED BY staging_seattle_1753750361222.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE TABLE staging_seattle_1753750361222.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750361222.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750361222.routing_nodes_id_seq OWNED BY staging_seattle_1753750361222.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE TABLE staging_seattle_1753750361222.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750361222.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750361222.split_trails_id_seq OWNED BY staging_seattle_1753750361222.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE TABLE staging_seattle_1753750361222.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750361222.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750361222.trail_hashes_id_seq OWNED BY staging_seattle_1753750361222.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE TABLE staging_seattle_1753750361222.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750361222.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750361222.trails_id_seq OWNED BY staging_seattle_1753750361222.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE TABLE staging_seattle_1753750362437.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750362437.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750362437.intersection_points_id_seq OWNED BY staging_seattle_1753750362437.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE TABLE staging_seattle_1753750362437.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750362437.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750362437.routing_edges_id_seq OWNED BY staging_seattle_1753750362437.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE TABLE staging_seattle_1753750362437.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750362437.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750362437.routing_nodes_id_seq OWNED BY staging_seattle_1753750362437.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE TABLE staging_seattle_1753750362437.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750362437.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750362437.split_trails_id_seq OWNED BY staging_seattle_1753750362437.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE TABLE staging_seattle_1753750362437.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750362437.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750362437.trail_hashes_id_seq OWNED BY staging_seattle_1753750362437.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE TABLE staging_seattle_1753750362437.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750362437.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750362437.trails_id_seq OWNED BY staging_seattle_1753750362437.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE TABLE staging_seattle_1753750365906.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750365906.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750365906.intersection_points_id_seq OWNED BY staging_seattle_1753750365906.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE TABLE staging_seattle_1753750365906.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750365906.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750365906.routing_edges_id_seq OWNED BY staging_seattle_1753750365906.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE TABLE staging_seattle_1753750365906.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750365906.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750365906.routing_nodes_id_seq OWNED BY staging_seattle_1753750365906.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE TABLE staging_seattle_1753750365906.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750365906.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750365906.split_trails_id_seq OWNED BY staging_seattle_1753750365906.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE TABLE staging_seattle_1753750365906.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750365906.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750365906.trail_hashes_id_seq OWNED BY staging_seattle_1753750365906.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE TABLE staging_seattle_1753750365906.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750365906.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750365906.trails_id_seq OWNED BY staging_seattle_1753750365906.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE TABLE staging_seattle_1753750367114.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750367114.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750367114.intersection_points_id_seq OWNED BY staging_seattle_1753750367114.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE TABLE staging_seattle_1753750367114.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750367114.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750367114.routing_edges_id_seq OWNED BY staging_seattle_1753750367114.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE TABLE staging_seattle_1753750367114.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750367114.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750367114.routing_nodes_id_seq OWNED BY staging_seattle_1753750367114.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE TABLE staging_seattle_1753750367114.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750367114.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750367114.split_trails_id_seq OWNED BY staging_seattle_1753750367114.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE TABLE staging_seattle_1753750367114.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750367114.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750367114.trail_hashes_id_seq OWNED BY staging_seattle_1753750367114.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE TABLE staging_seattle_1753750367114.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750367114.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750367114.trails_id_seq OWNED BY staging_seattle_1753750367114.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE TABLE staging_seattle_1753750368341.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750368341.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750368341.intersection_points_id_seq OWNED BY staging_seattle_1753750368341.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE TABLE staging_seattle_1753750368341.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750368341.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750368341.routing_edges_id_seq OWNED BY staging_seattle_1753750368341.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE TABLE staging_seattle_1753750368341.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750368341.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750368341.routing_nodes_id_seq OWNED BY staging_seattle_1753750368341.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE TABLE staging_seattle_1753750368341.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750368341.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750368341.split_trails_id_seq OWNED BY staging_seattle_1753750368341.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE TABLE staging_seattle_1753750368341.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750368341.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750368341.trail_hashes_id_seq OWNED BY staging_seattle_1753750368341.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE TABLE staging_seattle_1753750368341.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750368341.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750368341.trails_id_seq OWNED BY staging_seattle_1753750368341.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE TABLE staging_seattle_1753750372953.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750372953.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750372953.intersection_points_id_seq OWNED BY staging_seattle_1753750372953.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE TABLE staging_seattle_1753750372953.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750372953.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750372953.routing_edges_id_seq OWNED BY staging_seattle_1753750372953.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE TABLE staging_seattle_1753750372953.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750372953.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750372953.routing_nodes_id_seq OWNED BY staging_seattle_1753750372953.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE TABLE staging_seattle_1753750372953.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750372953.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750372953.split_trails_id_seq OWNED BY staging_seattle_1753750372953.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE TABLE staging_seattle_1753750372953.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750372953.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750372953.trail_hashes_id_seq OWNED BY staging_seattle_1753750372953.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE TABLE staging_seattle_1753750372953.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750372953.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750372953.trails_id_seq OWNED BY staging_seattle_1753750372953.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE TABLE staging_seattle_1753750378967.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750378967.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750378967.intersection_points_id_seq OWNED BY staging_seattle_1753750378967.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE TABLE staging_seattle_1753750378967.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750378967.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750378967.routing_edges_id_seq OWNED BY staging_seattle_1753750378967.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE TABLE staging_seattle_1753750378967.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750378967.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750378967.routing_nodes_id_seq OWNED BY staging_seattle_1753750378967.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE TABLE staging_seattle_1753750378967.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750378967.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750378967.split_trails_id_seq OWNED BY staging_seattle_1753750378967.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE TABLE staging_seattle_1753750378967.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750378967.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750378967.trail_hashes_id_seq OWNED BY staging_seattle_1753750378967.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE TABLE staging_seattle_1753750378967.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750378967.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750378967.trails_id_seq OWNED BY staging_seattle_1753750378967.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE TABLE staging_seattle_1753750380156.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750380156.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750380156.intersection_points_id_seq OWNED BY staging_seattle_1753750380156.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE TABLE staging_seattle_1753750380156.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750380156.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750380156.routing_edges_id_seq OWNED BY staging_seattle_1753750380156.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE TABLE staging_seattle_1753750380156.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750380156.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750380156.routing_nodes_id_seq OWNED BY staging_seattle_1753750380156.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE TABLE staging_seattle_1753750380156.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750380156.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750380156.split_trails_id_seq OWNED BY staging_seattle_1753750380156.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE TABLE staging_seattle_1753750380156.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750380156.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750380156.trail_hashes_id_seq OWNED BY staging_seattle_1753750380156.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE TABLE staging_seattle_1753750380156.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750380156.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750380156.trails_id_seq OWNED BY staging_seattle_1753750380156.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE TABLE staging_seattle_1753750382409.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750382409.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750382409.intersection_points_id_seq OWNED BY staging_seattle_1753750382409.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE TABLE staging_seattle_1753750382409.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750382409.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750382409.routing_edges_id_seq OWNED BY staging_seattle_1753750382409.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE TABLE staging_seattle_1753750382409.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750382409.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750382409.routing_nodes_id_seq OWNED BY staging_seattle_1753750382409.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE TABLE staging_seattle_1753750382409.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750382409.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750382409.split_trails_id_seq OWNED BY staging_seattle_1753750382409.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE TABLE staging_seattle_1753750382409.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750382409.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750382409.trail_hashes_id_seq OWNED BY staging_seattle_1753750382409.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE TABLE staging_seattle_1753750382409.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750382409.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750382409.trails_id_seq OWNED BY staging_seattle_1753750382409.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE TABLE staging_seattle_1753750383587.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750383587.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750383587.intersection_points_id_seq OWNED BY staging_seattle_1753750383587.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE TABLE staging_seattle_1753750383587.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750383587.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750383587.routing_edges_id_seq OWNED BY staging_seattle_1753750383587.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE TABLE staging_seattle_1753750383587.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750383587.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750383587.routing_nodes_id_seq OWNED BY staging_seattle_1753750383587.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE TABLE staging_seattle_1753750383587.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750383587.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750383587.split_trails_id_seq OWNED BY staging_seattle_1753750383587.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE TABLE staging_seattle_1753750383587.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750383587.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750383587.trail_hashes_id_seq OWNED BY staging_seattle_1753750383587.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE TABLE staging_seattle_1753750383587.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750383587.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750383587.trails_id_seq OWNED BY staging_seattle_1753750383587.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE TABLE staging_seattle_1753750387012.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750387012.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750387012.intersection_points_id_seq OWNED BY staging_seattle_1753750387012.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE TABLE staging_seattle_1753750387012.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750387012.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750387012.routing_edges_id_seq OWNED BY staging_seattle_1753750387012.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE TABLE staging_seattle_1753750387012.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750387012.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750387012.routing_nodes_id_seq OWNED BY staging_seattle_1753750387012.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE TABLE staging_seattle_1753750387012.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750387012.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750387012.split_trails_id_seq OWNED BY staging_seattle_1753750387012.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE TABLE staging_seattle_1753750387012.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750387012.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750387012.trail_hashes_id_seq OWNED BY staging_seattle_1753750387012.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE TABLE staging_seattle_1753750387012.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750387012.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750387012.trails_id_seq OWNED BY staging_seattle_1753750387012.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE TABLE staging_seattle_1753750389371.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750389371.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750389371.intersection_points_id_seq OWNED BY staging_seattle_1753750389371.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE TABLE staging_seattle_1753750389371.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750389371.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750389371.routing_edges_id_seq OWNED BY staging_seattle_1753750389371.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE TABLE staging_seattle_1753750389371.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750389371.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750389371.routing_nodes_id_seq OWNED BY staging_seattle_1753750389371.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE TABLE staging_seattle_1753750389371.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750389371.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750389371.split_trails_id_seq OWNED BY staging_seattle_1753750389371.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE TABLE staging_seattle_1753750389371.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750389371.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750389371.trail_hashes_id_seq OWNED BY staging_seattle_1753750389371.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE TABLE staging_seattle_1753750389371.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750389371.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750389371.trails_id_seq OWNED BY staging_seattle_1753750389371.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE TABLE staging_seattle_1753750398553.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750398553.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750398553.intersection_points_id_seq OWNED BY staging_seattle_1753750398553.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE TABLE staging_seattle_1753750398553.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750398553.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750398553.routing_edges_id_seq OWNED BY staging_seattle_1753750398553.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE TABLE staging_seattle_1753750398553.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750398553.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750398553.routing_nodes_id_seq OWNED BY staging_seattle_1753750398553.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE TABLE staging_seattle_1753750398553.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750398553.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750398553.split_trails_id_seq OWNED BY staging_seattle_1753750398553.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE TABLE staging_seattle_1753750398553.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750398553.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750398553.trail_hashes_id_seq OWNED BY staging_seattle_1753750398553.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE TABLE staging_seattle_1753750398553.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750398553.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750398553.trails_id_seq OWNED BY staging_seattle_1753750398553.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE TABLE staging_seattle_1753750399762.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750399762.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750399762.intersection_points_id_seq OWNED BY staging_seattle_1753750399762.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE TABLE staging_seattle_1753750399762.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750399762.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750399762.routing_edges_id_seq OWNED BY staging_seattle_1753750399762.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE TABLE staging_seattle_1753750399762.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750399762.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750399762.routing_nodes_id_seq OWNED BY staging_seattle_1753750399762.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE TABLE staging_seattle_1753750399762.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750399762.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750399762.split_trails_id_seq OWNED BY staging_seattle_1753750399762.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE TABLE staging_seattle_1753750399762.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750399762.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750399762.trail_hashes_id_seq OWNED BY staging_seattle_1753750399762.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE TABLE staging_seattle_1753750399762.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750399762.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750399762.trails_id_seq OWNED BY staging_seattle_1753750399762.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE TABLE staging_seattle_1753750402156.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750402156.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750402156.intersection_points_id_seq OWNED BY staging_seattle_1753750402156.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE TABLE staging_seattle_1753750402156.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750402156.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750402156.routing_edges_id_seq OWNED BY staging_seattle_1753750402156.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE TABLE staging_seattle_1753750402156.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750402156.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750402156.routing_nodes_id_seq OWNED BY staging_seattle_1753750402156.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE TABLE staging_seattle_1753750402156.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750402156.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750402156.split_trails_id_seq OWNED BY staging_seattle_1753750402156.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE TABLE staging_seattle_1753750402156.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750402156.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750402156.trail_hashes_id_seq OWNED BY staging_seattle_1753750402156.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE TABLE staging_seattle_1753750402156.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750402156.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750402156.trails_id_seq OWNED BY staging_seattle_1753750402156.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE TABLE staging_seattle_1753750403371.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750403371.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750403371.intersection_points_id_seq OWNED BY staging_seattle_1753750403371.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE TABLE staging_seattle_1753750403371.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750403371.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750403371.routing_edges_id_seq OWNED BY staging_seattle_1753750403371.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE TABLE staging_seattle_1753750403371.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750403371.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750403371.routing_nodes_id_seq OWNED BY staging_seattle_1753750403371.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE TABLE staging_seattle_1753750403371.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750403371.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750403371.split_trails_id_seq OWNED BY staging_seattle_1753750403371.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE TABLE staging_seattle_1753750403371.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750403371.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750403371.trail_hashes_id_seq OWNED BY staging_seattle_1753750403371.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE TABLE staging_seattle_1753750403371.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750403371.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750403371.trails_id_seq OWNED BY staging_seattle_1753750403371.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE TABLE staging_seattle_1753750406858.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750406858.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750406858.intersection_points_id_seq OWNED BY staging_seattle_1753750406858.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE TABLE staging_seattle_1753750406858.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750406858.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750406858.routing_edges_id_seq OWNED BY staging_seattle_1753750406858.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE TABLE staging_seattle_1753750406858.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750406858.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750406858.routing_nodes_id_seq OWNED BY staging_seattle_1753750406858.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE TABLE staging_seattle_1753750406858.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750406858.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750406858.split_trails_id_seq OWNED BY staging_seattle_1753750406858.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE TABLE staging_seattle_1753750406858.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750406858.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750406858.trail_hashes_id_seq OWNED BY staging_seattle_1753750406858.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE TABLE staging_seattle_1753750406858.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750406858.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750406858.trails_id_seq OWNED BY staging_seattle_1753750406858.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE TABLE staging_seattle_1753750409210.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750409210.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750409210.intersection_points_id_seq OWNED BY staging_seattle_1753750409210.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE TABLE staging_seattle_1753750409210.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750409210.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750409210.routing_edges_id_seq OWNED BY staging_seattle_1753750409210.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE TABLE staging_seattle_1753750409210.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750409210.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750409210.routing_nodes_id_seq OWNED BY staging_seattle_1753750409210.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE TABLE staging_seattle_1753750409210.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750409210.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750409210.split_trails_id_seq OWNED BY staging_seattle_1753750409210.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE TABLE staging_seattle_1753750409210.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750409210.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750409210.trail_hashes_id_seq OWNED BY staging_seattle_1753750409210.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE TABLE staging_seattle_1753750409210.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750409210.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750409210.trails_id_seq OWNED BY staging_seattle_1753750409210.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE TABLE staging_seattle_1753750410481.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750410481.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750410481.intersection_points_id_seq OWNED BY staging_seattle_1753750410481.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE TABLE staging_seattle_1753750410481.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750410481.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750410481.routing_edges_id_seq OWNED BY staging_seattle_1753750410481.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE TABLE staging_seattle_1753750410481.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750410481.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750410481.routing_nodes_id_seq OWNED BY staging_seattle_1753750410481.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE TABLE staging_seattle_1753750410481.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750410481.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750410481.split_trails_id_seq OWNED BY staging_seattle_1753750410481.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE TABLE staging_seattle_1753750410481.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750410481.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750410481.trail_hashes_id_seq OWNED BY staging_seattle_1753750410481.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE TABLE staging_seattle_1753750410481.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750410481.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750410481.trails_id_seq OWNED BY staging_seattle_1753750410481.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE TABLE staging_seattle_1753750411680.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750411680.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750411680.intersection_points_id_seq OWNED BY staging_seattle_1753750411680.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE TABLE staging_seattle_1753750411680.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750411680.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750411680.routing_edges_id_seq OWNED BY staging_seattle_1753750411680.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE TABLE staging_seattle_1753750411680.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750411680.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750411680.routing_nodes_id_seq OWNED BY staging_seattle_1753750411680.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE TABLE staging_seattle_1753750411680.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750411680.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750411680.split_trails_id_seq OWNED BY staging_seattle_1753750411680.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE TABLE staging_seattle_1753750411680.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750411680.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750411680.trail_hashes_id_seq OWNED BY staging_seattle_1753750411680.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE TABLE staging_seattle_1753750411680.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750411680.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750411680.trails_id_seq OWNED BY staging_seattle_1753750411680.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE TABLE staging_seattle_1753750415131.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750415131.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750415131.intersection_points_id_seq OWNED BY staging_seattle_1753750415131.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE TABLE staging_seattle_1753750415131.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750415131.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750415131.routing_edges_id_seq OWNED BY staging_seattle_1753750415131.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE TABLE staging_seattle_1753750415131.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750415131.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750415131.routing_nodes_id_seq OWNED BY staging_seattle_1753750415131.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE TABLE staging_seattle_1753750415131.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750415131.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750415131.split_trails_id_seq OWNED BY staging_seattle_1753750415131.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE TABLE staging_seattle_1753750415131.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750415131.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750415131.trail_hashes_id_seq OWNED BY staging_seattle_1753750415131.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE TABLE staging_seattle_1753750415131.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750415131.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750415131.trails_id_seq OWNED BY staging_seattle_1753750415131.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE TABLE staging_seattle_1753750416323.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750416323.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750416323.intersection_points_id_seq OWNED BY staging_seattle_1753750416323.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE TABLE staging_seattle_1753750416323.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750416323.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750416323.routing_edges_id_seq OWNED BY staging_seattle_1753750416323.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE TABLE staging_seattle_1753750416323.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750416323.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750416323.routing_nodes_id_seq OWNED BY staging_seattle_1753750416323.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE TABLE staging_seattle_1753750416323.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750416323.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750416323.split_trails_id_seq OWNED BY staging_seattle_1753750416323.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE TABLE staging_seattle_1753750416323.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750416323.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750416323.trail_hashes_id_seq OWNED BY staging_seattle_1753750416323.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE TABLE staging_seattle_1753750416323.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750416323.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750416323.trails_id_seq OWNED BY staging_seattle_1753750416323.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE TABLE staging_seattle_1753750417519.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750417519.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750417519.intersection_points_id_seq OWNED BY staging_seattle_1753750417519.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE TABLE staging_seattle_1753750417519.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750417519.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750417519.routing_edges_id_seq OWNED BY staging_seattle_1753750417519.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE TABLE staging_seattle_1753750417519.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750417519.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750417519.routing_nodes_id_seq OWNED BY staging_seattle_1753750417519.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE TABLE staging_seattle_1753750417519.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750417519.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750417519.split_trails_id_seq OWNED BY staging_seattle_1753750417519.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE TABLE staging_seattle_1753750417519.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750417519.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750417519.trail_hashes_id_seq OWNED BY staging_seattle_1753750417519.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE TABLE staging_seattle_1753750417519.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750417519.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750417519.trails_id_seq OWNED BY staging_seattle_1753750417519.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE TABLE staging_seattle_1753750422219.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750422219.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750422219.intersection_points_id_seq OWNED BY staging_seattle_1753750422219.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE TABLE staging_seattle_1753750422219.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750422219.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750422219.routing_edges_id_seq OWNED BY staging_seattle_1753750422219.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE TABLE staging_seattle_1753750422219.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750422219.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750422219.routing_nodes_id_seq OWNED BY staging_seattle_1753750422219.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE TABLE staging_seattle_1753750422219.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750422219.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750422219.split_trails_id_seq OWNED BY staging_seattle_1753750422219.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE TABLE staging_seattle_1753750422219.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750422219.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750422219.trail_hashes_id_seq OWNED BY staging_seattle_1753750422219.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE TABLE staging_seattle_1753750422219.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750422219.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750422219.trails_id_seq OWNED BY staging_seattle_1753750422219.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE TABLE staging_seattle_1753750442417.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750442417.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750442417.intersection_points_id_seq OWNED BY staging_seattle_1753750442417.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE TABLE staging_seattle_1753750442417.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750442417.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750442417.routing_edges_id_seq OWNED BY staging_seattle_1753750442417.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE TABLE staging_seattle_1753750442417.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750442417.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750442417.routing_nodes_id_seq OWNED BY staging_seattle_1753750442417.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE TABLE staging_seattle_1753750442417.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750442417.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750442417.split_trails_id_seq OWNED BY staging_seattle_1753750442417.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE TABLE staging_seattle_1753750442417.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750442417.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750442417.trail_hashes_id_seq OWNED BY staging_seattle_1753750442417.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE TABLE staging_seattle_1753750442417.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750442417.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750442417.trails_id_seq OWNED BY staging_seattle_1753750442417.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE TABLE staging_seattle_1753750443990.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750443990.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750443990.intersection_points_id_seq OWNED BY staging_seattle_1753750443990.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE TABLE staging_seattle_1753750443990.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750443990.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750443990.routing_edges_id_seq OWNED BY staging_seattle_1753750443990.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE TABLE staging_seattle_1753750443990.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750443990.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750443990.routing_nodes_id_seq OWNED BY staging_seattle_1753750443990.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE TABLE staging_seattle_1753750443990.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750443990.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750443990.split_trails_id_seq OWNED BY staging_seattle_1753750443990.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE TABLE staging_seattle_1753750443990.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750443990.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750443990.trail_hashes_id_seq OWNED BY staging_seattle_1753750443990.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE TABLE staging_seattle_1753750443990.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750443990.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750443990.trails_id_seq OWNED BY staging_seattle_1753750443990.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE TABLE staging_seattle_1753750446394.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750446394.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750446394.intersection_points_id_seq OWNED BY staging_seattle_1753750446394.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE TABLE staging_seattle_1753750446394.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750446394.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750446394.routing_edges_id_seq OWNED BY staging_seattle_1753750446394.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE TABLE staging_seattle_1753750446394.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750446394.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750446394.routing_nodes_id_seq OWNED BY staging_seattle_1753750446394.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE TABLE staging_seattle_1753750446394.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750446394.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750446394.split_trails_id_seq OWNED BY staging_seattle_1753750446394.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE TABLE staging_seattle_1753750446394.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750446394.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750446394.trail_hashes_id_seq OWNED BY staging_seattle_1753750446394.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE TABLE staging_seattle_1753750446394.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750446394.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750446394.trails_id_seq OWNED BY staging_seattle_1753750446394.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE TABLE staging_seattle_1753750447593.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750447593.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750447593.intersection_points_id_seq OWNED BY staging_seattle_1753750447593.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE TABLE staging_seattle_1753750447593.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750447593.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750447593.routing_edges_id_seq OWNED BY staging_seattle_1753750447593.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE TABLE staging_seattle_1753750447593.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750447593.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750447593.routing_nodes_id_seq OWNED BY staging_seattle_1753750447593.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE TABLE staging_seattle_1753750447593.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750447593.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750447593.split_trails_id_seq OWNED BY staging_seattle_1753750447593.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE TABLE staging_seattle_1753750447593.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750447593.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750447593.trail_hashes_id_seq OWNED BY staging_seattle_1753750447593.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE TABLE staging_seattle_1753750447593.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750447593.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750447593.trails_id_seq OWNED BY staging_seattle_1753750447593.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE TABLE staging_seattle_1753750451225.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750451225.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750451225.intersection_points_id_seq OWNED BY staging_seattle_1753750451225.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE TABLE staging_seattle_1753750451225.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750451225.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750451225.routing_edges_id_seq OWNED BY staging_seattle_1753750451225.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE TABLE staging_seattle_1753750451225.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750451225.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750451225.routing_nodes_id_seq OWNED BY staging_seattle_1753750451225.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE TABLE staging_seattle_1753750451225.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750451225.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750451225.split_trails_id_seq OWNED BY staging_seattle_1753750451225.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE TABLE staging_seattle_1753750451225.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750451225.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750451225.trail_hashes_id_seq OWNED BY staging_seattle_1753750451225.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE TABLE staging_seattle_1753750451225.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750451225.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750451225.trails_id_seq OWNED BY staging_seattle_1753750451225.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE TABLE staging_seattle_1753750453617.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750453617.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750453617.intersection_points_id_seq OWNED BY staging_seattle_1753750453617.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE TABLE staging_seattle_1753750453617.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750453617.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750453617.routing_edges_id_seq OWNED BY staging_seattle_1753750453617.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE TABLE staging_seattle_1753750453617.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750453617.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750453617.routing_nodes_id_seq OWNED BY staging_seattle_1753750453617.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE TABLE staging_seattle_1753750453617.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750453617.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750453617.split_trails_id_seq OWNED BY staging_seattle_1753750453617.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE TABLE staging_seattle_1753750453617.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750453617.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750453617.trail_hashes_id_seq OWNED BY staging_seattle_1753750453617.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE TABLE staging_seattle_1753750453617.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750453617.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750453617.trails_id_seq OWNED BY staging_seattle_1753750453617.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE TABLE staging_seattle_1753750454912.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750454912.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750454912.intersection_points_id_seq OWNED BY staging_seattle_1753750454912.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE TABLE staging_seattle_1753750454912.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750454912.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750454912.routing_edges_id_seq OWNED BY staging_seattle_1753750454912.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE TABLE staging_seattle_1753750454912.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750454912.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750454912.routing_nodes_id_seq OWNED BY staging_seattle_1753750454912.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE TABLE staging_seattle_1753750454912.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750454912.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750454912.split_trails_id_seq OWNED BY staging_seattle_1753750454912.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE TABLE staging_seattle_1753750454912.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750454912.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750454912.trail_hashes_id_seq OWNED BY staging_seattle_1753750454912.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE TABLE staging_seattle_1753750454912.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750454912.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750454912.trails_id_seq OWNED BY staging_seattle_1753750454912.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE TABLE staging_seattle_1753750456121.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750456121.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750456121.intersection_points_id_seq OWNED BY staging_seattle_1753750456121.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE TABLE staging_seattle_1753750456121.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750456121.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750456121.routing_edges_id_seq OWNED BY staging_seattle_1753750456121.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE TABLE staging_seattle_1753750456121.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750456121.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750456121.routing_nodes_id_seq OWNED BY staging_seattle_1753750456121.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE TABLE staging_seattle_1753750456121.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750456121.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750456121.split_trails_id_seq OWNED BY staging_seattle_1753750456121.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE TABLE staging_seattle_1753750456121.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750456121.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750456121.trail_hashes_id_seq OWNED BY staging_seattle_1753750456121.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE TABLE staging_seattle_1753750456121.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750456121.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750456121.trails_id_seq OWNED BY staging_seattle_1753750456121.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE TABLE staging_seattle_1753750459662.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750459662.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750459662.intersection_points_id_seq OWNED BY staging_seattle_1753750459662.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE TABLE staging_seattle_1753750459662.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750459662.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750459662.routing_edges_id_seq OWNED BY staging_seattle_1753750459662.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE TABLE staging_seattle_1753750459662.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750459662.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750459662.routing_nodes_id_seq OWNED BY staging_seattle_1753750459662.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE TABLE staging_seattle_1753750459662.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750459662.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750459662.split_trails_id_seq OWNED BY staging_seattle_1753750459662.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE TABLE staging_seattle_1753750459662.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750459662.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750459662.trail_hashes_id_seq OWNED BY staging_seattle_1753750459662.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE TABLE staging_seattle_1753750459662.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750459662.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750459662.trails_id_seq OWNED BY staging_seattle_1753750459662.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE TABLE staging_seattle_1753750460968.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750460968.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750460968.intersection_points_id_seq OWNED BY staging_seattle_1753750460968.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE TABLE staging_seattle_1753750460968.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750460968.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750460968.routing_edges_id_seq OWNED BY staging_seattle_1753750460968.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE TABLE staging_seattle_1753750460968.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750460968.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750460968.routing_nodes_id_seq OWNED BY staging_seattle_1753750460968.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE TABLE staging_seattle_1753750460968.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750460968.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750460968.split_trails_id_seq OWNED BY staging_seattle_1753750460968.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE TABLE staging_seattle_1753750460968.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750460968.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750460968.trail_hashes_id_seq OWNED BY staging_seattle_1753750460968.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE TABLE staging_seattle_1753750460968.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750460968.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750460968.trails_id_seq OWNED BY staging_seattle_1753750460968.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE TABLE staging_seattle_1753750462159.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750462159.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750462159.intersection_points_id_seq OWNED BY staging_seattle_1753750462159.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE TABLE staging_seattle_1753750462159.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750462159.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750462159.routing_edges_id_seq OWNED BY staging_seattle_1753750462159.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE TABLE staging_seattle_1753750462159.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750462159.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750462159.routing_nodes_id_seq OWNED BY staging_seattle_1753750462159.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE TABLE staging_seattle_1753750462159.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750462159.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750462159.split_trails_id_seq OWNED BY staging_seattle_1753750462159.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE TABLE staging_seattle_1753750462159.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750462159.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750462159.trail_hashes_id_seq OWNED BY staging_seattle_1753750462159.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE TABLE staging_seattle_1753750462159.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750462159.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750462159.trails_id_seq OWNED BY staging_seattle_1753750462159.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE TABLE staging_seattle_1753750466862.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750466862.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750466862.intersection_points_id_seq OWNED BY staging_seattle_1753750466862.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE TABLE staging_seattle_1753750466862.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750466862.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750466862.routing_edges_id_seq OWNED BY staging_seattle_1753750466862.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE TABLE staging_seattle_1753750466862.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750466862.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750466862.routing_nodes_id_seq OWNED BY staging_seattle_1753750466862.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE TABLE staging_seattle_1753750466862.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750466862.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750466862.split_trails_id_seq OWNED BY staging_seattle_1753750466862.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE TABLE staging_seattle_1753750466862.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750466862.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750466862.trail_hashes_id_seq OWNED BY staging_seattle_1753750466862.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE TABLE staging_seattle_1753750466862.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750466862.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750466862.trails_id_seq OWNED BY staging_seattle_1753750466862.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE TABLE staging_seattle_1753750527633.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750527633.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750527633.intersection_points_id_seq OWNED BY staging_seattle_1753750527633.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE TABLE staging_seattle_1753750527633.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750527633.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750527633.routing_edges_id_seq OWNED BY staging_seattle_1753750527633.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE TABLE staging_seattle_1753750527633.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750527633.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750527633.routing_nodes_id_seq OWNED BY staging_seattle_1753750527633.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE TABLE staging_seattle_1753750527633.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750527633.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750527633.split_trails_id_seq OWNED BY staging_seattle_1753750527633.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE TABLE staging_seattle_1753750527633.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750527633.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750527633.trail_hashes_id_seq OWNED BY staging_seattle_1753750527633.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE TABLE staging_seattle_1753750527633.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750527633.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750527633.trails_id_seq OWNED BY staging_seattle_1753750527633.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE TABLE staging_seattle_1753750528914.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750528914.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750528914.intersection_points_id_seq OWNED BY staging_seattle_1753750528914.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE TABLE staging_seattle_1753750528914.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750528914.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750528914.routing_edges_id_seq OWNED BY staging_seattle_1753750528914.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE TABLE staging_seattle_1753750528914.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750528914.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750528914.routing_nodes_id_seq OWNED BY staging_seattle_1753750528914.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE TABLE staging_seattle_1753750528914.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750528914.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750528914.split_trails_id_seq OWNED BY staging_seattle_1753750528914.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE TABLE staging_seattle_1753750528914.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750528914.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750528914.trail_hashes_id_seq OWNED BY staging_seattle_1753750528914.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE TABLE staging_seattle_1753750528914.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750528914.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750528914.trails_id_seq OWNED BY staging_seattle_1753750528914.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE TABLE staging_seattle_1753750531246.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750531246.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750531246.intersection_points_id_seq OWNED BY staging_seattle_1753750531246.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE TABLE staging_seattle_1753750531246.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750531246.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750531246.routing_edges_id_seq OWNED BY staging_seattle_1753750531246.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE TABLE staging_seattle_1753750531246.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750531246.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750531246.routing_nodes_id_seq OWNED BY staging_seattle_1753750531246.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE TABLE staging_seattle_1753750531246.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750531246.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750531246.split_trails_id_seq OWNED BY staging_seattle_1753750531246.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE TABLE staging_seattle_1753750531246.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750531246.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750531246.trail_hashes_id_seq OWNED BY staging_seattle_1753750531246.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE TABLE staging_seattle_1753750531246.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750531246.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750531246.trails_id_seq OWNED BY staging_seattle_1753750531246.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE TABLE staging_seattle_1753750532511.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750532511.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750532511.intersection_points_id_seq OWNED BY staging_seattle_1753750532511.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE TABLE staging_seattle_1753750532511.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750532511.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750532511.routing_edges_id_seq OWNED BY staging_seattle_1753750532511.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE TABLE staging_seattle_1753750532511.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750532511.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750532511.routing_nodes_id_seq OWNED BY staging_seattle_1753750532511.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE TABLE staging_seattle_1753750532511.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750532511.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750532511.split_trails_id_seq OWNED BY staging_seattle_1753750532511.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE TABLE staging_seattle_1753750532511.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750532511.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750532511.trail_hashes_id_seq OWNED BY staging_seattle_1753750532511.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE TABLE staging_seattle_1753750532511.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750532511.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750532511.trails_id_seq OWNED BY staging_seattle_1753750532511.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE TABLE staging_seattle_1753750535980.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750535980.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750535980.intersection_points_id_seq OWNED BY staging_seattle_1753750535980.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE TABLE staging_seattle_1753750535980.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750535980.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750535980.routing_edges_id_seq OWNED BY staging_seattle_1753750535980.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE TABLE staging_seattle_1753750535980.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750535980.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750535980.routing_nodes_id_seq OWNED BY staging_seattle_1753750535980.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE TABLE staging_seattle_1753750535980.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750535980.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750535980.split_trails_id_seq OWNED BY staging_seattle_1753750535980.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE TABLE staging_seattle_1753750535980.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750535980.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750535980.trail_hashes_id_seq OWNED BY staging_seattle_1753750535980.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE TABLE staging_seattle_1753750535980.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750535980.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750535980.trails_id_seq OWNED BY staging_seattle_1753750535980.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE TABLE staging_seattle_1753750538290.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750538290.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750538290.intersection_points_id_seq OWNED BY staging_seattle_1753750538290.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE TABLE staging_seattle_1753750538290.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750538290.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750538290.routing_edges_id_seq OWNED BY staging_seattle_1753750538290.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE TABLE staging_seattle_1753750538290.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750538290.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750538290.routing_nodes_id_seq OWNED BY staging_seattle_1753750538290.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE TABLE staging_seattle_1753750538290.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750538290.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750538290.split_trails_id_seq OWNED BY staging_seattle_1753750538290.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE TABLE staging_seattle_1753750538290.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750538290.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750538290.trail_hashes_id_seq OWNED BY staging_seattle_1753750538290.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE TABLE staging_seattle_1753750538290.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750538290.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750538290.trails_id_seq OWNED BY staging_seattle_1753750538290.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE TABLE staging_seattle_1753750539526.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750539526.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750539526.intersection_points_id_seq OWNED BY staging_seattle_1753750539526.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE TABLE staging_seattle_1753750539526.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750539526.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750539526.routing_edges_id_seq OWNED BY staging_seattle_1753750539526.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE TABLE staging_seattle_1753750539526.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750539526.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750539526.routing_nodes_id_seq OWNED BY staging_seattle_1753750539526.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE TABLE staging_seattle_1753750539526.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750539526.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750539526.split_trails_id_seq OWNED BY staging_seattle_1753750539526.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE TABLE staging_seattle_1753750539526.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750539526.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750539526.trail_hashes_id_seq OWNED BY staging_seattle_1753750539526.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE TABLE staging_seattle_1753750539526.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750539526.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750539526.trails_id_seq OWNED BY staging_seattle_1753750539526.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE TABLE staging_seattle_1753750540696.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750540696.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750540696.intersection_points_id_seq OWNED BY staging_seattle_1753750540696.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE TABLE staging_seattle_1753750540696.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750540696.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750540696.routing_edges_id_seq OWNED BY staging_seattle_1753750540696.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE TABLE staging_seattle_1753750540696.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750540696.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750540696.routing_nodes_id_seq OWNED BY staging_seattle_1753750540696.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE TABLE staging_seattle_1753750540696.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750540696.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750540696.split_trails_id_seq OWNED BY staging_seattle_1753750540696.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE TABLE staging_seattle_1753750540696.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750540696.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750540696.trail_hashes_id_seq OWNED BY staging_seattle_1753750540696.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE TABLE staging_seattle_1753750540696.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750540696.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750540696.trails_id_seq OWNED BY staging_seattle_1753750540696.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE TABLE staging_seattle_1753750544229.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750544229.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750544229.intersection_points_id_seq OWNED BY staging_seattle_1753750544229.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE TABLE staging_seattle_1753750544229.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750544229.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750544229.routing_edges_id_seq OWNED BY staging_seattle_1753750544229.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE TABLE staging_seattle_1753750544229.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750544229.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750544229.routing_nodes_id_seq OWNED BY staging_seattle_1753750544229.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE TABLE staging_seattle_1753750544229.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750544229.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750544229.split_trails_id_seq OWNED BY staging_seattle_1753750544229.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE TABLE staging_seattle_1753750544229.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750544229.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750544229.trail_hashes_id_seq OWNED BY staging_seattle_1753750544229.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE TABLE staging_seattle_1753750544229.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750544229.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750544229.trails_id_seq OWNED BY staging_seattle_1753750544229.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE TABLE staging_seattle_1753750545409.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750545409.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750545409.intersection_points_id_seq OWNED BY staging_seattle_1753750545409.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE TABLE staging_seattle_1753750545409.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750545409.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750545409.routing_edges_id_seq OWNED BY staging_seattle_1753750545409.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE TABLE staging_seattle_1753750545409.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750545409.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750545409.routing_nodes_id_seq OWNED BY staging_seattle_1753750545409.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE TABLE staging_seattle_1753750545409.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750545409.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750545409.split_trails_id_seq OWNED BY staging_seattle_1753750545409.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE TABLE staging_seattle_1753750545409.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750545409.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750545409.trail_hashes_id_seq OWNED BY staging_seattle_1753750545409.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE TABLE staging_seattle_1753750545409.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750545409.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750545409.trails_id_seq OWNED BY staging_seattle_1753750545409.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE TABLE staging_seattle_1753750546595.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750546595.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750546595.intersection_points_id_seq OWNED BY staging_seattle_1753750546595.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE TABLE staging_seattle_1753750546595.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750546595.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750546595.routing_edges_id_seq OWNED BY staging_seattle_1753750546595.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE TABLE staging_seattle_1753750546595.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750546595.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750546595.routing_nodes_id_seq OWNED BY staging_seattle_1753750546595.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE TABLE staging_seattle_1753750546595.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750546595.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750546595.split_trails_id_seq OWNED BY staging_seattle_1753750546595.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE TABLE staging_seattle_1753750546595.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750546595.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750546595.trail_hashes_id_seq OWNED BY staging_seattle_1753750546595.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE TABLE staging_seattle_1753750546595.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750546595.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750546595.trails_id_seq OWNED BY staging_seattle_1753750546595.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE TABLE staging_seattle_1753750551060.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750551060.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750551060.intersection_points_id_seq OWNED BY staging_seattle_1753750551060.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE TABLE staging_seattle_1753750551060.routing_edges (
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
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750551060.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750551060.routing_edges_id_seq OWNED BY staging_seattle_1753750551060.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE TABLE staging_seattle_1753750551060.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750551060.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750551060.routing_nodes_id_seq OWNED BY staging_seattle_1753750551060.routing_nodes.id;


--
-- Name: split_trails; Type: TABLE; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE TABLE staging_seattle_1753750551060.split_trails (
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
-- Name: split_trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750551060.split_trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: split_trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750551060.split_trails_id_seq OWNED BY staging_seattle_1753750551060.split_trails.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE TABLE staging_seattle_1753750551060.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750551060.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750551060.trail_hashes_id_seq OWNED BY staging_seattle_1753750551060.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE TABLE staging_seattle_1753750551060.trails (
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
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE SEQUENCE staging_seattle_1753750551060.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER SEQUENCE staging_seattle_1753750551060.trails_id_seq OWNED BY staging_seattle_1753750551060.trails.id;


--
-- Name: elevation_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.elevation_points ALTER COLUMN id SET DEFAULT nextval('public.elevation_points_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intersection_points ALTER COLUMN id SET DEFAULT nextval('public.intersection_points_id_seq'::regclass);


--
-- Name: region_metadata id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.region_metadata ALTER COLUMN id SET DEFAULT nextval('public.region_metadata_id_seq'::regclass);


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

ALTER TABLE ONLY public.trails ALTER COLUMN id SET DEFAULT nextval('public.temp_split_trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750357844.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750357844.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750357844.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750357844.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750357844.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750357844.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750358170.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750358170.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750358170.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750358170.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750358170.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750358170.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750422402.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750422402.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750422402.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750422402.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750422402.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750422402.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750422846.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750422846.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750422846.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750422846.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750422846.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750422846.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750467330.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750467330.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750467330.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750467330.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750467330.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750467330.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750467617.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750467617.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750467617.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750467617.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750467617.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750467617.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750552692.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750552692.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750552692.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750552692.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750552692.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750552692.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750552888.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750552888.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750552888.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750552888.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750552888.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1753750552888.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750361222.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750361222.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750361222.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750361222.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750361222.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750361222.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750362437.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750362437.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750362437.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750362437.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750362437.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750362437.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750365906.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750365906.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750365906.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750365906.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750365906.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750365906.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750367114.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750367114.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750367114.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750367114.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750367114.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750367114.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750368341.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750368341.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750368341.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750368341.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750368341.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750368341.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750372953.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750372953.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750372953.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750372953.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750372953.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750372953.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750378967.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750378967.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750378967.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750378967.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750378967.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750378967.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750380156.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750380156.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750380156.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750380156.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750380156.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750380156.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750382409.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750382409.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750382409.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750382409.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750382409.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750382409.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750383587.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750383587.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750383587.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750383587.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750383587.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750383587.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750387012.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750387012.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750387012.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750387012.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750387012.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750387012.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750389371.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750389371.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750389371.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750389371.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750389371.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750389371.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750398553.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750398553.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750398553.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750398553.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750398553.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750398553.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750399762.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750399762.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750399762.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750399762.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750399762.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750399762.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750402156.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750402156.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750402156.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750402156.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750402156.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750402156.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750403371.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750403371.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750403371.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750403371.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750403371.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750403371.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750406858.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750406858.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750406858.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750406858.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750406858.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750406858.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750409210.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750409210.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750409210.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750409210.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750409210.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750409210.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750410481.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750410481.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750410481.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750410481.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750410481.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750410481.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750411680.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750411680.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750411680.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750411680.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750411680.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750411680.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750415131.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750415131.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750415131.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750415131.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750415131.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750415131.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750416323.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750416323.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750416323.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750416323.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750416323.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750416323.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750417519.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750417519.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750417519.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750417519.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750417519.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750417519.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750422219.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750422219.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750422219.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750422219.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750422219.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750422219.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750442417.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750442417.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750442417.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750442417.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750442417.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750442417.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750443990.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750443990.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750443990.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750443990.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750443990.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750443990.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750446394.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750446394.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750446394.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750446394.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750446394.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750446394.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750447593.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750447593.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750447593.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750447593.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750447593.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750447593.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750451225.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750451225.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750451225.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750451225.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750451225.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750451225.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750453617.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750453617.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750453617.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750453617.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750453617.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750453617.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750454912.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750454912.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750454912.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750454912.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750454912.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750454912.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750456121.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750456121.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750456121.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750456121.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750456121.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750456121.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750459662.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750459662.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750459662.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750459662.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750459662.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750459662.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750460968.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750460968.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750460968.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750460968.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750460968.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750460968.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750462159.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750462159.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750462159.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750462159.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750462159.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750462159.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750466862.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750466862.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750466862.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750466862.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750466862.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750466862.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750527633.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750527633.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750527633.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750527633.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750527633.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750527633.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750528914.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750528914.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750528914.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750528914.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750528914.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750528914.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750531246.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750531246.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750531246.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750531246.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750531246.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750531246.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750532511.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750532511.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750532511.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750532511.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750532511.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750532511.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750535980.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750535980.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750535980.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750535980.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750535980.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750535980.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750538290.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750538290.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750538290.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750538290.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750538290.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750538290.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750539526.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750539526.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750539526.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750539526.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750539526.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750539526.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750540696.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750540696.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750540696.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750540696.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750540696.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750540696.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750544229.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750544229.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750544229.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750544229.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750544229.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750544229.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750545409.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750545409.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750545409.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750545409.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750545409.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750545409.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750546595.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750546595.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750546595.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750546595.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750546595.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750546595.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750551060.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750551060.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750551060.routing_nodes_id_seq'::regclass);


--
-- Name: split_trails id; Type: DEFAULT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.split_trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750551060.split_trails_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750551060.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.trails ALTER COLUMN id SET DEFAULT nextval('staging_seattle_1753750551060.trails_id_seq'::regclass);


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
-- Name: region_metadata region_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.region_metadata
    ADD CONSTRAINT region_metadata_pkey PRIMARY KEY (id);


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
-- Name: trails temp_split_trails_app_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trails
    ADD CONSTRAINT temp_split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails temp_split_trails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trails
    ADD CONSTRAINT temp_split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: split_trails split_trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.split_trails
    ADD CONSTRAINT split_trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: split_trails split_trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.split_trails
    ADD CONSTRAINT split_trails_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


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
-- Name: idx_route_recommendations_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_route_recommendations_created ON public.route_recommendations USING btree (created_at);


--
-- Name: idx_route_recommendations_distance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_route_recommendations_distance ON public.route_recommendations USING btree (gpx_distance_km, recommended_distance_km);


--
-- Name: idx_route_recommendations_elevation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_route_recommendations_elevation ON public.route_recommendations USING btree (gpx_elevation_gain, recommended_elevation_gain);


--
-- Name: idx_routing_edges_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routing_edges_geom ON public.routing_edges USING gist (geom);


--
-- Name: idx_routing_nodes_coords; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routing_nodes_coords ON public.routing_nodes USING btree (lat, lng) WHERE ((lat IS NOT NULL) AND (lng IS NOT NULL));


--
-- Name: idx_routing_nodes_elevation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routing_nodes_elevation ON public.routing_nodes USING btree (elevation) WHERE (elevation IS NOT NULL);


--
-- Name: idx_routing_nodes_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routing_nodes_geom ON public.routing_nodes USING gist (the_geom);


--
-- Name: idx_routing_nodes_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routing_nodes_location ON public.routing_nodes USING gist (public.st_setsrid(public.st_makepoint(lng, lat), 4326));


--
-- Name: idx_routing_nodes_route_finding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routing_nodes_route_finding ON public.routing_nodes USING btree (id, lat, lng, elevation);


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
-- Name: idx_trails_bbox_optimized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_bbox_optimized ON public.trails USING btree (bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);


--
-- Name: idx_trails_elevation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_elevation ON public.trails USING btree (elevation_gain);


--
-- Name: idx_trails_geometry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_geometry ON public.trails USING gist (geometry);


--
-- Name: idx_trails_length; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_length ON public.trails USING btree (length_km);


--
-- Name: idx_trails_original_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_original_id ON public.trails USING btree (original_trail_id);


--
-- Name: idx_trails_osm_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_osm_id ON public.trails USING btree (osm_id);


--
-- Name: idx_trails_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region ON public.trails USING btree (region);


--
-- Name: idx_trails_region_elevation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region_elevation ON public.trails USING btree (region, elevation_gain);


--
-- Name: idx_trails_region_length; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region_length ON public.trails USING btree (region, length_km);


--
-- Name: idx_trails_region_surface; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region_surface ON public.trails USING btree (region, surface);


--
-- Name: idx_trails_region_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region_type ON public.trails USING btree (region, trail_type);


--
-- Name: idx_trails_segment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_segment ON public.trails USING btree (segment_number);


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
-- Name: idx_staging_boulder_1753750357844_intersection_points; Type: INDEX; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750357844_intersection_points ON staging_boulder_1753750357844.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1753750357844_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750357844_routing_edges_geometry ON staging_boulder_1753750357844.routing_edges USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750357844_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750357844_routing_nodes_location ON staging_boulder_1753750357844.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_boulder_1753750357844_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750357844_split_trails_geometry ON staging_boulder_1753750357844.split_trails USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750357844_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750357844_trails_geometry ON staging_boulder_1753750357844.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1753750357844.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1753750357844.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1753750357844.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_boulder_1753750357844.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750357844; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1753750357844.trails USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750358170_intersection_points; Type: INDEX; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750358170_intersection_points ON staging_boulder_1753750358170.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1753750358170_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750358170_routing_edges_geometry ON staging_boulder_1753750358170.routing_edges USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750358170_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750358170_routing_nodes_location ON staging_boulder_1753750358170.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_boulder_1753750358170_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750358170_split_trails_geometry ON staging_boulder_1753750358170.split_trails USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750358170_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750358170_trails_geometry ON staging_boulder_1753750358170.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1753750358170.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1753750358170.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1753750358170.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_boulder_1753750358170.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750358170; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1753750358170.trails USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750422402_intersection_points; Type: INDEX; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750422402_intersection_points ON staging_boulder_1753750422402.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1753750422402_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750422402_routing_edges_geometry ON staging_boulder_1753750422402.routing_edges USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750422402_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750422402_routing_nodes_location ON staging_boulder_1753750422402.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_boulder_1753750422402_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750422402_split_trails_geometry ON staging_boulder_1753750422402.split_trails USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750422402_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750422402_trails_geometry ON staging_boulder_1753750422402.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1753750422402.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1753750422402.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1753750422402.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_boulder_1753750422402.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750422402; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1753750422402.trails USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750422846_intersection_points; Type: INDEX; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750422846_intersection_points ON staging_boulder_1753750422846.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1753750422846_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750422846_routing_edges_geometry ON staging_boulder_1753750422846.routing_edges USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750422846_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750422846_routing_nodes_location ON staging_boulder_1753750422846.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_boulder_1753750422846_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750422846_split_trails_geometry ON staging_boulder_1753750422846.split_trails USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750422846_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750422846_trails_geometry ON staging_boulder_1753750422846.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1753750422846.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1753750422846.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1753750422846.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_boulder_1753750422846.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750422846; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1753750422846.trails USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750467330_intersection_points; Type: INDEX; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750467330_intersection_points ON staging_boulder_1753750467330.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1753750467330_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750467330_routing_edges_geometry ON staging_boulder_1753750467330.routing_edges USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750467330_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750467330_routing_nodes_location ON staging_boulder_1753750467330.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_boulder_1753750467330_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750467330_split_trails_geometry ON staging_boulder_1753750467330.split_trails USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750467330_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750467330_trails_geometry ON staging_boulder_1753750467330.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1753750467330.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1753750467330.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1753750467330.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_boulder_1753750467330.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750467330; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1753750467330.trails USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750467617_intersection_points; Type: INDEX; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750467617_intersection_points ON staging_boulder_1753750467617.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1753750467617_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750467617_routing_edges_geometry ON staging_boulder_1753750467617.routing_edges USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750467617_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750467617_routing_nodes_location ON staging_boulder_1753750467617.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_boulder_1753750467617_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750467617_split_trails_geometry ON staging_boulder_1753750467617.split_trails USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750467617_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750467617_trails_geometry ON staging_boulder_1753750467617.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1753750467617.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1753750467617.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1753750467617.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_boulder_1753750467617.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750467617; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1753750467617.trails USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750552692_intersection_points; Type: INDEX; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750552692_intersection_points ON staging_boulder_1753750552692.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1753750552692_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750552692_routing_edges_geometry ON staging_boulder_1753750552692.routing_edges USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750552692_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750552692_routing_nodes_location ON staging_boulder_1753750552692.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_boulder_1753750552692_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750552692_split_trails_geometry ON staging_boulder_1753750552692.split_trails USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750552692_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750552692_trails_geometry ON staging_boulder_1753750552692.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1753750552692.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1753750552692.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1753750552692.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_boulder_1753750552692.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750552692; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1753750552692.trails USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750552888_intersection_points; Type: INDEX; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750552888_intersection_points ON staging_boulder_1753750552888.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1753750552888_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750552888_routing_edges_geometry ON staging_boulder_1753750552888.routing_edges USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750552888_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750552888_routing_nodes_location ON staging_boulder_1753750552888.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_boulder_1753750552888_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750552888_split_trails_geometry ON staging_boulder_1753750552888.split_trails USING gist (geometry);


--
-- Name: idx_staging_boulder_1753750552888_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE INDEX idx_staging_boulder_1753750552888_trails_geometry ON staging_boulder_1753750552888.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1753750552888.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1753750552888.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1753750552888.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_boulder_1753750552888.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1753750552888; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1753750552888.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750361222.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750361222.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750361222.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750361222_intersection_points; Type: INDEX; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750361222_intersection_points ON staging_seattle_1753750361222.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750361222_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750361222_routing_edges_geometry ON staging_seattle_1753750361222.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750361222_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750361222_routing_nodes_location ON staging_seattle_1753750361222.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750361222_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750361222_split_trails_geometry ON staging_seattle_1753750361222.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750361222_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750361222_trails_geometry ON staging_seattle_1753750361222.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750361222.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750361222; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750361222.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750362437.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750362437.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750362437.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750362437_intersection_points; Type: INDEX; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750362437_intersection_points ON staging_seattle_1753750362437.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750362437_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750362437_routing_edges_geometry ON staging_seattle_1753750362437.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750362437_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750362437_routing_nodes_location ON staging_seattle_1753750362437.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750362437_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750362437_split_trails_geometry ON staging_seattle_1753750362437.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750362437_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750362437_trails_geometry ON staging_seattle_1753750362437.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750362437.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750362437; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750362437.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750365906.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750365906.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750365906.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750365906_intersection_points; Type: INDEX; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750365906_intersection_points ON staging_seattle_1753750365906.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750365906_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750365906_routing_edges_geometry ON staging_seattle_1753750365906.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750365906_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750365906_routing_nodes_location ON staging_seattle_1753750365906.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750365906_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750365906_split_trails_geometry ON staging_seattle_1753750365906.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750365906_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750365906_trails_geometry ON staging_seattle_1753750365906.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750365906.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750365906; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750365906.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750367114.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750367114.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750367114.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750367114_intersection_points; Type: INDEX; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750367114_intersection_points ON staging_seattle_1753750367114.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750367114_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750367114_routing_edges_geometry ON staging_seattle_1753750367114.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750367114_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750367114_routing_nodes_location ON staging_seattle_1753750367114.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750367114_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750367114_split_trails_geometry ON staging_seattle_1753750367114.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750367114_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750367114_trails_geometry ON staging_seattle_1753750367114.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750367114.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750367114; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750367114.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750368341.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750368341.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750368341.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750368341_intersection_points; Type: INDEX; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750368341_intersection_points ON staging_seattle_1753750368341.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750368341_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750368341_routing_edges_geometry ON staging_seattle_1753750368341.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750368341_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750368341_routing_nodes_location ON staging_seattle_1753750368341.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750368341_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750368341_split_trails_geometry ON staging_seattle_1753750368341.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750368341_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750368341_trails_geometry ON staging_seattle_1753750368341.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750368341.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750368341; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750368341.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750372953.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750372953.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750372953.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750372953_intersection_points; Type: INDEX; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750372953_intersection_points ON staging_seattle_1753750372953.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750372953_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750372953_routing_edges_geometry ON staging_seattle_1753750372953.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750372953_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750372953_routing_nodes_location ON staging_seattle_1753750372953.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750372953_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750372953_split_trails_geometry ON staging_seattle_1753750372953.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750372953_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750372953_trails_geometry ON staging_seattle_1753750372953.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750372953.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750372953; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750372953.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750378967.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750378967.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750378967.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750378967_intersection_points; Type: INDEX; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750378967_intersection_points ON staging_seattle_1753750378967.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750378967_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750378967_routing_edges_geometry ON staging_seattle_1753750378967.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750378967_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750378967_routing_nodes_location ON staging_seattle_1753750378967.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750378967_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750378967_split_trails_geometry ON staging_seattle_1753750378967.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750378967_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750378967_trails_geometry ON staging_seattle_1753750378967.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750378967.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750378967; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750378967.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750380156.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750380156.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750380156.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750380156_intersection_points; Type: INDEX; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750380156_intersection_points ON staging_seattle_1753750380156.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750380156_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750380156_routing_edges_geometry ON staging_seattle_1753750380156.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750380156_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750380156_routing_nodes_location ON staging_seattle_1753750380156.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750380156_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750380156_split_trails_geometry ON staging_seattle_1753750380156.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750380156_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750380156_trails_geometry ON staging_seattle_1753750380156.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750380156.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750380156; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750380156.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750382409.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750382409.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750382409.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750382409_intersection_points; Type: INDEX; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750382409_intersection_points ON staging_seattle_1753750382409.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750382409_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750382409_routing_edges_geometry ON staging_seattle_1753750382409.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750382409_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750382409_routing_nodes_location ON staging_seattle_1753750382409.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750382409_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750382409_split_trails_geometry ON staging_seattle_1753750382409.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750382409_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750382409_trails_geometry ON staging_seattle_1753750382409.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750382409.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750382409; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750382409.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750383587.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750383587.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750383587.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750383587_intersection_points; Type: INDEX; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750383587_intersection_points ON staging_seattle_1753750383587.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750383587_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750383587_routing_edges_geometry ON staging_seattle_1753750383587.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750383587_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750383587_routing_nodes_location ON staging_seattle_1753750383587.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750383587_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750383587_split_trails_geometry ON staging_seattle_1753750383587.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750383587_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750383587_trails_geometry ON staging_seattle_1753750383587.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750383587.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750383587; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750383587.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750387012.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750387012.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750387012.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750387012_intersection_points; Type: INDEX; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750387012_intersection_points ON staging_seattle_1753750387012.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750387012_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750387012_routing_edges_geometry ON staging_seattle_1753750387012.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750387012_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750387012_routing_nodes_location ON staging_seattle_1753750387012.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750387012_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750387012_split_trails_geometry ON staging_seattle_1753750387012.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750387012_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750387012_trails_geometry ON staging_seattle_1753750387012.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750387012.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750387012; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750387012.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750389371.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750389371.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750389371.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750389371_intersection_points; Type: INDEX; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750389371_intersection_points ON staging_seattle_1753750389371.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750389371_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750389371_routing_edges_geometry ON staging_seattle_1753750389371.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750389371_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750389371_routing_nodes_location ON staging_seattle_1753750389371.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750389371_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750389371_split_trails_geometry ON staging_seattle_1753750389371.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750389371_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750389371_trails_geometry ON staging_seattle_1753750389371.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750389371.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750389371; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750389371.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750398553.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750398553.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750398553.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750398553_intersection_points; Type: INDEX; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750398553_intersection_points ON staging_seattle_1753750398553.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750398553_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750398553_routing_edges_geometry ON staging_seattle_1753750398553.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750398553_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750398553_routing_nodes_location ON staging_seattle_1753750398553.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750398553_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750398553_split_trails_geometry ON staging_seattle_1753750398553.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750398553_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750398553_trails_geometry ON staging_seattle_1753750398553.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750398553.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750398553; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750398553.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750399762.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750399762.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750399762.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750399762_intersection_points; Type: INDEX; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750399762_intersection_points ON staging_seattle_1753750399762.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750399762_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750399762_routing_edges_geometry ON staging_seattle_1753750399762.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750399762_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750399762_routing_nodes_location ON staging_seattle_1753750399762.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750399762_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750399762_split_trails_geometry ON staging_seattle_1753750399762.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750399762_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750399762_trails_geometry ON staging_seattle_1753750399762.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750399762.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750399762; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750399762.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750402156.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750402156.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750402156.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750402156_intersection_points; Type: INDEX; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750402156_intersection_points ON staging_seattle_1753750402156.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750402156_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750402156_routing_edges_geometry ON staging_seattle_1753750402156.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750402156_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750402156_routing_nodes_location ON staging_seattle_1753750402156.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750402156_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750402156_split_trails_geometry ON staging_seattle_1753750402156.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750402156_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750402156_trails_geometry ON staging_seattle_1753750402156.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750402156.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750402156; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750402156.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750403371.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750403371.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750403371.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750403371_intersection_points; Type: INDEX; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750403371_intersection_points ON staging_seattle_1753750403371.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750403371_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750403371_routing_edges_geometry ON staging_seattle_1753750403371.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750403371_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750403371_routing_nodes_location ON staging_seattle_1753750403371.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750403371_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750403371_split_trails_geometry ON staging_seattle_1753750403371.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750403371_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750403371_trails_geometry ON staging_seattle_1753750403371.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750403371.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750403371; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750403371.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750406858.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750406858.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750406858.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750406858_intersection_points; Type: INDEX; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750406858_intersection_points ON staging_seattle_1753750406858.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750406858_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750406858_routing_edges_geometry ON staging_seattle_1753750406858.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750406858_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750406858_routing_nodes_location ON staging_seattle_1753750406858.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750406858_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750406858_split_trails_geometry ON staging_seattle_1753750406858.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750406858_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750406858_trails_geometry ON staging_seattle_1753750406858.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750406858.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750406858; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750406858.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750409210.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750409210.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750409210.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750409210_intersection_points; Type: INDEX; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750409210_intersection_points ON staging_seattle_1753750409210.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750409210_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750409210_routing_edges_geometry ON staging_seattle_1753750409210.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750409210_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750409210_routing_nodes_location ON staging_seattle_1753750409210.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750409210_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750409210_split_trails_geometry ON staging_seattle_1753750409210.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750409210_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750409210_trails_geometry ON staging_seattle_1753750409210.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750409210.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750409210; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750409210.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750410481.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750410481.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750410481.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750410481_intersection_points; Type: INDEX; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750410481_intersection_points ON staging_seattle_1753750410481.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750410481_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750410481_routing_edges_geometry ON staging_seattle_1753750410481.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750410481_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750410481_routing_nodes_location ON staging_seattle_1753750410481.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750410481_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750410481_split_trails_geometry ON staging_seattle_1753750410481.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750410481_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750410481_trails_geometry ON staging_seattle_1753750410481.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750410481.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750410481; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750410481.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750411680.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750411680.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750411680.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750411680_intersection_points; Type: INDEX; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750411680_intersection_points ON staging_seattle_1753750411680.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750411680_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750411680_routing_edges_geometry ON staging_seattle_1753750411680.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750411680_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750411680_routing_nodes_location ON staging_seattle_1753750411680.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750411680_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750411680_split_trails_geometry ON staging_seattle_1753750411680.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750411680_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750411680_trails_geometry ON staging_seattle_1753750411680.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750411680.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750411680; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750411680.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750415131.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750415131.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750415131.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750415131_intersection_points; Type: INDEX; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750415131_intersection_points ON staging_seattle_1753750415131.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750415131_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750415131_routing_edges_geometry ON staging_seattle_1753750415131.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750415131_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750415131_routing_nodes_location ON staging_seattle_1753750415131.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750415131_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750415131_split_trails_geometry ON staging_seattle_1753750415131.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750415131_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750415131_trails_geometry ON staging_seattle_1753750415131.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750415131.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750415131; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750415131.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750416323.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750416323.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750416323.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750416323_intersection_points; Type: INDEX; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750416323_intersection_points ON staging_seattle_1753750416323.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750416323_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750416323_routing_edges_geometry ON staging_seattle_1753750416323.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750416323_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750416323_routing_nodes_location ON staging_seattle_1753750416323.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750416323_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750416323_split_trails_geometry ON staging_seattle_1753750416323.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750416323_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750416323_trails_geometry ON staging_seattle_1753750416323.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750416323.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750416323; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750416323.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750417519.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750417519.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750417519.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750417519_intersection_points; Type: INDEX; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750417519_intersection_points ON staging_seattle_1753750417519.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750417519_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750417519_routing_edges_geometry ON staging_seattle_1753750417519.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750417519_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750417519_routing_nodes_location ON staging_seattle_1753750417519.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750417519_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750417519_split_trails_geometry ON staging_seattle_1753750417519.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750417519_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750417519_trails_geometry ON staging_seattle_1753750417519.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750417519.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750417519; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750417519.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750422219.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750422219.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750422219.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750422219_intersection_points; Type: INDEX; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750422219_intersection_points ON staging_seattle_1753750422219.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750422219_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750422219_routing_edges_geometry ON staging_seattle_1753750422219.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750422219_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750422219_routing_nodes_location ON staging_seattle_1753750422219.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750422219_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750422219_split_trails_geometry ON staging_seattle_1753750422219.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750422219_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750422219_trails_geometry ON staging_seattle_1753750422219.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750422219.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750422219; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750422219.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750442417.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750442417.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750442417.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750442417_intersection_points; Type: INDEX; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750442417_intersection_points ON staging_seattle_1753750442417.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750442417_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750442417_routing_edges_geometry ON staging_seattle_1753750442417.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750442417_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750442417_routing_nodes_location ON staging_seattle_1753750442417.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750442417_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750442417_split_trails_geometry ON staging_seattle_1753750442417.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750442417_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750442417_trails_geometry ON staging_seattle_1753750442417.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750442417.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750442417; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750442417.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750443990.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750443990.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750443990.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750443990_intersection_points; Type: INDEX; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750443990_intersection_points ON staging_seattle_1753750443990.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750443990_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750443990_routing_edges_geometry ON staging_seattle_1753750443990.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750443990_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750443990_routing_nodes_location ON staging_seattle_1753750443990.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750443990_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750443990_split_trails_geometry ON staging_seattle_1753750443990.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750443990_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750443990_trails_geometry ON staging_seattle_1753750443990.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750443990.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750443990; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750443990.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750446394.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750446394.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750446394.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750446394_intersection_points; Type: INDEX; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750446394_intersection_points ON staging_seattle_1753750446394.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750446394_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750446394_routing_edges_geometry ON staging_seattle_1753750446394.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750446394_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750446394_routing_nodes_location ON staging_seattle_1753750446394.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750446394_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750446394_split_trails_geometry ON staging_seattle_1753750446394.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750446394_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750446394_trails_geometry ON staging_seattle_1753750446394.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750446394.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750446394; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750446394.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750447593.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750447593.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750447593.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750447593_intersection_points; Type: INDEX; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750447593_intersection_points ON staging_seattle_1753750447593.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750447593_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750447593_routing_edges_geometry ON staging_seattle_1753750447593.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750447593_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750447593_routing_nodes_location ON staging_seattle_1753750447593.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750447593_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750447593_split_trails_geometry ON staging_seattle_1753750447593.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750447593_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750447593_trails_geometry ON staging_seattle_1753750447593.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750447593.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750447593; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750447593.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750451225.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750451225.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750451225.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750451225_intersection_points; Type: INDEX; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750451225_intersection_points ON staging_seattle_1753750451225.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750451225_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750451225_routing_edges_geometry ON staging_seattle_1753750451225.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750451225_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750451225_routing_nodes_location ON staging_seattle_1753750451225.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750451225_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750451225_split_trails_geometry ON staging_seattle_1753750451225.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750451225_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750451225_trails_geometry ON staging_seattle_1753750451225.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750451225.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750451225; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750451225.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750453617.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750453617.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750453617.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750453617_intersection_points; Type: INDEX; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750453617_intersection_points ON staging_seattle_1753750453617.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750453617_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750453617_routing_edges_geometry ON staging_seattle_1753750453617.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750453617_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750453617_routing_nodes_location ON staging_seattle_1753750453617.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750453617_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750453617_split_trails_geometry ON staging_seattle_1753750453617.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750453617_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750453617_trails_geometry ON staging_seattle_1753750453617.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750453617.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750453617; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750453617.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750454912.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750454912.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750454912.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750454912_intersection_points; Type: INDEX; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750454912_intersection_points ON staging_seattle_1753750454912.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750454912_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750454912_routing_edges_geometry ON staging_seattle_1753750454912.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750454912_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750454912_routing_nodes_location ON staging_seattle_1753750454912.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750454912_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750454912_split_trails_geometry ON staging_seattle_1753750454912.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750454912_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750454912_trails_geometry ON staging_seattle_1753750454912.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750454912.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750454912; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750454912.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750456121.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750456121.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750456121.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750456121_intersection_points; Type: INDEX; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750456121_intersection_points ON staging_seattle_1753750456121.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750456121_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750456121_routing_edges_geometry ON staging_seattle_1753750456121.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750456121_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750456121_routing_nodes_location ON staging_seattle_1753750456121.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750456121_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750456121_split_trails_geometry ON staging_seattle_1753750456121.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750456121_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750456121_trails_geometry ON staging_seattle_1753750456121.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750456121.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750456121; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750456121.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750459662.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750459662.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750459662.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750459662_intersection_points; Type: INDEX; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750459662_intersection_points ON staging_seattle_1753750459662.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750459662_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750459662_routing_edges_geometry ON staging_seattle_1753750459662.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750459662_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750459662_routing_nodes_location ON staging_seattle_1753750459662.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750459662_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750459662_split_trails_geometry ON staging_seattle_1753750459662.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750459662_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750459662_trails_geometry ON staging_seattle_1753750459662.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750459662.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750459662; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750459662.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750460968.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750460968.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750460968.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750460968_intersection_points; Type: INDEX; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750460968_intersection_points ON staging_seattle_1753750460968.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750460968_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750460968_routing_edges_geometry ON staging_seattle_1753750460968.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750460968_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750460968_routing_nodes_location ON staging_seattle_1753750460968.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750460968_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750460968_split_trails_geometry ON staging_seattle_1753750460968.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750460968_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750460968_trails_geometry ON staging_seattle_1753750460968.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750460968.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750460968; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750460968.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750462159.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750462159.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750462159.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750462159_intersection_points; Type: INDEX; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750462159_intersection_points ON staging_seattle_1753750462159.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750462159_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750462159_routing_edges_geometry ON staging_seattle_1753750462159.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750462159_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750462159_routing_nodes_location ON staging_seattle_1753750462159.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750462159_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750462159_split_trails_geometry ON staging_seattle_1753750462159.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750462159_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750462159_trails_geometry ON staging_seattle_1753750462159.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750462159.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750462159; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750462159.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750466862.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750466862.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750466862.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750466862_intersection_points; Type: INDEX; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750466862_intersection_points ON staging_seattle_1753750466862.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750466862_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750466862_routing_edges_geometry ON staging_seattle_1753750466862.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750466862_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750466862_routing_nodes_location ON staging_seattle_1753750466862.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750466862_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750466862_split_trails_geometry ON staging_seattle_1753750466862.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750466862_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750466862_trails_geometry ON staging_seattle_1753750466862.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750466862.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750466862; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750466862.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750527633.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750527633.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750527633.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750527633_intersection_points; Type: INDEX; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750527633_intersection_points ON staging_seattle_1753750527633.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750527633_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750527633_routing_edges_geometry ON staging_seattle_1753750527633.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750527633_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750527633_routing_nodes_location ON staging_seattle_1753750527633.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750527633_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750527633_split_trails_geometry ON staging_seattle_1753750527633.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750527633_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750527633_trails_geometry ON staging_seattle_1753750527633.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750527633.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750527633; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750527633.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750528914.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750528914.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750528914.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750528914_intersection_points; Type: INDEX; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750528914_intersection_points ON staging_seattle_1753750528914.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750528914_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750528914_routing_edges_geometry ON staging_seattle_1753750528914.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750528914_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750528914_routing_nodes_location ON staging_seattle_1753750528914.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750528914_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750528914_split_trails_geometry ON staging_seattle_1753750528914.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750528914_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750528914_trails_geometry ON staging_seattle_1753750528914.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750528914.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750528914; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750528914.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750531246.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750531246.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750531246.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750531246_intersection_points; Type: INDEX; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750531246_intersection_points ON staging_seattle_1753750531246.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750531246_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750531246_routing_edges_geometry ON staging_seattle_1753750531246.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750531246_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750531246_routing_nodes_location ON staging_seattle_1753750531246.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750531246_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750531246_split_trails_geometry ON staging_seattle_1753750531246.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750531246_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750531246_trails_geometry ON staging_seattle_1753750531246.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750531246.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750531246; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750531246.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750532511.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750532511.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750532511.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750532511_intersection_points; Type: INDEX; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750532511_intersection_points ON staging_seattle_1753750532511.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750532511_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750532511_routing_edges_geometry ON staging_seattle_1753750532511.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750532511_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750532511_routing_nodes_location ON staging_seattle_1753750532511.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750532511_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750532511_split_trails_geometry ON staging_seattle_1753750532511.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750532511_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750532511_trails_geometry ON staging_seattle_1753750532511.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750532511.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750532511; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750532511.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750535980.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750535980.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750535980.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750535980_intersection_points; Type: INDEX; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750535980_intersection_points ON staging_seattle_1753750535980.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750535980_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750535980_routing_edges_geometry ON staging_seattle_1753750535980.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750535980_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750535980_routing_nodes_location ON staging_seattle_1753750535980.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750535980_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750535980_split_trails_geometry ON staging_seattle_1753750535980.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750535980_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750535980_trails_geometry ON staging_seattle_1753750535980.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750535980.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750535980; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750535980.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750538290.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750538290.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750538290.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750538290_intersection_points; Type: INDEX; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750538290_intersection_points ON staging_seattle_1753750538290.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750538290_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750538290_routing_edges_geometry ON staging_seattle_1753750538290.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750538290_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750538290_routing_nodes_location ON staging_seattle_1753750538290.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750538290_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750538290_split_trails_geometry ON staging_seattle_1753750538290.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750538290_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750538290_trails_geometry ON staging_seattle_1753750538290.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750538290.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750538290; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750538290.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750539526.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750539526.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750539526.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750539526_intersection_points; Type: INDEX; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750539526_intersection_points ON staging_seattle_1753750539526.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750539526_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750539526_routing_edges_geometry ON staging_seattle_1753750539526.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750539526_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750539526_routing_nodes_location ON staging_seattle_1753750539526.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750539526_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750539526_split_trails_geometry ON staging_seattle_1753750539526.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750539526_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750539526_trails_geometry ON staging_seattle_1753750539526.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750539526.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750539526; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750539526.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750540696.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750540696.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750540696.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750540696_intersection_points; Type: INDEX; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750540696_intersection_points ON staging_seattle_1753750540696.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750540696_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750540696_routing_edges_geometry ON staging_seattle_1753750540696.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750540696_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750540696_routing_nodes_location ON staging_seattle_1753750540696.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750540696_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750540696_split_trails_geometry ON staging_seattle_1753750540696.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750540696_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750540696_trails_geometry ON staging_seattle_1753750540696.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750540696.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750540696; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750540696.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750544229.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750544229.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750544229.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750544229_intersection_points; Type: INDEX; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750544229_intersection_points ON staging_seattle_1753750544229.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750544229_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750544229_routing_edges_geometry ON staging_seattle_1753750544229.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750544229_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750544229_routing_nodes_location ON staging_seattle_1753750544229.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750544229_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750544229_split_trails_geometry ON staging_seattle_1753750544229.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750544229_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750544229_trails_geometry ON staging_seattle_1753750544229.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750544229.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750544229; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750544229.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750545409.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750545409.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750545409.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750545409_intersection_points; Type: INDEX; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750545409_intersection_points ON staging_seattle_1753750545409.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750545409_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750545409_routing_edges_geometry ON staging_seattle_1753750545409.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750545409_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750545409_routing_nodes_location ON staging_seattle_1753750545409.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750545409_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750545409_split_trails_geometry ON staging_seattle_1753750545409.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750545409_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750545409_trails_geometry ON staging_seattle_1753750545409.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750545409.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750545409; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750545409.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750546595.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750546595.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750546595.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750546595_intersection_points; Type: INDEX; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750546595_intersection_points ON staging_seattle_1753750546595.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750546595_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750546595_routing_edges_geometry ON staging_seattle_1753750546595.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750546595_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750546595_routing_nodes_location ON staging_seattle_1753750546595.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750546595_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750546595_split_trails_geometry ON staging_seattle_1753750546595.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750546595_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750546595_trails_geometry ON staging_seattle_1753750546595.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750546595.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750546595; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750546595.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_seattle_1753750551060.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_seattle_1753750551060.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_seattle_1753750551060.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750551060_intersection_points; Type: INDEX; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750551060_intersection_points ON staging_seattle_1753750551060.intersection_points USING gist (point);


--
-- Name: idx_staging_seattle_1753750551060_routing_edges_geometry; Type: INDEX; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750551060_routing_edges_geometry ON staging_seattle_1753750551060.routing_edges USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750551060_routing_nodes_location; Type: INDEX; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750551060_routing_nodes_location ON staging_seattle_1753750551060.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_seattle_1753750551060_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750551060_split_trails_geometry ON staging_seattle_1753750551060.split_trails USING gist (geometry);


--
-- Name: idx_staging_seattle_1753750551060_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE INDEX idx_staging_seattle_1753750551060_trails_geometry ON staging_seattle_1753750551060.trails USING gist (geometry);


--
-- Name: idx_staging_split_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE INDEX idx_staging_split_trails_geometry ON staging_seattle_1753750551060.split_trails USING gist (geometry);


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_seattle_1753750551060; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_seattle_1753750551060.trails USING gist (geometry);


--
-- Name: trails update_trails_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_trails_updated_at BEFORE UPDATE ON public.trails FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_boulder_1753750357844.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750357844; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750357844.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_boulder_1753750357844.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_boulder_1753750358170.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750358170; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750358170.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_boulder_1753750358170.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_boulder_1753750422402.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750422402; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422402.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_boulder_1753750422402.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_boulder_1753750422846.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750422846; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750422846.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_boulder_1753750422846.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_boulder_1753750467330.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750467330; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467330.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_boulder_1753750467330.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_boulder_1753750467617.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750467617; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750467617.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_boulder_1753750467617.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_boulder_1753750552692.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750552692; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552692.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_boulder_1753750552692.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_boulder_1753750552888.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1753750552888; Owner: -
--

ALTER TABLE ONLY staging_boulder_1753750552888.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_boulder_1753750552888.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750361222.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750361222; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750361222.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750361222.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750362437.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750362437; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750362437.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750362437.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750365906.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750365906; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750365906.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750365906.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750367114.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750367114; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750367114.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750367114.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750368341.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750368341; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750368341.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750368341.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750372953.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750372953; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750372953.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750372953.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750378967.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750378967; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750378967.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750378967.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750380156.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750380156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750380156.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750380156.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750382409.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750382409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750382409.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750382409.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750383587.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750383587; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750383587.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750383587.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750387012.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750387012; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750387012.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750387012.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750389371.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750389371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750389371.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750389371.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750398553.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750398553; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750398553.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750398553.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750399762.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750399762; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750399762.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750399762.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750402156.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750402156; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750402156.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750402156.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750403371.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750403371; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750403371.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750403371.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750406858.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750406858; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750406858.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750406858.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750409210.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750409210; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750409210.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750409210.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750410481.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750410481; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750410481.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750410481.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750411680.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750411680; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750411680.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750411680.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750415131.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750415131; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750415131.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750415131.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750416323.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750416323; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750416323.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750416323.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750417519.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750417519; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750417519.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750417519.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750422219.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750422219; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750422219.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750422219.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750442417.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750442417; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750442417.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750442417.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750443990.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750443990; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750443990.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750443990.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750446394.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750446394; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750446394.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750446394.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750447593.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750447593; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750447593.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750447593.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750451225.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750451225; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750451225.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750451225.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750453617.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750453617; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750453617.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750453617.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750454912.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750454912; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750454912.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750454912.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750456121.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750456121; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750456121.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750456121.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750459662.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750459662; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750459662.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750459662.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750460968.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750460968; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750460968.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750460968.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750462159.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750462159; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750462159.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750462159.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750466862.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750466862; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750466862.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750466862.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750527633.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750527633; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750527633.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750527633.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750528914.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750528914; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750528914.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750528914.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750531246.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750531246; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750531246.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750531246.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750532511.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750532511; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750532511.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750532511.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750535980.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750535980; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750535980.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750535980.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750538290.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750538290; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750538290.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750538290.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750539526.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750539526; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750539526.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750539526.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750540696.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750540696; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750540696.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750540696.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750544229.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750544229; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750544229.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750544229.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750545409.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750545409; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750545409.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750545409.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750546595.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750546595; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750546595.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750546595.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.routing_edges
    ADD CONSTRAINT routing_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES staging_seattle_1753750551060.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: staging_seattle_1753750551060; Owner: -
--

ALTER TABLE ONLY staging_seattle_1753750551060.routing_edges
    ADD CONSTRAINT routing_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES staging_seattle_1753750551060.routing_nodes(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

