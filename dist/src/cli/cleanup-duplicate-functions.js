#!/usr/bin/env ts-node
"use strict";
/**
 * Cleanup script to remove duplicate functions from the database
 * Keeps the newer versions and drops the older ones
 */
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const env_1 = require("../utils/env");
async function cleanupDuplicateFunctions() {
    console.log('🧹 Cleaning up duplicate functions...');
    const dbConfig = (0, env_1.getDbConfig)();
    const client = new pg_1.Client(dbConfig);
    try {
        await client.connect();
        console.log('✅ Connected to database');
        // Get all duplicate functions dynamically
        const duplicateFunctionsResult = await client.query(`
      SELECT routine_name, specific_name
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
        AND routine_name IN (
          'detect_trail_intersections',
          'generate_route_name', 
          'generate_route_recommendations_configurable',
          'generate_route_recommendations_large_dataset',
          'generate_routing_nodes_native',
          'generate_simple_route_recommendations'
        )
      ORDER BY routine_name, specific_name
    `);
        // Group by routine name
        const functionGroups = {};
        duplicateFunctionsResult.rows.forEach(row => {
            if (!functionGroups[row.routine_name]) {
                functionGroups[row.routine_name] = [];
            }
            functionGroups[row.routine_name].push(row.specific_name);
        });
        let totalDropped = 0;
        for (const [routineName, specificNames] of Object.entries(functionGroups)) {
            if (specificNames.length <= 1)
                continue;
            console.log(`\n📋 Processing ${routineName}...`);
            console.log(`  Found ${specificNames.length} instances: ${specificNames.join(', ')}`);
            // Sort by specific name to identify newer ones (higher numbers)
            specificNames.sort();
            // Keep the last one (newest), drop the rest
            const toDrop = specificNames.slice(0, -1);
            const toKeep = specificNames[specificNames.length - 1];
            console.log(`  Keeping: ${toKeep}`);
            for (const specificName of toDrop) {
                try {
                    console.log(`  Dropping: ${specificName}`);
                    await client.query(`DROP FUNCTION IF EXISTS ${specificName} CASCADE`);
                    totalDropped++;
                    console.log(`  ✅ Dropped ${specificName}`);
                }
                catch (error) {
                    console.error(`  ❌ Failed to drop ${specificName}:`, error);
                }
            }
        }
        console.log(`\n📊 Cleanup Summary:`);
        console.log(`  ✅ Total functions dropped: ${totalDropped}`);
        // Verify cleanup
        console.log('\n🔍 Verifying cleanup...');
        const verificationResult = await client.query(`
      SELECT routine_name, COUNT(*) as count 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
        AND routine_name IN (
          'detect_trail_intersections',
          'generate_route_name', 
          'generate_route_recommendations_configurable',
          'generate_route_recommendations_large_dataset',
          'generate_routing_nodes_native',
          'generate_simple_route_recommendations'
        )
      GROUP BY routine_name 
      HAVING COUNT(*) > 1
    `);
        if (verificationResult.rows.length === 0) {
            console.log('✅ All duplicate functions successfully removed!');
        }
        else {
            console.log('⚠️  Some duplicates may still exist:');
            verificationResult.rows.forEach(row => {
                console.log(`  - ${row.routine_name}: ${row.count} instances`);
            });
        }
        // Show final function count
        console.log('\n📋 Final function count:');
        const finalCountResult = await client.query(`
      SELECT routine_name, COUNT(*) as count 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
        AND routine_name IN (
          'detect_trail_intersections',
          'generate_route_name', 
          'generate_route_recommendations_configurable',
          'generate_route_recommendations_large_dataset',
          'generate_routing_nodes_native',
          'generate_simple_route_recommendations'
        )
      GROUP BY routine_name 
      ORDER BY routine_name
    `);
        finalCountResult.rows.forEach(row => {
            console.log(`  - ${row.routine_name}: ${row.count} instance(s)`);
        });
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
    cleanupDuplicateFunctions()
        .then(() => {
        console.log('✅ Function cleanup completed successfully');
        process.exit(0);
    })
        .catch((error) => {
        console.error('❌ Function cleanup failed:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=cleanup-duplicate-functions.js.map