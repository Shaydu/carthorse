#!/usr/bin/env ts-node
"use strict";
/**
 * Cleanup script to remove unused test functions from the database
 */
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const env_1 = require("../utils/env");
async function cleanupUnusedFunctions() {
    console.log('🧹 Cleaning up unused test functions...');
    const dbConfig = (0, env_1.getDbConfig)();
    const client = new pg_1.Client(dbConfig);
    try {
        await client.connect();
        console.log('✅ Connected to database');
        // List of unused test functions to remove
        const unusedFunctions = [
            'test_function_v13',
            'test_edge_generation',
            'test_params'
        ];
        let totalDropped = 0;
        for (const funcName of unusedFunctions) {
            try {
                console.log(`📋 Checking function: ${funcName}`);
                // Check if function exists
                const existsResult = await client.query(`
          SELECT COUNT(*) as count 
          FROM information_schema.routines 
          WHERE routine_schema = 'public' 
            AND routine_name = $1
        `, [funcName]);
                if (existsResult.rows[0].count > 0) {
                    console.log(`  Dropping: ${funcName}`);
                    await client.query(`DROP FUNCTION IF EXISTS ${funcName} CASCADE`);
                    totalDropped++;
                    console.log(`  ✅ Dropped ${funcName}`);
                }
                else {
                    console.log(`  ⚠️  Function ${funcName} does not exist`);
                }
            }
            catch (error) {
                console.error(`  ❌ Failed to drop ${funcName}:`, error);
            }
        }
        console.log(`\n📊 Cleanup Summary:`);
        console.log(`  ✅ Total functions dropped: ${totalDropped}`);
        // Also check for any other test functions that might be unused
        console.log('\n🔍 Checking for other potentially unused functions...');
        const testFunctionsResult = await client.query(`
      SELECT routine_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
        AND routine_name LIKE '%test%'
        AND routine_name NOT IN (
          'test_route_finding',
          'test_route_finding_configurable', 
          'test_route_strategies'
        )
      ORDER BY routine_name
    `);
        if (testFunctionsResult.rows.length > 0) {
            console.log('📋 Other test functions found:');
            testFunctionsResult.rows.forEach(row => {
                console.log(`  - ${row.routine_name}`);
            });
            console.log('💡 Consider reviewing these functions for potential removal');
        }
        else {
            console.log('✅ No other test functions found');
        }
    }
    catch (error) {
        console.error('❌ Cleanup failed:', error);
        throw error;
    }
    finally {
        await client.end();
    }
}
// Main execution
if (require.main === module) {
    cleanupUnusedFunctions()
        .then(() => {
        console.log('✅ Function cleanup completed successfully');
        process.exit(0);
    })
        .catch((error) => {
        console.error('❌ Function cleanup failed:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=cleanup-unused-functions.js.map