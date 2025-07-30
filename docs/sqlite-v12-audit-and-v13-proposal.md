# SQLite v12 Schema Audit and v13 Proposal

## Executive Summary

This document presents the audit results of the SQLite v12 schema and proposes changes for v13 to enable proper route type and shape filtering for the recommendation engine.

## v12 Schema Audit Results

### Current State Analysis

#### ✅ **What Works Well in v12:**
- **Deduplication**: Automatic removal of duplicate trails, nodes, and edges
- **Performance**: Optimized indexes for pgRouting structure
- **Data Validation**: CHECK constraints for distances, elevations, and scores
- **Compression**: WAL mode and memory-mapped I/O for large databases
- **Backward Compatibility**: Maintains all v11 functionality

#### ❌ **Critical Issues Found:**

1. **Missing Route Shape Column**
   - `route_shape` column does not exist in v12 schema
   - No way to classify routes as 'loop', 'out-and-back', 'lollipop', 'point-to-point'

2. **Inconsistent Route Type Enforcement**
   - `route_type` exists but has no constraints
   - Current values are inconsistent across different schemas:
     - PostGIS: `['exact_match', 'similar_distance', 'similar_elevation', 'similar_profile', 'custom']`
     - Migration script: `['out-and-back', 'loop', 'lollipop', 'point-to-point']`
     - v12: No constraints (any text value allowed)

3. **No Recommendation Engine Filtering**
   - Cannot filter routes by type ('single' vs 'multi' trail)
   - Cannot filter routes by shape (loop, out-and-back, etc.)
   - Missing indexes for efficient filtering queries

## v13 Schema Proposal

### New Features

#### 1. **Route Type Enforcement**
```sql
route_type TEXT CHECK(route_type IN ('single', 'multi')) NOT NULL
```
- **'single'**: Route uses only one trail
- **'multi'**: Route combines multiple trails

#### 2. **Route Shape Classification**
```sql
route_shape TEXT CHECK(route_shape IN ('loop', 'out-and-back', 'lollipop', 'point-to-point')) NOT NULL
```
- **'loop'**: Route starts and ends at the same point
- **'out-and-back'**: Route goes out and returns on the same path
- **'lollipop'**: Route with a loop at the end of an out-and-back
- **'point-to-point'**: Route from one point to another

#### 3. **Enhanced Filtering Indexes**
```sql
-- Individual filtering indexes
CREATE INDEX idx_route_recommendations_type ON route_recommendations(route_type);
CREATE INDEX idx_route_recommendations_shape ON route_recommendations(route_shape);

-- Combined filtering indexes
CREATE INDEX idx_route_recommendations_type_shape ON route_recommendations(route_type, route_shape);
CREATE INDEX idx_route_recommendations_region_type ON route_recommendations(region, route_type);
CREATE INDEX idx_route_recommendations_region_shape ON route_recommendations(region, route_shape);
CREATE INDEX idx_route_recommendations_region_type_shape ON route_recommendations(region, route_type, route_shape);
```

### Migration Strategy

#### Phase 1: Data Analysis
- Analyze existing `route_recommendations` data
- Determine route type based on trail count in `route_edges`
- Analyze route geometry to determine shape classification

#### Phase 2: Schema Migration
- Create new table with v13 constraints
- Migrate data with proper type and shape classification
- Validate data integrity
- Update schema version

#### Phase 3: Index Optimization
- Create new filtering indexes
- Optimize for recommendation engine queries
- Validate performance improvements

## Recommendation Engine Benefits

### Enhanced Filtering Capabilities

#### Route Type Filtering
```sql
-- Find single-trail routes
SELECT * FROM route_recommendations WHERE route_type = 'single';

-- Find multi-trail routes
SELECT * FROM route_recommendations WHERE route_type = 'multi';
```

#### Route Shape Filtering
```sql
-- Find loop routes
SELECT * FROM route_recommendations WHERE route_shape = 'loop';

-- Find out-and-back routes
SELECT * FROM route_recommendations WHERE route_shape = 'out-and-back';

-- Find lollipop routes
SELECT * FROM route_recommendations WHERE route_shape = 'lollipop';

-- Find point-to-point routes
SELECT * FROM route_recommendations WHERE route_shape = 'point-to-point';
```

#### Combined Filtering
```sql
-- Find single-trail loops
SELECT * FROM route_recommendations 
WHERE route_type = 'single' AND route_shape = 'loop';

-- Find multi-trail out-and-back routes
SELECT * FROM route_recommendations 
WHERE route_type = 'multi' AND route_shape = 'out-and-back';
```

### Performance Improvements

#### Query Performance
- **Indexed filtering**: All route type and shape queries use indexes
- **Combined indexes**: Efficient multi-column filtering
- **Region-based filtering**: Optimized for geographic queries

#### Recommendation Engine
- **Precise matching**: Filter by exact route characteristics
- **User preferences**: Support for user-defined route type/shape preferences
- **Efficient queries**: Fast filtering for large recommendation datasets

## Implementation Plan

### 1. Schema Creation
- [x] Create `carthorse-sqlite-schema-v13.sql`
- [x] Add route type and shape constraints
- [x] Add filtering indexes
- [x] Maintain all v12 optimizations

### 2. Migration Script
- [x] Create `migrate-v12-to-v13-route-enforcement.js`
- [x] Implement route analysis logic
- [x] Add data validation
- [x] Include backup and rollback functionality

### 3. Testing Strategy
- [ ] Test migration script on sample data
- [ ] Validate data integrity after migration
- [ ] Test filtering performance
- [ ] Verify recommendation engine integration

### 4. Deployment
- [ ] Run migration on test databases
- [ ] Validate results
- [ ] Deploy to production
- [ ] Monitor performance

## Data Classification Logic

### Route Type Classification
```javascript
function determineRouteType(routeEdges) {
  const edgesData = JSON.parse(routeEdges);
  return edgesData.length === 1 ? 'single' : 'multi';
}
```

### Route Shape Classification
```javascript
function analyzeRouteShape(routePath, routeEdges) {
  const pathData = JSON.parse(routePath);
  const edgesData = JSON.parse(routeEdges);
  const trailCount = edgesData.length;
  
  if (trailCount === 1) {
    // Single trail analysis
    const coordinates = pathData.coordinates || [];
    const start = coordinates[0];
    const end = coordinates[coordinates.length - 1];
    const distance = calculateDistance(start, end);
    
    return distance < 0.001 ? 'loop' : 'out-and-back';
  } else {
    // Multi-trail analysis
    const coordinates = pathData.coordinates || [];
    const start = coordinates[0];
    const end = coordinates[coordinates.length - 1];
    const distance = calculateDistance(start, end);
    
    if (distance < 0.001) return 'loop';
    if (trailCount === 2) return 'out-and-back';
    return 'lollipop';
  }
}
```

## Validation Queries

### Data Integrity Checks
```sql
-- Check for invalid route types
SELECT COUNT(*) FROM route_recommendations 
WHERE route_type NOT IN ('single', 'multi');

-- Check for invalid route shapes
SELECT COUNT(*) FROM route_recommendations 
WHERE route_shape NOT IN ('loop', 'out-and-back', 'lollipop', 'point-to-point');

-- Check for null values
SELECT COUNT(*) FROM route_recommendations 
WHERE route_type IS NULL OR route_shape IS NULL;
```

### Distribution Analysis
```sql
-- Route type distribution
SELECT route_type, COUNT(*) as count 
FROM route_recommendations 
GROUP BY route_type;

-- Route shape distribution
SELECT route_shape, COUNT(*) as count 
FROM route_recommendations 
GROUP BY route_shape;

-- Combined distribution
SELECT route_type, route_shape, COUNT(*) as count 
FROM route_recommendations 
GROUP BY route_type, route_shape;
```

## Conclusion

The v13 schema proposal addresses the critical gaps in the v12 schema by:

1. **Adding route shape classification** for proper route categorization
2. **Enforcing route type constraints** for consistent data
3. **Optimizing indexes** for efficient recommendation engine filtering
4. **Maintaining all v12 optimizations** while adding new functionality

This enhancement will enable the recommendation engine to provide more precise and relevant route suggestions based on user preferences for route type and shape.

## Files Created

1. **`sql/schemas/carthorse-sqlite-schema-v13.sql`** - New schema with route enforcement
2. **`scripts/migrate-v12-to-v13-route-enforcement.js`** - Migration script
3. **`docs/sqlite-v12-audit-and-v13-proposal.md`** - This audit document

## Next Steps

1. **Review and approve** the v13 schema changes
2. **Test migration script** on sample data
3. **Deploy to test environment** for validation
4. **Update recommendation engine** to use new filtering capabilities
5. **Monitor performance** and user feedback 