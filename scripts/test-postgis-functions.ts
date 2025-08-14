#!/usr/bin/env ts-node

import { Pool } from 'pg';

const TEST_CONFIG = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'carthorse',
  password: process.env.PGPASSWORD || ''
};

async function testPostGISFunctions() {
  console.log('🔍 Testing PostGIS function availability...');
  
  const pgClient = new Pool(TEST_CONFIG);
  
  try {
    // Test 1: Check if ST_ClusterDBSCAN exists
    console.log('📋 Testing ST_ClusterDBSCAN availability...');
    try {
      const result = await pgClient.query(`
        SELECT ST_ClusterDBSCAN(
          ST_GeomFromText('POINT(0 0)'),
          0.1,
          1
        ) as test_result
      `);
      console.log('✅ ST_ClusterDBSCAN is available');
    } catch (error) {
      console.log('❌ ST_ClusterDBSCAN is NOT available:', error instanceof Error ? error.message : error);
    }

    // Test 2: Check PostGIS version
    console.log('📋 Checking PostGIS version...');
    try {
      const versionResult = await pgClient.query(`
        SELECT PostGIS_Version() as postgis_version
      `);
      console.log(`✅ PostGIS version: ${versionResult.rows[0].postgis_version}`);
    } catch (error) {
      console.log('❌ Could not get PostGIS version:', error instanceof Error ? error.message : error);
    }

    // Test 3: Check PostgreSQL version
    console.log('📋 Checking PostgreSQL version...');
    try {
      const pgVersionResult = await pgClient.query(`
        SELECT version() as pg_version
      `);
      console.log(`✅ PostgreSQL version: ${pgVersionResult.rows[0].pg_version}`);
    } catch (error) {
      console.log('❌ Could not get PostgreSQL version:', error instanceof Error ? error.message : error);
    }

    // Test 4: Test temporary table creation
    console.log('📋 Testing temporary table creation...');
    try {
      await pgClient.query(`
        CREATE TEMP TABLE test_temp_table (
          id SERIAL PRIMARY KEY,
          name TEXT
        ) ON COMMIT DROP
      `);
      await pgClient.query(`INSERT INTO test_temp_table (name) VALUES ('test')`);
      const testResult = await pgClient.query(`SELECT * FROM test_temp_table`);
      console.log(`✅ Temporary table creation works: ${testResult.rows.length} rows`);
    } catch (error) {
      console.log('❌ Temporary table creation failed:', error instanceof Error ? error.message : error);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testPostGISFunctions().catch(console.error);
