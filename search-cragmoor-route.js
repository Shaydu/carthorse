const Database = require('better-sqlite3');

// Open the SQLite database
const db = new Database('/Users/shaydu/dev/carthorse/test-output/boulder.db');

try {
  console.log('🔍 Searching for routes with "Cragmoor" in the name...\n');
  
  // Search in route_analysis table
  const cragmoorRoutes = db.prepare(`
    SELECT 
      route_uuid,
      route_name,
      edge_count,
      unique_trail_count,
      total_distance_km,
      total_elevation_gain_m
    FROM route_analysis 
    WHERE route_name LIKE '%Cragmoor%'
    ORDER BY total_distance_km DESC
  `).all();

  console.log(`Found ${cragmoorRoutes.length} routes with "Cragmoor" in route_analysis:`);
  cragmoorRoutes.forEach((route, index) => {
    console.log(`\n${index + 1}. Route UUID: ${route.route_uuid}`);
    console.log(`   Name: ${route.route_name}`);
    console.log(`   Distance: ${route.total_distance_km} km`);
    console.log(`   Elevation Gain: ${route.total_elevation_gain_m} m`);
    console.log(`   Edge Count: ${route.edge_count}`);
    console.log(`   Unique Trail Count: ${route.unique_trail_count}`);
  });

  // Also check route_trails table for Cragmoor trails
  console.log('\n🔍 Checking route_trails for Cragmoor trails...');
  const cragmoorTrails = db.prepare(`
    SELECT DISTINCT
      route_uuid,
      trail_name,
      segment_order,
      segment_distance_km,
      segment_elevation_gain
    FROM route_trails 
    WHERE trail_name LIKE '%Cragmoor%'
    ORDER BY route_uuid, segment_order
  `).all();

  console.log(`Found ${cragmoorTrails.length} Cragmoor trail segments in route_trails:`);
  cragmoorTrails.forEach((trail, index) => {
    console.log(`\n${index + 1}. Route: ${trail.route_uuid}`);
    console.log(`   Trail: ${trail.trail_name}`);
    console.log(`   Order: ${trail.segment_order}`);
    console.log(`   Distance: ${trail.segment_distance_km} km`);
    console.log(`   Elevation: ${trail.segment_elevation_gain} m`);
  });

  // Check if the specific route UUID exists
  const specificRoute = 'unified-loop-hawick-circuits-1756221600362-66';
  console.log(`\n🔍 Checking for specific route UUID: ${specificRoute}`);
  
  const routeExists = db.prepare(`
    SELECT COUNT(*) as count FROM route_analysis WHERE route_uuid = ?
  `).get(specificRoute);
  
  if (routeExists.count > 0) {
    console.log(`✅ Found the specific route!`);
    const routeDetails = db.prepare(`
      SELECT * FROM route_analysis WHERE route_uuid = ?
    `).get(specificRoute);
    console.log(JSON.stringify(routeDetails, null, 2));
  } else {
    console.log(`❌ Specific route not found in current database`);
  }

} catch (error) {
  console.error('Error:', error.message);
} finally {
  db.close();
}
