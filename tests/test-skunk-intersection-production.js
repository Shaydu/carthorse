#!/usr/bin/env node
/**
 * Test Skunk Canyon Trail intersection with Skunk Connector Trail
 * Using production Layer 1 intersection detection logic
 */

const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function testSkunkIntersectionProduction() {
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

    // Test 1: Production-style intersection detection (exactly like Layer 1)
    console.log('\n🔍 Test 1: Production-style intersection detection (Layer 1 logic)...');
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

    console.log(`🔍 Found ${productionIntersectionResult.rows.length} intersection(s) using production Layer 1 logic`);

    if (productionIntersectionResult.rows.length === 0) {
      console.log('❌ No intersections found with production Layer 1 logic');
      
      // Test 2: Check if they're near-miss (within 20m tolerance like our bridging)
      console.log('\n🔍 Test 2: Checking for near-miss intersections (20m tolerance like bridging)...');
      const nearMissResult = await pgClient.query(`
        SELECT 
          ST_Distance(t1.geometry::geography, t2.geometry::geography) as distance_meters,
          ST_AsText(ST_ClosestPoint(t1.geometry, ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry)))) as closest_point
        FROM public.trails t1
        JOIN public.trails t2 ON t1.app_uuid = $1 AND t2.app_uuid = $2
        WHERE ST_DWithin(t1.geometry::geography, t2.geometry::geography, 20)
      `, [skunkCanyonUUID, skunkConnectorUUID]);

      if (nearMissResult.rows.length > 0) {
        console.log(`   Found near-miss: ${nearMissResult.rows[0].distance_meters?.toFixed(2)}m apart`);
        console.log(`   Closest point: ${nearMissResult.rows[0].closest_point}`);
      } else {
        console.log('   No near-miss found within 20m');
      }
      
      // Test 3: Check endpoint proximity (like our post-noding snap)
      console.log('\n🔍 Test 3: Checking endpoint proximity (like post-noding snap)...');
      const endpointResult = await pgClient.query(`
        SELECT 
          ST_Distance(ST_StartPoint(t1.geometry)::geography, ST_StartPoint(t2.geometry)::geography) as start_start_dist,
          ST_Distance(ST_StartPoint(t1.geometry)::geography, ST_EndPoint(t2.geometry)::geography) as start_end_dist,
          ST_Distance(ST_EndPoint(t1.geometry)::geography, ST_StartPoint(t2.geometry)::geography) as end_start_dist,
          ST_Distance(ST_EndPoint(t1.geometry)::geography, ST_EndPoint(t2.geometry)::geography) as end_end_dist
        FROM public.trails t1
        JOIN public.trails t2 ON t1.app_uuid = $1 AND t2.app_uuid = $2
      `, [skunkCanyonUUID, skunkConnectorUUID]);

      if (endpointResult.rows.length > 0) {
        const dists = endpointResult.rows[0];
        console.log(`   Endpoint distances:`);
        console.log(`     Start-Start: ${dists.start_start_dist?.toFixed(2)}m`);
        console.log(`     Start-End: ${dists.start_end_dist?.toFixed(2)}m`);
        console.log(`     End-Start: ${dists.end_start_dist?.toFixed(2)}m`);
        console.log(`     End-End: ${dists.end_end_dist?.toFixed(2)}m`);
      }
    } else {
      // Test 4: Split trails at intersection points (production logic)
      console.log('\n✂️ Test 4: Splitting trails at intersection points (production logic)...');
      for (const intersection of productionIntersectionResult.rows) {
        const splitPoint = intersection.intersection_point;
        console.log(`   ✅ Intersection point: ${splitPoint}`);
        
        // Split Skunk Canyon using production logic
        const splitSkunkCanyonResult = await pgClient.query(`
          SELECT (ST_Dump(ST_Split(t.geometry, $1::geometry))).geom AS segment
          FROM public.trails t
          WHERE t.app_uuid = $2
        `, [splitPoint, skunkCanyonUUID]);
        
        console.log(`   📏 Skunk Canyon split into ${splitSkunkCanyonResult.rows.length} segments`);
        
        // Show details of each segment
        splitSkunkCanyonResult.rows.forEach((segment, index) => {
          console.log(`     Segment ${index + 1}: ${segment.segment}`);
        });
        
        // Split Skunk Connector using production logic
        const splitSkunkConnectorResult = await pgClient.query(`
          SELECT (ST_Dump(ST_Split(t.geometry, $1::geometry))).geom AS segment
          FROM public.trails t
          WHERE t.app_uuid = $2
        `, [splitPoint, skunkConnectorUUID]);
        
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

testSkunkIntersectionProduction();
