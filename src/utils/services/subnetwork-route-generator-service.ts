import { Pool, Client } from 'pg';
import { RoutePattern, RouteRecommendation } from '../ksp-route-generator';

export interface Subnetwork {
  component_id: number;
  node_count: number;
  trail_count: number;
  total_length_km: number;
  bounding_box: [number, number, number, number];
  node_ids: number[];
  trail_names: string[];
  centroid: [number, number];
}

export interface SubnetworkRouteGenerationResult {
  subnetwork: Subnetwork;
  routes: RouteRecommendation[];
  processing_time_ms: number;
  memory_usage_mb?: number;
  success: boolean;
  error?: string;
}

export interface SubnetworkRouteGeneratorConfig {
  stagingSchema: string;
  maxSubnetworkSize?: number; // Skip subnetworks larger than this (nodes)
  minSubnetworkSize?: number; // Skip subnetworks smaller than this (nodes)
  maxRoutesPerSubnetwork?: number;
  enableMemoryMonitoring?: boolean;
  parallelProcessing?: boolean;
  maxParallelSubnetworks?: number;
}

export class SubnetworkRouteGeneratorService {
  private pgClient: Pool | Client;
  private config: SubnetworkRouteGeneratorConfig;

  constructor(pgClient: Pool | Client, config: SubnetworkRouteGeneratorConfig) {
    this.pgClient = pgClient;
    this.config = {
      maxSubnetworkSize: 1000, // Skip very large subnetworks
      minSubnetworkSize: 3,    // Skip very small subnetworks
      maxRoutesPerSubnetwork: 10,
      enableMemoryMonitoring: true,
      parallelProcessing: false, // Start with sequential for stability
      maxParallelSubnetworks: 2,
      ...config
    };
  }

  /**
   * Detect all disconnected subnetworks in the routing graph
   */
  async detectSubnetworks(): Promise<Subnetwork[]> {
    console.log('🔍 Detecting disconnected subnetworks...');
    
    // Add timeout to prevent hanging
    const queryTimeout = 30000; // 30 seconds
    
    try {
      const result = await Promise.race([
        this.pgClient.query(`
          WITH connected_components AS (
            SELECT 
              component,
              node,
              cnt as connection_count
            FROM pgr_connectedComponents(
              'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded'
            )
            JOIN ${this.config.stagingSchema}.ways_noded_vertices_pgr v ON v.id = node
          ),
          component_stats AS (
            SELECT 
              component,
              COUNT(*) as node_count,
              ARRAY_AGG(node ORDER BY node) as node_ids,
              AVG(connection_count) as avg_connections
            FROM connected_components
            GROUP BY component
            ORDER BY node_count DESC
          ),
          component_trails AS (
            SELECT 
              cs.component,
              cs.node_count,
              cs.node_ids,
              cs.avg_connections,
              ARRAY_AGG(DISTINCT t.name) as trail_names,
              SUM(ST_Length(t.geometry::geography) / 1000.0) as total_length_km,
              ARRAY[
                ST_XMin(ST_Collect(t.geometry)),
                ST_YMin(ST_Collect(t.geometry)),
                ST_XMax(ST_Collect(t.geometry)),
                ST_YMax(ST_Collect(t.geometry))
              ] as bounding_box,
              ARRAY[
                ST_X(ST_Centroid(ST_Collect(t.geometry))),
                ST_Y(ST_Centroid(ST_Collect(t.geometry)))
              ] as centroid
            FROM component_stats cs
            JOIN connected_components cc ON cs.component = cc.component
            JOIN ${this.config.stagingSchema}.node_mapping nm ON cc.node = nm.pg_id
            JOIN ${this.config.stagingSchema}.edge_mapping em ON nm.pg_id = em.pg_id
            JOIN ${this.config.stagingSchema}.trails t ON em.app_uuid = t.app_uuid
            WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
            GROUP BY cs.component, cs.node_count, cs.node_ids, cs.avg_connections
          )
          SELECT 
            component as component_id,
            node_count,
            array_length(trail_names, 1) as trail_count,
            total_length_km,
            bounding_box,
            node_ids,
            trail_names,
            centroid
          FROM component_trails
          ORDER BY node_count DESC
        `),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Subnetwork detection timed out after ${queryTimeout/1000} seconds`)), queryTimeout)
        )
      ]) as any;

      const subnetworks: Subnetwork[] = (result.rows as any[]).map((row: any) => ({
        component_id: parseInt(row.component_id),
        node_count: parseInt(row.node_count),
        trail_count: parseInt(row.trail_count),
        total_length_km: parseFloat(row.total_length_km),
        bounding_box: row.bounding_box,
        node_ids: row.node_ids,
        trail_names: row.trail_names,
        centroid: row.centroid
      }));

      console.log(`✅ Detected ${subnetworks.length} subnetworks:`);
      subnetworks.forEach((subnet, index) => {
        console.log(`  Subnetwork ${index + 1}: ${subnet.node_count} nodes, ${subnet.trail_count} trails, ${subnet.total_length_km.toFixed(1)}km`);
      });

      return subnetworks;
    } catch (error) {
      console.error('❌ Subnetwork detection failed:', error);
      
      // Return a simple fallback - treat the entire network as one subnetwork
      console.log('🔄 Falling back to single subnetwork approach...');
      const fallbackResult = await this.pgClient.query(`
        SELECT 
          1 as component_id,
          COUNT(*) as node_count,
          COUNT(DISTINCT t.name) as trail_count,
          SUM(ST_Length(t.geometry::geography) / 1000.0) as total_length_km,
          ARRAY[ST_XMin(ST_Collect(t.geometry)), ST_YMin(ST_Collect(t.geometry)), ST_XMax(ST_Collect(t.geometry)), ST_YMax(ST_Collect(t.geometry))] as bounding_box,
          ARRAY[ST_X(ST_Centroid(ST_Collect(t.geometry))), ST_Y(ST_Centroid(ST_Collect(t.geometry)))] as centroid
        FROM ${this.config.stagingSchema}.trails t
        WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
      `);
      
      const fallbackSubnetwork: Subnetwork = {
        component_id: 1,
        node_count: parseInt(fallbackResult.rows[0].node_count),
        trail_count: parseInt(fallbackResult.rows[0].trail_count),
        total_length_km: parseFloat(fallbackResult.rows[0].total_length_km),
        bounding_box: fallbackResult.rows[0].bounding_box,
        node_ids: [], // Will be populated if needed
        trail_names: [], // Will be populated if needed
        centroid: fallbackResult.rows[0].centroid
      };
      
      console.log(`✅ Fallback: Single subnetwork with ${fallbackSubnetwork.node_count} nodes, ${fallbackSubnetwork.trail_count} trails`);
      return [fallbackSubnetwork];
    }
  }

  /**
   * Filter subnetworks based on size constraints
   */
  filterSubnetworks(subnetworks: Subnetwork[]): Subnetwork[] {
    const filtered = subnetworks.filter(subnet => {
      if (this.config.minSubnetworkSize && subnet.node_count < this.config.minSubnetworkSize) {
        console.log(`⏭️ Skipping subnetwork ${subnet.component_id}: too small (${subnet.node_count} nodes < ${this.config.minSubnetworkSize})`);
        return false;
      }
      
      if (this.config.maxSubnetworkSize && subnet.node_count > this.config.maxSubnetworkSize) {
        console.log(`⏭️ Skipping subnetwork ${subnet.component_id}: too large (${subnet.node_count} nodes > ${this.config.maxSubnetworkSize})`);
        return false;
      }
      
      return true;
    });

    console.log(`📊 Filtered to ${filtered.length} processable subnetworks (from ${subnetworks.length} total)`);
    return filtered;
  }

  /**
   * Generate routes for a single subnetwork
   */
  async generateRoutesForSubnetwork(
    subnetwork: Subnetwork, 
    patterns: RoutePattern[]
  ): Promise<SubnetworkRouteGenerationResult> {
    const startTime = Date.now();
    const startMemory = this.config.enableMemoryMonitoring ? this.getMemoryUsage() : 0;
    
    console.log(`\n🛤️ Processing subnetwork ${subnetwork.component_id}: ${subnetwork.node_count} nodes, ${subnetwork.trail_count} trails`);
    
    try {
      // Create a temporary filtered view for this subnetwork
      const tempViewName = `temp_subnetwork_${subnetwork.component_id}`;
      await this.createSubnetworkView(subnetwork, tempViewName);
      
      const routes: RouteRecommendation[] = [];
      
      // Process each pattern for this subnetwork
      for (const pattern of patterns) {
        console.log(`  🎯 Processing pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
        
        const patternRoutes = await this.generateRoutesForPattern(
          pattern, 
          tempViewName, 
          subnetwork
        );
        
        routes.push(...patternRoutes);
        
        // Check if we've reached the limit for this subnetwork
        if (routes.length >= (this.config.maxRoutesPerSubnetwork || 10)) {
          console.log(`  ✅ Reached route limit for subnetwork ${subnetwork.component_id}`);
          break;
        }
      }
      
      // Clean up temporary view
      await this.dropSubnetworkView(tempViewName);
      
      const processingTime = Date.now() - startTime;
      const memoryUsage = this.config.enableMemoryMonitoring ? this.getMemoryUsage() - startMemory : 0;
      
      console.log(`  ✅ Subnetwork ${subnetwork.component_id}: Generated ${routes.length} routes in ${processingTime}ms`);
      if (this.config.enableMemoryMonitoring) {
        console.log(`  📊 Memory usage: ${memoryUsage.toFixed(1)}MB`);
      }
      
      return {
        subnetwork,
        routes,
        processing_time_ms: processingTime,
        memory_usage_mb: memoryUsage,
        success: true
      };
      
    } catch (error) {
      console.error(`  ❌ Error processing subnetwork ${subnetwork.component_id}:`, error);
      
      return {
        subnetwork,
        routes: [],
        processing_time_ms: Date.now() - startTime,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Create a temporary view containing only the nodes and edges for a specific subnetwork
   */
  private async createSubnetworkView(subnetwork: Subnetwork, viewName: string): Promise<void> {
    await this.pgClient.query(`
      CREATE TEMPORARY VIEW ${viewName}_nodes AS
      SELECT * FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
      WHERE id = ANY($1::integer[])
    `, [subnetwork.node_ids]);

    await this.pgClient.query(`
      CREATE TEMPORARY VIEW ${viewName}_edges AS
      SELECT e.* FROM ${this.config.stagingSchema}.ways_noded e
      WHERE e.source = ANY($1::integer[]) AND e.target = ANY($1::integer[])
    `, [subnetwork.node_ids]);
  }

  /**
   * Drop temporary subnetwork views
   */
  private async dropSubnetworkView(viewName: string): Promise<void> {
    await this.pgClient.query(`DROP VIEW IF EXISTS ${viewName}_nodes`);
    await this.pgClient.query(`DROP VIEW IF EXISTS ${viewName}_edges`);
  }

  /**
   * Generate routes for a specific pattern within a subnetwork
   */
  private async generateRoutesForPattern(
    pattern: RoutePattern, 
    viewName: string, 
    subnetwork: Subnetwork
  ): Promise<RouteRecommendation[]> {
    const routes: RouteRecommendation[] = [];
    
    // Use a simplified route generation approach for subnetworks
    // This avoids the complex recursive queries that can cause memory issues
    
    if (pattern.route_shape === 'out-and-back') {
      const outAndBackRoutes = await this.generateSimpleOutAndBackRoutes(pattern, viewName, subnetwork);
      routes.push(...outAndBackRoutes);
    } else if (pattern.route_shape === 'loop') {
      const loopRoutes = await this.generateSimpleLoopRoutes(pattern, viewName, subnetwork);
      routes.push(...loopRoutes);
    } else {
      const pointToPointRoutes = await this.generateSimplePointToPointRoutes(pattern, viewName, subnetwork);
      routes.push(...pointToPointRoutes);
    }
    
    return routes;
  }

  /**
   * Generate simple out-and-back routes for a subnetwork
   */
  private async generateSimpleOutAndBackRoutes(
    pattern: RoutePattern, 
    viewName: string, 
    subnetwork: Subnetwork
  ): Promise<RouteRecommendation[]> {
    const routes: RouteRecommendation[] = [];
    const halfTargetDistance = pattern.target_distance_km / 2;
    
    // Find node pairs within reasonable distance for out-and-back routes
    const nodePairsResult = await this.pgClient.query(`
      SELECT 
        e1.source as start_node,
        e1.target as end_node,
        e1.length_km as distance_km,
        e1.elevation_gain,
        e1.trail_name
      FROM ${viewName}_edges e1
      WHERE e1.length_km BETWEEN $1 * 0.5 AND $1 * 1.5
        AND e1.elevation_gain BETWEEN $2 * 0.5 AND $2 * 1.5
      ORDER BY ABS(e1.length_km - $1)
      LIMIT 5
    `, [halfTargetDistance, pattern.target_elevation_gain / 2]);
    
    for (const pair of nodePairsResult.rows) {
      const outAndBackDistance = pair.distance_km * 2;
      const outAndBackElevation = pair.elevation_gain * 2;
      
      // Check if this meets our criteria
      const distanceOk = outAndBackDistance >= pattern.target_distance_km * (1 - pattern.tolerance_percent / 100) 
                        && outAndBackDistance <= pattern.target_distance_km * (1 + pattern.tolerance_percent / 100);
      const elevationOk = outAndBackElevation >= pattern.target_elevation_gain * (1 - pattern.tolerance_percent / 100)
                         && outAndBackElevation <= pattern.target_elevation_gain * (1 + pattern.tolerance_percent / 100);
      
      if (distanceOk && elevationOk) {
        const route: RouteRecommendation = {
          route_uuid: `subnet-${subnetwork.component_id}-${pair.start_node}-${pair.end_node}`,
          route_name: `${pair.trail_name} Out & Back`,
          route_shape: 'out-and-back',
          input_length_km: pattern.target_distance_km,
          input_elevation_gain: pattern.target_elevation_gain,
          recommended_length_km: outAndBackDistance,
          recommended_elevation_gain: outAndBackElevation,
          route_path: {
            type: 'LineString',
            coordinates: [
              [subnetwork.centroid[0], subnetwork.centroid[1]], // Simplified path
              [subnetwork.centroid[0] + 0.001, subnetwork.centroid[1] + 0.001]
            ]
          },
          route_edges: [pair.start_node, pair.end_node],
          trail_count: 1,
          route_score: 85,
          similarity_score: 0.85,
          region: 'boulder' // TODO: Make dynamic
        };
        
        routes.push(route);
      }
    }
    
    return routes;
  }

  /**
   * Generate simple loop routes for a subnetwork
   */
  private async generateSimpleLoopRoutes(
    pattern: RoutePattern, 
    viewName: string, 
    subnetwork: Subnetwork
  ): Promise<RouteRecommendation[]> {
    const routes: RouteRecommendation[] = [];
    
    // Find simple loops (3+ edges that form a cycle)
    const loopResult = await this.pgClient.query(`
      WITH RECURSIVE loop_search AS (
        SELECT 
          e1.source as start_node,
          e1.target as current_node,
          ARRAY[e1.source, e1.target] as path,
          ARRAY[e1.id] as edges,
          e1.length_km as total_distance,
          e1.elevation_gain as total_elevation,
          1 as depth
        FROM ${viewName}_edges e1
        WHERE e1.source != e1.target
        
        UNION ALL
        
        SELECT 
          ls.start_node,
          e.target as current_node,
          ls.path || e.target,
          ls.edges || e.id,
          ls.total_distance + e.length_km,
          ls.total_elevation + e.elevation_gain,
          ls.depth + 1
        FROM loop_search ls
        JOIN ${viewName}_edges e ON ls.current_node = e.source
        WHERE ls.depth < 5  -- Limit depth to prevent infinite loops
          AND e.target != ALL(ls.path[1:array_length(ls.path, 1)-1])  -- Avoid revisiting nodes except start
          AND ls.total_distance < $1 * 1.5  -- Distance tolerance
      )
      SELECT 
        start_node,
        path,
        edges,
        total_distance,
        total_elevation,
        depth
      FROM loop_search
      WHERE current_node = start_node  -- Complete loop
        AND depth >= 3  -- At least 3 edges
        AND total_distance BETWEEN $1 * 0.8 AND $1 * 1.2
        AND total_elevation BETWEEN $2 * 0.8 AND $2 * 1.2
      ORDER BY ABS(total_distance - $1)
      LIMIT 3
    `, [pattern.target_distance_km, pattern.target_elevation_gain]);
    
    for (const loop of loopResult.rows) {
      const route: RouteRecommendation = {
        route_uuid: `subnet-${subnetwork.component_id}-loop-${loop.start_node}`,
        route_name: `Loop Route ${loop.start_node}`,
        route_shape: 'loop',
        input_length_km: pattern.target_distance_km,
        input_elevation_gain: pattern.target_elevation_gain,
        recommended_length_km: loop.total_distance,
        recommended_elevation_gain: loop.total_elevation,
        route_path: {
          type: 'LineString',
          coordinates: loop.path.map((nodeId: number) => [subnetwork.centroid[0], subnetwork.centroid[1]]) // Simplified
        },
        route_edges: loop.edges,
        trail_count: loop.depth,
        route_score: 80,
        similarity_score: 0.80,
        region: 'boulder'
      };
      
      routes.push(route);
    }
    
    return routes;
  }

  /**
   * Generate simple point-to-point routes for a subnetwork
   */
  private async generateSimplePointToPointRoutes(
    pattern: RoutePattern, 
    viewName: string, 
    subnetwork: Subnetwork
  ): Promise<RouteRecommendation[]> {
    const routes: RouteRecommendation[] = [];
    
    // Find direct connections that meet our criteria
    const directRoutesResult = await this.pgClient.query(`
      SELECT 
        source as start_node,
        target as end_node,
        length_km,
        elevation_gain,
        trail_name
      FROM ${viewName}_edges
      WHERE length_km BETWEEN $1 * 0.8 AND $1 * 1.2
        AND elevation_gain BETWEEN $2 * 0.8 AND $2 * 1.2
      ORDER BY ABS(length_km - $1)
      LIMIT 3
    `, [pattern.target_distance_km, pattern.target_elevation_gain]);
    
    for (const route of directRoutesResult.rows) {
      const routeRecommendation: RouteRecommendation = {
        route_uuid: `subnet-${subnetwork.component_id}-p2p-${route.start_node}-${route.end_node}`,
        route_name: `${route.trail_name} Route`,
        route_shape: 'point-to-point',
        input_length_km: pattern.target_distance_km,
        input_elevation_gain: pattern.target_elevation_gain,
        recommended_length_km: route.length_km,
        recommended_elevation_gain: route.elevation_gain,
        route_path: {
          type: 'LineString',
          coordinates: [
            [subnetwork.centroid[0], subnetwork.centroid[1]],
            [subnetwork.centroid[0] + 0.001, subnetwork.centroid[1] + 0.001]
          ]
        },
        route_edges: [route.start_node, route.end_node],
        trail_count: 1,
        route_score: 75,
        similarity_score: 0.75,
        region: 'boulder'
      };
      
      routes.push(routeRecommendation);
    }
    
    return routes;
  }

  /**
   * Get current memory usage (Node.js process)
   */
  private getMemoryUsage(): number {
    const memUsage = process.memoryUsage();
    return memUsage.heapUsed / 1024 / 1024; // Convert to MB
  }

  /**
   * Main method to generate routes for all subnetworks
   */
  async generateRoutesForAllSubnetworks(patterns: RoutePattern[]): Promise<RouteRecommendation[]> {
    console.log('🛤️ Starting subnetwork-based route generation...');
    
    // Step 1: Detect all subnetworks
    const allSubnetworks = await this.detectSubnetworks();
    
    // Step 2: Filter subnetworks based on size constraints
    const processableSubnetworks = this.filterSubnetworks(allSubnetworks);
    
    if (processableSubnetworks.length === 0) {
      console.log('⚠️ No processable subnetworks found');
      return [];
    }
    
    // Step 3: Process each subnetwork
    const allResults: SubnetworkRouteGenerationResult[] = [];
    const allRoutes: RouteRecommendation[] = [];
    
    if (this.config.parallelProcessing) {
      // Parallel processing (use with caution)
      console.log(`🔄 Processing ${processableSubnetworks.length} subnetworks in parallel (max ${this.config.maxParallelSubnetworks})`);
      
      const batchSize = this.config.maxParallelSubnetworks || 2;
      for (let i = 0; i < processableSubnetworks.length; i += batchSize) {
        const batch = processableSubnetworks.slice(i, i + batchSize);
        const batchPromises = batch.map(subnet => 
          this.generateRoutesForSubnetwork(subnet, patterns)
        );
        
        const batchResults = await Promise.all(batchPromises);
        allResults.push(...batchResults);
        
        // Add a small delay between batches to prevent memory buildup
        if (i + batchSize < processableSubnetworks.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } else {
      // Sequential processing (safer for memory)
      console.log(`🔄 Processing ${processableSubnetworks.length} subnetworks sequentially`);
      
      for (const subnetwork of processableSubnetworks) {
        const result = await this.generateRoutesForSubnetwork(subnetwork, patterns);
        allResults.push(result);
        
        // Add a small delay between subnetworks to allow garbage collection
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Step 4: Collect all successful routes
    for (const result of allResults) {
      if (result.success) {
        allRoutes.push(...result.routes);
      } else {
        console.log(`⚠️ Subnetwork ${result.subnetwork.component_id} failed: ${result.error}`);
      }
    }
    
    // Step 5: Summary
    const totalProcessingTime = allResults.reduce((sum, r) => sum + r.processing_time_ms, 0);
    const totalMemoryUsage = allResults.reduce((sum, r) => sum + (r.memory_usage_mb || 0), 0);
    const successfulSubnetworks = allResults.filter(r => r.success).length;
    
    console.log(`\n✅ Subnetwork route generation complete:`);
    console.log(`   📊 Processed ${successfulSubnetworks}/${processableSubnetworks.length} subnetworks successfully`);
    console.log(`   🛤️ Generated ${allRoutes.length} total routes`);
    console.log(`   ⏱️ Total processing time: ${totalProcessingTime}ms`);
    if (this.config.enableMemoryMonitoring) {
      console.log(`   📊 Total memory usage: ${totalMemoryUsage.toFixed(1)}MB`);
    }
    
    return allRoutes;
  }
}
