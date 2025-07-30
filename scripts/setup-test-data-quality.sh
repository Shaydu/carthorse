#!/bin/bash

# Setup Test Data Quality Script
# This script creates controlled test scenarios with known data quality issues
# for testing edge cases and validation logic

set -e

echo "🧪 Setting up test data quality scenarios..."

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

echo "📊 Current test database state:"
psql -c "
SELECT 
    COUNT(*) as total_trails,
    COUNT(CASE WHEN name LIKE 'Test Trail%' THEN 1 END) as test_trails,
    COUNT(CASE WHEN elevation_gain IS NULL AND elevation_loss IS NULL AND max_elevation IS NULL AND min_elevation IS NULL AND avg_elevation IS NULL THEN 1 END) as missing_elevation,
    COUNT(CASE WHEN ST_Length(geometry) = 0 THEN 1 END) as zero_length
FROM trails;
"

echo ""
echo "🧹 Cleaning up existing test data..."
psql -c "DELETE FROM trails WHERE name LIKE 'Test Trail%';"
psql -c "DELETE FROM trails WHERE ST_Length(geometry) = 0;"

echo ""
echo "🔧 Fixing real data quality issues..."
# Fix missing elevation_loss for real trails
psql -c "
UPDATE trails 
SET elevation_loss = 0 
WHERE elevation_loss IS NULL AND elevation_gain IS NOT NULL;
"

# Fix completely missing elevation for trails with 3D geometry
psql -c "
UPDATE trails 
SET 
    elevation_gain = 0,
    elevation_loss = 0,
    max_elevation = ST_Z(ST_PointN(geometry, 1)),
    min_elevation = ST_Z(ST_PointN(geometry, 1)),
    avg_elevation = ST_Z(ST_PointN(geometry, 1))
WHERE elevation_gain IS NULL 
  AND elevation_loss IS NULL 
  AND max_elevation IS NULL 
  AND min_elevation IS NULL 
  AND avg_elevation IS NULL
  AND ST_NDims(geometry) = 3;
"

echo ""
echo "🧪 Creating controlled test scenarios..."

# Scenario 1: Trail with completely missing elevation data (for testing validation)
psql -c "
INSERT INTO trails (
    app_uuid, name, region, osm_id, trail_type, surface, difficulty,
    elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
    length_km, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
    geometry, source_tags, created_at, updated_at
) VALUES (
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
);
"

# Scenario 2: Trail with partial elevation data (missing elevation_loss)
psql -c "
INSERT INTO trails (
    app_uuid, name, region, osm_id, trail_type, surface, difficulty,
    elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
    length_km, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
    geometry, source_tags, created_at, updated_at
) VALUES (
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
);
"

# Scenario 3: Trail with zero elevation values (for testing edge cases)
psql -c "
INSERT INTO trails (
    app_uuid, name, region, osm_id, trail_type, surface, difficulty,
    elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
    length_km, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
    geometry, source_tags, created_at, updated_at
) VALUES (
    'test-zero-elevation-$(date +%s)', 
    'Test Trail Zero Elevation', 
    'boulder', 
    'test-123456791', 
    'hiking', 
    'dirt', 
    'moderate',
    0, 0, 1800, 1800, 1800,
    2.5, -105.2705, -105.2706, 40.0150, 40.0151,
    ST_GeomFromText('LINESTRING Z (-105.2705 40.0150 1800, -105.2706 40.0151 1800)', 4326),
    '{\"highway\": \"path\"}',
    NOW(), NOW()
);
"

# Scenario 4: Trail with invalid elevation range (max < min)
psql -c "
INSERT INTO trails (
    app_uuid, name, region, osm_id, trail_type, surface, difficulty,
    elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
    length_km, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
    geometry, source_tags, created_at, updated_at
) VALUES (
    'test-invalid-range-$(date +%s)', 
    'Test Trail Invalid Range', 
    'boulder', 
    'test-123456792', 
    'hiking', 
    'dirt', 
    'moderate',
    100, 50, 1900, 2000, 1950,
    2.5, -105.2705, -105.2706, 40.0150, 40.0151,
    ST_GeomFromText('LINESTRING Z (-105.2705 40.0150 2000, -105.2706 40.0151 1900)', 4326),
    '{\"highway\": \"path\"}',
    NOW(), NOW()
);
"

# Scenario 5: Trail with perfect elevation data (for testing success cases)
psql -c "
INSERT INTO trails (
    app_uuid, name, region, osm_id, trail_type, surface, difficulty,
    elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
    length_km, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
    geometry, source_tags, created_at, updated_at
) VALUES (
    'test-perfect-elevation-$(date +%s)', 
    'Test Trail Perfect Elevation', 
    'boulder', 
    'test-123456793', 
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
echo "📊 Final test database state:"
psql -c "
SELECT 
    COUNT(*) as total_trails,
    COUNT(CASE WHEN name LIKE 'Test Trail%' THEN 1 END) as test_trails,
    COUNT(CASE WHEN name NOT LIKE 'Test Trail%' THEN 1 END) as real_trails,
    COUNT(CASE WHEN elevation_gain IS NULL AND elevation_loss IS NULL AND max_elevation IS NULL AND min_elevation IS NULL AND avg_elevation IS NULL THEN 1 END) as missing_elevation,
    COUNT(CASE WHEN elevation_gain = 0 AND elevation_loss = 0 AND max_elevation = 0 AND min_elevation = 0 AND avg_elevation = 0 THEN 1 END) as zero_elevation,
    COUNT(CASE WHEN max_elevation < min_elevation THEN 1 END) as invalid_range,
    COUNT(CASE WHEN ST_Length(geometry) = 0 THEN 1 END) as zero_length
FROM trails;
"

echo ""
echo "🧪 Test scenarios created:"
echo "   ✅ Test Trail Missing Elevation - Tests null elevation detection"
echo "   ✅ Test Trail Partial Elevation - Tests partial data handling"
echo "   ✅ Test Trail Zero Elevation - Tests zero value edge cases"
echo "   ✅ Test Trail Invalid Range - Tests invalid range detection"
echo "   ✅ Test Trail Perfect Elevation - Tests success case validation"
echo ""
echo "✅ Test data quality setup complete!"
echo "   - Real data cleaned and fixed"
echo "   - Controlled test scenarios added"
echo "   - Edge cases preserved for testing" 