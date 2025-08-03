# PgRouting Orchestrator Documentation

## Overview

The PgRouting Orchestrator is a specialized version of the Carthorse Orchestrator that uses pgRouting to generate advanced routing networks. It creates a staging schema based on the `trail_master_db` and uses pgRouting functions to generate a comprehensive routing network that can be exported to SQLite.

**🔒 SAFETY GUARANTEE**: This orchestrator is designed with strict safety constraints to ensure it never modifies the `trail_master_db`. All operations are contained within staging schemas only, and the production database is accessed in READ-ONLY mode.

## Key Features

- **PgRouting Integration**: Uses pgRouting extension for advanced routing network generation
- **Staging Schema**: Creates isolated PostgreSQL schemas for processing
- **Node Network**: Automatically creates node networks from trail geometries
- **Topology Analysis**: Performs graph analysis and topology creation
- **Export Ready**: Generates routing nodes and edges ready for export
- **🔒 Safety First**: READ-ONLY access to trail_master_db, all modifications in staging schemas only

## Prerequisites

### Database Requirements

1. **PostgreSQL with PostGIS**: Must have PostGIS extension installed
2. **PgRouting Extension**: Must have pgRouting extension installed
3. **Trail Master Database**: Must have `trail_master_db` with trail data

### Installing PgRouting

```bash
# On Ubuntu/Debian
sudo apt-get install postgresql-14-pgrouting

# On macOS with Homebrew
brew install postgis
# Note: pgRouting is included with PostGIS on macOS

# On CentOS/RHEL
sudo yum install postgresql14-pgrouting
```

### Verifying Installation

```sql
-- Check if pgRouting extension is available
SELECT EXISTS(
  SELECT 1 FROM pg_extension WHERE extname = 'pgrouting'
) as pgrouting_available;

-- Check for required functions
SELECT proname FROM pg_proc 
WHERE proname IN ('pgr_nodeNetwork', 'pgr_createTopology', 'pgr_analyzeGraph');
```

## Usage

### Command Line Interface

```bash
# Basic usage
carthorse-pgrouting --region boulder --out data/boulder-pgrouting.db

# With custom pgRouting tolerance
carthorse-pgrouting --region boulder --out data/boulder-pgrouting.db --pgrouting-tolerance 0.0005

# With bounding box
carthorse-pgrouting --region boulder --out data/boulder-pgrouting.db --bbox -105.281,40.066,-105.235,40.105

# With trail limit
carthorse-pgrouting --region boulder --out data/boulder-pgrouting.db --limit 1000

# Skip validation for faster processing
carthorse-pgrouting --region boulder --out data/boulder-pgrouting.db --skip-validation
```

### Programmatic Usage

```typescript
import { PgRoutingOrchestrator } from './src/orchestrator/PgRoutingOrchestrator';

const config = {
  region: 'boulder',
  outputPath: 'data/boulder-pgrouting.db',
  pgroutingTolerance: 0.0001,
  usePgroutingTopology: true,
  exportRoutingNetwork: true,
  // ... other configuration options
};

const orchestrator = new PgRoutingOrchestrator(config);
await orchestrator.run();
```

## Configuration Options

### PgRouting-Specific Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `pgroutingTolerance` | number | 0.0001 | Tolerance for pgRouting node network creation |
| `usePgroutingTopology` | boolean | true | Whether to use pgRouting topology functions |
| `exportRoutingNetwork` | boolean | true | Whether to export the routing network |

### Standard Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `region` | string | 'boulder' | Region to process |
| `outputPath` | string | 'data/output.db' | Output database path |
| `simplifyTolerance` | number | 0.001 | Geometry simplification tolerance |
| `intersectionTolerance` | number | 2.0 | Intersection detection tolerance |
| `validate` | boolean | true | Whether to validate export |
| `verbose` | boolean | false | Enable verbose logging |

## Pipeline Steps

### 1. Setup and Validation

- Checks for pgRouting extension availability
- Validates required pgRouting functions
- Connects to PostgreSQL database
- **🔒 Safety Validation**: Ensures all operations will be contained in staging schemas

### 2. Staging Environment Creation

- Creates unique staging schema (e.g., `staging_boulder_1234567890`)
- Creates standard staging tables
- Creates pgRouting-specific tables:
  - `trails_noded`: Node network table
  - `trails_vertices_pgr`: Vertices table

### 3. Data Copy

- **🔒 READ-ONLY**: Copies region data from `public.trails` to staging schema (READ-ONLY access to trail_master_db)
- Applies bounding box filters if specified
- Validates geometry and data integrity

### 4. PgRouting Network Generation

**🔒 SAFETY**: All pgRouting operations are performed only on staging schema tables

#### Node Network Creation
```sql
SELECT pgr_nodeNetwork(
  'staging_schema.trails',
  tolerance,
  'id',
  'geometry'
);
```

#### Topology Creation
```sql
SELECT pgr_createTopology(
  'staging_schema.trails_noded',
  tolerance,
  'geometry',
  'id'
);
```

#### Graph Analysis
```sql
SELECT pgr_analyzeGraph(
  'staging_schema.trails_noded',
  tolerance,
  'geometry',
  'id',
  'source',
  'target'
);
```

### 5. Routing Nodes and Edges Generation

- Creates routing nodes from pgRouting vertices
- Creates routing edges from noded trails
- Preserves trail metadata and elevation data

### 6. Export and Validation

- Exports routing network to SQLite
- Validates node and edge counts
- Performs comprehensive cleanup

## Staging Schema Structure

### Core Tables

```sql
-- Standard staging tables
CREATE TABLE staging_schema.trails (
  id SERIAL PRIMARY KEY,
  app_uuid TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  geometry GEOMETRY(LINESTRINGZ, 4326),
  -- ... other trail fields
);

CREATE TABLE staging_schema.routing_nodes (
  id SERIAL PRIMARY KEY,
  node_uuid TEXT UNIQUE,
  lat REAL,
  lng REAL,
  elevation REAL,
  node_type TEXT,
  connected_trails TEXT,
  trail_ids TEXT[]
);

CREATE TABLE staging_schema.routing_edges (
  id SERIAL PRIMARY KEY,
  source INTEGER,
  target INTEGER,
  trail_id TEXT,
  trail_name TEXT,
  length_km REAL,
  elevation_gain REAL,
  elevation_loss REAL,
  is_bidirectional BOOLEAN,
  geometry geometry(LineString, 4326)
);
```

### PgRouting Tables

```sql
-- PgRouting node network table
CREATE TABLE staging_schema.trails_noded (
  id SERIAL PRIMARY KEY,
  old_id INTEGER,
  sub_id INTEGER,
  source INTEGER,
  target INTEGER,
  cost REAL,
  reverse_cost REAL,
  geometry geometry(LineString, 4326)
);

-- PgRouting vertices table
CREATE TABLE staging_schema.trails_vertices_pgr (
  id SERIAL PRIMARY KEY,
  cnt INTEGER,
  chk INTEGER,
  ein INTEGER,
  eout INTEGER,
  the_geom geometry(Point, 4326)
);
```

## Performance Considerations

### Tolerance Settings

- **Lower tolerance** (e.g., 0.0001): More precise node placement, more nodes/edges
- **Higher tolerance** (e.g., 0.001): Less precise, fewer nodes/edges, faster processing

### Memory Usage

- PgRouting operations can be memory-intensive
- Consider processing smaller regions or using bbox filters
- Monitor PostgreSQL memory usage during processing

### Processing Time

- Node network creation: O(n²) where n is number of trail segments
- Topology creation: O(n log n)
- Graph analysis: O(n)

## 🔒 Safety Guarantees

### Database Safety

The PgRouting Orchestrator is designed with multiple safety layers to ensure it never modifies the `trail_master_db`:

1. **Schema Naming Validation**: All staging schemas must start with `staging_`
2. **READ-ONLY Access**: trail_master_db is accessed only for reading data
3. **Staging Isolation**: All modifications happen only in staging schemas
4. **Runtime Validation**: Safety checks are performed at runtime
5. **Explicit Logging**: All operations are logged with safety indicators

### Safety Checks

The orchestrator performs these safety validations:

- ✅ Staging schema naming pattern validation
- ✅ Database connection validation
- ✅ Schema isolation verification
- ✅ READ-ONLY access enforcement
- ✅ Runtime safety constraint validation

### What the Orchestrator Does NOT Do

- ❌ Never modifies `public.trails` table
- ❌ Never creates routing tables in public schema
- ❌ Never drops or modifies existing production data
- ❌ Never runs pgRouting operations on production tables
- ❌ Never writes to trail_master_db

### What the Orchestrator Does

- ✅ Creates isolated staging schemas
- ✅ Reads trail data from trail_master_db (READ-ONLY)
- ✅ Performs pgRouting operations in staging only
- ✅ Exports results to SQLite
- ✅ Cleans up staging schemas after export

## Troubleshooting

### Common Issues

#### PgRouting Extension Not Found
```
❌ pgRouting extension is not installed. Please install pgRouting first.
```
**Solution**: Install pgRouting extension for your PostgreSQL version.

#### Required Functions Missing
```
❌ Required pgRouting function 'pgr_nodeNetwork' is not available.
```
**Solution**: Ensure pgRouting extension is properly installed and loaded.

#### Memory Issues
```
ERROR: out of memory
```
**Solution**: 
- Reduce region size using bbox filters
- Increase PostgreSQL shared_buffers
- Process smaller batches of trails

#### Geometry Issues
```
ERROR: geometry is not valid
```
**Solution**: 
- Check trail geometries in source database
- Use `ST_IsValid()` to identify problematic geometries
- Consider geometry simplification

### Debugging

Enable verbose logging:
```bash
carthorse-pgrouting --region boulder --out data/boulder-pgrouting.db --verbose
```

Skip cleanup for debugging:
```bash
carthorse-pgrouting --region boulder --out data/boulder-pgrouting.db --skip-cleanup
```

## Comparison with Standard Orchestrator

| Feature | Standard Orchestrator | PgRouting Orchestrator |
|---------|----------------------|------------------------|
| Intersection Detection | PostGIS spatial functions | PgRouting node network |
| Node Generation | Manual endpoint/intersection detection | Automatic from pgRouting vertices |
| Edge Generation | Manual trail segment analysis | Automatic from noded trails |
| Topology Analysis | Basic connectivity | Advanced graph analysis |
| Performance | Good for small datasets | Optimized for large networks |
| Accuracy | High precision | Configurable precision |

## Examples

### Basic Export
```bash
# Export Boulder region with default settings
carthorse-pgrouting --region boulder --out data/boulder-pgrouting.db
```

### High Precision Export
```bash
# Export with high precision node network
carthorse-pgrouting --region boulder --out data/boulder-precise.db --pgrouting-tolerance 0.00005
```

### Large Region Export
```bash
# Export large region with lower precision for performance
carthorse-pgrouting --region seattle --out data/seattle-pgrouting.db --pgrouting-tolerance 0.001
```

### Debug Export
```bash
# Export with debugging enabled
carthorse-pgrouting --region boulder --out data/boulder-debug.db --verbose --skip-cleanup
``` 