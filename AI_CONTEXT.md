# AI Context - Carthorse

## Project Overview
- **Name**: Carthorse - Trail data processing and export system
- **Architecture**: Node.js + PostgreSQL + PostGIS
- **Key Features**: Trail data processing, geometry handling, elevation data, multi-region exports
- **Deployment**: CLI tool with Docker support

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
