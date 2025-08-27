const { Pool } = require('pg');

async function updateLongLoop() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('Updating long loop target distance...');
    
    // Update Long Loop - set distance to 10km
    const result = await pgClient.query(`
      UPDATE route_patterns 
      SET target_distance_km = 10
      WHERE pattern_name LIKE '%Long%Loop%'
    `);
    
    console.log(`Updated ${result.rowCount} long loop patterns`);
    
    // Show updated patterns
    const updated = await pgClient.query('SELECT * FROM route_patterns WHERE pattern_name LIKE \'%Long%Loop%\'');
    console.log('\nUpdated long loop pattern:');
    updated.rows.forEach(row => {
      console.log(`  ${row.pattern_name}: ${row.target_distance_km}km, ${row.target_elevation_gain}m elevation, ${row.route_shape}`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pgClient.end();
  }
}

updateLongLoop();
