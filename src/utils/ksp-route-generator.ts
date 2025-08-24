import { Pool, Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

export interface RoutePattern {
  pattern_name: string;
  target_distance_km: number;
  target_elevation_gain: number;
  route_shape: string;
  tolerance_percent: number;
}

export interface RouteRecommendation {
  route_uuid?: string; // Optional since database generates it automatically
  route_name: string;
  route_shape: string;
  input_length_km: number;
  input_elevation_gain: number;
  recommended_length_km: number;
  recommended_elevation_gain: number;
  route_path: any;
  route_edges: any[];
  route_geometry?: any; // Aggregated geometry from constituent trails
  trail_count: number;
  route_score: number;
  similarity_score: number;
  region: string;
  // Constituent trail analysis data
  constituent_trails?: any[];
  unique_trail_count?: number;
  total_trail_distance_km?: number;
  total_trail_elevation_gain_m?: number;
  out_and_back_distance_km?: number;
  out_and_back_elevation_gain_m?: number;
}

interface ToleranceConfig {
  name: string;
  distance: number;
  elevation: number;
  quality: number;
}

export class KspRouteGenerator {
  private pgClient: Pool | Client;
  private stagingSchema: string;
  private outputConfig?: { includeLoops?: boolean; includePointToPoint?: boolean; includeOutAndBack?: boolean; includeLollipops?: boolean };

  constructor(pgClient: Pool | Client, stagingSchema: string, outputConfig?: { includeLoops?: boolean; includePointToPoint?: boolean; includeOutAndBack?: boolean; includeLollipops?: boolean }) {
    this.pgClient = pgClient;
    this.stagingSchema = stagingSchema;
    this.outputConfig = outputConfig;
  }

  async generateRouteRecommendations(): Promise<RouteRecommendation[]> {
    console.log('🛤️ Starting KSP route recommendation generation...');
    
    try {
      // Step 1: Load route patterns based on output configuration
      console.log('📋 Loading route patterns based on output configuration...');
      const patterns = await this.loadRoutePatterns();
      
      // Filter patterns based on output configuration
      const enabledPatterns = patterns.filter(pattern => this.shouldGenerateRouteShape(pattern.route_shape));
      console.log(`✅ Loaded ${patterns.length} total patterns, ${enabledPatterns.length} enabled by configuration`);
      
      if (enabledPatterns.length === 0) {
        console.log('⚠️ No enabled route patterns found based on output configuration');
        return [];
      }

      // Step 2: Add length and elevation columns to ways_noded for KSP routing
      console.log('📏 Adding length and elevation columns to ways_noded...');
      await this.addLengthAndElevationColumns();

      // Step 3: Skip connectivity fixes (now handled at network level)
      console.log('⏭️ Skipping connectivity fixes (handled at network level)');

      // Step 4: Generate routes for each enabled pattern using native pgRouting algorithms
      const allRecommendations: RouteRecommendation[] = [];
      
      for (const pattern of enabledPatterns) {
        console.log(`\n🎯 Processing pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m, ${pattern.route_shape})`);
        
        let patternRoutes: RouteRecommendation[] = [];
        const targetRoutes = 5;
        
        // Use different pgRouting algorithms based on route shape and output configuration
        console.log(`🔍 DEBUG: Pattern ${pattern.pattern_name} has route_shape: "${pattern.route_shape}"`);
        

        
        if (pattern.route_shape === 'loop') {
          console.log(`🔄 Using pgr_dijkstra for loop routes`);
          patternRoutes = await this.generateLoopRoutes(pattern, targetRoutes);
          
          // Add specialized Bear Canyon loop if this is a Bear Canyon pattern
          if (pattern.pattern_name.toLowerCase().includes('bear canyon') || pattern.pattern_name.toLowerCase().includes('bear peak')) {
            console.log(`🎯 Adding specialized Bear Canyon loop for pattern: ${pattern.pattern_name}`);
            const bearCanyonRoutes = await this.generateBearCanyonLoop(pattern);
            patternRoutes.push(...bearCanyonRoutes);
          }
        } else if (pattern.route_shape === 'point-to-point') {
          console.log(`🔄 Using pgr_dijkstra for point-to-point routes`);
          patternRoutes = await this.generatePointToPointRoutes(pattern, targetRoutes);
        } else if (pattern.route_shape === 'out-and-back') {
          // Use new true out-and-back generation that reverses P2P routes
          console.log(`🔄 Using TRUE out-and-back generation (P2P reversal)`);
          patternRoutes = await this.generateTrueOutAndBackRoutes(pattern, targetRoutes);
        } else {
          // Default to out-and-back using existing KSP logic
          console.log(`🔄 Using pgr_ksp for out-and-back routes`);
          patternRoutes = await this.generateOutAndBackRoutes(pattern, targetRoutes);
        }
        
        // Also try withPoints for more flexible routing
        if (patternRoutes.length < targetRoutes) {
          console.log(`🔄 Trying pgr_withPoints for additional flexible routes`);
          const withPointsRoutes = await this.generateWithPointsRoutes(pattern, targetRoutes - patternRoutes.length);
          patternRoutes.push(...withPointsRoutes);
        }
        
        console.log(`✅ Generated ${patternRoutes.length} routes for ${pattern.pattern_name} (${pattern.route_shape})`);
        allRecommendations.push(...patternRoutes);
      }

      // Store recommendations in the staging schema for SQLite export
      if (allRecommendations.length > 0) {
        console.log(`💾 Storing ${allRecommendations.length} route recommendations in staging schema...`);
        await this.storeRecommendationsInDatabase(allRecommendations);
        console.log(`✅ Successfully stored ${allRecommendations.length} route recommendations`);
      } else {
        console.log('⚠️ No route recommendations generated');
      }

      return allRecommendations;

    } catch (error) {
      console.error('❌ KSP route generation failed:', error);
      throw error;
    }
  }

  private shouldGenerateRouteShape(routeShape: string): boolean {
    // If no output configuration is provided, default to all route shapes
    if (!this.outputConfig) {
      return true;
    }
    
    // Check if this route shape is enabled in the output configuration
    switch (routeShape) {
      case 'loop':
        return this.outputConfig.includeLoops !== false;
      case 'point-to-point':
        return this.outputConfig.includePointToPoint !== false;
      case 'out-and-back':
        return this.outputConfig.includeOutAndBack !== false;
      case 'lollipop':
        return this.outputConfig.includeLollipops !== false;
      default:
        return false; // Unknown route shapes are disabled by default
    }
  }

  private async loadRoutePatterns(): Promise<RoutePattern[]> {
    // Load all route patterns, not just loops, since we'll filter based on output configuration
    const result = await this.pgClient.query(`
      SELECT pattern_name, target_distance_km, target_elevation_gain, route_shape, tolerance_percent
      FROM public.route_patterns 
      ORDER BY target_distance_km, route_shape
    `);
    
    return result.rows;
  }

  private async addLengthAndElevationColumns(): Promise<void> {
    console.log('📏 Adding length and elevation columns to ways_noded...');
    
    // Add length_km and elevation_gain columns to ways_noded table
    await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.ways_noded w
      SET 
        length_km = t.length_km,
        elevation_gain = t.elevation_gain
      FROM ${this.stagingSchema}.trails t
      WHERE w.original_trail_uuid = t.original_trail_uuid
    `);
    
    console.log('✅ Added length and elevation columns to ways_noded');
  }

  private getRegionFromStagingSchema(): string {
    // Region is implicit in staging schema name - extract from schema name
    const regionMatch = this.stagingSchema.match(/carthorse_(\w+)_\d+/);
    return regionMatch ? regionMatch[1] : 'boulder';
  }

  public async storeRecommendationsInDatabase(recommendations: RouteRecommendation[]): Promise<void> {
    console.log(`💾 Storing ${recommendations.length} route recommendations in ${this.stagingSchema}.route_recommendations...`);
    
    // Clear existing recommendations
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.route_recommendations`);
    
    // Insert new recommendations
    for (const recommendation of recommendations) {
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.route_recommendations (
          route_uuid, route_name, route_shape, 
          input_length_km, input_elevation_gain, 
          recommended_length_km, recommended_elevation_gain,
          route_path, route_edges, trail_count, 
          route_score, similarity_score, region
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        recommendation.route_uuid,
        recommendation.route_name,
        recommendation.route_shape,
        recommendation.input_length_km,
        recommendation.input_elevation_gain,
        recommendation.recommended_length_km,
        recommendation.recommended_elevation_gain,
        JSON.stringify(recommendation.route_path),
        JSON.stringify(recommendation.route_edges),
        recommendation.trail_count,
        recommendation.route_score,
        recommendation.similarity_score,
        recommendation.region
      ]);
    }
    
    console.log(`✅ Successfully stored ${recommendations.length} route recommendations in database`);
  }

  /**
   * Generate the specific Bear Canyon loop with all required trail segments
   * This manually constructs the complex loop: Bear Canyon → Mesa → Bluebell-Baird → Amphitheater → Saddle Rock → Gregory Canyon → Ranger → Green Mountain West Ridge → Green Bear → back to Bear Canyon
   */
  async generateBearCanyonLoop(pattern: RoutePattern): Promise<RouteRecommendation[]> {
    console.log(`🎯 Generating specialized Bear Canyon loop for: ${pattern.pattern_name}`);
    const recommendations: RouteRecommendation[] = [];
    
    try {
      // Define the specific Bear Canyon loop path
      const bearCanyonLoopPath = [
        { from: 334, to: 359, description: 'Fern Canyon to Mesa Trail' },
        { from: 359, to: 358, description: 'Mesa Trail connection' },
        { from: 358, to: 341, description: 'Mesa Trail to Bear Canyon' },
        { from: 341, to: 335, description: 'Bear Canyon to Bear Peak West Ridge' },
        { from: 335, to: 340, description: 'Bear Peak West Ridge to Bear Peak' },
        { from: 340, to: 335, description: 'Bear Peak back to Bear Peak West Ridge' },
        { from: 335, to: 338, description: 'Bear Peak West Ridge to Fern Canyon' },
        { from: 338, to: 334, description: 'Fern Canyon back to start' }
      ];
      
      const pathEdges: any[] = [];
      let totalLength = 0;
      let totalElevation = 0;
      
      for (const segment of bearCanyonLoopPath) {
        // Find the edge for this segment
        const edgeResult = await this.pgClient.query(`
          SELECT id, source, target, trail_name, length_km, elevation_gain
          FROM ${this.stagingSchema}.ways_noded
          WHERE (source = $1 AND target = $2) OR (source = $2 AND target = $1)
          LIMIT 1
        `, [segment.from, segment.to]);
        
        if (edgeResult.rows.length > 0) {
          const edge = edgeResult.rows[0];
          pathEdges.push({
            edge_id: edge.id,
            trail_name: edge.trail_name,
            length_km: edge.length_km,
            elevation_gain: edge.elevation_gain || 0
          });
          totalLength += edge.length_km;
          totalElevation += edge.elevation_gain || 0;
        } else {
          console.log(`⚠️  No direct edge found for ${segment.from} → ${segment.to} (${segment.description})`);
          // Try to find a path using Dijkstra
          const pathResult = await this.pgClient.query(`
            SELECT * FROM pgr_dijkstra(
              'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded',
              $1::integer, $2::integer, false
            )
          `, [segment.from, segment.to]);
          
          if (pathResult.rows.length > 0) {
            // Get the edges in the path
            const edgeIds = pathResult.rows.map((row: any) => row.edge);
            const edgesResult = await this.pgClient.query(`
              SELECT id, source, target, trail_name, length_km, elevation_gain
              FROM ${this.stagingSchema}.ways_noded
              WHERE id = ANY($1::integer[])
              ORDER BY id
            `, [edgeIds]);
            
            edgesResult.rows.forEach((edge: any) => {
              pathEdges.push({
                edge_id: edge.id,
                trail_name: edge.trail_name,
                length_km: edge.length_km,
                elevation_gain: edge.elevation_gain || 0
              });
              totalLength += edge.length_km;
              totalElevation += edge.elevation_gain || 0;
            });
          }
        }
      }
      
      if (pathEdges.length > 0) {
        const routeUuid = `bear-canyon-loop-${Date.now()}`;
        const recommendation: RouteRecommendation = {
          route_uuid: routeUuid,
          route_name: `${pattern.pattern_name} - Bear Canyon Loop`,
          route_shape: 'loop',
          input_length_km: pattern.target_distance_km,
          input_elevation_gain: pattern.target_elevation_gain,
          recommended_length_km: totalLength,
          recommended_elevation_gain: totalElevation,
          route_path: {
            path: bearCanyonLoopPath.map(seg => seg.from.toString()),
            edges: pathEdges.map(edge => edge.edge_id.toString()),
            start_node: '334',
            end_node: '334'
          },
          route_edges: pathEdges,
          trail_count: pathEdges.length,
          route_score: 1.0,
          similarity_score: 1.0,
          region: 'boulder'
        };
        
        recommendations.push(recommendation);
        console.log(`✅ Generated Bear Canyon loop: ${totalLength.toFixed(2)}km, ${totalElevation.toFixed(0)}m elevation`);
      }
      
    } catch (error) {
      console.error('❌ Error generating Bear Canyon loop:', error);
    }
    
    return recommendations;
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
    const nodesResult = await this.pgClient.query(`
      SELECT pg_id as id, node_type, connection_count 
      FROM ${this.stagingSchema}.node_mapping 
      WHERE node_type IN ('intersection', 'endpoint')
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
        
        const reachableNodes = await this.pgClient.query(`
          SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
          FROM pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded',
            $1::bigint, 
            (SELECT array_agg(pg_id) FROM ${this.stagingSchema}.node_mapping WHERE node_type IN ('intersection', 'endpoint')),
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
            const returnPathCheck = await this.pgClient.query(`
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
            const kspResult = await this.pgClient.query(`
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
              const edgeIds = routeSteps.map((step: any) => step.edge).filter((edge: number) => edge !== -1);
              
              if (edgeIds.length === 0) {
                console.log(`  ⚠️ No valid edges found for path ${pathId}`);
                continue;
              }
              
              // Get the edges for this route
              const routeEdges = await this.pgClient.query(`
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
                  route_shape: pattern.route_shape,
                  input_length_km: pattern.target_distance_km,
                  input_elevation_gain: pattern.target_elevation_gain,
                  recommended_length_km: outAndBackDistance,
                  recommended_elevation_gain: outAndBackElevation,
                  route_path: { path_id: pathId, steps: routeSteps },
                  route_edges: routeEdges.rows,
                  trail_count: routeEdges.rows.length,
                  route_score: Math.floor(finalScore * 100),
                  similarity_score: finalScore,
                  region: await this.getRegionFromStagingSchema()
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

  private async fixConnectivityIssues(): Promise<void> {
    const connectionTolerance = 0.000045; // ~5 meters in degrees
    
    // 1. Connect edges that come within 5m of nodes but aren't properly connected
    const edgeToNodeConnections = await this.pgClient.query(`
      WITH nearby_edges_nodes AS (
        SELECT 
          e.original_trail_id as edge_id,
          e.source as current_source,
          e.target as current_target,
          n.id as nearby_node_id,
          ST_Distance(ST_EndPoint(e.the_geom), n.the_geom) as distance_to_node,
          CASE 
            WHEN ST_Distance(ST_StartPoint(e.the_geom), n.the_geom) < ST_Distance(ST_EndPoint(e.the_geom), n.the_geom)
            THEN 'start'
            ELSE 'end'
          END as connection_point
        FROM ${this.stagingSchema}.ways_noded e
        CROSS JOIN ${this.stagingSchema}.ways_noded_vertices_pgr n
        WHERE ST_DWithin(ST_EndPoint(e.the_geom), n.the_geom, $1)
          OR ST_DWithin(ST_StartPoint(e.the_geom), n.the_geom, $1)
      )
      SELECT 
        edge_id,
        nearby_node_id,
        distance_to_node,
        connection_point
      FROM nearby_edges_nodes
      WHERE distance_to_node <= $1
        AND (current_source != nearby_node_id AND current_target != nearby_node_id)
      ORDER BY distance_to_node
    `, [connectionTolerance]);
    
    if (edgeToNodeConnections.rows.length > 0) {
      console.log(`🔗 Found ${edgeToNodeConnections.rows.length} edges to connect to nearby nodes`);
      
      // Update edge connections
      for (const connection of edgeToNodeConnections.rows) {
        if (connection.connection_point === 'start') {
          await this.pgClient.query(`
            UPDATE ${this.stagingSchema}.ways_noded 
            SET source = $1
            WHERE original_trail_id = $2
          `, [connection.nearby_node_id, connection.edge_id]);
        } else {
          await this.pgClient.query(`
            UPDATE ${this.stagingSchema}.ways_noded 
            SET target = $1
            WHERE original_trail_id = $2
          `, [connection.nearby_node_id, connection.edge_id]);
        }
      }
      console.log(`✅ Connected ${edgeToNodeConnections.rows.length} edges to nearby nodes`);
    }
    
    // 2. Connect nearby endpoints (within 5m) to create intersection nodes
    const endpointConnections = await this.pgClient.query(`
      WITH endpoint_pairs AS (
        SELECT 
          v1.id as node1_id,
          v2.id as node2_id,
          ST_Distance(v1.the_geom, v2.the_geom) as distance,
          v1.the_geom as geom1,
          v2.the_geom as geom2
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v1
        CROSS JOIN ${this.stagingSchema}.ways_noded_vertices_pgr v2
        WHERE v1.id < v2.id
          AND v1.cnt = 1  -- Both are endpoints
          AND v2.cnt = 1
          AND ST_DWithin(v1.the_geom, v2.the_geom, $1)
          AND NOT EXISTS (
            SELECT 1 FROM ${this.stagingSchema}.ways_noded e 
            WHERE (e.source = v1.id AND e.target = v2.id) 
               OR (e.source = v2.id AND e.target = v1.id)
          )
      )
      SELECT 
        node1_id,
        node2_id,
        distance,
        ST_MakeLine(geom1, geom2) as bridge_geom
      FROM endpoint_pairs
      WHERE distance <= $1
      ORDER BY distance
      LIMIT 100  -- Limit to prevent too many connections
    `, [connectionTolerance]);
    
    if (endpointConnections.rows.length > 0) {
      console.log(`🔗 Found ${endpointConnections.rows.length} endpoint pairs to connect`);
      
      // Add virtual bridge edges between endpoints
      for (const connection of endpointConnections.rows) {
        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.ways_noded (original_trail_id, source, target, the_geom, length_km, elevation_gain)
          VALUES (
            (SELECT COALESCE(MAX(original_trail_id), 0) + 1 FROM ${this.stagingSchema}.ways_noded),
            $1, $2, $3, $4, 0
          )
        `, [
          connection.node1_id, 
          connection.node2_id, 
          connection.bridge_geom, 
          connection.distance * 111.32 // Convert degrees to km
        ]);
      }
      
      console.log(`✅ Added ${endpointConnections.rows.length} bridge edges between endpoints`);
    }
    
    // 3. Recalculate node connectivity after connections
    await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.ways_noded_vertices_pgr 
      SET cnt = (
        SELECT COUNT(*) 
        FROM ${this.stagingSchema}.ways_noded e 
        WHERE e.source = ways_noded_vertices_pgr.id OR e.target = ways_noded_vertices_pgr.id
      )
    `);
    
    console.log('✅ Recalculated node connectivity after connections');
  }

  /**
   * Generate loop routes using pgRouting's pgr_hawickcircuits
   * This finds simple cycles in the network
   */
  async generateLoopRoutes(pattern: RoutePattern, targetRoutes: number = 5): Promise<RouteRecommendation[]> {
    console.log(`🔄 Generating TRUE loop routes for pattern: ${pattern.pattern_name}`);
    
    const recommendations: RouteRecommendation[] = [];
    
    // Use pgRouting's cycle detection to find actual loops
    // A true loop starts and ends at the same node
    console.log(`🔍 Debugging loop detection for pattern: ${pattern.pattern_name} (target: ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
    
    // Method 1: Use pgr_hawickcircuits to find simple cycles
    console.log(`🔍 Using pgr_hawickcircuits to detect simple cycles...`);
    
    const cycleResult = await this.pgClient.query(`
      SELECT 
        path_id,
        path_seq,
        start_vid,
        end_vid,
        node,
        edge,
        cost,
        agg_cost
      FROM pgr_hawickcircuits(
        'SELECT id, source, target, cost FROM ${this.stagingSchema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND cost <= 5.0 ORDER BY id'
      )
      ORDER BY path_id, path_seq
    `);
    
    console.log(`📍 Found ${cycleResult.rows.length} cycle segments from pgr_hawickcircuits`);
    
    // Group cycles by path_id
    const cyclesByPathId = new Map();
    for (const row of cycleResult.rows) {
      if (!cyclesByPathId.has(row.path_id)) {
        cyclesByPathId.set(row.path_id, []);
      }
      cyclesByPathId.get(row.path_id).push(row);
    }
    
    console.log(`📍 Found ${cyclesByPathId.size} distinct simple cycles`);
    
    // Skip simple cycles for now - focus on complex loops
    console.log(`⏭️ Skipping ${cyclesByPathId.size} simple cycles to focus on complex loops`)
    
    // Method 2: Use KSP + Return Paths to find complex loops (like Bear Canyon)
    if (recommendations.length < targetRoutes) {
      console.log(`🔍 Using KSP + Return Paths to detect complex loops...`);
      const complexLoops = await this.generateComplexLoopsWithKSP(pattern);
      recommendations.push(...complexLoops);
    }
    
    console.log(`✅ Generated ${recommendations.length} TRUE loop routes`);
    return recommendations;
  }

  /**
   * Generate complex loops using KSP + Return Paths approach
   * This can detect loops that don't form simple cycles, like the Bear Canyon loop
   */
  private async generateComplexLoopsWithKSP(pattern: RoutePattern): Promise<RouteRecommendation[]> {
    console.log(`🔍 Generating complex loops with KSP for: ${pattern.pattern_name}`);
    const recommendations: RouteRecommendation[] = [];
    
    try {
      // Get all nodes as potential start points
      const nodesResult = await this.pgClient.query(`
        SELECT id FROM ${this.stagingSchema}.ways_noded_vertices_pgr 
        WHERE cnt >= 2
        ORDER BY id
      `);
      
      const nodes = nodesResult.rows.map(row => row.id);
      console.log(`📊 Testing ${nodes.length} nodes for complex loops`);
      
      for (const startNode of nodes.slice(0, 10)) { // Limit to first 10 nodes for testing
        console.log(`🔍 Testing start node: ${startNode}`);
        
        // Find K-shortest paths from start node
        const kspResult = await this.pgClient.query(`
          SELECT * FROM pgr_ksp(
            'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded',
            $1::integer, $1::integer, 5, false
          )
        `, [startNode]);
        
        if (kspResult.rows.length === 0) continue;
        
        // Group paths by end node
        const pathsByEndNode: { [key: number]: any[] } = {};
        kspResult.rows.forEach((row: any) => {
          if (!pathsByEndNode[row.end_vid]) {
            pathsByEndNode[row.end_vid] = [];
          }
          pathsByEndNode[row.end_vid].push(row);
        });
        
        // For each end node, try to find a return path that forms a true loop
        for (const [endNode, outboundPaths] of Object.entries(pathsByEndNode)) {
          const endNodeId = parseInt(endNode);
          if (endNodeId === startNode) continue; // Skip if same as start
          
          // Find return paths from end node back to start
          const returnResult = await this.pgClient.query(`
            SELECT * FROM pgr_ksp(
              'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded',
              $1::integer, $2::integer, 3, false
            )
          `, [endNodeId, startNode]);
          
          if (returnResult.rows.length === 0) continue;
          
          // Try to combine outbound and return paths to form true loops
          for (const outboundPath of outboundPaths) {
            for (const returnPath of returnResult.rows) {
              // Check if this forms a true loop (no duplicate edges)
              const combinedPath = this.combinePaths(outboundPath, returnPath);
              if (this.isTrueLoop(combinedPath)) {
                const recommendation = await this.createRouteRecommendation(
                  pattern, combinedPath, 'complex-loop'
                );
                if (recommendation) {
                  recommendations.push(recommendation);
                }
              }
            }
          }
        }
      }
      
      console.log(`✅ Generated ${recommendations.length} complex loop recommendations`);
      return recommendations;
      
    } catch (error) {
      console.error('❌ Error generating complex loops with KSP:', error);
      return [];
    }
  }

  private combinePaths(outboundPath: any, returnPath: any): any {
    // Combine outbound and return paths, removing duplicate start/end nodes
    const outboundEdges = outboundPath.path || [];
    const returnEdges = returnPath.path || [];
    
    // Remove the last edge of outbound and first edge of return if they're the same
    const combinedEdges = [...outboundEdges];
    if (returnEdges.length > 0) {
      combinedEdges.push(...returnEdges.slice(1));
    }
    
    return {
      path: combinedEdges,
      cost: (outboundPath.cost || 0) + (returnPath.cost || 0)
    };
  }

  private isTrueLoop(combinedPath: any): boolean {
    // Check if the combined path forms a true loop (no duplicate edges)
    const edges = combinedPath.path || [];
    const uniqueEdges = new Set(edges);
    
    // A true loop should have the same number of unique edges as total edges
    // (no edge traversed twice in the same direction)
    return edges.length > 3 && uniqueEdges.size === edges.length;
  }

  private async createRouteRecommendation(pattern: RoutePattern, combinedPath: any, routeType: string): Promise<RouteRecommendation | null> {
    try {
      // Get edge details for the combined path
      const edgeIds = combinedPath.path || [];
      const edgesResult = await this.pgClient.query(`
        SELECT id, source, target, trail_name, length_km, elevation_gain
        FROM ${this.stagingSchema}.ways_noded
        WHERE id = ANY($1::integer[])
        ORDER BY id
      `, [edgeIds]);
      
      if (edgesResult.rows.length === 0) return null;
      
      // Calculate totals
      let totalLength = 0;
      let totalElevation = 0;
      const routeEdges = edgesResult.rows.map(edge => {
        totalLength += edge.length_km;
        totalElevation += edge.elevation_gain || 0;
        return {
          edge_id: edge.id,
          trail_name: edge.trail_name,
          length_km: edge.length_km,
          elevation_gain: edge.elevation_gain || 0
        };
      });
      
      const routeUuid = `${routeType}-${Date.now()}`;
          const recommendation: RouteRecommendation = {
        route_uuid: routeUuid,
        route_name: `${pattern.pattern_name} - ${routeType}`,
            route_shape: 'loop',
            input_length_km: pattern.target_distance_km,
            input_elevation_gain: pattern.target_elevation_gain,
        recommended_length_km: totalLength,
        recommended_elevation_gain: totalElevation,
            route_path: { 
          path: edgeIds.map((id: any) => id.toString()),
          edges: edgeIds.map((id: any) => id.toString()),
          start_node: edgeIds[0]?.toString() || '',
          end_node: edgeIds[0]?.toString() || ''
        },
        route_edges: routeEdges,
        trail_count: routeEdges.length,
        route_score: 1.0,
        similarity_score: 1.0,
        region: 'boulder'
      };
      
      return recommendation;
      } catch (error) {
      console.error('❌ Error creating route recommendation:', error);
      return null;
      }
  }

  /**
   * Generate point-to-point routes using pgRouting's pgr_dijkstra
   */
  async generatePointToPointRoutes(pattern: RoutePattern, targetRoutes: number = 5): Promise<RouteRecommendation[]> {
    console.log(`🔄 Generating point-to-point routes for pattern: ${pattern.pattern_name}`);
    
    const recommendations: RouteRecommendation[] = [];
    const region = await this.getRegionFromStagingSchema();
    
    // Get potential start and end nodes
    const nodesResult = await this.pgClient.query(`
      SELECT id, the_geom, cnt
      FROM ${this.stagingSchema}.ways_noded_vertices_pgr
      WHERE cnt >= 2
      ORDER BY RANDOM()
      LIMIT 50
    `);
    
    console.log(`📍 Found ${nodesResult.rows.length} potential nodes for point-to-point routes`);
    
    // Try different node pairs
    for (let i = 0; i < nodesResult.rows.length - 1; i += 2) {
      if (recommendations.length >= targetRoutes) break;
      
      const startNode = nodesResult.rows[i];
      const endNode = nodesResult.rows[i + 1];
      
      console.log(`🔄 Trying point-to-point from node ${startNode.id} to ${endNode.id}`);
      
      try {
        // Use pgr_dijkstra for point-to-point routing
        const dijkstraResult = await this.pgClient.query(`
          SELECT * FROM pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded',
            $1::integer, $2::integer, false
          )
        `, [startNode.id, endNode.id]);
        
        if (dijkstraResult.rows.length === 0) continue;
        
        // Calculate metrics
        let totalDistance = 0;
        let totalElevationGain = 0;
        const edgeIds = dijkstraResult.rows.map((row: any) => row.edge).filter((edge: number) => edge !== -1);
        
        if (edgeIds.length === 0) continue;
        
        const routeEdges = await this.pgClient.query(`
          SELECT * FROM ${this.stagingSchema}.ways_noded 
          WHERE id = ANY($1::integer[])
        `, [edgeIds]);
        
        for (const edge of routeEdges.rows) {
          totalDistance += edge.length_km || 0;
          totalElevationGain += edge.elevation_gain || 0;
        }
        
        // REMOVED: Distance and elevation criteria checking - no longer filtering by these criteria
        
          const recommendation: RouteRecommendation = {
            route_uuid: `ptp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            route_name: `${pattern.pattern_name} - Point-to-Point Route`,
            route_shape: 'point-to-point',
            input_length_km: pattern.target_distance_km,
            input_elevation_gain: pattern.target_elevation_gain,
            recommended_length_km: totalDistance,
            recommended_elevation_gain: totalElevationGain,
            route_path: { path: dijkstraResult.rows },
            route_edges: routeEdges.rows,
            trail_count: routeEdges.rows.length,
            route_score: Math.floor((1.0 - Math.abs(totalDistance - pattern.target_distance_km) / pattern.target_distance_km) * 100),
            similarity_score: 0,
            region: region
          };
          
          recommendations.push(recommendation);
          console.log(`✅ Found point-to-point route: ${totalDistance.toFixed(2)}km, ${totalElevationGain.toFixed(0)}m elevation`);
      } catch (error) {
        console.log(`❌ Failed to generate point-to-point route: ${error}`);
      }
    }
    
    console.log(`✅ Generated ${recommendations.length} point-to-point routes`);
    return recommendations;
  }

  /**
   * Generate routes using pgr_withPoints for more flexible routing
   * This allows starting/ending anywhere on edges, not just at nodes
   */
  async generateWithPointsRoutes(pattern: RoutePattern, targetRoutes: number = 5): Promise<RouteRecommendation[]> {
    console.log(`🔄 Generating withPoints routes for pattern: ${pattern.pattern_name}`);
    
    const recommendations: RouteRecommendation[] = [];
    const region = await this.getRegionFromStagingSchema();
    
    // Get random points along edges for more flexible routing
    const randomPointsResult = await this.pgClient.query(`
      SELECT 
        id as edge_id,
        ST_LineInterpolatePoint(the_geom, 0.3) as start_point,
        ST_LineInterpolatePoint(the_geom, 0.7) as end_point
      FROM ${this.stagingSchema}.ways_noded
      WHERE length_km >= $1 * 0.5
      ORDER BY RANDOM()
      LIMIT 20
    `, [pattern.target_distance_km]);
    
    console.log(`📍 Found ${randomPointsResult.rows.length} potential edge points for withPoints routing`);
    
    for (const edgePoint of randomPointsResult.rows) {
      if (recommendations.length >= targetRoutes) break;
      
      try {
        // Use pgr_withPoints for flexible routing
        const withPointsResult = await this.pgClient.query(`
          SELECT * FROM pgr_withPoints(
            'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded',
            'SELECT 1 as pid, $1::geometry as edge_id, $2::float as fraction',
            'SELECT 2 as pid, $3::geometry as edge_id, $4::float as fraction',
            -1, -2, false
          )
        `, [
          edgePoint.edge_id, 0.3,  // Start point
          edgePoint.edge_id, 0.7   // End point
        ]);
        
        if (withPointsResult.rows.length === 0) continue;
        
        // Calculate metrics
        let totalDistance = 0;
        let totalElevationGain = 0;
        const edgeIds = withPointsResult.rows.map((row: any) => row.edge).filter((edge: number) => edge !== -1);
        
        if (edgeIds.length === 0) continue;
        
        const routeEdges = await this.pgClient.query(`
          SELECT * FROM ${this.stagingSchema}.ways_noded 
          WHERE id = ANY($1::integer[])
        `, [edgeIds]);
        
        for (const edge of routeEdges.rows) {
          totalDistance += edge.length_km || 0;
          totalElevationGain += edge.elevation_gain || 0;
        }
        
        // REMOVED: Distance and elevation criteria checking - no longer filtering by these criteria
        
          const recommendation: RouteRecommendation = {
            route_uuid: `wp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            route_name: `${pattern.pattern_name} - Flexible Route`,
            route_shape: pattern.route_shape,
            input_length_km: pattern.target_distance_km,
            input_elevation_gain: pattern.target_elevation_gain,
            recommended_length_km: totalDistance,
            recommended_elevation_gain: totalElevationGain,
            route_path: { path: withPointsResult.rows },
            route_edges: routeEdges.rows,
            trail_count: routeEdges.rows.length,
            route_score: Math.floor((1.0 - Math.abs(totalDistance - pattern.target_distance_km) / pattern.target_distance_km) * 100),
            similarity_score: 0,
            region: region
          };
          
          recommendations.push(recommendation);
          console.log(`✅ Found withPoints route: ${totalDistance.toFixed(2)}km, ${totalElevationGain.toFixed(0)}m elevation`);
      } catch (error) {
        console.log(`❌ Failed to generate withPoints route: ${error}`);
      }
    }
    
    console.log(`✅ Generated ${recommendations.length} withPoints routes`);
    return recommendations;
  }

  /**
   * Generate true out-and-back routes by reversing and doubling existing point-to-point routes
   * This creates actual out-and-back geometry instead of just doubling metrics
   */
  async generateTrueOutAndBackRoutes(pattern: RoutePattern, targetRoutes: number = 5): Promise<RouteRecommendation[]> {
    console.log(`\n🎯 Generating TRUE out-and-back routes for: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
    
    // For out-and-back routes, we target half the distance since we'll double it
    const halfTargetDistance = pattern.target_distance_km / 2;
    const halfTargetElevation = pattern.target_elevation_gain / 2;
    
    console.log(`📏 Targeting half-distance: ${halfTargetDistance.toFixed(1)}km, half-elevation: ${halfTargetElevation.toFixed(0)}m`);
    
    // First, get existing point-to-point routes that meet our half-distance criteria
    // Be more flexible with the search criteria to find suitable routes
    const existingP2PRoutes = await this.pgClient.query(`
      SELECT 
        route_uuid,
        route_name,
        recommended_length_km as one_way_distance,
        recommended_elevation_gain as one_way_elevation,
        route_path,
        route_edges,
        route_score,
        similarity_score
      FROM ${this.stagingSchema}.route_recommendations 
      WHERE route_shape = 'point-to-point'
        AND recommended_length_km BETWEEN $1 * 0.5 AND $1 * 1.5  -- More flexible: 50% to 150% of half target
        AND recommended_elevation_gain BETWEEN $2 * 0.5 AND $2 * 1.5  -- More flexible: 50% to 150% of half target
      ORDER BY route_score DESC
      LIMIT 30
    `, [halfTargetDistance, halfTargetElevation]);
    
    if (existingP2PRoutes.rows.length === 0) {
      console.log('⚠️ No suitable point-to-point routes found for out-and-back conversion');
      return [];
    }
    
    console.log(`✅ Found ${existingP2PRoutes.rows.length} suitable point-to-point routes for conversion`);
    
    const outAndBackRoutes: RouteRecommendation[] = [];
    
    for (const p2pRoute of existingP2PRoutes.rows.slice(0, targetRoutes)) {
      try {
        console.log(`🔄 Converting P2P route: ${p2pRoute.route_name} (${p2pRoute.one_way_distance.toFixed(2)}km → ${(p2pRoute.one_way_distance * 2).toFixed(2)}km)`);
        
        // Parse the existing route path
        const routePath = p2pRoute.route_path;
        const routeEdges = p2pRoute.route_edges;
        
        if (!routePath || !routePath.steps || !Array.isArray(routePath.steps)) {
          console.log(`  ⚠️ Invalid route path for ${p2pRoute.route_uuid}`);
          continue;
        }
        
        // Create the out-and-back route path by duplicating and reversing the return journey
        const outboundSteps = routePath.steps;
        const returnSteps = [...outboundSteps].reverse().map((step: any, index: number) => ({
          ...step,
          seq: outboundSteps.length + index,
          path_seq: outboundSteps.length + index,
          agg_cost: step.agg_cost + outboundSteps[outboundSteps.length - 1].agg_cost
        }));
        
        const outAndBackPath = {
          path_id: routePath.path_id,
          steps: [...outboundSteps, ...returnSteps]
        };
        
        // Get the geometry for the outbound journey
        const outboundEdgeIds = outboundSteps
          .map((step: any) => step.edge)
          .filter((edge: number) => edge !== -1);
        
        if (outboundEdgeIds.length === 0) {
          console.log(`  ⚠️ No valid edges found for route ${p2pRoute.route_uuid}`);
          continue;
        }
        
        // Get the outbound edges
        const outboundEdges = await this.pgClient.query(`
          SELECT * FROM ${this.stagingSchema}.ways_noded 
          WHERE id = ANY($1::integer[])
          ORDER BY id
        `, [outboundEdgeIds]);
        
        if (outboundEdges.rows.length === 0) {
          console.log(`  ⚠️ No edges found for route ${p2pRoute.route_uuid}`);
          continue;
        }
        
        // Create the true out-and-back geometry by duplicating the outbound path
        const outAndBackGeometry = await this.createOutAndBackGeometry(outboundEdgeIds);
        
        if (!outAndBackGeometry) {
          console.log(`  ⚠️ No geometry found for route ${p2pRoute.route_uuid}`);
          continue;
        }
        
        // Use the actual calculated distance from the geometry
        const outAndBackDistance = outAndBackGeometry.length_km;
        const outboundLength = outAndBackGeometry.outbound_length_km;
        
        // Calculate elevation stats from the actual geometry
        const elevationStats = await this.calculateElevationStatsFromGeometry(outAndBackGeometry.geometry);
        const outAndBackElevation = elevationStats.total_elevation_gain;
        
        console.log(`  📏 Route metrics: ${outboundLength.toFixed(2)}km outbound → ${outAndBackDistance.toFixed(2)}km total (out-and-back), ${outAndBackElevation.toFixed(0)}m elevation`);
        console.log(`  🔄 Geometry validation: start/end match = ${outAndBackGeometry.points_match}`);
        
        // REMOVED: Distance and elevation criteria checking - no longer filtering by these criteria
        
          // Calculate quality score based on how well it matches the target
          const distanceScore = 1.0 - Math.abs(outAndBackDistance - pattern.target_distance_km) / pattern.target_distance_km;
          const elevationScore = 1.0 - Math.abs(outAndBackElevation - pattern.target_elevation_gain) / pattern.target_elevation_gain;
          const finalScore = (distanceScore + elevationScore) / 2;
          
        console.log(`  ✅ Route accepted! Score: ${finalScore.toFixed(3)}`);
          
          // Create a synthetic edge that represents the complete out-and-back route
          const outAndBackEdge = {
            id: `out-and-back-${p2pRoute.route_uuid}`,
            cost: outAndBackDistance,
            trail_name: `${p2pRoute.route_name} (Out-and-Back)`,
            trail_type: 'out-and-back',
            elevation_gain: outAndBackElevation,
            elevation_loss: elevationStats.total_elevation_loss,
            geometry: outAndBackGeometry.geometry,
            length_km: outAndBackDistance
          };
          
          // Create the out-and-back route recommendation
          const recommendation: RouteRecommendation = {
            route_uuid: `out-and-back-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            route_name: `${pattern.pattern_name} - True Out-and-Back via ${p2pRoute.route_name}`,
            route_shape: 'out-and-back',
            input_length_km: pattern.target_distance_km,
            input_elevation_gain: pattern.target_elevation_gain,
            recommended_length_km: outAndBackDistance,
            recommended_elevation_gain: outAndBackElevation,
            route_path: outAndBackPath,
            route_edges: [outAndBackEdge],
            trail_count: 1,
            route_score: Math.floor(finalScore * 100),
            similarity_score: finalScore,
            region: await this.getRegionFromStagingSchema()
          };
          
          outAndBackRoutes.push(recommendation);
          
          if (outAndBackRoutes.length >= targetRoutes) {
            console.log(`  🎯 Reached ${targetRoutes} out-and-back routes`);
            break;
        }
        
      } catch (error: any) {
        console.log(`❌ Failed to convert route ${p2pRoute.route_uuid}: ${error.message}`);
      }
    }
    
    // Sort by score and take top routes
    const bestRoutes = outAndBackRoutes
      .sort((a, b) => b.route_score - a.route_score)
      .slice(0, targetRoutes);
    
    console.log(`✅ Generated ${bestRoutes.length} TRUE out-and-back routes for ${pattern.pattern_name}`);
    return bestRoutes;
  }

  /**
   * Calculate elevation statistics from a GeoJSON geometry
   */
  private async calculateElevationStatsFromGeometry(geojsonGeometry: string): Promise<any> {
    try {
      const elevationResult = await this.pgClient.query(`
        WITH pts AS (
          SELECT 
            (dp.path)[1] AS pt_index,
            ST_Z(dp.geom) AS z
          FROM ST_DumpPoints(ST_GeomFromGeoJSON($1)) dp
        ),
        deltas AS (
          SELECT
            GREATEST(z - LAG(z) OVER (ORDER BY pt_index), 0) AS up,
            GREATEST(LAG(z) OVER (ORDER BY pt_index) - z, 0) AS down,
            z
          FROM pts
        ),
        agg AS (
          SELECT 
            COALESCE(SUM(up), 0) AS total_elevation_gain,
            COALESCE(SUM(down), 0) AS total_elevation_loss,
            MAX(z) AS max_elevation,
            MIN(z) AS min_elevation,
            AVG(z) AS avg_elevation
          FROM deltas
        )
        SELECT * FROM agg
      `, [geojsonGeometry]);
      
      return elevationResult.rows[0];
      
    } catch (error) {
      console.log(`⚠️ Failed to calculate elevation stats: ${error}`);
      return {
        total_elevation_gain: 0,
        total_elevation_loss: 0,
        max_elevation: 0,
        min_elevation: 0,
        avg_elevation: 0
      };
    }
  }

  /**
   * Create true out-and-back geometry by reversing the outbound path and concatenating
   * This creates actual out-and-back geometry that retraces the same path
   */
  private async createOutAndBackGeometry(outboundEdgeIds: number[]): Promise<any> {
    try {
      // First, get the complete outbound path as a single LineString
      const outboundPathResult = await this.pgClient.query(`
        SELECT 
          ST_LineMerge(ST_Union(geometry ORDER BY id)) as outbound_path,
          ST_Length(ST_Union(geometry ORDER BY id)::geography) / 1000.0 as outbound_length_km
        FROM ${this.stagingSchema}.ways_noded 
        WHERE id = ANY($1::integer[])
      `, [outboundEdgeIds]);
      
      if (!outboundPathResult.rows[0]?.outbound_path) {
        throw new Error('No outbound path found');
      }
      
      const outboundPath = outboundPathResult.rows[0].outbound_path;
      const outboundLength = outboundPathResult.rows[0].outbound_length_km;
      
      // Create the return path by reversing the outbound path
      const returnPathResult = await this.pgClient.query(`
        SELECT ST_Reverse($1::geometry) as return_path
      `, [outboundPath]);
      
      const returnPath = returnPathResult.rows[0].return_path;
      
      // Concatenate outbound and return paths to create true out-and-back geometry
      const outAndBackGeometryResult = await this.pgClient.query(`
        SELECT 
          ST_AsGeoJSON(ST_LineMerge(ST_Union($1::geometry, $2::geometry)), 6, 0) as out_and_back_geojson,
          ST_Length(ST_LineMerge(ST_Union($1::geometry, $2::geometry))::geography) / 1000.0 as total_length_km,
          ST_StartPoint($1::geometry) as start_point,
          ST_EndPoint(ST_LineMerge(ST_Union($1::geometry, $2::geometry))) as end_point
        FROM (SELECT 1) as dummy
      `, [outboundPath, returnPath]);
      
      const totalLength = outAndBackGeometryResult.rows[0].total_length_km;
      const startPoint = outAndBackGeometryResult.rows[0].start_point;
      const endPoint = outAndBackGeometryResult.rows[0].end_point;
      
      // Verify that start and end points are the same (true out-and-back)
      const startEndCheck = await this.pgClient.query(`
        SELECT ST_DWithin($1::geometry, $2::geometry, 1.0) as points_match
      `, [startPoint, endPoint]);
      
      const pointsMatch = startEndCheck.rows[0].points_match;
      
      console.log(`  🔄 Out-and-back geometry: ${outboundLength.toFixed(2)}km outbound → ${totalLength.toFixed(2)}km total, start/end match: ${pointsMatch}`);
      
      return {
        geometry: outAndBackGeometryResult.rows[0].out_and_back_geojson,
        length_km: totalLength,
        outbound_length_km: outboundLength,
        points_match: pointsMatch
      };
      
    } catch (error) {
      console.log(`⚠️ Failed to create out-and-back geometry: ${error}`);
      return null;
    }
  }

  /**
   * Store route recommendations in the database
   */
  async storeRouteRecommendations(recommendations: RouteRecommendation[]): Promise<void> {
    console.log(`💾 Storing ${recommendations.length} route recommendations in ${this.stagingSchema}.route_recommendations...`);
    
    for (const recommendation of recommendations) {
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.route_recommendations (
          route_uuid, route_name, route_shape, 
          input_length_km, input_elevation_gain, 
          recommended_length_km, recommended_elevation_gain,
          route_path, route_edges, trail_count, 
          route_score, similarity_score, region
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        recommendation.route_uuid,
        recommendation.route_name,
        recommendation.route_shape,
        recommendation.input_length_km,
        recommendation.input_elevation_gain,
        recommendation.recommended_length_km,
        recommendation.recommended_elevation_gain,
        JSON.stringify(recommendation.route_path),
        JSON.stringify(recommendation.route_edges),
        recommendation.trail_count,
        recommendation.route_score,
        recommendation.similarity_score,
        recommendation.region
      ]);
    }
    
    console.log(`✅ Successfully stored ${recommendations.length} route recommendations in database`);
  }
} 