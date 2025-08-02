#!/usr/bin/env node

const { Client } = require('pg');

async function auditProductionFunctions() {
  const client = new Client({
    host: 'localhost',
    user: 'tester',
    password: 'testpass',
    database: 'trail_master_db',
    port: 5432
  });

  try {
    await client.connect();
    console.log('🔍 Auditing Production Database Functions...\n');

    // 1. Get all functions in production
    const productionFunctions = await client.query(`
      SELECT 
        r.routine_name,
        r.routine_type,
        r.data_type,
        p.parameter_name,
        p.parameter_mode,
        p.parameter_default
      FROM information_schema.routines r
      LEFT JOIN information_schema.parameters p 
        ON r.specific_name = p.specific_name
      WHERE r.routine_schema = 'public'
      ORDER BY r.routine_name, p.ordinal_position
    `);

    // 2. Get all functions in test
    const testFunctions = await client.query(`
      SELECT 
        routine_name,
        routine_type,
        data_type
      FROM information_schema.routines 
      WHERE routine_schema = 'public'
      ORDER BY routine_name
    `);

    // 3. Analyze function categories
    const functionCategories = {
      routing: [],
      intersection: [],
      elevation: [],
      validation: [],
      utility: [],
      postgis: [],
      pgrouting: [],
      other: []
    };

    const productionFunctionNames = new Set();
    const testFunctionNames = new Set();

    // Process production functions
    productionFunctions.rows.forEach(row => {
      const name = row.routine_name;
      productionFunctionNames.add(name);
      
      if (name.includes('routing') || name.includes('route')) {
        functionCategories.routing.push(row);
      } else if (name.includes('intersection')) {
        functionCategories.intersection.push(row);
      } else if (name.includes('elevation')) {
        functionCategories.elevation.push(row);
      } else if (name.includes('valid') || name.includes('test')) {
        functionCategories.validation.push(row);
      } else if (name.startsWith('st_')) {
        functionCategories.postgis.push(row);
      } else if (name.startsWith('pgr_')) {
        functionCategories.pgrouting.push(row);
      } else if (name.includes('update') || name.includes('get') || name.includes('set')) {
        functionCategories.utility.push(row);
      } else {
        functionCategories.other.push(row);
      }
    });

    // Process test functions
    testFunctions.rows.forEach(row => {
      testFunctionNames.add(row.routine_name);
    });

    // 4. Find differences
    const onlyInProduction = [...productionFunctionNames].filter(name => !testFunctionNames.has(name));
    const onlyInTest = [...testFunctionNames].filter(name => !productionFunctionNames.has(name));
    const inBoth = [...productionFunctionNames].filter(name => testFunctionNames.has(name));

    // 5. Check function usage in staging schemas
    const stagingSchemas = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%' 
      ORDER BY schema_name DESC 
      LIMIT 5
    `);

    console.log('📊 FUNCTION AUDIT RESULTS\n');
    console.log('='.repeat(60));

    // Summary
    console.log(`📈 SUMMARY:`);
    console.log(`  Production functions: ${productionFunctionNames.size}`);
    console.log(`  Test functions: ${testFunctionNames.size}`);
    console.log(`  In both: ${inBoth.length}`);
    console.log(`  Only in production: ${onlyInProduction.length}`);
    console.log(`  Only in test: ${onlyInTest.length}`);

    console.log('\n' + '='.repeat(60));

    // Routing functions analysis
    console.log('\n🛤️  ROUTING FUNCTIONS:');
    console.log('-'.repeat(40));
    functionCategories.routing.forEach(func => {
      const status = testFunctionNames.has(func.routine_name) ? '✅' : '❌';
      console.log(`${status} ${func.routine_name} (${func.routine_type})`);
    });

    // Intersection functions
    console.log('\n🔗 INTERSECTION FUNCTIONS:');
    console.log('-'.repeat(40));
    functionCategories.intersection.forEach(func => {
      const status = testFunctionNames.has(func.routine_name) ? '✅' : '❌';
      console.log(`${status} ${func.routine_name} (${func.routine_type})`);
    });

    // Elevation functions
    console.log('\n🏔️  ELEVATION FUNCTIONS:');
    console.log('-'.repeat(40));
    functionCategories.elevation.forEach(func => {
      const status = testFunctionNames.has(func.routine_name) ? '✅' : '❌';
      console.log(`${status} ${func.routine_name} (${func.routine_type})`);
    });

    // Validation functions
    console.log('\n🔍 VALIDATION FUNCTIONS:');
    console.log('-'.repeat(40));
    functionCategories.validation.forEach(func => {
      const status = testFunctionNames.has(func.routine_name) ? '✅' : '❌';
      console.log(`${status} ${func.routine_name} (${func.routine_type})`);
    });

    // Utility functions
    console.log('\n🛠️  UTILITY FUNCTIONS:');
    console.log('-'.repeat(40));
    functionCategories.utility.forEach(func => {
      const status = testFunctionNames.has(func.routine_name) ? '✅' : '❌';
      console.log(`${status} ${func.routine_name} (${func.routine_type})`);
    });

    // Only in production (potentially obsolete)
    if (onlyInProduction.length > 0) {
      console.log('\n⚠️  FUNCTIONS ONLY IN PRODUCTION (POTENTIALLY OBSOLETE):');
      console.log('-'.repeat(50));
      onlyInProduction.forEach(name => {
        console.log(`❌ ${name}`);
      });
    }

    // Only in test (missing from production)
    if (onlyInTest.length > 0) {
      console.log('\n➕ FUNCTIONS ONLY IN TEST (MISSING FROM PRODUCTION):');
      console.log('-'.repeat(50));
      onlyInTest.forEach(name => {
        console.log(`➕ ${name}`);
      });
    }

    // Check staging schema usage
    console.log('\n📋 RECENT STAGING SCHEMAS:');
    console.log('-'.repeat(40));
    stagingSchemas.rows.forEach(schema => {
      console.log(`  ${schema.schema_name}`);
    });

    // Check for function calls in orchestrator
    console.log('\n🔍 CHECKING ORCHESTRATOR FUNCTION CALLS...');
    const orchestratorFunctions = [
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

    console.log('\n🎯 ORCHESTRATOR-REQUIRED FUNCTIONS:');
    console.log('-'.repeat(40));
    orchestratorFunctions.forEach(funcName => {
      const inProd = productionFunctionNames.has(funcName);
      const inTest = testFunctionNames.has(funcName);
      const status = inProd && inTest ? '✅' : inProd ? '⚠️' : '❌';
      console.log(`${status} ${funcName} (prod: ${inProd}, test: ${inTest})`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('✅ Audit complete!');

  } catch (error) {
    console.error('❌ Audit error:', error);
  } finally {
    await client.end();
  }
}

auditProductionFunctions(); 