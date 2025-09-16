#!/usr/bin/env node
/**
 * Test Skunk Canyon Trail intersection with Skunk Connector Trail
 */

const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function testSkunkIntersection() {
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

    // Step 1: Round coordinates to 6 decimal places (exactly like prototype)
    console.log('📐 Step 1: Rounding coordinates to 6 decimal places...');
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
          ) as skunk_canyon_rounded,
          ST_GeomFromText(
            'LINESTRING(' || 
            string_agg(
              ROUND(ST_X(pt2)::numeric, 6) || ' ' || ROUND(ST_Y(pt2)::numeric, 6),
              ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($2), pt2)
            ) || 
            ')'
          ) as skunk_connector_rounded
        FROM 
          (SELECT (ST_DumpPoints(ST_GeomFromText($1))).geom AS pt1) as points1,
          (SELECT (ST_DumpPoints(ST_GeomFromText($2))).geom AS pt2) as points2
      )
      SELECT skunk_canyon_rounded, skunk_connector_rounded FROM rounded_trails
    `, [skunkCanyon.geom_text, skunkConnector.geom_text]);

    if (roundedResult.rows.length === 0) {
      console.log('❌ Failed to round coordinates');
      return;
    }

    const skunkCanyonRounded = roundedResult.rows[0].skunk_canyon_rounded;
    const skunkConnectorRounded = roundedResult.rows[0].skunk_connector_rounded;

    // Step 2: Snap with 1e-6 tolerance (exactly like prototype)
    console.log('🔗 Step 2: Snapping geometries with 1e-6 tolerance...');
    const snappedResult = await pgClient.query(`
      SELECT 
        ST_Snap($1::geometry, $2::geometry, 1e-6) AS skunk_canyon_snapped,
        ST_Snap($2::geometry, $1::geometry, 1e-6) AS skunk_connector_snapped
    `, [skunkCanyonRounded, skunkConnectorRounded]);

    const skunkCanyonSnapped = snappedResult.rows[0].skunk_canyon_snapped;
    const skunkConnectorSnapped = snappedResult.rows[0].skunk_connector_snapped;

    // Step 3: Find intersections (exactly like production code - using ST_Force2D)
    console.log('🔍 Step 3: Finding intersections (using ST_Force2D like production)...');
    const intersectionResult = await pgClient.query(`
      SELECT (ST_Dump(ST_Intersection(ST_Force2D($1::geometry), ST_Force2D($2::geometry)))).geom AS pt
      WHERE ST_Intersects($1::geometry, $2::geometry)
        AND ST_GeometryType(ST_Intersection(ST_Force2D($1::geometry), ST_Force2D($2::geometry))) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_Length($1::geometry::geography) > 5
        AND ST_Length($2::geometry::geography) > 5
    `, [skunkCanyonSnapped, skunkConnectorSnapped]);

    console.log(`🔍 Found ${intersectionResult.rows.length} intersection(s)`);

    if (intersectionResult.rows.length === 0) {
      console.log('❌ No intersections found between Skunk Canyon and Skunk Connector');
      return;
    }

    // Step 4: Split both trails at intersection points (exactly like prototype)
    console.log('✂️ Step 4: Splitting trails at intersection points...');
    for (const intersection of intersectionResult.rows) {
      const splitPoint = intersection.pt;
      console.log(`   ✅ Intersection point: ${splitPoint}`);
      
      // Split Skunk Canyon
      const splitSkunkCanyonResult = await pgClient.query(`
        SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
      `, [skunkCanyonSnapped, splitPoint]);
      
      console.log(`   📏 Skunk Canyon split into ${splitSkunkCanyonResult.rows.length} segments`);
      
      // Show details of each segment
      splitSkunkCanyonResult.rows.forEach((segment, index) => {
        const length = pgClient.query(`SELECT ST_Length($1::geometry) as length`, [segment.segment]);
        console.log(`     Segment ${index + 1}: ${segment.segment}`);
      });
      
      // Split Skunk Connector
      const splitSkunkConnectorResult = await pgClient.query(`
        SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
      `, [skunkConnectorSnapped, splitPoint]);
      
      console.log(`   📏 Skunk Connector split into ${splitSkunkConnectorResult.rows.length} segments`);
      
      // Show details of each segment
      splitSkunkConnectorResult.rows.forEach((segment, index) => {
        console.log(`     Segment ${index + 1}: ${segment.segment}`);
      });
    }

    console.log('✅ Skunk Canyon <-> Skunk Connector intersection test completed successfully!');

  } catch (error) {
    console.error('❌ Error testing Skunk intersection:', error);
  } finally {
    await pgClient.end();
  }
}

testSkunkIntersection();
