const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  user: 'shaydu',
  password: '',
  database: 'trail_master_db',
  port: 5432
});

async function testCotrexSnapping() {
  try {
    console.log('🔍 Testing different snapping tolerances on cotrex trails...');
    
    // Get the specific cotrex trails
    const cotrexTrailsResult = await pgClient.query(`
      SELECT name, app_uuid, ST_AsText(geometry) as geom_text, ST_Length(geometry::geography) as length_meters
      FROM public.trails 
      WHERE app_uuid IN ('67fa5621-d393-4953-ba82-f79ad67cdaf5', 'c7c8ecd5-42c8-4947-b02e-25dc832e2f1e')
      ORDER BY name
    `);
    
    if (cotrexTrailsResult.rows.length < 2) {
      console.log('❌ Need both cotrex trails');
      return;
    }
    
    const cotrexEnchanted = cotrexTrailsResult.rows.find(t => t.name === 'Enchanted Mesa Trail');
    const cotrexKohler = cotrexTrailsResult.rows.find(t => t.name === 'Enchanted-Kohler Spur Trail');
    
    console.log(`🔗 Testing: ${cotrexEnchanted.name} <-> ${cotrexKohler.name}`);
    console.log(`   - Enchanted Mesa: ${Math.round(cotrexEnchanted.length_meters * 100) / 100}m`);
    console.log(`   - Kohler Spur: ${Math.round(cotrexKohler.length_meters * 100) / 100}m`);
    
    // Check distance between trails
    const distanceResult = await pgClient.query(`
      SELECT ST_Distance($1::geometry, $2::geometry) as distance_degrees,
             ST_Distance($1::geometry::geography, $2::geometry::geography) as distance_meters
    `, [cotrexEnchanted.geom_text, cotrexKohler.geom_text]);
    
    const distanceDegrees = distanceResult.rows[0].distance_degrees;
    const distanceMeters = distanceResult.rows[0].distance_meters;
    
    console.log(`📏 Distance between cotrex trails: ${distanceDegrees} degrees (${Math.round(distanceMeters * 100) / 100}m)`);
    
    // Test different snapping tolerances
    const tolerances = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 0.001, 0.01, 0.1, 1.0];
    
    console.log('\n🔧 Testing different snapping tolerances:');
    
    for (const tolerance of tolerances) {
      try {
        // Round coordinates to 6 decimal places
        const roundedResult = await pgClient.query(`
          WITH rounded_trails AS (
            SELECT 
              ST_GeomFromText(
                'LINESTRING(' || 
                string_agg(
                  ROUND(ST_X(pt1)::numeric, 6) || ' ' || ROUND(ST_Y(pt1)::numeric, 6),
                  ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($1, 4326), pt1)
                ) || 
                ')', 4326
              ) as enchanted_mesa_rounded,
              ST_GeomFromText(
                'LINESTRING(' || 
                string_agg(
                  ROUND(ST_X(pt2)::numeric, 6) || ' ' || ROUND(ST_Y(pt2)::numeric, 6),
                  ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($2, 4326), pt2)
                ) || 
                ')', 4326
              ) as kohler_spur_rounded
            FROM 
              (SELECT (ST_DumpPoints(ST_GeomFromText($1, 4326))).geom AS pt1) as points1,
              (SELECT (ST_DumpPoints(ST_GeomFromText($2, 4326))).geom AS pt2) as points2
          )
          SELECT enchanted_mesa_rounded, kohler_spur_rounded FROM rounded_trails
        `, [cotrexEnchanted.geom_text, cotrexKohler.geom_text]);
        
        const enchantedMesaRounded = roundedResult.rows[0].enchanted_mesa_rounded;
        const kohlerSpurRounded = roundedResult.rows[0].kohler_spur_rounded;
        
        // Snap with current tolerance
        const snappedResult = await pgClient.query(`
          SELECT 
            ST_Snap($1::geometry, $2::geometry, $3) AS enchanted_mesa_snapped,
            ST_Snap($2::geometry, $1::geometry, $3) AS kohler_spur_snapped
        `, [enchantedMesaRounded, kohlerSpurRounded, tolerance]);
        
        const enchantedMesaSnapped = snappedResult.rows[0].enchanted_mesa_snapped;
        const kohlerSpurSnapped = snappedResult.rows[0].kohler_spur_snapped;
        
        // Find intersections
        const intersectionResult = await pgClient.query(`
          SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt,
                 ST_GeometryType((ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom) as geom_type
        `, [enchantedMesaSnapped, kohlerSpurSnapped]);
        
        const intersectionCount = intersectionResult.rows.length;
        const intersectionTypes = [...new Set(intersectionResult.rows.map(r => r.geom_type))];
        
        console.log(`   Tolerance ${tolerance}: ${intersectionCount} intersection(s) [${intersectionTypes.join(', ')}]`);
        
        if (intersectionCount > 0) {
          console.log(`      ✅ Found intersection(s) with tolerance ${tolerance}`);
          console.log(`      📍 Types: ${intersectionTypes.join(', ')}`);
          
          // Test if we can split with this tolerance
          try {
            const splitTestResult = await pgClient.query(`
              SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
            `, [enchantedMesaSnapped, intersectionResult.rows[0].pt]);
            
            console.log(`      ✂️ Split test: ${splitTestResult.rows.length} segments created`);
            
            if (splitTestResult.rows.length > 1) {
              console.log(`      🎯 SUCCESS: Tolerance ${tolerance} works for splitting cotrex trails!`);
              
              // Show segment lengths
              for (let i = 0; i < splitTestResult.rows.length; i++) {
                const segmentLength = await pgClient.query(`
                  SELECT ST_Length($1::geometry::geography) as length_meters
                `, [splitTestResult.rows[i].segment]);
                console.log(`         Segment ${i + 1}: ${Math.round(segmentLength.rows[0].length_meters * 100) / 100}m`);
              }
              break;
            }
          } catch (splitError) {
            console.log(`      ❌ Split failed: ${splitError.message}`);
          }
        }
        
      } catch (error) {
        console.log(`   Tolerance ${tolerance}: ERROR - ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error testing cotrex snapping:', error);
  } finally {
    await pgClient.end();
  }
}

testCotrexSnapping();
