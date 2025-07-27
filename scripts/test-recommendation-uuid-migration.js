#!/usr/bin/env node

/**
 * Test script for recommendation_uuid to route_uuid migration
 * 
 * This script creates a test database with the old schema (recommendation_uuid)
 * and then runs the migration to verify it works correctly.
 * 
 * Usage: node scripts/test-recommendation-uuid-migration.js
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateRecommendationUuidToRouteUuid } = require('./migrate-recommendation-uuid-to-route-uuid.js');

async function testMigration() {
  const testDbPath = 'test-migration.db';
  
  console.log('🧪 Testing recommendation_uuid to route_uuid migration...');
  
  // Clean up any existing test database
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  
  const db = new Database(testDbPath);
  
  try {
    // Create test database with old schema (recommendation_uuid)
    console.log('📝 Creating test database with old schema...');
    
    const createOldTableSql = `
      CREATE TABLE route_recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recommendation_uuid TEXT UNIQUE,
        gpx_distance_km REAL NOT NULL,
        gpx_elevation_gain REAL NOT NULL,
        gpx_name TEXT,
        recommended_distance_km REAL NOT NULL,
        recommended_elevation_gain REAL NOT NULL,
        route_type TEXT CHECK(route_type IN ('out-and-back', 'loop', 'lollipop', 'point-to-point')) NOT NULL,
        route_edges TEXT NOT NULL,
        route_path TEXT NOT NULL,
        similarity_score REAL NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    db.prepare(createOldTableSql).run();
    
    // Insert test data
    console.log('📊 Inserting test data...');
    const insertSql = `
      INSERT INTO route_recommendations (
        recommendation_uuid, gpx_distance_km, gpx_elevation_gain, gpx_name,
        recommended_distance_km, recommended_elevation_gain, route_type,
        route_edges, route_path, similarity_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const testData = [
      ['route-001', 5.2, 150, 'Test Route 1', 5.0, 140, 'loop', '["edge1", "edge2"]', '{"type":"LineString","coordinates":[]}', 0.95],
      ['route-002', 3.8, 120, 'Test Route 2', 4.0, 130, 'out-and-back', '["edge3", "edge4"]', '{"type":"LineString","coordinates":[]}', 0.88],
      ['route-003', 7.1, 200, 'Test Route 3', 7.0, 190, 'lollipop', '["edge5", "edge6"]', '{"type":"LineString","coordinates":[]}', 0.92]
    ];
    
    testData.forEach(data => {
      db.prepare(insertSql).run(data);
    });
    
    // Create old indexes
    db.prepare(`CREATE INDEX idx_route_recommendations_distance ON route_recommendations(gpx_distance_km, recommended_distance_km)`).run();
    db.prepare(`CREATE INDEX idx_route_recommendations_uuid ON route_recommendations(recommendation_uuid)`).run();
    
    db.close();
    
    // Verify old schema
    console.log('🔍 Verifying old schema...');
    const oldDb = new Database(testDbPath);
    const oldTableInfo = oldDb.prepare(`PRAGMA table_info(route_recommendations)`).all();
    const hasRecommendationUuid = oldTableInfo.some(col => col.name === 'recommendation_uuid');
    const hasRouteUuid = oldTableInfo.some(col => col.name === 'route_uuid');
    
    console.log('📋 Old table schema:');
    oldTableInfo.forEach(col => {
      console.log(`   - ${col.name} (${col.type})`);
    });
    
    if (!hasRecommendationUuid) {
      throw new Error('❌ Old schema does not have recommendation_uuid column');
    }
    
    if (hasRouteUuid) {
      throw new Error('❌ Old schema should not have route_uuid column');
    }
    
    const oldRowCount = oldDb.prepare(`SELECT COUNT(*) as count FROM route_recommendations`).get().count;
    console.log(`📊 Old table row count: ${oldRowCount}`);
    
    oldDb.close();
    
    // Run migration
    console.log('🔄 Running migration...');
    await migrateRecommendationUuidToRouteUuid(testDbPath);
    
    // Verify new schema
    console.log('🔍 Verifying new schema...');
    const newDb = new Database(testDbPath);
    const newTableInfo = newDb.prepare(`PRAGMA table_info(route_recommendations)`).all();
    const newHasRecommendationUuid = newTableInfo.some(col => col.name === 'recommendation_uuid');
    const newHasRouteUuid = newTableInfo.some(col => col.name === 'route_uuid');
    
    console.log('📋 New table schema:');
    newTableInfo.forEach(col => {
      console.log(`   - ${col.name} (${col.type})`);
    });
    
    if (newHasRecommendationUuid) {
      throw new Error('❌ New schema still has recommendation_uuid column');
    }
    
    if (!newHasRouteUuid) {
      throw new Error('❌ New schema does not have route_uuid column');
    }
    
    const newRowCount = newDb.prepare(`SELECT COUNT(*) as count FROM route_recommendations`).get().count;
    console.log(`📊 New table row count: ${newRowCount}`);
    
    if (newRowCount !== oldRowCount) {
      throw new Error(`❌ Row count mismatch: old=${oldRowCount}, new=${newRowCount}`);
    }
    
    // Verify data integrity
    console.log('🔍 Verifying data integrity...');
    const migratedData = newDb.prepare(`
      SELECT route_uuid, gpx_name, route_type, similarity_score 
      FROM route_recommendations 
      ORDER BY route_uuid
    `).all();
    
    console.log('📊 Migrated data:');
    migratedData.forEach(row => {
      console.log(`   - ${row.route_uuid}: ${row.gpx_name} (${row.route_type}) - score: ${row.similarity_score}`);
    });
    
    // Verify indexes
    console.log('🔍 Verifying indexes...');
    const indexes = newDb.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='index' AND tbl_name='route_recommendations'
    `).all();
    
    console.log('📋 Indexes:');
    indexes.forEach(index => {
      console.log(`   - ${index.name}`);
    });
    
    const hasUuidIndex = indexes.some(index => index.name === 'idx_route_recommendations_uuid');
    if (!hasUuidIndex) {
      throw new Error('❌ Missing route_uuid index');
    }
    
    newDb.close();
    
    console.log('✅ Migration test completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration test failed:', error);
    throw error;
  } finally {
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
      console.log('🧹 Cleaned up test database');
    }
  }
}

// Main execution
if (require.main === module) {
  testMigration()
    .then(() => {
      console.log('🎉 Migration test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration test failed:', error);
      process.exit(1);
    });
}

module.exports = { testMigration }; 