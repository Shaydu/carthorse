const { Pool } = require('pg');

async function testSpecificIntersection() {
  const pool = new Pool({
    user: 'carthorse',
    host: 'localhost',
    database: 'trail_master_db',
    port: 5432,
  });

  const client = await pool.connect();

  try {
    console.log('🧪 Testing specific trail intersection...');

    // Create test trails with the exact geometries provided
    const trail1 = {
      type: "LineString",
      coordinates: [
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
      ]
    };

    const trail2 = {
      type: "LineString",
      coordinates: [
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
      ]
    };

    const intersectionPoint = {
      type: "Point",
      coordinates: [-105.291243, 40.06997, 1726.449463]
    };

    // Test 1: Check if they intersect
    console.log('\n1️⃣ Testing intersection detection...');
    const intersectResult = await client.query(`
      SELECT 
        ST_Intersects(ST_GeomFromGeoJSON($1), ST_GeomFromGeoJSON($2)) as intersects,
        ST_Crosses(ST_GeomFromGeoJSON($1), ST_GeomFromGeoJSON($2)) as crosses
    `, [JSON.stringify(trail1), JSON.stringify(trail2)]);

    console.log(`   ST_Intersects: ${intersectResult.rows[0].intersects}`);
    console.log(`   ST_Crosses: ${intersectResult.rows[0].crosses}`);

    // Test 2: Find intersection point
    console.log('\n2️⃣ Finding intersection point...');
    const intersectionResult = await client.query(`
      SELECT 
        ST_AsGeoJSON(ST_Intersection(ST_GeomFromGeoJSON($1), ST_GeomFromGeoJSON($2)))::json as intersection
    `, [JSON.stringify(trail1), JSON.stringify(trail2)]);

    console.log(`   Intersection: ${JSON.stringify(intersectionResult.rows[0].intersection)}`);

    // Test 3: Calculate split ratios
    console.log('\n3️⃣ Calculating split ratios...');
    const ratioResult = await client.query(`
      SELECT 
        ST_LineLocatePoint(ST_GeomFromGeoJSON($1), ST_GeomFromGeoJSON($3)) as trail1_ratio,
        ST_LineLocatePoint(ST_GeomFromGeoJSON($2), ST_GeomFromGeoJSON($3)) as trail2_ratio
    `, [JSON.stringify(trail1), JSON.stringify(trail2), JSON.stringify(intersectionPoint)]);

    const trail1Ratio = parseFloat(ratioResult.rows[0].trail1_ratio);
    const trail2Ratio = parseFloat(ratioResult.rows[0].trail2_ratio);

    console.log(`   Trail 1 split ratio: ${trail1Ratio.toFixed(6)}`);
    console.log(`   Trail 2 split ratio: ${trail2Ratio.toFixed(6)}`);

    // Test 4: Test splitting
    console.log('\n4️⃣ Testing trail splitting...');
    
    // Split trail 1
    const split1Result = await client.query(`
      SELECT 
        ST_AsGeoJSON(ST_LineSubstring(ST_GeomFromGeoJSON($1), 0.0, $2))::json as segment1,
        ST_AsGeoJSON(ST_LineSubstring(ST_GeomFromGeoJSON($1), $2, 1.0))::json as segment2
    `, [JSON.stringify(trail1), trail1Ratio]);

    console.log(`   Trail 1 segment 1 length: ${split1Result.rows[0].segment1.coordinates.length} points`);
    console.log(`   Trail 1 segment 2 length: ${split1Result.rows[0].segment2.coordinates.length} points`);

    // Split trail 2
    const split2Result = await client.query(`
      SELECT 
        ST_AsGeoJSON(ST_LineSubstring(ST_GeomFromGeoJSON($1), 0.0, $2))::json as segment1,
        ST_AsGeoJSON(ST_LineSubstring(ST_GeomFromGeoJSON($1), $2, 1.0))::json as segment2
    `, [JSON.stringify(trail2), trail2Ratio]);

    console.log(`   Trail 2 segment 1 length: ${split2Result.rows[0].segment1.coordinates.length} points`);
    console.log(`   Trail 2 segment 2 length: ${split2Result.rows[0].segment2.coordinates.length} points`);

    // Test 5: Calculate segment lengths
    console.log('\n5️⃣ Calculating segment lengths...');
    const lengthResult = await client.query(`
      SELECT 
        ST_Length(ST_LineSubstring(ST_GeomFromGeoJSON($1), 0.0, $2)::geography) as trail1_seg1_length,
        ST_Length(ST_LineSubstring(ST_GeomFromGeoJSON($1), $2, 1.0)::geography) as trail1_seg2_length,
        ST_Length(ST_LineSubstring(ST_GeomFromGeoJSON($3), 0.0, $4)::geography) as trail2_seg1_length,
        ST_Length(ST_LineSubstring(ST_GeomFromGeoJSON($3), $4, 1.0)::geography) as trail2_seg2_length
    `, [JSON.stringify(trail1), trail1Ratio, JSON.stringify(trail2), trail2Ratio]);

    const lengths = lengthResult.rows[0];
    console.log(`   Trail 1 segment 1: ${parseFloat(lengths.trail1_seg1_length).toFixed(2)}m`);
    console.log(`   Trail 1 segment 2: ${parseFloat(lengths.trail1_seg2_length).toFixed(2)}m`);
    console.log(`   Trail 2 segment 1: ${parseFloat(lengths.trail2_seg1_length).toFixed(2)}m`);
    console.log(`   Trail 2 segment 2: ${parseFloat(lengths.trail2_seg2_length).toFixed(2)}m`);

    // Test 6: Check if segments are valid
    console.log('\n6️⃣ Validating segments...');
    const validResult = await client.query(`
      SELECT 
        ST_IsValid(ST_LineSubstring(ST_GeomFromGeoJSON($1), 0.0, $2)) as trail1_seg1_valid,
        ST_IsValid(ST_LineSubstring(ST_GeomFromGeoJSON($1), $2, 1.0)) as trail1_seg2_valid,
        ST_IsValid(ST_LineSubstring(ST_GeomFromGeoJSON($3), 0.0, $4)) as trail2_seg1_valid,
        ST_IsValid(ST_LineSubstring(ST_GeomFromGeoJSON($3), $4, 1.0)) as trail2_seg2_valid
    `, [JSON.stringify(trail1), trail1Ratio, JSON.stringify(trail2), trail2Ratio]);

    const validity = validResult.rows[0];
    console.log(`   Trail 1 segment 1 valid: ${validity.trail1_seg1_valid}`);
    console.log(`   Trail 1 segment 2 valid: ${validity.trail1_seg2_valid}`);
    console.log(`   Trail 2 segment 1 valid: ${validity.trail2_seg1_valid}`);
    console.log(`   Trail 2 segment 2 valid: ${validity.trail2_seg2_valid}`);

    console.log('\n✅ Test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

testSpecificIntersection();
