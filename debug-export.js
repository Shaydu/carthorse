#!/usr/bin/env node

const { Client } = require('pg');
const { ExportService } = require('./dist/src/utils/export-service');
const Database = require('better-sqlite3');

async function debugExport() {
  console.log('🔍 Debugging export process...');
  
  const pgClient = new Client({
    host: 'localhost',
    port: 5432,
    user: 'shaydu',
    database: 'trail_master_db'
  });

  try {
    await pgClient.connect();
    console.log('✅ Connected to PostgreSQL');

    const exportService = new ExportService(pgClient, {
      sqliteDbPath: '/tmp/debug-export.db',
      region: 'boulder'
    });

    console.log('📦 Starting export...');
    const result = await exportService.exportDatabase('public');
    console.log('✅ Export successful:', result);

  } catch (error) {
    console.error('❌ Export failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pgClient.end();
  }
}

debugExport(); 