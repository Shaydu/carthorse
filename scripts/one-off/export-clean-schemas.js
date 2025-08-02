#!/usr/bin/env node

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function exportCleanSchemas() {
  const client = new Client({
    host: 'localhost',
    user: 'tester',
    password: 'testpass',
    database: 'trail_master_db',
    port: 5432
  });

  try {
    await client.connect();
    console.log('📤 Exporting clean schema files...\n');

    // Create output directory
    const outputDir = './sql/schemas/clean';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 1. Export public schema functions (main database)
    console.log('🔍 Exporting public schema functions...');
    
    const publicFunctions = await client.query(`
      SELECT 
        routine_name,
        routine_type,
        data_type,
        routine_definition,
        external_language,
        is_deterministic,
        sql_data_access,
        security_type
      FROM information_schema.routines 
      WHERE routine_schema = 'public'
      ORDER BY routine_name
    `);

    // Group functions by category
    const functionCategories = {
      routing: [],
      intersection: [],
      elevation: [],
      validation: [],
      utility: [],
      carthorse: [],
      postgis: [],
      pgrouting: [],
      other: []
    };

    publicFunctions.rows.forEach(func => {
      const name = func.routine_name;
      
      if (name.includes('routing') || name.includes('route')) {
        functionCategories.routing.push(func);
      } else if (name.includes('intersection')) {
        functionCategories.intersection.push(func);
      } else if (name.includes('elevation')) {
        functionCategories.elevation.push(func);
      } else if (name.includes('valid') || name.includes('test')) {
        functionCategories.validation.push(func);
      } else if (name.startsWith('st_')) {
        functionCategories.postgis.push(func);
      } else if (name.startsWith('pgr_') || name.startsWith('_pgr_')) {
        functionCategories.pgrouting.push(func);
      } else if (name.includes('get_') || name.includes('set_') || name.includes('update_')) {
        functionCategories.utility.push(func);
      } else if (name.includes('carthorse') || name.includes('trail')) {
        functionCategories.carthorse.push(func);
      } else {
        functionCategories.other.push(func);
      }
    });

    // 2. Generate clean schema files
    console.log('📝 Generating clean schema files...');

    // Main production schema
    let mainSchema = `-- Carthorse Production Database Schema
-- Generated: ${new Date().toISOString()}
-- Database: trail_master_db
-- Schema: public

-- ========================================
-- CARTHORSE CORE FUNCTIONS
-- ========================================

`;

    // Add routing functions
    if (functionCategories.routing.length > 0) {
      mainSchema += `-- Routing Functions\n`;
      mainSchema += `-- ========================================\n\n`;
      functionCategories.routing.forEach(func => {
        mainSchema += `-- Function: ${func.routine_name}\n`;
        mainSchema += `-- Type: ${func.routine_type}\n`;
        mainSchema += `-- Returns: ${func.data_type}\n`;
        if (func.routine_definition) {
          mainSchema += `${func.routine_definition};\n\n`;
        }
      });
    }

    // Add intersection functions
    if (functionCategories.intersection.length > 0) {
      mainSchema += `-- Intersection Functions\n`;
      mainSchema += `-- ========================================\n\n`;
      functionCategories.intersection.forEach(func => {
        mainSchema += `-- Function: ${func.routine_name}\n`;
        mainSchema += `-- Type: ${func.routine_type}\n`;
        mainSchema += `-- Returns: ${func.data_type}\n`;
        if (func.routine_definition) {
          mainSchema += `${func.routine_definition};\n\n`;
        }
      });
    }

    // Add utility functions
    if (functionCategories.utility.length > 0) {
      mainSchema += `-- Utility Functions\n`;
      mainSchema += `-- ========================================\n\n`;
      functionCategories.utility.forEach(func => {
        mainSchema += `-- Function: ${func.routine_name}\n`;
        mainSchema += `-- Type: ${func.routine_type}\n`;
        mainSchema += `-- Returns: ${func.data_type}\n`;
        if (func.routine_definition) {
          mainSchema += `${func.routine_definition};\n\n`;
        }
      });
    }

    // Add carthorse functions
    if (functionCategories.carthorse.length > 0) {
      mainSchema += `-- Carthorse Functions\n`;
      mainSchema += `-- ========================================\n\n`;
      functionCategories.carthorse.forEach(func => {
        mainSchema += `-- Function: ${func.routine_name}\n`;
        mainSchema += `-- Type: ${func.routine_type}\n`;
        mainSchema += `-- Returns: ${func.data_type}\n`;
        if (func.routine_definition) {
          mainSchema += `${func.routine_definition};\n\n`;
        }
      });
    }

    // Write main schema file
    fs.writeFileSync(`${outputDir}/carthorse-production-schema.sql`, mainSchema);

    // 3. Generate staging schema template
    const stagingSchema = `-- Carthorse Staging Schema Template
-- Generated: ${new Date().toISOString()}
-- Purpose: Template for staging schemas created during export

-- ========================================
-- STAGING SCHEMA TEMPLATE
-- ========================================

-- This schema is created dynamically during export
-- Tables: trails, routing_nodes, routing_edges, intersection_points, trail_hashes
-- Functions: None (functions are called from public schema)

-- Example staging schema creation:
-- CREATE SCHEMA IF NOT EXISTS staging_boulder_<timestamp>;
-- 
-- CREATE TABLE staging_boulder_<timestamp>.trails (
--   id SERIAL PRIMARY KEY,
--   name TEXT,
--   geojson TEXT,
--   -- ... other fields
-- );
-- 
-- CREATE TABLE staging_boulder_<timestamp>.routing_nodes (
--   id SERIAL PRIMARY KEY,
--   lat DOUBLE PRECISION,
--   lng DOUBLE PRECISION,
--   node_type TEXT,
--   connected_trails TEXT
-- );
-- 
-- CREATE TABLE staging_boulder_<timestamp>.routing_edges (
--   id SERIAL PRIMARY KEY,
--   source INTEGER,
--   target INTEGER,
--   cost DOUBLE PRECISION,
--   reverse_cost DOUBLE PRECISION
-- );

`;

    fs.writeFileSync(`${outputDir}/carthorse-staging-template.sql`, stagingSchema);

    // 4. Generate function summary
    const summary = `# Carthorse Schema Summary
Generated: ${new Date().toISOString()}

## Function Categories

### Routing Functions (${functionCategories.routing.length})
${functionCategories.routing.map(f => `- ${f.routine_name}`).join('\n')}

### Intersection Functions (${functionCategories.intersection.length})
${functionCategories.intersection.map(f => `- ${f.routine_name}`).join('\n')}

### Utility Functions (${functionCategories.utility.length})
${functionCategories.utility.map(f => `- ${f.routine_name}`).join('\n')}

### Carthorse Functions (${functionCategories.carthorse.length})
${functionCategories.carthorse.map(f => `- ${f.routine_name}`).join('\n')}

### PostGIS Functions (${functionCategories.postgis.length})
${functionCategories.postgis.map(f => `- ${f.routine_name}`).join('\n')}

### PgRouting Functions (${functionCategories.pgrouting.length})
${functionCategories.pgrouting.map(f => `- ${f.routine_name}`).join('\n')}

### Other Functions (${functionCategories.other.length})
${functionCategories.other.map(f => `- ${f.routine_name}`).join('\n')}

## Total Functions: ${publicFunctions.rows.length}
`;

    fs.writeFileSync(`${outputDir}/schema-summary.md`, summary);

    // 5. Export table schemas
    console.log('📋 Exporting table schemas...');
    
    const tables = await client.query(`
      SELECT 
        table_name,
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);

    const tableSchemas = {};
    tables.rows.forEach(row => {
      if (!tableSchemas[row.table_name]) {
        tableSchemas[row.table_name] = [];
      }
      tableSchemas[row.table_name].push(row);
    });

    let tableSchemaSQL = `-- Carthorse Table Schemas
-- Generated: ${new Date().toISOString()}

`;

    Object.entries(tableSchemas).forEach(([tableName, columns]) => {
      tableSchemaSQL += `-- Table: ${tableName}\n`;
      tableSchemaSQL += `CREATE TABLE IF NOT EXISTS ${tableName} (\n`;
      
      const columnDefs = columns.map(col => {
        let def = `  ${col.column_name} ${col.data_type}`;
        if (col.is_nullable === 'NO') def += ' NOT NULL';
        if (col.column_default) def += ` DEFAULT ${col.column_default}`;
        return def;
      });
      
      tableSchemaSQL += columnDefs.join(',\n') + '\n);\n\n';
    });

    fs.writeFileSync(`${outputDir}/carthorse-tables.sql`, tableSchemaSQL);

    console.log('✅ Schema export complete!');
    console.log(`📁 Files created in: ${outputDir}`);
    console.log(`  - carthorse-production-schema.sql (main functions)`);
    console.log(`  - carthorse-staging-template.sql (staging template)`);
    console.log(`  - carthorse-tables.sql (table schemas)`);
    console.log(`  - schema-summary.md (function summary)`);

    // 6. Show statistics
    console.log('\n📊 EXPORT STATISTICS:');
    console.log(`  Total functions: ${publicFunctions.rows.length}`);
    console.log(`  Routing functions: ${functionCategories.routing.length}`);
    console.log(`  Intersection functions: ${functionCategories.intersection.length}`);
    console.log(`  Utility functions: ${functionCategories.utility.length}`);
    console.log(`  Carthorse functions: ${functionCategories.carthorse.length}`);
    console.log(`  PostGIS functions: ${functionCategories.postgis.length}`);
    console.log(`  PgRouting functions: ${functionCategories.pgrouting.length}`);
    console.log(`  Other functions: ${functionCategories.other.length}`);
    console.log(`  Tables: ${Object.keys(tableSchemas).length}`);

  } catch (error) {
    console.error('❌ Export error:', error);
  } finally {
    await client.end();
  }
}

exportCleanSchemas(); 