# Carthorse Test Coverage Audit

## Current Issues Identified

### 1. TypeScript Compilation Errors (FIXED ✅)
- ✅ Fixed `environment` property error in `trail-splitting.test.ts`
- ✅ Fixed implicit `any` type errors in `orchestrator-pipeline.test.ts`

### 2. Test Data Issues (NEEDS FIXING ❌)
- **Missing required fields**: Test data missing `region`, `elevation_gain`, `max_elevation`, `min_elevation`, `avg_elevation`
- **Empty routing results**: Tests creating 0 nodes/edges due to insufficient test data
- **Database constraints**: Production database has constraints that test data violates

### 3. Business Logic Misalignment (NEEDS FIXING ❌)
- **Intersection Node Configuration**: `useIntersectionNodes` config exists but is NOT implemented in PostGIS functions
- **Default Behavior**: Currently always creates intersection nodes (should be configurable)
- **Test Coverage Gap**: No tests for both `useIntersectionNodes: true` and `useIntersectionNodes: false` scenarios

### 4. Missing Test Coverage (NEEDS ADDING ❌)
- **Intersection Node Configuration Tests**: Both enabled and disabled scenarios
- **Edge Cases**: Tests for various tolerance values and their effects
- **Error Handling**: Tests for invalid configurations and edge cases
- **Performance Tests**: Tests for large datasets and performance characteristics

## Required Fixes

### Phase 1: Fix Test Data Issues
1. **Update test data creation** to include all required fields
2. **Create proper test trails** that will generate intersection nodes
3. **Fix database constraints** in test environment

### Phase 2: Implement Intersection Node Configuration
1. **Modify PostGIS functions** to respect `useIntersectionNodes` parameter
2. **Update orchestrator** to use configurable intersection node behavior
3. **Add configuration option** to CLI and orchestrator config

### Phase 3: Add Comprehensive Test Coverage
1. **Test both intersection node modes** (enabled/disabled)
2. **Test tolerance sensitivity** across different values
3. **Test error handling** and edge cases
4. **Test performance** with realistic data sizes

## Current Test Structure Analysis

### ✅ Working Tests
- `postgis-functions.test.ts` - Tests individual PostGIS functions
- `intersection-detection-unit.test.ts` - Tests intersection detection logic
- `intersection-detection-validation.test.ts` - Tests validation functions
- `routing-graph-export.test.ts` - Tests export functionality
- `sqlite-export-helpers.test.ts` - Tests SQLite export helpers

### ❌ Problematic Tests
- `trail-splitting.test.ts` - Fixed TypeScript errors, but needs better test data
- `orchestrator-pipeline.test.ts` - Fixed TypeScript errors, but failing due to test data issues

### 🔄 Missing Tests
- **Intersection node configuration tests** (both true/false scenarios)
- **Tolerance sensitivity tests** (different tolerance values)
- **Performance tests** (large dataset handling)
- **Error handling tests** (invalid configurations)

## Business Logic Requirements

### Intersection Node Configuration
- **Default**: `useIntersectionNodes: false` (should be off by default)
- **When enabled**: Create true intersection nodes at trail crossings
- **When disabled**: Use shared endpoints only, no intersection nodes
- **Configuration**: Should be configurable via CLI and orchestrator config

### Test Data Requirements
- **Minimum viable test data**: 3-5 trails that create actual intersections
- **Required fields**: All elevation data, region, proper geometry
- **Realistic scenarios**: Both intersection and endpoint node scenarios

## Next Steps

1. **Fix test data creation** to include all required fields
2. **Implement intersection node configuration** in PostGIS functions
3. **Add comprehensive test coverage** for both configuration modes
4. **Update orchestrator** to use configurable intersection behavior
5. **Add CLI options** for intersection node configuration
6. **Performance testing** with realistic data sizes

## Files to Modify

### Core Logic Files
- `sql/carthorse-postgis-intersection-functions.sql` - Add useIntersectionNodes parameter
- `src/orchestrator/EnhancedPostgresOrchestrator.ts` - Use configurable intersection behavior
- `src/cli/export.ts` - Add CLI option for intersection nodes

### Test Files
- `src/__tests__/spatial/trail-splitting.test.ts` - Fix test data
- `src/__tests__/orchestrator-pipeline.test.ts` - Fix test data and add configuration tests
- `src/__tests__/spatial/intersection-configuration.test.ts` - NEW: Test both configuration modes

### Configuration Files
- `src/types/index.ts` - Add intersection node configuration to orchestrator config
- `src/constants.ts` - Add default intersection node configuration 