import { Pool } from 'pg';
import { RouteRecommendation } from '../ksp-route-generator';
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

      // Insert new routes
      for (const route of routes) {
        console.log(`🔍 [SIMPLIFIED-ORCHESTRATOR] Debug - route.route_edges:`, route.route_edges);
        console.log(`🔍 [SIMPLIFIED-ORCHESTRATOR] Debug - route.route_edges type:`, typeof route.route_edges, Array.isArray(route.route_edges));
        await this.pgClient.query(`
          INSERT INTO ${this.config.stagingSchema}.route_recommendations (
            route_uuid, input_length_km, input_elevation_gain, recommended_length_km,
            recommended_elevation_gain, route_score, route_type, route_name, route_shape,
            trail_count, route_path, route_edges, route_geometry
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
          route.route_uuid,
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
          `{${(route.route_edges || []).join(',')}}`,
          route.route_geometry
        ]);
      }

      console.log(`✅ [SIMPLIFIED-ORCHESTRATOR] Stored ${routes.length} route recommendations`);
    } catch (error) {
      console.error('❌ [SIMPLIFIED-ORCHESTRATOR] Error storing routes:', error);
      throw error;
    }
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
