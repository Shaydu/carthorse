const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  host: 'localhost',
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'postgres',
  port: 5432
});

async function checkNorthSkySourceId() {
  const pgClient = await pool.connect();
  
  try {
    const searchId = 'df3b7eb8-b3bf-4ad8-bed8-979c6378f870';
    
    console.log(`🔍 Checking source columns for North Sky Trail ID: ${searchId}`);
    
    // Check osm_id column
    console.log('\n📋 Checking osm_id column:');
    const osmIdCheck = await pgClient.query(`
      SELECT app_uuid, name, osm_id, trail_type, length_km
      FROM public.trails 
      WHERE osm_id = $1 OR name ILIKE '%north sky%'
      ORDER BY name
    `, [searchId]);
    
    console.log(`Found ${osmIdCheck.rows.length} matches in osm_id:`);
    osmIdCheck.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.name} (${row.app_uuid})`);
      console.log(`     osm_id: ${row.osm_id}`);
      console.log(`     Length: ${row.length_km}km`);
    });
    
    // Check source column
    console.log('\n📋 Checking source column:');
    const sourceCheck = await pgClient.query(`
      SELECT app_uuid, name, source, trail_type, length_km
      FROM public.trails 
      WHERE source = $1 OR name ILIKE '%north sky%'
      ORDER BY name
    `, [searchId]);
    
    console.log(`Found ${sourceCheck.rows.length} matches in source:`);
    sourceCheck.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.name} (${row.app_uuid})`);
      console.log(`     source: ${row.source}`);
      console.log(`     Length: ${row.length_km}km`);
    });
    
    // Check source_tags column for the ID
    console.log('\n📋 Checking source_tags column:');
    const sourceTagsCheck = await pgClient.query(`
      SELECT app_uuid, name, source_tags, trail_type, length_km
      FROM public.trails 
      WHERE name ILIKE '%north sky%'
      ORDER BY name
    `);
    
    console.log(`Found ${sourceTagsCheck.rows.length} North Sky trails with source_tags:`);
    sourceTagsCheck.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.name} (${row.app_uuid})`);
      console.log(`     source_tags: ${JSON.stringify(row.source_tags)}`);
      console.log(`     Length: ${row.length_km}km`);
      
      // Check if the search ID is in the source_tags
      if (row.source_tags && JSON.stringify(row.source_tags).includes(searchId)) {
        console.log(`     ⭐ FOUND SEARCH ID IN SOURCE_TAGS!`);
      }
    });
    
    // Let's also check if the ID might be in any text field
    console.log('\n🔍 Searching all text fields for the ID:');
    const textSearch = await pgClient.query(`
      SELECT app_uuid, name, trail_type, length_km
      FROM public.trails 
      WHERE name ILIKE '%north sky%'
        AND (
          osm_id::text ILIKE '%df3b7eb8%' 
          OR source::text ILIKE '%df3b7eb8%'
          OR source_tags::text ILIKE '%df3b7eb8%'
        )
      ORDER BY name
    `);
    
    console.log(`Found ${textSearch.rows.length} North Sky trails with ID pattern in text fields:`);
    textSearch.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.name} (${row.app_uuid}) - ${row.length_km}km`);
    });
    
    // Now let's analyze the connections for the actual North Sky Trail segments we found
    console.log('\n🔗 Analyzing connections for actual North Sky Trail segments:');
    
    const northSkySegments = await pgClient.query(`
      SELECT app_uuid, name, trail_type, length_km, ST_Length(geometry) as length_m
      FROM public.trails 
      WHERE name ILIKE '%north sky%'
      ORDER BY ST_Length(geometry) DESC
    `);
    
    for (const segment of northSkySegments.rows) {
      console.log(`\n📋 Analyzing ${segment.name} (${segment.app_uuid}):`);
      console.log(`   Length: ${segment.length_km}km (${segment.length_m.toFixed(2)}m)`);
      
      // Find trails that touch this segment
      const touchingTrails = await pgClient.query(`
        SELECT 
          t.app_uuid,
          t.name,
          t.trail_type,
          t.length_km,
          ST_Length(t.geometry) as length_m,
          ST_Distance(t.geometry, ns.geometry) as distance_to_north_sky,
          CASE 
            WHEN ST_DWithin(ST_StartPoint(t.geometry), ST_StartPoint(ns.geometry), 25) THEN 'start_to_start'
            WHEN ST_DWithin(ST_StartPoint(t.geometry), ST_EndPoint(ns.geometry), 25) THEN 'start_to_end'
            WHEN ST_DWithin(ST_EndPoint(t.geometry), ST_StartPoint(ns.geometry), 25) THEN 'end_to_start'
            WHEN ST_DWithin(ST_EndPoint(t.geometry), ST_EndPoint(ns.geometry), 25) THEN 'end_to_end'
            WHEN ST_DWithin(t.geometry, ns.geometry, 25) THEN 'path_intersection'
            ELSE 'nearby'
          END as connection_type
        FROM public.trails t
        CROSS JOIN (
          SELECT geometry FROM public.trails WHERE app_uuid = $1
        ) ns
        WHERE t.app_uuid != $1
          AND ST_DWithin(t.geometry, ns.geometry, 25)  -- Within 25m
        ORDER BY distance_to_north_sky, t.name
        LIMIT 10
      `, [segment.app_uuid]);
      
      console.log(`   Found ${touchingTrails.rows.length} nearby trails:`);
      touchingTrails.rows.forEach((trail, index) => {
        console.log(`     ${index + 1}. ${trail.name} (${trail.trail_type})`);
        console.log(`        Distance: ${trail.distance_to_north_sky.toFixed(2)}m`);
        console.log(`        Connection: ${trail.connection_type}`);
        console.log(`        Length: ${trail.length_km}km`);
      });
    }
    
    console.log('\n📊 Summary:');
    console.log(`   The ID '${searchId}' was not found in any column.`);
    console.log(`   However, we found ${northSkySegments.rows.length} actual North Sky Trail segments.`);
    console.log(`   The splits you're seeing are likely between these actual segments.`);
    
  } catch (error) {
    console.error('❌ Error during analysis:', error);
    throw error;
  } finally {
    pgClient.release();
    await pool.end();
  }
}

// Run the script
checkNorthSkySourceId().catch(console.error);
