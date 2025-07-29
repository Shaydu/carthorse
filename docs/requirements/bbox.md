<div align="left">
  <img src="../../carthorse-logo-small.png" alt="Carthorse Logo" width="40" height="40">
</div>

# Bounding Box (BBox) Requirements

## Overview

This document outlines the requirements for bounding box handling in the Carthorse trail data system, specifically focusing on the `initial_view_bbox` functionality.

## Background

The system uses two types of bounding boxes:
1. **Main BBox**: Calculated from the actual trail geometry extent in the database
2. **Initial View BBox**: Used by the frontend to set the initial map view

## Initial View BBox Requirements

### Core Logic

The `initial_view_bbox` is handled during the export process in `carthorse-enhanced-postgres-orchestrator.ts` with the following logic:

#### If `initial_view_bbox` is NULL in Postgres:
- Calculate a 25% bbox from the main database extent
- Center the 25% bbox on the center of the main bbox
- Write the calculated bbox to SQLite as JSON

#### If `initial_view_bbox` is set in Postgres:
- Copy the existing value as-is to SQLite
- Handle both object and string formats

### Implementation Details

```typescript
// Handle initial_view_bbox logic
let initialViewBbox;
if (r.initial_view_bbox === null || r.initial_view_bbox === undefined) {
  // Calculate 25% bbox from the main bbox
  const bboxWidth = mainBbox.maxLng - mainBbox.minLng;
  const bboxHeight = mainBbox.maxLat - mainBbox.minLat;
  const centerLng = mainBbox.minLng + bboxWidth / 2;
  const centerLat = mainBbox.minLat + bboxHeight / 2;
  const quarterWidth = bboxWidth * 0.25;
  const quarterHeight = bboxHeight * 0.25;
  
  const calculatedBbox = {
    minLng: centerLng - quarterWidth / 2,
    maxLng: centerLng + quarterWidth / 2,
    minLat: centerLat - quarterHeight / 2,
    maxLat: centerLat + quarterHeight / 2
  };
  
  initialViewBbox = JSON.stringify(calculatedBbox);
  console.log('📊 Calculated 25% initial_view_bbox from main bbox:', calculatedBbox);
} else {
  // Copy existing initial_view_bbox as-is
  initialViewBbox = typeof r.initial_view_bbox === 'object' ? JSON.stringify(r.initial_view_bbox) : r.initial_view_bbox;
  console.log('📊 Using existing initial_view_bbox from Postgres:', r.initial_view_bbox);
}
```

### Database Schema

The `regions` table in SQLite includes:

```sql
CREATE TABLE IF NOT EXISTS regions (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  bbox TEXT,                    -- Main bbox (calculated from trail geometry)
  initial_view_bbox TEXT,       -- Initial view bbox (25% or custom)
  center TEXT,
  metadata TEXT
);
```

### Testing Scenarios

#### Seattle Region
- **Condition**: `initial_view_bbox` is NULL in Postgres
- **Expected Result**: Gets a calculated 25% bbox
- **Verification**: Check that the calculated bbox is 25% of the main bbox dimensions

#### Boulder Region
- **Condition**: `initial_view_bbox` is set in Postgres
- **Expected Result**: Gets the custom bbox as-is
- **Verification**: Check that the custom bbox is preserved exactly

### Validation Requirements

1. **25% Calculation Accuracy**: The calculated bbox should reduce both dimensions by exactly 75%
2. **Centering**: The calculated bbox should be centered on the main bbox center
3. **Preservation**: Custom bboxes should be preserved exactly as stored in Postgres
4. **JSON Format**: All bboxes should be stored as valid JSON strings in SQLite

### API Integration

The frontend API should:
- Return the `initial_view_bbox` from the regions table
- Use this bbox to set the initial map view
- Handle both calculated (25%) and custom bboxes transparently

### Deployment Verification

After deployment, verify via the API that:
1. Seattle returns a calculated 25% bbox
2. Boulder returns the custom bbox
3. Both regions have valid `initialViewBbox` values

## Benefits

This approach provides:
- **Unambiguous logic**: Every region always has a valid `initial_view_bbox`
- **Robust handling**: Works for both new regions (NULL) and existing regions (custom)
- **Consistent API**: Frontend logic remains simple and consistent
- **Automatic fallback**: Regions without custom bboxes get sensible defaults

## Future Considerations

- Consider adding validation to ensure calculated bboxes are reasonable
- May want to add configuration options for the 25% calculation
- Could extend to support different calculation methods per region 