-- PostgreSQL Master Database Schema for Carthorse
-- This file creates the master database schema with PostGIS spatial support
-- Version: 3.0.0 (Updated for v2.0.0 release)

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

-- Insert schema version 3
INSERT INTO schema_version (version) VALUES (3) ON CONFLICT DO NOTHING;

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
    geo2 GEOMETRY(LINESTRINGZ, 4326)
);

-- ============================================================================
-- ELEVATION POINTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS elevation_points (
    id SERIAL PRIMARY KEY,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    elevation REAL NOT NULL,
    source TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    geo2 GEOMETRY(POINT, 4326)
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
    geo2 GEOMETRY(LINESTRING, 4326),
    FOREIGN KEY (from_node_id) REFERENCES routing_nodes(id),
    FOREIGN KEY (to_node_id) REFERENCES routing_nodes(id)
);

-- ============================================================================
-- REGION METADATA TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS region_metadata (
    id SERIAL PRIMARY KEY,
    region_name TEXT NOT NULL,
    bbox_min_lng REAL,
    bbox_max_lng REAL,
    bbox_min_lat REAL,
    bbox_max_lat REAL,
    trail_count INTEGER CHECK(trail_count >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ROUTE RECOMMENDATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS route_recommendations (
    id SERIAL PRIMARY KEY,
    route_uuid TEXT UNIQUE,
    region TEXT NOT NULL,
    gpx_distance_km REAL,
    gpx_elevation_gain REAL,
    gpx_name TEXT,
    recommended_distance_km REAL,
    recommended_elevation_gain REAL,
    route_type TEXT,
    route_edges JSONB,
    route_path JSONB,
    similarity_score REAL,
    input_distance_km REAL,
    input_elevation_gain REAL,
    request_hash TEXT,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- SPLIT TRAILS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS split_trails (
    id SERIAL PRIMARY KEY,
    original_trail_id INTEGER NOT NULL,
    split_trail_id TEXT UNIQUE NOT NULL,
    segment_order INTEGER NOT NULL,
    length_km REAL NOT NULL,
    elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
    elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (original_trail_id) REFERENCES trails(id)
);

-- ============================================================================
-- INTERSECTION POINTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS intersection_points (
    id SERIAL PRIMARY KEY,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    elevation REAL,
    intersection_type TEXT,
    connected_trail_ids INTEGER[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    geo2 GEOMETRY(POINT, 4326)
);

-- ============================================================================
-- TRAIL HASHES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS trail_hashes (
    id SERIAL PRIMARY KEY,
    trail_id INTEGER NOT NULL,
    hash_value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trail_id) REFERENCES trails(id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Trails indexes
CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON trails(app_uuid);
CREATE INDEX IF NOT EXISTS idx_trails_osm_id ON trails(osm_id);
CREATE INDEX IF NOT EXISTS idx_trails_region ON trails(region);
CREATE INDEX IF NOT EXISTS idx_trails_bbox ON trails USING GIST (ST_MakeEnvelope(bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat));
CREATE INDEX IF NOT EXISTS idx_trails_geo2 ON trails USING GIST (geo2);
CREATE INDEX IF NOT EXISTS idx_trails_elevation ON trails(elevation_gain);
CREATE INDEX IF NOT EXISTS idx_trails_surface ON trails(surface);
CREATE INDEX IF NOT EXISTS idx_trails_type ON trails(trail_type);

-- Additional spatial indexes for trails
CREATE INDEX IF NOT EXISTS idx_trails_bbox_spatial ON trails USING GIST (ST_Envelope(geo2));
CREATE INDEX IF NOT EXISTS idx_trails_bbox_coords ON trails(bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);

-- Region-specific indexes
CREATE INDEX IF NOT EXISTS idx_trails_region_elevation ON trails(region, elevation_gain);
CREATE INDEX IF NOT EXISTS idx_trails_region_length ON trails(region, length_km);
CREATE INDEX IF NOT EXISTS idx_trails_region_surface ON trails(region, surface);
CREATE INDEX IF NOT EXISTS idx_trails_region_type ON trails(region, trail_type);

-- Elevation points indexes
CREATE INDEX IF NOT EXISTS idx_elevation_points_location ON elevation_points USING GIST (ST_SetSRID(ST_MakePoint(lng, lat), 4326));

-- Routing nodes indexes
CREATE INDEX IF NOT EXISTS idx_routing_nodes_location ON routing_nodes USING GIST (ST_SetSRID(ST_MakePoint(lng, lat), 4326));
CREATE INDEX IF NOT EXISTS idx_routing_nodes_type ON routing_nodes(node_type);

-- Routing edges indexes
CREATE INDEX IF NOT EXISTS idx_routing_edges_trail ON routing_edges(trail_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_nodes ON routing_edges(from_node_id, to_node_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_distance ON routing_edges(distance_km);

-- Route recommendations indexes
CREATE INDEX IF NOT EXISTS idx_route_recommendations_distance ON route_recommendations(gpx_distance_km, recommended_distance_km);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_elevation ON route_recommendations(gpx_elevation_gain, recommended_elevation_gain);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_uuid ON route_recommendations(route_uuid);

-- Additional route recommendations indexes
CREATE INDEX IF NOT EXISTS idx_route_recommendations_region ON route_recommendations(region);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_input ON route_recommendations(input_distance_km, input_elevation_gain);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_created ON route_recommendations(created_at);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_expires ON route_recommendations(expires_at);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_request_hash ON route_recommendations(request_hash);

-- Performance optimization indexes
CREATE INDEX IF NOT EXISTS idx_route_recommendations_region_hash ON route_recommendations(region, request_hash);

-- Additional performance indexes
CREATE INDEX IF NOT EXISTS idx_trails_length ON trails(length_km);
CREATE INDEX IF NOT EXISTS idx_trails_bbox_optimized ON trails(bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_coords ON routing_nodes(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routing_nodes_elevation ON routing_nodes(elevation) WHERE elevation IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routing_nodes_route_finding ON routing_nodes(id, lat, lng, elevation);
CREATE INDEX IF NOT EXISTS idx_routing_edges_from_node ON routing_edges(from_node_id, to_node_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_trail_distance ON routing_edges(trail_id, distance_km);
CREATE INDEX IF NOT EXISTS idx_routing_edges_route_finding ON routing_edges(from_node_id, to_node_id, trail_id, distance_km);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for trails table
CREATE TRIGGER update_trails_updated_at 
    BEFORE UPDATE ON trails 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PGROUTING FUNCTIONS
-- ============================================================================

-- Function to generate routing graph
CREATE OR REPLACE FUNCTION generate_routing_graph()
RETURNS TABLE(edges_count INTEGER, nodes_count INTEGER) AS $$
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
$$ LANGUAGE plpgsql;

-- Function to show routing graph summary
CREATE OR REPLACE FUNCTION show_routing_summary()
RETURNS TABLE(type TEXT, count BIGINT) AS $$
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
$$ LANGUAGE plpgsql;

-- ============================================================================
-- POSTGIS INTERSECTION FUNCTIONS
-- ============================================================================

-- Enhanced function to detect all intersections between trails in a table
-- Only returns points where two distinct trails cross/touch (true intersection)
-- or where endpoints are within a tight threshold (default 1.0 meter)
CREATE OR REPLACE FUNCTION detect_trail_intersections(
    trails_schema text,
    trails_table text,
    intersection_tolerance_meters float DEFAULT 1.0
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
            -- Use ST_Node to split all trails at intersections (network topology)
            SELECT id, name, (ST_Dump(ST_Node(geometry))).geom as noded_geom
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        true_intersections AS (
            -- True geometric intersections (where two trails cross/touch)
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
$$ LANGUAGE plpgsql;

-- Enhanced function to build routing nodes using optimized spatial operations
CREATE OR REPLACE FUNCTION build_routing_nodes(
    staging_schema text,
    trails_table text,
    intersection_tolerance_meters float DEFAULT 2.0
) RETURNS integer AS $$
DECLARE
    node_count integer;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Insert routing nodes using optimized PostGIS spatial functions
    EXECUTE format('
        INSERT INTO %I.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails)
        WITH trail_endpoints AS (
            -- Get all trail endpoints
            SELECT 
                id,
                name,
                        ST_StartPoint(geometry) as start_point,
        ST_EndPoint(geometry) as end_point,
                ST_Z(ST_StartPoint(ST_Force3D(geometry))) as start_elevation,
                ST_Z(ST_EndPoint(ST_Force3D(geometry))) as end_elevation
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        all_points AS (
            -- Collect all endpoints
            SELECT id, name, start_point as point, start_elevation as elevation, ''start'' as point_type
            FROM trail_endpoints
            UNION ALL
            SELECT id, name, end_point as point, end_elevation as elevation, ''end'' as point_type
            FROM trail_endpoints
        ),
        clustered_points AS (
            -- Cluster nearby points using ST_ClusterWithin
            SELECT 
                ST_Centroid(ST_Collect(point)) as cluster_center,
                ST_Z(ST_Centroid(ST_Collect(ST_Force3D(point)))) as cluster_elevation,
                array_agg(id) as connected_trail_ids,
                array_agg(name) as connected_trail_names,
                CASE 
                    WHEN COUNT(*) > 1 THEN ''intersection''
                    ELSE ''endpoint''
                END as node_type
            FROM all_points
            GROUP BY ST_ClusterWithin(point, $1)
        )
        SELECT 
            gen_random_uuid()::text as node_uuid,
            ST_Y(cluster_center) as lat,
            ST_X(cluster_center) as lng,
            cluster_elevation as elevation,
            node_type,
            array_to_string(connected_trail_names, '','') as connected_trails
        FROM clustered_points
        WHERE ST_IsValid(cluster_center)
    ', staging_schema, staging_schema, trails_table)
    USING intersection_tolerance_meters;
    
    -- Get count of inserted nodes
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    
    RETURN node_count;
END;
$$ LANGUAGE plpgsql;

-- Enhanced function to build routing edges using individual trail splitting
CREATE OR REPLACE FUNCTION build_routing_edges(
    staging_schema text,
    trails_table text
) RETURNS integer AS $$
DECLARE
    edge_count integer;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Insert routing edges using individual trail splitting
    EXECUTE format('
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, elevation_loss)
        WITH trail_segments AS (
            -- Split each trail individually at its intersections
            SELECT 
                t.id,
                t.name,
                t.length_km,
                t.elevation_gain,
                t.elevation_loss,
                        (ST_Dump(ST_Node(t.geometry))).geom as segment_geom,
        (ST_Dump(ST_Node(t.geometry))).path[1] as segment_order
            FROM %I.%I t
            WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        ),
        segment_endpoints AS (
            -- Get start and end points of each segment
            SELECT 
                id,
                name,
                length_km,
                elevation_gain,
                elevation_loss,
                segment_geom,
                segment_order,
                ST_StartPoint(segment_geom) as start_point,
                ST_EndPoint(segment_geom) as end_point
            FROM trail_segments
        ),
        node_matches AS (
            -- Match segment endpoints to routing nodes
            SELECT 
                se.id,
                se.name,
                se.length_km,
                se.elevation_gain,
                se.elevation_loss,
                se.segment_geom,
                se.segment_order,
                se.start_point,
                se.end_point,
                rn1.id as from_node_id,
                rn2.id as to_node_id
            FROM segment_endpoints se
            LEFT JOIN %I.routing_nodes rn1 ON ST_DWithin(se.start_point, rn1.geo2, 0.001)
            LEFT JOIN %I.routing_nodes rn2 ON ST_DWithin(se.end_point, rn2.geo2, 0.001)
            WHERE rn1.id IS NOT NULL AND rn2.id IS NOT NULL
        )
        SELECT 
            from_node_id,
            to_node_id,
            id::text as trail_id,
            name as trail_name,
            length_km as distance_km,
            elevation_gain,
            elevation_loss
        FROM node_matches
        ORDER BY id, segment_order
    ', staging_schema, staging_schema, trails_table, staging_schema, staging_schema);
    
    -- Get count of inserted edges
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    RETURN edge_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get intersection statistics
CREATE OR REPLACE FUNCTION get_intersection_stats(
    staging_schema text
) RETURNS TABLE(
    total_nodes integer,
    intersection_nodes integer,
    endpoint_nodes integer,
    total_edges integer,
    avg_edges_per_node float
) AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT 
            COUNT(*)::integer as total_nodes,
            COUNT(*) FILTER (WHERE node_type = ''intersection'')::integer as intersection_nodes,
            COUNT(*) FILTER (WHERE node_type = ''endpoint'')::integer as endpoint_nodes,
            (SELECT COUNT(*) FROM %I.routing_edges)::integer as total_edges,
            CASE 
                WHEN COUNT(*) > 0 THEN (SELECT COUNT(*)::float FROM %I.routing_edges) / COUNT(*)::float
                ELSE 0.0
            END as avg_edges_per_node
        FROM %I.routing_nodes
    ', staging_schema, staging_schema, staging_schema);
END;
$$ LANGUAGE plpgsql;

-- Function to validate intersection detection
CREATE OR REPLACE FUNCTION validate_intersection_detection(
    staging_schema text
) RETURNS TABLE(
    validation_type text,
    status text,
    details text
) AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Node Count'' as validation_type,
            CASE 
                WHEN COUNT(*) > 0 THEN ''PASS''
                ELSE ''FAIL''
            END as status,
            ''Found '' || COUNT(*) || '' routing nodes'' as details
        FROM %I.routing_nodes
        UNION ALL
        SELECT 
            ''Edge Count'' as validation_type,
            CASE 
                WHEN COUNT(*) > 0 THEN ''PASS''
                ELSE ''FAIL''
            END as status,
            ''Found '' || COUNT(*) || '' routing edges'' as details
        FROM %I.routing_edges
        UNION ALL
        SELECT 
            ''Edge-to-Node Ratio'' as validation_type,
            CASE 
                WHEN COUNT(*) > 0 AND (SELECT COUNT(*) FROM %I.routing_edges)::float / COUNT(*)::float < 2.0 THEN ''PASS''
                ELSE ''FAIL''
            END as status,
            ''Ratio: '' || (SELECT COUNT(*) FROM %I.routing_edges)::float / COUNT(*)::float as details
        FROM %I.routing_nodes
    ', staging_schema, staging_schema, staging_schema, staging_schema, staging_schema);
END;
$$ LANGUAGE plpgsql;

-- Function to validate spatial data integrity
CREATE OR REPLACE FUNCTION validate_spatial_data_integrity(
    staging_schema text
) RETURNS TABLE(
    validation_type text,
    status text,
    details text
) AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Valid Geometries'' as validation_type,
            CASE 
                WHEN COUNT(*) = 0 THEN ''PASS''
                ELSE ''FAIL''
            END as status,
            ''Found '' || COUNT(*) || '' invalid geometries'' as details
        FROM %I.trails
        WHERE geometry IS NOT NULL AND NOT ST_IsValid(geometry)
        UNION ALL
        SELECT 
            ''Non-Null Geometries'' as validation_type,
            CASE 
                WHEN COUNT(*) > 0 THEN ''PASS''
                ELSE ''FAIL''
            END as status,
            ''Found '' || COUNT(*) || '' trails with geometry'' as details
        FROM %I.trails
        WHERE geometry IS NOT NULL
        UNION ALL
        SELECT 
            ''Valid Node Geometries'' as validation_type,
            CASE 
                WHEN COUNT(*) = 0 THEN ''PASS''
                ELSE ''FAIL''
            END as status,
            ''Found '' || COUNT(*) || '' invalid node geometries'' as details
        FROM %I.routing_nodes
        WHERE geo2 IS NOT NULL AND NOT ST_IsValid(geo2)
    ', staging_schema, staging_schema, staging_schema);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SAMPLE TEST DATA
-- ============================================================================

-- Insert sample test data from the 'test' region
INSERT INTO trails (app_uuid, name, region, length_km, elevation_gain, elevation_loss, trail_type, surface) VALUES
('test-x-horizontal', 'Test X Horizontal', 'test', 0.2, 50, 0, 'path', 'dirt'),
('test-x-vertical', 'Test X Vertical', 'test', 0.2, 50, 0, 'path', 'dirt'),
('test-t-main', 'Test T Main', 'test', 0.3, 50, 0, 'path', 'dirt'),
('test-t-branch', 'Test T Branch', 'test', 0.2, 50, 0, 'path', 'dirt'),
('test-y-main', 'Test Y Main', 'test', 0.2, 50, 0, 'path', 'dirt')
ON CONFLICT (app_uuid) DO NOTHING;

-- Insert region metadata for test region
INSERT INTO region_metadata (region_name, trail_count) VALUES
('test', 5)
ON CONFLICT (region_name) DO UPDATE SET 
    trail_count = EXCLUDED.trail_count,
    updated_at = CURRENT_TIMESTAMP;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE trails IS 'Master trails table with 3D geo2 and elevation data';
COMMENT ON COLUMN trails.geo2 IS '3D LineString geo2 with elevation data (SRID: 4326)';
COMMENT ON COLUMN trails.elevation_gain IS 'Total elevation gain in meters';
COMMENT ON COLUMN trails.elevation_loss IS 'Total elevation loss in meters';
COMMENT ON COLUMN trails.length_km IS 'Trail length in kilometers';

COMMENT ON TABLE elevation_points IS 'Elevation data points from TIFF files';
COMMENT ON TABLE routing_nodes IS 'Intersection and endpoint nodes for routing';
COMMENT ON TABLE routing_edges IS 'Trail segments connecting routing nodes';
COMMENT ON TABLE route_recommendations IS 'GPX-based route recommendations'; 