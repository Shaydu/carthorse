import { Pool } from 'pg';
import { KspRouteGeneratorService } from './ksp-route-generator-service';
import { LoopRouteGeneratorService } from './loop-route-generator-service';
import { RouteRecommendation } from '../ksp-route-generator';

export interface RouteGenerationOrchestratorConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  minDistanceBetweenRoutes: number;
  generateKspRoutes: boolean;
  generateLoopRoutes: boolean;
  loopConfig?: {
    useHawickCircuits: boolean;
    targetRoutesPerPattern: number;
  };
}

export class RouteGenerationOrchestratorService {
  private kspService: KspRouteGeneratorService | null = null;
  private loopService: LoopRouteGeneratorService | null = null;

  constructor(
    private pgClient: Pool,
    private config: RouteGenerationOrchestratorConfig
  ) {
    if (this.config.generateKspRoutes) {
      this.kspService = new KspRouteGeneratorService(this.pgClient, {
        stagingSchema: this.config.stagingSchema,
        region: this.config.region,
        targetRoutesPerPattern: this.config.targetRoutesPerPattern,
        minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes
      });
    }

    if (this.config.generateLoopRoutes) {
      this.loopService = new LoopRouteGeneratorService(this.pgClient, {
        stagingSchema: this.config.stagingSchema,
        region: this.config.region,
        targetRoutesPerPattern: this.config.loopConfig?.targetRoutesPerPattern || 3,
        minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes,
        useHawickCircuits: this.config.loopConfig?.useHawickCircuits || true
      });
    }
  }

  /**
   * Generate all route types (KSP and Loop)
   */
  async generateAllRoutes(): Promise<{
    kspRoutes: RouteRecommendation[];
    loopRoutes: RouteRecommendation[];
    totalRoutes: number;
  }> {
    console.log('🎯 Generating all route types...');
    
    const kspRoutes: RouteRecommendation[] = [];
    const loopRoutes: RouteRecommendation[] = [];

    // Generate KSP routes
    if (this.config.generateKspRoutes && this.kspService) {
      console.log('🛤️ Generating KSP routes...');
      const kspRecommendations = await this.kspService.generateKspRoutes();
      await this.kspService.storeRouteRecommendations(kspRecommendations);
      kspRoutes.push(...kspRecommendations);
      console.log(`✅ Generated ${kspRecommendations.length} KSP routes`);
    }

    // Generate Loop routes
    if (this.config.generateLoopRoutes && this.loopService) {
      console.log('🔄 Generating loop routes...');
      const loopRecommendations = await this.loopService.generateLoopRoutes();
      await this.loopService.storeLoopRouteRecommendations(loopRecommendations);
      loopRoutes.push(...loopRecommendations);
      console.log(`✅ Generated ${loopRecommendations.length} loop routes`);
    }

    const totalRoutes = kspRoutes.length + loopRoutes.length;
    console.log(`🎯 Total routes generated: ${totalRoutes} (${kspRoutes.length} KSP, ${loopRoutes.length} loops)`);

    return {
      kspRoutes,
      loopRoutes,
      totalRoutes
    };
  }

  /**
   * Generate only KSP routes
   */
  async generateKspRoutes(): Promise<RouteRecommendation[]> {
    if (!this.kspService) {
      throw new Error('KSP route generation is not enabled');
    }

    console.log('🛤️ Generating KSP routes...');
    const recommendations = await this.kspService.generateKspRoutes();
    await this.kspService.storeRouteRecommendations(recommendations);
    
    console.log(`✅ Generated ${recommendations.length} KSP routes`);
    return recommendations;
  }

  /**
   * Generate only loop routes
   */
  async generateLoopRoutes(): Promise<RouteRecommendation[]> {
    if (!this.loopService) {
      throw new Error('Loop route generation is not enabled');
    }

    console.log('🔄 Generating loop routes...');
    const recommendations = await this.loopService.generateLoopRoutes();
    await this.loopService.storeLoopRouteRecommendations(recommendations);
    
    console.log(`✅ Generated ${recommendations.length} loop routes`);
    return recommendations;
  }

  /**
   * Get route generation statistics
   */
  async getRouteGenerationStats(): Promise<{
    kspEnabled: boolean;
    loopEnabled: boolean;
    totalRoutesGenerated: number;
    routeTypes: string[];
  }> {
    const stats = {
      kspEnabled: this.config.generateKspRoutes,
      loopEnabled: this.config.generateLoopRoutes,
      totalRoutesGenerated: 0,
      routeTypes: [] as string[]
    };

    if (this.config.generateKspRoutes) {
      stats.routeTypes.push('KSP');
    }

    if (this.config.generateLoopRoutes) {
      stats.routeTypes.push('Loop');
    }

    return stats;
  }
} 