import { Pool } from 'pg';
import { RouteRecommendation } from '../ksp-route-generator';

interface PgRoutingConfig {
  stagingSchema: string;
  maxEndpointDistance: number; // in meters
  maxLoopDistance: number; // in km
}

export class EnhancedPgRoutingRouteGenerator {
  private pgClient: Pool;
  private config: PgRoutingConfig;

  constructor(pgClient: Pool, config: PgRoutingConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  async generateRoutes(): Promise<RouteRecommendation[]> {
    console.log('🎯 Generating routes using enhanced pgRouting with automatic endpoint connections...');
    
    // Step 1: Prepare the enhanced pgRouting network
    await this.prepareEnhancedPgRoutingNetwork();
    
    // Step 2: Load route patterns
    const patterns = await this.loadRoutePatterns();
    
    // Step 3: Generate routes
    const routes: RouteRecommendation[] = [];
    
    for (const pattern of patterns) {
      if (pattern.route_shape === 'loop') {
        const loopRoutes = await this.generateLoopRoutes(pattern);
        routes.push(...loopRoutes);
      } else if (pattern.route_shape === 'out-and-back') {
        const outAndBackRoutes = await this.generateOutAndBackRoutes(pattern);
        routes.push(...outAndBackRoutes);
      }
    }
    
    return routes;
  }

  private async prepareEnhancedPgRoutingNetwork(): Promise<void> {
    console.log('🔄 Preparing enhanced pgRouting network with automatic endpoint connections...');
    
    // Step 1: Create the base ways_noded table
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${this.config.stagingSchema}.ways_noded_enhanced
    `);
    
    await this.pgClient.query(`
      CREATE TABLE ${this.config.stagingSchema}.ways_noded_enhanced AS
      SELECT 
        id,
        source,
        target,
        length_km as cost,
        length_km as reverse_cost,
        ST_Force2D(ST_GeomFromGeoJSON(geojson)) as the_geom
      FROM ${this.config.stagingSchema}.export_edges
      WHERE geojson IS NOT NULL 
        AND geojson != ''
        AND ST_IsValid(ST_GeomFromGeoJSON(geojson))
    `);
    
    // Step 2: Identify dead-end nodes (nodes with only incoming edges)
    console.log('🔍 Identifying dead-end nodes...');
    const deadEndNodes = await this.pgClient.query(`
      WITH node_degrees AS (
        SELECT 
          node_id,
          in_degree,
          out_degree,
          total_degree
        FROM (
          SELECT source as node_id, COUNT(*) as out_degree FROM ${this.config.stagingSchema}.ways_noded_enhanced GROUP BY source
        ) out_edges
        FULL OUTER JOIN (
          SELECT target as node_id, COUNT(*) as in_degree FROM ${this.config.stagingSchema}.ways_noded_enhanced GROUP BY target
        ) in_edges USING (node_id)
        CROSS JOIN (
          SELECT (COALESCE(in_degree, 0) + COALESCE(out_degree, 0)) as total_degree
        ) total
      )
      SELECT node_id, in_degree, out_degree, total_degree
      FROM node_degrees
      WHERE out_degree = 0 AND in_degree > 0
      ORDER BY node_id
    `);
    
    console.log(`Found ${deadEndNodes.rows.length} dead-end nodes`);
    
    // Step 3: Find potential connections for dead-end nodes
    if (deadEndNodes.rows.length > 0) {
      console.log('🔗 Creating virtual connections for dead-end nodes...');
      
      for (const deadEnd of deadEndNodes.rows) {
        const deadEndNodeId = deadEnd.node_id;
        
        // Find nearby nodes that could complete loops
        const nearbyNodes = await this.pgClient.query(`
          WITH dead_end_location AS (
            SELECT ST_StartPoint(the_geom) as dead_end_point
            FROM ${this.config.stagingSchema}.ways_noded_enhanced
            WHERE target = $1
            LIMIT 1
          ),
          nearby_nodes AS (
            SELECT 
              wn.source as node_id,
              ST_Distance(
                ST_StartPoint(wn.the_geom),
                dead_end_location.dead_end_point
              ) as distance_meters
            FROM ${this.config.stagingSchema}.ways_noded_enhanced wn
            CROSS JOIN dead_end_location
            WHERE wn.source != $1
              AND ST_Distance(
                ST_StartPoint(wn.the_geom),
                dead_end_location.dead_end_point
              ) <= $2
            ORDER BY distance_meters
            LIMIT 5
          )
          SELECT * FROM nearby_nodes
        `, [deadEndNodeId, this.config.maxEndpointDistance]);
        
        // Create virtual connections for the closest nodes
        for (const nearby of nearbyNodes.rows) {
          const virtualEdgeId = `virtual_${deadEndNodeId}_${nearby.node_id}`;
          const virtualCost = nearby.distance_meters / 1000; // Convert to km
          
          await this.pgClient.query(`
            INSERT INTO ${this.config.stagingSchema}.ways_noded_enhanced (id, source, target, cost, reverse_cost, the_geom)
            VALUES ($1, $2, $3, $4, $4, 
              ST_MakeLine(
                (SELECT ST_StartPoint(the_geom) FROM ${this.config.stagingSchema}.ways_noded_enhanced WHERE target = $2 LIMIT 1),
                (SELECT ST_StartPoint(the_geom) FROM ${this.config.stagingSchema}.ways_noded_enhanced WHERE source = $3 LIMIT 1)
              )
            )
          `, [virtualEdgeId, deadEndNodeId, nearby.node_id, virtualCost]);
          
          console.log(`  Created virtual connection: ${deadEndNodeId} → ${nearby.node_id} (${virtualCost.toFixed(3)}km)`);
        }
      }
    }
    
    // Step 4: Create vertices table
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${this.config.stagingSchema}.ways_noded_enhanced_vertices_pgr
    `);
    
    await this.pgClient.query(`
      SELECT pgr_createVerticesTable('${this.config.stagingSchema}.ways_noded_enhanced', 'the_geom', 'id', '${this.config.stagingSchema}.ways_noded_enhanced_vertices_pgr')
    `);
    
    // Step 5: Analyze the enhanced graph
    await this.pgClient.query(`
      SELECT pgr_analyzeGraph('${this.config.stagingSchema}.ways_noded_enhanced', 0.000001, 'the_geom', 'id', 'source', 'target', '${this.config.stagingSchema}.ways_noded_enhanced_vertices_pgr')
    `);
    
    console.log('✅ Enhanced pgRouting network prepared');
  }

  private async loadRoutePatterns(): Promise<any[]> {
    const result = await this.pgClient.query(`
      SELECT * FROM get_route_patterns()
      WHERE route_shape IN ('loop', 'out-and-back')
      ORDER BY target_distance_km
    `);
    return result.rows;
  }

  private async generateLoopRoutes(pattern: any): Promise<RouteRecommendation[]> {
    console.log(`🔄 Generating loop routes for pattern: ${pattern.name} (${pattern.target_distance_km}km)`);
    
    const routes: RouteRecommendation[] = [];
    
    try {
      // Use pgr_hawickCircuits to find cycles
      const result = await this.pgClient.query(`
        SELECT * FROM pgr_hawickCircuits(
          'SELECT id, source, target, cost, reverse_cost FROM ${this.config.stagingSchema}.ways_noded_enhanced'
        )
        WHERE cost <= $1
        ORDER BY cost
        LIMIT 10
      `, [pattern.target_distance_km * 1.5]); // Allow some flexibility
      
      for (const circuit of result.rows) {
        const route = await this.convertCircuitToRouteRecommendation(circuit, pattern);
        if (route) {
          routes.push(route);
        }
      }
      
      console.log(`  Found ${routes.length} loop routes for ${pattern.name}`);
      
    } catch (error) {
      console.error(`  Error generating loop routes for ${pattern.name}:`, error);
    }
    
    return routes;
  }

  private async generateOutAndBackRoutes(pattern: any): Promise<RouteRecommendation[]> {
    console.log(`🔄 Generating out-and-back routes for pattern: ${pattern.name} (${pattern.target_distance_km}km)`);
    
    const routes: RouteRecommendation[] = [];
    
    try {
      // Use pgr_ksp to find k-shortest paths
      const result = await this.pgClient.query(`
        SELECT * FROM pgr_ksp(
          'SELECT id, source, target, cost, reverse_cost FROM ${this.config.stagingSchema}.ways_noded_enhanced',
          $1, $2, 5, true
        )
        WHERE cost <= $3
        ORDER BY cost
        LIMIT 10
      `, [1, 1, pattern.target_distance_km * 1.5]); // Start from node 1, allow flexibility
      
      for (const path of result.rows) {
        const route = await this.convertPathToRouteRecommendation(path, pattern);
        if (route) {
          routes.push(route);
        }
      }
      
      console.log(`  Found ${routes.length} out-and-back routes for ${pattern.name}`);
      
    } catch (error) {
      console.error(`  Error generating out-and-back routes for ${pattern.name}:`, error);
    }
    
    return routes;
  }

  private async convertCircuitToRouteRecommendation(circuit: any, pattern: any): Promise<RouteRecommendation | null> {
    try {
      // Extract edge IDs from the circuit
      const edgeIds = circuit.path.split(',').map((id: string) => parseInt(id.trim()));
      
      // Get trail information for these edges
      const trailResult = await this.pgClient.query(`
        SELECT trail_name, length_km, elevation_gain, elevation_loss
        FROM ${this.config.stagingSchema}.export_edges
        WHERE id = ANY($1)
      `, [edgeIds]);
      
      const trails = trailResult.rows.map(row => row.trail_name);
      const totalDistance = trailResult.rows.reduce((sum, row) => sum + row.length_km, 0);
      const totalElevationGain = trailResult.rows.reduce((sum, row) => sum + row.elevation_gain, 0);
      
      return {
        id: `enhanced_loop_${pattern.id}_${circuit.cost.toFixed(2)}`,
        name: `${pattern.name} Loop`,
        description: `Enhanced loop route using ${pattern.name} pattern`,

        target_distance_km: pattern.target_distance_km,
        target_elevation_gain_m: pattern.target_elevation_gain_m,
        actual_distance_km: totalDistance,
        actual_elevation_gain_m: totalElevationGain,
        constituent_trails: trails,
        unique_trail_count: new Set(trails).size,
        total_trail_distance_km: totalDistance,
        total_trail_elevation_gain_m: totalElevationGain,
        difficulty: pattern.difficulty,
        region: pattern.region
      };
      
    } catch (error) {
      console.error('Error converting circuit to route recommendation:', error);
      return null;
    }
  }

  private async convertPathToRouteRecommendation(path: any, pattern: any): Promise<RouteRecommendation | null> {
    try {
      // Extract edge IDs from the path
      const edgeIds = path.path.split(',').map((id: string) => parseInt(id.trim()));
      
      // Get trail information for these edges
      const trailResult = await this.pgClient.query(`
        SELECT trail_name, length_km, elevation_gain, elevation_loss
        FROM ${this.config.stagingSchema}.export_edges
        WHERE id = ANY($1)
      `, [edgeIds]);
      
      const trails = trailResult.rows.map(row => row.trail_name);
      const totalDistance = trailResult.rows.reduce((sum, row) => sum + row.length_km, 0);
      const totalElevationGain = trailResult.rows.reduce((sum, row) => sum + row.elevation_gain, 0);
      
      return {
        id: `enhanced_outback_${pattern.id}_${path.cost.toFixed(2)}`,
        name: `${pattern.name} Out & Back`,
        description: `Enhanced out-and-back route using ${pattern.name} pattern`,

        target_distance_km: pattern.target_distance_km,
        target_elevation_gain_m: pattern.target_elevation_gain_m,
        actual_distance_km: totalDistance,
        actual_elevation_gain_m: totalElevationGain,
        constituent_trails: trails,
        unique_trail_count: new Set(trails).size,
        total_trail_distance_km: totalDistance,
        total_trail_elevation_gain_m: totalElevationGain,
        difficulty: pattern.difficulty,
        region: pattern.region
      };
      
    } catch (error) {
      console.error('Error converting path to route recommendation:', error);
      return null;
    }
  }

  async findBearPeakLoop(): Promise<RouteRecommendation[]> {
    console.log('🔍 Looking for Bear Peak loop with enhanced routing...');
    
    const routes = await this.generateRoutes();
    
    // Filter for Bear Peak related routes
    const bearPeakRoutes = routes.filter(route => 
      route.constituent_trails.some(trail => 
        trail.toLowerCase().includes('bear') || 
        trail.toLowerCase().includes('fern') ||
        trail.toLowerCase().includes('mesa')
      )
    );
    
    console.log(`Found ${bearPeakRoutes.length} Bear Peak related routes`);
    
    return bearPeakRoutes;
  }
}
