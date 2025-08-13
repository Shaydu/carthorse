# Degree-2 Edge Merge Cleanup Feature Requirements

## Overview
The degree-2 edge merge cleanup feature consolidates fragmented trail segments into continuous, routeable edges by detecting and merging chains of edges that pass through degree-2 vertices (intermediate points with exactly 2 connections).

## Layer Architecture

### Three-Layer System
Carthorse operates on three distinct layers:

1. **Trails Layer** (`trails` table)
   - **Purpose**: Raw trail data from OSM/imports
   - **Contains**: Original trail geometries, names, metadata
   - **Example**: "Chautauqua Trail", "Mesa Trail", etc.

2. **Edges Layer** (`ways_noded` table) 
   - **Purpose**: pgRouting network edges created from trails
   - **Contains**: Network edges with source/target vertices for routing
   - **Created by**: Splitting trails at intersections and creating routing topology
   - **Example**: Individual trail segments between intersection points

3. **Routes Layer** (`routes` table)
   - **Purpose**: Generated route recommendations (KSP, loops, etc.)
   - **Contains**: Complete routes composed of multiple edges
   - **Created by**: Route generation algorithms using the edges layer
   - **Example**: "5km loop route", "10km out-and-back route"

### Layer-Specific Operations

**Gap Bridging**: Operates at the **trails layer** (`trails` table)
- **Purpose**: Connect disconnected trail segments before they become edges
- **Function**: `runGapMidpointBridging` should work on trails, not edges
- **Tolerance**: Configurable (default: 50m) via `trailBridgingToleranceMeters`
- **Output**: Adds bridge trails to connect nearby trail endpoints

**Degree-2 Edge Merge**: Operates at the **edges layer** (`ways_noded` table)
- **Purpose**: Consolidate fragmented routing edges into continuous segments
- **Function**: `mergeDegree2Chains` works on edges, not trails
- **Tolerance**: Configurable (default: 5m) via `degree2MergeTolerance`
- **Output**: Merges degree-2 chains into single routing edges

**Connectivity Measurement**: Operates at the **edges layer** (`ways_noded` table)
- **Purpose**: Measure routing network connectivity using pgRouting
- **Function**: `pgr_dijkstra` on edges layer to measure node reachability
- **Metric**: Percentage of nodes reachable from starting node

## Core Problem
Trail data often contains fragmented segments where a single logical trail is split into multiple edges at intermediate vertices. These fragments create unnecessary complexity in the routing network and can lead to suboptimal route generation. The goal is to iteratively merge all possible degree-2 chains until the network consists only of edges that span between endpoints (degree-1) or intersections (degree-3+).

## Primary Goals
1. **Detect continuous chains** of edges that form logical trail segments
2. **Iteratively merge degree-2 chains** into single, continuous edges until convergence
3. **Clean up intermediate vertices** that are no longer needed
4. **Maintain network connectivity** and routing functionality
5. **Preserve trail metadata** (names, lengths, elevation data)
6. **Achieve ideal state**: All edges span between endpoints (degree-1) or intersections (degree-3+)

## Functional Requirements

### FR-1: Chain Detection
**Requirement**: Detect chains of edges that can be merged into continuous segments.

**Criteria**:
- Chains must start and end at degree-1 vertices (endpoints) or degree-3+ vertices (intersections)
- All intermediate vertices in the chain must be degree-2
- Edges in the chain must be geometrically continuous (endpoints within configurable tolerance)
- Maximum chain length: 15 edges (configurable)
- Chains must not form loops (start vertex ≠ end vertex)
- **Iterative Processing**: Continue detecting and merging chains until no more merges are possible

**Input**: `ways_noded` table with edges and `ways_noded_vertices_pgr` table with vertex degrees
**Output**: List of mergeable chains with their constituent edges

**Convergence**: Process continues until no chains can be detected that span between endpoints or intersections

### FR-2: Geometric Validation
**Requirement**: Ensure geometric continuity and validity of merged chains.

**Criteria**:
- Use PostGIS functions (`ST_DWithin`, `ST_LineMerge`, `ST_Union`) for geometric operations
- Configurable tolerance for endpoint proximity (default: 5 meters)
- Validate that merged geometry forms a single, valid LineString
- Handle cases where `ST_Union` produces MultiLineString (extract first component)

**Tolerance Configuration**: Read from `configs/route-discovery.config.yaml` under `degree2MergeTolerance`

### FR-3: Chain Merging
**Requirement**: Merge detected chains into single edges.

**Criteria**:
- Create new edge with merged geometry from `ST_LineMerge(ST_Union(...))`
- Sum lengths, elevation gains, and elevation losses from constituent edges
- Preserve trail name from first edge in chain
- Generate unique `app_uuid` with pattern: `merged-degree2-chain-{start}-{end}-edges-{edge_ids}`
- Remove original edges that were merged
- Update vertex connectivity after merge

### FR-4: Overlap Detection and Deduplication
**Requirement**: Detect and handle overlapping chains to prevent data loss.

**Criteria**:
- Use PostGIS functions (`ST_Overlaps`, `ST_Contains`, `ST_Covers`) to detect overlaps
- Remove shorter chains that significantly overlap with longer chains (>100m overlap)
- Ensure no edge appears in multiple merged chains
- Prioritize longer chains over shorter ones

### FR-5: Vertex Cleanup
**Requirement**: Clean up intermediate vertices that are no longer needed.

**Criteria**:
- Remove vertices that are no longer connected to any edges
- Recalculate vertex degrees after merging
- Update `cnt` field in `ways_noded_vertices_pgr` table

### FR-6: Bridge Edge Handling
**Requirement**: Handle bridge edges that connect degree-1 vertices to degree-2 vertices.

**Criteria**:
- Detect edges where one endpoint is degree-1 and the other is degree-2
- Merge bridge edges with adjacent edges to form longer chains
- Prevent bridge edges from being merged with each other
- Handle cases where bridge edges connect to multiple adjacent edges

## Non-Functional Requirements

### NFR-1: Performance
**Requirement**: Process large networks efficiently.

**Criteria**:
- Process networks with 10,000+ edges in reasonable time (<5 minutes)
- Use efficient SQL queries with proper indexing
- Minimize database round trips

### NFR-2: Configurability
**Requirement**: Make key parameters configurable.

**Criteria**:
- Tolerance values configurable via YAML files
- Maximum chain length configurable
- Overlap detection thresholds configurable

### NFR-3: Safety
**Requirement**: Ensure data integrity and provide rollback capability.

**Criteria**:
- Operate only on staging schema (never modify public schema)
- Use database transactions for atomicity
- Provide detailed logging of all operations
- Maintain audit trail of merged edges

### NFR-4: Integration
**Requirement**: Integrate seamlessly with existing pipeline.

**Criteria**:
- Run as part of network creation process
- Execute after bridge connector generation and gap detection
- Execute after initial edge deduplication
- Compatible with existing orchestrator workflow
- Preserve interface with routing services

**Processing Order**:
1. **Trails Layer Gap Bridging**: Connect disconnected trail segments within tolerance (50m default)
   - Operates on `trails` table
   - Adds bridge trails to connect nearby trail endpoints
   - Runs before network creation

2. **Network Creation**: Convert trails to routing edges
   - Creates `ways_noded` and `ways_noded_vertices_pgr` tables
   - Splits trails at intersections
   - Establishes routing topology

3. **Edges Layer Iterative Processing**: Repeat steps 4-6 until convergence
   4. **Edge Deduplication**: Remove duplicate edges in routing network
   5. **Degree-2 Edge Merge**: Merge contiguous edges that share degree-2 vertices
   6. **Vertex Cleanup**: Remove orphaned vertices from routing network

**Convergence Criteria**: Stop when no more edges can be merged between endpoints (degree-1) or intersections (degree-3+) in the routing network

## Technical Constraints

### TC-1: Database Schema
- Must work with existing `ways_noded` and `ways_noded_vertices_pgr` tables
- Cannot modify table structure
- Must preserve all existing columns and data types

### TC-2: PostGIS Functions
- Must use standard PostGIS functions available in PostgreSQL 12+
- Cannot rely on custom extensions beyond pgRouting
- Must handle geometry validation and error cases

### TC-3: pgRouting Compatibility
- Merged edges must be compatible with `pgr_createTopology`
- Must maintain proper source/target relationships
- Cannot break existing routing functionality

## Test Scenarios

### TS-1: Simple Chain Merge
**Scenario**: Two edges connected through a degree-2 vertex
**Input**: Edge A (vertex 1 → vertex 2), Edge B (vertex 2 → vertex 3), where vertex 2 has degree 2
**Expected**: Single merged edge (vertex 1 → vertex 3), vertex 2 removed

### TS-2: Complex Chain with Bridge
**Scenario**: Three edges forming a chain with a bridge connector
**Input**: 
- Edge 12: Marshall Mesa (vertex 6 → vertex 19)
- Edge 19: Bridge connector (vertex 19 → vertex 20) 
- Edge 13: Marshall Valley Trail (vertex 10 → vertex 20)
**Expected**: Single merged edge (vertex 6 → vertex 10), vertices 19 and 20 removed

### TS-3: Overlapping Chains
**Scenario**: Multiple chains that share edges or have geometric overlaps
**Input**: Two chains that overlap significantly
**Expected**: Longer chain preserved, shorter chain removed

### TS-4: Chain Ending at Intersection
**Scenario**: Chain that ends at a degree-3+ vertex (intersection)
**Input**: Chain ending at vertex with 3+ connections
**Expected**: Chain merged up to intersection, intersection vertex preserved

### TS-5: Invalid Geometry Handling
**Scenario**: Chain that produces invalid geometry when merged
**Input**: Edges that when merged create self-intersecting or invalid LineStrings
**Expected**: Chain rejected, original edges preserved

## Success Criteria

### SC-1: Network Simplification
- Reduce total edge count by at least 20% for typical trail networks
- Eliminate unnecessary degree-2 vertices
- Maintain network connectivity
- **Achieve ideal state**: All remaining edges span between endpoints (degree-1) or intersections (degree-3+)

### SC-2: Route Quality
- Merged edges produce identical routing results to original chains
- No degradation in route quality or performance
- Preserve all trail metadata and attributes

### SC-3: Data Integrity
- No data loss during merge process
- All merged edges are geometrically valid
- Vertex connectivity is correctly updated

### SC-4: Performance
- Process completes within acceptable time limits
- Memory usage remains reasonable
- Database performance is not degraded

## Current Implementation Status

### ✅ Completed
- Basic chain detection logic with recursive CTEs
- Geometric validation using PostGIS functions
- Configurable tolerance system
- Integration with orchestrator pipeline
- Bridge edge handling logic
- Overlap detection framework

### ❌ Issues Identified
- **Layer Architecture Mismatch**: Gap bridging currently operates on edges layer instead of trails layer
- **Degree-2 Merge Layer Mismatch**: Iterative optimization uses wrong function that operates on trails instead of edges
- **Gap Bridging Not Working**: Finding 0 bridges despite 35 degree-1 vertices in network
- **Degree-2 Merge Stuck**: Finding 10 connections in trails but not merging anything in edges
- **Low Connectivity**: Network connectivity stuck at 25.4% instead of 40%+ target
- **Missing Iterative Processing**: Current implementation doesn't continue until convergence
- **Incorrect Processing Order**: Gap bridging should run before network creation, degree-2 merge after

### 🔄 In Progress
- Debugging chain detection logic
- Fixing bridge edge merge behavior
- Improving validation criteria
- Testing with real-world data

## Dependencies

### Internal Dependencies
- `deduplicateSharedVertices` function (runs before degree2 merge)
- `fixConnectivityIssues` function (runs after degree2 merge)
- Configuration loading from YAML files
- Database connection management

### External Dependencies
- PostgreSQL 12+ with PostGIS extension
- pgRouting extension
- Node.js with pg library

## Future Enhancements

### FE-1: Adaptive Tolerance
- Dynamically adjust tolerance based on data quality
- Use different tolerances for different regions or trail types

### FE-2: Chain Quality Scoring
- Score chains based on length, straightness, and trail name consistency
- Prioritize higher-quality chains for merging

### FE-3: Batch Processing
- Process large networks in batches to improve performance
- Provide progress reporting for long-running operations

### FE-4: Visualization Support
- Generate before/after visualizations for debugging
- Export merged chains for external review
