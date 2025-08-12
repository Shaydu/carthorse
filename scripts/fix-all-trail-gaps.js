#!/usr/bin/env node

const { Client } = require('pg');

const client = new Client({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'shaydu',
  password: process.env.PGPASSWORD || 'shaydu'
});

const STAGING_SCHEMA = 'carthorse_1754994218132';
const MIN_GAP_DISTANCE = 1; // meters - ignore very small gaps
const MAX_GAP_DISTANCE = 10; // meters

async function fixAllTrailGaps() {
  try {
    await client.connect();
    console.log(`🔧 Fixing trail gaps between ${MIN_GAP_DISTANCE}m and ${MAX_GAP_DISTANCE}m...`);

    // Start transaction
    await client.query('BEGIN');

    // Step 1: Find all trail gaps
    console.log('\n📊 Step 1: Finding trail gaps...');
    
    const gaps = await client.query(`
      WITH trail_endpoints AS (
        SELECT 
          id,
          app_uuid,
          name,
          ST_StartPoint(geometry) as start_pt,
          ST_EndPoint(geometry) as end_pt,
          geometry
        FROM ${STAGING_SCHEMA}.trails
      )
      SELECT 
        t1.id as trail1_id,
        t1.app_uuid as trail1_uuid,
        t1.name as trail1_name,
        t2.id as trail2_id,
        t2.app_uuid as trail2_uuid,
        t2.name as trail2_name,
        ST_Distance(t1.end_pt, t2.start_pt) as gap_distance,
        t1.end_pt as trail1_end,
        t2.start_pt as trail2_start
      FROM trail_endpoints t1
      CROSS JOIN trail_endpoints t2
      WHERE t1.id != t2.id
        AND ST_Distance(t1.end_pt, t2.start_pt) >= $1
        AND ST_Distance(t1.end_pt, t2.start_pt) <= $2
      ORDER BY gap_distance ASC
    `, [MIN_GAP_DISTANCE, MAX_GAP_DISTANCE]);

    console.log(`Found ${gaps.rows.length} gaps between ${MIN_GAP_DISTANCE}m and ${MAX_GAP_DISTANCE}m`);

    if (gaps.rows.length === 0) {
      console.log('✅ No gaps found in the specified range!');
      await client.query('COMMIT');
      return;
    }

    // Step 2: Process each gap
    console.log('\n🔗 Step 2: Processing gaps...');
    
    let fixedCount = 0;
    const processedTrails = new Set(); // Track trails we've already modified

    for (const gap of gaps.rows) {
      // Skip if we've already processed one of these trails
      if (processedTrails.has(gap.trail1_uuid) || processedTrails.has(gap.trail2_uuid)) {
        console.log(`⏭️ Skipping gap between ${gap.trail1_name} and ${gap.trail2_name} (already processed)`);
        continue;
      }

      console.log(`\n🔗 Fixing gap: ${gap.trail1_name} → ${gap.trail2_name} (${gap.gap_distance.toFixed(2)}m)`);

      try {
        // Create connector geometry
        const connectorResult = await client.query(`
          SELECT 
            ST_MakeLine($1::geometry, $2::geometry) as connector_geom,
            ST_Length(ST_MakeLine($1::geometry, $2::geometry)::geography) as connector_length
        `, [gap.trail1_end, gap.trail2_start]);

        const connector = connectorResult.rows[0];

        // Get the trail that will be extended (trail2)
        const trail2Result = await client.query(`
          SELECT 
            geometry,
            ST_Length(geometry::geography) as current_length
          FROM ${STAGING_SCHEMA}.trails 
          WHERE app_uuid = $1
        `, [gap.trail2_uuid]);

        const trail2 = trail2Result.rows[0];

        // Extend trail2 by prepending the connector
        const extendedResult = await client.query(`
          SELECT 
            ST_LineMerge(ST_Union($1::geometry, $2::geometry)) as extended_geom,
            ST_Length(ST_LineMerge(ST_Union($1::geometry, $2::geometry))::geography) as extended_length
        `, [connector.connector_geom, trail2.geometry]);

        const extended = extendedResult.rows[0];

        // Update trail2's geometry
        await client.query(`
          UPDATE ${STAGING_SCHEMA}.trails 
          SET 
            geometry = $1::geometry,
            length_km = ST_Length($1::geometry::geography) / 1000.0,
            updated_at = NOW()
          WHERE app_uuid = $2
        `, [extended.extended_geom, gap.trail2_uuid]);

        // Update the routing edge for trail2
        const edgeResult = await client.query(`
          SELECT id FROM ${STAGING_SCHEMA}.ways_noded WHERE app_uuid = $1
        `, [gap.trail2_uuid]);

        if (edgeResult.rows.length > 0) {
          await client.query(`
            UPDATE ${STAGING_SCHEMA}.ways_noded
            SET 
              the_geom = ST_Force2D($1::geometry),
              length_km = ST_Length(ST_Force2D($1::geometry)::geography) / 1000.0
            WHERE app_uuid = $2
          `, [extended.extended_geom, gap.trail2_uuid]);
        }

        console.log(`  ✅ Extended ${gap.trail2_name} by ${(extended.extended_length - trail2.current_length).toFixed(2)}m`);
        console.log(`  📏 New length: ${extended.extended_length.toFixed(2)}m`);

        // Mark both trails as processed
        processedTrails.add(gap.trail1_uuid);
        processedTrails.add(gap.trail2_uuid);
        fixedCount++;

      } catch (error) {
        console.error(`  ❌ Error fixing gap between ${gap.trail1_name} and ${gap.trail2_name}:`, error.message);
        // Continue with next gap instead of aborting
      }
    }

    // Step 3: Recompute vertex degrees
    console.log('\n🔄 Step 3: Recomputing vertex degrees...');
    await client.query(`
      UPDATE ${STAGING_SCHEMA}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);

    // Step 4: Verify fixes
    console.log('\n🔍 Step 4: Verifying fixes...');
    
    const remainingGaps = await client.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid,
          name,
          ST_StartPoint(geometry) as start_pt,
          ST_EndPoint(geometry) as end_pt
        FROM ${STAGING_SCHEMA}.trails
      )
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_Distance(t1.end_pt, t2.start_pt) as gap_distance
      FROM trail_endpoints t1
      CROSS JOIN trail_endpoints t2
      WHERE t1.app_uuid != t2.app_uuid
        AND ST_Distance(t1.end_pt, t2.start_pt) >= $1
        AND ST_Distance(t1.end_pt, t2.start_pt) <= $2
      ORDER BY gap_distance ASC
    `, [MIN_GAP_DISTANCE, MAX_GAP_DISTANCE]);

    console.log(`\n📊 Results:`);
    console.log(`  Gaps fixed: ${fixedCount}`);
    console.log(`  Remaining gaps: ${remainingGaps.rows.length}`);

    if (remainingGaps.rows.length > 0) {
      console.log('\n⚠️ Remaining gaps:');
      remainingGaps.rows.slice(0, 10).forEach(gap => {
        console.log(`  ${gap.trail1_name} → ${gap.trail2_name}: ${gap.gap_distance.toFixed(2)}m`);
      });
      if (remainingGaps.rows.length > 10) {
        console.log(`  ... and ${remainingGaps.rows.length - 10} more`);
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    console.log('\n✅ Trail gap fixing completed!');

  } catch (error) {
    console.error('❌ Error fixing trail gaps:', error);
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
}

fixAllTrailGaps();
