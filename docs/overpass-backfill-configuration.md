# Overpass API Backfill Configuration

## Overview

The Overpass API backfill feature allows Carthorse to automatically query OpenStreetMap's Overpass API to find and add missing trails to your trail network. This ensures you have the most comprehensive trail coverage for your bbox.

## Configuration

### Global Configuration (`configs/carthorse.config.yaml`)

```yaml
constants:
  # Overpass API backfill configuration
  overpassBackfill:
    enabled: true                # ENABLED: Query Overpass API to add missing trails
    timeoutSeconds: 30           # Timeout for Overpass API requests
    maxTrailsPerRequest: 1000    # Maximum trails to process per bbox
    # Trail types to include from Overpass API
    trailTypes:
      - "path"                   # Unpaved paths
      - "footway"                # Footways (unpaved)
      - "track"                  # Tracks (unpaved)
      - "bridleway"              # Bridleways
      - "steps"                  # Steps/stairs
    # Surface types to exclude (paved trails)
    excludeSurfaces:
      - "paved"
      - "asphalt"
      - "concrete"
```

### Environment Variables

You can also control Overpass backfill using environment variables:

```bash
# Disable Overpass backfill
export OVERPASS_BACKFILL_ENABLED=false

# Set custom timeout (seconds)
export OVERPASS_TIMEOUT_SECONDS=45

# Set maximum trails per request
export OVERPASS_MAX_TRAILS=500
```

## How It Works

### 1. Comprehensive Bbox Query
- Queries the entire bbox for ALL trails from Overpass API
- Not just gap-fillers, but complete trail coverage
- Filters for unpaved trails only (excludes paved surfaces)

### 2. Missing Trail Detection
- Compares Overpass trails with existing database trails
- Uses geometric similarity (within 10m) to detect duplicates
- Identifies trails that exist in Overpass but not in your database

### 3. Automatic Addition
- Adds all missing trails from Overpass API
- Preserves trail metadata (name, surface type, etc.)
- Maintains data integrity with proper geometry handling

### 4. Gap Analysis
- After adding missing trails, checks for isolated endpoints
- Logs any remaining gaps for manual attention
- Provides transparency about network completeness

## Usage Examples

### Enable Overpass Backfill (Default)
```bash
# Overpass backfill is enabled by default
npx ts-node src/cli/export.ts --region boulder --bbox -105.291,39.969,-105.280,39.981
```

### Disable Overpass Backfill
```bash
# Method 1: Environment variable
export OVERPASS_BACKFILL_ENABLED=false
npx ts-node src/cli/export.ts --region boulder --bbox -105.291,39.969,-105.280,39.981

# Method 2: Edit config file
# Set enabled: false in configs/carthorse.config.yaml
```

### Custom Configuration
```bash
# Set custom timeout and trail limit
export OVERPASS_TIMEOUT_SECONDS=60
export OVERPASS_MAX_TRAILS=2000
npx ts-node src/cli/export.ts --region boulder --bbox -105.291,39.969,-105.280,39.981
```

## Output Example

```
🔗 Filling gaps in trail network...
   🌐 Overpass backfill: ENABLED
   🗺️ Bbox: [-105.291, 39.969, -105.280, 39.981]
   🌐 Querying Overpass API for all trails in bbox...
   📋 Trail types: path, footway, track, bridleway, steps
   🚫 Excluding surfaces: paved, asphalt, concrete
   📊 Found 45 trails from Overpass API
   📊 Found 32 existing trails in database
   🔍 Found 13 missing trails from Overpass API
   ✅ Added missing trail: Mesa Trail (156 points)
   ✅ Added missing trail: Bluebell Road Trail (89 points)
   ...
   📊 Trail backfill complete: 13 missing trails + 0 gap fillers = 13 total added
```

## Benefits

1. **Complete Coverage**: Ensures you have all available trails from OpenStreetMap
2. **Better Connectivity**: More trails = better network connectivity
3. **Data Quality**: Uses authoritative OpenStreetMap data
4. **Configurable**: Can be enabled/disabled as needed
5. **Transparent**: Logs all operations for visibility

## Troubleshooting

### Overpass API Timeout
If you experience timeouts with large bboxes:
```bash
export OVERPASS_TIMEOUT_SECONDS=60
```

### Too Many Trails
If you're getting too many trails for a large area:
```bash
export OVERPASS_MAX_TRAILS=500
```

### Disable for Testing
To test without Overpass data:
```bash
export OVERPASS_BACKFILL_ENABLED=false
```

## Limitations

1. **API Rate Limits**: Overpass API has rate limits for large requests
2. **Data Quality**: Relies on OpenStreetMap data quality and completeness
3. **Surface Filtering**: Only includes unpaved trails (excludes paved paths)
4. **Geographic Coverage**: Depends on OpenStreetMap coverage in your area

## Related Configuration

This feature works alongside other trail processing features:
- **Gap Fixing**: `constants.gapFixing.enabled`
- **Trail Deduplication**: Automatic duplicate removal
- **Trail Cleanup**: Invalid geometry removal
