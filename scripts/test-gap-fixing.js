#!/usr/bin/env node

const { Client } = require('pg');

const client = new Client({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'shaydu',
  password: process.env.PGPASSWORD || 'shaydu'
});

async function testGapFixing() {
  try {
    await client.connect();
    
    // Get the most recent staging schema
    const schemaResult = await client.query(`
      SELECT schema_name FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC LIMIT 1
    `);
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`Testing gap fixing in schema: ${stagingSchema}`);
    
    // Test the exact gap we identified
    const gapTest = await client.query(`
      WITH trail_endpoints AS (
        SELECT 
          id,
          app_uuid,
          name,
          ST_StartPoint(geometry) as start_pt,
          ST_EndPoint(geometry) as end_pt,
          geometry
        FROM ${stagingSchema}.trails
        WHERE name = 'Mesa Trail'
      )
      SELECT 
        t1.id as trail1_id,
        t1.app_uuid as trail1_uuid,
        t1.name as trail1_name,
        t2.id as trail2_id,
        t2.app_uuid as trail2_uuid,
        t2.name as trail2_name,
        ST_Distance(t1.end_pt::geography, t2.start_pt::geography) as gap_distance,
        ST_AsText(t1.end_pt) as trail1_end_text,
        ST_AsText(t2.start_pt) as trail2_start_text
      FROM trail_endpoints t1
      CROSS JOIN trail_endpoints t2
      WHERE t1.id != t2.id
        AND ST_Distance(t1.end_pt::geography, t2.start_pt::geography) >= 1
        AND ST_Distance(t1.end_pt::geography, t2.start_pt::geography) <= 30
      ORDER BY gap_distance ASC
    `);
    
    console.log(`Found ${gapTest.rows.length} gaps between 1-30m`);
    
    if (gapTest.rows.length > 0) {
      console.log('\nGaps found:');
      gapTest.rows.forEach((gap, i) => {
        console.log(`${i+1}. ${gap.trail1_name} → ${gap.trail2_name}: ${gap.gap_distance.toFixed(2)}m`);
        console.log(`   Trail 1 end: ${gap.trail1_end_text}`);
        console.log(`   Trail 2 start: ${gap.trail2_start_text}`);
        console.log('');
      });
    } else {
      console.log('No gaps found in the 1-30m range');
    }
    
    // Test the specific coordinates we know should have a gap
    const specificGapTest = await client.query(`
      SELECT 
        ST_Distance(
          ST_GeomFromText('POINT(-105.284509 39.979646)', 4326),
          ST_GeomFromText('POINT(-105.284692 39.979528)', 4326)
        ) as specific_gap_distance
    `);
    
    const specificGap = specificGapTest.rows[0].specific_gap_distance;
    console.log(`\nSpecific gap test:`);
    console.log(`Distance between known endpoints: ${specificGap.toFixed(6)} degrees (${(specificGap * 111000).toFixed(2)}m)`);
    console.log(`Within 1-30m range: ${specificGap * 111000 >= 1 && specificGap * 111000 <= 30 ? 'YES' : 'NO'}`);
    
  } catch (error) {
    console.error('Error testing gap fixing:', error);
  } finally {
    await client.end();
  }
}

testGapFixing();
