# Snap-and-Split Approach for Trail Network Creation

## Overview

The snap-and-split approach addresses the requirement: **"we must have 1 and only 1 split at each node location. snap the nodes to the trails first so we get a clean split at every node. if there is already a split under that node, do not split"**.

This approach ensures clean, deterministic trail splitting by:
1. **First snapping nodes to trails** (ensuring nodes are exactly on trail geometries)
2. **Then splitting trails only at those snapped node locations**
3. **Avoiding duplicate splits** at the same location

## Key Components

### 1. SQL Function: `split_trails_at_snapped_nodes`

**File**: `sql/organized/functions/snap-and-split-functions.sql`

This function implements the core logic:

```sql
CREATE OR REPLACE FUNCTION split_trails_at_snapped_nodes(
    staging_schema text,
    tolerance_meters double precision DEFAULT 1.0
) RETURNS TABLE(
    original_count integer,
    split_count integer,
    final_count integer,
    node_count integer
)
```

**Steps**:
1. **Detect intersections** between trails using `ST_Intersection()`
2. **Snap intersection points** to nearest trail vertices within tolerance
3. **Deduplicate nodes** at the same location (ensure exactly 1 node per location)
4. **Split trails** only at unique node locations
5. **Avoid duplicate splits** by checking if a trail is already split at a point

### 2. TypeScript Strategy: `SnapAndSplitStrategy`

**File**: `src/utils/services/network-creation/strategies/snap-and-split-strategy.ts`

This strategy class implements the network creation using the snap-and-split approach:

- Uses the `split_trails_at_snapped_nodes` SQL function
- Creates routing nodes from intersection points
- Creates routing edges from split trails
- Provides detailed statistics and validation

### 3. CLI Command: `snap-and-split`

**File**: `src/cli/snap-and-split.ts`

Command-line interface for testing and using the snap-and-split functionality:

```bash
npm run snap-and-split -- --staging-schema <schema> --tolerance <meters>
npm run snap-and-split:dry-run -- --staging-schema <schema>
```

## How It Works

### Step 1: Intersection Detection
```sql
-- Find all intersection points between trails
SELECT DISTINCT
    ST_Force2D(intersection_point) as point,
    ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids
FROM (
    SELECT (ST_Dump(ST_Intersection(t1.geometry, t2.geometry))).geom as intersection_point
    FROM trails t1 JOIN trails t2 ON t1.id < t2.id
    WHERE ST_Intersects(t1.geometry, t2.geometry)
) AS intersections
```

### Step 2: Node Snapping
```sql
-- Snap intersection points to nearest trail vertices
WITH all_trail_vertices AS (
    SELECT (ST_DumpPoints(t.geometry)).geom as vertex
    FROM trails t
),
snapped_intersections AS (
    SELECT 
        ip.point as original_point,
        -- Find closest trail vertex within tolerance
        (SELECT atv.vertex 
         FROM all_trail_vertices atv
         WHERE ST_DWithin(ip.point, atv.vertex, tolerance)
         ORDER BY ST_Distance(ip.point, atv.vertex)
         LIMIT 1) as snapped_point
    FROM intersection_points ip
)
```

### Step 3: Node Deduplication
```sql
-- Ensure exactly 1 node per location
SELECT DISTINCT ON (node_location_key)
    original_point,
    final_point,
    node_location_key
FROM snapped_nodes
ORDER BY node_location_key, 
         array_length(connected_trail_ids, 1) DESC,
         ST_Distance(original_point, final_point)
```

### Step 4: Trail Splitting
```sql
-- Split trails only at unique node locations
-- Avoid splitting if already split at that point
SELECT 
    t.*,
    un.final_point as split_point
FROM trails t
JOIN unique_nodes un ON (
    t.app_uuid = ANY(un.connected_trail_ids)
    AND ST_DWithin(t.geometry, un.final_point, tolerance)
    AND ST_LineLocatePoint(t.geometry, un.final_point) > 0.001
    AND ST_LineLocatePoint(t.geometry, un.final_point) < 0.999
)
```

## Benefits

### 1. **Deterministic Results**
- Exactly 1 split per node location
- No duplicate splits at the same point
- Consistent results across runs

### 2. **Clean Geometry**
- Nodes are snapped to actual trail vertices
- No floating nodes or misaligned intersections
- Proper topological relationships

### 3. **Performance**
- Efficient intersection detection
- Minimal redundant processing
- Optimized for large trail networks

### 4. **Validation**
- Comprehensive error checking
- Detailed statistics and reporting
- Dry-run capability for testing

## Usage Examples

### Basic Usage
```bash
# Run snap-and-split on staging schema
npm run snap-and-split -- --staging-schema staging_boulder_1754318437837 --tolerance 1.0
```

### Dry Run (Testing)
```bash
# Test without making changes
npm run snap-and-split:dry-run -- --staging-schema staging_boulder_1754318437837
```

### Custom Tolerance
```bash
# Use different tolerance for intersection detection
npm run snap-and-split -- --staging-schema staging_boulder_1754318437837 --tolerance 0.5
```

## Integration

The snap-and-split approach is now the default strategy in the `NetworkCreationService`:

```typescript
export class NetworkCreationService {
  constructor() {
    // Use snap-and-split strategy for proper node snapping and clean splits
    this.strategy = new SnapAndSplitStrategy();
  }
}
```

This ensures that all network creation operations use the improved snap-and-split approach by default.

## Testing

Run the test script to verify the functionality:

```bash
node test-snap-and-split.js
```

This will check that all components are properly installed and the CLI command works correctly.

## Configuration

The approach uses the same tolerance configuration as other network creation methods:

- **Intersection Detection Tolerance**: Distance for detecting intersections (default: 1.0 meters)
- **Edge to Vertex Tolerance**: Distance for snapping edges to vertices (default: 0.001 meters)
- **Minimum Trail Length**: Minimum length for valid trail segments (default: 50 meters)

These can be configured through the `NetworkConfig` interface or CLI parameters.
