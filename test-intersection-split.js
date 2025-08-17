const { Client } = require('pg');

async function testIntersectionSplit() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: 'carthorse'
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    const schema = 'carthorse_1755382803764';
    const node99Point = 'POINT(-105.282386772 39.988580539)';
    
    console.log('\n🔍 Testing intersection detection at node 99 coordinate...');
    
    // Check what trails intersect at this point
    const intersectingTrails = await client.query(`
      SELECT old_id, name, ST_Distance(ST_GeomFromText($1, 4326), the_geom) as distance_m
      FROM ${schema}.ways_noded 
      WHERE ST_DWithin(ST_GeomFromText($1, 4326), the_geom, 0.01)
      ORDER BY distance_m
    `, [node99Point]);
    
    console.log(`\n📊 Trails near node 99 (within 10m):`);
    intersectingTrails.rows.forEach(row => {
      console.log(`   ${row.name} (ID: ${row.old_id}): ${row.distance_m.toFixed(6)}m`);
    });

    // Check if trails actually intersect geometrically
    console.log('\n🔗 Checking geometric intersections...');
    const geometricIntersections = await client.query(`
      WITH nearby_trails AS (
        SELECT old_id, name, the_geom
        FROM ${schema}.ways_noded 
        WHERE ST_DWithin(ST_GeomFromText($1, 4326), the_geom, 0.01)
      )
      SELECT 
        t1.old_id as trail1_id,
        t1.name as trail1_name,
        t2.old_id as trail2_id,
        t2.name as trail2_name,
        ST_Intersects(t1.the_geom, t2.the_geom) as intersects,
        ST_Crosses(t1.the_geom, t2.the_geom) as crosses,
        ST_Touches(t1.the_geom, t2.the_geom) as touches,
        ST_Distance(t1.the_geom, t2.the_geom) as distance_m
      FROM nearby_trails t1
      JOIN nearby_trails t2 ON t1.old_id < t2.old_id
      WHERE ST_DWithin(t1.the_geom, t2.the_geom, 0.01)
      ORDER BY distance_m
    `, [node99Point]);

    console.log(`\n📊 Geometric intersection analysis:`);
    geometricIntersections.rows.forEach(row => {
      console.log(`   ${row.trail1_name} ↔ ${row.trail2_name}:`);
      console.log(`     Distance: ${row.distance_m.toFixed(6)}m`);
      console.log(`     Intersects: ${row.intersects}`);
      console.log(`     Crosses: ${row.crosses}`);
      console.log(`     Touches: ${row.touches}`);
    });

    // Test ST_Node on the nearby trails
    console.log('\n🔧 Testing ST_Node on nearby trails...');
    const nodeTest = await client.query(`
      WITH nearby_trails AS (
        SELECT the_geom
        FROM ${schema}.ways_noded 
        WHERE ST_DWithin(ST_GeomFromText($1, 4326), the_geom, 0.01)
        LIMIT 5
      )
      SELECT 
        ST_NumGeometries(ST_Node(ST_Collect(the_geom))) as num_geometries_after_node,
        COUNT(*) as num_trails_before_node
      FROM nearby_trails
    `, [node99Point]);

    console.log(`\n📊 ST_Node test results:`);
    console.log(`   Trails before ST_Node: ${nodeTest.rows[0].num_trails_before_node}`);
    console.log(`   Geometries after ST_Node: ${nodeTest.rows[0].num_geometries_after_node}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

testIntersectionSplit();
