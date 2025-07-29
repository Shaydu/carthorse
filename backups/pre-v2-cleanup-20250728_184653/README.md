# Garbage Directory

This directory contains inactive, non-production code and scripts that are not linked to the main orchestrator.

## **What's Here:**

### **Inactive SQL Files**
- **`fix-*.sql`** - One-off database fixes (superseded by migrations)
- **`integrate-*.sql`** - Integration scripts (no longer needed)
- **`*-routing.sql`** - Experimental routing implementations
- **`pgrouting-*.sql`** - pgRouting experiments (not used)
- **`postgis-*.sql`** - PostGIS function experiments

### **Inactive Tools**
- **`carthorse-*.js/ts`** - Old development tools
- **`debug-*.js`** - Debugging utilities
- **`test-*.ts`** - Test scripts
- **`elevation-*.ts`** - Elevation processing tools
- **`generate-production-test-results.js`** - Old test result generator

### **Inactive Documentation**
- **`SCHEMA_V9_OPTIMIZATIONS_SUMMARY.md`** - Old schema documentation
- **`TEST_COVERAGE_AUDIT.md`** - Old test documentation
- **`FIXES_SUMMARY.md`** - Old fixes documentation
- **`SPATIAL_OPTIMIZATION_SUMMARY.md`** - Old optimization docs
- **`DATA_*.md`** - Old data documentation
- **`LEARNING.md`** - Old learning notes
- **`ONBOARDING.md`** - Old onboarding docs

### **Inactive Directories**
- **`examples/`** - Example files
- **`downloads/`** - Downloaded files
- **`databases/`** - Old database files
- **`trail-split-results/`** - Old trail splitting results

## **Why These Are Here:**

1. **Not Linked to Orchestrator**: These files are not used by the main application
2. **Superseded by Migrations**: SQL fixes replaced by proper migrations
3. **Experimental Code**: Routing experiments that didn't make it to production
4. **Old Documentation**: Superseded by current documentation
5. **Development Artifacts**: Temporary files from development

## **Current Active Code:**

### **Core Application**
- **`src/`** - Main application code
- **`migrations/`** - Database schema migrations
- **`sql/schemas/`** - Current database schemas

### **Active Tools**
- **`tools/generate-map-visualization.js`** - Map visualization (used)
- **`tools/split-trails-dev/`** - Trail splitting development (active)

### **Active Documentation**
- **`README.md`** - Main project documentation
- **`WORKFLOW.md`** - Development workflow
- **`PROJECT_STRUCTURE.md`** - Project organization
- **`CHANGELOG.md`** - Version history

## **Recovery:**

If you need to recover any of these files:
1. Check the file modification dates
2. Look for similar functionality in active code
3. Consider if the functionality is still needed
4. Move back to appropriate directory if needed

## **Cleanup:**

This directory can be safely deleted if you're sure you don't need any of these files. 