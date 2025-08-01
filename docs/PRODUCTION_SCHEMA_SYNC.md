# Production Schema Sync

## Overview

This document explains how to keep the production database schema in sync with the test database installation process.

## The Problem

The test database installation uses static schema files:
- `sql/schemas/carthorse-complete-schema.sql` (main schema)
- `docs/sql/fix_routing_functions.sql` (fixes)
- `sql/schemas/missing-functions.sql` (additional functions)

These files can become out of sync with the production database when:
- New functions are added to production
- Table structures are modified
- New tables are created
- Functions are updated

## The Solution

We use the `scripts/sync-production-schema.sh` script to export the production schema and update our schema files.

## How It Works

### 1. Schema Export Process

The sync script:
1. **Exports complete production schema** using `pg_dump`
2. **Analyzes production functions and tables** to show what exists
3. **Updates schema files** with the latest production schema
4. **Creates backup files** for comparison and rollback
5. **Generates a summary report** of changes

### 2. Files Updated

- `sql/schemas/carthorse-complete-schema.sql` - Complete production schema
- `sql/schemas/missing-functions.sql` - Production functions (if any are missing)

### 3. Backup Files Created

- `backups/schema-sync-YYYYMMDD_HHMMSS/production-schema.sql` - Raw production schema export
- `backups/schema-sync-YYYYMMDD_HHMMSS/production-functions.sql` - Production functions only
- `backups/schema-sync-YYYYMMDD_HHMMSS/sync-summary.md` - Summary report

## Usage

### Running the Sync

```bash
# Set production database environment
PGUSER=tester PGDATABASE=trail_master_db PGPASSWORD=test123 ./scripts/sync-production-schema.sh
```

### Testing the Updated Schema

```bash
# Test the updated schema installation
PGUSER=tester PGDATABASE=trail_master_db PGPASSWORD=test123 npx ts-node test-install.js
```

### Running Tests

```bash
# Run tests with the updated schema
npm test
```

## When to Run

Run the sync script when:

1. **Production schema changes** - New functions, tables, or modifications
2. **Before major releases** - Ensure test environment matches production
3. **After production deployments** - Sync any schema changes
4. **When tests fail** - Check if schema drift is the cause

## Verification

After running the sync:

1. **Check installation works**: `npx ts-node test-install.js`
2. **Run tests**: `npm test`
3. **Compare backup files**: Check `backups/schema-sync-*/` for changes
4. **Review summary**: Read `backups/schema-sync-*/sync-summary.md`

## Troubleshooting

### Schema Installation Fails

If the test installation fails after sync:

1. Check the backup files for differences
2. Compare production vs test database schemas
3. Look for missing functions or tables
4. Check for syntax errors in the exported schema

### Tests Fail After Sync

If tests fail after sync:

1. Check if new functions are being tested correctly
2. Verify table structures match expectations
3. Look for breaking changes in function signatures
4. Update tests if necessary

### Rollback

To rollback schema changes:

1. Restore from backup: `cp backups/schema-sync-*/production-schema.sql sql/schemas/carthorse-complete-schema.sql`
2. Re-run installation: `npx ts-node test-install.js`
3. Run tests: `npm test`

## Best Practices

1. **Run sync regularly** - Keep schemas in sync
2. **Test immediately** - Verify changes work
3. **Document changes** - Update this document if needed
4. **Backup before changes** - Always have a rollback plan
5. **Review differences** - Understand what changed

## Current Status

- ✅ **Schema sync script created**: `scripts/sync-production-schema.sh`
- ✅ **Production schema exported**: Latest schema captured
- ✅ **Schema files updated**: Test installation uses production schema
- ✅ **Installation verified**: Test database installs successfully
- 🔄 **Tests pending**: Need to run full test suite

## Next Steps

1. Run full test suite: `npm test`
2. Fix any test failures
3. Document any issues found
4. Establish regular sync schedule 