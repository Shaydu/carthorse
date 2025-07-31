#!/bin/bash

# Carthorse Database Recreation Script
# This script recreates the database from scratch using the complete schema

set -e

# Configuration
DB_NAME="trail_master_db"
DB_USER="tester"
DB_HOST="localhost"
SCHEMA_FILE="sql/schemas/carthorse-complete-schema.sql"

echo "🗄️  Recreating Carthorse database..."

# Drop existing database if it exists
echo "📋 Dropping existing database..."
psql -h $DB_HOST -U $DB_USER -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;" || true

# Create new database
echo "📋 Creating new database..."
psql -h $DB_HOST -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME;"

# Apply complete schema
echo "📋 Applying complete schema..."
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f $SCHEMA_FILE

echo "✅ Database recreated successfully!"
echo "📊 Database contains:"
echo "   - $(grep -c 'CREATE TABLE' $SCHEMA_FILE) tables"
echo "   - $(grep -c 'CREATE FUNCTION' $SCHEMA_FILE) functions"
echo "   - $(grep -c 'CREATE INDEX' $SCHEMA_FILE) indexes"

echo ""
echo "🚀 Ready to use! You can now run exports and other operations." 