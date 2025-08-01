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
    distance_km REAL NOT NULL CHECK(distance_km > 0),
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
CREATE INDEX IF NOT EXISTS idx_routing_edges_distance ON routing_edges(distance_km);
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

-- Function 3: generate_routing_nodes_native
CREATE OR REPLACE FUNCTION generate_routing_nodes_native(
    staging_schema text, 
    tolerance_meters real DEFAULT 0.0001
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

    -- Generate routing nodes from trail endpoints and intersections
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, created_at)
        WITH trail_endpoints AS (
            SELECT
                app_uuid,
                name,
                ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point,
                ST_Z(ST_StartPoint(geometry)) as start_elevation,
                ST_Z(ST_EndPoint(geometry)) as end_elevation
            FROM %I.trails
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        all_points AS (
            SELECT
                app_uuid,
                name,
                start_point as point,
                start_elevation as elevation,
                'start' as point_type
            FROM trail_endpoints
            UNION ALL
            SELECT
                app_uuid,
                name,
                end_point as point,
                end_elevation as elevation,
                'end' as point_type
            FROM trail_endpoints
        ),
        intersection_points AS (
            SELECT DISTINCT
                ST_Intersection(t1.geometry, t2.geometry) as point,
                ST_Z(ST_Intersection(t1.geometry, t2.geometry)) as elevation
            FROM %I.trails t1
            JOIN %I.trails t2 ON t1.app_uuid < t2.app_uuid
            WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
            AND t1.geometry IS NOT NULL AND t2.geometry IS NOT NULL
            AND ST_IsValid(t1.geometry) AND ST_IsValid(t2.geometry)
        ),
        clustered_points AS (
            SELECT
                ST_Centroid(ST_Collect(point)) as clustered_point,
                ST_Z(ST_Centroid(ST_Collect(point))) as elevation,
                COUNT(*) as point_count,
                STRING_AGG(DISTINCT app_uuid, ',' ORDER BY app_uuid) as connected_trails
            FROM all_points
            GROUP BY ST_ClusterWithin(point, $1)
        ),
        intersection_clusters AS (
            SELECT
                ST_Centroid(ST_Collect(point)) as clustered_point,
                ST_Z(ST_Centroid(ST_Collect(point))) as elevation,
                COUNT(*) as point_count,
                'intersection' as node_type
            FROM intersection_points
            GROUP BY ST_ClusterWithin(point, $1)
        ),
        all_clusters AS (
            SELECT
                clustered_point,
                elevation,
                point_count,
                CASE
                    WHEN point_count > 1 THEN 'intersection'
                    ELSE 'endpoint'
                END as node_type,
                connected_trails
            FROM clustered_points
            UNION ALL
            SELECT
                clustered_point,
                elevation,
                point_count,
                node_type,
                NULL as connected_trails
            FROM intersection_clusters
        )
        SELECT
            ROW_NUMBER() OVER (ORDER BY ST_X(clustered_point), ST_Y(clustered_point)) as id,
            md5(ST_AsText(clustered_point)) as node_uuid,
            ST_Y(clustered_point) as lat,
            ST_X(clustered_point) as lng,
            elevation,
            node_type,
            connected_trails,
            NOW() as created_at
        FROM all_clusters
        WHERE clustered_point IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_meters;

    GET DIAGNOSTICS node_count_var = ROW_COUNT;

    -- Return results
    RETURN QUERY SELECT
        node_count_var,
        true as success,
        format('Successfully generated %s routing nodes (endpoints and intersections)', node_count_var) as message;

    RAISE NOTICE 'Generated % routing nodes', node_count_var;

EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT
        0, false,
        format('Error during routing nodes generation: %s', SQLERRM) as message;

    RAISE NOTICE 'Error during routing nodes generation: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Function 4: generate_routing_edges_native
CREATE OR REPLACE FUNCTION generate_routing_edges_native(
    staging_schema text, 
    tolerance_meters real DEFAULT 0.0001
) RETURNS TABLE(
    edge_count integer, 
    success boolean, 
    message text
) AS $$
DECLARE
    edge_count_var integer := 0;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);

    -- Generate routing edges from trail segments
    EXECUTE format($f$
        INSERT INTO %I.routing_edges (
            from_node_id, to_node_id, trail_id, trail_name, 
            distance_km, elevation_gain, elevation_loss, 
            is_bidirectional, created_at, geometry
        )
        WITH segment_endpoints AS (
            SELECT
                t.id as trail_id,
                t.name as trail_name,
                t.length_km,
                t.elevation_gain,
                t.elevation_loss,
                ST_StartPoint(t.geometry) as start_point,
                ST_EndPoint(t.geometry) as end_point,
                t.geometry
            FROM %I.trails t
            WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        ),
        node_connections AS (
            SELECT
                se.trail_id,
                se.trail_name,
                se.length_km,
                se.elevation_gain,
                se.elevation_loss,
                se.geometry,
                rn1.id as from_node_id,
                rn2.id as to_node_id
            FROM segment_endpoints se
            LEFT JOIN %I.routing_nodes rn1 ON ST_DWithin(se.start_point, ST_SetSRID(ST_MakePoint(rn1.lng, rn1.lat), 4326), $1)
            LEFT JOIN %I.routing_nodes rn2 ON ST_DWithin(se.end_point, ST_SetSRID(ST_MakePoint(rn2.lng, rn2.lat), 4326), $1)
            WHERE rn1.id IS NOT NULL AND rn2.id IS NOT NULL
        )
        SELECT
            from_node_id,
            to_node_id,
            trail_id::text,
            trail_name,
            length_km,
            elevation_gain,
            elevation_loss,
            true as is_bidirectional,
            NOW() as created_at,
            geometry
        FROM node_connections
    $f$, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_meters;

    GET DIAGNOSTICS edge_count_var = ROW_COUNT;

    -- Return results
    RETURN QUERY SELECT
        edge_count_var,
        true as success,
        format('Successfully generated %s routing edges', edge_count_var) as message;

    RAISE NOTICE 'Generated % routing edges', edge_count_var;

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