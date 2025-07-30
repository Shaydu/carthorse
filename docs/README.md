<div align="left">
  <img src="../carthorse-logo-small.png" alt="Carthorse Logo" width="40" height="40">
</div>

# Documentation Directory Organization

## 📁 Purpose

This directory contains all project documentation, guides, and reference materials.

### **Required Organization:**

- **`docs/requirements/`** - Project requirements and specifications
- **`docs/examples/`** - Usage examples and tutorials
- **`docs/api/`** - API documentation
- **`docs/sql/`** - SQL documentation and examples

### **🚫 FORBIDDEN:**
- **NEVER** place code files here (use `src/` directory)
- **NEVER** place scripts here (use `scripts/` directory)
- **NEVER** create temporary documentation (use `tmp/` directory)
- **NEVER** create region-specific docs (use `--region` flag)

### **✅ REQUIRED:**
- **ALWAYS** use descriptive, kebab-case names
- **ALWAYS** include proper markdown formatting
- **ALWAYS** add table of contents for long documents
- **ALWAYS** keep documentation up to date
- **ALWAYS** include code examples where relevant 