#!/bin/bash

# Setup Test Database from Production Script
# This script creates a fresh test database with production schema and 10% of production data

set -e

echo "🔄 Setting up test database from production..."

# Check if we're connected to the test database
if [ "$PGDATABASE" != "trail_master_db_test" ]; then
    echo "⚠️  WARNING: Not connected to test database!"
    echo "   Current database: $PGDATABASE"
    echo "   Expected: trail_master_db_test"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "📊 Production database state:"
psql -d trail_master_db -c "
SELECT 
    COUNT(*) as total_trails,
    COUNT(CASE WHEN elevation_gain IS NOT NULL THEN 1 END) as trails_with_gain,
    COUNT(CASE WHEN ST_NDims(geometry) = 3 THEN 1 END) as trails_with_3d,
    COUNT(CASE WHEN region = 'boulder' THEN 1 END) as boulder_trails,
    COUNT(CASE WHEN region = 'seattle' THEN 1 END) as seattle_trails
FROM trails;
"

echo ""
echo "🗑️  Dropping existing test database..."
dropdb --if-exists trail_master_db_test

echo "🔄 Creating fresh test database..."
createdb trail_master_db_test

echo "🗺️  Enabling PostGIS extensions..."
psql -d trail_master_db_test -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -d trail_master_db_test -c "CREATE EXTENSION IF NOT EXISTS postgis_topology;"
psql -d trail_master_db_test -c "CREATE EXTENSION IF NOT EXISTS postgis_raster;"
psql -d trail_master_db_test -c "CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;"

echo "📋 Copying production schema..."
pg_dump -d trail_master_db --schema-only --no-owner --no-privileges | psql -d trail_master_db_test

echo "🔧 Setting up test user permissions..."
psql -d trail_master_db_test -c "GRANT ALL PRIVILEGES ON DATABASE trail_master_db_test TO tester;"
psql -d trail_master_db_test -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO tester;"
psql -d trail_master_db_test -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO tester;"
psql -d trail_master_db_test -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO tester;"
psql -d trail_master_db_test -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO tester;"

echo "📊 Copying regions table first..."
psql -d trail_master_db -c "COPY regions TO STDOUT WITH CSV HEADER;" | psql -d trail_master_db_test -c "COPY regions FROM STDIN WITH CSV HEADER;"

echo "📊 Sampling 10% of production data..."
# Get a random 10% sample of trails from production
psql -d trail_master_db -c "
COPY (
    SELECT 
        id, app_uuid, osm_id, source, name, trail_type, surface, difficulty,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        length_km, source_tags, created_at, updated_at,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        region, geometry
    FROM trails 
    WHERE random() < 0.1
    ORDER BY region, name
) TO STDOUT WITH CSV HEADER;
" | psql -d trail_master_db_test -c "
COPY trails (
    id, app_uuid, osm_id, source, name, trail_type, surface, difficulty,
    elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
    length_km, source_tags, created_at, updated_at,
    bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
    region, geometry
) FROM STDIN WITH CSV HEADER;
"

echo "📊 Copying routing tables (if they exist)..."
# Check if routing tables exist in production and copy them
if psql -d trail_master_db -c "\dt routing_nodes" >/dev/null 2>&1; then
    echo "   Copying routing_nodes..."
    psql -d trail_master_db -c "COPY routing_nodes TO STDOUT WITH CSV HEADER;" | psql -d trail_master_db_test -c "COPY routing_nodes FROM STDIN WITH CSV HEADER;" || echo "   No routing_nodes data to copy"
fi

if psql -d trail_master_db -c "\dt routing_edges" >/dev/null 2>&1; then
    echo "   Copying routing_edges..."
    psql -d trail_master_db -c "COPY routing_edges TO STDOUT WITH CSV HEADER;" | psql -d trail_master_db_test -c "COPY routing_edges FROM STDIN WITH CSV HEADER;" || echo "   No routing_edges data to copy"
fi

echo ""
echo "📊 Final test database state:"
psql -d trail_master_db_test -c "
SELECT 
    COUNT(*) as total_trails,
    COUNT(CASE WHEN elevation_gain IS NOT NULL THEN 1 END) as trails_with_gain,
    COUNT(CASE WHEN ST_NDims(geometry) = 3 THEN 1 END) as trails_with_3d,
    COUNT(CASE WHEN region = 'boulder' THEN 1 END) as boulder_trails,
    COUNT(CASE WHEN region = 'seattle' THEN 1 END) as seattle_trails,
    COUNT(CASE WHEN name LIKE 'Test Trail%' THEN 1 END) as test_trails
FROM trails;
"

echo ""
echo "🧪 Adding controlled test scenarios for edge case testing..."
# Add a few controlled test scenarios for testing edge cases
psql -d trail_master_db_test -c "
INSERT INTO trails (
    app_uuid, name, region, osm_id, trail_type, surface, difficulty,
    elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
    length_km, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
    geometry, source_tags, created_at, updated_at
) VALUES 
-- Trail with missing elevation data
(
    'test-missing-elevation-$(date +%s)', 
    'Test Trail Missing Elevation', 
    'boulder', 
    'test-123456789', 
    'hiking', 
    'dirt', 
    'moderate',
    NULL, NULL, NULL, NULL, NULL,
    2.5, -105.2705, -105.2706, 40.0150, 40.0151,
    ST_GeomFromText('LINESTRING Z (-105.2705 40.0150 1800, -105.2706 40.0151 1820)', 4326),
    '{\"highway\": \"path\"}',
    NOW(), NOW()
),
-- Trail with partial elevation data
(
    'test-partial-elevation-$(date +%s)', 
    'Test Trail Partial Elevation', 
    'boulder', 
    'test-123456790', 
    'hiking', 
    'dirt', 
    'moderate',
    100, NULL, 2000, 1900, 1950,
    2.5, -105.2705, -105.2706, 40.0150, 40.0151,
    ST_GeomFromText('LINESTRING Z (-105.2705 40.0150 1900, -105.2706 40.0151 2000)', 4326),
    '{\"highway\": \"path\"}',
    NOW(), NOW()
),
-- Trail with perfect elevation data
(
    'test-perfect-elevation-$(date +%s)', 
    'Test Trail Perfect Elevation', 
    'boulder', 
    'test-123456791', 
    'hiking', 
    'dirt', 
    'moderate',
    150, 50, 2000, 1850, 1925,
    2.5, -105.2705, -105.2706, 40.0150, 40.0151,
    ST_GeomFromText('LINESTRING Z (-105.2705 40.0150 1850, -105.2706 40.0151 2000)', 4326),
    '{\"highway\": \"path\"}',
    NOW(), NOW()
);
"

echo ""
echo "📊 Final test database summary:"
psql -d trail_master_db_test -c "
SELECT 
    COUNT(*) as total_trails,
    COUNT(CASE WHEN name LIKE 'Test Trail%' THEN 1 END) as test_trails,
    COUNT(CASE WHEN name NOT LIKE 'Test Trail%' THEN 1 END) as real_trails,
    COUNT(CASE WHEN elevation_gain IS NULL AND elevation_loss IS NULL AND max_elevation IS NULL AND min_elevation IS NULL AND avg_elevation IS NULL THEN 1 END) as missing_elevation,
    COUNT(CASE WHEN ST_NDims(geometry) = 3 THEN 1 END) as three_d_geometry
FROM trails;
"

echo ""
echo "✅ Test database setup complete!"
echo "   - Fresh schema from production"
echo "   - 10% sample of production data"
echo "   - Controlled test scenarios added"
echo "   - Ready for fast test execution"
echo ""
echo "🚀 Test database is now ready for testing!" 