#!/usr/bin/env node

const { Client } = require('pg');

async function syncTestDatabase() {
  const client = new Client({
    host: 'localhost',
    user: 'tester',
    password: 'testpass',
    database: 'trail_master_db_test',
    port: 5432
  });

  try {
    await client.connect();
    console.log('🔄 Syncing test database with production cleanup...\n');

    // 1. Check current state
    console.log('📊 Checking test database state...');
    
    const functionCount = await client.query(`
      SELECT COUNT(*) as count
      FROM information_schema.routines 
      WHERE routine_schema = 'public'
    `);
    
    const tableCount = await client.query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    const stagingCount = await client.query(`
      SELECT COUNT(*) as count
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%'
    `);

    console.log(`  Functions: ${functionCount.rows[0].count}`);
    console.log(`  Tables: ${tableCount.rows[0].count}`);
    console.log(`  Staging schemas: ${stagingCount.rows[0].count}`);

    // 2. Find old staging schemas in test database
    console.log('\n🔍 Finding old staging schemas in test database...');
    
    const oldStagingSchemas = await client.query(`
      SELECT schema_name, 
             EXTRACT(EPOCH FROM (NOW() - to_timestamp(
               split_part(schema_name, '_', 3)::bigint / 1000
             ))) / 3600 as hours_old
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%'
      AND EXTRACT(EPOCH FROM (NOW() - to_timestamp(
        split_part(schema_name, '_', 3)::bigint / 1000
      ))) > 24
      ORDER BY hours_old DESC
    `);

    if (oldStagingSchemas.rows.length > 0) {
      console.log(`📋 Found ${oldStagingSchemas.rows.length} old staging schemas:`);
      oldStagingSchemas.rows.forEach(schema => {
        const hoursOld = parseFloat(schema.hours_old) || 0;
        console.log(`  ${schema.schema_name} (${hoursOld.toFixed(1)}h old)`);
      });

      // 3. Drop old staging schemas
      console.log('\n🗑️  Dropping old staging schemas...');
      for (const schema of oldStagingSchemas.rows) {
        try {
          await client.query(`DROP SCHEMA IF EXISTS ${schema.schema_name} CASCADE`);
          console.log(`  ✅ Dropped ${schema.schema_name}`);
        } catch (error) {
          console.log(`  ❌ Failed to drop ${schema.schema_name}: ${error.message}`);
        }
      }
    } else {
      console.log('✅ No old staging schemas to clean up');
    }

    // 4. Check for duplicate functions
    console.log('\n🔍 Checking for duplicate functions...');
    
    const duplicates = await client.query(`
      SELECT routine_name, COUNT(*) as count
      FROM information_schema.routines 
      WHERE routine_schema = 'public'
      GROUP BY routine_name 
      HAVING COUNT(*) > 1
      ORDER BY routine_name
    `);

    if (duplicates.rows.length > 0) {
      console.log(`📋 Found ${duplicates.rows.length} functions with duplicates:`);
      duplicates.rows.forEach(row => {
        console.log(`  ${row.routine_name} (${row.count} instances)`);
      });
      console.log('💡 Note: Duplicates are mostly PostGIS/PgRouting and don\'t affect performance');
    } else {
      console.log('✅ No duplicate functions found');
    }

    // 5. Verify required functions are present
    console.log('\n🔍 Verifying required orchestrator functions...');
    
    const requiredFunctions = [
      'generate_routing_nodes_native',
      'cleanup_orphaned_nodes', 
      'generate_routing_edges_native',
      'cleanup_routing_graph',
      'copy_and_split_trails_to_staging_native',
      'test_route_finding',
      'generate_route_recommendations',
      'find_routes_recursive',
      'get_intersection_tolerance'
    ];

    for (const funcName of requiredFunctions) {
      const exists = await client.query(`
        SELECT COUNT(*) as count
        FROM information_schema.routines 
        WHERE routine_schema = 'public' AND routine_name = $1
      `, [funcName]);
      
      const status = exists.rows[0].count > 0 ? '✅' : '❌';
      console.log(`  ${status} ${funcName}`);
    }

    // 6. Final state check
    console.log('\n📊 Final test database state...');
    
    const finalFunctionCount = await client.query(`
      SELECT COUNT(*) as count
      FROM information_schema.routines 
      WHERE routine_schema = 'public'
    `);
    
    const finalStagingCount = await client.query(`
      SELECT COUNT(*) as count
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%'
    `);

    console.log(`  Functions: ${finalFunctionCount.rows[0].count}`);
    console.log(`  Staging schemas: ${finalStagingCount.rows[0].count}`);

    // 7. Compare with production
    console.log('\n🔄 Comparing with production database...');
    
    const prodClient = new Client({
      host: 'localhost',
      user: 'tester',
      password: 'testpass',
      database: 'trail_master_db',
      port: 5432
    });

    await prodClient.connect();
    
    const prodFunctionCount = await prodClient.query(`
      SELECT COUNT(*) as count
      FROM information_schema.routines 
      WHERE routine_schema = 'public'
    `);
    
    const prodStagingCount = await prodClient.query(`
      SELECT COUNT(*) as count
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%'
    `);

    console.log(`  Production functions: ${prodFunctionCount.rows[0].count}`);
    console.log(`  Test functions: ${finalFunctionCount.rows[0].count}`);
    console.log(`  Production staging: ${prodStagingCount.rows[0].count}`);
    console.log(`  Test staging: ${finalStagingCount.rows[0].count}`);

    const functionSync = finalFunctionCount.rows[0].count === prodFunctionCount.rows[0].count;
    const stagingSync = finalStagingCount.rows[0].count === prodStagingCount.rows[0].count;

    console.log(`\n📊 Sync Status:`);
    console.log(`  Functions: ${functionSync ? '✅' : '❌'} ${functionSync ? 'In sync' : 'Out of sync'}`);
    console.log(`  Staging: ${stagingSync ? '✅' : '❌'} ${stagingSync ? 'In sync' : 'Out of sync'}`);

    if (functionSync && stagingSync) {
      console.log('\n🎉 Test database is now in sync with production!');
    } else {
      console.log('\n⚠️  Test database still needs manual sync');
    }

    await prodClient.end();

  } catch (error) {
    console.error('❌ Sync error:', error);
  } finally {
    await client.end();
  }
}

syncTestDatabase(); 