# PostgreSQL Database Constraints

This document describes the comprehensive constraints system implemented for the PostgreSQL master database to ensure data integrity.

## Overview

With the migration from SQLite/SpatiaLite to PostgreSQL/PostGIS, we now have the ability to enforce strict data integrity constraints at the database level. This ensures that all trail data is complete, valid, and consistent.

## Key Constraints Implemented

### 1. NOT NULL Constraints
- **`app_uuid`**: Every trail must have a unique identifier
- **`name`**: Every trail must have a name
- **`geometry`**: Every trail must have 3D geometry data
- **`region`**: Every trail must be assigned to a region

### 2. CHECK Constraints

#### Trail Data Validation
```sql
-- Length must be positive
CHECK (length_km IS NULL OR length_km > 0)

-- Elevation values must be non-negative
CHECK (elevation_gain IS NULL OR elevation_gain >= 0)
CHECK (elevation_loss IS NULL OR elevation_loss >= 0)

-- Elevation ranges must be valid
CHECK (max_elevation IS NULL OR max_elevation >= -1000)
CHECK (min_elevation IS NULL OR min_elevation >= -1000)
CHECK (avg_elevation IS NULL OR avg_elevation >= -1000)
```

#### Geometry Validation
```sql
-- Must be 3D LineString geometry
CHECK (geometry IS NULL OR 
       (ST_NDims(geometry) = 3 AND ST_GeometryType(geometry) = 'ST_LineString'))

-- Geometry must be valid
CHECK (geometry IS NULL OR ST_IsValid(geometry))

-- Must have at least 2 points
CHECK (geometry IS NULL OR ST_NPoints(geometry) >= 2)
```

#### Bounding Box Validation
```sql
-- BBox coordinates must be consistent
CHECK (
  (bbox_min_lng IS NULL AND bbox_max_lng IS NULL AND bbox_min_lat IS NULL AND bbox_max_lat IS NULL) OR
  (bbox_min_lng IS NOT NULL AND bbox_max_lng IS NOT NULL AND bbox_min_lat IS NOT NULL AND bbox_max_lat IS NOT NULL AND
   bbox_min_lng < bbox_max_lng AND bbox_min_lat < bbox_max_lat)
)
```

#### Elevation Data Consistency
```sql
-- Elevation values must be logically consistent
CHECK (
  (max_elevation IS NULL AND min_elevation IS NULL AND avg_elevation IS NULL) OR
  (max_elevation IS NOT NULL AND min_elevation IS NOT NULL AND avg_elevation IS NOT NULL AND
   max_elevation >= min_elevation AND avg_elevation BETWEEN min_elevation AND max_elevation)
)
```

#### Categorical Data Validation
```sql
-- Surface types must be valid
CHECK (surface IS NULL OR surface IN (
  'dirt', 'gravel', 'paved', 'concrete', 'asphalt', 'wood', 'metal', 'stone', 
  'grass', 'sand', 'mud', 'snow', 'ice', 'unknown'
))

-- Trail types must be valid
CHECK (trail_type IS NULL OR trail_type IN (
  'hiking', 'biking', 'running', 'walking', 'climbing', 'skiing', 'snowshoeing',
  'horseback', 'motorized', 'mixed', 'unknown'
))

-- Difficulty levels must be valid
CHECK (difficulty IS NULL OR difficulty IN (
  'easy', 'moderate', 'difficult', 'expert', 'unknown'
))

-- Regions must be valid
CHECK (region IN ('boulder', 'seattle', 'test'))
```

### 3. UNIQUE Constraints
- **`app_uuid`**: Each trail must have a unique UUID
- **`osm_id`**: Each trail must have a unique OSM ID

### 4. Foreign Key Constraints
- **Routing edges** must reference valid trails and nodes
- **Elevation points** have unique coordinate combinations

## Automatic Triggers

### 1. Data Completeness Validation
```sql
CREATE TRIGGER trigger_validate_trail_completeness
  BEFORE INSERT OR UPDATE ON trails
  FOR EACH ROW
  EXECUTE FUNCTION validate_trail_completeness();
```

This trigger ensures:
- Complete trails have all required elevation data
- 3D geometry has valid elevation data
- Bounding box is calculated if geometry exists
- Length is calculated if geometry exists

### 2. Auto-Calculation Triggers
```sql
-- Auto-calculate bounding box from geometry
CREATE TRIGGER trigger_auto_calculate_bbox
  BEFORE INSERT OR UPDATE ON trails
  FOR EACH ROW
  EXECUTE FUNCTION auto_calculate_bbox();

-- Auto-calculate length from geometry
CREATE TRIGGER trigger_auto_calculate_length
  BEFORE INSERT OR UPDATE ON trails
  FOR EACH ROW
  EXECUTE FUNCTION auto_calculate_length();
```

### 3. Routing Consistency Validation
```sql
CREATE TRIGGER trigger_validate_routing_edge_consistency
  BEFORE INSERT OR UPDATE ON routing_edges
  FOR EACH ROW
  EXECUTE FUNCTION validate_routing_edge_consistency();
```

## Monitoring Views

### 1. Incomplete Trails View
```sql
CREATE VIEW incomplete_trails AS
SELECT 
  id, app_uuid, name, region,
  CASE 
    WHEN geometry IS NULL THEN 'Missing geometry'
    WHEN elevation_gain IS NULL THEN 'Missing elevation_gain'
    WHEN max_elevation IS NULL THEN 'Missing max_elevation'
    WHEN min_elevation IS NULL THEN 'Missing min_elevation'
    WHEN avg_elevation IS NULL THEN 'Missing avg_elevation'
    WHEN length_km IS NULL OR length_km <= 0 THEN 'Missing or invalid length'
    WHEN bbox_min_lng IS NULL THEN 'Missing bbox'
    ELSE 'Other'
  END as missing_data
FROM trails
WHERE geometry IS NULL 
   OR elevation_gain IS NULL 
   OR max_elevation IS NULL 
   OR min_elevation IS NULL 
   OR avg_elevation IS NULL
   OR length_km IS NULL 
   OR length_km <= 0
   OR bbox_min_lng IS NULL;
```

### 2. 2D Geometry Detection
```sql
CREATE VIEW trails_with_2d_geometry AS
SELECT 
  id, app_uuid, name, region,
  ST_NDims(geometry) as dimensions,
  ST_GeometryType(geometry) as geometry_type
FROM trails
WHERE geometry IS NOT NULL AND ST_NDims(geometry) = 2;
```

### 3. Invalid Geometry Detection
```sql
CREATE VIEW invalid_geometries AS
SELECT 
  id, app_uuid, name, region,
  ST_IsValidReason(geometry) as validity_reason
FROM trails
WHERE geometry IS NOT NULL AND NOT ST_IsValid(geometry);
```

### 4. Inconsistent Elevation Data
```sql
CREATE VIEW inconsistent_elevation_data AS
SELECT 
  id, app_uuid, name, region,
  max_elevation, min_elevation, avg_elevation, elevation_gain,
  CASE 
    WHEN max_elevation < min_elevation THEN 'max_elevation < min_elevation'
    WHEN avg_elevation < min_elevation THEN 'avg_elevation < min_elevation'
    WHEN avg_elevation > max_elevation THEN 'avg_elevation > max_elevation'
    ELSE 'Other'
  END as inconsistency_type
FROM trails
WHERE max_elevation IS NOT NULL 
  AND min_elevation IS NOT NULL 
  AND avg_elevation IS NOT NULL
  AND (max_elevation < min_elevation 
       OR avg_elevation < min_elevation 
       OR avg_elevation > max_elevation);
```

## Integrity Check Function

```sql
CREATE OR REPLACE FUNCTION check_database_integrity()
RETURNS TABLE (
  check_name TEXT,
  status TEXT,
  count BIGINT,
  details TEXT
) AS $$
BEGIN
  -- Check incomplete trails
  RETURN QUERY
  SELECT 
    'Incomplete Trails'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
    COUNT(*),
    'Trails missing required data'::TEXT
  FROM incomplete_trails;
  
  -- Check 2D geometries
  RETURN QUERY
  SELECT 
    '2D Geometries'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END::TEXT,
    COUNT(*),
    'Trails with 2D geometry (should be 3D)'::TEXT
  FROM trails_with_2d_geometry;
  
  -- Check invalid geometries
  RETURN QUERY
  SELECT 
    'Invalid Geometries'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
    COUNT(*),
    'Trails with invalid geometry'::TEXT
  FROM invalid_geometries;
  
  -- Check inconsistent elevation data
  RETURN QUERY
  SELECT 
    'Inconsistent Elevation'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
    COUNT(*),
    'Trails with inconsistent elevation data'::TEXT
  FROM inconsistent_elevation_data;
  
  -- Check orphaned routing edges
  RETURN QUERY
  SELECT 
    'Orphaned Routing Edges'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
    COUNT(*),
    'Routing edges referencing non-existent trails'::TEXT
  FROM routing_edges re
  WHERE NOT EXISTS (SELECT 1 FROM trails t WHERE t.app_uuid = re.trail_id);
END;
$$ LANGUAGE plpgsql;
```

## Usage

### 1. Apply Constraints to Existing Database
```bash
# Check what constraints would be applied (dry run)
npx ts-node carthorse-apply-constraints.ts --db trail_master_db --dry-run

# Apply constraints safely (will fail if data conflicts)
npx ts-node carthorse-apply-constraints.ts --db trail_master_db

# Apply constraints forcefully (may cause errors)
npx ts-node carthorse-apply-constraints.ts --db trail_master_db --force
```

### 2. Check Database Integrity
```sql
-- Run comprehensive integrity check
SELECT * FROM check_database_integrity();

-- Check specific issues
SELECT * FROM incomplete_trails;
SELECT * FROM trails_with_2d_geometry;
SELECT * FROM invalid_geometries;
SELECT * FROM inconsistent_elevation_data;
```

### 3. Integration with Master Database Builder
The constraints are automatically applied during the master database build process:

```typescript
// In carthorse-master-db-builder.ts
async buildMasterDatabase(): Promise<void> {
  // ... build database ...
  
  // Apply data integrity constraints
  await this.applyConstraints();
  
  // ... show statistics ...
}
```

## Benefits

### 1. Data Quality Assurance
- Ensures all trails have complete elevation data
- Validates geometry integrity
- Prevents inconsistent elevation values
- Enforces valid categorical data

### 2. Performance Optimization
- Spatial indexes on geometry columns
- Efficient constraint checking
- Automatic calculation of derived values

### 3. Error Prevention
- Catches data issues at insertion time
- Prevents orphaned references
- Ensures referential integrity

### 4. Monitoring and Debugging
- Clear views for identifying issues
- Comprehensive integrity checking
- Detailed error reporting

## Migration Considerations

### From SQLite/SpatiaLite
- SQLite had limited constraint support
- SpatiaLite provided basic spatial validation
- No automatic triggers or views

### To PostgreSQL/PostGIS
- Full constraint system with CHECK constraints
- Automatic triggers for data validation
- Comprehensive monitoring views
- Spatial integrity enforcement

## Future Enhancements

### 1. Additional Constraints
- Trail length minimum/maximum thresholds
- Elevation gain/loss ratio validation
- Surface type consistency by region
- Difficulty level validation

### 2. Performance Optimizations
- Partial indexes for constraint checking
- Materialized views for complex queries
- Parallel constraint validation

### 3. Monitoring and Alerting
- Automated integrity reports
- Email notifications for constraint violations
- Integration with monitoring systems

## Troubleshooting

### Common Constraint Violations

1. **Missing Elevation Data**
   ```sql
   -- Find trails missing elevation data
   SELECT * FROM incomplete_trails WHERE missing_data LIKE '%elevation%';
   ```

2. **Invalid Geometry**
   ```sql
   -- Find and fix invalid geometries
   SELECT * FROM invalid_geometries;
   UPDATE trails SET geometry = ST_MakeValid(geometry) WHERE NOT ST_IsValid(geometry);
   ```

3. **2D Geometry**
   ```sql
   -- Convert 2D to 3D geometry
   UPDATE trails 
   SET geometry = ST_Force3D(geometry) 
   WHERE ST_NDims(geometry) = 2;
   ```

### Constraint Management

1. **Temporarily Disable Constraints**
   ```sql
   -- Disable specific constraint
   ALTER TABLE trails DISABLE TRIGGER trigger_validate_trail_completeness;
   
   -- Re-enable constraint
   ALTER TABLE trails ENABLE TRIGGER trigger_validate_trail_completeness;
   ```

2. **Drop Constraints**
   ```sql
   -- Remove specific constraint
   ALTER TABLE trails DROP CONSTRAINT chk_trails_length_positive;
   ```

3. **Add New Constraints**
   ```sql
   -- Add custom constraint
   ALTER TABLE trails 
   ADD CONSTRAINT chk_custom_validation 
   CHECK (your_condition_here);
   ``` 