# One-Off Scripts

This directory contains one-off scripts and utilities that were created for specific tasks or debugging purposes. These scripts should not be used in production workflows and are kept here for reference.

## Script Categories

### Analysis Scripts
- `analyze-*.js` - Network connectivity and export ratio analysis
- `analyze_*.js` - Route recommendation analysis

### Audit Scripts
- `audit-*.js` - Function usage and production function auditing

### Diagnostic Scripts
- `diagnose-*.js` - Edge generation and routing network diagnostics

### Export Scripts
- `export-*.js` - Various GeoJSON export utilities
- `export_*.js` - BBox visualization exports

### Test Scripts
- `test-*.js` - Various testing utilities
- `test_*.js` - Route recommendation and schema testing

### Utility Scripts
- `check-*.js` - Trail coordinate validation
- `cleanup-*.js` - Database cleanup utilities
- `create_*.js` - Intersection GeoJSON creation
- `debug-*.js` - Debugging utilities
- `extract-*.js` - Function extraction utilities
- `find_*.js` - Hike recommendation finders
- `generate_*.js` - Visualization generation
- `inspect-*.js` - Database inspection
- `organize-*.js` - SQL file organization
- `sync-*.js` - Database synchronization
- `update-*.js` - SQL query updates
- `validate-*.js` - Export validation
- `verify-*.js` - Route verification
- `visualize_*.js` - Export validation visualization

### SQL Scripts
- `add_*.sql` - Trail ID routing node additions
- `update_*.sql` - Routing node updates
- `working-*.sql` - Working function definitions
- `test_*.sql` - Schema testing

## Usage

⚠️ **Warning**: These scripts are for reference and debugging only. They should not be used in production workflows.

For production operations, always use the CarthorseOrchestrator:

```bash
# Install functions
npx ts-node src/orchestrator/CarthorseOrchestrator.ts install

# Export data
npx ts-node src/orchestrator/CarthorseOrchestrator.ts export --region <region> --out <file.db>

# Validate data
npx ts-node src/orchestrator/CarthorseOrchestrator.ts validate --region <region>

# Cleanup
npx ts-node src/orchestrator/CarthorseOrchestrator.ts cleanup
```

### Staging/Test Prototyping Policy
- You may use scripts here to prototype in `trail_master_db_test` and `staging.*` only
- Prototype work must be upstreamed into reusable SQL under `sql/organized/**` or helper libraries, and then invoked by `CarthorseOrchestrator` before any production use
- Never run manual SQL or direct installs against production/public schemas
- The orchestrator remains mandatory for all production operations

## Maintenance

- Scripts in this directory should be reviewed periodically
- Remove scripts that are no longer needed
- Update documentation when new scripts are added
- Consider integrating useful functionality into the main orchestrator 