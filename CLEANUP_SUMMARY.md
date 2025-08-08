# Carthorse Cleanup Summary

## Overview
Successfully cleaned up unused GeoJSON exports and duplicated database files from the Carthorse codebase.

## Cleanup Date
August 3, 2025

## Files Removed

### GeoJSON Export Files (~200MB+)
**Root Directory:**
- `top-route-recommendations.geojson` (4.6MB)
- `route-recommendations-test.geojson` (4.6MB)
- `test-boulder-fixed-export.geojson` (4.6MB)
- `test-boulder-fixed.geojson` (840KB)
- `test-boulder-complete.geojson` (4.6MB)
- `test-optimized-working-edges.geojson` (4.6MB)
- `boulder-working-node-edge.geojson` (2.9MB)
- `intersection-network-full-boulder.geojson` (17MB)
- `intersection-network-with-junctions.geojson` (6.8MB)
- `intersection-network-boy-scout-debug.geojson` (6.8MB)
- `intersection-network-debug-loops.geojson` (6.8MB)
- `intersection-network-refined.geojson` (6.8MB)
- `intersection-network-fixed.geojson` (22MB)

**Data Directory:**
- `boulder-complete-network-with-real-names.geojson` (15MB)
- `boulder-with-real-names.geojson` (15MB)
- `boulder-valley-ranch-4x-expanded.geojson` (2.3MB)
- `boulder-valley-ranch-working.geojson` (232KB)
- `boulder-pgrouting-final.geojson` (47MB)
- `boulder-pgrouting-exit-test.geojson` (16MB)
- `boulder-pgrouting-simple.geojson` (16MB)
- Multiple `*_clean_trails.geojson` files
- Multiple `boulder-*-test.geojson` files
- Multiple `boulder-pgrouting-*.geojson` files
- Multiple `boulder-valley-ranch-*.geojson` files

**Test Output Directory:**
- Entire `test-output/` directory (112MB) containing:
  - Multiple amphitheater test files
  - Loop detection files
  - Boulder UUID test files
  - Various debug and test exports

### Database Files
**Root Directory:**
- `test-route-recommendations.db` (820KB)
- `debug-test.db` (812KB)
- `test-chautauqua-trails-only.geojson.db` (820KB)
- `boulder-working-node-edge.geojson.db` (1.6MB)
- `boulder-valley-ranch-post-refactor.db` (556KB)
- `boulder-valley-ranch-old.db` (296KB)
- `boulder-valley-ranch-original-bbox.db` (364KB)

### Test JavaScript Files
**Root Directory:**
- `test-orchestrator-loop-integration-small.js` (8KB)
- `test-orchestrator-loop-integration-10mile.js` (4KB)
- `test-orchestrator-loop-integration.js` (4KB)
- `test-pgr-comparison.js` (12KB)
- `test-pgr-workflow-simplified.js` (12KB)
- `test-pgr-nodenetwork-fixed.js` (8KB)
- `test-pgr-workflow-simple.js` (12KB)
- `test-pgr-workflow.js` (12KB)
- `test-network-analysis-manual.js` (8KB)
- `test-pgr-nodes-edges.js` (8KB)
- `test-pgr-nodenetwork-benjamin.js` (8KB)

## Files Preserved

### Important Production Files
- `data/boulder.db` (main production database)
- `boulder.db` (root directory - kept as may be important)
- `api-service/data/boulder.db` (API service database)
- `api-service/data/boulder-v14.db` (v14 database)
- `api-service/data/boulder-orchestrator-export.db` (orchestrator export)

### Documentation and Examples
- `docs/examples/` directory with sample GeoJSON files
- `tools/test/test-splitting-visualization/` directory with test visualization files

### Source Code and Configuration
- All source code files
- Configuration files
- Documentation files
- Backup directories

## Space Saved
- **Total space freed:** ~400MB+
- **GeoJSON files:** ~200MB+
- **Database files:** ~5MB+
- **Test output:** ~112MB+
- **Test scripts:** ~100KB+

## Repository State After Cleanup
- **Total repository size:** 3.5GB (down from ~4GB)
- **Remaining GeoJSON files:** Only essential documentation examples and test visualizations
- **Remaining database files:** Only production and API service databases
- **Codebase organization:** Much cleaner and more focused

## Backup Created
- Backup directory created: `backups/cleanup-20250803_140425/`
- Important files preserved in backup before deletion

## Benefits
1. **Reduced repository size** by ~400MB+
2. **Improved codebase organization** - removed clutter
3. **Faster git operations** - fewer large files to track
4. **Clearer project structure** - easier to navigate
5. **Reduced confusion** - removed duplicate and outdated files

## Next Steps
- The codebase is now cleaner and more organized
- Future exports should be placed in appropriate directories
- Consider adding export files to `.gitignore` if they're temporary
- Regular cleanup scripts can be run periodically to maintain organization 