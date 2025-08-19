# T/Y Intersection Edge Cases Analysis

## Problem Summary

Your Layer 1 processing is successfully detecting and splitting most T/Y intersections, but there are specific edge cases that are being missed, causing disconnected components in the network.

## Root Cause Analysis

### 1. Data Corruption Issue
- **112 edges** have corrupted data with `undefined` source/target values
- This indicates a bug in the component assignment process
- These corrupted edges are preventing proper connectivity analysis

### 2. Near-Miss Intersection Detection
- Current logic only detects **exact geometric intersections**
- Missing **near-miss intersections** where trails are close but don't exactly intersect
- Connector trails (like "6th Street Connector") are not being properly detected

### 3. Tolerance Issues
- Current intersection tolerance is too strict (1-2 meters)
- Should be increased to 3-5 meters for edge cases
- Connector trails need even higher tolerance (6-10 meters)

## Specific Edge Cases Identified

### Edge Case 1: Connector Trail Intersections
```
6th Street Connector Segment 1 (Component 1) ↔ Flagstaff Trail Segment 1 (Component 12)
```
- **Issue**: Connector trails should bridge different components
- **Cause**: Near-miss detection not implemented
- **Solution**: Special handling for trails with "connector" or "spur" in name

### Edge Case 2: Near-Miss Intersections
- Trails that are within 2-5 meters but don't exactly intersect
- Current logic: `ST_Intersects()` only
- Needed: `ST_DWithin()` for proximity detection

### Edge Case 3: Component Assignment Corruption
- 112 edges with undefined component values
- Prevents proper connectivity analysis
- Need to fix component assignment logic

## Solution: Enhanced T/Y Intersection Detection

### Key Improvements

1. **Enhanced Intersection Detection**
   ```sql
   -- Exact intersections (existing)
   WHERE ST_Intersects(t1.geometry, t2.geometry)
   
   -- Near-miss intersections (new)
   WHERE ST_DWithin(t1.geometry::geography, t2.geometry::geography, tolerance_meters)
   
   -- Connector trail intersections (new)
   WHERE (LOWER(t1.name) LIKE '%connector%' OR LOWER(t2.name) LIKE '%connector%')
   ```

2. **Increased Tolerance**
   - Default tolerance: 3.0 meters (up from 1-2 meters)
   - Connector trails: 6.0 meters (2x tolerance)
   - Minimum trail length: 2 meters (down from 5 meters)

3. **Special Connector Trail Handling**
   - Higher tolerance for trails with "connector" or "spur" in name
   - Ensures connector trails are properly detected and split

4. **Component Validation**
   - New function to validate component connectivity
   - Identifies isolated components after splitting
   - Ensures routing graph can be built

## Implementation Steps

### Step 1: Install Enhanced Functions
```sql
-- Run the enhanced T/Y intersection detection functions
\i fix-ty-intersection-edge-cases.sql
```

### Step 2: Apply Enhanced Detection
```sql
-- Run enhanced detection on staging schema
SELECT * FROM detect_and_split_ty_intersection_edge_cases('staging_schema_name', 3.0);
```

### Step 3: Validate Results
```sql
-- Check component connectivity
SELECT * FROM validate_component_connectivity('staging_schema_name');
```

### Step 4: Regenerate Network
```sql
-- Regenerate routing nodes and edges
-- (This will be done automatically by your Layer 2 processing)
```

## Expected Results

After applying the enhanced T/Y intersection detection:

1. **Reduced Component Count**: Should go from 4 components to 1-2 components
2. **Eliminated "Undefined" Component**: All edges should have valid component assignments
3. **Connected Network**: All trails should be properly connected
4. **Improved Routing**: Routing graph should span the entire network

## Monitoring and Validation

### Success Metrics
- [ ] No "undefined" component edges
- [ ] Single connected component (or minimal disconnected components)
- [ ] All connector trails properly connected
- [ ] Routing graph can be built successfully

### Validation Queries
```sql
-- Check component distribution
SELECT edge_component, COUNT(*) 
FROM staging.routing_edges 
GROUP BY edge_component 
ORDER BY edge_component;

-- Check for undefined components
SELECT COUNT(*) 
FROM staging.routing_edges 
WHERE edge_component IS NULL OR edge_component = 'undefined';

-- Validate connectivity
SELECT * FROM validate_component_connectivity('staging');
```

## Next Steps

1. **Apply the enhanced functions** to your staging environment
2. **Test with a small dataset** first to validate the approach
3. **Monitor the results** using the validation queries
4. **Adjust tolerance values** if needed based on your specific data
5. **Integrate into your Layer 1 processing** pipeline

This solution specifically addresses the edge cases where T/Y intersections are being missed while maintaining the existing functionality for exact intersections.
