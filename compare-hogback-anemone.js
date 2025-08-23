#!/usr/bin/env node

const { Client } = require('pg');

async function compareHogbackAnemone() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('🔍 Comparing Hogback Ridge vs Anemone Loop...');

    // Get Hogback Ridge details
    console.log('\n📋 Hogback Ridge Analysis:');
    const hogbackTrails = await client.query(`
      SELECT id, app_uuid, name, 
             ST_Length(geometry::geography) as length_meters,
             ST_NumPoints(geometry) as num_points,
             ST_IsSimple(geometry) as is_simple,
             ST_GeometryType(geometry) as geom_type,
             ST_AsText(ST_StartPoint(geometry)) as start_point,
             ST_AsText(ST_EndPoint(geometry)) as end_point,
             ST_Equals(ST_StartPoint(geometry), ST_EndPoint(geometry)) as is_closed_loop
      FROM public.trails 
      WHERE name ILIKE '%hogback%'
      ORDER BY name
    `);

    if (hogbackTrails.rows.length === 0) {
      console.log('   ❌ No Hogback Ridge trails found in public.trails');
    } else {
      hogbackTrails.rows.forEach((trail, index) => {
        console.log(`   Trail ${index + 1}: ${trail.name}`);
        console.log(`     ID: ${trail.id}, UUID: ${trail.app_uuid}`);
        console.log(`     Length: ${trail.length_meters?.toFixed(2)}m, Points: ${trail.num_points}`);
        console.log(`     Is Simple: ${trail.is_simple}, Type: ${trail.geom_type}`);
        console.log(`     Start: ${trail.start_point}`);
        console.log(`     End: ${trail.end_point}`);
        console.log(`     Is Closed Loop: ${trail.is_closed_loop}`);
        console.log('');
      });
    }

    // Get Anemone Loop details
    console.log('\n📋 Anemone Loop Analysis:');
    const anemoneTrails = await client.query(`
      SELECT id, app_uuid, name, 
             ST_Length(geometry::geography) as length_meters,
             ST_NumPoints(geometry) as num_points,
             ST_IsSimple(geometry) as is_simple,
             ST_GeometryType(geometry) as geom_type,
             ST_AsText(ST_StartPoint(geometry)) as start_point,
             ST_AsText(ST_EndPoint(geometry)) as end_point,
             ST_Equals(ST_StartPoint(geometry), ST_EndPoint(geometry)) as is_closed_loop
      FROM public.trails 
      WHERE name ILIKE '%anemone%'
      ORDER BY name
    `);

    if (anemoneTrails.rows.length === 0) {
      console.log('   ❌ No Anemone Loop trails found in public.trails');
    } else {
      anemoneTrails.rows.forEach((trail, index) => {
        console.log(`   Trail ${index + 1}: ${trail.name}`);
        console.log(`     ID: ${trail.id}, UUID: ${trail.app_uuid}`);
        console.log(`     Length: ${trail.length_meters?.toFixed(2)}m, Points: ${trail.num_points}`);
        console.log(`     Is Simple: ${trail.is_simple}, Type: ${trail.geom_type}`);
        console.log(`     Start: ${trail.start_point}`);
        console.log(`     End: ${trail.end_point}`);
        console.log(`     Is Closed Loop: ${trail.is_closed_loop}`);
        console.log('');
      });
    }

    // Test self-intersection detection for both
    console.log('\n🔧 Testing Self-Intersection Detection:');
    
    // Test Hogback Ridge
    if (hogbackTrails.rows.length > 0) {
      const hogback = hogbackTrails.rows[0];
      console.log(`\n   Testing Hogback Ridge (${hogback.name}):`);
      
      const hogbackIntersection = await client.query(`
        SELECT 
          ST_GeometryType(ST_Intersection(geometry, geometry)) as intersection_type,
          ST_NumGeometries(ST_Intersection(geometry, geometry)) as intersection_count,
          ST_AsText(ST_Intersection(geometry, geometry)) as intersection_text
        FROM public.trails 
        WHERE app_uuid = $1
      `, [hogback.app_uuid]);

      console.log(`     Intersection Type: ${hogbackIntersection.rows[0].intersection_type}`);
      console.log(`     Intersection Count: ${hogbackIntersection.rows[0].intersection_count}`);
      console.log(`     Intersection Text: ${hogbackIntersection.rows[0].intersection_text}`);
    }

    // Test Anemone Loop
    if (anemoneTrails.rows.length > 0) {
      const anemone = anemoneTrails.rows[0];
      console.log(`\n   Testing Anemone Loop (${anemone.name}):`);
      
      const anemoneIntersection = await client.query(`
        SELECT 
          ST_GeometryType(ST_Intersection(geometry, geometry)) as intersection_type,
          ST_NumGeometries(ST_Intersection(geometry, geometry)) as intersection_count,
          ST_AsText(ST_Intersection(geometry, geometry)) as intersection_text
        FROM public.trails 
        WHERE app_uuid = $1
      `, [anemone.app_uuid]);

      console.log(`     Intersection Type: ${anemoneIntersection.rows[0].intersection_type}`);
      console.log(`     Intersection Count: ${anemoneIntersection.rows[0].intersection_count}`);
      console.log(`     Intersection Text: ${anemoneIntersection.rows[0].intersection_text}`);
    }

    // Test splitting logic for both
    console.log('\n🔧 Testing Splitting Logic:');
    
    // Test Hogback Ridge splitting
    if (hogbackTrails.rows.length > 0) {
      const hogback = hogbackTrails.rows[0];
      console.log(`\n   Testing Hogback Ridge splitting:`);
      
      try {
        const hogbackSplit = await client.query(`
          WITH loop_geometry AS (
            SELECT '${hogback.app_uuid}' as trail_uuid, '${hogback.name}' as name, ST_Force2D(geometry) as geom
            FROM public.trails 
            WHERE app_uuid = '${hogback.app_uuid}'
          ),
          split_segments AS (
            SELECT 
              (ST_Dump(ST_Split(geom, ST_Intersection(geom, geom)))).geom as segment_geom,
              generate_series(1, ST_NumGeometries(ST_Split(geom, ST_Intersection(geom, geom)))) as segment_index
            FROM loop_geometry
          )
          SELECT 
            segment_geom,
            segment_index,
            ST_GeometryType(segment_geom) as geom_type,
            ST_NumPoints(segment_geom) as num_points,
            ST_IsSimple(segment_geom) as is_simple,
            ST_Length(segment_geom::geography) as length_meters
          FROM split_segments
          WHERE ST_GeometryType(segment_geom) = 'ST_LineString'
            AND ST_NumPoints(segment_geom) > 1
        `);

        console.log(`     ✅ Split result: ${hogbackSplit.rows.length} segments created`);
        hogbackSplit.rows.forEach((segment, index) => {
          console.log(`       Segment ${index + 1}: ${segment.geom_type}, ${segment.num_points} points, ${segment.length_meters?.toFixed(2)}m, simple: ${segment.is_simple}`);
        });
      } catch (error) {
        console.log(`     ❌ Split failed: ${error.message}`);
      }
    }

    // Test Anemone Loop splitting
    if (anemoneTrails.rows.length > 0) {
      const anemone = anemoneTrails.rows[0];
      console.log(`\n   Testing Anemone Loop splitting:`);
      
      try {
        const anemoneSplit = await client.query(`
          WITH loop_geometry AS (
            SELECT '${anemone.app_uuid}' as trail_uuid, '${anemone.name}' as name, ST_Force2D(geometry) as geom
            FROM public.trails 
            WHERE app_uuid = '${anemone.app_uuid}'
          ),
          split_segments AS (
            SELECT 
              (ST_Dump(ST_Split(geom, ST_Intersection(geom, geom)))).geom as segment_geom,
              generate_series(1, ST_NumGeometries(ST_Split(geom, ST_Intersection(geom, geom)))) as segment_index
            FROM loop_geometry
          )
          SELECT 
            segment_geom,
            segment_index,
            ST_GeometryType(segment_geom) as geom_type,
            ST_NumPoints(segment_geom) as num_points,
            ST_IsSimple(segment_geom) as is_simple,
            ST_Length(segment_geom::geography) as length_meters
          FROM split_segments
          WHERE ST_GeometryType(segment_geom) = 'ST_LineString'
            AND ST_NumPoints(segment_geom) > 1
        `);

        console.log(`     ✅ Split result: ${anemoneSplit.rows.length} segments created`);
        anemoneSplit.rows.forEach((segment, index) => {
          console.log(`       Segment ${index + 1}: ${segment.geom_type}, ${segment.num_points} points, ${segment.length_meters?.toFixed(2)}m, simple: ${segment.is_simple}`);
        });
      } catch (error) {
        console.log(`     ❌ Split failed: ${error.message}`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

compareHogbackAnemone();
