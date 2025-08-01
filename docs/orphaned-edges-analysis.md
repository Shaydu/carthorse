# Orphaned Edges Analysis

## Root Cause

The orphaned edges issue stems from the routing graph generation process in `generate_routing_edges_native()`. Here's the problem:

### Current Process
1. **Node Generation**: Nodes are created at trail intersections and endpoints
2. **Edge Generation**: Edges are created by finding the nearest nodes to each trail's start/end points
3. **Tolerance Check**: Uses `ST_DWithin()` with a 1.0 meter tolerance
4. **Strict Requirement**: Edges are only created when BOTH source AND target nodes are found

### The Problem
```sql
-- From generate_routing_edges_native()
WHERE source_node.id IS NOT NULL
  AND target_node.id IS NOT NULL
```

If a trail's start or end point is more than 1.0 meters from any existing node, the edge is **completely skipped**, leaving:
- Orphaned nodes (nodes with no connecting edges)
- Disconnected trail segments
- Incomplete routing graph

## Impact

1. **286 orphaned edges** in the current test data
2. **Disconnected trail segments** that can't be used for routing
3. **Incomplete routing graph** that affects route finding algorithms
4. **Data integrity issues** in the exported SQLite database

## Solutions

### Option 1: Adaptive Tolerance (Recommended)
Increase tolerance dynamically based on trail density:

```sql
-- Adaptive tolerance based on local trail density
CREATE OR REPLACE FUNCTION get_adaptive_tolerance(trail_geometry geometry) 
RETURNS float AS $$
DECLARE
    local_density integer;
    adaptive_tolerance float;
BEGIN
    -- Count nearby trails within 100m
    SELECT COUNT(*) INTO local_density
    FROM trails 
    WHERE ST_DWithin(geometry, trail_geometry, 100);
    
    -- Adaptive tolerance: 1m for dense areas, up to 10m for sparse areas
    adaptive_tolerance := GREATEST(1.0, LEAST(10.0, 20.0 / local_density));
    
    RETURN adaptive_tolerance;
END;
$$ LANGUAGE plpgsql;
```

### Option 2: Create Missing Nodes
When no node is found within tolerance, create a new node:

```sql
-- Modified edge generation with node creation
CROSS JOIN LATERAL (
    SELECT id FROM routing_nodes 
    WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_StartPoint(ec.geometry), $1)
    ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_StartPoint(ec.geometry))
    LIMIT 1
) source_node
CROSS JOIN LATERAL (
    -- If no node found, create one
    SELECT COALESCE(
        (SELECT id FROM routing_nodes 
         WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_StartPoint(ec.geometry), $1)
         ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_StartPoint(ec.geometry))
         LIMIT 1),
        (INSERT INTO routing_nodes (lat, lng, node_type) 
         VALUES (ST_Y(ST_StartPoint(ec.geometry)), ST_X(ST_StartPoint(ec.geometry)), 'endpoint')
         RETURNING id)
    ) as id
) source_node_created
```

### Option 3: Relaxed Edge Creation
Allow edges with only one valid node:

```sql
-- Modified edge creation logic
WHERE (source_node.id IS NOT NULL OR target_node.id IS NOT NULL)
  AND NOT (source_node.id IS NULL AND target_node.id IS NULL)
```

## Recommended Implementation

**Option 1 (Adaptive Tolerance)** is recommended because:
- Maintains data quality by using appropriate tolerances
- Scales with trail density
- Doesn't create unnecessary nodes
- Preserves the existing graph structure

## Testing Strategy

1. **Measure current orphaned edge count**
2. **Implement adaptive tolerance**
3. **Re-run routing graph generation**
4. **Verify orphaned edge reduction**
5. **Ensure routing functionality still works**

## Configuration Changes

Update `configs/carthorse.config.yaml`:

```yaml
postgis:
  processing:
    # Current fixed tolerance
    defaultIntersectionTolerance: 1.0
    
    # New adaptive tolerance settings
    adaptiveToleranceEnabled: true
    minTolerance: 1.0
    maxTolerance: 10.0
    densityThreshold: 5  # trails within 100m
```

## Implementation Plan

1. **Phase 1**: Implement adaptive tolerance function
2. **Phase 2**: Modify edge generation to use adaptive tolerance
3. **Phase 3**: Update tests to expect fewer orphaned edges
4. **Phase 4**: Validate routing functionality
5. **Phase 5**: Deploy to production

## Success Metrics

- **Target**: Reduce orphaned edges by 80% (from 286 to <60)
- **Maintain**: Routing graph connectivity
- **Preserve**: Route finding accuracy
- **Ensure**: No performance degradation 