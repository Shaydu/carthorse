# Contributing to CARTHORSE

Thank you for your interest in contributing to CARTHORSE! This document provides guidelines and information for contributors.

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 12+ with PostGIS 3+
- GDAL/OGR for TIFF processing
- Git

### Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/carthorse/carthorse.git
   cd carthorse
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment**
   ```bash
   cp env.example .env
   # Edit .env with your database and data source paths
   ```

4. **Build the project**
   ```bash
   npm run build
   ```

## 🧪 Testing

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm test -- --testNamePattern="boulder|seattle"

# Run with verbose output
npm test -- --verbose

# Run tests in watch mode
npm test -- --watch
```

### Test Requirements

- All tests must pass consistently
- Tests should complete without hanging
- New features should include appropriate tests
- CLI tests should validate end-to-end functionality

### Test Data

The test suite uses a dedicated test database (`trail_master_db_test`) with sample data for Boulder and Seattle regions. Test data is automatically managed and should not be modified manually.

## 📝 Code Style

### TypeScript

- Use TypeScript for all new code
- Follow strict type checking
- Use interfaces for data structures
- Prefer `const` over `let` when possible

### Code Formatting

```bash
# Format code
npm run format

# Lint code
npm run lint
```

### File Organization

- Keep related functionality together
- Use descriptive file and function names
- Add JSDoc comments for public APIs
- Group imports logically

## 🔧 Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Your Changes

- Write clear, focused commits
- Test your changes thoroughly
- Update documentation as needed

### 3. Run Tests

```bash
npm test
```

### 4. Submit a Pull Request

- Provide a clear description of changes
- Reference any related issues
- Ensure all tests pass
- Update CHANGELOG.md if needed

## 📚 Documentation

### Code Documentation

- Add JSDoc comments for public functions
- Document complex algorithms
- Include examples for CLI commands

### User Documentation

- Update README.md for user-facing changes
- Add examples for new features
- Keep ONBOARDING.md current

## 🐛 Bug Reports

When reporting bugs, please include:

1. **Environment details**: OS, Node.js version, PostgreSQL version
2. **Steps to reproduce**: Clear, step-by-step instructions
3. **Expected behavior**: What should happen
4. **Actual behavior**: What actually happens
5. **Error messages**: Full error output
6. **Sample data**: If applicable

## 💡 Feature Requests

When suggesting features:

1. **Describe the problem**: What issue does this solve?
2. **Propose a solution**: How should it work?
3. **Consider alternatives**: Are there other approaches?
4. **Impact assessment**: How does this affect existing functionality?

## 🔄 Release Process

### Version Bumping

- Use semantic versioning (MAJOR.MINOR.PATCH)
- Update `package.json` version
- Update `CHANGELOG.md` with changes
- Tag releases with version numbers

### Publishing

```bash
# Build and publish
npm run prepublishOnly
npm publish
```

## 🤝 Community Guidelines

- Be respectful and inclusive
- Help others learn and grow
- Provide constructive feedback
- Follow the project's code of conduct

## 📞 Getting Help

- **Issues**: [GitHub Issues](https://github.com/carthorse/carthorse/issues)
- **Discussions**: [GitHub Discussions](https://github.com/carthorse/carthorse/discussions)
- **Documentation**: Check README.md and docs/ directory

## 📄 License

By contributing to CARTHORSE, you agree that your contributions will be licensed under the same license as the project (GPL-3.0-or-later).

---

Thank you for contributing to CARTHORSE! 🎉 