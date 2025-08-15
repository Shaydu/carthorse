const { Pool } = require('pg');

async function testEnchantedIntersection() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || ''
  });

  try {
    console.log('🔍 Testing Enchanted Mesa Trail and Enchanted-Kohler Spur Trail intersection...');
    
    // Use the most recent staging schema
    const stagingSchema = 'carthorse_1755206771085';
    console.log(`📊 Using staging schema: ${stagingSchema}`);
    
    // Get the trails
    const trailsResult = await pool.query(`
      SELECT 
        app_uuid,
        name,
        ST_StartPoint(geometry) as start_point,
        ST_EndPoint(geometry) as end_point,
        geometry as trail_geometry
      FROM ${stagingSchema}.trails 
      WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
      AND ST_IsValid(geometry) AND ST_GeometryType(geometry) = 'ST_LineString'
    `);

    if (trailsResult.rowCount < 2) {
      console.log('❌ Could not find both trails');
      return;
    }

    const enchantedMesa = trailsResult.rows.find(t => t.name === 'Enchanted Mesa Trail');
    const kohlerSpur = trailsResult.rows.find(t => t.name === 'Enchanted-Kohler Spur Trail');

    console.log(`\n📍 Enchanted Mesa Trail:`);
    console.log(`   Start: ${enchantedMesa.start_point}`);
    console.log(`   End: ${enchantedMesa.end_point}`);
    
    console.log(`\n📍 Enchanted-Kohler Spur Trail:`);
    console.log(`   Start: ${kohlerSpur.start_point}`);
    console.log(`   End: ${kohlerSpur.end_point}`);

    // Check distances between endpoints and trails
    const distancesResult = await pool.query(`
      SELECT 
        'Kohler Spur end to Mesa Trail' as test_case,
        ST_Distance(
          (SELECT ST_EndPoint(geometry) FROM ${stagingSchema}.trails WHERE name = 'Enchanted-Kohler Spur Trail'),
          (SELECT geometry FROM ${stagingSchema}.trails WHERE name = 'Enchanted Mesa Trail')
        ) as distance_meters,
        ST_ClosestPoint(
          (SELECT geometry FROM ${stagingSchema}.trails WHERE name = 'Enchanted Mesa Trail'),
          (SELECT ST_EndPoint(geometry) FROM ${stagingSchema}.trails WHERE name = 'Enchanted-Kohler Spur Trail')
        ) as closest_point
      
      UNION ALL
      
      SELECT 
        'Mesa Trail end to Kohler Spur' as test_case,
        ST_Distance(
          (SELECT ST_EndPoint(geometry) FROM ${stagingSchema}.trails WHERE name = 'Enchanted Mesa Trail'),
          (SELECT geometry FROM ${stagingSchema}.trails WHERE name = 'Enchanted-Kohler Spur Trail')
        ) as distance_meters,
        ST_ClosestPoint(
          (SELECT geometry FROM ${stagingSchema}.trails WHERE name = 'Enchanted-Kohler Spur Trail'),
          (SELECT ST_EndPoint(geometry) FROM ${stagingSchema}.trails WHERE name = 'Enchanted Mesa Trail')
        ) as closest_point
    `);

    console.log('\n📏 Distance Analysis:');
    for (const row of distancesResult.rows) {
      console.log(`   ${row.test_case}: ${row.distance_meters.toFixed(3)}m`);
      console.log(`   Closest point: ${row.closest_point}`);
    }

    // Check if this would be detected by our T-intersection query
    const tIntersectionResult = await pool.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid,
          name,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          geometry as trail_geometry
        FROM ${stagingSchema}.trails
        WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
        AND ST_IsValid(geometry) AND ST_GeometryType(geometry) = 'ST_LineString'
      )
      SELECT 
        e1.name as endpoint_trail_name,
        e1.end_point as endpoint_point,
        'end' as endpoint_type,
        e2.name as target_trail_name,
        ST_Distance(e1.end_point::geography, e2.trail_geometry::geography) as distance_meters,
        ST_ClosestPoint(e2.trail_geometry, e1.end_point) as closest_point_on_target
      FROM trail_endpoints e1
      JOIN trail_endpoints e2 ON e1.app_uuid != e2.app_uuid
      WHERE ST_DWithin(e1.end_point::geography, e2.trail_geometry::geography, 3.0)
        AND ST_Distance(e1.end_point::geography, e2.trail_geometry::geography) > 0
        AND ST_Distance(e1.end_point::geography, e2.trail_geometry::geography) <= 3.0
    `);

    console.log('\n🔍 T-Intersection Detection Results:');
    if (tIntersectionResult.rowCount > 0) {
      for (const row of tIntersectionResult.rows) {
        console.log(`   ✅ FOUND: "${row.endpoint_trail_name}" end → "${row.target_trail_name}" (${row.distance_meters.toFixed(3)}m)`);
        console.log(`   📍 Closest point: ${row.closest_point_on_target}`);
      }
    } else {
      console.log('   ❌ NOT FOUND: No T-intersection detected between these trails');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

testEnchantedIntersection();

