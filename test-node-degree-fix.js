#!/usr/bin/env node
/**
 * Test script to verify node degree calculation fix
 * 
 * This script compares the old incorrect degree calculation with the new correct one
 * that uses pgRouting's cnt field from ways_noded_vertices_pgr.
 */

const { Pool } = require('pg');

// Configuration
const config = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu'
};

const stagingSchema = 'staging_boulder_1754318437837'; // Use your actual staging schema

async function testNodeDegreeFix() {
  const pgClient = new Pool(config);
  
  try {
    console.log('🧪 Testing node degree calculation fix...');
    console.log(`🎯 Using staging schema: ${stagingSchema}`);

    // Step 1: Check if pgRouting tables exist
    console.log('\n📊 Step 1: Checking pgRouting tables...');
    const tablesCheck = await pgClient.query(`
      SELECT 
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded_vertices_pgr') as vertices_exist,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded') as edges_exist
    `, [stagingSchema]);
    
    if (!tablesCheck.rows[0].vertices_exist || !tablesCheck.rows[0].edges_exist) {
      console.log('❌ pgRouting tables not found. Please run the full export process first.');
      return;
    }
    
    console.log('✅ pgRouting tables found');

    // Step 2: Compare old vs new degree calculation
    console.log('\n🔍 Step 2: Comparing degree calculation methods...');
    
    const comparisonResult = await pgClient.query(`
      WITH old_degree_calculation AS (
        SELECT 
          v.id,
          v.cnt as correct_degree,
          COALESCE(degree_counts.incorrect_degree, 0) as incorrect_degree
        FROM ${stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN (
          SELECT 
            vertex_id,
            COUNT(*) as incorrect_degree
          FROM (
            SELECT source as vertex_id FROM ${stagingSchema}.ways_noded WHERE source IS NOT NULL
            UNION ALL
            SELECT target as vertex_id FROM ${stagingSchema}.ways_noded WHERE target IS NOT NULL
          ) all_vertices
          GROUP BY vertex_id
        ) degree_counts ON v.id = degree_counts.vertex_id
        ORDER BY v.id
        LIMIT 20
      )
      SELECT 
        id,
        correct_degree,
        incorrect_degree,
        CASE 
          WHEN correct_degree = incorrect_degree THEN '✅ Match'
          ELSE '❌ Mismatch'
        END as status,
        CASE 
          WHEN correct_degree >= 3 THEN 'intersection'
          WHEN correct_degree = 2 THEN 'connector'
          WHEN correct_degree = 1 THEN 'endpoint'
          ELSE 'unknown'
        END as correct_node_type,
        CASE 
          WHEN incorrect_degree >= 3 THEN 'intersection'
          WHEN incorrect_degree = 2 THEN 'connector'
          WHEN incorrect_degree = 1 THEN 'endpoint'
          ELSE 'unknown'
        END as incorrect_node_type
      FROM old_degree_calculation
      ORDER BY id
    `);
    
    console.log('📊 Degree calculation comparison:');
    console.log('   ID | Correct | Incorrect | Status   | Correct Type | Incorrect Type');
    console.log('   ---|---------|-----------|----------|--------------|---------------');
    
    let matchCount = 0;
    let mismatchCount = 0;
    
    comparisonResult.rows.forEach(row => {
      const status = row.correct_degree === row.incorrect_degree ? '✅' : '❌';
      console.log(`   ${row.id.toString().padStart(2)} | ${row.correct_degree.toString().padStart(7)} | ${row.incorrect_degree.toString().padStart(9)} | ${status.padStart(8)} | ${row.correct_node_type.padStart(12)} | ${row.incorrect_node_type.padStart(13)}`);
      
      if (row.correct_degree === row.incorrect_degree) {
        matchCount++;
      } else {
        mismatchCount++;
      }
    });
    
    console.log(`\n📈 Summary:`);
    console.log(`   ✅ Matches: ${matchCount}`);
    console.log(`   ❌ Mismatches: ${mismatchCount}`);
    console.log(`   📊 Accuracy: ${((matchCount / (matchCount + mismatchCount)) * 100).toFixed(1)}%`);

    // Step 3: Show degree distribution
    console.log('\n📊 Step 3: Degree distribution analysis...');
    const degreeDistribution = await pgClient.query(`
      SELECT 
        cnt as degree,
        COUNT(*) as vertex_count,
        CASE 
          WHEN cnt >= 3 THEN 'intersection'
          WHEN cnt = 2 THEN 'connector'
          WHEN cnt = 1 THEN 'endpoint'
          ELSE 'unknown'
        END as node_type
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    
    console.log('📊 Degree distribution:');
    console.log('   Degree | Count | Node Type');
    console.log('   -------|-------|----------');
    
    degreeDistribution.rows.forEach(row => {
      console.log(`   ${row.degree.toString().padStart(6)} | ${row.vertex_count.toString().padStart(5)} | ${row.node_type}`);
    });

    // Step 4: Test the fixed export query
    console.log('\n🛤️ Step 4: Testing fixed export query...');
    const fixedExportResult = await pgClient.query(`
      SELECT 
        v.id, 
        'node-' || v.id::text as node_uuid, 
        ST_Y(v.the_geom) as lat, 
        ST_X(v.the_geom) as lng, 
        COALESCE(ST_Z(v.the_geom), 0) as elevation, 
        CASE 
          WHEN v.cnt >= 3 THEN 'intersection'
          WHEN v.cnt = 2 THEN 'connector'
          WHEN v.cnt = 1 THEN 'endpoint'
          ELSE 'unknown'
        END as node_type, 
        v.cnt as degree
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      ORDER BY v.id
      LIMIT 10
    `);
    
    console.log('✅ Fixed export query results (first 10 nodes):');
    console.log('   ID | UUID      | Lat        | Lng         | Type        | Degree');
    console.log('   ---|-----------|------------|-------------|-------------|--------');
    
    fixedExportResult.rows.forEach(row => {
      console.log(`   ${row.id.toString().padStart(2)} | ${row.node_uuid.padStart(9)} | ${row.lat.toFixed(6).padStart(10)} | ${row.lng.toFixed(6).padStart(11)} | ${row.node_type.padStart(11)} | ${row.degree.toString().padStart(6)}`);
    });

    // Step 5: Show the impact
    console.log('\n📈 Step 5: Impact analysis...');
    if (mismatchCount > 0) {
      console.log('🔧 The fix addresses these issues:');
      console.log('   - Incorrect node type classification');
      console.log('   - Wrong degree counts in exports');
      console.log('   - Inaccurate network analysis');
      console.log('   - Poor route generation decisions');
      
      console.log('\n✅ The fix provides:');
      console.log('   - Correct degree counts from pgRouting');
      console.log('   - Accurate node type classification');
      console.log('   - Proper network analysis');
      console.log('   - Better route generation');
    } else {
      console.log('✅ All degree calculations match - no issues found!');
    }

    console.log('\n🎉 Node degree calculation test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    await pgClient.end();
  }
}

// Run the test
if (require.main === module) {
  testNodeDegreeFix().catch(console.error);
}

module.exports = { testNodeDegreeFix };
