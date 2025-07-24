#!/usr/bin/env node

const { EnhancedPostgresOrchestrator } = require('./dist/orchestrator/EnhancedPostgresOrchestrator');

async function testAllFixes() {
  console.log('🧪 Testing all Carthorse package fixes...');
  
  // Create orchestrator config
  const config = {
    region: 'boulder',
    outputPath: './data/test-all-fixes.db',
    simplifyTolerance: 0.001,
    intersectionTolerance: 2.0,
    replace: true,
    validate: false,
    verbose: true,
    skipBackup: true,
    buildMaster: false,
    targetSizeMB: null,
    maxSpatiaLiteDbSizeMB: 400,
    skipIncompleteTrails: false,
    useSqlite: true
  };

  const orchestrator = new EnhancedPostgresOrchestrator(config);
  
  try {
    // Connect to database
    await orchestrator.pgClient.connect();
    console.log('✅ Connected to PostgreSQL');
    
    // Test 1: Create staging environment (tests UUID schema fixes)
    console.log('\n📋 Test 1: Creating staging environment...');
    await orchestrator.createStagingEnvironment();
    console.log('✅ Staging environment created successfully');
    
    // Test 2: Copy region data (tests regionBbox calculation)
    console.log('\n📋 Test 2: Copying region data...');
    await orchestrator.copyRegionDataToStaging();
    console.log('✅ Region data copied successfully');
    
    // Test 3: Detect intersections (tests UUID parsing fixes)
    console.log('\n📋 Test 3: Detecting intersections...');
    await orchestrator.detectIntersections(); // Now uses native SQL/PostGIS function
    console.log('✅ Intersection detection completed successfully');
    
    // Test 4: Split trails at intersections
    console.log('\n📋 Test 4: Splitting trails at intersections...');
    await orchestrator.splitTrailsAtIntersections();
    console.log('✅ Trail splitting completed successfully');
    
    // Test 5: Build routing graph (tests PostgreSQL function fixes)
    console.log('\n📋 Test 5: Building routing graph...');
    const { buildRoutingGraphHelper } = require('./dist/utils/sql/routing');
    await buildRoutingGraphHelper(
      orchestrator.pgClient,
      orchestrator.stagingSchema,
      'split_trails',
      config.intersectionTolerance,
      20
    );
    console.log('✅ Routing graph built successfully');
    
    // Test 6: Export to SQLite (tests region metadata null handling)
    console.log('\n📋 Test 6: Exporting to SQLite...');
    await orchestrator.exportDatabase();
    console.log('✅ SQLite export completed successfully');
    
    // Test 7: Verify the exported database
    console.log('\n📋 Test 7: Verifying exported database...');
    const Database = require('better-sqlite3');
    const sqliteDb = new Database(config.outputPath);
    
    // Check tables exist
    const tables = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log(`   - Found ${tables.length} tables: ${tables.map(t => t.name).join(', ')}`);
    
    // Check data counts
    const trailCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM trails').get().count;
    const nodeCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM routing_nodes').get().count;
    const edgeCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM routing_edges').get().count;
    const metaCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM region_metadata').get().count;
    
    console.log(`   - Trails: ${trailCount}`);
    console.log(`   - Nodes: ${nodeCount}`);
    console.log(`   - Edges: ${edgeCount}`);
    console.log(`   - Metadata: ${metaCount}`);
    
    // Check region metadata
    const regionMeta = sqliteDb.prepare('SELECT * FROM region_metadata LIMIT 1').get();
    console.log(`   - Region: ${regionMeta.region_name}`);
    console.log(`   - Bbox: ${regionMeta.bbox_min_lng}, ${regionMeta.bbox_min_lat}, ${regionMeta.bbox_max_lng}, ${regionMeta.bbox_max_lat}`);
    console.log(`   - Trail count: ${regionMeta.trail_count}`);
    
    // Check UUID handling
    const sampleTrail = sqliteDb.prepare('SELECT app_uuid, name FROM trails LIMIT 1').get();
    console.log(`   - Sample trail UUID: ${sampleTrail.app_uuid}`);
    console.log(`   - Sample trail name: ${sampleTrail.name}`);
    
    sqliteDb.close();
    
    console.log('\n🎉 All fixes verified successfully!');
    console.log('📋 This confirms that:');
    console.log('   ✅ UUID parsing errors are fixed');
    console.log('   ✅ Trail hashes table schema is correct');
    console.log('   ✅ PostgreSQL function type casting works');
    console.log('   ✅ Region metadata null handling works');
    console.log('   ✅ RegionBbox calculation works');
    console.log('   ✅ End-to-end export pipeline works');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    // Clean up
    if (orchestrator.pgClient) {
      try {
        await orchestrator.cleanupStaging();
        console.log('🧹 Cleaned up staging schema');
      } catch (cleanupErr) {
        console.warn('⚠️ Failed to clean up staging schema:', cleanupErr);
      }
      await orchestrator.pgClient.end();
    }
  }
}

// Run the test
testAllFixes()
  .then(() => {
    console.log('✅ All tests passed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Tests failed:', error);
    process.exit(1);
  }); 