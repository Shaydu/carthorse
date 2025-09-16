#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { LollipopRouteGeneratorServiceLengthFirst } from '../src/services/layer3/LollipopRouteGeneratorServiceLengthFirst';
import { getDatabasePoolConfig } from '../src/utils/config-loader';

interface RouteWithEdges {
  anchor_node: number;
  dest_node: number;
  outbound_distance: number;
  return_distance: number;
  total_distance: number;
  path_id: number;
  connection_type: string;
  route_shape: string;
  edge_overlap_count: number;
  edge_overlap_percentage: number;
  route_geometry: string;
  edge_ids: number[];
}

interface EdgeCoverage {
  edge_id: number;
  routes: RouteWithEdges[];
  total_coverage: number;
}

class LoopCombinationOptimizer {
  private routes: RouteWithEdges[] = [];
  private edgeCoverage: Map<number, EdgeCoverage> = new Map();
  
  constructor(routes: RouteWithEdges[]) {
    this.routes = routes;
    this.buildEdgeCoverageMap();
  }
  
  private buildEdgeCoverageMap() {
    console.log('🔍 Building edge coverage map...');
    console.log(`   📊 Processing ${this.routes.length} routes...`);
    
    let processedRoutes = 0;
    // Build coverage map for each edge
    this.routes.forEach((route, index) => {
      route.edge_ids.forEach(edgeId => {
        if (!this.edgeCoverage.has(edgeId)) {
          this.edgeCoverage.set(edgeId, {
            edge_id: edgeId,
            routes: [],
            total_coverage: 0
          });
        }
        
        const coverage = this.edgeCoverage.get(edgeId)!;
        coverage.routes.push(route);
        coverage.total_coverage += route.total_distance;
      });
      
      processedRoutes++;
      if (processedRoutes % 10 === 0 || processedRoutes === this.routes.length) {
        console.log(`   📈 Processed ${processedRoutes}/${this.routes.length} routes (${this.edgeCoverage.size} unique edges so far)`);
      }
    });
    
    console.log(`   ✅ Completed: ${this.edgeCoverage.size} unique edges mapped from ${this.routes.length} routes`);
  }
  
  /**
   * Find the optimal combination of routes that maximizes total distance
   * while ensuring all edges are covered at least once
   */
  findOptimalCombination(): RouteWithEdges[] {
    console.log('🎯 Finding optimal route combination...');
    console.log('   🔍 Strategy: Greedy approach - start with longest route, add routes that maximize new edge coverage');
    
    // Strategy 1: Greedy approach - start with longest route, add routes that add most new edges
    const selectedRoutes: RouteWithEdges[] = [];
    const coveredEdges = new Set<number>();
    const remainingRoutes = [...this.routes];
    
    // Sort routes by total distance (longest first)
    console.log('   📊 Sorting routes by distance (longest first)...');
    remainingRoutes.sort((a, b) => b.total_distance - a.total_distance);
    
    console.log(`   🚀 Starting optimization with ${remainingRoutes.length} routes`);
    
    // Always start with the longest route
    if (remainingRoutes.length > 0) {
      const longestRoute = remainingRoutes.shift()!;
      selectedRoutes.push(longestRoute);
      longestRoute.edge_ids.forEach(edgeId => coveredEdges.add(edgeId));
      console.log(`   ✅ Added longest route: ${longestRoute.total_distance.toFixed(2)}km (${longestRoute.edge_ids.length} edges)`);
    }
    
    let iteration = 0;
    // Greedily add routes that maximize new edge coverage
    while (remainingRoutes.length > 0) {
      iteration++;
      console.log(`   🔄 Iteration ${iteration}: Evaluating ${remainingRoutes.length} remaining routes...`);
      
      let bestRoute: RouteWithEdges | null = null;
      let bestNewEdges = 0;
      let bestRouteIndex = -1;
      
      // Find route that adds the most new edges
      for (let i = 0; i < remainingRoutes.length; i++) {
        const route = remainingRoutes[i];
        const newEdges = route.edge_ids.filter(edgeId => !coveredEdges.has(edgeId)).length;
        
        if (newEdges > bestNewEdges) {
          bestNewEdges = newEdges;
          bestRoute = route;
          bestRouteIndex = i;
        }
      }
      
      // If no route adds new edges, try to find one that significantly extends coverage
      if (bestNewEdges === 0) {
        console.log('   🔍 No routes add new edges, looking for significant coverage extensions...');
        for (let i = 0; i < remainingRoutes.length; i++) {
          const route = remainingRoutes[i];
          const newEdges = route.edge_ids.filter(edgeId => !coveredEdges.has(edgeId)).length;
          const totalEdges = route.edge_ids.length;
          
          // If route has significant new coverage or is very long, consider it
          if (newEdges > 0 || (totalEdges > 50 && route.total_distance > 100)) {
            bestRoute = route;
            bestRouteIndex = i;
            bestNewEdges = newEdges;
            break;
          }
        }
      }
      
      if (bestRoute && bestNewEdges > 0) {
        selectedRoutes.push(bestRoute);
        bestRoute.edge_ids.forEach(edgeId => coveredEdges.add(edgeId));
        remainingRoutes.splice(bestRouteIndex, 1);
        console.log(`   ✅ Added route: ${bestRoute.total_distance.toFixed(2)}km (+${bestNewEdges} new edges, ${coveredEdges.size} total edges)`);
      } else {
        // No more beneficial routes
        console.log('   🛑 No more beneficial routes found, stopping optimization');
        break;
      }
    }
    
    const totalDistance = selectedRoutes.reduce((sum, route) => sum + route.total_distance, 0);
    const totalEdges = coveredEdges.size;
    
    console.log(`   🏆 Optimal combination found:`);
    console.log(`      • ${selectedRoutes.length} routes`);
    console.log(`      • ${totalDistance.toFixed(2)}km total distance`);
    console.log(`      • ${totalEdges} unique edges covered`);
    console.log(`      • ${(totalEdges / this.edgeCoverage.size * 100).toFixed(1)}% edge coverage`);
    
    return selectedRoutes;
  }
  
  /**
   * Find alternative combinations using different strategies
   */
  findAlternativeCombinations(): RouteWithEdges[][] {
    console.log('🔄 Finding alternative combinations...');
    console.log('   📊 Testing 3 different optimization strategies...');
    
    const combinations: RouteWithEdges[][] = [];
    
    // Strategy 2: Coverage-first approach
    console.log('   🎯 Strategy 1/3: Coverage-first approach...');
    const coverageFirst = this.findCoverageFirstCombination();
    combinations.push(coverageFirst);
    
    // Strategy 3: Distance-first approach (top N longest routes)
    console.log('   🎯 Strategy 2/3: Distance-first approach...');
    const distanceFirst = this.findDistanceFirstCombination();
    combinations.push(distanceFirst);
    
    // Strategy 4: Balanced approach
    console.log('   🎯 Strategy 3/3: Balanced approach...');
    const balanced = this.findBalancedCombination();
    combinations.push(balanced);
    
    console.log('   ✅ All alternative strategies completed');
    return combinations;
  }
  
  private findCoverageFirstCombination(): RouteWithEdges[] {
    console.log('   📊 Coverage-first strategy...');
    
    const selectedRoutes: RouteWithEdges[] = [];
    const coveredEdges = new Set<number>();
    const remainingRoutes = [...this.routes];
    
    // Sort by edge count (most edges first)
    remainingRoutes.sort((a, b) => b.edge_ids.length - a.edge_ids.length);
    
    for (const route of remainingRoutes) {
      const newEdges = route.edge_ids.filter(edgeId => !coveredEdges.has(edgeId)).length;
      if (newEdges > route.edge_ids.length * 0.3) { // At least 30% new edges
        selectedRoutes.push(route);
        route.edge_ids.forEach(edgeId => coveredEdges.add(edgeId));
      }
    }
    
    const totalDistance = selectedRoutes.reduce((sum, route) => sum + route.total_distance, 0);
    console.log(`      • ${selectedRoutes.length} routes, ${totalDistance.toFixed(2)}km, ${coveredEdges.size} edges`);
    
    return selectedRoutes;
  }
  
  private findDistanceFirstCombination(): RouteWithEdges[] {
    console.log('   🏃 Distance-first strategy...');
    
    // Take top 20 longest routes
    const sortedRoutes = [...this.routes].sort((a, b) => b.total_distance - a.total_distance);
    const topRoutes = sortedRoutes.slice(0, 20);
    
    const totalDistance = topRoutes.reduce((sum, route) => sum + route.total_distance, 0);
    const totalEdges = new Set(topRoutes.flatMap(route => route.edge_ids)).size;
    
    console.log(`      • ${topRoutes.length} routes, ${totalDistance.toFixed(2)}km, ${totalEdges} edges`);
    
    return topRoutes;
  }
  
  private findBalancedCombination(): RouteWithEdges[] {
    console.log('   ⚖️  Balanced strategy...');
    
    const selectedRoutes: RouteWithEdges[] = [];
    const coveredEdges = new Set<number>();
    const remainingRoutes = [...this.routes];
    
    // Sort by a combination of distance and edge count
    remainingRoutes.sort((a, b) => {
      const scoreA = a.total_distance + (a.edge_ids.length * 0.1);
      const scoreB = b.total_distance + (b.edge_ids.length * 0.1);
      return scoreB - scoreA;
    });
    
    for (const route of remainingRoutes) {
      const newEdges = route.edge_ids.filter(edgeId => !coveredEdges.has(edgeId)).length;
      if (newEdges > 0 || route.total_distance > 150) { // Always include very long routes
        selectedRoutes.push(route);
        route.edge_ids.forEach(edgeId => coveredEdges.add(edgeId));
      }
    }
    
    const totalDistance = selectedRoutes.reduce((sum, route) => sum + route.total_distance, 0);
    console.log(`      • ${selectedRoutes.length} routes, ${totalDistance.toFixed(2)}km, ${coveredEdges.size} edges`);
    
    return selectedRoutes;
  }
}

async function testLollipopIntegrationMaximumV2() {
  console.log('🚀 Testing LollipopRouteGeneratorServiceLengthFirst for ULTRA-MAXIMUM LENGTH routes (V2)...');
  console.log('🎯 NEW FEATURE: Loop Combination Optimization - Find the "best of both" loops!');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node test-lollipop-integration-maximum-v2.ts <schema_name>');
    process.exit(1);
  }

  // Get metadata information
  const { execSync } = require('child_process');
  let gitCommit = 'unknown';
  let gitBranch = 'unknown';
  let runTimestamp = new Date().toISOString();
  
  try {
    gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch (error) {
    console.log('⚠️  Could not get git information');
  }

  console.log('\n📋 METADATA:');
  console.log(`   • Schema: ${schema}`);
  console.log(`   • Git Commit: ${gitCommit}`);
  console.log(`   • Git Branch: ${gitBranch}`);
  console.log(`   • Run Timestamp: ${runTimestamp}`);
  console.log(`   • Script: test-lollipop-integration-maximum-v2.ts`);
  console.log(`   • Target: ULTRA-MAXIMUM LENGTH route discovery with loop combination (500km+ target)`);
  console.log('');

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // ULTRA-AGGRESSIVE configuration to find the absolute longest routes possible
    // BUT using same entrypoints as v1 for faster execution
    const lollipopService = new LollipopRouteGeneratorServiceLengthFirst(pgClient, {
      stagingSchema: schema,
      region: 'boulder',
      targetDistance: 500, // Very high target to not limit discovery
      maxAnchorNodes: 50, // Same as v1 - limited entrypoints for speed
      maxReachableNodes: 50, // Same as v1 - limited destinations for speed
      maxDestinationExploration: 25, // Same as v1 - limited exploration for speed
      distanceRangeMin: 0.1, // Allow very short outbound legs (10% of target)
      distanceRangeMax: 2.0, // Allow return legs up to 200% of target
      edgeOverlapThreshold: 95, // Allow up to 95% overlap (almost no filtering)
      kspPaths: 50, // Maximum path exploration
      minOutboundDistance: 0.5, // Very low minimum outbound distance (500m)
      outputPath: 'test-output'
    });

    console.log('🚀 Generating ULTRA-MAXIMUM LENGTH lollipop routes (V2)...');
    console.log('🎯 Strategy: Collect ALL routes, then optimize combinations for maximum coverage');
    console.log('   • 50 anchor nodes (same as v1 for speed)');
    console.log('   • 50 reachable nodes per anchor (same as v1 for speed)');
    console.log('   • 25 destinations per anchor (same as v1 for speed)');
    console.log('   • 50 KSP paths (maximum path exploration)');
    console.log('   • 95% overlap threshold (almost no filtering)');
    console.log('   • 0.5km minimum outbound (very low threshold)');
    console.log('   • 500km target distance (no discovery limits)');
    console.log('');
    
    const lollipopRoutes = await lollipopService.generateLollipopRoutes();
    
    console.log(`✅ Generated ${lollipopRoutes.length} lollipop routes`);
    
    if (lollipopRoutes.length > 0) {
      console.log('📊 ALL routes sorted by length (showing top 20):');
      const sortedRoutes = lollipopRoutes.sort((a, b) => b.total_distance - a.total_distance);
      
      sortedRoutes.slice(0, 20).forEach((route, index) => {
        console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km (${route.edge_overlap_percentage.toFixed(1)}% overlap) - Anchor ${route.anchor_node} → ${route.dest_node}`);
      });

      // NEW: Loop Combination Optimization
      console.log('\n🔄 LOOP COMBINATION OPTIMIZATION:');
      console.log('🎯 Finding the "best of both" loops to maximize total coverage...');
      console.log(`📊 Analyzing ${lollipopRoutes.length} routes for optimal combinations...`);
      
      const optimizer = new LoopCombinationOptimizer(lollipopRoutes);
      
      // Find optimal combination
      console.log('\n🎯 STEP 1/2: Finding optimal combination...');
      const optimalCombination = optimizer.findOptimalCombination();
      
      // Find alternative combinations
      console.log('\n🎯 STEP 2/2: Finding alternative combinations...');
      const alternativeCombinations = optimizer.findAlternativeCombinations();
      
      // Compare all combinations
      console.log('\n🏆 COMBINATION COMPARISON:');
      console.log('   📊 Optimal Combination:');
      const optimalTotal = optimalCombination.reduce((sum, route) => sum + route.total_distance, 0);
      const optimalEdges = new Set(optimalCombination.flatMap(route => route.edge_ids)).size;
      console.log(`      • ${optimalCombination.length} routes`);
      console.log(`      • ${optimalTotal.toFixed(2)}km total distance`);
      console.log(`      • ${optimalEdges} unique edges`);
      
      console.log('   📊 Alternative Combinations:');
      alternativeCombinations.forEach((combination, index) => {
        const total = combination.reduce((sum, route) => sum + route.total_distance, 0);
        const edges = new Set(combination.flatMap(route => route.edge_ids)).size;
        const strategy = ['Coverage-First', 'Distance-First', 'Balanced'][index];
        console.log(`      • ${strategy}: ${combination.length} routes, ${total.toFixed(2)}km, ${edges} edges`);
      });
      
      // Show the best combination details
      const bestCombination = [optimalCombination, ...alternativeCombinations]
        .sort((a, b) => {
          const scoreA = a.reduce((sum, route) => sum + route.total_distance, 0) + 
                        new Set(a.flatMap(route => route.edge_ids)).size * 0.1;
          const scoreB = b.reduce((sum, route) => sum + route.total_distance, 0) + 
                        new Set(b.flatMap(route => route.edge_ids)).size * 0.1;
          return scoreB - scoreA;
        })[0];
      
      console.log('\n🏆 BEST COMBINATION DETAILS:');
      bestCombination.slice(0, 10).forEach((route, index) => {
        console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km - Anchor ${route.anchor_node} → ${route.dest_node} (${route.edge_ids.length} edges)`);
      });
      
      const bestTotal = bestCombination.reduce((sum, route) => sum + route.total_distance, 0);
      const bestEdges = new Set(bestCombination.flatMap(route => route.edge_ids)).size;
      console.log(`\n   🎯 FINAL RESULT: ${bestCombination.length} routes, ${bestTotal.toFixed(2)}km total, ${bestEdges} unique edges`);

      // Check for Shadow Canyon routes specifically
      const shadowCanyonRoutes = sortedRoutes.filter(route => 
        route.route_shape && 
        (route.route_shape.includes('Shadow') || route.route_shape.includes('shadow'))
      );
      
      if (shadowCanyonRoutes.length > 0) {
        console.log(`\n🏔️  SHADOW CANYON ROUTES FOUND: ${shadowCanyonRoutes.length}`);
        shadowCanyonRoutes.slice(0, 10).forEach((route, index) => {
          console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km - Anchor ${route.anchor_node} → ${route.dest_node}`);
        });
      } else {
        console.log(`\n⚠️  No Shadow Canyon routes found in discovered routes`);
      }

      // Detailed statistics for ultra-maximum route discovery
      const ultraLongRoutes = lollipopRoutes.filter(r => r.total_distance >= 200);
      const extremeRoutes = lollipopRoutes.filter(r => r.total_distance >= 300);
      const networkLimitRoutes = lollipopRoutes.filter(r => r.total_distance >= 400);
      const massiveRoutes = lollipopRoutes.filter(r => r.total_distance >= 500);
      
      console.log(`\n📈 ULTRA-MAXIMUM ROUTE DISCOVERY STATISTICS (V2):`);
      console.log(`   • Total routes found: ${lollipopRoutes.length}`);
      console.log(`   • Routes ≥200km: ${ultraLongRoutes.length}`);
      console.log(`   • Routes ≥300km: ${extremeRoutes.length}`);
      console.log(`   • Routes ≥400km: ${networkLimitRoutes.length}`);
      console.log(`   • Routes ≥500km: ${massiveRoutes.length}`);
      console.log(`   • Average distance: ${(lollipopRoutes.reduce((sum, r) => sum + r.total_distance, 0) / lollipopRoutes.length).toFixed(2)}km`);
      console.log(`   • MAXIMUM distance found: ${Math.max(...lollipopRoutes.map(r => r.total_distance)).toFixed(2)}km`);
      console.log(`   • Median distance: ${sortedRoutes[Math.floor(sortedRoutes.length / 2)].total_distance.toFixed(2)}km`);
      
      // Show the absolute longest route details
      const longestRoute = sortedRoutes[0];
      console.log(`\n🏆 LONGEST SINGLE ROUTE DISCOVERED (V2):`);
      console.log(`   • Total Distance: ${longestRoute.total_distance.toFixed(2)}km`);
      console.log(`   • Outbound: ${longestRoute.outbound_distance.toFixed(2)}km`);
      console.log(`   • Return: ${longestRoute.return_distance.toFixed(2)}km`);
      console.log(`   • Anchor Node: ${longestRoute.anchor_node}`);
      console.log(`   • Destination Node: ${longestRoute.dest_node}`);
      console.log(`   • Edge Overlap: ${longestRoute.edge_overlap_percentage.toFixed(1)}%`);

      // Save to database
      await lollipopService.saveToDatabase(lollipopRoutes);
      console.log('💾 Routes saved to database');

      // Export to GeoJSON (only the best routes)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputFile = `test-output/lollipop-routes-${schema}-v2-${timestamp}.geojson`;
      
      // Export only the top 20 longest routes - we only need the best ones
      const routesToExport = sortedRoutes.slice(0, 20);
      console.log(`📁 Exporting top ${routesToExport.length} longest routes (the best ones only)`);
      
      await lollipopService.exportToGeoJSON(routesToExport, outputFile);
      console.log(`📁 Routes exported to: ${outputFile}`);

      // Additional analysis for V2
      console.log(`\n🔍 ULTRA-MAXIMUM NETWORK ANALYSIS (V2):`);
      const distanceRanges = [
        { min: 0, max: 100, label: 'Short (0-100km)' },
        { min: 100, max: 200, label: 'Medium (100-200km)' },
        { min: 200, max: 300, label: 'Long (200-300km)' },
        { min: 300, max: 400, label: 'Very Long (300-400km)' },
        { min: 400, max: 500, label: 'Extreme (400-500km)' },
        { min: 500, max: Infinity, label: 'MASSIVE (500km+)' }
      ];
      
      distanceRanges.forEach(range => {
        const count = lollipopRoutes.filter(r => r.total_distance >= range.min && r.total_distance < range.max).length;
        console.log(`   • ${range.label}: ${count} routes`);
      });

      // Show top 10 longest routes with more detail
      console.log(`\n🏆 TOP 10 LONGEST ROUTES (V2):`);
      sortedRoutes.slice(0, 10).forEach((route, index) => {
        console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km total`);
        console.log(`      Outbound: ${route.outbound_distance.toFixed(2)}km, Return: ${route.return_distance.toFixed(2)}km`);
        console.log(`      Anchor ${route.anchor_node} → ${route.dest_node} (${route.edge_overlap_percentage.toFixed(1)}% overlap)`);
        console.log('');
      });

    } else {
      console.log('❌ No lollipop routes found');
    }

    console.log('\n🎉 V2 Script completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error testing ultra-maximum lollipop integration (V2):', error);
    process.exit(1);
  } finally {
    await pgClient.end();
    console.log('✅ Database connection closed');
  }
}

// Run the test
testLollipopIntegrationMaximumV2().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});