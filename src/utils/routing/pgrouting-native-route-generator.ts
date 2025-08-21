import { Pool } from 'pg';
import { RouteRecommendation } from '../ksp-route-generator';

export interface PgRoutingNativeRouteGeneratorConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  minDistanceBetweenRoutes: number;
}

export class PgRoutingNativeRouteGenerator {
  constructor(
    private pgClient: Pool,
    private config: PgRoutingNativeRouteGeneratorConfig
  ) {}

  /**
   * Generate routes using pgRouting native functions with Layer 2 network
   */
  async generateRoutes(): Promise<RouteRecommendation[]> {
    console.log('🎯 Generating routes using pgRouting native functions with Layer 2 network...');
    
    // Ensure we have the pgRouting network ready
    await this.preparePgRoutingNetwork();
    
    // Generate routes using pgRouting functions
    const recommendations = await this.generateRoutesWithPgRouting();
    
    console.log(`✅ Generated ${recommendations.length} routes using pgRouting native functions`);
    return recommendations;
  }

  /**
   * Prepare the pgRouting network from Layer 2 data
   */
  private async preparePgRoutingNetwork(): Promise<void> {
    console.log('🔄 Using existing Layer 2 pgRouting network...');
    
    // Check if Layer 2 ways_noded table exists and has data
    const tableExists = await this.pgClient.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = '${this.config.stagingSchema}' 
        AND table_name = 'ways_noded'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      throw new Error('Layer 2 ways_noded table does not exist. Please run Layer 2 first.');
    }
    
    const hasData = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.ways_noded
    `);
    
    if (parseInt(hasData.rows[0].count) === 0) {
      throw new Error('Layer 2 ways_noded table is empty. Please run Layer 2 first.');
    }
    
    // Verify that ways_noded_vertices_pgr also exists
    const verticesExist = await this.pgClient.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = '${this.config.stagingSchema}' 
        AND table_name = 'ways_noded_vertices_pgr'
      )
    `);
    
    if (!verticesExist.rows[0].exists) {
      throw new Error('Layer 2 ways_noded_vertices_pgr table does not exist. Please run Layer 2 first.');
    }
    
    console.log('✅ Using existing Layer 2 pgRouting network with intersection-based connectivity');
  }

  /**
   * Generate routes using pgRouting native functions
   */
  private async generateRoutesWithPgRouting(): Promise<RouteRecommendation[]> {
    console.log('🔄 Generating routes with pgRouting native functions...');
    
    // Load route patterns
    const patterns = await this.loadRoutePatterns();
    const allRecommendations: RouteRecommendation[] = [];
    
    for (const pattern of patterns) {
      console.log(`🎯 Processing pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
      
      const patternRoutes = await this.generateRoutesForPattern(pattern);
      allRecommendations.push(...patternRoutes);
    }
    
    return allRecommendations;
  }

  /**
   * Load route patterns from the database
   */
  private async loadRoutePatterns(): Promise<any[]> {
    const result = await this.pgClient.query(`
      SELECT * FROM get_route_patterns()
      WHERE route_shape IN ('loop', 'out-and-back')
      ORDER BY target_distance_km
    `);
    return result.rows;
  }

  /**
   * Generate routes for a specific pattern using pgRouting
   */
  private async generateRoutesForPattern(pattern: any): Promise<RouteRecommendation[]> {
    const { target_distance_km, target_elevation_gain, tolerance_percent } = pattern;
    
    // Calculate tolerance ranges
    const minDistance = target_distance_km * (1 - tolerance_percent / 100);
    const maxDistance = target_distance_km * (1 + tolerance_percent / 100);
    const minElevation = target_elevation_gain * (1 - tolerance_percent / 100);
    const maxElevation = target_elevation_gain * (1 + tolerance_percent / 100);
    
    console.log(`📏 Distance range: ${minDistance.toFixed(1)}-${maxDistance.toFixed(1)}km`);
    console.log(`⛰️ Elevation range: ${minElevation.toFixed(0)}-${maxElevation.toFixed(0)}m`);
    
    // Generate routes using pgRouting functions
    const routes = await this.findRoutesWithPgRouting(
              minDistance, maxDistance, minElevation, maxElevation, pattern.route_shape
    );
    
    return routes;
  }

  /**
   * Find routes using pgRouting native functions
   */
  private async findRoutesWithPgRouting(
    minDistance: number, 
    maxDistance: number, 
    minElevation: number, 
    maxElevation: number,
    routeType: string
  ): Promise<RouteRecommendation[]> {
    
    if (routeType === 'loop') {
      return await this.findLoopRoutesWithPgRouting(minDistance, maxDistance, minElevation, maxElevation);
    } else {
      return await this.findOutAndBackRoutesWithPgRouting(minDistance, maxDistance, minElevation, maxElevation);
    }
  }

  /**
   * Find loop routes using pgRouting's hawickcircuits
   */
  private async findLoopRoutesWithPgRouting(
    minDistance: number, 
    maxDistance: number, 
    minElevation: number, 
    maxElevation: number
  ): Promise<RouteRecommendation[]> {
    console.log('🔄 Finding loop routes with pgRouting hawickcircuits...');
    
    const result = await this.pgClient.query(`
      WITH all_cycles AS (
        SELECT 
          path_id as cycle_id,
          edge as edge_id,
          cost,
          agg_cost,
          path_seq
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded'
        )
      ),
      cycle_metrics AS (
        SELECT 
          cycle_id,
          SUM(cost) as total_distance,
          COUNT(*) as edge_count,
          array_agg(edge_id ORDER BY path_seq) as edge_ids,
          array_agg(path_seq ORDER BY path_seq) as path_sequence
        FROM all_cycles
        GROUP BY cycle_id
      ),
      valid_loops AS (
        SELECT 
          cm.*,
          -- Calculate elevation gain from edge data
          COALESCE((
            SELECT SUM(ee.elevation_gain)
            FROM ${this.config.stagingSchema}.export_edges ee
            WHERE ee.id = ANY(cm.edge_ids)
          ), 0) as total_elevation_gain,
          -- Get trail names
          array_agg(DISTINCT ee.trail_name) as trail_names
        FROM cycle_metrics cm
        JOIN ${this.config.stagingSchema}.export_edges ee ON ee.id = ANY(cm.edge_ids)
        WHERE cm.total_distance >= $1  -- Minimum distance
          AND cm.total_distance <= $2  -- Maximum distance
          AND cm.edge_count >= 3  -- At least 3 edges for a meaningful loop
        GROUP BY cm.cycle_id, cm.total_distance, cm.edge_count, cm.edge_ids, cm.path_sequence
      )
      SELECT 
        gen_random_uuid()::text as route_id,
        total_distance,
        total_elevation_gain,
        edge_ids as route_edges,
        trail_names,
        'loop' as route_shape,
        array_length(trail_names, 1) as trail_count
      FROM valid_loops
      WHERE total_elevation_gain >= $3  -- Minimum elevation
        AND total_elevation_gain <= $4  -- Maximum elevation
      ORDER BY total_distance
      LIMIT 20
    `, [minDistance, maxDistance, minElevation, maxElevation]);
    
    return result.rows.map(row => this.convertToRouteRecommendation(row));
  }

  /**
   * Find out-and-back routes using pgRouting's ksp (K-Shortest Paths)
   */
  private async findOutAndBackRoutesWithPgRouting(
    minDistance: number, 
    maxDistance: number, 
    minElevation: number, 
    maxElevation: number
  ): Promise<RouteRecommendation[]> {
    console.log('🔄 Finding out-and-back routes with pgRouting ksp...');
    
    // Get potential start/end nodes (nodes with multiple connections)
    const nodesResult = await this.pgClient.query(`
      SELECT id FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
      WHERE cnt >= 2
      ORDER BY RANDOM()
      LIMIT 10
    `);
    
    const recommendations: RouteRecommendation[] = [];
    
    for (const node of nodesResult.rows) {
      const routes = await this.findKspRoutesFromNode(node.id, minDistance, maxDistance, minElevation, maxElevation);
      recommendations.push(...routes);
    }
    
    return recommendations;
  }

  /**
   * Find K-Shortest Paths from a specific node
   */
  private async findKspRoutesFromNode(
    startNode: number,
    minDistance: number, 
    maxDistance: number, 
    minElevation: number, 
    maxElevation: number
  ): Promise<RouteRecommendation[]> {
    
    const result = await this.pgClient.query(`
      WITH ksp_routes AS (
        SELECT 
          path_id,
          path_seq,
          node,
          edge,
          cost,
          agg_cost
        FROM pgr_ksp(
          'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded',
          $1, $1, 5, false
        )
      ),
      route_metrics AS (
        SELECT 
          path_id,
          SUM(cost) as total_distance,
          COUNT(*) as edge_count,
          array_agg(edge ORDER BY path_seq) as edge_ids,
          array_agg(node ORDER BY path_seq) as node_path
        FROM ksp_routes
        GROUP BY path_id
      ),
      valid_routes AS (
        SELECT 
          rm.*,
          -- Calculate elevation gain
          COALESCE((
            SELECT SUM(ee.elevation_gain)
            FROM ${this.config.stagingSchema}.export_edges ee
            WHERE ee.id = ANY(rm.edge_ids)
          ), 0) as total_elevation_gain,
          -- Get trail names
          array_agg(DISTINCT ee.trail_name) as trail_names
        FROM route_metrics rm
        JOIN ${this.config.stagingSchema}.export_edges ee ON ee.id = ANY(rm.edge_ids)
        WHERE rm.total_distance >= $2  -- Minimum distance
          AND rm.total_distance <= $3  -- Maximum distance
          AND rm.edge_count >= 2  -- At least 2 edges
        GROUP BY rm.path_id, rm.total_distance, rm.edge_count, rm.edge_ids, rm.node_path
      )
      SELECT 
        gen_random_uuid()::text as route_id,
        total_distance,
        total_elevation_gain,
        edge_ids as route_edges,
        node_path as route_path,
        trail_names,
        'out-and-back' as route_shape,
        array_length(trail_names, 1) as trail_count
      FROM valid_routes
      WHERE total_elevation_gain >= $4  -- Minimum elevation
        AND total_elevation_gain <= $5  -- Maximum elevation
      ORDER BY total_distance
      LIMIT 5
    `, [startNode, minDistance, maxDistance, minElevation, maxElevation]);
    
    return result.rows.map(row => this.convertToRouteRecommendation(row));
  }

  /**
   * Convert database row to RouteRecommendation
   */
  private convertToRouteRecommendation(row: any): RouteRecommendation {
    return {
      route_uuid: row.route_id,
      region: this.config.region,
      input_length_km: row.total_distance,
      input_elevation_gain: row.total_elevation_gain,
      recommended_length_km: row.total_distance,
      recommended_elevation_gain: row.total_elevation_gain,
      
      route_shape: row.route_shape,
      trail_count: row.trail_count,
      route_score: 100, // Default score
      similarity_score: 1.0, // Perfect match for now
      route_path: row.route_path || [],
      route_edges: row.route_edges || [],
      route_name: `${row.route_shape} - ${(row.trail_names || []).join(', ')}`,
      // Additional properties will be generated later
      constituent_trails: [],
      unique_trail_count: row.trail_count,
      total_trail_distance_km: row.total_distance,
      total_trail_elevation_gain_m: row.total_elevation_gain
    };
  }

  /**
   * Find your specific Bear Peak / Fern Canyon loop using pgRouting
   */
  async findBearPeakLoop(): Promise<any[]> {
    console.log('🔍 Looking for Bear Peak / Fern Canyon loop with pgRouting...');
    
    const result = await this.pgClient.query(`
      WITH bear_peak_edges AS (
        -- Find edges that are part of Bear Peak or Fern Canyon trails
        SELECT id, source, target, trail_name, length_km, elevation_gain
        FROM ${this.config.stagingSchema}.export_edges
        WHERE trail_name ILIKE '%bear peak%' 
           OR trail_name ILIKE '%fern canyon%'
           OR trail_name ILIKE '%bear canyon%'
           OR trail_name ILIKE '%mesa trail%'
      ),
      bear_peak_cycles AS (
        -- Find cycles that include Bear Peak and Fern Canyon edges
        SELECT 
          hc.path_id as cycle_id,
          hc.edge as edge_id,
          hc.cost,
          hc.agg_cost,
          hc.path_seq
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded'
        ) hc
        JOIN bear_peak_edges bpe ON hc.edge = bpe.id
      ),
      bear_peak_loops AS (
        SELECT 
          cycle_id,
          SUM(cost) as total_distance,
          COUNT(*) as edge_count,
          array_agg(edge_id ORDER BY path_seq) as edge_ids,
          array_agg(DISTINCT bpe.trail_name) as trail_names
        FROM bear_peak_cycles bpc
        JOIN bear_peak_edges bpe ON bpc.edge_id = bpe.id
        GROUP BY cycle_id
        HAVING COUNT(*) >= 3  -- At least 3 edges
          AND 'Bear Peak' = ANY(array_agg(DISTINCT bpe.trail_name))
          AND 'Fern Canyon' = ANY(array_agg(DISTINCT bpe.trail_name))
      )
      SELECT 
        cycle_id,
        total_distance,
        edge_count,
        edge_ids,
        trail_names,

      FROM bear_peak_loops
      WHERE total_distance BETWEEN 5 AND 15  -- Reasonable loop distance
      ORDER BY total_distance
      LIMIT 5
    `);
    
    console.log(`🔍 Found ${result.rows.length} Bear Peak loops with pgRouting`);
    return result.rows;
  }
}
