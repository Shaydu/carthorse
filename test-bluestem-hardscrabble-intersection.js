const { Client } = require('pg');

async function testBluestemHardscrabbleIntersection() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('🔍 Testing Bluestem-Hardscrabble intersection at (-105.260583, 39.961661)...\n');

    const intersectionPoint = 'POINT(-105.260583 39.961661)';
    const tolerance = 50; // 50 meters

    // Step 1: Find Bluestem and Hardscrabble trails
    console.log('🔍 Step 1: Finding Bluestem and Hardscrabble trails...');
    const trailsResult = await client.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsText(geometry) as geom_text,
        ST_Length(geometry::geography) as length_meters,
        ST_Distance(ST_GeomFromText($1, 4326), geometry) as distance_to_intersection
      FROM public.trails 
      WHERE name ILIKE '%bluestem%' OR name ILIKE '%hardscrabble%'
      ORDER BY name
    `, [intersectionPoint]);

    console.log(`📊 Found ${trailsResult.rows.length} trails:`);
    trailsResult.rows.forEach(trail => {
      console.log(`   - ${trail.name} (${trail.app_uuid})`);
      console.log(`     Length: ${trail.length_meters?.toFixed(1)}m`);
      console.log(`     Distance to intersection: ${trail.distance_to_intersection?.toFixed(1)}m`);
    });

    if (trailsResult.rows.length < 2) {
      console.log('❌ Need at least 2 trails (Bluestem and Hardscrabble) for intersection test');
      return;
    }

    // Step 2: Check if trails actually intersect
    console.log('\n🔍 Step 2: Checking if trails intersect...');
    const intersectionResult = await client.query(`
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_Intersects(t1.geometry, t2.geometry) as intersects,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_point,
        ST_Distance(t1.geometry::geography, t2.geometry::geography) as min_distance_meters
      FROM public.trails t1
      JOIN public.trails t2 ON t1.app_uuid < t2.app_uuid
      WHERE (t1.name ILIKE '%bluestem%' AND t2.name ILIKE '%hardscrabble%')
         OR (t1.name ILIKE '%hardscrabble%' AND t2.name ILIKE '%bluestem%')
    `);

    console.log(`📊 Intersection analysis (${intersectionResult.rows.length} pairs):`);
    intersectionResult.rows.forEach(row => {
      console.log(`   ${row.trail1_name} ↔ ${row.trail2_name}:`);
      console.log(`     Intersects: ${row.intersects}`);
      console.log(`     Intersection type: ${row.intersection_type}`);
      console.log(`     Intersection point: ${row.intersection_point}`);
      console.log(`     Min distance: ${row.min_distance_meters?.toFixed(1)}m`);
    });

    // Step 3: Check for near-miss (gap) at the specific coordinates
    console.log('\n🔍 Step 3: Checking for gap at specific coordinates...');
    const gapResult = await client.query(`
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_Distance(ST_ClosestPoint(t1.geometry, ST_GeomFromText($1, 4326)), ST_GeomFromText($1, 4326)) as t1_distance_to_point,
        ST_Distance(ST_ClosestPoint(t2.geometry, ST_GeomFromText($1, 4326)), ST_GeomFromText($1, 4326)) as t2_distance_to_point,
        ST_Distance(ST_ClosestPoint(t1.geometry, ST_ClosestPoint(t2.geometry, ST_GeomFromText($1, 4326))), ST_ClosestPoint(t2.geometry, ST_GeomFromText($1, 4326))) as gap_distance
      FROM public.trails t1
      JOIN public.trails t2 ON t1.app_uuid < t2.app_uuid
      WHERE (t1.name ILIKE '%bluestem%' AND t2.name ILIKE '%hardscrabble%')
         OR (t1.name ILIKE '%hardscrabble%' AND t2.name ILIKE '%bluestem%')
    `, [intersectionPoint]);

    console.log(`📊 Gap analysis:`);
    gapResult.rows.forEach(row => {
      console.log(`   ${row.trail1_name} ↔ ${row.trail2_name}:`);
      console.log(`     Trail1 distance to intersection point: ${row.t1_distance_to_point?.toFixed(1)}m`);
      console.log(`     Trail2 distance to intersection point: ${row.t2_distance_to_point?.toFixed(1)}m`);
      console.log(`     Gap between trails at intersection: ${row.gap_distance?.toFixed(1)}m`);
      
      if (row.gap_distance > 0 && row.gap_distance < tolerance) {
        console.log(`     💡 GAP DETECTED: ${row.gap_distance.toFixed(1)}m gap needs to be bridged!`);
      }
    });

    // Step 4: Check if trails are in the staging schema
    console.log('\n🔍 Step 4: Checking staging schema for trails...');
    const stagingSchemaResult = await client.query(`
      SELECT schemaname 
      FROM pg_tables 
      WHERE tablename = 'trails' 
        AND schemaname LIKE 'staging%'
      ORDER BY schemaname DESC 
      LIMIT 1
    `);

    if (stagingSchemaResult.rows.length > 0) {
      const stagingSchema = stagingSchemaResult.rows[0].schemaname;
      console.log(`📋 Using staging schema: ${stagingSchema}`);

      const stagingTrailsResult = await client.query(`
        SELECT 
          name,
          ST_AsText(geometry) as geom_text,
          ST_Length(geometry::geography) as length_meters
        FROM ${stagingSchema}.trails 
        WHERE name ILIKE '%bluestem%' OR name ILIKE '%hardscrabble%'
        ORDER BY name
      `);

      console.log(`📊 Staging trails (${stagingTrailsResult.rows.length}):`);
      stagingTrailsResult.rows.forEach(trail => {
        console.log(`   - ${trail.name} (${trail.length_meters?.toFixed(1)}m)`);
      });

      // Check intersection points in staging
      const stagingIntersectionResult = await client.query(`
        SELECT 
          connected_trail_names,
          ST_AsText(point) as point_text,
          node_type,
          distance_meters
        FROM ${stagingSchema}.intersection_points
        WHERE 'Bluestem' = ANY(connected_trail_names) 
           OR 'Hardscrabble' = ANY(connected_trail_names)
        ORDER BY connected_trail_names
      `);

      console.log(`📊 Staging intersection points (${stagingIntersectionResult.rows.length}):`);
      stagingIntersectionResult.rows.forEach(row => {
        console.log(`   - ${row.connected_trail_names.join(' ↔ ')}: ${row.node_type} at ${row.point_text} (${row.distance_meters?.toFixed(1)}m)`);
      });
    }

    // Step 5: Test Y-intersection splitting logic
    console.log('\n🔍 Step 5: Testing Y-intersection splitting logic...');
    const yIntersectionResult = await client.query(`
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t2.geometry as trail2_geom
        FROM public.trails t1
        JOIN public.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE (t1.name ILIKE '%bluestem%' AND t2.name ILIKE '%hardscrabble%')
           OR (t1.name ILIKE '%hardscrabble%' AND t2.name ILIKE '%bluestem%')
      )
      SELECT 
        trail1_name,
        trail2_name,
        ST_Distance(trail1_geom::geography, trail2_geom::geography) as min_distance,
        ST_AsText(ST_ClosestPoint(trail1_geom, ST_ClosestPoint(trail2_geom, ST_GeomFromText($1, 4326)))) as closest_point,
        CASE 
          WHEN ST_Distance(trail1_geom::geography, trail2_geom::geography) <= $2 THEN 'Y-intersection candidate'
          ELSE 'No Y-intersection'
        END as intersection_status
      FROM trail_pairs
    `, [intersectionPoint, tolerance]);

    console.log(`📊 Y-intersection analysis:`);
    yIntersectionResult.rows.forEach(row => {
      console.log(`   ${row.trail1_name} ↔ ${row.trail2_name}:`);
      console.log(`     Min distance: ${row.min_distance?.toFixed(1)}m`);
      console.log(`     Closest point: ${row.closest_point}`);
      console.log(`     Status: ${row.intersection_status}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

testBluestemHardscrabbleIntersection();
