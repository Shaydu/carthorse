-- Fix the routing function to use correct column names
-- The test creates routing_edges with 'geometry' column, not 'geom'

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

COMMENT ON FUNCTION generate_routing_edges_native(text, real) IS 'Updated to use correct column names (geometry instead of geom)'; 