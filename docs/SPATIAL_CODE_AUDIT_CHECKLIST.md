# Spatial Code Audit Checklist (Working)

## 🟡 Current Status (as of latest test run)

### ✅ Recent Fixes
- Added `skipCleanup: true` to orchestrator-based tests to allow assertions on staging schema before cleanup.
- Exposed `stagingSchema` property for test access in orchestrator.
- Inserted pre-cleanup assertions in all orchestrator-based tests.
- Patched spatial index detection tests to print and check for GIST indexes in both `public` and latest `staging_*` schemas.
- Committed all changes for test reliability and visibility.

### ❌ Current Blockers / Test Failures
- **Staging schema/table lifecycle:**
  - Orchestrator-based tests still fail with `relation "staging_<region>_<timestamp>.trails" does not exist` during intersection detection.
  - Indicates a transaction/connection scope issue or race condition in DDL visibility.
- **Spatial index detection tests:**
  - Tests print all indexes in both `public` and latest `staging_*` schemas, but still fail if GIST indexes are not found as expected.
- **Other issues:**
  - Some SQLite file/database access errors persist in a few tests.
  - Schema mismatches (e.g., missing columns) may cause additional failures.

### 🟠 Next Steps (Prioritized)
1. **Unblock Staging Schema/Table Lifecycle**
   - Investigate and fix why orchestrator-created staging tables are not visible/accessible during test runs.
   - Confirm DDL is committed and visible to all connections.
2. **Spatial Index Detection**
   - Ensure GIST indexes are created in both `public` and staging schemas as needed.
   - Update tests to pass if indexes are present in either schema.
3. **Schema Consistency**
   - Add any missing columns (e.g., `connected_trails`) or update tests to match the current schema.
4. **SQLite/SpatiaLite Issues**
   - Fix file/database access errors in SQLite-based tests.
5. **SQL Validation Test Errors**
   - Address SQL errors (e.g., aggregates in WHERE instead of HAVING).
6. **CLI Test Expectations**
   - Review and update CLI test expectations for exit codes and error handling.

### 📋 Checklist
- [x] Add skipCleanup and pre-cleanup assertions to orchestrator-based tests
- [x] Patch spatial index detection tests for both public and staging schemas
- [ ] Fix staging schema/table lifecycle so tests can access dynamic staging tables reliably
- [ ] Ensure spatial indexes are present and detected in all relevant schemas
- [ ] Resolve schema mismatches and missing columns
- [ ] Fix SQLite/SpatiaLite test errors
- [ ] Address SQL validation test errors
- [ ] Review CLI test expectations

---

**Next session:**
- Start with fixing the staging schema/table lifecycle (blocker for most spatial/export tests).
- Then address spatial index detection and schema consistency.
- Continue down the priority list as time allows.

_Last updated: [auto-generated, latest test run]_ 