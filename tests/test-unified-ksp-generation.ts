import { Pool } from 'pg';
import { UnifiedKspRouteGeneratorService } from './src/utils/services/unified-ksp-route-generator-service';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function testUnifiedKspGeneration() {
  console.log('🧪 Testing Unified KSP Route Generation...');
  
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
    // Create unified KSP service
    const unifiedKspService = new UnifiedKspRouteGeneratorService(pgClient, {
      stagingSchema: 'carthorse_test', // Use a test schema
      region: 'boulder',
      targetRoutesPerPattern: 5,
      minDistanceBetweenRoutes: 100,
      kspKValue: 10,
      useTrailheadsOnly: false
    });

    console.log('🛤️ Generating routes with unified KSP service...');
    const routes = await unifiedKspService.generateKspRoutes();
    
    console.log(`✅ Generated ${routes.length} routes`);
    
    if (routes.length > 0) {
      console.log('📊 Route details:');
      routes.slice(0, 3).forEach((route, index) => {
        console.log(`  ${index + 1}. ${route.route_name}`);
        console.log(`     Distance: ${route.recommended_length_km.toFixed(2)}km`);
        console.log(`     Elevation: ${route.recommended_elevation_gain.toFixed(0)}m`);
        console.log(`     Score: ${route.route_score.toFixed(2)}`);
        console.log(`     Trails: ${route.constituent_trails?.slice(0, 3).join(', ') || 'Unknown'}${route.constituent_trails && route.constituent_trails.length > 3 ? '...' : ''}`);
      });
    }

  } catch (error) {
    console.error('❌ Error testing unified KSP generation:', error);
  } finally {
    await pgClient.end();
  }
}

testUnifiedKspGeneration().catch(console.error);
