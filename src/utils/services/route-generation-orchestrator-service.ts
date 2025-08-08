import { Pool } from 'pg';
import { KspRouteGeneratorService } from './ksp-route-generator-service';
import { LoopRouteGeneratorService } from './loop-route-generator-service';
import { RouteRecommendation } from '../ksp-route-generator';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';

export interface RouteGenerationOrchestratorConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  minDistanceBetweenRoutes: number;
  kspKValue: number;
  generateKspRoutes: boolean;
  generateLoopRoutes: boolean;
  useTrailheadsOnly?: boolean; // Use only trailhead nodes for route generation (alias for trailheads.enabled)
  trailheadLocations?: Array<{name?: string, lat: number, lng: number, tolerance_meters?: number}>; // Trailhead coordinate locations
  loopConfig?: {
    useHawickCircuits: boolean;
    targetRoutesPerPattern: number;
  };
}

export class RouteGenerationOrchestratorService {
  private kspService: KspRouteGeneratorService | null = null;
  private loopService: LoopRouteGeneratorService | null = null;
  private configLoader: RouteDiscoveryConfigLoader;

  constructor(
    private pgClient: Pool,
    private config: RouteGenerationOrchestratorConfig
  ) {
    this.configLoader = RouteDiscoveryConfigLoader.getInstance();
    
    // Load trailhead configuration from YAML
    const routeDiscoveryConfig = this.configLoader.loadConfig();
    const trailheadConfig = routeDiscoveryConfig.trailheads;
    
    console.log(`🔍 DEBUG: RouteGenerationOrchestratorService config:`, {
      useTrailheadsOnly: this.config.useTrailheadsOnly,
      trailheadLocations: this.config.trailheadLocations?.length || 0,
      configEnabled: trailheadConfig.enabled,
      configStrategy: trailheadConfig.selectionStrategy,
      configLocations: trailheadConfig.locations?.length || 0
    });
    
    if (this.config.generateKspRoutes) {
      this.kspService = new KspRouteGeneratorService(this.pgClient, {
        stagingSchema: this.config.stagingSchema,
        region: this.config.region,
        targetRoutesPerPattern: this.config.targetRoutesPerPattern,
        minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes,
        kspKValue: this.config.kspKValue,
        useTrailheadsOnly: this.config.useTrailheadsOnly !== undefined ? this.config.useTrailheadsOnly : trailheadConfig.enabled, // CLI override takes precedence over YAML config
        trailheadLocations: this.config.trailheadLocations || trailheadConfig.locations
      });
    }

    if (this.config.generateLoopRoutes) {
      this.loopService = new LoopRouteGeneratorService(this.pgClient, {
        stagingSchema: this.config.stagingSchema,
        region: this.config.region,
        targetRoutesPerPattern: this.config.loopConfig?.targetRoutesPerPattern || 3,
        minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes,

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
      console.log(`🔍 DEBUG: Loop service config:`, {
        generateLoopRoutes: this.config.generateLoopRoutes,
        useHawickCircuits: this.config.loopConfig?.useHawickCircuits,
        targetRoutesPerPattern: this.config.loopConfig?.targetRoutesPerPattern
      });
      const loopRecommendations = await this.loopService.generateLoopRoutes();
      await this.loopService.storeLoopRouteRecommendations(loopRecommendations);
      loopRoutes.push(...loopRecommendations);
      console.log(`✅ Generated ${loopRecommendations.length} loop routes`);
    } else {
      console.log(`🔍 DEBUG: Loop generation skipped - generateLoopRoutes: ${this.config.generateLoopRoutes}, loopService: ${!!this.loopService}`);
    }

    // Post-generation deduplication: keep the longest route for any given routing edge per route shape/type
    const dedupeByEdgePerType = (routes: RouteRecommendation[]): RouteRecommendation[] => {
      // Sort descending by recommended_length_km so we keep longest first
      const sorted = [...routes].sort((a, b) => (b.recommended_length_km || 0) - (a.recommended_length_km || 0));
      const kept: RouteRecommendation[] = [];
      // Map<route_type_or_shape, Set<edge_id>> to track used edges
      const usedEdgesByType = new Map<string, Set<number>>();

      for (const route of sorted) {
        const typeKey = route.route_shape || route.route_type || 'unknown';
        if (!usedEdgesByType.has(typeKey)) {
          usedEdgesByType.set(typeKey, new Set<number>());
        }
        const usedSet = usedEdgesByType.get(typeKey)!;

        const edges = Array.isArray((route as any).route_edges) ? (route as any).route_edges : [];
        // If any edge already used for this typeKey, skip this route
        const edgeIds = edges.map((e: any) => e.id).filter((id: any) => typeof id === 'number');
        const hasConflict = edgeIds.some((id: number) => usedSet.has(id));
        if (hasConflict) {
          continue;
        }
        // Keep and mark edges as used
        kept.push(route);
        edgeIds.forEach((id: number) => usedSet.add(id));
      }
      return kept;
    };

    const kspRoutesDeduped = dedupeByEdgePerType(kspRoutes);
    const loopRoutesDeduped = dedupeByEdgePerType(loopRoutes);
    const totalRoutes = kspRoutesDeduped.length + loopRoutesDeduped.length;

    console.log(`🎯 Total routes after dedupe: ${totalRoutes} (${kspRoutesDeduped.length} KSP, ${loopRoutesDeduped.length} loops)`);

    return {
      kspRoutes: kspRoutesDeduped,
      loopRoutes: loopRoutesDeduped,
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