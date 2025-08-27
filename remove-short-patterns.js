const { Pool } = require('pg');

async function removeShortPatterns() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('Removing short route patterns...');
    
    // Delete short patterns
    const result = await pgClient.query(
      "DELETE FROM route_patterns WHERE pattern_name LIKE '%Short%'"
    );
    
    console.log(`Removed ${result.rowCount} patterns`);
    
    // Show remaining patterns
    const remaining = await pgClient.query('SELECT * FROM route_patterns ORDER BY target_distance_km');
    console.log('\nRemaining route patterns:');
    remaining.rows.forEach(row => {
      console.log(`  ${row.pattern_name}: ${row.target_distance_km}km, ${row.target_elevation_gain}m elevation, ${row.route_shape}`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pgClient.end();
  }
}

removeShortPatterns();
