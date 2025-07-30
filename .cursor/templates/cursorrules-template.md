# Cursor AI Rules Template

## MANDATORY: Read Before Starting
**ALWAYS read these docs before any development work:**
- `AI_QUICK_REFERENCE.md` - **START HERE** - Quick reference with links to all critical docs
- `AI_CONTEXT.md` - Complete development guidelines
- `public/docs/developers/architecture.md` - Type organization and API design rules
- `public/docs/developers/types.md` - Type system organization

## COMMAND APPROVAL CONFIGURATION
### Auto-Approved Commands (Safe Operations)
- File reading operations (`read_file`, `list_dir`, `file_search`)
- Code search operations (`codebase_search`, `grep_search`)
- Documentation reading
- Test execution (when using orchestrator)
- Cache clearing operations

### Require Confirmation (Potentially Destructive)
- File creation (`edit_file`, creating new files)
- File deletion (`delete_file`)
- Database operations
- Deployment commands
- Configuration changes
- Package installation/removal
- Git operations (except safe reads)

## CRITICAL RULES

### Type System (STRICT ENFORCEMENT)
- **NEVER** use inline types: `{ lng: number; lat: number }` ❌
- **ALWAYS** use canonical types: `GeoJSONCoordinate`, `BoundingBox`, `CenterCoordinate` ✅
- **NEVER** create duplicate type definitions
- **ALWAYS** import from correct location: `@/types/` (shared) vs `@/frontend-types/` (UI-only)

### API Development
- **ALWAYS** require `region` parameter for region-based endpoints
- **ALWAYS** use camelCase in API responses, snake_case only in database
- **NEVER** change API signatures without explicit user approval
- **ALWAYS** use PostGIS native functions for spatial operations

### Testing and Deployment (STRICT ENFORCEMENT)
- **ALWAYS** use the orchestrator for any testing or deployment operations
- **NEVER** run tests directly with npm/yarn - use `./scripts/orchestrator/gainiac-orchestrator test`
- **NEVER** start services manually - use `./scripts/orchestrator/gainiac-orchestrator ui --local` and `./scripts/orchestrator/gainiac-orchestrator local --region <region> --mode docker`

### Data Integrity (FAIL-FAST ENFORCEMENT)
- **NEVER** handle missing data gracefully - **ALWAYS** fail hard and fast
- **NEVER** use defensive programming for data issues - throw errors immediately
- **ALWAYS** validate data integrity at boundaries (API, database, file imports)
- **NEVER** provide fallbacks for missing elevation, coordinates, or critical trail data
- **ALWAYS** throw descriptive errors that identify the root cause (e.g., "carthorse export missing elevation data")
- **NEVER** backfill or calculate missing data - fix the source (carthorse, database schema, etc.)
- **ALWAYS** assume data is correct and complete - if not, the system is broken

### Development Workflow
- **ALWAYS** get user permission before creating new files
- **ALWAYS** search existing code before creating new functionality
- **ALWAYS** run tests before committing
- **ALWAYS** update documentation for architectural changes

## Project Overview
- **Name**: [PROJECT_NAME] - [PROJECT_DESCRIPTION]
- **Architecture**: [ARCHITECTURE_DESCRIPTION]
- **Key Features**: [KEY_FEATURES]
- **Deployment**: [DEPLOYMENT_DESCRIPTION] 