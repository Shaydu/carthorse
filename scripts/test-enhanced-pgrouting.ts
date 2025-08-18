import { Pool } from 'pg';
import { EnhancedPgRoutingRouteGenerator } from '../src/utils/routing/enhanced-pgrouting-route-generator';

async function testEnhancedPgRouting() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🧪 Testing enhanced pgRouting route generation...');
    
    // Get the most recent staging schema
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
    
    // Create enhanced route generator
    const enhancedGenerator = new EnhancedPgRoutingRouteGenerator(pgClient, {
      stagingSchema,
      maxEndpointDistance: 500, // 500 meters
      maxLoopDistance: 20 // 20 km
    });
    
    // Test Bear Peak loop detection
    console.log('\n🔍 Testing Bear Peak loop detection with enhanced routing...');
    const bearPeakRoutes = await enhancedGenerator.findBearPeakLoop();
    
    console.log('\n📊 Bear Peak Loop Results:');
    if (bearPeakRoutes.length === 0) {
      console.log('  ❌ No Bear Peak loops found');
    } else {
      bearPeakRoutes.forEach((route, index) => {
        console.log(`  ${index + 1}. ${route.name}`);
        console.log(`     Distance: ${route.actual_distance_km.toFixed(2)}km (target: ${route.target_distance_km}km)`);
        console.log(`     Elevation: +${route.actual_elevation_gain_m.toFixed(0)}m (target: ${route.target_elevation_gain_m}m)`);
        console.log(`     Trails: ${route.constituent_trails.join(', ')}`);
        console.log(`     Type: ${route.route_type}`);
        console.log('');
      });
    }
    
    // Test general route generation
    console.log('\n🔄 Testing general route generation with enhanced routing...');
    const allRoutes = await enhancedGenerator.generateRoutes();
    
    console.log(`\n📊 Generated ${allRoutes.length} total routes:`);
    
    const loopRoutes = allRoutes.filter(r => r.route_type === 'loop');
    const outBackRoutes = allRoutes.filter(r => r.route_type === 'out-and-back');
    
    console.log(`  Loops: ${loopRoutes.length}`);
    console.log(`  Out & Back: ${outBackRoutes.length}`);
    
    // Show some example routes
    console.log('\n📍 Example Loop Routes:');
    loopRoutes.slice(0, 3).forEach((route, index) => {
      console.log(`  ${index + 1}. ${route.name} (${route.actual_distance_km.toFixed(2)}km, +${route.actual_elevation_gain_m.toFixed(0)}m)`);
    });
    
    console.log('\n📍 Example Out & Back Routes:');
    outBackRoutes.slice(0, 3).forEach((route, index) => {
      console.log(`  ${index + 1}. ${route.name} (${route.actual_distance_km.toFixed(2)}km, +${route.actual_elevation_gain_m.toFixed(0)}m)`);
    });
    
  } catch (error) {
    console.error('❌ Error during enhanced pgRouting test:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testEnhancedPgRouting().catch(console.error);
