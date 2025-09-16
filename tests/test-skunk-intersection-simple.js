#!/usr/bin/env node
/**
 * Simple test of Skunk Canyon Trail intersection with Skunk Connector Trail
 * Using production intersection detection logic
 */

const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function testSkunkIntersectionSimple() {
  try {
    await pgClient.connect();
    console.log('✅ Connected to PostgreSQL database');

    // Get the specific Skunk Canyon and Skunk Connector trails that we know intersect
    const skunkCanyonUUID = '8fa2152a-a213-40d1-b8b6-ef1b233f2bc6';
    const skunkConnectorUUID = '3da33063-b264-4455-b32e-5881325f26fd';

    console.log('🔍 Getting Skunk Canyon and Skunk Connector trails...');
    
    const trailsResult = await pgClient.query(`
      SELECT app_uuid, name, ST_AsText(geometry) as geom_text, length_km, elevation_gain
      FROM public.trails 
      WHERE app_uuid IN ($1, $2)
      ORDER BY name
    `, [skunkCanyonUUID, skunkConnectorUUID]);

    console.log(`🔍 Found ${trailsResult.rows.length} trails:`);
    trailsResult.rows.forEach(row => {
      console.log(`   - ${row.name} (${row.app_uuid}) - ${row.length_km?.toFixed(3)}km, ${row.elevation_gain?.toFixed(0)}m gain`);
    });

    if (trailsResult.rows.length < 2) {
      console.log('❌ Need both Skunk Canyon and Skunk Connector trails');
      return;
    }

    const skunkCanyon = trailsResult.rows.find(t => t.app_uuid === skunkCanyonUUID);
    const skunkConnector = trailsResult.rows.find(t => t.app_uuid === skunkConnectorUUID);

    console.log(`\n🔗 Testing intersection: ${skunkCanyon.name} <-> ${skunkConnector.name}`);

    // Test 1: Direct intersection check (no preprocessing)
    console.log('\n🔍 Test 1: Direct intersection check (no preprocessing)...');
    const directIntersectionResult = await pgClient.query(`
      SELECT 
        ST_Intersects($1::geometry, $2::geometry) as intersects,
        ST_GeometryType(ST_Intersection(ST_Force2D($1::geometry), ST_Force2D($2::geometry))) as intersection_type,
        ST_AsText(ST_Intersection(ST_Force2D($1::geometry), ST_Force2D($2::geometry))) as intersection_geom
      FROM (SELECT 1) as dummy
    `, [skunkCanyon.geom_text, skunkConnector.geom_text]);

    console.log(`   Intersects: ${directIntersectionResult.rows[0].intersects}`);
    console.log(`   Intersection Type: ${directIntersectionResult.rows[0].intersection_type}`);
    console.log(`   Intersection Geometry: ${directIntersectionResult.rows[0].intersection_geom}`);

    // Test 2: Production-style intersection detection
    console.log('\n🔍 Test 2: Production-style intersection detection...');
    const productionIntersectionResult = await pgClient.query(`
      SELECT 
        (ST_Dump(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)))).geom as intersection_point
      FROM public.trails t1
      JOIN public.trails t2 ON t1.app_uuid = $1 AND t2.app_uuid = $2
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_Length(t1.geometry::geography) > 5
        AND ST_Length(t2.geometry::geography) > 5
    `, [skunkCanyonUUID, skunkConnectorUUID]);

    console.log(`🔍 Found ${productionIntersectionResult.rows.length} intersection(s) using production logic`);

    if (productionIntersectionResult.rows.length === 0) {
      console.log('❌ No intersections found with production logic');
      
      // Let's debug why
      console.log('\n🔍 Debug: Checking individual trail properties...');
      const debugResult = await pgClient.query(`
        SELECT 
          app_uuid,
          name,
          ST_Length(geometry::geography) as length_meters,
          ST_NumPoints(geometry) as num_points,
          ST_IsValid(geometry) as is_valid,
          ST_GeometryType(geometry) as geom_type
        FROM public.trails 
        WHERE app_uuid IN ($1, $2)
      `, [skunkCanyonUUID, skunkConnectorUUID]);
      
      debugResult.rows.forEach(row => {
        console.log(`   ${row.name}: ${row.length_meters?.toFixed(1)}m, ${row.num_points} points, valid: ${row.is_valid}, type: ${row.geom_type}`);
      });
    } else {
      // Test 3: Split trails at intersection points
      console.log('\n✂️ Test 3: Splitting trails at intersection points...');
      for (const intersection of productionIntersectionResult.rows) {
        const splitPoint = intersection.intersection_point;
        console.log(`   ✅ Intersection point: ${splitPoint}`);
        
        // Split Skunk Canyon
        const splitSkunkCanyonResult = await pgClient.query(`
          SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
        `, [skunkCanyon.geom_text, splitPoint]);
        
        console.log(`   📏 Skunk Canyon split into ${splitSkunkCanyonResult.rows.length} segments`);
        
        // Show details of each segment
        splitSkunkCanyonResult.rows.forEach((segment, index) => {
          console.log(`     Segment ${index + 1}: ${segment.segment}`);
        });
        
        // Split Skunk Connector
        const splitSkunkConnectorResult = await pgClient.query(`
          SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
        `, [skunkConnector.geom_text, splitPoint]);
        
        console.log(`   📏 Skunk Connector split into ${splitSkunkConnectorResult.rows.length} segments`);
        
        // Show details of each segment
        splitSkunkConnectorResult.rows.forEach((segment, index) => {
          console.log(`     Segment ${index + 1}: ${segment.segment}`);
        });
      }
    }

    console.log('\n✅ Skunk Canyon <-> Skunk Connector intersection test completed!');

  } catch (error) {
    console.error('❌ Error testing Skunk intersection:', error);
  } finally {
    await pgClient.end();
  }
}

testSkunkIntersectionSimple();
