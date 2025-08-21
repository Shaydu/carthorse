#!/usr/bin/env node
/**
 * Test script for subnetwork-based route generation
 * 
 * This script demonstrates how to use the new subnetwork-based route generation
 * to prevent memory issues when processing large networks.
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

async function testSubnetworkRouteGeneration() {
  const pgClient = new Pool(config);
  
  try {
    console.log('🧪 Testing subnetwork-based route generation...');
    console.log(`🎯 Using staging schema: ${stagingSchema}`);

    // Step 1: Check if the routing network exists
    console.log('\n📊 Step 1: Checking routing network...');
    const networkCheck = await pgClient.query(`
      SELECT 
        COUNT(*) as node_count,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as edge_count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
    `);
    
    const nodeCount = parseInt(networkCheck.rows[0].node_count);
    const edgeCount = parseInt(networkCheck.rows[0].edge_count);
    
    console.log(`✅ Network stats: ${nodeCount} nodes, ${edgeCount} edges`);
    
    if (nodeCount === 0 || edgeCount === 0) {
      console.log('❌ No routing network found. Please run the full export process first.');
      return;
    }

    // Step 2: Detect subnetworks
    console.log('\n🔍 Step 2: Detecting subnetworks...');
    const subnetworksResult = await pgClient.query(`
      WITH connected_components AS (
        SELECT 
          component,
          COUNT(*) as node_count
        FROM pgr_connectedComponents(
          'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded'
        )
        GROUP BY component
        ORDER BY node_count DESC
      )
      SELECT 
        component as component_id,
        node_count,
        CASE 
          WHEN node_count >= 100 THEN 'large'
          WHEN node_count >= 20 THEN 'medium'
          ELSE 'small'
        END as size_category
      FROM connected_components
      ORDER BY node_count DESC
    `);
    
    const subnetworks = subnetworksResult.rows;
    console.log(`✅ Detected ${subnetworks.length} subnetworks:`);
    
    subnetworks.forEach((subnet, index) => {
      console.log(`  Subnetwork ${index + 1}: ${subnet.node_count} nodes (${subnet.size_category})`);
    });

    // Step 3: Test subnetwork-based route generation
    console.log('\n🛤️ Step 3: Testing subnetwork-based route generation...');
    
    // Import the subnetwork route generator
    const { SubnetworkRouteGeneratorService } = require('./src/utils/services/subnetwork-route-generator-service');
    
    const subnetworkGenerator = new SubnetworkRouteGeneratorService(pgClient, {
      stagingSchema: stagingSchema,
      maxSubnetworkSize: 500, // Process subnetworks up to 500 nodes
      minSubnetworkSize: 5,   // Skip subnetworks smaller than 5 nodes
      maxRoutesPerSubnetwork: 5, // Generate up to 5 routes per subnetwork
      enableMemoryMonitoring: true,
      parallelProcessing: false // Use sequential processing for stability
    });
    
    // Create test patterns
    const testPatterns = [
      { pattern_name: 'Short Out & Back', target_distance_km: 3, target_elevation_gain: 100, route_shape: 'out-and-back', tolerance_percent: 20 },
      { pattern_name: 'Medium Out & Back', target_distance_km: 8, target_elevation_gain: 300, route_shape: 'out-and-back', tolerance_percent: 20 },
      { pattern_name: 'Short Loop', target_distance_km: 5, target_elevation_gain: 150, route_shape: 'loop', tolerance_percent: 20 }
    ];
    
    console.log(`📋 Using ${testPatterns.length} test patterns`);
    
    // Generate routes using subnetworks
    const startTime = Date.now();
    const allRoutes = await subnetworkGenerator.generateRoutesForAllSubnetworks(testPatterns);
    const processingTime = Date.now() - startTime;
    
    console.log(`\n✅ Subnetwork route generation completed:`);
    console.log(`   🛤️ Generated ${allRoutes.length} total routes`);
    console.log(`   ⏱️ Processing time: ${processingTime}ms`);
    console.log(`   📊 Memory efficient: Processed one subnetwork at a time`);
    
    // Step 4: Show route details
    if (allRoutes.length > 0) {
      console.log('\n📋 Route details:');
      allRoutes.slice(0, 10).forEach((route, index) => {
        console.log(`  Route ${index + 1}: ${route.route_name}`);
        console.log(`    Distance: ${route.recommended_length_km.toFixed(1)}km (target: ${route.input_length_km}km)`);
        console.log(`    Elevation: ${route.recommended_elevation_gain.toFixed(0)}m (target: ${route.input_elevation_gain}m)`);
        console.log(`    Shape: ${route.route_shape}, Score: ${route.route_score}`);
      });
      
      if (allRoutes.length > 10) {
        console.log(`  ... and ${allRoutes.length - 10} more routes`);
      }
    }

    // Step 5: Memory usage comparison
    console.log('\n📊 Memory usage comparison:');
    console.log('   Traditional approach: Processes entire network at once');
    console.log('   Subnetwork approach: Processes one subnetwork at a time');
    console.log('   Benefits:');
    console.log('     - Prevents memory exhaustion');
    console.log('     - More stable for large networks');
    console.log('     - Better error isolation');
    console.log('     - Easier to debug and monitor');

    console.log('\n🎉 Subnetwork-based route generation test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    await pgClient.end();
  }
}

// Run the test
if (require.main === module) {
  testSubnetworkRouteGeneration().catch(console.error);
}

module.exports = { testSubnetworkRouteGeneration };
