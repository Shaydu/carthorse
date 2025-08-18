# GeoJSON Nested Coordinates Fix for Layer 3 Routes

## Problem

The GeoJSON export for layer 3 routes was producing nested coordinate arrays instead of the proper GeoJSON format. This occurred when converting PostGIS `MULTILINESTRINGZ` geometries to GeoJSON format.

## Root Cause

The issue was in the `exportRecommendations` function in `src/utils/export/geojson-export-strategy.ts`. When converting PostGIS geometry to GeoJSON, the code was using:

```sql
SELECT ST_AsGeoJSON($1::geometry, 6, 0) as geojson
```

This approach doesn't handle nested coordinates properly when the geometry contains multiple parts (like a MultiLineString). The resulting GeoJSON would have nested coordinate arrays instead of the expected flat array of coordinate pairs.

## Solution

Updated the geometry conversion to use `ST_Dump` to handle nested coordinates properly:

```sql
SELECT ST_AsGeoJSON((ST_Dump($1::geometry)).geom, 6, 0) as geojson
```

The `ST_Dump` function decomposes a geometry into its constituent parts, and `.geom` extracts the individual geometry component. This ensures that:

1. MultiLineStrings are properly converted to individual LineStrings
2. Coordinates are flattened to the correct GeoJSON format
3. 3D coordinates (elevation) are preserved with the `6, 0` parameters

## Files Modified

- `src/utils/export/geojson-export-strategy.ts` - Updated `exportRecommendations` function

## Testing

The fix was tested by running the export command:

```bash
npx ts-node src/cli/export.ts --region boulder --out test-output/boulder-expanded-bbox-test-fixed.geojson --format geojson --bbox -105.30123174925316,39.96928418458248,-105.26050515816028,39.993172777276015 --disable-trailheads-only --no-trailheads --skip-validation --no-cleanup --verbose --source cotrex
```

The export completed successfully and produced properly formatted GeoJSON with flat coordinate arrays instead of nested coordinates.

## Result

Layer 3 route geometries now export correctly with proper GeoJSON coordinate format:

```json
{
  "type": "Feature",
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [-105.295685, 39.998169, 1810.234741],
      [-105.295772, 39.998183, 1810.508057],
      ...
    ]
  }
}
```
