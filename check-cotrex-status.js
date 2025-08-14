const { Pool } = require('pg');
require('dotenv').config();

async function checkCotrexStatus() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres'
  });

  try {
    // Check if cotrex.trails table exists
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'cotrex' AND table_name = 'trails'
    `);
    
    console.log('COTREX trails table exists:', tableCheck.rowCount > 0);
    
    if (tableCheck.rowCount > 0) {
      // Count COTREX trails
      const cotrexCount = await pool.query('SELECT COUNT(*) as count FROM cotrex.trails');
      console.log('COTREX trails count:', cotrexCount.rows[0].count);
      
      // Check if any COTREX trails are in public.trails
      const publicCotrexCount = await pool.query(`
        SELECT COUNT(*) as count 
        FROM public.trails 
        WHERE source = 'cotrex'
      `);
      console.log('COTREX trails in public.trails:', publicCotrexCount.rows[0].count);
      
      // Show sample COTREX trail
      const sampleTrail = await pool.query(`
        SELECT id, name, trail_type, length_miles, ST_AsText(ST_StartPoint(geometry)) as start_point
        FROM cotrex.trails 
        LIMIT 1
      `);
      if (sampleTrail.rowCount > 0) {
        console.log('Sample COTREX trail:', sampleTrail.rows[0]);
      }
    }
    
    // Show all sources in public.trails
    const sources = await pool.query(`
      SELECT source, COUNT(*) as count 
      FROM public.trails 
      GROUP BY source 
      ORDER BY count DESC
    `);
    console.log('\nSources in public.trails:');
    sources.rows.forEach(row => {
      console.log(`  ${row.source}: ${row.count}`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkCotrexStatus();
