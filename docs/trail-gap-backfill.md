# Trail Gap Backfill System

This system identifies gaps in the trail network and backfills them with external data from APIs like Overpass (OpenStreetMap).

## Overview

The trail gap backfill system operates on the **master database** (`trail_master_db.public.trails`) to improve the source data quality. It does not modify existing trails - it only adds new trails to fill identified gaps.

## Key Features

- **Non-destructive**: Never modifies existing trails
- **Tagged data**: All backfilled trails are tagged with metadata for easy identification
- **Queryable**: Backfilled trails can be easily queried, analyzed, and deleted
- **Configurable**: Adjustable confidence thresholds, gap distances, and data sources
- **Separate operation**: Runs independently from the main export orchestrator

## Usage

### 1. Identify and Backfill Gaps

```bash
# Dry run to see what gaps would be filled
npm run backfill:gaps:dry-run -- --region boulder

# Generate visualization with connectivity analysis
npm run backfill:visualize -- --region boulder --confidence-threshold 0.6

# Actually backfill gaps
npm run backfill:gaps -- --region boulder --max-gap-distance 100 --confidence-threshold 0.6
```

### 2. List Backfilled Trails

```bash
# List all backfilled trails
npm run backfilled:list

# List with filters
npm run backfilled:list -- --confidence-min 0.8 --source overpass --limit 20
```

### 3. View Statistics

```bash
# Get statistics about backfilled trails
npm run backfilled:stats
```

### 4. Delete Backfilled Trails

```bash
# Dry run to see what would be deleted
npm run backfilled:delete -- --confidence-max 0.5 --dry-run

# Delete low-confidence trails
npm run backfilled:delete -- --confidence-max 0.5

# Delete trails from a specific backfill operation
npm run backfilled:delete -- --backfill-id backfill_1234567890_abc123
```

## Configuration Options

### Backfill Command Options

- `--region <region>`: Region to process (default: boulder)
- `--max-gap-distance <meters>`: Maximum gap distance to consider (default: 100m)
- `--confidence-threshold <score>`: Minimum confidence for adding trails (default: 0.6)
- `--bbox-expansion <meters>`: Bbox expansion for API queries (default: 50m)
- `--enable-overpass`: Enable Overpass API queries (default: true)
- `--enable-other-apis`: Enable other API integrations (default: false)
- `--dry-run`: Identify gaps without adding trails
- `--visualize`: Export visualization GeoJSON with candidates
- `--visualize-path <path>`: Output path for visualization GeoJSON (default: backfill-visualization.geojson)
- `--include-existing-trails`: Include existing trails in visualization
- `--include-connectivity`: Include connectivity analysis in visualization

### List Command Options

- `--backfill-id <id>`: Filter by specific backfill ID
- `--date-start <date>`: Filter by start date (ISO format)
- `--date-end <date>`: Filter by end date (ISO format)
- `--confidence-min <score>`: Minimum confidence score (0-1)
- `--source <source>`: Filter by data source (overpass, other_api)
- `--limit <number>`: Limit number of results (default: 50)

### Delete Command Options

- `--backfill-id <id>`: Delete by specific backfill ID
- `--date-start <date>`: Delete by start date (ISO format)
- `--date-end <date>`: Delete by end date (ISO format)
- `--confidence-max <score>`: Delete trails with confidence below this score
- `--source <source>`: Delete trails from specific source
- `--dry-run`: Show what would be deleted without actually deleting

## Data Structure

### Backfilled Trail Metadata

Each backfilled trail includes metadata in JSON format:

```json
{
  "backfill_id": "backfill_1234567890_abc123",
  "backfill_timestamp": "2024-01-15T10:30:00.000Z",
  "gap_trail1_id": "uuid1",
  "gap_trail1_name": "Trail A",
  "gap_trail2_id": "uuid2", 
  "gap_trail2_name": "Trail B",
  "gap_distance_meters": 75.5,
  "candidate_source": "overpass",
  "candidate_confidence": 0.85,
  "backfill_version": "1.0.0"
}
```

### Trail Identification

Backfilled trails are identified by:
- `region = 'backfilled'` in the trails table
- Metadata JSON containing backfill information
- Unique backfill IDs for tracking operations

## SQL Queries

### Find All Backfilled Trails

```sql
SELECT * FROM public.trails 
WHERE region = 'backfilled'
ORDER BY metadata->>'backfill_timestamp' DESC;
```

### Find High-Confidence Backfilled Trails

```sql
SELECT * FROM public.trails 
WHERE region = 'backfilled' 
  AND CAST(metadata->>'candidate_confidence' AS FLOAT) >= 0.8;
```

### Find Trails from Specific Backfill Operation

```sql
SELECT * FROM public.trails 
WHERE region = 'backfilled' 
  AND metadata->>'backfill_id' = 'backfill_1234567890_abc123';
```

### Delete Low-Confidence Backfilled Trails

```sql
DELETE FROM public.trails 
WHERE region = 'backfilled' 
  AND CAST(metadata->>'candidate_confidence' AS FLOAT) < 0.5;
```

## Workflow

1. **Analysis**: Run dry-run to identify gaps and estimate impact
2. **Visualization**: Generate GeoJSON visualization to see the impact
3. **Connectivity Analysis**: Review connectivity improvements before/after
4. **Backfill**: Execute backfill with appropriate confidence thresholds
5. **Review**: List and analyze the added trails
6. **Validate**: Check the quality of backfilled trails
7. **Cleanup**: Delete any low-quality or incorrect trails if needed

## Visualization Features

The system can generate comprehensive GeoJSON visualizations that include:

### Color-Coded Elements
- **🟢 Sea Green**: Existing trails
- **🔴 Red (Dashed)**: Gap connections between trail endpoints
- **🟠 Orange Red**: Gap endpoint markers
- **🟢 Lime Green**: Selected candidate trails (solid lines)
- **🟡 Gold (Dashed)**: Rejected candidate trails
- **🩷 Light Pink**: Low confidence candidates

### Connectivity Analysis
The visualization includes connectivity metrics:
- **Before Backfill**: Current connectivity percentage, reachable nodes, isolated components
- **After Backfill**: Projected connectivity with selected candidates
- **Improvement**: Percentage increase, additional reachable nodes, reduced components

### Example Usage
```bash
# Generate full visualization with connectivity analysis
npm run backfill:visualize -- --region boulder --confidence-threshold 0.6

# Custom visualization path
npm run backfill:gaps:dry-run -- --region boulder --visualize --visualize-path my-analysis.geojson --include-connectivity
```

## Best Practices

- Always start with a dry-run to understand what will be added
- Use conservative confidence thresholds (0.6-0.8) initially
- Review backfilled trails before using them in exports
- Keep track of backfill IDs for easy cleanup if needed
- Monitor the impact on downstream data quality

## Integration with Export Process

The backfill system is designed to be run **before** the main export process:

1. Run trail gap backfill to improve source data
2. Run the normal export process
3. The improved trail data will flow through to edges and routes

This ensures that the backfilled trails are included in the network processing and route generation.
