const { Pool } = require('pg');

async function debugEnchantedMesa() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'carthorse',
    password: '',
    database: 'trail_master_db'
  });

  try {
    console.log('🔍 Debugging Enchanted Mesa Trail splitting...\n');

    // First, find the correct staging schema
    const schemasResult = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_boulder_%'
      ORDER BY schema_name DESC
      LIMIT 5
    `);

    console.log('📋 Available staging schemas:');
    schemasResult.rows.forEach(schema => {
      console.log(`   - ${schema.schema_name}`);
    });

    if (schemasResult.rows.length === 0) {
      console.log('❌ No staging schemas found');
      return;
    }

    const stagingSchema = schemasResult.rows[0].schema_name;
    console.log(`\n🎯 Using staging schema: ${stagingSchema}\n`);

    // Check all Enchanted trails
    const trailsResult = await pool.query(`
      SELECT 
        app_uuid, 
        name, 
        ST_Length(geometry::geography) as length_meters,
        ST_NumPoints(geometry) as num_points,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${stagingSchema}.trails 
      WHERE name LIKE '%Enchanted%' 
      ORDER BY name, length_meters DESC
    `);

    console.log('📊 Enchanted trails found:');
    trailsResult.rows.forEach(trail => {
      console.log(`   - ${trail.name}: ${trail.length_meters.toFixed(1)}m, ${trail.num_points} points`);
      console.log(`     Start: ${trail.start_point}`);
      console.log(`     End: ${trail.end_point}`);
    });

    // Check for intersections between Enchanted trails
    console.log('\n🔗 Checking intersections between Enchanted trails:');
    const intersectionsResult = await pool.query(`
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_Distance(t1.geometry::geography, t2.geometry::geography) as distance_meters,
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_point
      FROM ${stagingSchema}.trails t1
      JOIN ${stagingSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
      WHERE t1.name LIKE '%Enchanted%' 
        AND t2.name LIKE '%Enchanted%'
        AND ST_DWithin(t1.geometry::geography, t2.geometry::geography, 10)
      ORDER BY distance_meters ASC
    `);

    if (intersectionsResult.rows.length > 0) {
      intersectionsResult.rows.forEach(intersection => {
        console.log(`   - ${intersection.trail1_name} ↔ ${intersection.trail2_name}: ${intersection.distance_meters.toFixed(3)}m`);
        if (intersection.intersection_point) {
          console.log(`     Intersection: ${intersection.intersection_point}`);
        }
      });
    } else {
      console.log('   - No intersections found between Enchanted trails');
    }

    // Check intersection_points table
    console.log('\n📍 Checking intersection_points table:');
    const intersectionPointsResult = await pool.query(`
      SELECT 
        connected_trail_names,
        node_type,
        distance_meters,
        ST_AsText(intersection_point) as intersection_point
      FROM ${stagingSchema}.intersection_points 
      WHERE array_to_string(connected_trail_names, ',') LIKE '%Enchanted%'
      ORDER BY distance_meters ASC
    `);

    if (intersectionPointsResult.rows.length > 0) {
      intersectionPointsResult.rows.forEach(point => {
        console.log(`   - ${point.connected_trail_names.join(' ↔ ')}: ${point.node_type}, ${point.distance_meters.toFixed(3)}m`);
        console.log(`     Point: ${point.intersection_point}`);
      });
    } else {
      console.log('   - No intersection points found for Enchanted trails');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

debugEnchantedMesa();
