const { Pool } = require('pg');

async function debugPairDetection() {
  const pgClient = new Pool({
    host: 'localhost',
    user: 'shaydu',
    password: '',
    database: 'trail_master_db'
  });

  try {
    // Find the staging schema
    const schemaResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schema found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📁 Using staging schema: ${stagingSchema}`);

    // Test the exact same query as IntersectionSplittingService
    const pairsResult = await pgClient.query(`
      WITH trail_pairs AS (
        SELECT DISTINCT
          t1.id as trail1_id,
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.id as trail2_id,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t2.geometry as trail2_geom
        FROM ${stagingSchema}.trails t1
        CROSS JOIN ${stagingSchema}.trails t2
        WHERE t1.id < t2.id  -- Avoid duplicate pairs
          AND ST_DWithin(t1.geometry, t2.geometry, 0.00002)  -- Within ~2m
          -- AND NOT ST_Intersects(t1.geometry, t2.geometry)  -- Temporarily disabled
      )
      SELECT 
        trail1_name, 
        trail2_name, 
        ST_Distance(trail1_geom, trail2_geom) as distance_degrees,
        ST_Distance(trail1_geom::geography, trail2_geom::geography) as distance_meters
      FROM trail_pairs
      ORDER BY distance_meters
      LIMIT 20
    `);

    console.log(`🔍 Found ${pairsResult.rows.length} pairs:`);
    pairsResult.rows.forEach((pair, index) => {
      console.log(`   ${index + 1}. ${pair.trail1_name} <-> ${pair.trail2_name} (${pair.distance_meters.toFixed(2)}m)`);
    });

    // Check specifically for Enchanted Mesa and Kohler Spur
    const specificPairResult = await pgClient.query(`
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_Distance(t1.geometry, t2.geometry) as distance_degrees,
        ST_Distance(t1.geometry::geography, t2.geometry::geography) as distance_meters,
        ST_DWithin(t1.geometry, t2.geometry, 0.00002) as within_2m,
        ST_Intersects(t1.geometry, t2.geometry) as intersects
      FROM ${stagingSchema}.trails t1
      CROSS JOIN ${stagingSchema}.trails t2
      WHERE t1.name = 'Enchanted Mesa Trail' 
        AND t2.name = 'Enchanted-Kohler Spur Trail'
    `);

    if (specificPairResult.rows.length > 0) {
      const pair = specificPairResult.rows[0];
      console.log(`\n🔍 Enchanted Mesa <-> Kohler Spur:`);
      console.log(`   Distance: ${pair.distance_degrees} degrees (${pair.distance_meters.toFixed(2)}m)`);
      console.log(`   Within 2m: ${pair.within_2m}`);
      console.log(`   Intersects: ${pair.intersects}`);
    } else {
      console.log('\n❌ Enchanted Mesa <-> Kohler Spur pair not found');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

debugPairDetection();
