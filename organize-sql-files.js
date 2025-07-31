#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

async function organizeSQLFiles() {
  console.log('📁 Organizing SQL files...\n');

  // Create organized directory structure
  const organizedDir = './sql/organized';
  const dirs = [
    `${organizedDir}/production`,
    `${organizedDir}/staging`, 
    `${organizedDir}/sqlite`,
    `${organizedDir}/functions`,
    `${organizedDir}/migrations`
  ];

  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // 1. Copy and organize production schema
  if (fs.existsSync('./sql/schemas/clean/carthorse-production-schema.sql')) {
    fs.copyFileSync(
      './sql/schemas/clean/carthorse-production-schema.sql',
      `${organizedDir}/production/carthorse-production-schema.sql`
    );
    console.log('✅ Copied production schema');
  }

  // 2. Copy staging template
  if (fs.existsSync('./sql/schemas/clean/carthorse-staging-template.sql')) {
    fs.copyFileSync(
      './sql/schemas/clean/carthorse-staging-template.sql',
      `${organizedDir}/staging/carthorse-staging-template.sql`
    );
    console.log('✅ Copied staging template');
  }

  // 3. Copy existing SQLite schema
  if (fs.existsSync('./sql/schemas/carthorse-sqlite-schema-v13.sql')) {
    fs.copyFileSync(
      './sql/schemas/carthorse-sqlite-schema-v13.sql',
      `${organizedDir}/sqlite/carthorse-sqlite-schema-v13.sql`
    );
    console.log('✅ Copied SQLite schema');
  }

  // 4. Copy function files
  const functionFiles = [
    './sql/functions/carthorse-configurable-sql.sql',
    './sql/functions/recursive-route-finding-configurable.sql'
  ];

  functionFiles.forEach(file => {
    if (fs.existsSync(file)) {
      const fileName = path.basename(file);
      fs.copyFileSync(file, `${organizedDir}/functions/${fileName}`);
      console.log(`✅ Copied function file: ${fileName}`);
    }
  });

  // 5. Create README for organized structure
  const readme = `# Carthorse SQL Organization

This directory contains organized SQL files for the Carthorse project.

## Directory Structure

### /production
- **carthorse-production-schema.sql**: Complete production database schema with all functions

### /staging  
- **carthorse-staging-template.sql**: Template for staging schemas created during export

### /sqlite
- **carthorse-sqlite-schema-v13.sql**: SQLite export schema (v13)

### /functions
- **carthorse-configurable-sql.sql**: Configurable SQL functions
- **recursive-route-finding-configurable.sql**: Route finding algorithms

### /migrations
- Place database migration files here

## Usage

### Production Database Setup
\`\`\`bash
psql -d carthorse_db -f production/carthorse-production-schema.sql
\`\`\`

### SQLite Export Schema
The SQLite schema is automatically applied during export operations.

### Function Updates
To update functions, modify the files in /functions and reinstall:
\`\`\`bash
psql -d carthorse_db -f functions/carthorse-configurable-sql.sql
psql -d carthorse_db -f functions/recursive-route-finding-configurable.sql
\`\`\`

## Schema Summary

- **Production Functions**: 1,692 total (34 routing, 19 intersection, 11 utility, 2 carthorse)
- **PostGIS Functions**: 790 (spatial operations)
- **PgRouting Functions**: 344 (routing algorithms)
- **Tables**: 21 (production database)

Generated: ${new Date().toISOString()}
`;

  fs.writeFileSync(`${organizedDir}/README.md`, readme);

  // 6. Create installation script
  const installScript = `#!/bin/bash
# Carthorse Database Installation Script
# Generated: ${new Date().toISOString()}

set -e

echo "🚀 Installing Carthorse Database..."

# Check if database exists
if ! psql -lqt | cut -d \\| -f 1 | grep -qw carthorse_db; then
    echo "📦 Creating database..."
    createdb carthorse_db
fi

echo "📋 Installing production schema..."
psql -d carthorse_db -f production/carthorse-production-schema.sql

echo "🔧 Installing function files..."
psql -d carthorse_db -f functions/carthorse-configurable-sql.sql
psql -d carthorse_db -f functions/recursive-route-finding-configurable.sql

echo "✅ Installation complete!"
echo "📊 Database: carthorse_db"
echo "📊 Schema: public"
echo "📊 Functions: 1,692 total"
`;

  fs.writeFileSync(`${organizedDir}/install.sh`, installScript);
  fs.chmodSync(`${organizedDir}/install.sh`, '755');

  // 7. Create cleanup script
  const cleanupScript = `#!/bin/bash
# Carthorse Database Cleanup Script
# Generated: ${new Date().toISOString()}

set -e

echo "🧹 Cleaning up Carthorse Database..."

# Drop old staging schemas (>24h old)
echo "📋 Finding old staging schemas..."
OLD_SCHEMAS=$(psql -t -d carthorse_db -c "
  SELECT schema_name 
  FROM information_schema.schemata 
  WHERE schema_name LIKE 'staging_%'
  AND EXTRACT(EPOCH FROM (NOW() - to_timestamp(
    split_part(schema_name, '_', 3)::bigint / 1000
  ))) > 86400
")

if [ ! -z "$OLD_SCHEMAS" ]; then
    echo "🗑️  Dropping old staging schemas..."
    echo "$OLD_SCHEMAS" | while read schema; do
        if [ ! -z "$schema" ]; then
            echo "  Dropping $schema"
            psql -d carthorse_db -c "DROP SCHEMA IF EXISTS $schema CASCADE;"
        fi
    done
else
    echo "✅ No old staging schemas to clean up"
fi

echo "✅ Cleanup complete!"
`;

  fs.writeFileSync(`${organizedDir}/cleanup.sh`, cleanupScript);
  fs.chmodSync(`${organizedDir}/cleanup.sh`, '755');

  console.log('\n✅ SQL organization complete!');
  console.log(`📁 Organized files in: ${organizedDir}`);
  console.log('  - /production: Production database schema');
  console.log('  - /staging: Staging schema templates');
  console.log('  - /sqlite: SQLite export schemas');
  console.log('  - /functions: Function files');
  console.log('  - /migrations: Database migrations');
  console.log('  - install.sh: Installation script');
  console.log('  - cleanup.sh: Cleanup script');
  console.log('  - README.md: Documentation');

  // 8. Show file sizes
  console.log('\n📊 FILE SIZES:');
  const files = [
    './sql/schemas/clean/carthorse-production-schema.sql',
    './sql/schemas/clean/carthorse-staging-template.sql',
    './sql/schemas/carthorse-sqlite-schema-v13.sql'
  ];

  files.forEach(file => {
    if (fs.existsSync(file)) {
      const stats = fs.statSync(file);
      const sizeKB = (stats.size / 1024).toFixed(1);
      console.log(`  ${path.basename(file)}: ${sizeKB} KB`);
    }
  });
}

organizeSQLFiles(); 