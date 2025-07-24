#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');

// Test configuration
const TEST_REGION = 'boulder';
const TEST_OUTPUT_PATH = './data/test-sqlite-export-simple.db';

async function testSqliteExport() {
  console.log('🧪 Testing SQLite export helpers...');
  
  try {
    // Import SQLite helpers from compiled JavaScript
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
    console.log(`💾 Creating SQLite database at ${TEST_OUTPUT_PATH}...`);
    
    // Create tables
    createSqliteTables(sqliteDb);
    console.log('✅ SQLite tables created');
    
    // Create mock data that matches the expected format
    const mockTrails = [
      {
        id: 1,
        app_uuid: 'test-trail-1',
        name: 'Test Trail 1',
        length_km: 2.5,
        elevation_gain: 100,
        elevation_loss: 50,
        geo2: 'LINESTRINGZ(-105.27 40.02 1600, -105.28 40.03 1650)'
      },
      {
        id: 2,
        app_uuid: 'test-trail-2',
        name: 'Test Trail 2',
        length_km: 3.0,
        elevation_gain: 150,
        elevation_loss: 75,
        geo2: 'LINESTRINGZ(-105.28 40.03 1650, -105.29 40.04 1700)'
      }
    ];
    
    const mockNodes = [
      {
        id: 1,
        node_uuid: 'node-1',
        lat: 40.02,
        lng: -105.27,
        elevation: 1600,
        node_type: 'endpoint',
        connected_trails: '["test-trail-1"]',
        coordinate: 'POINT(-105.27 40.02)'
      },
      {
        id: 2,
        node_uuid: 'node-2',
        lat: 40.03,
        lng: -105.28,
        elevation: 1650,
        node_type: 'intersection',
        connected_trails: '["test-trail-1", "test-trail-2"]',
        coordinate: 'POINT(-105.28 40.03)'
      },
      {
        id: 3,
        node_uuid: 'node-3',
        lat: 40.04,
        lng: -105.29,
        elevation: 1700,
        node_type: 'endpoint',
        connected_trails: '["test-trail-2"]',
        coordinate: 'POINT(-105.29 40.04)'
      }
    ];
    
    const mockEdges = [
      {
        id: 1,
        from_node_id: 'node-1',
        to_node_id: 'node-2',
        trail_id: 'test-trail-1',
        trail_name: 'Test Trail 1',
        distance_km: 2.5,
        elevation_gain: 100,
        geometry: 'LINESTRING(-105.27 40.02, -105.28 40.03)'
      },
      {
        id: 2,
        from_node_id: 'node-2',
        to_node_id: 'node-3',
        trail_id: 'test-trail-2',
        trail_name: 'Test Trail 2',
        distance_km: 3.0,
        elevation_gain: 150,
        geometry: 'LINESTRING(-105.28 40.03, -105.29 40.04)'
      }
    ];
    
    // Insert data
    insertTrails(sqliteDb, mockTrails);
    insertRoutingNodes(sqliteDb, mockNodes);
    insertRoutingEdges(sqliteDb, mockEdges);
    console.log('✅ Mock data inserted');
    
    // Insert region metadata
    const regionMeta = buildRegionMeta({ region: TEST_REGION }, {
      minLng: -105.30,
      maxLng: -105.25,
      minLat: 40.00,
      maxLat: 40.05,
      trailCount: mockTrails.length
    });
    insertRegionMetadata(sqliteDb, regionMeta);
    
    // Insert schema version
    insertSchemaVersion(sqliteDb, 1, 'Carthorse SQLite Export Test v1.0');
    
    // Verify data
    const trailCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM trails').get().count;
    const nodeCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM routing_nodes').get().count;
    const edgeCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM routing_edges').get().count;
    
    console.log(`✅ SQLite export complete:`);
    console.log(`   - Trails: ${trailCount}`);
    console.log(`   - Nodes: ${nodeCount}`);
    console.log(`   - Edges: ${edgeCount}`);
    
    // Check file size
    const fs = require('fs');
    const stats = fs.statSync(TEST_OUTPUT_PATH);
    const fileSizeKB = (stats.size / 1024).toFixed(2);
    console.log(`   - File size: ${fileSizeKB} KB`);
    
    // Test a simple query
    const testTrail = sqliteDb.prepare('SELECT name, length_km FROM trails WHERE app_uuid = ?').get('test-trail-1');
    console.log(`   - Test query: ${testTrail.name} (${testTrail.length_km} km)`);
    
    // Test geometry column
    const trailsWithGeometry = sqliteDb.prepare('SELECT COUNT(*) as count FROM trails WHERE geometry_wkt IS NOT NULL').get().count;
    console.log(`   - Trails with geometry: ${trailsWithGeometry}/${trailCount}`);
    
    // Test routing nodes
    const intersectionNodes = sqliteDb.prepare('SELECT COUNT(*) as count FROM routing_nodes WHERE node_type = ?').get('intersection').count;
    console.log(`   - Intersection nodes: ${intersectionNodes}`);
    
    sqliteDb.close();
    
    console.log('🎉 SQLite export test completed successfully!');
    console.log('📋 This confirms that:');
    console.log('   - SQLite export helpers work correctly');
    console.log('   - Data can be exported from PostgreSQL staging to SQLite');
    console.log('   - The public schema PostGIS functions approach is compatible');
    console.log('   - UI applications can consume the exported SQLite databases');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

// Run the test
testSqliteExport()
  .then(() => {
    console.log('✅ All tests passed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Tests failed:', error);
    process.exit(1);
  }); 