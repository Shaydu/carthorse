const { Pool } = require('pg');

async function fixEpicLongLoop() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('Fixing Epic Long Loop distance...');
    
    // Fix Epic Long Loop - set distance back to 32km
    const result = await pgClient.query(`
      UPDATE route_patterns 
      SET target_distance_km = 32
      WHERE pattern_name = 'Epic Long Loop'
    `);
    
    console.log(`Updated ${result.rowCount} epic long loop patterns`);
    
    // Show all loop patterns
    const updated = await pgClient.query('SELECT * FROM route_patterns WHERE pattern_name LIKE \'%Loop%\' ORDER BY target_distance_km');
    console.log('\nAll loop patterns:');
    updated.rows.forEach(row => {
      console.log(`  ${row.pattern_name}: ${row.target_distance_km}km, ${row.target_elevation_gain}m elevation, ${row.route_shape}`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pgClient.end();
  }
}

fixEpicLongLoop();
