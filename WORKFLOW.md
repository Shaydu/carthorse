# CARTHORSE Development Workflow

## 🎯 Overview

This document defines the development workflow, architecture, and basic rules for the CARTHORSE project. **All new sessions must read this document before making any changes.**

> **Note:** For every AI or code review session, you must complete the [Spatial Code Checklist and rules in .cursorrules](.cursorrules). That file is the single source of truth for spatial code requirements.

## 🏗️ Architecture Overview

### Core Components

```
CARTHORSE/
├── src/
│   ├── cli/                   # Command-line interfaces
│   │   ├── export.ts         # Main export pipeline
│   │   ├── region-readiness.ts # Region validation
│   │   └── validate.ts       # Data validation
│   ├── orchestrator/          # Main processing pipeline
│   │   └── EnhancedPostgresOrchestrator.ts # Core orchestrator
│   ├── inserters/             # Database insertion utilities
│   ├── loaders/               # Data loading utilities
│   ├── processors/            # Data processing modules
│   ├── validation/            # Data integrity validation
│   ├── types/                 # TypeScript type definitions
│   └── utils/                 # Shared utilities
├── data/                      # Exported databases and data files
├── docs/                      # Documentation
├── scripts/                   # Utility scripts
└── migrations/                # Database migrations
```

### Data Flow

1. **Input**: OSM data, GPX files, elevation TIFFs
2. **Processing**: PostgreSQL/PostGIS with staging schemas
3. **Output**: SpatiaLite databases with routing graphs
4. **Validation**: Comprehensive data integrity checks

## 🛡️ Safety Rules (CRITICAL)

### Database Safety
- **NEVER** modify `trail_master_db` (production database)
- **ALWAYS** use `trail_master_db_test` for development
- **NEVER** run destructive operations on production
- **ALWAYS** validate environment variables before database operations

### Environment Safety
- Check `PGDATABASE` environment variable before any database command
- Use `NODE_ENV=test` for development work
- Prefer test databases for all operations
- Keep production database read-only during development

### Command Safety
```bash
# ❌ DANGEROUS - Never do this
PGDATABASE=trail_master_db psql -c "DROP TABLE trails;"

# ✅ SAFE - Use test database
PGDATABASE=trail_master_db_test psql -c "SELECT COUNT(*) FROM trails;"
```

## 🔄 Development Workflow

### 1. Session Setup
- **ALWAYS** read this WORKFLOW.md first
- **ALWAYS** check current environment variables
- **ALWAYS** verify you're using test database for development
- **ALWAYS** understand the current task before making changes

### 2. Code Changes
- **Test first**: Run existing tests before making changes
- **Small increments**: Make small, focused changes
- **Validate**: Run validation after changes
- **Document**: Update documentation if needed

### 3. Database Operations
- **Use staging**: All operations go through staging schemas
- **Backup**: Always backup before major operations
- **Test environment**: Use test database for all development
- **Validate**: Check data integrity after operations

### 4. Testing
- **Run tests**: Always run tests after changes
- **Test database**: Use `trail_master_db_test` for all tests
- **Mock data**: Use mock data when possible
- **Validation**: Run validation tests

## 📊 Data Architecture

### Database Structure
- **Production**: `trail_master_db` (read-only for development)
- **Test**: `trail_master_db_test` (for all development work)
- **Staging**: Temporary schemas for processing

### Key Tables
- `trails`: Main trail data with 3D geometry
- `routing_nodes`: Intersection and endpoint nodes
- `routing_edges`: Connections between nodes
- `regions`: Geographic region definitions

### Export Process
1. **Copy to staging**: Copy region data to staging schema
2. **Detect intersections**: Find trail intersections
3. **Split trails**: Split trails at intersection points
4. **Build routing graph**: Create nodes and edges
5. **Export to SpatiaLite**: Generate final database

## 🧪 Testing Strategy

### Test Types
- **Unit tests**: Individual component testing
- **Integration tests**: Pipeline testing
- **Validation tests**: Data integrity testing
- **CLI tests**: Command-line interface testing

### Test Environment
- **Database**: `trail_master_db_test`
- **Data**: Sample data from production
- **Isolation**: Tests don't affect production
- **Safety**: Automatic validation prevents production access

### Running Tests
```bash
# Run all tests
PGDATABASE=trail_master_db_test npm test

# Run specific test suites
npm test -- --testNamePattern="boulder|seattle"

# Run with verbose output
npm test -- --verbose
```

## 🚀 Deployment Process

### Export Pipeline
1. **Region selection**: Choose region to export
2. **Data validation**: Validate region readiness
3. **Processing**: Run through orchestrator pipeline
4. **Export**: Generate SpatiaLite database
5. **Validation**: Run post-export validation

### Output Files
- **Location**: `data/` directory
- **Format**: SpatiaLite databases
- **Naming**: `{region}.db` (e.g., `boulder.db`, `seattle.db`)
- **Validation**: Always validate output files

## 📋 Validation Checklist

### Before Making Changes
- [ ] Read and understand this workflow
- [ ] Check environment variables
- [ ] Verify using test database
- [ ] Understand the current task
- [ ] Run existing tests

### After Making Changes
- [ ] Run tests to ensure nothing broke
- [ ] Validate data integrity
- [ ] Update documentation if needed
- [ ] Check for any safety violations
- [ ] Verify changes work as expected

### Before Database Operations
- [ ] Using test database (`trail_master_db_test`)
- [ ] Command is safe (no destructive operations)
- [ ] Environment variables are correct
- [ ] Backup is available if needed
- [ ] Operation has been tested in safe environment

## 🆘 Emergency Procedures

### If You Accidentally Run a Dangerous Command
1. **STOP IMMEDIATELY** - Do not run any more commands
2. **Check the command** - Verify what was actually executed
3. **Notify immediately** - Alert about the potential issue
4. **Document the incident** - Record what happened for future prevention

### If Tests Fail
1. **Check environment** - Verify using test database
2. **Check dependencies** - Ensure all requirements are met
3. **Check data** - Verify test data is available
4. **Check configuration** - Ensure proper setup

## 📚 Key Documents

### Essential Reading
- **This file**: `WORKFLOW.md` (you are here)
- **Safety rules**: `.cursorrules` (AI safety guidelines)
- **Main README**: `README.md` (project overview)
- **Contributing**: `CONTRIBUTING.md` (contribution guidelines)
- **Testing**: `docs/testing.md` (testing documentation)

### Reference Documents
- **Data integrity**: `DATA_INTEGRITY_GUARANTEES.md`
- **Data sources**: `DATA_SOURCES.md`
- **PostgreSQL constraints**: `README-postgres-constraints.md`
- **Validation**: `README-validation.md`

## 🎯 Success Indicators

### Good Development Session
- ✅ All tests pass
- ✅ No production database access
- ✅ Changes are well-documented
- ✅ Data integrity maintained
- ✅ Safety rules followed

### Red Flags
- ❌ Tests failing
- ❌ Production database modifications
- ❌ Missing documentation
- ❌ Data integrity issues
- ❌ Safety rule violations

## 🔄 Continuous Improvement

### Workflow Updates
- **Review regularly**: Update this workflow as needed
- **Learn from mistakes**: Document lessons learned
- **Improve safety**: Enhance safety measures
- **Update documentation**: Keep docs current

### Feedback Loop
- **Monitor**: Watch for workflow issues
- **Improve**: Update processes based on experience
- **Share**: Share best practices with team
- **Document**: Record improvements

## Spatial Code Safety

All spatial logic (intersection, node/edge detection, splitting, etc.) **must** be implemented in SQL using PostGIS/SpatiaLite functions.

**See the full enforceable rules and checklist in [.cursorrules](.cursorrules).**

**Remember**: This workflow is designed to keep the project safe, maintainable, and productive. Follow 
these guidelines to ensure successful development sessions! 🚀  
