# Enhanced Intersection Splitting with Proper Deduplication

## 🎯 Problem Statement

The original intersection splitting implementation had a critical flaw: when trails were split at intersections, the original unsplit trails were not being deleted. This resulted in:

- **Duplication**: Both the original unsplit trail and the split segments existed simultaneously
- **Data Inconsistency**: The same trail geometry appeared multiple times with different UUIDs
- **Routing Issues**: Confusion in the routing graph due to duplicate trail references

## 🔧 Solution Overview

The enhanced intersection splitting service now properly tracks which trails were split and deletes only the unsplit versions of those trails, while preserving trails that weren't involved in intersections.

### Key Features

1. **Selective Deletion**: Only deletes original trails that were actually split
2. **Trail Preservation**: Keeps trails that don't intersect with others unchanged
3. **Reference Tracking**: Uses `original_trail_uuid` to maintain relationships between split segments and their source
4. **Atomic Operations**: Ensures data consistency through proper transaction handling

## 🏗️ Implementation Details

### EnhancedIntersectionSplittingService

The enhanced service provides the following improvements:

```typescript
export interface EnhancedIntersectionSplittingResult {
  trailsProcessed: number;
  segmentsCreated: number;
  intersectionsFound: number;
  originalTrailsDeleted: number;  // NEW: Track deleted original trails
}
```

### Process Flow

1. **Intersection Detection**: Find all trail intersections using PostGIS `ST_Intersection()`
2. **Trail Identification**: Create a temporary table tracking which trails will be split
3. **Selective Splitting**: Split only trails involved in intersections
4. **Original Deletion**: Delete only the original trails that were split
5. **Segment Creation**: Insert new split segments with `original_trail_uuid` references
6. **Trail Preservation**: Leave trails without intersections unchanged

### Database Schema

The solution leverages the existing `original_trail_uuid` column in the trails table:

```sql
CREATE TABLE trails (
  id SERIAL PRIMARY KEY,
  app_uuid TEXT UNIQUE NOT NULL,
  original_trail_uuid TEXT,  -- Reference to parent trail UUID when this trail is a split segment
  -- ... other columns
);
```

## 📊 Example Output

### Before Enhanced Splitting
```
Trail: Hogback Ridge Trail (UUID: abc-123)
- Single continuous trail geometry
- No split segments
- No original_trail_uuid reference
```

### After Enhanced Splitting
```
Original Trail: Hogback Ridge Trail (UUID: abc-123) - DELETED

Split Segments:
- Hogback Ridge Trail (UUID: def-456, original_trail_uuid: abc-123)
- Hogback Ridge Trail (Segment 2) (UUID: ghi-789, original_trail_uuid: abc-123)
```

## 🧪 Testing

### Test Scripts

1. **Unit Test**: `test-enhanced-intersection-splitting.js`
   - Tests with synthetic data
   - Verifies proper deletion of unsplit trails
   - Confirms preservation of standalone trails

2. **Integration Test**: `test-enhanced-splitting-with-real-data.js`
   - Tests with real staging schema data
   - Validates intersection detection
   - Confirms proper deduplication

### CLI Command

```bash
# Test enhanced splitting on a staging schema
node src/cli/test-enhanced-splitting.ts --staging-schema staging_boulder_test --dry-run
```

## 🔄 Integration with Orchestrator

The enhanced service is now integrated into the main Carthorse orchestrator:

```typescript
// In CarthorseOrchestrator.ts
private async splitTrailsAtIntersectionsWithVerification(): Promise<void> {
  // Apply loop splitting first
  await this.applyLoopSplitting();
  
  // Apply enhanced intersection splitting
  const { EnhancedIntersectionSplittingService } = await import('../services/layer1/EnhancedIntersectionSplittingService');
  
  const splittingService = new EnhancedIntersectionSplittingService({
    stagingSchema: this.stagingSchema,
    pgClient: this.pgClient,
    minTrailLengthMeters: 5.0
  });
  
  const result = await splittingService.applyEnhancedIntersectionSplitting();
  
  console.log(`✅ Enhanced intersection splitting completed: ${result.segmentsCreated} segments created, ${result.originalTrailsDeleted} originals deleted`);
}
```

## 📈 Benefits

### Data Quality
- **No Duplication**: Eliminates duplicate trail geometries
- **Consistent References**: Clear relationship between split segments and originals
- **Proper Segmentation**: Accurate trail splitting at actual intersection points

### Performance
- **Selective Processing**: Only processes trails that need splitting
- **Efficient Deletion**: Removes only necessary original trails
- **Optimized Queries**: Uses spatial indexing for intersection detection

### Maintainability
- **Clear Tracking**: `original_trail_uuid` provides audit trail
- **Modular Design**: Service can be used independently or in orchestrator
- **Comprehensive Testing**: Multiple test scenarios ensure reliability

## 🛡️ Safety Features

### Data Integrity
- **Transaction Safety**: All operations wrapped in database transactions
- **Validation**: Verifies trail counts before and after splitting
- **Error Handling**: Graceful failure with detailed error messages

### Backup Strategy
- **Temporary Tables**: Creates backup tables during processing
- **Rollback Capability**: Can revert changes if needed
- **Staging Environment**: All operations performed in isolated staging schemas

## 🎯 Success Metrics

### Before Enhancement
- ❌ Duplicate trails in output
- ❌ Unsplit original trails remaining
- ❌ No clear relationship between segments and originals

### After Enhancement
- ✅ No duplicate trails
- ✅ Original unsplit trails properly deleted
- ✅ Clear `original_trail_uuid` references
- ✅ Preserved standalone trails unchanged

## 📋 Usage Examples

### Basic Usage
```typescript
const splittingService = new EnhancedIntersectionSplittingService({
  stagingSchema: 'staging_boulder_test',
  pgClient: pool,
  minTrailLengthMeters: 5.0
});

const result = await splittingService.applyEnhancedIntersectionSplitting();
console.log(`Deleted ${result.originalTrailsDeleted} original trails, created ${result.segmentsCreated} segments`);
```

### With Custom Configuration
```typescript
const splittingService = new EnhancedIntersectionSplittingService({
  stagingSchema: 'staging_boulder_test',
  pgClient: pool,
  minTrailLengthMeters: 10.0  // Only split trails longer than 10m
});
```

## 🔮 Future Enhancements

### Potential Improvements
1. **Batch Processing**: Handle very large datasets more efficiently
2. **Parallel Processing**: Split multiple trails simultaneously
3. **Advanced Filtering**: More sophisticated criteria for which trails to split
4. **Audit Logging**: Detailed logs of all splitting operations

### Configuration Options
1. **Split Thresholds**: Configurable minimum trail lengths
2. **Intersection Types**: Filter by intersection geometry types
3. **Preservation Rules**: Custom rules for which trails to preserve
4. **Output Formats**: Different output formats for split results

## 📚 Related Documentation

- [Orchestrator Documentation](orchestrator-README.md)
- [Trail Splitting Analysis](trail-splitting-analysis.md)
- [Database Schema Documentation](README-postgres-constraints.md)
- [Testing Guidelines](testing.md)
