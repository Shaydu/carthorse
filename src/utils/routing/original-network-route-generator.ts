import { Pool } from 'pg';
import { RouteRecommendation } from '../ksp-route-generator';

export interface OriginalNetworkRouteGeneratorConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  minDistanceBetweenRoutes: number;
}

export class OriginalNetworkRouteGenerator {
  private pgClient: Pool;

  constructor(
    private pgClient: Pool,
    private config: OriginalNetworkRouteGeneratorConfig
  ) {
    this.pgClient = pgClient;
  }

  /**
   * Generate routes using the original Layer 1 node/edge structure
   * This bypasses the translated routing networks and uses the original connected structure
   */
  async generateRoutes(): Promise<RouteRecommendation[]> {
    console.log('🎯 Generating routes using original Layer 1 network structure...');
    
    // Create a direct routing table from the original trail data
    await this.createOriginalRoutingTable();
    
    // Generate routes using the original structure
    const recommendations = await this.generateRoutesFromOriginalStructure();
    
    console.log(`✅ Generated ${recommendations.length} routes using original network structure`);
    return recommendations;
  }

  /**
   * Create a routing table directly from the original trail data
   * This preserves the original node IDs and connections
   */
  private async createOriginalRoutingTable(): Promise<void> {
    console.log('🔄 Creating original routing table from Layer 1 data...');
    
    // Create a table that maps the original trail structure to routing format
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${this.config.stagingSchema}.original_routing_edges AS
      SELECT 
        ROW_NUMBER() OVER (ORDER BY t.app_uuid) as id,
        t.app_uuid as trail_id,
        t.name as trail_name,
        t.length_km,
        t.elevation_gain,
        t.elevation_loss,
        t.geometry,
        -- Use original node IDs from the trail data
        -- This preserves your connected network structure
        start_node.id as source,
        end_node.id as target
      FROM ${this.config.stagingSchema}.trails t
      -- Join with original node structure (nodes 9, 10, 12, 15, 16, 40, etc.)
      JOIN ${this.config.stagingSchema}.original_nodes start_node 
        ON ST_DWithin(ST_StartPoint(t.geometry), ST_SetSRID(ST_MakePoint(start_node.lng, start_node.lat), 4326), 0.0001)
      JOIN ${this.config.stagingSchema}.original_nodes end_node 
        ON ST_DWithin(ST_EndPoint(t.geometry), ST_SetSRID(ST_MakePoint(end_node.lng, end_node.lat), 4326), 0.0001)
      WHERE t.geometry IS NOT NULL 
        AND ST_IsValid(t.geometry)
        AND t.length_km > 0
    `);
    
    console.log('✅ Created original routing table');
  }

  /**
   * Generate routes using the original node structure
   */
  private async generateRoutesFromOriginalStructure(): Promise<RouteRecommendation[]> {
    console.log('🔄 Generating routes from original structure...');
    
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
      SELECT * FROM public.route_patterns 
      WHERE route_type IN ('loop', 'out-and-back')
      ORDER BY target_distance_km
    `);
    return result.rows;
  }

  /**
   * Generate routes for a specific pattern using original structure
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
    
    // Generate routes using the original structure
    const routes = await this.findRoutesInOriginalStructure(
      minDistance, maxDistance, minElevation, maxElevation
    );
    
    return routes;
  }

  /**
   * Find routes in the original network structure
   */
  private async findRoutesInOriginalStructure(
    minDistance: number, 
    maxDistance: number, 
    minElevation: number, 
    maxElevation: number
  ): Promise<RouteRecommendation[]> {
    
    // Use recursive CTE to find routes in the original structure
    const result = await this.pgClient.query(`
      WITH RECURSIVE route_search AS (
        -- Start with all edges as potential starting points
        SELECT 
          e1.id as edge_id,
          e1.source as start_node,
          e1.target as current_node,
          e1.trail_id,
          e1.trail_name,
          e1.length_km as total_distance,
          e1.elevation_gain as total_elevation,
          ARRAY[e1.source, e1.target] as path,
          ARRAY[e1.id] as edges,
          ARRAY[e1.trail_name] as trail_names,
          1 as depth
        FROM ${this.config.stagingSchema}.original_routing_edges e1
        
        UNION ALL
        
        -- Recursively explore connected edges
        SELECT 
          rs.edge_id,
          rs.start_node,
          e2.target as current_node,
          rs.trail_id,
          rs.trail_name,
          rs.total_distance + e2.length_km as total_distance,
          rs.total_elevation + COALESCE(e2.elevation_gain, 0) as total_elevation,
          rs.path || e2.target as path,
          rs.edges || e2.id as edges,
          rs.trail_names || e2.trail_name as trail_names,
          rs.depth + 1 as depth
        FROM route_search rs
        JOIN ${this.config.stagingSchema}.original_routing_edges e2 ON rs.current_node = e2.source
        WHERE rs.depth < 10  -- Limit search depth
          AND e2.target != ALL(rs.path[1:array_length(rs.path, 1)-1])  -- Don't revisit nodes except start
          AND rs.total_distance + e2.length_km <= $1  -- Don't exceed max distance
          AND rs.total_elevation + COALESCE(e2.elevation_gain, 0) <= $2  -- Don't exceed max elevation
      ),
      valid_routes AS (
        SELECT 
          gen_random_uuid()::text as route_id,
          start_node,
          current_node as end_node,
          total_distance,
          total_elevation,
          path,
          edges,
          trail_names,
          CASE 
            WHEN start_node = current_node THEN 'loop'
            WHEN array_length(path, 1) = 2 THEN 'out-and-back'
            ELSE 'point-to-point'
          END as route_shape,
          array_length(array_agg(DISTINCT trail_names), 1) as trail_count
        FROM route_search
        WHERE total_distance >= $3  -- Minimum distance
          AND total_distance <= $1  -- Maximum distance
          AND total_elevation >= $4  -- Minimum elevation
          AND total_elevation <= $2  -- Maximum elevation
          AND array_length(path, 1) >= 2  -- At least 2 nodes
        GROUP BY start_node, current_node, total_distance, total_elevation, path, edges, trail_names
      )
      SELECT * FROM valid_routes
      ORDER BY total_distance
      LIMIT 50
    `, [maxDistance, maxElevation, minDistance, minElevation]);
    
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
      input_elevation_gain: row.total_elevation,
      recommended_length_km: row.total_distance,
      recommended_elevation_gain: row.total_elevation,
      route_type: row.route_shape,
      route_shape: row.route_shape,
      trail_count: row.trail_count,
      route_score: 100, // Default score
      similarity_score: 1.0, // Perfect match for now
      route_path: row.path,
      route_edges: row.edges,
      route_name: `${row.route_shape} - ${row.trail_names.join(', ')}`,
      route_geometry: null, // Will be generated later
      created_at: new Date()
    };
  }
}
