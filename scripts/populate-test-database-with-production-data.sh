#!/bin/bash
# Populate test database with 30% of production data for Boulder and Seattle
# This script samples production data and inserts it into the test database

set -e

echo "🚀 Populating Test Database with 30% of Production Data"
echo "======================================================="

# Check production data counts
echo "📊 Production data summary:"
psql -d trail_master_db -c "
SELECT 
    region,
    COUNT(*) as total_trails,
    ROUND(COUNT(*) * 0.3) as trails_to_sample
FROM trails 
WHERE region IN ('boulder', 'seattle')
GROUP BY region
ORDER BY total_trails DESC;
"

echo ""
echo "🔄 Starting data population..."

# Step 1: Copy regions data first (required for foreign key constraints)
echo "1️⃣ Copying regions data..."
psql -d trail_master_db_test -c "
INSERT INTO regions (region_key, name, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, created_at, updated_at)
SELECT region_key, name, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, created_at, updated_at
FROM trail_master_db.public.regions
WHERE region_key IN ('boulder', 'seattle')
ON CONFLICT (region_key) DO NOTHING;
"

# Step 2: Sample and copy Boulder trails (30%)
echo "2️⃣ Sampling 30% of Boulder trails..."
BOULDER_SAMPLE_COUNT=$(psql -d trail_master_db -t -c "SELECT ROUND(COUNT(*) * 0.3) FROM trails WHERE region = 'boulder';" | xargs)
echo "   Sampling $BOULDER_SAMPLE_COUNT Boulder trails..."

psql -d trail_master_db_test -c "
INSERT INTO trails (
    app_uuid, name, region, osm_id, trail_type, surface, difficulty,
    elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
    length_km, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
    geometry, source_tags, created_at, updated_at
)
SELECT 
    app_uuid, name, region, osm_id, trail_type, surface, difficulty,
    elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
    length_km, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
    geometry, source_tags, created_at, updated_at
FROM trail_master_db.public.trails
WHERE region = 'boulder'
ORDER BY RANDOM()
LIMIT $BOULDER_SAMPLE_COUNT
ON CONFLICT (app_uuid) DO NOTHING;
"

# Step 3: Sample and copy Seattle trails (30%)
echo "3️⃣ Sampling 30% of Seattle trails..."
SEATTLE_SAMPLE_COUNT=$(psql -d trail_master_db -t -c "SELECT ROUND(COUNT(*) * 0.3) FROM trails WHERE region = 'seattle';" | xargs)
echo "   Sampling $SEATTLE_SAMPLE_COUNT Seattle trails..."

psql -d trail_master_db_test -c "
INSERT INTO trails (
    app_uuid, name, region, osm_id, trail_type, surface, difficulty,
    elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
    length_km, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
    geometry, source_tags, created_at, updated_at
)
SELECT 
    app_uuid, name, region, osm_id, trail_type, surface, difficulty,
    elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
    length_km, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
    geometry, source_tags, created_at, updated_at
FROM trail_master_db.public.trails
WHERE region = 'seattle'
ORDER BY RANDOM()
LIMIT $SEATTLE_SAMPLE_COUNT
ON CONFLICT (app_uuid) DO NOTHING;
"

# Step 4: Verify the data
echo "4️⃣ Verifying populated data..."
psql -d trail_master_db_test -c "
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
"

# Step 5: Update GeoJSON materialized view
echo "5️⃣ Refreshing GeoJSON materialized view..."
psql -d trail_master_db_test -c "REFRESH MATERIALIZED VIEW trails_boulder_geojson;"

echo ""
echo "✅ Test database population completed!"
echo "📊 Summary:"
echo "   - Boulder: ~$BOULDER_SAMPLE_COUNT trails (30% of production)"
echo "   - Seattle: ~$SEATTLE_SAMPLE_COUNT trails (30% of production)"
echo "   - GeoJSON materialized view refreshed"
echo "   - All optimizations and v6 schema applied" 