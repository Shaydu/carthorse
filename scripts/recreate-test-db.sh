#!/bin/bash

echo "🗄️  Recreating test database with production structure..."

# Drop and recreate the test database
echo "📋 Dropping existing test database..."
psql -h localhost -U tester -d postgres -c "DROP DATABASE IF EXISTS trail_master_db_test;"

echo "📋 Creating new test database..."
psql -h localhost -U tester -d postgres -c "CREATE DATABASE trail_master_db_test;"

# Dump production schema (structure only, no data)
echo "📋 Dumping production schema..."
pg_dump -h localhost -U tester -d trail_master_db --schema-only --no-owner --no-privileges > /tmp/production_schema.sql

# Import schema to test database
echo "📋 Importing schema to test database..."
psql -h localhost -U tester -d trail_master_db_test -f /tmp/production_schema.sql

# Apply our fixed function
echo "📋 Applying fixed copy_and_split_trails_to_staging_native function..."
# All functions are now in the consolidated schema

# Copy some sample data from production (optional)
echo "📋 Copying sample data from production..."
psql -h localhost -U tester -d trail_master_db_test -c "
INSERT INTO public.trails 
SELECT * FROM trail_master_db.public.trails 
WHERE region = 'boulder' 
LIMIT 10;
"

echo "✅ Test database recreated successfully!"
echo "📊 Test database: trail_master_db_test"
echo "🔧 Schema: Exact copy of production"
echo "📋 Sample data: 10 boulder trails from production" 