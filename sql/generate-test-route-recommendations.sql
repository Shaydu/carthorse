-- Generate Test Route Recommendations
-- This script creates sample route recommendations for visualization testing
-- Run this in your staging schema to populate the route_recommendations table

-- Example usage:
-- PGPASSWORD=your_password psql -h localhost -U postgres -d trail_master_db -f sql/generate-test-route-recommendations.sql

-- Set the staging schema (change this to match your schema)
\set staging_schema 'boulder_staging'

-- Generate sample route recommendations
INSERT INTO :staging_schema.route_recommendations (
    route_uuid,
    region,
    input_distance_km,
    input_elevation_gain,
    recommended_distance_km,
    recommended_elevation_gain,
    recommended_elevation_loss,
    route_score,
    route_type,
    route_shape,
    trail_count,
    route_path,
    route_edges,
    created_at
) 
SELECT 
    gen_random_uuid()::text as route_uuid,
    'boulder' as region,
    -- Input parameters (simulated user requests)
    CASE 
        WHEN i % 4 = 0 THEN 5.0  -- Short routes
        WHEN i % 4 = 1 THEN 10.0 -- Medium routes  
        WHEN i % 4 = 2 THEN 15.0 -- Long routes
        ELSE 20.0                 -- Very long routes
    END as input_distance_km,
    CASE 
        WHEN i % 3 = 0 THEN 200.0  -- Low elevation
        WHEN i % 3 = 1 THEN 500.0  -- Medium elevation
        ELSE 800.0                 -- High elevation
    END as input_elevation_gain,
    -- Recommended route parameters (simulated algorithm output)
    CASE 
        WHEN i % 4 = 0 THEN 4.8 + (random() * 0.4)   -- Close to target
        WHEN i % 4 = 1 THEN 9.5 + (random() * 1.0)   -- Close to target
        WHEN i % 4 = 2 THEN 14.2 + (random() * 1.6)  -- Close to target
        ELSE 19.1 + (random() * 2.0)                 -- Close to target
    END as recommended_distance_km,
    CASE 
        WHEN i % 3 = 0 THEN 180.0 + (random() * 40.0)   -- Close to target
        WHEN i % 3 = 1 THEN 480.0 + (random() * 40.0)   -- Close to target
        ELSE 750.0 + (random() * 100.0)                 -- Close to target
    END as recommended_elevation_gain,
    CASE 
        WHEN i % 3 = 0 THEN 150.0 + (random() * 30.0)
        WHEN i % 3 = 1 THEN 400.0 + (random() * 80.0)
        ELSE 650.0 + (random() * 100.0)
    END as recommended_elevation_loss,
    -- Route score (quality metric)
    CASE 
        WHEN i % 5 = 0 THEN 95.0 + (random() * 5.0)   -- Excellent
        WHEN i % 5 = 1 THEN 85.0 + (random() * 10.0)  -- Very good
        WHEN i % 5 = 2 THEN 75.0 + (random() * 10.0)  -- Good
        WHEN i % 5 = 3 THEN 65.0 + (random() * 10.0)  -- Fair
        ELSE 55.0 + (random() * 10.0)                 -- Poor
    END as route_score,
    -- Route type (algorithm classification)
    CASE 
        WHEN i % 4 = 0 THEN 'exact_match'
        WHEN i % 4 = 1 THEN 'similar_distance'
        WHEN i % 4 = 2 THEN 'similar_elevation'
        ELSE 'similar_profile'
    END as route_type,
    -- Route shape
    CASE 
        WHEN i % 4 = 0 THEN 'loop'
        WHEN i % 4 = 1 THEN 'out-and-back'
        WHEN i % 4 = 2 THEN 'lollipop'
        ELSE 'point-to-point'
    END as route_shape,
    -- Trail count
    CASE 
        WHEN i % 3 = 0 THEN 1
        WHEN i % 3 = 1 THEN 2 + (i % 3)
        ELSE 3 + (i % 4)
    END as trail_count,
    -- Sample route path (GeoJSON LineString)
    '{"type":"LineString","coordinates":[[-105.285,39.985],[-105.280,39.990],[-105.275,39.985],[-105.285,39.985]]}' as route_path,
    -- Sample route edges (JSON array)
    '[{"trail_id":"test_trail_1","distance_km":2.5,"elevation_gain":100},{"trail_id":"test_trail_2","distance_km":2.3,"elevation_gain":150}]' as route_edges,
    NOW() as created_at
FROM generate_series(1, 20) as i;

-- Display summary
SELECT 
    COUNT(*) as total_routes,
    AVG(recommended_distance_km) as avg_distance_km,
    AVG(recommended_elevation_gain) as avg_elevation_gain,
    AVG(route_score) as avg_score,
    COUNT(CASE WHEN route_shape = 'loop' THEN 1 END) as loop_routes,
    COUNT(CASE WHEN route_shape = 'out-and-back' THEN 1 END) as out_and_back_routes,
    COUNT(CASE WHEN route_shape = 'lollipop' THEN 1 END) as lollipop_routes,
    COUNT(CASE WHEN route_shape = 'point-to-point' THEN 1 END) as point_to_point_routes
FROM :staging_schema.route_recommendations;

-- Show sample routes
SELECT 
    id,
    route_uuid,
    input_distance_km,
    input_elevation_gain,
    recommended_distance_km,
    recommended_elevation_gain,
    route_score,
    route_type,
    route_shape,
    trail_count
FROM :staging_schema.route_recommendations
ORDER BY route_score DESC
LIMIT 5; 