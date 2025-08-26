const Database = require('better-sqlite3');

// Open the SQLite database
const db = new Database('/Users/shaydu/dev/carthorse/test-output/boulder.db');

try {
  // Get the schema for route_recommendations table
  const schema = db.prepare(`
    PRAGMA table_info(route_recommendations)
  `).all();

  console.log('📋 route_recommendations table schema:');
  schema.forEach(column => {
    console.log(`  ${column.name}: ${column.type} ${column.notnull ? 'NOT NULL' : ''} ${column.pk ? 'PRIMARY KEY' : ''}`);
  });

  // Check if there are any routes in the staging schema that should have been exported
  console.log('\n🔍 Checking if routes exist in staging schema...');
  
  // Let's also check what's in the route_analysis table since that has data
  const routeAnalysis = db.prepare(`
    SELECT route_uuid, route_name, total_distance_km, total_elevation_gain_m 
    FROM route_analysis 
    LIMIT 5
  `).all();

  console.log('\n📊 Sample route_analysis data:');
  routeAnalysis.forEach(route => {
    console.log(`  - ${route.route_uuid}: ${route.route_name} (${route.total_distance_km}km, ${route.total_elevation_gain_m}m)`);
  });

  // Check for any routes with "Cragmoor" in the name
  const cragmoorRoutes = db.prepare(`
    SELECT route_uuid, route_name, total_distance_km, total_elevation_gain_m 
    FROM route_analysis 
    WHERE route_name LIKE '%Cragmoor%'
  `).all();

  if (cragmoorRoutes.length > 0) {
    console.log('\n🔍 Found Cragmoor routes in route_analysis:');
    cragmoorRoutes.forEach(route => {
      console.log(`  - ${route.route_uuid}: ${route.route_name}`);
    });
  } else {
    console.log('\n❌ No Cragmoor routes found in route_analysis');
  }

} catch (error) {
  console.error('Error:', error.message);
} finally {
  db.close();
}
