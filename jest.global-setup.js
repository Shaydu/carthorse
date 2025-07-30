const { execSync } = require('child_process');
const { Client } = require('pg');
const { TestOrchestrator } = require('./src/orchestrator/TestOrchestrator');

module.exports = async () => {
  // Ensure tester user and test DB exist
  execSync('./scripts/setup-tester-user.sh', { stdio: 'inherit' });

  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'trail_master_db_test',
  });
  let connected = false;
  try {
    await client.connect();
    const res = await client.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'trails'");
    if (res.rowCount === 0) {
      // Table missing, need to rebuild
      await client.end();
      TestOrchestrator.rebuildTestDatabase();
    } else {
      connected = true;
    }
  } catch (err) {
    // If connection fails, try to rebuild
    TestOrchestrator.rebuildTestDatabase();
  } finally {
    if (connected) await client.end();
  }
}; 