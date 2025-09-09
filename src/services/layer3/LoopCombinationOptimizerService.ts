import { LollipopRoute } from './LollipopRouteGeneratorService';

export interface RouteWithEdges {
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

export interface EdgeCoverage {
  edge_id: number;
  routes: RouteWithEdges[];
  total_coverage: number;
}

export interface OptimizationResult {
  optimalCombination: RouteWithEdges[];
  alternativeCombinations: RouteWithEdges[][];
  bestCombination: RouteWithEdges[];
  totalDistance: number;
  totalEdges: number;
  edgeCoveragePercentage: number;
}

export class LoopCombinationOptimizerService {
  private routes: RouteWithEdges[] = [];
  private edgeCoverage: Map<number, EdgeCoverage> = new Map();
  
  constructor(routes: LollipopRoute[]) {
    // Convert LollipopRoute to RouteWithEdges format
    this.routes = routes.map(route => ({
      anchor_node: route.anchor_node,
      dest_node: route.dest_node,
      outbound_distance: route.outbound_distance,
      return_distance: route.return_distance,
      total_distance: route.total_distance,
      path_id: route.path_id,
      connection_type: route.connection_type,
      route_shape: route.route_shape,
      edge_overlap_count: route.edge_overlap_count,
      edge_overlap_percentage: route.edge_overlap_percentage,
      route_geometry: route.route_geometry,
      edge_ids: route.edge_ids
    }));
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

  /**
   * Run the complete optimization process and return results
   */
  optimizeRoutes(): OptimizationResult {
    console.log('\n🔄 LOOP COMBINATION OPTIMIZATION:');
    console.log('🎯 Finding the "best of both" loops to maximize total coverage...');
    console.log(`📊 Analyzing ${this.routes.length} routes for optimal combinations...`);
    
    // Find optimal combination
    console.log('\n🎯 STEP 1/2: Finding optimal combination...');
    const optimalCombination = this.findOptimalCombination();
    
    // Find alternative combinations
    console.log('\n🎯 STEP 2/2: Finding alternative combinations...');
    const alternativeCombinations = this.findAlternativeCombinations();
    
    // Find the best combination overall
    const bestCombination = [optimalCombination, ...alternativeCombinations]
      .sort((a, b) => {
        const scoreA = a.reduce((sum, route) => sum + route.total_distance, 0) + 
                      new Set(a.flatMap(route => route.edge_ids)).size * 0.1;
        const scoreB = b.reduce((sum, route) => sum + route.total_distance, 0) + 
                      new Set(b.flatMap(route => route.edge_ids)).size * 0.1;
        return scoreB - scoreA;
      })[0];
    
    const totalDistance = bestCombination.reduce((sum, route) => sum + route.total_distance, 0);
    const totalEdges = new Set(bestCombination.flatMap(route => route.edge_ids)).size;
    const edgeCoveragePercentage = (totalEdges / this.edgeCoverage.size * 100);
    
    console.log('\n🏆 OPTIMIZATION COMPLETE:');
    console.log(`   • Best combination: ${bestCombination.length} routes`);
    console.log(`   • Total distance: ${totalDistance.toFixed(2)}km`);
    console.log(`   • Unique edges: ${totalEdges}`);
    console.log(`   • Edge coverage: ${edgeCoveragePercentage.toFixed(1)}%`);
    
    return {
      optimalCombination,
      alternativeCombinations,
      bestCombination,
      totalDistance,
      totalEdges,
      edgeCoveragePercentage
    };
  }
}
