# Intersection-Based Orchestrator

## Overview

The Intersection-Based Orchestrator is a parallel implementation of the Carthorse routing system that uses an alternative strategy for creating routing networks. Unlike the main orchestrator which uses a more complex intersection detection and trail splitting approach, this implementation follows a simpler, more direct method based on the SQL logic you provided.

## Key Differences from Main Orchestrator

### Main Orchestrator Approach
- Complex intersection detection with tolerance-based matching
- Sophisticated trail splitting algorithms
- Advanced node deduplication and snapping
- Comprehensive validation and error handling

### Intersection-Based Approach
- Direct intersection detection using PostGIS `ST_Intersection`
- Simple line densification for better intersection detection
- Straightforward node extraction from start/end points and intersections
- Basic grid snapping for node deduplication
- Direct trail splitting at node locations

## Architecture

The intersection-based orchestrator follows these steps:

1. **Create Working Copy**: Copy trail geometry to a working table
2. **Densify Lines**: Use `ST_Segmentize` to add more points for better intersection detection
3. **Detect Intersections**: Find all trail intersections using `ST_Intersection`
4. **Extract Nodes**: Collect start points, end points, and intersection points
5. **Create Unique Nodes**: Snap nodes to grid and deduplicate
6. **Split Trails**: Split all trails at node locations to create graph edges
7. **Assign Node IDs**: Create numbered node IDs
8. **Build Network**: Assign source and target nodes to each edge

## Usage

### Installation

```bash
# Install the intersection-based routing system
npx ts-node src/cli/intersection-export.ts install

# Install test database with sample data
npx ts-node src/cli/intersection-export.ts install-test --region boulder --limit 1000
```

### Processing Trails

```bash
# Process trails with default settings
npx ts-node src/cli/intersection-export.ts process

# Process with custom parameters
npx ts-node src/cli/intersection-export.ts process \
  --densify 10 \
  --snap 0.0001 \
  --segmentize 10
```

### Validation

```bash
# Validate the intersection-based network
npx ts-node src/cli/intersection-export.ts validate
```

### Cleanup

```bash
# Clean up staging schemas
npx ts-node src/cli/intersection-export.ts cleanup
```

## Configuration Options

| Parameter | Default | Description |
|-----------|---------|-------------|
| `densifyDistance` | 5 | Distance in meters for line densification |
| `snapTolerance` | 0.00001 | Tolerance for snapping nodes to grid |
| `segmentizeDistance` | 5 | Distance for ST_Segmentize |

## Database Schema

The intersection-based orchestrator creates these additional tables in the staging schema:

- `working_trails`: Working copy of trail geometry
- `trail_intersections`: Points where trails intersect
- `trail_nodes`: All node points (start, end, intersections)
- `unique_nodes`: Deduplicated nodes with grid snapping
- `graph_edges`: Trail segments split at nodes
- `graph_nodes`: Numbered node IDs
- `graph_network`: Final network with source/target assignments

## Advantages

1. **Simplicity**: Direct implementation of the SQL logic you provided
2. **Transparency**: Each step is clearly defined and easy to understand
3. **Parallel**: Doesn't interfere with the existing orchestrator
4. **Configurable**: Key parameters can be adjusted for different scenarios
5. **Testable**: Comprehensive test suite included

## Limitations

1. **Export Not Implemented**: SQLite export functionality is not yet implemented
2. **Basic Validation**: Limited validation compared to main orchestrator
3. **No Elevation**: Elevation processing not yet integrated
4. **No Recommendations**: Route recommendation generation not implemented

## Future Enhancements

1. **SQLite Export**: Implement export to SQLite database
2. **Elevation Integration**: Add elevation processing capabilities
3. **Route Recommendations**: Implement route recommendation generation
4. **Advanced Validation**: Add more comprehensive network validation
5. **Performance Optimization**: Optimize for large datasets

## Testing

Run the test suite:

```bash
npm test -- --testNamePattern="IntersectionBasedOrchestrator"
```

## Integration with Main Orchestrator

The intersection-based orchestrator is designed to be completely separate from the main orchestrator. It:

- Uses different staging schema names (`staging_intersection_*`)
- Has its own CLI interface
- Follows the same patterns but with different implementation
- Can be used alongside the main orchestrator for comparison

## Example Workflow

```bash
# 1. Install the system
npx ts-node src/cli/intersection-export.ts install

# 2. Install test database
npx ts-node src/cli/intersection-export.ts install-test --region boulder --limit 500

# 3. Process trails
npx ts-node src/cli/intersection-export.ts process --densify 5 --snap 0.00001

# 4. Validate results
npx ts-node src/cli/intersection-export.ts validate

# 5. Clean up
npx ts-node src/cli/intersection-export.ts cleanup
```

This will create a complete intersection-based routing network that you can compare with the main orchestrator's results. 