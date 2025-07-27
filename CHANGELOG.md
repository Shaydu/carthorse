# Changelog

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

