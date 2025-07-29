<div align="left">
  <img src="../carthorse-logo-small.png" alt="Carthorse Logo" width="40" height="40">
</div>

# Transactional PostgreSQL Approach

## Overview

This document explains the transactional approach implemented to prevent the half-baked data issues that plagued the SQLite/SpatiaLite implementation. The new system uses PostgreSQL transactions to ensure atomic record creation with complete data integrity.

## The Problem: Half-Baked Data

### SQLite/SpatiaLite Issues

The legacy system suffered from several critical problems:

1. **Partial Record Insertion**: Records could be inserted with missing elevation data, incomplete geometry, or missing summary statistics
2. **No Transaction Support**: SQLite's limited transaction support made it difficult to ensure atomic operations
3. **Inconsistent State**: Database could contain trails with:
   - 2D geometry instead of 3D
   - Missing elevation calculations
   - Incomplete bounding box data
   - Null values in required fields
4. **Query Failures**: Partial data caused runtime errors when applications expected complete records

### Impact on Development

- **Weeks of debugging** spent tracking down data inconsistencies
- **Unreliable queries** that would fail on incomplete records
- **Manual data cleanup** required before each deployment
- **Poor user experience** due to missing or incorrect trail data

## The Solution: Atomic Transactional Insertion

### Core Principles

1. **Atomic Operations**: Each trail record is created as a single, indivisible transaction
2. **Complete Data Validation**: All required data must be present and valid before insertion
3. **Rollback on Failure**: Any error causes the entire transaction to be rolled back
4. **No Partial Records**: Either the complete record is inserted or nothing is inserted

### Implementation Components

#### 1. Atomic Trail Inserter (`carthorse-postgres-atomic-insert.ts`)

```typescript
class AtomicTrailInserter {
  async insertTrailAtomically(trailData: TrailInsertData): Promise<InsertResult> {
    const transaction = await this.client.connect();
    
    try {
      await this.client.query('BEGIN');
      
      // Step 1: Process elevation data
      const elevationData = await this.processTrailElevation(trailData.coordinates);
      
      // Step 2: Calculate derived data
      const bbox = this.calculateBBox(trailData.coordinates);
      const length_km = this.calculateLength(trailData.coordinates);
      
      // Step 3: Create 3D geometry
      const coordinates3D = elevationData.coordinates3D;
      const geometryWkt = `LINESTRING Z (${coordinates3D.map(coord => 
        `${coord[0]} ${coord[1]} ${coord[2]}`).join(', ')})`;
      
      // Step 4: Validate complete record
      const validationErrors = this.validateTrailData(completeTrail);
      if (validationErrors.length > 0) {
        await this.client.query('ROLLBACK');
        return { success: false, error: 'Validation failed' };
      }
      
      // Step 5: Insert complete record
      await this.client.query(insertQuery, [...]);
      
      // Step 6: Commit transaction
      await this.client.query('COMMIT');
      
      return { success: true, trail_id: completeTrail.app_uuid };
      
    } catch (error) {
      await this.client.query('ROLLBACK');
      return { success: false, error: error.message };
    }
  }
}
```

#### 2. Transactional Orchestrator (`carthorse-postgres-transactional-orchestrator.ts`)

```typescript
class TransactionalOrchestrator {
  async processTrailsInBatches(trails: TrailInsertData[]): Promise<BuildResult> {
    // Process trails in configurable batches
    for (let i = 0; i < trails.length; i += this.config.batchSize) {
      const batch = trails.slice(i, i + this.config.batchSize);
      
      try {
        const batchResult = await this.atomicInserter.insertTrailsBatch(batch);
        // Track success/failure statistics
      } catch (error) {
        // Log error and continue with next batch
      }
    }
  }
}
```

#### 3. Database Constraints (`carthorse-postgres-constraints.sql`)

```sql
-- Ensure complete elevation data
ALTER TABLE trails ADD CONSTRAINT check_elevation_complete
CHECK (
  elevation_gain IS NOT NULL AND elevation_gain >= 0 AND
  elevation_loss IS NOT NULL AND elevation_loss >= 0 AND
  max_elevation IS NOT NULL AND min_elevation IS NOT NULL AND
  avg_elevation IS NOT NULL AND
  max_elevation >= min_elevation AND
  avg_elevation BETWEEN min_elevation AND max_elevation
);

-- Ensure 3D geometry
ALTER TABLE trails ADD CONSTRAINT check_3d_geometry
CHECK (
  geometry IS NOT NULL AND
  ST_NDims(geometry) = 3 AND
  ST_IsValid(geometry) = true
);

-- Ensure complete bounding box
ALTER TABLE trails ADD CONSTRAINT check_bbox_complete
CHECK (
  bbox_min_lng IS NOT NULL AND bbox_max_lng IS NOT NULL AND
  bbox_min_lat IS NOT NULL AND bbox_max_lat IS NOT NULL AND
  bbox_min_lng < bbox_max_lng AND bbox_min_lat < bbox_max_lat
);
```

## Data Flow

### 1. Input Validation
```typescript
interface TrailInsertData {
  osm_id: string;           // Required
  name: string;             // Required
  trail_type: string;       // Required
  coordinates: number[][];  // Required, minimum 2 points
  source_tags: Record<string, string>;
  region: string;           // Required
}
```

### 2. Elevation Processing
- Load TIFF files into memory for fast access
- Calculate elevation for each coordinate point
- Generate 3D coordinates: `[lng, lat, elevation]`
- Calculate elevation statistics: gain, loss, min, max, avg

### 3. Geometry Creation
- Convert 2D coordinates to 3D with elevation data
- Create PostGIS LINESTRING Z geometry
- Validate geometry using PostGIS functions
- Ensure minimum coordinate count (2+ points)

### 4. Derived Data Calculation
- Calculate trail length using Haversine formula
- Calculate bounding box from coordinates
- Generate summary statistics
- Create unique UUID for the record

### 5. Complete Record Validation
```typescript
private validateTrailData(trailData: CompleteTrailRecord): string[] {
  const errors: string[] = [];
  
  // Required field validation
  if (!trailData.name || trailData.name.trim() === '') {
    errors.push('Trail name is required');
  }
  
  // Geometry validation
  if (trailData.coordinate_count < 2) {
    errors.push('Trail must have at least 2 coordinate points');
  }
  
  if (!trailData.has_3d_geometry) {
    errors.push('Trail must have 3D geometry with elevation data');
  }
  
  // Elevation data validation
  if (!trailData.elevation_data_complete) {
    errors.push('Complete elevation data is required');
  }
  
  return errors;
}
```

### 6. Atomic Insertion
- Begin PostgreSQL transaction
- Insert complete record with all data
- Apply database constraints
- Commit transaction or rollback on error

## Benefits

### 1. Data Integrity
- **No partial records**: Every trail has complete data
- **Consistent state**: Database is always in a valid state
- **Reliable queries**: Applications can trust the data

### 2. Error Handling
- **Automatic rollback**: Failed insertions don't leave partial data
- **Detailed error reporting**: Clear feedback on what went wrong
- **Batch processing**: Continue processing other trails if one fails

### 3. Performance
- **Transaction efficiency**: PostgreSQL handles concurrent access
- **Memory optimization**: TIFF files loaded once, reused
- **Batch processing**: Configurable batch sizes for optimal performance

### 4. Development Experience
- **Predictable behavior**: No more debugging half-baked data
- **Clear validation**: Explicit error messages for data issues
- **Testable**: Easy to test individual components

## Usage Examples

### Basic Trail Insertion
```bash
# Insert a single trail
npx ts-node carthorse-postgres-atomic-insert.ts --db trail_master_db

# Insert with sample data
const inserter = new AtomicTrailInserter('trail_master_db');
const result = await inserter.insertTrailAtomically(sampleTrail);
```

### Batch Processing
```bash
# Process multiple trails
npx ts-node carthorse-postgres-transactional-orchestrator.ts \
  --region boulder \
  --count 1000 \
  --batch-size 50

# Dry run to validate without inserting
npx ts-node carthorse-postgres-transactional-orchestrator.ts \
  --region boulder \
  --count 100 \
  --dry-run
```

### Database Constraints
```bash
# Apply constraints to existing database
npx ts-node carthorse-apply-constraints.ts \
  --db trail_master_db \
  --dry-run

# Force apply constraints (overrides warnings)
npx ts-node carthorse-apply-constraints.ts \
  --db trail_master_db \
  --force
```

## Migration from SQLite/SpatiaLite

### 1. Data Validation
```bash
# Check existing data for issues
npx ts-node carthorse-postgres-status-scripts.ts \
  --db trail_master_db \
  --validate-integrity
```

### 2. Constraint Application
```bash
# Apply constraints with pre-checks
npx ts-node carthorse-apply-constraints.ts \
  --db trail_master_db \
  --pre-check
```

### 3. Data Migration
```bash
# Migrate data using transactional approach
npx ts-node carthorse-postgres-transactional-orchestrator.ts \
  --region boulder \
  --count all \
  --force
```

## Monitoring and Maintenance

### 1. Data Quality Monitoring
```sql
-- Check for incomplete records
SELECT COUNT(*) as incomplete_count
FROM trails
WHERE geometry IS NULL 
   OR elevation_gain IS NULL 
   OR max_elevation IS NULL;

-- Check for 2D geometries
SELECT COUNT(*) as two_d_count
FROM trails
WHERE ST_NDims(geometry) = 2;
```

### 2. Performance Monitoring
```sql
-- Monitor transaction performance
SELECT 
  schemaname,
  tablename,
  n_tup_ins as inserts,
  n_tup_upd as updates,
  n_tup_del as deletes
FROM pg_stat_user_tables
WHERE tablename = 'trails';
```

### 3. Error Tracking
```typescript
// Monitor insertion failures
const result = await inserter.insertTrailAtomically(trailData);
if (!result.success) {
  console.error('Insertion failed:', result.error);
  console.error('Validation errors:', result.validation_errors);
}
```

## Best Practices

### 1. Always Use Transactions
- Never insert data outside of a transaction
- Always validate data before insertion
- Always handle rollback on errors

### 2. Validate Early and Often
- Validate input data before processing
- Validate derived data after calculation
- Validate complete records before insertion

### 3. Monitor Data Quality
- Regular integrity checks
- Performance monitoring
- Error tracking and alerting

### 4. Test Thoroughly
- Unit tests for each component
- Integration tests for full workflow
- Performance tests with real data

## Troubleshooting

### Common Issues

1. **TIFF File Loading**
   - Ensure TIFF files are in the correct directory
   - Check file permissions
   - Verify file format compatibility

2. **Memory Usage**
   - Monitor memory usage with large TIFF files
   - Consider lazy loading for very large datasets
   - Use appropriate batch sizes

3. **Transaction Timeouts**
   - Increase PostgreSQL timeout settings
   - Reduce batch sizes
   - Optimize elevation calculation

4. **Constraint Violations**
   - Check data quality before insertion
   - Review constraint definitions
   - Use dry-run mode to identify issues

### Debug Mode
```bash
# Enable verbose logging
npx ts-node carthorse-postgres-transactional-orchestrator.ts \
  --region boulder \
  --count 10 \
  --verbose
```

## Conclusion

The transactional approach eliminates the half-baked data issues that plagued the SQLite/SpatiaLite implementation. By ensuring atomic operations and complete data validation, the system provides:

- **Reliable data integrity**
- **Predictable behavior**
- **Better error handling**
- **Improved development experience**

This foundation makes the PostgreSQL migration successful and provides a solid base for future development and scaling. 