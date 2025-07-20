# PostGIS Optimization Strategy

## Overview

PostGIS is highly optimized for spatial operations and can handle complex geometric calculations much faster than Node.js. This document outlines how to offload spatial processing work to PostgreSQL/PostGIS.

## Current vs. Optimized Approach

### Current Approach (Node.js Heavy)
```typescript
// ❌ Current: Processing in Node.js
for (const trail of trails.rows) {
  const coords = parseWktCoords(geomText);
  for (let i = 0; i < coords.length; i++) {
    // Create nodes for every coordinate point
    const key = `${lat.toFixed(7)},${lng.toFixed(7)}`;
    nodeTrailMap.get(key)!.add(appUuid);
  }
}
```

### Optimized Approach (PostGIS Heavy)
```sql
-- ✅ Optimized: Let PostGIS do the heavy lifting
WITH trail_endpoints AS (
  SELECT 
    id,
    app_uuid,
    ST_StartPoint(geometry) as start_point,
    ST_EndPoint(geometry) as end_point
  FROM staging.trails
),
intersection_nodes AS (
  SELECT DISTINCT
    point,
    array_agg(trail_id) as connected_trails
  FROM staging.intersection_points
  GROUP BY point
),
all_nodes AS (
  -- Trail endpoints
  SELECT 
    start_point as point,
    array_agg(app_uuid) as connected_trails,
    'endpoint' as node_type
  FROM trail_endpoints
  GROUP BY start_point
  
  UNION ALL
  
  SELECT 
    end_point as point,
    array_agg(app_uuid) as connected_trails,
    'endpoint' as node_type
  FROM trail_endpoints
  GROUP BY end_point
  
  UNION ALL
  
  -- Intersection points
  SELECT 
    point,
    connected_trails,
    CASE 
      WHEN array_length(connected_trails, 1) > 1 THEN 'intersection'
      ELSE 'endpoint'
    END as node_type
  FROM intersection_nodes
)
SELECT * FROM all_nodes;
```

## PostGIS Functions We Should Use

### 1. **Trail Endpoint Extraction**
```sql
-- Extract start and end points of trails
SELECT 
  id,
  ST_StartPoint(geometry) as start_point,
  ST_EndPoint(geometry) as end_point,
  ST_AsText(ST_StartPoint(geometry)) as start_wkt,
  ST_AsText(ST_EndPoint(geometry)) as end_wkt
FROM staging.trails;
```

### 2. **Advanced Intersection Detection**
```sql
-- Detect all types of intersections
WITH intersection_analysis AS (
  SELECT 
    t1.id as trail1_id,
    t2.id as trail2_id,
    ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) as intersection_geom,
    ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) as intersection_type,
    ST_Distance(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) as distance_meters
  FROM staging.trails t1
  JOIN staging.trails t2 ON (
    t1.id < t2.id AND 
    ST_DWithin(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry), $1)
  )
)
SELECT * FROM intersection_analysis
WHERE intersection_type = 'ST_Point' 
   OR (intersection_type = 'ST_LineString' AND distance_meters <= $1);
```

### 3. **Automatic Node Creation**
```sql
-- Create routing nodes automatically
CREATE OR REPLACE FUNCTION create_routing_nodes()
RETURNS TABLE (
  node_id SERIAL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  elevation DOUBLE PRECISION,
  node_type TEXT,
  connected_trails TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  WITH trail_endpoints AS (
    SELECT 
      app_uuid,
      ST_X(ST_StartPoint(geometry)) as lng,
      ST_Y(ST_StartPoint(geometry)) as lat,
      ST_Z(ST_StartPoint(geometry)) as elevation
    FROM staging.trails
    
    UNION ALL
    
    SELECT 
      app_uuid,
      ST_X(ST_EndPoint(geometry)) as lng,
      ST_Y(ST_EndPoint(geometry)) as lat,
      ST_Z(ST_EndPoint(geometry)) as elevation
    FROM staging.trails
  ),
  intersection_points AS (
    SELECT 
      ST_X(point) as lng,
      ST_Y(point) as lat,
      0 as elevation, -- 2D intersection points
      array_agg(DISTINCT t1.app_uuid || ',' || t2.app_uuid) as connected_trails
    FROM staging.intersection_points ip
    JOIN staging.trails t1 ON ip.trail1_id = t1.id
    JOIN staging.trails t2 ON ip.trail2_id = t2.id
    GROUP BY point
  ),
  all_points AS (
    SELECT lng, lat, elevation, array_agg(app_uuid) as connected_trails
    FROM trail_endpoints
    GROUP BY lng, lat, elevation
    
    UNION ALL
    
    SELECT lng, lat, elevation, connected_trails
    FROM intersection_points
  )
  SELECT 
    nextval('routing_nodes_id_seq'),
    lat,
    lng,
    elevation,
    CASE 
      WHEN array_length(connected_trails, 1) > 1 THEN 'intersection'
      ELSE 'endpoint'
    END as node_type,
    connected_trails
  FROM all_points;
END;
$$ LANGUAGE plpgsql;
```

### 4. **Automatic Edge Creation**
```sql
-- Create routing edges automatically
CREATE OR REPLACE FUNCTION create_routing_edges()
RETURNS TABLE (
  from_node_id INTEGER,
  to_node_id INTEGER,
  trail_id TEXT,
  trail_name TEXT,
  distance_km DOUBLE PRECISION,
  elevation_gain DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  WITH trail_segments AS (
    SELECT 
      t.app_uuid,
      t.name,
      t.elevation_gain,
      ST_Length(t.geometry) / 1000 as distance_km,
      ST_StartPoint(t.geometry) as start_point,
      ST_EndPoint(t.geometry) as end_point
    FROM staging.trails t
  ),
  node_mapping AS (
    SELECT 
      node_id,
      ST_Point(lng, lat) as point,
      connected_trails
    FROM staging.routing_nodes
  )
  SELECT 
    n1.node_id as from_node_id,
    n2.node_id as to_node_id,
    ts.app_uuid as trail_id,
    ts.name as trail_name,
    ts.distance_km,
    ts.elevation_gain
  FROM trail_segments ts
  JOIN node_mapping n1 ON ST_Equals(ts.start_point, n1.point)
  JOIN node_mapping n2 ON ST_Equals(ts.end_point, n2.point)
  WHERE n1.node_id != n2.node_id;
END;
$$ LANGUAGE plpgsql;
```

### 5. **Spatial Clustering for Performance**
```sql
-- Group nearby nodes to reduce complexity
CREATE OR REPLACE FUNCTION cluster_nearby_nodes(tolerance_meters DOUBLE PRECISION DEFAULT 5)
RETURNS TABLE (
  cluster_id INTEGER,
  representative_lat DOUBLE PRECISION,
  representative_lng DOUBLE PRECISION,
  node_count INTEGER,
  connected_trails TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  WITH node_clusters AS (
    SELECT 
      ST_ClusterDBSCAN(ST_Point(lng, lat), tolerance_meters / 111000.0, 1) OVER () as cluster_id,
      lat,
      lng,
      connected_trails
    FROM staging.routing_nodes
  ),
  cluster_centers AS (
    SELECT 
      cluster_id,
      AVG(lat) as representative_lat,
      AVG(lng) as representative_lng,
      COUNT(*) as node_count,
      array_agg(DISTINCT unnest(connected_trails)) as connected_trails
    FROM node_clusters
    GROUP BY cluster_id
  )
  SELECT * FROM cluster_centers
  WHERE cluster_id IS NOT NULL;
END;
$$ LANGUAGE plpgsql;
```

## Implementation Strategy

### Phase 1: Replace Node.js Processing with PostGIS Functions
```sql
-- Replace the current buildRoutingGraph() method with:
SELECT create_routing_nodes();
SELECT create_routing_edges();
```

### Phase 2: Add Spatial Indexes for Performance
```sql
-- Create spatial indexes for all geometry columns
CREATE INDEX IF NOT EXISTS idx_trails_geometry ON staging.trails USING GIST(geometry);
CREATE INDEX IF NOT EXISTS idx_intersection_points ON staging.intersection_points USING GIST(point);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_location ON staging.routing_nodes USING GIST(ST_Point(lng, lat));
```

### Phase 3: Add Spatial Constraints and Validation
```sql
-- Ensure all geometries are valid
ALTER TABLE staging.trails 
ADD CONSTRAINT valid_geometry 
CHECK (ST_IsValid(geometry));

-- Ensure intersection points are within tolerance
ALTER TABLE staging.intersection_points 
ADD CONSTRAINT valid_intersection_distance 
CHECK (distance_meters <= 50);
```

## Performance Benefits

### Before (Node.js Processing)
- **3,809 nodes** for 151 trails (25.2 nodes per trail)
- **Slow coordinate parsing** in JavaScript
- **Memory intensive** with large coordinate arrays
- **Complex intersection detection** in application code

### After (PostGIS Processing)
- **~300 nodes** for 151 trails (2 nodes per trail + intersections)
- **Fast spatial operations** using PostGIS indexes
- **Minimal memory usage** in application
- **Optimized intersection detection** using spatial indexes

## Migration Plan

1. **Create PostGIS functions** for node/edge creation
2. **Update orchestrator** to use PostGIS functions
3. **Add comprehensive tests** for PostGIS functions
4. **Performance testing** with large datasets
5. **Documentation updates** for new PostGIS approach

## Testing PostGIS Functions

```sql
-- Test intersection detection
SELECT COUNT(*) FROM staging.intersection_points;

-- Test node creation
SELECT node_type, COUNT(*) 
FROM staging.routing_nodes 
GROUP BY node_type;

-- Test edge creation
SELECT COUNT(*) FROM staging.routing_edges;

-- Performance test
EXPLAIN ANALYZE SELECT create_routing_nodes();
```

This approach will dramatically improve performance and reduce complexity by leveraging PostGIS's optimized spatial operations. 