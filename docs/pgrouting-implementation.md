# pgRouting Implementation Documentation

## Overview

Our pgRouting implementation provides network analysis capabilities for trail routing, with seamless UUID ↔ integer mapping at the boundary of the pgRouting module. This ensures pgRouting operates with integer IDs internally while the application maintains UUID-based data integrity.

## Architecture

### Core Components

1. **PgRoutingHelpers** (`src/utils/pgrouting-helpers.ts`) - Main pgRouting interface
2. **CLI Test Tools** - Command-line testing and visualization
3. **Staging Schema** - Temporary workspace for pgRouting operations
4. **UUID Mapping Tables** - Boundary mapping between UUIDs and integers

### Data Flow

```
trail_master_db.trails (UUIDs) 
    ↓
staging_schema.routing_nodes/edges (UUIDs)
    ↓
node_mapping/edge_mapping (UUID ↔ Integer)
    ↓
pgRouting tables (ways, ways_vertices_pgr) (Integers)
    ↓
pgr_ksp() algorithm (Integer operations)
    ↓
Results with UUID mapping back to original data
```

## Key Functions

### 1. `createPgRoutingViews()`
**Purpose:** Creates pgRouting-compatible tables from staging data
**Input:** Staging schema with routing_nodes and routing_edges
**Output:** ways, ways_vertices_pgr, node_mapping, edge_mapping tables

```typescript
// Creates mapping tables with ROW_NUMBER() for unique integer IDs
CREATE TABLE node_mapping AS
SELECT id as uuid, ROW_NUMBER() OVER (ORDER BY id) as pg_id
FROM routing_nodes WHERE lat IS NOT NULL AND lng IS NOT NULL
```

### 2. `findKShortestPaths()`
**Purpose:** Finds K shortest paths between two nodes
**Input:** Start/end UUIDs, number of paths (k), directed flag
**Output:** Array of path objects with trail UUIDs and metadata

```typescript
// Public interface - accepts UUIDs, handles mapping
async findKShortestPaths(startNodeUuid: string, endNodeUuid: string, k: number = 3)
```

### 3. `generateRouteRecommendations()`
**Purpose:** Generates route recommendations for connected node pairs
**Input:** Staging schema with routing data
**Output:** Array of route recommendations with trail UUIDs

## Critical Implementation Files

### Core Implementation
- **`src/utils/pgrouting-helpers.ts`** - Main pgRouting interface
- **`src/cli/pgrouting-test.ts`** - CLI testing interface
- **`src/orchestrator/CarthorseOrchestrator.ts`** - Orchestrator integration

### Test Files
- **`test-pgrouting-geojson-export.js`** - End-to-end testing with trail name verification
- **`test-pgrouting-recommendations.js`** - Route recommendation testing
- **`test-pgrouting-bbox.js`** - Bbox-specific analysis

### Output Files
- **`pgrouting-with-trail-names.geojson`** - Complete network visualization
- **`bbox-pgrouting-analysis.geojson`** - Bbox-specific analysis

## Command Examples

### 1. Basic pgRouting Test
```bash
npx ts-node src/cli/pgrouting-test.ts --help
```

### 2. Bbox Analysis with Trail Names
```bash
node test-pgrouting-geojson-export.js
```
**Output:** `pgrouting-with-trail-names.geojson` with 154 nodes, 96 edges, 3 route recommendations

### 3. Route Recommendations Test
```bash
node test-pgrouting-recommendations.js
```

### 4. Bbox-Specific Analysis
```bash
node test-pgrouting-bbox.js
```
**Bbox Used:**
```json
{
  "type": "Feature",
  "properties": {},
  "geometry": {
    "coordinates": [[
      [-105.32047300758535, 40.01589890417776],
      [-105.32047300758535, 39.97645469545003],
      [-105.26687332281577, 39.97645469545003],
      [-105.26687332281577, 40.01589890417776],
      [-105.32047300758535, 40.01589890417776]
    ]],
    "type": "Polygon"
  }
}
```

## UUID Mapping Strategy

### Boundary Concept
All UUID ↔ integer mapping happens at the **boundary** of the pgRouting module:

```typescript
// Public method - accepts UUIDs
async findKShortestPaths(startNodeUuid: string, endNodeUuid: string)

// Private method - expects integers (for pgRouting)
private async _findKShortestPaths(startNodeId: number, endNodeId: number)
```

### Mapping Tables
- **`node_mapping`** - Maps node UUIDs to sequential integers
- **`edge_mapping`** - Maps edge UUIDs to sequential integers
- **Unique IDs:** `ROW_NUMBER() OVER (ORDER BY id)` ensures uniqueness

### Verification
Every trail name from staging schema matches exactly with `trail_master_db.trails`:
```
Staging Trail Name: Mesa Trail
Trail Master Name: Mesa Trail ✅
```

## pgRouting Functions Used

### Primary Functions
- **`pgr_ksp()`** - K-Shortest Paths algorithm
- **`pgr_createTopology()`** - Creates network topology
- **`pgr_analyzeGraph()`** - Analyzes graph connectivity

### SQL Structure
```sql
SELECT * FROM pgr_ksp(
  'SELECT gid as id, source, target, cost FROM staging_schema.ways',
  start_node_id::integer, 
  end_node_id::integer, 
  k::integer, 
  directed := false
)
```

## Data Processing Pipeline

### 1. Data Preparation
```sql
-- Create routing nodes from trail endpoints
INSERT INTO routing_nodes (id, lat, lng, node_type)
SELECT DISTINCT app_uuid, ST_Y(geom), ST_X(geom), 'endpoint'
FROM trails WHERE geom IS NOT NULL
```

### 2. Edge Generation
```sql
-- Create routing edges from trail segments
INSERT INTO routing_edges (id, trail_id, trail_name, geometry, length_km)
SELECT uuid(), app_uuid, name, geom, ST_Length(geom)/1000
FROM trails WHERE geom IS NOT NULL
```

### 3. pgRouting Table Creation
```sql
-- Create ways table for pgRouting
CREATE TABLE ways AS
SELECT em.pg_id as gid, sm.pg_id as source, tm.pg_id as target,
       e.length_km * 1000 as cost, e.geometry as the_geom
FROM routing_edges e
JOIN edge_mapping em ON e.id = em.uuid
JOIN node_mapping sm ON e.source = sm.uuid
JOIN node_mapping tm ON e.target = tm.uuid
```

### 4. Route Generation
```sql
-- Generate route recommendations
SELECT * FROM pgr_ksp(
  'SELECT gid as id, source, target, cost FROM ways',
  start_node_id, end_node_id, 3, false
)
```

## Test Results

### Bbox Analysis Results
- **Nodes:** 154 (intersection + endpoint nodes)
- **Edges:** 96 (trail segments)
- **Route Recommendations:** 3 (pgRouting generated)
- **UUID Mapping:** 100% accurate (verified against trail_master_db)

### Visualization Elements
- **Blue Lines:** Trail segments (routing_edges)
- **Green Circles:** Intersection nodes
- **Yellow Circles:** Endpoint nodes
- **Magenta Lines:** Route recommendations (pgRouting output)
- **Red Boundary:** Analysis bbox

## Integration Points

### Orchestrator Integration
- **`CarthorseOrchestrator.install()`** - Sets up staging schemas
- **`CarthorseOrchestrator.export()`** - Exports processed data
- **Independent pgRouting module** - Operates separately from other recommendations

### Database Integration
- **Read-only access** to `trail_master_db.public.trails`
- **Staging schemas** for processing (e.g., `staging_boulder_1754308823746`)
- **UUID preservation** throughout the pipeline

## Future Enhancements

1. **Additional Algorithms:** `pgr_dijkstra()`, `pgr_astar()`
2. **Performance Optimization:** Index optimization, query tuning
3. **Advanced Routing:** Multi-modal routing, elevation-based costs
4. **Real-time Updates:** Dynamic route recalculation

## Troubleshooting

### Common Issues
1. **UUID to Integer Mapping:** Ensure mapping tables exist and are populated
2. **pgRouting Function Errors:** Add explicit type casting (`::integer`, `::boolean`)
3. **Spatial Filtering:** Use `ST_Intersects()` for bbox filtering
4. **Node.js Module Issues:** Avoid `require()` for TypeScript files in CommonJS

### Debug Commands
```bash
# Check mapping tables
SELECT COUNT(*) FROM staging_schema.node_mapping;
SELECT COUNT(*) FROM staging_schema.edge_mapping;

# Verify pgRouting tables
SELECT COUNT(*) FROM staging_schema.ways;
SELECT COUNT(*) FROM staging_schema.ways_vertices_pgr;
``` 