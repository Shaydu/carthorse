const { Pool } = require('pg');

async function testShadowCanyonCopy() {
  const pool = new Pool({
    connectionString: 'postgresql://postgres:password@localhost:5432/trail_master_db'
  });

  const targetTrailUuid = 'e393e414-b14f-46a1-9734-e6e582c602ac';
  const stagingSchema = 'carthorse_1757009688969';

  try {
    console.log('🔍 Testing Shadow Canyon Trail copy process...');
    console.log(`Target trail UUID: ${targetTrailUuid}`);
    console.log(`Staging schema: ${stagingSchema}`);

    // Step 1: Check if trail exists in public.trails
    console.log('\n📋 Step 1: Checking trail in public.trails...');
    const publicTrailResult = await pool.query(`
      SELECT app_uuid, name, region, 
             ST_NumPoints(geometry) as num_points,
             ST_Length(geometry::geography)/1000.0 as length_km,
             ST_Intersects(geometry, ST_MakeEnvelope(-105.323322108554, 39.9414084228671, -105.246109155213, 40.139896554615, 4326)) as intersects_bbox
      FROM public.trails 
      WHERE app_uuid = $1
    `, [targetTrailUuid]);

    if (publicTrailResult.rows.length === 0) {
      console.log('❌ Trail not found in public.trails!');
      return;
    }

    const publicTrail = publicTrailResult.rows[0];
    console.log(`✅ Found trail in public.trails:`);
    console.log(`   - Name: ${publicTrail.name}`);
    console.log(`   - Region: ${publicTrail.region}`);
    console.log(`   - Points: ${publicTrail.num_points}`);
    console.log(`   - Length: ${publicTrail.length_km.toFixed(3)}km`);
    console.log(`   - Intersects bbox: ${publicTrail.intersects_bbox}`);

    // Step 2: Check if trail already exists in staging
    console.log('\n📋 Step 2: Checking if trail exists in staging...');
    const stagingCheckResult = await pool.query(`
      SELECT app_uuid, name, original_trail_uuid, ST_NumPoints(geometry) as num_points
      FROM ${stagingSchema}.trails 
      WHERE app_uuid = $1 OR original_trail_uuid = $1
    `, [targetTrailUuid]);

    if (stagingCheckResult.rows.length > 0) {
      console.log('⚠️ Trail already exists in staging:');
      stagingCheckResult.rows.forEach(trail => {
        console.log(`   - UUID: ${trail.app_uuid}`);
        console.log(`   - Name: ${trail.name}`);
        console.log(`   - Original UUID: ${trail.original_trail_uuid}`);
        console.log(`   - Points: ${trail.num_points}`);
      });
      return;
    }

    // Step 3: Attempt to copy the trail
    console.log('\n📋 Step 3: Attempting to copy trail to staging...');
    const copyQuery = `
      INSERT INTO ${stagingSchema}.trails (
        original_trail_uuid, app_uuid, name, trail_type, surface, difficulty,
        geometry, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, osm_id
      )
      SELECT 
        app_uuid as original_trail_uuid,  -- Preserve original UUID
        gen_random_uuid() as app_uuid,    -- Generate new UUID for staging
        name, trail_type, surface, difficulty,
        geometry, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, osm_id
      FROM public.trails 
      WHERE app_uuid = $1
    `;

    console.log('Executing copy query...');
    const copyResult = await pool.query(copyQuery, [targetTrailUuid]);
    console.log(`✅ Copy successful! Rows affected: ${copyResult.rowCount}`);

    // Step 4: Verify the copy
    console.log('\n📋 Step 4: Verifying the copy...');
    const verifyResult = await pool.query(`
      SELECT app_uuid, name, original_trail_uuid, ST_NumPoints(geometry) as num_points,
             ST_Length(geometry::geography)/1000.0 as length_km
      FROM ${stagingSchema}.trails 
      WHERE original_trail_uuid = $1
    `, [targetTrailUuid]);

    if (verifyResult.rows.length > 0) {
      const copiedTrail = verifyResult.rows[0];
      console.log(`✅ Trail successfully copied to staging:`);
      console.log(`   - New UUID: ${copiedTrail.app_uuid}`);
      console.log(`   - Name: ${copiedTrail.name}`);
      console.log(`   - Original UUID: ${copiedTrail.original_trail_uuid}`);
      console.log(`   - Points: ${copiedTrail.num_points}`);
      console.log(`   - Length: ${copiedTrail.length_km.toFixed(3)}km`);
    } else {
      console.log('❌ Trail was not copied to staging!');
    }

  } catch (error) {
    console.error('❌ Error during copy test:', error);
    console.error('Error details:', error.message);
  } finally {
    await pool.end();
  }
}

testShadowCanyonCopy();



