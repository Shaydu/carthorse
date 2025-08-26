const Database = require('better-sqlite3');

// Open the SQLite database
const db = new Database('/Users/shaydu/dev/carthorse/test-output/boulder.db');

try {
  // Get all table names
  const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' 
    ORDER BY name
  `).all();

  console.log('📋 Tables in database:');
  tables.forEach(table => {
    console.log(`  - ${table.name}`);
  });

  console.log('\n📊 Table contents:');
  
  tables.forEach(table => {
    const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get();
    console.log(`  ${table.name}: ${count.count} rows`);
    
    if (count.count > 0 && count.count <= 10) {
      // Show sample data for small tables
      const sample = db.prepare(`SELECT * FROM ${table.name} LIMIT 3`).all();
      console.log(`    Sample data:`, JSON.stringify(sample, null, 2));
    } else if (count.count > 10) {
      // Show just column names for large tables
      const sample = db.prepare(`SELECT * FROM ${table.name} LIMIT 1`).all();
      if (sample.length > 0) {
        console.log(`    Columns: ${Object.keys(sample[0]).join(', ')}`);
      }
    }
    console.log('');
  });

  // Specifically check for the route you're looking for
  console.log('🔍 Looking for specific route:');
  const specificRoute = db.prepare(`
    SELECT * FROM route_recommendations 
    WHERE route_uuid = 'unified-loop-hawick-circuits-1756221600362-66'
  `).all();
  
  if (specificRoute.length > 0) {
    console.log('✅ Found the specific route:', JSON.stringify(specificRoute[0], null, 2));
  } else {
    console.log('❌ Route not found');
    
    // Check for any routes with similar names
    const similarRoutes = db.prepare(`
      SELECT route_uuid, route_name FROM route_recommendations 
      WHERE route_name LIKE '%Cragmoor%' OR route_name LIKE '%Loop%'
      LIMIT 5
    `).all();
    
    if (similarRoutes.length > 0) {
      console.log('🔍 Similar routes found:');
      similarRoutes.forEach(route => {
        console.log(`  - ${route.route_uuid}: ${route.route_name}`);
      });
    }
  }

} catch (error) {
  console.error('Error:', error.message);
} finally {
  db.close();
}
