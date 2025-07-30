#!/bin/bash

# Cursor AI Best Practices Setup Script
# This script sets up command approval configuration and best practices for new projects

set -e

PROJECT_NAME=${1:-"new-project"}
PROJECT_DESCRIPTION=${2:-"Project description"}
ARCHITECTURE=${3:-"Next.js frontend + Node.js API"}
KEY_FEATURES=${4:-"Key features"}
DEPLOYMENT=${5:-"Containerized with Docker"}

echo "🚀 Setting up Cursor AI best practices for: $PROJECT_NAME"

# Create .cursor directory if it doesn't exist
mkdir -p .cursor

# Copy settings template
cp .cursor/templates/command-approval-template.json .cursor/settings.json

# Create .cursorrules from template
cp .cursor/templates/cursorrules-template.md .cursorrules

# Replace placeholders in .cursorrules
sed -i.bak "s/\[PROJECT_NAME\]/$PROJECT_NAME/g" .cursorrules
sed -i.bak "s/\[PROJECT_DESCRIPTION\]/$PROJECT_DESCRIPTION/g" .cursorrules
sed -i.bak "s|\[ARCHITECTURE_DESCRIPTION\]|$ARCHITECTURE|g" .cursorrules
sed -i.bak "s/\[KEY_FEATURES\]/$KEY_FEATURES/g" .cursorrules
sed -i.bak "s/\[DEPLOYMENT_DESCRIPTION\]/$DEPLOYMENT/g" .cursorrules

# Clean up backup files
rm -f .cursorrules.bak

# Create essential documentation files
mkdir -p public/docs/developers
mkdir -p public/docs/internal

# Create AI_QUICK_REFERENCE.md
cat > AI_QUICK_REFERENCE.md << EOF
# AI Quick Reference - $PROJECT_NAME

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
\`\`\`bash
# Search existing code
codebase_search "your search query"

# Read documentation
read_file AI_CONTEXT.md

# Check project structure
list_dir src/
\`\`\`
EOF

# Create AI_CONTEXT.md
cat > AI_CONTEXT.md << EOF
# AI Context - $PROJECT_NAME

## Project Overview
- **Name**: $PROJECT_NAME - $PROJECT_DESCRIPTION
- **Architecture**: $ARCHITECTURE
- **Key Features**: $KEY_FEATURES
- **Deployment**: $DEPLOYMENT

## Development Guidelines

### Type System
- Use canonical types from \`@/types/\` (shared) or \`@/frontend-types/\` (UI-only)
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
EOF

# Create architecture.md
cat > public/docs/developers/architecture.md << EOF
# Architecture Guidelines - $PROJECT_NAME

## Type Organization
- **Shared Types**: \`@/types/\` - Used across frontend and backend
- **Frontend Types**: \`@/frontend-types/\` - UI-specific types only
- **API Types**: \`@/api-types/\` - API contract types

## API Design Rules
- Use RESTful conventions
- Include proper error handling
- Document all endpoints
- Use consistent naming conventions

## File Organization
- Group related functionality
- Use clear, descriptive names
- Maintain separation of concerns
- Follow project-specific conventions
EOF

# Create types.md
cat > public/docs/developers/types.md << EOF
# Type System Organization - $PROJECT_NAME

## Type Categories

### Canonical Types
Define these in \`@/types/\` for shared use:
- \`GeoJSONCoordinate\` - Geographic coordinates
- \`BoundingBox\` - Geographic bounds
- \`CenterCoordinate\` - Center point coordinates

### API Types
Define these in \`@/api-types/\`:
- Request/response interfaces
- API contract types
- Validation schemas

### UI Types
Define these in \`@/frontend-types/\`:
- Component props
- UI state types
- Form data types

## Type Rules
- Never use inline types
- Always import from correct location
- Use descriptive, specific names
- Document complex types
EOF

echo "✅ Cursor AI best practices setup complete!"
echo ""
echo "📁 Created files:"
echo "  - .cursor/settings.json (command approval config)"
echo "  - .cursorrules (project rules)"
echo "  - AI_QUICK_REFERENCE.md (quick reference)"
echo "  - AI_CONTEXT.md (complete guidelines)"
echo "  - public/docs/developers/architecture.md"
echo "  - public/docs/developers/types.md"
echo ""
echo "🎯 Next steps:"
echo "  1. Review and customize the generated files"
echo "  2. Update project-specific details"
echo "  3. Add any project-specific rules"
echo "  4. Commit the configuration to version control" 