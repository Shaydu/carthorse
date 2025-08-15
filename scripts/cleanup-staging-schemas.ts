#!/usr/bin/env ts-node

import { Client } from 'pg';
import { config } from 'dotenv';
import * as path from 'path';

// Load environment variables
config();

async function cleanupStagingSchemas() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'carthorse',
    password: process.env.PGPASSWORD,
  });

  try {
    await client.connect();
    console.log('🔗 Connected to database');

    // First, let's see what schemas we have
    const schemasResult = await client.query(`
      SELECT 
        schemaname,
        to_timestamp(split_part(schemaname, '_', 2)::bigint / 1000.0) as created_time
      FROM pg_tables 
      WHERE schemaname LIKE 'carthorse_%'
      ORDER BY split_part(schemaname, '_', 2)::bigint DESC
    `);

    console.log(`📊 Found ${schemasResult.rows.length} staging schemas:`);
    schemasResult.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. ${row.schemaname} (created: ${row.created_time})`);
    });

    if (schemasResult.rows.length <= 1) {
      console.log('✅ No cleanup needed - only one or zero staging schemas found');
      return;
    }

    // Get the latest schema
    const latestSchema = schemasResult.rows[0];
    console.log(`\n🎯 Keeping latest schema: ${latestSchema.schemaname}`);

    // Get schemas to delete
    const schemasToDelete = schemasResult.rows.slice(1);
    console.log(`🗑️  Will delete ${schemasToDelete.length} old schemas:`);
    schemasToDelete.forEach(row => {
      console.log(`   - ${row.schemaname}`);
    });

    // Confirm deletion
    console.log('\n⚠️  This will permanently delete the old schemas. Continue? (y/N)');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.once('data', async (data) => {
      const input = data.toString().trim().toLowerCase();
      process.stdin.setRawMode(false);
      process.stdin.pause();

      if (input === 'y' || input === 'yes') {
        console.log('\n🗑️  Deleting old schemas...');
        
        for (const schema of schemasToDelete) {
          try {
            await client.query(`DROP SCHEMA IF EXISTS ${schema.schemaname} CASCADE`);
            console.log(`   ✅ Deleted ${schema.schemaname}`);
          } catch (error) {
            console.error(`   ❌ Failed to delete ${schema.schemaname}:`, error);
          }
        }
        
        console.log('\n✅ Cleanup complete!');
      } else {
        console.log('\n❌ Cleanup cancelled');
      }
      
      await client.end();
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    await client.end();
    process.exit(1);
  }
}

// Run the cleanup
cleanupStagingSchemas().catch(console.error);
