const { Pool } = require('pg');

async function testEnchantedKohlerPublic() {
  const pgClient = new Pool({
    host: 'localhost',
    user: 'shaydu',
    password: '',
    database: 'trail_master_db'
  });

  try {
    console.log('🔍 Testing Enchanted Mesa/Kohler Spur pair detection in public.trails...');

    // Test the exact same query as PublicTrailIntersectionSplittingService
    const pairsResult = await pgClient.query(`
      WITH trail_pairs AS (
        SELECT DISTINCT
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t2.geometry as trail2_geom
        FROM public.trails t1
        CROSS JOIN public.trails t2
        WHERE t1.app_uuid < t2.app_uuid  -- Avoid duplicate pairs
          AND ST_DWithin(t1.geometry, t2.geometry, 0.00002)  -- Within ~2m
          AND NOT ST_Intersects(t1.geometry, t2.geometry)  -- Don't already intersect
      )
      SELECT 
        trail1_name, 
        trail2_name, 
        ST_Distance(trail1_geom, trail2_geom) as distance_degrees,
        ST_Distance(trail1_geom::geography, trail2_geom::geography) as distance_meters
      FROM trail_pairs
      ORDER BY distance_meters
      LIMIT 100
    `);

    console.log(`🔍 Found ${pairsResult.rows.length} pairs in public.trails:`);
    
    // Look for Enchanted Mesa/Kohler Spur pair
    let foundPair = null;
    pairsResult.rows.forEach((pair, index) => {
      if (index < 20) {
        console.log(`   ${index + 1}. ${pair.trail1_name} <-> ${pair.trail2_name} (${pair.distance_meters.toFixed(2)}m)`);
      }
      
      if ((pair.trail1_name === 'Enchanted Mesa Trail' && pair.trail2_name === 'Enchanted-Kohler Spur Trail') ||
          (pair.trail1_name === 'Enchanted-Kohler Spur Trail' && pair.trail2_name === 'Enchanted Mesa Trail')) {
        foundPair = pair;
      }
    });

    if (foundPair) {
      console.log(`\n✅ Found Enchanted Mesa/Kohler Spur pair:`);
      console.log(`   Distance: ${foundPair.distance_degrees} degrees (${foundPair.distance_meters.toFixed(2)}m)`);
    } else {
      console.log(`\n❌ Enchanted Mesa/Kohler Spur pair NOT found in top ${pairsResult.rows.length} pairs`);
      
      // Check specifically for this pair
      const specificPairResult = await pgClient.query(`
        SELECT 
          t1.name as trail1_name,
          t2.name as trail2_name,
          ST_Distance(t1.geometry, t2.geometry) as distance_degrees,
          ST_Distance(t1.geometry::geography, t2.geometry::geography) as distance_meters,
          ST_DWithin(t1.geometry, t2.geometry, 0.00002) as within_2m,
          ST_Intersects(t1.geometry, t2.geometry) as intersects
        FROM public.trails t1
        CROSS JOIN public.trails t2
        WHERE t1.name = 'Enchanted Mesa Trail' 
          AND t2.name = 'Enchanted-Kohler Spur Trail'
      `);

      if (specificPairResult.rows.length > 0) {
        const pair = specificPairResult.rows[0];
        console.log(`\n🔍 Enchanted Mesa <-> Kohler Spur in public.trails:`);
        console.log(`   Distance: ${pair.distance_degrees} degrees (${pair.distance_meters.toFixed(2)}m)`);
        console.log(`   Within 2m: ${pair.within_2m}`);
        console.log(`   Intersects: ${pair.intersects}`);
      } else {
        console.log('\n❌ Enchanted Mesa/Kohler Spur pair not found in public.trails');
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testEnchantedKohlerPublic();
