const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function testCOTREXPrototypeSplittingFixed() {
  try {
    console.log('🔍 Testing COTREX prototype intersection splitting (FIXED VERSION)...');
    
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
    
    // Step 2: Use a conservative tolerance that works for COTREX
    const tolerance = 0.0001; // ~11m in degrees
    console.log(`\n🔧 Step 2: Using tolerance ${tolerance} for COTREX data...`);
    
    // Snap with tolerance
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
    
    console.log(`✅ Found ${intersectionResult.rows.length} intersection(s)`);
    
    // Step 3: Split ONLY the visited trail (Enchanted Mesa) at the intersection point
    console.log(`\n🔧 Step 3: Splitting ONLY Enchanted Mesa trail at intersection point...`);
    
    if (intersectionResult.rows.length > 0) {
      const splitPoint = intersectionResult.rows[0].pt;
      console.log(`   🔗 Using intersection point: ${splitPoint}`);
      
      // Use buffer method to handle linear intersections - ONLY split Enchanted Mesa
      const bufferSize = 0.000001; // Very small buffer to avoid linear intersection error
      console.log(`   🔧 Using buffer method with size ${bufferSize} to avoid linear intersection error`);
      
      const splitEnchantedMesaResult = await pgClient.query(`
        SELECT 
          (ST_Dump(ST_Split($1::geometry, ST_Buffer($2::geometry, $3)))).geom AS segment,
          (ST_Dump(ST_Split($1::geometry, ST_Buffer($2::geometry, $3)))).path[1] as segment_order
      `, [enchantedMesaSnapped, splitPoint, bufferSize]);
      
      console.log(`   📏 Enchanted Mesa split into ${splitEnchantedMesaResult.rows.length} segments:`);
      
      let validSegments = 0;
      for (let i = 0; i < splitEnchantedMesaResult.rows.length; i++) {
        const segment = splitEnchantedMesaResult.rows[i];
        const lengthResult = await pgClient.query(`
          SELECT ST_Length($1::geometry::geography) as length_meters
        `, [segment.segment]);
        
        const lengthMeters = lengthResult.rows[0].length_meters;
        if (lengthMeters > 1) { // Only count segments longer than 1 meter
          console.log(`      Segment ${i + 1}: ${Math.round(lengthMeters)}m`);
          validSegments++;
        } else {
          console.log(`      Segment ${i + 1}: ${Math.round(lengthMeters)}m (too short, will be filtered)`);
        }
      }
      
      console.log(`   ✅ Valid segments created: ${validSegments}`);
      console.log(`   🚫 Kohler Spur trail remains UNCHANGED (not split)`);
      
      // Verify the split worked correctly
      const totalLengthResult = await pgClient.query(`
        SELECT 
          ST_Length($1::geometry::geography) as original_length,
          (SELECT SUM(ST_Length(geom::geography)) 
           FROM (SELECT (ST_Dump(ST_Split($1::geometry, ST_Buffer($2::geometry, $3)))).geom) as segments
           WHERE ST_Length(geom::geography) > 1) as split_length
      `, [enchantedMesaSnapped, splitPoint, bufferSize]);
      
      const originalLength = totalLengthResult.rows[0].original_length;
      const splitLength = totalLengthResult.rows[0].split_length || 0;
      const lengthDifference = Math.abs(originalLength - splitLength);
      
      console.log(`\n📊 Split verification:`);
      console.log(`   Original Enchanted Mesa length: ${Math.round(originalLength)}m`);
      console.log(`   Total split segments length: ${Math.round(splitLength)}m`);
      console.log(`   Length difference: ${Math.round(lengthDifference)}m`);
      
      if (lengthDifference < 10) { // Allow small difference due to buffer
        console.log(`   ✅ Split verification passed - lengths match within tolerance`);
      } else {
        console.log(`   ⚠️ Split verification warning - significant length difference`);
      }
      
    } else {
      console.log(`   ⚠️ No intersections found - no splitting needed`);
    }
    
    console.log(`\n✅ COTREX prototype splitting completed successfully!`);
    console.log(`🎯 Only Enchanted Mesa trail was split, Kohler Spur remains unchanged`);
    
    // Step 4: Export the results to GeoJSON for verification
    console.log(`\n📄 Exporting results to GeoJSON...`);
    
    const exportResult = await pgClient.query(`
      WITH split_results AS (
        SELECT 
          'Enchanted Mesa (COTREX) - Original' as name,
          $1::geometry as geom,
          'original' as type
        UNION ALL
        SELECT 
          'Kohler Spur (COTREX) - Unchanged' as name,
          $2::geometry as geom,
          'unchanged' as type
        UNION ALL
        SELECT 
          'Intersection Point' as name,
          $3::geometry as geom,
          'intersection' as type
      )
      SELECT 
        json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(
            json_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(geom)::json,
              'properties', json_build_object(
                'name', name,
                'type', type
              )
            )
          )
        ) as geojson
      FROM split_results
    `, [enchantedMesaSnapped, kohlerSpurSnapped, intersectionResult.rows[0]?.pt]);
    
    const fs = require('fs');
    fs.writeFileSync('test-output/cotrex-split-results-clean.geojson', JSON.stringify(exportResult.rows[0].geojson, null, 2));
    console.log(`✅ Results exported to test-output/cotrex-split-results-clean.geojson`);
    
  } catch (error) {
    console.error('❌ Error testing COTREX prototype splitting:', error);
  } finally {
    await pgClient.end();
  }
}

testCOTREXPrototypeSplittingFixed();
