const { Pool } = require('pg');

async function testPrototypeOnStaging() {
  const pgClient = new Pool({
    host: 'localhost',
    user: 'shaydu',
    password: '',
    database: 'trail_master_db'
  });

  try {
    // Find the staging schema
    const schemaResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schema found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📁 Using staging schema: ${stagingSchema}`);

    // Get the trails from staging schema
    const trailsResult = await pgClient.query(`
      SELECT name, app_uuid, ST_AsText(geometry) as geom_text
      FROM ${stagingSchema}.trails 
      WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
      ORDER BY name
    `);
    
    console.log(`🔍 Found ${trailsResult.rows.length} trails in staging:`);
    trailsResult.rows.forEach(trail => {
      console.log(`   - ${trail.name} (${trail.app_uuid})`);
    });
    
    if (trailsResult.rows.length < 2) {
      console.log('❌ Need both Enchanted Mesa and Kohler trails in staging');
      return;
    }
    
    const enchantedMesa = trailsResult.rows.find(t => t.name === 'Enchanted Mesa Trail');
    const kohlerSpur = trailsResult.rows.find(t => t.name === 'Enchanted-Kohler Spur Trail');
    
    console.log(`\n🔗 Testing prototype logic on staging data: ${enchantedMesa.name} <-> ${kohlerSpur.name}`);
    
    // Step 1: Round coordinates to 6 decimal places (exactly like prototype)
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
    
    // Step 2: Snap with 1e-6 tolerance (exactly like prototype)
    const snappedResult = await pgClient.query(`
      SELECT 
        ST_Snap($1::geometry, $2::geometry, 1e-6) AS enchanted_mesa_snapped,
        ST_Snap($2::geometry, $1::geometry, 1e-6) AS kohler_spur_snapped
    `, [enchantedMesaRounded, kohlerSpurRounded]);
    
    const enchantedMesaSnapped = snappedResult.rows[0].enchanted_mesa_snapped;
    const kohlerSpurSnapped = snappedResult.rows[0].kohler_spur_snapped;
    
    // Step 3: Find intersections (exactly like prototype)
    const intersectionResult = await pgClient.query(`
      SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt
    `, [enchantedMesaSnapped, kohlerSpurSnapped]);
    
    console.log(`🔍 Found ${intersectionResult.rows.length} intersection(s)`);
    
    if (intersectionResult.rows.length === 0) {
      console.log('❌ No intersections found - prototype logic failed on staging data');
      return;
    }
    
    // Step 4: Split both trails at intersection points (exactly like prototype)
    for (const intersection of intersectionResult.rows) {
      const splitPoint = intersection.pt;
      console.log(`   ✅ Intersection point: ${splitPoint}`);
      
      // Split Enchanted Mesa
      const splitEnchantedMesaResult = await pgClient.query(`
        SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
      `, [enchantedMesaSnapped, splitPoint]);
      
      console.log(`   📏 Enchanted Mesa split into ${splitEnchantedMesaResult.rows.length} segments`);
      
      // Split Kohler Spur
      const splitKohlerSpurResult = await pgClient.query(`
        SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
      `, [kohlerSpurSnapped, splitPoint]);
      
      console.log(`   📏 Kohler Spur split into ${splitKohlerSpurResult.rows.length} segments`);
    }
    
    console.log('✅ Prototype on staging data test completed successfully!');
    
  } catch (error) {
    console.error('❌ Error testing prototype on staging data:', error);
  } finally {
    await pgClient.end();
  }
}

testPrototypeOnStaging();
