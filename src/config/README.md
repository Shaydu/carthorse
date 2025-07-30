# Carthorse Configuration

This directory contains configuration files for the Carthorse project.

## Global Configuration

### `carthorse.global.config.ts`

This is the main global configuration file that centralizes all configuration constants and provides helper functions.

#### Usage Examples

```typescript
import { GLOBAL_CONFIG, configHelpers } from './carthorse.global.config';

// Get elevation precision
const precision = configHelpers.getElevationPrecision(); // 2 by default

// Round elevation values to configured precision
const roundedElevation = configHelpers.roundElevation(1928.5791); // 1928.58
const formattedElevation = configHelpers.formatElevation(158.86658); // "158.87"

// Get spatial tolerances
const intersectionTolerance = configHelpers.getSpatialTolerance('intersection');
const edgeTolerance = configHelpers.getSpatialTolerance('edge');

// Check verbose logging
if (configHelpers.isVerbose()) {
  console.log('Detailed logging enabled');
}

// Get processing settings
const batchSize = configHelpers.getBatchSize(); // 1000 by default
const timeout = configHelpers.getTimeoutMs(); // 30000 by default
```

#### Environment Variables

The global config reads from these environment variables:

- `CARTHORSE_ELEVATION_PRECISION` - Decimal places for elevation values (default: 2)
- `INTERSECTION_TOLERANCE` - Spatial intersection tolerance in meters (default: 1)
- `EDGE_TOLERANCE` - Spatial edge tolerance in meters (default: 1)
- `CARTHORSE_BATCH_SIZE` - Processing batch size (default: 1000)
- `CARTHORSE_TIMEOUT_MS` - Processing timeout in milliseconds (default: 30000)
- `CARTHORSE_LOG_LEVEL` - Logging level (default: 'info')
- `CARTHORSE_VERBOSE` - Enable verbose logging (default: false)

#### Configuration Sections

1. **Elevation Configuration**
   - Precision control for elevation values
   - Validation of precision values
   - Helper functions for rounding and formatting

2. **Spatial Configuration**
   - Intersection and edge tolerances
   - Geometry simplification settings

3. **Database Configuration**
   - Schema naming conventions
   - Staging schema management

4. **Processing Configuration**
   - Batch sizes and timeouts
   - Logging settings

5. **Export Configuration**
   - SQLite database size limits
   - Default tolerances

6. **Validation Configuration**
   - Skip options for various validation checks

7. **Cleanup Configuration**
   - Disk space management settings

### `test-config.ts`

Test-specific configuration that extends the global config with test-specific settings.

## Best Practices

1. **Always use the global config** instead of hardcoded values
2. **Use helper functions** for common operations like elevation rounding
3. **Set environment variables** in your `.env` file for customization
4. **Import from the config file** rather than duplicating constants

## Example: Elevation Precision

Before (hardcoded):
```typescript
const elevation = Math.round(1928.5791); // Always rounds to whole numbers
```

After (using global config):
```typescript
import { configHelpers } from './carthorse.global.config';

const elevation = configHelpers.roundElevation(1928.5791); // Respects configured precision
// With CARTHORSE_ELEVATION_PRECISION=2: 1928.58
// With CARTHORSE_ELEVATION_PRECISION=1: 1928.6
// With CARTHORSE_ELEVATION_PRECISION=0: 1929
``` 