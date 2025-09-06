const { Client } = require('pg');

// Test data from the user's example
const foothillsNorthTrail = {
  name: "Foothills North Trail",
  app_uuid: "873d19f1-26df-4b91-91ee-d1139ff88683",
  coordinates: [
    [-105.282727593, 40.070455567, 1687.336791992],
    [-105.283430657, 40.070318704, 1687.121826172],
    [-105.283899475, 40.070254488, 1687.099975586],
    [-105.284392235, 40.070307338, 1687.581542969],
    [-105.284767464, 40.070297406, 1688.423217773],
    [-105.285294652, 40.070169973, 1691.094604492],
    [-105.285540957, 40.070178377, 1691.958129883],
    [-105.285658152, 40.070160069, 1692.993164062],
    [-105.286173462, 40.069996623, 1693.963989258],
    [-105.286700986, 40.069950269, 1696.985595703],
    [-105.287052908, 40.069976428, 1698.661499023],
    [-105.28747508, 40.06997538, 1699.495117188],
    [-105.287827153, 40.070037574, 1699.94909668],
    [-105.288976702, 40.07010679, 1705.932006836],
    [-105.289164332, 40.070106322, 1707.591918945],
    [-105.289656484, 40.070014995, 1710.877929688],
    [-105.290125639, 40.070031841, 1715.303955078],
    [-105.290336496, 40.069977254, 1715.358520508],
    [-105.290547543, 40.069967716, 1718.499755859],
    [-105.290652971, 40.069940422, 1721.354125977],
    [-105.290988133, 40.069969306, 1723.668579102],
    [-105.291177042, 40.069954216, 1726.449462891],
    [-105.291243129, 40.069970456, 1726.449462891],
    [-105.291421057, 40.069978588, 1726.752563477]
  ]
};

const northSkyTrail = {
  name: "North Sky Trail", 
  app_uuid: "ab36dded-56f4-4a1d-bd16-6781586a3336",
  coordinates: [
    [-105.291193821, 40.070110007, 1731.133178711],
    [-105.29122595, 40.070040755, 1726.449462891],
    [-105.291243129, 40.069970456, 1726.449462891],
    [-105.291266876, 40.069873291, 1727.728393555],
    [-105.291296544, 40.069653513, 1728.930541992],
    [-105.291315845, 40.069611252, 1729.321533203],
    [-105.291333853, 40.069598859, 1729.321533203],
    [-105.291371229, 40.06960322, 1729.321533203],
    [-105.291398126, 40.069624179, 1729.321533203],
    [-105.291394233, 40.069694656, 1728.997192383],
    [-105.291419156, 40.06977441, 1727.890380859],
    [-105.291427745, 40.069832987, 1727.890380859],
    [-105.291421057, 40.069978588, 0]
  ]
};

async function testSplittingIssue() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Create test trails in staging schema
    const createTrailsQuery = `
      DROP TABLE IF EXISTS staging.test_trails;
      CREATE TABLE staging.test_trails (
        app_uuid UUID PRIMARY KEY,
        name TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        is_valid BOOLEAN DEFAULT true,
        length_m DOUBLE PRECISION,
        is_simple BOOLEAN DEFAULT true,
        original_trail_uuid UUID
      );
    `;
    
    await client.query(createTrailsQuery);
    console.log('Created test_trails table');

    // Insert the test trails
    const foothillsGeom = `LINESTRINGZ(${foothillsNorthTrail.coordinates.map(c => `${c[0]} ${c[1]} ${c[2]}`).join(', ')})`;
    const northSkyGeom = `LINESTRINGZ(${northSkyTrail.coordinates.map(c => `${c[0]} ${c[1]} ${c[2]}`).join(', ')})`;

    await client.query(`
      INSERT INTO staging.test_trails (app_uuid, name, geometry, length_m) VALUES
      ($1, $2, ST_GeomFromText($3, 4326), ST_Length(ST_GeomFromText($3, 4326)::geography)),
      ($4, $5, ST_GeomFromText($6, 4326), ST_Length(ST_GeomFromText($6, 4326)::geography))
    `, [
      foothillsNorthTrail.app_uuid, foothillsNorthTrail.name, foothillsGeom,
      northSkyTrail.app_uuid, northSkyTrail.name, northSkyGeom
    ]);

    console.log('Inserted test trails');

    // Get the intersection geometry
    const intersectionQuery = `
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        t1.geometry as trail1_geom,
        t2.geometry as trail2_geom,
        ST_Force3D(ST_Intersection(t1.geometry, t2.geometry)) as intersection_geom,
        ST_GeometryType(ST_Force3D(ST_Intersection(t1.geometry, t2.geometry))) as intersection_type
      FROM staging.test_trails t1
      JOIN staging.test_trails t2 ON t1.app_uuid < t2.app_uuid
      WHERE ST_Intersects(t1.geometry, t2.geometry)
    `;

    const intersectionResult = await client.query(intersectionQuery);
    
    if (intersectionResult.rows.length === 0) {
      console.log('❌ No intersection found');
      return;
    }

    const intersection = intersectionResult.rows[0];
    console.log(`\n🔍 Found intersection: ${intersection.trail1_name} ↔ ${intersection.trail2_name}`);
    console.log(`   Intersection Type: ${intersection.intersection_type}`);
    console.log(`   Intersection WKT: ${(await client.query('SELECT ST_AsText($1)', [intersection.intersection_geom])).rows[0].st_astext}`);

    // Test different splitting approaches
    console.log('\n🔧 Testing different splitting approaches...');

    // Approach 1: Split with MultiPoint (current approach)
    console.log('\n1. Splitting with MultiPoint (current approach):');
    const splitWithMultiPointQuery = `
      SELECT 
        ST_GeometryType(ST_Split($1::geometry, $2::geometry)) as split_result_type,
        ST_NumGeometries(ST_Split($1::geometry, $2::geometry)) as split_result_count,
        (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment,
        (ST_Dump(ST_Split($1::geometry, $2::geometry))).path AS path
      FROM (
        SELECT $1::geometry as geom, $2::geometry as split_point
      ) t
    `;

    const splitWithMultiPointResult = await client.query(splitWithMultiPointQuery, [intersection.trail1_geom, intersection.intersection_geom]);
    console.log(`   Trail 1 split result type: ${splitWithMultiPointResult.rows[0].split_result_type}`);
    console.log(`   Trail 1 split result count: ${splitWithMultiPointResult.rows[0].split_result_count}`);
    console.log(`   Trail 1 segments created: ${splitWithMultiPointResult.rows.length}`);

    // Approach 2: Split with individual points from MultiPoint
    console.log('\n2. Splitting with individual points from MultiPoint:');
    const individualPointsQuery = `
      SELECT 
        (ST_Dump($1::geometry)).geom as point_geom,
        (ST_Dump($1::geometry)).path as point_path
      FROM (
        SELECT $1::geometry as intersection_geom
      ) t
    `;

    const individualPointsResult = await client.query(individualPointsQuery, [intersection.intersection_geom]);
    console.log(`   Found ${individualPointsResult.rows.length} individual intersection points`);

    for (const pointRow of individualPointsResult.rows) {
      console.log(`   Point ${pointRow.point_path}: ${(await client.query('SELECT ST_AsText($1)', [pointRow.point_geom])).rows[0].st_astext}`);
      
      // Try splitting with this individual point
      const splitWithPointQuery = `
        SELECT 
          ST_GeometryType(ST_Split($1::geometry, $2::geometry)) as split_result_type,
          ST_NumGeometries(ST_Split($1::geometry, $2::geometry)) as split_result_count,
          (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment,
          (ST_Dump(ST_Split($1::geometry, $2::geometry))).path AS path
        FROM (
          SELECT $1::geometry as geom, $2::geometry as split_point
        ) t
      `;

      const splitWithPointResult = await client.query(splitWithPointQuery, [intersection.trail1_geom, pointRow.point_geom]);
      console.log(`     Trail 1 split with point ${pointRow.point_path}: ${splitWithPointResult.rows.length} segments`);
    }

    // Approach 3: Use ST_Node (PostGIS function for splitting at intersections)
    console.log('\n3. Using ST_Node (PostGIS function):');
    const nodeQuery = `
      SELECT 
        ST_GeometryType(ST_Node($1::geometry)) as node_result_type,
        ST_NumGeometries(ST_Node($1::geometry)) as node_result_count,
        (ST_Dump(ST_Node($1::geometry))).geom AS segment,
        (ST_Dump(ST_Node($1::geometry))).path AS path
      FROM (
        SELECT $1::geometry as geom
      ) t
    `;

    const nodeResult = await client.query(nodeQuery, [intersection.trail1_geom]);
    console.log(`   Trail 1 node result type: ${nodeResult.rows[0].node_result_type}`);
    console.log(`   Trail 1 node result count: ${nodeResult.rows[0].node_result_count}`);
    console.log(`   Trail 1 segments created: ${nodeResult.rows.length}`);

    // Approach 4: Manual splitting at specific coordinates
    console.log('\n4. Manual splitting at specific coordinates:');
    const manualSplitQuery = `
      SELECT 
        ST_GeometryType(ST_Split($1::geometry, ST_GeomFromText('POINT(-105.291243129 40.069970456)', 4326))) as split_result_type,
        ST_NumGeometries(ST_Split($1::geometry, ST_GeomFromText('POINT(-105.291243129 40.069970456)', 4326))) as split_result_count,
        (ST_Dump(ST_Split($1::geometry, ST_GeomFromText('POINT(-105.291243129 40.069970456)', 4326)))).geom AS segment,
        (ST_Dump(ST_Split($1::geometry, ST_GeomFromText('POINT(-105.291243129 40.069970456)', 4326)))).path AS path
      FROM (
        SELECT $1::geometry as geom
      ) t
    `;

    const manualSplitResult = await client.query(manualSplitQuery, [intersection.trail1_geom]);
    console.log(`   Trail 1 manual split result type: ${manualSplitResult.rows[0].split_result_type}`);
    console.log(`   Trail 1 manual split result count: ${manualSplitResult.rows[0].split_result_count}`);
    console.log(`   Trail 1 segments created: ${manualSplitResult.rows.length}`);

    // Clean up
    await client.query('DROP TABLE IF EXISTS staging.test_trails');
    console.log('\nCleaned up test data');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

testSplittingIssue();
