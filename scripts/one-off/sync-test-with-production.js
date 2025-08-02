#!/usr/bin/env node

const { Client } = require('pg');
const fs = require('fs');
const path = require('path'); // Added missing import for path

async function syncTestWithProduction() {
  const testClient = new Client({
    host: 'localhost',
    user: 'tester',
    password: 'testpass',
    database: 'trail_master_db_test',
    port: 5432
  });

  const prodClient = new Client({
    host: 'localhost',
    user: 'tester',
    password: 'testpass',
    database: 'trail_master_db',
    port: 5432
  });

  try {
    await testClient.connect();
    await prodClient.connect();
    
    console.log('🔄 Syncing test database with production...\n');

    // 1. Check what's missing in test database
    console.log('🔍 Checking missing functions in test database...');
    
    const missingFunctions = [
      'copy_and_split_trails_to_staging_native',
      'get_intersection_tolerance'
    ];

    for (const funcName of missingFunctions) {
      const exists = await testClient.query(`
        SELECT COUNT(*) as count
        FROM information_schema.routines 
        WHERE routine_schema = 'public' AND routine_name = $1
      `, [funcName]);
      
      if (exists.rows[0].count === 0) {
        console.log(`  ❌ Missing: ${funcName}`);
        
        // Get function definition from production
        const funcDef = await prodClient.query(`
          SELECT routine_definition
          FROM information_schema.routines 
          WHERE routine_schema = 'public' AND routine_name = $1
        `, [funcName]);
        
        if (funcDef.rows.length > 0 && funcDef.rows[0].routine_definition) {
          try {
            await testClient.query(funcDef.rows[0].routine_definition);
            console.log(`  ✅ Installed: ${funcName}`);
          } catch (error) {
            console.log(`  ❌ Failed to install ${funcName}: ${error.message}`);
          }
        } else {
          console.log(`  ❌ Could not find definition for ${funcName}`);
        }
      } else {
        console.log(`  ✅ Present: ${funcName}`);
      }
    }

    // 2. Install function files if they exist
    console.log('\n📋 Installing function files...');
    
    const functionFiles = [
      './sql/organized/functions/carthorse-configurable-sql.sql',
      './sql/organized/functions/recursive-route-finding-configurable.sql'
    ];

    for (const file of functionFiles) {
      if (fs.existsSync(file)) {
        try {
          const sql = fs.readFileSync(file, 'utf8');
          await testClient.query(sql);
          console.log(`  ✅ Installed: ${path.basename(file)}`);
        } catch (error) {
          console.log(`  ❌ Failed to install ${path.basename(file)}: ${error.message}`);
        }
      } else {
        console.log(`  ⚠️  File not found: ${file}`);
      }
    }

    // 3. Final verification
    console.log('\n🔍 Final verification...');
    
    for (const funcName of missingFunctions) {
      const exists = await testClient.query(`
        SELECT COUNT(*) as count
        FROM information_schema.routines 
        WHERE routine_schema = 'public' AND routine_name = $1
      `, [funcName]);
      
      const status = exists.rows[0].count > 0 ? '✅' : '❌';
      console.log(`  ${status} ${funcName}`);
    }

    // 4. Compare function counts
    const testFunctionCount = await testClient.query(`
      SELECT COUNT(*) as count
      FROM information_schema.routines 
      WHERE routine_schema = 'public'
    `);
    
    const prodFunctionCount = await prodClient.query(`
      SELECT COUNT(*) as count
      FROM information_schema.routines 
      WHERE routine_schema = 'public'
    `);

    console.log(`\n📊 Function Counts:`);
    console.log(`  Production: ${prodFunctionCount.rows[0].count}`);
    console.log(`  Test: ${testFunctionCount.rows[0].count}`);
    
    const functionDiff = prodFunctionCount.rows[0].count - testFunctionCount.rows[0].count;
    if (functionDiff === 0) {
      console.log('🎉 Test database is now in sync with production!');
    } else {
      console.log(`⚠️  Still ${functionDiff} functions different`);
    }

  } catch (error) {
    console.error('❌ Sync error:', error);
  } finally {
    await testClient.end();
    await prodClient.end();
  }
}

syncTestWithProduction(); 