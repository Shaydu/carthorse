<div align="left">
  <img src="../carthorse-logo-small.png" alt="Carthorse Logo" width="40" height="40">
</div>

# Scripts Directory Organization

## 📁 Purpose

This directory contains utility scripts for development, testing, and maintenance. All scripts must follow the established patterns.

### **Required Organization:**

- **Development Scripts** - Build, test, and development utilities
- **Database Scripts** - Database setup, cleanup, and migration
- **Validation Scripts** - Data validation and quality checks
- **Performance Scripts** - Performance monitoring and optimization
- **Release Scripts** - Versioning and release management

### **🚫 FORBIDDEN:**
- **NEVER** create region-specific scripts (use `--region` flag instead)
- **NEVER** create temporary test files (use `tmp/` directory)
- **NEVER** create backup scripts (use version control instead)
- **NEVER** place SQL files here (use `sql/` directory)
- **NEVER** create one-off scripts without proper naming

### **✅ REQUIRED:**
- **ALWAYS** use descriptive, kebab-case names: `setup-test-database.sh`
- **ALWAYS** include proper shebang: `#!/bin/bash`
- **ALWAYS** add error handling and logging
- **ALWAYS** document script purpose and usage
- **ALWAYS** make scripts executable: `chmod +x script.sh`

### **📋 Script Categories:**

#### **Database Scripts:**
- `setup-*.sh` - Database setup and initialization
- `cleanup-*.sh` - Database cleanup and maintenance
- `optimize-*.sh` - Database optimization
- `test-*.sh` - Database testing

#### **Development Scripts:**
- `build-*.sh` - Build and compilation
- `test-*.sh` - Testing and validation
- `lint-*.sh` - Code quality checks
- `format-*.sh` - Code formatting

#### **Performance Scripts:**
- `monitor-*.sh` - Performance monitoring
- `benchmark-*.sh` - Performance benchmarking
- `profile-*.sh` - Performance profiling

### **🔧 Before Adding Scripts:**
1. Check if similar functionality already exists
2. Use appropriate naming convention
3. Add proper error handling
4. Include usage documentation
5. Make executable with proper permissions 