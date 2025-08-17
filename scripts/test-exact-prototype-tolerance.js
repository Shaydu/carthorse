const { Pool } = require('pg');

async function testExactPrototypeTolerance() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu',
    password: ''
  });

  try {
    console.log('🔍 Testing exact prototype tolerance (1e-6)...');

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
    console.log(`  Enchanted Mesa: ${enchantedMesa.name} - ${(enchantedMesa.length_meters / 1000).toFixed(3)}km`);
    console.log(`  Kohler Spur: ${kohlerSpur.name} - ${(kohlerSpur.length_meters / 1000).toFixed(3)}km`);

    // Test the exact prototype logic with 1e-6 tolerance
    console.log(`\n🔬 Testing exact prototype logic (1e-6 tolerance):`);
    
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

    // Step 2: Snap with 1e-6 tolerance (EXACT SAME AS PROTOTYPE)
    const snappedResult = await pgClient.query(`
      SELECT 
        ST_Snap($1::geometry, $2::geometry, 1e-6) AS enchanted_mesa_snapped,
        ST_Snap($2::geometry, $1::geometry, 1e-6) AS kohler_spur_snapped
    `, [enchantedMesaRounded, kohlerSpurRounded]);

    const enchantedMesaSnapped = snappedResult.rows[0].enchanted_mesa_snapped;
    const kohlerSpurSnapped = snappedResult.rows[0].kohler_spur_snapped;

    // Step 3: Find intersections
    const intersectionResult = await pgClient.query(`
      SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt
    `, [enchantedMesaSnapped, kohlerSpurSnapped]);

    console.log(`✅ Found ${intersectionResult.rows.length} intersection(s)`);

    if (intersectionResult.rows.length > 0) {
      console.log(`🎯 Intersection types:`);
      intersectionResult.rows.forEach((intersection, i) => {
        const geomType = intersection.pt.substring(0, 2);
        let typeName = 'Unknown';
        if (geomType === '01') typeName = 'Point';
        else if (geomType === '02') typeName = 'LineString';
        console.log(`  ${i + 1}. ${typeName}: ${intersection.pt.substring(0, 50)}...`);
      });

      // Only proceed if we have point intersections
      const pointIntersections = intersectionResult.rows.filter(intersection => 
        intersection.pt.substring(0, 2) === '01'
      );

      if (pointIntersections.length > 0) {
        console.log(`\n✂️ Testing splitting with ${pointIntersections.length} point intersection(s):`);
        for (const intersection of pointIntersections) {
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
        console.log(`❌ No point intersections found - only line intersections`);
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

testExactPrototypeTolerance();
