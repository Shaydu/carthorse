-- Working routing functions with YAML configuration

-- Function: generate_routing_nodes_native (OPTIMIZED VERSION)
-- Creates nodes only at actual trail intersections, not endpoints
-- Uses YAML configuration for tolerance (defaultIntersectionTolerance: 0.5m)
CREATE OR REPLACE FUNCTION generate_routing_nodes_native(staging_schema text, intersection_tolerance_meters real DEFAULT 0.5)
RETURNS TABLE(node_count integer, success boolean, message text) AS $$
DECLARE
    node_count_var integer := 0;
    tolerance_degrees real := intersection_tolerance_meters / 111000.0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Generate routing nodes only at actual trail intersections
    -- Only create nodes where trails actually connect to other trails
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
                name as connected_trails
            FROM trail_endpoints
            UNION ALL
            SELECT 
                app_uuid,
                name,
                end_point as point,
                end_elevation as elevation,
                name as connected_trails
            FROM trail_endpoints
        ),
        -- Find actual intersections where multiple trails connect
        intersection_points AS (
            SELECT 
                point,
                elevation,
                COUNT(DISTINCT app_uuid) as trail_count,
                STRING_AGG(DISTINCT name, ', ') as connected_trails
            FROM all_endpoints
            WHERE point IS NOT NULL
            GROUP BY point, elevation
            HAVING COUNT(DISTINCT app_uuid) > 1  -- Only points where multiple trails connect
        ),
        -- Cluster nearby intersection points
        clustered_intersections AS (
            SELECT 
                ST_Centroid(ST_Collect(point)) as intersection_point,
                AVG(elevation) as elevation,
                COUNT(*) as cluster_size,
                STRING_AGG(connected_trails, '; ') as connected_trails
            FROM intersection_points
            GROUP BY ST_SnapToGrid(point, %L)  -- Cluster points within tolerance
        )
        SELECT 
            ROW_NUMBER() OVER (ORDER BY ST_X(intersection_point), ST_Y(intersection_point)) as id,
            gen_random_uuid() as node_uuid,
            ST_Y(intersection_point) as lat,
            ST_X(intersection_point) as lng,
            elevation,
            'intersection' as node_type,
            connected_trails,
            NOW() as created_at
        FROM clustered_intersections
        WHERE intersection_point IS NOT NULL
        AND cluster_size >= 2  -- Only keep clusters with at least 2 trails
    $f$, staging_schema, staging_schema, tolerance_degrees);
    
    GET DIAGNOSTICS node_count_var = ROW_COUNT;
    
    RETURN QUERY SELECT 
        node_count_var,
        true as success,
        format('Generated %s routing nodes at actual intersections (routable only, tolerance: %s m)', node_count_var, intersection_tolerance_meters) as message;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing nodes generation: %s', SQLERRM) as message;
END;
$$ LANGUAGE plpgsql;

-- Function: generate_routing_edges_native (OPTIMIZED VERSION)
-- Creates edges based on actual trail geometry, with configurable tolerance for coordinate matching
-- Only creates edges between connected, routable nodes
-- Uses consistent tolerance with node generation (defaultEdgeTolerance: 0.5m)
CREATE OR REPLACE FUNCTION generate_routing_edges_native(staging_schema text, tolerance_meters real DEFAULT 0.5)
RETURNS TABLE(edge_count integer, success boolean, message text) AS $$
DECLARE
    edge_count_var integer := 0;
    node_count_var integer := 0;
    orphaned_count integer := 0;
    orphaned_edges_count integer := 0;
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
    
    -- Clean up orphaned nodes (nodes that have no edges)
    EXECUTE format($f$
        DELETE FROM %I.%I 
        WHERE id NOT IN (
            SELECT DISTINCT source FROM %I.%I 
            UNION 
            SELECT DISTINCT target FROM %I.%I
        )
    $f$, staging_schema, 'routing_nodes', staging_schema, 'routing_edges', staging_schema, 'routing_edges');
    
    GET DIAGNOSTICS orphaned_count = ROW_COUNT;
    
    -- Clean up orphaned edges (edges that point to non-existent nodes)
    EXECUTE format($f$
        DELETE FROM %I.%I 
        WHERE source NOT IN (SELECT id FROM %I.%I) 
        OR target NOT IN (SELECT id FROM %I.%I)
    $f$, staging_schema, 'routing_edges', staging_schema, 'routing_nodes', staging_schema, 'routing_nodes');
    
    GET DIAGNOSTICS orphaned_edges_count = ROW_COUNT;
    
    RETURN QUERY SELECT 
        edge_count_var,
        true as success,
        format('Generated %s routing edges from %s nodes, cleaned up %s orphaned nodes and %s orphaned edges (routable only, tolerance: %s m)', edge_count_var, node_count_var, orphaned_count, orphaned_edges_count, tolerance_meters) as message;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing edges generation: %s', SQLERRM) as message;
END;
$$ LANGUAGE plpgsql; 