import { Pool } from 'pg';
import { RoutePattern } from '../ksp-route-generator';

export class RoutePatternSqlHelpers {
  constructor(private pgClient: Pool) {}

  /**
   * Load out-and-back route patterns
   */
  async loadOutAndBackPatterns(): Promise<RoutePattern[]> {
    console.log('📋 Loading out-and-back route patterns...');
    
    const patternsResult = await this.pgClient.query(`
      SELECT * FROM public.route_patterns 
      WHERE route_shape = 'out-and-back'
      ORDER BY target_distance_km
    `);
    
    const patterns: RoutePattern[] = patternsResult.rows;
    console.log(`✅ Loaded ${patterns.length} out-and-back route patterns`);
    
    console.log('🔍 Out-and-back patterns to process:');
    for (const pattern of patterns) {
      console.log(`  - ${pattern.pattern_name}: ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m elevation`);
    }

    if (patterns.length === 0) {
      throw new Error('No out-and-back patterns found');
    }

    return patterns;
  }

  /**
   * Get network entry points for routing
   */
  async getNetworkEntryPoints(stagingSchema: string): Promise<any[]> {
    const nodesResult = await this.pgClient.query(`
      SELECT nm.pg_id as id, nm.node_type, nm.connection_count, 
             ST_X(v.the_geom) as lon, 
             ST_Y(v.the_geom) as lat
      FROM ${stagingSchema}.node_mapping nm
      JOIN ${stagingSchema}.ways_noded_vertices_pgr v ON nm.pg_id = v.id
      WHERE nm.node_type IN ('intersection', 'simple_connection')
      AND nm.connection_count <= 4
      ORDER BY nm.connection_count ASC, nm.pg_id
      LIMIT 50
    `);
    
    return nodesResult.rows;
  }

  /**
   * Find reachable nodes from a starting point
   */
  async findReachableNodes(
    stagingSchema: string, 
    startNode: number, 
    maxDistance: number
  ): Promise<any[]> {
    const reachableNodes = await this.pgClient.query(`
      SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
      FROM pgr_dijkstra(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
        $1::bigint, 
        (SELECT array_agg(pg_id) FROM ${stagingSchema}.node_mapping WHERE node_type IN ('intersection', 'simple_connection')),
        false
      )
      WHERE agg_cost <= $2
      AND end_vid != $1
      ORDER BY agg_cost DESC
      LIMIT 10
    `, [startNode, maxDistance]);
    
    return reachableNodes.rows;
  }

  /**
   * Execute KSP routing between two nodes
   */
  async executeKspRouting(
    stagingSchema: string, 
    startNode: number, 
    endNode: number
  ): Promise<any[]> {
    const kspResult = await this.pgClient.query(`
      SELECT * FROM pgr_ksp(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
        $1::bigint, $2::bigint, 3, false, false
      )
    `, [startNode, endNode]);
    
    return kspResult.rows;
  }

  /**
   * Get route edges by IDs with UUID mapping for trail metadata
   */
  async getRouteEdges(stagingSchema: string, edgeIds: number[]): Promise<any[]> {
    const routeEdges = await this.pgClient.query(`
      SELECT 
        w.*,
        em.app_uuid,
        em.trail_name,
        em.length_km as trail_length_km,
        em.elevation_gain as trail_elevation_gain,
        t.trail_type,
        t.surface,
        t.difficulty,
        t.max_elevation,
        t.min_elevation,
        t.avg_elevation
      FROM ${stagingSchema}.ways_noded w
      JOIN ${stagingSchema}.edge_mapping em ON w.id = em.pg_id
      JOIN ${stagingSchema}.trails t ON em.app_uuid = t.app_uuid
      WHERE w.id = ANY($1::integer[])
      ORDER BY w.id
    `, [edgeIds]);
    
    return routeEdges.rows;
  }

  /**
   * Store route recommendation
   */
  async storeRouteRecommendation(
    stagingSchema: string, 
    recommendation: any
  ): Promise<void> {
    await this.pgClient.query(`
      INSERT INTO ${stagingSchema}.route_recommendations (
        route_uuid, route_name, route_type, route_shape,
        input_distance_km, input_elevation_gain,
        recommended_distance_km, recommended_elevation_gain,
        route_path, route_edges, trail_count, route_score,
        similarity_score, region, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
    `, [
      recommendation.route_uuid, recommendation.route_name, recommendation.route_type, recommendation.route_shape,
      recommendation.input_distance_km, recommendation.input_elevation_gain,
      recommendation.recommended_distance_km, recommendation.recommended_elevation_gain,
      JSON.stringify(recommendation.route_path), JSON.stringify(recommendation.route_edges),
      recommendation.trail_count, recommendation.route_score, recommendation.similarity_score, recommendation.region
    ]);
  }
} 