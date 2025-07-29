<div align="left">
  <img src="../carthorse-logo-small.png" alt="Carthorse Logo" width="40" height="40">
</div>

# Elevation Export Fix

## Problem

The Carthorse export process was not populating elevation data in the geometry coordinates. All coordinates had a third element (elevation), but they were all set to 0 instead of actual elevation values.

## Root Cause

The issue was in the `ST_AsGeoJSON()` function calls throughout the export process. By default, `ST_AsGeoJSON()` converts 3D geometries to 2D, dropping the Z coordinates (elevation). To preserve 3D coordinates, we need to use `ST_AsGeoJSON(geometry, 6, 0)` where:
- `6` specifies the number of decimal places
- `0` preserves 3D coordinates (doesn't force 2D conversion)

## Solution

Updated all `ST_AsGeoJSON()` calls in the export process to preserve 3D coordinates:

### Files Modified

1. **`src/utils/export-service.ts`**
   - Updated 6 instances of `ST_AsGeoJSON(geometry)` to `ST_AsGeoJSON(geometry, 6, 0)`
   - Affects both `exportDatabase()` and `exportStagingData()` methods

2. **`src/orchestrator/EnhancedPostgresOrchestrator.ts`**
   - Updated 3 instances of `ST_AsGeoJSON(geometry)` to `ST_AsGeoJSON(geometry, 6, 0)`
   - Affects `exportDatabase()` and `exportStagingData()` methods

3. **`tools/test/test_trail_splitting_visualization.js`**
   - Updated 5 instances of `ST_AsGeoJSON()` to preserve 3D coordinates
   - Ensures test data maintains elevation information

4. **`migrations/V3__add_postgis_functions.sql`**
   - Updated 1 instance in the routing edges generation function
   - Ensures routing edges preserve elevation data

### Changes Made

**Before:**
```sql
ST_AsGeoJSON(geometry) as geojson
```

**After:**
```sql
ST_AsGeoJSON(geometry, 6, 0) as geojson
```

## Testing

### Unit Test
Added a test in `src/__tests__/sqlite/sqlite-export-helpers.test.ts`:
- `should preserve 3D coordinates in GeoJSON export`
- Verifies that 3D coordinates with elevation data are preserved
- Checks that elevation values are not zeroed out
- Confirms elevation values match expected test data

### Integration Test
Created `scripts/test-3d-elevation-export.js` to verify:
- 3D coordinates are preserved in exported GeoJSON
- Elevation values are not zeroed out
- ST_AsGeoJSON(geometry, 6, 0) correctly preserves 3D data

## Verification

The fix ensures that:
1. **Elevation data is preserved**: All 3D coordinates maintain their Z values
2. **No zeroing out**: Elevation values are not converted to 0
3. **Consistent format**: All exported geometries maintain 3D structure
4. **Backward compatibility**: Existing 2D geometries are handled correctly

## Impact

- **Trails**: Elevation data is now preserved in trail geometries
- **Routing Nodes**: Node coordinates maintain elevation information
- **Routing Edges**: Edge geometries preserve elevation data
- **Export Process**: All SQLite exports now include proper elevation data

## PostGIS Function Parameters

The `ST_AsGeoJSON()` function signature is:
```sql
ST_AsGeoJSON(geometry, decimal_places, include_3d)
```

Where:
- `decimal_places`: Number of decimal places (default: 15)
- `include_3d`: Whether to include 3D coordinates (0 = preserve input dimension, 1 = force 3D)

Our fix uses `(geometry, 6, 0)` to:
- Limit decimal places to 6 for performance
- Preserve the input dimension (2D stays 2D, 3D stays 3D)

## Related Documentation

- [PostGIS ST_AsGeoJSON Documentation](https://postgis.net/docs/ST_AsGeoJSON.html)
- [Carthorse Spatial Code Rules](../WORKFLOW.md#carthorse-spatial-code-rules)
- [PostGIS Architectural Rules](../WORKFLOW.md#postgis-architectural-rules)