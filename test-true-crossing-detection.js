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

async function testTrueCrossingDetection() {
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

    // Test the TrueCrossingSplittingService detection logic
    const trueCrossingQuery = `
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          t2.geometry as trail2_geom
        FROM staging.test_trails t1
        CROSS JOIN staging.test_trails t2
        WHERE t1.app_uuid < t2.app_uuid  -- Avoid duplicate pairs
          AND ST_Length(t1.geometry::geography) >= 5.0
          AND ST_Length(t2.geometry::geography) >= 5.0
          AND ST_IsValid(t1.geometry)
          AND ST_IsValid(t2.geometry)
          AND ST_Crosses(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))  -- True crossing detection
      ),
      intersection_points AS (
        SELECT 
          trail1_id,
          trail1_name,
          trail1_geom,
          trail2_id,
          trail2_name,
          trail2_geom,
          ST_Intersection(ST_Force2D(trail1_geom), ST_Force2D(trail2_geom)) as intersection_geom
        FROM trail_pairs
        WHERE ST_GeometryType(ST_Intersection(ST_Force2D(trail1_geom), ST_Force2D(trail2_geom))) IN ('ST_Point', 'ST_MultiPoint')
      )
      SELECT 
        trail1_id,
        trail1_name,
        trail2_id,
        trail2_name,
        ST_AsGeoJSON(intersection_geom) as intersection_point_json,
        ST_AsText(intersection_geom) as intersection_wkt,
        ST_GeometryType(intersection_geom) as intersection_type,
        ST_LineLocatePoint(ST_Force2D(trail1_geom), 
          CASE 
            WHEN ST_GeometryType(intersection_geom) = 'ST_MultiPoint' 
            THEN ST_Centroid(intersection_geom)
            ELSE intersection_geom 
          END) as trail1_ratio,
        ST_LineLocatePoint(ST_Force2D(trail2_geom), 
          CASE 
            WHEN ST_GeometryType(intersection_geom) = 'ST_MultiPoint' 
            THEN ST_Centroid(intersection_geom)
            ELSE intersection_geom 
          END) as trail2_ratio
      FROM intersection_points
      ORDER BY trail1_name, trail2_name;
    `;

    const result = await client.query(trueCrossingQuery);
    
    console.log('\n=== TRUE CROSSING DETECTION RESULTS ===');
    if (result.rows.length === 0) {
      console.log('❌ No true crossings detected by ST_Crosses()');
      
      // Let's also test ST_Intersects to see what we get
      const intersectsQuery = `
        SELECT 
          t1.name as trail1_name,
          t2.name as trail2_name,
          ST_Intersects(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) as intersects,
          ST_Crosses(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) as crosses,
          ST_Overlaps(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) as overlaps,
          ST_Touches(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) as touches
        FROM staging.test_trails t1
        CROSS JOIN staging.test_trails t2
        WHERE t1.app_uuid < t2.app_uuid
      `;
      
      const intersectsResult = await client.query(intersectsQuery);
      console.log('\n=== SPATIAL RELATIONSHIP TEST ===');
      for (const row of intersectsResult.rows) {
        console.log(`Trails: ${row.trail1_name} ↔ ${row.trail2_name}`);
        console.log(`  ST_Intersects: ${row.intersects}`);
        console.log(`  ST_Crosses: ${row.crosses}`);
        console.log(`  ST_Overlaps: ${row.overlaps}`);
        console.log(`  ST_Touches: ${row.touches}`);
        console.log('---');
      }
    } else {
      console.log(`✅ Found ${result.rows.length} true crossing(s):`);
      for (const row of result.rows) {
        console.log(`📍 True Crossing: ${row.trail1_name} × ${row.trail2_name}`);
        console.log(`   Intersection Type: ${row.intersection_type}`);
        console.log(`   Intersection WKT: ${row.intersection_wkt}`);
        console.log(`   Trail1 Position Ratio: ${row.trail1_ratio.toFixed(4)} (0=start, 1=end)`);
        console.log(`   Trail2 Position Ratio: ${row.trail2_ratio.toFixed(4)} (0=start, 1=end)`);
        
        try {
          const intersectionPoint = JSON.parse(row.intersection_point_json);
          if (intersectionPoint.coordinates) {
            console.log(`   Coordinates: [${intersectionPoint.coordinates[0].toFixed(6)}, ${intersectionPoint.coordinates[1].toFixed(6)}]`);
          }
        } catch (e) {
          console.log(`   Coordinates: [unable to parse]`);
        }
        console.log('---');
      }
    }

    // Clean up
    await client.query('DROP TABLE IF EXISTS staging.test_trails');
    console.log('\nCleaned up test data');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

testTrueCrossingDetection();
