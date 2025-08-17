const { Pool } = require('pg');

async function testEnchantedIntersection() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu',
    password: ''
  });

  try {
    console.log('🔍 Testing Enchanted Mesa and Enchanted-Kohler Spur intersection...');

    // Get the staging schema
    const schemaResult = await pgClient.query(`
      SELECT schema_name FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schema found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📁 Using staging schema: ${stagingSchema}`);

    // Get the specific trails
    const trailsResult = await pgClient.query(`
      SELECT 
        id, app_uuid, name, 
        ST_AsText(geometry) as geom_text,
        ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails 
      WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
      ORDER BY name
    `);

    if (trailsResult.rows.length !== 2) {
      console.log(`❌ Expected 2 trails, found ${trailsResult.rows.length}`);
      return;
    }

    const enchantedMesa = trailsResult.rows.find(t => t.name === 'Enchanted Mesa Trail');
    const kohlerSpur = trailsResult.rows.find(t => t.name === 'Enchanted-Kohler Spur Trail');

    console.log(`\n📊 Trail details:`);
    console.log(`  Enchanted Mesa: ${enchantedMesa.name} (${enchantedMesa.app_uuid}) - ${(enchantedMesa.length_meters / 1000).toFixed(3)}km`);
    console.log(`  Kohler Spur: ${kohlerSpur.name} (${kohlerSpur.app_uuid}) - ${(kohlerSpur.length_meters / 1000).toFixed(3)}km`);

    // Check distance between trails
    const distanceResult = await pgClient.query(`
      SELECT ST_Distance($1::geometry, $2::geometry) as distance_degrees
    `, [enchantedMesa.geom_text, kohlerSpur.geom_text]);

    const distanceDegrees = distanceResult.rows[0].distance_degrees;
    const distanceMeters = distanceDegrees * 111000; // Rough conversion
    console.log(`\n📏 Distance between trails: ${distanceDegrees.toFixed(6)} degrees (≈ ${distanceMeters.toFixed(1)}m)`);

    // Test if they're within our DWithin threshold
    const dwithinResult = await pgClient.query(`
      SELECT ST_DWithin($1::geometry, $2::geometry, 0.001) as within_100m
    `, [enchantedMesa.geom_text, kohlerSpur.geom_text]);

    console.log(`🔍 Within 100m (0.001 degrees): ${dwithinResult.rows[0].within_100m}`);

    // Test with different thresholds
    const thresholds = [0.0001, 0.0005, 0.001, 0.002, 0.005];
    console.log(`\n🔍 Testing different DWithin thresholds:`);
    for (const threshold of thresholds) {
      const result = await pgClient.query(`
        SELECT ST_DWithin($1::geometry, $2::geometry, $3) as within_threshold
      `, [enchantedMesa.geom_text, kohlerSpur.geom_text, threshold]);
      console.log(`  ${threshold} degrees (≈ ${(threshold * 111000).toFixed(0)}m): ${result.rows[0].within_threshold}`);
    }

    // Test the full prototype logic
    console.log(`\n🔬 Testing full prototype logic:`);
    
    // Step 1: Round coordinates to 6 decimal places
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
      console.log(`❌ Failed to round coordinates`);
      return;
    }

    const enchantedMesaRounded = roundedResult.rows[0].enchanted_mesa_rounded;
    const kohlerSpurRounded = roundedResult.rows[0].kohler_spur_rounded;

    // Step 2: Snap with 1e-4 tolerance
    const snappedResult = await pgClient.query(`
      SELECT 
        ST_Snap($1::geometry, $2::geometry, 1e-4) AS enchanted_mesa_snapped,
        ST_Snap($2::geometry, $1::geometry, 1e-4) AS kohler_spur_snapped
    `, [enchantedMesaRounded, kohlerSpurRounded]);

    const enchantedMesaSnapped = snappedResult.rows[0].enchanted_mesa_snapped;
    const kohlerSpurSnapped = snappedResult.rows[0].kohler_spur_snapped;

    // Step 3: Find intersections
    const intersectionResult = await pgClient.query(`
      SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt
    `, [enchantedMesaSnapped, kohlerSpurSnapped]);

    console.log(`✅ Found ${intersectionResult.rows.length} intersection(s)`);

    if (intersectionResult.rows.length > 0) {
      console.log(`🎯 Intersection points:`);
      intersectionResult.rows.forEach((intersection, i) => {
        console.log(`  ${i + 1}. ${intersection.pt}`);
      });

      // Test splitting
      console.log(`\n✂️ Testing splitting:`);
      for (const intersection of intersectionResult.rows) {
        const splitPoint = intersection.pt;
        
        // Split Enchanted Mesa
        const splitEnchantedMesaResult = await pgClient.query(`
          SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
        `, [enchantedMesaSnapped, splitPoint]);
        
        console.log(`  Enchanted Mesa split into ${splitEnchantedMesaResult.rows.length} segments`);
        
        // Split Kohler Spur
        const splitKohlerSpurResult = await pgClient.query(`
          SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
        `, [kohlerSpurSnapped, splitPoint]);
        
        console.log(`  Kohler Spur split into ${splitKohlerSpurResult.rows.length} segments`);
      }
    } else {
      console.log(`❌ No intersections found after snapping`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testEnchantedIntersection();
