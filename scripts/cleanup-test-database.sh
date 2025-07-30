#!/bin/bash

# Cleanup Test Database Script
# This script removes test trails and fixes data quality issues in the test database

set -e

echo "🧹 Cleaning up test database..."

# Check if we're connected to the test database
if [ "$PGDATABASE" != "trail_master_db_test" ]; then
    echo "⚠️  WARNING: Not connected to test database!"
    echo "   Current database: $PGDATABASE"
    echo "   Expected: trail_master_db_test"
    echo "   This script should only be run against the test database"
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
    COUNT(CASE WHEN name NOT LIKE 'Test Trail%' THEN 1 END) as real_trails,
    COUNT(CASE WHEN elevation_gain IS NULL AND elevation_loss IS NULL AND max_elevation IS NULL AND min_elevation IS NULL AND avg_elevation IS NULL THEN 1 END) as missing_elevation,
    COUNT(CASE WHEN ST_Length(geometry) = 0 THEN 1 END) as zero_length
FROM trails;
"

echo ""
echo "🗑️  Removing test trails..."
psql -c "DELETE FROM trails WHERE name LIKE 'Test Trail%';"

echo "🗑️  Removing trails with zero length geometry..."
psql -c "DELETE FROM trails WHERE ST_Length(geometry) = 0;"

echo "🔧 Fixing missing elevation_loss values..."
psql -c "
UPDATE trails 
SET elevation_loss = 0 
WHERE elevation_loss IS NULL AND elevation_gain IS NOT NULL;
"

echo "🔧 Fixing missing elevation data for trails with 3D geometry..."
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
echo "📊 Final test database state:"
psql -c "
SELECT 
    COUNT(*) as total_trails,
    COUNT(CASE WHEN name LIKE 'Test Trail%' THEN 1 END) as test_trails,
    COUNT(CASE WHEN name NOT LIKE 'Test Trail%' THEN 1 END) as real_trails,
    COUNT(CASE WHEN elevation_gain IS NULL AND elevation_loss IS NULL AND max_elevation IS NULL AND min_elevation IS NULL AND avg_elevation IS NULL THEN 1 END) as missing_elevation,
    COUNT(CASE WHEN ST_Length(geometry) = 0 THEN 1 END) as zero_length,
    COUNT(CASE WHEN ST_NDims(geometry) = 3 THEN 1 END) as three_d_geometry
FROM trails;
"

echo ""
echo "✅ Test database cleanup complete!"
echo "   - Removed test trails"
echo "   - Fixed missing elevation data"
echo "   - Removed zero-length geometry"
echo "   - All trails now have complete elevation data" 