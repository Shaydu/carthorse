#!/bin/bash
# Carthorse Database Installation Script
# Generated: 2025-07-31T20:31:01.747Z

set -e

echo "🚀 Installing Carthorse Database..."

# Check if database exists
if ! psql -lqt | cut -d \| -f 1 | grep -qw carthorse_db; then
    echo "📦 Creating database..."
    createdb carthorse_db
fi

echo "📋 Installing production schema..."
psql -d carthorse_db -f production/carthorse-production-schema.sql

echo "🔧 Installing function files..."
psql -d carthorse_db -f functions/carthorse-configurable-sql.sql
psql -d carthorse_db -f functions/recursive-route-finding-configurable.sql

echo "✅ Installation complete!"
echo "📊 Database: carthorse_db"
echo "📊 Schema: public"
echo "📊 Functions: 1,692 total"
