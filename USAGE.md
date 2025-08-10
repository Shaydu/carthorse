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

Notes:
- No env flags are required. PostGIS noding and trail-level bridging are driven by config.
- To adjust the bridging tolerance, change `constants.bridging.toleranceMeters` and re-run.

