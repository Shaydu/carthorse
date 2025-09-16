const { Client } = require('pg');

async function testCompleteSolution() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('🔍 Testing Complete T-Intersection Solution...\n');

    // Test 1: Verify the fixed detect_trail_intersections function works
    console.log('📋 Test 1: Verifying fixed detect_trail_intersections function...');
    const intersectionResult = await client.query(`
      SELECT 
        node_type,
        connected_trail_names,
        distance_meters,
        ST_AsText(intersection_point) as intersection_point_text
      FROM detect_trail_intersections('public', 'trails', 500.0 / 111000.0)
      WHERE array_to_string(connected_trail_names, ',') ILIKE '%Big Bluestem%' 
         AND array_to_string(connected_trail_names, ',') ILIKE '%South Boulder Creek%'
         AND node_type = 't_intersection'
      ORDER BY distance_meters
    `);

    console.log(`   Found ${intersectionResult.rows.length} T-intersections between Big Bluestem and South Boulder Creek`);
    
    if (intersectionResult.rows.length > 0) {
      console.log('   ✅ T-intersection detection working correctly');
      intersectionResult.rows.forEach((row, i) => {
        console.log(`      ${i + 1}. Distance: ${(row.distance_meters * 111000).toFixed(0)}m, Point: ${row.intersection_point_text}`);
      });
    } else {
      console.log('   ❌ No T-intersections found');
    }

    // Test 2: Test enhanced Layer 1 trail splitting function
    console.log('\n📋 Test 2: Testing enhanced Layer 1 trail splitting function...');
    
    // Create a test staging schema
    const testSchema = `test_${Date.now()}`;
    console.log(`   Creating test schema: ${testSchema}`);
    
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    
    // Copy a subset of trails to test schema
    await client.query(`
      CREATE TABLE ${testSchema}.trails AS
      SELECT * FROM public.trails 
      WHERE name ILIKE '%Big Bluestem%' OR name ILIKE '%South Boulder Creek%'
      LIMIT 10
    `);
    
    const trailCountResult = await client.query(`SELECT COUNT(*) as count FROM ${testSchema}.trails`);
    console.log(`   Copied ${trailCountResult.rows[0].count} trails to test schema`);
    
    // Test the enhanced splitting function
    const splittingResult = await client.query(`
      SELECT enhanced_split_trails_at_intersections_layer1($1, 500.0, 1.0, 1.0) as total_segments
    `, [testSchema]);
    
    const totalSegments = parseInt(splittingResult.rows[0].total_segments);
    console.log(`   ✅ Enhanced splitting completed: ${totalSegments} segments created`);
    
    // Check if Big Bluestem was split
    const bigBluestemSegments = await client.query(`
      SELECT COUNT(*) as count FROM ${testSchema}.trails WHERE name ILIKE '%Big Bluestem%'
    `);
    console.log(`   Big Bluestem segments after splitting: ${bigBluestemSegments.rows[0].count}`);
    
    // Test 3: Test enhanced Layer 2 node generation function
    console.log('\n📋 Test 3: Testing enhanced Layer 2 node generation function...');
    
    // Create routing_nodes table in test schema
    await client.query(`
      CREATE TABLE ${testSchema}.routing_nodes (
        id SERIAL PRIMARY KEY,
        node_uuid UUID,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        elevation DOUBLE PRECISION,
        node_type TEXT,
        connected_trails TEXT[],
        trail_ids INTEGER[],
        created_at TIMESTAMP
      )
    `);
    
    // Test the enhanced node generation function
    const nodeResult = await client.query(`
      SELECT * FROM enhanced_generate_routing_nodes_layer2($1, 500.0, 1.0, 1.0)
    `, [testSchema]);
    
    const nodeCount = parseInt(nodeResult.rows[0].node_count);
    const success = nodeResult.rows[0].success;
    const message = nodeResult.rows[0].message;
    
    console.log(`   Node generation result: ${message}`);
    console.log(`   ✅ Generated ${nodeCount} nodes`);
    
    // Check node types
    const nodeTypesResult = await client.query(`
      SELECT node_type, COUNT(*) as count 
      FROM ${testSchema}.routing_nodes 
      GROUP BY node_type
    `);
    
    console.log('   Node type breakdown:');
    nodeTypesResult.rows.forEach(row => {
      console.log(`      ${row.node_type}: ${row.count} nodes`);
    });
    
    // Test 4: Check for T-intersection nodes specifically
    console.log('\n📋 Test 4: Checking for T-intersection nodes...');
    const tIntersectionNodes = await client.query(`
      SELECT id, lat, lng, connected_trails, trail_ids
      FROM ${testSchema}.routing_nodes 
      WHERE node_type = 't_intersection'
      AND (
        array_to_string(connected_trails, ',') ILIKE '%Big Bluestem%' OR
        array_to_string(connected_trails, ',') ILIKE '%South Boulder Creek%'
      )
    `);
    
    console.log(`   Found ${tIntersectionNodes.rows.length} T-intersection nodes involving Big Bluestem or South Boulder Creek`);
    
    if (tIntersectionNodes.rows.length > 0) {
      console.log('   ✅ T-intersection nodes created successfully');
      tIntersectionNodes.rows.forEach((row, i) => {
        console.log(`      ${i + 1}. Node ${row.id}: (${row.lat}, ${row.lng}) - ${row.connected_trails}`);
      });
    } else {
      console.log('   ❌ No T-intersection nodes found');
    }
    
    // Clean up test schema
    console.log('\n🧹 Cleaning up test schema...');
    await client.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    
    console.log('\n✅ Complete solution test finished');
    
  } catch (error) {
    console.error('❌ Error during complete solution test:', error);
  } finally {
    await client.end();
  }
}

testCompleteSolution();
