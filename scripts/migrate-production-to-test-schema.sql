-- Migration script to update production database to match test database
-- This will fix the 3D geometry handling and routing functions

-- Step 1: Update the generate_routing_edges_native function to handle 3D geometry properly
CREATE OR REPLACE FUNCTION generate_routing_edges_native(staging_schema text, tolerance_meters real DEFAULT 0.0001)
RETURNS TABLE(edge_count integer, success boolean, message text)
LANGUAGE plpgsql
AS $$
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
          AND source_node.id <> target_node.id  -- Prevent self-loops
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
$$;

-- Step 2: Update the generate_routing_nodes_native function to handle 3D geometry properly
CREATE OR REPLACE FUNCTION generate_routing_nodes_native(staging_schema text, tolerance_meters real DEFAULT 0.0001)
RETURNS TABLE(node_count integer, success boolean, message text)
LANGUAGE plpgsql
AS $$
DECLARE
    node_count_var integer := 0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Generate routing nodes from trail endpoints and intersections
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, created_at)
        WITH trail_endpoints AS (
            -- Get all trail start and end points with 3D coordinates
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
            -- Combine start and end points
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
            -- Find intersection points between trails
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
            -- Cluster nearby points using ST_ClusterWithin
            SELECT 
                ST_Centroid(ST_Collect(point)) as clustered_point,
                ST_Z(ST_Centroid(ST_Collect(point))) as elevation,
                COUNT(*) as point_count,
                STRING_AGG(DISTINCT app_uuid, ',' ORDER BY app_uuid) as connected_trails
            FROM all_points
            GROUP BY ST_ClusterWithin(point, $1)
        ),
        intersection_clusters AS (
            -- Cluster intersection points
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
$$;

-- Step 3: Add missing functions that might be needed
CREATE OR REPLACE FUNCTION recalculate_elevation_data(geometry geometry)
RETURNS TABLE(elevation_gain real, elevation_loss real)
LANGUAGE plpgsql
AS $$
DECLARE
    total_gain real := 0;
    total_loss real := 0;
    prev_elevation real;
    curr_elevation real;
    point_geom geometry;
BEGIN
    -- Extract elevation data from 3D geometry
    FOR i IN 1..ST_NPoints($1) LOOP
        point_geom := ST_PointN($1, i);
        curr_elevation := ST_Z(point_geom);
        
        IF i > 1 THEN
            IF curr_elevation > prev_elevation THEN
                total_gain := total_gain + (curr_elevation - prev_elevation);
            ELSIF curr_elevation < prev_elevation THEN
                total_loss := total_loss + (prev_elevation - curr_elevation);
            END IF;
        END IF;
        
        prev_elevation := curr_elevation;
    END LOOP;
    
    RETURN QUERY SELECT total_gain, total_loss;
END;
$$;

-- Step 4: Update any staging schema tables to use the correct structure
-- This will be done when creating new staging schemas

COMMENT ON FUNCTION generate_routing_edges_native(text, real) IS 'Updated to handle 3D geometry properly';
COMMENT ON FUNCTION generate_routing_nodes_native(text, real) IS 'Updated to handle 3D geometry properly';
COMMENT ON FUNCTION recalculate_elevation_data(geometry) IS 'Helper function to extract elevation data from 3D geometry'; 