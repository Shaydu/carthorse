const { Pool } = require('pg');

async function updateRoutePatterns() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('Updating route patterns...');
    
    // Update Medium Loop - double distance and elevation
    const mediumResult = await pgClient.query(`
      UPDATE route_patterns 
      SET target_distance_km = target_distance_km * 2,
          target_elevation_gain = target_elevation_gain * 2
      WHERE pattern_name LIKE '%Medium%Loop%'
    `);
    
    console.log(`Updated ${mediumResult.rowCount} medium loop patterns`);
    
    // Update Epic Long Loop - set distance to 32km and double elevation
    const epicResult = await pgClient.query(`
      UPDATE route_patterns 
      SET target_distance_km = 32,
          target_elevation_gain = target_elevation_gain * 2
      WHERE pattern_name LIKE '%Epic%Long%Loop%'
    `);
    
    console.log(`Updated ${epicResult.rowCount} epic long loop patterns`);
    
    // Show updated patterns
    const updated = await pgClient.query('SELECT * FROM route_patterns ORDER BY target_distance_km');
    console.log('\nUpdated route patterns:');
    updated.rows.forEach(row => {
      console.log(`  ${row.pattern_name}: ${row.target_distance_km}km, ${row.target_elevation_gain}m elevation, ${row.route_shape}`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pgClient.end();
  }
}

updateRoutePatterns();
