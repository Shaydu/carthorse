import { Pool } from 'pg';
import { LoopRouteGeneratorService } from './loop-route-generator-service';
import { LollipopRouteGeneratorService } from './lollipop-route-generator-service';
import { UnifiedKspRouteGeneratorService } from './unified-ksp-route-generator-service';
import { UnifiedLoopRouteGeneratorService } from './unified-loop-route-generator-service';
import { UnifiedPgRoutingNetworkGenerator } from '../routing/unified-pgrouting-network-generator';
import { RouteRecommendation } from '../../types/route-types';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';

export interface RouteGenerationOrchestratorConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  minDistanceBetweenRoutes: number;
  kspKValue: number;
  generateKspRoutes: boolean;
  generateLoopRoutes: boolean;
  generateLollipopRoutes: boolean;
  useUnifiedNetwork?: boolean; // Use unified network generation instead of legacy services
  useTrailheadsOnly?: boolean; // Use only trailhead nodes for route generation (alias for trailheads.enabled)
  trailheadLocations?: Array<{name?: string, lat: number, lng: number, tolerance_meters?: number}>; // Trailhead coordinate locations
  loopConfig?: {
    useHawickCircuits: boolean;
    targetRoutesPerPattern: number;
    elevationGainRateWeight?: number; // Weight for elevation gain rate matching (0-1)
    distanceWeight?: number; // Weight for distance matching (0-1)
  };
  lollipopConfig?: {
    targetRoutesPerPattern: number;
    minLollipopDistance: number;
    maxLollipopDistance: number;
  };
}

export class RouteGenerationOrchestratorService {
  private loopService: LoopRouteGeneratorService | null = null;
  private lollipopService: LollipopRouteGeneratorService | null = null;
  private unifiedKspService: UnifiedKspRouteGeneratorService | null = null;
  private unifiedLoopService: UnifiedLoopRouteGeneratorService | null = null;
  private unifiedNetworkGenerator: UnifiedPgRoutingNetworkGenerator | null = null;
  private configLoader: RouteDiscoveryConfigLoader;

  constructor(
    private pgClient: Pool,
    private config: RouteGenerationOrchestratorConfig
  ) {
    this.configLoader = RouteDiscoveryConfigLoader.getInstance();
    
    // Load route generation configuration from YAML
    const routeDiscoveryConfig = this.configLoader.loadConfig();
    const routeGenerationConfig = routeDiscoveryConfig.routeGeneration;
    const trailheadConfig = routeDiscoveryConfig.trailheads;
    
    // Check YAML config enabled flags for each route type
    const kspEnabled = routeGenerationConfig?.ksp?.enabled ?? true;
    const loopEnabled = routeGenerationConfig?.loops?.enabled ?? true;
    const lollipopEnabled = routeGenerationConfig?.lollipops?.enabled ?? true;
    
    console.log(`🔍 DEBUG: RouteGenerationOrchestratorService config:`, {
      useTrailheadsOnly: this.config.useTrailheadsOnly,
      trailheadLocations: this.config.trailheadLocations?.length || 0,
      configEnabled: trailheadConfig.enabled,
      configStrategy: trailheadConfig.selectionStrategy,
      configLocations: trailheadConfig.locations?.length || 0,
      yamlKspEnabled: kspEnabled,
      yamlLoopEnabled: loopEnabled,
      yamlLollipopEnabled: lollipopEnabled,
      cliKspEnabled: this.config.generateKspRoutes,
      cliLoopEnabled: this.config.generateLoopRoutes,
      cliLollipopEnabled: this.config.generateLollipopRoutes
    });
    
    // Only create services for enabled route types (YAML config takes precedence)
    if (this.config.generateLoopRoutes && loopEnabled) {
      if (this.config.useUnifiedNetwork) {
        // Use unified network services
        this.unifiedNetworkGenerator = new UnifiedPgRoutingNetworkGenerator(this.pgClient, {
          stagingSchema: this.config.stagingSchema,
          tolerance: 10, // meters
          maxEndpointDistance: 100 // meters
        });

        this.unifiedKspService = new UnifiedKspRouteGeneratorService(this.pgClient, {
          stagingSchema: this.config.stagingSchema,
          region: this.config.region,
          targetRoutesPerPattern: this.config.targetRoutesPerPattern,
          minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes,
          kspKValue: this.config.kspKValue,
          useTrailheadsOnly: this.config.useTrailheadsOnly !== undefined ? this.config.useTrailheadsOnly : trailheadConfig.enabled,
          trailheadLocations: this.config.trailheadLocations || trailheadConfig.locations
        });

        this.unifiedLoopService = new UnifiedLoopRouteGeneratorService(this.pgClient, {
          stagingSchema: this.config.stagingSchema,
          region: this.config.region,
          targetRoutesPerPattern: this.config.loopConfig?.targetRoutesPerPattern || 5,
          minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes,
          maxLoopSearchDistance: 15, // km
          elevationGainRateWeight: this.config.loopConfig?.elevationGainRateWeight || 0.7,
          distanceWeight: this.config.loopConfig?.distanceWeight || 0.3,
          hawickMaxRows: (this.configLoader.loadConfig().routeGeneration?.loops as any)?.hawickMaxRows
        });
      } else {
        // Use legacy services
        this.loopService = new LoopRouteGeneratorService(this.pgClient, {
          stagingSchema: this.config.stagingSchema,
          region: this.config.region,
          targetRoutesPerPattern: this.config.loopConfig?.targetRoutesPerPattern || 3,
          minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes,
        });
      }
    }

    // Initialize lollipop route generator
    if (this.config.generateLollipopRoutes && lollipopEnabled) {
      this.lollipopService = new LollipopRouteGeneratorService(this.pgClient, {
        stagingSchema: this.config.stagingSchema,
        region: this.config.region,
        targetRoutesPerPattern: this.config.lollipopConfig?.targetRoutesPerPattern || 5,
        minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes,
        minLollipopDistance: this.config.lollipopConfig?.minLollipopDistance || 3.0,
        maxLollipopDistance: this.config.lollipopConfig?.maxLollipopDistance || 20.0,
        useTrailheadsOnly: this.config.useTrailheadsOnly !== undefined ? this.config.useTrailheadsOnly : trailheadConfig.enabled,
        trailheadLocations: this.config.trailheadLocations || trailheadConfig.locations
      });
    }
  }

  /**
   * Create necessary tables in staging schema for route generation
   */
  private async createStagingTables(): Promise<void> {
    console.log('📋 Creating staging tables for route generation...');
    
    try {
      // Create route_recommendations table
      await this.pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${this.config.stagingSchema}.route_recommendations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          route_uuid TEXT UNIQUE NOT NULL,
          region TEXT NOT NULL,
          input_length_km REAL CHECK(input_length_km > 0),
          input_elevation_gain REAL,
          recommended_length_km REAL CHECK(recommended_length_km > 0),
          recommended_elevation_gain REAL,
          route_type TEXT,
          route_shape TEXT,
          trail_count INTEGER,
          route_score REAL,
          similarity_score REAL CHECK(similarity_score >= 0 AND similarity_score <= 1),
          route_path JSONB,
          route_edges JSONB,
          route_name TEXT,
          route_geometry GEOMETRY(MULTILINESTRINGZ, 4326),
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      console.log('✅ route_recommendations table created/verified');

      // Create routing_nodes table if it doesn't exist
      await this.pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${this.config.stagingSchema}.routing_nodes (
          id SERIAL PRIMARY KEY,
          lng DOUBLE PRECISION NOT NULL,
          lat DOUBLE PRECISION NOT NULL,
          node_type TEXT,
          geom GEOMETRY(POINT, 4326),
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      console.log('✅ routing_nodes table created/verified');

      // Create routing_edges table if it doesn't exist
      await this.pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${this.config.stagingSchema}.routing_edges (
          id SERIAL PRIMARY KEY,
          app_uuid TEXT,
          name TEXT,
          trail_type TEXT,
          length_km REAL,
          elevation_gain REAL,
          elevation_loss REAL,
          geom GEOMETRY(LINESTRING, 4326),
          source INTEGER REFERENCES ${this.config.stagingSchema}.routing_nodes(id),
          target INTEGER REFERENCES ${this.config.stagingSchema}.routing_nodes(id),
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      console.log('✅ routing_edges table created/verified');

      // Check if Layer 2 ways_noded table exists and has data
      const waysNodedExists = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = '${this.config.stagingSchema}' 
          AND table_name = 'ways_noded'
        )
      `);
      
      if (!waysNodedExists.rows[0].exists) {
        throw new Error('Layer 2 ways_noded table does not exist. Please run Layer 2 first to create the intersection-based network.');
      }
      
      const waysNodedCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.ways_noded
      `);
      
      if (parseInt(waysNodedCount.rows[0].count) === 0) {
        throw new Error('Layer 2 ways_noded table is empty. Please run Layer 2 first to create the intersection-based network.');
      }
      
      console.log('✅ Using existing Layer 2 ways_noded table with intersection-based connectivity');

      // Check if Layer 2 ways_noded_vertices_pgr table exists
      const verticesExist = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = '${this.config.stagingSchema}' 
          AND table_name = 'ways_noded_vertices_pgr'
        )
      `);
      
      if (!verticesExist.rows[0].exists) {
        throw new Error('Layer 2 ways_noded_vertices_pgr table does not exist. Please run Layer 2 first.');
      }
      
      console.log('✅ Using existing Layer 2 ways_noded_vertices_pgr table');

    } catch (error) {
      console.error('❌ Error creating staging tables:', error);
      throw error;
    }
  }

  /**
   * Generate all route types (KSP, Loop, and Lollipop)
   */
  async generateAllRoutes(): Promise<{
    kspRoutes: RouteRecommendation[];
    loopRoutes: RouteRecommendation[];
    lollipopRoutes: RouteRecommendation[];
    totalRoutes: number;
  }> {
    console.log('🎯 Generating all route types...');
    
    // Create necessary tables first
    await this.createStagingTables();
    
    const kspRoutes: RouteRecommendation[] = [];
    const loopRoutes: RouteRecommendation[] = [];
    const lollipopRoutes: RouteRecommendation[] = [];

    if (this.config.useUnifiedNetwork) {
      console.log('🔄 Using unified network generation...');
      
      // Generate unified network first
      if (this.unifiedNetworkGenerator) {
        console.log('🔧 Generating unified routing network...');
        const networkResult = await this.unifiedNetworkGenerator.generateUnifiedNetwork();
        if (!networkResult.success) {
          throw new Error(`Failed to generate unified network: ${networkResult.message}`);
        }
        console.log('✅ Unified network generated successfully');
      }

      // Generate KSP routes with unified network
      if (this.config.generateKspRoutes && this.unifiedKspService) {
        console.log('🛤️ Generating KSP routes with unified network...');
        const kspRecommendations = await this.unifiedKspService.generateKspRoutesWithUnifiedNetwork();
        await this.unifiedKspService.storeRouteRecommendations(kspRecommendations);
        kspRoutes.push(...kspRecommendations);
        console.log(`✅ Generated ${kspRecommendations.length} KSP routes with unified network`);
      }

      // Generate Loop routes with unified network
      if (this.config.generateLoopRoutes && this.unifiedLoopService) {
        console.log('🔄 Generating loop routes with unified network...');
        console.log(`🔍 DEBUG: Unified loop service config:`, {
          generateLoopRoutes: this.config.generateLoopRoutes,
          elevationGainRateWeight: this.config.loopConfig?.elevationGainRateWeight,
          distanceWeight: this.config.loopConfig?.distanceWeight,
          targetRoutesPerPattern: this.config.loopConfig?.targetRoutesPerPattern
        });
        const loopRecommendations = await this.unifiedLoopService.generateLoopRoutes();
        await this.storeUnifiedLoopRouteRecommendations(loopRecommendations);
        loopRoutes.push(...loopRecommendations);
        console.log(`✅ Generated ${loopRecommendations.length} loop routes with unified network`);
      }

      // Generate Lollipop routes with unified network
      if (this.config.generateLollipopRoutes && this.lollipopService) {
        console.log('🍭 Generating lollipop routes with unified network...');
        const lollipopRecommendations = await this.lollipopService.generateLollipopRoutes();
        await this.lollipopService.storeLollipopRouteRecommendations(lollipopRecommendations);
        lollipopRoutes.push(...lollipopRecommendations);
        console.log(`✅ Generated ${lollipopRecommendations.length} lollipop routes with unified network`);
      }
    } else {
      // Use legacy services
      console.log('🔄 Using legacy network generation...');
      
      // KSP routes are now handled by OutAndBackRouteService in SimplifiedRouteOrchestratorService

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

      // Generate Lollipop routes
      if (this.config.generateLollipopRoutes && this.lollipopService) {
        console.log('🍭 Generating lollipop routes...');
        const lollipopRecommendations = await this.lollipopService.generateLollipopRoutes();
        await this.lollipopService.storeLollipopRouteRecommendations(lollipopRecommendations);
        lollipopRoutes.push(...lollipopRecommendations);
        console.log(`✅ Generated ${lollipopRecommendations.length} lollipop routes`);
      } else {
        console.log(`🔍 DEBUG: Lollipop generation skipped - generateLollipopRoutes: ${this.config.generateLollipopRoutes}, lollipopService: ${!!this.lollipopService}`);
      }
    }

    const totalRoutes = kspRoutes.length + loopRoutes.length + lollipopRoutes.length;
    console.log(`🎯 Total routes generated: ${totalRoutes} (${kspRoutes.length} KSP, ${loopRoutes.length} loops, ${lollipopRoutes.length} lollipops)`);

    return {
      kspRoutes,
      loopRoutes,
      lollipopRoutes,
      totalRoutes
    };
  }

  /**
   * Generate only KSP routes
   * NOTE: KSP routes are now handled by OutAndBackRouteService in SimplifiedRouteOrchestratorService
   */
  async generateKspRoutes(): Promise<RouteRecommendation[]> {
    throw new Error('KSP route generation is now handled by OutAndBackRouteService in SimplifiedRouteOrchestratorService');
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

  /**
   * Store unified loop route recommendations in the database
   */
  private async storeUnifiedLoopRouteRecommendations(recommendations: RouteRecommendation[]): Promise<void> {
    console.log(`💾 Storing ${recommendations.length} unified loop route recommendations...`);
    
    try {
      for (const recommendation of recommendations) {
        await this.pgClient.query(`
          INSERT INTO ${this.config.stagingSchema}.route_recommendations (
            route_uuid,
            region,
            input_length_km,
            input_elevation_gain,
            recommended_length_km,
            recommended_elevation_gain,
            route_type,
            route_shape,
            trail_count,
            route_score,
            similarity_score,
            route_path,
            route_edges,
            route_name,
            route_geometry
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (route_uuid) DO UPDATE SET
            recommended_length_km = EXCLUDED.recommended_length_km,
            recommended_elevation_gain = EXCLUDED.recommended_elevation_gain,
            route_score = EXCLUDED.route_score,
            similarity_score = EXCLUDED.similarity_score,
            route_path = EXCLUDED.route_path,
            route_edges = EXCLUDED.route_edges,
            route_name = EXCLUDED.route_name,
            route_geometry = EXCLUDED.route_geometry
        `, [
          recommendation.route_uuid,
          recommendation.region,
          recommendation.input_length_km,
          recommendation.input_elevation_gain,
          recommendation.recommended_length_km,
          recommendation.recommended_elevation_gain,
          recommendation.route_type,
          recommendation.route_shape,
          recommendation.trail_count,
          recommendation.route_score,
          recommendation.similarity_score,
          JSON.stringify(recommendation.route_path),
          JSON.stringify(recommendation.route_edges),
          recommendation.route_name,
          recommendation.route_geometry
        ]);
      }
      
      console.log(`✅ Stored ${recommendations.length} unified loop route recommendations`);
    } catch (error) {
      console.error('❌ Error storing unified loop route recommendations:', error);
      throw error;
    }
  }
}