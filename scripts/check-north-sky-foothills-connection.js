const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  host: 'localhost',
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'postgres',
  port: 5432
});

async function checkNorthSkyFoothillsConnection() {
  const pgClient = await pool.connect();
  
  try {
    console.log('🔍 Analyzing North Sky Trail ↔ Foothills North Trail connections...');
    
    // First, let's get all North Sky Trail segments
    console.log('\n📋 North Sky Trail segments:');
    const northSkySegments = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        length_km,
        ST_Length(geometry) as length_m,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM public.trails 
      WHERE name ILIKE '%north sky%'
      ORDER BY ST_Length(geometry) DESC
    `);
    
    console.log(`Found ${northSkySegments.rows.length} North Sky Trail segments:`);
    northSkySegments.rows.forEach((segment, index) => {
      console.log(`  ${index + 1}. ${segment.name} (${segment.app_uuid})`);
      console.log(`     Length: ${segment.length_km}km (${segment.length_m.toFixed(2)}m)`);
      console.log(`     Start: ${segment.start_point}`);
      console.log(`     End: ${segment.end_point}`);
    });
    
    // Now let's get all Foothills North Trail segments
    console.log('\n📋 Foothills North Trail segments:');
    const foothillsSegments = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        length_km,
        ST_Length(geometry) as length_m,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM public.trails 
      WHERE name ILIKE '%foothills north%'
      ORDER BY ST_Length(geometry) DESC
    `);
    
    console.log(`Found ${foothillsSegments.rows.length} Foothills North Trail segments:`);
    foothillsSegments.rows.forEach((segment, index) => {
      console.log(`  ${index + 1}. ${segment.name} (${segment.app_uuid})`);
      console.log(`     Length: ${segment.length_km}km (${segment.length_m.toFixed(2)}m)`);
      console.log(`     Start: ${segment.start_point}`);
      console.log(`     End: ${segment.end_point}`);
    });
    
    // Now let's check the specific connections between North Sky and Foothills North
    console.log('\n🔗 North Sky ↔ Foothills North Trail connections:');
    
    const connections = await pgClient.query(`
      WITH north_sky AS (
        SELECT app_uuid, name, geometry, 
               ST_StartPoint(geometry) as start_point,
               ST_EndPoint(geometry) as end_point
        FROM public.trails 
        WHERE name ILIKE '%north sky%'
      ),
      foothills AS (
        SELECT app_uuid, name, geometry,
               ST_StartPoint(geometry) as start_point,
               ST_EndPoint(geometry) as end_point
        FROM public.trails 
        WHERE name ILIKE '%foothills north%'
      )
      SELECT 
        ns.app_uuid as north_sky_id,
        ns.name as north_sky_name,
        fh.app_uuid as foothills_id,
        fh.name as foothills_name,
        ST_Distance(ns.geometry, fh.geometry) as trail_distance,
        ST_Distance(ns.start_point, fh.start_point) as start_to_start,
        ST_Distance(ns.start_point, fh.end_point) as start_to_end,
        ST_Distance(ns.end_point, fh.start_point) as end_to_start,
        ST_Distance(ns.end_point, fh.end_point) as end_to_end,
        LEAST(
          ST_Distance(ns.start_point, fh.start_point),
          ST_Distance(ns.start_point, fh.end_point),
          ST_Distance(ns.end_point, fh.start_point),
          ST_Distance(ns.end_point, fh.end_point)
        ) as min_endpoint_distance,
        CASE 
          WHEN ST_DWithin(ns.start_point, fh.start_point, 25) THEN 'north_sky_start_to_foothills_start'
          WHEN ST_DWithin(ns.start_point, fh.end_point, 25) THEN 'north_sky_start_to_foothills_end'
          WHEN ST_DWithin(ns.end_point, fh.start_point, 25) THEN 'north_sky_end_to_foothills_start'
          WHEN ST_DWithin(ns.end_point, fh.end_point, 25) THEN 'north_sky_end_to_foothills_end'
          WHEN ST_DWithin(ns.geometry, fh.geometry, 25) THEN 'path_intersection'
          ELSE 'nearby'
        END as connection_type
      FROM north_sky ns
      CROSS JOIN foothills fh
      WHERE ST_DWithin(ns.geometry, fh.geometry, 25)  -- Within 25m
      ORDER BY min_endpoint_distance, trail_distance
    `);
    
    console.log(`Found ${connections.rows.length} connections between North Sky and Foothills North trails:`);
    
    // Group connections by type
    const connectionsByType = {
      north_sky_start_to_foothills_start: [],
      north_sky_start_to_foothills_end: [],
      north_sky_end_to_foothills_start: [],
      north_sky_end_to_foothills_end: [],
      path_intersection: [],
      nearby: []
    };
    
    connections.rows.forEach(conn => {
      connectionsByType[conn.connection_type].push(conn);
    });
    
    // Display results by connection type
    Object.entries(connectionsByType).forEach(([type, conns]) => {
      if (conns.length > 0) {
        console.log(`\n${type.toUpperCase().replace(/_/g, ' ')} (${conns.length} connections):`);
        conns.forEach((conn, index) => {
          console.log(`  ${index + 1}. ${conn.north_sky_name} ↔ ${conn.foothills_name}`);
          console.log(`     Min endpoint distance: ${conn.min_endpoint_distance.toFixed(2)}m`);
          console.log(`     Trail distance: ${conn.trail_distance.toFixed(2)}m`);
          console.log(`     Start→Start: ${conn.start_to_start.toFixed(2)}m`);
          console.log(`     Start→End: ${conn.start_to_end.toFixed(2)}m`);
          console.log(`     End→Start: ${conn.end_to_start.toFixed(2)}m`);
          console.log(`     End→End: ${conn.end_to_end.toFixed(2)}m`);
        });
      }
    });
    
    // Check for exact connections (0.00m distance)
    console.log('\n🎯 Exact connections (0.00m distance):');
    const exactConnections = connections.rows.filter(conn => 
      conn.min_endpoint_distance === 0 || conn.trail_distance === 0
    );
    
    if (exactConnections.length > 0) {
      exactConnections.forEach((conn, index) => {
        console.log(`  ${index + 1}. ${conn.north_sky_name} ↔ ${conn.foothills_name}`);
        console.log(`     Connection type: ${conn.connection_type}`);
        console.log(`     Min endpoint distance: ${conn.min_endpoint_distance.toFixed(2)}m`);
        console.log(`     Trail distance: ${conn.trail_distance.toFixed(2)}m`);
      });
    } else {
      console.log('   No exact connections found');
    }
    
    // Check for close connections (within 5m)
    console.log('\n🔗 Close connections (within 5m):');
    const closeConnections = connections.rows.filter(conn => 
      conn.min_endpoint_distance <= 5 && conn.min_endpoint_distance > 0
    );
    
    if (closeConnections.length > 0) {
      closeConnections.forEach((conn, index) => {
        console.log(`  ${index + 1}. ${conn.north_sky_name} ↔ ${conn.foothills_name}`);
        console.log(`     Connection type: ${conn.connection_type}`);
        console.log(`     Min endpoint distance: ${conn.min_endpoint_distance.toFixed(2)}m`);
        console.log(`     Trail distance: ${conn.trail_distance.toFixed(2)}m`);
      });
    } else {
      console.log('   No close connections found');
    }
    
    // Summary
    console.log('\n📊 Connection Summary:');
    console.log(`   Total connections: ${connections.rows.length}`);
    console.log(`   Exact connections (0.00m): ${exactConnections.length}`);
    console.log(`   Close connections (≤5m): ${closeConnections.length}`);
    
    Object.entries(connectionsByType).forEach(([type, conns]) => {
      if (conns.length > 0) {
        console.log(`   ${type}: ${conns.length}`);
      }
    });
    
    // Check if any North Sky segments are completely isolated from Foothills North
    console.log('\n🔍 Checking for isolated North Sky segments:');
    const isolatedNorthSky = northSkySegments.rows.filter(ns => {
      return !connections.rows.some(conn => conn.north_sky_id === ns.app_uuid);
    });
    
    if (isolatedNorthSky.length > 0) {
      console.log(`Found ${isolatedNorthSky.length} North Sky segments with no connection to Foothills North:`);
      isolatedNorthSky.forEach((segment, index) => {
        console.log(`  ${index + 1}. ${segment.name} (${segment.app_uuid})`);
        console.log(`     Length: ${segment.length_km}km`);
      });
    } else {
      console.log('   All North Sky segments have connections to Foothills North');
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
checkNorthSkyFoothillsConnection().catch(console.error);
