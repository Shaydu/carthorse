# Carthorse SQLite Schema v14 Changes

## Overview
Carthorse SQLite schema has been updated to v14 with significant enhancements for route recommendations and trail composition tracking.

## Key Changes from v13

### 1. New Route Trails Junction Table
- **Table**: `route_trails`
- **Purpose**: Detailed tracking of which trails compose each route recommendation
- **Fields**:
  - `route_uuid`: Links to route_recommendations
  - `trail_id`: Individual trail identifier
  - `trail_name`: Trail name for display
  - `segment_order`: Order of trail in the route
  - `segment_distance_km`: Distance of this trail segment
  - `segment_elevation_gain`: Elevation gain for this segment
  - `segment_elevation_loss`: Elevation loss for this segment

### 2. Enhanced Route Recommendations
- **Dynamic Region Support**: No longer hardcoded to 'boulder'
- **Better Constraint Handling**: Fallback values for calculated fields
- **Enhanced Parametric Search**: Additional calculated fields for filtering

### 3. New Parametric Search Fields
All calculated from route data:
- `route_gain_rate`: Meters per kilometer
- `route_trail_count`: Number of unique trails (same as trail_count)
- `route_max_elevation`: Highest point on route
- `route_min_elevation`: Lowest point on route  
- `route_avg_elevation`: Average elevation
- `route_difficulty`: Calculated from gain rate
- `route_estimated_time_hours`: Estimated hiking time
- `route_connectivity_score`: How well trails connect

### 4. New Views
- `route_trail_composition`: Join view showing trail details for each route
- Updated `route_stats`: Now uses `route_shape` instead of deprecated fields

## Schema Files

### Primary Schema
- **File**: `sql/schemas/carthorse-sqlite-schema-v14.sql`
- **Location**: [sql/schemas/carthorse-sqlite-schema-v14.sql](sql/schemas/carthorse-sqlite-schema-v14.sql)

### Implementation Changes
- **Export Helpers**: `src/utils/sqlite-export-helpers.ts` (updated for v14)
- **Tests**: `src/__tests__/route-recommendations-export.test.ts` (updated test data)

## API Integration Points

### 1. Route Recommendations Query
```sql
-- Get route with trail composition
SELECT rr.*, rt.trail_id, rt.trail_name, rt.segment_order
FROM route_recommendations rr
JOIN route_trails rt ON rr.route_uuid = rt.route_uuid
WHERE rr.region = ? AND rr.route_shape = ?
ORDER BY rr.route_uuid, rt.segment_order;
```

### 2. Parametric Search
```sql
-- Filter by difficulty and distance
SELECT * FROM route_recommendations 
WHERE region = ? 
  AND route_difficulty = ?
  AND recommended_distance_km BETWEEN ? AND ?
  AND route_gain_rate BETWEEN ? AND ?;
```

### 3. Trail Composition
```sql
-- Get detailed trail breakdown for a route
SELECT * FROM route_trail_composition 
WHERE route_uuid = ?;
```

## Migration Notes

### For API Team
1. **Region Parameter**: All route queries now require region parameter
2. **Trail Composition**: Use `route_trails` table for detailed trail breakdown
3. **Parametric Fields**: New calculated fields available for advanced filtering
4. **Constraint Handling**: Better fallback values prevent constraint violations

### For Database Team
1. **Schema Version**: Update to v14 for new features
2. **Indexes**: New indexes added for parametric search performance
3. **Views**: New `route_trail_composition` view for easy querying
4. **Constraints**: Enhanced constraint handling with fallback values

## Testing Status
- ✅ Route recommendations insertion test passing
- ✅ Constraint validation working
- ✅ Fallback values preventing violations
- ✅ Schema version validation updated

## Next Steps
1. Update PostgreSQL functions to populate `route_trails` table
2. Implement dynamic region parameter in recommendation generation
3. Update export service to handle new schema
4. Add comprehensive tests for trail composition features

## Contact
For questions about the schema changes, refer to the v14 schema file and this documentation. 