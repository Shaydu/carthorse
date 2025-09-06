import { Pool } from 'pg';

export interface AlternativeLoopDetectionResult {
  success: boolean;
  loopsFound: number;
  routesGenerated: number;
  error?: string;
}

export interface LoopRoute {
  id: string;
  name: string;
  distanceKm: number;
  elevationGain: number;
  trailNames: string[];
  geometry: any;
}

export class AlternativeLoopDetectionService {
  private pgClient: Pool;
  private stagingSchema: string;
  private maxSearchDistance: number;
  private maxNetworkSize: number;

  constructor(config: {
    pgClient: Pool;
    stagingSchema: string;
    maxSearchDistance?: number;
    maxNetworkSize?: number;
  }) {
    this.pgClient = config.pgClient;
    this.stagingSchema = config.stagingSchema;
    this.maxSearchDistance = config.maxSearchDistance || 15.0; // Max 15km loops
    this.maxNetworkSize = config.maxNetworkSize || 3000; // Limit for when to use this service
  }

  /**
   * Alternative loop detection using targeted Dijkstra searches
   * This service is designed to work when Hawick Circuits fails due to memory issues
   */
  async detectLoopsAlternative(): Promise<AlternativeLoopDetectionResult> {
    try {
      console.log('🔄 Starting alternative loop detection (Dijkstra-based)...');
      
      // Step 1: Check if we should use this service
      const networkSize = await this.getNetworkSize();
      console.log(`📊 Network size: ${networkSize.nodes} nodes, ${networkSize.edges} edges`);
      
      if (networkSize.edges <= this.maxNetworkSize) {
        console.log(`✅ Network size is manageable (${networkSize.edges} edges <= ${this.maxNetworkSize} limit)`);
        console.log(`   Consider using Hawick Circuits for better loop detection`);
        return {
          success: true,
          loopsFound: 0,
          routesGenerated: 0,
          error: 'Network too small for alternative service - use Hawick Circuits'
        };
      }

      console.log(`⚠️ Large network detected (${networkSize.edges} edges > ${this.maxNetworkSize} limit)`);
      console.log(`   Using alternative loop detection to avoid memory issues`);

      // Step 2: Find high-degree nodes (good starting points for loops)
      const anchorNodes = await this.findAnchorNodes();
      console.log(`🎯 Found ${anchorNodes.length} anchor nodes for loop detection`);

      // Step 3: Generate loops using targeted Dijkstra searches
      const loops = await this.generateLoopsFromAnchors(anchorNodes);
      console.log(`🔄 Generated ${loops.length} potential loops`);

      // Step 4: Filter and validate loops
      const validLoops = await this.validateLoops(loops);
      console.log(`✅ Validated ${validLoops.length} valid loops`);

      return {
        success: true,
        loopsFound: validLoops.length,
        routesGenerated: validLoops.length
      };

    } catch (error) {
      console.error('❌ Error in alternative loop detection:', error);
      return {
        success: false,
        loopsFound: 0,
        routesGenerated: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get current network size
   */
  private async getNetworkSize(): Promise<{ nodes: number; edges: number }> {
    const result = await this.pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${this.stagingSchema}.routing_nodes) as nodes,
        (SELECT COUNT(*) FROM ${this.stagingSchema}.routing_edges) as edges
    `);
    
    return {
      nodes: parseInt(result.rows[0].nodes),
      edges: parseInt(result.rows[0].edges)
    };
  }

  /**
   * Find high-degree nodes that are good starting points for loop detection
   */
  private async findAnchorNodes(): Promise<Array<{ nodeId: number; degree: number; lat: number; lng: number }>> {
    const result = await this.pgClient.query(`
      WITH node_degrees AS (
        SELECT 
          n.id as node_id,
          n.lat,
          n.lng,
          COUNT(e.id) as degree
        FROM ${this.stagingSchema}.routing_nodes n
        LEFT JOIN ${this.stagingSchema}.routing_edges e ON (e.from_node_id = n.id OR e.to_node_id = n.id)
        GROUP BY n.id, n.lat, n.lng
        HAVING COUNT(e.id) >= 3  -- At least 3 connections for loop potential
      )
      SELECT node_id, degree, lat, lng
      FROM node_degrees
      ORDER BY degree DESC
      LIMIT 15  -- Top 15 anchor nodes (reduced for performance)
    `);

    return result.rows.map(row => ({
      nodeId: parseInt(row.node_id),
      degree: parseInt(row.degree),
      lat: parseFloat(row.lat),
      lng: parseFloat(row.lng)
    }));
  }

  /**
   * Generate loops using targeted Dijkstra searches from anchor nodes
   */
  private async generateLoopsFromAnchors(anchorNodes: Array<{ nodeId: number; degree: number; lat: number; lng: number }>): Promise<LoopRoute[]> {
    const loops: LoopRoute[] = [];

    for (const anchor of anchorNodes) {
      console.log(`🎯 Processing anchor node ${anchor.nodeId} (degree: ${anchor.degree})`);
      
      // Find nearby nodes within reasonable distance
      const nearbyNodes = await this.findNearbyNodes(anchor.nodeId, this.maxSearchDistance / 2);
      
      // Try to create loops from this anchor to nearby nodes
      for (const target of nearbyNodes.slice(0, 5)) { // Limit to top 5 nearby nodes
        if (target.nodeId === anchor.nodeId) continue;
        
        // Use Dijkstra to find path from anchor to target
        const path = await this.findPath(anchor.nodeId, target.nodeId);
        
        if (path && path.length > 0) {
          // Try to find return path to create a loop
          const returnPath = await this.findPath(target.nodeId, anchor.nodeId);
          
          if (returnPath && returnPath.length > 0) {
            // Combine paths to create a loop
            const loop = await this.createLoopFromPaths(anchor.nodeId, target.nodeId, path, returnPath);
            if (loop) {
              loops.push(loop);
            }
          }
        }
      }
    }

    return loops;
  }

  /**
   * Find nodes within a certain distance of an anchor node
   */
  private async findNearbyNodes(anchorNodeId: number, maxDistanceKm: number): Promise<Array<{ nodeId: number; distance: number }>> {
    const result = await this.pgClient.query(`
      WITH anchor AS (
        SELECT lat, lng FROM ${this.stagingSchema}.routing_nodes WHERE id = $1
      )
      SELECT 
        n.id as node_id,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(anchor.lng, anchor.lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)::geography
        ) / 1000 as distance_km
      FROM ${this.stagingSchema}.routing_nodes n, anchor
      WHERE n.id != $1
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(anchor.lng, anchor.lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)::geography,
          $2 * 1000
        )
      ORDER BY distance_km
      LIMIT 8  -- Limit nearby nodes to prevent explosion
    `, [anchorNodeId, maxDistanceKm]);

    return result.rows.map(row => ({
      nodeId: parseInt(row.node_id),
      distance: parseFloat(row.distance_km)
    }));
  }

  /**
   * Find path between two nodes using Dijkstra
   */
  private async findPath(startNodeId: number, endNodeId: number): Promise<Array<{ edgeId: number; nodeId: number }> | null> {
    try {
      const result = await this.pgClient.query(`
        SELECT 
          edge,
          node,
          cost
        FROM pgr_dijkstra(
          'SELECT id, from_node_id as source, to_node_id as target, length_km as cost 
           FROM ${this.stagingSchema}.routing_edges
           WHERE length_km <= $3',
          $1, $2, false
        )
        WHERE edge != -1
        ORDER BY seq
        LIMIT 50  -- Limit path length to prevent very long paths
      `, [startNodeId, endNodeId, this.maxSearchDistance]);

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows.map(row => ({
        edgeId: parseInt(row.edge),
        nodeId: parseInt(row.node)
      }));

    } catch (error) {
      console.log(`   ⚠️ No path found from ${startNodeId} to ${endNodeId}`);
      return null;
    }
  }

  /**
   * Create a loop route from two paths
   */
  private async createLoopFromPaths(
    startNodeId: number, 
    midNodeId: number, 
    path1: Array<{ edgeId: number; nodeId: number }>, 
    path2: Array<{ edgeId: number; nodeId: number }>
  ): Promise<LoopRoute | null> {
    try {
      // Combine the paths (path1 + path2 without duplicating the middle node)
      const allEdges = [
        ...path1.map(p => p.edgeId),
        ...path2.slice(1).map(p => p.edgeId) // Skip first edge of path2 to avoid duplication
      ];

      // Get edge details
      const edgeDetails = await this.pgClient.query(`
        SELECT 
          id,
          trail_name,
          length_km,
          elevation_gain,
          geometry
        FROM ${this.stagingSchema}.routing_edges
        WHERE id = ANY($1)
        ORDER BY array_position($1, id)
      `, [allEdges]);

      if (edgeDetails.rows.length === 0) {
        return null;
      }

      // Calculate totals
      const totalDistance = edgeDetails.rows.reduce((sum, edge) => sum + (parseFloat(edge.length_km) || 0), 0);
      const totalElevationGain = edgeDetails.rows.reduce((sum, edge) => sum + (parseFloat(edge.elevation_gain) || 0), 0);
      
      // Get unique trail names
      const trailNames = [...new Set(edgeDetails.rows.map(edge => edge.trail_name).filter(name => name))];

      // Create geometry by combining edge geometries
      const geometryResult = await this.pgClient.query(`
        SELECT ST_LineMerge(ST_Collect(geometry)) as combined_geometry
        FROM ${this.stagingSchema}.routing_edges
        WHERE id = ANY($1)
      `, [allEdges]);

      if (totalDistance < 1.0 || totalDistance > this.maxSearchDistance) {
        return null; // Filter out too short or too long loops
      }

      return {
        id: `alt_loop_${startNodeId}_${midNodeId}_${Date.now()}`,
        name: `Alternative Loop via ${trailNames.slice(0, 2).join(' + ')}`,
        distanceKm: totalDistance,
        elevationGain: totalElevationGain,
        trailNames,
        geometry: geometryResult.rows[0]?.combined_geometry
      };

    } catch (error) {
      console.log(`   ⚠️ Could not create loop from paths: ${error}`);
      return null;
    }
  }

  /**
   * Validate and filter loops
   */
  private async validateLoops(loops: LoopRoute[]): Promise<LoopRoute[]> {
    return loops.filter(loop => {
      // Basic validation
      if (loop.distanceKm < 1.0 || loop.distanceKm > this.maxSearchDistance) {
        return false;
      }
      
      if (loop.trailNames.length < 2) {
        return false; // Need at least 2 different trails for a meaningful loop
      }
      
      return true;
    });
  }
}
