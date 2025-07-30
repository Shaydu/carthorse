#!/usr/bin/env node

/**
 * Migration script to upgrade SQLite v12 to v13 with trail count and route shape enforcement
 * 
 * This script:
 * 1. Analyzes existing route_recommendations data
 * 2. Determines trail_count based on route_edges JSON array length
 * 3. Determines route_shape based on route geometry analysis
 * 4. Creates new table with v13 constraints
 * 5. Migrates data with proper enforcement
 * 
 * Usage: node scripts/migrate-v12-to-v13-route-enforcement.js <database-path>
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

/**
 * Analyze route geometry to determine route shape
 * @param {string} routePath - GeoJSON route path
 * @param {string} routeEdges - JSON array of trail segments
 * @returns {string} route shape classification
 */
function analyzeRouteShape(routePath, routeEdges) {
  try {
    // Parse route path to analyze geometry
    const pathData = JSON.parse(routePath);
    
    // Check if it's a single trail route
    const edgesData = JSON.parse(routeEdges);
    const trailCount = edgesData.length;
    
    if (trailCount === 1) {
      // Single trail - analyze the geometry
      const coordinates = pathData.coordinates || [];
      
      if (coordinates.length < 2) {
        return 'point-to-point'; // Default for insufficient data
      }
      
      // Check if start and end points are close (loop)
      const start = coordinates[0];
      const end = coordinates[coordinates.length - 1];
      const distance = Math.sqrt(
        Math.pow(start[0] - end[0], 2) + Math.pow(start[1] - end[1], 2)
      );
      
      // If start and end are close (within ~100 meters), it's likely a loop
      if (distance < 0.001) { // Roughly 100 meters in degrees
        return 'loop';
      } else {
        return 'out-and-back';
      }
    } else {
      // Multiple trails - analyze the overall shape
      const coordinates = pathData.coordinates || [];
      
      if (coordinates.length < 2) {
        return 'point-to-point';
      }
      
      const start = coordinates[0];
      const end = coordinates[coordinates.length - 1];
      const distance = Math.sqrt(
        Math.pow(start[0] - end[0], 2) + Math.pow(start[1] - end[1], 2)
      );
      
      if (distance < 0.001) {
        return 'loop';
      } else if (trailCount === 2) {
        return 'out-and-back';
      } else {
        // Complex multi-trail route
        return 'lollipop';
      }
    }
  } catch (error) {
    console.log(`⚠️  Error analyzing route shape: ${error.message}`);
    return 'point-to-point'; // Default fallback
  }
}

/**
 * Determine trail count based on route edges
 * @param {string} routeEdges - JSON array of trail segments
 * @returns {number} trail count
 */
function determineTrailCount(routeEdges) {
  try {
    const edgesData = JSON.parse(routeEdges);
    return edgesData.length;
  } catch (error) {
    console.log(`⚠️  Error determining trail count: ${error.message}`);
    return 1; // Default to single trail for safety
  }
}

/**
 * Migrate SQLite database from v12 to v13 with trail count and route shape enforcement
 * @param {string} dbPath - Path to SQLite database
 */
async function migrateV12ToV13(dbPath) {
  console.log(`🔄 Starting migration from v12 to v13: ${dbPath}`);
  
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }
  
  // Create backup
  const backupPath = dbPath.replace('.db', '_v12_backup.db');
  fs.copyFileSync(dbPath, backupPath);
  console.log(`💾 Created backup: ${backupPath}`);
  
  const db = new Database(dbPath);
  
  try {
    // Check current schema version
    const versionResult = db.prepare('SELECT version FROM schema_version ORDER BY created_at DESC LIMIT 1').get();
    const currentVersion = versionResult ? versionResult.version : 0;
    
    console.log(`📋 Current schema version: ${currentVersion}`);
    
    if (currentVersion >= 13) {
      console.log('✅ Database is already at v13 or higher');
      return;
    }
    
    // Analyze existing route_recommendations data
    console.log('🔍 Analyzing existing route recommendations...');
    const existingRoutes = db.prepare('SELECT COUNT(*) as count FROM route_recommendations').get();
    console.log(`📊 Found ${existingRoutes.count} existing route recommendations`);
    
    // Create new table with v13 schema
    console.log('🏗️  Creating new route_recommendations table with v13 schema...');
    
    const createV13Table = `
      CREATE TABLE route_recommendations_v13 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_uuid TEXT UNIQUE,
        region TEXT NOT NULL,
        gpx_distance_km REAL CHECK(gpx_distance_km >= 0),
        gpx_elevation_gain REAL CHECK(gpx_elevation_gain >= 0),
        gpx_name TEXT,
        recommended_distance_km REAL CHECK(recommended_distance_km >= 0),
        recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
        trail_count INTEGER CHECK(trail_count >= 1) NOT NULL,
        route_shape TEXT CHECK(route_shape IN ('loop', 'out-and-back', 'lollipop', 'point-to-point')) NOT NULL,
        route_type TEXT,
        route_edges TEXT,
        route_path TEXT,
        similarity_score REAL CHECK(similarity_score >= 0 AND similarity_score <= 1),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        input_distance_km REAL CHECK(input_distance_km >= 0),
        input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
        input_distance_tolerance REAL CHECK(input_distance_tolerance >= 0),
        input_elevation_tolerance REAL CHECK(input_elevation_tolerance >= 0),
        expires_at DATETIME,
        usage_count INTEGER DEFAULT 0 CHECK(usage_count >= 0),
        complete_route_data TEXT,
        trail_connectivity_data TEXT,
        request_hash TEXT
      )
    `;
    
    db.prepare(createV13Table).run();
    
    // Migrate data with trail count and route shape analysis
    console.log('🔄 Migrating data with trail count and route shape analysis...');
    
    const migrateData = `
      INSERT INTO route_recommendations_v13 (
        id, route_uuid, region, gpx_distance_km, gpx_elevation_gain, gpx_name,
        recommended_distance_km, recommended_elevation_gain, trail_count, route_shape,
        route_type, route_edges, route_path, similarity_score, created_at,
        input_distance_km, input_elevation_gain, input_distance_tolerance, input_elevation_tolerance,
        expires_at, usage_count, complete_route_data, trail_connectivity_data, request_hash
      )
      SELECT 
        id, route_uuid, region, gpx_distance_km, gpx_elevation_gain, gpx_name,
        recommended_distance_km, recommended_elevation_gain,
        CASE 
          WHEN route_edges IS NOT NULL THEN json_array_length(route_edges)
          ELSE 1
        END as trail_count,
        CASE 
          WHEN route_path IS NOT NULL AND route_edges IS NOT NULL THEN
            CASE 
              WHEN json_array_length(route_edges) = 1 AND 
                   json_extract(route_path, '$.coordinates[0]') = json_extract(route_path, '$.coordinates[-1]') THEN 'loop'
              WHEN json_array_length(route_edges) = 1 THEN 'out-and-back'
              WHEN json_array_length(route_edges) = 2 THEN 'out-and-back'
              ELSE 'lollipop'
            END
          ELSE 'point-to-point'
        END as route_shape,
        route_type, route_edges, route_path, similarity_score, created_at,
        input_distance_km, input_elevation_gain, input_distance_tolerance, input_elevation_tolerance,
        expires_at, usage_count, complete_route_data, trail_connectivity_data, request_hash
      FROM route_recommendations
    `;
    
    db.prepare(migrateData).run();
    
    // Verify migration
    const newCount = db.prepare('SELECT COUNT(*) as count FROM route_recommendations_v13').get().count;
    console.log(`✅ Migrated ${newCount} route recommendations`);
    
    // Drop old table and rename new table
    console.log('🔄 Replacing old table with new schema...');
    db.prepare('DROP TABLE route_recommendations').run();
    db.prepare('ALTER TABLE route_recommendations_v13 RENAME TO route_recommendations').run();
    
    // Create new indexes for filtering
    console.log('🔧 Creating new filtering indexes...');
    const indexSqls = [
      'CREATE INDEX IF NOT EXISTS idx_route_recommendations_trail_count ON route_recommendations(trail_count)',
      'CREATE INDEX IF NOT EXISTS idx_route_recommendations_shape ON route_recommendations(route_shape)',
      'CREATE INDEX IF NOT EXISTS idx_route_recommendations_trail_count_shape ON route_recommendations(trail_count, route_shape)',
      'CREATE INDEX IF NOT EXISTS idx_route_recommendations_region_trail_count ON route_recommendations(region, trail_count)',
      'CREATE INDEX IF NOT EXISTS idx_route_recommendations_region_shape ON route_recommendations(region, route_shape)',
      'CREATE INDEX IF NOT EXISTS idx_route_recommendations_region_trail_count_shape ON route_recommendations(region, trail_count, route_shape)'
    ];
    
    indexSqls.forEach(sql => {
      try {
        db.prepare(sql).run();
      } catch (error) {
        console.log(`⚠️  Index creation warning: ${error.message}`);
      }
    });
    
    // Update schema version
    console.log('📝 Updating schema version...');
    db.prepare(`
      INSERT INTO schema_version (version, description, created_at)
      VALUES (13, 'Trail count and route shape enforcement for recommendation engine filtering', datetime('now'))
    `).run();
    
    // Validate data integrity
    console.log('🔍 Validating data integrity...');
    const validationQueries = [
      'SELECT COUNT(*) as count FROM route_recommendations WHERE trail_count < 1',
      'SELECT COUNT(*) as count FROM route_recommendations WHERE route_shape NOT IN ("loop", "out-and-back", "lollipop", "point-to-point")',
      'SELECT COUNT(*) as count FROM route_recommendations WHERE trail_count IS NULL',
      'SELECT COUNT(*) as count FROM route_recommendations WHERE route_shape IS NULL'
    ];
    
    validationQueries.forEach((query, index) => {
      const result = db.prepare(query).get();
      const count = result.count;
      if (count > 0) {
        console.log(`⚠️  Validation warning: ${count} records with invalid data in query ${index + 1}`);
      }
    });
    
    // Show migration summary
    console.log('📊 Migration Summary:');
    const summaryQueries = [
      'SELECT trail_count, COUNT(*) as count FROM route_recommendations GROUP BY trail_count',
      'SELECT route_shape, COUNT(*) as count FROM route_recommendations GROUP BY route_shape',
      'SELECT trail_count, route_shape, COUNT(*) as count FROM route_recommendations GROUP BY trail_count, route_shape'
    ];
    
    summaryQueries.forEach((query, index) => {
      const results = db.prepare(query).all();
      console.log(`  Query ${index + 1}:`);
      results.forEach(row => {
        console.log(`    ${JSON.stringify(row)}`);
      });
    });
    
    console.log('✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    
    // Restore backup if migration failed
    console.log('🔄 Restoring from backup...');
    db.close();
    fs.copyFileSync(backupPath, dbPath);
    console.log('✅ Database restored from backup');
    
    throw error;
  } finally {
    db.close();
  }
}

// Main execution
if (require.main === module) {
  const dbPath = process.argv[2];
  
  if (!dbPath) {
    console.error('❌ Usage: node scripts/migrate-v12-to-v13-route-enforcement.js <database-path>');
    console.error('Example: node scripts/migrate-v12-to-v13-route-enforcement.js api-service/data/boulder.db');
    process.exit(1);
  }
  
  migrateV12ToV13(dbPath)
    .then(() => {
      console.log('🎉 Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateV12ToV13, analyzeRouteShape, determineTrailCount }; 