const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  user: 'shaydu',
  password: '',
  database: 'trail_master_db',
  port: 5432
});

async function analyzeCotrexIntersection() {
  try {
    console.log('🔍 Analyzing cotrex Enchanted Mesa and Kohler Spur intersection...');
    
    // Get the cotrex trails specifically
    const trailsResult = await pgClient.query(`
      SELECT name, app_uuid, ST_AsText(geometry) as geom_text, ST_Length(geometry::geography) as length_meters
      FROM public.trails 
      WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
        AND source = 'cotrex'
      ORDER BY name
    `);
    
    console.log(`🔍 Found ${trailsResult.rows.length} cotrex trails:`);
    trailsResult.rows.forEach(trail => {
      console.log(`   - ${trail.name} (${trail.app_uuid}): ${Math.round(trail.length_meters * 100) / 100}m`);
    });
    
    if (trailsResult.rows.length < 2) {
      console.log('❌ Need both cotrex Enchanted Mesa and Kohler trails');
      return;
    }
    
    const enchantedMesa = trailsResult.rows.find(t => t.name === 'Enchanted Mesa Trail');
    const kohlerSpur = trailsResult.rows.find(t => t.name === 'Enchanted-Kohler Spur Trail');
    
    console.log(`\n🔗 Analyzing: ${enchantedMesa.name} <-> ${kohlerSpur.name}`);
    
    // Check distance between trails
    const distanceResult = await pgClient.query(`
      SELECT ST_Distance($1::geometry, $2::geometry) as distance_degrees,
             ST_Distance($1::geometry::geography, $2::geometry::geography) as distance_meters
    `, [enchantedMesa.geom_text, kohlerSpur.geom_text]);
    
    const distanceDegrees = distanceResult.rows[0].distance_degrees;
    const distanceMeters = distanceResult.rows[0].distance_meters;
    
    console.log(`📏 Distance between trails: ${distanceDegrees} degrees (${Math.round(distanceMeters * 100) / 100}m)`);
    
    // Test different snapping tolerances
    const tolerances = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 0.001, 0.01, 0.1];
    
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
                  ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($1), pt1)
                ) || 
                ')'
              ) as enchanted_mesa_rounded,
              ST_GeomFromText(
                'LINESTRING(' || 
                string_agg(
                  ROUND(ST_X(pt2)::numeric, 6) || ' ' || ROUND(ST_Y(pt2)::numeric, 6),
                  ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($2), pt2)
                ) || 
                ')'
              ) as kohler_spur_rounded
            FROM 
              (SELECT (ST_DumpPoints(ST_GeomFromText($1))).geom AS pt1) as points1,
              (SELECT (ST_DumpPoints(ST_GeomFromText($2))).geom AS pt2) as points2
          )
          SELECT enchanted_mesa_rounded, kohler_spur_rounded FROM rounded_trails
        `, [enchantedMesa.geom_text, kohlerSpur.geom_text]);
        
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
              console.log(`      🎯 SUCCESS: Tolerance ${tolerance} works for splitting!`);
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
    console.error('❌ Error analyzing cotrex intersection:', error);
  } finally {
    await pgClient.end();
  }
}

analyzeCotrexIntersection();
