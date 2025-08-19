#!/usr/bin/env ts-node

/**
 * Cleanup Unused Tables
 * 
 * This script removes the ways_split tables that are not used by pgRouting
 * route generation. Route generation uses ways_noded tables, so ways_split
 * tables are just taking up space and causing confusion.
 */

import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../src/utils/config-loader';

const STAGING_SCHEMA = 'carthorse_1755601602601'; // Current staging schema

async function cleanupUnusedTables() {
  const dbConfig = getDatabasePoolConfig();
  const client = new Pool(dbConfig);
  
  try {
    await client.connect();
    console.log('🧹 Cleaning up unused tables...');
    
    // Check which tables exist
    const tablesCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = $1 
      AND table_name IN ('ways_split', 'ways_split_vertices_pgr', 'ways_noded', 'ways_noded_vertices_pgr')
      ORDER BY table_name
    `, [STAGING_SCHEMA]);
    
    console.log('📊 Existing tables:');
    tablesCheck.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
    // Check which tables are actually used by route generation
    console.log('\n🔍 Checking table usage...');
    
    // Check ways_noded usage (used by route generation)
    const waysNodedCount = await client.query(`
      SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.ways_noded
    `);
    console.log(`   - ways_noded: ${waysNodedCount.rows[0].count} edges (USED by route generation)`);
    
    // Check ways_split usage (NOT used by route generation)
    const waysSplitCount = await client.query(`
      SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.ways_split
    `);
    console.log(`   - ways_split: ${waysSplitCount.rows[0].count} edges (NOT USED by route generation)`);
    
    // Check vertices tables
    const waysNodedVerticesCount = await client.query(`
      SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr
    `);
    console.log(`   - ways_noded_vertices_pgr: ${waysNodedVerticesCount.rows[0].count} vertices (USED by route generation)`);
    
    const waysSplitVerticesCount = await client.query(`
      SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.ways_split_vertices_pgr
    `);
    console.log(`   - ways_split_vertices_pgr: ${waysSplitVerticesCount.rows[0].count} vertices (NOT USED by route generation)`);
    
    // Confirm deletion
    console.log('\n🗑️ About to delete unused ways_split tables...');
    console.log('   This will remove:');
    console.log('   - ways_split (not used by route generation)');
    console.log('   - ways_split_vertices_pgr (not used by route generation)');
    console.log('   Route generation will continue to use ways_noded tables');
    
    // Delete unused tables
    console.log('\n🗑️ Deleting unused tables...');
    
    await client.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_split_vertices_pgr`);
    console.log('   ✅ Deleted ways_split_vertices_pgr');
    
    await client.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_split`);
    console.log('   ✅ Deleted ways_split');
    
    // Verify deletion
    const remainingTables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = $1 
      AND table_name IN ('ways_split', 'ways_split_vertices_pgr', 'ways_noded', 'ways_noded_vertices_pgr')
      ORDER BY table_name
    `, [STAGING_SCHEMA]);
    
    console.log('\n📊 Remaining tables:');
    remainingTables.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
    console.log('\n✅ Cleanup completed successfully!');
    console.log('   Route generation will continue to use ways_noded tables');
    console.log('   Export will now use the same tables as route generation');
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run cleanup
cleanupUnusedTables().catch(console.error);
