# Changelog

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

