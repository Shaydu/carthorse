# AI Quick Reference - Carthorse

## Essential Documentation
- [AI Context](./AI_CONTEXT.md) - Complete development guidelines
- [Architecture](./public/docs/developers/architecture.md) - Type organization and API design
- [Types](./public/docs/developers/types.md) - Type system organization

## Command Approval Configuration
- **Auto-approved**: File reading, code searches, documentation access
- **Require confirmation**: File creation/deletion, database operations, deployment
- **Always ask**: Terminal commands, destructive operations

## Critical Rules Summary
- Use canonical types, never inline types
- Require region parameter for region-based endpoints
- Use orchestrator for testing/deployment
- Fail fast on data integrity issues
- Always search existing code before creating new functionality

## Quick Commands
```bash
# Search existing code
codebase_search "your search query"

# Read documentation
read_file AI_CONTEXT.md

# Check project structure
list_dir src/
```
