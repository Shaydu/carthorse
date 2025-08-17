const { Pool } = require('pg');

async function debugIntersectionSplitting() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu',
    password: ''
  });

  try {
    console.log('🔍 Debugging intersection splitting...');

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

    // Step 1: Find trail pairs that are geometrically close
    const closeTrailsResult = await pgClient.query(`
      WITH trail_pairs AS (
        SELECT DISTINCT
          t1.id as trail1_id,
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.id as trail2_id,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t2.geometry as trail2_geom
        FROM ${stagingSchema}.trails t1
        CROSS JOIN ${stagingSchema}.trails t2
        WHERE t1.id < t2.id  -- Avoid duplicate pairs
          AND ST_DWithin(t1.geometry, t2.geometry, 0.001)  -- Within ~100m
          AND NOT ST_Intersects(t1.geometry, t2.geometry)  -- Don't already intersect
      )
      SELECT * FROM trail_pairs
      LIMIT 5
    `);

    console.log(`🔗 Found ${closeTrailsResult.rows.length} potential T-intersection pairs`);

    for (const pair of closeTrailsResult.rows) {
      console.log(`\n🔍 Processing pair: ${pair.trail1_name} <-> ${pair.trail2_name}`);
      console.log(`   Trail 1 ID: ${pair.trail1_id}, UUID: ${pair.trail1_uuid}`);
      console.log(`   Trail 2 ID: ${pair.trail2_id}, UUID: ${pair.trail2_uuid}`);
      
      // Check original geometries
      const originalGeomResult = await pgClient.query(`
        SELECT 
          ST_AsText($1::geometry) as trail1_text,
          ST_AsText($2::geometry) as trail2_text,
          ST_Distance($1::geometry, $2::geometry) as distance
      `, [pair.trail1_geom, pair.trail2_geom]);
      
      console.log(`   Original distance: ${originalGeomResult.rows[0].distance}`);
      console.log(`   Trail 1 geometry: ${originalGeomResult.rows[0].trail1_text.substring(0, 100)}...`);
      console.log(`   Trail 2 geometry: ${originalGeomResult.rows[0].trail2_text.substring(0, 100)}...`);

      // Step 2: Apply prototype logic - round coordinates to 6 decimal places
      const roundedResult = await pgClient.query(`
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
        )
        SELECT trail1_rounded, trail2_rounded FROM rounded_trails
      `, [pair.trail1_geom, pair.trail2_geom]);

      if (roundedResult.rows.length === 0) {
        console.log(`   ❌ No rounded geometries created`);
        continue;
      }
      
      const trail1Rounded = roundedResult.rows[0].trail1_rounded;
      const trail2Rounded = roundedResult.rows[0].trail2_rounded;

      // Check rounded geometries
      const roundedGeomResult = await pgClient.query(`
        SELECT 
          ST_AsText($1::geometry) as trail1_rounded_text,
          ST_AsText($2::geometry) as trail2_rounded_text,
          ST_Distance($1::geometry, $2::geometry) as rounded_distance
      `, [trail1Rounded, trail2Rounded]);
      
      console.log(`   Rounded distance: ${roundedGeomResult.rows[0].rounded_distance}`);

      // Step 3: Snap trails with 1e-6 tolerance
      const snappedResult = await pgClient.query(`
        SELECT 
          ST_Snap($1::geometry, $2::geometry, 1e-6) AS trail1_snapped,
          ST_Snap($2::geometry, $1::geometry, 1e-6) AS trail2_snapped
      `, [trail1Rounded, trail2Rounded]);

      const trail1Snapped = snappedResult.rows[0].trail1_snapped;
      const trail2Snapped = snappedResult.rows[0].trail2_snapped;

      // Check snapped geometries
      const snappedGeomResult = await pgClient.query(`
        SELECT 
          ST_Distance($1::geometry, $2::geometry) as snapped_distance,
          ST_Intersects($1::geometry, $2::geometry) as intersects_after_snap
      `, [trail1Snapped, trail2Snapped]);
      
      console.log(`   Snapped distance: ${snappedGeomResult.rows[0].snapped_distance}`);
      console.log(`   Intersects after snap: ${snappedGeomResult.rows[0].intersects_after_snap}`);

      // Step 4: Find intersections
      const intersectionResult = await pgClient.query(`
        SELECT 
          (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt,
          ST_GeometryType((ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom) as geom_type
      `, [trail1Snapped, trail2Snapped]);

      console.log(`   Found ${intersectionResult.rows.length} intersection(s)`);
      
      for (let i = 0; i < intersectionResult.rows.length; i++) {
        const intersection = intersectionResult.rows[i];
        console.log(`   Intersection ${i + 1}: ${intersection.geom_type} - ${intersection.pt}`);
      }

      if (intersectionResult.rows.length === 0) {
        console.log(`   ⚠️ No intersections found`);
        continue;
      }

      // Step 5: Test splitting
      for (const intersection of intersectionResult.rows) {
        const splitPoint = intersection.pt;
        
        console.log(`   Testing split with point: ${splitPoint}`);
        
        // Split trail 1
        const splitTrail1Result = await pgClient.query(`
          SELECT 
            (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment,
            ST_Length((ST_Dump(ST_Split($1::geometry, $2::geometry))).geom::geography) as length_meters
        `, [trail1Snapped, splitPoint]);
        
        console.log(`   Trail 1 split into ${splitTrail1Result.rows.length} segments`);
        for (let i = 0; i < splitTrail1Result.rows.length; i++) {
          console.log(`     Segment ${i + 1}: ${splitTrail1Result.rows[i].length_meters.toFixed(2)}m`);
        }
        
        // Split trail 2
        const splitTrail2Result = await pgClient.query(`
          SELECT 
            (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment,
            ST_Length((ST_Dump(ST_Split($1::geometry, $2::geometry))).geom::geography) as length_meters
        `, [trail2Snapped, splitPoint]);
        
        console.log(`   Trail 2 split into ${splitTrail2Result.rows.length} segments`);
        for (let i = 0; i < splitTrail2Result.rows.length; i++) {
          console.log(`     Segment ${i + 1}: ${splitTrail2Result.rows[i].length_meters.toFixed(2)}m`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

debugIntersectionSplitting();
