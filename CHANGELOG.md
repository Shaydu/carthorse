# Changelog

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