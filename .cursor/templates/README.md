# Cursor AI Best Practices Templates

This directory contains reusable templates for setting up Cursor AI best practices across all your projects.

## Quick Setup for New Projects

### Option 1: Use the Setup Script (Recommended)
```bash
# Clone or copy the templates to your new project
cp -r .cursor/templates/ /path/to/new-project/.cursor/

# Run the setup script
cd /path/to/new-project
.cursor/templates/setup-new-project.sh "My Project" "Project description" "Next.js + Node.js" "Key features" "Docker deployment"
```

### Option 2: Manual Setup
1. Copy `command-approval-template.json` to `.cursor/settings.json`
2. Copy `cursorrules-template.md` to `.cursorrules`
3. Update the placeholders in `.cursorrules`
4. Create the essential documentation files

## Template Files

### `command-approval-template.json`
- Configures which commands are auto-approved vs require confirmation
- Includes safety settings for destructive operations
- Contains project guidelines for type system, API development, etc.

### `cursorrules-template.md`
- Template for `.cursorrules` with command approval configuration
- Includes critical rules for type system, API development, testing
- Has placeholders for project-specific details

### `setup-new-project.sh`
- Automated script to set up all templates
- Creates essential documentation files
- Replaces placeholders with project details

## Command Approval Configuration

### Auto-Approved Commands (Safe)
- `read_file` - Reading files
- `list_dir` - Listing directories
- `file_search` - File searching
- `codebase_search` - Code searching
- `grep_search` - Text searching

### Require Confirmation (Potentially Destructive)
- `edit_file` - Creating/modifying files
- `delete_file` - Deleting files
- `run_terminal_cmd` - Terminal commands
- `search_replace` - Find and replace operations

## Best Practices Included

### Type System
- Use canonical types, never inline types
- Import from correct locations (`@/types/`, `@/frontend-types/`)
- Prevent duplicate type definitions

### API Development
- Require region parameter for region-based endpoints
- Use camelCase in API responses, snake_case in database
- Never change API signatures without approval

### Testing and Deployment
- Use project-specific orchestrator
- Never run tests directly with package managers
- Follow project-specific deployment procedures

### Data Integrity
- Fail fast on missing data
- Never use defensive programming for data issues
- Validate data at boundaries
- Throw descriptive errors

### Development Workflow
- Always get user permission before creating files
- Search existing code before creating new functionality
- Run tests before committing
- Update documentation for architectural changes

## Customization

After running the setup script:

1. **Review generated files** - Check that all placeholders were replaced correctly
2. **Update project-specific details** - Modify architecture, features, deployment info
3. **Add project-specific rules** - Include any unique requirements for your project
4. **Test the configuration** - Verify that command approval works as expected

## Usage Examples

### For a React/TypeScript project:
```bash
.cursor/templates/setup-new-project.sh "MyApp" "React dashboard" "React + TypeScript + Node.js" "Dashboard, charts, API" "Vercel deployment"
```

### For a Python/Django project:
```bash
.cursor/templates/setup-new-project.sh "DjangoAPI" "REST API" "Django + PostgreSQL" "User auth, CRUD operations" "Docker + AWS"
```

### For a Node.js microservice:
```bash
.cursor/templates/setup-new-project.sh "UserService" "User management" "Node.js + Express + MongoDB" "Authentication, profiles" "Kubernetes deployment"
```

## Benefits

- **Consistency** - Same best practices across all projects
- **Safety** - Prevents accidental destructive operations
- **Efficiency** - Auto-approves safe operations
- **Documentation** - Essential docs created automatically
- **Maintainability** - Clear rules and guidelines for AI assistants 