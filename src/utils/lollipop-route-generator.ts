import { Pool } from 'pg';
import { RouteRecommendation } from './ksp-route-generator';

export interface RoutePattern {
  pattern_name: string;
  route_shape: string;
  target_distance_km: number;
  target_elevation_gain: number;
  tolerance_percent: number;
}

export interface RouteEdge {
  edge_id: number;
  trail_name: string;
  length_km: number;
  elevation_gain: number;
}

export class LollipopRouteGenerator {
  private pgClient: Pool;
  private stagingSchema: string;

  constructor(pgClient: Pool, stagingSchema: string) {
    this.pgClient = pgClient;
    this.stagingSchema = stagingSchema;
  }

  /**
   * Main method to generate lollipop route recommendations
   * This service specializes in detecting complex loops that form "lollipop" patterns
   * (out-and-back with a loop at the end, or complex circuits)
   */
  async generateLollipopRoutes(patterns: RoutePattern[]): Promise<RouteRecommendation[]> {
    console.log('🍭 Generating lollipop route recommendations...');
    const allRecommendations: RouteRecommendation[] = [];

    for (const pattern of patterns) {
      console.log(`🎯 Processing lollipop pattern: ${pattern.pattern_name}`);
      console.log(`🔍 Pattern details: target_distance_km=${pattern.target_distance_km}, target_elevation_gain=${pattern.target_elevation_gain}, route_shape=${pattern.route_shape}`);
      
      if (pattern.route_shape === 'lollipop' || pattern.route_shape === 'loop') {
        const loopRoutes = await this.generateComplexLoopRoutes(pattern);
        allRecommendations.push(...loopRoutes);
      } else {
        console.log(`⚠️  Skipping pattern with route_shape: ${pattern.route_shape}`);
      }
    }

    console.log(`✅ Generated ${allRecommendations.length} lollipop route recommendations`);
    return allRecommendations;
  }

  /**
   * Generate complex loop routes that form lollipop patterns
   * This includes routes that traverse different trails to form complex circuits
   */
  private async generateComplexLoopRoutes(pattern: RoutePattern): Promise<RouteRecommendation[]> {
    console.log(`🔍 Generating complex loop routes for: ${pattern.pattern_name}`);
    const recommendations: RouteRecommendation[] = [];

    try {
      // Generate complex loops using KSP approach
      const kspRoutes = await this.generateComplexLoopsWithKSP(pattern);
      recommendations.push(...kspRoutes);

      // Generate other known complex loops
      const knownLoops = await this.generateKnownComplexLoops(pattern);
      recommendations.push(...knownLoops);

    } catch (error) {
      console.error('❌ Error generating complex loop routes:', error);
    }

    return recommendations;
  }

  /**
   * Generate complex loops using a better approach
   */
  private async generateComplexLoopsWithKSP(pattern: RoutePattern): Promise<RouteRecommendation[]> {
    console.log(`🔍 Generating complex loops for: ${pattern.pattern_name}`);
    const recommendations: RouteRecommendation[] = [];
    
    try {
      // Get nodes with geographic distribution for better coverage
      const nodesResult = await this.pgClient.query(`
        SELECT DISTINCT from_node_id as id, 
               COUNT(*) as connections,
               ST_X(ST_Centroid(ST_Union(geometry))) as lon,
               ST_Y(ST_Centroid(ST_Union(geometry))) as lat
        FROM ${this.stagingSchema}.routing_edges 
        GROUP BY from_node_id 
        HAVING COUNT(*) >= 2
        ORDER BY connections DESC, from_node_id
      `);
      
      const nodes = nodesResult.rows;
      console.log(`📊 Found ${nodes.length} nodes with multiple connections for loops`);
      
      // Create geographic clusters to ensure coverage across the area
      const clusters = this.createGeographicClusters(nodes, 5); // 5 clusters
      const testNodes = clusters.flat().slice(0, 50); // Test up to 50 nodes across clusters
      console.log(`🔍 Testing ${testNodes.length} nodes across ${clusters.length} geographic clusters for loops`);
      
      for (const startNodeData of testNodes) {
        const startNode = startNodeData.id;
        console.log(`🔍 Testing start node: ${startNode} at (${startNodeData.lon.toFixed(4)}, ${startNodeData.lat.toFixed(4)})`);
        
        // Find all connected nodes
        const connectedNodesResult = await this.pgClient.query(`
          SELECT DISTINCT to_node_id as node_id
          FROM ${this.stagingSchema}.routing_edges 
          WHERE from_node_id = $1 AND to_node_id != $1
          ORDER BY to_node_id
        `, [startNode]);
        
        for (const connectedNode of connectedNodesResult.rows) {
          const endNode = connectedNode.node_id;
          if (endNode === startNode) continue;
          
          // Find multiple paths from start to end node using K-Shortest Paths
          const outboundResult = await this.pgClient.query(`
            SELECT * FROM pgr_ksp(
              'SELECT id, from_node_id as source, to_node_id as target, length_km as cost FROM ${this.stagingSchema}.routing_edges',
              $1::integer, $2::integer, 3, false
            )
            ORDER BY cost
          `, [startNode, endNode]);
          
          if (outboundResult.rows.length === 0) continue;
          
          // Find multiple paths from end back to start using K-Shortest Paths
          const returnResult = await this.pgClient.query(`
            SELECT * FROM pgr_ksp(
              'SELECT id, from_node_id as source, to_node_id as target, length_km as cost FROM ${this.stagingSchema}.routing_edges',
              $1::integer, $2::integer, 3, false
            )
            ORDER BY cost
          `, [endNode, startNode]);
          
          if (returnResult.rows.length === 0) continue;
          
          // Group paths by path_id to get distinct paths
          const outboundPaths = this.groupPathsByPathId(outboundResult.rows);
          const returnPaths = this.groupPathsByPathId(returnResult.rows);
          
          // Try different combinations of outbound and return paths
          for (const outboundPath of outboundPaths) {
            for (const returnPath of returnPaths) {
              const outboundEdges = outboundPath.map((row: any) => row.edge).filter((edge: any) => edge !== -1);
              const returnEdges = returnPath.map((row: any) => row.edge).filter((edge: any) => edge !== -1);
              
              // Check if this forms a valid loop (different paths)
              const allEdges = [...outboundEdges, ...returnEdges];
              const uniqueEdges = new Set(allEdges);
              
              // Require at least 60% unique edges to ensure different paths
              const overlapRatio = 1 - (uniqueEdges.size / allEdges.length);
              
              if (allEdges.length > 4 && overlapRatio <= 0.4) {
                const outboundLength = outboundPath.reduce((sum: number, row: any) => sum + (row.cost || 0), 0);
                const returnLength = returnPath.reduce((sum: number, row: any) => sum + (row.cost || 0), 0);
                const totalLength = outboundLength + returnLength;
            
                            // Check if the loop meets the pattern requirements (more flexible)
                if (totalLength >= pattern.target_distance_km * 0.2 && totalLength <= pattern.target_distance_km * 4.0) {
                  const combinedPath = {
                    path: allEdges,
                    cost: totalLength
                  };
                  
                  const recommendation = await this.createRouteRecommendation(
                    pattern, combinedPath, 'complex-loop'
                  );
                  if (recommendation) {
                    recommendations.push(recommendation);
                    console.log(`✅ Found complex loop: ${totalLength.toFixed(2)}km from node ${startNode} to ${endNode} (${uniqueEdges.size}/${allEdges.length} unique edges)`);
                    
                    // Continue searching for more routes - no artificial limit
                  }
                }
              }
            }
            
            // Continue searching for more routes - no artificial limit
          }
        }
        
        // Continue searching for more routes - no artificial limit
      }
      
      console.log(`✅ Generated ${recommendations.length} complex loop recommendations`);
      return recommendations;
      
    } catch (error) {
      console.error('❌ Error generating complex loops:', error);
      return [];
    }
  }

  /**
   * Generate other known complex loops
   */
  private async generateKnownComplexLoops(pattern: RoutePattern): Promise<RouteRecommendation[]> {
    console.log(`🔍 Generating known complex loops for: ${pattern.pattern_name}`);
    const recommendations: RouteRecommendation[] = [];
    
    // Removed hardcoded Bear Canyon loop - letting natural algorithm find loops
    console.log(`🔍 Using natural loop detection for: ${pattern.pattern_name}`);
    
    return recommendations;
  }



  /**
   * Combine outbound and return paths
   */
  private combinePaths(outboundPath: any, returnPath: any): any {
    const outboundEdges = outboundPath.path || [];
    const returnEdges = returnPath.path || [];
    
    const combinedEdges = [...outboundEdges];
    if (returnEdges.length > 0) {
      combinedEdges.push(...returnEdges.slice(1));
    }
    
    return {
      path: combinedEdges,
      cost: (outboundPath.cost || 0) + (returnPath.cost || 0)
    };
  }

  /**
   * Check if the combined path forms a true loop
   */
  private isTrueLoop(combinedPath: any): boolean {
    const edges = combinedPath.path || [];
    const uniqueEdges = new Set(edges);
    
    // A true loop should have the same number of unique edges as total edges
    return edges.length > 3 && uniqueEdges.size === edges.length;
  }

  /**
   * Create a route recommendation from a combined path
   */
  private async createRouteRecommendation(pattern: RoutePattern, combinedPath: any, routeType: string): Promise<RouteRecommendation | null> {
    try {
      const edgeIds = combinedPath.path || [];
      const edgesResult = await this.pgClient.query(`
        SELECT id, source, target, trail_name, length_km, elevation_gain
        FROM ${this.stagingSchema}.ways_noded
        WHERE id = ANY($1::integer[])
        ORDER BY id
      `, [edgeIds]);
      
      if (edgesResult.rows.length === 0) return null;
      
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
      
      // Let the database generate a proper UUID automatically
      const routeUuid = undefined; // Will be generated by database
      const recommendation: RouteRecommendation = {
        route_name: `${pattern.pattern_name} - ${routeType}`,
        route_shape: 'lollipop',
        input_length_km: pattern.target_distance_km || 0,
        input_elevation_gain: pattern.target_elevation_gain || 0,
        recommended_length_km: totalLength,
        recommended_elevation_gain: totalElevation,
        route_path: await this.createRouteGeometry(edgeIds),
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
   * Group KSP results by path_id to get distinct paths
   */
  private groupPathsByPathId(rows: any[]): any[][] {
    const paths: { [key: number]: any[] } = {};
    
    for (const row of rows) {
      if (!paths[row.path_id]) {
        paths[row.path_id] = [];
      }
      paths[row.path_id].push(row);
    }
    
    return Object.values(paths);
  }

  /**
   * Create geographic clusters to ensure coverage across the area
   */
  private createGeographicClusters(nodes: any[], numClusters: number): any[][] {
    if (nodes.length <= numClusters) {
      return nodes.map(node => [node]);
    }

    // Simple k-means clustering based on longitude/latitude
    const clusters: any[][] = Array.from({ length: numClusters }, () => []);
    
    // Initialize cluster centers with evenly distributed nodes
    const step = Math.floor(nodes.length / numClusters);
    const centers = [];
    for (let i = 0; i < numClusters; i++) {
      const centerIndex = i * step;
      centers.push({
        lon: nodes[centerIndex].lon,
        lat: nodes[centerIndex].lat
      });
    }

    // Assign nodes to nearest cluster center
    for (const node of nodes) {
      let minDistance = Infinity;
      let bestCluster = 0;
      
      for (let i = 0; i < centers.length; i++) {
        const distance = Math.sqrt(
          Math.pow(node.lon - centers[i].lon, 2) + 
          Math.pow(node.lat - centers[i].lat, 2)
        );
        if (distance < minDistance) {
          minDistance = distance;
          bestCluster = i;
        }
      }
      
      clusters[bestCluster].push(node);
    }

    // Sort clusters by size (largest first) and take top nodes from each
    clusters.sort((a, b) => b.length - a.length);
    
    // Take up to 10 nodes from each cluster
    const result = clusters.map(cluster => cluster.slice(0, 10));
    
    console.log(`🗺️  Created ${clusters.length} geographic clusters: ${clusters.map(c => c.length).join(', ')} nodes each`);
    return result;
  }

  /**
   * Create GeoJSON geometry for a route from edge IDs
   */
  private async createRouteGeometry(edgeIds: number[]): Promise<any> {
    try {
      // Filter out invalid edge IDs
      const validEdgeIds = edgeIds.filter(id => id > 0);
      
      console.log(`🔧 Creating route geometry for edge IDs: ${edgeIds}, valid: ${validEdgeIds}`);
      
      if (validEdgeIds.length === 0) {
        console.log(`⚠️ No valid edge IDs found, returning empty geometry`);
        return {
          type: 'LineString',
          coordinates: []
        };
      }

      // Get the geometry for all edges in the route
      const geometryResult = await this.pgClient.query(`
        SELECT ST_AsGeoJSON(ST_Union(the_geom)) as route_geometry
        FROM ${this.stagingSchema}.ways_noded
        WHERE id = ANY($1::integer[])
      `, [validEdgeIds]);

      console.log(`🔧 Geometry query result: ${JSON.stringify(geometryResult.rows[0])}`);

      if (geometryResult.rows[0] && geometryResult.rows[0].route_geometry) {
        const geometry = JSON.parse(geometryResult.rows[0].route_geometry);
        console.log(`✅ Created route geometry: ${geometry.type} with ${geometry.coordinates?.length || 0} coordinates`);
        return geometry;
      }

      // Fallback to empty geometry
      console.log(`⚠️ No geometry found, returning empty geometry`);
      return {
        type: 'LineString',
        coordinates: []
      };
    } catch (error) {
      console.error('❌ Error creating route geometry:', error);
      return {
        type: 'LineString',
        coordinates: []
      };
    }
  }

  /**
   * Store route recommendations in the database
   */
  async storeRouteRecommendations(recommendations: RouteRecommendation[]): Promise<void> {
    console.log(`💾 Storing ${recommendations.length} lollipop route recommendations...`);
    
    try {
      for (const recommendation of recommendations) {
        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.route_recommendations (
            route_name, route_shape, input_length_km, input_elevation_gain,
            recommended_length_km, recommended_elevation_gain, route_path, route_edges,
            trail_count, route_score, similarity_score, region
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
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
      
      console.log(`✅ Successfully stored ${recommendations.length} lollipop route recommendations in database`);
    } catch (error) {
      console.error('❌ Error storing route recommendations:', error);
      throw error;
    }
  }
}
