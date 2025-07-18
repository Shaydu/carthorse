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
  user: 'shaydu',
  database: 'trail_master_db_test',
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
    
    if (existingTrails.rows[0].count > 0) {
      console.log('✅ Test database already has data, skipping setup');
      return;
    }
    
    // Copy sample data from production database
    console.log('📋 Copying sample trail data...');
    
    // Copy Boulder trails
    await client.query(`
      INSERT INTO trails (
        app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        geometry, region
      )
      SELECT 
        app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        geometry, region
      FROM trail_master_db.trails 
      WHERE region = 'boulder' 
      LIMIT 100
    `);
    
    // Copy Seattle trails
    await client.query(`
      INSERT INTO trails (
        app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        geometry, region
      )
      SELECT 
        app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        geometry, region
      FROM trail_master_db.trails 
      WHERE region = 'seattle' 
      LIMIT 50
    `);
    
    // Verify the data
    const boulderCount = await client.query("SELECT COUNT(*) as count FROM trails WHERE region = 'boulder'");
    const seattleCount = await client.query("SELECT COUNT(*) as count FROM trails WHERE region = 'seattle'");
    
    console.log(`✅ Setup complete!`);
    console.log(`   - Boulder trails: ${boulderCount.rows[0].count}`);
    console.log(`   - Seattle trails: ${seattleCount.rows[0].count}`);
    console.log(`   - Total trails: ${boulderCount.rows[0].count + seattleCount.rows[0].count}`);
    
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