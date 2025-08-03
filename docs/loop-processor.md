# Loop Processor

The `LoopProcessor` is a dedicated utility class for detecting and processing loop trails in the Carthorse trail network. Loops are trails that begin and end at the same point, which require special handling for routing.

## Overview

Loops are common in trail networks (e.g., circular hiking trails, mountain bike loops). The `LoopProcessor` identifies these loops and converts them into proper routing nodes and edges that can be integrated with the main network.

## Features

- **Automatic Loop Detection**: Identifies trails where start and end points are identical
- **Loop Segmentation**: Splits loops into manageable segments for routing
- **Node Creation**: Creates routing nodes at loop segment endpoints
- **Edge Generation**: Creates routing edges between loop nodes
- **Network Integration**: Seamlessly integrates loops with the main routing network
- **Duplicate Prevention**: Avoids creating duplicate nodes/edges
- **Statistics**: Provides detailed statistics about loop processing

## Usage

The `LoopProcessor` is automatically integrated into the Carthorse orchestrator workflow. It runs as **Step 4** in the routing graph generation process.

### Manual Usage

```typescript
import { LoopProcessor } from '../utils/loop-processor';

// Create processor instance
const loopProcessor = new LoopProcessor(pgClient, stagingSchema);

// Process loops with tolerance settings
await loopProcessor.detectAndProcessLoops(2.0, 20.0);

// Get loop statistics
const stats = await loopProcessor.getLoopStatistics();
console.log(`Found ${stats.totalLoops} loops, created ${stats.loopNodes} nodes, ${stats.loopEdges} edges`);
```

## Processing Steps

### 1. Loop Detection
Identifies trails where `ST_Equals(ST_StartPoint(geometry), ST_EndPoint(geometry))`

### 2. Loop Segmentation
Splits loop geometries into segments using `ST_Segmentize()` for better routing granularity

### 3. Node Extraction
Extracts start and end points from each loop segment

### 4. Node Deduplication
Groups nodes by location and snaps to grid to avoid floating-point precision issues

### 5. Edge Network Building
Creates edges between loop nodes based on segment connectivity

### 6. Network Integration
Adds loop nodes and edges to the main routing network, avoiding duplicates

## Configuration

The processor uses tolerance settings from the route discovery configuration:

- **Node Tolerance**: Distance for grouping nearby nodes (default: 2.0m)
- **Edge Tolerance**: Distance for edge connections (default: 20.0m)

## Output

The processor creates:

- **Loop Nodes**: Nodes with `node_type = 'loop_node'`
- **Loop Edges**: Edges connecting loop nodes with proper trail metadata
- **Statistics**: Detailed counts of processed loops, nodes, and edges

## Integration with Orchestrator

The `LoopProcessor` is automatically called during the routing graph generation:

```typescript
// In CarthorseOrchestrator.generateRoutingGraph()
const loopProcessor = new LoopProcessor(this.pgClient, this.stagingSchema);
await loopProcessor.detectAndProcessLoops(nodeTolerance, edgeTolerance);
```

## Benefits

- **Complete Network Coverage**: Ensures all trails, including loops, are included in routing
- **Proper Connectivity**: Creates valid routing connections for loop trails
- **Metadata Preservation**: Maintains trail names, lengths, and elevation data
- **Performance**: Efficient processing with temporary tables and cleanup
- **Modularity**: Separate class allows for easy testing and maintenance

## Example Output

```
🔄 Detecting and processing loops with tolerances: 2m (nodes), 20m (edges)
🔄 Step 1: Identifying loop segments...
🔄 Found 3 loop segments
🔄 Step 2: Splitting loop geometries into segments...
🔄 Created 12 loop edge segments
🔄 Step 3: Creating loop nodes from segments...
🔄 Step 4: Deduplicating and snapping loop nodes...
🔄 Created 6 unique loop nodes
🔄 Step 5: Building loop edges by joining start/end to nodes...
🔄 Created 8 loop network edges
🔄 Step 6: Adding loop nodes to main routing network...
🔄 Added 4 new loop nodes to routing network
🔄 Step 7: Adding loop edges to main routing network...
🔄 Added 6 new loop edges to routing network
🔄 Cleaning up temporary loop tables...
✅ Loop processing complete:
   - Original loops: 3
   - Loop nodes added: 4
   - Loop edges added: 6
``` 