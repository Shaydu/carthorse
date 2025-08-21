# Vertex-Based Trail Splitting Solution

## Problem Description

The original trail splitting approach had a critical flaw: **trails were running through nodes instead of stopping at them**, creating tiny segments (0.000014 km) that made routing impossible. This happened because:

1. **Current Issue**: `ST_Split()` creates segments that pass through intersection points rather than stopping at them
2. **Network Creation**: `pgr_createTopology()` creates nodes at endpoints but doesn't properly split trails at intersection vertices
3. **Result**: Edges with near-zero length that break routing algorithms

## Solution Overview

The new **vertex-based splitting approach** solves this by:

1. **Extracting all vertices** from trail geometries
2. **Finding intersection vertices** (vertices shared by multiple trails)
3. **Splitting trails at intersection vertices** to create proper segments
4. **Deduplicating overlapping segments**
5. **Creating a proper routing network** where edges stop at nodes

## Implementation

### Layer 1: Vertex-Based Splitting (`VertexBasedSplittingService`)

```typescript
// Step 1: Extract all vertices from trail geometries
CREATE TABLE trail_vertices AS
WITH vertex_dump AS (
  SELECT 
    t.id as trail_id,
    t.app_uuid as trail_uuid,
    t.name as trail_name,
    (ST_DumpPoints(t.geometry)).geom as vertex_point,
    (ST_DumpPoints(t.geometry)).path[1] as vertex_order
  FROM trails t
  WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
)

// Step 2: Find intersection vertices (vertices that appear in multiple trails)
CREATE TABLE intersection_vertices AS
WITH vertex_clusters AS (
  SELECT 
    ST_SnapToGrid(vertex_point, 0.00001) as snapped_point,
    COUNT(DISTINCT trail_uuid) as trail_count,
    ARRAY_AGG(DISTINCT trail_uuid) as connected_trails
  FROM trail_vertices
  GROUP BY ST_SnapToGrid(vertex_point, 0.00001)
  HAVING COUNT(DISTINCT trail_uuid) > 1
)

// Step 3: Split trails at intersection vertices
// Step 4: Deduplicate segments by geometry
// Step 5: Replace original trails with split segments
```

### Layer 2: Vertex-Based Network Creation (`VertexBasedNetworkStrategy`)

```typescript
// Step 1: Extract unique vertices from trail endpoints
CREATE TABLE network_vertices AS
WITH all_endpoints AS (
  SELECT ST_StartPoint(geom) as vertex_point FROM trails_2d
  UNION
  SELECT ST_EndPoint(geom) as vertex_point FROM trails_2d
),
unique_vertices AS (
  SELECT 
    ST_SnapToGrid(vertex_point, 0.00001) as snapped_vertex,
    COUNT(*) as usage_count
  FROM all_endpoints
  GROUP BY ST_SnapToGrid(vertex_point, 0.00001)
)

// Step 2: Create edges that connect vertices
CREATE TABLE network_edges AS
WITH trail_vertex_mapping AS (
  SELECT 
    t.id as trail_id,
    t.app_uuid as trail_uuid,
    t.name as trail_name,
    t.geom as trail_geom,
    v1.id as start_vertex_id,
    v2.id as end_vertex_id
  FROM trails_2d t
  JOIN network_vertices v1 ON ST_DWithin(ST_StartPoint(t.geom), v1.geom, 0.001)
  JOIN network_vertices v2 ON ST_DWithin(ST_EndPoint(t.geom), v2.geom, 0.001)
  WHERE v1.id != v2.id  -- Avoid self-loops
)

// Step 3: Populate routing_nodes and routing_edges tables
```

## Key Benefits

### 1. **Proper Node/Edge Relationships**
- Edges now stop at nodes instead of running through them
- No more tiny segments that break routing
- Clean network topology for routing algorithms

### 2. **Accurate Intersection Detection**
- Uses actual trail vertices for intersection detection
- Handles complex intersection patterns (T, Y, X intersections)
- Preserves trail geometry integrity

### 3. **Efficient Deduplication**
- Removes overlapping segments automatically
- Maintains trail connectivity while eliminating redundancy
- Reduces network complexity

### 4. **Scalable Architecture**
- Separates concerns: splitting (Layer 1) vs network creation (Layer 2)
- Uses strategy pattern for different network creation approaches
- Easy to extend and modify

## Configuration

The solution uses configurable tolerances:

```typescript
const networkConfig = {
  stagingSchema: stagingSchema,
  tolerances: {
    intersectionDetectionTolerance: 0.00001,  // ~1m in degrees
    edgeToVertexTolerance: 0.001,             // ~100m in degrees
    graphAnalysisTolerance: 0.00001,          // ~1m in degrees
    trueLoopTolerance: 0.00001,               // ~1m in degrees
    minTrailLengthMeters: 50,                 // Minimum trail length
    maxTrailLengthMeters: 100000              // Maximum trail length
  }
};
```

## Testing

Use the test script to verify the solution:

```bash
node test-vertex-based-splitting.js
```

This will:
1. Apply vertex-based splitting to trails
2. Create the routing network
3. Verify edge lengths (should be > 1m)
4. Check network connectivity

## Migration Path

1. **Update Layer 1**: Replace old intersection splitting with `VertexBasedSplittingService`
2. **Update Layer 2**: Replace pgRouting network creation with `VertexBasedNetworkStrategy`
3. **Update Orchestrator**: Use new services in the processing pipeline
4. **Test**: Verify routing works correctly with proper edge lengths

## Expected Results

After implementing this solution:

- ✅ **No tiny edges**: All edges should be > 1m in length
- ✅ **Proper connectivity**: Nodes and edges form a valid routing network
- ✅ **Accurate routing**: Routing algorithms can find valid paths
- ✅ **Preserved geometry**: Trail shapes and relationships maintained
- ✅ **Efficient processing**: Faster network creation and routing

This solution addresses the root cause of the routing issues by ensuring trails are properly split at intersection vertices and creating a clean network topology for routing algorithms.
