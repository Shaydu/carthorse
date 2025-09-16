const { Client } = require('pg');

// Test trail geometries from the user's data
const northSkyTrail = {
  "type": "Feature",
  "properties": {
    "id": "ab36dded-56f4-4a1d-bd16-6781586a3336",
    "name": "North Sky Trail",
    "length_meters": 106.28836983903227,
    "distance_to_bbox": 0,
    "trail_category": "north_sky",
    "color": "#FF0000"
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
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
      [-105.291421057, 40.069978588, 1726.752563477]
    ]
  }
};

const foothillsNorthTrail = {
  "type": "Feature",
  "properties": {
    "id": "c55c0383-f02c-4761-aebe-26098441802d",
    "name": "Foothills North Trail",
    "length_meters": 833.6713479390932,
    "distance_to_bbox": 0,
    "trail_category": "foothills_north",
    "color": "#00FF00"
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
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
      [-105.291421057, 40.069978588, 1726.752563477],
      [-105.29149735, 40.069947311, 1727.308837891],
      [-105.291532339, 40.069902174, 1727.308837891],
      [-105.291624656, 40.069550564, 1734.462280273],
      [-105.291612545, 40.069460498, 1735.524536133],
      [-105.291670757, 40.069361246, 1738.508422852]
    ]
  }
};

async function analyzeTrailIntersections() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'carthorse_test',
    user: 'postgres',
    password: 'postgres'
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Create a temporary table for testing
    await client.query(`
      DROP TABLE IF EXISTS test_trails;
      CREATE TABLE test_trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT,
        name TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        length_meters DOUBLE PRECISION
      )
    `);

    // Insert the test trails
    await client.query(`
      INSERT INTO test_trails (app_uuid, name, geometry, length_meters)
      VALUES 
        ($1, $2, ST_GeomFromGeoJSON($3), $4),
        ($5, $6, ST_GeomFromGeoJSON($7), $8)
    `, [
      northSkyTrail.properties.id,
      northSkyTrail.properties.name,
      JSON.stringify(northSkyTrail.geometry),
      northSkyTrail.properties.length_meters,
      foothillsNorthTrail.properties.id,
      foothillsNorthTrail.properties.name,
      JSON.stringify(foothillsNorthTrail.geometry),
      foothillsNorthTrail.properties.length_meters
    ]);

    console.log('Inserted test trails');

    // Analyze the trails
    console.log('\n=== TRAIL ANALYSIS ===');
    
    // Check basic properties
    const trailInfo = await client.query(`
      SELECT 
        id, app_uuid, name, length_meters,
        ST_Length(geometry::geography) as length_geography,
        ST_IsValid(geometry) as is_valid,
        ST_GeometryType(geometry) as geometry_type,
        ST_NumPoints(geometry) as num_points
      FROM test_trails
      ORDER BY name
    `);

    console.log('\nTrail Information:');
    trailInfo.rows.forEach(row => {
      console.log(`- ${row.name}:`);
      console.log(`  Length (m): ${row.length_meters}`);
      console.log(`  Length (geography): ${row.length_geography}`);
      console.log(`  Valid: ${row.is_valid}`);
      console.log(`  Type: ${row.geometry_type}`);
      console.log(`  Points: ${row.num_points}`);
    });

    // Check for intersections
    console.log('\n=== INTERSECTION ANALYSIS ===');
    
    const intersections = await client.query(`
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_Intersects(t1.geometry, t2.geometry) as intersects,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_wkt,
        ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) as intersection_length
      FROM test_trails t1
      JOIN test_trails t2 ON t1.id < t2.id
    `);

    console.log('\nIntersection Results:');
    intersections.rows.forEach(row => {
      console.log(`- ${row.trail1_name} vs ${row.trail2_name}:`);
      console.log(`  Intersects: ${row.intersects}`);
      console.log(`  Type: ${row.intersection_type}`);
      console.log(`  WKT: ${row.intersection_wkt}`);
      console.log(`  Length: ${row.intersection_length}`);
    });

    // Test the intersection detection logic from the production code
    console.log('\n=== PRODUCTION LOGIC TEST ===');
    
    const productionIntersections = await client.query(`
      SELECT DISTINCT
        ST_Force2D(intersection_point) as point,
        ST_Force3D(intersection_point) as point_3d,
        ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
        ARRAY[t1.name, t2.name] as connected_trail_names,
        'intersection' as node_type,
        2.0 as distance_meters
      FROM (
        SELECT 
          (ST_Dump(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)))).geom as intersection_point,
          t1.app_uuid as t1_uuid,
          t2.app_uuid as t2_uuid
        FROM test_trails t1
        JOIN test_trails t2 ON t1.id < t2.id
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) IN ('ST_Point', 'ST_MultiPoint')
          AND ST_Length(t1.geometry::geography) > 5
          AND ST_Length(t2.geometry::geography) > 5
      ) AS intersections
      JOIN test_trails t1 ON t1.app_uuid = intersections.t1_uuid
      JOIN test_trails t2 ON t2.app_uuid = intersections.t2_uuid
      WHERE ST_Length(intersection_point::geography) = 0
    `);

    console.log(`\nProduction intersection detection found ${productionIntersections.rows.length} intersections:`);
    productionIntersections.rows.forEach((row, i) => {
      console.log(`- Intersection ${i + 1}:`);
      console.log(`  Point: ${row.point}`);
      console.log(`  Connected trails: ${row.connected_trail_names.join(' and ')}`);
    });

    // Test pgRouting approach
    console.log('\n=== PGROUTING APPROACH TEST ===');
    
    // Create a table with the required pgRouting structure
    await client.query(`
      DROP TABLE IF EXISTS test_trails_pgr;
      CREATE TABLE test_trails_pgr (
        id SERIAL PRIMARY KEY,
        the_geom GEOMETRY(LINESTRINGZ, 4326),
        name TEXT,
        length_meters DOUBLE PRECISION
      )
    `);

    await client.query(`
      INSERT INTO test_trails_pgr (the_geom, name, length_meters)
      SELECT geometry, name, length_meters FROM test_trails
    `);

    // Add source/target columns
    await client.query(`
      ALTER TABLE test_trails_pgr ADD COLUMN IF NOT EXISTS source INTEGER;
      ALTER TABLE test_trails_pgr ADD COLUMN IF NOT EXISTS target INTEGER;
    `);

    // Try pgRouting topology creation
    try {
      const pgrResult = await client.query(`
        SELECT pgr_createTopology('test_trails_pgr', 2.0, 'the_geom', 'id')
      `);
      console.log('pgRouting topology creation result:', pgrResult.rows[0]);
      
      // Check the results
      const pgrNodes = await client.query(`
        SELECT * FROM test_trails_pgr_vertices_pgr
      `);
      console.log(`pgRouting created ${pgrNodes.rows.length} nodes`);
      
      const pgrEdges = await client.query(`
        SELECT id, source, target, name, ST_Length(the_geom::geography) as length
        FROM test_trails_pgr
        WHERE source IS NOT NULL AND target IS NOT NULL
      `);
      console.log(`pgRouting created ${pgrEdges.rows.length} edges`);
      
      pgrEdges.rows.forEach(row => {
        console.log(`- Edge ${row.id}: ${row.source} -> ${row.target} (${row.name}, ${row.length}m)`);
      });
      
    } catch (error) {
      console.log('pgRouting topology creation failed:', error.message);
    }

    // Test ST_Split approach
    console.log('\n=== ST_SPLIT APPROACH TEST ===');
    
    if (productionIntersections.rows.length > 0) {
      const splitTest = await client.query(`
        WITH trail_intersections AS (
          SELECT DISTINCT
            t1.app_uuid as trail1_uuid,
            t2.app_uuid as trail2_uuid,
            ST_Intersection(t1.geometry, t2.geometry) as intersection_point
          FROM test_trails t1
          JOIN test_trails t2 ON t1.id < t2.id
          WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
            AND ST_Length(t1.geometry::geography) > 5
            AND ST_Length(t2.geometry::geography) > 5
        ),
        split_results AS (
          SELECT
            t.id, t.app_uuid, t.name, t.geometry,
            (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).geom as split_geometry,
            (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).path[1] as segment_order
          FROM test_trails t
          JOIN trail_intersections ti ON t.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
        )
        SELECT 
          app_uuid, name, segment_order,
          ST_GeometryType(split_geometry) as split_type,
          ST_Length(split_geometry::geography) as split_length,
          ST_NumPoints(split_geometry) as split_points
        FROM split_results
        WHERE ST_GeometryType(split_geometry) = 'ST_LineString'
        ORDER BY name, segment_order
      `);

      console.log(`\nST_Split created ${splitTest.rows.length} segments:`);
      splitTest.rows.forEach(row => {
        console.log(`- ${row.name} segment ${row.segment_order}: ${row.split_length}m (${row.split_points} points)`);
      });
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

analyzeTrailIntersections().catch(console.error);

