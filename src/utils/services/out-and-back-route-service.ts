import { Pool } from 'pg';
import { RouteRecommendation } from '../ksp-route-generator';
import { ConstituentTrailAnalysisService } from './constituent-trail-analysis-service';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';

export interface OutAndBackRouteServiceConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  minDistanceBetweenRoutes: number;
  kspKValue: number;
  useTrailheadsOnly?: boolean;
  trailheadLocations?: Array<{
    name?: string;
    lat: number;
    lng: number;
    tolerance_meters?: number;
  }>;
}

export interface OutAndBackPattern {
  pattern_name: string;
  target_distance_km: number;
  target_elevation_gain: number;
  route_shape: 'out-and-back';
}

/**
 * Dedicated service for generating out-and-back routes
 * Consolidates all out-and-back route generation logic in one place
 */
export class OutAndBackRouteService {
  private constituentAnalysisService: ConstituentTrailAnalysisService;
  private configLoader: RouteDiscoveryConfigLoader;

  constructor(
    private pgClient: Pool,
    private config: OutAndBackRouteServiceConfig
  ) {
    this.constituentAnalysisService = new ConstituentTrailAnalysisService(pgClient);
    this.configLoader = RouteDiscoveryConfigLoader.getInstance();
  }

  /**
   * Generate all out-and-back routes for all patterns
   */
  async generateOutAndBackRoutes(): Promise<RouteRecommendation[]> {
    console.log('🎯 [OUT-AND-BACK] Starting out-and-back route generation...');
    
    const patterns = await this.getOutAndBackPatterns();
    const allRoutes: RouteRecommendation[] = [];
    
    for (const pattern of patterns) {
      console.log(`🎯 [OUT-AND-BACK] Processing pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
      
      const patternRoutes = await this.generateRoutesForPattern(pattern);
      allRoutes.push(...patternRoutes);
      
      console.log(`✅ [OUT-AND-BACK] Generated ${patternRoutes.length} routes for ${pattern.pattern_name}`);
    }
    
    console.log(`🎉 [OUT-AND-BACK] Total out-and-back routes generated: ${allRoutes.length}`);
    return allRoutes;
  }

  /**
   * Generate out-and-back routes for a specific pattern
   */
  private async generateRoutesForPattern(pattern: OutAndBackPattern): Promise<RouteRecommendation[]> {
    const routes: RouteRecommendation[] = [];
    
    // Get network components
    const components = await this.getNetworkComponents();
    console.log(`🔍 [OUT-AND-BACK] Found ${components.length} network components`);
    
    for (const component of components) {
      console.log(`🔍 [OUT-AND-BACK] Processing component ${component.componentId} with ${component.endpointCount} endpoints`);
      if (routes.length >= this.config.targetRoutesPerPattern) break;
      
      console.log(`🎯 [OUT-AND-BACK] Processing component ${component.componentId}`);
      const componentRoutes = await this.generateOutAndBackRoutesForComponent(
        component,
        pattern
      );
      
      console.log(`✅ [OUT-AND-BACK] Generated ${componentRoutes.length} routes for component ${component.componentId}`);
      routes.push(...componentRoutes);
    }
    
    return routes;
  }

  /**
   * Generate out-and-back routes for a specific network component
   */
  private async generateOutAndBackRoutesForComponent(
    component: any,
    pattern: OutAndBackPattern
  ): Promise<RouteRecommendation[]> {
    const routes: RouteRecommendation[] = [];
    
    // Find endpoints in this component
    const endpoints = await this.findEndpointsForComponent(component.componentId);
    
    if (endpoints.length < 2) {
      console.log(`⚠️ [OUT-AND-BACK] Not enough endpoints (${endpoints.length}) for component ${component.componentId}`);
      return routes;
    }
    
    console.log(`🎯 [OUT-AND-BACK] Found ${endpoints.length} endpoints for component ${component.componentId}`);
    
    // Generate routes between endpoint pairs
    for (let i = 0; i < endpoints.length && routes.length < this.config.targetRoutesPerPattern; i++) {
      const startEndpoint = endpoints[i];
      
      // Target half distance since we'll double it for out-and-back
      const halfTargetDistance = pattern.target_distance_km / 2;
      const halfTargetElevation = pattern.target_elevation_gain / 2;
      
      // Find paths from this endpoint
      const paths = await this.findKspPaths(
        startEndpoint.id,
        halfTargetDistance,
        halfTargetElevation
      );
      
      console.log(`🔍 [OUT-AND-BACK] Found ${paths.length} paths from endpoint ${startEndpoint.id} for target ${halfTargetDistance}km`);
      
      for (const path of paths) {
        if (routes.length >= this.config.targetRoutesPerPattern) break;
        
        const route = await this.createOutAndBackRoute(
          startEndpoint,
          path,
          pattern
        );
        
        if (route) {
          routes.push(route);
          console.log(`✅ [OUT-AND-BACK] Added route: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m)`);
        }
      }
    }
    
    return routes;
  }

  /**
   * Create an out-and-back route from a path
   */
  private async createOutAndBackRoute(
    startEndpoint: any,
    path: any[],
    pattern: OutAndBackPattern
  ): Promise<RouteRecommendation | null> {
    try {
      // Extract edge IDs from path and filter out invalid IDs
      const edgeIds = path
        .map(p => parseInt(p.edge))
        .filter(id => !isNaN(id) && id > 0); // Filter out NaN, -1, 0, etc.
      
      console.log(`🔍 [OUT-AND-BACK] Debug - edgeIds:`, edgeIds);
      console.log(`🔍 [OUT-AND-BACK] Debug - edgeIds type:`, typeof edgeIds, Array.isArray(edgeIds));
      
      if (edgeIds.length === 0) {
        return null;
      }
      
      // Generate out-and-back geometry directly in this service
      const routeGeometry = await this.generateOutAndBackGeometry(edgeIds, pattern.target_distance_km);
      
      if (!routeGeometry) {
        const errorMsg = `❌ [OUT-AND-BACK] CRITICAL ERROR: Failed to generate geometry for out-and-back route with ${edgeIds.length} edges, target distance: ${pattern.target_distance_km}km`;
        console.error(errorMsg);
        console.error(`❌ [OUT-AND-BACK] Edge IDs: ${edgeIds.join(', ')}`);
        throw new Error(errorMsg);
      }
      
      // Calculate metrics (double for out-and-back)
      const oneWayDistance = path.reduce((sum, p) => sum + (p.cost || 0), 0);
      const totalDistance = oneWayDistance * 2;
      
      // Get elevation data from edges
      const elevationData = await this.getElevationDataForEdges(edgeIds);
      const totalElevationGain = elevationData.elevation_gain * 2; // Double for out-and-back
      
      // Get trail names for route naming
      const trailNames = await this.getTrailNamesForEdges(edgeIds);
      const primaryTrailName = trailNames[0] || 'Unknown Trail';
      
      const route: RouteRecommendation = {
        route_uuid: `out-and-back-${startEndpoint.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        input_length_km: pattern.target_distance_km,
        input_elevation_gain: pattern.target_elevation_gain,
        recommended_length_km: totalDistance,
        recommended_elevation_gain: totalElevationGain,
        route_score: this.calculateRouteScore(totalDistance, totalElevationGain, pattern),
        route_type: 'out-and-back',
        route_name: `${pattern.pattern_name} via ${primaryTrailName}`,
        route_shape: 'out-and-back',
        trail_count: trailNames.length,
        route_path: null, // Redundant with route_geometry
        route_edges: edgeIds,
        route_geometry: routeGeometry,
        similarity_score: 0,
        region: this.config.region
      };
      
      return route;
    } catch (error) {
      console.error('❌ [OUT-AND-BACK] Error creating route:', error);
      return null;
    }
  }

  /**
   * Generate out-and-back geometry directly in this service
   * Creates a route that goes from start to midpoint, then back along the same path
   * For a target distance, finds the halfway point and creates out-and-back from there
   */
  private async generateOutAndBackGeometry(edgeIds: number[], targetDistanceKm: number): Promise<any> {
    if (!edgeIds || edgeIds.length === 0) {
      console.log('❌ [OUT-AND-BACK] No edge IDs provided for geometry generation');
      return null;
    }

    try {
      console.log(`🔍 [OUT-AND-BACK] Generating geometry for ${edgeIds.length} edges, target distance: ${targetDistanceKm}km`);
      console.log(`🔍 [OUT-AND-BACK] Edge IDs: ${edgeIds.slice(0, 5).join(', ')}${edgeIds.length > 5 ? '...' : ''}`);
      
      // For out-and-back routes, we need to:
      // 1. Calculate cumulative distance to find the midpoint (halfway point based on actual path distance)
      // 2. Use only edges up to the midpoint for the outbound path
      // 3. Copy that geometry, reverse it, and concatenate to create the full out-and-back route
      
      // For out-and-back routes, we need to:
      // 1. Calculate cumulative distance to find the midpoint (halfway point based on target distance)
      // 2. Use only edges up to the midpoint for the outbound path
      // 3. Copy that geometry, reverse it, and concatenate to create the full out-and-back route
      const midpointDistance = targetDistanceKm / 2; // Half of target distance for out-and-back
      
      console.log(`🔍 [OUT-AND-BACK] Target distance: ${targetDistanceKm.toFixed(3)}km, midpoint: ${midpointDistance.toFixed(3)}km`);
      
      const result = await this.pgClient.query(`
        WITH path(edge_id, ord) AS (
          SELECT edge_id::bigint, ord::int
          FROM unnest($1::bigint[]) WITH ORDINALITY AS u(edge_id, ord)
        ),
        ordered_edges AS (
          SELECT w.the_geom, w.length_km, p.ord
          FROM path p
          JOIN ${this.config.stagingSchema}.ways_noded w ON w.id = p.edge_id
          WHERE w.the_geom IS NOT NULL AND ST_IsValid(w.the_geom)
          ORDER BY p.ord
        ),
        cumulative_distances AS (
          -- Calculate cumulative distance for each edge
          SELECT 
            the_geom,
            length_km,
            ord,
            SUM(length_km) OVER (ORDER BY ord) AS cumulative_km
          FROM ordered_edges
        ),
        midpoint_edges AS (
          -- Select edges up to the midpoint (halfway point based on target distance)
          SELECT the_geom, length_km, ord
          FROM cumulative_distances
          WHERE cumulative_km <= $2
        ),
        outbound_to_midpoint AS (
          -- Create the outbound path to the midpoint
          SELECT ST_LineMerge(ST_Collect(the_geom ORDER BY ord)) AS outbound_geom
          FROM midpoint_edges
        ),
        complete_route AS (
          -- Create out-and-back route: outbound + reversed outbound
          -- Use ST_LineMerge with ST_Collect to ensure perfect continuity without artificial connectors
          SELECT ST_Force3D(
            ST_LineMerge(
              ST_Collect(
                o.outbound_geom,           -- Outbound: start to midpoint
                ST_Reverse(o.outbound_geom) -- Return: midpoint back to start (mirror image)
              )
            )
          ) AS route_geometry
          FROM outbound_to_midpoint o
          WHERE o.outbound_geom IS NOT NULL AND NOT ST_IsEmpty(o.outbound_geom)
        )
        SELECT route_geometry FROM complete_route
        WHERE route_geometry IS NOT NULL AND NOT ST_IsEmpty(route_geometry) AND ST_IsValid(route_geometry)
      `, [edgeIds, midpointDistance]);
      
      console.log(`🔍 [OUT-AND-BACK] Query result rows: ${result.rows.length}`);
      if (result.rows.length > 0) {
        const geometry = result.rows[0]?.route_geometry;
        console.log(`🔍 [OUT-AND-BACK] Geometry result: ${geometry ? 'VALID' : 'NULL'}`);
        if (geometry) {
          console.log(`🔍 [OUT-AND-BACK] Geometry type: ${geometry.type || 'unknown'}`);
        }
      } else {
        console.log('❌ [OUT-AND-BACK] No rows returned from geometry query');
      }
      
      return result.rows[0]?.route_geometry || null;
    } catch (error) {
      console.error('❌ [OUT-AND-BACK] Error generating out-and-back geometry:', error);
      console.error('❌ [OUT-AND-BACK] Error details:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * Get network components for routing
   */
  private async getNetworkComponents(): Promise<any[]> {
    // First, run pgr_connectedComponents to add component column
    await this.pgClient.query(`
      ALTER TABLE ${this.config.stagingSchema}.ways_noded_vertices_pgr 
      ADD COLUMN IF NOT EXISTS component INTEGER
    `);
    
    await this.pgClient.query(`
      UPDATE ${this.config.stagingSchema}.ways_noded_vertices_pgr 
      SET component = NULL
    `);
    
    const componentsResult = await this.pgClient.query(`
      SELECT (pgr_connectedComponents(
        'SELECT id, source, target, length_km as cost, length_km as reverse_cost FROM ${this.config.stagingSchema}.ways_noded'
      )).* 
    `);
    
    console.log(`🔍 [OUT-AND-BACK] pgr_connectedComponents returned ${componentsResult.rows.length} rows`);
    if (componentsResult.rows.length > 0) {
      console.log(`🔍 [OUT-AND-BACK] First component result:`, componentsResult.rows[0]);
    }
    
    // Update vertices with component information
    for (const row of componentsResult.rows) {
      await this.pgClient.query(`
        UPDATE ${this.config.stagingSchema}.ways_noded_vertices_pgr 
        SET component = $1 
        WHERE id = $2
      `, [row.component, row.node]);
    }
    
    const result = await this.pgClient.query(`
      SELECT DISTINCT component
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
      WHERE component IS NOT NULL
      ORDER BY component
    `);
    
    return result.rows.map(row => ({ componentId: row.component }));
  }

  /**
   * Find endpoints for a network component
   */
  private async findEndpointsForComponent(componentId: number): Promise<any[]> {
    const result = await this.pgClient.query(`
      SELECT DISTINCT v.id, v.the_geom, v.cnt as degree
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
      WHERE v.component = $1
        AND v.cnt <= 2  -- Endpoints and degree-2 intersections
      ORDER BY v.cnt, v.id
      LIMIT 50
    `, [componentId]);
    
    return result.rows;
  }

  /**
   * Find KSP paths from a starting point
   */
  private async findKspPaths(
    startNodeId: number,
    targetDistance: number,
    targetElevation: number
  ): Promise<any[]> {
    // Get potential destination nodes within the SAME component as startNodeId
    const destinations = await this.pgClient.query(`
      SELECT DISTINCT v.id
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
      WHERE v.id != $1 
        AND v.component = (SELECT component FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr WHERE id = $1)
      ORDER BY v.id
      LIMIT 20
    `, [startNodeId]);
    
    const allPaths: any[] = [];
    
    // Get the component of the start node for debugging
    const startNodeComponent = await this.pgClient.query(`
      SELECT component FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr WHERE id = $1
    `, [startNodeId]);
    
    console.log(`🔍 [OUT-AND-BACK] Routing within component ${startNodeComponent.rows[0]?.component || 'unknown'}`);
    console.log(`🔍 [OUT-AND-BACK] Found ${destinations.rows.length} potential destinations in same component`);
    
    for (const dest of destinations.rows) {
      console.log(`🔍 [OUT-AND-BACK] Attempting route from node ${startNodeId} to node ${dest.id} (both in component ${startNodeComponent.rows[0]?.component})`);
      try {
        const pathResult = await this.pgClient.query(`
          SELECT *
          FROM pgr_ksp(
            'SELECT id, source, target, length_km as cost, length_km as reverse_cost FROM ${this.config.stagingSchema}.ways_noded',
            $1::bigint, $2::bigint, $3::integer
          )
          ORDER BY path_id, path_seq
        `, [startNodeId, dest.id, this.config.kspKValue]);
        
        if (pathResult.rows.length > 0) {
          // Check for -1 edges in the raw result
          const negativeEdges = pathResult.rows.filter(row => row.edge === -1);
          if (negativeEdges.length > 0) {
            console.log(`⚠️ [OUT-AND-BACK] Found ${negativeEdges.length} rows with edge = -1 from ${startNodeId} to ${dest.id}`);
            console.log(`⚠️ [OUT-AND-BACK] Sample -1 edge row:`, negativeEdges[0]);
          }
          
          console.log(`🔍 [OUT-AND-BACK] Debug - pgr_ksp raw result sample:`, pathResult.rows.slice(0, 3));
          
          // Group by path_id
          const pathGroups = new Map<number, any[]>();
          for (const row of pathResult.rows) {
            if (!pathGroups.has(row.path_id)) {
              pathGroups.set(row.path_id, []);
            }
            pathGroups.get(row.path_id)!.push(row);
          }
          
          // Check each path for distance/elevation criteria
          for (const [pathId, pathRows] of pathGroups) {
            // Filter out invalid edges (edge = -1 or edge = 0)
            const validPathRows = pathRows.filter(row => row.edge > 0);
            
            if (validPathRows.length === 0) {
              console.log(`⚠️ [OUT-AND-BACK] Path ${pathId} has no valid edges, skipping`);
              continue;
            }
            
            const totalCost = validPathRows.reduce((sum, row) => sum + (row.cost || 0), 0);
            
            // Check if path meets criteria (with tolerance)
            const distanceTolerance = 0.5; // 50% tolerance
            if (totalCost >= targetDistance * (1 - distanceTolerance) && 
                totalCost <= targetDistance * (1 + distanceTolerance)) {
              allPaths.push(validPathRows);
            }
          }
        }
      } catch (error) {
        console.error(`❌ [OUT-AND-BACK] Error finding path from ${startNodeId} to ${dest.id}:`, error);
      }
    }
    
    return allPaths;
  }

  /**
   * Get elevation data for edges
   */
  private async getElevationDataForEdges(edgeIds: number[]): Promise<any> {
    console.log(`🔍 [OUT-AND-BACK] Getting elevation data for edge IDs: ${edgeIds.join(', ')}`);
    
    const result = await this.pgClient.query(`
      SELECT 
        COALESCE(SUM(elevation_gain), 0) as elevation_gain,
        COALESCE(SUM(elevation_loss), 0) as elevation_loss,
        COUNT(*) as found_edges
      FROM ${this.config.stagingSchema}.ways_noded
      WHERE id = ANY($1::bigint[])
    `, [edgeIds]);
    
    const data = result.rows[0] || { elevation_gain: 0, elevation_loss: 0, found_edges: 0 };
    console.log(`🔍 [OUT-AND-BACK] Elevation data result: ${data.found_edges}/${edgeIds.length} edges found, elevation_gain: ${data.elevation_gain}, elevation_loss: ${data.elevation_loss}`);
    
    return { elevation_gain: data.elevation_gain, elevation_loss: data.elevation_loss };
  }

  /**
   * Get trail names for edges
   */
  private async getTrailNamesForEdges(edgeIds: number[]): Promise<string[]> {
    console.log(`🔍 [OUT-AND-BACK] Getting trail names for edge IDs: ${edgeIds.join(', ')}`);
    
    const result = await this.pgClient.query(`
      SELECT DISTINCT em.trail_name
      FROM ${this.config.stagingSchema}.edge_mapping em
      WHERE em.pg_id = ANY($1::integer[])
        AND em.trail_name IS NOT NULL
        AND em.trail_name != ''
      ORDER BY em.trail_name
    `, [edgeIds]);
    
    const trailNames = result.rows.map(row => row.trail_name);
    console.log(`🔍 [OUT-AND-BACK] Found ${trailNames.length} trail names: ${trailNames.join(', ')}`);
    
    return trailNames;
  }

  /**
   * Calculate route score based on how well it matches target criteria
   */
  private calculateRouteScore(
    actualDistance: number,
    actualElevation: number,
    pattern: OutAndBackPattern
  ): number {
    const distanceScore = 1 - Math.abs(actualDistance - pattern.target_distance_km) / pattern.target_distance_km;
    const elevationScore = pattern.target_elevation_gain > 0 
      ? 1 - Math.abs(actualElevation - pattern.target_elevation_gain) / pattern.target_elevation_gain
      : 1;
    
    return Math.max(0, (distanceScore + elevationScore) / 2);
  }

  /**
   * Get out-and-back route patterns
   */
  private async getOutAndBackPatterns(): Promise<OutAndBackPattern[]> {
    // Load patterns from config or database
    const configData = this.configLoader.loadConfig();
    
    // Default out-and-back patterns
    const defaultPatterns: OutAndBackPattern[] = [
      {
        pattern_name: 'Micro Out-and-Back',
        target_distance_km: 1,
        target_elevation_gain: 50,
        route_shape: 'out-and-back'
      },
      {
        pattern_name: 'Short Out-and-Back', 
        target_distance_km: 2,
        target_elevation_gain: 125,
        route_shape: 'out-and-back'
      },
      {
        pattern_name: 'Medium Out-and-Back',
        target_distance_km: 5,
        target_elevation_gain: 300,
        route_shape: 'out-and-back'
      },
      {
        pattern_name: 'Long Out-and-Back',
        target_distance_km: 12,
        target_elevation_gain: 600,
        route_shape: 'out-and-back'
      },
      {
        pattern_name: 'Epic Out-and-Back',
        target_distance_km: 20,
        target_elevation_gain: 1200,
        route_shape: 'out-and-back'
      },
      {
        pattern_name: 'Ultra Out-and-Back',
        target_distance_km: 30,
        target_elevation_gain: 1800,
        route_shape: 'out-and-back'
      }
    ];
    
    return defaultPatterns;
  }
}
