-- Import sampled trail data from CSV files
-- This script imports the 30% sampled data from production

-- Import Boulder trails
\copy trails (app_uuid, name, region, osm_id, trail_type, surface, difficulty, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, length_km, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, geometry, source_tags, created_at, updated_at) FROM '/tmp/boulder_trails_sample.csv' WITH (FORMAT csv, HEADER, FORCE_NULL (elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation));

-- Import Seattle trails  
\copy trails (app_uuid, name, region, osm_id, trail_type, surface, difficulty, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, length_km, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, geometry, source_tags, created_at, updated_at) FROM '/tmp/seattle_trails_sample.csv' WITH (FORMAT csv, HEADER, FORCE_NULL (elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation));

-- Refresh the GeoJSON materialized view
REFRESH MATERIALIZED VIEW trails_boulder_geojson;

-- Show summary
SELECT 
    region,
    COUNT(*) as trail_count,
    COUNT(CASE WHEN elevation_gain IS NOT NULL THEN 1 END) as trails_with_elevation,
    COUNT(CASE WHEN elevation_gain IS NULL THEN 1 END) as trails_without_elevation,
    ROUND(AVG(length_km), 2) as avg_length_km,
    ROUND(AVG(elevation_gain), 2) as avg_elevation_gain
FROM trails 
WHERE region IN ('boulder', 'seattle')
GROUP BY region
ORDER BY trail_count DESC; 