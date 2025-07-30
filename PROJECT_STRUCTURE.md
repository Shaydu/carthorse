# Carthorse Project Structure Guide

## 📁 Directory Organization

This document defines the mandatory organization for all files in the Carthorse project.

### **Root Directory Structure**

```
carthorse/
├── src/                    # TypeScript source code
│   ├── cli/               # Command-line interface
│   ├── orchestrator/      # Main orchestration logic
│   ├── utils/             # Utility functions
│   ├── types/             # TypeScript types
│   ├── database/          # Database connections
│   ├── validation/        # Data validation
│   ├── api/               # API endpoints
│   ├── tools/             # Standalone tools
│   ├── inserters/         # Data insertion
│   ├── loaders/           # Data loading
│   ├── processors/        # Data processing
│   └── __tests__/         # Test files
├── scripts/               # Utility scripts
├── sql/                   # SQL schema and functions
├── docs/                  # Documentation
├── tests/                 # Test files and data
├── tmp/                   # Temporary files (auto-cleanup)
├── data/                  # Data files
├── logs/                  # Log files
├── backups/               # Database backups
└── tools/                 # External tools
```

### **🚫 FORBIDDEN PATTERNS**

- **NEVER** place files in root directory without approval
- **NEVER** create region-specific files (use `--region` flag)
- **NEVER** create temporary files outside `tmp/` directory
- **NEVER** create backup files (use version control)
- **NEVER** create one-off scripts without proper naming
- **NEVER** place code files in `docs/` directory
- **NEVER** place SQL files in `scripts/` directory
- **NEVER** place test files in `src/` (use `src/__tests__/`)

### **✅ REQUIRED PATTERNS**

- **ALWAYS** use kebab-case for file names
- **ALWAYS** include proper documentation
- **ALWAYS** follow existing naming conventions
- **ALWAYS** check for existing similar functionality
- **ALWAYS** read directory README files before adding files
- **ALWAYS** place files in the appropriate subdirectory

### **📋 File Naming Conventions**

#### **TypeScript Files:**
- Use kebab-case: `my-utility.ts`
- Use PascalCase for classes: `MyUtility`
- Use camelCase for functions: `myUtility()`
- Use UPPER_SNAKE_CASE for constants: `MY_CONSTANT`

#### **Script Files:**
- Use kebab-case: `setup-test-database.sh`
- Include proper shebang: `#!/bin/bash`
- Make executable: `chmod +x script.sh`

#### **SQL Files:**
- Use descriptive names: `carthorse-postgres-schema.sql`
- Include version numbers: `carthorse-sqlite-schema-v12.sql`
- Use consistent formatting and indentation

#### **Documentation Files:**
- Use descriptive names: `README-validation.md`
- Include proper markdown formatting
- Add table of contents for long documents

### **🔧 Before Adding Files**

1. **Check existing functionality** - Don't duplicate existing code
2. **Read directory README** - Follow the organization rules
3. **Use appropriate naming** - Follow the naming conventions
4. **Place in correct directory** - Use the appropriate subdirectory
5. **Add documentation** - Include proper comments and docs
6. **Update relevant files** - Update imports, exports, and references

### **📋 Directory-Specific Rules**

Each directory has its own `README.md` file with specific rules:
- **`src/README.md`** - TypeScript source code organization
- **`scripts/README.md`** - Script organization and conventions
- **`sql/README.md`** - SQL file organization and naming
- **`docs/README.md`** - Documentation organization

### **🚨 Enforcement**

- All AI models must read this guide before adding files
- All AI models must read directory README files before placing files
- Violations will be caught during code review
- Files placed in wrong locations will be moved or deleted 