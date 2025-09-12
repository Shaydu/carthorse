## Carthorse Export (Boulder BBox) with Bridged Trails and Post-Noding Snap

The current default network strategy is PostGIS (ST_Node), and trail-level bridging is enabled by default with a 20m tolerance via `configs/carthorse.config.yaml`:

```yaml
constants:
  defaultNetworkStrategy: postgis-node
  bridging:
    enabled: true
    toleranceMeters: 20
```

Trail-level bridging inserts connector trails for near-miss endpoints before noding; a post-noding snap step then snaps edge endpoints to the nearest vertex within the same tolerance to guarantee traversal.

Run the export for the Boulder bbox:

```bash
npx ts-node src/cli/export.ts \
  --region boulder \
  --out /Users/shaydu/dev/carthorse/test-output/boulder-bbox.geojson \
  --format geojson \
  --bbox -105.238916605744,39.94173903877004,-105.21407230796711,39.961563470007604 \
  --disable-trailheads-only --no-trailheads --use-split-trails --skip-validation --no-cleanup
```
```bash

# short bbox, no massive loops
npx ts-node src/cli/export.ts --region boulder --out /Users/shaydu/dev/carthorse/test-output/boulder-expanded-bbox-test.geojson --format geojson --bbox -105.30123174925316,39.96928418458248,-105.26050515816028,39.993172777276015 --disable-trailheads-only --no-trailheads --skip-validation --no-cleanup --verbose --source cotrex

# short bbox, no massive loops
npx ts-node src/cli/export.ts --region boulder --out /Users/shaydu/dev/carthorse/test-output/boulder-expanded-bbox-test.geojson --format geojson --bbox -105.30958159914027,40.07269607609242,-105.26885500804738,40.09658466878596 --no-cleanup --verbose --source cotrex



DOUBLE NORTH BOUNDARY HEIGHT so that it only affectst cotrex



npx ts-node src/cli/export.ts --region boulder --out test-output/boulder-final-validation-test.geojson --format geojson --bbox -105.323322108554,39.9414084228671,-105.246109155213,40.139896554615
--disable-trailheads-only --no-trailheads --skip-validation --no-cleanup --verbose --source cotrex


4x North Boundary Height
```bash

Notes:
- No env flags are required. PostGIS noding and trail-level bridging are driven by config.
- To adjust the bridging tolerance, change `constants.bridging.toleranceMeters` and re-run.

4c0e03ce75312ecd59bc3183bfffed26839859cb is the commit where we fixed the community ditch trail merges - still issues with otehr mergees in that small bbox we are now working on at 10:20 am 8, 10



2025-09-08
npx ts-node src/cli/export.ts --region boulder --out /Users/shaydu/dev/carthorse/test-output/boulder-expanded-bbox-test-fixed.geojson --format geojson --bbox -105.30123174925316,39.96038502242032,-105.26050515816028,39.993172777276015 --no-cleanup --verbose --source cotrex

npx ts-node test-lollipop-integration-maximum.ts carthorse_1757353799429

2025-09-09
expanded N/S boundaries
npx ts-node src/cli/export.ts --region boulder --out /Users/shaydu/dev/carthorse/test-output/boulder-expanded-bbox-test-fixed.geojson --format geojson --bbox -105.30123174925316,39.91538502242032,-105.26050515816028,40.083172777276015 --no-cleanup --verbose --source cotrex


2025-09-10
npx ts-node src/cli/export.ts --region boulder --out /Users/shaydu/dev/carthorse/test-output/boulder-expanded-bbox-test-fixed.geojson --format geojson --bbox -105.30123174925316,39.96038502242032,-105.26050515816028,39.993172777276015 --no-cleanup --verbose --source cotrex

 npx ts-node src/cli/export.ts --region boulder --out /Users/shaydu/dev/carthorse/test-output/boulder-expanded-bbox-test-fixed.db --format sqlite --bbox -105.30123174925316,39.96038502242032,-105.26050515816028,39.993172777276015 --no-cleanup --verbose --source cotrex

 #this bbox has the correct output for routes
 shaydu@Stephens-MBP carthorse % npx ts-node src/cli/export.ts --region boulder --out /Users/shaydu/dev/carthorse/test-output/boulder-expanded-bbox-test-fixed.db --format sqlite --bbox -105.30123174925316,39.96038502242032,-105.26050515816028,39.993172777276015 --no-cleanup --verbose --source cotrex | cat



npx ts-node src/cli/export.ts --region boulder --out /Users/shaydu/dev/carthorse/test-output/boulder-expanded-bbox-test-fixed.db --format sqlite --bbox -105.30123174925316,39.96038502242032,-105.26050515816028,39.993172777276015 --source cotrex | cat

 