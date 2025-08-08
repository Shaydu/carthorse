-- Fix node classification logic to be based on edge count, not trail names
-- This addresses the fundamental issue where trail splitting creates unique names for each segment

-- Drop the old build_routing_nodes function
DROP FUNCTION IF EXISTS build_routing_nodes(text, text, double precision);

-- Create a new build_routing_nodes function that classifies nodes based on edge count
CREATE OR REPLACE FUNCTION build_routing_nodes(
    staging_schema text,
    trails_table text,
    intersection_tolerance_meters double precision DEFAULT 2.0
) RETURNS integer AS $$
DECLARE
    node_count integer;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Insert routing nodes with INITIAL classification (will be corrected later)
    EXECUTE format('
        INSERT INTO %I.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails)
        WITH noded_trails AS (
            -- Use ST_Node to split all trails at intersections (network topology)
            SELECT id, name, (ST_Dump(ST_Node(geometry))).geom as noded_geom
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        true_intersections AS (
            -- True geometric intersections (where two trails cross/touch)
            SELECT 
                (ST_Dump(ST_Intersection(t1.noded_geom, t2.noded_geom))).geom as intersection_point,
                ST_Force3D((ST_Dump(ST_Intersection(t1.noded_geom, t2.noded_geom))).geom) as intersection_point_3d,
                ARRAY[t1.id, t2.id] as connected_trail_ids,
                ARRAY[t1.name, t2.name] as connected_trail_names,
                ''intersection'' as node_type,
                0.0 as distance_meters
            FROM noded_trails t1
            JOIN noded_trails t2 ON (t1.id < t2.id)
            WHERE ST_Intersects(t1.noded_geom, t2.noded_geom)
              AND ST_GeometryType(ST_Intersection(t1.noded_geom, t2.noded_geom)) IN (''ST_Point'', ''ST_MultiPoint'')
        ),
        endpoint_near_miss AS (
            -- Find trail endpoints that are close to other trails (near-miss intersections)
            SELECT 
                ST_ClosestPoint(t1.noded_geom, t2.noded_geom) as intersection_point,
                ST_Force3D(ST_ClosestPoint(t1.noded_geom, t2.noded_geom)) as intersection_point_3d,
                ARRAY[t1.id, t2.id] as connected_trail_ids,
                ARRAY[t1.name, t2.name] as connected_trail_names,
                ''intersection'' as node_type,
                ST_Distance(t1.noded_geom, t2.noded_geom) as distance_meters
            FROM noded_trails t1
            JOIN noded_trails t2 ON (t1.id < t2.id)
            WHERE NOT ST_Intersects(t1.noded_geom, t2.noded_geom)
              AND ST_Distance(t1.noded_geom, t2.noded_geom) <= $1
        ),
        intersection_points AS (
            -- Combine true intersections and near-miss intersections
            SELECT * FROM true_intersections
            UNION ALL
            SELECT * FROM endpoint_near_miss
        ),
        trail_endpoints AS (
            -- Get start and end points of all trails
            SELECT 
                id,
                name,
                ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
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
                -- TEMPORARY classification (will be corrected after edge building)
                ''endpoint'' as node_type,
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
    
    RAISE NOTICE 'Generated % routing nodes with initial classification', node_count;
    
    RETURN node_count;
END;
$$ LANGUAGE plpgsql;

-- Function to correct node classification based on actual edge count
CREATE OR REPLACE FUNCTION correct_node_classification(staging_schema text) RETURNS integer AS $$
DECLARE
    updated_count integer := 0;
BEGIN
    -- Update node classification based on actual edge count
    EXECUTE format('
        UPDATE %I.routing_nodes 
        SET node_type = CASE 
            WHEN edge_count = 1 THEN ''endpoint''
            WHEN edge_count >= 2 THEN ''intersection''
            ELSE node_type
        END
        FROM (
            SELECT n.id, COUNT(e.id) as edge_count
            FROM %I.routing_nodes n
            LEFT JOIN %I.routing_edges e ON n.id = e.source OR n.id = e.target
            GROUP BY n.id
        ) connectivity
        WHERE %I.routing_nodes.id = connectivity.id
    ', staging_schema, staging_schema, staging_schema, staging_schema);
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Corrected classification for % nodes based on edge count', updated_count;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Enhanced build_routing_edges function that calls classification correction
CREATE OR REPLACE FUNCTION build_routing_edges(
    staging_schema text,
    trails_table text
) RETURNS integer AS $$
DECLARE
    edge_count integer;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Build routing edges (existing logic)
    EXECUTE format('
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, elevation_loss)
        WITH trail_segments AS (
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
            SELECT 
                id,
                app_uuid,
                name,
                geometry,
                length_km,
                COALESCE(elevation_gain, 0) as elevation_gain,
                COALESCE(elevation_loss, 0) as elevation_loss,
                start_point,
                end_point
            FROM trail_segments
        ),
        node_connections AS (
            -- Find which nodes connect to which trail segments
            SELECT 
                n.id as node_id,
                t.id as trail_id,
                t.name as trail_name,
                t.length_km,
                t.elevation_gain,
                t.elevation_loss,
                CASE 
                    WHEN ST_DWithin(n.geometry, t.start_point, 0.001) THEN ''start''
                    WHEN ST_DWithin(n.geometry, t.end_point, 0.001) THEN ''end''
                    ELSE ''middle''
                END as connection_type
            FROM %I.routing_nodes n
            CROSS JOIN elevation_calculated t
            WHERE ST_DWithin(n.geometry, t.geometry, 0.001)
        ),
        edge_pairs AS (
            -- Create edges between nodes that share the same trail
            SELECT DISTINCT
                nc1.node_id as from_node_id,
                nc2.node_id as to_node_id,
                nc1.trail_id,
                nc1.trail_name,
                nc1.length_km,
                nc1.elevation_gain,
                nc1.elevation_loss
            FROM node_connections nc1
            JOIN node_connections nc2 ON nc1.trail_id = nc2.trail_id AND nc1.node_id < nc2.node_id
        )
        SELECT 
            from_node_id,
            to_node_id,
            trail_id,
            trail_name,
            length_km,
            elevation_gain,
            elevation_loss
        FROM edge_pairs
    ', staging_schema, staging_schema, trails_table, staging_schema);
    
    GET DIAGNOSTICS edge_count = ROW_COUNT;
    RAISE NOTICE 'Generated % routing edges', edge_count;
    
    -- NOW CORRECT THE NODE CLASSIFICATION BASED ON ACTUAL EDGE COUNT
    PERFORM correct_node_classification(staging_schema);
    
    RETURN edge_count;
END;
$$ LANGUAGE plpgsql; 