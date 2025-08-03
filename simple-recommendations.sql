-- Simple route recommendations that work with trails directly
CREATE OR REPLACE FUNCTION generate_simple_route_recommendations(
    staging_schema text,
    bbox_min_lng float,
    bbox_min_lat float,
    bbox_max_lng float,
    bbox_max_lat float
) RETURNS integer AS $$
DECLARE
    route_count integer := 0;
    total_routes integer := 0;
BEGIN
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
    
    -- Generate simple route recommendations from trails within bbox
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
            gen_random_uuid()::text as route_uuid,
            ''boulder'' as region,
            length_km as input_distance_km,
            elevation_gain as input_elevation_gain,
            length_km as recommended_distance_km,
            elevation_gain as recommended_elevation_gain,
            ''single_trail'' as route_type,
            CASE 
                WHEN ST_StartPoint(geometry)::geometry <-> ST_EndPoint(geometry)::geometry < 0.001 THEN ''loop''
                ELSE ''point-to-point''
            END as route_shape,
            1 as trail_count,
            100 as route_score,
            ST_AsGeoJSON(geometry)::jsonb as route_path,
            json_build_array(app_uuid)::jsonb as route_edges,
            name || '' - '' || ROUND(length_km::numeric, 1) || ''km, '' || ROUND(elevation_gain::numeric) || ''m gain'' as route_name,
            NOW() as created_at
        FROM %I.trails 
        WHERE ST_Within(geometry, ST_MakeEnvelope(%L, %L, %L, %L, 4326))
          AND length_km >= 0.5
          AND length_km <= 20.0
          AND elevation_gain >= 0
          AND elevation_gain <= 1000
        ORDER BY length_km DESC
        LIMIT 50
    ', staging_schema, staging_schema, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat);
    
    GET DIAGNOSTICS route_count = ROW_COUNT;
    total_routes := total_routes + route_count;
    RAISE NOTICE 'Generated % single trail routes', route_count;
    
    -- Generate multi-trail route recommendations (combinations of nearby trails)
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
            gen_random_uuid()::text as route_uuid,
            ''boulder'' as region,
            (t1.length_km + t2.length_km) / 2 as input_distance_km,
            (t1.elevation_gain + t2.elevation_gain) / 2 as input_elevation_gain,
            t1.length_km + t2.length_km as recommended_distance_km,
            t1.elevation_gain + t2.elevation_gain as recommended_elevation_gain,
            ''multi_trail'' as route_type,
            ''point-to-point'' as route_shape,
            2 as trail_count,
            85 as route_score,
            ST_AsGeoJSON(ST_Union(t1.geometry, t2.geometry))::jsonb as route_path,
            json_build_array(t1.app_uuid, t2.app_uuid)::jsonb as route_edges,
            t1.name || '' + '' || t2.name || '' - '' || ROUND((t1.length_km + t2.length_km)::numeric, 1) || ''km, '' || ROUND((t1.elevation_gain + t2.elevation_gain)::numeric) || ''m gain'' as route_name,
            NOW() as created_at
        FROM %I.trails t1
        JOIN %I.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE ST_Within(t1.geometry, ST_MakeEnvelope(%L, %L, %L, %L, 4326))
          AND ST_Within(t2.geometry, ST_MakeEnvelope(%L, %L, %L, %L, 4326))
          AND ST_DWithin(t1.geometry, t2.geometry, 0.01)  -- Trails within ~1km of each other
          AND t1.length_km + t2.length_km >= 1.0
          AND t1.length_km + t2.length_km <= 15.0
          AND t1.elevation_gain + t2.elevation_gain >= 50
          AND t1.elevation_gain + t2.elevation_gain <= 800
        ORDER BY (t1.length_km + t2.length_km) DESC
        LIMIT 25
    ', staging_schema, staging_schema, staging_schema, 
       bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat,
       bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat);
    
    GET DIAGNOSTICS route_count = ROW_COUNT;
    total_routes := total_routes + route_count;
    RAISE NOTICE 'Generated % multi-trail routes', route_count;
    
    RETURN total_routes;
END;
$$ LANGUAGE plpgsql; 