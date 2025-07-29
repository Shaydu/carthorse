# Carthorse Project Structure

## **Core Application Code**

### **`src/` - Main Application Code**
- **`src/cli/`** - Command-line interface
- **`src/orchestrator/`** - Database orchestration logic
- **`src/utils/`** - Utility functions and helpers
- **`src/types/`** - TypeScript type definitions

### **`migrations/` - Database Schema Migrations**
- **`V1__initial_schema.sql`** - Initial database schema
- **`V2__add_trail_splitting_support.sql`** - Trail splitting tables
- **`V3__add_postgis_functions.sql`** - PostGIS functions as schema

## **Database Schema Files**

### **`sql/schemas/` - Database Schema Definitions**
- **`carthorse-postgres-schema.sql`** - PostgreSQL/PostGIS schema
- **`carthorse-sqlite-schema-v9-proposed.sql`** - SQLite schema v9
- **`carthorse-sqlite-schema-v10-optimized.sql`** - SQLite schema v10
- **`carthorse-template-schema.sql`** - Template schema

### **`garbage/` - Inactive SQL Files**
- **`fix-*.sql`** - One-off database fixes (superseded by migrations)
- **`*-routing.sql`** - Experimental routing implementations
- **`pgrouting-*.sql`** - pgRouting experiments (not used)

## **Tools and Utilities**

### **`tools/` - Active Development Tools**
- **`tools/generate-map-visualization.js`** - Map visualization generator
- **`tools/split-trails-dev/`** - Trail splitting development tools

### **`garbage/` - Inactive/Non-Production Code**
- **`garbage/`** - All inactive scripts, experimental code, and non-production files
- See `garbage/README.md` for detailed inventory

## **Data and Output**

### **`data/` - Generated Data Files**
- **`*.db`** - SQLite export files
- **`*.geojson`** - GeoJSON exports

### **`tmp/` - Temporary Files**
- Temporary processing files

### **`logs/` - Application Logs**
- Debug and error logs

## **Documentation**

### **`docs/` - Project Documentation**
- API documentation
- Development guides

### **Root Documentation Files**
- **`README.md`** - Main project documentation
- **`WORKFLOW.md`** - Development workflow
- **`CONTRIBUTING.md`** - Contribution guidelines
- **`CHANGELOG.md`** - Version history

## **Configuration Files**

### **Root Configuration**
- **`package.json`** - Node.js dependencies
- **`tsconfig.json`** - TypeScript configuration
- **`jest.config.js`** - Testing configuration
- **`.env.example`** - Environment variables template

## **Cleanup Rules**

### **✅ What Belongs in Root**
- Configuration files (`package.json`, `tsconfig.json`, etc.)
- Documentation files (`README.md`, `CHANGELOG.md`, etc.)
- Environment files (`.env.example`)
- Git files (`.gitignore`, `.github/`)

### **❌ What Should NOT Be in Root**
- One-off scripts (move to `tools/`)
- Debug logs (move to `logs/` or delete)
- Old package files (delete)
- Temporary files (move to `tmp/`)
- Development artifacts (move to appropriate directories)

### **🗑️ What Goes in Garbage**
- Inactive SQL files (superseded by migrations)
- Experimental routing implementations
- Old development tools not linked to orchestrator
- Superseded documentation
- Non-production code and scripts

## **File Organization Principles**

1. **Core Code**: Keep `src/` clean with only application logic
2. **Database**: Organize SQL files by purpose (schemas, fixes, routing)
3. **Tools**: All one-off scripts go in `tools/`
4. **Data**: Generated files go in `data/`
5. **Documentation**: Keep root clean with only essential docs

## **Migration Checklist**

- [x] Move one-off scripts to `tools/`
- [x] Organize SQL files by purpose
- [x] Remove old package files
- [x] Clean up debug logs
- [x] Create proper directory structure
- [x] Document the new structure
- [x] Move inactive code to `garbage/`
- [x] Clean up inactive documentation
- [x] Organize active vs inactive tools 