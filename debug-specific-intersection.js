const { Client } = require('pg');

async function debugSpecificIntersection() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: 'postgres'
  });

  try {
    await client.connect();
    console.log('🔍 Debugging specific intersection detection...\n');

    const stagingSchema = 'carthorse_1756944329498';

    // Create test geometries for the two trail segments
    const trail1Coords = [
      [-105.291194, 40.07011, 1731.133179],
      [-105.291226, 40.070041, 1726.449463],
      [-105.291243, 40.06997, 1726.449463],
      [-105.291267, 40.069873, 1727.728394],
      [-105.291297, 40.069654, 1728.930542],
      [-105.291316, 40.069611, 1729.321533],
      [-105.291334, 40.069599, 1729.321533],
      [-105.291371, 40.069603, 1729.321533],
      [-105.291398, 40.069624, 1729.321533],
      [-105.291394, 40.069695, 1728.997192],
      [-105.291419, 40.069774, 1727.890381],
      [-105.291428, 40.069833, 1727.890381],
      [-105.291421, 40.069979, 1726.752563]
    ];

    const trail2Coords = [
      [-105.282728, 40.070456, 1687.336792],
      [-105.283431, 40.070319, 1687.121826],
      [-105.283899, 40.070254, 1687.099976],
      [-105.284392, 40.070307, 1687.581543],
      [-105.284767, 40.070297, 1688.423218],
      [-105.285295, 40.07017, 1691.094604],
      [-105.285541, 40.070178, 1691.95813],
      [-105.285658, 40.07016, 1692.993164],
      [-105.286173, 40.069997, 1693.963989],
      [-105.286701, 40.06995, 1696.985596],
      [-105.287053, 40.069976, 1698.661499],
      [-105.287475, 40.069975, 1699.495117],
      [-105.287827, 40.070038, 1699.949097],
      [-105.288977, 40.070107, 1705.932007],
      [-105.289164, 40.070106, 1707.591919],
      [-105.289656, 40.070015, 1710.87793],
      [-105.290126, 40.070032, 1715.303955],
      [-105.290336, 40.069977, 1715.358521],
      [-105.290548, 40.069968, 1718.499756],
      [-105.290653, 40.06994, 1721.354126],
      [-105.290988, 40.069969, 1723.668579],
      [-105.291177, 40.069954, 1726.449463],
      [-105.291243, 40.06997, 1726.449463],
      [-105.291421, 40.069979, 1726.752563]
    ];

    const trail1GeoJSON = {
      type: "LineString",
      coordinates: trail1Coords
    };

    const trail2GeoJSON = {
      type: "LineString", 
      coordinates: trail2Coords
    };

    console.log('📍 Testing intersection detection...');
    console.log(`Trail 1: ${trail1Coords.length} points`);
    console.log(`Trail 2: ${trail2Coords.length} points`);
    console.log(`Shared point: [-105.291243, 40.06997, 1726.449463]\n`);

    // Test intersection detection
    const intersectionTest = await client.query(`
      WITH trail1 AS (
        SELECT ST_GeomFromGeoJSON($1) as geom
      ),
      trail2 AS (
        SELECT ST_GeomFromGeoJSON($2) as geom
      )
      SELECT 
        ST_Intersects(t1.geom, t2.geom) as intersects,
        ST_Crosses(t1.geom, t2.geom) as crosses,
        ST_GeometryType(ST_Intersection(t1.geom, t2.geom)) as intersection_type,
        ST_AsText(ST_Intersection(t1.geom, t2.geom)) as intersection_wkt,
        ST_NumGeometries(ST_Intersection(t1.geom, t2.geom)) as num_intersections
      FROM trail1 t1, trail2 t2
    `, [JSON.stringify(trail1GeoJSON), JSON.stringify(trail2GeoJSON)]);

    console.log('🔍 Intersection Test Results:');
    console.log(`ST_Intersects: ${intersectionTest.rows[0].intersects}`);
    console.log(`ST_Crosses: ${intersectionTest.rows[0].crosses}`);
    console.log(`Intersection Type: ${intersectionTest.rows[0].intersection_type}`);
    console.log(`Intersection WKT: ${intersectionTest.rows[0].intersection_wkt}`);
    console.log(`Number of Intersections: ${intersectionTest.rows[0].num_intersections}\n`);

    // Now check if these specific trail segments exist in the database
    console.log('🔍 Checking if these trail segments exist in database...');
    
    const dbTrails = await client.query(`
      SELECT 
        name,
        app_uuid,
        ST_Length(geometry::geography)/1000 as length_km,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${stagingSchema}.trails 
      WHERE name LIKE '%Foothills North%' OR name LIKE '%North Sky%'
      ORDER BY name, length_km
    `);

    console.log(`Found ${dbTrails.rows.length} trail segments in database:`);
    dbTrails.rows.forEach((trail, index) => {
      console.log(`${index + 1}. ${trail.name} (${trail.length_km.toFixed(3)}km)`);
      console.log(`   UUID: ${trail.app_uuid}`);
      console.log(`   Start: ${trail.start_point}`);
      console.log(`   End: ${trail.end_point}\n`);
    });

    // Test if any of these database trails intersect with our test geometries
    console.log('🔍 Testing database trails against our test geometries...');
    
    for (const dbTrail of dbTrails.rows) {
      const dbTrailTest = await client.query(`
        WITH test_trail AS (
          SELECT ST_GeomFromGeoJSON($1) as geom
        )
        SELECT 
          ST_Intersects(tt.geom, t.geometry) as intersects,
          ST_Crosses(tt.geom, t.geometry) as crosses,
          ST_GeometryType(ST_Intersection(tt.geom, t.geometry)) as intersection_type
        FROM test_trail tt, ${stagingSchema}.trails t
        WHERE t.app_uuid = $2
      `, [JSON.stringify(trail1GeoJSON), dbTrail.app_uuid]);

      if (dbTrailTest.rows[0].intersects) {
        console.log(`✅ Trail ${dbTrail.name} intersects with test trail 1`);
        console.log(`   Intersects: ${dbTrailTest.rows[0].intersects}`);
        console.log(`   Crosses: ${dbTrailTest.rows[0].crosses}`);
        console.log(`   Type: ${dbTrailTest.rows[0].intersection_type}\n`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

debugSpecificIntersection();