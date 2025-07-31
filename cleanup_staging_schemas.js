#!/usr/bin/env node

const { Client } = require('pg');

async function cleanupStagingSchemas() {
  console.log('🧹 Cleaning up PostgreSQL staging schemas...\n');

  const pgClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'trail_master_db',
    user: process.env.DB_USER || 'tester',
    password: process.env.DB_PASSWORD || 'test'
  });

  try {
    await pgClient.connect();
    console.log('✅ Connected to PostgreSQL');

    // Get all staging schemas
    const schemasResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%'
      ORDER BY schema_name
    `);

    const stagingSchemas = schemasResult.rows.map(row => row.schema_name);
    
    if (stagingSchemas.length === 0) {
      console.log('✅ No staging schemas found to clean up');
      return;
    }

    console.log(`📋 Found ${stagingSchemas.length} staging schemas to clean up:`);
    stagingSchemas.forEach(schema => console.log(`   - ${schema}`));

    // Drop each staging schema
    let droppedCount = 0;
    for (const schema of stagingSchemas) {
      try {
        await pgClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        console.log(`🗑️  Dropped schema: ${schema}`);
        droppedCount++;
      } catch (error) {
        console.error(`❌ Failed to drop schema ${schema}:`, error.message);
      }
    }

    console.log(`\n✅ Cleanup complete! Dropped ${droppedCount} staging schemas`);

    // Verify cleanup
    const remainingResult = await pgClient.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%'
    `);
    
    const remainingCount = remainingResult.rows[0].count;
    if (remainingCount === 0) {
      console.log('✅ All staging schemas successfully cleaned up');
    } else {
      console.log(`⚠️  ${remainingCount} staging schemas still remain`);
    }

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the cleanup
cleanupStagingSchemas().catch(console.error); 