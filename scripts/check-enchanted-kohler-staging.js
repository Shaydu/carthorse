const { Pool } = require('pg');

async function checkEnchantedKohlerStaging() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu',
    password: ''
  });

  try {
    console.log('🔍 Checking Enchanted Mesa and Kohler Spur in staging...');

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

    // Find Enchanted Mesa and Kohler Spur trails
    const trailsResult = await pgClient.query(`
      SELECT id, app_uuid, name, ST_AsText(geometry) as geom_text, ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails 
      WHERE name LIKE '%Enchanted%' OR name LIKE '%Kohler%'
      ORDER BY name
    `);

    console.log(`Found ${trailsResult.rows.length} trails:`);
    for (const trail of trailsResult.rows) {
      console.log(`  ${trail.name} (ID: ${trail.id}, UUID: ${trail.app_uuid}, Length: ${trail.length_meters.toFixed(2)}m)`);
      console.log(`    Geometry: ${trail.geom_text.substring(0, 200)}...`);
    }

    if (trailsResult.rows.length >= 2) {
      const trail1 = trailsResult.rows[0];
      const trail2 = trailsResult.rows[1];
      
      console.log(`\n🔍 Analyzing pair: ${trail1.name} <-> ${trail2.name}`);
      
      // Check distance and intersection
      const analysisResult = await pgClient.query(`
        SELECT 
          ST_Distance($1::geometry, $2::geometry) as distance,
          ST_Intersects($1::geometry, $2::geometry) as intersects,
          ST_DWithin($1::geometry, $2::geometry, 0.001) as within_100m,
          ST_DWithin($1::geometry, $2::geometry, 0.0001) as within_10m,
          ST_DWithin($1::geometry, $2::geometry, 0.00001) as within_1m
      `, [trail1.geom_text, trail2.geom_text]);
      
      const analysis = analysisResult.rows[0];
      console.log(`  Distance: ${analysis.distance}`);
      console.log(`  Intersects: ${analysis.intersects}`);
      console.log(`  Within 100m: ${analysis.within_100m}`);
      console.log(`  Within 10m: ${analysis.within_10m}`);
      console.log(`  Within 1m: ${analysis.within_1m}`);

      // Try different snapping tolerances
      console.log(`\n🔧 Testing different snapping tolerances:`);
      const tolerances = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2];
      
      for (const tolerance of tolerances) {
        const snapResult = await pgClient.query(`
          SELECT 
            ST_Distance(
              ST_Snap($1::geometry, $2::geometry, $3),
              ST_Snap($2::geometry, $1::geometry, $3)
            ) as snapped_distance,
            ST_Intersects(
              ST_Snap($1::geometry, $2::geometry, $3),
              ST_Snap($2::geometry, $1::geometry, $3)
            ) as snapped_intersects
        `, [trail1.geom_text, trail2.geom_text, tolerance]);
        
        const snap = snapResult.rows[0];
        console.log(`  Tolerance ${tolerance}: distance=${snap.snapped_distance}, intersects=${snap.snapped_intersects}`);
      }

      // Try the exact prototype approach with 6-decimal rounding
      console.log(`\n🔧 Testing prototype approach with 6-decimal rounding:`);
      const prototypeResult = await pgClient.query(`
        WITH rounded_trails AS (
          SELECT 
            ST_GeomFromText(
              'LINESTRING(' || 
              string_agg(
                ROUND(ST_X(pt1)::numeric, 6) || ' ' || ROUND(ST_Y(pt1)::numeric, 6),
                ',' ORDER BY ST_LineLocatePoint($1::geometry, pt1)
              ) || 
              ')'
            ) as trail1_rounded,
            ST_GeomFromText(
              'LINESTRING(' || 
              string_agg(
                ROUND(ST_X(pt2)::numeric, 6) || ' ' || ROUND(ST_Y(pt2)::numeric, 6),
                ',' ORDER BY ST_LineLocatePoint($2::geometry, pt2)
              ) || 
              ')'
            ) as trail2_rounded
          FROM 
            (SELECT (ST_DumpPoints($1::geometry)).geom AS pt1) as points1,
            (SELECT (ST_DumpPoints($2::geometry)).geom AS pt2) as points2
        ),
        snapped AS (
          SELECT 
            ST_Snap(trail1_rounded, trail2_rounded, 1e-6) AS trail1_snapped,
            ST_Snap(trail2_rounded, trail1_rounded, 1e-6) AS trail2_snapped
          FROM rounded_trails
        )
        SELECT 
          ST_Distance(trail1_snapped, trail2_snapped) as prototype_distance,
          ST_Intersects(trail1_snapped, trail2_snapped) as prototype_intersects,
          ST_NumGeometries(ST_Intersection(trail1_snapped, trail2_snapped)) as intersection_count
        FROM snapped
      `, [trail1.geom_text, trail2.geom_text]);
      
      if (prototypeResult.rows.length > 0) {
        const prototype = prototypeResult.rows[0];
        console.log(`  Prototype distance: ${prototype.prototype_distance}`);
        console.log(`  Prototype intersects: ${prototype.prototype_intersects}`);
        console.log(`  Intersection count: ${prototype.intersection_count}`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

checkEnchantedKohlerStaging();
