#!/usr/bin/env node

/**
 * Setup script for CARTHORSE test database
 * 
 * This script sets up a test PostgreSQL database with sample trail data
 * for Boulder and Seattle regions to support the test suite.
 */

const { Client } = require('pg');
const fs = require('fs-extra');
const path = require('path');

const TEST_DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  user: process.env.PGUSER || 'tester',
  database: process.env.PGDATABASE || 'trail_master_db_test',
  password: process.env.PGPASSWORD || ''
};

async function setupTestDatabase() {
  console.log('🔧 Setting up CARTHORSE test database...');
  
  const client = new Client(TEST_DB_CONFIG);
  
  try {
    await client.connect();
    console.log('✅ Connected to test database');
    
    // Check if test data already exists
    const existingTrails = await client.query('SELECT COUNT(*) as count FROM trails');
    console.log(`📊 Found ${existingTrails.rows[0].count} existing trails`);
    
    if (Number(existingTrails.rows[0].count) > 0) {
      console.log('✅ Test database already has data, skipping setup');
      return;
    }
    
    // Insert mock/sample data if needed (for safety, do not copy from production)
    console.log('⚠️  No sample data found. Please insert mock data or use create_test_database.sh to populate the test database.');
    // Optionally, insert a minimal mock trail here for test safety
    // await client.query(`INSERT INTO trails (app_uuid, name, region, geometry) VALUES ('mock-uuid', 'Mock Trail', 'boulder', ST_GeomFromText('LINESTRING Z(-105.3 40.0 1000, -105.2 40.1 1100)', 4326))`);
    
    // You can add more mock data insertion here if desired
    
  } catch (error) {
    console.error('❌ Error setting up test database:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the setup
if (require.main === module) {
  setupTestDatabase().catch(console.error);
}

module.exports = { setupTestDatabase }; 