const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  user: 'shaydu',
  password: '',
  database: 'trail_master_db',
  port: 5432
});

async function snapCotrexTrails() {
  try {
    console.log('🔍 Testing different snapping approaches to join cotrex trails...');
    
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
    
    // Test different snapping approaches
    console.log('\n🔧 Testing different snapping approaches:');
    
    // Approach 1: Direct snapping with different tolerances
    const tolerances = [0.00001, 0.00002, 0.00005, 0.0001, 0.0002, 0.0005, 0.001];
    
    for (const tolerance of tolerances) {
      try {
        console.log(`\n   Approach 1: Direct snapping with tolerance ${tolerance} (${Math.round(tolerance * 111000)}m)`);
        
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
        const pointIntersections = intersectionResult.rows.filter(r => r.geom_type === 'ST_Point');
        const lineIntersections = intersectionResult.rows.filter(r => r.geom_type === 'ST_LineString');
        
        console.log(`      Found ${intersectionCount} intersections: ${pointIntersections.length} points, ${lineIntersections.length} lines`);
        
        if (pointIntersections.length > 0) {
          console.log(`      ✅ Found ${pointIntersections.length} point intersection(s) - can split!`);
          
          // Test splitting with point intersections
          for (let i = 0; i < pointIntersections.length; i++) {
            try {
              const splitTestResult = await pgClient.query(`
                SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
              `, [enchantedMesaSnapped, pointIntersections[i].pt]);
              
              console.log(`         Point ${i + 1}: ${splitTestResult.rows.length} segments created`);
              
              if (splitTestResult.rows.length > 1) {
                console.log(`         🎯 SUCCESS: Can split with point intersection ${i + 1}!`);
                
                // Show segment lengths
                for (let j = 0; j < splitTestResult.rows.length; j++) {
                  const segmentLength = await pgClient.query(`
                    SELECT ST_Length($1::geometry::geography) as length_meters
                  `, [splitTestResult.rows[j].segment]);
                  console.log(`            Segment ${j + 1}: ${Math.round(segmentLength.rows[0].length_meters * 100) / 100}m`);
                }
              }
            } catch (splitError) {
              console.log(`         ❌ Split failed: ${splitError.message}`);
            }
          }
        }
        
      } catch (error) {
        console.log(`      ❌ Error: ${error.message}`);
      }
    }
    
    // Approach 2: Buffer and snap approach
    console.log('\n   Approach 2: Buffer and snap approach');
    try {
      const bufferResult = await pgClient.query(`
        SELECT 
          ST_Buffer($1::geometry, 0.00002) as enchanted_buffer,
          ST_Buffer($2::geometry, 0.00002) as kohler_buffer
      `, [cotrexEnchanted.geom_text, cotrexKohler.geom_text]);
      
      const intersectionResult = await pgClient.query(`
        SELECT (ST_Dump(ST_Intersection($1, $2))).geom AS pt,
               ST_GeometryType((ST_Dump(ST_Intersection($1, $2))).geom) as geom_type
      `, [bufferResult.rows[0].enchanted_buffer, bufferResult.rows[0].kohler_buffer]);
      
      console.log(`      Buffer intersection: ${intersectionResult.rows.length} geometries`);
      
      // Find the centroid of the intersection area
      if (intersectionResult.rows.length > 0) {
        const centroidResult = await pgClient.query(`
          SELECT ST_Centroid(ST_Union($1)) as intersection_point
        `, [intersectionResult.rows.map(r => r.pt)]);
        
        console.log(`      Intersection centroid: ${centroidResult.rows[0].intersection_point}`);
        
        // Try to snap trails to this point
        const snapToPointResult = await pgClient.query(`
          SELECT 
            ST_Snap($1::geometry, $2::geometry, 0.00001) AS enchanted_snapped,
            ST_Snap($3::geometry, $2::geometry, 0.00001) AS kohler_snapped
        `, [cotrexEnchanted.geom_text, centroidResult.rows[0].intersection_point, cotrexKohler.geom_text]);
        
        // Test intersection after snapping to point
        const finalIntersectionResult = await pgClient.query(`
          SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt,
                 ST_GeometryType((ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom) as geom_type
        `, [snapToPointResult.rows[0].enchanted_snapped, snapToPointResult.rows[0].kohler_snapped]);
        
        const pointIntersections = finalIntersectionResult.rows.filter(r => r.geom_type === 'ST_Point');
        console.log(`      After snapping to centroid: ${pointIntersections.length} point intersections`);
        
        if (pointIntersections.length > 0) {
          console.log(`      ✅ SUCCESS: Buffer approach created point intersection!`);
        }
      }
      
    } catch (error) {
      console.log(`      ❌ Buffer approach error: ${error.message}`);
    }
    
  } catch (error) {
    console.error('❌ Error snapping cotrex trails:', error);
  } finally {
    await pgClient.end();
  }
}

snapCotrexTrails();
