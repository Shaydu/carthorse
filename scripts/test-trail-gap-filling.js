#!/usr/bin/env node

const { Client } = require('pg');

const client = new Client({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'shaydu',
  password: process.env.PGPASSWORD || 'shaydu'
});

const STAGING_SCHEMA = 'carthorse_1754992253411';

async function testTrailGapFilling() {
  try {
    await client.connect();
    console.log('🔍 Testing trail gap filling with specific coordinates...');

    // The specific gap coordinates from the user
    const point1 = [-105.284692, 39.979528, 1892.259155];
    const point2 = [-105.284509, 39.979646, 1898.36731];

    console.log('\n📊 Target Gap Analysis:');
    console.log(`Point 1: [${point1.join(', ')}]`);
    console.log(`Point 2: [${point2.join(', ')}]`);

    // Calculate the actual gap distance
    const distanceAnalysis = await client.query(`
      SELECT 
        ST_Distance(
          ST_SetSRID(ST_MakePoint($1, $2, $3), 4326)::geography,
          ST_SetSRID(ST_MakePoint($4, $5, $6), 4326)::geography
        ) as distance_meters
    `, [point1[0], point1[1], point1[2], point2[0], point2[1], point2[2]]);

    const gapDistance = distanceAnalysis.rows[0].distance_meters;
    console.log(`\n📏 Gap Distance: ${gapDistance.toFixed(3)}m`);

    // Check current trail count before gap filling
    const beforeCount = await client.query(`
      SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails
    `);
    console.log(`\n📊 Trails before gap filling: ${beforeCount.rows[0].count}`);

    // Simulate the trail gap filling logic
    const toleranceMeters = 5.0; // From the new YAML config
    console.log(`\n🔍 Gap filling tolerance: ${toleranceMeters}m`);

    if (gapDistance <= toleranceMeters) {
      console.log('✅ Gap is within tolerance - would create connector trail');
      
      // Show what the connector trail would look like
      const connectorGeom = await client.query(`
        SELECT 
          ST_AsText(ST_MakeLine(
            ST_SetSRID(ST_MakePoint($1, $2, $3), 4326),
            ST_SetSRID(ST_MakePoint($4, $5, $6), 4326)
          )) as connector_geom,
          ST_Length(ST_MakeLine(
            ST_SetSRID(ST_MakePoint($1, $2, $3), 4326),
            ST_SetSRID(ST_MakePoint($4, $5, $6), 4326)
          )::geography) as connector_length_meters
      `, [point1[0], point1[1], point1[2], point2[0], point2[1], point2[2]]);

      console.log(`\n🔗 Connector Trail Details:`);
      console.log(`   Geometry: ${connectorGeom.rows[0].connector_geom}`);
      console.log(`   Length: ${connectorGeom.rows[0].connector_length_meters.toFixed(3)}m`);
      console.log(`   Name: "Connector: Trail 1 ↔ Trail 2"`);
      console.log(`   Type: "connector"`);
      console.log(`   Source: "gap_filler"`);

    } else {
      console.log('❌ Gap is too large - would not create connector trail');
    }

    // Check for any existing connector trails
    const existingConnectors = await client.query(`
      SELECT 
        app_uuid,
        name,
        trail_type,
        source,
        ST_Length(geometry::geography) as length_meters,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${STAGING_SCHEMA}.trails
      WHERE source = 'gap_filler' OR trail_type = 'connector'
      ORDER BY length_meters
    `);

    console.log(`\n🔗 Existing Connector Trails: ${existingConnectors.rows.length}`);
    existingConnectors.rows.forEach((connector, index) => {
      console.log(`\n  Connector ${index + 1}:`);
      console.log(`    Name: ${connector.name}`);
      console.log(`    Type: ${connector.trail_type}`);
      console.log(`    Source: ${connector.source}`);
      console.log(`    Length: ${connector.length_meters.toFixed(3)}m`);
      console.log(`    Start: ${connector.start_point}`);
      console.log(`    End: ${connector.end_point}`);
    });

    // Test the gap detection query that would be used
    console.log('\n🔍 Testing gap detection query...');
    const potentialGaps = await client.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point
        FROM ${STAGING_SCHEMA}.trails
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) > 0
      )
      SELECT COUNT(*) as count
      FROM trail_endpoints t1
      CROSS JOIN trail_endpoints t2
      WHERE t1.trail_id < t2.trail_id
        AND (
          (ST_DWithin(t1.start_point, t2.start_point, $1 / 111320) AND 
           ST_Distance(t1.start_point::geography, t2.start_point::geography) >= 1.0 AND
           ST_Distance(t1.start_point::geography, t2.start_point::geography) <= $1) OR
          (ST_DWithin(t1.start_point, t2.end_point, $1 / 111320) AND 
           ST_Distance(t1.start_point::geography, t2.end_point::geography) >= 1.0 AND
           ST_Distance(t1.start_point::geography, t2.end_point::geography) <= $1) OR
          (ST_DWithin(t1.end_point, t2.start_point, $1 / 111320) AND 
           ST_Distance(t1.end_point::geography, t2.start_point::geography) >= 1.0 AND
           ST_Distance(t1.end_point::geography, t2.start_point::geography) <= $1) OR
          (ST_DWithin(t1.end_point, t2.end_point, $1 / 111320) AND 
           ST_Distance(t1.end_point::geography, t2.end_point::geography) >= 1.0 AND
           ST_Distance(t1.end_point::geography, t2.end_point::geography) <= $1)
        )
    `, [toleranceMeters]);

    console.log(`📊 Potential gaps detected: ${potentialGaps.rows[0].count}`);

    console.log('\n✅ Trail gap filling test completed');

  } catch (error) {
    console.error('❌ Error testing trail gap filling:', error);
  } finally {
    await client.end();
  }
}

testTrailGapFilling();
