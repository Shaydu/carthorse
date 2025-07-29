<div align="left">
  <img src="../../carthorse-logo-small.png" alt="Carthorse Logo" width="40" height="40">
</div>

# Trail Database Orchestrator Documentation

## Overview

The Enhanced PostgreSQL Orchestrator manages a two-stage database architecture for trail data processing:

1. **Master Database**: Full-resolution source data from OpenStreetMap APIs (PostgreSQL/PostGIS)
2. **Application Database**: Processed, split trails with intersections and nodes (SpatiaLite)

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   OSM APIs      │───▶│  Master Database │───▶│  App Database   │
│ (Overpass API)  │    │  (Full Res)      │    │  (Processed)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │                        │
                              │ osm_id (unique key)    │ app_uuid (generated)
                              │ no app_uuid            │ split trails only
                              │ elevation data         │ intersections & nodes
                              │ 3D geometry            │ region-specific
```

## Main Orchestrator Functions

### `EnhancedPostgresOrchestrator.run()`

**Primary orchestration function that executes the complete pipeline:**

```pseudocode
FUNCTION run():
    // Step 0: Backup PostgreSQL database
    IF NOT skipBackup:
        backupDatabase()
    
    // Step 1: Connect to PostgreSQL
    connectToPostgreSQL()
    
    // Step 1.5: Build master database if requested
    IF buildMaster:
        buildMasterDatabase()
        RETURN
    
    // Step 2: Create staging environment
    createStagingEnvironment()
    
    // Step 3: Copy region data to staging
    copyRegionDataToStaging()
    
    // Step 4: Detect intersections
    detectIntersections()
    
    // Step 5: Split trails at intersections
    splitTrailsAtIntersections()
    
    // Step 6: Build routing graph
    buildRoutingGraph()
    
    // Step 7: Export to SpatiaLite
    exportToSpatiaLite()
    
    // Step 8: Cleanup staging
    cleanupStaging()
```

### `buildMasterDatabase()`

**Builds the master PostgreSQL database from Overpass API:**

```pseudocode
FUNCTION buildMasterDatabase():
    // Get region bbox from PostgreSQL
    bbox = queryRegionBbox(region)
    
    // Query Overpass API for trail data
    overpassTrails = queryOverpassAPI(bbox)
    
    // Process trails through atomic inserter
    atomicInserter = new AtomicTrailInserter()
    
    FOR each overpassTrail IN overpassTrails:
        trailData = convertOverpassTrailToInsertData(overpassTrail)
        IF trailData IS valid:
            result = atomicInserter.insertTrailAtomically(trailData)
            IF result.success:
                log("Inserted: " + trailData.name)
            ELSE:
                log("Failed: " + trailData.name)
```

### `createStagingEnvironment()`

**Creates staging schema and tables for processing:**

```pseudocode
FUNCTION createStagingEnvironment():
    // Create staging schema
    CREATE SCHEMA staging_{region}_{timestamp}
    
    // Create staging tables
    CREATE TABLE staging.trails (
        id, app_uuid, osm_id, name, trail_type, surface, difficulty,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, 
        min_elevation, avg_elevation, source, region, geometry, geometry_text
    )
    
    CREATE TABLE staging.trail_hashes (
        trail_id, geometry_hash, elevation_hash, metadata_hash, last_processed
    )
    
    CREATE TABLE staging.intersection_points (
        id, point, trail1_id, trail2_id, distance_meters
    )
    
    CREATE TABLE staging.split_trails (
        original_trail_id, segment_number, app_uuid, name, trail_type,
        surface, difficulty, source_tags, osm_id, elevation_gain,
        elevation_loss, max_elevation, min_elevation, avg_elevation,
        length_km, source, geometry, bbox_min_lng, bbox_max_lng,
        bbox_min_lat, bbox_max_lat
    )
    
    CREATE TABLE staging.routing_nodes (
        id, node_uuid, lat, lng, node_type, connected_trails
    )
    
    CREATE TABLE staging.routing_edges (
        from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain
    )
```

### `copyRegionDataToStaging()`

**Copies region-specific data from master to staging:**

```pseudocode
FUNCTION copyRegionDataToStaging():
    // Copy region data to staging
    INSERT INTO staging.trails
    SELECT * FROM master.trails 
    WHERE region = {region}
    
    // Store both geometry and geometry_text
    UPDATE staging.trails 
    SET geometry_text = ST_AsText(geometry)
    
    // Validate staging data
    validateStagingData(strict = false)
```

### `detectIntersections()`

**Detects trail intersections using PostGIS:**

```pseudocode
FUNCTION detectIntersections():
    // Clear existing intersection data
    DELETE FROM staging.intersection_points
    
    // Find intersection points using PostGIS
    INSERT INTO staging.intersection_points (point, trail1_id, trail2_id, distance_meters)
    SELECT DISTINCT 
        ST_Intersection(t1.geometry, t2.geometry) as intersection_point,
        t1.id as trail1_id,
        t2.id as trail2_id,
        ST_Distance(t1.geometry, t2.geometry) as distance_meters
    FROM staging.trails t1
    JOIN staging.trails t2 ON (
        t1.id < t2.id AND 
        ST_Intersects(t1.geometry, t2.geometry) AND
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point' AND
        ST_Distance(t1.geometry, t2.geometry) <= {intersectionTolerance}
    )
    
    // Load intersections into memory for processing
    intersections = query("SELECT * FROM staging.intersection_points")
    
    // Group intersections by trail
    FOR each intersection IN intersections:
        point = parsePoint(intersection.point)
        addToSplitPoints(trail1_id, point)
        addToSplitPoints(trail2_id, point)
```

### `splitTrailsAtIntersections()`

**Splits trails at intersection points:**

```pseudocode
FUNCTION splitTrailsAtIntersections():
    // Check for cached splits
    changedTrails = getChangedTrails()
    IF changedTrails.length == 0:
        RETURN // Use cached splits
    
    // Clear existing split trails for changed trails
    DELETE FROM staging.split_trails 
    WHERE original_trail_id IN (SELECT id FROM staging.trails WHERE app_uuid IN changedTrails)
    
    // Fetch trails for splitting
    trails = query("SELECT * FROM staging.trails WHERE geometry IS NOT NULL")
    
    FOR each trail IN trails:
        intersections = getSplitPoints(trail.id)
        
        IF intersections.length == 0:
            // No intersections, copy trail as-is
            insertSplitTrail(trail, 1, trail.geometry_text)
            CONTINUE
        
        // Find split points along trail geometry
        splitPoints = findSplitPointsAlongTrail(trail, intersections)
        
        IF splitPoints.length < 2:
            // No meaningful splits, copy trail as-is
            insertSplitTrail(trail, 1, trail.geometry_text)
            CONTINUE
        
        // Split trail at points
        segments = splitTrailAtPoints(trail, splitPoints)
        
        FOR each segment IN segments:
            insertSplitTrail(trail, segment_number, segment)
```

### `buildRoutingGraph()`

**Builds routing nodes and edges from split trails:**

```pseudocode
FUNCTION buildRoutingGraph():
    // Clear existing routing data
    DELETE FROM staging.routing_edges
    DELETE FROM staging.routing_nodes
    
    // Get all split trails
    trails = query("SELECT * FROM staging.split_trails WHERE geometry IS NOT NULL")
    
    nodeMap = new Map()
    nodeId = 1
    nodes = []
    edges = []
    
    FOR each trail IN trails:
        coords = parseGeometry(trail.geometry_text)
        
        // Create nodes for each coordinate pair
        FOR i = 0 TO coords.length - 2:
            [lng1, lat1] = coords[i]
            [lng2, lat2] = coords[i + 1]
            
            node1Id = getOrCreateNode(nodeMap, nodes, lat1, lng1, nodeId++)
            node2Id = getOrCreateNode(nodeMap, nodes, lat2, lng2, nodeId++)
            
            // Calculate distance
            distanceKm = calculateDistance([lng1, lat1], [lng2, lat2]) / 1000
            
            edges.push({
                fromNodeId: node1Id,
                toNodeId: node2Id,
                trailId: trail.app_uuid,
                trailName: trail.name,
                distanceKm: distanceKm,
                elevationGain: trail.elevation_gain
            })
    
    // Insert nodes and edges
    FOR each node IN nodes:
        INSERT INTO staging.routing_nodes VALUES (node)
    
    FOR each edge IN edges:
        INSERT INTO staging.routing_edges VALUES (edge)
```

### `exportToSpatiaLite()`

**Exports processed data to SpatiaLite database:**

```pseudocode
FUNCTION exportToSpatiaLite():
    // Create SpatiaLite database
    spatialiteDb = new Database(outputPath)
    loadSpatiaLiteExtension()
    initSpatialMetadata()
    
    // Create tables
    CREATE TABLE trails (
        id, app_uuid, osm_id, name, trail_type, surface, difficulty,
        source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, 
        min_elevation, avg_elevation, created_at, updated_at
    )
    
    CREATE TABLE routing_nodes (
        id, node_uuid, lat, lng, node_type, connected_trails, created_at
    )
    
    CREATE TABLE routing_edges (
        from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, created_at
    )
    
    // Add spatial column
    AddGeometryColumn('trails', 'geometry', 4326, 'LINESTRING', 3)
    
    // Export split trails
    trailsToExport = query("SELECT * FROM staging.split_trails")
    
    atomicInserter = new AtomicTrailInserter()
    
    FOR each trail IN trailsToExport:
        trailData = convertStagingTrailToInsertData(trail)
        IF trailData IS valid:
            result = atomicInserter.insertTrailAtomically(trailData)
            IF result.success:
                log("Updated: " + trail.name)
            ELSE:
                log("Failed: " + trail.name)
    
    // Export routing data
    exportRoutingNodes()
    exportRoutingEdges()
```

## Key Processing Steps

### 1. Master Database Creation
- Query Overpass API for region-specific trail data
- Process through atomic inserter for validation
- Store in PostgreSQL with PostGIS geometry

### 2. Staging Environment Setup
- Create isolated schema for processing
- Copy region data to staging tables
- Calculate and store trail hashes for change detection

### 3. Intersection Detection
- Use PostGIS spatial functions to find trail intersections
- Filter by distance tolerance (default: 3 meters)
- Group intersections by trail for processing

### 4. Trail Splitting
- Split trails at intersection points
- Create segments with unique app_uuid suffixes
- Maintain original trail metadata

### 5. Routing Graph Construction
- Create nodes at trail endpoints and intersections
- Build edges between connected nodes
- Calculate distances and elevation gains

### 6. SpatiaLite Export
- Export processed data to region-specific database
- Use atomic inserter for validation
- Create spatial indexes for performance

## Export Logic Flow

### 1. Query Region Data
- Query PostgreSQL master database for all trails in specified region
- Copy complete trail records (including elevation data) to staging schema

### 2. Create Staging Environment
- Create isolated staging schema with tables for processing
- Copy region data to staging tables
- Validate staging data integrity

### 3. Detect Trail Intersections
- Use PostGIS spatial functions to find where trails intersect
- Store intersection points for trail splitting

### 4. Split Trails at Intersections
- Split trails into segments at intersection points
- Create new app_uuid for each segment
- Maintain original trail metadata

### 5. Build Routing Graph
- Create nodes at trail endpoints and intersections
- Build edges between connected nodes
- Calculate distances and elevation gains

### 6. Export to SpatiaLite
- **Should:** Directly copy validated data from staging to SpatiaLite
- **Currently:** Incorrectly calls atomic inserter which re-processes elevation data
- This causes TIFF lookup failures for coordinates outside coverage

### 7. Deploy to Google Cloud Run
- Builds Docker container with region-specific database
- Deploys to Cloud Run service

**Note:** The atomic inserter should only be used when building the master database from raw data (Overpass API), not during export. The export process should preserve existing elevation data instead of re-processing it.

## Validation Summary

### PostgreSQL Master Database
- **Atomic Trail Insertion** - Complete validation during initial data insertion
  - Required fields: name, osm_id, geometry
  - Geometry: ≥2 coordinate points, 3D geometry with elevation
  - Elevation: Complete data (gain, loss, min, max, avg) required
  - Length: Must be >0
  - Bounding box: Valid min/max coordinates
  - **Transaction-based** - Either complete record or nothing inserted

### Staging Environment (PostgreSQL)
- **Critical Requirements Check**
  - Complete elevation data (no NULL values)
  - Valid geometry and geometry_text
  - Valid bounding boxes (min < max)
  - No duplicate UUIDs
  - Basic data copy integrity

### SpatiaLite Export Database
- **Database Constraints**
  - `app_uuid TEXT UNIQUE NOT NULL` - Prevents duplicate UUIDs
  - `name TEXT NOT NULL` - Requires trail names
  - Primary key constraints
- **Application-level Checks**
  - Duplicate UUID check before export
  - Geometry validation during export
  - Export location validation
  - **Database Size Validation**
    - Hard limit: 400MB maximum per region (configurable with --max-spatialite-db-size)
    - Prompts for user confirmation if database exceeds limit
    - If user declines, stops export and removes database file
    - If user confirms, proceeds with export and deployment
    - Suggests optimization options (simplify-tolerance, target-size, max-spatialite-db-size)

### Export Location Validation
- **Container Path Check**
  - Database must be at: `api-service/data/{region}.db`
  - Validates against expected Docker container path
  - Warns if path doesn't match container expectations
  - Ensures proper packaging for `gainiac-{region}` containers

### Deployment Validation
- **Region-specific Isolation**
  - Each container gets only one database file
  - Database filename must match region key exactly
  - Container environment variables set correctly
  - Service URL validation and updates

**Key Insight:** Master DB has heavy validation, staging has essential checks, SpatiaLite has database constraints + application checks, and export location ensures proper container packaging.

## Data Validation

### Atomic Trail Insertion
Each trail insertion is atomic - either the complete record is inserted or nothing is inserted for that trail:

```pseudocode
FUNCTION insertTrailAtomically(trailData):
    BEGIN TRANSACTION  // Per individual trail
    
    // Process and validate
    elevationData = processTrailElevation(coordinates)
    completeTrail = buildCompleteRecord(...)
    validationErrors = validateTrailData(completeTrail)
    
    IF validationErrors.length > 0:
        ROLLBACK  // Rollback THIS trail only
        RETURN { success: false }
    
    // Insert if validation passes
    upsertResult = upsertToDatabase(completeTrail)
    COMMIT  // Commit THIS trail only
    RETURN { success: true }
```

### Required Data Validation
Trail insertion fails if any required data is missing:

- **Basic Data**: Name, OSM ID, geometry required
- **Geometry**: Must have ≥2 coordinate points, 3D geometry with elevation
- **Elevation**: Complete elevation data (gain, loss, min, max, avg) required
- **Length**: Trail length must be >0
- **Bounding Box**: Valid min/max coordinates required

### Batch Processing
- Each trail processed independently
- Individual failures don't prevent other trails from succeeding
- Partial batch success possible (some trails succeed, others fail)

## Usage

```bash
# Build master database from Overpass API
npx ts-node carthorse-enhanced-postgres-orchestrator.ts --region boulder --build-master

# Process region and export to SpatiaLite
npx ts-node carthorse-enhanced-postgres-orchestrator.ts --region boulder --out data/boulder.db

# Process with custom settings
npx ts-node carthorse-enhanced-postgres-orchestrator.ts \
  --region boulder \
  --out data/boulder.db \
  --intersection-tolerance 5 \
  --simplify-tolerance 0.002 \
  --target-size 100 \
  --max-spatialite-db-size 500 \
  --validate
```

## Configuration Options

- `--region`: Region to process (required)
- `--out`: Output SpatiaLite database path
- `--simplify-tolerance`: Path simplification tolerance (default: 0.001)
- `--intersection-tolerance`: Intersection detection tolerance in meters (default: 3)
- `--target-size`: Target database size in MB
- `--max-spatialite-db-size`: Maximum database size in MB (default: 400)
- `--replace`: Replace existing database
- `--validate`: Run validation after export
- `--verbose`: Enable verbose logging
- `--skip-backup`: Skip database backup
- `--build-master`: Build master database from Overpass API

## CARTHORSE Pipeline Tools

### Core Orchestration
- `carthorse-enhanced-postgres-orchestrator.ts` - Main orchestrator
- `carthorse-postgres-atomic-insert.ts` - Atomic trail insertion
- `carthorse-master-db-builder.ts` - Master database builder

### Elevation Processing
- `carthorse-elevation-backfill.js` - Backfill missing elevation data
- `carthorse-simple-elevation-fill.ts` - Simple elevation extraction
- `carthorse-tiff-coverage-checker.js` - Validate TIFF file coverage
- `carthorse-tiff-coverage-analyzer.js` - Analyze TIFF coverage details

### Validation & Maintenance
- `carthorse-validate-database.ts` - Database validation
- `carthorse-recalculate-trail-stats.js` - Recalculate trail statistics
- `carthorse-deduplicate-trails.js` - Remove duplicate trails

### Trail Processing
- `carthorse-simple-trail-splitting.js` - Split trails at intersections
- `carthorse-build-routing-graph.js` - Build routing network
- `carthorse-build-routing-nodes-edges.ts` - Create routing nodes/edges

### Database Management
- `carthorse-nuclear-reset.ts` - Complete database reset
- `carthorse-sqlite-to-postgres-migrator.ts` - Migration utilities 