#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'shaydu',
  password: process.env.PGPASSWORD || 'shaydu'
});

async function testGapFixingSimple() {
  try {
    const stagingSchema = 'carthorse_1754995760682';
    console.log(`Testing gap fixing in schema: ${stagingSchema}`);
    
    // Test the gap detection query directly
    const gapTest = await pool.query(`
      WITH trail_endpoints AS (
        SELECT 
          id,
          app_uuid,
          name,
          ST_StartPoint(geometry) as start_pt,
          ST_EndPoint(geometry) as end_pt,
          geometry
        FROM ${stagingSchema}.trails
      )
      SELECT 
        t1.id as trail1_id,
        t1.app_uuid as trail1_uuid,
        t1.name as trail1_name,
        t2.id as trail2_id,
        t2.app_uuid as trail2_uuid,
        t2.name as trail2_name,
        ST_Distance(t1.end_pt::geography, t2.start_pt::geography) as gap_distance,
        t1.end_pt as trail1_end,
        t2.start_pt as trail2_start
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
        console.log(`   Trail 1 UUID: ${gap.trail1_uuid}`);
        console.log(`   Trail 2 UUID: ${gap.trail2_uuid}`);
      });
      
      // Try to fix the first gap manually
      const gap = gapTest.rows[0];
      console.log(`\nAttempting to fix gap between ${gap.trail1_name} and ${gap.trail2_name}...`);
      
      // Create connector geometry
      const connectorResult = await pool.query(`
        SELECT 
          ST_MakeLine($1::geometry, $2::geometry) as connector_geom,
          ST_Length(ST_MakeLine($1::geometry, $2::geometry)::geography) as connector_length
      `, [gap.trail1_end, gap.trail2_start]);
      
      const connector = connectorResult.rows[0];
      console.log(`Connector length: ${connector.connector_length.toFixed(2)}m`);
      
      // Get the trail that will be extended (trail2)
      const trail2Result = await pool.query(`
        SELECT 
          geometry,
          ST_Length(geometry::geography) as current_length
        FROM ${stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [gap.trail2_uuid]);
      
      const trail2 = trail2Result.rows[0];
      console.log(`Trail 2 current length: ${trail2.current_length.toFixed(2)}m`);
      
      // Extend trail2 by prepending the connector
      const extendedResult = await pool.query(`
        SELECT 
          ST_LineMerge(ST_Union($1::geometry, $2::geometry)) as extended_geom,
          ST_Length(ST_LineMerge(ST_Union($1::geometry, $2::geometry))::geography) as extended_length
      `, [connector.connector_geom, trail2.geometry]);
      
      const extended = extendedResult.rows[0];
      console.log(`Extended trail length: ${extended.extended_length.toFixed(2)}m`);
      
      // Update trail2's geometry
      await pool.query(`
        UPDATE ${stagingSchema}.trails 
        SET 
          geometry = $1::geometry,
          length_km = ST_Length($1::geometry::geography) / 1000.0,
          updated_at = NOW()
        WHERE app_uuid = $2
      `, [extended.extended_geom, gap.trail2_uuid]);
      
      console.log(`✅ Successfully extended trail ${gap.trail2_uuid}`);
      
      // Verify the gap is now fixed
      const verifyResult = await pool.query(`
        SELECT 
          ST_Distance(
            (SELECT ST_EndPoint(geometry) FROM ${stagingSchema}.trails WHERE app_uuid = $1),
            (SELECT ST_StartPoint(geometry) FROM ${stagingSchema}.trails WHERE app_uuid = $2)
          ) as new_gap_distance
      `, [gap.trail1_uuid, gap.trail2_uuid]);
      
      const newGapDistance = verifyResult.rows[0].new_gap_distance;
      console.log(`New gap distance: ${newGapDistance.toFixed(6)}m`);
      
    }
    
  } catch (error) {
    console.error('Error testing gap fixing:', error);
  } finally {
    await pool.end();
  }
}

testGapFixingSimple();
