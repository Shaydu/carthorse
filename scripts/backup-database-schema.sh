#!/bin/bash

# =====================================================
# CARTHORSE DATABASE SCHEMA BACKUP SCRIPT
# =====================================================
# This script creates comprehensive backups of all database schemas,
# functions, and provides recovery procedures for database corruption
# or deletion scenarios.

set -e

# Configuration
BACKUP_DIR="backups/database-schema-$(date +%Y%m%d_%H%M%S)"
TEST_DB="trail_master_db_test"
PROD_DB="trail_master_db"
DB_HOST="localhost"
DB_USER="tester"

echo "🗄️  CARTHORSE DATABASE SCHEMA BACKUP"
echo "======================================"
echo "Backup directory: $BACKUP_DIR"
echo "Test database: $TEST_DB"
echo "Production database: $PROD_DB"
echo ""

# Create backup directory
mkdir -p "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR/schemas"
mkdir -p "$BACKUP_DIR/functions"
mkdir -p "$BACKUP_DIR/migrations"
mkdir -p "$BACKUP_DIR/recovery"

echo "📁 Created backup directory structure"

# =====================================================
# BACKUP SCHEMAS
# =====================================================

echo ""
echo "📋 BACKING UP DATABASE SCHEMAS..."

# Backup test database schema
echo "  🔍 Test database schema..."
pg_dump -h $DB_HOST -U $DB_USER -d $TEST_DB --schema-only --no-owner --no-privileges > "$BACKUP_DIR/schemas/test_db_schema.sql"

# Backup production database schema
echo "  🔍 Production database schema..."
pg_dump -h $DB_HOST -U $DB_USER -d $PROD_DB --schema-only --no-owner --no-privileges > "$BACKUP_DIR/schemas/prod_db_schema.sql"

# =====================================================
# BACKUP CUSTOM FUNCTIONS
# =====================================================

echo ""
echo "🔧 BACKING UP CUSTOM FUNCTIONS..."

# Export all custom functions from test database
echo "  📝 Custom functions from test database..."
psql -h $DB_HOST -U $DB_USER -d $TEST_DB -c "
SELECT 
    'CREATE OR REPLACE FUNCTION ' || r.routine_name || '(' ||
    COALESCE(
        STRING_AGG(
            p.parameter_name || ' ' || p.data_type,
            ', ' ORDER BY p.ordinal_position
        ), ''
    ) || ') RETURNS ' || 
    CASE 
        WHEN r.routine_type = 'FUNCTION' THEN r.data_type
        ELSE 'TABLE(' || (
            SELECT STRING_AGG(column_name || ' ' || data_type, ', ')
            FROM information_schema.columns 
            WHERE table_name = r.routine_name
        ) || ')'
    END || ' AS \$\$' || r.routine_definition || '\$\$ LANGUAGE ' || 
    r.external_language || ';'
FROM information_schema.routines r
LEFT JOIN information_schema.parameters p ON r.routine_name = p.specific_name
WHERE r.routine_schema = 'public' 
  AND r.routine_name IN (
    'generate_app_uuid',
    'recalculate_elevation_data', 
    'copy_and_split_trails_to_staging_native',
    'detect_trail_intersections',
    'generate_routing_nodes_native',
    'generate_routing_edges_native',
    'validate_intersection_detection',
    'show_routing_summary',
    'validate_routing_edge_consistency',
    'validate_spatial_data_integrity',
    'validate_trail_completeness'
  )
GROUP BY r.routine_name, r.routine_type, r.data_type, r.external_language, r.routine_definition
ORDER BY r.routine_name;
" > "$BACKUP_DIR/functions/custom_functions_test.sql"

# Export all custom functions from production database
echo "  📝 Custom functions from production database..."
psql -h $DB_HOST -U $DB_USER -d $PROD_DB -c "
SELECT 
    'CREATE OR REPLACE FUNCTION ' || r.routine_name || '(' ||
    COALESCE(
        STRING_AGG(
            p.parameter_name || ' ' || p.data_type,
            ', ' ORDER BY p.ordinal_position
        ), ''
    ) || ') RETURNS ' || 
    CASE 
        WHEN r.routine_type = 'FUNCTION' THEN r.data_type
        ELSE 'TABLE(' || (
            SELECT STRING_AGG(column_name || ' ' || data_type, ', ')
            FROM information_schema.columns 
            WHERE table_name = r.routine_name
        ) || ')'
    END || ' AS \$\$' || r.routine_definition || '\$\$ LANGUAGE ' || 
    r.external_language || ';'
FROM information_schema.routines r
LEFT JOIN information_schema.parameters p ON r.routine_name = p.specific_name
WHERE r.routine_schema = 'public' 
  AND r.routine_name IN (
    'generate_app_uuid',
    'recalculate_elevation_data', 
    'copy_and_split_trails_to_staging_native',
    'detect_trail_intersections',
    'generate_routing_nodes_native',
    'generate_routing_edges_native',
    'validate_intersection_detection',
    'show_routing_summary',
    'validate_routing_edge_consistency',
    'validate_spatial_data_integrity',
    'validate_trail_completeness'
  )
GROUP BY r.routine_name, r.routine_type, r.data_type, r.external_language, r.routine_definition
ORDER BY r.routine_name;
" > "$BACKUP_DIR/functions/custom_functions_prod.sql"

# =====================================================
# BACKUP MIGRATIONS
# =====================================================

echo ""
echo "📦 BACKING UP MIGRATION FILES..."

# Copy all migration files
cp migrations/*.sql "$BACKUP_DIR/migrations/"

# =====================================================
# CREATE RECOVERY SCRIPTS
# =====================================================

echo ""
echo "🛠️  CREATING RECOVERY SCRIPTS..."

# Create recovery script for test database
cat > "$BACKUP_DIR/recovery/restore_test_db.sh" << 'EOF'
#!/bin/bash

# =====================================================
# CARTHORSE TEST DATABASE RECOVERY SCRIPT
# =====================================================

set -e

DB_HOST="localhost"
DB_USER="tester"
TEST_DB="trail_master_db_test"

echo "🔄 RESTORING TEST DATABASE SCHEMA AND FUNCTIONS..."

# Drop and recreate test database
echo "  🗑️  Dropping existing test database..."
dropdb -h $DB_HOST -U $DB_USER $TEST_DB 2>/dev/null || true

echo "  🆕 Creating fresh test database..."
createdb -h $DB_HOST -U $DB_USER $TEST_DB

# Enable PostGIS extensions
echo "  🗺️  Enabling PostGIS extensions..."
psql -h $DB_HOST -U $DB_USER -d $TEST_DB -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -h $DB_HOST -U $DB_USER -d $TEST_DB -c "CREATE EXTENSION IF NOT EXISTS postgis_topology;"
psql -h $DB_HOST -U $DB_USER -d $TEST_DB -c "CREATE EXTENSION IF NOT EXISTS postgis_raster;"
psql -h $DB_HOST -U $DB_USER -d $TEST_DB -c "CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;"
psql -h $DB_HOST -U $DB_USER -d $TEST_DB -c "CREATE EXTENSION IF NOT EXISTS pgrouting;"

# Restore schema
echo "  📋 Restoring database schema..."
psql -h $DB_HOST -U $DB_USER -d $TEST_DB -f schemas/test_db_schema.sql

# Restore custom functions
echo "  🔧 Restoring custom functions..."
psql -h $DB_HOST -U $DB_USER -d $TEST_DB -f functions/custom_functions_test.sql

echo "✅ Test database recovery complete!"
echo "   Database: $TEST_DB"
echo "   Host: $DB_HOST"
echo "   User: $DB_USER"
EOF

# Create recovery script for production database
cat > "$BACKUP_DIR/recovery/restore_prod_db.sh" << 'EOF'
#!/bin/bash

# =====================================================
# CARTHORSE PRODUCTION DATABASE RECOVERY SCRIPT
# =====================================================

set -e

DB_HOST="localhost"
DB_USER="tester"
PROD_DB="trail_master_db"

echo "🔄 RESTORING PRODUCTION DATABASE SCHEMA AND FUNCTIONS..."

# Drop and recreate production database
echo "  🗑️  Dropping existing production database..."
dropdb -h $DB_HOST -U $DB_USER $PROD_DB 2>/dev/null || true

echo "  🆕 Creating fresh production database..."
createdb -h $DB_HOST -U $DB_USER $PROD_DB

# Enable PostGIS extensions
echo "  🗺️  Enabling PostGIS extensions..."
psql -h $DB_HOST -U $DB_USER -d $PROD_DB -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -h $DB_HOST -U $DB_USER -d $PROD_DB -c "CREATE EXTENSION IF NOT EXISTS postgis_topology;"
psql -h $DB_HOST -U $DB_USER -d $PROD_DB -c "CREATE EXTENSION IF NOT EXISTS postgis_raster;"
psql -h $DB_HOST -U $DB_USER -d $PROD_DB -c "CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;"
psql -h $DB_HOST -U $DB_USER -d $PROD_DB -c "CREATE EXTENSION IF NOT EXISTS pgrouting;"

# Restore schema
echo "  📋 Restoring database schema..."
psql -h $DB_HOST -U $DB_USER -d $PROD_DB -f schemas/prod_db_schema.sql

# Restore custom functions
echo "  🔧 Restoring custom functions..."
psql -h $DB_HOST -U $DB_USER -d $PROD_DB -f functions/custom_functions_prod.sql

echo "✅ Production database recovery complete!"
echo "   Database: $PROD_DB"
echo "   Host: $DB_HOST"
echo "   User: $DB_USER"
EOF

# Create comprehensive recovery guide
cat > "$BACKUP_DIR/recovery/RECOVERY_GUIDE.md" << 'EOF'
# CARTHORSE DATABASE RECOVERY GUIDE

## Overview
This directory contains everything needed to recover the Carthorse database system from corruption or deletion.

## Quick Recovery Commands

### Test Database Recovery
```bash
cd recovery
chmod +x restore_test_db.sh
./restore_test_db.sh
```

### Production Database Recovery
```bash
cd recovery
chmod +x restore_prod_db.sh
./restore_prod_db.sh
```

## Manual Recovery Steps

### 1. Database Setup
```bash
# Create test database
createdb -h localhost -U tester trail_master_db_test

# Create production database
createdb -h localhost -U tester trail_master_db
```

### 2. Enable Extensions
```sql
-- Run on both databases
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS postgis_raster;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS pgrouting;
```

### 3. Apply Migrations
```bash
# Apply all migrations in order
psql -h localhost -U tester -d trail_master_db_test -f migrations/V1__initial_schema.sql
psql -h localhost -U tester -d trail_master_db_test -f migrations/V2__add_trail_splitting_support.sql
psql -h localhost -U tester -d trail_master_db_test -f migrations/V3__add_postgis_functions.sql
psql -h localhost -U tester -d trail_master_db_test -f migrations/V4__add_pgrouting_functions.sql
psql -h localhost -U tester -d trail_master_db_test -f migrations/V5__update_route_recommendations_schema.sql

# Repeat for production database
psql -h localhost -U tester -d trail_master_db -f migrations/V1__initial_schema.sql
psql -h localhost -U tester -d trail_master_db -f migrations/V2__add_trail_splitting_support.sql
psql -h localhost -U tester -d trail_master_db -f migrations/V3__add_postgis_functions.sql
psql -h localhost -U tester -d trail_master_db -f migrations/V4__add_pgrouting_functions.sql
psql -h localhost -U tester -d trail_master_db -f migrations/V5__update_route_recommendations_schema.sql
```

### 4. Verify Functions
```sql
-- Check that all custom functions exist
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name IN (
    'generate_app_uuid',
    'recalculate_elevation_data',
    'generate_routing_nodes_native',
    'generate_routing_edges_native',
    'detect_trail_intersections',
    'validate_intersection_detection'
  )
ORDER BY routine_name;
```

## Critical Functions

The following functions are essential for Carthorse operation:

- `generate_app_uuid()` - Generates UUIDs for new trails
- `recalculate_elevation_data()` - Calculates elevation from 3D geometry
- `generate_routing_nodes_native()` - Creates routing nodes from trail endpoints
- `generate_routing_edges_native()` - Creates routing edges from trail segments
- `detect_trail_intersections()` - Detects trail intersections
- `validate_intersection_detection()` - Validates intersection detection

## Backup Contents

- `schemas/` - Complete database schemas
- `functions/` - All custom PostgreSQL functions
- `migrations/` - All migration files
- `recovery/` - Recovery scripts and guides

## Verification

After recovery, run the test suite to verify everything works:

```bash
npm test
```

## Emergency Contacts

If recovery fails, check:
1. PostgreSQL service is running
2. User 'tester' has proper permissions
3. All extensions are installed
4. Migration files are in correct order
EOF

# Make recovery scripts executable
chmod +x "$BACKUP_DIR/recovery/restore_test_db.sh"
chmod +x "$BACKUP_DIR/recovery/restore_prod_db.sh"

# =====================================================
# CREATE BACKUP SUMMARY
# =====================================================

echo ""
echo "📊 CREATING BACKUP SUMMARY..."

# Create backup summary
cat > "$BACKUP_DIR/BACKUP_SUMMARY.md" << EOF
# CARTHORSE DATABASE BACKUP SUMMARY

**Backup Date:** $(date)
**Backup Directory:** $BACKUP_DIR

## Contents

### Schemas
- \`schemas/test_db_schema.sql\` - Test database schema
- \`schemas/prod_db_schema.sql\` - Production database schema

### Functions
- \`functions/custom_functions_test.sql\` - Custom functions from test database
- \`functions/custom_functions_prod.sql\` - Custom functions from production database

### Migrations
- \`migrations/\` - All migration files

### Recovery
- \`recovery/restore_test_db.sh\` - Test database recovery script
- \`recovery/restore_prod_db.sh\` - Production database recovery script
- \`recovery/RECOVERY_GUIDE.md\` - Comprehensive recovery guide

## Database Information

### Test Database
- **Name:** $TEST_DB
- **Host:** $DB_HOST
- **User:** $DB_USER
- **Functions:** $(psql -h $DB_HOST -U $DB_USER -d $TEST_DB -t -c "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public';" | tr -d ' ')

### Production Database
- **Name:** $PROD_DB
- **Host:** $DB_HOST
- **User:** $DB_USER
- **Functions:** $(psql -h $DB_HOST -U $DB_USER -d $PROD_DB -t -c "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public';" | tr -d ' ')

## Recovery Instructions

1. **Quick Recovery:** Run the recovery scripts in the \`recovery/\` directory
2. **Manual Recovery:** Follow the guide in \`recovery/RECOVERY_GUIDE.md\`
3. **Verification:** Run \`npm test\` to verify recovery

## Critical Functions Backed Up

- generate_app_uuid()
- recalculate_elevation_data()
- generate_routing_nodes_native()
- generate_routing_edges_native()
- detect_trail_intersections()
- validate_intersection_detection()
- copy_and_split_trails_to_staging_native()
- show_routing_summary()
- validate_routing_edge_consistency()
- validate_spatial_data_integrity()
- validate_trail_completeness()
EOF

# =====================================================
# FINAL SUMMARY
# =====================================================

echo ""
echo "✅ BACKUP COMPLETE!"
echo "=================="
echo "Backup directory: $BACKUP_DIR"
echo ""
echo "📁 Backup contents:"
echo "  📋 Schemas: schemas/"
echo "  🔧 Functions: functions/"
echo "  📦 Migrations: migrations/"
echo "  🛠️  Recovery: recovery/"
echo ""
echo "🚀 Quick recovery commands:"
echo "  Test DB:   cd $BACKUP_DIR/recovery && ./restore_test_db.sh"
echo "  Prod DB:   cd $BACKUP_DIR/recovery && ./restore_prod_db.sh"
echo ""
echo "📖 Full recovery guide: $BACKUP_DIR/recovery/RECOVERY_GUIDE.md"
echo "📊 Backup summary: $BACKUP_DIR/BACKUP_SUMMARY.md" 