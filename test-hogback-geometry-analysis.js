#!/usr/bin/env node

const { Client } = require('pg');

async function analyzeHogbackGeometry() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('🔍 Analyzing Hogback Ridge geometry...');

    // Get Hogback Ridge trail details
    const hogbackTrail = await client.query(`
      SELECT 
        app_uuid,
        name,
        ST_IsSimple(geometry) as is_simple,
        ST_IsValid(geometry) as is_valid,
        ST_Length(geometry::geography) as length_meters,
        ST_NumPoints(geometry) as num_points,
        ST_StartPoint(geometry) as start_point,
        ST_EndPoint(geometry) as end_point,
        ST_Distance(ST_StartPoint(geometry), ST_EndPoint(geometry)) as start_end_distance,
        ST_GeometryType(geometry) as geometry_type,
        ST_AsText(ST_StartPoint(geometry)) as start_point_text,
        ST_AsText(ST_EndPoint(geometry)) as end_point_text
      FROM public.trails 
      WHERE name ILIKE '%hogback ridge%'
      LIMIT 1
    `);

    if (hogbackTrail.rows.length === 0) {
      console.log('❌ No Hogback Ridge trail found');
      return;
    }

    const trail = hogbackTrail.rows[0];
    console.log('\n📊 Hogback Ridge Trail Analysis:');
    console.log(`   Name: ${trail.name}`);
    console.log(`   UUID: ${trail.app_uuid}`);
    console.log(`   Is Simple: ${trail.is_simple}`);
    console.log(`   Is Valid: ${trail.is_valid}`);
    console.log(`   Length: ${trail.length_meters.toFixed(1)} meters`);
    console.log(`   Points: ${trail.num_points}`);
    console.log(`   Geometry Type: ${trail.geometry_type}`);
    console.log(`   Start-End Distance: ${trail.start_end_distance.toFixed(6)} degrees`);
    console.log(`   Start Point: ${trail.start_point_text}`);
    console.log(`   End Point: ${trail.end_point_text}`);

    // Check if it's actually a loop (start and end points are close)
    const isLoop = trail.start_end_distance < 0.001; // Within ~100 meters
    console.log(`\n🔍 Loop Analysis:`);
    console.log(`   Is Loop (start/end close): ${isLoop}`);
    
    if (isLoop) {
      console.log(`   ✅ Trail forms a loop (start and end points are close)`);
    } else {
      console.log(`   ❌ Trail does NOT form a loop (start and end points are far apart)`);
    }

    // Check for self-intersections
    console.log(`\n🔍 Self-Intersection Analysis:`);
    if (!trail.is_simple) {
      console.log(`   ❌ Trail is NOT simple (has self-intersections)`);
      
      // Try to find the self-intersection points
      const selfIntersection = await client.query(`
        SELECT 
          ST_GeometryType(ST_Intersection(geometry, geometry)) as intersection_type,
          ST_NumGeometries(ST_Intersection(geometry, geometry)) as intersection_count,
          ST_AsText(ST_Intersection(geometry, geometry)) as intersection_text
        FROM public.trails 
        WHERE app_uuid = $1
      `, [trail.app_uuid]);

      const intersection = selfIntersection.rows[0];
      console.log(`   Intersection Type: ${intersection.intersection_type}`);
      console.log(`   Intersection Count: ${intersection.intersection_count}`);
      console.log(`   Intersection Geometry: ${intersection.intersection_text}`);
      
    } else {
      console.log(`   ✅ Trail is simple (no self-intersections)`);
    }

    // Check if we need to snap the endpoints to close the loop
    if (isLoop && trail.is_simple) {
      console.log(`\n🔧 Loop Gap Analysis:`);
      console.log(`   The trail forms a loop but has a gap between start and end points`);
      console.log(`   This is why it's not being detected as self-intersecting`);
      console.log(`   We should snap the endpoints to close the loop`);
      
      // Calculate the gap distance in meters
      const gapDistanceMeters = trail.start_end_distance * 111320; // Convert degrees to meters
      console.log(`   Gap distance: ${gapDistanceMeters.toFixed(1)} meters`);
      
      if (gapDistanceMeters < 10) {
        console.log(`   ✅ Gap is small (< 10m) - can be snapped to close the loop`);
      } else {
        console.log(`   ⚠️ Gap is large (${gapDistanceMeters.toFixed(1)}m) - may need different approach`);
      }
    }

    // Test snapping the endpoints to close the loop
    console.log(`\n🧪 Testing endpoint snapping to close the loop...`);
    const snappedGeometry = await client.query(`
      SELECT 
        ST_AsText(ST_Snap(geometry, ST_StartPoint(geometry), 0.001)) as snapped_geometry_text,
        ST_IsSimple(ST_Snap(geometry, ST_StartPoint(geometry), 0.001)) as snapped_is_simple,
        ST_Length(ST_Snap(geometry, ST_StartPoint(geometry), 0.001)::geography) as snapped_length
      FROM public.trails 
      WHERE app_uuid = $1
    `, [trail.app_uuid]);

    const snapped = snappedGeometry.rows[0];
    console.log(`   Snapped Is Simple: ${snapped.snapped_is_simple}`);
    console.log(`   Snapped Length: ${snapped.snapped_length.toFixed(1)} meters`);
    
    if (snapped.snapped_is_simple === false) {
      console.log(`   ✅ Successfully created self-intersecting loop by snapping endpoints!`);
    } else {
      console.log(`   ❌ Snapping didn't create self-intersection - may need larger tolerance`);
    }

  } catch (error) {
    console.error('\n❌ Analysis failed:', error.message);
  } finally {
    await client.end();
  }
}

analyzeHogbackGeometry();
