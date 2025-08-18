# Enhanced Preference-Based Cost Routing Test Suite

## Overview

This document describes the comprehensive test suite for the enhanced preference-based cost routing system. The tests verify that the system correctly calculates costs based on deviation from user preferences for elevation gain rate, distance, and route shape.

## Test Components

### 1. TypeScript Unit Tests (`src/__tests__/enhanced-preference-cost-routing.test.ts`)

Tests the TypeScript service logic including:
- Cost calculation functions
- Preference weight application
- Route sorting logic
- Error handling
- Edge cases

**Run with:**
```bash
npm test -- --testPathPattern=enhanced-preference-cost-routing.test.ts
```

### 2. SQL Function Tests (`scripts/test-enhanced-preference-cost.sql`)

Tests the PostgreSQL functions including:
- `calculate_elevation_gain_rate_cost()`
- `calculate_distance_cost()`
- `calculate_route_shape_cost()`
- `calculate_overall_preference_cost()`
- `get_enhanced_preference_cost_config()`

**Run with:**
```bash
psql -f scripts/test-enhanced-preference-cost.sql
```

### 3. Integration Tests (`scripts/test-enhanced-cost-integration.js`)

End-to-end tests that verify:
- Database connectivity
- Configuration loading
- Function integration
- Real-world scenarios

**Run with:**
```bash
node scripts/test-enhanced-cost-integration.js
```

### 4. Test Runner (`scripts/run-enhanced-cost-tests.sh`)

Comprehensive test runner that executes all tests in sequence.

**Run with:**
```bash
./scripts/run-enhanced-cost-tests.sh
```

## Test Scenarios

### Cost Calculation Tests

#### Elevation Gain Rate Cost
- **Perfect match**: 50 m/km target vs 50 m/km actual → very low cost
- **Moderate deviation**: 50 m/km target vs 75 m/km actual → moderate cost
- **Large deviation**: 50 m/km target vs 150 m/km actual → high cost
- **Terrain preference**: Moderate terrain (50-100 m/km) should have lowest cost

#### Distance Cost
- **Perfect match**: 10 km target vs 10 km actual → very low cost
- **Moderate deviation**: 10 km target vs 15 km actual → moderate cost
- **Large deviation**: 10 km target vs 25 km actual → high cost
- **Distance preference**: Medium routes (5-15 km) should have lowest cost

#### Route Shape Cost
- **Loop routes**: Should have lowest cost (0.0)
- **Out-and-back routes**: Should have low cost (0.1)
- **Point-to-point routes**: Should have higher cost (0.3)
- **Unknown shapes**: Should have highest cost (0.5)

### Priority Weight Tests

#### Elevation Priority
- Elevation mismatches should cost more than distance mismatches
- Tests that elevation has 60% weight vs distance's 30% weight

#### Overall Cost Calculation
- Weighted combination of all cost components
- Normalization to 0-100 range
- Proper ordering of routes by cost (ascending)

### Edge Case Tests

#### Zero Values
- Zero target distance
- Zero target elevation gain rate
- Zero actual distance

#### Large Deviations
- Very large elevation deviations (10x target)
- Very large distance deviations (10x target)
- Extreme terrain conditions

#### Error Handling
- Route not found errors
- Database connection failures
- Invalid configuration

## Expected Test Results

### Cost Ranges
- **Perfect matches**: 0-5 cost
- **Good matches**: 5-15 cost
- **Moderate matches**: 15-30 cost
- **Poor matches**: 30-60 cost
- **Very poor matches**: 60-100 cost

### Priority Verification
- Elevation mismatches should cost more than distance mismatches
- Loop routes should cost less than point-to-point routes
- Moderate terrain should cost less than extreme terrain

### Configuration Validation
- Priority weights should sum to 1.0
- All configuration parameters should be present
- Default values should be reasonable

## Running Tests

### Prerequisites
- Node.js and npm
- PostgreSQL client (psql)
- Database connection configured
- Environment variables set (optional)

### Quick Test
```bash
# Run all tests
./scripts/run-enhanced-cost-tests.sh
```

### Individual Tests
```bash
# TypeScript unit tests only
npm test -- --testPathPattern=enhanced-preference-cost-routing.test.ts

# SQL function tests only
psql -f scripts/test-enhanced-preference-cost.sql

# Integration tests only
node scripts/test-enhanced-cost-integration.js
```

### Database Setup
Before running SQL tests, ensure the enhanced preference cost functions are installed:

```sql
-- Install the functions
\i sql/organized/functions/enhanced-preference-matching.sql

-- Verify installation
SELECT get_enhanced_preference_cost_config();
```

## Test Output

### Successful Test Run
```
🧪 Enhanced Preference-Based Cost Routing Test Suite
==================================================

📋 Test 1: Running TypeScript unit tests...
✅ TypeScript unit tests passed

📋 Test 2: Running SQL function tests...
✅ Database connection successful
✅ SQL function tests passed

📋 Test 3: Running integration tests...
✅ Integration tests passed

📋 Test 4: Testing configuration loading...
✅ Configuration test passed

📋 Test 5: Testing TypeScript service compilation...
✅ TypeScript service compiles successfully

🎉 All tests completed successfully!

📊 Test Summary:
   ✅ TypeScript unit tests
   ✅ SQL function tests
   ✅ Integration tests
   ✅ Configuration tests
   ✅ TypeScript compilation

🚀 Enhanced preference-based cost routing system is ready to use!
```

### Failed Test Example
```
❌ Test failed: Elevation Weight > Distance Weight
   - Elevation mismatch cost: 15.23
   - Distance mismatch cost: 18.45
   - Expected: elevation_cost > distance_cost
   - Actual: elevation_cost < distance_cost
```

## Troubleshooting

### Common Issues

#### Database Connection Failed
```
❌ Database connection failed: connection to server at "localhost" (127.0.0.1), port 5432 failed
```
**Solution**: Check PostgreSQL is running and connection settings in `.env`

#### SQL Functions Not Found
```
❌ function "calculate_elevation_gain_rate_cost" does not exist
```
**Solution**: Install the SQL functions first:
```sql
\i sql/organized/functions/enhanced-preference-matching.sql
```

#### Configuration Not Found
```
❌ Enhanced cost routing configuration not found or disabled
```
**Solution**: Check `configs/layer3-routing.config.yaml` has the enhanced cost routing section

#### TypeScript Compilation Errors
```
❌ TypeScript service compilation failed
```
**Solution**: Check for missing dependencies or syntax errors in the service file

### Debug Mode
Run tests with verbose output:
```bash
npm test -- --testPathPattern=enhanced-preference-cost-routing.test.ts --verbose
```

### Manual Testing
Test individual functions manually:
```sql
-- Test elevation cost calculation
SELECT calculate_elevation_gain_rate_cost(75.0, 50.0) as cost;

-- Test overall cost calculation
SELECT calculate_overall_preference_cost(75.0, 50.0, 15.0, 10.0, 'loop') as cost;
```

## Continuous Integration

The test suite is designed to be run in CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run Enhanced Cost Routing Tests
  run: |
    ./scripts/run-enhanced-cost-tests.sh
```

## Performance Considerations

- SQL function tests should complete in < 30 seconds
- Integration tests should complete in < 60 seconds
- TypeScript tests should complete in < 10 seconds
- Total test suite should complete in < 2 minutes

## Future Test Enhancements

1. **Performance tests**: Test with large datasets
2. **Stress tests**: Test with extreme values
3. **Memory tests**: Test memory usage with many routes
4. **Concurrency tests**: Test concurrent cost calculations
5. **Regression tests**: Test against known good results

