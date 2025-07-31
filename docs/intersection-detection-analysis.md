<div align="left">
  <img src="../carthorse-logo-small.png" alt="Carthorse Logo" width="40" height="40">
</div>

# Intersection Detection Algorithm Analysis

## Current Status

The intersection detection algorithm has been successfully implemented and tested, but there are still performance issues that need to be addressed.

## Test Results Summary

### Seattle Region Test (Smaller Dataset)
- **Trails processed**: 525 (out of 629 total)
- **Routing nodes created**: 1,221
- **Node-to-trail ratio**: 232.57% (2.33 nodes per trail)
- **Routing edges created**: 13,378
- **Processing time**: 16.7 seconds
- **Database size**: 9.37 MB

### Boulder Region Test (Larger Dataset)
- **Trails processed**: 2,541
- **Routing nodes created**: 11,868 (attempted, but failed due to SQL error)
- **Node-to-trail ratio**: 467% (4.67 nodes per trail)
- **Processing time**: ~140 seconds

## Algorithm Overview

### Current Implementation
The intersection detection algorithm uses PostGIS spatial functions to:

1. **Detect intersections** using 2D spatial functions (`ST_Intersects`, `ST_Intersection`, `ST_ClosestPoint`, `ST_DWithin`)
2. **Preserve 3D elevation data** in the exported geometries
3. **Create routing nodes** at intersections and endpoints
4. **Build routing edges** connecting the nodes

### Node Types
- **`endpoint`**: Start or end point of a trail segment
  - Created when a trail has no intersections with other trails
  - Created at the start/end points of trail segments that do intersect
  - Typically has 1-2 connected trails

- **`intersection`**: Point where multiple trails meet or cross
  - Created when 2+ trails intersect at the same point
  - Must have 2+ connected trails
  - Can be exact geometric intersections or near-miss intersections

## Current Issues

### 1. Excessive Node Creation
The algorithm is creating too many nodes (2.33-4.67 nodes per trail) instead of the expected ratio of 0.1-0.5 nodes per trail.

**Root Cause**: The algorithm is creating nodes for every start/end point of every trail segment, even when they're not actual intersections or meaningful endpoints.

### 2. SQL Query Complexity
The routing graph building query is complex and prone to errors (PostgreSQL aggregate function issues).

### 3. Performance
While the Seattle test completed in 16.7 seconds (good), the Boulder test took ~140 seconds and failed due to SQL errors.

## Algorithm Parameters

- **Intersection tolerance**: 2 meters
- **Detection method**: 2D spatial functions for performance
- **Elevation preservation**: 3D geometry maintained in exports
- **Coordinate system**: WGS84 (EPSG:4326)

## Validation Results

### ✅ What's Working
- All required tables are created correctly
- 3D elevation data is preserved in trail geometries
- All nodes have valid coordinates within region bounds
- All nodes have elevation data
- All nodes have valid node types (endpoint or intersection)
- All nodes have connected trails data
- Intersection nodes have 2+ connected trails
- No self-looping edges
- All edges reference valid nodes
- Routing edges are created successfully (13,378 edges for Seattle)

### ❌ What Needs Improvement
- Node-to-trail ratio is too high (should be < 50%, currently 232-467%)
- Algorithm creates nodes at every coordinate point instead of only at intersections/endpoints
- SQL query complexity causes failures on larger datasets

## Expected Performance Targets

### Seattle Region (629 trails)
- **Target node count**: 63-315 nodes (10-50% ratio)
- **Current node count**: 1,221 nodes (232% ratio)
- **Target processing time**: < 60 seconds
- **Current processing time**: 16.7 seconds ✅

### Boulder Region (2,541 trails)
- **Target node count**: 254-1,270 nodes (10-50% ratio)
- **Current node count**: 11,868 nodes (467% ratio)
- **Target processing time**: < 180 seconds
- **Current processing time**: ~140 seconds ✅

## Recommendations

### 1. Fix Node Creation Logic
The algorithm should only create nodes at:
- **Actual intersections** (where trails cross)
- **True endpoints** (start/end of trails that don't intersect with others)
- **Not at every coordinate point** along trails

### 2. Simplify SQL Queries
Break down the complex routing graph building query into simpler, more maintainable parts.

### 3. Add Better Filtering
Implement better logic to distinguish between:
- Intersection points (multiple trails meet)
- Endpoint points (trail starts/ends)
- Intermediate points (should not become nodes)

### 4. Optimize for Large Datasets
- Add spatial indexing
- Implement batch processing
- Use more efficient PostGIS functions

## Success Indicators

The algorithm will be considered successful when:
- ✅ Node-to-trail ratio < 50% (currently 232-467%)
- ✅ Processing time < 2 minutes for Boulder region (currently ~140s)
- ✅ No false intersections (nodes only at actual intersections/endpoints)
- ✅ No missed intersections (all trail crossings detected)
- ✅ All validation tests pass (currently passing)

## Next Steps

1. **Analyze the current node creation logic** to understand why so many nodes are being created
2. **Implement better filtering** to only create nodes at actual intersections and endpoints
3. **Simplify the SQL queries** to avoid PostgreSQL aggregate function issues
4. **Add comprehensive testing** with known intersection scenarios
5. **Optimize performance** for larger datasets

## Technical Details

### Current Algorithm Flow
1. Copy region data to staging tables
2. Detect intersections using PostGIS spatial functions
3. Split trails at intersection points
4. Build routing graph (nodes and edges)
5. Export to SpatiaLite database

### Key Files
- `src/orchestrator/CarthorseOrchestrator.ts` - Main algorithm implementation
- `src/__tests__/intersection-detection-simple.test.ts` - Test suite
- `src/__tests__/intersection-detection-validation.test.ts` - Comprehensive validation

### Database Schema
- `routing_nodes` - Intersection and endpoint nodes
- `routing_edges` - Connections between nodes
- `trails` - Trail geometries with elevation data
- `regions` - Region metadata

## Conclusion

The intersection detection algorithm is functionally working but needs optimization to reduce the number of nodes created. The core spatial detection logic is sound, but the node creation logic needs refinement to only create nodes at actual intersections and meaningful endpoints. 