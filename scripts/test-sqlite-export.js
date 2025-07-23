#!/usr/bin/env node
/**
 * Test SQLite Export
 * Manually export data from PostGIS staging to SQLite to test the export functionality
 */

const { Client } = require('pg');
const Database = require('better-sqlite3');
const path = require('path');

async function testSqliteExport() {
  console.log('🧪 Testing SQLite export functionality...');
  
  // Connect to PostgreSQL
  const pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'trail_master_db_test'
  });
  
  await pgClient.connect();
  console.log('✅ Connected to PostgreSQL');
  
  // Get staging schema
  const stagingSchema = 'staging_boulder_1753313112829';
  
  try {
    // Query data from staging schema
    console.log('📊 Querying data from PostGIS staging...');
    const trailsRes = await pgClient.query(`SELECT * FROM ${stagingSchema}.split_trails`);
    const nodesRes = await pgClient.query(`SELECT * FROM ${stagingSchema}.routing_nodes`);
    const edgesRes = await pgClient.query(`SELECT * FROM ${stagingSchema}.routing_edges`);
    
    console.log(`📈 Found ${trailsRes.rows.length} trails, ${nodesRes.rows.length} nodes, ${edgesRes.rows.length} edges`);
    
    // Create SQLite database
    const sqlitePath = './data/test-sqlite-export.db';
    console.log(`💾 Creating SQLite database at ${sqlitePath}...`);
    const sqliteDb = new Database(sqlitePath);
    
    // Import SQLite helpers
    const { createSqliteTables, insertTrails, insertRoutingNodes, insertRoutingEdges } = require('./src/utils/sqlite-export-helpers.ts');
    
    // Create tables
    console.log('🏗️ Creating SQLite tables...');
    createSqliteTables(sqliteDb);
    
    // Insert data
    console.log('📥 Inserting data into SQLite...');
    insertTrails(sqliteDb, trailsRes.rows);
    insertRoutingNodes(sqliteDb, nodesRes.rows);
    insertRoutingEdges(sqliteDb, edgesRes.rows);
    
    // Verify data
    console.log('🔍 Verifying SQLite data...');
    const trailCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM trails').get().count;
    const nodeCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM routing_nodes').get().count;
    const edgeCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM routing_edges').get().count;
    
    console.log(`✅ SQLite export complete:`);
    console.log(`   - Trails: ${trailCount}`);
    console.log(`   - Nodes: ${nodeCount}`);
    console.log(`   - Edges: ${edgeCount}`);
    
    // Check file size
    const fs = require('fs');
    const stats = fs.statSync(sqlitePath);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`   - File size: ${fileSizeMB} MB`);
    
    console.log('🎉 SQLite export test successful!');
    
  } catch (error) {
    console.error('❌ SQLite export test failed:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the test
testSqliteExport().catch(console.error); 