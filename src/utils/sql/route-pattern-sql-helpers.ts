import { Pool } from 'pg';
import { RoutePattern } from '../ksp-route-generator';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';

export class RoutePatternSqlHelpers {
  private configLoader: RouteDiscoveryConfigLoader;

  constructor(private pgClient: Pool) {
    this.configLoader = RouteDiscoveryConfigLoader.getInstance();
  }

  private graphSigCache: string | null = null;
  private async getGraphSignature(stagingSchema: string, region: string, bbox?: [number, number, number, number]): Promise<string> {
    if (this.graphSigCache) return this.graphSigCache;
    const { getNetworkCacheConfig } = await import('../config-loader');
    const cacheCfg = getNetworkCacheConfig();
    if (!cacheCfg.enableCompletedNetworkCache) {
      this.graphSigCache = 'nocache';
      return this.graphSigCache;
    }
    const { RouteCacheService } = await import('../cache/route-cache');
    const cache = new RouteCacheService(this.pgClient, cacheCfg.cacheSchema);
    await cache.ensureSchemaAndTables();
    this.graphSigCache = await cache.computeGraphSignature(stagingSchema, region, bbox as any);
    return this.graphSigCache;
  }

  /**
   * Load out-and-back route patterns
   */
  async loadOutAndBackPatterns(): Promise<RoutePattern[]> {
    console.log('📋 Loading out-and-back route patterns...');
    
    const patternsResult = await this.pgClient.query(`
      SELECT * FROM public.route_patterns 
      WHERE route_shape = 'out-and-back'
      ORDER BY target_distance_km DESC
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
   * Validate that a route only uses actual trail edges
   * This prevents artificial connections between distant nodes
   */
  async validateRouteEdges(
    stagingSchema: string, 
    edgeIds: number[]
  ): Promise<{ isValid: boolean; reason?: string }> {
    if (edgeIds.length === 0) {
      return { isValid: false, reason: 'No edges provided' };
    }

    // Check that all edges exist and are valid trail edges
    const validationResult = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(*) FILTER (WHERE source IS NOT NULL AND target IS NOT NULL) as connected_edges,
        COUNT(*) FILTER (WHERE app_uuid IS NOT NULL AND name IS NOT NULL) as trail_edges,
        COUNT(*) FILTER (WHERE length_km <= 2.0) as reasonable_length_edges,
        COUNT(*) FILTER (WHERE length_km > 2.0) as long_edges,
        MAX(length_km) as max_edge_length,
        MIN(length_km) as min_edge_length
      FROM ${stagingSchema}.ways_noded
      WHERE id = ANY($1::integer[])
    `, [edgeIds]);

    const stats = validationResult.rows[0];
    
    // Validation checks
    if (stats.total_edges !== edgeIds.length) {
      return { isValid: false, reason: `Missing edges: expected ${edgeIds.length}, found ${stats.total_edges}` };
    }
    
    if (stats.connected_edges !== edgeIds.length) {
      return { isValid: false, reason: `Disconnected edges: ${edgeIds.length - stats.connected_edges} edges have null source/target` };
    }
    
    if (stats.trail_edges !== edgeIds.length) {
      return { isValid: false, reason: `Non-trail edges: ${edgeIds.length - stats.trail_edges} edges missing app_uuid or name` };
    }
    
    if (stats.long_edges > 0) {
      return { isValid: false, reason: `Long edges detected: ${stats.long_edges} edges > 2km (max: ${stats.max_edge_length.toFixed(2)}km)` };
    }
    
    if (stats.max_edge_length > 2.0) {
      return { isValid: false, reason: `Edge too long: ${stats.max_edge_length.toFixed(2)}km exceeds 2km limit` };
    }

    return { isValid: true };
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
    const cfg = this.configLoader.loadConfig();
    const corridor = cfg.corridor;
    const corridorSql = (() => {
      if (!corridor || !corridor.enabled) return '';
      if (corridor.mode === 'polyline-buffer' && corridor.polyline && corridor.polyline.length >= 2) {
        const coords = corridor.polyline.map(p => `${p[0]} ${p[1]}`).join(', ');
        const buf = corridor.bufferMeters || 200;
        return ` AND ST_Intersects(ways_noded.the_geom, ST_Buffer(ST_SetSRID(ST_GeomFromText('LINESTRING(${coords})'), 4326)::geography, ${buf})::geometry)`;
      }
      if (corridor.bbox && corridor.bbox.length === 4) {
        const [minLng, minLat, maxLng, maxLat] = corridor.bbox;
        return ` AND ST_Intersects(ways_noded.the_geom, ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326))`;
      }
      return '';
    })();
    // Cache layer (optional)
    const { getNetworkCacheConfig } = await import('../config-loader');
    const cacheCfg = getNetworkCacheConfig();
    const constraintsSig = 'len<=2.0&trailOnly&named';
    let graphSig = 'nocache';
    if (cacheCfg.enableCompletedNetworkCache) {
      graphSig = await this.getGraphSignature(stagingSchema, 'unknown');
      const { RouteCacheService } = await import('../cache/route-cache');
      const cache = new RouteCacheService(this.pgClient, cacheCfg.cacheSchema);
      const hit = await cache.getKspPaths(graphSig, startNode, endNode, kValue, constraintsSig);
      if (hit && hit.paths && hit.paths.length > 0) {
        console.log(`🗃️ KSP cache HIT: ${startNode}→${endNode} (k=${kValue}) paths=${hit.paths.length}`);
        // Reconstruct rows in the same shape as pgr_ksp output (edge list per path)
        const rows: any[] = [];
        hit.paths.forEach((edgeList, idx) => {
          let seq = 1;
          edgeList.forEach((edgeId) => {
            rows.push({ path_id: idx + 1, path_seq: seq++, edge: edgeId });
          });
        });
        return rows;
      }
      console.log(`🗃️ KSP cache MISS: ${startNode}→${endNode} (k=${kValue})`);
    }

    // Miss: query pgr_ksp and then cache
    const client = await this.pgClient.connect();
    let rows: any[] = [];
    try {
      await client.query('BEGIN');
      if (cfg.routing?.statementTimeoutMs) {
        await client.query(`SET LOCAL statement_timeout TO '${Math.max(1, cfg.routing.statementTimeoutMs)}'`);
      }
      const kspResult = await client.query(
        `SELECT * FROM pgr_ksp(
          'SELECT id, source, target, length_km as cost 
           FROM ${stagingSchema}.ways_noded ways_noded
           WHERE source IS NOT NULL 
             AND target IS NOT NULL 
             AND length_km <= 2.0  -- Prevent use of extremely long edges (>2km)
             AND app_uuid IS NOT NULL  -- Ensure edge is part of actual trail
             AND name IS NOT NULL  -- Ensure edge has a trail name
             ${corridorSql}
           ORDER BY id',
          $1::bigint, $2::bigint, $3, false, false
        )`,
        [startNode, endNode, kValue]
      );
      rows = kspResult.rows;
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw err;
    } finally {
      client.release();
    }

    if (cacheCfg.enableCompletedNetworkCache && rows && rows.length > 0) {
      // Group by path_id into edge lists and store
      const pathsMap = new Map<number, number[]>();
      for (const r of rows) {
        if (!pathsMap.has(r.path_id)) pathsMap.set(r.path_id, []);
        if (typeof r.edge === 'number' && r.edge !== -1) pathsMap.get(r.path_id)!.push(r.edge);
      }
      const paths = Array.from(pathsMap.keys()).sort((a, b) => a - b).map((pid) => pathsMap.get(pid)!);
      const { RouteCacheService } = await import('../cache/route-cache');
      const cache = new RouteCacheService(this.pgClient, cacheCfg.cacheSchema);
      await cache.setKspPaths(graphSig, startNode, endNode, kValue, constraintsSig, paths);
      console.log(`🗃️ KSP cache STORE: ${startNode}→${endNode} (k=${kValue}) paths=${paths.length}`);
    }

    return rows;
  }

  /**
   * Execute A* routing for more efficient pathfinding
   */
  async executeAstarRouting(
    stagingSchema: string, 
    startNode: number, 
    endNode: number
  ): Promise<any[]> {
    const cfg = this.configLoader.loadConfig();
    const corridor = cfg.corridor;
    const corridorSql = (() => {
      if (!corridor || !corridor.enabled) return '';
      if (corridor.mode === 'polyline-buffer' && corridor.polyline && corridor.polyline.length >= 2) {
        const coords = corridor.polyline.map(p => `${p[0]} ${p[1]}`).join(', ');
        const buf = corridor.bufferMeters || 200;
        return ` AND ST_Intersects(ways_noded.the_geom, ST_Buffer(ST_SetSRID(ST_GeomFromText('LINESTRING(${coords})'), 4326)::geography, ${buf})::geometry)`;
      }
      if (corridor.bbox && corridor.bbox.length === 4) {
        const [minLng, minLat, maxLng, maxLat] = corridor.bbox;
        return ` AND ST_Intersects(ways_noded.the_geom, ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326))`;
      }
      return '';
    })();
    const client = await this.pgClient.connect();
    try {
      await client.query('BEGIN');
      if (cfg.routing?.statementTimeoutMs) {
        await client.query(`SET LOCAL statement_timeout TO '${Math.max(1, cfg.routing.statementTimeoutMs)}'`);
      }
      const astarResult = await client.query(`
        SELECT * FROM pgr_astar(
        'SELECT id, source, target, length_km as cost, 
                ST_X(ST_StartPoint(the_geom)) as x1, ST_Y(ST_StartPoint(the_geom)) as y1,
                ST_X(ST_EndPoint(the_geom)) as x2, ST_Y(ST_EndPoint(the_geom)) as y2
         FROM ${stagingSchema}.ways_noded ways_noded
         WHERE source IS NOT NULL 
           AND target IS NOT NULL 
           AND length_km <= 2.0  -- Prevent use of extremely long edges (>2km)
           AND app_uuid IS NOT NULL  -- Ensure edge is part of actual trail
           AND name IS NOT NULL  -- Ensure edge has a trail name
           ${corridorSql}
         ORDER BY id',
        $1::bigint, $2::bigint, false
        )
      `, [startNode, endNode]);
      await client.query('COMMIT');
      return astarResult.rows;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Execute bidirectional Dijkstra for better performance on large networks
   */
  async executeBidirectionalDijkstra(
    stagingSchema: string, 
    startNode: number, 
    endNode: number
  ): Promise<any[]> {
    const cfg = this.configLoader.loadConfig();
    const corridor = cfg.corridor;
    const corridorSql = (() => {
      if (!corridor || !corridor.enabled) return '';
      if (corridor.mode === 'polyline-buffer' && corridor.polyline && corridor.polyline.length >= 2) {
        const coords = corridor.polyline.map(p => `${p[0]} ${p[1]}`).join(', ');
        const buf = corridor.bufferMeters || 200;
        return ` AND ST_Intersects(ways_noded.the_geom, ST_Buffer(ST_SetSRID(ST_GeomFromText('LINESTRING(${coords})'), 4326)::geography, ${buf})::geometry)`;
      }
      if (corridor.bbox && corridor.bbox.length === 4) {
        const [minLng, minLat, maxLng, maxLat] = corridor.bbox;
        return ` AND ST_Intersects(ways_noded.the_geom, ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326))`;
      }
      return '';
    })();

    const client = await this.pgClient.connect();
    try {
      await client.query('BEGIN');
      if (cfg.routing?.statementTimeoutMs) {
        await client.query(`SET LOCAL statement_timeout TO '${Math.max(1, cfg.routing.statementTimeoutMs)}'`);
      }
      const bdResult = await client.query(`
        SELECT * FROM pgr_bddijkstra(
        'SELECT id, source, target, length_km as cost 
         FROM ${stagingSchema}.ways_noded ways_noded
         WHERE source IS NOT NULL 
           AND target IS NOT NULL 
           AND length_km <= 2.0  -- Prevent use of extremely long edges (>2km)
           AND app_uuid IS NOT NULL  -- Ensure edge is part of actual trail
           AND name IS NOT NULL  -- Ensure edge has a trail name
           ${corridorSql}
         ORDER BY id',
        $1::bigint, $2::bigint, false
        )
      `, [startNode, endNode]);
      await client.query('COMMIT');
      return bdResult.rows;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Execute Chinese Postman for optimal trail coverage
   * This finds the shortest route that covers all edges at least once
   */
  async executeChinesePostman(stagingSchema: string): Promise<any[]> {
    const cpResult = await this.pgClient.query(`
      SELECT * FROM pgr_chinesepostman(
        'SELECT id, source, target, length_km as cost 
         FROM ${stagingSchema}.ways_noded
         WHERE source IS NOT NULL 
           AND target IS NOT NULL 
           AND length_km <= 2.0  -- Prevent use of extremely long edges (>2km)
           AND app_uuid IS NOT NULL  -- Ensure edge is part of actual trail
           AND name IS NOT NULL  -- Ensure edge has a trail name
         ORDER BY id'
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
        'SELECT id, source, target, length_km as cost 
         FROM ${stagingSchema}.ways_noded
         WHERE source IS NOT NULL 
           AND target IS NOT NULL 
           AND length_km <= 2.0  -- Prevent use of extremely long edges (>2km)
           AND app_uuid IS NOT NULL  -- Ensure edge is part of actual trail
           AND name IS NOT NULL  -- Ensure edge has a trail name
         ORDER BY id'
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
    const cfg = this.configLoader.loadConfig();
    const corridor = cfg.corridor;
    const corridorSql = (() => {
      if (!corridor || !corridor.enabled) return '';
      if (corridor.mode === 'polyline-buffer' && corridor.polyline && corridor.polyline.length >= 2) {
        const coords = corridor.polyline.map(p => `${p[0]} ${p[1]}`).join(', ');
        const buf = corridor.bufferMeters || 200;
        return ` WHERE source IS NOT NULL AND target IS NOT NULL AND ST_Intersects(ways_noded.the_geom, ST_Buffer(ST_SetSRID(ST_GeomFromText('LINESTRING(${coords})'), 4326)::geography, ${buf})::geometry)`;
      }
      if (corridor.bbox && corridor.bbox.length === 4) {
        const [minLng, minLat, maxLng, maxLat] = corridor.bbox;
        return ` WHERE source IS NOT NULL AND target IS NOT NULL AND ST_Intersects(ways_noded.the_geom, ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326))`;
      }
      return '';
    })();

    const wpkspResult = await this.pgClient.query(`
      SELECT * FROM pgr_withpointsksp(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded ways_noded${corridorSql}',
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
    try {
      console.log(`💾 Storing route recommendation: ${recommendation.route_uuid}`);
      console.log(`   - Schema: ${stagingSchema}`);
      console.log(`   - Route name: ${recommendation.route_name}`);
      console.log(`   - Route type: ${recommendation.route_type}`);
      console.log(`   - Trail count: ${recommendation.trail_count}`);
      
      // Generate complete_route_data in the expected API format
      const completeRouteData = {
        routeId: recommendation.route_uuid,
        routeName: recommendation.route_name,
        routeType: recommendation.trail_count === 1 ? 'single' : 'multi',
        totalDistance: recommendation.recommended_length_km,
        totalElevationGain: recommendation.recommended_elevation_gain,
        routeShape: recommendation.route_shape,
        similarityScore: recommendation.similarity_score,
        trailSegments: recommendation.route_edges?.map((edge: any, index: number) => ({
          trailId: edge.trail_id || edge.trail_uuid,
          appUuid: edge.app_uuid,
          osmId: edge.osm_id,
          name: edge.trail_name || edge.name,
          geometry: edge.geometry || edge.the_geom,
          distance: edge.distance_km || edge.length_km,
          elevationGain: edge.elevation_gain,
          elevationLoss: edge.elevation_loss
        })) || [],
        connectivity: {
          segmentConnections: [],
          routeContinuity: true,
          gaps: []
        },
        combinedPath: recommendation.route_path,
        combinedBbox: null, // Will be calculated if needed
        createdAt: new Date().toISOString(),
        region: recommendation.region,
        inputParameters: {
          targetDistance: recommendation.input_length_km,
          targetElevationGain: recommendation.input_elevation_gain,
          distanceTolerance: 10, // Default tolerance
          elevationTolerance: 20 // Default tolerance
        }
      };

      await this.pgClient.query(`
        INSERT INTO ${stagingSchema}.route_recommendations (
          route_uuid, route_name, route_type, route_shape,
          input_length_km, input_elevation_gain,
          recommended_length_km, recommended_elevation_gain,
          route_path, route_edges, trail_count, route_score,
          similarity_score, region, complete_route_data, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
      `, [
        recommendation.route_uuid, recommendation.route_name, recommendation.route_type, recommendation.route_shape,
        recommendation.input_length_km, recommendation.input_elevation_gain,
        recommendation.recommended_length_km, recommendation.recommended_elevation_gain,
        recommendation.route_path, JSON.stringify(recommendation.route_edges),
        recommendation.trail_count, recommendation.route_score, recommendation.similarity_score, recommendation.region,
        JSON.stringify(completeRouteData)
      ]);
      
      // Populate route_trails table with individual trail segments
      if (recommendation.route_edges && recommendation.route_edges.length > 0) {
        console.log(`💾 Storing ${recommendation.route_edges.length} trail segments for route: ${recommendation.route_uuid}`);
        
        for (let i = 0; i < recommendation.route_edges.length; i++) {
          const edge = recommendation.route_edges[i];
          await this.pgClient.query(`
            INSERT INTO ${stagingSchema}.route_trails (
              route_uuid, trail_id, trail_name, segment_order,
              segment_length_km, segment_elevation_gain, trail_type, surface, difficulty, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
          `, [
            recommendation.route_uuid,
            edge.trail_id || edge.trail_uuid || edge.app_uuid,
            edge.trail_name || edge.name,
            i + 1, // segment_order (1-based)
            edge.distance_km || edge.length_km,
            edge.elevation_gain || 0,
            edge.trail_type || 'hiking',
            edge.surface || 'unknown',
            edge.difficulty || 'moderate'
          ]);
        }
        
        console.log(`✅ Successfully stored ${recommendation.route_edges.length} trail segments for route: ${recommendation.route_uuid}`);
      }
      
      console.log(`✅ Successfully stored route: ${recommendation.route_uuid}`);
    } catch (error) {
      console.error(`❌ Failed to store route ${recommendation.route_uuid}:`, error);
      console.error(`   - Schema: ${stagingSchema}`);
      console.error(`   - Recommendation data:`, JSON.stringify(recommendation, null, 2));
      throw error;
    }
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
      
      // Fallback to default entry points
      console.log('⚠️ No trailhead strategy matched - falling back to default entry points');
      return this.getDefaultNetworkEntryPoints(stagingSchema, maxEntryPoints);
    }
    
    // Default behavior: use all available nodes
    console.log('✅ Using default network entry points (all available nodes)');
    return this.getDefaultNetworkEntryPoints(stagingSchema, maxEntryPoints);
  }

  /**
   * Get default network entry points (all available nodes)
   */
  private async getDefaultNetworkEntryPoints(stagingSchema: string, maxEntryPoints: number = 50): Promise<any[]> {
    const cfg = this.configLoader.loadConfig();
    const corridor = cfg.corridor;
    const corridorSql = (() => {
      if (!corridor || !corridor.enabled) return '';
      if (corridor.mode === 'polyline-buffer' && corridor.polyline && corridor.polyline.length >= 2) {
        const coords = corridor.polyline.map(p => `${p[0]} ${p[1]}`).join(', ');
        const buf = corridor.bufferMeters || 200;
        return ` AND ST_Intersects(v.the_geom, ST_Buffer(ST_SetSRID(ST_GeomFromText('LINESTRING(${coords})'), 4326)::geography, ${buf})::geometry)`;
      }
      if (corridor.bbox && corridor.bbox.length === 4) {
        const [minLng, minLat, maxLng, maxLat] = corridor.bbox;
        return ` AND ST_Intersects(v.the_geom, ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326))`;
      }
      return '';
    })();

    const entryPoints = await this.pgClient.query(`
      SELECT 
        v.id,
        'endpoint' as node_type,
        COALESCE(nm.connection_count, 1) as connection_count,
        ST_Y(v.the_geom) as lat,
        ST_X(v.the_geom) as lon,
        'default' as entry_type
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      LEFT JOIN ${stagingSchema}.node_mapping nm ON v.id = nm.pg_id
      WHERE nm.node_type IN ('intersection', 'endpoint')
        ${corridorSql}
      ORDER BY nm.connection_count DESC, v.id
      LIMIT $1
    `, [maxEntryPoints]);
    
    return entryPoints.rows;
  }

  /**
   * Find nearest edge endpoints to trailhead coordinates
   */
  private async findNearestEdgeEndpointsToTrailheads(
    stagingSchema: string,
    trailheadLocations: Array<{name?: string, lat: number, lng: number, tolerance_meters?: number}>,
    maxTrailheads: number = 50
  ): Promise<any[]> {
    const trailheadNodes: any[] = [];
    
    for (const location of trailheadLocations.slice(0, maxTrailheads)) {
      const tolerance = location.tolerance_meters || 50;
      
      // Find the nearest node to this coordinate location
      const nearestNode = await this.pgClient.query(`
        SELECT 
          v.id,
          'endpoint' as node_type,
          COALESCE(nm.connection_count, 1) as connection_count,
          ST_Y(v.the_geom) as lat,
          ST_X(v.the_geom) as lon,
          ST_Distance(
            ST_SetSRID(ST_MakePoint($1, $2), 4326),
            v.the_geom
          ) * 111000 as distance_meters
        FROM ${stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN ${stagingSchema}.node_mapping nm ON v.id = nm.pg_id
        WHERE ST_DWithin(
          ST_SetSRID(ST_MakePoint($1, $2), 4326),
          v.the_geom,
          $3 / 111000.0
        )
        ORDER BY distance_meters ASC
        LIMIT 1
      `, [location.lng, location.lat, tolerance]);
      
      if (nearestNode.rows.length > 0) {
        const node = nearestNode.rows[0];
        console.log(`✅ Found trailhead node: ID ${node.id} at ${node.lat}, ${node.lon} (distance: ${node.distance_meters.toFixed(1)}m)`);
        trailheadNodes.push(node);
      } else {
        console.log(`❌ No routing nodes found within ${tolerance}m of ${location.lat}, ${location.lng}`);
      }
    }
    
    console.log(`🔍 Found ${trailheadNodes.length} trailhead nodes total`);
    return trailheadNodes.slice(0, maxTrailheads);
  }

  /**
   * Find nodes reachable from a starting node within a maximum distance
   */
  async findReachableNodes(
    stagingSchema: string, 
    startNode: number, 
    maxDistance: number
  ): Promise<any[]> {
    const { getNetworkCacheConfig } = await import('../config-loader');
    const cacheCfg = getNetworkCacheConfig();
    let graphSig = 'nocache';
    if (cacheCfg.enableCompletedNetworkCache) {
      graphSig = await this.getGraphSignature(stagingSchema, 'unknown');
      const { RouteCacheService } = await import('../cache/route-cache');
      const cache = new RouteCacheService(this.pgClient, cacheCfg.cacheSchema);
      const hit = await cache.getReachableNodes(graphSig, startNode, maxDistance);
      if (hit && hit.results) {
        console.log(`🗃️ Reachability cache HIT: start=${startNode} max=${maxDistance}km results=${hit.results.length}`);
        return hit.results.map(r => ({ node_id: r.node_id, distance_km: r.distance_km }));
      }
      console.log(`🗃️ Reachability cache MISS: start=${startNode} max=${maxDistance}km`);
    }

    const client = await this.pgClient.connect();
    let rows: any[] = [];
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout TO '30000'");
      const cfg = this.configLoader.loadConfig();
      const corridor = cfg.corridor;
      const corridorSql = (() => {
        if (!corridor || !corridor.enabled) return '';
        if (corridor.mode === 'polyline-buffer' && corridor.polyline && corridor.polyline.length >= 2) {
          const coords = corridor.polyline.map(p => `${p[0]} ${p[1]}`).join(', ');
          const buf = corridor.bufferMeters || 200;
          return ` AND ST_Intersects(ways_noded.the_geom, ST_Buffer(ST_SetSRID(ST_GeomFromText('LINESTRING(${coords})'), 4326)::geography, ${buf})::geometry)`;
        }
        if (corridor.bbox && corridor.bbox.length === 4) {
          const [minLng, minLat, maxLng, maxLat] = corridor.bbox;
          return ` AND ST_Intersects(ways_noded.the_geom, ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326))`;
        }
        return '';
      })();

      const reachableNodes = await client.query(
        `SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
         FROM pgr_dijkstra(
           'SELECT id, source, target, length_km as cost 
            FROM ${stagingSchema}.ways_noded ways_noded
            WHERE source IS NOT NULL 
              AND target IS NOT NULL 
              AND length_km <= 2.0  -- Prevent use of extremely long edges (>2km)
              AND app_uuid IS NOT NULL  -- Ensure edge is part of actual trail
              AND name IS NOT NULL  -- Ensure edge has a trail name
              ${corridorSql}
            ORDER BY id',
           $1::bigint, 
           (SELECT array_agg(pg_id) FROM ${stagingSchema}.node_mapping WHERE node_type IN ('intersection', 'endpoint')),
           false
         )
         WHERE agg_cost <= $2
         AND end_vid != $1
         ORDER BY agg_cost DESC
         LIMIT 10`,
        [startNode, maxDistance]
      );
      rows = reachableNodes.rows;
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
    if (cacheCfg.enableCompletedNetworkCache && rows) {
      const { RouteCacheService } = await import('../cache/route-cache');
      const cache = new RouteCacheService(this.pgClient, cacheCfg.cacheSchema);
      await cache.setReachableNodes(
        graphSig,
        startNode,
        maxDistance,
        rows.map((r: any) => ({ node_id: r.node_id, distance_km: r.distance_km }))
      );
      console.log(`🗃️ Reachability cache STORE: start=${startNode} max=${maxDistance}km results=${rows.length}`);
    }
    return rows;
  }
} 