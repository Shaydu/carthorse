#!/bin/bash

# Setup script for CARTHORSE test user and test database
# This script creates the 'tester' user and the 'trail_master_db_test' database for safe test runs

set -e

TEST_USER="tester"
TEST_DB="trail_master_db_test"
TEST_PASSWORD="${PGPASSWORD:-}"  # Use PGPASSWORD if set, else blank

# Create the tester user if it does not exist
echo "🔍 Checking for test user '$TEST_USER'..."
USER_EXISTS=$(psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$TEST_USER'")
if [ "$USER_EXISTS" != "1" ]; then
  echo "👤 Creating user '$TEST_USER'..."
  createuser $TEST_USER --createdb --login || true
else
  echo "✅ User '$TEST_USER' already exists."
fi

# Set password for tester user (if provided)
if [ -n "$TEST_PASSWORD" ]; then
  echo "🔑 Setting password for user '$TEST_USER'..."
  psql -d postgres -c "ALTER USER $TEST_USER WITH PASSWORD '$TEST_PASSWORD';"
else
  echo "⚠️  No password set for user '$TEST_USER'."
fi

# Create the test database if it does not exist
echo "🔍 Checking for test database '$TEST_DB'..."
DB_EXISTS=$(psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$TEST_DB'")
if [ "$DB_EXISTS" != "1" ]; then
  echo "🗄️  Creating test database '$TEST_DB' owned by '$TEST_USER'..."
  createdb -O $TEST_USER $TEST_DB || true
else
  echo "✅ Test database '$TEST_DB' already exists."
fi

# Enable PostGIS and related extensions in the test database
DB_HOST="localhost"
DB_USER="$TEST_USER"
echo "🗺️  Enabling PostGIS and related extensions in test DB $TEST_DB..."
psql -h $DB_HOST -U $DB_USER -d $TEST_DB -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -h $DB_HOST -U $DB_USER -d $TEST_DB -c "CREATE EXTENSION IF NOT EXISTS postgis_topology;" || echo "(postgis_topology not available)"
psql -h $DB_HOST -U $DB_USER -d $TEST_DB -c "CREATE EXTENSION IF NOT EXISTS postgis_raster;" || echo "(postgis_raster not available)"
psql -h $DB_HOST -U $DB_USER -d $TEST_DB -c "CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;" || echo "(fuzzystrmatch not available)"
# Note: SpatiaLite is for SQLite, not PostgreSQL. If using SpatiaLite, enable extensions in SQLite setup scripts.

# Grant all privileges on test database to tester user
echo "🔏 Granting all privileges on '$TEST_DB' to '$TEST_USER'..."
psql -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE $TEST_DB TO $TEST_USER;"

echo "🎉 Test user and database setup complete!" 