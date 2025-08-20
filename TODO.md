<div align="left">
  <img src="carthorse-logo-small.png" alt="Carthorse Logo" width="40" height="40">
</div>

# TODO

## Current Tasks

- [x] ~~Fix tolerance settings in Layer 2 processing~~
- [x] ~~Update pgr_createTopology calls to use configurable tolerance~~
- [x] ~~Test the fix to verify it creates degree-3+ vertices instead of degree-1~~
- [x] ~~Fix route classification logic to properly identify loops vs out-and-back vs point-to-point~~
- [x] ~~Add color coding to route exports based on route shape~~
- [x] ~~Fix SQLite export region column issue~~
- [x] ~~Fix Layer 1 TrailProcessingService region column error~~
- [ ] Test the complete Layer 1 fix to ensure trail processing works without region column errors
- [ ] Test SQLite export with the fixed Layer 1 processing
- [ ] Verify that route generation and classification still works correctly
- [ ] Test the increased timeout (15 minutes) for Layer 3 routing
- [ ] Test the increased hawickMaxRows (10000) for better loop discovery

## Completed Tasks

- [x] ~~Fix tolerance settings in Layer 2 processing~~
- [x] ~~Update pgr_createTopology calls to use configurable tolerance~~
- [x] ~~Test the fix to verify it creates degree-3+ vertices instead of degree-1~~
- [x] ~~Fix route classification logic to properly identify loops vs out-and-back vs point-to-point~~
- [x] ~~Add color coding to route exports based on route shape~~
- [x] ~~Fix SQLite export region column issue~~
- [x] ~~Fix Layer 1 TrailProcessingService region column error~~

## Notes

- Layer 3 routing timeout increased from 5 minutes to 15 minutes
- Hawick circuits max rows increased from 5000 to 10000 for better loop discovery
- Route classification now properly distinguishes between loops, out-and-back, and point-to-point routes
- Color coding added to exports: red for loops, teal for out-and-back, blue for point-to-point 