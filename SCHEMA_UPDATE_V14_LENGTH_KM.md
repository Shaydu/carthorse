# Schema Update: Distance to Length Field Rename (v14)

## Overview
Updated the route recommendations schema to use `length_km` consistently instead of `distance_km` for better semantic accuracy and consistency across all tables.

## Changes Made

### 1. Route Recommendations Table Schema Changes

**Before:**
```sql
CREATE TABLE route_recommendations (
  -- ...
  input_distance_km REAL CHECK(input_distance_km > 0),
  recommended_distance_km REAL CHECK(recommended_distance_km > 0),
  -- ...
);
```

**After:**
```sql
CREATE TABLE route_recommendations (
  -- ...
  input_length_km REAL CHECK(input_length_km > 0),
  recommended_length_km REAL CHECK(recommended_length_km > 0),
  -- ...
);
```

### 2. Updated Indexes

**Before:**
```sql
CREATE INDEX idx_route_recommendations_distance ON route_recommendations(recommended_distance_km);
CREATE INDEX idx_route_recommendations_input ON route_recommendations(input_distance_km, input_elevation_gain);
CREATE INDEX idx_route_recommendations_distance_gain_rate ON route_recommendations(recommended_distance_km, route_gain_rate);
CREATE INDEX idx_route_recommendations_difficulty_distance ON route_recommendations(route_difficulty, recommended_distance_km);
```

**After:**
```sql
CREATE INDEX idx_route_recommendations_length ON route_recommendations(recommended_length_km);
CREATE INDEX idx_route_recommendations_input ON route_recommendations(input_length_km, input_elevation_gain);
CREATE INDEX idx_route_recommendations_length_gain_rate ON route_recommendations(recommended_length_km, route_gain_rate);
CREATE INDEX idx_route_recommendations_difficulty_length ON route_recommendations(route_difficulty, recommended_length_km);
```

### 3. Updated Views

**Route Stats View:**
```sql
-- Before
AVG(recommended_distance_km) as avg_distance_km,

-- After  
AVG(recommended_length_km) as avg_length_km,
```

**Route Trail Composition View:**
```sql
-- Before
rr.recommended_distance_km,

-- After
rr.recommended_length_km,
```

## Frontend Integration Changes

### API Response Changes

**Before:**
```json
{
  "route_recommendations": [
    {
      "route_uuid": "abc-123",
      "input_distance_km": 5.0,
      "recommended_distance_km": 5.2,
      "recommended_elevation_gain": 200,
      // ...
    }
  ]
}
```

**After:**
```json
{
  "route_recommendations": [
    {
      "route_uuid": "abc-123", 
      "input_length_km": 5.0,
      "recommended_length_km": 5.2,
      "recommended_elevation_gain": 200,
      // ...
    }
  ]
}
```

### Database Query Changes

**Before:**
```sql
SELECT * FROM route_recommendations 
WHERE recommended_distance_km BETWEEN 4.5 AND 5.5
ORDER BY recommended_distance_km;
```

**After:**
```sql
SELECT * FROM route_recommendations 
WHERE recommended_length_km BETWEEN 4.5 AND 5.5
ORDER BY recommended_length_km;
```

## Files Updated

### Core Schema Files
- `sql/schemas/carthorse-sqlite-schema-v14.sql`
- `src/utils/sql/staging-schema.ts`

### Export/Import Files  
- `src/utils/sqlite-export-helpers.ts`
- `src/utils/export/export-service.ts`
- `src/utils/export-service.ts`
- `src/sql/queries/export-queries.ts`
- `src/utils/sql/route-pattern-sql-helpers.ts`

### Test Files
- `src/__tests__/route-recommendations-integration.test.ts`
- `src/__tests__/route-recommendations-export.test.ts`

## Migration Notes

1. **Backward Compatibility**: This is a breaking change. Frontend code must be updated to use the new field names.

2. **Database Migration**: Existing databases will need to be recreated with the new schema or migrated using ALTER TABLE statements.

3. **API Versioning**: Consider versioning the API to support both old and new field names during transition.

4. **Validation**: Update any client-side validation to use the new field names.

## Rationale

- **Consistency**: All tables now use `length_km` for physical trail/route measurements
- **Clarity**: `length` is more precise than `distance` for trail measurements  
- **Semantic Accuracy**: We're measuring the physical length of trails/routes, not just distance between points
- **Future-Proofing**: Aligns with industry standards for trail/route data

## Testing

All existing tests have been updated to use the new field names. The schema validation and export functionality has been tested to ensure compatibility.

## Deployment Checklist

- [ ] Update frontend code to use new field names
- [ ] Update API documentation
- [ ] Test database exports with new schema
- [ ] Verify all route recommendation queries work with new fields
- [ ] Update any hardcoded field references in frontend
- [ ] Test route filtering and sorting functionality 