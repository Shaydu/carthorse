# Data Sources Organization

## Overview

The CARTHORSE pipeline uses a **hybrid data source approach** that combines local OSM extracts with PostgreSQL for efficient trail data processing.

## CLI Data Ingestion & Export

The main entry point for orchestrating data ingestion, processing, and export is the CLI:

```bash
carthorse --region <region> --out <output_path> [options]
```

See the [README](../../README.md#cli-usage) for a full list of options and usage examples.

- Use `--build-master` to build the master database from OSM data.
- Use `--validate` to run validation after export.
- Use `--skip-incomplete-trails` to skip trails missing geometry or elevation.

Example:

```bash
carthorse --region boulder --out data/boulder.db --build-master --validate
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    DATA SOURCES                                │
├─────────────────────────────────────────────────────────────────┤
│ 1. OSM Extracts: /path/to/source-data/osm/                   │
│    boulder-colorado.osm.pbf (321MB)                          │
│    seattle-washington.osm.pbf                                 │
│                                                               │
│ 2. Elevation TIFFs: /path/to/source-data/                    │
│    elevation-data/ (DEM files)                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                POSTGRESQL DATABASE                             │
├─────────────────────────────────────────────────────────────────┤
│ Database: trail_master_db                                     │
│                                                               │
│ Schema Organization:                                          │
│ ├── public (master application data)                          │
│ ├── osm_boulder (OSM data for Boulder region)                │
│ ├── osm_seattle (OSM data for Seattle region)                │
│ └── staging_* (temporary processing schemas)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                PROCESSING PIPELINE                             │
├─────────────────────────────────────────────────────────────────┤
│ 1. Load OSM PBF into PostgreSQL schemas                      │
│ 2. Extract trails using spatial queries                      │
│ 3. Process elevation data from TIFF files                    │
│ 4. Insert into public.trails (master database)               │
│ 5. Export to SpatiaLite (application database)               │
└─────────────────────────────────────────────────────────────────┘
```

## Data Source Types

### 1. OSM Extracts (.osm.pbf)

**Location:** `/path/to/source-data/osm/`

**Format:** Protocol Buffer Binary Format (PBF) - most efficient OSM format

**Files:**
- `boulder-colorado.osm.pbf` (321MB)
- `seattle-washington.osm.pbf` (planned)
- `denver-colorado.osm.pbf` (planned)

**Advantages over Overpass API:**
- ✅ **Reproducible** - Same data every time
- ✅ **Faster** - No network calls, local processing
- ✅ **Complete** - All OSM data, not just current
- ✅ **Reliable** - No API rate limits or downtime
- ✅ **Offline** - Can work without internet

### 2. Elevation TIFFs

**Location:** `/path/to/source-data/elevation-data/`

**Format:** GeoTIFF files (Digital Elevation Models)

**Coverage:** High-resolution elevation data for trail regions

**Processing:** Backfilled into trail geometry for 3D elevation profiles

## PostgreSQL Organization

### Database: `trail_master_db`

**Schema Strategy:** Separate schemas for different data types

#### `public` Schema (Main Application Data)
```sql
-- Processed trail data (final output)
CREATE TABLE public.trails (
  id SERIAL PRIMARY KEY,
  app_uuid TEXT UNIQUE,
  osm_id TEXT,
  name TEXT,
  geometry GEOMETRY(LINESTRINGZ, 4326),
  elevation_gain REAL,
  elevation_loss REAL,
  length_km REAL,
  region TEXT,
  -- ... other fields
);

-- Region configurations
CREATE TABLE public.regions (
  region_key TEXT PRIMARY KEY,
  bbox_min_lng REAL,
  bbox_max_lng REAL,
  bbox_min_lat REAL,
  bbox_max_lat REAL
);
```

#### `osm_boulder` Schema (OSM Data for Boulder)
```sql
-- Raw OSM ways (trails)
CREATE TABLE osm_boulder.ways (
  osm_id BIGINT PRIMARY KEY,
  name TEXT,
  highway TEXT,
  route TEXT,
  surface TEXT,
  difficulty TEXT,
  tags JSONB,
  way_geom GEOMETRY(LINESTRING, 4326)
);

-- OSM nodes (way coordinates)
CREATE TABLE osm_boulder.nodes (
  osm_id BIGINT PRIMARY KEY,
  lat REAL,
  lon REAL,
  node_geom GEOMETRY(POINT, 4326)
);
```

#### `osm_seattle` Schema (OSM Data for Seattle)
```sql
-- Same structure as osm_boulder but for Seattle region
```

## Data Flow

### Stage 1: OSM Data Loading
```bash
# Load OSM PBF into PostgreSQL schema
osm2pgsql --create --slim --schema=osm_boulder boulder-colorado.osm.pbf
```

### Stage 2: Trail Extraction
```sql
-- Query trails using same criteria as Overpass API
SELECT osm_id, name, highway, route, surface, tags, way_geom
FROM osm_boulder.ways
WHERE 
  name IS NOT NULL 
  AND (
    (highway IN ('path', 'track', 'footway', 'cycleway', 'bridleway') 
     AND surface IN ('dirt', 'gravel', 'unpaved', 'ground', 'fine_gravel', 'grass', 'sand', 'rock', 'compacted', 'earth', 'natural'))
    OR
    (route IN ('hiking', 'foot', 'walking') 
     AND surface IN ('dirt', 'gravel', 'unpaved', 'ground', 'fine_gravel', 'grass', 'sand', 'rock', 'compacted', 'earth', 'natural'))
  )
  AND way_geom IS NOT NULL
  AND ST_NumPoints(way_geom) >= 2;
```

### Stage 3: Elevation Processing
```bash
# Backfill elevation from TIFF files
# Process 3D geometry with elevation data
```

### Stage 4: Master Database Population
```sql
-- Insert processed trails into public.trails
INSERT INTO public.trails (osm_id, name, geometry, elevation_gain, ...)
VALUES (...);
```

## Environment Configuration

### Source Data Directory
```bash
# Environment variable for source data location
export SOURCE_DATA_DIR="/path/to/source-data"

# Directory structure
$SOURCE_DATA_DIR/
├── osm/
│   ├── boulder-colorado.osm.pbf
│   └── seattle-washington.osm.pbf
└── elevation-data/
    ├── boulder-dem.tiff
    └── seattle-dem.tiff
```

### PostgreSQL Configuration
```bash
# Database connection
DATABASE_URL="postgresql://postgres@localhost:5432/trail_master_db"

# Schema naming convention
OSM_SCHEMA_PREFIX="osm_"  # Results in: osm_boulder, osm_seattle
```

## Development Dependencies

### Required Tools (via Homebrew)
```bash
# OSM processing tools
brew install osmium-tool    # OSM data manipulation
brew install osm2pgsql      # OSM to PostgreSQL import

# Version tracking in package.json
{
  "osmTools": {
    "description": "OSM processing tools (installed via Homebrew)",
    "osmium-tool": "1.18.0_1",
    "osm2pgsql": "2.1.1"
  }
}
```

### Node.js Dependencies
```json
{
  "dependencies": {
    "pg": "^8.16.3",           // PostgreSQL client
    "osm-pbf-parser": "^2.3.0" // OSM PBF parsing (fallback)
  }
}
```

## Benefits of This Approach

### 1. **Reproducibility**
- Fixed OSM extracts ensure consistent results
- No dependency on live API availability
- Version-controlled data sources

### 2. **Performance**
- Local PostgreSQL queries vs. network API calls
- Spatial indexing for fast geometry queries
- Batch processing capabilities

### 3. **Flexibility**
- Can modify filtering criteria without API changes
- Easy to add new regions
- Can process historical OSM data

### 4. **Reliability**
- No API rate limits or downtime
- Offline processing capability
- Backup and restore of complete data

### 5. **Scalability**
- Separate schemas for different regions
- Easy to add new data sources
- Efficient storage and querying

## Migration from Overpass API

### Before (Overpass API)
```typescript
// Query live API
const overpassTrails = await queryOverpassAPI(bbox);
```

### After (OSM Extracts)
```typescript
// Load OSM data into PostgreSQL
const osmLoader = createOSMPostgresLoader('boulder');
await osmLoader.loadOSMData();

// Query local PostgreSQL
const trails = await osmLoader.extractTrails();
```

## Future Enhancements

### 1. **Automated Updates**
- Scheduled OSM extract downloads
- Incremental updates from OSM changesets
- Version management of extracts

### 2. **Additional Data Sources**
- USGS elevation data integration
- Weather data for trail conditions
- Trail maintenance data

### 3. **Advanced Processing**
- Machine learning for trail classification
- Automatic trail difficulty assessment
- Seasonal trail availability

## Troubleshooting

### Common Issues

1. **OSM Extract Not Found**
   ```bash
   # Check file exists
   ls -la $SOURCE_DATA_DIR/osm/boulder-colorado.osm.pbf
   ```

2. **PostgreSQL Connection Issues**
   ```bash
   # Test connection
   psql -h localhost -U postgres -d trail_master_db
   ```

3. **osm2pgsql Not Found**
   ```bash
   # Install via Homebrew
   brew install osm2pgsql
   ```

4. **Schema Permission Issues**
   ```sql
   -- Grant permissions
   GRANT ALL ON SCHEMA osm_boulder TO postgres;
   ``` 