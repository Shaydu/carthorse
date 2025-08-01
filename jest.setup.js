// Ensure required PostGIS test environment variables are set for all tests
process.env.PGHOST = process.env.PGHOST || 'localhost';
process.env.PGUSER = process.env.PGUSER || 'tester';
process.env.PGPASSWORD = process.env.PGPASSWORD || '';
process.env.PGDATABASE = process.env.PGDATABASE || 'testdb_testonly_test';
process.env.PGPORT = process.env.PGPORT || '5432';

// Set test-specific environment variables
process.env.TEST_PGHOST = process.env.TEST_PGHOST || process.env.PGHOST || 'localhost';
process.env.TEST_PGUSER = process.env.TEST_PGUSER || process.env.PGUSER || 'tester';
process.env.TEST_PGPASSWORD = process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '';
process.env.TEST_PGDATABASE = process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'testdb_testonly_test';
process.env.TEST_PGPORT = process.env.TEST_PGPORT || process.env.PGPORT || '5432';

// Jest setup file
const { Client } = require('pg');

// Validate test database connection
async function validateTestDatabase() {
  const client = new Client({
    host: process.env.TEST_PGHOST,
    port: parseInt(process.env.TEST_PGPORT),
    user: process.env.TEST_PGUSER,
    password: process.env.TEST_PGPASSWORD,
    database: process.env.TEST_PGDATABASE,
  });

  try {
    await client.connect();
    const result = await client.query("SELECT COUNT(*) as count FROM trails");
    console.log(`✅ Test database connection validated: ${result.rows[0].count} trails available`);
    await client.end();
  } catch (error) {
    console.warn(`⚠️  Test database connection failed: ${error.message}`);
    console.warn('Tests may be skipped if database is not available');
  }
}

// Run validation in non-blocking way
validateTestDatabase().catch(console.warn); 