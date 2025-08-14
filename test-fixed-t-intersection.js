const { Client } = require('pg');

async function testFixedTIntersection() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('🔍 Testing Fixed T-Intersection Detection...\n');

    // Test with a reasonable tolerance (500 meters to catch the 372m distance)
    const tolerance = 500; // meters
    
    console.log(`📏 Using tolerance: ${tolerance}m\n`);

    // Test the fixed detect_trail_intersections function
    console.log('🔧 Testing Fixed detect_trail_intersections function...');
    const result = await client.query(`
      SELECT 
        node_type,
        connected_trail_names,
        distance_meters,
        ST_AsText(intersection_point) as intersection_point_text
      FROM detect_trail_intersections('public', 'trails', $1)
      WHERE array_to_string(connected_trail_names, ',') ILIKE '%Big Bluestem%' 
         OR array_to_string(connected_trail_names, ',') ILIKE '%South Boulder Creek%'
      ORDER BY distance_meters
    `, [tolerance / 111000.0]); // Convert meters to degrees

    console.log(`📊 Found ${result.rows.length} intersections involving Big Bluestem or South Boulder Creek trails`);
    
    result.rows.forEach((row, i) => {
      console.log(`\n   Intersection ${i + 1}:`);
      console.log(`     Type: ${row.node_type}`);
      console.log(`     Trails: ${row.connected_trail_names}`);
      console.log(`     Distance: ${row.distance_meters ? (row.distance_meters * 111000).toFixed(0) + 'm' : '0m'}`);
      console.log(`     Point: ${row.intersection_point_text}`);
    });

    // Check if we found the specific T-intersection
    const tIntersectionFound = result.rows.some(row => 
      row.node_type === 't_intersection' &&
      row.connected_trail_names.some(name => name.includes('Big Bluestem')) &&
      row.connected_trail_names.some(name => name.includes('South Boulder Creek'))
    );

    if (tIntersectionFound) {
      console.log('\n✅ SUCCESS: T-intersection between Big Bluestem and South Boulder Creek detected!');
    } else {
      console.log('\n❌ FAILED: T-intersection between Big Bluestem and South Boulder Creek NOT detected');
    }

    // Also test with a staging schema to see if it works in the export flow
    console.log('\n🔍 Testing with staging schema (simulating export flow)...');
    
    // Check if there are any recent staging schemas
    const stagingSchemasResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%'
      ORDER BY schema_name DESC
      LIMIT 1
    `);

    if (stagingSchemasResult.rows.length > 0) {
      const stagingSchema = stagingSchemasResult.rows[0].schema_name;
      console.log(`   Using staging schema: ${stagingSchema}`);
      
      const stagingResult = await client.query(`
        SELECT 
          node_type,
          connected_trail_names,
          distance_meters,
          ST_AsText(intersection_point) as intersection_point_text
        FROM detect_trail_intersections($1, 'trails', $2)
        WHERE array_to_string(connected_trail_names, ',') ILIKE '%Big Bluestem%' 
           OR array_to_string(connected_trail_names, ',') ILIKE '%South Boulder Creek%'
        ORDER BY distance_meters
      `, [stagingSchema, tolerance / 111000.0]);

      console.log(`   📊 Found ${stagingResult.rows.length} intersections in staging schema`);
      
      stagingResult.rows.forEach((row, i) => {
        console.log(`\n     Staging Intersection ${i + 1}:`);
        console.log(`       Type: ${row.node_type}`);
        console.log(`       Trails: ${row.connected_trail_names}`);
        console.log(`       Distance: ${row.distance_meters ? (row.distance_meters * 111000).toFixed(0) + 'm' : '0m'}`);
      });
    } else {
      console.log('   No staging schemas found for testing');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

testFixedTIntersection();
