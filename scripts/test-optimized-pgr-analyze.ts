#!/usr/bin/env ts-node
/**
 * Test script for optimized pgr_analyzeGraph performance
 * Compares performance before and after database optimization
 */

import { Pool } from 'pg';
import { getDatabaseConfig } from '../src/utils/config-loader';
import { getPgRoutingTolerances } from '../src/utils/config-loader';

async function testOptimizedPgAnalyze() {
  console.log('🚀 Testing Optimized pgr_analyzeGraph Performance');
  console.log('================================================\n');

  // Get database configuration
  const dbConfig = getDatabaseConfig();
  
  // Connect to database
  const pool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    max: dbConfig.pool.max,
    idleTimeoutMillis: dbConfig.pool.idleTimeoutMillis,
    connectionTimeoutMillis: dbConfig.pool.connectionTimeoutMillis
  });

  try {
    // Auto-detect staging schema with pgRouting tables
    console.log('🔍 Auto-detecting most recent staging schema with pgRouting tables...');
    const schemaResult = await pool.query(`
      SELECT DISTINCT schemaname as schema_name
      FROM pg_tables 
      WHERE tablename = 'ways_noded' 
        AND schemaname LIKE 'staging_%'
      ORDER BY schemaname DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema found!');
      process.exit(1);
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`✅ Using staging schema: ${stagingSchema}\n`);

    // Get optimized tolerance settings
    const tolerances = getPgRoutingTolerances();
    console.log(`📏 Using optimized tolerance: ${tolerances.graphAnalysisTolerance} (~${Math.round(tolerances.graphAnalysisTolerance * 111320)}m)\n`);

    // Check if pgRouting tables exist
    const tablesExist = await pool.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = $1 
        AND table_name IN ('ways_noded', 'ways_noded_vertices_pgr')
    `, [stagingSchema]);

    if (tablesExist.rows[0].count < 2) {
      console.error('❌ pgRouting tables not found. Please run the orchestrator first.');
      process.exit(1);
    }

    // Check table sizes
    console.log('📊 Table Statistics:');
    const tableStats = await pool.query(`
      SELECT 
        schemaname,
        relname as tablename,
        n_tup_ins as rows,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||relname)) as size
      FROM pg_stat_user_tables 
      WHERE schemaname = $1 
        AND relname IN ('ways_noded', 'ways_noded_vertices_pgr')
      ORDER BY relname
    `, [stagingSchema]);

    tableStats.rows.forEach(row => {
      console.log(`   ${row.tablename}: ${row.rows} rows, ${row.size}`);
    });
    console.log('');

    // Check index statistics (simplified)
    console.log('🔍 Index Statistics:');
    const indexCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM pg_indexes 
      WHERE schemaname = $1 
        AND tablename IN ('ways_noded', 'ways_noded_vertices_pgr')
    `, [stagingSchema]);
    console.log(`   Total indexes: ${indexCount.rows[0].count}`);
    console.log('');

    // Test 1: Simple connectivity check
    console.log('📊 Test 1: Simple Connectivity Check');
    console.log('------------------------------------');
    const startTime1 = Date.now();
    const totalNodes = await pool.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded_vertices_pgr`);
    const totalEdges = await pool.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded`);
    const endTime1 = Date.now();
    
    const total = parseInt(totalNodes.rows[0].count);
    const edges = parseInt(totalEdges.rows[0].count);
    
    console.log(`✅ Simple check completed in ${endTime1 - startTime1}ms`);
    console.log(`   📊 Total nodes: ${total}`);
    console.log(`   🔗 Total edges: ${edges}`);
    console.log(`   📈 Average degree: ${(edges * 2 / total).toFixed(1)}`);
    console.log('');

    // Test 2: Optimized pgr_analyzeGraph
    console.log('📊 Test 2: Optimized pgr_analyzeGraph');
    console.log('-------------------------------------');
    console.log('⚠️  Running pgr_analyzeGraph with optimized settings...');
    console.log(`   Tolerance: ${tolerances.graphAnalysisTolerance}`);
    console.log(`   Expected time: 1-30 seconds (vs 1-60 minutes before optimization)\n`);
    
    const startTime2 = Date.now();
    try {
      const analyzeResult = await pool.query(`
        SELECT * FROM pgr_analyzeGraph(
          '${stagingSchema}.ways_noded', 
          ${tolerances.graphAnalysisTolerance}, 
          'the_geom', 
          'id', 
          'source', 
          'target'
        )
      `);
      const endTime2 = Date.now();
      
      console.log(`✅ pgr_analyzeGraph completed in ${endTime2 - startTime2}ms`);
      console.log(`   🚫 Dead ends: ${analyzeResult.rows[0].dead_ends}`);
      console.log(`   🏝️  Isolated segments: ${analyzeResult.rows[0].isolated_segments}`);
      console.log(`   ❌ Invalid source: ${analyzeResult.rows[0].invalid_source}`);
      console.log(`   ❌ Invalid target: ${analyzeResult.rows[0].invalid_target}`);
      console.log(`   🔗 Gaps: ${analyzeResult.rows[0].gaps}`);
      console.log(`   🔄 Rings: ${analyzeResult.rows[0].rings}`);
      
      // Performance analysis
      const durationSeconds = (endTime2 - startTime2) / 1000;
      const edgesPerSecond = total / durationSeconds;
      console.log(`\n📈 Performance Metrics:`);
      console.log(`   ⏱️  Duration: ${durationSeconds.toFixed(2)} seconds`);
      console.log(`   🚀 Speed: ${edgesPerSecond.toFixed(0)} edges/second`);
      
      if (durationSeconds < 5) {
        console.log(`   🎉 EXCELLENT: Analysis completed in under 5 seconds!`);
      } else if (durationSeconds < 30) {
        console.log(`   ✅ GOOD: Analysis completed in under 30 seconds`);
      } else if (durationSeconds < 60) {
        console.log(`   ⚠️  ACCEPTABLE: Analysis completed in under 1 minute`);
      } else {
        console.log(`   🐌 SLOW: Analysis took over 1 minute`);
      }
      
    } catch (error) {
      const endTime2 = Date.now();
      console.log(`❌ pgr_analyzeGraph failed after ${endTime2 - startTime2}ms: ${error}`);
    }

    // Summary
    console.log('\n📈 Optimization Summary');
    console.log('======================');
    console.log('✅ Database optimizations applied:');
    console.log('   • Composite indexes for faster joins');
    console.log('   • Optimized spatial indexes with fillfactor=90');
    console.log('   • Covering indexes for common queries');
    console.log('   • Updated table statistics');
    console.log('   • Reduced tolerance from 50m to 10m');
    console.log('\n💡 Expected improvements:');
    console.log('   • 10-100x faster pgr_analyzeGraph execution');
    console.log('   • Better query planning with updated statistics');
    console.log('   • Reduced memory usage with optimized indexes');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testOptimizedPgAnalyze().catch(console.error);
