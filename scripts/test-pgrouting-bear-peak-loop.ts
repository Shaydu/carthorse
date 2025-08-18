import { Pool } from 'pg';
import { PgRoutingNativeRouteGenerator } from '../src/utils/routing/pgrouting-native-route-generator';

async function testPgRoutingBearPeakLoop() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🧪 Testing pgRouting Bear Peak loop generation...');
    
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
    
    // Create the pgRouting route generator
    const routeGenerator = new PgRoutingNativeRouteGenerator(pgClient, {
      stagingSchema,
      region: 'boulder',
      targetRoutesPerPattern: 10,
      minDistanceBetweenRoutes: 0.5
    });
    
    // Test finding the Bear Peak loop specifically
    console.log('\n🔍 Testing Bear Peak loop detection...');
    const bearPeakLoops = await routeGenerator.findBearPeakLoop();
    
    console.log('\n📊 Bear Peak Loop Results:');
    bearPeakLoops.forEach((loop, index) => {
      console.log(`\n${index + 1}. Loop ${loop.cycle_id}:`);
      console.log(`   Distance: ${loop.total_distance.toFixed(2)}km`);
      console.log(`   Edges: ${loop.edge_count}`);
      console.log(`   Trails: ${loop.trail_names.join(', ')}`);
      console.log(`   Edge IDs: ${loop.edge_ids.join(', ')}`);
    });
    
    // Test general route generation
    console.log('\n🔄 Testing general route generation...');
    const recommendations = await routeGenerator.generateRoutes();
    
    console.log('\n📊 General Route Results:');
    console.log(`Total routes generated: ${recommendations.length}`);
    
    const routesByType = recommendations.reduce((acc, route) => {
      acc[route.route_type] = (acc[route.route_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    Object.entries(routesByType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count} routes`);
    });
    
    // Show some example routes
    console.log('\n📋 Example Routes:');
    recommendations.slice(0, 5).forEach((route, index) => {
      console.log(`\n${index + 1}. ${route.route_name}`);
      console.log(`   Type: ${route.route_type}`);
      console.log(`   Distance: ${route.recommended_length_km.toFixed(2)}km`);
      console.log(`   Elevation: ${route.recommended_elevation_gain.toFixed(0)}m`);
      console.log(`   Trails: ${route.trail_count}`);
    });
    
  } catch (error) {
    console.error('❌ Error during pgRouting test:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testPgRoutingBearPeakLoop().catch(console.error);
