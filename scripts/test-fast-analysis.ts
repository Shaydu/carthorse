#!/usr/bin/env ts-node
/**
 * Test script for fast graph analysis methods
 * Demonstrates the performance difference between pgr_analyzeGraph and custom fast analysis
 */

import { Pool } from 'pg';
import { PgRoutingHelpers } from '../src/utils/pgrouting-helpers';
import { getDatabaseConfig } from '../src/utils/config-loader';

async function testFastAnalysis() {
  console.log('🚀 Testing Fast Graph Analysis Methods');
  console.log('=====================================\n');

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
    // Auto-detect staging schema
    console.log('🔍 Auto-detecting most recent staging schema...');
    const schemaResult = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema found!');
      process.exit(1);
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`✅ Using staging schema: ${stagingSchema}\n`);

    // Create pgRouting helpers
    const pgrouting = new PgRoutingHelpers({ stagingSchema, pgClient: pool });

    // Create pgRouting tables if they don't exist
    console.log('🔧 Creating pgRouting tables...');
    const tablesCreated = await pgrouting.createPgRoutingViews();
    if (!tablesCreated) {
      console.error('❌ Failed to create pgRouting tables');
      process.exit(1);
    }
    console.log('✅ pgRouting tables created successfully\n');

    // Test 1: Quick connectivity check (fastest)
    console.log('📊 Test 1: Quick Connectivity Check');
    console.log('-----------------------------------');
    const startTime1 = Date.now();
    const quickResult = await pgrouting.quickConnectivityCheck();
    const endTime1 = Date.now();
    
    if (quickResult.success) {
      console.log(`✅ Quick check completed in ${endTime1 - startTime1}ms`);
      console.log(`   📈 Connectivity: ${quickResult.analysis.connectivity_percentage}`);
      console.log(`   🔗 Reachable nodes: ${quickResult.analysis.reachable_nodes}/${quickResult.analysis.total_nodes}`);
      console.log(`   🌐 Fully connected: ${quickResult.analysis.is_fully_connected ? 'Yes' : 'No'}`);
    } else {
      console.log(`❌ Quick check failed: ${quickResult.error}`);
    }
    console.log('');

    // Test 2: Fast custom analysis (medium speed)
    console.log('📊 Test 2: Fast Custom Analysis');
    console.log('--------------------------------');
    const startTime2 = Date.now();
    const fastResult = await pgrouting.fastAnalyzeGraph();
    const endTime2 = Date.now();
    
    if (fastResult.success) {
      console.log(`✅ Fast analysis completed in ${endTime2 - startTime2}ms`);
      console.log(`   🚫 Dead ends: ${fastResult.analysis.dead_ends}`);
      console.log(`   🏝️  Isolated segments: ${fastResult.analysis.isolated_segments}`);
      console.log(`   ❌ Invalid source: ${fastResult.analysis.invalid_source}`);
      console.log(`   ❌ Invalid target: ${fastResult.analysis.invalid_target}`);
      console.log(`   🧩 Connected components: ${fastResult.analysis.connected_components}`);
    } else {
      console.log(`❌ Fast analysis failed: ${fastResult.error}`);
    }
    console.log('');

    // Test 3: Traditional pgr_analyzeGraph (slowest)
    console.log('📊 Test 3: Traditional pgr_analyzeGraph');
    console.log('----------------------------------------');
    console.log('⚠️  This may take a long time or hang...');
    console.log('   Press Ctrl+C to cancel if it takes too long\n');
    
    const startTime3 = Date.now();
    try {
      const traditionalResult = await pgrouting.analyzeGraph();
      const endTime3 = Date.now();
      
      if (traditionalResult.success) {
        console.log(`✅ Traditional analysis completed in ${endTime3 - startTime3}ms`);
        console.log(`   🚫 Dead ends: ${traditionalResult.analysis.dead_ends}`);
        console.log(`   🏝️  Isolated segments: ${traditionalResult.analysis.isolated_segments}`);
        console.log(`   ❌ Invalid source: ${traditionalResult.analysis.invalid_source}`);
        console.log(`   ❌ Invalid target: ${traditionalResult.analysis.invalid_target}`);
      } else {
        console.log(`❌ Traditional analysis failed: ${traditionalResult.error}`);
      }
    } catch (error) {
      const endTime3 = Date.now();
      console.log(`❌ Traditional analysis failed after ${endTime3 - startTime3}ms: ${error}`);
    }

    // Summary
    console.log('\n📈 Performance Summary');
    console.log('=====================');
    console.log('1. Quick check: ~1-10ms (recommended for basic connectivity)');
    console.log('2. Fast analysis: ~10-100ms (recommended for detailed analysis)');
    console.log('3. Traditional pgr_analyzeGraph: ~1000-60000ms (may hang on large networks)');
    console.log('\n💡 Recommendation: Use --fast-analysis or --quick-check flags in CLI');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testFastAnalysis().catch(console.error);
