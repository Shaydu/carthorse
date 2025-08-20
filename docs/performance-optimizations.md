# Performance Optimizations for Carthorse

## Overview
This document outlines the performance optimizations implemented to improve query performance, especially for spatial operations involving trail data.

## Key Performance Issues Identified

### 1. Slow Spatial Distance Queries
- **Problem**: Queries using `ST_Distance` with geography types were running slowly due to lack of proper spatial indexes
- **Impact**: CROSS JOIN operations with 1,000+ trails creating ~1M combinations
- **Solution**: Added geography indexes and optimized query patterns

### 2. Missing Spatial Indexes
- **Problem**: Staging schemas were created without critical spatial indexes
- **Impact**: Every spatial operation required full table scans
- **Solution**: Added comprehensive spatial indexing strategy

## Implemented Optimizations

### 1. Geography Indexes (CRITICAL)
Added geography indexes to staging schema creation in multiple files:

```sql
-- CRITICAL: Geography index for ST_Distance operations (major performance boost)
CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_geography ON ${schemaName}.trails USING gist((geometry::geography));
```

**Files Updated:**
- `src/utils/sql/staging-schema.ts`
- `src/utils/sql/staging-sql-helpers.ts`

### 2. Additional Spatial Indexes
Added comprehensive spatial indexing for common query patterns:

```sql
-- Additional optimization indexes for common spatial query patterns
CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_bbox_spatial ON ${schemaName}.trails USING gist(ST_Envelope(geometry));
CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_centroid ON ${schemaName}.trails USING gist(ST_Centroid(geometry));
CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_startpoint ON ${schemaName}.trails USING gist(ST_StartPoint(geometry));
CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_endpoint ON ${schemaName}.trails USING gist(ST_EndPoint(geometry));
```

### 3. Query Optimization
Optimized the slow trail gap detection query in `src/utils/services/trail-gap-fixing-service.ts`:

**Before (Slow):**
```sql
FROM trail_endpoints t1
CROSS JOIN trail_endpoints t2
WHERE t1.id != t2.id
  AND ST_Distance(t1.end_pt::geography, t2.start_pt::geography) >= $1
  AND ST_Distance(t1.end_pt::geography, t2.start_pt::geography) <= $2
```

**After (Optimized):**
```sql
FROM trail_endpoints t1
JOIN trail_endpoints t2 ON (
  t1.id != t2.id 
  AND ST_DWithin(t1.end_pt::geography, t2.start_pt::geography, $2)  -- Use spatial index for initial filtering
)
WHERE ST_Distance(trail1_end::geography, trail2_start::geography) >= $1
  AND ST_Distance(trail1_end::geography, trail2_start::geography) <= $2
```

## Performance Impact

### Expected Improvements
1. **Geography Distance Queries**: 10-100x faster with geography indexes
2. **Spatial Joins**: 5-20x faster with proper spatial indexing
3. **Trail Gap Detection**: 50-200x faster with optimized query pattern
4. **Overall Processing Time**: 3-10x reduction in processing time

### Before vs After
- **Before**: CROSS JOIN with 1,013 trails = ~1,026,169 combinations
- **After**: Pre-filtered with spatial indexes = ~1,000-10,000 combinations

## Implementation Strategy

### 1. Staging Schema Creation
All new staging schemas will automatically include optimized indexes:
- Geography indexes for distance calculations
- Spatial indexes for common operations
- B-tree indexes for filtering operations

### 2. Query Patterns
Updated query patterns to leverage spatial indexes:
- Use `ST_DWithin` for initial filtering before expensive `ST_Distance` calculations
- Leverage spatial indexes for JOIN operations
- Pre-filter data before applying complex spatial operations

### 3. Index Strategy
- **Geography Indexes**: For distance calculations on curved earth
- **Spatial Indexes**: For geometric operations and spatial joins
- **B-tree Indexes**: For traditional filtering and sorting

## Monitoring and Validation

### Performance Monitoring
Monitor query performance using:
```sql
-- Check active queries
SELECT pid, usename, query_start, query FROM pg_stat_activity WHERE state = 'active';

-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch 
FROM pg_stat_user_indexes WHERE schemaname LIKE 'carthorse_%';
```

### Validation Queries
Test performance improvements with:
```sql
-- Test geography distance query performance
EXPLAIN ANALYZE SELECT ST_Distance(geometry::geography, ST_Point(-105.2, 40.0)::geography) 
FROM carthorse_1755653593916.trails LIMIT 1000;
```

## Future Optimizations

### 1. Query Caching
- Implement query result caching for frequently accessed data
- Cache spatial index results for common operations

### 2. Parallel Processing
- Implement parallel processing for independent spatial operations
- Use PostgreSQL parallel query execution where applicable

### 3. Materialized Views
- Create materialized views for complex spatial aggregations
- Pre-compute common spatial relationships

### 4. Partitioning
- Consider table partitioning for very large datasets
- Partition by geographic regions or time periods

## Maintenance

### Index Maintenance
Regular index maintenance is recommended:
```sql
-- Analyze tables to update statistics
ANALYZE carthorse_1755653593916.trails;

-- Reindex if needed
REINDEX INDEX CONCURRENTLY idx_carthorse_1755653593916_trails_geography;
```

### Performance Monitoring
- Monitor query execution times
- Track index usage statistics
- Alert on slow queries (>30 seconds)

## Conclusion

These optimizations should dramatically improve the performance of spatial operations in the carthorse project, particularly for trail gap detection and other distance-based calculations. The geography indexes alone should provide significant performance improvements for all distance-related queries.
