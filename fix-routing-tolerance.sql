-- Fix Routing Tolerance Issues
-- This script updates the routing functions to use proper tolerance values
-- that match the configuration settings, preventing trail truncation

-- Update the generate_routing_edges_native function to use proper tolerance
CREATE OR REPLACE FUNCTION generate_routing_edges_native(staging_schema text, tolerance_meters real DEFAULT 50.0)
RETURNS TABLE(edge_count integer, success boolean, message text)
LANGUAGE plpgsql
AS $$
DECLARE
    edge_count_var integer := 0;
    node_count_var integer := 0;
    tolerance_degrees real := tolerance_meters / 111000.0;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Get node count for validation
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count_var;
    
    -- Generate routing edges from trail segments with proper tolerance
    EXECUTE format($f$
        INSERT INTO %I.routing_edges (source, target, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geometry, geojson)
        WITH elevation_calculated AS (
            -- Calculate elevation data from geometry using PostGIS function
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
            COALESCE(ec.calculated_elevation_gain, 0) as elevation_gain,
            COALESCE(ec.calculated_elevation_loss, 0) as elevation_loss,
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
          AND source_node.id <> target_node.id  -- Prevent self-loops
    $f$, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_degrees;
    
    GET DIAGNOSTICS edge_count_var = ROW_COUNT;
    
    -- Return results
    RETURN QUERY SELECT 
        edge_count_var,
        true as success,
        format('Successfully generated %s routing edges from %s nodes (tolerance: %s m)', edge_count_var, node_count_var, tolerance_meters) as message;
    
    RAISE NOTICE 'Generated % routing edges from % nodes (tolerance: % m)', edge_count_var, node_count_var, tolerance_meters;
        
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing edges generation: %s', SQLERRM) as message;
    
    RAISE NOTICE 'Error during routing edges generation: %', SQLERRM;
END;
$$;

-- Update the generate_routing_nodes_native function to use proper tolerance
CREATE OR REPLACE FUNCTION generate_routing_nodes_native(staging_schema text, intersection_tolerance_meters real DEFAULT 50.0)
RETURNS TABLE(node_count integer, success boolean, message text)
LANGUAGE plpgsql
AS $$
DECLARE
    node_count_var integer := 0;
    tolerance_degrees real := intersection_tolerance_meters / 111000.0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Generate routing nodes at trail intersections and endpoints
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, created_at)
        WITH intersection_points AS (
            -- Find actual intersections between trails
            SELECT DISTINCT
                ST_Intersection(t1.geometry, t2.geometry) as intersection_point,
                ST_Force3D(ST_Intersection(t1.geometry, t2.geometry)) as intersection_point_3d,
                ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
                ARRAY[t1.name, t2.name] as connected_trail_names,
                'intersection' as node_type,
                0.0 as distance_meters
            FROM %I.trails t1
            JOIN %I.trails t2 ON (
                t1.id < t2.id AND
                ST_Intersects(t1.geometry, t2.geometry) AND
                ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
            )
            WHERE t1.geometry IS NOT NULL 
              AND t2.geometry IS NOT NULL
              AND ST_IsValid(t1.geometry)
              AND ST_IsValid(t2.geometry)
              AND ST_Length(t1.geometry::geography) >= 0.1
              AND ST_Length(t2.geometry::geography) >= 0.1
        ),
        endpoint_points AS (
            -- Find trail endpoints
            SELECT DISTINCT
                ST_StartPoint(geometry) as endpoint_point,
                ST_Force3D(ST_StartPoint(geometry)) as endpoint_point_3d,
                ARRAY[app_uuid] as connected_trail_ids,
                ARRAY[name] as connected_trail_names,
                'endpoint' as node_type,
                0.0 as distance_meters
            FROM %I.trails
            WHERE geometry IS NOT NULL 
              AND ST_IsValid(geometry)
              AND ST_Length(geometry::geography) >= 0.1
            
            UNION ALL
            
            SELECT DISTINCT
                ST_EndPoint(geometry) as endpoint_point,
                ST_Force3D(ST_EndPoint(geometry)) as endpoint_point_3d,
                ARRAY[app_uuid] as connected_trail_ids,
                ARRAY[name] as connected_trail_names,
                'endpoint' as node_type,
                0.0 as distance_meters
            FROM %I.trails
            WHERE geometry IS NOT NULL 
              AND ST_IsValid(geometry)
              AND ST_Length(geometry::geography) >= 0.1
        ),
        all_points AS (
            SELECT 
                intersection_point as point,
                intersection_point_3d as point_3d,
                connected_trail_ids,
                connected_trail_names,
                node_type,
                distance_meters
            FROM intersection_points
            
            UNION ALL
            
            SELECT 
                endpoint_point as point,
                endpoint_point_3d as point_3d,
                connected_trail_ids,
                connected_trail_names,
                node_type,
                distance_meters
            FROM endpoint_points
        ),
        clustered_points AS (
            -- Cluster nearby points to avoid duplicates
            SELECT 
                ST_Centroid(ST_Collect(point)) as clustered_point,
                ST_Centroid(ST_Collect(point_3d)) as clustered_point_3d,
                array_agg(DISTINCT unnest(connected_trail_ids)) as all_trail_ids,
                array_agg(DISTINCT unnest(connected_trail_names)) as all_trail_names,
                CASE 
                    WHEN COUNT(*) > 1 THEN 'intersection'
                    ELSE MAX(node_type)
                END as node_type,
                AVG(distance_meters) as avg_distance
            FROM all_points
            GROUP BY ST_SnapToGrid(point, $1)  -- Cluster within tolerance
        )
        SELECT 
            ROW_NUMBER() OVER (ORDER BY ST_X(clustered_point), ST_Y(clustered_point)) as id,
            gen_random_uuid() as node_uuid,
            ST_Y(clustered_point) as lat,
            ST_X(clustered_point) as lng,
            ST_Z(clustered_point_3d) as elevation,
            node_type,
            array_to_string(all_trail_names, '; ') as connected_trails,
            NOW() as created_at
        FROM clustered_points
        WHERE clustered_point IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_degrees;
    
    GET DIAGNOSTICS node_count_var = ROW_COUNT;
    
    RETURN QUERY SELECT 
        node_count_var,
        true as success,
        format('Generated %s routing nodes (tolerance: %s m)', node_count_var, intersection_tolerance_meters) as message;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing nodes generation: %s', SQLERRM) as message;
END;
$$;

-- Update the generate_routing_graph function to use proper tolerances
CREATE OR REPLACE FUNCTION generate_routing_graph(staging_schema text DEFAULT 'staging_boulder')
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
AS $$
DECLARE
    node_result record;
    edge_result record;
    node_count integer := 0;
    edge_count integer := 0;
BEGIN
    -- Generate routing nodes with proper tolerance (50 meters)
    SELECT * INTO node_result FROM generate_routing_nodes_native(staging_schema, 50.0);
    
    IF NOT node_result.success THEN
        RETURN QUERY SELECT false, node_result.message;
        RETURN;
    END IF;
    
    node_count := node_result.node_count;
    
    -- Generate routing edges with proper tolerance (50 meters)
    SELECT * INTO edge_result FROM generate_routing_edges_native(staging_schema, 50.0);
    
    IF NOT edge_result.success THEN
        RETURN QUERY SELECT false, edge_result.message;
        RETURN;
    END IF;
    
    edge_count := edge_result.edge_count;
    
    -- Return success
    RETURN QUERY SELECT 
        true, 
        format('Successfully generated routing graph: %s nodes, %s edges', node_count, edge_count);
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT false, format('Error generating routing graph: %s', SQLERRM);
END;
$$;

-- Add a function to analyze connectivity issues
CREATE OR REPLACE FUNCTION analyze_routing_connectivity(staging_schema text DEFAULT 'staging_boulder')
RETURNS TABLE(
    total_trails integer,
    connected_trails integer,
    disconnected_trails integer,
    total_nodes integer,
    connected_nodes integer,
    orphaned_nodes integer,
    message text
)
LANGUAGE plpgsql
AS $$
DECLARE
    total_trails_var integer := 0;
    connected_trails_var integer := 0;
    disconnected_trails_var integer := 0;
    total_nodes_var integer := 0;
    connected_nodes_var integer := 0;
    orphaned_nodes_var integer := 0;
BEGIN
    -- Count total trails
    EXECUTE format('SELECT COUNT(*) FROM %I.trails WHERE geometry IS NOT NULL AND ST_IsValid(geometry)', staging_schema) INTO total_trails_var;
    
    -- Count trails that have edges
    EXECUTE format('SELECT COUNT(DISTINCT trail_id) FROM %I.routing_edges', staging_schema) INTO connected_trails_var;
    
    -- Calculate disconnected trails
    disconnected_trails_var := total_trails_var - connected_trails_var;
    
    -- Count total nodes
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO total_nodes_var;
    
    -- Count nodes that have edges
    EXECUTE format('
        SELECT COUNT(DISTINCT n.id) 
        FROM %I.routing_nodes n
        WHERE EXISTS (
            SELECT 1 FROM %I.routing_edges e 
            WHERE e.source = n.id OR e.target = n.id
        )
    ', staging_schema, staging_schema) INTO connected_nodes_var;
    
    -- Calculate orphaned nodes
    orphaned_nodes_var := total_nodes_var - connected_nodes_var;
    
    RETURN QUERY SELECT 
        total_trails_var,
        connected_trails_var,
        disconnected_trails_var,
        total_nodes_var,
        connected_nodes_var,
        orphaned_nodes_var,
        format('Connectivity analysis: %s/%s trails connected, %s/%s nodes connected', 
               connected_trails_var, total_trails_var, connected_nodes_var, total_nodes_var);
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, 0, 0, 0, 0, 0, 
        format('Error analyzing connectivity: %s', SQLERRM);
END;
$$;



