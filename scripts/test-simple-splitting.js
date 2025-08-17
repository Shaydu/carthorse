const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function testSimpleSplitting() {
  try {
    console.log('🔍 Testing Simple Splitting (following working prototype approach)...');
    
    // Test case: Enchanted Mesa / Enchanted-Kohler Spur (using working prototype IDs)
    const trail1Id = '4cda78f2-3a86-4e56-9300-c62480ca11fa'; // Enchanted Mesa Trail
    const trail2Id = 'a610885e-8cf0-48bd-9b47-2217e2055101'; // Enchanted-Kohler Spur Trail
    
    // Get trail data
    const trailsResult = await pgClient.query(`
      SELECT app_uuid, name, ST_AsText(geometry) as geom_text
      FROM public.trails 
      WHERE app_uuid IN ($1, $2)
      ORDER BY name
    `, [trail1Id, trail2Id]);
    
    if (trailsResult.rows.length < 2) {
      console.log('❌ Need both trails');
      return;
    }
    
    const trail1 = trailsResult.rows[0];
    const trail2 = trailsResult.rows[1];
    
    console.log(`🔗 Testing: ${trail1.name} <-> ${trail2.name}`);
    
    // Step 1: Round coordinates to 6 decimal places (exactly like working prototype)
    const roundedResult = await pgClient.query(`
      WITH rounded_trails AS (
        SELECT 
          ST_GeomFromText(
            'LINESTRING(' || 
            string_agg(
              ROUND(ST_X(pt1)::numeric, 6) || ' ' || ROUND(ST_Y(pt1)::numeric, 6),
              ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($1), pt1)
            ) || 
            ')'
          ) as trail1_rounded,
          ST_GeomFromText(
            'LINESTRING(' || 
            string_agg(
              ROUND(ST_X(pt2)::numeric, 6) || ' ' || ROUND(ST_Y(pt2)::numeric, 6),
              ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($2), pt2)
            ) || 
            ')'
          ) as trail2_rounded
        FROM 
          (SELECT (ST_DumpPoints(ST_GeomFromText($1))).geom AS pt1) as points1,
          (SELECT (ST_DumpPoints(ST_GeomFromText($2))).geom AS pt2) as points2
      )
      SELECT trail1_rounded, trail2_rounded FROM rounded_trails
    `, [trail1.geom_text, trail2.geom_text]);
    
    if (roundedResult.rows.length === 0) {
      console.log('❌ Failed to round coordinates');
      return;
    }
    
    const trail1Rounded = roundedResult.rows[0].trail1_rounded;
    const trail2Rounded = roundedResult.rows[0].trail2_rounded;
    
    // Step 2: Snap with 1e-6 tolerance (exactly like working prototype)
    const snappedResult = await pgClient.query(`
      SELECT 
        ST_Snap($1::geometry, $2::geometry, 1e-6) AS trail1_snapped,
        ST_Snap($2::geometry, $1::geometry, 1e-6) AS trail2_snapped
    `, [trail1Rounded, trail2Rounded]);
    
    const trail1Snapped = snappedResult.rows[0].trail1_snapped;
    const trail2Snapped = snappedResult.rows[0].trail2_snapped;
    
    // Step 3: Find intersections (exactly like working prototype)
    const intersectionResult = await pgClient.query(`
      SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt
    `, [trail1Snapped, trail2Snapped]);
    
    console.log(`🔍 Found ${intersectionResult.rows.length} intersection(s)`);
    
    if (intersectionResult.rows.length === 0) {
      console.log('❌ No intersections found');
      return;
    }
    
    // Step 4: Split trails at intersection points (exactly like working prototype)
    for (const intersection of intersectionResult.rows) {
      const splitPoint = intersection.pt;
      console.log(`   ✅ Intersection point: ${splitPoint}`);
      
      // Split Trail 1
      const splitTrail1Result = await pgClient.query(`
        SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
      `, [trail1Snapped, splitPoint]);
      
      console.log(`   📏 ${trail1.name} split into ${splitTrail1Result.rows.length} segments`);
      
      // Split Trail 2
      const splitTrail2Result = await pgClient.query(`
        SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
      `, [trail2Snapped, splitPoint]);
      
      console.log(`   📏 ${trail2.name} split into ${splitTrail2Result.rows.length} segments`);
    }
    
    console.log('✅ Simple splitting test completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testSimpleSplitting();
