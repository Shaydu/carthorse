import { Pool } from 'pg';
import { RouteRecommendation } from '../ksp-route-generator';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';
import { RouteGeometryGeneratorService } from './route-geometry-generator-service';

export interface LollipopRouteGeneratorConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  minDistanceBetweenRoutes: number;
  maxLollipopDistance: number; // Maximum total distance for lollipop routes
  minLollipopDistance: number; // Minimum total distance for lollipop routes
  useTrailheadsOnly?: boolean;
  trailheadLocations?: Array<{name?: string, lat: number, lng: number, tolerance_meters?: number}>;
}

export interface LollipopRoute {
  route_uuid: string;
  route_name: string;
  route_shape: 'lollipop';
  trail_count: number;
  recommended_length_km: number;
  recommended_elevation_gain: number;
  route_edges: number[];
  outbound_edges: number[];
  loop_edges: number[];
  return_edges: number[];
  start_node: number;
  loop_start_node: number;
  loop_end_node: number;
}

export class LollipopRouteGeneratorService {
  private configLoader: RouteDiscoveryConfigLoader;
  private geometryGeneratorService: RouteGeometryGeneratorService;

  constructor(
    private pgClient: Pool,
    private config: LollipopRouteGeneratorConfig
  ) {
    this.configLoader = RouteDiscoveryConfigLoader.getInstance();
    this.geometryGeneratorService = new RouteGeometryGeneratorService(pgClient, { stagingSchema: config.stagingSchema });
  }

  /**
   * Generate lollipop routes by detecting out-and-back routes that end at loops
   */
  async generateLollipopRoutes(): Promise<RouteRecommendation[]> {
    console.log('🍭 Generating lollipop routes...');
    
    try {
      // Step 1: Find all loops in the network
      const loops = await this.findLoopsInNetwork();
      console.log(`🔍 Found ${loops.length} potential loops in the network`);
      
      if (loops.length === 0) {
        console.log('⚠️ No loops found in network, cannot generate lollipop routes');
        return [];
      }

      // Step 2: Find network entry points (trailheads or endpoints)
      const entryPoints = await this.getNetworkEntryPoints();
      console.log(`📍 Found ${entryPoints.length} network entry points`);

      if (entryPoints.length === 0) {
        console.log('⚠️ No entry points found, cannot generate lollipop routes');
        return [];
      }

      // Step 3: Generate lollipop routes by connecting entry points to loops
      const lollipopRoutes: RouteRecommendation[] = [];
      
      for (const loop of loops.slice(0, 10)) { // Limit to top 10 loops
        for (const entryPoint of entryPoints.slice(0, 5)) { // Limit to top 5 entry points per loop
          const lollipopRoute = await this.createLollipopRoute(entryPoint, loop);
          if (lollipopRoute) {
            lollipopRoutes.push(lollipopRoute);
            
            // Stop if we have enough routes
            if (lollipopRoutes.length >= this.config.targetRoutesPerPattern) {
              break;
            }
          }
        }
        
        if (lollipopRoutes.length >= this.config.targetRoutesPerPattern) {
          break;
        }
      }

      console.log(`✅ Generated ${lollipopRoutes.length} lollipop routes`);
      return lollipopRoutes;

    } catch (error) {
      console.error('❌ Error generating lollipop routes:', error);
      return [];
    }
  }

  /**
   * Find all loops in the network using pgRouting
   */
  private async findLoopsInNetwork(): Promise<Array<{loop_id: number, edges: number[], nodes: number[], distance: number, elevation_gain: number}>> {
    try {
      // Use pgr_hawickcircuits to find all cycles in the graph
      const result = await this.pgClient.query(`
        WITH cycles AS (
          SELECT 
            cycle_id,
            array_agg(edge_id ORDER BY path_seq) as edges,
            array_agg(node ORDER BY path_seq) as nodes,
            SUM(cost) as total_distance
          FROM pgr_hawickcircuits(
            'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded WHERE length_km IS NOT NULL'
          )
          GROUP BY cycle_id
        ),
        cycles_with_elevation AS (
          SELECT 
            c.cycle_id,
            c.edges,
            c.nodes,
            c.total_distance,
            COALESCE(SUM(w.elevation_gain), 0) as elevation_gain
          FROM cycles c
          LEFT JOIN ${this.config.stagingSchema}.ways_noded w ON w.id = ANY(c.edges)
          WHERE c.total_distance BETWEEN 1.0 AND 15.0  -- Filter reasonable loop sizes
          GROUP BY c.cycle_id, c.edges, c.nodes, c.total_distance
        )
        SELECT 
          cycle_id as loop_id,
          edges,
          nodes,
          total_distance as distance,
          elevation_gain
        FROM cycles_with_elevation
        ORDER BY total_distance DESC
        LIMIT 20
      `);

      return result.rows;
    } catch (error) {
      console.error('❌ Error finding loops:', error);
      return [];
    }
  }

  /**
   * Get network entry points (trailheads or endpoints)
   */
  private async getNetworkEntryPoints(): Promise<Array<{id: number, lng: number, lat: number, name?: string}>> {
    try {
      // Load trailhead configuration
      const routeDiscoveryConfig = this.configLoader.loadConfig();
      const trailheadConfig = routeDiscoveryConfig.trailheads;
      const shouldUseTrailheads = this.config.useTrailheadsOnly !== undefined ? this.config.useTrailheadsOnly : trailheadConfig.enabled;

      if (shouldUseTrailheads && this.config.trailheadLocations && this.config.trailheadLocations.length > 0) {
        // Use configured trailhead locations
        const trailheadNodes: Array<{id: number, lng: number, lat: number, name?: string}> = [];
        
        for (const trailhead of this.config.trailheadLocations) {
          const result = await this.pgClient.query(`
            SELECT 
              v.id,
              ST_X(v.the_geom) as lng,
              ST_Y(v.the_geom) as lat
            FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
            WHERE ST_DWithin(
              v.the_geom, 
              ST_SetSRID(ST_MakePoint($1, $2), 4326), 
              $3
            )
            ORDER BY ST_Distance(v.the_geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
            LIMIT 1
          `, [trailhead.lng, trailhead.lat, (trailhead.tolerance_meters || 50) / 111000]);

          if (result.rows.length > 0) {
            trailheadNodes.push({
              id: result.rows[0].id,
              lng: result.rows[0].lng,
              lat: result.rows[0].lat,
              name: trailhead.name
            });
          }
        }
        
        return trailheadNodes;
      } else {
        // Use all nodes with good connectivity as entry points
        const result = await this.pgClient.query(`
          SELECT 
            v.id,
            ST_X(v.the_geom) as lng,
            ST_Y(v.the_geom) as lat
          FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
          WHERE v.cnt >= 2  -- At least 2 connections
          ORDER BY v.cnt DESC
          LIMIT 10
        `);

        return result.rows;
      }
    } catch (error) {
      console.error('❌ Error getting network entry points:', error);
      return [];
    }
  }

  /**
   * Create a lollipop route by connecting an entry point to a loop
   */
  private async createLollipopRoute(
    entryPoint: {id: number, lng: number, lat: number, name?: string},
    loop: {loop_id: number, edges: number[], nodes: number[], distance: number, elevation_gain: number}
  ): Promise<RouteRecommendation | null> {
    try {
      // Find the best loop entry point (closest node in the loop to the entry point)
      const loopEntryNode = await this.findBestLoopEntryPoint(entryPoint.id, loop.nodes);
      if (!loopEntryNode) {
        return null;
      }

      // Find outbound path from entry point to loop
      const outboundPath = await this.findPathToLoop(entryPoint.id, loopEntryNode);
      if (!outboundPath) {
        return null;
      }

      // Find return path from loop back to entry point (different path if possible)
      const returnPath = await this.findReturnPathFromLoop(loopEntryNode, entryPoint.id, outboundPath.edges);
      if (!returnPath) {
        return null;
      }

      // Calculate total metrics
      const totalDistance = outboundPath.distance + loop.distance + returnPath.distance;
      const totalElevationGain = outboundPath.elevation_gain + loop.elevation_gain + returnPath.elevation_gain;
      const totalEdges = [...outboundPath.edges, ...loop.edges, ...returnPath.edges];

      // Check if the route meets our criteria
      if (totalDistance < this.config.minLollipopDistance || totalDistance > this.config.maxLollipopDistance) {
        return null;
      }

      // Generate route geometry using shared service
      const routeGeometry = await this.geometryGeneratorService.generateRouteGeometry(totalEdges);

      // Create route recommendation
      const route_uuid = `lollipop-${entryPoint.id}-${loop.loop_id}-${Date.now()}`;
      const route_name = this.generateLollipopRouteName(entryPoint, loop, totalDistance);

      return {
        route_uuid,
        route_name,
        route_type: 'lollipop',
        route_shape: 'lollipop',
        input_length_km: totalDistance,
        input_elevation_gain: totalElevationGain,
        trail_count: totalEdges.length,
        recommended_length_km: totalDistance,
        recommended_elevation_gain: totalElevationGain,
        route_edges: totalEdges,
        region: this.config.region,
        route_score: this.calculateLollipopScore(totalDistance, totalElevationGain, loop.distance),
        similarity_score: 0.8, // Good similarity for lollipop routes
        route_path: null,
        route_geometry: routeGeometry
      };

    } catch (error) {
      console.error('❌ Error creating lollipop route:', error);
      return null;
    }
  }

  /**
   * Find the best entry point into the loop (closest node)
   */
  private async findBestLoopEntryPoint(entryNodeId: number, loopNodes: number[]): Promise<number | null> {
    try {
      const result = await this.pgClient.query(`
        WITH distances AS (
          SELECT 
            loop_node,
            pgr_dijkstra(
              'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded WHERE length_km IS NOT NULL',
              $1, loop_node, false
            ) as path_info
          FROM unnest($2::int[]) as loop_node
        )
        SELECT 
          loop_node,
          (path_info).cost as distance
        FROM distances
        WHERE (path_info).cost IS NOT NULL
        ORDER BY (path_info).cost
        LIMIT 1
      `, [entryNodeId, loopNodes]);

      return result.rows.length > 0 ? result.rows[0].loop_node : null;
    } catch (error) {
      console.error('❌ Error finding loop entry point:', error);
      return null;
    }
  }

  /**
   * Find path from entry point to loop
   */
  private async findPathToLoop(entryNodeId: number, loopNodeId: number): Promise<{edges: number[], distance: number, elevation_gain: number} | null> {
    try {
      const result = await this.pgClient.query(`
        WITH path AS (
          SELECT * FROM pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded WHERE length_km IS NOT NULL',
            $1, $2, false
          )
        )
        SELECT 
          array_agg(edge ORDER BY seq) as edges,
          SUM(cost) as distance,
          COALESCE(SUM(w.elevation_gain), 0) as elevation_gain
        FROM path p
        LEFT JOIN ${this.config.stagingSchema}.ways_noded w ON w.id = p.edge
        WHERE p.edge IS NOT NULL
      `, [entryNodeId, loopNodeId]);

      if (result.rows.length > 0 && result.rows[0].edges) {
        return {
          edges: result.rows[0].edges,
          distance: result.rows[0].distance,
          elevation_gain: result.rows[0].elevation_gain
        };
      }
      return null;
    } catch (error) {
      console.error('❌ Error finding path to loop:', error);
      return null;
    }
  }

  /**
   * Find return path from loop back to entry point (avoiding outbound path)
   */
  private async findReturnPathFromLoop(
    loopNodeId: number, 
    entryNodeId: number, 
    outboundEdges: number[]
  ): Promise<{edges: number[], distance: number, elevation_gain: number} | null> {
    try {
      // Try to find a different return path by excluding outbound edges
      const result = await this.pgClient.query(`
        WITH path AS (
          SELECT * FROM pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded WHERE length_km IS NOT NULL AND id != ALL($3)',
            $1, $2, false
          )
        )
        SELECT 
          array_agg(edge ORDER BY seq) as edges,
          SUM(cost) as distance,
          COALESCE(SUM(w.elevation_gain), 0) as elevation_gain
        FROM path p
        LEFT JOIN ${this.config.stagingSchema}.ways_noded w ON w.id = p.edge
        WHERE p.edge IS NOT NULL
      `, [loopNodeId, entryNodeId, outboundEdges]);

      if (result.rows.length > 0 && result.rows[0].edges) {
        return {
          edges: result.rows[0].edges,
          distance: result.rows[0].distance,
          elevation_gain: result.rows[0].elevation_gain
        };
      }

      // Fallback: use any path back
      const fallbackResult = await this.pgClient.query(`
        WITH path AS (
          SELECT * FROM pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded WHERE length_km IS NOT NULL',
            $1, $2, false
          )
        )
        SELECT 
          array_agg(edge ORDER BY seq) as edges,
          SUM(cost) as distance,
          COALESCE(SUM(w.elevation_gain), 0) as elevation_gain
        FROM path p
        LEFT JOIN ${this.config.stagingSchema}.ways_noded w ON w.id = p.edge
        WHERE p.edge IS NOT NULL
      `, [loopNodeId, entryNodeId]);

      if (fallbackResult.rows.length > 0 && fallbackResult.rows[0].edges) {
        return {
          edges: fallbackResult.rows[0].edges,
          distance: fallbackResult.rows[0].distance,
          elevation_gain: fallbackResult.rows[0].elevation_gain
        };
      }

      return null;
    } catch (error) {
      console.error('❌ Error finding return path:', error);
      return null;
    }
  }

  /**
   * Generate a descriptive name for the lollipop route
   */
  private generateLollipopRouteName(
    entryPoint: {id: number, lng: number, lat: number, name?: string},
    loop: {loop_id: number, edges: number[], nodes: number[], distance: number, elevation_gain: number},
    totalDistance: number
  ): string {
    const entryName = entryPoint.name || `Trailhead ${entryPoint.id}`;
    const loopDistance = loop.distance.toFixed(1);
    const totalDistanceFormatted = totalDistance.toFixed(1);
    
    return `${entryName} to ${loopDistance}km Loop (${totalDistanceFormatted}km Lollipop)`;
  }

  /**
   * Calculate a score for the lollipop route quality
   */
  private calculateLollipopScore(totalDistance: number, totalElevationGain: number, loopDistance: number): number {
    // Prefer routes with good loop-to-total distance ratio and reasonable elevation
    const loopRatio = loopDistance / totalDistance;
    const elevationRate = totalElevationGain / totalDistance;
    
    // Score based on:
    // - Loop should be a good portion of the total route (0.3-0.7 is ideal)
    // - Reasonable elevation gain rate (50-200m/km is good)
    // - Total distance in good range
    
    let score = 0;
    
    // Loop ratio score (prefer 30-70% loop)
    if (loopRatio >= 0.3 && loopRatio <= 0.7) {
      score += 0.4;
    } else if (loopRatio >= 0.2 && loopRatio <= 0.8) {
      score += 0.2;
    }
    
    // Elevation rate score
    if (elevationRate >= 50 && elevationRate <= 200) {
      score += 0.3;
    } else if (elevationRate >= 30 && elevationRate <= 300) {
      score += 0.15;
    }
    
    // Distance score (prefer 5-15km total)
    if (totalDistance >= 5 && totalDistance <= 15) {
      score += 0.3;
    } else if (totalDistance >= 3 && totalDistance <= 20) {
      score += 0.15;
    }
    
    return Math.min(score, 1.0);
  }

  /**
   * Store lollipop route recommendations in the database
   */
  async storeLollipopRouteRecommendations(routes: RouteRecommendation[]): Promise<void> {
    console.log(`💾 Storing ${routes.length} lollipop route recommendations...`);
    
    try {
      for (const route of routes) {
        await this.pgClient.query(`
          INSERT INTO ${this.config.stagingSchema}.route_recommendations (
            route_uuid, route_name, route_shape, trail_count, 
            recommended_length_km, recommended_elevation_gain, route_edges,
            region, route_score, similarity_score
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (route_uuid) DO UPDATE SET
            route_name = EXCLUDED.route_name,
            route_shape = EXCLUDED.route_shape,
            trail_count = EXCLUDED.trail_count,
            recommended_length_km = EXCLUDED.recommended_length_km,
            recommended_elevation_gain = EXCLUDED.recommended_elevation_gain,
            route_edges = EXCLUDED.route_edges,
            route_score = EXCLUDED.route_score,
            similarity_score = EXCLUDED.similarity_score
        `, [
          route.route_uuid,
          route.route_name,
          route.route_shape,
          route.trail_count,
          route.recommended_length_km,
          route.recommended_elevation_gain,
          JSON.stringify(route.route_edges),
          route.region,
          route.route_score,
          route.similarity_score
        ]);
      }
      
      console.log(`✅ Stored ${routes.length} lollipop route recommendations`);
    } catch (error) {
      console.error('❌ Error storing lollipop route recommendations:', error);
      throw error;
    }
  }
}
