# Carthorse API Schema Reference v16.0

## Overview

This document provides a clean reference for the Carthorse SQLite database schema v16.0, designed for frontend API integration. The schema has been simplified to use `trail_count` as the single source of truth for route classification.

## Key Changes in v16.0

- **Removed `route_type`** - No longer using 'single'/'multi' classification
- **Enhanced `trail_count`** - Now the primary field for route classification
- **Simplified classification** - Use `trail_count` values directly:
  - `trail_count = 1` → Single trail route
  - `trail_count > 1` → Multi-trail route
  - `trail_count = 3` → Route uses 3 different trails

## Core Tables

### 1. Trails Table
```sql
CREATE TABLE trails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_uuid TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  length_km REAL NOT NULL,
  elevation_gain REAL NOT NULL,
  elevation_loss REAL NOT NULL,
  max_elevation REAL NOT NULL,
  min_elevation REAL NOT NULL,
  avg_elevation REAL NOT NULL,
  difficulty TEXT,
  surface_type TEXT,
  trail_type TEXT,
  source TEXT,
  geojson TEXT NOT NULL,
  bbox_min_lng REAL,
  bbox_max_lng REAL,
  bbox_min_lat REAL,
  bbox_max_lat REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2. Route Recommendations Table
```sql
CREATE TABLE route_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_uuid TEXT UNIQUE NOT NULL,
  region TEXT NOT NULL,
  input_length_km REAL CHECK(input_length_km > 0),
  input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
  recommended_length_km REAL CHECK(recommended_length_km > 0),
  recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
  route_elevation_loss REAL CHECK(route_elevation_loss >= 0),
  route_score REAL CHECK(route_score >= 0 AND route_score <= 100),
  route_name TEXT,
  route_shape TEXT CHECK(route_shape IN ('loop', 'out-and-back', 'lollipop', 'point-to-point')),
  trail_count INTEGER CHECK(trail_count >= 1),
  route_geometry TEXT NOT NULL,
  route_edges TEXT NOT NULL,
  similarity_score REAL CHECK(similarity_score >= 0 AND similarity_score <= 1),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- Additional fields for enhanced functionality
  input_distance_tolerance REAL CHECK(input_distance_tolerance >= 0),
  input_elevation_tolerance REAL CHECK(input_elevation_tolerance >= 0),
  expires_at DATETIME,
  usage_count INTEGER DEFAULT 0 CHECK(usage_count >= 0),
  complete_route_data TEXT,
  trail_connectivity_data TEXT,
  request_hash TEXT,
  route_gain_rate REAL CHECK(route_gain_rate >= 0),
  route_trail_count INTEGER CHECK(route_trail_count > 0),
  route_max_elevation REAL,
  route_min_elevation REAL,
  route_avg_elevation REAL,
  route_difficulty TEXT,
  route_estimated_time_hours REAL CHECK(route_estimated_time_hours > 0),
  route_connectivity_score REAL CHECK(route_connectivity_score >= 0 AND route_connectivity_score <= 1)
);
```

### 3. Routing Network Tables

#### Routing Nodes
```sql
CREATE TABLE routing_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_uuid TEXT UNIQUE NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  elevation REAL,
  node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
  connected_trails TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### Routing Edges
```sql
CREATE TABLE routing_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source INTEGER NOT NULL,
  target INTEGER NOT NULL,
  trail_id TEXT,
  trail_name TEXT NOT NULL,
  length_km REAL NOT NULL,
  elevation_gain REAL,
  elevation_loss REAL,
  geojson TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## API Query Examples

### Get Routes by Trail Count
```sql
-- Single trail routes
SELECT * FROM route_recommendations WHERE trail_count = 1;

-- Multi-trail routes
SELECT * FROM route_recommendations WHERE trail_count > 1;

-- Routes with specific trail count
SELECT * FROM route_recommendations WHERE trail_count = 3;
```

### Get Routes by Shape and Trail Count
```sql
-- Loop routes with multiple trails
SELECT * FROM route_recommendations 
WHERE route_shape = 'loop' AND trail_count > 1;

-- Out-and-back routes with single trail
SELECT * FROM route_recommendations 
WHERE route_shape = 'out-and-back' AND trail_count = 1;
```

### Get Route Statistics
```sql
-- Route count by trail count
SELECT trail_count, COUNT(*) as route_count 
FROM route_recommendations 
GROUP BY trail_count 
ORDER BY trail_count;

-- Route count by shape and trail count
SELECT route_shape, trail_count, COUNT(*) as route_count 
FROM route_recommendations 
GROUP BY route_shape, trail_count 
ORDER BY route_shape, trail_count;
```

### Get Route with Trail Composition
```sql
-- Get route details with constituent trails
SELECT 
  rr.route_uuid,
  rr.route_name,
  rr.route_shape,
  rr.trail_count,
  rr.recommended_length_km,
  rr.recommended_elevation_gain,
  rr.route_geometry,
  rt.trail_id,
  rt.trail_name,
  rt.segment_order,
  rt.segment_distance_km
FROM route_recommendations rr
LEFT JOIN route_trails rt ON rr.route_uuid = rt.route_uuid
WHERE rr.route_uuid = 'your-route-uuid'
ORDER BY rt.segment_order;
```

## Field Descriptions

### Route Classification Fields
- **`trail_count`**: Number of unique trails used in the route (primary classification field)
- **`route_shape`**: Geometric shape of the route ('loop', 'out-and-back', 'lollipop', 'point-to-point')
- **`route_trail_count`**: Same as `trail_count` (for compatibility)

### Route Data Fields
- **`route_geometry`**: GeoJSON geometry of the route (3D coordinates with elevation)
- **`route_edges`**: JSON array of edge metadata for the route
- **`route_score`**: Quality score (0-100, higher is better)
- **`similarity_score`**: Similarity to input parameters (0-1)

### Route Metrics Fields
- **`recommended_length_km`**: Total route distance in kilometers
- **`recommended_elevation_gain`**: Total elevation gain in meters
- **`route_gain_rate`**: Elevation gain per kilometer (m/km)
- **`route_estimated_time_hours`**: Estimated hiking time in hours

## Performance Considerations

### Key Indexes
- `idx_route_recommendations_trail_count` - Fast filtering by trail count
- `idx_route_recommendations_shape` - Fast filtering by route shape
- `idx_route_recommendations_region` - Fast filtering by region
- `idx_route_recommendations_score` - Fast sorting by quality

### Recommended Query Patterns
1. **Filter by trail count first** - Most selective filter
2. **Add shape filter** - Secondary filter
3. **Sort by score** - Quality ordering
4. **Limit results** - Pagination

## Migration from v15

If migrating from v15, the main changes are:
1. Remove any references to `route_type` field
2. Use `trail_count` for all route classification
3. Update queries to use `trail_count` instead of `route_type`

## Schema Version

Current schema version: **16**
Description: "Carthorse SQLite Export v16.0 (Simplified Route Classification - trail_count only, removed route_type)"
