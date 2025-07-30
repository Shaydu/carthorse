# Source Code Organization

## 📁 Directory Structure

This directory contains the main TypeScript source code for Carthorse. All new files must be placed in the appropriate subdirectory.

### **Required Organization:**

- **`src/cli/`** - Command-line interface tools
- **`src/orchestrator/`** - Main orchestration and pipeline logic
- **`src/utils/`** - Utility functions and helpers
- **`src/types/`** - TypeScript type definitions
- **`src/database/`** - Database connection and configuration
- **`src/validation/`** - Data validation services
- **`src/api/`** - API endpoints and routing
- **`src/tools/`** - Standalone tools and scripts
- **`src/inserters/`** - Data insertion utilities
- **`src/loaders/`** - Data loading utilities
- **`src/processors/`** - Data processing utilities

### **🚫 FORBIDDEN:**
- **NEVER** place files directly in `src/` root
- **NEVER** create new top-level directories without approval
- **NEVER** place test files in `src/` (use `src/__tests__/`)

### **✅ REQUIRED:**
- **ALWAYS** place new files in the appropriate subdirectory
- **ALWAYS** follow existing naming conventions
- **ALWAYS** add proper TypeScript types
- **ALWAYS** include JSDoc comments for public functions

### **📋 File Naming Conventions:**
- Use kebab-case for file names: `my-utility.ts`
- Use PascalCase for class names: `MyUtility`
- Use camelCase for function names: `myUtility()`
- Use UPPER_SNAKE_CASE for constants: `MY_CONSTANT`

### **🔧 Before Adding Files:**
1. Check if similar functionality already exists
2. Place in the correct subdirectory
3. Follow existing patterns and conventions
4. Add proper imports/exports
5. Update relevant index files if needed 