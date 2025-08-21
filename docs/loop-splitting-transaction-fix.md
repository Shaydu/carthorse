# Loop Splitting Transaction Fix

## Problem

The previous loop splitting implementation had several critical issues:

1. **No proper database transactions**: Operations were not wrapped in transactions, leading to potential data inconsistency if any step failed
2. **Missing parent-child relationships**: Split segments didn't properly reference their parent trail via `original_trail_uuid`
3. **Race conditions**: Parent trails could be deleted before child segments were properly inserted
4. **No rollback capability**: If splitting failed partway through, the database could be left in an inconsistent state

## Solution

### 1. Proper Transaction Handling

The `LoopSplittingHelpers.splitLoopTrails()` method now:

- Uses a dedicated database client for transaction management
- Wraps all operations in a single transaction with `BEGIN`/`COMMIT`/`ROLLBACK`
- Ensures atomicity - either all operations succeed or none do
- Properly releases the client back to the pool

```typescript
async splitLoopTrails(): Promise<LoopSplittingResult> {
  const client = await this.pgClient.connect();
  
  try {
    await client.query('BEGIN');
    
    // All splitting operations...
    
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

### 2. Parent-Child Relationship Management

The `original_trail_uuid` field is now properly used to maintain parent-child relationships:

- **Split segments** get `original_trail_uuid` set to their parent trail's UUID
- **Unsplit trails** have `original_trail_uuid` set to `NULL`
- The parent trail is only deleted after all child segments are successfully inserted

```sql
WITH inserted_segments AS (
  INSERT INTO staging_schema.trails (
    app_uuid, original_trail_uuid, name, geometry, ...
  )
  SELECT 
    original_loop_uuid || '_segment_' || segment_number as app_uuid,
    original_loop_uuid as original_trail_uuid,  -- Reference to parent
    segment_name as name,
    ...
  FROM loop_split_segments
  RETURNING app_uuid, original_trail_uuid
),
deleted_originals AS (
  DELETE FROM staging_schema.trails 
  WHERE app_uuid IN (
    SELECT DISTINCT original_trail_uuid 
    FROM inserted_segments 
    WHERE original_trail_uuid IS NOT NULL
  )
  RETURNING app_uuid
)
SELECT COUNT(*) as inserted_count FROM inserted_segments;
```

### 3. Schema Updates

The trails table schema now includes the `original_trail_uuid` field:

```sql
CREATE TABLE IF NOT EXISTS trails (
    id SERIAL PRIMARY KEY,
    app_uuid TEXT UNIQUE NOT NULL,
    original_trail_uuid TEXT,  -- Reference to parent trail UUID
    -- ... other fields
);
```

### 4. Migration Support

A migration script is provided to add the `original_trail_uuid` column to existing staging schemas:

```sql
-- Add column to specific schema
SELECT add_original_trail_uuid_column('staging_boulder_1234567890');

-- Or migrate all staging schemas
SELECT migrate_all_staging_schemas();
```

## Usage

### Basic Usage

```typescript
import { createLoopSplittingHelpers } from './src/utils/loop-splitting-helpers';

const loopSplittingHelpers = createLoopSplittingHelpers(
  'staging_boulder_1234567890', 
  pgPool, 
  5.0  // intersection tolerance in meters
);

const result = await loopSplittingHelpers.splitLoopTrails();

if (result.success) {
  console.log(`Split ${result.splitSegments} segments from ${result.loopCount} loops`);
}
```

### Testing

A test script is provided to verify the functionality:

```bash
# Set environment variables
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=trail_master_db
export DB_USER=postgres
export DB_PASSWORD=postgres
export STAGING_SCHEMA=staging_boulder_test

# Run the test
npx ts-node scripts/test-loop-splitting-transaction.ts
```

## Benefits

1. **Data Integrity**: All operations are atomic and consistent
2. **Traceability**: Split segments maintain references to their parent trails
3. **Reliability**: Proper error handling and rollback on failures
4. **Performance**: Single transaction reduces database round trips
5. **Maintainability**: Clear separation of concerns and proper resource management

## Migration Notes

- Existing staging schemas need the `original_trail_uuid` column added
- The migration is safe to run multiple times (idempotent)
- No data loss occurs during migration
- The old `replaceLoopTrailsWithSegments()` method is deprecated but still available for backward compatibility

## Future Improvements

- Add validation to ensure split segments are properly linked to parent trails
- Implement cleanup of orphaned segments
- Add metrics and monitoring for splitting operations
- Consider parallel processing for large datasets
