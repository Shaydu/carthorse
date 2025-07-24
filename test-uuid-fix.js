#!/usr/bin/env node

const { Client } = require('pg');
const Database = require('better-sqlite3');

// Test configuration
const TEST_REGION = 'boulder';
const TEST_OUTPUT_PATH = './data/test-uuid-fix.db';

async function testUuidFix() {
  console.log('🧪 Testing UUID to integer conversion fix...');
  
  let pgClient;
  
  try {
    // Connect to PostgreSQL
    pgClient = new Client({
      host: process.env.PGHOST || 'localhost',
      port: process.env.PGPORT || 5432,
      user: process.env.PGUSER || 'tester',
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE || 'trail_master_db_test'
    });
    
    await pgClient.connect();
    console.log('✅ Connected to PostgreSQL');
    
    // Create a test staging schema
    const stagingSchema = `test_uuid_fix_${Date.now()}`;
    console.log(`🏗️ Creating test staging schema: ${stagingSchema}`);
    
    // Drop if exists and create fresh
    await pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
    await pgClient.query(`CREATE SCHEMA ${stagingSchema}`);
    
    // Create staging tables with UUID support
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        length_km REAL,
        elevation_gain REAL DEFAULT 0,
        elevation_loss REAL DEFAULT 0,
        geo2 GEOMETRY(LINESTRINGZ, 4326)
      )
    `);
    
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.intersection_points (
        id SERIAL PRIMARY KEY,
        point GEOMETRY(POINT, 4326),
        point_3d GEOMETRY(POINTZ, 4326),
        trail1_id TEXT,
        trail2_id TEXT,
        distance_meters REAL
      )
    `);
    
    // Insert test data with UUIDs
    await pgClient.query(`
      INSERT INTO ${stagingSchema}.trails (app_uuid, name, length_km, elevation_gain, elevation_loss, geo2)
      VALUES 
        ('bb29f3fe-f3c4-4384-a485-a4c5e712914f', 'Test Trail 1', 2.5, 100, 50, ST_GeomFromText('LINESTRINGZ(-105.27 40.02 1600, -105.28 40.03 1650)', 4326)),
        ('cc39f4fe-f4c5-5485-b596-b5d6f8230250', 'Test Trail 2', 3.0, 150, 75, ST_GeomFromText('LINESTRINGZ(-105.28 40.03 1650, -105.29 40.04 1700)', 4326))
    `);
    
    console.log('✅ Test data inserted with UUIDs');
    
    // Test the intersection detection function
    console.log('🔍 Testing intersection detection with UUIDs...');
    
    // Import the fixed intersection helper
    const { detectIntersectionsHelper } = require('./dist/utils/sql/intersection');
    
    // This should NOT throw the UUID to integer conversion error
    const splitPoints = await detectIntersectionsHelper(pgClient, stagingSchema, 2.0);
    
    console.log('✅ Intersection detection completed successfully!');
    console.log(`📊 Found ${splitPoints.size} trails with intersection points`);
    
    // Log the results
    for (const [trailId, points] of splitPoints) {
      console.log(`   Trail ${trailId}: ${points.length} intersection points`);
      for (const point of points) {
        console.log(`     - Intersects with trail: ${point.visitorTrailId} (${point.visitorTrailName})`);
        console.log(`     - Coordinate: [${point.coordinate.join(', ')}]`);
        console.log(`     - Distance: ${point.distance}m`);
      }
    }
    
    // Test SQLite export with the fixed data
    console.log('💾 Testing SQLite export with fixed intersection data...');
    
    const { 
      createSqliteTables, 
      insertTrails, 
      insertRoutingNodes, 
      insertRoutingEdges, 
      insertRegionMetadata, 
      buildRegionMeta, 
      insertSchemaVersion 
    } = require('./dist/utils/sqlite-export-helpers');
    
    // Create SQLite database
    const sqliteDb = new Database(TEST_OUTPUT_PATH);
    
    // Create tables
    createSqliteTables(sqliteDb);
    
    // Get trail data
    const trailsRes = await pgClient.query(`SELECT * FROM ${stagingSchema}.trails`);
    
    // Insert trails
    insertTrails(sqliteDb, trailsRes.rows);
    
    // Insert region metadata
    const regionMeta = buildRegionMeta({ region: TEST_REGION }, {
      minLng: -105.30,
      maxLng: -105.25,
      minLat: 40.00,
      maxLat: 40.05,
      trailCount: trailsRes.rows.length
    });
    insertRegionMetadata(sqliteDb, regionMeta);
    
    // Insert schema version
    insertSchemaVersion(sqliteDb, 1, 'Carthorse UUID Fix Test v1.0');
    
    // Verify data
    const trailCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM trails').get().count;
    console.log(`✅ SQLite export complete: ${trailCount} trails`);
    
    // Test a query with UUID
    const testTrail = sqliteDb.prepare('SELECT name, length_km FROM trails WHERE app_uuid = ?').get('bb29f3fe-f3c4-4384-a485-a4c5e712914f');
    console.log(`   - Test query with UUID: ${testTrail.name} (${testTrail.length_km} km)`);
    
    sqliteDb.close();
    
    console.log('🎉 UUID fix test completed successfully!');
    console.log('📋 This confirms that:');
    console.log('   - UUID trail identifiers are handled correctly');
    console.log('   - No integer conversion errors occur');
    console.log('   - Intersection detection works with UUIDs');
    console.log('   - SQLite export works with UUID data');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    if (pgClient) {
      // Clean up staging schema
      try {
        await pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
        console.log('🧹 Cleaned up test staging schema');
      } catch (cleanupErr) {
        console.warn('⚠️ Failed to clean up staging schema:', cleanupErr);
      }
      await pgClient.end();
    }
  }
}

// Run the test
testUuidFix()
  .then(() => {
    console.log('✅ All tests passed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Tests failed:', error);
    process.exit(1);
  }); 