# Parametric Search Examples

This document shows how to use the new parametric search fields to filter and query routes based on actual calculated values rather than pre-categorized bins.

## New Parametric Search Fields

The following fields have been added to the `route_recommendations` table for parametric search:

- `route_gain_rate` - Elevation gain per kilometer (m/km)
- `route_trail_count` - Number of unique trails in the route
- `route_max_elevation` - Highest point on the route
- `route_min_elevation` - Lowest point on the route
- `route_avg_elevation` - Average elevation of the route
- `route_difficulty` - Calculated difficulty (easy, moderate, hard, expert)
- `route_estimated_time_hours` - Estimated hiking time
- `route_connectivity_score` - How well trails connect (0-1)

## Example Queries

### 1. Find Routes by Elevation Gain Rate (Steepness)

```sql
-- Find routes with moderate steepness (50-100 m/km)
SELECT 
    route_uuid,
    recommended_distance_km,
    recommended_elevation_gain,
    route_gain_rate,
    route_difficulty
FROM route_recommendations 
WHERE route_gain_rate BETWEEN 50 AND 100
ORDER BY route_gain_rate DESC;

-- Find very steep routes (>150 m/km)
SELECT 
    route_uuid,
    recommended_distance_km,
    route_gain_rate,
    route_difficulty
FROM route_recommendations 
WHERE route_gain_rate > 150
ORDER BY route_gain_rate DESC;
```

### 2. Find Routes by Difficulty Level

```sql
-- Find easy routes (gain rate < 50 m/km)
SELECT 
    route_uuid,
    recommended_distance_km,
    route_gain_rate,
    route_estimated_time_hours
FROM route_recommendations 
WHERE route_difficulty = 'easy'
ORDER BY recommended_distance_km;

-- Find expert-level routes
SELECT 
    route_uuid,
    recommended_distance_km,
    route_gain_rate,
    route_estimated_time_hours
FROM route_recommendations 
WHERE route_difficulty = 'expert'
ORDER BY route_gain_rate DESC;
```

### 3. Find Routes by Trail Count (Complexity)

```sql
-- Find simple routes (1-2 trails)
SELECT 
    route_uuid,
    route_trail_count,
    recommended_distance_km,
    route_connectivity_score
FROM route_recommendations 
WHERE route_trail_count BETWEEN 1 AND 2
ORDER BY route_trail_count;

-- Find complex routes (5+ trails)
SELECT 
    route_uuid,
    route_trail_count,
    recommended_distance_km,
    route_connectivity_score
FROM route_recommendations 
WHERE route_trail_count >= 5
ORDER BY route_trail_count DESC;
```

### 4. Find Routes by Elevation Range

```sql
-- Find routes in specific elevation range (2000-3000m)
SELECT 
    route_uuid,
    route_min_elevation,
    route_max_elevation,
    recommended_distance_km,
    route_difficulty
FROM route_recommendations 
WHERE route_min_elevation >= 2000 
  AND route_max_elevation <= 3000
ORDER BY route_max_elevation;

-- Find high-altitude routes (>4000m)
SELECT 
    route_uuid,
    route_max_elevation,
    recommended_distance_km,
    route_difficulty
FROM route_recommendations 
WHERE route_max_elevation > 4000
ORDER BY route_max_elevation DESC;
```

### 5. Find Routes by Estimated Time

```sql
-- Find short hikes (1-3 hours)
SELECT 
    route_uuid,
    recommended_distance_km,
    route_estimated_time_hours,
    route_difficulty
FROM route_recommendations 
WHERE route_estimated_time_hours BETWEEN 1 AND 3
ORDER BY route_estimated_time_hours;

-- Find full-day hikes (6+ hours)
SELECT 
    route_uuid,
    recommended_distance_km,
    route_estimated_time_hours,
    route_difficulty
FROM route_recommendations 
WHERE route_estimated_time_hours >= 6
ORDER BY route_estimated_time_hours DESC;
```

### 6. Complex Parametric Searches

```sql
-- Find moderate difficulty routes with good connectivity
SELECT 
    route_uuid,
    recommended_distance_km,
    route_gain_rate,
    route_connectivity_score,
    route_estimated_time_hours
FROM route_recommendations 
WHERE route_difficulty = 'moderate'
  AND route_connectivity_score > 0.7
  AND route_estimated_time_hours BETWEEN 2 AND 5
ORDER BY route_connectivity_score DESC;

-- Find expert routes in high elevation with multiple trails
SELECT 
    route_uuid,
    route_trail_count,
    route_max_elevation,
    route_gain_rate,
    route_estimated_time_hours
FROM route_recommendations 
WHERE route_difficulty = 'expert'
  AND route_max_elevation > 3000
  AND route_trail_count >= 3
ORDER BY route_max_elevation DESC;
```

### 7. Distance + Gain Rate Combinations

```sql
-- Find short but steep routes (5-10km, >100 m/km)
SELECT 
    route_uuid,
    recommended_distance_km,
    route_gain_rate,
    route_difficulty
FROM route_recommendations 
WHERE recommended_distance_km BETWEEN 5 AND 10
  AND route_gain_rate > 100
ORDER BY route_gain_rate DESC;

-- Find long but gentle routes (15+ km, <50 m/km)
SELECT 
    route_uuid,
    recommended_distance_km,
    route_gain_rate,
    route_estimated_time_hours
FROM route_recommendations 
WHERE recommended_distance_km >= 15
  AND route_gain_rate < 50
ORDER BY recommended_distance_km DESC;
```

## API Integration Examples

### Frontend Filter Parameters

```javascript
// Example filter object for frontend
const routeFilters = {
  distance: {
    min: 5,
    max: 15
  },
  routeGainRate: {
    min: 50,
    max: 150
  },
  difficulty: ['moderate', 'hard'],
  trailCount: {
    min: 2,
    max: 5
  },
  elevationRange: {
    min: 2000,
    max: 3500
  },
  estimatedTime: {
    min: 2,
    max: 6
  }
};
```

### Backend Query Builder

```sql
-- Dynamic query based on filter parameters
SELECT 
    route_uuid,
    recommended_distance_km,
    recommended_elevation_gain_rate,
    route_difficulty,
    route_trail_count,
    route_estimated_time_hours
FROM route_recommendations 
WHERE 1=1
  AND (recommended_distance_km BETWEEN $1 AND $2)
  AND (route_gain_rate BETWEEN $3 AND $4)
  AND (route_difficulty = ANY($5))
  AND (route_trail_count BETWEEN $6 AND $7)
  AND (route_estimated_time_hours BETWEEN $8 AND $9)
ORDER BY similarity_score DESC;
```

## Benefits of Parametric Search

1. **Precise Filtering**: Users can specify exact ranges instead of predefined bins
2. **Flexible Combinations**: Multiple criteria can be combined in any way
3. **Real-time Results**: No need to pre-calculate bins for every possible combination
4. **User Control**: Users define their own search parameters
5. **Scalable**: Easy to add new parametric fields without changing the search system

## Performance Considerations

- All parametric fields are indexed for fast querying
- Composite indexes support common filter combinations
- Use `EXPLAIN ANALYZE` to optimize complex queries
- Consider caching frequently used filter combinations 