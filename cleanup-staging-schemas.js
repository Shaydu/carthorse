#!/usr/bin/env node

const { Client } = require('pg');

async function cleanupStagingSchemas() {
  const client = new Client({
    host: 'localhost',
    user: 'tester',
    password: 'testpass',
    database: 'trail_master_db',
    port: 5432
  });

  try {
    await client.connect();
    console.log('🧹 Cleaning up old staging schemas...\n');

    // Find staging schemas older than 24 hours
    const oldSchemas = await client.query(`
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

    if (oldSchemas.rows.length === 0) {
      console.log('✅ No old staging schemas to clean up!');
      return;
    }

    console.log(`📋 Found ${oldSchemas.rows.length} old staging schemas:`);
    console.log('-'.repeat(50));
    
    oldSchemas.rows.forEach(schema => {
      const hoursOld = parseFloat(schema.hours_old) || 0;
      console.log(`  ${schema.schema_name} (${hoursOld.toFixed(1)}h old)`);
    });

    console.log('\n⚠️  WARNING: This will permanently delete these schemas!');
    console.log('   Only proceed if you are sure these are not in use.');
    
    // For safety, just show what would be dropped
    console.log('\n📋 SCHEMAS THAT WOULD BE DROPPED:');
    console.log('-'.repeat(50));
    
    for (const schema of oldSchemas.rows) {
      console.log(`  DROP SCHEMA IF EXISTS ${schema.schema_name} CASCADE;`);
    }

    console.log('\n💡 To actually drop these schemas, run the SQL commands above manually.');
    console.log('   Or modify this script to execute the drops automatically.');

  } catch (error) {
    console.error('❌ Cleanup error:', error);
  } finally {
    await client.end();
  }
}

cleanupStagingSchemas(); 