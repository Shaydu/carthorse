#!/usr/bin/env node
/**
 * Carthorse Spatial SQL Linter
 *
 * Enforces that all spatial operations (intersection, node/edge detection, splitting, etc.)
 * are performed in SQL using PostGIS/SpatiaLite functions, not in JS/TS/Python.
 *
 * Fails if it finds forbidden patterns (coordinate loops, custom intersection logic, etc.).
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Patterns to flag (forbidden in JS/TS/Python)
const forbiddenPatterns = [
  /for\s*\(.*(coord|point|node|edge|segment|vertex)/i, // for-loops over coordinates
  /\.reduce\(.*(coord|point|node|edge|segment|vertex)/i, // reduce over coordinates
  /function\s+(detect|find|split|calculate).*intersection/i, // custom intersection functions
  /function\s+(detect|find|split|calculate).*node/i, // custom node functions
  /function\s+(detect|find|split|calculate).*edge/i, // custom edge functions
  /calculateDistance\s*\(/i, // custom distance functions
  /parseWktCoords\s*\(/i, // custom WKT coordinate parsing
  /manual intersection/i, // comments about manual intersection
  /custom intersection/i, // comments about custom intersection
  /custom node detection/i, // comments about custom node detection
  /custom edge detection/i, // comments about custom edge detection
];

// Allowed spatial SQL functions (should be present in .sql files)
const requiredSqlFunctions = [
  'ST_Intersects',
  'ST_Intersection',
  'ST_Node',
  'ST_Split',
  'ST_DWithin',
  'ST_Union',
];

function scanFile(filePath, patterns) {
  const content = fs.readFileSync(filePath, 'utf8');
  const findings = [];
  patterns.forEach((pattern) => {
    let match;
    let regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
    while ((match = regex.exec(content)) !== null) {
      const line = content.substr(0, match.index).split('\n').length;
      findings.push({
        file: filePath,
        line,
        match: match[0],
      });
      // Prevent infinite loop for zero-width matches
      if (match.index === regex.lastIndex) regex.lastIndex++;
    }
  });
  return findings;
}

function scanCodebase() {
  const forbiddenFindings = [];
  const codeFiles = glob.sync('**/*.{js,ts,tsx,jsx,py}', {
    ignore: ['node_modules/**', 'dist/**', 'build/**', 'test-output/**', 'data/**', 'logs/**'],
  });
  codeFiles.forEach((file) => {
    forbiddenFindings.push(...scanFile(file, forbiddenPatterns));
  });
  return forbiddenFindings;
}

function checkSqlFunctions() {
  const sqlFiles = glob.sync('**/*.sql', {
    ignore: ['node_modules/**', 'dist/**', 'build/**', 'test-output/**', 'data/**', 'logs/**'],
  });
  const missing = [];
  const allSql = sqlFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  requiredSqlFunctions.forEach((fn) => {
    if (!allSql.includes(fn)) {
      missing.push(fn);
    }
  });
  return missing;
}

function main() {
  let failed = false;
  console.log('🔍 Running Carthorse Spatial SQL Linter...');

  // 1. Scan for forbidden patterns in code
  const forbiddenFindings = scanCodebase();
  if (forbiddenFindings.length > 0) {
    failed = true;
    console.error('\n❌ Forbidden spatial logic found in code:');
    forbiddenFindings.forEach((f) => {
      console.error(`  ${f.file}:${f.line}  -->  ${f.match}`);
    });
  } else {
    console.log('✅ No forbidden spatial logic found in JS/TS/Python.');
  }

  // 2. Check for required SQL functions
  const missingSql = checkSqlFunctions();
  if (missingSql.length > 0) {
    failed = true;
    console.error('\n❌ Missing required spatial SQL functions in .sql files:');
    missingSql.forEach((fn) => {
      console.error(`  - ${fn}`);
    });
  } else {
    console.log('✅ All required spatial SQL functions are present.');
  }

  if (failed) {
    console.error('\n🚨 Spatial SQL linter failed. Please refactor code to comply with .cursorrules.');
    process.exit(1);
  } else {
    console.log('\n🎉 Spatial SQL linter passed! All spatial logic is compliant.');
    process.exit(0);
  }
}

if (require.main === module) {
  main();
} 