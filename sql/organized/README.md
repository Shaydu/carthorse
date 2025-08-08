# Carthorse SQL Organization

This directory contains organized SQL files for the Carthorse project.

## Directory Structure

### /production
- **carthorse-production-schema.sql**: Complete production database schema with all functions

### /staging  
- **carthorse-staging-template.sql**: Template for staging schemas created during export

### /sqlite
- **carthorse-sqlite-schema-v13.sql**: SQLite export schema (v13)

### /functions
Legacy configurable SQL files were removed.

### /migrations
- Place database migration files here

## Usage

### Production Database Setup
```bash
psql -d carthorse_db -f production/carthorse-production-schema.sql
```

### SQLite Export Schema
The SQLite schema is automatically applied during export operations.

### Function Updates
Functions are managed via the orchestrator workflow; no manual SQL install required.

## Schema Summary

- **Production Functions**: 1,692 total (34 routing, 19 intersection, 11 utility, 2 carthorse)
- **PostGIS Functions**: 790 (spatial operations)
- **PgRouting Functions**: 344 (routing algorithms)
- **Tables**: 21 (production database)

Generated: 2025-07-31T20:31:01.746Z
