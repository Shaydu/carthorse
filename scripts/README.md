<div align="left">
  <img src="../carthorse-logo-small.png" alt="Carthorse Logo" width="40" height="40">
</div>

# Scripts Directory

This directory contains utility scripts for the Carthorse project.

## Database Scripts

- **`create_test_database.sh`** - Creates the test PostgreSQL database with sample data
- **`create_test_database_advanced.sh`** - Advanced test database creation with more options
- **`carthorse-post-run-validation.sh`** - Validates database after processing

## Export Scripts

- **`test-sqlite-migration.sh`** - Comprehensive test suite for SQLite migration
- **`test-sqlite-export.js`** - Manual SQLite export testing
- **`export_bvr_geojson.sh`** - Exports Boulder Valley Ranch data as GeoJSON

## Usage

Most scripts can be run directly:

```bash
# Create test database
./scripts/create_test_database.sh

# Run SQLite migration tests
./scripts/test-sqlite-migration.sh

# Export GeoJSON
./scripts/export_bvr_geojson.sh
```

## Requirements

- PostgreSQL with PostGIS extension
- Node.js and npm
- SQLite3 (for some scripts) 