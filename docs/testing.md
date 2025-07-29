<div align="left">
  <img src="../carthorse-logo-small.png" alt="Carthorse Logo" width="40" height="40">
</div>

# Testing Documentation

This document provides a comprehensive guide to the Carthorse test suite, including setup, execution, and troubleshooting.

## Table of Contents

- [Test Suite Overview](#test-suite-overview)
- [Test Types and Categories](#test-types-and-categories)
- [Database Requirements](#database-requirements)
- [Running Tests](#running-tests)
- [Test Data Sources](#test-data-sources)
- [Performance Expectations](#performance-expectations)
- [Troubleshooting](#troubleshooting)
- [Adding New Tests](#adding-new-tests)
- [Cross-References](#cross-references)

## Test Suite Overview

The Carthorse project includes **9 test files** with a comprehensive testing strategy:

| Test File | Type | Database Required | Description |
|-----------|------|------------------|-------------|
| `basic.test.ts` | Unit | ❌ | Basic class instantiation tests |
| `bbox.test.ts` | Unit | ❌ | Bounding box utility function tests |
| `intersection-detection-validation.test.ts` | Integration | ✅ | Comprehensive intersection detection (Boulder: 2,541 trails) |
| `intersection-detection-simple.test.ts` | Integration | ✅ | Simple intersection detection (Seattle: 629 trails) |
| `intersection-accuracy.test.ts` | Integration | ✅ | Intersection detection accuracy validation |
| `intersection-detection-unit.test.ts` | Hybrid | ✅ | Algorithm analysis and tolerance testing |
| `routing-graph-export.test.ts` | Integration | ✅ | SpatiaLite export pipeline validation |
| `cli-integration.test.ts` | CLI Integration | ✅ | Command-line interface testing |
| `intersection-detection.test.ts` | Integration | ✅ | Focused intersection detection scenarios |

**Total Tests:** 37 tests across 9 test suites

## Test Types and Categories

### 🧪 **Unit Tests (Pure Logic)**
- **Purpose:** Test individual functions and classes without external dependencies
- **Database:** Not required
- **Examples:** `bbox.test.ts`, `basic.test.ts`
- **Characteristics:** Fast, reliable, no external dependencies

### 🗄️ **Integration Tests (PostgreSQL Database)**
- **Purpose:** Test full pipeline with real database connections
- **Database:** PostgreSQL with PostGIS extension required
- **Examples:** All intersection detection tests, routing tests
- **Characteristics:** Slower, tests real system behavior, requires database setup

### 🖥️ **CLI Integration Tests**
- **Purpose:** Test command-line interface functionality
- **Database:** PostgreSQL required for end-to-end tests
- **Examples:** `cli-integration.test.ts`
- **Characteristics:** Tests CLI argument parsing and full export pipeline

## Database Requirements

### Test Database Setup

Most tests require a PostgreSQL test database. See [README.md#test-database-setup](../README.md#test-database-setup) for detailed instructions.

**Quick Setup:**
```bash
# Create test user
createuser $USER --createdb --login
psql -c "ALTER USER $USER WITH PASSWORD 'yourpassword';"

# Create test database
createdb -O $USER trail_master_db_test
psql -c "GRANT ALL PRIVILEGES ON DATABASE trail_master_db_test TO $USER;"
```

### Environment Variables

Set these environment variables for database-dependent tests:

```bash
export PGHOST=localhost
export PGUSER=$USER
export PGDATABASE=trail_master_db_test
export PGPASSWORD=yourpassword
```

**⚠️ Safety Note:** The test suite includes automatic validation to prevent accidental connection to production databases. If you attempt to run tests against `trail_master_db` or `postgres`, the tests will fail with a safety violation error.

### Database Dependencies

| Test Category | Database Required | Reason |
|---------------|------------------|---------|
| Unit Tests | ❌ | Pure function testing |
| Integration Tests | ✅ | Real PostgreSQL/PostGIS testing |
| CLI Tests | ✅ | End-to-end pipeline testing |
| Performance Tests | ✅ | Large dataset processing |

## Running Tests

### Basic Commands

```bash
# Run all tests
npm test

# Run specific test suites
npm test -- --testNamePattern="boulder|seattle"

# Run with verbose output
npm test -- --verbose

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- src/__tests__/bbox.test.ts
```

### Test Patterns

```bash
# Run only unit tests (no database required)
npm test -- --testNamePattern="bbox|basic"

# Run only integration tests
npm test -- --testNamePattern="intersection|routing"

# Run CLI tests only
npm test -- --testNamePattern="CLI"
```

### Test Timeouts

- **Unit Tests:** Default timeout (5s)
- **Integration Tests:** 60-120 seconds
- **Performance Tests:** Up to 300 seconds

## Test Data Sources

### Real Data Regions

| Region | Trail Count | Use Case | Test File |
|--------|-------------|----------|-----------|
| **Boulder** | ~2,541 trails | Comprehensive testing | `intersection-detection-validation.test.ts` |
| **Seattle** | ~629 trails | Fast development testing | `intersection-detection-simple.test.ts` |

### Mock Data

- **Unit Tests:** Use mock data and expected results
- **Bounding Box Tests:** Synthetic coordinate data
- **CLI Tests:** Mock database configurations

### Test Data Management

- Test data is automatically managed
- Should not be modified manually
- Uses dedicated test database (`trail_master_db_test`)
- Includes sample data for Boulder and Seattle regions

## Performance Expectations

### Test Execution Times

| Test Type | Expected Time | Notes |
|-----------|---------------|-------|
| Unit Tests | < 5 seconds | Fast execution |
| Seattle Integration | ~15-20 seconds | Smaller dataset |
| Boulder Integration | ~60-140 seconds | Larger dataset |
| Full Test Suite | ~3-5 minutes | All tests |

### Performance Metrics

**Intersection Detection Tests:**
- **Node-to-Trail Ratio:** Should be < 50% (currently ~100-200%)
- **Processing Time:** < 2 minutes for Boulder region
- **Memory Usage:** < 1GB for large datasets

**Export Tests:**
- **Database Size:** < 100MB for test regions
- **Export Time:** < 60 seconds for small regions
- **Geometry Validation:** 100% 3D coordinate preservation

## Troubleshooting

### Common Issues

#### 1. **All Tests Skipped**
**Symptoms:** "32 skipped, 32 total"
**Cause:** Missing database configuration
**Solution:** Set up test database and environment variables

#### 2. **Database Connection Errors**
**Symptoms:** "connection refused" or "authentication failed"
**Solution:** 
- Verify PostgreSQL is running
- Check environment variables
- Ensure your user has proper permissions

#### 3. **Test Timeouts**
**Symptoms:** Tests hang or timeout
**Solution:**
- Increase timeout values for slow tests
- Check database performance
- Verify test data size

#### 4. **SpatiaLite Extension Errors**
**Symptoms:** "mod_spatialite.dylib not found"
**Solution:** Install SpatiaLite extension for your OS

#### 5. **Test Safety Violation Errors**
**Symptoms:** "TEST SAFETY VIOLATION: Attempting to connect to production database"
**Solution:** 
- Ensure `PGDATABASE=trail_master_db_test` is set
- Ensure `PGUSER=$USER` is set
- Check that you're not accidentally connecting to production

### Debug Commands

```bash
# Check environment variables
echo "PGHOST: $PGHOST, PGUSER: $PGUSER, PGDATABASE: $PGDATABASE"

# Test database connection
psql -h $PGHOST -U $PGUSER -d $PGDATABASE -c "SELECT 1;"

# List all tests
npm test -- --listTests

# Run single test with verbose output
npm test -- --verbose --testNamePattern="specific test name"
```

## Adding New Tests

### Test Guidelines

1. **Follow Naming Convention:** `*.test.ts` in `src/__tests__/`
2. **Use Descriptive Names:** Clear test purpose in description
3. **Include Appropriate Timeouts:** Based on test complexity
4. **Add Database Checks:** For integration tests
5. **Clean Up Resources:** Remove test files after tests

### Test Template

```typescript
import { EnhancedPostgresOrchestrator } from '../orchestrator/EnhancedPostgresOrchestrator';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

describe('Your Test Suite', () => {
  const TEST_OUTPUT_PATH = path.resolve(__dirname, '../../data/test-output.db');

  beforeAll(() => {
    // Setup
  });

  afterAll(() => {
    // Cleanup
    if (fs.existsSync(TEST_OUTPUT_PATH)) fs.unlinkSync(TEST_OUTPUT_PATH);
  });

  test('should do something specific', async () => {
    // Skip if no test database available
    if (!process.env.PGHOST || !process.env.PGUSER) {
      console.log('⏭️  Skipping test - no test database available');
      return;
    }

    // Test implementation
    const orchestrator = new EnhancedPostgresOrchestrator({
      region: 'boulder',
      outputPath: TEST_OUTPUT_PATH,
      // ... other options
    });

    await orchestrator.run();

    // Assertions
    const db = new Database(TEST_OUTPUT_PATH, { readonly: true });
    // ... validation logic
    db.close();
  }, 60000); // Appropriate timeout
});
```

### Test Categories

| Category | Location | Purpose |
|----------|----------|---------|
| Unit Tests | `src/__tests__/` | Pure function testing |
| Integration Tests | `src/__tests__/` | Database integration |
| CLI Tests | `src/__tests__/` | Command-line interface |
| Performance Tests | `src/__tests__/` | Large dataset processing |

## Cross-References

### Related Documentation

- **[README.md](../README.md#testing)** - Basic testing instructions and test database setup
- **[CONTRIBUTING.md](../CONTRIBUTING.md#testing)** - Testing guidelines for contributors
- **[docs/intersection-detection-analysis.md](intersection-detection-analysis.md)** - Detailed intersection detection test results
- **[docs/postgis-optimization.md](postgis-optimization.md)** - PostGIS testing strategies

### Configuration Files

- **[jest.config.js](../jest.config.js)** - Jest configuration
- **[jest.setup.js](../jest.setup.js)** - Test environment setup
- **[package.json](../package.json)** - Test scripts and dependencies

### Key Test Files

- **[src/__tests__/intersection-detection-validation.test.ts](../src/__tests__/intersection-detection-validation.test.ts)** - Comprehensive intersection testing
- **[src/__tests__/routing-graph-export.test.ts](../src/__tests__/routing-graph-export.test.ts)** - Export pipeline validation
- **[src/__tests__/cli-integration.test.ts](../src/__tests__/cli-integration.test.ts)** - CLI functionality testing

### Database Schema

- **[migrations/V1__initial_schema.sql](../migrations/V1__initial_schema.sql)** - Database schema for tests
- **[carthorse-postgres-schema.sql](../carthorse-postgres-schema.sql)** - Full PostgreSQL schema

---

## Quick Reference

### Run Tests Without Database
```bash
npm test -- --testNamePattern="bbox|basic"
```

### Run All Integration Tests
```bash
npm test -- --testNamePattern="intersection|routing|CLI"
```

### Debug Database Issues
```bash
echo "PGHOST: $PGHOST, PGUSER: $PGUSER, PGDATABASE: $PGDATABASE"
psql -h $PGHOST -U $PGUSER -d $PGDATABASE -c "SELECT 1;"
```

### Check Test Coverage
```bash
npm test -- --coverage
```

For more detailed information, see the cross-referenced documentation files above. 