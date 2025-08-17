const { Pool } = require('pg');

async function debugEnchantedKohlerPair() {
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

    // Step 1: Check if the pair is found by ST_DWithin
    console.log('\n🔍 Step 1: Checking ST_DWithin detection...');
    const dwithinResult = await pgClient.query(`
      SELECT 
        t1.id as trail1_id,
        t1.name as trail1_name,
        t2.id as trail2_id,
        t2.name as trail2_name,
        ST_Distance(t1.geometry, t2.geometry) as distance,
        ST_DWithin(t1.geometry, t2.geometry, 0.000005) as within_5cm,
        ST_Intersects(t1.geometry, t2.geometry) as already_intersects
      FROM ${stagingSchema}.trails t1
      CROSS JOIN ${stagingSchema}.trails t2
      WHERE t1.name = 'Enchanted Mesa Trail' 
        AND t2.name = 'Enchanted-Kohler Spur Trail'
    `);

    if (dwithinResult.rows.length === 0) {
      console.log('❌ Pair not found in staging schema');
      return;
    }

    const pair = dwithinResult.rows[0];
    console.log(`   Distance: ${pair.distance}`);
    console.log(`   Within 5cm: ${pair.within_5cm}`);
    console.log(`   Already intersects: ${pair.already_intersects}`);

    if (!pair.within_5cm) {
      console.log('❌ Pair not within 5cm threshold');
      return;
    }

    if (pair.already_intersects) {
      console.log('❌ Pair already intersects (excluded by NOT ST_Intersects)');
      return;
    }

    // Step 2: Test the rounding logic
    console.log('\n🔍 Step 2: Testing rounding logic...');
    const roundedResult = await pgClient.query(`
      WITH rounded_trails AS (
        SELECT 
          ST_GeomFromText(
            'LINESTRING(' || 
            string_agg(
              ROUND(ST_X(pt1)::numeric, 6) || ' ' || ROUND(ST_Y(pt1)::numeric, 6),
              ',' ORDER BY ST_LineLocatePoint(ST_Force2D($1::geometry), pt1)
            ) || 
            ')'
          ) as trail1_rounded,
          ST_GeomFromText(
            'LINESTRING(' || 
            string_agg(
              ROUND(ST_X(pt2)::numeric, 6) || ' ' || ROUND(ST_Y(pt2)::numeric, 6),
              ',' ORDER BY ST_LineLocatePoint(ST_Force2D($2::geometry), pt2)
            ) || 
            ')'
          ) as trail2_rounded
        FROM 
          (SELECT (ST_DumpPoints(ST_Force2D($1::geometry))).geom AS pt1) as points1,
          (SELECT (ST_DumpPoints(ST_Force2D($2::geometry))).geom AS pt2) as points2
      )
      SELECT 
        trail1_rounded, 
        trail2_rounded,
        ST_Distance(trail1_rounded, trail2_rounded) as rounded_distance
      FROM rounded_trails
    `, [pair.trail1_geom, pair.trail2_geom]);

    if (roundedResult.rows.length === 0) {
      console.log('❌ Rounding failed');
      return;
    }

    console.log(`   Rounded distance: ${roundedResult.rows[0].rounded_distance}`);

    // Step 3: Test snapping
    console.log('\n🔍 Step 3: Testing snapping...');
    const snappedResult = await pgClient.query(`
      SELECT 
        ST_Snap($1::geometry, $2::geometry, 1e-6) AS trail1_snapped,
        ST_Snap($2::geometry, $1::geometry, 1e-6) AS trail2_snapped,
        ST_Distance(
          ST_Snap($1::geometry, $2::geometry, 1e-6),
          ST_Snap($2::geometry, $1::geometry, 1e-6)
        ) as snapped_distance
    `, [roundedResult.rows[0].trail1_rounded, roundedResult.rows[0].trail2_rounded]);

    console.log(`   Snapped distance: ${snappedResult.rows[0].snapped_distance}`);

    // Step 4: Test intersection
    console.log('\n🔍 Step 4: Testing intersection...');
    const intersectionResult = await pgClient.query(`
      SELECT 
        (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt,
        ST_GeometryType((ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom) as geom_type
    `, [snappedResult.rows[0].trail1_snapped, snappedResult.rows[0].trail2_snapped]);

    console.log(`   Intersection count: ${intersectionResult.rows.length}`);
    if (intersectionResult.rows.length > 0) {
      console.log(`   Intersection type: ${intersectionResult.rows[0].geom_type}`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

debugEnchantedKohlerPair();
