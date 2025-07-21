// Jest setup file
process.env.PGDATABASE = 'trail_master_db_test';
process.env.PGUSER = 'tester';
process.env.NODE_ENV = 'test';
const { Client } = require('pg');

// Remove seedTestDatabase and beforeAll logic; keep only env setup. 