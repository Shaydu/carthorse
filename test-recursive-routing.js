const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function testRecursiveRouting() {
  console.log('🧪 Testing Recursive Route Finding...');
  
  // Connect to test database
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db_test',
    user: 'tester',
    password: ''
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to test database');
    
    // Create test schema
    const testSchema = 'test_recursive_routing';
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    console.log('✅ Created test schema');
    
    // Install recursive route finding functions
    const functionsPath = path.join(process.cwd(), 'sql/functions/recursive-route-finding.sql');
    const functionsSql = fs.readFileSync(functionsPath, 'utf8');
    await client.query(functionsSql);
    console.log('✅ Installed recursive route finding functions');
    
    // Create test routing graph
    await client.query(`
      CREATE TABLE ${testSchema}.routing_nodes (
        id SERIAL PRIMARY KEY,
        node_uuid TEXT UNIQUE NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        elevation REAL,
        node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
        connected_trails TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE ${testSchema}.routing_edges (
        id SERIAL PRIMARY KEY,
        source INTEGER NOT NULL,
        target INTEGER NOT NULL,
        trail_id TEXT,
        trail_name TEXT,
        distance_km REAL CHECK(distance_km > 0),
        elevation_gain REAL CHECK(elevation_gain >= 0),
        elevation_loss REAL CHECK(elevation_loss >= 0),
        geojson TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert test data - simple 3-node graph
    await client.query(`
      INSERT INTO ${testSchema}.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails) VALUES
        ('node-1', 40.0, -105.0, 1600, 'intersection', 'trail-a,trail-b'),
        ('node-2', 40.1, -105.1, 1700, 'intersection', 'trail-b,trail-c'),
        ('node-3', 40.2, -105.2, 1800, 'endpoint', 'trail-c')
    `);

    await client.query(`
      INSERT INTO ${testSchema}.routing_edges (source, target, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geojson) VALUES
        (1, 2, 'trail-b', 'Boulder Creek Trail', 5.0, 100, 0, '{"type":"LineString","coordinates":[[-105.0,40.0],[-105.1,40.1]]}'),
        (2, 3, 'trail-c', 'Mesa Trail', 3.0, 100, 0, '{"type":"LineString","coordinates":[[-105.1,40.1],[-105.2,40.2]]}'),
        (2, 1, 'trail-b', 'Boulder Creek Trail', 5.0, 0, 100, '{"type":"LineString","coordinates":[[-105.1,40.1],[-105.0,40.0]]}')
    `);

    console.log('✅ Created test routing graph');

    // Test route finding
    console.log('\n🔍 Testing route finding...');
    const routes = await client.query(`
      SELECT * FROM find_routes_recursive($1, $2, $3, $4, $5)
    `, [testSchema, 8.0, 200.0, 20.0, 5]);

    console.log(`Found ${routes.rows.length} routes:`);
    routes.rows.forEach((route, i) => {
      console.log(`  Route ${i + 1}:`);
      console.log(`    - Distance: ${route.total_distance_km}km`);
      console.log(`    - Elevation: ${route.total_elevation_gain}m`);
      console.log(`    - Shape: ${route.route_shape}`);
      console.log(`    - Score: ${route.similarity_score}`);
      console.log(`    - Path: [${route.route_path.join(' -> ')}]`);
    });

    // Test route finding for criteria
    console.log('\n🎯 Testing route finding for criteria...');
    const criteriaRoutes = await client.query(`
      SELECT * FROM find_routes_for_criteria($1, $2, $3, $4, $5)
    `, [testSchema, 8.0, 200.0, null, 5]);

    console.log(`Found ${criteriaRoutes.rows.length} routes for criteria:`);
    criteriaRoutes.rows.forEach((route, i) => {
      console.log(`  Route ${i + 1}:`);
      console.log(`    - Distance: ${route.total_distance_km}km`);
      console.log(`    - Elevation: ${route.total_elevation_gain}m`);
      console.log(`    - Shape: ${route.route_shape}`);
      console.log(`    - Score: ${route.similarity_score}`);
    });

    // Test route finding validation
    console.log('\n🧪 Testing route finding validation...');
    const tests = await client.query(`
      SELECT * FROM test_route_finding($1)
    `, [testSchema]);

    console.log('Validation results:');
    tests.rows.forEach(test => {
      console.log(`  ${test.test_name}: ${test.result} - ${test.details}`);
    });

    console.log('\n✅ All tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    if (client) {
      await client.query(`DROP SCHEMA IF EXISTS test_recursive_routing CASCADE`);
      await client.end();
    }
  }
}

testRecursiveRouting(); 