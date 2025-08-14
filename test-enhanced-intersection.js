const { Client } = require('pg');

async function testEnhancedIntersection() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('🔍 Testing Enhanced T-Intersection Detection...\n');

    // Test with a larger tolerance to catch more T-intersections
    const tolerance = 0.001; // ~100 meters in degrees
    
    console.log(`📏 Using tolerance: ${tolerance} degrees (~${(tolerance * 111000).toFixed(0)}m)\n`);

    // Test the enhanced function
    console.log('🔍 Testing ENHANCED detect_trail_intersections_enhanced function...');
    const enhancedResult = await client.query(`
      SELECT 
        node_type,
        COUNT(*) as count,
        AVG(distance_meters::float) as avg_distance,
        MIN(distance_meters::float) as min_distance,
        MAX(distance_meters::float) as max_distance
      FROM detect_trail_intersections_enhanced('public', 'trails', $1)
      GROUP BY node_type
      ORDER BY node_type
    `, [tolerance]);

    console.log('Enhanced function results:');
    enhancedResult.rows.forEach(row => {
      console.log(`   ${row.node_type}: ${row.count} intersections (avg: ${row.avg_distance?.toFixed(2)}m, range: ${row.min_distance?.toFixed(2)}-${row.max_distance?.toFixed(2)}m)`);
    });

    // Test specific Big Bluestem and South Boulder Creek trails
    console.log('\n🔍 Testing specific trail pairs with enhanced function...');
    const specificResult = await client.query(`
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        node_type,
        distance_meters::float as distance_meters,
        ST_AsText(intersection_point) as intersection_location
      FROM detect_trail_intersections_enhanced('public', 'trails', $1) ip
      JOIN public.trails t1 ON t1.id = ip.connected_trail_ids[1]
      JOIN public.trails t2 ON t2.id = ip.connected_trail_ids[2]
      WHERE (t1.name ILIKE '%Big Bluestem%' AND t2.name ILIKE '%South Boulder Creek%')
         OR (t1.name ILIKE '%South Boulder Creek%' AND t2.name ILIKE '%Big Bluestem%')
      ORDER BY distance_meters
      LIMIT 10
    `, [tolerance]);

    console.log(`Found ${specificResult.rows.length} intersections between Big Bluestem and South Boulder Creek trails:`);
    specificResult.rows.forEach((row, i) => {
      console.log(`\n${i + 1}. ${row.trail1_name} ↔ ${row.trail2_name}`);
      console.log(`   Type: ${row.node_type}`);
      console.log(`   Distance: ${row.distance_meters.toFixed(2)}m`);
      console.log(`   Location: ${row.intersection_location}`);
    });

    // Manual T-intersection detection for comparison
    console.log('\n🔍 Manual T-intersection detection for comparison...');
    const manualResult = await client.query(`
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_Distance(ST_EndPoint(t1.geometry), t2.geometry) as distance_meters,
        ST_AsText(ST_EndPoint(t1.geometry)) as endpoint_location
      FROM public.trails t1
      JOIN public.trails t2 ON t1.id < t2.id
      WHERE (t1.name ILIKE '%Big Bluestem%' AND t2.name ILIKE '%South Boulder Creek%')
         OR (t1.name ILIKE '%South Boulder Creek%' AND t2.name ILIKE '%Big Bluestem%')
        AND ST_DWithin(ST_EndPoint(t1.geometry), t2.geometry, $1)
        AND NOT ST_Intersects(t1.geometry, t2.geometry)
      ORDER BY distance_meters
      LIMIT 5
    `, [tolerance]);

    console.log(`Manual detection found ${manualResult.rows.length} potential T-intersections:`);
    manualResult.rows.forEach((row, i) => {
      console.log(`\n${i + 1}. ${row.trail1_name} endpoint near ${row.trail2_name}`);
      console.log(`   Distance: ${row.distance_meters.toFixed(2)}m`);
      console.log(`   Endpoint: ${row.endpoint_location}`);
    });

    // Summary
    console.log('\n📊 SUMMARY:');
    const tIntersections = enhancedResult.rows.find(row => row.node_type === 't_intersection');
    
    if (tIntersections) {
      console.log(`   T-Intersections detected: ${tIntersections.count}`);
      console.log(`   Average distance: ${tIntersections.avg_distance.toFixed(2)}m`);
      console.log(`   Distance range: ${tIntersections.min_distance.toFixed(2)}-${tIntersections.max_distance.toFixed(2)}m`);
    } else {
      console.log('   No T-intersections detected with current tolerance');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

testEnhancedIntersection();
