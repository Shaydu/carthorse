<div align="left">
  <img src="../carthorse-logo-small.png" alt="Carthorse Logo" width="40" height="40">
</div>

# Disk Space Management for Carthorse

## Overview

Carthorse now includes comprehensive disk space management features to help prevent disk space constraints during processing. These features automatically clean up temporary files, old staging schemas, and other disk-intensive artifacts.

## Features

### 1. Automatic Cleanup (Default Behavior)

By default, Carthorse now performs comprehensive cleanup after each export:

- **Current staging schema**: Cleaned up after successful export
- **Old staging schemas**: Keeps only the 2 most recent per region
- **Temporary files**: Removes files older than 24 hours
- **Database vacuum**: Reclaims space from deleted data
- **Test staging schemas**: Cleans up all test-related schemas

### 2. CLI Options for Fine-Tuning

```bash
# Disable aggressive cleanup
carthorse --region boulder --out data/boulder.db --no-aggressive-cleanup

# Keep only 1 staging schema per region (instead of 2)
carthorse --region boulder --out data/boulder.db --max-staging-schemas 1

# Disable cleanup of old staging schemas
carthorse --region boulder --out data/boulder.db --no-cleanup-old-staging

# Disable cleanup of temporary files
carthorse --region boulder --out data/boulder.db --no-cleanup-temp-files

# Enable cleanup of database logs (requires PostgreSQL configuration)
carthorse --region boulder --out data/boulder.db --cleanup-db-logs

# Perform cleanup even if export fails
carthorse --region boulder --out data/boulder.db --cleanup-on-error
```

### 3. Standalone Cleanup Commands

```bash
# Comprehensive disk space cleanup
carthorse --cleanup-disk-space

# Clean up specific region
carthorse --cleanup-disk-space --region boulder

# Clean up with custom settings
carthorse --cleanup-disk-space --region boulder --max-staging-schemas 1 --no-aggressive-cleanup

# Clean up test data only
carthorse --clean-test-data
```

### 4. Disk Space Monitoring

```bash
# Monitor disk usage and get recommendations
scripts/dev-utils/disk-space-monitor.sh
```

## Configuration Options

### Orchestrator Configuration

```typescript
interface EnhancedOrchestratorConfig {
  // Cleanup options (all default to true except cleanupDatabaseLogs)
  aggressiveCleanup?: boolean;           // Default: true
  cleanupOldStagingSchemas?: boolean;    // Default: true
  cleanupTempFiles?: boolean;            // Default: true
  maxStagingSchemasToKeep?: number;      // Default: 2
  cleanupDatabaseLogs?: boolean;         // Default: false
  cleanupOnError?: boolean;              // Default: false
}
```

## What Gets Cleaned Up

### 1. Staging Schemas
- **Current schema**: Dropped after successful export
- **Old schemas**: Keeps only N most recent per region (configurable)
- **Orphaned schemas**: Removes schemas from other regions
- **Test schemas**: Cleans up all test-related schemas

### 2. Temporary Files
- **Project temp directories**: `tmp/`, `logs/`, `data/temp/`
- **System temp directory**: Files older than 24 hours
- **Specific temp files**: `/tmp/latest_prod_schema.sql`, test databases
- **Pattern-based cleanup**: Files matching `test-*.db`, etc.

### 3. Database Cleanup
- **Vacuum**: Reclaims space from deleted data
- **Temporary tables**: Removes pg_temp tables
- **Database logs**: (Optional, requires PostgreSQL configuration)

## Usage Examples

### Basic Export with Default Cleanup
```bash
carthorse --region boulder --out data/boulder.db
# Automatically performs comprehensive cleanup
```

### Export with Minimal Cleanup
```bash
carthorse --region boulder --out data/boulder.db \
  --no-aggressive-cleanup \
  --no-cleanup-old-staging \
  --no-cleanup-temp-files
```

### Export with Aggressive Cleanup
```bash
carthorse --region boulder --out data/boulder.db \
  --max-staging-schemas 1 \
  --cleanup-on-error
```

### Standalone Cleanup Operations
```bash
# Emergency cleanup
carthorse --cleanup-disk-space

# Region-specific cleanup
carthorse --cleanup-disk-space --region boulder --max-staging-schemas 1

# Test data cleanup only
carthorse --clean-test-data
```

### Monitoring and Maintenance
```bash
# Check disk usage
scripts/dev-utils/disk-space-monitor.sh

# Manual staging schema cleanup
scripts/dev-utils/drop_all_staging_schemas.sh
```

## Best Practices

### 1. Regular Monitoring
- Run `scripts/dev-utils/disk-space-monitor.sh` periodically
- Monitor disk usage before large exports
- Check for orphaned staging schemas

### 2. Cleanup Strategy
- Use `--max-staging-schemas 1` for disk-constrained environments
- Enable `--cleanup-on-error` for production environments
- Use `--no-aggressive-cleanup` only for debugging

### 3. Production Workflows
```bash
# Production export with aggressive cleanup
carthorse --region boulder --out data/boulder.db \
  --max-staging-schemas 1 \
  --cleanup-on-error \
  --verbose

# Post-export cleanup verification
scripts/dev-utils/disk-space-monitor.sh
```

## Troubleshooting

### Cleanup Errors
- Cleanup errors don't fail the main export process
- Check logs for specific cleanup failures
- Run standalone cleanup commands to retry

### Disk Space Still Low
- Check for large files with `find . -size +100M`
- Verify PostgreSQL database sizes
- Consider reducing `maxStagingSchemasToKeep`

### Staging Schema Issues
- Use `carthorse --clean-test-data` for test schemas
- Use `carthorse --cleanup-disk-space` for comprehensive cleanup
- Check for orphaned schemas with the monitor script

## Implementation Details

### Cleanup Methods
- `performComprehensiveCleanup()`: Main cleanup orchestration
- `cleanupOldStagingSchemas()`: Region-specific schema cleanup
- `cleanupTempFiles()`: File system cleanup
- `performAggressiveCleanup()`: Maximum space recovery
- `cleanupOrphanedStagingSchemas()`: Cross-region cleanup

### Safety Features
- Cleanup errors don't fail main process
- Configurable cleanup options
- Dry-run capabilities for testing
- Comprehensive logging

### Performance Impact
- Cleanup runs after export completion
- Minimal impact on export performance
- Configurable to skip if needed
- Background cleanup for non-critical operations 