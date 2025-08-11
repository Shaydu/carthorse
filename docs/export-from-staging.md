# Export from Existing Staging Schema

This document explains how to export data from an existing staging schema to SQLite format without re-processing the data.

## Overview

When you run a Carthorse export, it typically:
1. Creates a new staging schema
2. Copies and processes trail data
3. Generates routing networks
4. Creates route recommendations
5. Exports to the target format

However, if you already have a staging schema with processed data, you can skip the data processing steps and export directly from the existing staging schema.

## Methods

### Method 1: Using the Main CLI (Recommended)

Add the `--staging-schema` option to your export command:

```bash
npx ts-node src/cli/export.ts \
  --region boulder \
  --out data/boulder-from-staging.db \
  --staging-schema staging_boulder_1234567890 \
  --format sqlite
```

### Method 2: Using the Dedicated Script

Use the dedicated export script for more control:

```bash
npx ts-node scripts/export-from-staging.ts \
  --staging-schema=staging_boulder_1234567890 \
  --region=boulder \
  --out=data/boulder-from-staging.db \
  --verbose
```

## Finding Existing Staging Schemas

To see what staging schemas exist in your database:

```sql
-- For test database
SELECT nspname as schema_name 
FROM pg_namespace 
WHERE nspname LIKE 'staging_%' 
ORDER BY nspname;

-- For production database
\c trail_master_db
SELECT nspname as schema_name 
FROM pg_namespace 
WHERE nspname LIKE 'staging_%' 
ORDER BY nspname;
```

## What Gets Exported

When exporting from an existing staging schema, the following data is exported:

- **Trails**: All trail data with geometry and metadata
- **Routing Nodes**: Network intersection points and endpoints
- **Routing Edges**: Connections between nodes for routing
- **Route Recommendations**: Pre-generated route suggestions (if available)

## Validation

The export process validates that the staging schema:
- Exists in the database
- Contains required tables (`trails`, `routing_nodes`, `routing_edges`)
- Has trail data (at least one trail)

## Benefits

- **Faster**: Skip data processing and network generation
- **Consistent**: Use the same processed data for multiple exports
- **Efficient**: Avoid re-computing expensive operations
- **Flexible**: Export to different formats from the same staging data

## Example Workflow

1. **Create staging schema with full processing**:
   ```bash
   npx ts-node src/cli/export.ts --region boulder --out data/boulder-full.db
   ```

2. **Export to different formats from the same staging**:
   ```bash
   # Export to SQLite
   npx ts-node src/cli/export.ts \
     --region boulder \
     --out data/boulder-sqlite.db \
     --staging-schema staging_boulder_1234567890 \
     --format sqlite
   
   # Export to GeoJSON
   npx ts-node src/cli/export.ts \
     --region boulder \
     --out data/boulder-geojson.json \
     --staging-schema staging_boulder_1234567890 \
     --format geojson
   ```

## Notes

- The staging schema must contain fully processed data (trails, nodes, edges)
- Route recommendations will only be exported if they exist in the staging schema
- The `--no-cleanup` option is useful when you want to keep the staging schema for multiple exports
- Staging schemas are automatically cleaned up after export unless `--no-cleanup` is specified
