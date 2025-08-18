import { Pool } from 'pg';
import { UnifiedKspRouteGeneratorService } from '../src/utils/services/unified-ksp-route-generator-service';

async function testUnifiedKspService() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🧪 Testing Unified KSP Route Generator Service...');
    
    // Get the most recent staging schema with unified network
    const schemaResult = await pgClient.query(`
      SELECT schemaname 
      FROM pg_tables 
      WHERE tablename = 'ways_noded' 
      ORDER BY schemaname DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema with ways_noded found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schemaname;
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Check unified network statistics
    const nodeCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded_vertices_pgr
    `);
    
    const edgeCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded
    `);
    
    console.log(`📊 Unified Network: ${nodeCount.rows[0].count} nodes, ${edgeCount.rows[0].count} edges`);
    
    // Test unified KSP service
    console.log('\n🔄 Testing Unified KSP Route Generation...');
    
    const unifiedKspService = new UnifiedKspRouteGeneratorService(pgClient, {
      stagingSchema,
      region: 'boulder',
      targetRoutesPerPattern: 3,
      minDistanceBetweenRoutes: 1,
      kspKValue: 3
    });
    
    try {
      // Generate KSP routes
      const kspRoutes = await unifiedKspService.generateKspRoutes();
      console.log(`✅ Generated ${kspRoutes.length} unified KSP routes`);
      
      // Show route details
      kspRoutes.forEach((route, index) => {
        console.log(`\n  ${index + 1}. ${route.route_name}`);
        console.log(`     Type: ${route.route_type} (${route.route_shape})`);
        console.log(`     Distance: ${route.recommended_length_km.toFixed(2)}km (target: ${route.input_length_km}km)`);
        console.log(`     Elevation: +${route.recommended_elevation_gain.toFixed(0)}m (target: ${route.input_elevation_gain}m)`);
        console.log(`     Score: ${route.route_score.toFixed(3)}`);
        console.log(`     Trails: ${route.constituent_trails?.join(', ') || 'Unknown'}`);
        console.log(`     Trail Count: ${route.trail_count}`);
      });
      
      // Test Bear Peak specific routes
      console.log('\n🎯 Checking for Bear Peak related routes...');
      
      const bearPeakRoutes = kspRoutes.filter(route => 
        route.constituent_trails?.some((trail: string) => 
          trail.toLowerCase().includes('bear peak') ||
          trail.toLowerCase().includes('fern canyon') ||
          trail.toLowerCase().includes('mesa trail') ||
          trail.toLowerCase().includes('bear canyon')
        )
      );
      
      console.log(`✅ Found ${bearPeakRoutes.length} Bear Peak related routes`);
      
      bearPeakRoutes.forEach((route, index) => {
        console.log(`\n  🐻 ${index + 1}. ${route.route_name}`);
        console.log(`     Distance: ${route.recommended_length_km.toFixed(2)}km, Elevation: +${route.recommended_elevation_gain.toFixed(0)}m`);
        console.log(`     Trails: ${route.constituent_trails?.join(', ')}`);
      });
      
      // Test route analysis
      console.log('\n📊 Route Analysis...');
      
      if (kspRoutes.length > 0) {
        const avgDistance = kspRoutes.reduce((sum, route) => sum + route.recommended_length_km, 0) / kspRoutes.length;
        const avgElevation = kspRoutes.reduce((sum, route) => sum + route.recommended_elevation_gain, 0) / kspRoutes.length;
        const avgScore = kspRoutes.reduce((sum, route) => sum + route.route_score, 0) / kspRoutes.length;
        
        console.log(`📈 Route Statistics:`);
        console.log(`  Total Routes: ${kspRoutes.length}`);
        console.log(`  Average Distance: ${avgDistance.toFixed(2)}km`);
        console.log(`  Average Elevation: ${avgElevation.toFixed(0)}m`);
        console.log(`  Average Score: ${avgScore.toFixed(3)}`);
        
        // Distance distribution
        const shortRoutes = kspRoutes.filter(r => r.recommended_length_km < 5).length;
        const mediumRoutes = kspRoutes.filter(r => r.recommended_length_km >= 5 && r.recommended_length_km < 10).length;
        const longRoutes = kspRoutes.filter(r => r.recommended_length_km >= 10).length;
        
        console.log(`  Distance Distribution:`);
        console.log(`    Short (<5km): ${shortRoutes}`);
        console.log(`    Medium (5-10km): ${mediumRoutes}`);
        console.log(`    Long (≥10km): ${longRoutes}`);
      }
      
    } catch (error) {
      console.error('❌ Unified KSP route generation failed:', error instanceof Error ? error.message : String(error));
    }
    
    // Test network connectivity
    console.log('\n🔗 Testing Network Connectivity...');
    
    try {
      // Check for isolated nodes
      const isolatedNodes = await pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${stagingSchema}.ways_noded_vertices_pgr 
        WHERE cnt = 0
      `);
      
      // Check for dead-end nodes (degree 1)
      const deadEndNodes = await pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${stagingSchema}.export_nodes 
        WHERE degree = 1
      `);
      
      // Check for high-degree nodes (intersections)
      const intersectionNodes = await pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${stagingSchema}.export_nodes 
        WHERE degree >= 3
      `);
      
      console.log(`📊 Network Connectivity:`);
      console.log(`  Isolated Nodes: ${isolatedNodes.rows[0].count}`);
      console.log(`  Dead-end Nodes: ${deadEndNodes.rows[0].count}`);
      console.log(`  Intersection Nodes (≥3): ${intersectionNodes.rows[0].count}`);
      
    } catch (error) {
      console.error('❌ Network connectivity analysis failed:', error instanceof Error ? error.message : String(error));
    }
    
  } catch (error) {
    console.error('❌ Error during unified KSP test:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testUnifiedKspService().catch(console.error);
