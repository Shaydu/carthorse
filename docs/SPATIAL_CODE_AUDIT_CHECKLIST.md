# Carthorse Spatial Code & Data Pipeline Audit Checklist

This checklist is for AI/code reviewers and test writers to ensure all spatial, database, and safety best practices are followed in the Carthorse project. Use this before every major change, review, or test suite update.

---

## 1. **Spatial SQL Usage (PostGIS/SpatiaLite)**
- [ ] All intersection, node, and edge detection is performed in SQL (PostGIS/SpatiaLite), **not** JS/TS/Python.
- [ ] No custom geometry, intersection, or distance logic in JS/TS/Python (except trivial UI/test code).
- [ ] All new spatial queries use native PostGIS/SpatiaLite functions:
    - `ST_Intersects`, `ST_Intersection`, `ST_DWithin`, `ST_Distance`, `ST_Simplify`, `ST_Envelope`, `ST_UnaryUnion`, `ST_Node`, `ST_LineMerge`, etc.
- [ ] All scripts for node/edge export reference SQL, not custom code.
- [ ] All spatial logic is tested with real region data.

## 2. **Orchestrator & Pipeline**
- [ ] Orchestrator (`EnhancedPostgresOrchestrator`) uses only SQL/PostGIS for all spatial operations (splitting, intersection, simplification, validation).
- [ ] No spatial math or geometry manipulation in TypeScript except orchestration and trivial data handling.
- [ ] Staging schema/tables are created and dropped using SQL.
- [ ] PostGIS functions are loaded into the staging schema and used for all spatial processing.
- [ ] Export pipeline only uses SpatiaLite for lightweight, read-only queries.

## 3. **Spatial Index Creation**
- [ ] All geometry columns have spatial indexes (GIST for PostGIS, RTree for SpatiaLite).
- [ ] Indexes are created in both staging and production schemas.
- [ ] Index creation is documented in schema and migration files.

## 4. **Database Config & Test Safety**
- [ ] All DB config is centralized (single loader/module, e.g., `getTestDbConfig`).
- [ ] No hardcoded production credentials in code or configs.
- [ ] All tests and orchestrator runs use the test DB (`trail_master_db_test`) and test user (`tester`).
- [ ] No destructive operations are ever run on production DB.
- [ ] `.env` and `env.example` files are up to date and do not contain secrets.

## 5. **Export & Validation Pipeline**
- [ ] All export logic uses SQL to extract, transform, and load data.
- [ ] SpatiaLite export is read-only and does not perform heavy spatial processing.
- [ ] All exported data is validated for geometry validity, SRID, and spatial containment.
- [ ] Exported DBs are checked for correct schema and spatial indexes.

## 6. **Spatial Validation & Testing**
- [ ] All spatial validation uses SQL (e.g., `ST_IsValid`, `ST_Within`, `ST_DWithin`).
- [ ] Test suites cover intersection detection, node/edge export, bbox filtering, and spatial containment.
- [ ] Tests validate that all spatial indexes exist and are used in queries.
- [ ] Tests ensure no custom geometry logic is present in JS/TS/Python.
- [ ] All test DBs are cleaned up after tests (schemas dropped, files deleted).

---

**For every PR, code review, or AI session:**
- Complete this checklist.
- Flag any violations for immediate refactor.
- Add/expand tests if new spatial logic or DB operations are introduced.

**Location:** `docs/SPATIAL_CODE_AUDIT_CHECKLIST.md` 