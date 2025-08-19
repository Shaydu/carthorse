import { Pool } from 'pg';
import { RouteRecommendation } from '../../types/route-types';
import { OutAndBackRouteService } from './out-and-back-route-service';
import { LoopRouteService } from './loop-route-service';
import { LollipopRouteService } from './lollipop-route-service';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';

export interface SimplifiedRouteOrchestratorConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  minDistanceBetweenRoutes: number;
  kspKValue: number;
  
  // Enable/disable specific route types for debugging
  enableOutAndBackRoutes: boolean;
  enableLoopRoutes: boolean;
  enableLollipopRoutes: boolean;
  
  useTrailheadsOnly?: boolean;
  trailheadLocations?: Array<{
    name: string;
    lat: number;
    lng: number;
    tolerance_meters?: number;
  }>;
}

/**
 * Simplified route orchestrator that uses dedicated services for each route type
 * This makes debugging much easier - you can enable/disable specific route types
 */
export class SimplifiedRouteOrchestratorService {
  private outAndBackService?: OutAndBackRouteService;
  private loopService?: LoopRouteService;
  private lollipopService?: LollipopRouteService;
  private configLoader: RouteDiscoveryConfigLoader;

  constructor(
    private pgClient: Pool,
    private config: SimplifiedRouteOrchestratorConfig
  ) {
    this.configLoader = RouteDiscoveryConfigLoader.getInstance();
    
    // Initialize services based on configuration
    if (this.config.enableOutAndBackRoutes) {
      this.outAndBackService = new OutAndBackRouteService(this.pgClient, {
        stagingSchema: this.config.stagingSchema,
        region: this.config.region,
        targetRoutesPerPattern: this.config.targetRoutesPerPattern,
        minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes,
        kspKValue: this.config.kspKValue,
        useTrailheadsOnly: this.config.useTrailheadsOnly,
        trailheadLocations: this.config.trailheadLocations
      });
    }

    if (this.config.enableLoopRoutes) {
      this.loopService = new LoopRouteService(this.pgClient, {
        stagingSchema: this.config.stagingSchema,
        region: this.config.region,
        targetRoutesPerPattern: this.config.targetRoutesPerPattern,
        minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes,
        kspKValue: this.config.kspKValue
      });
    }

    if (this.config.enableLollipopRoutes) {
      this.lollipopService = new LollipopRouteService(this.pgClient, {
        stagingSchema: this.config.stagingSchema,
        region: this.config.region,
        targetRoutesPerPattern: this.config.targetRoutesPerPattern,
        minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes,
        kspKValue: this.config.kspKValue
      });
    }
  }

  /**
   * Generate all routes using the enabled services
   */
  async generateAllRoutes(): Promise<RouteRecommendation[]> {
    console.log('🎯 [SIMPLIFIED-ORCHESTRATOR] Starting route generation with dedicated services...');
    console.log('🎯 [SIMPLIFIED-ORCHESTRATOR] Enabled services:');
    console.log(`  - Out-and-back routes: ${this.config.enableOutAndBackRoutes ? '✅' : '❌'}`);
    console.log(`  - Loop routes: ${this.config.enableLoopRoutes ? '✅' : '❌'}`);
    console.log(`  - Lollipop routes: ${this.config.enableLollipopRoutes ? '✅' : '❌'}`);
    
    const allRoutes: RouteRecommendation[] = [];
    
    // Generate out-and-back routes
    if (this.outAndBackService) {
      console.log('\n🎯 [SIMPLIFIED-ORCHESTRATOR] Generating out-and-back routes...');
      const outAndBackRoutes = await this.outAndBackService.generateOutAndBackRoutes();
      allRoutes.push(...outAndBackRoutes);
      console.log(`✅ [SIMPLIFIED-ORCHESTRATOR] Generated ${outAndBackRoutes.length} out-and-back routes`);
    }
    
    // Generate loop routes
    if (this.loopService) {
      console.log('\n🎯 [SIMPLIFIED-ORCHESTRATOR] Generating loop routes...');
      const loopRoutes = await this.loopService.generateLoopRoutes();
      allRoutes.push(...loopRoutes);
      console.log(`✅ [SIMPLIFIED-ORCHESTRATOR] Generated ${loopRoutes.length} loop routes`);
    }
    
    // Generate lollipop routes
    if (this.lollipopService) {
      console.log('\n🎯 [SIMPLIFIED-ORCHESTRATOR] Generating lollipop routes...');
      const lollipopRoutes = await this.lollipopService.generateLollipopRoutes();
      allRoutes.push(...lollipopRoutes);
      console.log(`✅ [SIMPLIFIED-ORCHESTRATOR] Generated ${lollipopRoutes.length} lollipop routes`);
    }
    
    console.log(`\n🎉 [SIMPLIFIED-ORCHESTRATOR] Total routes generated: ${allRoutes.length}`);
    
    // Store routes in database
    await this.storeRoutes(allRoutes);
    
    return allRoutes;
  }



  /**
   * Store routes in the route_recommendations table
   */
  private async storeRoutes(routes: RouteRecommendation[]): Promise<void> {
    if (routes.length === 0) {
      console.log('⚠️ [SIMPLIFIED-ORCHESTRATOR] No routes to store');
      return;
    }

    console.log(`💾 [SIMPLIFIED-ORCHESTRATOR] Storing ${routes.length} route recommendations...`);
    
    // Deduplicate routes within each route shape before storing
    const deduplicatedRoutes = this.deduplicateRoutesByShape(routes);
    console.log(`🔧 [SIMPLIFIED-ORCHESTRATOR] Deduplicated from ${routes.length} to ${deduplicatedRoutes.length} routes`);
    
    try {
      // Create route_recommendations table if it doesn't exist
      await this.pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${this.config.stagingSchema}.route_recommendations (
          route_uuid TEXT PRIMARY KEY,
          input_length_km DOUBLE PRECISION,
          input_elevation_gain DOUBLE PRECISION,
          recommended_length_km DOUBLE PRECISION,
          recommended_elevation_gain DOUBLE PRECISION,
          route_score DOUBLE PRECISION,
          route_type TEXT,
          route_name TEXT,
          route_shape TEXT,
          trail_count INTEGER,
          route_path JSONB,
          route_edges INTEGER[],
          route_geometry GEOMETRY(LINESTRINGZ, 4326)
        )
      `);

      // Clear existing routes
      await this.pgClient.query(`DELETE FROM ${this.config.stagingSchema}.route_recommendations`);

      // Insert deduplicated routes
      for (const route of deduplicatedRoutes) {
        console.log(`🔍 [SIMPLIFIED-ORCHESTRATOR] Debug - route.route_edges:`, route.route_edges);
        console.log(`🔍 [SIMPLIFIED-ORCHESTRATOR] Debug - route.route_edges type:`, typeof route.route_edges, Array.isArray(route.route_edges));
        // Convert route_edges to proper array if it's an object
        let routeEdgesArray: number[] = [];
        if (route.route_edges) {
          if (Array.isArray(route.route_edges)) {
            routeEdgesArray = route.route_edges;
          } else if (typeof route.route_edges === 'object') {
            // If it's an object with numeric keys, convert to array
            routeEdgesArray = Object.values(route.route_edges).filter(val => typeof val === 'number') as number[];
          }
        }
        
        // Ensure we have a proper array for PostgreSQL INTEGER[] type
        if (!Array.isArray(routeEdgesArray)) {
          routeEdgesArray = [];
        }
        
        // Convert to JSON array format for jsonb column
        const jsonArray = JSON.stringify(routeEdgesArray);

        await this.pgClient.query(`
          INSERT INTO ${this.config.stagingSchema}.route_recommendations (
            route_uuid, region, input_length_km, input_elevation_gain, recommended_length_km,
            recommended_elevation_gain, route_score, route_type, route_name, route_shape,
            trail_count, route_path, route_edges, route_geometry
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `, [
          route.route_uuid,
          this.config.region,
          route.input_length_km,
          route.input_elevation_gain,
          route.recommended_length_km,
          route.recommended_elevation_gain,
          route.route_score,
          route.route_type,
          route.route_name,
          route.route_shape,
          route.trail_count,
          route.route_path ? JSON.stringify(route.route_path) : null,
          jsonArray,
          route.route_geometry
        ]);
      }

      console.log(`✅ [SIMPLIFIED-ORCHESTRATOR] Stored ${deduplicatedRoutes.length} route recommendations`);
    } catch (error) {
      console.error('❌ [SIMPLIFIED-ORCHESTRATOR] Error storing routes:', error);
      throw error;
    }
  }

  /**
   * Deduplicate routes within each route shape, keeping longer routes when shorter routes are 100% contained
   */
  private deduplicateRoutesByShape(routes: RouteRecommendation[]): RouteRecommendation[] {
    console.log('🔧 [SIMPLIFIED-ORCHESTRATOR] Starting route deduplication by shape...');
    
    // Group routes by shape
    const routesByShape: Record<string, RouteRecommendation[]> = {};
    routes.forEach(route => {
      const shape = route.route_shape || 'unknown';
      if (!routesByShape[shape]) {
        routesByShape[shape] = [];
      }
      routesByShape[shape].push(route);
    });

    const deduplicatedRoutes: RouteRecommendation[] = [];
    
    // Process each route shape separately
    for (const [shape, shapeRoutes] of Object.entries(routesByShape)) {
      console.log(`🔧 [SIMPLIFIED-ORCHESTRATOR] Processing ${shapeRoutes.length} ${shape} routes...`);
      
      // Check if deduplication is enabled for this route shape
      const dedupeEnabled = this.isDeduplicationEnabledForShape(shape);
      
      if (!dedupeEnabled) {
        console.log(`🔧 [SIMPLIFIED-ORCHESTRATOR] Deduplication disabled for ${shape} routes - keeping all ${shapeRoutes.length} routes`);
        deduplicatedRoutes.push(...shapeRoutes);
        continue;
      }
      
      console.log(`🔧 [SIMPLIFIED-ORCHESTRATOR] Deduplicating ${shapeRoutes.length} ${shape} routes...`);
      
      // Sort routes by length (longest first) to prioritize keeping longer routes
      const sortedRoutes = shapeRoutes.sort((a, b) => 
        (b.recommended_length_km || 0) - (a.recommended_length_km || 0)
      );
      
      const routesToKeep: RouteRecommendation[] = [];
      const routesToRemove = new Set<string>();
      
      // Compare each route against all others
      for (let i = 0; i < sortedRoutes.length; i++) {
        const currentRoute = sortedRoutes[i];
        
        // Skip if this route is already marked for removal
        if (routesToRemove.has(currentRoute.route_uuid)) {
          continue;
        }
        
        let isContainedInLongerRoute = false;
        
        // Check if current route is contained within any longer route
        for (let j = 0; j < i; j++) {
          const longerRoute = sortedRoutes[j];
          
          // Skip if the longer route is already marked for removal
          if (routesToRemove.has(longerRoute.route_uuid)) {
            continue;
          }
          
          // Check if current route is 100% contained within the longer route
          if (this.isRouteContained(currentRoute, longerRoute)) {
            console.log(`🔧 [SIMPLIFIED-ORCHESTRATOR] Route "${currentRoute.route_name}" (${currentRoute.recommended_length_km?.toFixed(2)}km) is contained within "${longerRoute.route_name}" (${longerRoute.recommended_length_km?.toFixed(2)}km) - removing shorter route`);
            routesToRemove.add(currentRoute.route_uuid);
            isContainedInLongerRoute = true;
            break;
          }
        }
        
        // Keep the route if it's not contained in any longer route
        if (!isContainedInLongerRoute) {
          routesToKeep.push(currentRoute);
        }
      }
      
      console.log(`🔧 [SIMPLIFIED-ORCHESTRATOR] ${shape}: Kept ${routesToKeep.length} routes, removed ${routesToRemove.size} duplicate routes`);
      deduplicatedRoutes.push(...routesToKeep);
    }
    
    console.log(`🔧 [SIMPLIFIED-ORCHESTRATOR] Deduplication complete: ${routes.length} → ${deduplicatedRoutes.length} routes`);
    return deduplicatedRoutes;
  }

  /**
   * Check if route A is 100% contained within route B
   * This compares the edge sets to see if all edges in route A are also in route B
   */
  private isRouteContained(routeA: RouteRecommendation, routeB: RouteRecommendation): boolean {
    // If route A is longer than route B, it can't be contained
    if ((routeA.recommended_length_km || 0) > (routeB.recommended_length_km || 0)) {
      return false;
    }
    
    // Convert route edges to sets for comparison
    const edgesA = new Set(this.normalizeRouteEdges(routeA.route_edges));
    const edgesB = new Set(this.normalizeRouteEdges(routeB.route_edges));
    
    // Check if all edges in route A are also in route B
    for (const edge of edgesA) {
      if (!edgesB.has(edge)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Normalize route edges to ensure consistent comparison
   */
  private normalizeRouteEdges(routeEdges: any): number[] {
    if (!routeEdges) return [];
    
    if (Array.isArray(routeEdges)) {
      return routeEdges.filter(edge => typeof edge === 'number');
    } else if (typeof routeEdges === 'object') {
      return Object.values(routeEdges).filter(val => typeof val === 'number') as number[];
    }
    
    return [];
  }
  
  /**
   * Check if deduplication is enabled for a specific route shape based on configuration
   */
  private isDeduplicationEnabledForShape(shape: string): boolean {
    // Map route shapes to config keys
    const shapeConfigMap: Record<string, string> = {
      'out-and-back': 'ksp',
      'loop': 'loops', 
      'lollipop': 'lollipops'
    };
    
    const configKey = shapeConfigMap[shape];
    if (!configKey) {
      console.log(`🔧 [SIMPLIFIED-ORCHESTRATOR] Unknown route shape "${shape}" - deduplication disabled`);
      return false;
    }
    
    // Get the config from the config loader
    const config = this.configLoader.getConfig();
    const shapeConfig = config.routeGeneration?.[configKey];
    if (!shapeConfig) {
      console.log(`🔧 [SIMPLIFIED-ORCHESTRATOR] No config found for ${shape} routes - deduplication disabled`);
      return false;
    }
    
    const enabled = shapeConfig.enabled !== false;
    const dedupe = shapeConfig.dedupe !== false;
    
    console.log(`🔧 [SIMPLIFIED-ORCHESTRATOR] ${shape} routes: enabled=${enabled}, dedupe=${dedupe}`);
    
    return enabled && dedupe;
  }

  /**
   * Get route statistics
   */
  async getRouteStatistics(): Promise<{
    totalRoutes: number;
    outAndBackRoutes: number;
    loopRoutes: number;
    lollipopRoutes: number;
    routesByType: Record<string, number>;
  }> {
    const result = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_routes,
        COUNT(CASE WHEN route_type = 'out-and-back' THEN 1 END) as out_and_back_routes,
        COUNT(CASE WHEN route_type = 'loop' THEN 1 END) as loop_routes,
        COUNT(CASE WHEN route_type = 'lollipop' THEN 1 END) as lollipop_routes,
        route_type,
        COUNT(*) as count
      FROM ${this.config.stagingSchema}.route_recommendations
      GROUP BY route_type
    `);

    const totalRoutes = parseInt(result.rows[0]?.total_routes || '0');
    const outAndBackRoutes = parseInt(result.rows.find(r => r.route_type === 'out-and-back')?.count || '0');
    const loopRoutes = parseInt(result.rows.find(r => r.route_type === 'loop')?.count || '0');
    const lollipopRoutes = parseInt(result.rows.find(r => r.route_type === 'lollipop')?.count || '0');

    const routesByType: Record<string, number> = {};
    result.rows.forEach(row => {
      routesByType[row.route_type] = parseInt(row.count);
    });

    return {
      totalRoutes,
      outAndBackRoutes,
      loopRoutes,
      lollipopRoutes,
      routesByType
    };
  }
}
