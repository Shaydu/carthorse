const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function testCOTREXPrototypeSplitting() {
  try {
    console.log('🔍 Testing COTREX prototype intersection splitting with specific trails...');
    
    // Get the specific COTREX trails by app_uuid and name
    const trailsResult = await pgClient.query(`
      SELECT 
        app_uuid, 
        name, 
        source,
        ST_AsText(geometry) as geom_text,
        ST_NumPoints(geometry) as num_points,
        ST_Length(geometry::geography) as length_meters,
        ST_X(ST_StartPoint(geometry)) as start_lng,
        ST_Y(ST_StartPoint(geometry)) as start_lat,
        ST_X(ST_EndPoint(geometry)) as end_lng,
        ST_Y(ST_EndPoint(geometry)) as end_lat
      FROM public.trails 
      WHERE (
        app_uuid = '67fa5621-d393-4953-ba82-f79ad67cdaf5'  -- Specific COTREX Enchanted Mesa
        OR (name = 'Enchanted-Kohler Spur Trail' AND source = 'cotrex' AND ST_Length(geometry::geography) > 200)
      )
      ORDER BY name, length_meters DESC
    `);
    
    console.log(`📊 Found ${trailsResult.rows.length} specific COTREX trails:`);
    trailsResult.rows.forEach(trail => {
      console.log(`   - ${trail.name} (${trail.app_uuid}): ${Math.round(trail.length_meters)}m (${trail.num_points} points)`);
    });
    
    if (trailsResult.rows.length < 2) {
      console.log('❌ Need both specific COTREX Enchanted Mesa and Kohler Spur trails');
      return;
    }
    
    const enchantedMesa = trailsResult.rows.find(t => t.app_uuid === '67fa5621-d393-4953-ba82-f79ad67cdaf5');
    const kohlerSpur = trailsResult.rows.find(t => t.name === 'Enchanted-Kohler Spur Trail');
    
    if (!enchantedMesa || !kohlerSpur) {
      console.log('❌ Missing required trails');
      console.log(`   Enchanted Mesa found: ${!!enchantedMesa}`);
      console.log(`   Kohler Spur found: ${!!kohlerSpur}`);
      return;
    }
    
    console.log(`\n🔗 Testing prototype logic with specific COTREX trails:`);
    console.log(`   Enchanted Mesa (${enchantedMesa.app_uuid}): ${Math.round(enchantedMesa.length_meters)}m (${enchantedMesa.num_points} points)`);
    console.log(`   Kohler Spur: ${Math.round(kohlerSpur.length_meters)}m (${kohlerSpur.num_points} points)`);
    
    // Also get the OSM version for comparison
    const osmComparisonResult = await pgClient.query(`
      SELECT 
        app_uuid, 
        name, 
        source,
        ST_AsText(geometry) as geom_text,
        ST_NumPoints(geometry) as num_points,
        ST_Length(geometry::geography) as length_meters,
        ST_X(ST_StartPoint(geometry)) as start_lng,
        ST_Y(ST_StartPoint(geometry)) as start_lat,
        ST_X(ST_EndPoint(geometry)) as end_lng,
        ST_Y(ST_EndPoint(geometry)) as end_lat
      FROM public.trails 
      WHERE name = 'Enchanted Mesa Trail' AND source = 'osm'
    `);
    
    if (osmComparisonResult.rows.length > 0) {
      const osmEnchantedMesa = osmComparisonResult.rows[0];
      console.log(`\n📊 Comparison with OSM version:`);
      console.log(`   OSM Enchanted Mesa: ${Math.round(osmEnchantedMesa.length_meters)}m (${osmEnchantedMesa.num_points} points)`);
      console.log(`   COTREX Enchanted Mesa: ${Math.round(enchantedMesa.length_meters)}m (${enchantedMesa.num_points} points)`);
      console.log(`   Length difference: ${Math.abs(enchantedMesa.length_meters - osmEnchantedMesa.length_meters).toFixed(1)}m`);
      
      // Check if they cover the same geographic area
      const overlapResult = await pgClient.query(`
        SELECT 
          ST_Distance($1::geometry::geography, $2::geometry::geography) as distance_meters,
          ST_Intersects($1::geometry, $2::geometry) as intersects
      `, [enchantedMesa.geom_text, osmEnchantedMesa.geom_text]);
      
      const overlap = overlapResult.rows[0];
      console.log(`   Distance between trails: ${Math.round(overlap.distance_meters)}m`);
      console.log(`   Intersects: ${overlap.intersects}`);
    }
    
    // Step 1: Round coordinates to 6 decimal places (exactly like working prototype)
    console.log(`\n🔧 Step 1: Rounding coordinates to 6 decimal places...`);
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
    
    if (roundedResult.rows.length === 0) {
      console.log('❌ Failed to round coordinates');
      return;
    }
    
    const enchantedMesaRounded = roundedResult.rows[0].enchanted_mesa_rounded;
    const kohlerSpurRounded = roundedResult.rows[0].kohler_spur_rounded;
    
    console.log(`✅ Coordinates rounded successfully`);
    
    // Step 2: Test different snap tolerances to find the right one for COTREX
    console.log(`\n🔧 Step 2: Testing snap tolerances for COTREX data...`);
    
    const tolerances = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 0.0001, 0.001, 0.01, 0.1];
    let bestTolerance = null;
    let bestIntersectionCount = 0;
    
    for (const tolerance of tolerances) {
      try {
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
          SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt
        `, [enchantedMesaSnapped, kohlerSpurSnapped]);
        
        if (intersectionResult.rows.length > 0) {
          console.log(`   ✅ Tolerance ${tolerance}: Found ${intersectionResult.rows.length} intersection(s)`);
          
          if (intersectionResult.rows.length > bestIntersectionCount) {
            bestIntersectionCount = intersectionResult.rows.length;
            bestTolerance = tolerance;
          }
          
          // Test splitting with this tolerance
          const splitResult = await pgClient.query(`
            SELECT 
              (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
          `, [enchantedMesaSnapped, intersectionResult.rows[0].pt]);
          
          console.log(`      📏 Split Enchanted Mesa into ${splitResult.rows.length} segments`);
          
          if (splitResult.rows.length >= 2) {
            console.log(`      🎯 SUCCESS: Found valid splitting with tolerance ${tolerance}`);
            break;
          }
        } else {
          console.log(`   ❌ Tolerance ${tolerance}: No intersections found`);
        }
      } catch (error) {
        console.log(`   ❌ Tolerance ${tolerance}: Error - ${error.message}`);
      }
    }
    
    if (!bestTolerance) {
      console.log('❌ No valid tolerance found for intersection detection');
      return;
    }
    
    console.log(`\n🎯 Using best tolerance: ${bestTolerance}`);
    
    // Step 3: Apply the prototype logic with the best tolerance
    console.log(`\n🔧 Step 3: Applying prototype logic with tolerance ${bestTolerance}...`);
    
    const finalSnappedResult = await pgClient.query(`
      SELECT 
        ST_Snap($1::geometry, $2::geometry, $3) AS enchanted_mesa_snapped,
        ST_Snap($2::geometry, $1::geometry, $3) AS kohler_spur_snapped
    `, [enchantedMesaRounded, kohlerSpurRounded, bestTolerance]);
    
    const enchantedMesaSnapped = finalSnappedResult.rows[0].enchanted_mesa_snapped;
    const kohlerSpurSnapped = finalSnappedResult.rows[0].kohler_spur_snapped;
    
    // Find intersections
    const finalIntersectionResult = await pgClient.query(`
      SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt
    `, [enchantedMesaSnapped, kohlerSpurSnapped]);
    
    console.log(`✅ Found ${finalIntersectionResult.rows.length} intersection(s)`);
    
    // Step 4: Split both trails at intersection points
    console.log(`\n🔧 Step 4: Splitting trails at intersection points...`);
    
    let totalSegments = 0;
    
    for (const intersection of finalIntersectionResult.rows) {
      const splitPoint = intersection.pt;
      console.log(`   🔗 Processing intersection point: ${splitPoint}`);
      
      // Split Enchanted Mesa
      const splitEnchantedMesaResult = await pgClient.query(`
        SELECT 
          (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment,
          (ST_Dump(ST_Split($1::geometry, $2::geometry))).path[1] as segment_order
      `, [enchantedMesaSnapped, splitPoint]);
      
      console.log(`   📏 Enchanted Mesa split into ${splitEnchantedMesaResult.rows.length} segments:`);
      for (let i = 0; i < splitEnchantedMesaResult.rows.length; i++) {
        const segment = splitEnchantedMesaResult.rows[i];
        const lengthResult = await pgClient.query(`
          SELECT ST_Length($1::geometry::geography) as length_meters
        `, [segment.segment]);
        console.log(`      Segment ${i + 1}: ${Math.round(lengthResult.rows[0].length_meters)}m`);
      }
      
      // Split Kohler Spur
      const splitKohlerSpurResult = await pgClient.query(`
        SELECT 
          (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment,
          (ST_Dump(ST_Split($1::geometry, $2::geometry))).path[1] as segment_order
      `, [kohlerSpurSnapped, splitPoint]);
      
      console.log(`   📏 Kohler Spur split into ${splitKohlerSpurResult.rows.length} segments:`);
      for (let i = 0; i < splitKohlerSpurResult.rows.length; i++) {
        const segment = splitKohlerSpurResult.rows[i];
        const lengthResult = await pgClient.query(`
          SELECT ST_Length($1::geometry::geography) as length_meters
        `, [segment.segment]);
        console.log(`      Segment ${i + 1}: ${Math.round(lengthResult.rows[0].length_meters)}m`);
      }
      
      totalSegments += splitEnchantedMesaResult.rows.length + splitKohlerSpurResult.rows.length;
    }
    
    console.log(`\n✅ COTREX prototype splitting completed successfully!`);
    console.log(`📊 Total segments created: ${totalSegments}`);
    console.log(`🎯 This should match the expected result from OSM data`);
    
  } catch (error) {
    console.error('❌ Error testing COTREX prototype splitting:', error);
  } finally {
    await pgClient.end();
  }
}

testCOTREXPrototypeSplitting();
