#!/bin/bash

# Route Recommendation Visualization Script
# This script helps visualize recommended routes from your staging schema

set -e

# Configuration
STAGING_SCHEMA=${1:-"boulder_staging"}
REGION=${2:-"boulder"}

echo "🗺️ Route Recommendation Visualization Tool"
echo "=========================================="
echo "Staging Schema: $STAGING_SCHEMA"
echo "Region: $REGION"
echo ""

# Check if staging schema exists
echo "🔍 Checking if staging schema exists..."
PGPASSWORD=$PGPASSWORD psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name = '$STAGING_SCHEMA';" | grep -q "$STAGING_SCHEMA" || {
    echo "❌ Error: Staging schema '$STAGING_SCHEMA' not found!"
    echo "Available schemas:"
    PGPASSWORD=$PGPASSWORD psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE '%staging%';"
    exit 1
}

# Check if route_recommendations table exists
echo "🔍 Checking if route_recommendations table exists..."
PGPASSWORD=$PGPASSWORD psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "SELECT COUNT(*) FROM $STAGING_SCHEMA.route_recommendations;" > /dev/null 2>&1 || {
    echo "❌ Error: route_recommendations table not found in $STAGING_SCHEMA!"
    echo "Available tables in $STAGING_SCHEMA:"
    PGPASSWORD=$PGPASSWORD psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "SELECT table_name FROM information_schema.tables WHERE table_schema = '$STAGING_SCHEMA';"
    exit 1
}

# Count route recommendations
ROUTE_COUNT=$(PGPASSWORD=$PGPASSWORD psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -t -c "SELECT COUNT(*) FROM $STAGING_SCHEMA.route_recommendations;")
echo "✅ Found $ROUTE_COUNT route recommendations"

# Run visualization tool
echo ""
echo "🎨 Generating visualization..."
STAGING_SCHEMA=$STAGING_SCHEMA node tools/route-visualization.js

echo ""
echo "🚀 Starting visualization server..."
cd tools/route-visualization-output && python3 -m http.server 8083 &
SERVER_PID=$!

echo ""
echo "✅ Visualization ready!"
echo "🌐 Open your browser to: http://localhost:8083"
echo ""
echo "📊 Features:"
echo "   • Interactive map with recommended routes"
echo "   • Route filtering by score, distance, elevation"
echo "   • Trail and routing graph overlay"
echo "   • Detailed popups with route information"
echo "   • Route selection and highlighting"
echo ""
echo "🛑 To stop the server: kill $SERVER_PID"
echo "📁 Output files: tools/route-visualization-output/" 