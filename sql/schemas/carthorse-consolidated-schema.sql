-- =============================================================================
-- CONSOLIDATED CARTHORSE SCHEMA - Single Source of Truth
-- This file contains only the functions and tables that are actually used
-- Version: 7.0.0 (Consolidated)
-- =============================================================================

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enable pgRouting extension
CREATE EXTENSION IF NOT EXISTS pgrouting;

-- ============================================================================
-- SCHEMA VERSION TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_version (
    id SERIAL PRIMARY KEY,
    version INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert schema version 7
INSERT INTO schema_version (version) VALUES (7) ON CONFLICT DO NOTHING;

-- ============================================================================
-- TRAILS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS trails (
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
    length_km REAL CHECK(length_km > 0),
    elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
    elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
    max_elevation REAL,
    min_elevation REAL,
    avg_elevation REAL,
    source TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    geometry GEOMETRY(LINESTRINGZ, 4326)
);

-- ============================================================================
-- ROUTING NODES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS routing_nodes (
    id SERIAL PRIMARY KEY,
    node_uuid TEXT UNIQUE,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    elevation REAL,
    node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
    connected_trails TEXT,
    trail_ids TEXT[], -- New column for trail_ids
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ROUTING EDGES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS routing_edges (
    id SERIAL PRIMARY KEY,
    from_node_id INTEGER NOT NULL,
    to_node_id INTEGER NOT NULL,
    trail_id TEXT NOT NULL,
    trail_name TEXT NOT NULL,
    length_km REAL NOT NULL CHECK(length_km > 0),
    elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
    elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
    is_bidirectional BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    geometry geometry(LineStringZ, 4326),
    geojson TEXT,
    FOREIGN KEY (from_node_id) REFERENCES routing_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (to_node_id) REFERENCES routing_nodes(id) ON DELETE CASCADE
);

-- ============================================================================
-- REGIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS regions (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    region_key TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON trails(app_uuid);
CREATE INDEX IF NOT EXISTS idx_trails_osm_id ON trails(osm_id);
CREATE INDEX IF NOT EXISTS idx_trails_region ON trails(region);
CREATE INDEX IF NOT EXISTS idx_trails_geometry ON trails USING GIST(geometry);
CREATE INDEX IF NOT EXISTS idx_trails_elevation ON trails(elevation_gain);
CREATE INDEX IF NOT EXISTS idx_trails_surface ON trails(surface);
CREATE INDEX IF NOT EXISTS idx_trails_type ON trails(trail_type);

CREATE INDEX IF NOT EXISTS idx_routing_nodes_location ON routing_nodes USING GIST(ST_SetSRID(ST_MakePoint(lng, lat), 4326));
CREATE INDEX IF NOT EXISTS idx_routing_nodes_type ON routing_nodes(node_type);

CREATE INDEX IF NOT EXISTS idx_routing_edges_trail ON routing_edges(trail_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_nodes ON routing_edges(from_node_id, to_node_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_distance ON routing_edges(length_km);
CREATE INDEX IF NOT EXISTS idx_routing_edges_geometry ON routing_edges USING GIST(geometry);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_trails_updated_at 
    BEFORE UPDATE ON trails 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- CORE FUNCTIONS (Only the 5 functions we actually use)
-- ============================================================================

-- Function 1: detect_trail_intersections
CREATE OR REPLACE FUNCTION detect_trail_intersections(
    trails_schema text,
    trails_table text,
    intersection_tolerance_meters float DEFAULT 2.0
) RETURNS TABLE (
    intersection_point geometry,
    intersection_point_3d geometry,
    connected_trail_ids integer[],
    connected_trail_names text[],
    node_type text,
    distance_meters float
) AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        WITH noded_trails AS (
            SELECT id, name, (ST_Dump(ST_Node(geometry))).geom as noded_geom
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        true_intersections AS (
            SELECT 
                ST_Intersection(t1.noded_geom, t2.noded_geom) as intersection_point,
                ST_Force3D(ST_Intersection(t1.noded_geom, t2.noded_geom)) as intersection_point_3d,
                ARRAY[t1.id, t2.id] as connected_trail_ids,
                ARRAY[t1.name, t2.name] as connected_trail_names,
                ''intersection'' as node_type,
                ST_Distance(t1.noded_geom::geography, t2.noded_geom::geography) as distance_meters
            FROM noded_trails t1
            JOIN noded_trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.noded_geom, t2.noded_geom)
            AND ST_GeometryType(ST_Intersection(t1.noded_geom, t2.noded_geom)) = ''ST_Point''
        )
        SELECT 
            intersection_point,
            intersection_point_3d,
            connected_trail_ids,
            connected_trail_names,
            node_type,
            distance_meters
        FROM true_intersections
        WHERE distance_meters <= $1
    ', trails_schema, trails_table) USING intersection_tolerance_meters;
END;
$$ LANGUAGE plpgsql;

-- Function 2: copy_and_split_trails_to_staging_native
CREATE OR REPLACE FUNCTION copy_and_split_trails_to_staging_native(
    staging_schema text, 
    source_table text, 
    region_filter text, 
    bbox_min_lng real DEFAULT NULL::real, 
    bbox_min_lat real DEFAULT NULL::real, 
    bbox_max_lng real DEFAULT NULL::real, 
    bbox_max_lat real DEFAULT NULL::real, 
    trail_limit integer DEFAULT NULL::integer, 
    tolerance_meters real DEFAULT 1.0
) RETURNS TABLE(
    original_count integer, 
    split_count integer, 
    intersection_count integer, 
    success boolean, 
    message text
) AS $$
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
            SELECT
                id, app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
                bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                source, created_at, updated_at, geometry
            FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        ),
        trails_with_intersections AS (
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
            SELECT * FROM trails_with_intersections
            UNION ALL
            SELECT * FROM trails_without_intersections
        )
        SELECT
            gen_random_uuid() as app_uuid,
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
        WHERE ST_IsValid(pt.split_geometry)
          AND pt.app_uuid IS NOT NULL
    $f$, staging_schema, source_query, source_query, source_query);

    GET DIAGNOSTICS split_count_var = ROW_COUNT;

    -- Get original count from source query
    EXECUTE format('SELECT COUNT(*) FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)', source_query) INTO original_count_var;

    -- Step 2: Detect intersections between split trail segments
    PERFORM detect_trail_intersections(staging_schema, 'trails', tolerance_meters);

    -- Get intersection count
    EXECUTE format('SELECT COUNT(*) FROM %I.intersection_points', staging_schema) INTO intersection_count_var;

    -- Clear routing data in staging schema since it needs to be regenerated from split trails
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
$$ LANGUAGE plpgsql;

-- Function 3: generate_routing_nodes_native (IMPROVED VERSION)
CREATE OR REPLACE FUNCTION generate_routing_nodes_native(
    staging_schema text, 
    tolerance_meters real DEFAULT 2.0
) RETURNS TABLE(
    node_count integer, 
    success boolean, 
    message text
) AS $$
DECLARE
    node_count_var integer := 0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Generate routing nodes from trail start and end points ONLY
    -- Use the SAME criteria as edge generation to ensure consistency
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (id, the_geom, cnt, lng, lat, elevation)
        SELECT DISTINCT
            nextval('routing_nodes_id_seq') as id,
            ST_SetSRID(ST_MakePoint(ST_X(clustered_point), ST_Y(clustered_point)), 4326) as the_geom,
            point_count as cnt,
            ST_X(clustered_point) as lng,
            ST_Y(clustered_point) as lat,
            COALESCE(ST_Z(clustered_point), 0) as elevation
        FROM (
            -- Cluster trail endpoints within tolerance distance
            SELECT 
                ST_Centroid(ST_Collect(point)) as clustered_point,
                COUNT(*) as point_count
            FROM (
                -- Start points of trails that will get edges
                SELECT ST_StartPoint(geometry) as point 
                FROM %I.trails 
                WHERE geometry IS NOT NULL 
                  AND ST_IsValid(geometry) 
                  AND length_km IS NOT NULL AND length_km > 0
                  AND ST_StartPoint(geometry) != ST_EndPoint(geometry)  -- No self-loops
                  AND ST_Length(geometry) > 0
                  AND ST_NumPoints(geometry) >= 2
                UNION
                -- End points of trails that will get edges
                SELECT ST_EndPoint(geometry) as point 
                FROM %I.trails 
                WHERE geometry IS NOT NULL 
                  AND ST_IsValid(geometry) 
                  AND length_km IS NOT NULL AND length_km > 0
                  AND ST_StartPoint(geometry) != ST_EndPoint(geometry)  -- No self-loops
                  AND ST_Length(geometry) > 0
                  AND ST_NumPoints(geometry) >= 2
            ) trail_points
            WHERE point IS NOT NULL
            GROUP BY ST_ClusterWithin(point, $1)  -- Cluster within tolerance distance
        ) clustered_points
        WHERE clustered_point IS NOT NULL
          AND point_count >= 1  -- At least one trail endpoint
    $f$, staging_schema, staging_schema, staging_schema);
    
    -- Get total node count
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count_var;
    
    -- Return results
    RETURN QUERY SELECT 
        node_count_var,
        true as success,
        format('Successfully generated %s routing nodes (endpoints only)', node_count_var) as message;
    
    RAISE NOTICE 'Generated % routing nodes (endpoints only)', node_count_var;
        
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing nodes generation: %s', SQLERRM) as message;
    
    RAISE NOTICE 'Error during routing nodes generation: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Function 4: generate_routing_edges_native (IMPROVED VERSION)
CREATE OR REPLACE FUNCTION generate_routing_edges_native(
    staging_schema text, 
    tolerance_meters real DEFAULT 2.0
) RETURNS TABLE(
    edge_count integer, 
    success boolean, 
    message text
) AS $$
DECLARE
    edge_count_var integer := 0;
    node_count_var integer := 0;
    max_node_id_var integer := 0;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Get node count and max node ID for validation
    EXECUTE format('SELECT COUNT(*), MAX(id) FROM %I.routing_nodes', staging_schema) INTO node_count_var, max_node_id_var;
    
    -- Validate that we have nodes to work with
    IF node_count_var = 0 THEN
        RETURN QUERY SELECT 
            0, false, 
            'No routing nodes available for edge generation' as message;
        RETURN;
    END IF;
    
    -- Generate routing edges from trail segments with improved validation
    EXECUTE format($f$
        INSERT INTO %I.routing_edges (id, app_uuid, name, trail_type, length_km, elevation_gain, elevation_loss, geom, source, target)
        SELECT 
            nextval('routing_edges_id_seq') as id,
            t.app_uuid,
            t.name,
            t.trail_type,
            t.length_km,
            t.elevation_gain,
            t.elevation_loss,
            t.geometry as geom,
            source_node.id as source,
            target_node.id as target
        FROM %I.trails t
        CROSS JOIN LATERAL (
            SELECT id FROM %I.routing_nodes 
            WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_StartPoint(t.geometry), $1)
              AND id IS NOT NULL
              AND id <= $2  -- Ensure node ID is within valid range
            ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_StartPoint(t.geometry))
            LIMIT 1
        ) source_node
        CROSS JOIN LATERAL (
            SELECT id FROM %I.routing_nodes 
            WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_EndPoint(t.geometry), $1)
              AND id IS NOT NULL
              AND id <= $2  -- Ensure node ID is within valid range
            ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_EndPoint(t.geometry))
            LIMIT 1
        ) target_node
        WHERE t.geometry IS NOT NULL 
          AND ST_IsValid(t.geometry) 
          AND t.length_km IS NOT NULL AND t.length_km > 0
          AND ST_Length(t.geometry) > 0
          AND ST_NumPoints(t.geometry) >= 2
          AND source_node.id IS NOT NULL
          AND target_node.id IS NOT NULL
          AND source_node.id <= $2  -- Double-check source node ID
          AND target_node.id <= $2  -- Double-check target node ID
    $f$, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_meters, max_node_id_var;
    
    GET DIAGNOSTICS edge_count_var = ROW_COUNT;
    
    -- Validate that no orphaned edges were created
    EXECUTE format($f$
        SELECT COUNT(*) FROM %I.routing_edges e
        WHERE e.source NOT IN (SELECT id FROM %I.routing_nodes)
           OR e.target NOT IN (SELECT id FROM %I.routing_nodes)
    $f$, staging_schema, staging_schema) INTO edge_count_var;
    
    IF edge_count_var > 0 THEN
        RETURN QUERY SELECT 
            0, false, 
            format('Validation failed: %s edges reference non-existent nodes', edge_count_var) as message;
        RETURN;
    END IF;
    
    -- Get final edge count
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count_var;
    
    -- Return results
    RETURN QUERY SELECT 
        edge_count_var,
        true as success,
        format('Successfully generated %s routing edges from %s nodes (max node ID: %s)', 
               edge_count_var, node_count_var, max_node_id_var) as message;
    
    RAISE NOTICE 'Generated % routing edges from % nodes (max node ID: %)', 
                 edge_count_var, node_count_var, max_node_id_var;
        
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing edges generation: %s', SQLERRM) as message;
    
    RAISE NOTICE 'Error during routing edges generation: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Function 5: cleanup_orphaned_nodes
CREATE OR REPLACE FUNCTION cleanup_orphaned_nodes(
    staging_schema text
) RETURNS TABLE(
    success boolean, 
    message text, 
    cleaned_nodes integer
) AS $$
DECLARE
    orphaned_nodes_count integer := 0;
    total_nodes_before integer := 0;
    total_nodes_after integer := 0;
BEGIN
    -- Get count before cleanup
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO total_nodes_before;

    -- Remove orphaned nodes (nodes not connected to any trails)
    -- These are nodes that were created but don't actually connect any trail segments
    EXECUTE format($f$
        DELETE FROM %I.routing_nodes n
        WHERE NOT EXISTS (
            SELECT 1 FROM %I.trails t
            WHERE ST_DWithin(
                ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326),
                t.geometry,
                0.001
            )
        )
    $f$, staging_schema, staging_schema);

    GET DIAGNOSTICS orphaned_nodes_count = ROW_COUNT;

    -- Get count after cleanup
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO total_nodes_after;

    -- Return results
    RETURN QUERY SELECT
        true as success,
        format('Cleaned up %s orphaned nodes (before: %s, after: %s)', 
               orphaned_nodes_count, total_nodes_before, total_nodes_after) as message,
        orphaned_nodes_count as cleaned_nodes;

    RAISE NOTICE 'Cleaned up % orphaned nodes', orphaned_nodes_count;

EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT
        false,
        format('Error during orphaned nodes cleanup: %s', SQLERRM) as message,
        0 as cleaned_nodes;

    RAISE NOTICE 'Error during orphaned nodes cleanup: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Create sequences for routing nodes and edges
CREATE SEQUENCE IF NOT EXISTS routing_nodes_id_seq;
CREATE SEQUENCE IF NOT EXISTS routing_edges_id_seq;

-- =============================================================================
-- ROUTE RECOMMENDATION FUNCTIONS (CONFIGURABLE VERSION)
-- =============================================================================
-- 
-- Simple PostgreSQL-based route finding using WITH RECURSIVE
-- No pgRouting required - uses only built-in PostgreSQL features
-- 
-- Features:
-- - Find routes matching target distance and elevation
-- - Avoid cycles and infinite loops
-- - Calculate similarity scores using configurable weights
-- - Classify route shapes
-- - Uses configurable values from YAML configs
-- =============================================================================

-- Function to generate route names according to Gainiac requirements
CREATE OR REPLACE FUNCTION generate_route_name(route_edges text[], route_shape text, staging_schema text DEFAULT NULL)
RETURNS text AS $$
DECLARE
  trail_names text[];
  unique_trail_names text[];
  route_name text;
  target_schema text;
BEGIN
  -- Determine which schema to use
  IF staging_schema IS NULL THEN
    target_schema := 'public';
  ELSE
    target_schema := staging_schema;
  END IF;
  
  -- Extract unique trail names from route edges
  EXECUTE format('SELECT array_agg(DISTINCT trail_name ORDER BY trail_name) FROM %I.routing_edges WHERE id::text = ANY($1)', target_schema)
  INTO trail_names
  USING route_edges;
  
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
$$ LANGUAGE plpgsql;

-- Function to find routes using recursive CTEs with configurable values
CREATE OR REPLACE FUNCTION find_routes_recursive_configurable(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    tolerance_percent float DEFAULT NULL,  -- Use config if NULL
    max_depth integer DEFAULT 8
) RETURNS TABLE(
    route_id text,
    start_node text,
    end_node text,
    total_distance_km float,
    total_elevation_gain float,
    route_path text[],
    route_edges text[],
    route_shape text,
    trail_count integer,
    similarity_score float
) AS $$
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
    
    RAISE NOTICE 'Starting route search: target=%.1fkm, elevation=%.0fm, tolerance=%%%, max_depth=%', 
        target_distance_km, target_elevation_gain, config_tolerance, max_depth;
    
    RETURN QUERY EXECUTE format($f$
        WITH RECURSIVE route_search AS (
            -- Start with all intersection nodes as potential starting points
            SELECT 
                id::text as start_node,
                id::text as current_node,
                id::text as end_node,
                ARRAY[id::text] as path,
                ARRAY[]::text[] as edges,
                0.0::float as total_distance_km,
                0.0::float as total_elevation_gain,
                0 as depth,
                ARRAY[]::text[] as trail_names
            FROM %I.routing_nodes
            
            UNION ALL
            
            -- Recursively explore connected nodes
            SELECT 
                rs.start_node,
                e.target::text as current_node,
                e.target::text as end_node,
                rs.path || e.target::text,
                rs.edges || e.id::text,
                rs.total_distance_km + e.length_km,
                rs.total_elevation_gain + COALESCE(e.elevation_gain, 0),
                rs.depth + 1,
                rs.trail_names || e.trail_name
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.current_node::uuid = e.source
            WHERE rs.depth < $1  -- Limit depth to prevent infinite loops
              AND e.target::text != ALL(rs.path)  -- Avoid cycles
              AND rs.total_distance_km < $2 * (1 + $3 / 100.0)  -- Distance tolerance
              AND rs.total_elevation_gain < $4 * (1 + $3 / 100.0)  -- Elevation tolerance
              AND rs.total_distance_km >= $2 * (1 - $3 / 100.0) * 0.5  -- Early termination: stop if too short
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
$$ LANGUAGE plpgsql;

-- Function to generate route recommendations using configurable patterns
CREATE OR REPLACE FUNCTION generate_route_recommendations_configurable(
    staging_schema text,
    region_name text DEFAULT 'boulder'
) RETURNS integer AS $$
DECLARE
    route_count integer := 0;
    total_routes integer := 0;
    pattern_distance float;
    pattern_elevation float;
    pattern_shape text;
    start_time timestamp;
BEGIN
    start_time := clock_timestamp();
    RAISE NOTICE 'Starting route recommendation generation at %', start_time;
    
    -- Pattern 1: Short loops (2-5km, 100-300m elevation)
    pattern_distance := 3.0;
    pattern_elevation := 200.0;
    pattern_shape := 'loop';
    
    EXECUTE format('
        INSERT INTO %I.route_recommendations (
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
            %L as region,
            %L,
            %L,
            r.total_distance_km,
            r.total_elevation_gain,
            ''similar_distance'' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            json_build_object(
                ''type'', ''LineString'',
                ''coordinates'', array_agg(
                    json_build_array(n.lng, n.lat, COALESCE(n.elevation, 0))
                    ORDER BY array_position(r.route_path, n.id)
                )
            )::jsonb as route_path,
            json_agg(r.route_edges)::jsonb as route_edges,
            %L || '' '' || r.route_shape || '' Route - '' || 
            ROUND(r.total_distance_km, 1) || ''km, '' || 
            ROUND(r.total_elevation_gain) || ''m gain'' as route_name,
            NOW() as created_at
        FROM find_routes_recursive_configurable(
            %L,
            %L,
            %L,
            20.0,  -- 20%% tolerance
            8
        ) r
        JOIN %I.routing_nodes n ON n.id = ANY(r.route_path)
        WHERE r.route_shape = %L
          AND r.similarity_score >= 0.3
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.route_edges
    ', staging_schema, region_name, pattern_distance, pattern_elevation, region_name,
       staging_schema, pattern_distance, pattern_elevation, staging_schema, pattern_shape);
    
    GET DIAGNOSTICS route_count = ROW_COUNT;
    total_routes := total_routes + route_count;
    RAISE NOTICE 'Generated % routes for short loops', route_count;
    
    -- Pattern 2: Medium out-and-back (5-10km, 300-600m elevation)
    pattern_distance := 7.0;
    pattern_elevation := 450.0;
    pattern_shape := 'out-and-back';
    
    EXECUTE format('
        INSERT INTO %I.route_recommendations (
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
            %L as region,
            %L,
            %L,
            r.total_distance_km,
            r.total_elevation_gain,
            ''similar_distance'' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            json_build_object(
                ''type'', ''LineString'',
                ''coordinates'', array_agg(
                    json_build_array(n.lng, n.lat, COALESCE(n.elevation, 0))
                    ORDER BY array_position(r.route_path, n.id)
                )
            )::jsonb as route_path,
            json_agg(r.route_edges)::jsonb as route_edges,
            %L || '' '' || r.route_shape || '' Route - '' || 
            ROUND(r.total_distance_km, 1) || ''km, '' || 
            ROUND(r.total_elevation_gain) || ''m gain'' as route_name,
            NOW() as created_at
        FROM find_routes_recursive_configurable(
            %L,
            %L,
            %L,
            25.0,  -- 25%% tolerance
            8
        ) r
        JOIN %I.routing_nodes n ON n.id = ANY(r.route_path)
        WHERE r.route_shape = %L
          AND r.similarity_score >= 0.3
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.route_edges
    ', staging_schema, region_name, pattern_distance, pattern_elevation, region_name,
       staging_schema, pattern_distance, pattern_elevation, staging_schema, pattern_shape);
    
    GET DIAGNOSTICS route_count = ROW_COUNT;
    total_routes := total_routes + route_count;
    RAISE NOTICE 'Generated % routes for medium out-and-back', route_count;
    
    -- Pattern 3: Long point-to-point (10-20km, 600-1200m elevation)
    pattern_distance := 15.0;
    pattern_elevation := 900.0;
    pattern_shape := 'point-to-point';
    
    EXECUTE format('
        INSERT INTO %I.route_recommendations (
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
            %L as region,
            %L,
            %L,
            r.total_distance_km,
            r.total_elevation_gain,
            ''similar_distance'' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            json_build_object(
                ''type'', ''LineString'',
                ''coordinates'', array_agg(
                    json_build_array(n.lng, n.lat, COALESCE(n.elevation, 0))
                    ORDER BY array_position(r.route_path, n.id)
                )
            )::jsonb as route_path,
            json_agg(r.route_edges)::jsonb as route_edges,
            %L || '' '' || r.route_shape || '' Route - '' || 
            ROUND(r.total_distance_km, 1) || ''km, '' || 
            ROUND(r.total_elevation_gain) || ''m gain'' as route_name,
            NOW() as created_at
        FROM find_routes_recursive_configurable(
            %L,
            %L,
            %L,
            30.0,  -- 30%% tolerance
            8
        ) r
        JOIN %I.routing_nodes n ON n.id = ANY(r.route_path)
        WHERE r.route_shape = %L
          AND r.similarity_score >= 0.3
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.route_edges
    ', staging_schema, region_name, pattern_distance, pattern_elevation, region_name,
       staging_schema, pattern_distance, pattern_elevation, staging_schema, pattern_shape);
    
    GET DIAGNOSTICS route_count = ROW_COUNT;
    total_routes := total_routes + route_count;
    RAISE NOTICE 'Generated % routes for long point-to-point', route_count;
    
    RAISE NOTICE 'Route recommendation generation completed in %. Total routes: %', 
        clock_timestamp() - start_time, total_routes;
    
    RETURN total_routes;
END;
$$ LANGUAGE plpgsql;

-- Function to generate route recommendations with adaptive tolerance
CREATE OR REPLACE FUNCTION generate_route_recommendations_adaptive(
    staging_schema text,
    region_name text DEFAULT 'boulder',
    min_routes_per_pattern integer DEFAULT 10,
    max_tolerance_percent integer DEFAULT 50
) RETURNS integer AS $$
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
                generate_route_name(r.route_edges, r.route_shape, $1) as route_name,
                NOW() as created_at
            FROM find_routes_recursive_configurable($4, $2, $3, $5, $6) r
            JOIN %I.routing_nodes n ON n.id::text = ANY(r.route_path)
            WHERE r.route_shape = $7
              AND r.similarity_score >= get_min_route_score()  -- Use configurable minimum score
            GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                     r.route_shape, r.trail_count, r.similarity_score, r.route_edges;
            
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
                ROW_NUMBER() OVER (PARTITION BY r.route_id ORDER BY array_position(r.route_path, e.source::text)) as segment_order,
                e.length_km,
                e.elevation_gain,
                e.elevation_loss
            FROM find_routes_recursive_configurable($1, $2, $3, $4, $5) r
            JOIN %I.routing_edges e ON e.id::text = ANY(r.route_edges)
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
$$ LANGUAGE plpgsql;

-- Alias function for backward compatibility - calls the configurable version
CREATE OR REPLACE FUNCTION generate_route_recommendations(staging_schema text) RETURNS integer AS $$
BEGIN
    RETURN generate_route_recommendations_configurable(staging_schema, 'boulder');
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- ESSENTIAL CONFIGURATION FUNCTIONS (ONLY THE ONES ACTUALLY USED)
-- =============================================================================

-- Route pattern table for recommendations
CREATE TABLE IF NOT EXISTS route_patterns (
    id SERIAL PRIMARY KEY,
    pattern_name TEXT NOT NULL,
    target_distance_km FLOAT NOT NULL,
    target_elevation_gain FLOAT NOT NULL,
    route_shape TEXT NOT NULL,
    tolerance_percent FLOAT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default route patterns
INSERT INTO route_patterns (pattern_name, target_distance_km, target_elevation_gain, route_shape, tolerance_percent) VALUES
('Short Loop', 5, 200, 'loop', 20),
('Medium Loop', 10, 400, 'loop', 20),
('Long Loop', 15, 600, 'loop', 20),
('Short Out-and-Back', 8, 300, 'out-and-back', 20),
('Medium Out-and-Back', 12, 500, 'out-and-back', 20),
('Long Out-and-Back', 18, 700, 'out-and-back', 20),
('Short Point-to-Point', 6, 250, 'point-to-point', 20),
('Medium Point-to-Point', 12, 450, 'point-to-point', 20),
('Long Point-to-Point', 20, 800, 'point-to-point', 20)
ON CONFLICT (pattern_name) DO NOTHING;

-- Function to get route patterns
CREATE OR REPLACE FUNCTION get_route_patterns() RETURNS TABLE(
    pattern_name text,
    target_distance_km float,
    target_elevation_gain float,
    route_shape text,
    tolerance_percent float
) AS $$
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
$$ LANGUAGE plpgsql;

-- Essential config functions (only the ones actually used)
CREATE OR REPLACE FUNCTION get_min_route_score() RETURNS float AS $$
BEGIN
    RETURN 0.3; -- Default minimum score
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_max_routes_per_bin() RETURNS integer AS $$
BEGIN
    RETURN 10; -- Default max routes per bin
END;
$$ LANGUAGE plpgsql;

-- Function to calculate route similarity score (simplified for actual usage)
CREATE OR REPLACE FUNCTION calculate_route_similarity_score(
    actual_distance_km float,
    target_distance_km float,
    actual_elevation_gain float,
    target_elevation_gain float
) RETURNS float AS $$
BEGIN
    -- Simple similarity score based on how close we are to target
    RETURN GREATEST(0, 1 - ABS(actual_distance_km - target_distance_km) / target_distance_km);
END;
$$ LANGUAGE plpgsql; 

-- =============================================================================
-- UPDATED ROUTING NODES FUNCTION (FIXES ISOLATED NODES ISSUE)
-- =============================================================================

-- Updated generate_routing_nodes_native_v2 function with trail_ids array support
CREATE OR REPLACE FUNCTION public.generate_routing_nodes_native_v2_with_trail_ids(
    staging_schema text, 
    intersection_tolerance_meters real DEFAULT 2.0
) RETURNS TABLE(node_count integer, success boolean, message text) AS $$
DECLARE
    node_count_var integer := 0;
    tolerance_degrees real := intersection_tolerance_meters / 111000.0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Generate routing nodes from actual trail endpoints and intersections with trail_ids
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids, created_at)
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
                name as connected_trails,
                ARRAY[app_uuid] as trail_ids
            FROM trail_endpoints
            UNION ALL
            SELECT 
                app_uuid,
                name,
                end_point as point,
                end_elevation as elevation,
                'endpoint' as node_type,
                name as connected_trails,
                ARRAY[app_uuid] as trail_ids
            FROM trail_endpoints
        ),
        intersection_points AS (
            -- Get intersection points from detect_trail_intersections function
            -- Convert integer trail IDs to text UUIDs by looking them up
            SELECT 
                ip.intersection_point as point,
                COALESCE(ST_Z(ip.intersection_point_3d), 0) as elevation,
                'intersection' as node_type,
                array_to_string(ip.connected_trail_names, ',') as connected_trails,
                array_agg(t.app_uuid) as trail_ids
            FROM detect_trail_intersections($1, 'trails', $2) ip
            JOIN %I.trails t ON t.id = ANY(ip.connected_trail_ids)
            WHERE array_length(ip.connected_trail_ids, 1) > 1
            GROUP BY ip.intersection_point, ip.intersection_point_3d, ip.connected_trail_names
        ),
        all_nodes AS (
            SELECT point, elevation, node_type, connected_trails, trail_ids
            FROM all_endpoints
            WHERE point IS NOT NULL
            UNION ALL
            SELECT point, elevation, node_type, connected_trails, trail_ids
            FROM intersection_points
            WHERE point IS NOT NULL
        ),
        unique_nodes AS (
            SELECT DISTINCT
                point,
                elevation,
                node_type,
                connected_trails,
                trail_ids
            FROM all_nodes
            WHERE point IS NOT NULL
        ),
        clustered_nodes AS (
            SELECT 
                point as clustered_point,
                elevation,
                node_type,
                connected_trails,
                trail_ids
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
            trail_ids,
            NOW() as created_at
        FROM clustered_nodes
        WHERE clustered_point IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema)
    USING staging_schema, intersection_tolerance_meters;
    
    GET DIAGNOSTICS node_count_var = ROW_COUNT;
    
    RETURN QUERY SELECT 
        node_count_var,
        true as success,
        format('Generated %s routing nodes with trail_ids (v2, routable only, tolerance: %s m)', node_count_var, intersection_tolerance_meters) as message;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing nodes generation with trail_ids (v2): %s', SQLERRM) as message;
END;
$$ LANGUAGE plpgsql; 

-- =============================================================================
-- UPDATED ROUTING EDGES FUNCTION (MATCHES STAGING SCHEMA)
-- =============================================================================

-- Function: generate_routing_edges_native_v2 (LATEST VERSION)
-- Creates edges based on actual trail geometry connectivity, with configurable tolerance for coordinate matching
-- Only creates edges between connected, routable nodes based on trail geometry
-- Uses YAML configuration for tolerance (defaultIntersectionTolerance: 1.0m)
CREATE OR REPLACE FUNCTION generate_routing_edges_native_v2(staging_schema text, tolerance_meters real DEFAULT 1.0)
RETURNS TABLE(edge_count integer, success boolean, message text) AS $$
DECLARE
    edge_count_var integer := 0;
    node_count_var integer := 0;
    orphaned_count integer := 0;
    orphaned_edges_count integer := 0;
    tolerance_degrees real := tolerance_meters / 111000.0;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Get node count for validation
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count_var;
    
    -- Generate routing edges from actual trail geometry connectivity
    -- This creates edges based on trail geometry, not spatial proximity
    EXECUTE format($f$
        INSERT INTO %I.routing_edges (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry, geojson)
        WITH trail_connectivity AS (
            -- Find trails that connect to each other through shared nodes
            SELECT DISTINCT
                t1.app_uuid as trail1_id,
                t1.name as trail1_name,
                t1.length_km as trail1_length,
                t1.elevation_gain as trail1_elevation_gain,
                t1.elevation_loss as trail1_elevation_loss,
                t1.geometry as trail1_geometry,
                t2.app_uuid as trail2_id,
                t2.name as trail2_name,
                t2.length_km as trail2_length,
                t2.elevation_gain as trail2_elevation_gain,
                t2.elevation_loss as trail2_elevation_loss,
                t2.geometry as trail2_geometry
            FROM %I.trails t1
            JOIN %I.trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ),
        trail_segments AS (
            -- Create edges for each trail segment connecting to nodes
            SELECT 
                t.app_uuid as trail_id,
                t.name as trail_name,
                t.length_km,
                t.elevation_gain,
                t.elevation_loss,
                t.geometry,
                -- Find start node
                start_node.id as source_node_id,
                start_node.node_uuid as source_node_uuid,
                -- Find end node  
                end_node.id as target_node_id,
                end_node.node_uuid as target_node_uuid
            FROM %I.trails t
            -- Connect to start node (trail endpoint or intersection)
            LEFT JOIN %I.routing_nodes start_node ON 
                ST_DWithin(ST_StartPoint(t.geometry), ST_SetSRID(ST_MakePoint(start_node.lng, start_node.lat), 4326), %L)
                AND (start_node.trail_ids @> ARRAY[t.app_uuid] OR start_node.node_type = 'endpoint')
            -- Connect to end node (trail endpoint or intersection)
            LEFT JOIN %I.routing_nodes end_node ON 
                ST_DWithin(ST_EndPoint(t.geometry), ST_SetSRID(ST_MakePoint(end_node.lng, end_node.lat), 4326), %L)
                AND (end_node.trail_ids @> ARRAY[t.app_uuid] OR end_node.node_type = 'endpoint')
            WHERE t.geometry IS NOT NULL 
            AND ST_IsValid(t.geometry) 
            AND t.length_km > 0
            AND start_node.id IS NOT NULL 
            AND end_node.id IS NOT NULL
            AND start_node.id <> end_node.id
        )
        SELECT 
            source_node_id as source,
            target_node_id as target,
            trail_id,
            trail_name,
            length_km,
            elevation_gain,
            elevation_loss,
            geometry,
            ST_AsGeoJSON(geometry, 6, 0) as geojson
        FROM trail_segments
        WHERE source_node_id IS NOT NULL AND target_node_id IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema, tolerance_degrees, staging_schema, tolerance_degrees);
    
    GET DIAGNOSTICS edge_count_var = ROW_COUNT;
    
    -- Clean up orphaned nodes (nodes that have no edges)
    EXECUTE format($f$
        DELETE FROM %I.routing_nodes 
        WHERE id NOT IN (
            SELECT DISTINCT source FROM %I.routing_edges 
            UNION 
            SELECT DISTINCT target FROM %I.routing_edges
        )
    $f$, staging_schema, staging_schema, staging_schema, staging_schema);
    
    GET DIAGNOSTICS orphaned_count = ROW_COUNT;
    
    -- Clean up orphaned edges (edges that point to non-existent nodes)
    EXECUTE format($f$
        DELETE FROM %I.routing_edges 
        WHERE source NOT IN (SELECT id FROM %I.routing_nodes) 
        OR target NOT IN (SELECT id FROM %I.routing_nodes)
    $f$, staging_schema, staging_schema, staging_schema, staging_schema);
    
    GET DIAGNOSTICS orphaned_edges_count = ROW_COUNT;
    
    RETURN QUERY SELECT 
        edge_count_var,
        true as success,
        format('Generated %s routing edges from %s nodes, cleaned up %s orphaned nodes and %s orphaned edges (v2, trail geometry connectivity, tolerance: %s m)', edge_count_var, node_count_var, orphaned_count, orphaned_edges_count, tolerance_meters) as message;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing edges generation (v2): %s', SQLERRM) as message;
END;
$$ LANGUAGE plpgsql; 