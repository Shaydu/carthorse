const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  host: 'localhost',
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'postgres',
  port: 5432
});

async function checkNorthSkyConnections() {
  const pgClient = await pool.connect();
  
  try {
    const northSkyId = 'df3b7eb8-b3bf-4ad8-bed8-979c6378f870';
    
    console.log(`🔍 Analyzing North Sky Trail connections for ID: ${northSkyId}`);
    
    // First, let's get the North Sky Trail details
    console.log('\n📋 North Sky Trail details:');
    const northSkyTrail = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        trail_type,
        surface,
        difficulty,
        length_km,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry) as length_m,
        ST_AsGeoJSON(geometry) as geojson
      FROM public.trails 
      WHERE app_uuid = $1
    `, [northSkyId]);
    
    if (northSkyTrail.rows.length === 0) {
      console.log('❌ North Sky Trail not found with that ID');
      return;
    }
    
    const trail = northSkyTrail.rows[0];
    console.log(`   Name: ${trail.name}`);
    console.log(`   Type: ${trail.trail_type}`);
    console.log(`   Surface: ${trail.surface}`);
    console.log(`   Difficulty: ${trail.difficulty}`);
    console.log(`   Length: ${trail.length_km}km (${trail.length_m.toFixed(2)}m)`);
    console.log(`   Start: ${trail.start_point}`);
    console.log(`   End: ${trail.end_point}`);
    
    // Now let's find trails that touch this North Sky Trail
    console.log('\n🔗 Finding trails that touch this North Sky Trail:');
    
    const touchingTrails = await pgClient.query(`
      SELECT 
        t.app_uuid,
        t.name,
        t.trail_type,
        t.surface,
        t.difficulty,
        t.length_km,
        ST_Length(t.geometry) as length_m,
        ST_Distance(t.geometry, ns.geometry) as distance_to_north_sky,
        ST_AsText(ST_StartPoint(t.geometry)) as start_point,
        ST_AsText(ST_EndPoint(t.geometry)) as end_point,
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
    `, [northSkyId]);
    
    console.log(`Found ${touchingTrails.rows.length} trails within 25m of this North Sky Trail:`);
    
    // Group by connection type
    const connectionsByType = {
      start_to_start: [],
      start_to_end: [],
      end_to_start: [],
      end_to_end: [],
      path_intersection: [],
      nearby: []
    };
    
    touchingTrails.rows.forEach(trail => {
      connectionsByType[trail.connection_type].push(trail);
    });
    
    // Display results by connection type
    Object.entries(connectionsByType).forEach(([type, trails]) => {
      if (trails.length > 0) {
        console.log(`\n${type.toUpperCase().replace(/_/g, ' ')} (${trails.length} trails):`);
        trails.forEach((t, index) => {
          console.log(`  ${index + 1}. ${t.name} (${t.trail_type})`);
          console.log(`     Length: ${t.length_km}km (${t.length_m.toFixed(2)}m)`);
          console.log(`     Distance: ${t.distance_to_north_sky.toFixed(2)}m`);
          console.log(`     Start: ${t.start_point}`);
          console.log(`     End: ${t.end_point}`);
        });
      }
    });
    
    // Let's also check for exact endpoint matches
    console.log('\n🎯 Exact endpoint matches (0.00m distance):');
    const exactMatches = touchingTrails.rows.filter(t => t.distance_to_north_sky === 0);
    
    if (exactMatches.length > 0) {
      exactMatches.forEach((trail, index) => {
        console.log(`  ${index + 1}. ${trail.name} (${trail.trail_type})`);
        console.log(`     Connection: ${trail.connection_type}`);
        console.log(`     Length: ${trail.length_km}km`);
      });
    } else {
      console.log('   No exact endpoint matches found');
    }
    
    // Check for trails that might be continuations or branches
    console.log('\n🔄 Potential trail continuations or branches:');
    const potentialContinuations = touchingTrails.rows.filter(t => 
      t.connection_type.includes('end') && t.distance_to_north_sky <= 5
    );
    
    if (potentialContinuations.length > 0) {
      potentialContinuations.forEach((trail, index) => {
        console.log(`  ${index + 1}. ${trail.name} (${trail.trail_type})`);
        console.log(`     Connection: ${trail.connection_type}`);
        console.log(`     Distance: ${trail.distance_to_north_sky.toFixed(2)}m`);
      });
    } else {
      console.log('   No obvious trail continuations found');
    }
    
    // Summary
    console.log('\n📊 Connection Summary:');
    console.log(`   Total nearby trails: ${touchingTrails.rows.length}`);
    console.log(`   Exact matches (0.00m): ${exactMatches.length}`);
    console.log(`   Potential continuations: ${potentialContinuations.length}`);
    
    Object.entries(connectionsByType).forEach(([type, trails]) => {
      if (trails.length > 0) {
        console.log(`   ${type}: ${trails.length}`);
      }
    });
    
  } catch (error) {
    console.error('❌ Error during analysis:', error);
    throw error;
  } finally {
    pgClient.release();
    await pool.end();
  }
}

// Run the script
checkNorthSkyConnections().catch(console.error);
