#!/usr/bin/env node
/**
 * Direct Boulder Export Script
 * 
 * Exports Boulder data directly using ExportService, bypassing the orchestrator
 * This uses the existing routing data in PostgreSQL instead of trying to generate new data
 */

const { Client } = require('pg');
const { ExportService } = require('../src/utils/export-service');

async function exportBoulderDirect() {
  console.log('🚀 Starting direct Boulder export...');
  
  // Database configuration
  const pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'shaydu',
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || 'trail_master_db'
  });

  try {
    // Connect to PostgreSQL
    await pgClient.connect();
    console.log('✅ Connected to PostgreSQL database');

    // Export configuration
    const exportConfig = {
      sqliteDbPath: './api-service/data/boulder-direct-export.db',
      maxDbSizeMB: 400,
      validate: true,
      region: 'boulder'
    };

    // Create export service
    const exportService = new ExportService(pgClient, exportConfig);

    // Export from public schema (where the data already exists)
    console.log('📦 Exporting Boulder data from public schema...');
    const result = await exportService.exportDatabase('public');

    // Display results
    console.log('\n📊 Export Results:');
    console.log(`✅ Trails exported: ${result.trailsExported}`);
    console.log(`✅ Nodes exported: ${result.nodesExported}`);
    console.log(`✅ Edges exported: ${result.edgesExported}`);
    console.log(`✅ Database size: ${result.dbSizeMB.toFixed(2)} MB`);
    console.log(`✅ Valid: ${result.isValid}`);
    
    if (result.errors.length > 0) {
      console.log('\n⚠️ Errors:');
      result.errors.forEach(error => console.log(`  - ${error}`));
    }

    console.log(`\n🎉 Export completed: ${exportConfig.sqliteDbPath}`);

  } catch (error) {
    console.error('❌ Export failed:', error.message);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

// Run the export
exportBoulderDirect(); 