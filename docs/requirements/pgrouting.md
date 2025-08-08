<div align="left">
  <img src="../../carthorse-logo-small.png" alt="Carthorse Logo" width="40" height="40">
</div>

# Carthorse pgRouting Integration Requirements

## Overview
- Carthorse must generate region SQLite databases with a robust routing graph using pgRouting.
- The export must use schema v8 for routing_nodes and routing_edges.

## Staging Table Workflow
- For each region export, create a dedicated staging schema (e.g., staging_<region>_<timestamp>).
- Copy raw trail data from the master DB into a split_trails table in staging.
- Run intersection detection and split trails at intersections in the staging table.

## pgRouting Integration
- Ensure the pgrouting extension is enabled in the PostgreSQL instance.
- On the split_trails table (with LINESTRING geometries), run:
  - `SELECT pgr_nodeNetwork('<staging_schema>.split_trails', 0.00005, 'id');`
  - This adds source and target node columns to each segment, creating split_trails_noded.

## Routing Graph Table Creation
- **routing_edges**:
  - Create from split_trails_noded.
  - Fields: id, source, target, trail_id, trail_name, elevation_gain, elevation_loss, is_bidirectional, geometry_wkt, and any additional needed fields.
- **routing_nodes**:
  - Create from unique source/target nodes in split_trails_noded.
  - Fields: node_id, lat, lng, elevation, node_type (intersection/endpoint), connected_trails, coordinate_wkt, etc.

## Export to SQLite
- Export routing_nodes and routing_edges to the region’s SQLite database using schema v8.
- Ensure all relevant fields are included and properly typed.
- Write schema version and description (e.g., version 8, “Gainiac Routing Graph v8: pgRouting nodes/edges schema”) to the schema_version table.

## Validation & Automation
- Validate that the exported SQLite database contains a complete, coherent routing graph (thousands of edges, correct node/edge references).
- Provide a test script or query to check node/edge counts and sample connectivity.
- Automate the entire process so a single command produces a ready-to-use <region>.db file.

## Assumptions & Constraints
- PostgreSQL instance must have PostGIS and pgRouting extensions enabled.
- All spatial operations must use SQL/PostGIS/pgRouting (no custom JS/TS geometry logic).
- Exported SQLite DB must be compatible with downstream UI and analytics tools. 