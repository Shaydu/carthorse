# Carthorse Package Installer Schemas

## Overview
This document contains the definitive schemas and functions required for the Carthorse package installer.

## PostgreSQL Schema
**File:** `carthorse-postgres-schema-clean.sql`
**Size:** 291KB
**Description:** Complete PostgreSQL schema with all required functions for:
- Trail data processing
- Routing graph generation
- Route recommendations
- Multi-region support

### Required Functions Confirmed Available:
- ✅ `generate_routing_nodes_native`
- ✅ `cleanup_orphaned_nodes`
- ✅ `generate_routing_edges_native` (wrapper around `build_routing_edges`)
- ✅ `cleanup_routing_graph`
- ✅ `copy_and_split_trails_to_staging_native`
- ✅ `test_route_finding`
- ✅ `generate_route_recommendations`
- ✅ `find_routes_recursive`

## SQLite Schema
**File:** `sql/schemas/carthorse-sqlite-schema-v13.sql`
**Version:** v13.0
**Description:** Definitive SQLite export schema with route recommendations support

### Key Features:
- Route type & shape enforcement
- Enhanced data type enforcement for recommendation engine filtering
- `trail_count` for route cardinality filtering
- `route_shape` column for route shape classification
- All v12 optimizations and deduplication maintained

### Route Classification Fields:
- `route_type`: Algorithm classification (exact_match, similar_distance, etc.)
- `route_shape`: Geometric classification (loop, out-and-back, lollipop, point-to-point)
- `trail_count`: Cardinality classification (number of unique trails used)

## Installation Instructions

### PostgreSQL Setup:
```bash
# Create database
createdb carthorse_db

# Install schema
psql -d carthorse_db -f carthorse-postgres-schema-clean.sql
```

### SQLite Export Schema:
The SQLite schema is automatically applied during export operations. No manual installation required.

## Route Recommendations Support

The schemas include full support for route recommendations:

1. **PostgreSQL Functions:**
   - Route finding algorithms
   - Recommendation generation
   - Route testing and validation

2. **SQLite Schema:**
   - Route recommendations table with all required fields
   - Proper indexing for efficient queries
   - Data validation constraints

## Data Integrity

All schemas include:
- Proper constraints and validation
- Elevation data requirements
- Spatial data integrity checks
- Route classification enforcement

## Version Compatibility

- **PostgreSQL:** Compatible with PostgreSQL 12+
- **SQLite:** Compatible with SQLite 3.30+
- **PostGIS:** Requires PostGIS 3.0+

## Testing

To verify installation:
```bash
# Test PostgreSQL functions
psql -d carthorse_db -c "SELECT routine_name FROM information_schema.routines WHERE routine_name LIKE '%routing%';"

# Test SQLite schema
sqlite3 test.db < sql/schemas/carthorse-sqlite-schema-v13.sql
``` 