<div align="left">
  <img src="../carthorse-logo-small.png" alt="Carthorse Logo" width="40" height="40">
</div>

# CARTHORSE Orchestrator Documentation

## 🎯 Overview

The `EnhancedPostgresOrchestrator` is the core processing pipeline for Carthorse. It handles the complete workflow from raw trail data to optimized SpatiaLite databases with routing graphs.

## 🏗️ Architecture

### Pipeline Flow

```
Input Data → Staging → Intersection Detection → Trail Splitting → Routing Graph → Export
```

### Key Components

1. **Staging Environment**: Isolated PostgreSQL schema for processing
2. **Intersection Detection**: PostGIS-based spatial analysis
3. **Trail Splitting**: Improved intersection-based segmentation
4. **Routing Graph**: Node/edge network for pathfinding
5. **Export**: SpatiaLite database generation

## 🔄 Pipeline Steps

### `run()` Method

The main orchestrator method that runs the complete pipeline:

```typescript
async run(): Promise<void> {
  // Step 1: Setup and validation
  await this.checkRequiredSqlFunctions();
  await this.pgClient.connect();
  
  // Step 2: Create staging environment
  await this.createStagingEnvironment();
  
  // Step 3: Copy region data to staging
  await this.copyRegionDataToStaging(this.config.bbox);
  
  // Step 4: Detect intersections
  await this.detectIntersections();
  
  // Step 5: Split trails at intersections (IMPROVED)
  if (this.config.useSplitTrails !== false) {
    await this.replaceTrailsWithSplitTrails();
  }
  
  // Step 6: Build routing graph from split trails
  await this.buildRoutingGraph();
  
  // Step 7: Export to SpatiaLite
  await this.exportDatabase();
  
  // Step 8: Validation and cleanup
  if (this.config.validate) {
    await this.validateExport();
  }
  await this.performComprehensiveCleanup();
}
```

### `replaceTrailsWithSplitTrails()`

**Improved intersection-based trail splitting using PostGIS:**

```typescript
private async replaceTrailsWithSplitTrails(): Promise<void> {
  console.log(`[ORCH] 📐 Replacing trails table with split trail segments...`);
  
  const result = await this.pgClient.query(
    `SELECT public.replace_trails_with_split_trails($1, $2)`,
    [this.stagingSchema, 'trails']
  );
  
  const segmentCount = result.rows[0]?.replace_trails_with_split_trails || 0;
  console.log(`[ORCH] ✅ Replaced trails table with ${segmentCount} split trail segments`);
}
```

**PostGIS Function Implementation:**
- Uses `ST_Intersection()` to find actual intersection points between different trails
- Uses `ST_Split()` to split trails at these intersection points
- Preserves all trail metadata and elevation data
- Filters out segments shorter than 100m
- Generates new `app_uuid` for each segment

### `buildRoutingGraph()`

**Builds routing nodes and edges from split trail segments:**

```typescript
private async buildRoutingGraph(): Promise<void> {
  const processingConfig = await this.getProcessingConfig();
  
  await buildRoutingGraphHelper(
    this.pgClient,
    this.stagingSchema,
    'trails', // Now contains split trail segments
    this.config.intersectionTolerance ?? INTERSECTION_TOLERANCE,
    this.config.edgeTolerance ?? EDGE_TOLERANCE,
    {
      useIntersectionNodes: processingConfig.useIntersectionNodes ?? false,
      intersectionTolerance: this.config.intersectionTolerance ?? INTERSECTION_TOLERANCE,
      edgeTolerance: this.config.edgeTolerance ?? EDGE_TOLERANCE
    }
  );
}
```

## 📊 Trail Splitting Results

### Before (Original Implementation)
- Used `ST_Node()` which only splits at self-intersections
- Didn't handle intersections between different trails
- Resulted in under-segmentation

### After (Improved Implementation)
- Uses `ST_Intersection()` to find actual intersection points between trails
- Uses `ST_Split()` to split trails at these specific points
- Results in proper segmentation at trail crossings
- Example: Chautauqua Trail splits into 2 segments at intersections with Bluebell trails

## 🔧 Configuration Options

### Trail Splitting
- `useSplitTrails: true` (default) - Enable intersection-based splitting
- `useSplitTrails: false` - Disable splitting, use original trails

### Routing Graph
- `useIntersectionNodes: true` (default) - Create nodes at intersections
- `useIntersectionNodes: false` - Create nodes only at endpoints

### Tolerances
- `intersectionTolerance: 2.0` - Distance tolerance for intersection detection
- `edgeTolerance: 20.0` - Distance tolerance for edge creation

## 🛡️ Safety Features

### Database Safety
- Uses test database (`trail_master_db_test`) for development
- Staging schemas for isolated processing
- No production database modifications

### Data Integrity
- Preserves all original trail metadata
- Maintains 3D elevation data
- Validates geometry integrity
- Filters out invalid or very short segments

### Error Handling
- Comprehensive error logging
- Graceful cleanup on failures
- Validation at each pipeline step

## 📈 Performance Optimizations

### Spatial Operations
- Uses native PostGIS functions for all spatial operations
- Spatial indexing on geometry columns
- Batch processing for large datasets

### Memory Management
- Staging schemas for isolated processing
- Automatic cleanup of temporary data
- Configurable disk space management

## 🔍 Validation

### Pre-Export Validation
- Geometry validity checks
- Elevation data validation
- Intersection detection verification

### Post-Export Validation
- Database integrity checks
- Schema version validation
- Data completeness verification

## 📚 Integration

### CLI Integration
```bash
# Export with trail splitting (default)
carthorse --region boulder --out data/boulder.db

# Export without trail splitting
carthorse --region boulder --out data/boulder.db --no-split-trails
```

### Library Integration
```typescript
const orchestrator = new EnhancedPostgresOrchestrator({
  region: 'boulder',
  outputPath: './data/boulder.db',
  useSplitTrails: true, // Enable intersection-based splitting
  useIntersectionNodes: true, // Enable intersection nodes
  validate: true
});

await orchestrator.run();
```

## 🎯 Success Metrics

### Trail Splitting
- ✅ Trails split at actual intersections between different trails
- ✅ Proper segmentation for routing efficiency
- ✅ Preserved metadata and elevation data
- ✅ Filtered short segments (< 100m)

### Routing Graph
- ✅ Nodes at intersections and endpoints
- ✅ Edges connecting trail segments
- ✅ Efficient pathfinding capability
- ✅ Node-to-trail ratio < 50%

### Export Quality
- ✅ Valid SpatiaLite database
- ✅ Complete trail metadata
- ✅ Spatial indexing for performance
- ✅ Schema version compatibility 