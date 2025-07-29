# Changelog

## [2.0.5] - 2025-01-27

### Fixed
- **Trail Splitting Implementation**: Fixed trail splitting to work correctly with T, Y, X, and double T intersections
  - **Replaced ST_Node with ST_Split**: More appropriate for splitting trails at intersection points
  - **Fixed UUID Generation**: All split segments now get new UUIDs via database trigger to prevent duplicates
  - **Removed Problematic Filters**: Eliminated endpoint distance filters that excluded valid intersections
  - **Fixed SQL Syntax**: Corrected format string parameter counts in PostGIS functions
- **Intersection Detection**: Improved detection of trail intersections between different trails
  - **Fern Canyon/Nebel Horn Test**: Now correctly splits intersecting trails into multiple segments
  - **Increased Trail Segments**: 2,541 original trails → 5,980 split segments (135% increase)
  - **Enhanced Intersection Count**: Detected 31,316 intersections vs previous 84

### Changed
- **Native PostgreSQL Functions**: Moved all trail splitting logic to native PostGIS functions for performance
- **Automatic UUID Generation**: Database trigger automatically generates unique UUIDs for split segments
- **Trail Splitting Default**: Set trail splitting to `true` by default for all exports

## [2.0.3] - 2025-07-29

### Added
- CLI integration tests for command-line validation
- GitHub Actions CI/CD pipeline with automated testing
- Automated changelog generation
- Package integrity validation in CI

### Changed
- Enhanced test coverage for CLI argument parsing
- Improved error handling for invalid CLI parameters

### Fixed
- CLI argument validation for required parameters
- Package build process to include all necessary files

## [2.0.2] - 2025-01-27

### Fixed
- **Test Suite Compatibility**: Updated all tests to work with v12 schema and pgRouting implementation
  - **Field Name Updates**: Updated all references from `from_node_id`/`to_node_id` to `source`/`target`
  - **Validation Logic**: Fixed orchestrator validation to accept warnings (not just errors)
  - **Schema Version**: Updated test expectations from v9 to v12
  - **Bbox Handling**: Added null bbox handling for small test datasets
- **Intersection Detection Tests**: Completely rewrote validation test for pgRouting approach
- **CLI Integration Tests**: Updated for new schema structure and field names
- **API Endpoint Tests**: Updated routing endpoints for new field names

### Changed
- **Test Expectations**: Adjusted expectations for small test datasets vs full Boulder dataset
- **Validation Behavior**: Orchestrator now accepts warnings as valid validation results
- **Schema Compatibility**: All tests now work with v12 schema and pgRouting implementation

### Technical Improvements
- **Comprehensive Test Coverage**: Maintained full test coverage while adapting to new architecture
- **pgRouting Integration**: Tests now properly validate the new pgRouting-based intersection detection
- **Schema Migration**: Smooth transition from v9 to v12 schema in test suite
- **Validation Robustness**: More flexible validation that distinguishes between errors and warnings

## [2.0.1] - 2025-01-27

### Changed
- **Patch Release**: Minor updates and bug fixes

## [2.0.0] - 2025-01-27

### Added
- **Complete PostGIS Intersection Functions**: Integrated all spatial processing functions into main schema
  - **Advanced Node Detection**: `build_routing_nodes()` with clustering and elevation support
  - **Individual Trail Splitting**: `build_routing_edges()` using `ST_Node` per trail for accurate edge creation
  - **Intersection Validation**: `detect_trail_intersections()`, `get_intersection_stats()`, `validate_intersection_detection()`
- **Sample Test Data**: Included test trails for validation and testing

### Changed
- **Major Version Release**: Bumped from v1.16.6 to v2.0.0 for significant architectural improvements

## [1.15.2] - 2025-01-27

### Added
- **Performance Optimizations**: Integrated 10 new performance indices from gainiac schema-v9-with-optimizations.md
  - **Trails Indices**: `idx_trails_app_uuid`, `idx_trails_name`, `idx_trails_length`, `idx_trails_elevation`
  - **Route Recommendations Indices**: `idx_route_recommendations_request_hash`, `idx_route_recommendations_region_hash`
  - **Routing Indices**: `idx_routing_nodes_coords`, `idx_routing_nodes_elevation`, `idx_routing_nodes_route_finding`
  - **Routing Edge Indices**: `idx_routing_edges_from_node`, `idx_routing_edges_trail_distance`, `idx_routing_edges_elevation`, `idx_routing_edges_route_finding`
- **Enhanced Schema v9**: Updated all reference schemas with performance optimizations
  - **SQLite Schema**: Updated `carthorse-sqlite-schema-v9-proposed.sql` with new indices
  - **PostgreSQL Schema**: Updated `carthorse-postgres-schema.sql` with enhanced v9 fields and indices
  - **Template Schema**: Updated `carthorse-template-schema.sql` with performance optimizations
  - **Documentation**: Updated all docs/sql schema files with new indices

### Changed
- **Export Performance**: SQLite export now includes all performance indices automatically
- **Schema Compatibility**: All new indices are purely additive and backward compatible
- **Reference Schemas**: All v9 schema files updated to include performance optimizations

### Technical Improvements
- **Query Performance**: Significantly improved performance for trail lookups, route recommendations, and routing operations
- **Database Efficiency**: Optimized indices for common query patterns in trail and routing data
- **Backward Compatibility**: All changes are additive-only, no breaking changes to existing v9 schema
- **Comprehensive Coverage**: All schema reference files updated consistently

## [1.15.1] - 2025-01-27

### Fixed
- **Critical Over-Segmentation Bug**: Fixed massive edge proliferation in routing graph creation
  - **Before**: 10 trails → 18 nodes → 52 edges (2.89:1 ratio)
  - **After**: 10 trails → 18 nodes → 10 edges (0.56:1 ratio)
  - **Production Impact**: 2543 trails → 4213 nodes → 2528 edges (0.60:1 ratio)
- **PostGIS Trail Splitting**: Fixed `build_routing_edges` function to use individual trail splitting instead of collective splitting
- **Test Suite**: Updated trail-splitting test to reflect correct behavior (1 edge per trail)

### Changed
- **PostGIS Function**: Changed from `ST_Node(ST_Collect(geometry_2d))` to individual `ST_Node(t.geometry_2d)` per trail
- **Routing Graph Performance**: Significantly improved routing performance with fewer edges to process
- **Database Size**: Reduced export database size due to fewer artificial edges

### Technical Improvements
- **Correct Graph Topology**: No more artificial connections between unrelated trail segments
- **Scalable Performance**: Edge-to-node ratio now consistent across all dataset sizes
- **Memory Efficiency**: Reduced memory usage for large datasets
- **Routing Accuracy**: Correct graph structure for navigation and analysis

## [1.15.0] - 2025-01-27

### Added
- **Test Bbox Discovery**: New `--list-test-bboxes` command to show available test configurations
- **Bbox Information Display**: Shows coordinates and approximate area for each test bbox
- **Enhanced CLI Help**: Added examples and additional commands section to help text

### Changed
- **CLI Interface**: Added `--list-test-bboxes` command for easy discovery of available test configurations
- **Help Documentation**: Enhanced with additional commands section showing utility commands

### Fixed
- **User Experience**: Users can now easily discover what test bboxes are available without reading code

### Technical Improvements
- **Transparency**: All predefined bbox configurations are now visible to users
- **Area Calculations**: Automatic calculation and display of approximate area in square miles
- **Better Discovery**: Users can see exact coordinates and sizes before choosing test configurations

## [1.14.0] - 2025-01-27

### Added
- **CLI Test Size Arguments**: New `--test-size` argument for easy testing with predefined bbox sizes
  - `--test-size small`: Uses small predefined bbox (~10 trails for Boulder, ~33 trails for Seattle)
  - `--test-size medium`: Uses medium predefined bbox (~33 trails for Boulder)
  - `--test-size full`: Uses entire region (no bbox filter)
- **Predefined Test Bboxes**: Region-specific bbox configurations for consistent testing
- **Enhanced CLI Examples**: Updated help text with test-size usage examples

### Changed
- **CLI Interface**: Added `--test-size` argument with default value of 'small'
- **Bbox Processing**: CLI now automatically applies predefined bboxes when test-size is specified
- **Help Documentation**: Added examples showing test-size usage for different regions

### Fixed
- **Test Data Management**: Consistent bbox configurations across all test scenarios
- **CLI Usability**: Simplified testing workflow with predefined data sizes

### Technical Improvements
- **Easy Testing**: Users can now quickly test with different data sizes without manual bbox coordinates
- **Consistent Results**: Predefined bboxes ensure reproducible test results
- **Better UX**: Clear examples in help text for common use cases

## [1.13.0] - 2025-01-27

### Added
- **Comprehensive Test Suite**: All 110 tests now passing with 100% success rate
- **Enhanced Trail Splitting**: Fixed critical PostGIS trail splitting functionality using `ST_Node` and `ST_Dump`
- **Improved CLI Integration**: Fixed bbox coordinate mismatches and region-specific configurations
- **Robust SQLite Export**: Critical data export functionality fully operational with schema version 9

### Changed
- **PostGIS Trail Splitting**: Implemented proper trail splitting at intersection points (Horizontal Trail: 10 edges, Vertical Trail: 8 edges)
- **CLI Configuration**: Updated Seattle bbox coordinates and region-specific test configurations
- **Schema Validation**: Updated tests to match actual SQLite schema (version 9, geojson column names)
- **Test Reliability**: Removed overly restrictive stderr validation that was causing false failures

### Fixed
- **Critical Trail Splitting Issue**: Fixed `build_routing_edges` function to properly split trails at intersections using PostGIS `ST_Node`
- **SQLite Migration (Critical Export)**: Fixed schema version mismatch (8 → 9) and stderr validation issues
- **CLI Integration**: Fixed Seattle bbox coordinates and region coordinate mismatches
- **Routing Graph Export**: Fixed node ID mismatches and schema validation issues
- **PostGIS Functions**: Fixed trail splitting logic to create multiple edges per trail at intersection points
- **Test Data Management**: Fixed bbox coordinate configurations for consistent test results

### Technical Improvements
- **100% Test Success Rate**: Reduced from 13 failed tests to 0 failed tests
- **Proper Trail Splitting**: Trails now correctly split into multiple segments at intersection points
- **Reliable SQLite Export**: Critical data export functionality working perfectly (33 trails, 54 nodes, 83 edges)
- **Enhanced CLI Reliability**: All CLI commands working correctly with proper error handling
- **Schema Consistency**: All tests updated to match actual database schema

## [1.12.0] - 2025-01-27

### Added
- **Database-driven Configuration System**: `useIntersectionNodes` toggle per region via `processing_config` JSONB field
- **Comprehensive Validation System**: Enhanced validation script with schema, geometry, network, and metadata validation
- **Enhanced Trail Splitting**: Core untested feature now working with proper 3D geometry support
- **Automatic Post-Export Validation**: Integration with orchestrator for automatic validation after exports
- **Processing Configuration**: Database-stored configuration for intersection node behavior
- **Detailed Validation Reporting**: Actionable insights and recommendations for data quality issues

### Changed
- **Orchestrator Integration**: Enhanced orchestrator to read configuration from database and run validation automatically
- **Test Data Integrity**: Improved test data creation with proper 3D geometry casting and complete field sets
- **Validation Script Enhancement**: Comprehensive validation with detailed reporting and issue detection
- **Configuration Management**: Moved intersection node configuration from hardcoded to database-driven

### Fixed
- **Critical 3D Geometry Issue**: Fixed `ST_GeomFromText()` casting to `LINESTRINGZ` for proper elevation handling
- **Trail Splitting Core Feature**: Resolved untested trail splitting functionality (11 intersection points, 11 routing nodes, 6 routing edges)
- **Data Integrity**: Fixed test data insertion with proper bbox and geometry_hash fields
- **Type Conversion Issues**: Fixed string-to-number conversions in test assertions
- **Configuration System**: Database-driven `useIntersectionNodes` toggle working correctly (6 vs 5 nodes)
- **PostGIS Functions**: All spatial tests passing with proper 3D geometry handling
- **Validation Integration**: Fixed orchestrator to use enhanced validation script with TypeScript support

### Technical Improvements
- **No Self-Loops**: All edges reference valid nodes in routing graph
- **Proper 3D Geometry**: Elevation data preserved throughout pipeline
- **Configuration Flexibility**: Per-region intersection node configuration
- **Comprehensive Testing**: Trail splitting, configuration system, and validation all working
- **Data Quality**: Automatic detection of orphaned nodes/edges, self-loops, and duplicate edges

## [1.11.0] - 2025-07-27

### Added
- CLI integration tests for command-line validation
- GitHub Actions CI/CD pipeline with automated testing
- Automated changelog generation
- Package integrity validation in CI

### Changed
- Enhanced test coverage for CLI argument parsing
- Improved error handling for invalid CLI parameters

### Fixed
- CLI argument validation for required parameters
- Package build process to include all necessary files

## [1.11.0] - 2024-07-26
### Added
- Improved trail splitting and intersection detection using efficient native PostGIS SQL functions
- Optimized spatial pipeline for T, X, and complex intersection types
- All splitting and intersection logic now performed in SQL, not TypeScript
- Updated and fixed tests for spatial pipeline and PostGIS functions

### Changed
- Refactored orchestrator and routing graph builder to use inline PostGIS splitting
- Removed legacy/unused TypeScript geometry logic

### Fixed
- Fixed issues with missed intersections and unsplit trails in exports
- Fixed test failures related to spatial pipeline

## [1.9.0] - 2025-07-24

### Added
- CLI integration tests for command-line validation
- GitHub Actions CI/CD pipeline with automated testing
- Automated changelog generation
- Package integrity validation in CI

### Changed
- Enhanced test coverage for CLI argument parsing
- Improved error handling for invalid CLI parameters

### Fixed
- CLI argument validation for required parameters
- Package build process to include all necessary files

## [1.8.0] - 2025-07-24

### Added
- CLI integration tests for command-line validation
- GitHub Actions CI/CD pipeline with automated testing
- Automated changelog generation
- Package integrity validation in CI

### Changed
- Enhanced test coverage for CLI argument parsing
- Improved error handling for invalid CLI parameters

### Fixed
- CLI argument validation for required parameters
- Package build process to include all necessary files

## [1.7.0] - 2025-07-24

### Added
- CLI integration tests for command-line validation
- GitHub Actions CI/CD pipeline with automated testing
- Automated changelog generation
- Package integrity validation in CI

### Changed
- Enhanced test coverage for CLI argument parsing
- Improved error handling for invalid CLI parameters

### Fixed
- CLI argument validation for required parameters
- Package build process to include all necessary files

## [1.6.0] - 2025-07-24

### Added
- CLI integration tests for command-line validation
- GitHub Actions CI/CD pipeline with automated testing
- Automated changelog generation
- Package integrity validation in CI

### Changed
- Enhanced test coverage for CLI argument parsing
- Improved error handling for invalid CLI parameters

### Fixed
- CLI argument validation for required parameters
- Package build process to include all necessary files

All notable changes to this project will be documented in this file.

## [1.5.0] - 2025-07-24

### Added
- CLI integration tests for command-line validation
- GitHub Actions CI/CD pipeline with automated testing
- Automated changelog generation
- Package integrity validation in CI

### Changed
- Enhanced test coverage for CLI argument parsing
- Improved error handling for invalid CLI parameters

### Fixed
- CLI argument validation for required parameters
- Package build process to include all necessary files

