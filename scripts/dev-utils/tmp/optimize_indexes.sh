#!/bin/bash
# Optimize indexes on trails, routing_nodes, and routing_edges tables
# Usage: ./optimize_indexes.sh [database_name]
# Example: ./optimize_indexes.sh trail_master_db_test
# NOTE: Review this script and test on a non-production database before running on production!

set -euo pipefail

DB_NAME="${1:-trail_master_db_test}"

# Step 1: List indexes before optimization
echo "[Before] Indexes on trails, routing_nodes, routing_edges:"
psql "$DB_NAME" -c "\di+ public.trails* public.routing_nodes* public.routing_edges*"

# Step 2: Drop redundant/duplicate indexes (safe to run multiple times)
echo "[Step 2] Dropping redundant/duplicate indexes..."
psql "$DB_NAME" <<'EOSQL'
-- Trails table: keep only one spatial index and one btree per key
DROP INDEX IF EXISTS idx_trails_geom;
DROP INDEX IF EXISTS idx_trails_geom_spatial;
DROP INDEX IF EXISTS idx_trails_geometry_spatial;
-- Keep idx_trails_geometry (GIST) and btree indexes on app_uuid, osm_id, region, surface, type
-- Routing nodes: keep only one spatial index
DROP INDEX IF EXISTS idx_routing_nodes_geometry_spatial;
DROP INDEX IF EXISTS idx_routing_nodes_location;
-- Keep only one GIST index on geometry if present
-- Routing edges: keep only one spatial index
DROP INDEX IF EXISTS idx_routing_edges_geometry;
DROP INDEX IF EXISTS idx_routing_edges_geometry_spatial;
-- Keep only one GIST index on geometry if present
EOSQL

# Step 3: List indexes after optimization
echo "[After] Indexes on trails, routing_nodes, routing_edges:"
psql "$DB_NAME" -c "\di+ public.trails* public.routing_nodes* public.routing_edges*"

echo "Index optimization complete. Review the before/after lists above." 