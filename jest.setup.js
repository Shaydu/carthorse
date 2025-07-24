// Ensure required PostGIS test environment variables are set for all tests
process.env.PGHOST = process.env.PGHOST || 'localhost';
process.env.PGUSER = process.env.PGUSER || 'tester';
process.env.PGPASSWORD = process.env.PGPASSWORD || '';
process.env.PGDATABASE = process.env.PGDATABASE || 'trail_master_db_test';

// Jest setup file
const { Client } = require('pg');

// Remove seedTestDatabase and beforeAll logic; keep only env setup. 