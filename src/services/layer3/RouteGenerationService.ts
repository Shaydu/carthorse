import { Pool } from 'pg';
import { RouteGenerationOrchestratorService } from '../../utils/services/route-generation-orchestrator-service';

export interface RouteGenerationConfig {
  stagingSchema: string;
  pgClient: Pool;
  region: string;
  generateKspRoutes?: boolean;
  generateLoopRoutes?: boolean;
  useTrailheadsOnly?: boolean;
  targetRoutesPerPattern?: number;
  minDistanceBetweenRoutes?: number;
  kspKValue?: number;
  loopConfig?: {
    useHawickCircuits: boolean;
    targetRoutesPerPattern: number;
  };
}

export interface RouteGenerationResult {
  totalRoutes: number;
  kspRoutes: any[];
  loopRoutes: any[];
  success: boolean;
  errors?: string[];
}

export class RouteGenerationService {
  private stagingSchema: string;
  private pgClient: Pool;
  private config: RouteGenerationConfig;

  constructor(config: RouteGenerationConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
    this.config = config;
  }

  /**
   * Process Layer 3: Route generation and recommendations
   */
  async processRoutes(): Promise<RouteGenerationResult> {
    console.log('🎯 LAYER 3: ROUTES - Generating route recommendations...');
    
    const result: RouteGenerationResult = {
      totalRoutes: 0,
      kspRoutes: [],
      loopRoutes: [],
      success: false,
      errors: []
    };

    // Check if route generation is enabled
    if (!this.config.generateKspRoutes && !this.config.generateLoopRoutes) {
      console.log('⏭️ Route generation disabled, skipping Layer 3...');
      result.success = true;
      return result;
    }

    try {
      // Step 1: Validate pgRouting network exists
      await this.validatePgRoutingNetwork();
      
      // Step 2: Generate route recommendations
      const routeResult = await this.generateRouteRecommendations();
      
      result.totalRoutes = routeResult.totalRoutes;
      result.kspRoutes = routeResult.kspRoutes;
      result.loopRoutes = routeResult.loopRoutes;
      result.success = true;
      
      console.log('✅ LAYER 3 COMPLETE: Route recommendations generated');
      console.log(`📊 Layer 3 Results: ${result.totalRoutes} total routes (${result.kspRoutes.length} KSP, ${result.loopRoutes.length} loops)`);
      
    } catch (error) {
      console.error('❌ Layer 3 failed:', error);
      result.errors = [error instanceof Error ? error.message : String(error)];
      result.success = false;
    }

    return result;
  }

  /**
   * Validate that pgRouting network exists and is ready for route generation
   */
  private async validatePgRoutingNetwork(): Promise<void> {
    console.log('🔍 Validating pgRouting network for route generation...');
    
    const networkCheck = await this.pgClient.query(`
      SELECT 
        EXISTS(SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded') as ways_noded_exists,
        EXISTS(SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded_vertices_pgr') as ways_noded_vertices_pgr_exists,
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded) as edge_count,
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded_vertices_pgr) as vertex_count
    `, [this.stagingSchema]);

    const { ways_noded_exists, ways_noded_vertices_pgr_exists, edge_count, vertex_count } = networkCheck.rows[0];
    
    if (!ways_noded_exists || !ways_noded_vertices_pgr_exists) {
      throw new Error('pgRouting network tables not found. Please run Layer 2 first.');
    }

    if (parseInt(edge_count) === 0 || parseInt(vertex_count) === 0) {
      throw new Error('pgRouting network is empty. Please run Layer 2 first.');
    }

    console.log(`✅ pgRouting network validated: ${edge_count} edges, ${vertex_count} vertices`);
  }

  /**
   * Generate route recommendations using the orchestrator service
   */
  private async generateRouteRecommendations(): Promise<{ totalRoutes: number; kspRoutes: any[]; loopRoutes: any[] }> {
    console.log('🎯 Generating route recommendations...');
    
    const routeConfig = {
      stagingSchema: this.stagingSchema,
      region: this.config.region,
      targetRoutesPerPattern: this.config.targetRoutesPerPattern || 3,
      minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes || 1000, // 1km
      kspKValue: this.config.kspKValue || 3,
      generateKspRoutes: this.config.generateKspRoutes || false,
      generateLoopRoutes: this.config.generateLoopRoutes || false,
      useTrailheadsOnly: this.config.useTrailheadsOnly || false,
      loopConfig: this.config.loopConfig
    };

    const routeService = new RouteGenerationOrchestratorService(this.pgClient, routeConfig);
    
    const result = await routeService.generateAllRoutes();
    
    console.log(`✅ Generated ${result.totalRoutes} route recommendations`);
    console.log(`   - KSP routes: ${result.kspRoutes.length}`);
    console.log(`   - Loop routes: ${result.loopRoutes.length}`);
    
    return result;
  }

  /**
   * Get route statistics for validation
   */
  async getRouteStatistics(): Promise<{ totalRoutes: number; routeTypes: Record<string, number> }> {
    const stats = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_routes,
        route_type,
        COUNT(*) as type_count
      FROM ${this.stagingSchema}.route_recommendations
      GROUP BY route_type
    `);

    const totalRoutes = parseInt(stats.rows[0]?.total_routes || '0');
    const routeTypes: Record<string, number> = {};
    
    stats.rows.forEach(row => {
      routeTypes[row.route_type] = parseInt(row.type_count);
    });

    return { totalRoutes, routeTypes };
  }
}
