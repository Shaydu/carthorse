# SQL Directory Organization

## 📁 Purpose

This directory contains all SQL schema definitions, migrations, and database-related files. All SQL files must follow the established patterns.

### **Required Organization:**

- **`sql/schemas/`** - Database schema definitions
- **`sql/migrations/`** - Database migration files
- **`sql/functions/`** - Custom SQL functions
- **`sql/constraints/`** - Database constraints and validation

### **🚫 FORBIDDEN:**
- **NEVER** place SQL files in other directories
- **NEVER** create region-specific SQL files
- **NEVER** create temporary SQL files (use `tmp/` directory)
- **NEVER** create backup SQL files (use version control)
- **NEVER** use inconsistent naming conventions

### **✅ REQUIRED:**
- **ALWAYS** use descriptive, kebab-case names: `carthorse-postgres-schema.sql`
- **ALWAYS** include proper comments and documentation
- **ALWAYS** specify schema version in filename
- **ALWAYS** use consistent formatting and indentation
- **ALWAYS** include proper error handling

### **📋 File Naming Conventions:**

#### **Schema Files:**
- `carthorse-postgres-schema.sql` - Main PostgreSQL schema
- `carthorse-sqlite-schema-v12.sql` - SQLite schema with version
- `carthorse-postgres-schema-optimized.sql` - Optimized PostgreSQL schema

#### **Migration Files:**
- `V1__initial_schema.sql` - Version 1 migration
- `V2__add_feature.sql` - Version 2 migration
- `V3__fix_issue.sql` - Version 3 migration

#### **Function Files:**
- `carthorse-postgis-functions.sql` - PostGIS functions
- `carthorse-pgrouting-functions.sql` - pgRouting functions
- `carthorse-constraints.sql` - Database constraints

### **🔧 Before Adding SQL Files:**
1. Check if similar functionality already exists
2. Use appropriate naming convention
3. Include proper documentation
4. Test the SQL syntax
5. Update relevant migration files if needed

### **📋 Schema Versioning:**
- **PostgreSQL Schema**: Use descriptive names with version suffixes
- **SQLite Schema**: Always include version number (e.g., `v12`)
- **Migration Files**: Use sequential versioning (V1, V2, V3, etc.) 

## Staging/Test Prototyping Policy

- Manual SQL is permitted strictly in `trail_master_db_test` and `staging.*` for prototyping/debugging of spatial workflows (e.g., PostGIS-based network creation without PNN)
- Prototype SQL must be formalized into organized files under `sql/organized/**` (e.g., `functions/`, `staging/`) and referenced by orchestrator-managed installation/validation flows before production use
- Never run manual SQL against production/public schemas or install functions outside the orchestrator in production
- The orchestrator is mandatory for all production operations