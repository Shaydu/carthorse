#!/bin/bash

# ============================================================================
# CARTHORSE CURRENT ORCHESTRATOR FUNCTION RELOAD SCRIPT
# ============================================================================
# This script drops and reloads ONLY the functions that the current orchestrator
# actually uses, based on code path analysis.
#
# Functions included:
# - detect_trail_intersections (used in routing queries)
# - build_routing_nodes (used in staging schema setup)
# - build_routing_edges (used in staging schema setup)
#
# Functions NOT included (not used by current orchestrator):
# - get_intersection_stats (statistics only)
# - validate_intersection_detection (validation only)
# - validate_spatial_data_integrity (validation only)
# - check_database_integrity (validation only)
# ============================================================================

set -e

# Configuration
DB_NAME=${PGDATABASE:-trail_master_db}
DB_USER=${PGUSER:-postgres}
DB_HOST=${PGHOST:-localhost}
DB_PORT=${PGPORT:-5432}

echo "🔄 Reloading Carthorse current orchestrator functions..."
echo "📊 Database: $DB_NAME"
echo "👤 User: $DB_USER"
echo "🌐 Host: $DB_HOST:$DB_PORT"
echo ""

# Step 1: Drop existing functions (for idempotency)
echo "🗑️  Dropping existing functions..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF
-- Drop functions if they exist
DROP FUNCTION IF EXISTS detect_trail_intersections(text, text, float) CASCADE;
DROP FUNCTION IF EXISTS build_routing_nodes(text, text, float) CASCADE;
DROP FUNCTION IF EXISTS build_routing_edges(text, text) CASCADE;

-- Also drop any functions without explicit parameters (for safety)
DROP FUNCTION IF EXISTS detect_trail_intersections(text, text) CASCADE;
DROP FUNCTION IF EXISTS build_routing_nodes(text, text) CASCADE;
DROP FUNCTION IF EXISTS build_routing_edges(text, text) CASCADE;
EOF

echo "✅ Dropped existing functions"

# Step 2: Load new functions
echo "📥 Loading new functions..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f sql/carthorse-current-orchestrator-functions.sql

echo "✅ Loaded new functions"

# Step 3: Verify functions are installed
echo "🔍 Verifying functions are installed..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF
SELECT 
    proname as function_name,
    pg_get_function_arguments(oid) as arguments,
    pg_get_function_result(oid) as return_type
FROM pg_proc 
WHERE proname IN ('detect_trail_intersections', 'build_routing_nodes', 'build_routing_edges')
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY proname;
EOF

echo ""
echo "✅ Carthorse current orchestrator functions reloaded successfully!"
echo ""
echo "📋 Functions installed:"
echo "   - detect_trail_intersections (core intersection detection)"
echo "   - build_routing_nodes (staging schema routing nodes)"
echo "   - build_routing_edges (staging schema routing edges)"
echo ""
echo "🎯 These are the ONLY functions the current orchestrator actually uses."
echo "📊 Missing functions (not needed by current orchestrator):"
echo "   - get_intersection_stats (statistics only)"
echo "   - validate_intersection_detection (validation only)"
echo "   - validate_spatial_data_integrity (validation only)"
echo "   - check_database_integrity (validation only)" 