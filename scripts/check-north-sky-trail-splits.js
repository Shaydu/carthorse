const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  host: 'localhost',
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'postgres',
  port: 5432
});

async function checkNorthSkyTrailSplits() {
  const pgClient = await pool.connect();
  
  try {
    console.log('🔍 Analyzing North Sky Trail splits...');
    
    // First, let's find all North Sky Trail segments in the original data
    console.log('\n📋 Original North Sky Trail segments in public.trails:');
    const originalSegments = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry) as length_m,
        ST_AsGeoJSON(geometry) as geojson
      FROM public.trails 
      WHERE name ILIKE '%north sky%'
      ORDER BY ST_Length(geometry) DESC
    `);
    
    console.log(`Found ${originalSegments.rows.length} North Sky Trail segments in original data:`);
    originalSegments.rows.forEach((segment, index) => {
      console.log(`  ${index + 1}. ${segment.name} (${segment.app_uuid})`);
      console.log(`     Length: ${segment.length_m.toFixed(2)}m`);
      console.log(`     Start: ${segment.start_point}`);
      console.log(`     End: ${segment.end_point}`);
    });
    
    // Check for any North Sky Trail segments in our processed tables
    console.log('\n🔗 Checking processed tables for North Sky Trail:');
    
    // Check trails_snapped_small_final
    const processedSegments = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry) as length_m
      FROM public.trails_snapped_small_final 
      WHERE name ILIKE '%north sky%'
      ORDER BY ST_Length(geometry) DESC
    `);
    
    console.log(`Found ${processedSegments.rows.length} North Sky Trail segments in processed data:`);
    processedSegments.rows.forEach((segment, index) => {
      console.log(`  ${index + 1}. ${segment.name} (${segment.app_uuid})`);
      console.log(`     Length: ${segment.length_m.toFixed(2)}m`);
      console.log(`     Start: ${segment.start_point}`);
      console.log(`     End: ${segment.end_point}`);
    });
    
    // Check trails_snapped_small_final_backup
    const backupSegments = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry) as length_m
      FROM public.trails_snapped_small_final_backup 
      WHERE name ILIKE '%north sky%'
      ORDER BY ST_Length(geometry) DESC
    `);
    
    console.log(`Found ${backupSegments.rows.length} North Sky Trail segments in backup data:`);
    backupSegments.rows.forEach((segment, index) => {
      console.log(`  ${index + 1}. ${segment.name} (${segment.app_uuid})`);
      console.log(`     Length: ${segment.length_m.toFixed(2)}m`);
      console.log(`     Start: ${segment.start_point}`);
      console.log(`     End: ${segment.end_point}`);
    });
    
    // Now let's look for potential connections between North Sky Trail segments
    console.log('\n🔍 Looking for potential connections between North Sky Trail segments:');
    
    const potentialConnections = await pgClient.query(`
      WITH north_sky_segments AS (
        SELECT 
          app_uuid,
          name,
          geometry,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point
        FROM public.trails 
        WHERE name ILIKE '%north sky%'
      )
      SELECT 
        t1.app_uuid as segment1_id,
        t1.name as segment1_name,
        t2.app_uuid as segment2_id,
        t2.name as segment2_name,
        ST_Distance(t1.start_point, t2.start_point) as start_to_start,
        ST_Distance(t1.start_point, t2.end_point) as start_to_end,
        ST_Distance(t1.end_point, t2.start_point) as end_to_start,
        ST_Distance(t1.end_point, t2.end_point) as end_to_end,
        LEAST(
          ST_Distance(t1.start_point, t2.start_point),
          ST_Distance(t1.start_point, t2.end_point),
          ST_Distance(t1.end_point, t2.start_point),
          ST_Distance(t1.end_point, t2.end_point)
        ) as min_distance
      FROM north_sky_segments t1
      CROSS JOIN north_sky_segments t2
      WHERE t1.app_uuid < t2.app_uuid
      ORDER BY min_distance
    `);
    
    console.log(`Found ${potentialConnections.rows.length} potential connections between North Sky Trail segments:`);
    potentialConnections.rows.forEach((connection, index) => {
      console.log(`  ${index + 1}. ${connection.segment1_name} ↔ ${connection.segment2_name}`);
      console.log(`     Min distance: ${connection.min_distance.toFixed(2)}m`);
      console.log(`     Start→Start: ${connection.start_to_start.toFixed(2)}m`);
      console.log(`     Start→End: ${connection.start_to_end.toFixed(2)}m`);
      console.log(`     End→Start: ${connection.end_to_start.toFixed(2)}m`);
      console.log(`     End→End: ${connection.end_to_end.toFixed(2)}m`);
    });
    
    // Check if there are any trails that might bridge the gaps
    console.log('\n🌉 Looking for potential bridge trails near North Sky Trail:');
    
    const nearbyTrails = await pgClient.query(`
      WITH north_sky_extent AS (
        SELECT ST_Envelope(ST_Collect(geometry)) as bbox
        FROM public.trails 
        WHERE name ILIKE '%north sky%'
      )
      SELECT 
        t.app_uuid,
        t.name,
        t.trail_type,
        ST_Length(t.geometry) as length_m,
        ST_Distance(t.geometry, ns.bbox) as distance_to_north_sky
      FROM public.trails t, north_sky_extent ns
      WHERE ST_DWithin(t.geometry, ns.bbox, 100)  -- Within 100m of North Sky Trail extent
        AND t.name NOT ILIKE '%north sky%'
      ORDER BY distance_to_north_sky, length_m DESC
      LIMIT 10
    `);
    
    console.log(`Found ${nearbyTrails.rows.length} nearby trails that might bridge gaps:`);
    nearbyTrails.rows.forEach((trail, index) => {
      console.log(`  ${index + 1}. ${trail.name} (${trail.trail_type})`);
      console.log(`     Length: ${trail.length_m.toFixed(2)}m`);
      console.log(`     Distance to North Sky: ${trail.distance_to_north_sky.toFixed(2)}m`);
    });
    
    // Check for any water features or obstacles that might cause splits
    console.log('\n💧 Checking for water features or obstacles near North Sky Trail:');
    
    const obstacles = await pgClient.query(`
      WITH north_sky_extent AS (
        SELECT ST_Envelope(ST_Collect(geometry)) as bbox
        FROM public.trails 
        WHERE name ILIKE '%north sky%'
      )
      SELECT 
        t.app_uuid,
        t.name,
        t.trail_type,
        ST_Length(t.geometry) as length_m,
        ST_Distance(t.geometry, ns.bbox) as distance_to_north_sky
      FROM public.trails t, north_sky_extent ns
      WHERE ST_DWithin(t.geometry, ns.bbox, 50)  -- Within 50m of North Sky Trail extent
        AND (t.trail_type ILIKE '%water%' OR t.name ILIKE '%creek%' OR t.name ILIKE '%river%' OR t.name ILIKE '%stream%')
      ORDER BY distance_to_north_sky
    `);
    
    console.log(`Found ${obstacles.rows.length} potential water obstacles near North Sky Trail:`);
    obstacles.rows.forEach((obstacle, index) => {
      console.log(`  ${index + 1}. ${obstacle.name} (${obstacle.trail_type})`);
      console.log(`     Length: ${obstacle.length_m.toFixed(2)}m`);
      console.log(`     Distance to North Sky: ${obstacle.distance_to_north_sky.toFixed(2)}m`);
    });
    
    console.log('\n📊 Summary:');
    console.log(`   Original North Sky segments: ${originalSegments.rows.length}`);
    console.log(`   Processed segments: ${processedSegments.rows.length}`);
    console.log(`   Backup segments: ${backupSegments.rows.length}`);
    console.log(`   Potential connections: ${potentialConnections.rows.length}`);
    console.log(`   Nearby bridge trails: ${nearbyTrails.rows.length}`);
    console.log(`   Water obstacles: ${obstacles.rows.length}`);
    
    if (originalSegments.rows.length > 1) {
      console.log('\n⚠️  The North Sky Trail appears to be split into multiple segments in the ORIGINAL data.');
      console.log('   This suggests the disconnections are inherent in the source data, not caused by our processing.');
    } else {
      console.log('\n✅ The North Sky Trail appears to be a single segment in the original data.');
      console.log('   Any splits would be introduced during processing.');
    }
    
  } catch (error) {
    console.error('❌ Error during analysis:', error);
    throw error;
  } finally {
    pgClient.release();
    await pool.end();
  }
}

// Run the script
checkNorthSkyTrailSplits().catch(console.error);
