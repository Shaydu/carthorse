import { Pool } from 'pg';
import { KspRouteGeneratorService } from '../src/utils/services/ksp-route-generator-service';
import { LoopRouteGeneratorService } from '../src/utils/services/loop-route-generator-service';

async function testKspOnUnifiedNetwork() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🧪 Testing KSP and Loop algorithms on unified network...');
    
    // Get the most recent staging schema with unified network
    const schemaResult = await pgClient.query(`
      SELECT schemaname 
      FROM pg_tables 
      WHERE tablename = 'export_edges' 
      ORDER BY schemaname DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema with export_edges found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schemaname;
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Check network statistics
    const nodeCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.export_nodes
    `);
    
    const edgeCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.export_edges
    `);
    
    console.log(`📊 Network: ${nodeCount.rows[0].count} nodes, ${edgeCount.rows[0].count} edges`);
    
    // Test KSP Route Generation
    console.log('\n🔄 Testing KSP Route Generation...');
    
    const kspService = new KspRouteGeneratorService(pgClient, {
      stagingSchema,
      region: 'boulder',
      targetRoutesPerPattern: 5,
      minDistanceBetweenRoutes: 1,
      kspKValue: 3
    });
    
    try {
      // Generate KSP routes
      const kspRoutes = await kspService.generateKspRoutes();
      console.log(`✅ Generated ${kspRoutes.length} KSP routes`);
      
      // Show some example routes
      kspRoutes.slice(0, 3).forEach((route: any, index: number) => {
        console.log(`  ${index + 1}. ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, +${route.recommended_elevation_gain.toFixed(0)}m)`);
        console.log(`     Trails: ${route.constituent_trails?.slice(0, 3).join(', ') || 'Unknown'}${route.constituent_trails && route.constituent_trails.length > 3 ? '...' : ''}`);
      });
      
    } catch (error) {
      console.error('❌ KSP route generation failed:', error instanceof Error ? error.message : String(error));
    }
    
    // Test Loop Route Generation
    console.log('\n🔄 Testing Loop Route Generation...');
    
    const loopService = new LoopRouteGeneratorService(pgClient, {
      stagingSchema,
      region: 'boulder',
      targetRoutesPerPattern: 5,
      minDistanceBetweenRoutes: 1
    });
    
    try {
      // Generate loop routes
      const loopRoutes = await loopService.generateLoopRoutes();
      console.log(`✅ Generated ${loopRoutes.length} loop routes`);
      
      // Show some example routes
      loopRoutes.slice(0, 3).forEach((route: any, index: number) => {
        console.log(`  ${index + 1}. ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, +${route.recommended_elevation_gain.toFixed(0)}m)`);
        console.log(`     Trails: ${route.constituent_trails?.slice(0, 3).join(', ') || 'Unknown'}${route.constituent_trails && route.constituent_trails.length > 3 ? '...' : ''}`);
      });
      
    } catch (error) {
      console.error('❌ Loop route generation failed:', error instanceof Error ? error.message : String(error));
    }
    
    // Test Bear Peak specific route generation
    console.log('\n🎯 Testing Bear Peak specific route generation...');
    
    try {
      // Find Bear Peak related routes
      const allRoutes = [...(await kspService.generateKspRoutes()), ...(await loopService.generateLoopRoutes())];
      
      const bearPeakRoutes = allRoutes.filter(route => 
        route.constituent_trails?.some((trail: string) => 
          trail.toLowerCase().includes('bear peak') ||
          trail.toLowerCase().includes('fern canyon') ||
          trail.toLowerCase().includes('mesa trail') ||
          trail.toLowerCase().includes('bear canyon')
        )
      );
      
      console.log(`✅ Found ${bearPeakRoutes.length} Bear Peak related routes`);
      
      bearPeakRoutes.forEach((route, index) => {
        console.log(`  ${index + 1}. ${route.route_name} (${route.route_type})`);
        console.log(`     Distance: ${route.recommended_length_km.toFixed(2)}km, Elevation: +${route.recommended_elevation_gain.toFixed(0)}m`);
        console.log(`     Trails: ${route.constituent_trails?.join(', ') || 'Unknown'}`);
        console.log('');
      });
      
    } catch (error) {
      console.error('❌ Bear Peak route generation failed:', error instanceof Error ? error.message : String(error));
    }
    
    // Test route analysis
    console.log('\n📊 Testing route analysis...');
    
    try {
      // Get route statistics
      const routeStats = await pgClient.query(`
        SELECT 
          COUNT(*) as total_routes,
          AVG(actual_distance_km) as avg_distance,
          MIN(actual_distance_km) as min_distance,
          MAX(actual_distance_km) as max_distance,
          AVG(actual_elevation_gain_m) as avg_elevation,
          COUNT(CASE WHEN route_type = 'loop' THEN 1 END) as loop_count,
          COUNT(CASE WHEN route_type = 'out-and-back' THEN 1 END) as outback_count
        FROM ${stagingSchema}.route_recommendations
      `);
      
      if (routeStats.rows.length > 0) {
        const stats = routeStats.rows[0];
        console.log('📈 Route Statistics:');
        console.log(`  Total Routes: ${stats.total_routes}`);
        console.log(`  Average Distance: ${parseFloat(stats.avg_distance || 0).toFixed(2)}km`);
        console.log(`  Distance Range: ${parseFloat(stats.min_distance || 0).toFixed(2)}km - ${parseFloat(stats.max_distance || 0).toFixed(2)}km`);
        console.log(`  Average Elevation: ${parseFloat(stats.avg_elevation || 0).toFixed(0)}m`);
        console.log(`  Loops: ${stats.loop_count}, Out & Back: ${stats.outback_count}`);
      }
      
    } catch (error) {
      console.error('❌ Route analysis failed:', error instanceof Error ? error.message : String(error));
    }
    
    // Compare with old network structure
    console.log('\n🔄 Comparing with old network structure...');
    
    try {
      // Check if old routing tables exist
      const oldTablesExist = await pgClient.query(`
        SELECT 
          EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = '${stagingSchema}' AND table_name = 'routing_edges') as has_routing_edges,
          EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = '${stagingSchema}' AND table_name = 'routing_nodes') as has_routing_nodes
      `);
      
      if (oldTablesExist.rows[0].has_routing_edges && oldTablesExist.rows[0].has_routing_nodes) {
        console.log('📊 Old network structure found - comparing...');
        
        const oldNodeCount = await pgClient.query(`
          SELECT COUNT(*) as count FROM ${stagingSchema}.routing_nodes
        `);
        
        const oldEdgeCount = await pgClient.query(`
          SELECT COUNT(*) as count FROM ${stagingSchema}.routing_edges
        `);
        
        console.log(`  Old Network: ${oldNodeCount.rows[0].count} nodes, ${oldEdgeCount.rows[0].count} edges`);
        console.log(`  New Network: ${nodeCount.rows[0].count} nodes, ${edgeCount.rows[0].count} edges`);
        
        const nodeDiff = parseInt(nodeCount.rows[0].count) - parseInt(oldNodeCount.rows[0].count);
        const edgeDiff = parseInt(edgeCount.rows[0].count) - parseInt(oldEdgeCount.rows[0].count);
        
        console.log(`  Difference: ${nodeDiff > 0 ? '+' : ''}${nodeDiff} nodes, ${edgeDiff > 0 ? '+' : ''}${edgeDiff} edges`);
      } else {
        console.log('📊 No old network structure found for comparison');
      }
      
    } catch (error) {
      console.error('❌ Network comparison failed:', error instanceof Error ? error.message : String(error));
    }
    
  } catch (error) {
    console.error('❌ Error during KSP test on unified network:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testKspOnUnifiedNetwork().catch(console.error);
