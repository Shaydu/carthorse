#!/usr/bin/env node

const { Client } = require('pg');

async function cleanupProductionDB() {
  const client = new Client({
    host: 'localhost',
    user: 'tester',
    password: 'testpass',
    database: 'trail_master_db',
    port: 5432
  });

  try {
    await client.connect();
    console.log('🧹 Cleaning up Production Database...\n');

    // 1. Find duplicate functions
    const duplicates = await client.query(`
      SELECT routine_name, COUNT(*) as count
      FROM information_schema.routines 
      WHERE routine_schema = 'public'
      GROUP BY routine_name 
      HAVING COUNT(*) > 1
      ORDER BY routine_name
    `);

    console.log('📋 DUPLICATE FUNCTIONS:');
    console.log('-'.repeat(40));
    duplicates.rows.forEach(row => {
      console.log(`  ${row.routine_name} (${row.count} instances)`);
    });

    // 2. Find old staging schemas (older than 1 day)
    const oldStagingSchemas = await client.query(`
      SELECT schema_name, 
             EXTRACT(EPOCH FROM (NOW() - to_timestamp(
               split_part(schema_name, '_', 3)::bigint / 1000
             ))) / 3600 as hours_old
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%'
      AND EXTRACT(EPOCH FROM (NOW() - to_timestamp(
        split_part(schema_name, '_', 3)::bigint / 1000
      ))) > 24
      ORDER BY hours_old DESC
    `);

    console.log('\n📋 OLD STAGING SCHEMAS (>24h):');
    console.log('-'.repeat(40));
    oldStagingSchemas.rows.forEach(schema => {
      const hoursOld = parseFloat(schema.hours_old) || 0;
      console.log(`  ${schema.schema_name} (${hoursOld.toFixed(1)}h old)`);
    });

    // 3. Ask for confirmation
    console.log('\n' + '='.repeat(60));
    console.log('🧹 CLEANUP OPTIONS:');
    console.log('1. Drop old staging schemas (>24h old)');
    console.log('2. List all duplicate functions for manual review');
    console.log('3. Exit without changes');
    console.log('='.repeat(60));

    // For now, just show what would be cleaned up
    console.log('\n📊 CLEANUP SUMMARY:');
    console.log(`  Duplicate functions found: ${duplicates.rows.length}`);
    console.log(`  Old staging schemas: ${oldStagingSchemas.rows.length}`);
    
    if (oldStagingSchemas.rows.length > 0) {
      console.log('\n💡 RECOMMENDATION: Clean up old staging schemas to free space');
    }

    console.log('\n✅ Audit complete! Use the information above to plan cleanup.');

  } catch (error) {
    console.error('❌ Cleanup error:', error);
  } finally {
    await client.end();
  }
}

cleanupProductionDB(); 