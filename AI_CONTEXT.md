# AI Context - Carthorse

## Project Overview
- **Name**: Carthorse - Trail data processing and export system
- **Architecture**: Node.js + PostgreSQL + PostGIS
- **Key Features**: Trail data processing, geometry handling, elevation data, multi-region exports
- **Deployment**: CLI tool with Docker support

## Boulder Export Orchestrator

### Standard Export Command
```bash
npx ts-node src/cli/export.ts --region boulder --out data/boulder.db
```

### Expected Results
- **Trails**: ~2,527 (all Boulder trails with valid geometry)
- **Nodes**: ~3,545 routing nodes
- **Edges**: ~2,090 routing edges  
- **Routes**: ~80 KSP route recommendations
- **File Size**: ~13MB SQLite database
- **Schema**: v14 with enhanced route recommendations

### Configuration
- **Minimum Trail Length**: Set to 0 (no filtering by length)
- **Validation**: Automatic by default (use `--skip-validation` to disable)
- **Trail Validation**: Ensures trails have at least 2 distinct points
- **Node Classification**: Based on edge connectivity, not trail names

## Routing Network Architecture

### ✅ **Source of Truth for Routing**
- **Edges**: `ways_noded` table (pgRouting format)
- **Nodes**: `ways_noded_vertices_pgr` table (pgRouting format)
- **Route Generation**: Uses pgRouting functions with these tables

### ❌ **Removed Tables (No Longer Used)**
- ~~`routing_nodes`~~ - Removed (was empty, not used for routing)
- ~~`routing_edges`~~ - Removed (was empty, not used for routing)

### 🎯 **Node Classification Logic**
```sql
-- Correct: Based on edge connectivity
SELECT 
  id,
  cnt as edge_count,
  CASE 
    WHEN cnt >= 3 THEN 'intersection'
    WHEN cnt = 2 THEN 'through'
    WHEN cnt = 1 THEN 'endpoint'
  END as node_type
FROM ways_noded_vertices_pgr
WHERE cnt > 0;
```

### 🚫 **Avoid Trail Name Logic**
- **Never use trail names** for routing decisions
- **Never use trail names** for node classification
- **Never use trail names** for connectivity analysis
- **Only use trail names** for display/labels

### Validation
The export includes comprehensive validation:
- ✅ Schema version v14
- ✅ All required tables present
- ✅ 100% trail completion rate
- ✅ Valid geometries for all trails
- ✅ Route recommendations with scores

### Common Issues
- ⚠️ Some isolated routing nodes (expected in large networks)
- ⚠️ Route recommendations may show warnings (non-critical)
- ✅ Export completes successfully despite warnings

## Development Guidelines

### Type System
- Use canonical types from `@/types/` (shared) or `@/frontend-types/` (UI-only)
- Never create inline types or duplicate definitions
- Import types from correct locations

### API Development
- Require region parameter for region-based endpoints
- Use camelCase in API responses, snake_case in database
- Never change API signatures without explicit approval
- Use appropriate database functions for operations

### Testing and Deployment
- Use project-specific orchestrator for testing/deployment
- Never run tests directly with package managers
- Follow project-specific deployment procedures

### Data Integrity
- Fail fast on missing or invalid data
- Never use defensive programming for data issues
- Validate data at boundaries (API, database, file imports)
- Throw descriptive errors for root cause identification

### Development Workflow
- Always get user permission before creating new files
- Search existing code before creating new functionality
- Run tests before committing
- Update documentation for architectural changes
