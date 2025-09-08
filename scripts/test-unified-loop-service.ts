#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { UnifiedLoopRouteGeneratorService, UnifiedLoopRouteGeneratorConfig } from '../src/utils/services/unified-loop-route-generator-service';
import { UnifiedPgRoutingNetworkGenerator } from '../src/utils/routing/unified-pgrouting-network-generator';

async function testUnifiedLoopService() {
  console.log('🧪 Testing Unified Loop Route Generator Service...');
  
  // Database connection
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: 'carthorse'
  });

  const stagingSchema = 'carthorse_1757336572662';
  
  try {
    // First, ensure unified network exists
    console.log('🔧 Setting up unified network...');
    const networkGenerator = new UnifiedPgRoutingNetworkGenerator(pgClient, {
      stagingSchema,
      tolerance: 10, // meters
      maxEndpointDistance: 100 // meters
    });
    
    await networkGenerator.generateUnifiedNetwork();
    
    // Configure the loop service with emphasis on elevation gain rate matching
    const loopConfig: UnifiedLoopRouteGeneratorConfig = {
      stagingSchema,
      region: 'boulder',
      targetRoutesPerPattern: 5, // Generate more loops since they're critical
      minDistanceBetweenRoutes: 0.5,
      maxLoopSearchDistance: 15, // km
      elevationGainRateWeight: 0.7, // Prioritize elevation gain rate matching
      distanceWeight: 0.3 // Secondary importance for distance matching
    };

    const loopService = new UnifiedLoopRouteGeneratorService(pgClient, loopConfig);

    console.log('\n🔄 Testing Unified Loop Route Generation...');
    console.log('📋 Using staging schema:', stagingSchema);
    console.log('⚖️ Elevation gain rate weight:', loopConfig.elevationGainRateWeight);
    console.log('📏 Distance weight:', loopConfig.distanceWeight);

    // Generate loop routes
    const loopRoutes = await loopService.generateLoopRoutes();

    console.log('\n📊 LOOP ROUTE GENERATION RESULTS:');
    console.log('=====================================');
    console.log(`✅ Generated ${loopRoutes.length} loop routes`);

    if (loopRoutes.length > 0) {
      console.log('\n🏆 Top Loop Routes (sorted by elevation gain rate matching):');
      loopRoutes.forEach((route, index) => {
        const elevationGainRate = route.recommended_elevation_gain / route.recommended_length_km;
        const targetElevationGainRate = route.input_elevation_gain / route.input_length_km;
        const elevationRateAccuracy = Math.abs(elevationGainRate - targetElevationGainRate) / targetElevationGainRate * 100;
        
        console.log(`\n${index + 1}. ${route.route_name}`);
        console.log(`   📏 Distance: ${route.recommended_length_km.toFixed(2)}km (target: ${route.input_length_km}km)`);
        console.log(`   🏔️ Elevation: ${route.recommended_elevation_gain.toFixed(0)}m (target: ${route.input_elevation_gain}m)`);
        console.log(`   📈 Elevation Rate: ${elevationGainRate.toFixed(1)}m/km (target: ${targetElevationGainRate.toFixed(1)}m/km)`);
        console.log(`   🎯 Rate Accuracy: ${(100 - elevationRateAccuracy).toFixed(1)}%`);
        console.log(`   ⭐ Score: ${route.route_score.toFixed(3)}`);
        console.log(`   🛤️ Trails: ${route.constituent_trails?.join(', ') || 'Unknown'}`);
        console.log(`   🔗 Trail Count: ${route.trail_count}`);
      });

      // Analyze elevation gain rate distribution
      console.log('\n📊 Elevation Gain Rate Analysis:');
      const elevationRates = loopRoutes.map(route => ({
        name: route.route_name,
        actualRate: route.recommended_elevation_gain / route.recommended_length_km,
        targetRate: route.input_elevation_gain / route.input_length_km,
        accuracy: Math.abs((route.recommended_elevation_gain / route.recommended_length_km) - (route.input_elevation_gain / route.input_length_km)) / (route.input_elevation_gain / route.input_length_km) * 100
      }));

      const avgAccuracy = elevationRates.reduce((sum, route) => sum + (100 - route.accuracy), 0) / elevationRates.length;
      console.log(`   🎯 Average Elevation Rate Accuracy: ${avgAccuracy.toFixed(1)}%`);
      
      const bestRateMatch = elevationRates.reduce((best, current) => 
        (100 - current.accuracy) > (100 - best.accuracy) ? current : best
      );
      console.log(`   🏆 Best Rate Match: ${bestRateMatch.name} (${(100 - bestRateMatch.accuracy).toFixed(1)}% accuracy)`);

      // Check for Bear Peak related routes
      console.log('\n🎯 Checking for Bear Peak related routes...');
      const bearPeakRoutes = loopRoutes.filter(route => 
        route.route_name.toLowerCase().includes('bear peak') ||
        route.constituent_trails?.some(trail => trail.toLowerCase().includes('bear peak'))
      );
      
      if (bearPeakRoutes.length > 0) {
        console.log(`✅ Found ${bearPeakRoutes.length} Bear Peak related loop routes:`);
        bearPeakRoutes.forEach((route, index) => {
          console.log(`   ${index + 1}. ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m)`);
        });
      } else {
        console.log('❌ No Bear Peak related loop routes found');
      }

    } else {
      console.log('❌ No loop routes generated');
    }

    // Test specific loop patterns
    console.log('\n🎯 Testing specific loop patterns...');
    await testSpecificLoopPatterns(pgClient, stagingSchema);

  } catch (error) {
    console.error('❌ Error testing unified loop service:', error);
  } finally {
    await pgClient.end();
  }
}

async function testSpecificLoopPatterns(pgClient: Pool, stagingSchema: string) {
  // Test Bear Peak loop specifically
  console.log('\n🔍 Testing Bear Peak loop generation...');
  
  try {
          // Look for loops that include Bear Peak trails
      const bearPeakLoops = await pgClient.query(`
        WITH bear_peak_edges AS (
          SELECT wn.id FROM ${stagingSchema}.ways_noded wn
          JOIN ${stagingSchema}.ways w ON wn.id = w.id
          WHERE w.trail_name ILIKE '%bear peak%'
        )
        SELECT 
          seq,
          path_seq,
          node,
          edge,
          cost,
          agg_cost
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, cost, reverse_cost
           FROM ${stagingSchema}.ways_noded
           WHERE source IS NOT NULL 
             AND target IS NOT NULL 
             AND cost <= 2.0
           ORDER BY id'
        )
        WHERE edge IN (SELECT id FROM bear_peak_edges)
          AND agg_cost >= 5.0 AND agg_cost <= 15.0
        ORDER BY agg_cost DESC
        LIMIT 10
      `);

    console.log(`🔍 Found ${bearPeakLoops.rows.length} Bear Peak related loops`);
    
    if (bearPeakLoops.rows.length > 0) {
      console.log('📊 Bear Peak Loop Details:');
      const loopGroups = new Map<number, any[]>();
      bearPeakLoops.rows.forEach(row => {
        if (!loopGroups.has(row.path_seq)) {
          loopGroups.set(row.path_seq, []);
        }
        loopGroups.get(row.path_seq)!.push(row);
      });

      for (const [pathSeq, loopEdges] of loopGroups) {
        const totalDistance = loopEdges[loopEdges.length - 1].agg_cost;
        console.log(`   Loop ${pathSeq}: ${totalDistance.toFixed(2)}km, ${loopEdges.length} edges`);
      }
    }

  } catch (error) {
    console.error('❌ Error testing Bear Peak loops:', error);
  }
}

// Run the test
testUnifiedLoopService().catch(console.error);
