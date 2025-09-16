const { Pool } = require('pg');
const { VertexBasedSplittingService } = require('./src/services/layer1/VertexBasedSplittingService');
const { NetworkCreationService } = require('./src/utils/services/network-creation/network-creation-service');

async function testVertexBasedSplitting() {
  console.log('🧪 Testing vertex-based trail splitting and network creation...');
  
  // Database connection
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'postgres',
    password: 'postgres'
  });
  
  const stagingSchema = 'staging';
  
  try {
    // Test 1: Vertex-based splitting
    console.log('\n🔗 Test 1: Vertex-based trail splitting...');
    const vertexSplitService = new VertexBasedSplittingService(
      pool,
      stagingSchema,
      { region: 'boulder' }
    );
    
    const splitResult = await vertexSplitService.applyVertexBasedSplitting();
    console.log('✅ Vertex-based splitting completed:');
    console.log(`   📍 Vertices extracted: ${splitResult.verticesExtracted}`);
    console.log(`   🔍 Trails split: ${splitResult.trailsSplit}`);
    console.log(`   ✂️ Segments created: ${splitResult.segmentsCreated}`);
    console.log(`   🔄 Duplicates removed: ${splitResult.duplicatesRemoved}`);
    console.log(`   📊 Final segments: ${splitResult.finalSegments}`);
    
    // Test 2: Network creation
    console.log('\n🛤️ Test 2: Vertex-based network creation...');
    const networkService = new NetworkCreationService();
    const networkConfig = {
      stagingSchema: stagingSchema,
      tolerances: {
        intersectionDetectionTolerance: 0.00001,
        edgeToVertexTolerance: 0.001,
        graphAnalysisTolerance: 0.00001,
        trueLoopTolerance: 0.00001,
        minTrailLengthMeters: 50,
        maxTrailLengthMeters: 100000
      }
    };
    
    const networkResult = await networkService.createNetwork(pool, networkConfig);
    
    if (networkResult.success) {
      console.log('✅ Network creation completed:');
      console.log(`   📍 Nodes created: ${networkResult.stats.nodesCreated}`);
      console.log(`   🛤️ Edges created: ${networkResult.stats.edgesCreated}`);
      console.log(`   🔗 Isolated nodes: ${networkResult.stats.isolatedNodes}`);
      console.log(`   🚫 Orphaned edges: ${networkResult.stats.orphanedEdges}`);
    } else {
      console.error('❌ Network creation failed:', networkResult.error);
    }
    
    // Test 3: Verify routing tables
    console.log('\n🔍 Test 3: Verifying routing tables...');
    const nodesCount = await pool.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_nodes`);
    const edgesCount = await pool.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_edges`);
    
    console.log(`   📍 Routing nodes: ${nodesCount.rows[0].count}`);
    console.log(`   🛤️ Routing edges: ${edgesCount.rows[0].count}`);
    
    // Test 4: Check for proper edge lengths (should not be tiny)
    console.log('\n📏 Test 4: Checking edge lengths...');
    const edgeLengths = await pool.query(`
      SELECT 
        MIN(distance_km) as min_length,
        MAX(distance_km) as max_length,
        AVG(distance_km) as avg_length,
        COUNT(*) as total_edges
      FROM ${stagingSchema}.routing_edges
    `);
    
    const stats = edgeLengths.rows[0];
    console.log(`   📏 Edge length stats:`);
    console.log(`      Min: ${stats.min_length} km`);
    console.log(`      Max: ${stats.max_length} km`);
    console.log(`      Avg: ${stats.avg_length} km`);
    console.log(`      Total: ${stats.total_edges} edges`);
    
    // Check for tiny edges (problem we're trying to fix)
    const tinyEdges = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ${stagingSchema}.routing_edges 
      WHERE distance_km < 0.001
    `);
    
    console.log(`   ⚠️  Tiny edges (< 1m): ${tinyEdges.rows[0].count}`);
    
    if (tinyEdges.rows[0].count === 0) {
      console.log('✅ No tiny edges found - vertex-based splitting working correctly!');
    } else {
      console.log('⚠️  Still have tiny edges - may need further refinement');
    }
    
    console.log('\n🎉 Vertex-based splitting and network creation test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testVertexBasedSplitting();
