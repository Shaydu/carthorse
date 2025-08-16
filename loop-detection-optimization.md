# Loop Detection Optimization Analysis

## Current Performance Issues

### 1. **Network Size Problem**
- **Issue**: 5,922 edges is too large for `pgr_hawickcircuits()` 
- **Impact**: Server crashes when trying to find all cycles
- **Solution**: Use targeted loop detection instead of exhaustive search

### 2. **Missing Critical Indexes**
- **Issue**: No indexes on `source`, `target`, `length_km`, `trail_name`
- **Impact**: Slow joins and filtering operations
- **Solution**: Add composite indexes for common query patterns

### 3. **Inefficient Query Patterns**
- **Issue**: Multiple subqueries calculating connection counts
- **Impact**: O(n²) complexity for node analysis
- **Solution**: Pre-compute connection counts and cache results

## Optimization Strategy

### Phase 1: Database Indexes (Immediate Impact)

```sql
-- Critical indexes for routing queries
CREATE INDEX CONCURRENTLY idx_routing_edges_source_target 
ON staging_boulder_1755370137573.routing_edges(source, target);

CREATE INDEX CONCURRENTLY idx_routing_edges_length_km 
ON staging_boulder_1755370137573.routing_edges(length_km) 
WHERE length_km <= 2.0;

CREATE INDEX CONCURRENTLY idx_routing_edges_trail_name 
ON staging_boulder_1755370137573.routing_edges(trail_name);

-- Index for connection count queries
CREATE INDEX CONCURRENTLY idx_routing_edges_source_target_combined 
ON staging_boulder_1755370137573.routing_edges(source, target, id);

-- Spatial index for distance calculations
CREATE INDEX CONCURRENTLY idx_routing_nodes_lat_lng 
ON staging_boulder_1755370137573.routing_nodes(lat, lng);
```

### Phase 2: Pre-computed Connection Counts

```sql
-- Add connection_count column to routing_nodes
ALTER TABLE staging_boulder_1755370137573.routing_nodes 
ADD COLUMN connection_count INTEGER DEFAULT 0;

-- Update connection counts
UPDATE staging_boulder_1755370137573.routing_nodes 
SET connection_count = (
  SELECT COUNT(*) 
  FROM staging_boulder_1755370137573.routing_edges 
  WHERE source = routing_nodes.id OR target = routing_nodes.id
);

-- Index the connection count
CREATE INDEX CONCURRENTLY idx_routing_nodes_connection_count 
ON staging_boulder_1755370137573.routing_nodes(connection_count);
```

### Phase 3: Targeted Loop Detection

Instead of `pgr_hawickcircuits()` (which finds ALL cycles), use:

1. **Anchor-based loop detection**: Start from high-degree nodes
2. **Distance-bounded search**: Limit search radius
3. **Trail-specific targeting**: Focus on known trail combinations

### Phase 4: Query Optimization

#### Current Inefficient Query:
```sql
-- O(n²) complexity - calculates connection count for each node
SELECT rn.id as node_id,
       (SELECT COUNT(*) FROM routing_edges WHERE source = rn.id OR target = rn.id) as connection_count
FROM routing_nodes rn
WHERE (SELECT COUNT(*) FROM routing_edges WHERE source = rn.id OR target = rn.id) >= 3
```

#### Optimized Query:
```sql
-- O(n) complexity - uses pre-computed connection_count
SELECT id as node_id, connection_count
FROM routing_nodes 
WHERE connection_count >= 3
ORDER BY connection_count DESC
```

## Implementation Plan

### Step 1: Add Critical Indexes
```sql
-- Execute these immediately for performance boost
CREATE INDEX CONCURRENTLY idx_routing_edges_source_target 
ON staging_boulder_1755370137573.routing_edges(source, target);

CREATE INDEX CONCURRENTLY idx_routing_edges_length_km 
ON staging_boulder_1755370137573.routing_edges(length_km) 
WHERE length_km <= 2.0;
```

### Step 2: Pre-compute Connection Counts
```sql
-- Add and populate connection_count column
ALTER TABLE staging_boulder_1755370137573.routing_nodes 
ADD COLUMN connection_count INTEGER DEFAULT 0;

UPDATE staging_boulder_1755370137573.routing_nodes 
SET connection_count = (
  SELECT COUNT(*) 
  FROM staging_boulder_1755370137573.routing_edges 
  WHERE source = routing_nodes.id OR target = routing_nodes.id
);
```

### Step 3: Implement Targeted Loop Detection
- Focus on Bear Canyon Trail area specifically
- Use `pgr_dijkstra()` for path finding between known trail endpoints
- Limit search to reasonable distance bounds (5-15km)

### Step 4: Optimize SQL Queries
- Replace subqueries with joins
- Use pre-computed connection counts
- Add spatial bounding box filters

## Expected Performance Improvements

1. **Indexes**: 10-100x faster joins and filtering
2. **Pre-computed counts**: 100-1000x faster node analysis
3. **Targeted search**: Avoid exponential complexity of exhaustive cycle search
4. **Query optimization**: 5-10x faster overall loop detection

## Bear Canyon Loop Specific Strategy

1. **Identify key nodes**: Find nodes connected to Bear Canyon, Bear Peak West Ridge, Fern Canyon
2. **Bounded search**: Use 10km radius around Bear Canyon area
3. **Trail combination targeting**: Look specifically for loops containing these 3 trails
4. **Progressive expansion**: Start small, expand search area if needed
