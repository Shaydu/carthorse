const { Pool } = require('pg');

async function debugDeletionIssue() {
  const pool = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'carthorse'
  });

  const stagingSchema = 'carthorse_1755788864524'; // Use the existing staging schema
  console.log('🔍 Debugging deletion issue in schema:', stagingSchema);

  try {
    // Check what's in the loop_split_segments table
    const segmentsCheck = await pool.query(`
      SELECT original_loop_uuid, segment_name, segment_number
      FROM ${stagingSchema}.loop_split_segments
      LIMIT 10
    `);
    
    console.log('📋 Loop split segments found:', segmentsCheck.rows.length);
    segmentsCheck.rows.forEach(row => {
      console.log(`  - ${row.segment_name} (original: ${row.original_loop_uuid})`);
    });

    // Check what original trails exist
    const originalTrailsCheck = await pool.query(`
      SELECT app_uuid, name, original_trail_uuid
      FROM ${stagingSchema}.trails
      WHERE original_trail_uuid IS NOT NULL
      ORDER BY name
    `);
    
    console.log('📋 Trails with original_trail_uuid:', originalTrailsCheck.rows.length);
    originalTrailsCheck.rows.forEach(row => {
      console.log(`  - ${row.name} (app_uuid: ${row.app_uuid}, original: ${row.original_trail_uuid})`);
    });

    // Check for trails that should have been deleted (loops that were split)
    const loopsToDelete = await pool.query(`
      SELECT app_uuid, name
      FROM ${stagingSchema}.trails
      WHERE app_uuid IN (
        SELECT original_loop_uuid FROM ${stagingSchema}.loop_split_segments
      )
    `);
    
    console.log('🗑️ Original loop trails that should be deleted:', loopsToDelete.rows.length);
    loopsToDelete.rows.forEach(row => {
      console.log(`  - ${row.name} (${row.app_uuid})`);
    });

    // Check for trails that are both original loops AND split segments
    const duplicateCheck = await pool.query(`
      SELECT t1.app_uuid, t1.name, t1.original_trail_uuid, t2.name as segment_name
      FROM ${stagingSchema}.trails t1
      JOIN ${stagingSchema}.trails t2 ON t1.app_uuid = t2.original_trail_uuid
      WHERE t1.original_trail_uuid IS NULL  -- t1 is an original trail
      AND t2.original_trail_uuid IS NOT NULL  -- t2 is a split segment
    `);
    
    console.log('🔍 Trails that are both original and have segments:', duplicateCheck.rows.length);
    duplicateCheck.rows.forEach(row => {
      console.log(`  - Original: ${row.name} (${row.app_uuid})`);
      console.log(`    Segment: ${row.segment_name} (original_trail_uuid: ${row.original_trail_uuid})`);
    });

  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  } finally {
    await pool.end();
  }
}

debugDeletionIssue();
