# Tools Directory

This directory contains development and utility tools for the Carthorse project.

## Database Tools

- **`carthorse-master-db-builder.ts`** - Builds the master PostgreSQL database
- **`carthorse-osm-extract-reader.ts`** - Reads OSM data extracts
- **`carthorse-osm-postgres-loader.ts`** - Loads OSM data into PostgreSQL
- **`carthorse-postgres-atomic-insert.ts`** - Atomic trail insertion utility
- **`carthorse-sqlite-to-postgres-migrator.ts`** - Migrates data from SQLite to PostgreSQL
- **`carthorse-validate-database.ts`** - Validates database integrity

## Elevation Tools

- **`elevation-fallback.ts`** - Elevation data fallback processing
- **`fill-boulder-elevation.ts`** - Fills elevation data for Boulder trails
- **`carthorse-elevation-processor.ts`** - Processes elevation data
- **`carthorse-calculate-elevation-stats.js`** - Calculates elevation statistics
- **`carthorse-calculate-elevation-stats-3d.js`** - 3D elevation statistics
- **`carthorse-calculate-elevation-loss.js`** - Calculates elevation loss

## Data Processing Tools

- **`carthorse-deduplicate-trails.js`** - Removes duplicate trails
- **`carthorse-simple-trail-splitting.js`** - Splits trails at intersections
- **`carthorse-recalculate-trail-stats.js`** - Recalculates trail statistics
- **`carthorse-fetch-specific-trail.ts`** - Fetches specific trail data

## Analysis Tools

- **`carthorse-tiff-coverage-analyzer.js`** - Analyzes TIFF coverage
- **`carthorse-tiff-coverage-checker.js`** - Checks TIFF coverage
- **`carthorse-nuclear-reset.ts`** - Nuclear reset utility

## Test Tools

- **`test-osm-extract-reader.ts`** - Tests OSM extract reader
- **`test-osm-postgres-loader.ts`** - Tests OSM PostgreSQL loader
- **`update-boulder-elevation.ts`** - Updates Boulder elevation data

## Usage

Most tools can be run with Node.js:

```bash
# Build master database
npx ts-node tools/carthorse-master-db-builder.ts

# Validate database
npx ts-node tools/carthorse-validate-database.ts

# Process elevation data
npx ts-node tools/elevation-fallback.ts
```

## Requirements

- Node.js and npm
- TypeScript (for .ts files)
- PostgreSQL with PostGIS
- Access to elevation data sources 