#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get version from package.json
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = packageJson.version;

// Get current date
const date = new Date().toISOString().split('T')[0];

// Read existing changelog
const changelogPath = 'CHANGELOG.md';
let changelog = '';
if (fs.existsSync(changelogPath)) {
  changelog = fs.readFileSync(changelogPath, 'utf8');
}

// Create new changelog entry
const newEntry = `## [${version}] - ${date}

### Added
- CLI integration tests for command-line validation
- GitHub Actions CI/CD pipeline with automated testing
- Automated changelog generation
- Package integrity validation in CI

### Changed
- Enhanced test coverage for CLI argument parsing
- Improved error handling for invalid CLI parameters

### Fixed
- CLI argument validation for required parameters
- Package build process to include all necessary files

`;

// Insert new entry at the top (after the header)
const headerMatch = changelog.match(/^# Changelog\n\n/);
if (headerMatch) {
  const beforeHeader = changelog.substring(0, headerMatch[0].length);
  const afterHeader = changelog.substring(headerMatch[0].length);
  changelog = beforeHeader + newEntry + afterHeader;
} else {
  // If no existing changelog, create one
  changelog = `# Changelog

All notable changes to this project will be documented in this file.

${newEntry}`;
}

// Write updated changelog
fs.writeFileSync(changelogPath, changelog);

console.log(`✅ Updated CHANGELOG.md with version ${version}`); 