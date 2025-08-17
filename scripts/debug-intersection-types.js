const { Pool } = require('pg');

async function debugIntersectionTypes() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu',
    password: ''
  });

  try {
    console.log('🔍 Debugging intersection types...');

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

    const enchantedMesa = trailsResult.rows.find(t => t.name === 'Enchanted Mesa Trail');
    const kohlerSpur = trailsResult.rows.find(t => t.name === 'Enchanted-Kohler Spur Trail');

    console.log(`\n📊 Original trails:`);
    console.log(`  Enchanted Mesa: ${(enchantedMesa.length_meters / 1000).toFixed(3)}km`);
    console.log(`  Kohler Spur: ${(kohlerSpur.length_meters / 1000).toFixed(3)}km`);

    // Test different snapping tolerances
    const tolerances = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2];
    
    for (const tolerance of tolerances) {
      console.log(`\n🔧 Testing tolerance: ${tolerance}`);
      
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

      if (roundedResult.rows.length === 0) continue;
      
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

      // Check intersection types
      const intersectionResult = await pgClient.query(`
        SELECT 
          (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS intersection_geom,
          ST_GeometryType((ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom) AS geom_type
      `, [enchantedMesaSnapped, kohlerSpurSnapped]);

      console.log(`  Intersections found: ${intersectionResult.rows.length}`);
      
      const pointIntersections = intersectionResult.rows.filter(row => 
        row.geom_type === 'ST_Point'
      );
      const lineIntersections = intersectionResult.rows.filter(row => 
        row.geom_type === 'ST_LineString'
      );
      
      console.log(`  Point intersections: ${pointIntersections.length}`);
      console.log(`  Line intersections: ${lineIntersections.length}`);
      
      if (pointIntersections.length > 0) {
        console.log(`  ✅ Found point intersection(s) - this should work for splitting!`);
        break;
      }
    }

    // Test without rounding (just snapping)
    console.log(`\n🔧 Testing without coordinate rounding (just snapping):`);
    const tolerances2 = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2];
    
    for (const tolerance of tolerances2) {
      console.log(`\n  Testing tolerance: ${tolerance}`);
      
      const snappedResult = await pgClient.query(`
        SELECT 
          ST_Snap($1::geometry, $2::geometry, $3) AS enchanted_mesa_snapped,
          ST_Snap($2::geometry, $1::geometry, $3) AS kohler_spur_snapped
      `, [enchantedMesa.geom_text, kohlerSpur.geom_text, tolerance]);

      const enchantedMesaSnapped = snappedResult.rows[0].enchanted_mesa_snapped;
      const kohlerSpurSnapped = snappedResult.rows[0].kohler_spur_snapped;

      const intersectionResult = await pgClient.query(`
        SELECT 
          (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS intersection_geom,
          ST_GeometryType((ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom) AS geom_type
      `, [enchantedMesaSnapped, kohlerSpurSnapped]);

      const pointIntersections = intersectionResult.rows.filter(row => 
        row.geom_type === 'ST_Point'
      );
      const lineIntersections = intersectionResult.rows.filter(row => 
        row.geom_type === 'ST_LineString'
      );
      
      console.log(`    Point intersections: ${pointIntersections.length}`);
      console.log(`    Line intersections: ${lineIntersections.length}`);
      
      if (pointIntersections.length > 0) {
        console.log(`    ✅ Found point intersection(s) - this should work for splitting!`);
        break;
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

debugIntersectionTypes();
