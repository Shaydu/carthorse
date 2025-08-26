const Database = require('better-sqlite3');

// Open the SQLite database
const db = new Database('/Users/shaydu/dev/carthorse/test-output/boulder.db');

try {
  console.log('🔍 Searching for the specific loop route...\n');
  
  // First, let's see all routes with 8 trail segments
  const routesWith8Trails = db.prepare(`
    SELECT 
      route_uuid,
      route_name,
      edge_count,
      unique_trail_count,
      total_distance_km,
      total_elevation_gain_m
    FROM route_analysis 
    WHERE edge_count = 8
    ORDER BY total_distance_km DESC
  `).all();

  console.log(`Found ${routesWith8Trails.length} routes with 8 trail segments:`);
  routesWith8Trails.forEach((route, index) => {
    console.log(`\n${index + 1}. Route UUID: ${route.route_uuid}`);
    console.log(`   Name: ${route.route_name}`);
    console.log(`   Distance: ${route.total_distance_km} km`);
    console.log(`   Elevation Gain: ${route.total_elevation_gain_m} m`);
    console.log(`   Edge Count: ${route.edge_count}`);
    console.log(`   Unique Trail Count: ${route.unique_trail_count}`);
  });

  // Now let's check if there are any routes that contain both "Cragmoor" and "Hardscrabble" and "Mesa" and "Shanahan"
  console.log('\n🔍 Searching for routes containing all the key trail names...');
  
  const complexRoutes = db.prepare(`
    SELECT 
      route_uuid,
      route_name,
      edge_count,
      unique_trail_count,
      total_distance_km,
      total_elevation_gain_m
    FROM route_analysis 
    WHERE route_name LIKE '%Cragmoor%' 
      AND route_name LIKE '%Hardscrabble%'
      AND route_name LIKE '%Mesa%'
      AND route_name LIKE '%Shanahan%'
    ORDER BY total_distance_km DESC
  `).all();

  console.log(`Found ${complexRoutes.length} routes containing all key trail names:`);
  complexRoutes.forEach((route, index) => {
    console.log(`\n${index + 1}. Route UUID: ${route.route_uuid}`);
    console.log(`   Name: ${route.route_name}`);
    console.log(`   Distance: ${route.total_distance_km} km`);
    console.log(`   Elevation Gain: ${route.total_elevation_gain_m} m`);
  });

  // Let's also check what routes contain "Medium Challenging Loop" in the name
  console.log('\n🔍 Searching for "Medium Challenging Loop" routes...');
  
  const mediumChallengingRoutes = db.prepare(`
    SELECT 
      route_uuid,
      route_name,
      edge_count,
      unique_trail_count,
      total_distance_km,
      total_elevation_gain_m
    FROM route_analysis 
    WHERE route_name LIKE '%Medium Challenging Loop%'
    ORDER BY total_distance_km DESC
  `).all();

  console.log(`Found ${mediumChallengingRoutes.length} "Medium Challenging Loop" routes:`);
  mediumChallengingRoutes.forEach((route, index) => {
    console.log(`\n${index + 1}. Route UUID: ${route.route_uuid}`);
    console.log(`   Name: ${route.route_name}`);
    console.log(`   Distance: ${route.total_distance_km} km`);
    console.log(`   Elevation Gain: ${route.total_elevation_gain_m} m`);
  });

  // Let's also check the trails table to see what Cragmoor trails exist
  console.log('\n🔍 Checking what Cragmoor trails exist in the database...');
  
  const cragmoorTrails = db.prepare(`
    SELECT 
      app_uuid,
      name,
      length_km,
      elevation_gain
    FROM trails 
    WHERE name LIKE '%Cragmoor%'
    ORDER BY name
  `).all();

  console.log(`Found ${cragmoorTrails.length} Cragmoor trails:`);
  cragmoorTrails.forEach((trail, index) => {
    console.log(`\n${index + 1}. UUID: ${trail.app_uuid}`);
    console.log(`   Name: ${trail.name}`);
    console.log(`   Length: ${trail.length_km} km`);
    console.log(`   Elevation Gain: ${trail.elevation_gain} m`);
  });

} catch (error) {
  console.error('Error:', error.message);
} finally {
  db.close();
}
