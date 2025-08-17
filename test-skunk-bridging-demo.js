#!/usr/bin/env node
/**
 * Demo of production Layer 1 bridging for Skunk Canyon and Skunk Connector trails
 * Shows how near-miss intersections (9.24m apart) are handled with connector trails
 */

const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function testSkunkBridgingDemo() {
  try {
    await pgClient.connect();
    console.log('✅ Connected to PostgreSQL database');

    const skunkCanyonUUID = '8fa2152a-a213-40d1-b8b6-ef1b233f2bc6';
    const skunkConnectorUUID = '3da33063-b264-4455-b32e-5881325f26fd';
    const bridgingTolerance = 20; // 20m tolerance like production

    console.log('🔍 Getting Skunk Canyon and Skunk Connector trails...');
    
    const trailsResult = await pgClient.query(`
      SELECT app_uuid, name, ST_AsText(geometry) as geom_text, length_km, elevation_gain
      FROM public.trails 
      WHERE app_uuid IN ($1, $2)
      ORDER BY name
    `, [skunkCanyonUUID, skunkConnectorUUID]);

    if (trailsResult.rows.length < 2) {
      console.log('❌ Need both trails');
      return;
    }

    const skunkCanyon = trailsResult.rows.find(t => t.app_uuid === skunkCanyonUUID);
    const skunkConnector = trailsResult.rows.find(t => t.app_uuid === skunkConnectorUUID);

    console.log(`\n🔗 Demo: Production bridging for ${skunkCanyon.name} <-> ${skunkConnector.name}`);
    console.log(`   Bridging tolerance: ${bridgingTolerance}m`);

    // Step 1: Detect near-miss intersections (like production bridging)
    console.log('\n🔍 Step 1: Detecting near-miss intersections (production bridging logic)...');
    const nearMissResult = await pgClient.query(`
      SELECT 
        t1.app_uuid as trail1_uuid,
        t2.app_uuid as trail2_uuid,
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_Distance(t1.geometry::geography, t2.geometry::geography) as distance_meters,
        ST_AsText(ST_ClosestPoint(t1.geometry, ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry)))) as closest_point_on_trail1,
        ST_AsText(ST_ClosestPoint(t2.geometry, ST_ClosestPoint(t1.geometry, ST_StartPoint(t2.geometry)))) as closest_point_on_trail2
      FROM public.trails t1
      JOIN public.trails t2 ON t1.app_uuid = $1 AND t2.app_uuid = $2
      WHERE ST_DWithin(t1.geometry::geography, t2.geometry::geography, $3)
        AND t1.app_uuid != t2.app_uuid
    `, [skunkCanyonUUID, skunkConnectorUUID, bridgingTolerance]);

    if (nearMissResult.rows.length === 0) {
      console.log('❌ No near-miss intersections found within bridging tolerance');
      return;
    }

    const nearMiss = nearMissResult.rows[0];
    console.log(`✅ Found near-miss intersection:`);
    console.log(`   ${nearMiss.trail1_name} <-> ${nearMiss.trail2_name}`);
    console.log(`   Distance: ${nearMiss.distance_meters?.toFixed(2)}m`);
    console.log(`   Closest point on ${nearMiss.trail1_name}: ${nearMiss.closest_point_on_trail1}`);
    console.log(`   Closest point on ${nearMiss.trail2_name}: ${nearMiss.closest_point_on_trail2}`);

    // Step 2: Create connector trail (like production bridging)
    console.log('\n🔗 Step 2: Creating connector trail (production bridging)...');
    const connectorResult = await pgClient.query(`
      SELECT 
        ST_AsText(ST_MakeLine(
          ST_ClosestPoint(t1.geometry, ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry))),
          ST_ClosestPoint(t2.geometry, ST_ClosestPoint(t1.geometry, ST_StartPoint(t2.geometry)))
        )) as connector_geometry,
        ST_Length(ST_MakeLine(
          ST_ClosestPoint(t1.geometry, ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry))),
          ST_ClosestPoint(t2.geometry, ST_ClosestPoint(t1.geometry, ST_StartPoint(t2.geometry)))
        )::geography) as connector_length_meters
      FROM public.trails t1
      JOIN public.trails t2 ON t1.app_uuid = $1 AND t2.app_uuid = $2
    `, [skunkCanyonUUID, skunkConnectorUUID]);

    const connector = connectorResult.rows[0];
    console.log(`✅ Created connector trail:`);
    console.log(`   Geometry: ${connector.connector_geometry}`);
    console.log(`   Length: ${connector.connector_length_meters?.toFixed(2)}m`);

    // Step 3: Simulate splitting trails at connector intersection points
    console.log('\n✂️ Step 3: Splitting trails at connector intersection points...');
    
    // Split Skunk Canyon at the closest point
    const splitSkunkCanyonResult = await pgClient.query(`
      SELECT 
        (ST_Dump(ST_Split(t.geometry, $1::geometry))).geom AS segment,
        (ST_Dump(ST_Split(t.geometry, $1::geometry))).path[1] as segment_order
      FROM public.trails t
      WHERE t.app_uuid = $2
    `, [nearMiss.closest_point_on_trail1, skunkCanyonUUID]);
    
    console.log(`📏 ${skunkCanyon.name} split into ${splitSkunkCanyonResult.rows.length} segments:`);
    splitSkunkCanyonResult.rows.forEach((segment, index) => {
      console.log(`   Segment ${segment.segment_order}: ${segment.segment}`);
    });
    
    // Split Skunk Connector at the closest point
    const splitSkunkConnectorResult = await pgClient.query(`
      SELECT 
        (ST_Dump(ST_Split(t.geometry, $1::geometry))).geom AS segment,
        (ST_Dump(ST_Split(t.geometry, $1::geometry))).path[1] as segment_order
      FROM public.trails t
      WHERE t.app_uuid = $2
    `, [nearMiss.closest_point_on_trail2, skunkConnectorUUID]);
    
    console.log(`📏 ${skunkConnector.name} split into ${splitSkunkConnectorResult.rows.length} segments:`);
    splitSkunkConnectorResult.rows.forEach((segment, index) => {
      console.log(`   Segment ${segment.segment_order}: ${segment.segment}`);
    });

    // Step 4: Show the final network structure
    console.log('\n🕸️ Step 4: Final network structure after bridging:');
    console.log(`   Original trails: 2`);
    console.log(`   Connector trails: 1`);
    console.log(`   Total trail segments: ${splitSkunkCanyonResult.rows.length + splitSkunkConnectorResult.rows.length + 1}`);
    console.log(`   Intersection nodes: 2 (at connector endpoints)`);
    console.log(`   Routing edges: ${splitSkunkCanyonResult.rows.length + splitSkunkConnectorResult.rows.length + 1}`);

    console.log('\n✅ Production bridging demo completed!');
    console.log('\n📝 Summary:');
    console.log(`   - Trails were ${nearMiss.distance_meters?.toFixed(2)}m apart (near-miss)`);
    console.log(`   - Production bridging detected this within ${bridgingTolerance}m tolerance`);
    console.log(`   - Created ${connector.connector_length_meters?.toFixed(2)}m connector trail`);
    console.log(`   - Split both trails at connector intersection points`);
    console.log(`   - Result: Connected routing network with ${splitSkunkCanyonResult.rows.length + splitSkunkConnectorResult.rows.length + 1} edges`);

  } catch (error) {
    console.error('❌ Error in bridging demo:', error);
  } finally {
    await pgClient.end();
  }
}

testSkunkBridgingDemo();
