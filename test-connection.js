const { Client } = require('pg');

async function testConnection() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu',
    password: '',
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    const result = await client.query('SELECT COUNT(*) FROM cotrex_trails WHERE id = 4409');
    console.log('✅ Query successful:', result.rows[0]);
    
    const trail = await client.query('SELECT id, name FROM cotrex_trails WHERE id = 4409');
    console.log('✅ Trail data:', trail.rows[0]);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

testConnection();
