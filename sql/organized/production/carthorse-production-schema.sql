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
-- Name: staging_boulder_1754076594794; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1754076594794;


--
-- Name: staging_boulder_1754076945956; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1754076945956;


--
-- Name: staging_boulder_1754077088464; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1754077088464;


--
-- Name: staging_boulder_1754077167124; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1754077167124;


--
-- Name: staging_boulder_1754077262506; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging_boulder_1754077262506;


--
-- Name: test_bbox_debug; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA test_bbox_debug;


--
-- Name: test_debug; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA test_debug;


--
-- Name: test_e2e_workflow_1754016871435; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA test_e2e_workflow_1754016871435;


--
-- Name: test_export_schema; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA test_export_schema;


--
-- Name: test_orphaned_nodes_1754016870045; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA test_orphaned_nodes_1754016870045;


--
-- Name: test_route_edge_cases_1754016870098; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA test_route_edge_cases_1754016870098;


--
-- Name: test_route_integration_1754016869970; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA test_route_integration_1754016869970;


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
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, elevation_loss)
        WITH trail_segments AS (
            -- Get all trail segments with validated geometry
            -- Preserve 3D geometry by removing ST_Force2D()
            SELECT 
                id,
                app_uuid,
                name,
                geometry,
                length_km,
                elevation_gain,
                elevation_loss,
                ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        elevation_calculated AS (
            -- Calculate elevation data from geometry using PostGIS function
            -- If existing elevation data is NULL, calculate from geometry
            -- If calculation fails, preserve NULL (don''t default to 0)
            SELECT 
                ts.*,
                CASE 
                    WHEN ts.elevation_gain IS NOT NULL THEN ts.elevation_gain
                    ELSE (SELECT elevation_gain FROM recalculate_elevation_data(ST_Force3D(ts.geometry)))
                END as calculated_elevation_gain,
                CASE 
                    WHEN ts.elevation_loss IS NOT NULL THEN ts.elevation_loss
                    ELSE (SELECT elevation_loss FROM recalculate_elevation_data(ST_Force3D(ts.geometry)))
                END as calculated_elevation_loss
            FROM trail_segments ts
        ),
        node_connections AS (
            -- Find which nodes connect to each trail segment using spatial functions
            SELECT 
                ec.id as trail_id,
                ec.app_uuid as trail_uuid,
                ec.name as trail_name,
                ec.length_km,
                ec.calculated_elevation_gain as elevation_gain,
                ec.calculated_elevation_loss as elevation_loss,
                ec.geometry,
                -- Find start node using spatial proximity
                (SELECT n.id 
                 FROM %I.routing_nodes n 
                 WHERE ST_DWithin(ec.start_point, ST_SetSRID(ST_Point(n.lng, n.lat), 4326), GREATEST(0.001, 0.001))
                 ORDER BY ST_Distance(ec.start_point, ST_SetSRID(ST_Point(n.lng, n.lat), 4326))
                 LIMIT 1) as from_node_id,
                -- Find end node using spatial proximity
                (SELECT n.id 
                 FROM %I.routing_nodes n 
                 WHERE ST_DWithin(ec.end_point, ST_SetSRID(ST_Point(n.lng, n.lat), 4326), GREATEST(0.001, 0.001))
                 ORDER BY ST_Distance(ec.end_point, ST_SetSRID(ST_Point(n.lng, n.lat), 4326))
                 LIMIT 1) as to_node_id
            FROM elevation_calculated ec
        ),
        valid_edges AS (
            -- Only include edges where both nodes are found
            SELECT 
                trail_id,
                trail_uuid,
                trail_name,
                length_km,
                elevation_gain,
                elevation_loss,
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
                -- Preserve NULL elevation values - don''t default to 0
                elevation_gain,
                elevation_loss,
                -- Validate that nodes are actually connected to the trail
                ST_DWithin(
                    ST_SetSRID(ST_Point(
                        (SELECT lng FROM %I.routing_nodes WHERE id = from_node_id),
                        (SELECT lat FROM %I.routing_nodes WHERE id = from_node_id)
                    ), 4326),
                    geometry,
                    GREATEST(0.001, 0.001)
                ) as start_connected,
                ST_DWithin(
                    ST_SetSRID(ST_Point(
                        (SELECT lng FROM %I.routing_nodes WHERE id = to_node_id),
                        (SELECT lat FROM %I.routing_nodes WHERE id = to_node_id)
                    ), 4326),
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
            elevation_gain,
            elevation_loss
        FROM edge_metrics
        WHERE start_connected AND end_connected
        ORDER BY trail_id
    ', staging_schema, staging_schema, trails_table, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema);
    
    -- Get the count of inserted edges
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    RETURN edge_count;
END;
$$;


--
-- Name: build_routing_edges(text, text, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.build_routing_edges(staging_schema text, trails_table text, edge_tolerance double precision DEFAULT 20.0) RETURNS integer
    LANGUAGE plpgsql
    AS $_$
DECLARE
    edge_count integer := 0;
    dyn_sql text;
BEGIN
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    dyn_sql := format($f$
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geo2)
        WITH trail_segments AS (
            SELECT id, app_uuid, name, geo2 as geo2_2d, length_km, elevation_gain, elevation_loss,
ST_StartPoint(geo2) as start_point, ST_EndPoint(geo2) as end_point
            FROM %I.%I
            WHERE geo2 IS NOT NULL AND ST_IsValid(geo2) AND ST_Length(geo2) > 0.1
        ),
        elevation_calculated AS (
            -- Calculate elevation data from geometry using PostGIS function
            -- If existing elevation data is NULL, calculate from geometry
            -- If calculation fails, preserve NULL (don''t default to 0)
            SELECT 
                ts.*,
                CASE 
                    WHEN ts.elevation_gain IS NOT NULL THEN ts.elevation_gain
                    ELSE (SELECT elevation_gain FROM recalculate_elevation_data(ST_Force3D(ts.geo2)))
                END as calculated_elevation_gain,
                CASE 
                    WHEN ts.elevation_loss IS NOT NULL THEN ts.elevation_loss
                    ELSE (SELECT elevation_loss FROM recalculate_elevation_data(ST_Force3D(ts.geo2)))
                END as calculated_elevation_loss
            FROM trail_segments ts
        ),
        node_connections AS (
            SELECT ec.id as trail_id, ec.app_uuid as trail_uuid, ec.name as trail_name, ec.length_km, 
                   ec.calculated_elevation_gain as elevation_gain, ec.calculated_elevation_loss as elevation_loss,
                   ec.geo2_2d, fn.id as from_node_id, tn.id as to_node_id, 
                   fn.lat as from_lat, fn.lng as from_lng, tn.lat as to_lat, tn.lng as to_lng
            FROM elevation_calculated ec
            LEFT JOIN LATERAL (
                SELECT n.id, n.lat, n.lng
                FROM %I.routing_nodes n
                WHERE ST_DWithin(ec.start_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), %s)
ORDER BY ST_Distance(ec.start_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                LIMIT 1
            ) fn ON true
            LEFT JOIN LATERAL (
                SELECT n.id, n.lat, n.lng
                FROM %I.routing_nodes n
                WHERE ST_DWithin(ec.end_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), %s)
ORDER BY ST_Distance(ec.end_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                LIMIT 1
            ) tn ON true
        ),
        valid_edges AS (
            SELECT trail_id, trail_uuid, trail_name, length_km, elevation_gain, elevation_loss, geo2_2d, 
                   from_node_id, to_node_id, from_lat, from_lng, to_lat, to_lng
            FROM node_connections
            WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL AND from_node_id <> to_node_id
        ),
        edge_metrics AS (
            SELECT trail_id, trail_uuid, trail_name, from_node_id, to_node_id,
                   COALESCE(length_km, ST_Length(geo2_2d::geography) / 1000) as distance_km,
                   -- Preserve NULL elevation values - don''t default to 0
                   elevation_gain,
                   elevation_loss,
                   ST_MakeLine(ST_SetSRID(ST_MakePoint(from_lng, from_lat), 4326), ST_SetSRID(ST_MakePoint(to_lng, to_lat), 4326)) as geo2
            FROM valid_edges
        )
        SELECT from_node_id, to_node_id, trail_uuid as trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geo2
        FROM edge_metrics
        ORDER BY trail_id
    $f$, staging_schema, staging_schema, trails_table, staging_schema, edge_tolerance, staging_schema, edge_tolerance);
    RAISE NOTICE 'build_routing_edges SQL: %', dyn_sql;
    EXECUTE dyn_sql;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    RETURN edge_count;
END;
$_$;


--
-- Name: build_routing_edges_fixed(text, text, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.build_routing_edges_fixed(staging_schema text, trails_table text, edge_tolerance double precision DEFAULT 20.0) RETURNS integer
    LANGUAGE plpgsql
    AS $$ DECLARE edge_count integer := 0; BEGIN EXECUTE format('DELETE FROM %I.routing_edges', staging_schema); EXECUTE format('INSERT INTO %I.routing_edges (source, target, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geometry) SELECT from_node_id, to_node_id, trail_uuid, trail_name, distance_km, elevation_gain, elevation_loss, geo2 FROM (SELECT ec.id as trail_id, ec.app_uuid as trail_uuid, ec.name as trail_name, ec.length_km, ec.elevation_gain, ec.elevation_loss, fn.id as from_node_id, tn.id as to_node_id, COALESCE(ec.length_km, ST_Length(ec.geometry::geography) / 1000) as distance_km, ec.geometry as geo2 FROM %I.%I ec LEFT JOIN LATERAL (SELECT n.id FROM %I.routing_nodes n WHERE ST_DWithin(ST_StartPoint(ec.geometry), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), %s) ORDER BY ST_Distance(ST_StartPoint(ec.geometry), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)) LIMIT 1) fn ON true LEFT JOIN LATERAL (SELECT n.id FROM %I.routing_nodes n WHERE ST_DWithin(ST_EndPoint(ec.geometry), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), %s) ORDER BY ST_Distance(ST_EndPoint(ec.geometry), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)) LIMIT 1) tn ON true WHERE ec.geometry IS NOT NULL AND ST_IsValid(ec.geometry) AND ST_Length(ec.geometry) > 0.1 AND fn.id IS NOT NULL AND tn.id IS NOT NULL AND fn.id <> tn.id) edges', staging_schema, staging_schema, trails_table, staging_schema, edge_tolerance, staging_schema, edge_tolerance); EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count; RETURN edge_count; END; $$;


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
            -- Preserve 3D geometry by removing ST_Force2D()
            SELECT 
                ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point,
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
            FROM detect_trail_intersections(''%I'', ''%I'', GREATEST($1, 0.001))
            WHERE array_length(connected_trail_ids, 1) > 1  -- Only true intersections
        ),
        all_nodes AS (
            -- Combine intersection points and trail endpoints
            SELECT 
                intersection_point as point,
                intersection_point_3d as point_3d,
                unnest(connected_trail_names) as connected_trail,
                ''intersection'' as node_type
            FROM intersection_points
            
            UNION ALL
            
            -- Trail start points
            SELECT 
                start_point as point,
                ST_Force3D(start_point) as point_3d,
                name as connected_trail,
                ''endpoint'' as node_type
            FROM trail_endpoints
            
            UNION ALL
            
            -- Trail end points
            SELECT 
                end_point as point,
                ST_Force3D(end_point) as point_3d,
                name as connected_trail,
                ''endpoint'' as node_type
            FROM trail_endpoints
        ),
        grouped_nodes AS (
            -- Group nearby nodes to avoid duplicates using spatial clustering
            SELECT 
                ST_X(point) as lng,
                ST_Y(point) as lat,
                COALESCE(ST_Z(point_3d), 0) as elevation,
                array_agg(DISTINCT connected_trail) as all_connected_trails,
                CASE 
                    WHEN array_length(array_agg(DISTINCT connected_trail), 1) > 1 THEN ''intersection''
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
-- Name: calculate_route_connectivity_score(integer, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_route_connectivity_score(trail_count integer, route_distance_km real) RETURNS real
    LANGUAGE plpgsql
    AS $$
DECLARE
    connectivity_score REAL;
BEGIN
    -- Return NULL if required parameters are NULL
    IF trail_count IS NULL OR route_distance_km IS NULL OR route_distance_km <= 0 THEN
        RETURN NULL;
    END IF;
    
    -- Calculate connectivity score based on trail density
    -- Higher score = better connectivity (more trails per km)
    connectivity_score := trail_count::REAL / route_distance_km;
    
    -- Normalize to 0-1 range (cap at 5 trails per km for max score)
    connectivity_score := LEAST(1.0, connectivity_score / 5.0);
    
    RETURN connectivity_score;
END;
$$;


--
-- Name: calculate_route_cost(double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_route_cost(steepness_m_per_km double precision, distance_km double precision) RETURNS double precision
    LANGUAGE plpgsql
    AS $$
DECLARE
    weights json;
BEGIN
    weights := get_cost_weights();
    
    RETURN (steepness_m_per_km * (weights ->> 'steepness_weight')::float) + 
           (distance_km * (weights ->> 'distance_weight')::float);
END;
$$;


--
-- Name: calculate_route_difficulty(real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_route_difficulty(elevation_gain_rate real) RETURNS text
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Return NULL if gain rate is NULL
    IF elevation_gain_rate IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Difficulty classification based on gain rate (m/km)
    IF elevation_gain_rate < 50 THEN
        RETURN 'easy';
    ELSIF elevation_gain_rate < 100 THEN
        RETURN 'moderate';
    ELSIF elevation_gain_rate < 150 THEN
        RETURN 'hard';
    ELSE
        RETURN 'expert';
    END IF;
END;
$$;


--
-- Name: calculate_route_elevation_stats(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_route_elevation_stats(route_edges_json jsonb) RETURNS TABLE(min_elevation real, max_elevation real, avg_elevation real)
    LANGUAGE plpgsql
    AS $$
DECLARE
    edge_record RECORD;
    min_elev REAL := 9999;
    max_elev REAL := -9999;
    total_elev REAL := 0;
    edge_count INTEGER := 0;
BEGIN
    -- Extract elevation data from route edges
    FOR edge_record IN 
        SELECT 
            (edge->>'min_elevation')::REAL as min_elev,
            (edge->>'max_elevation')::REAL as max_elev,
            (edge->>'avg_elevation')::REAL as avg_elev
        FROM jsonb_array_elements(route_edges_json) as edge
        WHERE edge->>'min_elevation' IS NOT NULL
          AND edge->>'max_elevation' IS NOT NULL
          AND edge->>'avg_elevation' IS NOT NULL
    LOOP
        -- Update min/max elevation
        IF edge_record.min_elev < min_elev THEN
            min_elev := edge_record.min_elev;
        END IF;
        IF edge_record.max_elev > max_elev THEN
            max_elev := edge_record.max_elev;
        END IF;
        
        -- Accumulate for average
        total_elev := total_elev + edge_record.avg_elev;
        edge_count := edge_count + 1;
    END LOOP;
    
    -- Return NULL if no valid elevation data found
    IF edge_count = 0 THEN
        RETURN QUERY SELECT NULL::REAL, NULL::REAL, NULL::REAL;
        RETURN;
    END IF;
    
    -- Return calculated statistics
    RETURN QUERY SELECT 
        CASE WHEN min_elev = 9999 THEN NULL ELSE min_elev END,
        CASE WHEN max_elev = -9999 THEN NULL ELSE max_elev END,
        total_elev / edge_count;
END;
$$;


--
-- Name: calculate_route_estimated_time(real, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_route_estimated_time(distance_km real, elevation_gain_rate real) RETURNS real
    LANGUAGE plpgsql
    AS $$
DECLARE
    base_speed_kmh REAL := 4.0; -- Base hiking speed on flat terrain
    elevation_factor REAL;
    estimated_hours REAL;
BEGIN
    -- Return NULL if distance is NULL or 0
    IF distance_km IS NULL OR distance_km <= 0 THEN
        RETURN NULL;
    END IF;
    
    -- Calculate elevation factor (slower on steep terrain)
    IF elevation_gain_rate IS NULL OR elevation_gain_rate < 50 THEN
        elevation_factor := 1.0; -- No penalty for easy terrain
    ELSIF elevation_gain_rate < 100 THEN
        elevation_factor := 0.8; -- 20% slower for moderate terrain
    ELSIF elevation_gain_rate < 150 THEN
        elevation_factor := 0.6; -- 40% slower for hard terrain
    ELSE
        elevation_factor := 0.4; -- 60% slower for expert terrain
    END IF;
    
    -- Calculate estimated time
    estimated_hours := distance_km / (base_speed_kmh * elevation_factor);
    
    -- Return minimum 0.5 hours and maximum 24 hours
    RETURN GREATEST(0.5, LEAST(24.0, estimated_hours));
END;
$$;


--
-- Name: calculate_route_gain_rate(real, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_route_gain_rate(route_distance_km real, route_elevation_gain real) RETURNS real
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Return NULL if distance is 0 or NULL to avoid division by zero
    IF route_distance_km IS NULL OR route_distance_km <= 0 THEN
        RETURN NULL;
    END IF;
    
    -- Return NULL if elevation gain is NULL
    IF route_elevation_gain IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Calculate gain rate: elevation gain / distance
    RETURN route_elevation_gain / route_distance_km;
END;
$$;


--
-- Name: calculate_route_parametric_metrics(real, real, integer, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_route_parametric_metrics(route_distance_km real, route_elevation_gain real, route_trail_count integer, route_edges_json jsonb) RETURNS TABLE(elevation_gain_rate real, difficulty text, estimated_time_hours real, connectivity_score real, min_elevation real, max_elevation real, avg_elevation real)
    LANGUAGE plpgsql
    AS $$
DECLARE
    gain_rate REAL;
    route_difficulty TEXT;
    estimated_time REAL;
    connectivity REAL;
    elevation_stats RECORD;
BEGIN
    -- Calculate route gain rate
    gain_rate := calculate_route_gain_rate(route_distance_km, route_elevation_gain);
    
    -- Calculate difficulty
    route_difficulty := calculate_route_difficulty(gain_rate);
    
    -- Calculate estimated time
    estimated_time := calculate_route_estimated_time(route_distance_km, gain_rate);
    
    -- Calculate connectivity score
    connectivity := calculate_route_connectivity_score(route_trail_count, route_distance_km);
    
    -- Calculate elevation statistics
    SELECT * INTO elevation_stats FROM calculate_route_elevation_stats(route_edges_json);
    
    -- Return all calculated metrics
    RETURN QUERY SELECT 
        gain_rate,
        route_difficulty,
        estimated_time,
        connectivity,
        elevation_stats.min_elevation,
        elevation_stats.max_elevation,
        elevation_stats.avg_elevation;
END;
$$;


--
-- Name: calculate_route_similarity_score(double precision, double precision, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_route_similarity_score(actual_distance_km double precision, target_distance_km double precision, actual_elevation_gain double precision, target_elevation_gain double precision) RETURNS double precision
    LANGUAGE plpgsql
    AS $$
DECLARE
    weights json;
    distance_score float;
    elevation_score float;
BEGIN
    weights := get_scoring_weights();
    
    -- Calculate individual scores (0-1, where 1 is perfect match)
    distance_score := GREATEST(0, 1 - ABS(actual_distance_km - target_distance_km) / target_distance_km);
    elevation_score := GREATEST(0, 1 - ABS(actual_elevation_gain - target_elevation_gain) / target_elevation_gain);
    
    -- Return weighted average
    RETURN (weights ->> 'distance_weight')::float * distance_score + 
           (weights ->> 'elevation_weight')::float * elevation_score;
END;
$$;


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
-- Name: cleanup_orphaned_nodes(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_orphaned_nodes(staging_schema text) RETURNS TABLE(success boolean, message text, cleaned_nodes integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
  orphaned_nodes_count integer := 0;
  total_nodes_before integer := 0;
  total_nodes_after integer := 0;
BEGIN
  -- Get count before cleanup
  EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO total_nodes_before;
  
  -- Remove orphaned nodes (nodes not connected to any trails)
  -- These are nodes that were created but don't actually connect any trail segments
  EXECUTE format('
    DELETE FROM %I.routing_nodes n
    WHERE NOT EXISTS (
      SELECT 1 FROM %I.trails t 
      WHERE ST_DWithin(
        ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), 
        ST_StartPoint(t.geometry), 
        0.0001
      ) OR ST_DWithin(
        ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), 
        ST_EndPoint(t.geometry), 
        0.0001
      )
    )', staging_schema, staging_schema);
  GET DIAGNOSTICS orphaned_nodes_count = ROW_COUNT;
  
  -- Get count after cleanup
  EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO total_nodes_after;
  
  -- Return results
  IF orphaned_nodes_count > 0 THEN
    RETURN QUERY SELECT 
      true as success,
      'Cleaned ' || orphaned_nodes_count || ' orphaned nodes before edge generation (before: ' || total_nodes_before || ', after: ' || total_nodes_after || ')' as message,
      orphaned_nodes_count as cleaned_nodes;
  ELSE
    RETURN QUERY SELECT 
      true as success,
      'No orphaned nodes found - node set is clean (total: ' || total_nodes_after || ')' as message,
      0 as cleaned_nodes;
  END IF;
END;
$$;


--
-- Name: cleanup_routing_graph(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_routing_graph(staging_schema text) RETURNS TABLE(success boolean, message text, cleaned_edges integer, cleaned_nodes integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
  self_loops_count integer := 0;
  orphaned_nodes_count integer := 0;
  orphaned_edges_count integer := 0;
BEGIN
  -- Remove self-loops (edges where source = target)
  EXECUTE format('DELETE FROM %I.routing_edges WHERE source = target', staging_schema);
  GET DIAGNOSTICS self_loops_count = ROW_COUNT;
  
  -- Remove orphaned edges (edges pointing to non-existent nodes)
  EXECUTE format('
    DELETE FROM %I.routing_edges e
    WHERE NOT EXISTS (
      SELECT 1 FROM %I.routing_nodes n WHERE n.id = e.source
    ) OR NOT EXISTS (
      SELECT 1 FROM %I.routing_nodes n WHERE n.id = e.target
    )', staging_schema, staging_schema, staging_schema);
  GET DIAGNOSTICS orphaned_edges_count = ROW_COUNT;
  
  -- Remove orphaned nodes (nodes not connected to any edges)
  EXECUTE format('
    DELETE FROM %I.routing_nodes n
    WHERE NOT EXISTS (
      SELECT 1 FROM %I.routing_edges e WHERE e.source = n.id OR e.target = n.id
    )', staging_schema, staging_schema);
  GET DIAGNOSTICS orphaned_nodes_count = ROW_COUNT;
  
  -- Return results
  IF self_loops_count > 0 OR orphaned_edges_count > 0 OR orphaned_nodes_count > 0 THEN
    RETURN QUERY SELECT 
      true as success,
      'Cleaned routing graph: ' || self_loops_count || ' self-loops, ' || 
      orphaned_edges_count || ' orphaned edges, ' || orphaned_nodes_count || ' orphaned nodes' as message,
      (self_loops_count + orphaned_edges_count) as cleaned_edges,
      orphaned_nodes_count as cleaned_nodes;
  ELSE
    RETURN QUERY SELECT 
      true as success,
      'Routing graph is clean - no issues found' as message,
      0 as cleaned_edges,
      0 as cleaned_nodes;
  END IF;
END;
$$;


--
-- Name: get_intersection_tolerance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_intersection_tolerance() RETURNS double precision
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'intersection_tolerance')::float;
END;
$$;


--
-- Name: copy_and_split_trails_to_staging_native(text, text, text, real, real, real, real, integer, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.copy_and_split_trails_to_staging_native(staging_schema text, source_table text, region_filter text, bbox_min_lng real DEFAULT NULL::real, bbox_min_lat real DEFAULT NULL::real, bbox_max_lng real DEFAULT NULL::real, bbox_max_lat real DEFAULT NULL::real, trail_limit integer DEFAULT NULL::integer, tolerance_meters real DEFAULT public.get_intersection_tolerance()) RETURNS TABLE(original_count integer, split_count integer, intersection_count integer, success boolean, message text)
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
            geometry, geometry_text, geometry_hash, created_at, updated_at
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
            -- Get all source trails (explicitly select only columns that exist in production)
            SELECT 
                id, app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
                bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                source, created_at, updated_at, geometry
            FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        ),
        trails_with_intersections AS (
            -- Get trails that have intersections
            SELECT 
                at.id, at.app_uuid, at.osm_id, at.name, at.region, at.trail_type, at.surface, at.difficulty, at.source_tags,
                at.bbox_min_lng, at.bbox_max_lng, at.bbox_min_lat, at.bbox_max_lat,
                at.length_km, at.elevation_gain, at.elevation_loss, at.max_elevation, at.min_elevation, at.avg_elevation,
                at.source, at.created_at, at.updated_at, at.geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).geom as split_geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).path[1] as segment_order
            FROM all_trails at
            JOIN trail_intersections ti ON at.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
        ),
        trails_without_intersections AS (
            -- Get trails that don't have intersections (keep original)
            SELECT 
                at.id, at.app_uuid, at.osm_id, at.name, at.region, at.trail_type, at.surface, at.difficulty, at.source_tags,
                at.bbox_min_lng, at.bbox_max_lng, at.bbox_min_lat, at.bbox_max_lat,
                at.length_km, at.elevation_gain, at.elevation_loss, at.max_elevation, at.min_elevation, at.avg_elevation,
                at.source, at.created_at, at.updated_at, at.geometry,
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
            ST_AsText(split_geometry) as geometry_text,
            md5(ST_AsText(split_geometry)) as geometry_hash,
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
            ST_Force2D(intersection_point) as point,
            ST_Force3D(intersection_point) as point_3d,
            ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
            ARRAY[t1.name, t2.name] as connected_trail_names,
            'intersection' as node_type,
            $1 as distance_meters
        FROM (
            SELECT 
                (ST_Dump(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)))).geom as intersection_point,
                t1.app_uuid as t1_uuid,
                t2.app_uuid as t2_uuid
            FROM %I.trails t1
            JOIN %I.trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) IN ('ST_Point', 'ST_MultiPoint')
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
-- Name: detect_trail_intersections(text, text, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_trail_intersections(trails_schema text, trails_table text, intersection_tolerance_meters double precision DEFAULT 1.0) RETURNS TABLE(intersection_point public.geometry, intersection_point_3d public.geometry, connected_trail_ids integer[], connected_trail_names text[], node_type text, distance_meters double precision)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE format('
        WITH noded_trails AS (
            -- Use ST_Node to split all trails at intersections (network topology)
            -- Preserve 3D geometry by removing ST_Force2D()
            SELECT id, name, (ST_Dump(ST_Node(geometry))).geom as noded_geom
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        true_intersections AS (
            -- True geometric intersections (where two trails cross/touch)
            -- Preserve 3D geometry by removing ST_Force2D()
            SELECT 
                ST_Intersection(t1.noded_geom, t2.noded_geom) as intersection_point,
                ST_Force3D(ST_Intersection(t1.noded_geom, t2.noded_geom)) as intersection_point_3d,
                ARRAY[t1.id, t2.id] as connected_trail_ids,
                ARRAY[t1.name, t2.name] as connected_trail_names,
                ''intersection'' as node_type,
                0.0 as distance_meters
            FROM noded_trails t1
            JOIN noded_trails t2 ON (t1.id < t2.id)
            WHERE ST_Intersects(t1.noded_geom, t2.noded_geom)
              AND ST_GeometryType(ST_Intersection(t1.noded_geom, t2.noded_geom)) = ''ST_Point''
        ),
        endpoint_near_miss AS (
            -- Endpoints within a tight threshold (1.0 meter)
            -- Preserve 3D geometry by removing ST_Force2D()
            SELECT 
                ST_EndPoint(t1.noded_geom) as intersection_point,
                ST_Force3D(ST_EndPoint(t1.noded_geom)) as intersection_point_3d,
                ARRAY[t1.id, t2.id] as connected_trail_ids,
                ARRAY[t1.name, t2.name] as connected_trail_names,
                ''endpoint_near_miss'' as node_type,
                ST_Distance(ST_EndPoint(t1.noded_geom), ST_EndPoint(t2.noded_geom)) as distance_meters
            FROM noded_trails t1
            JOIN noded_trails t2 ON (t1.id < t2.id)
            WHERE ST_DWithin(ST_EndPoint(t1.noded_geom), ST_EndPoint(t2.noded_geom), GREATEST($1, 0.001))
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
-- Name: find_out_and_back_spatial(text, double precision, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_out_and_back_spatial(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, tolerance_percent double precision DEFAULT 30.0) RETURNS TABLE(route_id text, start_node integer, end_node integer, total_distance_km double precision, total_elevation_gain double precision, route_path integer[], route_edges integer[], route_shape text, trail_count integer, similarity_score double precision)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    min_distance float;
    max_distance float;
    min_elevation float;
    max_elevation float;
BEGIN
    -- Calculate tolerance ranges
    min_distance := target_distance_km * (1 - tolerance_percent / 100.0);
    max_distance := target_distance_km * (1 + tolerance_percent / 100.0);
    min_elevation := target_elevation_gain * (1 - tolerance_percent / 100.0);
    max_elevation := target_elevation_gain * (1 + tolerance_percent / 100.0);
    
    RETURN QUERY EXECUTE format($f$
        WITH out_and_back AS (
            -- Find edges that form out-and-back routes
            SELECT 
                e1.id as edge1_id,
                e1.source as start_node,
                e1.target as mid_node,
                e2.id as edge2_id,
                e2.target as end_node,
                e1.distance_km + e2.distance_km as total_distance,
                COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0) as total_elevation,
                ARRAY[e1.source, e1.target, e2.target] as path,
                ARRAY[e1.id, e2.id] as edges,
                ARRAY[e1.trail_name, e2.trail_name] as trail_names
            FROM %I.routing_edges e1
            JOIN %I.routing_edges e2 ON e1.target = e2.source
            WHERE e1.source = e2.target  -- Forms a loop back to start
              AND e1.distance_km + e2.distance_km BETWEEN $1 AND $2
              AND COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0) BETWEEN $3 AND $4
        ),
        valid_routes AS (
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance as total_distance_km,
                total_elevation as total_elevation_gain,
                path,
                edges,
                'out-and-back' as route_shape,
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                calculate_route_similarity_score(
                    total_distance, $5,
                    total_elevation, $6
                ) as similarity_score
            FROM out_and_back
            GROUP BY start_node, end_node, total_distance, total_elevation, path, edges
        )
        SELECT * FROM valid_routes
        WHERE similarity_score >= get_min_route_score()
        ORDER BY similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema, staging_schema)
    USING min_distance, max_distance, min_elevation, max_elevation,
          target_distance_km, target_elevation_gain;
END;
$_$;


--
-- Name: find_routes_for_criteria(text, double precision, double precision, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_routes_for_criteria(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, desired_route_shape text DEFAULT NULL::text, max_routes integer DEFAULT 10) RETURNS TABLE(route_id text, total_distance_km double precision, total_elevation_gain double precision, route_shape text, trail_count integer, similarity_score double precision, route_path integer[], route_edges integer[])
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE format($f$
        SELECT 
            route_id,
            total_distance_km,
            total_elevation_gain,
            route_shape,
            trail_count,
            similarity_score,
            route_path,
            route_edges
        FROM find_routes_recursive($1, $2, $3, 20.0, 8)
        WHERE ($4 IS NULL OR route_shape = $4)
        ORDER BY similarity_score DESC
        LIMIT $5
    $f$, staging_schema)
    USING target_distance_km, target_elevation_gain, desired_route_shape, max_routes;
END;
$_$;


--
-- Name: find_routes_for_criteria_configurable(text, double precision, double precision, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_routes_for_criteria_configurable(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, desired_route_shape text DEFAULT NULL::text, max_routes integer DEFAULT NULL::integer) RETURNS TABLE(route_id text, total_distance_km double precision, total_elevation_gain double precision, route_shape text, trail_count integer, similarity_score double precision, route_path integer[], route_edges integer[])
    LANGUAGE plpgsql
    AS $_$
DECLARE
    config_max_routes integer;
BEGIN
    IF max_routes IS NULL THEN
        config_max_routes := get_max_routes_per_bin();
    ELSE
        config_max_routes := max_routes;
    END IF;
    
    RETURN QUERY EXECUTE format($f$
        SELECT 
            route_id,
            total_distance_km,
            total_elevation_gain,
            route_shape,
            trail_count,
            similarity_score,
            route_path,
            route_edges
        FROM find_routes_recursive_configurable($1, $2, $3, 20.0, 8)
        WHERE ($4 IS NULL OR route_shape = $4)
        ORDER BY similarity_score DESC
        LIMIT $5
    $f$, staging_schema)
    USING staging_schema, target_distance_km, target_elevation_gain, desired_route_shape, config_max_routes;
END;
$_$;


--
-- Name: find_routes_recursive(text, double precision, double precision, double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_routes_recursive(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, tolerance_percent double precision DEFAULT 20.0, max_depth integer DEFAULT 8) RETURNS TABLE(route_id text, start_node integer, end_node integer, total_distance_km double precision, total_elevation_gain double precision, route_path integer[], route_edges integer[], route_shape text, trail_count integer, similarity_score double precision)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE format($f$
        WITH RECURSIVE route_search AS (
            -- Start with all intersection nodes as potential starting points
            SELECT 
                id as start_node,
                id as current_node,
                id as end_node,
                ARRAY[id] as path,
                ARRAY[]::integer[] as edges,
                0.0::double precision as total_distance,
                0.0::double precision as total_elevation_gain,
                0 as depth,
                ARRAY[]::text[] as trail_names
            FROM %I.routing_nodes
            WHERE node_type IN ('intersection', 'endpoint')
            
            UNION ALL
            
            -- Recursively explore connected nodes
            SELECT 
                rs.start_node,
                e.target as current_node,
                e.target as end_node,
                rs.path || e.target,
                rs.edges || e.id,
                (rs.total_distance + e.distance_km)::double precision,
                (rs.total_elevation_gain + COALESCE(e.elevation_gain, 0))::double precision,
                rs.depth + 1,
                rs.trail_names || e.trail_name
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.current_node = e.source
            WHERE rs.depth < $1  -- Limit depth to prevent infinite loops
              AND e.target != ALL(rs.path)  -- Avoid cycles
              AND rs.total_distance < $2 * (1 + $3 / 100.0)  -- Distance tolerance
              AND rs.total_elevation_gain < $4 * (1 + $3 / 100.0)  -- Elevation tolerance
        ),
        valid_routes AS (
            -- Filter to routes that meet our criteria
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance as total_distance_km,
                total_elevation_gain,
                path as route_path,
                edges as route_edges,
                -- Classify route shape
                CASE 
                    WHEN start_node = end_node THEN 'loop'
                    WHEN array_length(path, 1) = 2 THEN 'out-and-back'
                    WHEN array_length(path, 1) > 2 AND start_node = end_node THEN 'loop'
                    ELSE 'point-to-point'
                END as route_shape,
                -- Count unique trails
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                -- Calculate similarity score (0-1)
                calculate_route_similarity_score(total_distance, $2, total_elevation_gain, $4) as similarity_score
            FROM route_search
            WHERE total_distance >= $2 * (1 - $3 / 100.0)  -- Minimum distance
              AND total_distance <= $2 * (1 + $3 / 100.0)  -- Maximum distance
              AND total_elevation_gain >= $4 * (1 - $3 / 100.0)  -- Minimum elevation
              AND total_elevation_gain <= $4 * (1 + $3 / 100.0)  -- Maximum elevation
              AND array_length(path, 1) >= 2  -- At least 2 nodes
            GROUP BY start_node, end_node, total_distance, total_elevation_gain, route_path, route_edges
        )
        SELECT 
            route_id,
            start_node,
            end_node,
            total_distance_km,
            total_elevation_gain,
            route_path,
            route_edges,
            route_shape,
            trail_count,
            similarity_score
        FROM valid_routes
        ORDER BY similarity_score DESC, total_distance_km
        LIMIT get_max_routes_per_bin()  -- Limit results
    $f$, staging_schema, staging_schema)
    USING max_depth, target_distance_km, tolerance_percent, target_elevation_gain;
END;
$_$;


--
-- Name: find_routes_recursive_configurable(text, double precision, double precision, double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_routes_recursive_configurable(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, tolerance_percent double precision DEFAULT NULL::double precision, max_depth integer DEFAULT 8) RETURNS TABLE(route_id text, start_node integer, end_node integer, total_distance_km double precision, total_elevation_gain double precision, route_path integer[], route_edges integer[], route_shape text, trail_count integer, similarity_score double precision)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    config_tolerance float;
    distance_limits json;
    elevation_limits json;
BEGIN
    -- Get configurable values
    IF tolerance_percent IS NULL THEN
        config_tolerance := 20.0;  -- Default from config
    ELSE
        config_tolerance := tolerance_percent;
    END IF;
    
    distance_limits := get_route_distance_limits();
    elevation_limits := get_elevation_gain_limits();
    
    RETURN QUERY EXECUTE format($f$
        WITH RECURSIVE route_search AS (
            -- Start with all intersection nodes as potential starting points
            SELECT 
                id as start_node,
                id as current_node,
                id as end_node,
                ARRAY[id] as path,
                ARRAY[]::integer[] as edges,
                0.0::float as total_distance_km,
                0.0::float as total_elevation_gain,
                0 as depth,
                ARRAY[]::text[] as trail_names
            FROM %I.routing_nodes
            
            UNION ALL
            
            -- Recursively explore connected nodes
            SELECT 
                rs.start_node,
                e.target as current_node,
                e.target as end_node,
                rs.path || e.target,
                rs.edges || e.id,
                rs.total_distance_km + e.distance_km,
                rs.total_elevation_gain + COALESCE(e.elevation_gain, 0),
                rs.depth + 1,
                rs.trail_names || e.trail_name
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.current_node = e.source
            WHERE rs.depth < $1  -- Limit depth to prevent infinite loops
              AND e.target != ALL(rs.path)  -- Avoid cycles
              AND rs.total_distance_km < $2 * (1 + $3 / 100.0)  -- Distance tolerance
              AND rs.total_elevation_gain < $4 * (1 + $3 / 100.0)  -- Elevation tolerance
        ),
        valid_routes AS (
            -- Filter to routes that meet our criteria
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance_km,
                total_elevation_gain,
                path,
                edges,
                -- Classify route shape
                CASE 
                    WHEN start_node = end_node THEN 'loop'
                    WHEN array_length(path, 1) = 2 THEN 'out-and-back'
                    WHEN array_length(path, 1) > 2 AND start_node = end_node THEN 'loop'
                    ELSE 'point-to-point'
                END as route_shape,
                -- Count unique trails
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                -- Calculate similarity score
                calculate_route_similarity_score(
                    total_distance_km, $2,
                    total_elevation_gain, $4
                ) as similarity_score
            FROM route_search
            WHERE total_distance_km >= $2 * (1 - $3 / 100.0)  -- Minimum distance
              AND total_elevation_gain >= $4 * (1 - $3 / 100.0)  -- Minimum elevation
            GROUP BY start_node, end_node, total_distance_km, total_elevation_gain, path, edges
        )
        SELECT * FROM valid_routes
        WHERE similarity_score >= get_min_route_score()
        ORDER BY similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema, staging_schema)
    USING max_depth, target_distance_km, config_tolerance, target_elevation_gain;
END;
$_$;


--
-- Name: find_routes_spatial(text, double precision, double precision, double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_routes_spatial(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, tolerance_percent double precision DEFAULT 20.0, max_depth integer DEFAULT 6) RETURNS TABLE(route_id text, start_node integer, end_node integer, total_distance_km double precision, total_elevation_gain double precision, route_path integer[], route_edges integer[], route_shape text, trail_count integer, similarity_score double precision)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    min_distance float;
    max_distance float;
    min_elevation float;
    max_elevation float;
    route_detail record;
BEGIN
    -- Calculate tolerance ranges
    min_distance := target_distance_km * (1 - tolerance_percent / 100.0);
    max_distance := target_distance_km * (1 + tolerance_percent / 100.0);
    min_elevation := target_elevation_gain * (1 - tolerance_percent / 100.0);
    max_elevation := target_elevation_gain * (1 + tolerance_percent / 100.0);
    
    -- Use a simpler approach: find connected edge sequences
    RETURN QUERY EXECUTE format($f$
        WITH RECURSIVE route_search AS (
            -- Start with all edges as potential starting points
            SELECT 
                e.id as edge_id,
                e.source as start_node,
                e.target as current_node,
                e.source as end_node,
                ARRAY[e.source, e.target] as path,
                ARRAY[e.id] as edges,
                e.distance_km as total_distance_km,
                COALESCE(e.elevation_gain, 0) as total_elevation_gain,
                1 as depth,
                ARRAY[e.trail_name] as trail_names
            FROM %I.routing_edges e
            WHERE e.distance_km <= $1  -- Start with edges that fit our target
            
            UNION ALL
            
            -- Recursively explore connected edges
            SELECT 
                rs.edge_id,
                rs.start_node,
                e.target as current_node,
                e.target as end_node,
                rs.path || e.target,
                rs.edges || e.id,
                rs.total_distance_km + e.distance_km,
                rs.total_elevation_gain + COALESCE(e.elevation_gain, 0),
                rs.depth + 1,
                rs.trail_names || e.trail_name
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.current_node = e.source
            WHERE rs.depth < $2  -- Limit depth
              AND e.target != ALL(rs.path)  -- Avoid cycles
              AND rs.total_distance_km + e.distance_km <= $3  -- Distance tolerance
              AND rs.total_elevation_gain + COALESCE(e.elevation_gain, 0) <= $4  -- Elevation tolerance
        ),
        valid_routes AS (
            -- Filter to routes that meet our criteria
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance_km,
                total_elevation_gain,
                path,
                edges,
                -- Classify route shape
                CASE 
                    WHEN start_node = end_node THEN 'loop'
                    WHEN array_length(path, 1) = 2 THEN 'out-and-back'
                    WHEN array_length(path, 1) > 2 AND start_node = end_node THEN 'loop'
                    ELSE 'point-to-point'
                END as route_shape,
                -- Count unique trails
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                -- Calculate similarity score
                calculate_route_similarity_score(
                    total_distance_km, $5,
                    total_elevation_gain, $6
                ) as similarity_score
            FROM route_search
            WHERE total_distance_km >= $7  -- Minimum distance
              AND total_elevation_gain >= $8  -- Minimum elevation
              AND array_length(path, 1) >= 2  -- At least 2 nodes
            GROUP BY start_node, end_node, total_distance_km, total_elevation_gain, path, edges
        )
        SELECT * FROM valid_routes
        WHERE similarity_score >= get_min_route_score()
        ORDER BY similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema, staging_schema)
    USING max_distance, max_depth, max_distance, max_elevation, 
          target_distance_km, target_elevation_gain, min_distance, min_elevation;
END;
$_$;


--
-- Name: find_routes_with_cost_configurable(text, double precision, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_routes_with_cost_configurable(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, max_cost double precision DEFAULT NULL::double precision) RETURNS TABLE(route_id text, total_distance_km double precision, total_elevation_gain double precision, route_cost double precision, steepness_m_per_km double precision, similarity_score double precision, route_shape text)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE format($f$
        WITH route_costs AS (
            SELECT 
                r.route_id,
                r.total_distance_km,
                r.total_elevation_gain,
                r.route_shape,
                r.similarity_score,
                -- Calculate steepness (elevation gain per km)
                CASE 
                    WHEN r.total_distance_km > 0 THEN r.total_elevation_gain / r.total_distance_km
                    ELSE 0
                END as steepness_m_per_km,
                -- Calculate route cost using configurable weights
                calculate_route_cost(
                    CASE 
                        WHEN r.total_distance_km > 0 THEN r.total_elevation_gain / r.total_distance_km
                        ELSE 0
                    END,
                    r.total_distance_km
                ) as route_cost
            FROM find_routes_recursive_configurable($1, $2::float, $3::float, 20.0, 8) r
        )
        SELECT 
            route_id,
            total_distance_km,
            total_elevation_gain,
            route_cost,
            steepness_m_per_km,
            similarity_score,
            route_shape
        FROM route_costs
        WHERE ($4 IS NULL OR route_cost <= $4)
        ORDER BY route_cost ASC, similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema)
    USING target_distance_km, target_elevation_gain, max_cost;
END;
$_$;


--
-- Name: find_simple_loops_spatial(text, double precision, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_simple_loops_spatial(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, tolerance_percent double precision DEFAULT 30.0) RETURNS TABLE(route_id text, start_node integer, end_node integer, total_distance_km double precision, total_elevation_gain double precision, route_path integer[], route_edges integer[], route_shape text, trail_count integer, similarity_score double precision)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    min_distance float;
    max_distance float;
    min_elevation float;
    max_elevation float;
BEGIN
    -- Calculate tolerance ranges
    min_distance := target_distance_km * (1 - tolerance_percent / 100.0);
    max_distance := target_distance_km * (1 + tolerance_percent / 100.0);
    min_elevation := target_elevation_gain * (1 - tolerance_percent / 100.0);
    max_elevation := target_elevation_gain * (1 + tolerance_percent / 100.0);
    
    RETURN QUERY EXECUTE format($f$
        WITH potential_loops AS (
            -- Find edges that could form loops by connecting back to start
            SELECT 
                e1.id as edge1_id,
                e1.source as start_node,
                e1.target as mid_node,
                e2.id as edge2_id,
                e2.target as end_node,
                e1.distance_km + e2.distance_km as total_distance,
                COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0) as total_elevation,
                ARRAY[e1.source, e1.target, e2.target] as path,
                ARRAY[e1.id, e2.id] as edges,
                ARRAY[e1.trail_name, e2.trail_name] as trail_names
            FROM %I.routing_edges e1
            JOIN %I.routing_edges e2 ON e1.target = e2.source
            WHERE e1.source != e2.target  -- Not a self-loop
              AND e1.distance_km + e2.distance_km BETWEEN $1 AND $2
              AND COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0) BETWEEN $3 AND $4
        ),
        valid_loops AS (
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance as total_distance_km,
                total_elevation as total_elevation_gain,
                path,
                edges,
                'loop' as route_shape,
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                calculate_route_similarity_score(
                    total_distance, $5,
                    total_elevation, $6
                ) as similarity_score
            FROM potential_loops
            GROUP BY start_node, end_node, total_distance, total_elevation, path, edges
        )
        SELECT * FROM valid_loops
        WHERE similarity_score >= get_min_route_score()
        ORDER BY similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema, staging_schema)
    USING min_distance, max_distance, min_elevation, max_elevation,
          target_distance_km, target_elevation_gain;
END;
$_$;


--
-- Name: find_simple_routes_with_logging(text, double precision, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_simple_routes_with_logging(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, tolerance_percent double precision DEFAULT 30.0) RETURNS TABLE(route_id text, start_node integer, end_node integer, total_distance_km double precision, total_elevation_gain double precision, route_path integer[], route_edges integer[], route_shape text, trail_count integer, similarity_score double precision)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    min_distance float;
    max_distance float;
    min_elevation float;
    max_elevation float;
    edge_count integer;
    route_count integer;
BEGIN
    -- Calculate tolerance ranges
    min_distance := target_distance_km * (1 - tolerance_percent / 100.0);
    max_distance := target_distance_km * (1 + tolerance_percent / 100.0);
    min_elevation := target_elevation_gain * (1 - tolerance_percent / 100.0);
    max_elevation := target_elevation_gain * (1 + tolerance_percent / 100.0);
    
    -- Log the search parameters
    RAISE NOTICE 'Searching for routes: distance %.1f-%.1f km, elevation %.0f-%.0f m', 
        min_distance, max_distance, min_elevation, max_elevation;
    
    -- Count available edges
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges WHERE distance_km BETWEEN %s AND %s', 
        staging_schema, min_distance, max_distance) INTO edge_count;
    RAISE NOTICE 'Found % edges in distance range', edge_count;
    
    RETURN QUERY EXECUTE format($f$
        WITH simple_routes AS (
            -- Find simple 2-edge routes that meet our criteria
            SELECT 
                gen_random_uuid()::text as route_id,
                e1.source as start_node,
                e2.target as end_node,
                (e1.distance_km + e2.distance_km)::double precision as total_distance_km,
                (COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0))::double precision as total_elevation_gain,
                ARRAY[e1.source, e1.target, e2.target] as route_path,
                ARRAY[e1.id, e2.id] as route_edges,
                CASE 
                    WHEN e1.source = e2.target THEN 'loop'
                    ELSE 'out-and-back'
                END as route_shape,
                2 as trail_count,
                calculate_route_similarity_score(
                    e1.distance_km + e2.distance_km, $1,
                    COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0), $2
                ) as similarity_score
            FROM %I.routing_edges e1
            JOIN %I.routing_edges e2 ON e1.target = e2.source
            WHERE e1.distance_km + e2.distance_km BETWEEN $3 AND $4
              AND COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0) BETWEEN $5 AND $6
              AND e1.source != e2.target  -- Avoid self-loops
        ),
        valid_routes AS (
            SELECT * FROM simple_routes
            WHERE similarity_score >= get_min_route_score()
            ORDER BY similarity_score DESC
            LIMIT get_max_routes_per_bin()
        )
        SELECT * FROM valid_routes
    $f$, staging_schema, staging_schema)
    USING target_distance_km, target_elevation_gain, min_distance, max_distance, min_elevation, max_elevation;
    
    -- Log results
    GET DIAGNOSTICS route_count = ROW_COUNT;
    RAISE NOTICE 'Generated % routes', route_count;
END;
$_$;


--
-- Name: generate_app_uuid(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_app_uuid() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.app_uuid IS NULL OR NEW.app_uuid = '' THEN
        NEW.app_uuid := gen_random_uuid();
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: generate_route_name(integer[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_route_name(route_edges integer[], route_shape text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  trail_names text[];
  unique_trail_names text[];
  route_name text;
BEGIN
  -- Extract unique trail names from route edges
  SELECT array_agg(DISTINCT trail_name ORDER BY trail_name) INTO trail_names
  FROM routing_edges 
  WHERE id = ANY(route_edges);
  
  -- Remove duplicates while preserving order
  SELECT array_agg(DISTINCT name ORDER BY name) INTO unique_trail_names
  FROM unnest(trail_names) AS name;
  
  -- Apply naming convention based on number of unique trails
  IF array_length(unique_trail_names, 1) = 1 THEN
    -- Single trail: use trail name directly
    route_name := unique_trail_names[1];
  ELSIF array_length(unique_trail_names, 1) = 2 THEN
    -- Two trails: {First Trail}/{Second Trail} Route
    route_name := unique_trail_names[1] || '/' || unique_trail_names[2] || ' Route';
  ELSE
    -- More than 2 trails: {First Trail}/{Last Trail} Route
    route_name := unique_trail_names[1] || '/' || unique_trail_names[array_length(unique_trail_names, 1)] || ' Route';
  END IF;
  
  -- Add route shape suffix if not already present
  IF route_name NOT LIKE '%' || route_shape || '%' THEN
    route_name := route_name || ' ' || route_shape;
  END IF;
  
  RETURN route_name;
END;
$$;


--
-- Name: generate_route_recommendations(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_route_recommendations(staging_schema text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN generate_route_recommendations_configurable(staging_schema, 'boulder');
END;
$$;


--
-- Name: generate_route_recommendations_adaptive(text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_route_recommendations_adaptive(staging_schema text, region_name text DEFAULT 'boulder'::text, min_routes_per_pattern integer DEFAULT 10, max_tolerance_percent integer DEFAULT 50) RETURNS integer
    LANGUAGE plpgsql
    AS $_$
DECLARE
    route_count integer := 0;
    pattern record;
    total_routes integer := 0;
    current_tolerance float;
    routes_found integer;
    max_iterations integer := 5; -- Prevent infinite loops
    iteration integer;
BEGIN
    -- Create route_trails table if it doesn't exist
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.route_trails (
            id SERIAL PRIMARY KEY,
            route_uuid TEXT NOT NULL,
            trail_id TEXT NOT NULL,
            trail_name TEXT NOT NULL,
            segment_order INTEGER NOT NULL,
            segment_distance_km REAL CHECK(segment_distance_km > 0),
            segment_elevation_gain REAL CHECK(segment_elevation_gain >= 0),
            segment_elevation_loss REAL CHECK(segment_elevation_loss >= 0),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ', staging_schema);
    
    -- Create route_recommendations table if it doesn't exist
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.route_recommendations (
            id SERIAL PRIMARY KEY,
            route_uuid TEXT UNIQUE NOT NULL,
            region TEXT NOT NULL,
            input_distance_km REAL CHECK(input_distance_km > 0),
            input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
            recommended_distance_km REAL CHECK(recommended_distance_km > 0),
            recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
            route_type TEXT,
            route_shape TEXT,
            trail_count INTEGER,
            route_score INTEGER,
            route_path JSONB,
            route_edges JSONB,
            route_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ', staging_schema);
    -- Generate recommendations for each pattern from config
    FOR pattern IN SELECT * FROM get_route_patterns() LOOP
        current_tolerance := pattern.tolerance_percent;
        routes_found := 0;
        iteration := 0;
        
        -- Try with increasing tolerance until we get enough routes
        WHILE routes_found < min_routes_per_pattern AND iteration < max_iterations AND current_tolerance <= max_tolerance_percent LOOP
            -- Clear any previous routes for this pattern
            EXECUTE format('DELETE FROM %I.route_recommendations 
            WHERE input_distance_km = $1 
              AND input_elevation_gain = $2
              AND route_shape = $3', staging_schema)
            USING pattern.target_distance_km, pattern.target_elevation_gain, pattern.route_shape;
            
            -- Generate routes with current tolerance
            EXECUTE format('INSERT INTO %I.route_recommendations (
                route_uuid,
                region,
                input_distance_km,
                input_elevation_gain,
                recommended_distance_km,
                recommended_elevation_gain,
                route_type,
                route_shape,
                trail_count,
                route_score,
                route_path,
                route_edges,
                route_name,
                created_at
            )
            SELECT 
                r.route_id,
                $1 as region,
                $2,
                $3,
                r.total_distance_km,
                r.total_elevation_gain,
                ''similar_distance'' as route_type,
                r.route_shape,
                r.trail_count,
                (r.similarity_score * 100)::integer as route_score,
                -- Convert path to GeoJSON (simplified) - FIXED: Use jsonb
                json_build_object(
                    ''type'', ''LineString'',
                    ''coordinates'', array_agg(
                        json_build_array(n.lng, n.lat, n.elevation)
                        ORDER BY array_position(r.route_path, n.id)
                    )
                )::jsonb as route_path,
                -- Convert edges to JSON array - FIXED: Use jsonb
                json_agg(r.route_edges)::jsonb as route_edges,
                -- Generate proper route name
                generate_route_name(r.route_edges, r.route_shape) as route_name,
                NOW() as created_at
            FROM find_routes_recursive_configurable($4, $2, $3, $5, $6) r
            JOIN %I.routing_nodes n ON n.id = ANY(r.route_path)
            WHERE r.route_shape = $7
              AND r.similarity_score >= get_min_route_score()  -- Use configurable minimum score
            GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                     r.route_shape, r.trail_count, r.similarity_score, r.route_edges', staging_schema, staging_schema)
            USING region_name, pattern.target_distance_km, pattern.target_elevation_gain, staging_schema, current_tolerance, 8, pattern.route_shape;
            
            GET DIAGNOSTICS routes_found = ROW_COUNT;
            
            -- Log route details for this iteration
            IF routes_found > 0 THEN
                RAISE NOTICE 'Routes found in iteration % (tolerance: %%%) for pattern %:', 
                    iteration, current_tolerance - 10.0, pattern.pattern_name;
                
                -- Get and log route details using a simpler approach
                DECLARE
                    route_detail RECORD;
                    route_query TEXT;
                BEGIN
                    route_query := format('
                        SELECT 
                            route_name,
                            recommended_distance_km,
                            recommended_elevation_gain,
                            ROUND(recommended_elevation_gain / recommended_distance_km, 1) as gain_rate_m_per_km,
                            route_shape,
                            trail_count,
                            route_score
                        FROM %I.route_recommendations 
                        WHERE input_distance_km = %s 
                          AND input_elevation_gain = %s 
                          AND route_shape = ''%s''
                        ORDER BY route_score DESC
                        LIMIT 5', 
                        staging_schema, 
                        pattern.target_distance_km, 
                        pattern.target_elevation_gain, 
                        pattern.route_shape);
                    
                    FOR route_detail IN EXECUTE route_query LOOP
                        RAISE NOTICE '  - %: %.1fkm, %.0fm gain (%.1f m/km), % shape, % trails, score: %', 
                            route_detail.route_name,
                            route_detail.recommended_distance_km,
                            route_detail.recommended_elevation_gain,
                            route_detail.gain_rate_m_per_km,
                            route_detail.route_shape,
                            route_detail.trail_count,
                            route_detail.route_score;
                    END LOOP;
                END;
            END IF;
            
            -- Populate route_trails junction table with trail composition data
            EXECUTE format('INSERT INTO %I.route_trails (
                route_uuid,
                trail_id,
                trail_name,
                segment_order,
                segment_distance_km,
                segment_elevation_gain,
                segment_elevation_loss
            )
            SELECT 
                r.route_id,
                e.trail_id,
                e.trail_name,
                ROW_NUMBER() OVER (PARTITION BY r.route_id ORDER BY array_position(r.route_path, e.source)) as segment_order,
                e.distance_km,
                e.elevation_gain,
                e.elevation_loss
            FROM find_routes_recursive_configurable($1, $2, $3, $4, $5) r
            JOIN %I.routing_edges e ON e.id = ANY(r.route_edges)
            WHERE r.route_shape = $6
              AND r.similarity_score >= get_min_route_score()', staging_schema, staging_schema)
            USING staging_schema, pattern.target_distance_km, pattern.target_elevation_gain, current_tolerance, 8, pattern.route_shape;
            
            -- Increase tolerance for next iteration
            current_tolerance := current_tolerance + 10.0;
            iteration := iteration + 1;
            
            RAISE NOTICE 'Pattern: %, Iteration: %, Tolerance: %%%, Routes found: %', 
                pattern.pattern_name, iteration, current_tolerance - 10.0, routes_found;
        END LOOP;
        
        total_routes := total_routes + routes_found;
        RAISE NOTICE 'Final: Generated % routes for pattern: % (tolerance: %%%)', 
            routes_found, pattern.pattern_name, current_tolerance - 10.0;
    END LOOP;
    
    -- Log final summary
    RAISE NOTICE '=== ROUTE GENERATION SUMMARY ===';
    RAISE NOTICE 'Total routes generated: %', total_routes;
    RAISE NOTICE 'Patterns processed: %', (SELECT COUNT(*) FROM route_patterns);
    RAISE NOTICE '================================';
    
    RETURN total_routes;
END;
$_$;


--
-- Name: generate_route_recommendations_configurable(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_route_recommendations_configurable(staging_schema text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    route_count integer := 0;
    pattern record;
    total_routes integer := 0;
BEGIN
    -- Generate recommendations for each pattern from config
    FOR pattern IN SELECT * FROM get_route_patterns() LOOP
        INSERT INTO route_recommendations (
            route_uuid,
            region,
            input_distance_km,
            input_elevation_gain,
            recommended_distance_km,
            recommended_elevation_gain,
            route_type,
            route_shape,
            trail_count,
            route_score,
            route_path,
            route_edges,
            route_name,
            created_at
        )
        SELECT 
            r.route_id,
            'boulder' as region,  -- TODO: Make this dynamic
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            r.total_distance_km,
            r.total_elevation_gain,
            'similar_distance' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            -- Convert path to GeoJSON (simplified)
            json_build_object(
                'type', 'LineString',
                'coordinates', array_agg(
                    json_build_array(n.lng, n.lat, n.elevation)
                    ORDER BY array_position(r.route_path, n.id)
                )
            )::text as route_path,
            -- Convert edges to JSON array
            json_agg(r.route_edges)::text as route_edges,
            -- Generate proper route name
            generate_route_name(r.route_edges, r.route_shape) as route_name,
            NOW() as created_at
        FROM find_routes_recursive_configurable(
            staging_schema,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            pattern.tolerance_percent,
            8
        ) r
        JOIN routing_nodes n ON n.id = ANY(r.route_path)
        WHERE r.route_shape = pattern.route_shape
          AND r.similarity_score >= get_min_route_score()  -- Use configurable minimum score
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.route_edges;
        
        GET DIAGNOSTICS route_count = ROW_COUNT;
        total_routes := total_routes + route_count;
        RAISE NOTICE 'Generated % routes for pattern: %', route_count, pattern.pattern_name;
    END LOOP;
    
    RETURN total_routes;
END;
$$;


--
-- Name: generate_route_recommendations_configurable(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_route_recommendations_configurable(staging_schema text, region_name text DEFAULT 'boulder'::text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    route_count integer := 0;
    pattern record;
    total_routes integer := 0;
BEGIN
    -- Generate recommendations for each pattern from config
    FOR pattern IN SELECT * FROM get_route_patterns() LOOP
        INSERT INTO route_recommendations (
            route_uuid,
            region,
            input_distance_km,
            input_elevation_gain,
            recommended_distance_km,
            recommended_elevation_gain,
            route_type,
            route_shape,
            trail_count,
            route_score,
            route_path,
            route_edges,
            route_name,
            created_at
        )
        SELECT 
            r.route_id,
            region_name as region,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            r.total_distance_km,
            r.total_elevation_gain,
            'similar_distance' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            -- Convert path to GeoJSON (simplified) - FIXED: Use jsonb
            json_build_object(
                'type', 'LineString',
                'coordinates', array_agg(
                    json_build_array(n.lng, n.lat, n.elevation)
                    ORDER BY array_position(r.route_path, n.id)
                )
            )::jsonb as route_path,
            -- Convert edges to JSON array - FIXED: Use jsonb
            json_agg(r.route_edges)::jsonb as route_edges,
            -- Generate proper route name
            generate_route_name(r.route_edges, r.route_shape) as route_name,
            NOW() as created_at
        FROM find_routes_recursive_configurable(
            staging_schema,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            pattern.tolerance_percent,
            8
        ) r
        JOIN routing_nodes n ON n.id = ANY(r.route_path)
        WHERE r.route_shape = pattern.route_shape
          AND r.similarity_score >= get_min_route_score()  -- Use configurable minimum score
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.route_edges;
        
        -- Populate route_trails junction table with trail composition data
        INSERT INTO route_trails (
            route_uuid,
            trail_id,
            trail_name,
            segment_order,
            segment_distance_km,
            segment_elevation_gain,
            segment_elevation_loss
        )
        SELECT 
            r.route_id,
            e.trail_id,
            e.trail_name,
            ROW_NUMBER() OVER (PARTITION BY r.route_id ORDER BY array_position(r.route_path, e.source)) as segment_order,
            e.distance_km,
            e.elevation_gain,
            e.elevation_loss
        FROM find_routes_recursive_configurable(
            staging_schema,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            pattern.tolerance_percent,
            8
        ) r
        JOIN routing_edges e ON e.id = ANY(r.route_edges)
        WHERE r.route_shape = pattern.route_shape
          AND r.similarity_score >= get_min_route_score();
        
        GET DIAGNOSTICS route_count = ROW_COUNT;
        total_routes := total_routes + route_count;
        RAISE NOTICE 'Generated % routes for pattern: %', route_count, pattern.pattern_name;
    END LOOP;
    
    RETURN total_routes;
END;
$$;


--
-- Name: generate_route_recommendations_large_dataset(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_route_recommendations_large_dataset(staging_schema text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    route_count integer := 0;
    pattern record;
    total_routes integer := 0;
BEGIN
    -- Generate recommendations for each pattern with more permissive settings
    FOR pattern IN SELECT * FROM get_route_patterns() LOOP
        INSERT INTO route_recommendations (
            route_uuid,
            region,
            input_distance_km,
            input_elevation_gain,
            recommended_distance_km,
            recommended_elevation_gain,
            route_type,
            route_shape,
            trail_count,
            route_score,
            route_path,
            route_edges,
            route_name,
            created_at
        )
        SELECT 
            r.route_id,
            'boulder' as region,  -- TODO: Make this dynamic
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            r.total_distance_km,
            r.total_elevation_gain,
            'similar_distance' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            -- Convert path to GeoJSON (simplified)
            json_build_object(
                'type', 'LineString',
                'coordinates', array_agg(
                    json_build_array(n.lng, n.lat, n.elevation)
                    ORDER BY array_position(r.route_path, n.id)
                )
            )::text as route_path,
            -- Convert edges to JSON array
            json_agg(r.route_edges)::text as route_edges,
            -- Generate proper route name
            generate_route_name(r.route_edges, r.route_shape) as route_name,
            NOW() as created_at
        FROM find_routes_recursive_configurable(
            staging_schema,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            pattern.tolerance_percent,
            12  -- Increased max depth for large datasets
        ) r
        JOIN routing_nodes n ON n.id = ANY(r.route_path)
        WHERE r.route_shape = pattern.route_shape
          AND r.similarity_score >= 0.3  -- Lower threshold for large datasets
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.route_edges;
        
        GET DIAGNOSTICS route_count = ROW_COUNT;
        total_routes := total_routes + route_count;
        RAISE NOTICE 'Generated % routes for pattern: %', route_count, pattern.pattern_name;
    END LOOP;
    
    RETURN total_routes;
END;
$$;


--
-- Name: generate_route_recommendations_large_dataset(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_route_recommendations_large_dataset(staging_schema text, region_name text DEFAULT 'boulder'::text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    route_count integer := 0;
    pattern record;
    total_routes integer := 0;
BEGIN
    -- Generate recommendations for each pattern with more permissive settings
    FOR pattern IN SELECT * FROM get_route_patterns() LOOP
        INSERT INTO route_recommendations (
            route_uuid,
            region,
            input_distance_km,
            input_elevation_gain,
            recommended_distance_km,
            recommended_elevation_gain,
            route_type,
            route_shape,
            trail_count,
            route_score,
            route_path,
            route_edges,
            route_name,
            created_at
        )
        SELECT 
            r.route_id,
            region_name as region,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            r.total_distance_km,
            r.total_elevation_gain,
            'similar_distance' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            -- Convert path to GeoJSON (simplified)
            json_build_object(
                'type', 'LineString',
                'coordinates', array_agg(
                    json_build_array(n.lng, n.lat, n.elevation)
                    ORDER BY array_position(r.route_path, n.id)
                )
            ) as route_path,
            -- Convert edges to JSON array
            json_agg(r.route_edges) as route_edges,
            -- Generate proper route name
            generate_route_name(r.route_edges, r.route_shape) as route_name,
            NOW() as created_at
        FROM find_routes_recursive_configurable(
            staging_schema,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            pattern.tolerance_percent,
            12  -- Increased max depth for large datasets
        ) r
        JOIN routing_nodes n ON n.id = ANY(r.route_path)
        WHERE r.route_shape = pattern.route_shape
          AND r.similarity_score >= 0.3  -- Lower threshold for large datasets
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.route_edges;
        
        GET DIAGNOSTICS route_count = ROW_COUNT;
        total_routes := total_routes + route_count;
        RAISE NOTICE 'Generated % routes for pattern: %', route_count, pattern.pattern_name;
    END LOOP;
    
    RETURN total_routes;
END;
$$;


--
-- Name: generate_routing_edges_native(text, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_routing_edges_native(staging_schema text, tolerance_meters real DEFAULT 20.0) RETURNS TABLE(edge_count integer, success boolean, message text)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    edge_count_var integer := 0;
    node_count_var integer := 0;
    tolerance_degrees real := tolerance_meters / 111000.0;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.%I', staging_schema, 'routing_edges');
    
    -- Get node count for validation
    EXECUTE format('SELECT COUNT(*) FROM %I.%I', staging_schema, 'routing_nodes') INTO node_count_var;
    
    -- Generate routing edges from actual trail segments (simplified version)
    EXECUTE format($f$
        INSERT INTO %I.%I (source, target, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geometry, geojson)
        SELECT 
            start_node.id as source, 
            end_node.id as target, 
            t.app_uuid as trail_id, 
            t.name as trail_name, 
            t.length_km as distance_km, 
            t.elevation_gain, 
            t.elevation_loss, 
            t.geometry, 
            ST_AsGeoJSON(t.geometry, 6, 0) as geojson 
        FROM %I.%I t
        JOIN %I.%I start_node ON ST_DWithin(ST_StartPoint(t.geometry), ST_SetSRID(ST_MakePoint(start_node.lng, start_node.lat), 4326), %L)
        JOIN %I.%I end_node ON ST_DWithin(ST_EndPoint(t.geometry), ST_SetSRID(ST_MakePoint(end_node.lng, end_node.lat), 4326), %L)
        WHERE t.geometry IS NOT NULL 
        AND ST_IsValid(t.geometry) 
        AND t.length_km > 0
        AND start_node.id IS NOT NULL 
        AND end_node.id IS NOT NULL
        AND start_node.id <> end_node.id
    $f$, staging_schema, 'routing_edges', staging_schema, 'trails', staging_schema, 'routing_nodes', tolerance_degrees, staging_schema, 'routing_nodes', tolerance_degrees);
    
    GET DIAGNOSTICS edge_count_var = ROW_COUNT;
    
    RETURN QUERY SELECT 
        edge_count_var,
        true as success,
        format('Generated %s routing edges from %s nodes (routable only, tolerance: %s m)', edge_count_var, node_count_var, tolerance_meters) as message;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing edges generation: %s', SQLERRM) as message;
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
-- Name: generate_routing_nodes_native(text, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_routing_nodes_native(staging_schema text, intersection_tolerance_meters real DEFAULT 2.0) RETURNS TABLE(node_count integer, success boolean, message text)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    node_count_var integer := 0;
    tolerance_degrees real := intersection_tolerance_meters / 111000.0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Generate routing nodes from actual trail endpoints and intersections
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, created_at)
        WITH valid_trails AS (
            SELECT app_uuid, name, geometry
            FROM %I.trails 
            WHERE geometry IS NOT NULL 
            AND ST_IsValid(geometry)
            AND ST_Length(geometry) > 0
        ),
        trail_endpoints AS (
            SELECT 
                app_uuid,
                name,
                ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point,
                ST_Z(ST_StartPoint(geometry)) as start_elevation,
                ST_Z(ST_EndPoint(geometry)) as end_elevation
            FROM valid_trails
        ),
        all_endpoints AS (
            SELECT 
                app_uuid,
                name,
                start_point as point,
                start_elevation as elevation,
                'endpoint' as node_type,
                name as connected_trails
            FROM trail_endpoints
            UNION ALL
            SELECT 
                app_uuid,
                name,
                end_point as point,
                end_elevation as elevation,
                'endpoint' as node_type,
                name as connected_trails
            FROM trail_endpoints
        ),
        unique_nodes AS (
            SELECT DISTINCT
                point,
                elevation,
                node_type,
                connected_trails
            FROM all_endpoints
            WHERE point IS NOT NULL
        ),
        clustered_nodes AS (
            SELECT 
                point as clustered_point,
                elevation,
                node_type,
                connected_trails
            FROM unique_nodes
            WHERE point IS NOT NULL
        )
        SELECT 
            ROW_NUMBER() OVER (ORDER BY ST_X(clustered_point), ST_Y(clustered_point)) as id,
            gen_random_uuid() as node_uuid,
            ST_Y(clustered_point) as lat,
            ST_X(clustered_point) as lng,
            elevation,
            node_type,
            connected_trails,
            NOW() as created_at
        FROM clustered_nodes
        WHERE clustered_point IS NOT NULL
    $f$, staging_schema, staging_schema);
    
    GET DIAGNOSTICS node_count_var = ROW_COUNT;
    
    RETURN QUERY SELECT 
        node_count_var,
        true as success,
        format('Generated %s routing nodes (routable only, tolerance: %s m)', node_count_var, intersection_tolerance_meters) as message;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing nodes generation: %s', SQLERRM) as message;
END;
$_$;


--
-- Name: generate_simple_route_recommendations(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_simple_route_recommendations(staging_schema text, region_name text DEFAULT 'boulder'::text) RETURNS integer
    LANGUAGE plpgsql
    AS $_$
DECLARE
    pattern record;
    routes_found integer := 0;
    total_routes integer := 0;
BEGIN
    RAISE NOTICE 'Starting simple route generation for region: %', region_name;
    
    -- Create route_recommendations table if it doesn't exist
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.route_recommendations (
            id SERIAL PRIMARY KEY,
            route_uuid TEXT UNIQUE NOT NULL,
            region TEXT NOT NULL,
            input_distance_km REAL CHECK(input_distance_km > 0),
            input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
            recommended_distance_km REAL CHECK(recommended_distance_km > 0),
            recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
            route_type TEXT,
            route_shape TEXT,
            trail_count INTEGER,
            route_score INTEGER,
            route_path JSONB,
            route_edges JSONB,
            route_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ', staging_schema);

    -- Create route_trails table if it doesn't exist
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.route_trails (
            id SERIAL PRIMARY KEY,
            route_uuid TEXT NOT NULL,
            trail_id TEXT NOT NULL,
            trail_name TEXT NOT NULL,
            segment_order INTEGER NOT NULL,
            segment_distance_km REAL CHECK(segment_distance_km > 0),
            segment_elevation_gain REAL CHECK(segment_elevation_gain >= 0),
            segment_elevation_loss REAL CHECK(segment_elevation_loss >= 0),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ', staging_schema);

    -- Clear existing recommendations
    EXECUTE format('DELETE FROM %I.route_recommendations', staging_schema);
    EXECUTE format('DELETE FROM %I.route_trails', staging_schema);

    -- Process each route pattern
    FOR pattern IN SELECT * FROM route_patterns WHERE pattern_name LIKE '%Loop%' OR pattern_name LIKE '%Out-and-Back%' ORDER BY target_distance_km LOOP
        RAISE NOTICE 'Processing pattern: % (%.1f km, %.0f m)', 
            pattern.pattern_name, pattern.target_distance_km, pattern.target_elevation_gain;
        
        -- Find routes for this pattern
        EXECUTE format('
            INSERT INTO %I.route_recommendations (
                route_uuid, region, input_distance_km, input_elevation_gain,
                recommended_distance_km, recommended_elevation_gain, route_type,
                route_shape, trail_count, route_score, route_path, route_edges, route_name
            )
            SELECT 
                r.route_id,
                $1 as region,
                $2 as input_distance_km,
                $3 as input_elevation_gain,
                r.total_distance_km,
                r.total_elevation_gain,
                ''similar_distance'' as route_type,
                r.route_shape,
                r.trail_count,
                (r.similarity_score * 100)::integer as route_score,
                json_build_object(
                    ''type'', ''LineString'',
                    ''coordinates'', array_agg(
                        json_build_array(n.lng, n.lat, n.elevation)
                        ORDER BY array_position(r.route_path, n.id)
                    )
                )::jsonb as route_path,
                json_agg(r.route_edges)::jsonb as route_edges,
                ''Generated Route '' || r.route_id as route_name
            FROM find_simple_routes_with_logging($4, $2, $3, $5) r
            JOIN %I.routing_nodes n ON n.id = ANY(r.route_path)
            WHERE r.route_shape = $6
            GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain,
                     r.route_shape, r.trail_count, r.similarity_score, r.route_edges
        ', staging_schema, staging_schema)
        USING region_name, pattern.target_distance_km, pattern.target_elevation_gain, 
              staging_schema, pattern.tolerance_percent, pattern.route_shape;
        
        GET DIAGNOSTICS routes_found = ROW_COUNT;
        total_routes := total_routes + routes_found;
        RAISE NOTICE 'Found % routes for pattern %', routes_found, pattern.pattern_name;
    END LOOP;
    
    RAISE NOTICE 'Total routes generated: %', total_routes;
    RETURN total_routes;
END;
$_$;


--
-- Name: get_batch_size(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_batch_size() RETURNS integer
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'batch_size')::integer;
END;
$$;


--
-- Name: get_carthorse_config(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_carthorse_config() RETURNS json
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN json_build_object(
        -- Spatial tolerances
        'intersection_tolerance', 2,
        'edge_tolerance', 2,
        'simplify_tolerance', 0.001,
        
        -- Processing settings
        'batch_size', 1000,
        'timeout_ms', 30000,
        
        -- Validation thresholds
        'min_trail_length_meters', 1,
        'max_trail_length_meters', 100000,
        'min_elevation_meters', 0,
        'max_elevation_meters', 9000,
        'min_coordinate_points', 2,
        'max_coordinate_points', 10000,
        
        -- Route discovery settings
        'max_routes_per_bin', 10,
        'min_route_score', 0.3,
        'min_route_distance_km', 1,
        'max_route_distance_km', 20,
        'min_elevation_gain_meters', 10,
        'max_elevation_gain_meters', 5000,
        
        -- Route scoring weights
        'distance_weight', 0.5,
        'elevation_weight', 0.3,
        'quality_weight', 0.3,
        
        -- Cost weighting
        'steepness_weight', 2,
        'routing_distance_weight', 0.5
    );
END;
$$;


--
-- Name: get_cost_weights(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_cost_weights() RETURNS json
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN json_build_object(
        'steepness_weight', (get_carthorse_config() ->> 'steepness_weight')::float,
        'distance_weight', (get_carthorse_config() ->> 'routing_distance_weight')::float
    );
END;
$$;


--
-- Name: get_edge_tolerance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_edge_tolerance() RETURNS double precision
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'edge_tolerance')::float;
END;
$$;


--
-- Name: get_elevation_gain_limits(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_elevation_gain_limits() RETURNS json
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN json_build_object(
        'min_meters', (get_carthorse_config() ->> 'min_elevation_gain_meters')::float,
        'max_meters', (get_carthorse_config() ->> 'max_elevation_gain_meters')::float
    );
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
-- Name: get_max_routes_per_bin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_max_routes_per_bin() RETURNS integer
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'max_routes_per_bin')::integer;
END;
$$;


--
-- Name: get_min_route_score(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_min_route_score() RETURNS double precision
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'min_route_score')::float;
END;
$$;


--
-- Name: get_route_distance_limits(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_route_distance_limits() RETURNS json
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN json_build_object(
        'min_km', (get_carthorse_config() ->> 'min_route_distance_km')::float,
        'max_km', (get_carthorse_config() ->> 'max_route_distance_km')::float
    );
END;
$$;


--
-- Name: get_route_patterns(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_route_patterns() RETURNS TABLE(pattern_name text, target_distance_km double precision, target_elevation_gain double precision, route_shape text, tolerance_percent double precision)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY SELECT 
        rp.pattern_name,
        rp.target_distance_km,
        rp.target_elevation_gain,
        rp.route_shape,
        rp.tolerance_percent
    FROM route_patterns rp
    ORDER BY rp.target_distance_km, rp.target_elevation_gain;
END;
$$;


--
-- Name: get_scoring_weights(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_scoring_weights() RETURNS json
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN json_build_object(
        'distance_weight', (get_carthorse_config() ->> 'distance_weight')::float,
        'elevation_weight', (get_carthorse_config() ->> 'elevation_weight')::float,
        'quality_weight', (get_carthorse_config() ->> 'quality_weight')::float
    );
END;
$$;


--
-- Name: get_simplify_tolerance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_simplify_tolerance() RETURNS double precision
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'simplify_tolerance')::float;
END;
$$;


--
-- Name: get_timeout_ms(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_timeout_ms() RETURNS integer
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'timeout_ms')::integer;
END;
$$;


--
-- Name: get_trails_with_geojson(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_trails_with_geojson(p_region text DEFAULT NULL::text, p_limit integer DEFAULT 100) RETURNS TABLE(id integer, app_uuid text, name text, region text, length_km real, elevation_gain real, geojson text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.id,
        t.app_uuid,
        t.name,
        t.region,
        t.length_km,
        t.elevation_gain,
        COALESCE(t.geojson_cached, ST_AsGeoJSON(t.geometry, 6, 0)) as geojson
    FROM trails t
    WHERE (p_region IS NULL OR t.region = p_region)
    ORDER BY t.name
    LIMIT p_limit;
END;
$$;


--
-- Name: prep_routing_network(text, text, double precision, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prep_routing_network(staging_schema text, trails_table text DEFAULT 'trails'::text, node_tolerance_meters double precision DEFAULT 0.01, steepness_weight double precision DEFAULT 2.0, distance_weight double precision DEFAULT 0.5) RETURNS TABLE(success boolean, message text, split_trails_count integer, nodes_count integer, edges_count integer)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    trail_count integer := 0;
    node_count integer := 0;
    edge_count integer := 0;
BEGIN
    -- Step 1: Add source and target columns to trails table (required by pgRouting)
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS source INTEGER, ADD COLUMN IF NOT EXISTS target INTEGER;', staging_schema, trails_table);
    
    -- Step 2: Call pgr_createTopology to detect intersections and split trails automatically
    EXECUTE format('SELECT pgr_createTopology(''%I.%I'', %s, ''the_geom'', ''id'')', staging_schema, trails_table, node_tolerance_meters);
    
    -- Step 3: Create routing_edges from the pgRouting-processed trails
    EXECUTE format('
        DROP TABLE IF EXISTS %I.routing_edges CASCADE;
        CREATE TABLE %I.routing_edges AS
        SELECT
            id,
            source,
            target,
            app_uuid as trail_id,
            name as trail_name,
            elevation_gain,
            elevation_loss,
            length_km,
            -- Cost calculation
            (CASE 
                WHEN length_km > 0 THEN (elevation_gain / length_km) * $1 + (length_km * $2)
                ELSE length_km * $2
            END) as cost,
            (CASE 
                WHEN length_km > 0 THEN (elevation_loss / length_km) * $1 + (length_km * $2)
                ELSE length_km * $2
            END) as reverse_cost,
            TRUE AS is_bidirectional,
            ST_AsText(the_geom) AS geometry_wkt,
            ST_AsText(ST_Force2D(the_geom)) AS geometry_2d_wkt
        FROM %I.%I
        WHERE the_geom IS NOT NULL AND ST_IsValid(the_geom)
    ', staging_schema, staging_schema, staging_schema, trails_table) 
    USING steepness_weight, distance_weight;
    
    -- Step 4: Create routing_nodes from the pgRouting vertices
    EXECUTE format('
        DROP TABLE IF EXISTS %I.routing_nodes CASCADE;
        CREATE TABLE %I.routing_nodes AS
        SELECT
            id,
            ''node_'' || id as node_uuid,
            ST_Y(the_geom) as lat,
            ST_X(the_geom) as lng,
            NULL as elevation,
            ''intersection'' AS node_type,
            '''' AS connected_trails
        FROM %I.%I_vertices_pgr
        WHERE id IS NOT NULL
    ', staging_schema, staging_schema, staging_schema, trails_table);
    
    -- Get final counts
    EXECUTE format('SELECT COUNT(*) FROM %I.%I', staging_schema, trails_table) INTO trail_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    
    -- Return success with statistics
    success := true;
    message := format('pgRouting network prepared successfully: %s trails, %s nodes, %s edges', trail_count, node_count, edge_count);
    
    RETURN QUERY SELECT success, message, trail_count, node_count, edge_count;
    
EXCEPTION WHEN OTHERS THEN
    success := false;
    message := 'Error preparing pgRouting network: ' || SQLERRM;
    RETURN QUERY SELECT success, message, 0, 0, 0;
END;
$_$;


--
-- Name: prepare_routing_network(text); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.prepare_routing_network(IN schema_name text)
    LANGUAGE plpgsql
    AS $$
DECLARE
  node_table TEXT := schema_name || '.routing_nodes';
  edge_table TEXT := schema_name || '.routing_edges';
  trails_3d_table TEXT := schema_name || '.split_trails';
  trails_2d_table TEXT := schema_name || '.split_trails_2d';
  noded_table TEXT := schema_name || '.split_trails_noded';
BEGIN
  RAISE NOTICE 'Beginning routing network prep for schema: %', schema_name;

  -- Step 0: Drop intermediate tables if they exist
  EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', trails_2d_table);
  EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', noded_table);

  -- Step 1: Create 2D geometry version of split_trails
  EXECUTE format('
    CREATE TABLE %I AS
    SELECT id AS old_id, ST_Force2D(geometry) AS geom
    FROM %I
    WHERE geometry IS NOT NULL AND ST_IsValid(geometry)',
    trails_2d_table, trails_3d_table
  );

  -- Step 2: Clean and node the network using native PostGIS
  EXECUTE format('
    CREATE TABLE %I AS
    SELECT
      row_number() OVER () AS id,
      d.geom::geometry(LINESTRING, 4326) AS geometry,
      s.old_id,
      s.old_id AS source,
      s.old_id AS target
    FROM (
      SELECT (ST_Dump(ST_Node(ST_Collect(geom)))).geom
      FROM %I
    ) AS d
    JOIN %I s
    ON ST_Intersects(d.geom, s.geom)',
    noded_table, trails_2d_table, trails_2d_table
  );

  -- Step 3: Add spatial index
  EXECUTE format('
    CREATE INDEX ON %I USING GIST (geometry)',
    noded_table
  );

  -- Step 4: Create topology with pgRouting
  EXECUTE format('
    SELECT pgr_createTopology(%L, 0.00001, %L, %L)',
    noded_table, 'geometry', 'id'
  );

  -- Step 5: Clear out routing_nodes and routing_edges if present
  EXECUTE format('DELETE FROM %I', node_table);
  EXECUTE format('DELETE FROM %I', edge_table);

  -- Step 6: Populate routing_nodes
  EXECUTE format('
    INSERT INTO %I (node_uuid, lat, lng, elevation, node_type, connected_trails)
    SELECT DISTINCT
      md5(source::text) AS node_uuid,
      ST_Y(pt.geom) AS lat,
      ST_X(pt.geom) AS lng,
      NULL::REAL AS elevation,
      ''intersection'' AS node_type,
      NULL::TEXT AS connected_trails
    FROM (
      SELECT source, ST_StartPoint(geometry) AS geom FROM %I
      UNION
      SELECT target, ST_EndPoint(geometry) AS geom FROM %I
    ) AS pt',
    node_table, noded_table, noded_table
  );

  -- Step 7: Populate routing_edges
  EXECUTE format('
    INSERT INTO %I (
      from_node_id, to_node_id, trail_id, trail_name, distance_km, geometry
    )
    SELECT
      n1.id AS from_node_id,
      n2.id AS to_node_id,
      CAST(stn.old_id AS TEXT) AS trail_id,
      t.name AS trail_name,
      ST_Length(geography(stn.geometry)) / 1000.0 AS distance_km,
      stn.geometry
    FROM %I stn
    JOIN %I n1 ON md5(stn.source::text) = n1.node_uuid
    JOIN %I n2 ON md5(stn.target::text) = n2.node_uuid
    JOIN %I t ON stn.old_id = t.id',
    edge_table, noded_table, node_table, node_table, trails_3d_table
  );

  RAISE NOTICE 'Routing network build complete for schema: %', schema_name;

END;
$$;


--
-- Name: prepare_routing_network(text, text, text, text, text, text, text, text, double precision, boolean); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.prepare_routing_network(IN in_schema text, IN in_table text, IN out_toponodes_table text DEFAULT 'routing_nodes'::text, IN out_topoedges_table text DEFAULT 'routing_edges'::text, IN id_col text DEFAULT 'id'::text, IN source_col text DEFAULT 'source'::text, IN target_col text DEFAULT 'target'::text, IN geom_col text DEFAULT 'geom'::text, IN tolerance double precision DEFAULT 0.00001, IN clean boolean DEFAULT true)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    qualified_input TEXT := format('%I.%I', in_schema, in_table);
    qualified_edges TEXT := format('%I.%I', in_schema, out_topoedges_table);
    qualified_nodes TEXT := format('%I.%I', in_schema, out_toponodes_table);
    deduplicated_table TEXT := 'deduplicated_trails_temp';
BEGIN
    RAISE NOTICE 'Beginning routing network prep for schema: %', in_schema;

    -- Step 0: Deduplicate trails by geometry and preserve all attributes
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', deduplicated_table);
    EXECUTE format('
        CREATE TABLE %I AS
        SELECT DISTINCT ON (ST_AsText(%I)) 
            %I, %I, app_uuid, name, trail_type, surface, difficulty, 
            elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            length_km, source_tags, osm_id, region, created_at, updated_at
        FROM %s
        WHERE %I IS NOT NULL AND ST_IsValid(%I)
        ORDER BY ST_AsText(%I), %I
    ', deduplicated_table, geom_col, id_col, geom_col, qualified_input, geom_col, geom_col, geom_col, id_col);

    -- Step 1: Cleanup existing outputs
    IF clean THEN
        EXECUTE format('DROP TABLE IF EXISTS %s CASCADE;', qualified_edges);
        EXECUTE format('DROP TABLE IF EXISTS %s CASCADE;', qualified_nodes);
    END IF;

    -- Step 2: Rename geometry column and create both 3D and 2D versions
    EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO geometry_3d', deduplicated_table, geom_col);
    EXECUTE format('ALTER TABLE %I ADD COLUMN the_geom GEOMETRY(LINESTRING, 4326)', deduplicated_table);
    EXECUTE format('UPDATE %I SET the_geom = ST_Force2D(geometry_3d)', deduplicated_table);

    -- Step 3: Add source and target columns for pgRouting
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS source BIGINT', deduplicated_table);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS target BIGINT', deduplicated_table);

    -- Step 4: Create Topology on deduplicated data
    RAISE NOTICE 'Creating topology for deduplicated trails';
    PERFORM pgr_createTopology(
        deduplicated_table,
        tolerance,
        'the_geom',
        'id'
    );

    -- Step 4: Create edges table with source/target columns and preserve all trail attributes
    RAISE NOTICE 'Creating edge table %', qualified_edges;
    EXECUTE format($f$
        CREATE TABLE %s AS
        SELECT
            id AS id,
            app_uuid,
            name,
            trail_type,
            surface,
            difficulty,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            length_km,
            source_tags,
            osm_id,
            region,
            created_at,
            updated_at,
            source,
            target,
            ST_Force2D(the_geom) AS geom,
            geometry_3d
        FROM %s;
    $f$, qualified_edges, deduplicated_table);

    -- Step 5: Create nodes table from vertices created by pgr_createTopology
    RAISE NOTICE 'Generating nodes table %', qualified_nodes;
    EXECUTE format($f$
        CREATE TABLE %s AS
        SELECT 
            id AS node_id, 
            the_geom AS geom
        FROM %I_vertices_pgr
        WHERE id IS NOT NULL;
    $f$, qualified_nodes, deduplicated_table);

    -- Step 5: Indexes for performance
    EXECUTE format('CREATE INDEX ON %s USING GIST (geom);', qualified_edges);
    EXECUTE format('CREATE INDEX ON %s USING GIST (geom);', qualified_nodes);
    EXECUTE format('ANALYZE %s;', qualified_edges);
    EXECUTE format('ANALYZE %s;', qualified_nodes);

    -- Clean up deduplicated table
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', deduplicated_table);

    RAISE NOTICE 'Routing network prepared successfully with deduplication.';
END;
$_$;


--
-- Name: recalculate_elevation_data(public.geometry); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalculate_elevation_data(geometry public.geometry) RETURNS TABLE(elevation_gain real, elevation_loss real)
    LANGUAGE plpgsql
    AS $_$ DECLARE total_gain real := 0; total_loss real := 0; prev_elevation real; curr_elevation real; point_geom geometry; BEGIN FOR i IN 1..ST_NPoints($1) LOOP point_geom := ST_PointN($1, i); curr_elevation := ST_Z(point_geom); IF i > 1 THEN IF curr_elevation > prev_elevation THEN total_gain := total_gain + (curr_elevation - prev_elevation); ELSIF curr_elevation < prev_elevation THEN total_loss := total_loss + (prev_elevation - curr_elevation); END IF; END IF; prev_elevation := curr_elevation; END LOOP; RETURN QUERY SELECT total_gain, total_loss; END; $_$;


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
-- Name: test_edge_generation(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.test_edge_generation(staging_schema text) RETURNS integer
    LANGUAGE plpgsql
    AS $$ BEGIN RETURN (SELECT COUNT(*) FROM staging_boulder_1754077262506.trails vt JOIN staging_boulder_1754077262506.routing_nodes start_node ON ST_DWithin(ST_StartPoint(vt.geometry), ST_SetSRID(ST_MakePoint(start_node.lng, start_node.lat), 4326), 0.0001) WHERE vt.geometry IS NOT NULL AND ST_IsValid(vt.geometry) AND vt.length_km > 0 LIMIT 5); END; $$;


--
-- Name: test_route_finding(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.test_route_finding(staging_schema text) RETURNS TABLE(test_name text, result text, details text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    route_count integer;
    node_count integer;
    edge_count integer;
BEGIN
    -- Test 1: Check if routing graph exists
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    IF node_count > 0 AND edge_count > 0 THEN
        RETURN QUERY SELECT 
            'Routing Graph'::text,
            'PASS'::text,
            format('Found %s nodes and %s edges', node_count, edge_count)::text;
    ELSE
        RETURN QUERY SELECT 
            'Routing Graph'::text,
            'FAIL'::text,
            format('Missing routing graph: %s nodes, %s edges', node_count, edge_count)::text;
    END IF;
    
    -- Test 2: Try to find a simple route
    SELECT COUNT(*) INTO route_count
    FROM find_routes_recursive(staging_schema, 5.0, 200.0, 20.0, 5);
    
    IF route_count > 0 THEN
        RETURN QUERY SELECT 
            'Route Finding'::text,
            'PASS'::text,
            format('Found %s routes for 5km/200m criteria', route_count)::text;
    ELSE
        RETURN QUERY SELECT 
            'Route Finding'::text,
            'FAIL'::text,
            'No routes found for 5km/200m criteria'::text;
    END IF;
    
    -- Test 3: Check route quality
    IF EXISTS (
        SELECT 1 FROM find_routes_recursive(staging_schema, 5.0, 200.0, 20.0, 5)
        WHERE similarity_score >= get_min_route_score()
    ) THEN
        RETURN QUERY SELECT 
            'Route Quality'::text,
            'PASS'::text,
            'Found high-quality routes (similarity > 0.8)'::text;
    ELSE
        RETURN QUERY SELECT 
            'Route Quality'::text,
            'WARN'::text,
            'No high-quality routes found - check criteria'::text;
    END IF;
END;
$$;


--
-- Name: test_route_finding_configurable(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.test_route_finding_configurable(staging_schema text) RETURNS TABLE(test_name text, result text, details text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    route_count integer;
    node_count integer;
    edge_count integer;
    config_min_score float;
BEGIN
    -- Test 1: Check if routing graph exists
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    IF node_count > 0 AND edge_count > 0 THEN
        RETURN QUERY SELECT 
            'Routing Graph'::text,
            'PASS'::text,
            format('Found %s nodes and %s edges', node_count, edge_count)::text;
    ELSE
        RETURN QUERY SELECT 
            'Routing Graph'::text,
            'FAIL'::text,
            format('Missing routing graph: %s nodes, %s edges', node_count, edge_count)::text;
    END IF;
    
    -- Test 2: Try to find a simple route with configurable values
    SELECT COUNT(*) INTO route_count
    FROM find_routes_recursive_configurable(staging_schema, 5.0, 200.0, 20.0, 5);
    
    IF route_count > 0 THEN
        RETURN QUERY SELECT 
            'Route Finding'::text,
            'PASS'::text,
            format('Found %s routes for 5km/200m criteria', route_count)::text;
    ELSE
        RETURN QUERY SELECT 
            'Route Finding'::text,
            'FAIL'::text,
            'No routes found for 5km/200m criteria'::text;
    END IF;
    
    -- Test 3: Check route quality using configurable minimum score
    config_min_score := get_min_route_score();
    IF EXISTS (
        SELECT 1 FROM find_routes_recursive_configurable(staging_schema, 5.0, 200.0, 20.0, 5)
        WHERE similarity_score >= config_min_score
    ) THEN
        RETURN QUERY SELECT 
            'Route Quality'::text,
            'PASS'::text,
            format('Found high-quality routes (similarity >= %s)', config_min_score)::text;
    ELSE
        RETURN QUERY SELECT 
            'Route Quality'::text,
            'WARN'::text,
            format('No high-quality routes found (similarity >= %s) - check criteria', config_min_score)::text;
    END IF;
    
    -- Test 4: Check configurable limits
    IF (get_route_distance_limits() ->> 'min_km')::float > 0 THEN
        RETURN QUERY SELECT 
            'Config Limits'::text,
            'PASS'::text,
            'Configurable distance and elevation limits are set'::text;
    ELSE
        RETURN QUERY SELECT 
            'Config Limits'::text,
            'WARN'::text,
            'Distance/elevation limits may be too restrictive'::text;
    END IF;
END;
$$;


--
-- Name: update_geojson_cache(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_geojson_cache() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.geojson_cached = ST_AsGeoJSON(NEW.geometry, 6, 0);
    RETURN NEW;
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
    geojson_cached text,
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
    route_uuid text,
    region text,
    input_distance_km real,
    input_elevation_gain real,
    request_hash text,
    expires_at timestamp without time zone,
    route_shape text,
    trail_count integer,
    route_score integer,
    route_name text,
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
-- Name: trails_boulder_geojson; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.trails_boulder_geojson AS
 SELECT trails.id,
    trails.app_uuid,
    trails.name,
    trails.region,
    trails.osm_id,
    trails.trail_type,
    trails.surface,
    trails.difficulty,
    trails.elevation_gain,
    trails.elevation_loss,
    trails.max_elevation,
    trails.min_elevation,
    trails.avg_elevation,
    trails.length_km,
    trails.bbox_min_lng,
    trails.bbox_max_lng,
    trails.bbox_min_lat,
    trails.bbox_max_lat,
    public.st_asgeojson(trails.geometry, 6, 0) AS geojson,
    trails.created_at,
    trails.updated_at
   FROM public.trails
  WHERE (trails.region = 'boulder'::text)
  WITH NO DATA;


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
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE TABLE staging_boulder_1754076594794.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE SEQUENCE staging_boulder_1754076594794.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER SEQUENCE staging_boulder_1754076594794.intersection_points_id_seq OWNED BY staging_boulder_1754076594794.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE TABLE staging_boulder_1754076594794.routing_edges (
    id integer NOT NULL,
    source integer NOT NULL,
    target integer NOT NULL,
    trail_id text NOT NULL,
    trail_name text NOT NULL,
    distance_km real NOT NULL,
    elevation_gain real,
    elevation_loss real,
    is_bidirectional boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geojson text,
    CONSTRAINT routing_edges_elevation_gain_check CHECK (((elevation_gain IS NULL) OR (elevation_gain >= (0)::double precision))),
    CONSTRAINT routing_edges_elevation_loss_check CHECK (((elevation_loss IS NULL) OR (elevation_loss >= (0)::double precision)))
);


--
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE SEQUENCE staging_boulder_1754076594794.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER SEQUENCE staging_boulder_1754076594794.routing_edges_id_seq OWNED BY staging_boulder_1754076594794.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE TABLE staging_boulder_1754076594794.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE SEQUENCE staging_boulder_1754076594794.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER SEQUENCE staging_boulder_1754076594794.routing_nodes_id_seq OWNED BY staging_boulder_1754076594794.routing_nodes.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE TABLE staging_boulder_1754076594794.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE SEQUENCE staging_boulder_1754076594794.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER SEQUENCE staging_boulder_1754076594794.trail_hashes_id_seq OWNED BY staging_boulder_1754076594794.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE TABLE staging_boulder_1754076594794.trails (
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
    elevation_gain real,
    elevation_loss real,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    source text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geometry_text text,
    geometry_hash text NOT NULL,
    CONSTRAINT staging_boulder_1754076594794_trails_3d_geometry CHECK ((public.st_ndims(geometry) = 3)),
    CONSTRAINT staging_boulder_1754076594794_trails_valid_geometry CHECK (public.st_isvalid(geometry)),
    CONSTRAINT trails_elevation_gain_check CHECK (((elevation_gain IS NULL) OR (elevation_gain >= (0)::double precision))),
    CONSTRAINT trails_elevation_loss_check CHECK (((elevation_loss IS NULL) OR (elevation_loss >= (0)::double precision)))
);


--
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE SEQUENCE staging_boulder_1754076594794.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER SEQUENCE staging_boulder_1754076594794.trails_id_seq OWNED BY staging_boulder_1754076594794.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE TABLE staging_boulder_1754076945956.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE SEQUENCE staging_boulder_1754076945956.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER SEQUENCE staging_boulder_1754076945956.intersection_points_id_seq OWNED BY staging_boulder_1754076945956.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE TABLE staging_boulder_1754076945956.routing_edges (
    id integer NOT NULL,
    source integer NOT NULL,
    target integer NOT NULL,
    trail_id text NOT NULL,
    trail_name text NOT NULL,
    distance_km real NOT NULL,
    elevation_gain real,
    elevation_loss real,
    is_bidirectional boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geojson text,
    CONSTRAINT routing_edges_elevation_gain_check CHECK (((elevation_gain IS NULL) OR (elevation_gain >= (0)::double precision))),
    CONSTRAINT routing_edges_elevation_loss_check CHECK (((elevation_loss IS NULL) OR (elevation_loss >= (0)::double precision)))
);


--
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE SEQUENCE staging_boulder_1754076945956.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER SEQUENCE staging_boulder_1754076945956.routing_edges_id_seq OWNED BY staging_boulder_1754076945956.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE TABLE staging_boulder_1754076945956.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE SEQUENCE staging_boulder_1754076945956.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER SEQUENCE staging_boulder_1754076945956.routing_nodes_id_seq OWNED BY staging_boulder_1754076945956.routing_nodes.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE TABLE staging_boulder_1754076945956.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE SEQUENCE staging_boulder_1754076945956.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER SEQUENCE staging_boulder_1754076945956.trail_hashes_id_seq OWNED BY staging_boulder_1754076945956.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE TABLE staging_boulder_1754076945956.trails (
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
    elevation_gain real,
    elevation_loss real,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    source text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geometry_text text,
    geometry_hash text NOT NULL,
    CONSTRAINT staging_boulder_1754076945956_trails_3d_geometry CHECK ((public.st_ndims(geometry) = 3)),
    CONSTRAINT staging_boulder_1754076945956_trails_valid_geometry CHECK (public.st_isvalid(geometry)),
    CONSTRAINT trails_elevation_gain_check CHECK (((elevation_gain IS NULL) OR (elevation_gain >= (0)::double precision))),
    CONSTRAINT trails_elevation_loss_check CHECK (((elevation_loss IS NULL) OR (elevation_loss >= (0)::double precision)))
);


--
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE SEQUENCE staging_boulder_1754076945956.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER SEQUENCE staging_boulder_1754076945956.trails_id_seq OWNED BY staging_boulder_1754076945956.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE TABLE staging_boulder_1754077088464.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE SEQUENCE staging_boulder_1754077088464.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER SEQUENCE staging_boulder_1754077088464.intersection_points_id_seq OWNED BY staging_boulder_1754077088464.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE TABLE staging_boulder_1754077088464.routing_edges (
    id integer NOT NULL,
    source integer NOT NULL,
    target integer NOT NULL,
    trail_id text NOT NULL,
    trail_name text NOT NULL,
    distance_km real NOT NULL,
    elevation_gain real,
    elevation_loss real,
    is_bidirectional boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geojson text,
    CONSTRAINT routing_edges_elevation_gain_check CHECK (((elevation_gain IS NULL) OR (elevation_gain >= (0)::double precision))),
    CONSTRAINT routing_edges_elevation_loss_check CHECK (((elevation_loss IS NULL) OR (elevation_loss >= (0)::double precision)))
);


--
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE SEQUENCE staging_boulder_1754077088464.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER SEQUENCE staging_boulder_1754077088464.routing_edges_id_seq OWNED BY staging_boulder_1754077088464.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE TABLE staging_boulder_1754077088464.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE SEQUENCE staging_boulder_1754077088464.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER SEQUENCE staging_boulder_1754077088464.routing_nodes_id_seq OWNED BY staging_boulder_1754077088464.routing_nodes.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE TABLE staging_boulder_1754077088464.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE SEQUENCE staging_boulder_1754077088464.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER SEQUENCE staging_boulder_1754077088464.trail_hashes_id_seq OWNED BY staging_boulder_1754077088464.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE TABLE staging_boulder_1754077088464.trails (
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
    elevation_gain real,
    elevation_loss real,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    source text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geometry_text text,
    geometry_hash text NOT NULL,
    CONSTRAINT staging_boulder_1754077088464_trails_3d_geometry CHECK ((public.st_ndims(geometry) = 3)),
    CONSTRAINT staging_boulder_1754077088464_trails_valid_geometry CHECK (public.st_isvalid(geometry)),
    CONSTRAINT trails_elevation_gain_check CHECK (((elevation_gain IS NULL) OR (elevation_gain >= (0)::double precision))),
    CONSTRAINT trails_elevation_loss_check CHECK (((elevation_loss IS NULL) OR (elevation_loss >= (0)::double precision)))
);


--
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE SEQUENCE staging_boulder_1754077088464.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER SEQUENCE staging_boulder_1754077088464.trails_id_seq OWNED BY staging_boulder_1754077088464.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE TABLE staging_boulder_1754077167124.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE SEQUENCE staging_boulder_1754077167124.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER SEQUENCE staging_boulder_1754077167124.intersection_points_id_seq OWNED BY staging_boulder_1754077167124.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE TABLE staging_boulder_1754077167124.routing_edges (
    id integer NOT NULL,
    source integer NOT NULL,
    target integer NOT NULL,
    trail_id text NOT NULL,
    trail_name text NOT NULL,
    distance_km real NOT NULL,
    elevation_gain real,
    elevation_loss real,
    is_bidirectional boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geojson text,
    CONSTRAINT routing_edges_elevation_gain_check CHECK (((elevation_gain IS NULL) OR (elevation_gain >= (0)::double precision))),
    CONSTRAINT routing_edges_elevation_loss_check CHECK (((elevation_loss IS NULL) OR (elevation_loss >= (0)::double precision)))
);


--
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE SEQUENCE staging_boulder_1754077167124.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER SEQUENCE staging_boulder_1754077167124.routing_edges_id_seq OWNED BY staging_boulder_1754077167124.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE TABLE staging_boulder_1754077167124.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE SEQUENCE staging_boulder_1754077167124.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER SEQUENCE staging_boulder_1754077167124.routing_nodes_id_seq OWNED BY staging_boulder_1754077167124.routing_nodes.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE TABLE staging_boulder_1754077167124.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE SEQUENCE staging_boulder_1754077167124.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER SEQUENCE staging_boulder_1754077167124.trail_hashes_id_seq OWNED BY staging_boulder_1754077167124.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE TABLE staging_boulder_1754077167124.trails (
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
    elevation_gain real,
    elevation_loss real,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    source text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geometry_text text,
    geometry_hash text NOT NULL,
    CONSTRAINT staging_boulder_1754077167124_trails_3d_geometry CHECK ((public.st_ndims(geometry) = 3)),
    CONSTRAINT staging_boulder_1754077167124_trails_valid_geometry CHECK (public.st_isvalid(geometry)),
    CONSTRAINT trails_elevation_gain_check CHECK (((elevation_gain IS NULL) OR (elevation_gain >= (0)::double precision))),
    CONSTRAINT trails_elevation_loss_check CHECK (((elevation_loss IS NULL) OR (elevation_loss >= (0)::double precision)))
);


--
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE SEQUENCE staging_boulder_1754077167124.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER SEQUENCE staging_boulder_1754077167124.trails_id_seq OWNED BY staging_boulder_1754077167124.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE TABLE staging_boulder_1754077262506.intersection_points (
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
-- Name: intersection_points_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE SEQUENCE staging_boulder_1754077262506.intersection_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intersection_points_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER SEQUENCE staging_boulder_1754077262506.intersection_points_id_seq OWNED BY staging_boulder_1754077262506.intersection_points.id;


--
-- Name: routing_edges; Type: TABLE; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE TABLE staging_boulder_1754077262506.routing_edges (
    id integer NOT NULL,
    source integer NOT NULL,
    target integer NOT NULL,
    trail_id text NOT NULL,
    trail_name text NOT NULL,
    distance_km real NOT NULL,
    elevation_gain real,
    elevation_loss real,
    is_bidirectional boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geojson text,
    CONSTRAINT routing_edges_elevation_gain_check CHECK (((elevation_gain IS NULL) OR (elevation_gain >= (0)::double precision))),
    CONSTRAINT routing_edges_elevation_loss_check CHECK (((elevation_loss IS NULL) OR (elevation_loss >= (0)::double precision)))
);


--
-- Name: routing_edges_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE SEQUENCE staging_boulder_1754077262506.routing_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER SEQUENCE staging_boulder_1754077262506.routing_edges_id_seq OWNED BY staging_boulder_1754077262506.routing_edges.id;


--
-- Name: routing_nodes; Type: TABLE; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE TABLE staging_boulder_1754077262506.routing_nodes (
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
-- Name: routing_nodes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE SEQUENCE staging_boulder_1754077262506.routing_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER SEQUENCE staging_boulder_1754077262506.routing_nodes_id_seq OWNED BY staging_boulder_1754077262506.routing_nodes.id;


--
-- Name: trail_hashes; Type: TABLE; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE TABLE staging_boulder_1754077262506.trail_hashes (
    id integer NOT NULL,
    app_uuid text NOT NULL,
    geometry_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE SEQUENCE staging_boulder_1754077262506.trail_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trail_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER SEQUENCE staging_boulder_1754077262506.trail_hashes_id_seq OWNED BY staging_boulder_1754077262506.trail_hashes.id;


--
-- Name: trails; Type: TABLE; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE TABLE staging_boulder_1754077262506.trails (
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
    elevation_gain real,
    elevation_loss real,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    source text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    geometry public.geometry(LineStringZ,4326),
    geometry_text text,
    geometry_hash text NOT NULL,
    CONSTRAINT staging_boulder_1754077262506_trails_3d_geometry CHECK ((public.st_ndims(geometry) = 3)),
    CONSTRAINT staging_boulder_1754077262506_trails_valid_geometry CHECK (public.st_isvalid(geometry)),
    CONSTRAINT trails_elevation_gain_check CHECK (((elevation_gain IS NULL) OR (elevation_gain >= (0)::double precision))),
    CONSTRAINT trails_elevation_loss_check CHECK (((elevation_loss IS NULL) OR (elevation_loss >= (0)::double precision)))
);


--
-- Name: trails_id_seq; Type: SEQUENCE; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE SEQUENCE staging_boulder_1754077262506.trails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trails_id_seq; Type: SEQUENCE OWNED BY; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER SEQUENCE staging_boulder_1754077262506.trails_id_seq OWNED BY staging_boulder_1754077262506.trails.id;


--
-- Name: intersection_points; Type: TABLE; Schema: test_bbox_debug; Owner: -
--

CREATE TABLE test_bbox_debug.intersection_points (
    id integer DEFAULT nextval('public.intersection_points_id_seq'::regclass) NOT NULL,
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
-- Name: COLUMN intersection_points.connected_trail_ids; Type: COMMENT; Schema: test_bbox_debug; Owner: -
--

COMMENT ON COLUMN test_bbox_debug.intersection_points.connected_trail_ids IS 'Array of trail IDs that connect at this intersection';


--
-- Name: COLUMN intersection_points.connected_trail_names; Type: COMMENT; Schema: test_bbox_debug; Owner: -
--

COMMENT ON COLUMN test_bbox_debug.intersection_points.connected_trail_names IS 'Array of trail names that connect at this intersection';


--
-- Name: trails; Type: TABLE; Schema: test_bbox_debug; Owner: -
--

CREATE TABLE test_bbox_debug.trails (
    id integer DEFAULT nextval('public.trails_id_seq'::regclass) NOT NULL,
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
    geojson_cached text,
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
-- Name: COLUMN trails.elevation_gain; Type: COMMENT; Schema: test_bbox_debug; Owner: -
--

COMMENT ON COLUMN test_bbox_debug.trails.elevation_gain IS 'Total elevation gain in meters (must be >= 0)';


--
-- Name: COLUMN trails.length_km; Type: COMMENT; Schema: test_bbox_debug; Owner: -
--

COMMENT ON COLUMN test_bbox_debug.trails.length_km IS 'Trail length in kilometers (must be > 0)';


--
-- Name: COLUMN trails.elevation_loss; Type: COMMENT; Schema: test_bbox_debug; Owner: -
--

COMMENT ON COLUMN test_bbox_debug.trails.elevation_loss IS 'Total elevation loss in meters (must be >= 0)';


--
-- Name: COLUMN trails.geometry; Type: COMMENT; Schema: test_bbox_debug; Owner: -
--

COMMENT ON COLUMN test_bbox_debug.trails.geometry IS '3D LineString geometry with elevation data (SRID: 4326)';


--
-- Name: routing_edges; Type: TABLE; Schema: test_debug; Owner: -
--

CREATE TABLE test_debug.routing_edges (
    id integer NOT NULL,
    source integer,
    target integer,
    trail_id text,
    trail_name text,
    distance_km real,
    elevation_gain real,
    elevation_loss real,
    geometry public.geometry(LineStringZ,4326),
    geojson text
);


--
-- Name: routing_nodes; Type: TABLE; Schema: test_debug; Owner: -
--

CREATE TABLE test_debug.routing_nodes (
    id integer NOT NULL,
    node_uuid text,
    lat real,
    lng real,
    elevation real,
    node_type text,
    connected_trails text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: trails; Type: TABLE; Schema: test_debug; Owner: -
--

CREATE TABLE test_debug.trails (
    app_uuid text NOT NULL,
    name text,
    geometry public.geometry(LineStringZ,4326),
    length_km real,
    elevation_gain real,
    elevation_loss real
);


--
-- Name: route_recommendations; Type: TABLE; Schema: test_e2e_workflow_1754016871435; Owner: -
--

CREATE TABLE test_e2e_workflow_1754016871435.route_recommendations (
    id integer NOT NULL,
    route_uuid text NOT NULL,
    region text NOT NULL,
    input_distance_km real,
    input_elevation_gain real,
    recommended_distance_km real,
    recommended_elevation_gain real,
    recommended_elevation_loss real,
    route_score real,
    route_type text,
    route_shape text,
    trail_count integer,
    route_path text,
    route_edges text,
    request_hash text,
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: route_recommendations_id_seq; Type: SEQUENCE; Schema: test_e2e_workflow_1754016871435; Owner: -
--

CREATE SEQUENCE test_e2e_workflow_1754016871435.route_recommendations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: route_recommendations_id_seq; Type: SEQUENCE OWNED BY; Schema: test_e2e_workflow_1754016871435; Owner: -
--

ALTER SEQUENCE test_e2e_workflow_1754016871435.route_recommendations_id_seq OWNED BY test_e2e_workflow_1754016871435.route_recommendations.id;


--
-- Name: routing_edges; Type: TABLE; Schema: test_e2e_workflow_1754016871435; Owner: -
--

CREATE TABLE test_e2e_workflow_1754016871435.routing_edges (
    id integer NOT NULL,
    source integer,
    target integer,
    trail_id text,
    trail_name text,
    distance_km real,
    elevation_gain real,
    elevation_loss real,
    geometry public.geometry(LineString,4326),
    geojson text
);


--
-- Name: routing_nodes; Type: TABLE; Schema: test_e2e_workflow_1754016871435; Owner: -
--

CREATE TABLE test_e2e_workflow_1754016871435.routing_nodes (
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
-- Name: trails; Type: TABLE; Schema: test_e2e_workflow_1754016871435; Owner: -
--

CREATE TABLE test_e2e_workflow_1754016871435.trails (
    app_uuid text NOT NULL,
    name text NOT NULL,
    region text NOT NULL,
    osm_id text,
    length_km real,
    elevation_gain real,
    elevation_loss real,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    difficulty text,
    surface text,
    trail_type text,
    geometry public.geometry(LineStringZ,4326),
    bbox_min_lng real,
    bbox_max_lng real,
    bbox_min_lat real,
    bbox_max_lat real,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: route_recommendations; Type: TABLE; Schema: test_export_schema; Owner: -
--

CREATE TABLE test_export_schema.route_recommendations (
    id integer NOT NULL,
    route_uuid text NOT NULL,
    region text NOT NULL,
    input_distance_km real,
    input_elevation_gain real,
    recommended_distance_km real,
    recommended_elevation_gain real,
    recommended_elevation_loss real,
    route_score real,
    route_type text,
    route_shape text,
    trail_count integer,
    route_path text,
    route_edges text,
    request_hash text,
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: route_recommendations_id_seq; Type: SEQUENCE; Schema: test_export_schema; Owner: -
--

CREATE SEQUENCE test_export_schema.route_recommendations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: route_recommendations_id_seq; Type: SEQUENCE OWNED BY; Schema: test_export_schema; Owner: -
--

ALTER SEQUENCE test_export_schema.route_recommendations_id_seq OWNED BY test_export_schema.route_recommendations.id;


--
-- Name: trails; Type: TABLE; Schema: test_export_schema; Owner: -
--

CREATE TABLE test_export_schema.trails (
    app_uuid text NOT NULL,
    name text NOT NULL,
    region text NOT NULL,
    osm_id text,
    length_km real,
    elevation_gain real,
    elevation_loss real,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    difficulty text,
    surface text,
    trail_type text,
    geometry public.geometry(LineStringZ,4326),
    bbox_min_lng real,
    bbox_max_lng real,
    bbox_min_lat real,
    bbox_max_lat real,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: routing_edges; Type: TABLE; Schema: test_orphaned_nodes_1754016870045; Owner: -
--

CREATE TABLE test_orphaned_nodes_1754016870045.routing_edges (
    id integer NOT NULL,
    source integer,
    target integer,
    trail_id text,
    trail_name text,
    distance_km real,
    elevation_gain real,
    elevation_loss real,
    geometry public.geometry(LineString,4326),
    geojson text
);


--
-- Name: routing_nodes; Type: TABLE; Schema: test_orphaned_nodes_1754016870045; Owner: -
--

CREATE TABLE test_orphaned_nodes_1754016870045.routing_nodes (
    id integer NOT NULL,
    node_uuid text,
    lat real,
    lng real,
    elevation real,
    node_type text NOT NULL,
    connected_trails text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: trails; Type: TABLE; Schema: test_orphaned_nodes_1754016870045; Owner: -
--

CREATE TABLE test_orphaned_nodes_1754016870045.trails (
    app_uuid text NOT NULL,
    name text NOT NULL,
    region text NOT NULL,
    osm_id text,
    length_km real,
    elevation_gain real,
    elevation_loss real,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    difficulty text,
    surface text,
    trail_type text,
    geometry public.geometry(LineStringZ,4326),
    bbox_min_lng real,
    bbox_max_lng real,
    bbox_min_lat real,
    bbox_max_lat real,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: route_recommendations; Type: TABLE; Schema: test_route_edge_cases_1754016870098; Owner: -
--

CREATE TABLE test_route_edge_cases_1754016870098.route_recommendations (
    id integer NOT NULL,
    route_uuid text NOT NULL,
    region text NOT NULL,
    input_distance_km real,
    input_elevation_gain real,
    recommended_distance_km real,
    recommended_elevation_gain real,
    recommended_elevation_loss real,
    route_score real,
    route_type text,
    route_shape text,
    trail_count integer,
    route_path text,
    route_edges text,
    request_hash text,
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: route_recommendations_id_seq; Type: SEQUENCE; Schema: test_route_edge_cases_1754016870098; Owner: -
--

CREATE SEQUENCE test_route_edge_cases_1754016870098.route_recommendations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: route_recommendations_id_seq; Type: SEQUENCE OWNED BY; Schema: test_route_edge_cases_1754016870098; Owner: -
--

ALTER SEQUENCE test_route_edge_cases_1754016870098.route_recommendations_id_seq OWNED BY test_route_edge_cases_1754016870098.route_recommendations.id;


--
-- Name: routing_edges; Type: TABLE; Schema: test_route_edge_cases_1754016870098; Owner: -
--

CREATE TABLE test_route_edge_cases_1754016870098.routing_edges (
    id integer NOT NULL,
    source integer,
    target integer,
    trail_id text,
    trail_name text,
    distance_km real,
    elevation_gain real,
    elevation_loss real,
    geometry public.geometry(LineString,4326),
    geojson text
);


--
-- Name: routing_nodes; Type: TABLE; Schema: test_route_edge_cases_1754016870098; Owner: -
--

CREATE TABLE test_route_edge_cases_1754016870098.routing_nodes (
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
-- Name: trails; Type: TABLE; Schema: test_route_edge_cases_1754016870098; Owner: -
--

CREATE TABLE test_route_edge_cases_1754016870098.trails (
    app_uuid text NOT NULL,
    name text NOT NULL,
    region text NOT NULL,
    osm_id text,
    length_km real,
    elevation_gain real,
    elevation_loss real,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    difficulty text,
    surface text,
    trail_type text,
    geometry public.geometry(LineStringZ,4326),
    bbox_min_lng real,
    bbox_max_lng real,
    bbox_min_lat real,
    bbox_max_lat real,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: route_recommendations; Type: TABLE; Schema: test_route_integration_1754016869970; Owner: -
--

CREATE TABLE test_route_integration_1754016869970.route_recommendations (
    id integer NOT NULL,
    route_uuid text NOT NULL,
    region text NOT NULL,
    input_distance_km real,
    input_elevation_gain real,
    recommended_distance_km real,
    recommended_elevation_gain real,
    recommended_elevation_loss real,
    route_score real,
    route_type text,
    route_shape text,
    trail_count integer,
    route_path text,
    route_edges text,
    request_hash text,
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: route_recommendations_id_seq; Type: SEQUENCE; Schema: test_route_integration_1754016869970; Owner: -
--

CREATE SEQUENCE test_route_integration_1754016869970.route_recommendations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: route_recommendations_id_seq; Type: SEQUENCE OWNED BY; Schema: test_route_integration_1754016869970; Owner: -
--

ALTER SEQUENCE test_route_integration_1754016869970.route_recommendations_id_seq OWNED BY test_route_integration_1754016869970.route_recommendations.id;


--
-- Name: routing_edges; Type: TABLE; Schema: test_route_integration_1754016869970; Owner: -
--

CREATE TABLE test_route_integration_1754016869970.routing_edges (
    id integer NOT NULL,
    source integer,
    target integer,
    trail_id text,
    trail_name text,
    distance_km real,
    elevation_gain real,
    elevation_loss real,
    geometry public.geometry(LineString,4326),
    geojson text
);


--
-- Name: routing_nodes; Type: TABLE; Schema: test_route_integration_1754016869970; Owner: -
--

CREATE TABLE test_route_integration_1754016869970.routing_nodes (
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
-- Name: trails; Type: TABLE; Schema: test_route_integration_1754016869970; Owner: -
--

CREATE TABLE test_route_integration_1754016869970.trails (
    app_uuid text NOT NULL,
    name text NOT NULL,
    region text NOT NULL,
    osm_id text,
    length_km real,
    elevation_gain real,
    elevation_loss real,
    max_elevation real,
    min_elevation real,
    avg_elevation real,
    difficulty text,
    surface text,
    trail_type text,
    geometry public.geometry(LineStringZ,4326),
    bbox_min_lng real,
    bbox_max_lng real,
    bbox_min_lat real,
    bbox_max_lat real,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


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
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076594794.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754076594794.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076594794.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754076594794.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076594794.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754076594794.routing_nodes_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076594794.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754076594794.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076594794.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754076594794.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076945956.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754076945956.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076945956.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754076945956.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076945956.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754076945956.routing_nodes_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076945956.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754076945956.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076945956.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754076945956.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077088464.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754077088464.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077088464.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754077088464.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077088464.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754077088464.routing_nodes_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077088464.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754077088464.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077088464.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754077088464.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077167124.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754077167124.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077167124.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754077167124.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077167124.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754077167124.routing_nodes_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077167124.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754077167124.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077167124.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754077167124.trails_id_seq'::regclass);


--
-- Name: intersection_points id; Type: DEFAULT; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077262506.intersection_points ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754077262506.intersection_points_id_seq'::regclass);


--
-- Name: routing_edges id; Type: DEFAULT; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077262506.routing_edges ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754077262506.routing_edges_id_seq'::regclass);


--
-- Name: routing_nodes id; Type: DEFAULT; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077262506.routing_nodes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754077262506.routing_nodes_id_seq'::regclass);


--
-- Name: trail_hashes id; Type: DEFAULT; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077262506.trail_hashes ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754077262506.trail_hashes_id_seq'::regclass);


--
-- Name: trails id; Type: DEFAULT; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077262506.trails ALTER COLUMN id SET DEFAULT nextval('staging_boulder_1754077262506.trails_id_seq'::regclass);


--
-- Name: route_recommendations id; Type: DEFAULT; Schema: test_e2e_workflow_1754016871435; Owner: -
--

ALTER TABLE ONLY test_e2e_workflow_1754016871435.route_recommendations ALTER COLUMN id SET DEFAULT nextval('test_e2e_workflow_1754016871435.route_recommendations_id_seq'::regclass);


--
-- Name: route_recommendations id; Type: DEFAULT; Schema: test_export_schema; Owner: -
--

ALTER TABLE ONLY test_export_schema.route_recommendations ALTER COLUMN id SET DEFAULT nextval('test_export_schema.route_recommendations_id_seq'::regclass);


--
-- Name: route_recommendations id; Type: DEFAULT; Schema: test_route_edge_cases_1754016870098; Owner: -
--

ALTER TABLE ONLY test_route_edge_cases_1754016870098.route_recommendations ALTER COLUMN id SET DEFAULT nextval('test_route_edge_cases_1754016870098.route_recommendations_id_seq'::regclass);


--
-- Name: route_recommendations id; Type: DEFAULT; Schema: test_route_integration_1754016869970; Owner: -
--

ALTER TABLE ONLY test_route_integration_1754016869970.route_recommendations ALTER COLUMN id SET DEFAULT nextval('test_route_integration_1754016869970.route_recommendations_id_seq'::regclass);


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
-- Name: route_recommendations route_recommendations_route_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_recommendations
    ADD CONSTRAINT route_recommendations_route_uuid_key UNIQUE (route_uuid);


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
-- Name: schema_version schema_version_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_version
    ADD CONSTRAINT schema_version_version_key UNIQUE (version);


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
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076594794.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076594794.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076594794.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076594794.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076594794.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076594794.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076594794.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076945956.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076945956.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076945956.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076945956.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076945956.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076945956.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076945956.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077088464.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077088464.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077088464.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077088464.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077088464.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077088464.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077088464.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077167124.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077167124.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077167124.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077167124.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077167124.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077167124.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077167124.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077262506.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077262506.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_node_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077262506.routing_nodes
    ADD CONSTRAINT routing_nodes_node_uuid_key UNIQUE (node_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077262506.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: trail_hashes trail_hashes_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077262506.trail_hashes
    ADD CONSTRAINT trail_hashes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077262506.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077262506.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: intersection_points intersection_points_pkey; Type: CONSTRAINT; Schema: test_bbox_debug; Owner: -
--

ALTER TABLE ONLY test_bbox_debug.intersection_points
    ADD CONSTRAINT intersection_points_pkey PRIMARY KEY (id);


--
-- Name: trails trails_app_uuid_key; Type: CONSTRAINT; Schema: test_bbox_debug; Owner: -
--

ALTER TABLE ONLY test_bbox_debug.trails
    ADD CONSTRAINT trails_app_uuid_key UNIQUE (app_uuid);


--
-- Name: trails trails_app_uuid_key1; Type: CONSTRAINT; Schema: test_bbox_debug; Owner: -
--

ALTER TABLE ONLY test_bbox_debug.trails
    ADD CONSTRAINT trails_app_uuid_key1 UNIQUE (app_uuid);


--
-- Name: trails trails_osm_id_key; Type: CONSTRAINT; Schema: test_bbox_debug; Owner: -
--

ALTER TABLE ONLY test_bbox_debug.trails
    ADD CONSTRAINT trails_osm_id_key UNIQUE (osm_id);


--
-- Name: trails trails_osm_id_key1; Type: CONSTRAINT; Schema: test_bbox_debug; Owner: -
--

ALTER TABLE ONLY test_bbox_debug.trails
    ADD CONSTRAINT trails_osm_id_key1 UNIQUE (osm_id);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: test_bbox_debug; Owner: -
--

ALTER TABLE ONLY test_bbox_debug.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (id);


--
-- Name: routing_edges routing_edges_pkey; Type: CONSTRAINT; Schema: test_debug; Owner: -
--

ALTER TABLE ONLY test_debug.routing_edges
    ADD CONSTRAINT routing_edges_pkey PRIMARY KEY (id);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: test_debug; Owner: -
--

ALTER TABLE ONLY test_debug.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: test_debug; Owner: -
--

ALTER TABLE ONLY test_debug.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (app_uuid);


--
-- Name: route_recommendations route_recommendations_pkey; Type: CONSTRAINT; Schema: test_e2e_workflow_1754016871435; Owner: -
--

ALTER TABLE ONLY test_e2e_workflow_1754016871435.route_recommendations
    ADD CONSTRAINT route_recommendations_pkey PRIMARY KEY (id);


--
-- Name: route_recommendations route_recommendations_route_uuid_key; Type: CONSTRAINT; Schema: test_e2e_workflow_1754016871435; Owner: -
--

ALTER TABLE ONLY test_e2e_workflow_1754016871435.route_recommendations
    ADD CONSTRAINT route_recommendations_route_uuid_key UNIQUE (route_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: test_e2e_workflow_1754016871435; Owner: -
--

ALTER TABLE ONLY test_e2e_workflow_1754016871435.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (app_uuid);


--
-- Name: route_recommendations route_recommendations_pkey; Type: CONSTRAINT; Schema: test_export_schema; Owner: -
--

ALTER TABLE ONLY test_export_schema.route_recommendations
    ADD CONSTRAINT route_recommendations_pkey PRIMARY KEY (id);


--
-- Name: route_recommendations route_recommendations_route_uuid_key; Type: CONSTRAINT; Schema: test_export_schema; Owner: -
--

ALTER TABLE ONLY test_export_schema.route_recommendations
    ADD CONSTRAINT route_recommendations_route_uuid_key UNIQUE (route_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: test_export_schema; Owner: -
--

ALTER TABLE ONLY test_export_schema.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (app_uuid);


--
-- Name: routing_nodes routing_nodes_pkey; Type: CONSTRAINT; Schema: test_orphaned_nodes_1754016870045; Owner: -
--

ALTER TABLE ONLY test_orphaned_nodes_1754016870045.routing_nodes
    ADD CONSTRAINT routing_nodes_pkey PRIMARY KEY (id);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: test_orphaned_nodes_1754016870045; Owner: -
--

ALTER TABLE ONLY test_orphaned_nodes_1754016870045.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (app_uuid);


--
-- Name: route_recommendations route_recommendations_pkey; Type: CONSTRAINT; Schema: test_route_edge_cases_1754016870098; Owner: -
--

ALTER TABLE ONLY test_route_edge_cases_1754016870098.route_recommendations
    ADD CONSTRAINT route_recommendations_pkey PRIMARY KEY (id);


--
-- Name: route_recommendations route_recommendations_route_uuid_key; Type: CONSTRAINT; Schema: test_route_edge_cases_1754016870098; Owner: -
--

ALTER TABLE ONLY test_route_edge_cases_1754016870098.route_recommendations
    ADD CONSTRAINT route_recommendations_route_uuid_key UNIQUE (route_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: test_route_edge_cases_1754016870098; Owner: -
--

ALTER TABLE ONLY test_route_edge_cases_1754016870098.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (app_uuid);


--
-- Name: route_recommendations route_recommendations_pkey; Type: CONSTRAINT; Schema: test_route_integration_1754016869970; Owner: -
--

ALTER TABLE ONLY test_route_integration_1754016869970.route_recommendations
    ADD CONSTRAINT route_recommendations_pkey PRIMARY KEY (id);


--
-- Name: route_recommendations route_recommendations_route_uuid_key; Type: CONSTRAINT; Schema: test_route_integration_1754016869970; Owner: -
--

ALTER TABLE ONLY test_route_integration_1754016869970.route_recommendations
    ADD CONSTRAINT route_recommendations_route_uuid_key UNIQUE (route_uuid);


--
-- Name: trails trails_pkey; Type: CONSTRAINT; Schema: test_route_integration_1754016869970; Owner: -
--

ALTER TABLE ONLY test_route_integration_1754016869970.trails
    ADD CONSTRAINT trails_pkey PRIMARY KEY (app_uuid);


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
-- Name: idx_trails_3d_geometry_complete; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_3d_geometry_complete ON public.trails USING gist (geometry) WHERE (public.st_ndims(geometry) = 3);


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
-- Name: idx_trails_boulder_geojson_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_boulder_geojson_id ON public.trails_boulder_geojson USING btree (id);


--
-- Name: idx_trails_boulder_geojson_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_boulder_geojson_name ON public.trails_boulder_geojson USING btree (name);


--
-- Name: idx_trails_complete_elevation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_complete_elevation ON public.trails USING btree (region, length_km, elevation_gain) WHERE ((elevation_gain IS NOT NULL) AND (max_elevation IS NOT NULL));


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
-- Name: idx_trails_region_elevation_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region_elevation_composite ON public.trails USING btree (region, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation);


--
-- Name: idx_trails_region_length_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region_length_composite ON public.trails USING btree (region, length_km, elevation_gain);


--
-- Name: idx_trails_region_surface_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trails_region_surface_composite ON public.trails USING btree (region, surface, trail_type);


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
-- Name: idx_intersection_points; Type: INDEX; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE INDEX idx_intersection_points ON staging_boulder_1754076594794.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1754076594794_intersection_points; Type: INDEX; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE INDEX idx_staging_boulder_1754076594794_intersection_points ON staging_boulder_1754076594794.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1754076594794_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE INDEX idx_staging_boulder_1754076594794_routing_edges_geometry ON staging_boulder_1754076594794.routing_edges USING gist (geometry);


--
-- Name: idx_staging_boulder_1754076594794_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE INDEX idx_staging_boulder_1754076594794_routing_nodes_location ON staging_boulder_1754076594794.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_boulder_1754076594794_trails_geometry; Type: INDEX; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE INDEX idx_staging_boulder_1754076594794_trails_geometry ON staging_boulder_1754076594794.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1754076594794.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1754076594794.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1754076594794.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1754076594794.trails USING gist (geometry);


--
-- Name: idx_trails_app_uuid; Type: INDEX; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE INDEX idx_trails_app_uuid ON staging_boulder_1754076594794.trails USING btree (app_uuid);


--
-- Name: idx_trails_geometry; Type: INDEX; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE INDEX idx_trails_geometry ON staging_boulder_1754076594794.trails USING gist (geometry);


--
-- Name: idx_trails_name; Type: INDEX; Schema: staging_boulder_1754076594794; Owner: -
--

CREATE INDEX idx_trails_name ON staging_boulder_1754076594794.trails USING btree (name);


--
-- Name: idx_intersection_points; Type: INDEX; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE INDEX idx_intersection_points ON staging_boulder_1754076945956.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1754076945956_intersection_points; Type: INDEX; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE INDEX idx_staging_boulder_1754076945956_intersection_points ON staging_boulder_1754076945956.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1754076945956_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE INDEX idx_staging_boulder_1754076945956_routing_edges_geometry ON staging_boulder_1754076945956.routing_edges USING gist (geometry);


--
-- Name: idx_staging_boulder_1754076945956_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE INDEX idx_staging_boulder_1754076945956_routing_nodes_location ON staging_boulder_1754076945956.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_boulder_1754076945956_trails_geometry; Type: INDEX; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE INDEX idx_staging_boulder_1754076945956_trails_geometry ON staging_boulder_1754076945956.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1754076945956.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1754076945956.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1754076945956.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1754076945956.trails USING gist (geometry);


--
-- Name: idx_trails_app_uuid; Type: INDEX; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE INDEX idx_trails_app_uuid ON staging_boulder_1754076945956.trails USING btree (app_uuid);


--
-- Name: idx_trails_geometry; Type: INDEX; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE INDEX idx_trails_geometry ON staging_boulder_1754076945956.trails USING gist (geometry);


--
-- Name: idx_trails_name; Type: INDEX; Schema: staging_boulder_1754076945956; Owner: -
--

CREATE INDEX idx_trails_name ON staging_boulder_1754076945956.trails USING btree (name);


--
-- Name: idx_intersection_points; Type: INDEX; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE INDEX idx_intersection_points ON staging_boulder_1754077088464.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1754077088464_intersection_points; Type: INDEX; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE INDEX idx_staging_boulder_1754077088464_intersection_points ON staging_boulder_1754077088464.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1754077088464_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE INDEX idx_staging_boulder_1754077088464_routing_edges_geometry ON staging_boulder_1754077088464.routing_edges USING gist (geometry);


--
-- Name: idx_staging_boulder_1754077088464_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE INDEX idx_staging_boulder_1754077088464_routing_nodes_location ON staging_boulder_1754077088464.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_boulder_1754077088464_trails_geometry; Type: INDEX; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE INDEX idx_staging_boulder_1754077088464_trails_geometry ON staging_boulder_1754077088464.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1754077088464.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1754077088464.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1754077088464.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1754077088464.trails USING gist (geometry);


--
-- Name: idx_trails_app_uuid; Type: INDEX; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE INDEX idx_trails_app_uuid ON staging_boulder_1754077088464.trails USING btree (app_uuid);


--
-- Name: idx_trails_geometry; Type: INDEX; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE INDEX idx_trails_geometry ON staging_boulder_1754077088464.trails USING gist (geometry);


--
-- Name: idx_trails_name; Type: INDEX; Schema: staging_boulder_1754077088464; Owner: -
--

CREATE INDEX idx_trails_name ON staging_boulder_1754077088464.trails USING btree (name);


--
-- Name: idx_intersection_points; Type: INDEX; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE INDEX idx_intersection_points ON staging_boulder_1754077167124.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1754077167124_intersection_points; Type: INDEX; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE INDEX idx_staging_boulder_1754077167124_intersection_points ON staging_boulder_1754077167124.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1754077167124_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE INDEX idx_staging_boulder_1754077167124_routing_edges_geometry ON staging_boulder_1754077167124.routing_edges USING gist (geometry);


--
-- Name: idx_staging_boulder_1754077167124_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE INDEX idx_staging_boulder_1754077167124_routing_nodes_location ON staging_boulder_1754077167124.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_boulder_1754077167124_trails_geometry; Type: INDEX; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE INDEX idx_staging_boulder_1754077167124_trails_geometry ON staging_boulder_1754077167124.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1754077167124.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1754077167124.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1754077167124.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1754077167124.trails USING gist (geometry);


--
-- Name: idx_trails_app_uuid; Type: INDEX; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE INDEX idx_trails_app_uuid ON staging_boulder_1754077167124.trails USING btree (app_uuid);


--
-- Name: idx_trails_geometry; Type: INDEX; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE INDEX idx_trails_geometry ON staging_boulder_1754077167124.trails USING gist (geometry);


--
-- Name: idx_trails_name; Type: INDEX; Schema: staging_boulder_1754077167124; Owner: -
--

CREATE INDEX idx_trails_name ON staging_boulder_1754077167124.trails USING btree (name);


--
-- Name: idx_intersection_points; Type: INDEX; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE INDEX idx_intersection_points ON staging_boulder_1754077262506.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1754077262506_intersection_points; Type: INDEX; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE INDEX idx_staging_boulder_1754077262506_intersection_points ON staging_boulder_1754077262506.intersection_points USING gist (point);


--
-- Name: idx_staging_boulder_1754077262506_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE INDEX idx_staging_boulder_1754077262506_routing_edges_geometry ON staging_boulder_1754077262506.routing_edges USING gist (geometry);


--
-- Name: idx_staging_boulder_1754077262506_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE INDEX idx_staging_boulder_1754077262506_routing_nodes_location ON staging_boulder_1754077262506.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_boulder_1754077262506_trails_geometry; Type: INDEX; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE INDEX idx_staging_boulder_1754077262506_trails_geometry ON staging_boulder_1754077262506.trails USING gist (geometry);


--
-- Name: idx_staging_intersection_points; Type: INDEX; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE INDEX idx_staging_intersection_points ON staging_boulder_1754077262506.intersection_points USING gist (point);


--
-- Name: idx_staging_routing_edges_geometry; Type: INDEX; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE INDEX idx_staging_routing_edges_geometry ON staging_boulder_1754077262506.routing_edges USING gist (geometry);


--
-- Name: idx_staging_routing_nodes_location; Type: INDEX; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE INDEX idx_staging_routing_nodes_location ON staging_boulder_1754077262506.routing_nodes USING gist (public.st_setsrid(public.st_makepoint((lng)::double precision, (lat)::double precision), 4326));


--
-- Name: idx_staging_trails_geometry; Type: INDEX; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE INDEX idx_staging_trails_geometry ON staging_boulder_1754077262506.trails USING gist (geometry);


--
-- Name: idx_trails_app_uuid; Type: INDEX; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE INDEX idx_trails_app_uuid ON staging_boulder_1754077262506.trails USING btree (app_uuid);


--
-- Name: idx_trails_geometry; Type: INDEX; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE INDEX idx_trails_geometry ON staging_boulder_1754077262506.trails USING gist (geometry);


--
-- Name: idx_trails_name; Type: INDEX; Schema: staging_boulder_1754077262506; Owner: -
--

CREATE INDEX idx_trails_name ON staging_boulder_1754077262506.trails USING btree (name);


--
-- Name: intersection_points_node_type_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX intersection_points_node_type_idx ON test_bbox_debug.intersection_points USING btree (node_type);


--
-- Name: intersection_points_point_3d_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX intersection_points_point_3d_idx ON test_bbox_debug.intersection_points USING gist (point_3d);


--
-- Name: intersection_points_point_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX intersection_points_point_idx ON test_bbox_debug.intersection_points USING gist (point);


--
-- Name: trails_app_uuid_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_app_uuid_idx ON test_bbox_debug.trails USING btree (app_uuid);


--
-- Name: trails_bbox_min_lng_bbox_max_lng_bbox_min_lat_bbox_max_lat_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_bbox_min_lng_bbox_max_lng_bbox_min_lat_bbox_max_lat_idx ON test_bbox_debug.trails USING btree (bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);


--
-- Name: trails_bbox_min_lng_bbox_max_lng_bbox_min_lat_bbox_max_lat_idx1; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_bbox_min_lng_bbox_max_lng_bbox_min_lat_bbox_max_lat_idx1 ON test_bbox_debug.trails USING btree (bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat) WHERE (bbox_min_lng IS NOT NULL);


--
-- Name: trails_elevation_gain_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_elevation_gain_idx ON test_bbox_debug.trails USING btree (elevation_gain);


--
-- Name: trails_elevation_gain_max_elevation_min_elevation_avg_eleva_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_elevation_gain_max_elevation_min_elevation_avg_eleva_idx ON test_bbox_debug.trails USING btree (elevation_gain, max_elevation, min_elevation, avg_elevation) WHERE (elevation_gain IS NOT NULL);


--
-- Name: trails_geometry_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_geometry_idx ON test_bbox_debug.trails USING gist (geometry);


--
-- Name: trails_geometry_idx1; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_geometry_idx1 ON test_bbox_debug.trails USING gist (geometry) WHERE (public.st_ndims(geometry) = 3);


--
-- Name: trails_geometry_idx2; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_geometry_idx2 ON test_bbox_debug.trails USING gist (geometry) WHERE (public.st_ndims(geometry) = 3);


--
-- Name: trails_geometry_idx3; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_geometry_idx3 ON test_bbox_debug.trails USING gist (geometry);


--
-- Name: trails_geometry_idx4; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_geometry_idx4 ON test_bbox_debug.trails USING gist (geometry);


--
-- Name: trails_geometry_idx5; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_geometry_idx5 ON test_bbox_debug.trails USING gist (geometry);


--
-- Name: trails_osm_id_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_osm_id_idx ON test_bbox_debug.trails USING btree (osm_id);


--
-- Name: trails_region_bbox_min_lng_bbox_max_lng_bbox_min_lat_bbox_m_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_region_bbox_min_lng_bbox_max_lng_bbox_min_lat_bbox_m_idx ON test_bbox_debug.trails USING btree (region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);


--
-- Name: trails_region_elevation_gain_elevation_loss_max_elevation_m_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_region_elevation_gain_elevation_loss_max_elevation_m_idx ON test_bbox_debug.trails USING btree (region, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation);


--
-- Name: trails_region_elevation_gain_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_region_elevation_gain_idx ON test_bbox_debug.trails USING btree (region, elevation_gain);


--
-- Name: trails_region_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_region_idx ON test_bbox_debug.trails USING btree (region);


--
-- Name: trails_region_length_km_elevation_gain_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_region_length_km_elevation_gain_idx ON test_bbox_debug.trails USING btree (region, length_km, elevation_gain);


--
-- Name: trails_region_length_km_elevation_gain_idx1; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_region_length_km_elevation_gain_idx1 ON test_bbox_debug.trails USING btree (region, length_km, elevation_gain) WHERE ((elevation_gain IS NOT NULL) AND (max_elevation IS NOT NULL));


--
-- Name: trails_region_surface_trail_type_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_region_surface_trail_type_idx ON test_bbox_debug.trails USING btree (region, surface, trail_type);


--
-- Name: trails_st_envelope_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_st_envelope_idx ON test_bbox_debug.trails USING gist (public.st_envelope(geometry));


--
-- Name: trails_st_makeenvelope_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_st_makeenvelope_idx ON test_bbox_debug.trails USING gist (public.st_makeenvelope((bbox_min_lng)::double precision, (bbox_min_lat)::double precision, (bbox_max_lng)::double precision, (bbox_max_lat)::double precision));


--
-- Name: trails_surface_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_surface_idx ON test_bbox_debug.trails USING btree (surface);


--
-- Name: trails_trail_type_idx; Type: INDEX; Schema: test_bbox_debug; Owner: -
--

CREATE INDEX trails_trail_type_idx ON test_bbox_debug.trails USING btree (trail_type);


--
-- Name: trails trigger_auto_calculate_bbox; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_auto_calculate_bbox BEFORE INSERT OR UPDATE ON public.trails FOR EACH ROW EXECUTE FUNCTION public.auto_calculate_bbox();


--
-- Name: trails trigger_auto_calculate_length; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_auto_calculate_length BEFORE INSERT OR UPDATE ON public.trails FOR EACH ROW EXECUTE FUNCTION public.auto_calculate_length();


--
-- Name: trails trigger_update_geojson_cache; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_geojson_cache BEFORE INSERT OR UPDATE ON public.trails FOR EACH ROW EXECUTE FUNCTION public.update_geojson_cache();


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
-- Name: routing_edges routing_edges_source_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076594794.routing_edges
    ADD CONSTRAINT routing_edges_source_fkey FOREIGN KEY (source) REFERENCES staging_boulder_1754076594794.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_target_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1754076594794; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076594794.routing_edges
    ADD CONSTRAINT routing_edges_target_fkey FOREIGN KEY (target) REFERENCES staging_boulder_1754076594794.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_source_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076945956.routing_edges
    ADD CONSTRAINT routing_edges_source_fkey FOREIGN KEY (source) REFERENCES staging_boulder_1754076945956.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_target_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1754076945956; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754076945956.routing_edges
    ADD CONSTRAINT routing_edges_target_fkey FOREIGN KEY (target) REFERENCES staging_boulder_1754076945956.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_source_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077088464.routing_edges
    ADD CONSTRAINT routing_edges_source_fkey FOREIGN KEY (source) REFERENCES staging_boulder_1754077088464.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_target_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1754077088464; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077088464.routing_edges
    ADD CONSTRAINT routing_edges_target_fkey FOREIGN KEY (target) REFERENCES staging_boulder_1754077088464.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_source_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077167124.routing_edges
    ADD CONSTRAINT routing_edges_source_fkey FOREIGN KEY (source) REFERENCES staging_boulder_1754077167124.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_target_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1754077167124; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077167124.routing_edges
    ADD CONSTRAINT routing_edges_target_fkey FOREIGN KEY (target) REFERENCES staging_boulder_1754077167124.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_source_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077262506.routing_edges
    ADD CONSTRAINT routing_edges_source_fkey FOREIGN KEY (source) REFERENCES staging_boulder_1754077262506.routing_nodes(id) ON DELETE CASCADE;


--
-- Name: routing_edges routing_edges_target_fkey; Type: FK CONSTRAINT; Schema: staging_boulder_1754077262506; Owner: -
--

ALTER TABLE ONLY staging_boulder_1754077262506.routing_edges
    ADD CONSTRAINT routing_edges_target_fkey FOREIGN KEY (target) REFERENCES staging_boulder_1754077262506.routing_nodes(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

