# Three-Layer Configuration Structure

## Overview

The `carthorse.config.yaml` file has been reorganized to reflect the 3-layer architecture of the Carthorse pipeline. This makes it clear which configurations apply to which processing layer.

## Layer Structure

### Layer 1: Trails (`layer1_trails`)
**Purpose**: Process and clean the raw trail network

**Configuration Sections**:
- **`cleanup`**: Trail validation and filtering
  - `minTrailLengthMeters`: Minimum trail length to keep
  - `removeInvalidGeometries`: Remove trails with invalid geometries
  - `removeZeroLengthTrails`: Remove trails with zero length

- **`gapFixing`**: Automatic trail gap detection and fixing
  - `enabled`: Enable/disable gap fixing
  - `minGapDistanceMeters`: Minimum gap distance to consider
  - `maxGapDistanceMeters`: Maximum gap distance to fix

- **`overpassBackfill`**: Query OpenStreetMap for missing trails
  - `enabled`: Enable/disable Overpass API queries
  - `timeoutSeconds`: API request timeout
  - `maxTrailsPerRequest`: Maximum trails to process per bbox
  - `trailTypes`: Types of trails to include from OSM
  - `excludeSurfaces`: Surface types to exclude

- **`deduplication`**: Remove duplicate trails
  - `enabled`: Enable/disable deduplication
  - `overlapThreshold`: Overlap percentage for considering trails duplicate
  - `distanceThreshold`: Distance threshold for very close trails
  - `preserveLongestTrail`: Keep longest trail when duplicates found

### Layer 2: Edges & Vertices (`layer2_edges`)
**Purpose**: Create routable network from trails

**Configuration Sections**:
- **`edgeCreation`**: Convert trails to routing edges
  - `enabled`: Enable/disable edge creation
  - `preserveTrailMetadata`: Keep trail metadata in edges
  - `addElevationData`: Include elevation data in edges

- **`noding`**: Create vertices at trail intersections
  - `enabled`: Enable/disable network noding
  - `intersectionTolerance`: Tolerance for finding intersections
  - `preserveTrueLoops`: Preserve actual loop trails
  - `trueLoopTolerance`: Tolerance for identifying true loops

- **`merging`**: Edge merging and optimization
  - `enableDegree2Merging`: Enable degree-2 chain merging
  - `enableOverlapDeduplication`: Enable overlap deduplication
  - `degree2MergeTolerance`: Tolerance for degree-2 merging
  - `spatialTolerance`: General spatial tolerance

- **`bridging`**: Connect disconnected network components
  - `trailBridgingEnabled`: Enable trail-level bridging
  - `edgeBridgingEnabled`: Enable edge-level bridging
  - `trailBridgingToleranceMeters`: Tolerance for trail bridging
  - `edgeBridgingToleranceMeters`: Tolerance for edge bridging
  - `edgeSnapToleranceMeters`: Tolerance for snapping edges to vertices
  - `shortConnectorMaxLengthMeters`: Max length for short connectors

- **`geometry`**: Geometry processing
  - `simplification.enabled`: Enable geometry simplification
  - `simplification.toleranceDegrees`: Simplification tolerance
  - `simplification.minPointsForSimplification`: Min points for simplification
  - `force3D`: Ensure all geometries are 3D
  - `validateGeometries`: Validate edge geometries

### Layer 3: Routing (`layer3_routing`)
**Purpose**: Generate routes from the network

**Configuration Sections**:
- **`routeGeneration`**: Route recommendation generation
  - `enabled`: Enable/disable route generation
  - `maxRoutesPerPattern`: Maximum routes per pattern
  - `preferLongerRoutes`: Prefer longer routes when duplicates exist
  - `includeRouteAnalysis`: Include route analysis in output

- **`pgrouting`**: pgRouting-specific configuration
  - `edgeToVertexTolerance`: Tolerance for connecting edges to vertices
  - `graphAnalysisTolerance`: Tolerance for graph analysis
  - `minTrailLengthMeters`: Minimum trail length for inclusion
  - `maxTrailLengthMeters`: Maximum trail length for processing

- **`validation`**: Network validation
  - `validateConnectivity`: Validate network connectivity
  - `validateTopology`: Validate network topology
  - `requireFullyConnected`: Require fully connected network
  - `connectivityThreshold`: Connectivity threshold for warnings

## Configuration Inheritance

Some configurations are shared across layers or can be overridden:

### Global Settings
- `defaultNetworkStrategy`: Overall network creation strategy
- `supportedRegions`: Supported geographic regions
- `supportedEnvironments`: Supported processing environments

### Environment Variables
Many settings can be overridden with environment variables:
```bash
# Layer 1: Overpass backfill
export OVERPASS_BACKFILL_ENABLED=false
export OVERPASS_TIMEOUT_SECONDS=60

# Layer 2: Edge processing
export SPATIAL_TOLERANCE=5.0
export DEGREE2_MERGE_TOLERANCE=3.0

# Layer 3: Route generation
export MAX_ROUTES_PER_PATTERN=20
```

## Usage Examples

### Disable Layer 1 Overpass Backfill
```yaml
constants:
  layer1_trails:
    overpassBackfill:
      enabled: false
```

### Adjust Layer 2 Edge Merging
```yaml
constants:
  layer2_edges:
    merging:
      enableDegree2Merging: true
      degree2MergeTolerance: 5.0
```

### Configure Layer 3 Route Generation
```yaml
constants:
  layer3_routing:
    routeGeneration:
      maxRoutesPerPattern: 5
      preferLongerRoutes: false
```

## Benefits of Layer-Based Configuration

1. **Clarity**: Easy to understand which settings affect which processing stage
2. **Maintainability**: Related configurations are grouped together
3. **Flexibility**: Can enable/disable entire layers or specific features
4. **Debugging**: Easier to isolate issues to specific layers
5. **Documentation**: Self-documenting structure

## Migration from Old Configuration

The old flat configuration structure has been reorganized into layers:

| Old Path | New Path |
|----------|----------|
| `constants.gapFixing` | `constants.layer1_trails.gapFixing` |
| `constants.overpassBackfill` | `constants.layer1_trails.overpassBackfill` |
| `constants.bridging` | `constants.layer2_edges.bridging` |
| `constants.geometrySimplification` | `constants.layer2_edges.geometry.simplification` |
| `constants.postgis.processing` | `constants.layer3_routing.pgrouting` |

## Related Documentation

- [Overpass Backfill Configuration](./overpass-backfill-configuration.md)
- [Three-Layer Data Model](./three-layer-datamodel.md)
- [Layer 3 Routing Configuration](../configs/layer3-routing.config.yaml)
