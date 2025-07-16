# Changelog

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