import { Pool } from 'pg';
import { LollipopRouteGenerator } from './src/utils/lollipop-route-generator';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function testLollipopWithFullPipeline() {
  console.log('🍭 Testing Lollipop Route Generation Service with Full Pipeline Data...');
  
  // Get database configuration
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    max: dbConfig.max,
    idleTimeoutMillis: dbConfig.idleTimeoutMillis,
    connectionTimeoutMillis: dbConfig.connectionTimeoutMillis
  });

  try {
    // Use the new staging schema with improved connectivity
    const stagingSchema = 'carthorse_1756041045274';
    
    console.log(`🔧 Testing lollipop service on staging schema: ${stagingSchema}`);
    
    // Initialize lollipop service
    const lollipopService = new LollipopRouteGenerator(pgClient, stagingSchema);
    
    // Create test patterns
    const testPatterns = [
      {
        pattern_name: 'Bear Canyon Lollipop',
        route_shape: 'lollipop',
        target_distance_km: 15.0,
        target_elevation_gain: 600,
        tolerance_percent: 50
      },
      {
        pattern_name: 'Medium Lollipop',
        route_shape: 'lollipop',
        target_distance_km: 12.0,
        target_elevation_gain: 500,
        tolerance_percent: 50
      }
    ];
    
    console.log('🎯 Generating lollipop routes...');
    const recommendations = await lollipopService.generateLollipopRoutes(testPatterns);
    
    console.log(`✅ Generated ${recommendations.length} lollipop route recommendations`);
    
    // Store recommendations
    if (recommendations.length > 0) {
      await lollipopService.storeRouteRecommendations(recommendations);
      console.log(`💾 Stored ${recommendations.length} lollipop route recommendations`);
      
      // Display recommendations
      console.log('\n📋 Lollipop Route Recommendations:');
      recommendations.forEach((rec, index) => {
        console.log(`${index + 1}. ${rec.route_name}`);
        console.log(`   Length: ${rec.recommended_length_km}km`);
        console.log(`   Elevation: ${rec.recommended_elevation_gain}m`);
        console.log(`   Trail Count: ${rec.trail_count}`);
        console.log(`   Route UUID: ${rec.route_uuid}`);
        console.log('');
      });
    }
    
    // Check if Bear Canyon loop was found
    const bearCanyonRoutes = recommendations.filter(rec => 
      rec.route_name.includes('Bear Canyon') || rec.route_name.includes('Lollipop')
    );
    
    console.log(`🔍 Found ${bearCanyonRoutes.length} Bear Canyon lollipop routes:`);
    bearCanyonRoutes.forEach((rec, index) => {
      console.log(`${index + 1}. ${rec.route_name}: ${rec.recommended_length_km}km, ${rec.recommended_elevation_gain}m`);
    });
    
  } catch (error) {
    console.error('❌ Error testing lollipop service:', error);
  } finally {
    await pgClient.end();
  }
}

testLollipopWithFullPipeline().catch(console.error);
