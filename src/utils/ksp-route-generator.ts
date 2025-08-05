import { Pool } from 'pg';

export interface RoutePattern {
  id: number;
  pattern_name: string;
  target_distance_km: number;
  target_elevation_gain: number;
  route_shape: string;
  tolerance_percent: number;
}

export interface RouteRecommendation {
  route_uuid: string;
  route_name: string;
  route_type: string;
  route_shape: string;
  input_distance_km: number;
  input_elevation_gain: number;
  recommended_distance_km: number;
  recommended_elevation_gain: number;
  route_path: any;
  route_edges: any;
  trail_count: number;
  route_score: number;
  similarity_score: number;
  region: string;
}

export interface KspRouteStep {
  seq: number;
  path_id: number;
  path_seq: number;
  start_vid: number;
  end_vid: number;
  node: number;
  edge: number;
  cost: number;
  agg_cost: number;
}

export interface ToleranceConfig {
  name: string;
  distance: number;
  elevation: number;
  quality: number;
}

export class KspRouteGenerator {
  private pool: Pool;
  private stagingSchema: string;

  constructor(pool: Pool, stagingSchema: string) {
    this.pool = pool;
    this.stagingSchema = stagingSchema;
  }

  /**
   * Generate out-and-back routes using KSP algorithm
   * For out-and-back routes, we target half the distance since we'll double it for the return journey
   */
  async generateOutAndBackRoutes(pattern: RoutePattern, targetRoutes: number = 5): Promise<RouteRecommendation[]> {
    console.log(`\n🎯 Generating out-and-back routes for: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
    
    // For out-and-back routes, we target half the distance since we'll double it
    const halfTargetDistance = pattern.target_distance_km / 2;
    const halfTargetElevation = pattern.target_elevation_gain / 2;
    
    console.log(`📏 Targeting half-distance: ${halfTargetDistance.toFixed(1)}km, half-elevation: ${halfTargetElevation.toFixed(0)}m`);
    
    // Get intersection nodes for routing
    const nodesResult = await this.pool.query(`
      SELECT pg_id as id, node_type, connection_count 
      FROM ${this.stagingSchema}.node_mapping 
      WHERE node_type IN ('intersection', 'simple_connection')
      ORDER BY connection_count DESC
      LIMIT 20
    `);
    
    if (nodesResult.rows.length < 2) {
      console.log('⚠️ Not enough nodes for routing');
      return [];
    }

    const patternRoutes: RouteRecommendation[] = [];
    
    // Try different tolerance levels to get target routes
    const toleranceLevels: ToleranceConfig[] = [
      { name: 'strict', distance: pattern.tolerance_percent, elevation: pattern.tolerance_percent, quality: 1.0 },
      { name: 'medium', distance: 50, elevation: 50, quality: 0.8 },
      { name: 'wide', distance: 100, elevation: 100, quality: 0.6 }
    ];

    for (const tolerance of toleranceLevels) {
      if (patternRoutes.length >= targetRoutes) break;
      
      console.log(`🔍 Trying ${tolerance.name} tolerance (${tolerance.distance}% distance, ${tolerance.elevation}% elevation)`);
      
      // Generate out-and-back routes from each node
      for (let i = 0; i < Math.min(nodesResult.rows.length, 10); i++) {
        if (patternRoutes.length >= targetRoutes) break;
        
        const startNode = nodesResult.rows[i].id;
        
        // Find reachable nodes using proper path-based discovery
        // Use pgr_dijkstra to find nodes within a reasonable distance (2x half target for safety)
        const maxSearchDistance = halfTargetDistance * 2;
        console.log(`  🔍 Finding nodes reachable within ${maxSearchDistance.toFixed(1)}km from node ${startNode}...`);
        
        const reachableNodes = await this.pool.query(`
          SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
          FROM pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded',
            $1::bigint, 
            (SELECT array_agg(pg_id) FROM ${this.stagingSchema}.node_mapping WHERE node_type IN ('intersection', 'simple_connection')),
            false
          )
          WHERE agg_cost <= $2
          AND end_vid != $1
          ORDER BY agg_cost DESC
          LIMIT 10
        `, [startNode, maxSearchDistance]);
        
        if (reachableNodes.rows.length === 0) {
          console.log(`  ❌ No reachable nodes found from node ${startNode} within ${maxSearchDistance.toFixed(1)}km`);
          continue;
        }
        
        console.log(`  ✅ Found ${reachableNodes.rows.length} reachable nodes from node ${startNode}`);
        
        // Try each reachable node as a destination for out-and-back route
        for (const reachableNode of reachableNodes.rows) {
          if (patternRoutes.length >= targetRoutes) break;
          
          const endNode = reachableNode.node_id;
          const oneWayDistance = reachableNode.distance_km;
          
          console.log(`  🛤️ Trying out-and-back route: ${startNode} → ${endNode} → ${startNode} (one-way: ${oneWayDistance.toFixed(2)}km)`);
          
          // Check if the one-way distance is reasonable for our target
          const minDistance = halfTargetDistance * (1 - tolerance.distance / 100);
          const maxDistance = halfTargetDistance * (1 + tolerance.distance / 100);
          
          if (oneWayDistance < minDistance || oneWayDistance > maxDistance) {
            console.log(`  ❌ One-way distance ${oneWayDistance.toFixed(2)}km outside tolerance range [${minDistance.toFixed(2)}km, ${maxDistance.toFixed(2)}km]`);
            continue;
          }
          
          try {
            // Verify we can return from endNode to startNode (should be same distance)
            const returnPathCheck = await this.pool.query(`
              SELECT 
                COUNT(*) as path_exists,
                MAX(agg_cost) as return_distance_km
              FROM pgr_dijkstra(
                'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded',
                $1::bigint, $2::bigint, false
              )
            `, [endNode, startNode]);
            
            const canReturn = returnPathCheck.rows[0].path_exists > 0;
            const returnDistance = returnPathCheck.rows[0].return_distance_km || 0;
            
            if (!canReturn) {
              console.log(`  ❌ Cannot return from node ${endNode} to ${startNode}`);
              continue;
            }
            
            // Check if return distance is similar to outbound distance (within 10%)
            const distanceDiff = Math.abs(oneWayDistance - returnDistance);
            const distanceDiffPercent = (distanceDiff / oneWayDistance) * 100;
            
            if (distanceDiffPercent > 10) {
              console.log(`  ❌ Return distance ${returnDistance.toFixed(2)}km differs too much from outbound ${oneWayDistance.toFixed(2)}km (${distanceDiffPercent.toFixed(1)}% difference)`);
              continue;
            }
            
            console.log(`  ✅ Return path verified: ${returnDistance.toFixed(2)}km (${distanceDiffPercent.toFixed(1)}% difference)`);

            // Use KSP to find multiple routes for the outbound journey
            const kspResult = await this.pool.query(`
              SELECT * FROM pgr_ksp(
                'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded',
                $1::bigint, $2::bigint, 3, false, false
              )
            `, [startNode, endNode]);
            
            console.log(`✅ KSP found ${kspResult.rows.length} routes`);
            
            // Process each KSP route
            const routeGroups = new Map();
            for (const row of kspResult.rows) {
              if (!routeGroups.has(row.path_id)) {
                routeGroups.set(row.path_id, []);
              }
              routeGroups.get(row.path_id).push(row);
            }
            
            for (const [pathId, routeSteps] of routeGroups) {
              if (patternRoutes.length >= targetRoutes) break;
              
              // Extract edge IDs from the route steps (skip -1 which means no edge)
              const edgeIds = routeSteps.map((step: KspRouteStep) => step.edge).filter((edge: number) => edge !== -1);
              
              if (edgeIds.length === 0) {
                console.log(`  ⚠️ No valid edges found for path ${pathId}`);
                continue;
              }
              
              // Get the edges for this route
              const routeEdges = await this.pool.query(`
                SELECT * FROM ${this.stagingSchema}.ways_noded 
                WHERE id = ANY($1::integer[])
                ORDER BY id
              `, [edgeIds]);
              
              if (routeEdges.rows.length === 0) {
                console.log(`  ⚠️ No edges found for route path`);
                continue;
              }
              
              // Calculate route metrics (one-way)
              let totalDistance = 0;
              let totalElevationGain = 0;
              
              for (const edge of routeEdges.rows) {
                totalDistance += edge.length_km || 0;
                totalElevationGain += edge.elevation_gain || 0;
              }
              
              // For out-and-back routes, double the distance and elevation for the return journey
              const outAndBackDistance = totalDistance * 2;
              const outAndBackElevation = totalElevationGain * 2;
              
              console.log(`  📏 Route metrics: ${totalDistance.toFixed(2)}km → ${outAndBackDistance.toFixed(2)}km (out-and-back), ${totalElevationGain.toFixed(0)}m → ${outAndBackElevation.toFixed(0)}m elevation`);
              
              // Check if route meets tolerance criteria (using full out-and-back distance)
              const distanceOk = outAndBackDistance >= pattern.target_distance_km * (1 - tolerance.distance / 100) && outAndBackDistance <= pattern.target_distance_km * (1 + tolerance.distance / 100);
              const elevationOk = outAndBackElevation >= pattern.target_elevation_gain * (1 - tolerance.elevation / 100) && outAndBackElevation <= pattern.target_elevation_gain * (1 + tolerance.elevation / 100);
              
              if (distanceOk && elevationOk) {
                // Calculate quality score based on tolerance level
                const finalScore = tolerance.quality * (1.0 - Math.abs(outAndBackDistance - pattern.target_distance_km) / pattern.target_distance_km);
                
                console.log(`  ✅ Route meets criteria! Score: ${finalScore.toFixed(3)}`);
                
                // Store the route
                const recommendation: RouteRecommendation = {
                  route_uuid: `ksp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  route_name: `${pattern.pattern_name} - KSP Route`,
                  route_type: 'custom',
                  route_shape: pattern.route_shape,
                  input_distance_km: pattern.target_distance_km,
                  input_elevation_gain: pattern.target_elevation_gain,
                  recommended_distance_km: outAndBackDistance,
                  recommended_elevation_gain: outAndBackElevation,
                  route_path: { path_id: pathId, steps: routeSteps },
                  route_edges: routeEdges.rows,
                  trail_count: routeEdges.rows.length,
                  route_score: Math.floor(finalScore * 100),
                  similarity_score: finalScore,
                  region: 'boulder'
                };
                
                patternRoutes.push(recommendation);
                
                if (patternRoutes.length >= targetRoutes) {
                  console.log(`  🎯 Reached ${targetRoutes} routes for this pattern`);
                  break;
                }
              } else {
                console.log(`  ❌ Route doesn't meet criteria (distance: ${distanceOk}, elevation: ${elevationOk})`);
              }
            }
          } catch (error: any) {
            console.log(`❌ KSP routing failed: ${error.message}`);
          }
        }
      }
    }
    
    // Sort by score and take top routes
    const bestRoutes = patternRoutes
      .sort((a, b) => b.route_score - a.route_score)
      .slice(0, targetRoutes);
    
    console.log(`✅ Generated ${bestRoutes.length} out-and-back routes for ${pattern.pattern_name}`);
    return bestRoutes;
  }
} 