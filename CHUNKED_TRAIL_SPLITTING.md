# Chunked Trail Splitting

## Overview

Chunked Trail Splitting is a new feature designed to solve the issue where `ST_Node()` fails to properly detect intersections when processing large datasets. This is particularly useful for large bounding boxes where the Y intersection detection fails.

## The Problem

When processing large datasets with many trails, the `ST_Node()` function in PostGIS can become unreliable and miss intersections. This was observed with:

- **Small bbox**: Works correctly, Y intersections are properly detected and split
- **Large bbox**: Fails to detect Y intersections, resulting in incorrect node degrees

## The Solution

Chunked Trail Splitting processes trails in connected subnetworks (chunks) rather than all at once:

1. **Identifies connected subnetworks** using spatial connectivity analysis
2. **Assigns chunk_id** to each trail based on which subnetwork it belongs to
3. **Processes each chunk separately** using `ST_Node()` on smaller, manageable datasets
4. **Preserves all intersections** because connected trails stay in the same chunk

## Usage

### Enable in Configuration

Edit `configs/layer1-trail.config.yaml`:

```yaml
layer1_trails:
  services:
    runChunkedTrailSplitting: true  # Enable chunked processing
```

### Enable in Code

```typescript
const trailProcessingConfig = {
  stagingSchema: 'your_schema',
  pgClient: yourPgClient,
  region: 'boulder',
  bbox: yourLargeBbox,
  
  // Enable chunked trail splitting
  runChunkedTrailSplitting: true,
  
  // Optionally disable other splitting services to isolate chunked splitting
  runStandaloneTrailSplitting: false,
  // ... other services
};
```

### Test the Feature

Run the test script:

```bash
npx ts-node test-chunked-trail-splitting.ts
```

## How It Works

### 1. Connectivity Analysis

The system identifies connected subnetworks by analyzing:
- **Physical intersections**: Trails that actually cross each other
- **Endpoint proximity**: Trails whose endpoints are within 1 meter of each other

### 2. Chunk Assignment

Each connected subnetwork gets a unique `chunk_id`. Isolated trails (not connected to any other trail) get their own individual chunk IDs.

### 3. Chunked Processing

For each chunk:
- Creates a temporary table with only that chunk's trails
- Applies `ST_Node()` to the smaller dataset
- Processes intersections reliably
- Merges results back into the main trails table

### 4. Database Schema

The staging trails table now includes a `chunk_id` column:

```sql
CREATE TABLE staging.trails (
  id SERIAL PRIMARY KEY,
  app_uuid UUID UNIQUE NOT NULL,
  chunk_id INTEGER,  -- For chunked processing
  -- ... other columns
);

CREATE INDEX idx_staging_trails_chunk_id ON staging.trails(chunk_id);
```

## Benefits

1. **Reliable Intersection Detection**: Each chunk is small enough for `ST_Node()` to work correctly
2. **Preserves Connectivity**: Connected trails stay together, so intersections are preserved
3. **Scalable**: Works regardless of total dataset size
4. **Maintains Data Integrity**: All processing happens in the staging database
5. **Fixes Y Intersection Issues**: The specific Y intersection at node 380 will be properly detected

## Performance

- **Memory Efficient**: Processes one chunk at a time
- **Database Optimized**: Uses indexed `chunk_id` column for efficient queries
- **Parallelizable**: Could be extended to process chunks in parallel if needed

## Example Output

```
🔄 Starting chunked trail splitting...
🔍 Identifying connected subnetworks and assigning chunk IDs...
✅ Chunk IDs assigned to all trails
📊 Found 15 chunks to process
🔄 Processing chunk 1 with 45 trails
✅ Chunk 1 processed: 67 segments created
🔄 Processing chunk 2 with 23 trails
✅ Chunk 2 processed: 31 segments created
...
✅ Chunked trail splitting completed: 15 chunks processed, 234 total segments created
```

## When to Use

Enable chunked trail splitting when:
- Processing large bounding boxes
- Experiencing missed Y intersections
- `ST_Node()` is failing on large datasets
- You need reliable intersection detection for route planning

## Configuration Options

```yaml
layer1_trails:
  services:
    runChunkedTrailSplitting: true
    toleranceMeters: 5.0                    # Spatial tolerance for connectivity
    minSegmentLengthMeters: 5.0             # Minimum segment length
```

## Troubleshooting

### Chunks Too Small
If chunks are too small (1-2 trails each), the connectivity tolerance might be too strict. Consider increasing `toleranceMeters`.

### Chunks Too Large
If chunks are still too large, the dataset might need further subdivision or the connectivity analysis might need refinement.

### Performance Issues
For very large datasets, consider:
- Processing chunks in parallel
- Using database connection pooling
- Optimizing the connectivity analysis query
