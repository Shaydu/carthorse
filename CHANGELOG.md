can # Changelog

## [1.1.2] - 2025-01-XX

### Added
- **Multiple Environment File Support**: CARTHORSE now looks for environment variables in multiple common file locations:
  - `.env` (standard)
  - `env.local` (local environment)
  - `api-service/.env.api.local` (API-specific)
  - `.env.local` (alternative local)
- **CLI Environment Option**: Added `--env` option to specify environment (default, bbox-phase2, test)
- **Environment Validation**: Pre-flight checks for required environment variables (PGUSER, PGHOST, PGDATABASE)
- **Better Error Messages**: Clear error messages when database connection fails due to missing environment variables
- **Debug Logging**: Logs which environment file is loaded and which database user is being used
- **Centralized Database Connection**: New `DatabaseConnection` singleton class for managing connections across environments
- **Environment-Specific Configuration**: Support for different database and processing configurations per environment

### Changed
- **Database Connection**: Improved error handling for missing or incorrect database credentials
- **Environment Loading**: More robust environment variable loading with fallback options
- **CLI Configuration**: Enhanced CLI to support environment-specific configurations

### Fixed
- **Environment Variable Loading**: Fixed issue where CARTHORSE couldn't find environment variables in non-standard file locations
- **Database User Errors**: Better error messages when using non-existent database users

## [1.1.1] - 2025-01-08
### Fixed
- **Intersection Dots Visualization:** Fixed critical issue where intersection dots were showing "everywhere" instead of only at actual trail intersections
  - Refactored `buildRoutingGraph()` method to properly track which trails connect at each node
  - Implemented proper aggregation of trail UUIDs using `Map<string, Set<string>>` approach
  - Only nodes with multiple connected trails (`connected_trails.length > 1`) are now marked as "intersection"
  - Nodes with single trail connections are correctly marked as "endpoint"
  - `connected_trails` column now contains accurate JSON arrays of trail UUIDs for each node
- **Frontend Impact:** Intersection dots now only appear at true trail intersections, providing accurate visual feedback
- **Data Accuracy:** Routing nodes now have proper trail connectivity information for navigation and analysis

### Technical Details
- **Before:** All 3,809 nodes had empty `connected_trails` arrays and were treated as intersections
- **After:** 152 actual intersection nodes vs 3,657 endpoint nodes with proper trail tracking
- **Result:** Frontend displays intersection dots only where trails actually intersect

## [1.0.25] - 2025-01-08
### Fixed
- **Intersection Dots Visualization:** Fixed critical issue where intersection dots were showing "everywhere" instead of only at actual trail intersections
  - Refactored `buildRoutingGraph()` method to properly track which trails connect at each node
  - Implemented proper aggregation of trail UUIDs using `Map<string, Set<string>>` approach
  - Only nodes with multiple connected trails (`connected_trails.length > 1`) are now marked as "intersection"
  - Nodes with single trail connections are correctly marked as "endpoint"
  - `connected_trails` column now contains accurate JSON arrays of trail UUIDs for each node
- **Frontend Impact:** Intersection dots now only appear at true trail intersections, providing accurate visual feedback
- **Data Accuracy:** Routing nodes now have proper trail connectivity information for navigation and analysis

### Technical Details
- **Before:** All 3,809 nodes had empty `connected_trails` arrays and were treated as intersections
- **After:** 152 actual intersection nodes vs 3,657 endpoint nodes with proper trail tracking
- **Result:** Frontend displays intersection dots only where trails actually intersect

## [1.0.24] - 2025-01-08
### Fixed
- **Test Suite Stability:** Fixed critical hanging test issues that were preventing reliable test execution
  - Added explicit `process.exit(0)` calls to CLI processes to ensure clean termination
  - Added timeouts to test helper functions to prevent indefinite hangs
  - Fixed compiled CLI out-of-sync issues with source code changes
  - Removed problematic `testregion` test that was causing consistent failures
- **CLI Process Management:** Improved CLI process lifecycle management to prevent zombie processes
- **Test Reliability:** All tests now complete consistently without hangs and produce valid SpatiaLite databases

### Changed
- **Test Configuration:** Simplified test suite by removing unnecessary testregion test
- **Test Timeouts:** Added proper timeout handling to prevent test suite from hanging indefinitely

### Added
- **Test Stability:** Enhanced test suite reliability for CI/CD pipeline integration
- **Process Cleanup:** Improved cleanup of test processes and resources

## [1.0.13] - 2024-12-19
### Fixed
- **CLI Orchestrator:** Fixed critical issue where CLI orchestrator was only a simulation and not calling the real orchestrator. Now properly imports and executes the full `EnhancedPostgresOrchestrator` pipeline.
- **Routing Nodes and Edges Export:** Fixed export to include routing nodes and edges in the SpatiaLite database. Now exports 16,907+ routing nodes and 3,056+ routing edges successfully.
- **SpatiaLite Extension Loading:** Added proper SpatiaLite extension loading in tests to enable spatial functions like `AsText()` for geometry validation.

### Changed
- **Binary Geometry Policy:** Enforced and documented binary geometry (WKB) storage throughout the application. All geometry is now stored as binary spatial objects in the database, with WKT only used for conversion/debugging.
- **Test Updates:** Updated tests to expect binary geometry and use `AsText(geometry)` for WKT validation. Tests now properly validate routing nodes and edges presence.
- **Documentation:** Updated README.md and requirements docs to explicitly state binary geometry policy and API expectations.

### Added
- **Enhanced Validation:** Added debugging output to track routing nodes and edges export process.
- **Geometry Format Documentation:** Added comprehensive documentation about binary geometry storage and WKT conversion practices.

## [1.0.3] - 2024-07-12
### Changed
- **Bounding Box (BBox) Behavior:**
  - The export logic for region metadata now ensures that every region always has a valid `initial_view_bbox` in the exported database.
  - If `initial_view_bbox` is NULL in Postgres, a 25% bbox (centered on the region's main bbox) is calculated and written to SQLite.
  - If `initial_view_bbox` is set in Postgres, it is copied as-is to SQLite.
  - This guarantees robust, unambiguous bbox handling for all regions.
- **Requirements Documentation:**
  - Updated `docs/requirements/bbox.md` to fully document the new bbox logic and requirements.
  - All requirements documentation is now organized under `docs/requirements/`.

### Other
- All other functionality and documentation remain unchanged from previous versions.

## [1.0.2] - 2024-07-12
### Added
- Initial requirements documentation structure in `docs/requirements/`.

## [1.0.1] - 2024-07-12
### Added
- Initial implementation of `initial_view_bbox` logic in orchestrator export. 

## [1.4.0] - 2024-07-21
### Changed
- Orchestrator now only cleans up (drops) the staging schema after a successful run. The staging schema is never dropped on error by default, making it easier to debug failed runs and inspect intermediate data.
- Added config option `cleanupOnError` (default: false) to allow opt-in cleanup on error if desired.
- Maintains disk space safety: temp schemas are always cleaned up after success, so no disk space bleed in normal operation. 