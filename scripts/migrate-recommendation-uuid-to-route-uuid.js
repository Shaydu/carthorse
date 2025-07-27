#!/usr/bin/env node

/**
 * Migration script to rename recommendation_uuid to route_uuid in SQLite databases
 * 
 * This script handles the migration of existing SQLite databases that have
 * the old field name 'recommendation_uuid' to the new field name 'route_uuid'
 * for consistency with the Route entity concept.
 * 
 * Usage: node scripts/migrate-recommendation-uuid-to-route-uuid.js <database-path>
 * Example: node scripts/migrate-recommendation-uuid-to-route-uuid.js api-service/data/boulder.db
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

async function migrateRecommendationUuidToRouteUuid(dbPath) {
  console.log(`🔄 Starting migration: recommendation_uuid → route_uuid`);
  console.log(`📁 Database: ${dbPath}`);
  
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }
  
  const db = new Database(dbPath);
  
  try {
    // Check if route_recommendations table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='route_recommendations'
    `).get();
    
    if (!tableExists) {
      console.log('ℹ️  route_recommendations table does not exist, skipping migration');
      return;
    }
    
    // Check current schema
    const tableInfo = db.prepare(`PRAGMA table_info(route_recommendations)`).all();
    console.log('📋 Current table schema:');
    tableInfo.forEach(col => {
      console.log(`   - ${col.name} (${col.type})`);
    });
    
    // Check if recommendation_uuid column exists
    const hasRecommendationUuid = tableInfo.some(col => col.name === 'recommendation_uuid');
    const hasRouteUuid = tableInfo.some(col => col.name === 'route_uuid');
    
    if (!hasRecommendationUuid) {
      console.log('ℹ️  recommendation_uuid column does not exist, skipping migration');
      return;
    }
    
    if (hasRouteUuid) {
      console.log('⚠️  route_uuid column already exists, checking if migration is needed...');
      
      // Check if recommendation_uuid has data
      const recommendationCount = db.prepare(`
        SELECT COUNT(*) as count FROM route_recommendations 
        WHERE recommendation_uuid IS NOT NULL
      `).get().count;
      
      if (recommendationCount === 0) {
        console.log('ℹ️  No data in recommendation_uuid column, dropping old column');
        db.prepare(`ALTER TABLE route_recommendations DROP COLUMN recommendation_uuid`).run();
        console.log('✅ Dropped recommendation_uuid column');
        return;
      }
      
      // Check if route_uuid has data
      const routeCount = db.prepare(`
        SELECT COUNT(*) as count FROM route_recommendations 
        WHERE route_uuid IS NOT NULL
      `).get().count;
      
      if (routeCount === 0 && recommendationCount > 0) {
        console.log('🔄 Copying data from recommendation_uuid to route_uuid...');
        db.prepare(`
          UPDATE route_recommendations 
          SET route_uuid = recommendation_uuid 
          WHERE recommendation_uuid IS NOT NULL AND route_uuid IS NULL
        `).run();
        console.log('✅ Copied data from recommendation_uuid to route_uuid');
        
        console.log('🗑️  Dropping recommendation_uuid column...');
        db.prepare(`ALTER TABLE route_recommendations DROP COLUMN recommendation_uuid`).run();
        console.log('✅ Dropped recommendation_uuid column');
        return;
      }
      
      console.log('⚠️  Both columns have data, manual intervention required');
      return;
    }
    
    // Main migration: rename recommendation_uuid to route_uuid
    console.log('🔄 Renaming recommendation_uuid to route_uuid...');
    
    // SQLite doesn't support RENAME COLUMN directly, so we need to recreate the table
    const createTableSql = `
      CREATE TABLE route_recommendations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_uuid TEXT UNIQUE,
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
    
    // Create new table with correct schema
    db.prepare(createTableSql).run();
    
    // Copy data from old table to new table
    const copyDataSql = `
      INSERT INTO route_recommendations_new (
        id, route_uuid, gpx_distance_km, gpx_elevation_gain, gpx_name,
        recommended_distance_km, recommended_elevation_gain, route_type,
        route_edges, route_path, similarity_score, created_at
      )
      SELECT 
        id, recommendation_uuid, gpx_distance_km, gpx_elevation_gain, gpx_name,
        recommended_distance_km, recommended_elevation_gain, route_type,
        route_edges, route_path, similarity_score, created_at
      FROM route_recommendations
    `;
    
    db.prepare(copyDataSql).run();
    
    // Drop old table and rename new table
    db.prepare(`DROP TABLE route_recommendations`).run();
    db.prepare(`ALTER TABLE route_recommendations_new RENAME TO route_recommendations`).run();
    
    // Recreate indexes
    console.log('🔧 Recreating indexes...');
    const indexSqls = [
      `CREATE INDEX idx_route_recommendations_distance ON route_recommendations(gpx_distance_km, recommended_distance_km)`,
      `CREATE INDEX idx_route_recommendations_elevation ON route_recommendations(gpx_elevation_gain, recommended_elevation_gain)`,
      `CREATE INDEX idx_route_recommendations_type ON route_recommendations(route_type)`,
      `CREATE INDEX idx_route_recommendations_score ON route_recommendations(similarity_score)`,
      `CREATE INDEX idx_route_recommendations_uuid ON route_recommendations(route_uuid)`
    ];
    
    indexSqls.forEach(sql => {
      try {
        db.prepare(sql).run();
      } catch (error) {
        console.log(`⚠️  Index creation warning: ${error.message}`);
      }
    });
    
    // Verify migration
    const newTableInfo = db.prepare(`PRAGMA table_info(route_recommendations)`).all();
    console.log('📋 New table schema:');
    newTableInfo.forEach(col => {
      console.log(`   - ${col.name} (${col.type})`);
    });
    
    const rowCount = db.prepare(`SELECT COUNT(*) as count FROM route_recommendations`).get().count;
    console.log(`📊 Total rows in route_recommendations: ${rowCount}`);
    
    console.log('✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    db.close();
  }
}

// Main execution
if (require.main === module) {
  const dbPath = process.argv[2];
  
  if (!dbPath) {
    console.error('❌ Usage: node scripts/migrate-recommendation-uuid-to-route-uuid.js <database-path>');
    console.error('Example: node scripts/migrate-recommendation-uuid-to-route-uuid.js api-service/data/boulder.db');
    process.exit(1);
  }
  
  migrateRecommendationUuidToRouteUuid(dbPath)
    .then(() => {
      console.log('🎉 Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateRecommendationUuidToRouteUuid }; 