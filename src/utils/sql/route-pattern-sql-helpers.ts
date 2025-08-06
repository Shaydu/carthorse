import { Pool } from 'pg';
import { RoutePattern } from '../ksp-route-generator';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';

export class RoutePatternSqlHelpers {
  private configLoader: RouteDiscoveryConfigLoader;

  constructor(private pgClient: Pool) {
    this.configLoader = RouteDiscoveryConfigLoader.getInstance();
  }

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
   * Load loop route patterns
   */
  async loadLoopPatterns(): Promise<RoutePattern[]> {
    console.log('📋 Loading loop route patterns...');
    
    const patternsResult = await this.pgClient.query(`
      SELECT * FROM public.route_patterns 
      WHERE route_shape = 'loop'
      ORDER BY target_distance_km DESC
    `);
    
    const patterns: RoutePattern[] = patternsResult.rows;
    console.log(`✅ Loaded ${patterns.length} loop route patterns`);
    
    console.log('🔍 Loop patterns to process (largest first):');
    for (const pattern of patterns) {
      console.log(`  - ${pattern.pattern_name}: ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m elevation`);
    }

    if (patterns.length === 0) {
      throw new Error('No loop patterns found');
    }

    return patterns;
  }

  /**
   * Load point-to-point route patterns
   */
  async loadPointToPointPatterns(): Promise<RoutePattern[]> {
    console.log('📋 Loading point-to-point route patterns...');
    
    const patternsResult = await this.pgClient.query(`
      SELECT * FROM public.route_patterns 
      WHERE route_shape = 'point-to-point'
      ORDER BY target_distance_km DESC
    `);
    
    const patterns: RoutePattern[] = patternsResult.rows;
    console.log(`✅ Loaded ${patterns.length} point-to-point route patterns`);
    
    console.log('🔍 Point-to-point patterns to process (largest first):');
    for (const pattern of patterns) {
      console.log(`  - ${pattern.pattern_name}: ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m elevation`);
    }

    if (patterns.length === 0) {
      console.log('⚠️ No point-to-point patterns found - this is normal for some regions');
      return [];
    }

    return patterns;
  }

  /**
   * Generate loop routes using pgRouting's hawickcircuits with improved tolerance handling
   * This finds all cycles in the graph that meet distance/elevation criteria
   */
  async generateLoopRoutes(
    stagingSchema: string,
    targetDistance: number,
    targetElevation: number,
    tolerancePercent: number = 20
  ): Promise<any[]> {
    console.log(`🔄 Generating loop routes: ${targetDistance}km, ${targetElevation}m elevation (with ${tolerancePercent}% tolerance)`);
    
    // Calculate tolerance ranges
    const minDistance = targetDistance * (1 - tolerancePercent / 100);
    const maxDistance = targetDistance * (1 + tolerancePercent / 100);
    const minElevation = targetElevation * (1 - tolerancePercent / 100);
    const maxElevation = targetElevation * (1 + tolerancePercent / 100);
    
    console.log(`📏 Distance range: ${minDistance.toFixed(1)}-${maxDistance.toFixed(1)}km`);
    console.log(`⛰️ Elevation range: ${minElevation.toFixed(0)}-${maxElevation.toFixed(0)}m`);
    
    // For larger loops (10+km), use a different approach with tolerance
    if (targetDistance >= 10) {
      console.log(`🔍 Using large loop detection with ${tolerancePercent}% tolerance for ${targetDistance}km target`);
      return await this.generateLargeLoops(stagingSchema, targetDistance, targetElevation, tolerancePercent);
    }
    
    // For smaller loops, use hawickcircuits (keeping original approach for now)
    console.log(`🔍 Using hawickcircuits for smaller loops`);
    
    const cyclesResult = await this.pgClient.query(`
      SELECT 
        path_id as cycle_id,
        edge as edge_id,
        cost,
        agg_cost,
        path_seq
      FROM pgr_hawickcircuits(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded'
      )
      ORDER BY path_id, path_seq
    `);
    
    console.log(`🔍 Found ${cyclesResult.rows.length} total edges in cycles with tolerance`);
    
    // Debug: Show some cycle details
    if (cyclesResult.rows.length > 0) {
      const uniqueCycles = new Set(cyclesResult.rows.map(r => r.cycle_id));
      console.log(`🔍 DEBUG: Found ${uniqueCycles.size} unique cycles with tolerance`);
    }
    
    return cyclesResult.rows;
  }

  /**
   * Generate large out-and-back routes (10+km) by finding paths that can form long routes
   */
  private async generateLargeLoops(
    stagingSchema: string,
    targetDistance: number,
    targetElevation: number,
    tolerancePercent: number
  ): Promise<any[]> {
    console.log(`🔍 LARGE OUT-AND-BACK DETECTION CALLED: ${targetDistance}km target`);
    console.log(`🔍 Generating large out-and-back routes (${targetDistance}km target)`);
    
    // Get high-degree nodes as potential route anchors
    const anchorNodes = await this.pgClient.query(`
      SELECT nm.pg_id as node_id, nm.connection_count, 
             ST_X(v.the_geom) as lon, ST_Y(v.the_geom) as lat
      FROM ${stagingSchema}.node_mapping nm
      JOIN ${stagingSchema}.ways_noded_vertices_pgr v ON nm.pg_id = v.id
      WHERE nm.connection_count >= 3
      ORDER BY nm.connection_count DESC
      LIMIT 20
    `);
    
    console.log(`🔍 Found ${anchorNodes.rows.length} anchor nodes for large out-and-back routes`);
    
    const largeRoutes: any[] = [];
    
    for (const anchor of anchorNodes.rows.slice(0, 10)) {
      console.log(`🔍 Exploring large out-and-back routes from anchor node ${anchor.node_id} (${anchor.connection_count} connections)`);
      
      // Find potential out-and-back paths from this anchor
      const routePaths = await this.findLargeLoopPaths(
        stagingSchema,
        anchor.node_id,
        targetDistance,
        targetElevation
      );
      
      largeRoutes.push(...routePaths);
    }
    
    console.log(`✅ Generated ${largeRoutes.length} large out-and-back route candidates`);
    return largeRoutes;
  }

    /**
   * Find potential large out-and-back paths from an anchor node with 100m tolerance
   */
  private async findLargeLoopPaths(
    stagingSchema: string,
    anchorNode: number,
    targetDistance: number,
    targetElevation: number
  ): Promise<any[]> {
    console.log(`🔍 Finding large out-and-back paths from anchor node ${anchorNode} for ${targetDistance}km target (with 100m tolerance)`);
    
    // Find nodes reachable within target distance, including nearby nodes within 100m
    const reachableNodes = await this.pgClient.query(`
      WITH direct_reachable AS (
        SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
        FROM pgr_dijkstra(
          'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
          $1::bigint,
          (SELECT array_agg(pg_id) FROM ${stagingSchema}.node_mapping WHERE connection_count >= 2),
          false
        )
        WHERE agg_cost BETWEEN $2 * 0.3 AND $2 * 0.7
        AND end_vid != $1
      ),
      nearby_nodes AS (
        SELECT DISTINCT nm2.pg_id as node_id, 
               ST_Distance(v1.the_geom, v2.the_geom) as distance_meters
        FROM ${stagingSchema}.node_mapping nm1
        JOIN ${stagingSchema}.ways_noded_vertices_pgr v1 ON nm1.pg_id = v1.id
        JOIN ${stagingSchema}.ways_noded_vertices_pgr v2 ON v2.id != v1.id
        JOIN ${stagingSchema}.node_mapping nm2 ON nm2.pg_id = v2.id
        WHERE nm1.pg_id = $1
        AND nm2.connection_count >= 2
        AND ST_Distance(v1.the_geom, v2.the_geom) <= 100
        AND nm2.pg_id != $1
      )
      SELECT node_id, distance_km, 'direct' as connection_type
      FROM direct_reachable
      UNION ALL
      SELECT node_id, distance_meters/1000.0 as distance_km, 'nearby' as connection_type
      FROM nearby_nodes
      ORDER BY distance_km DESC
      LIMIT 15
    `, [anchorNode, targetDistance]);
    
    console.log(`🔍 Found ${reachableNodes.rows.length} reachable nodes (including nearby nodes within 100m)`);
    
    const routePaths: any[] = [];
    
    for (const destNode of reachableNodes.rows.slice(0, 8)) {
      console.log(`🔍 Exploring out-and-back route from ${anchorNode} → ${destNode.node_id} (${destNode.distance_km.toFixed(1)}km outbound, ${destNode.connection_type} connection)`);
      
      // Try to find a return path that creates an out-and-back route
      const returnPaths = await this.pgClient.query(`
        SELECT * FROM pgr_ksp(
          'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
          $1::bigint, $2::bigint, 3, false, false
        )
      `, [destNode.node_id, anchorNode]);
      
      console.log(`🔍 Found ${returnPaths.rows.length} return paths`);
      
      for (const returnPath of returnPaths.rows.slice(0, 2)) {
        // Calculate total out-and-back distance
        const totalDistance = destNode.distance_km + returnPath.agg_cost;
        
        console.log(`🔍 Out-and-back candidate: ${destNode.distance_km.toFixed(1)}km out + ${returnPath.agg_cost.toFixed(1)}km back = ${totalDistance.toFixed(1)}km total`);
        
        if (totalDistance >= targetDistance * 0.8 && totalDistance <= targetDistance * 1.2) {
          console.log(`✅ Valid large out-and-back route found: ${totalDistance.toFixed(1)}km`);
          routePaths.push({
            anchor_node: anchorNode,
            dest_node: destNode.node_id,
            outbound_distance: destNode.distance_km,
            return_distance: returnPath.agg_cost,
            total_distance: totalDistance,
            path_id: returnPath.path_id,
            connection_type: destNode.connection_type,
            route_type: 'out-and-back' // Mark as out-and-back, not loop
          });
        }
      }
    }
    
    console.log(`✅ Found ${routePaths.length} valid large out-and-back route candidates`);
    return routePaths;
  }

  /**
   * Group cycle edges into distinct cycles
   */
  private groupCycles(cycleEdges: any[]): Map<number, any[]> {
    const cycles = new Map<number, any[]>();
    
    for (const edge of cycleEdges) {
      if (!cycles.has(edge.cycle_id)) {
        cycles.set(edge.cycle_id, []);
      }
      cycles.get(edge.cycle_id)!.push(edge);
    }
    
    return cycles;
  }

  /**
   * Filter cycles by distance and elevation criteria
   */
  private async filterCyclesByCriteria(
    stagingSchema: string,
    cycles: Map<number, any[]>,
    minDistance: number,
    maxDistance: number,
    minElevation: number,
    maxElevation: number
  ): Promise<any[]> {
    const validLoops: any[] = [];
    
    console.log(`🔍 DEBUG: Filtering ${cycles.size} cycles with criteria: ${minDistance}-${maxDistance}km, ${minElevation}-${maxElevation}m`);
    
    for (const [cycleId, edges] of cycles) {
      // Calculate total distance and elevation for this cycle
      const edgeIds = edges.map(e => parseInt(e.edge_id)).filter(id => id > 0); // Convert strings to integers, filter out -1
      
      console.log(`🔍 DEBUG: Cycle ${cycleId} edge IDs: ${edgeIds.join(', ')}`);
      console.log(`🔍 DEBUG: Cycle ${cycleId} has ${edgeIds.length} valid edge IDs`);
      
      if (edgeIds.length === 0) {
        console.log(`⚠️ DEBUG: Cycle ${cycleId} has no valid edge IDs, skipping`);
        continue;
      }
      
      const cycleMetrics = await this.calculateCycleMetrics(stagingSchema, edgeIds);
      
      console.log(`🔍 DEBUG: Cycle ${cycleId} metrics: ${cycleMetrics.totalDistance.toFixed(2)}km, ${cycleMetrics.totalElevationGain.toFixed(0)}m`);
      
      // Check if cycle meets criteria
      if (cycleMetrics.totalDistance >= minDistance && 
          cycleMetrics.totalDistance <= maxDistance &&
          cycleMetrics.totalElevationGain >= minElevation &&
          cycleMetrics.totalElevationGain <= maxElevation) {
        
        console.log(`✅ DEBUG: Cycle ${cycleId} meets criteria!`);
        validLoops.push({
          cycle_id: cycleId,
          edges: edges,
          total_distance: cycleMetrics.totalDistance,
          total_elevation_gain: cycleMetrics.totalElevationGain,
          trail_count: cycleMetrics.trailCount,
          route_shape: 'loop'
        });
      } else {
        console.log(`❌ DEBUG: Cycle ${cycleId} filtered out (distance: ${cycleMetrics.totalDistance.toFixed(2)}km, elevation: ${cycleMetrics.totalElevationGain.toFixed(0)}m)`);
      }
    }
    
    console.log(`🔍 DEBUG: Returning ${validLoops.length} valid loops`);
    return validLoops;
  }

  /**
   * Calculate metrics for a cycle
   */
  private async calculateCycleMetrics(stagingSchema: string, edgeIds: number[]): Promise<{
    totalDistance: number;
    totalElevationGain: number;
    trailCount: number;
  }> {
    console.log(`🔍 DEBUG: calculateCycleMetrics called with edgeIds: ${edgeIds.join(', ')} (type: ${typeof edgeIds[0]})`);
    
    const metricsResult = await this.pgClient.query(`
      SELECT 
        SUM(w.length_km) as total_distance,
        SUM(w.elevation_gain) as total_elevation_gain,
        COUNT(DISTINCT em.original_trail_id) as trail_count
      FROM ${stagingSchema}.ways_noded w
      JOIN ${stagingSchema}.edge_mapping em ON w.id = em.pg_id
      WHERE w.id = ANY($1::integer[])
    `, [edgeIds]);
    
    const metrics = metricsResult.rows[0];
    console.log(`🔍 DEBUG: calculateCycleMetrics result: ${JSON.stringify(metrics)}`);
    
    return {
      totalDistance: parseFloat(metrics.total_distance) || 0,
      totalElevationGain: parseFloat(metrics.total_elevation_gain) || 0,
      trailCount: parseInt(metrics.trail_count) || 0
    };
  }



  /**
   * Find trailhead nodes based on coordinate locations
   */
  async findTrailheadNodesByCoordinates(
    stagingSchema: string,
    trailheadLocations: Array<{lat: number, lng: number, tolerance_meters?: number}>,
    maxTrailheads: number = 50
  ): Promise<any[]> {
    console.log(`🔍 Finding trailhead nodes for ${trailheadLocations.length} coordinate locations...`);
    
    const trailheadNodes: any[] = [];
    
    for (const location of trailheadLocations) {
      const tolerance = location.tolerance_meters || 50; // Default 50m tolerance
      
      console.log(`🔍 Searching for trailhead at ${location.lat}, ${location.lng} with ${tolerance}m tolerance...`);
      
      // Find the nearest node to this coordinate location
      const nearestNode = await this.pgClient.query(`
        SELECT 
          rn.id,
          rn.node_type,
          rn.lat,
          rn.lng,
          rn.elevation,
          rn.connected_trails,
          ST_Distance(
            ST_SetSRID(ST_MakePoint($1, $2), 4326),
            ST_SetSRID(ST_MakePoint(rn.lng, rn.lat), 4326)
          ) * 111000 as distance_meters
        FROM ${stagingSchema}.routing_nodes rn
        WHERE ST_DWithin(
          ST_SetSRID(ST_MakePoint($1, $2), 4326),
          ST_SetSRID(ST_MakePoint(rn.lng, rn.lat), 4326),
          $3 / 111000.0
        )
        ORDER BY distance_meters ASC
        LIMIT 1
      `, [location.lng, location.lat, tolerance]);
      
      if (nearestNode.rows.length > 0) {
        const node = nearestNode.rows[0];
        console.log(`✅ Found trailhead node: ID ${node.id} at ${node.lat}, ${node.lng} (distance: ${node.distance_meters.toFixed(1)}m)`);
        trailheadNodes.push(node);
      } else {
        console.log(`❌ No routing nodes found within ${tolerance}m of ${location.lat}, ${location.lng}`);
        
        // Let's check what nodes are available in the area
        const nearbyNodes = await this.pgClient.query(`
          SELECT 
            rn.id,
            rn.node_type,
            rn.lat,
            rn.lng,
            ST_Distance(
              ST_SetSRID(ST_MakePoint($1, $2), 4326),
              ST_SetSRID(ST_MakePoint(rn.lng, rn.lat), 4326)
            ) * 111000 as distance_meters
          FROM ${stagingSchema}.routing_nodes rn
          ORDER BY distance_meters ASC
          LIMIT 5
        `, [location.lng, location.lat]);
        
        console.log(`🔍 Nearest available nodes:`);
        for (const node of nearbyNodes.rows) {
          console.log(`   - Node ${node.id}: ${node.lat}, ${node.lng} (${node.distance_meters.toFixed(1)}m away)`);
        }
      }
    }
    
    console.log(`🔍 Found ${trailheadNodes.length} trailhead nodes total`);
    return trailheadNodes.slice(0, maxTrailheads);
  }

  /**
   * Get network entry points for route generation
   * @param stagingSchema The staging schema name
   * @param useTrailheadsOnly If true, only return trailhead nodes. If false, use default logic.
   * @param maxEntryPoints Maximum number of entry points to return
   * @param trailheadLocations Optional array of trailhead coordinate locations
   */
  async getNetworkEntryPoints(
    stagingSchema: string, 
    useTrailheadsOnly: boolean = false,
    maxEntryPoints: number = 50,
    trailheadLocations?: Array<{lat: number, lng: number, tolerance_meters?: number}>
  ): Promise<any[]> {
    console.log(`🔍 Finding network entry points${useTrailheadsOnly ? ' (trailheads only)' : ''}...`);
    
    if (useTrailheadsOnly) {
      // Load trailhead configuration from YAML
      const config = this.configLoader.loadConfig();
      const trailheadConfig = config.trailheads;
      
      console.log(`🔍 Trailhead config: enabled=${trailheadConfig.enabled}, strategy=${trailheadConfig.selectionStrategy}, locations=${trailheadConfig.locations?.length || 0}`);
      
      if (!trailheadConfig.enabled) {
        console.log('⚠️ Trailheads disabled in config - falling back to default entry points');
        return this.getDefaultNetworkEntryPoints(stagingSchema, maxEntryPoints);
      }
      
      // Use coordinate-based trailhead finding from YAML config
      if (trailheadConfig.selectionStrategy === 'coordinates' && trailheadConfig.locations && trailheadConfig.locations.length > 0) {
        console.log(`✅ Using ${trailheadConfig.locations.length} trailhead locations from YAML config`);
        return this.findNearestEdgeEndpointsToTrailheads(stagingSchema, trailheadConfig.locations, trailheadConfig.maxTrailheads);
      }
      
      // Use manual trailhead nodes (if any exist in database)
      if (trailheadConfig.selectionStrategy === 'manual') {
        console.log('🔍 Looking for manual trailhead nodes in database...');
        const manualTrailheadNodes = await this.pgClient.query(`
          SELECT 
            rn.id,
            rn.node_type,
            COALESCE(nm.connection_count, 1) as connection_count,
            rn.lat as lat,
            rn.lng as lon,
            'manual_trailhead' as entry_type
          FROM ${stagingSchema}.routing_nodes rn
          LEFT JOIN ${stagingSchema}.node_mapping nm ON rn.id = nm.pg_id
          WHERE rn.node_type = 'trailhead'
          ORDER BY nm.connection_count ASC, rn.id
          LIMIT $1
        `, [trailheadConfig.maxTrailheads]);
        
        console.log(`✅ Found ${manualTrailheadNodes.rows.length} manual trailhead nodes`);
        
        if (manualTrailheadNodes.rows.length === 0) {
          console.warn('⚠️ No manual trailheads found - falling back to default entry points');
          return this.getDefaultNetworkEntryPoints(stagingSchema, maxEntryPoints);
        }
        
        return manualTrailheadNodes.rows;
      }
      
      // Auto detection (not implemented yet)
      if (trailheadConfig.selectionStrategy === 'auto') {
        console.log('⚠️ Auto trailhead detection not implemented yet - falling back to default entry points');
        return this.getDefaultNetworkEntryPoints(stagingSchema, maxEntryPoints);
      }
      
      // Fallback to default if no valid strategy
      console.warn('⚠️ No valid trailhead strategy found - falling back to default entry points');
      return this.getDefaultNetworkEntryPoints(stagingSchema, maxEntryPoints);
    } else {
      // Use default logic (existing behavior)
      return this.getDefaultNetworkEntryPoints(stagingSchema, maxEntryPoints);
    }
  }

  /**
   * Find the nearest edge endpoints to trailhead coordinates
   * This implements the correct flow: YAML coordinates -> nearest edge endpoints
   */
  async findNearestEdgeEndpointsToTrailheads(
    stagingSchema: string,
    trailheadLocations: Array<{name?: string, lat: number, lng: number, tolerance_meters?: number}>,
    maxTrailheads: number = 50
  ): Promise<any[]> {
    console.log(`🔍 Finding nearest edge endpoints to ${trailheadLocations.length} trailhead coordinates...`);
    
    const nearestEndpoints: any[] = [];
    
    for (const trailhead of trailheadLocations) {
      const tolerance = trailhead.tolerance_meters || 100; // Default 100m tolerance
      
      console.log(`🔍 Finding nearest edge endpoints to trailhead: ${trailhead.name || 'unnamed'} at (${trailhead.lat}, ${trailhead.lng}) with ${tolerance}m tolerance`);
      
      // Find the nearest edge endpoints (nodes) to this trailhead coordinate
      const nearestNodes = await this.pgClient.query(`
        SELECT 
          v.id,
          'endpoint' as node_type,
          1 as connection_count,
          ST_X(v.the_geom) as lon,
          ST_Y(v.the_geom) as lat,
          'trailhead_endpoint' as entry_type,
          ST_Distance(v.the_geom, ST_SetSRID(ST_Point($1, $2), 4326)) as distance_meters,
          $3 as trailhead_name
        FROM ${stagingSchema}.ways_noded_vertices_pgr v
        WHERE ST_DWithin(v.the_geom, ST_SetSRID(ST_Point($1, $2), 4326), $4)
        ORDER BY ST_Distance(v.the_geom, ST_SetSRID(ST_Point($1, $2), 4326))
        LIMIT 5
      `, [trailhead.lng, trailhead.lat, trailhead.name || 'unnamed', tolerance]);
      
      if (nearestNodes.rows.length > 0) {
        console.log(`✅ Found ${nearestNodes.rows.length} nearest edge endpoints for trailhead ${trailhead.name || 'unnamed'}`);
        nearestEndpoints.push(...nearestNodes.rows);
      } else {
        console.warn(`⚠️ No edge endpoints found within ${tolerance}m of trailhead ${trailhead.name || 'unnamed'}`);
      }
    }
    
    // Limit to maxTrailheads and remove duplicates
    const uniqueEndpoints = nearestEndpoints
      .filter((endpoint, index, self) => 
        index === self.findIndex(e => e.id === endpoint.id)
      )
      .slice(0, maxTrailheads);
    
    console.log(`✅ Found ${uniqueEndpoints.length} unique edge endpoints near trailhead coordinates`);
    
    // Log some examples for debugging
    if (uniqueEndpoints.length > 0) {
      console.log('🔍 Example trailhead endpoints:');
      uniqueEndpoints.slice(0, 5).forEach((endpoint, i) => {
        console.log(`  ${i + 1}. ${endpoint.trailhead_name} -> endpoint ${endpoint.id} at (${endpoint.lon.toFixed(4)}, ${endpoint.lat.toFixed(4)}) - ${endpoint.distance_meters.toFixed(1)}m away`);
      });
    }
    
    return uniqueEndpoints;
  }

  /**
   * Get default network entry points (original logic)
   */
  private async getDefaultNetworkEntryPoints(stagingSchema: string, maxEntryPoints: number = 50): Promise<any[]> {
    // First, get nodes with very low connection counts (likely trailheads)
    const trailheadNodes = await this.pgClient.query(`
      SELECT nm.pg_id as id, nm.node_type, nm.connection_count, 
             ST_X(v.the_geom) as lon, 
             ST_Y(v.the_geom) as lat,
             'trailhead' as entry_type
      FROM ${stagingSchema}.node_mapping nm
      JOIN ${stagingSchema}.ways_noded_vertices_pgr v ON nm.pg_id = v.id
      WHERE nm.node_type IN ('intersection', 'simple_connection')
      AND nm.connection_count <= 2
      ORDER BY nm.connection_count ASC, nm.pg_id
      LIMIT 30
    `);
    
    // Then, get edge nodes with moderate connections (good starting points)
    const edgeNodes = await this.pgClient.query(`
      SELECT nm.pg_id as id, nm.node_type, nm.connection_count, 
             ST_X(v.the_geom) as lon, 
             ST_Y(v.the_geom) as lat,
             'edge' as entry_type
      FROM ${stagingSchema}.node_mapping nm
      JOIN ${stagingSchema}.ways_noded_vertices_pgr v ON nm.pg_id = v.id
      WHERE nm.node_type IN ('intersection', 'simple_connection')
      AND nm.connection_count BETWEEN 3 AND 4
      ORDER BY nm.connection_count ASC, nm.pg_id
      LIMIT 20
    `);
    
    // Combine and prioritize trailheads first, then edge nodes
    const allEntryPoints = [...trailheadNodes.rows, ...edgeNodes.rows];
    
    console.log(`✅ Found ${trailheadNodes.rows.length} trailhead nodes and ${edgeNodes.rows.length} edge nodes`);
    console.log(`🔍 Total entry points: ${allEntryPoints.length}`);
    
    // Log some examples for debugging
    if (allEntryPoints.length > 0) {
      console.log('🔍 Example entry points:');
      allEntryPoints.slice(0, 5).forEach((node, i) => {
        console.log(`  ${i + 1}. ${node.entry_type} node ${node.id} (${node.connection_count} connections) at (${node.lon.toFixed(4)}, ${node.lat.toFixed(4)})`);
      });
    }
    
    return allEntryPoints;
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
   * Execute KSP routing between two nodes with enhanced diversity
   */
  async executeKspRouting(
    stagingSchema: string, 
    startNode: number, 
    endNode: number,
    kValue: number = 10
  ): Promise<any[]> {
    // Use configurable K value for more diverse routes
    const kspResult = await this.pgClient.query(`
      SELECT * FROM pgr_ksp(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
        $1::bigint, $2::bigint, $3, false, false
      )
    `, [startNode, endNode, kValue]);
    
    return kspResult.rows;
  }

  /**
   * Execute A* routing for more efficient pathfinding
   */
  async executeAstarRouting(
    stagingSchema: string, 
    startNode: number, 
    endNode: number
  ): Promise<any[]> {
    const astarResult = await this.pgClient.query(`
      SELECT * FROM pgr_astar(
        'SELECT id, source, target, length_km as cost, 
                ST_X(ST_StartPoint(geometry)) as x1, ST_Y(ST_StartPoint(geometry)) as y1,
                ST_X(ST_EndPoint(geometry)) as x2, ST_Y(ST_EndPoint(geometry)) as y2
         FROM ${stagingSchema}.ways_noded',
        $1::bigint, $2::bigint, false
      )
    `, [startNode, endNode]);
    
    return astarResult.rows;
  }

  /**
   * Execute bidirectional Dijkstra for better performance on large networks
   */
  async executeBidirectionalDijkstra(
    stagingSchema: string, 
    startNode: number, 
    endNode: number
  ): Promise<any[]> {
    const bdResult = await this.pgClient.query(`
      SELECT * FROM pgr_bddijkstra(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
        $1::bigint, $2::bigint, false
      )
    `, [startNode, endNode]);
    
    return bdResult.rows;
  }

  /**
   * Execute Chinese Postman for optimal trail coverage
   * This finds the shortest route that covers all edges at least once
   */
  async executeChinesePostman(stagingSchema: string): Promise<any[]> {
    const cpResult = await this.pgClient.query(`
      SELECT * FROM pgr_chinesepostman(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded'
      )
    `);
    
    return cpResult.rows;
  }

  /**
   * Execute Hawick Circuits for finding all cycles in the network
   * This is excellent for loop route generation
   */
  async executeHawickCircuits(stagingSchema: string): Promise<any[]> {
    const hcResult = await this.pgClient.query(`
      SELECT * FROM pgr_hawickcircuits(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded'
      )
    `);
    
    return hcResult.rows;
  }

  /**
   * Execute withPointsKSP for routes that can start/end at any point along trails
   * This allows for more flexible route generation
   */
  async executeWithPointsKsp(
    stagingSchema: string, 
    startNode: number, 
    endNode: number
  ): Promise<any[]> {
    const wpkspResult = await this.pgClient.query(`
      SELECT * FROM pgr_withpointsksp(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
        'SELECT pid, edge_id, fraction FROM ${stagingSchema}.points_of_interest',
        ARRAY[$1::bigint], ARRAY[$2::bigint], 6, 'd', false, false
      )
    `, [startNode, endNode]);
    
    return wpkspResult.rows;
  }

  /**
   * Get route edges by IDs with split trail metadata
   */
  async getRouteEdges(stagingSchema: string, edgeIds: number[]): Promise<any[]> {
    const routeEdges = await this.pgClient.query(`
      SELECT 
        w.*,
        COALESCE(em.app_uuid, 'unknown') as app_uuid,
        COALESCE(em.trail_name, 'Unnamed Trail') as trail_name,
        w.length_km as trail_length_km,
        w.elevation_gain as trail_elevation_gain,
        w.elevation_loss as elevation_loss,
        'hiking' as trail_type,
        'dirt' as surface,
        'moderate' as difficulty,
        0 as max_elevation,
        0 as min_elevation,
        0 as avg_elevation
      FROM ${stagingSchema}.ways_noded w
      LEFT JOIN ${stagingSchema}.edge_mapping em ON w.id = em.pg_id
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
        input_length_km, input_elevation_gain,
        recommended_length_km, recommended_elevation_gain,
        route_path, route_edges, trail_count, route_score,
        similarity_score, region, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
    `, [
      recommendation.route_uuid, recommendation.route_name, recommendation.route_type, recommendation.route_shape,
              recommendation.input_length_km, recommendation.input_elevation_gain,
        recommendation.recommended_length_km, recommendation.recommended_elevation_gain,
      recommendation.route_path, JSON.stringify(recommendation.route_edges),
      recommendation.trail_count, recommendation.route_score, recommendation.similarity_score, recommendation.region
    ]);
  }
} 