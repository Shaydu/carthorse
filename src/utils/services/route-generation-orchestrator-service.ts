import { Pool } from 'pg';
import { OutAndBackGeneratorService } from './out-and-back-route-generator-service';
import { UnifiedKspRouteGeneratorService } from './unified-ksp-route-generator-service';
import { UnifiedLoopRouteGeneratorService } from './unified-loop-route-generator-service';
import { LollipopRouteGeneratorService } from '../../services/layer3/LollipopRouteGeneratorService';
import { UnifiedPgRoutingNetworkGenerator } from '../routing/unified-pgrouting-network-generator';
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
  generateP2PRoutes: boolean; // Generate P2P routes for out-and-back conversion
  includeP2PRoutesInOutput: boolean; // Include P2P routes in final output (GeoJSON/SQLite)
  generateLollipopRoutes: boolean; // Generate lollipop routes (true loops)
  useTrailheadsOnly?: boolean; // Use only trailhead nodes for route generation
  trailheadLocations?: Array<{name?: string, lat: number, lng: number, tolerance_meters?: number}>; // Trailhead coordinate locations
  loopConfig?: {
    useHawickCircuits: boolean;
    targetRoutesPerPattern: number;
    elevationGainRateWeight?: number; // Weight for elevation gain rate matching (0-1)
    distanceWeight?: number; // Weight for distance matching (0-1)
    hawickMaxRows?: number; // Maximum rows to read from pgr_hawickcircuits
  };
  lollipopConfig?: {
    targetDistance: number;
    maxAnchorNodes: number;
    maxReachableNodes: number;
    maxDestinationExploration: number;
    distanceRangeMin: number;
    distanceRangeMax: number;
    edgeOverlapThreshold: number;
    kspPaths: number;
    minOutboundDistance: number;
    autoDiscoverEndpoints?: boolean; // Auto-discover degree-1 endpoints
    maxRoutesToKeep?: number; // Maximum number of longest routes to keep
  };
}

export class RouteGenerationOrchestratorService {
  private trueOutAndBackService: OutAndBackGeneratorService | null = null;
  private unifiedKspService: UnifiedKspRouteGeneratorService | null = null;
  private unifiedLoopService: UnifiedLoopRouteGeneratorService | null = null;
  private lollipopService: LollipopRouteGeneratorService | null = null;
  private unifiedNetworkGenerator: UnifiedPgRoutingNetworkGenerator | null = null;
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

      configLocations: trailheadConfig.locations?.length || 0
    });
    
    // Always use unified network generation
    this.unifiedNetworkGenerator = new UnifiedPgRoutingNetworkGenerator(this.pgClient, {
      stagingSchema: this.config.stagingSchema,
      tolerance: 10, // meters
      maxEndpointDistance: 100 // meters
    });

    // DISABLED: Out-and-Back service for out-and-back routes (using traditional network)
    // Using unified network approach instead
    if (this.config.generateKspRoutes) {
      console.log('⚠️ OutAndBackRouteGeneratorService is DISABLED - using unified network approach instead');
      // this.outAndBackService = new OutAndBackRouteGeneratorService(this.pgClient, {
      //   stagingSchema: this.config.stagingSchema,
      //   region: this.config.region,
      //   targetRoutesPerPattern: this.config.targetRoutesPerPattern,
      //   minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes,
      //   kspKValue: this.config.kspKValue
      // });
    }

    // Unified KSP service for point-to-point routes (used by true out-and-back service)
    if (this.config.generateP2PRoutes || this.config.generateKspRoutes) {
      this.unifiedKspService = new UnifiedKspRouteGeneratorService(this.pgClient, {
        stagingSchema: this.config.stagingSchema,
        region: this.config.region,
        targetRoutesPerPattern: this.config.targetRoutesPerPattern,
        minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes,
        kspKValue: this.config.kspKValue,
        useTrailheadsOnly: this.config.useTrailheadsOnly,
        trailheadLocations: this.config.trailheadLocations
      });
    }

    // True out-and-back service (generates A-B-C-D-C-B-A routes from P2P routes)
    if (this.config.generateKspRoutes) {
      this.trueOutAndBackService = new OutAndBackGeneratorService(this.pgClient, {
        stagingSchema: this.config.stagingSchema,
        region: this.config.region,
        targetRoutesPerPattern: this.config.targetRoutesPerPattern,
        minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes
      });
    }

    // Unified Loop service for loop routes
    if (this.config.generateLoopRoutes) {
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
    }

    // Lollipop service for true loops with minimal edge overlap
    if (this.config.generateLollipopRoutes) {
      this.lollipopService = new LollipopRouteGeneratorService(this.pgClient, {
        stagingSchema: this.config.stagingSchema,
        region: this.config.region,
        targetDistance: this.config.lollipopConfig?.targetDistance,
        maxAnchorNodes: this.config.lollipopConfig?.maxAnchorNodes,
        maxReachableNodes: this.config.lollipopConfig?.maxReachableNodes,
        maxDestinationExploration: this.config.lollipopConfig?.maxDestinationExploration,
        distanceRangeMin: this.config.lollipopConfig?.distanceRangeMin,
        distanceRangeMax: this.config.lollipopConfig?.distanceRangeMax,
        edgeOverlapThreshold: this.config.lollipopConfig?.edgeOverlapThreshold,
        kspPaths: this.config.lollipopConfig?.kspPaths,
        minOutboundDistance: this.config.lollipopConfig?.minOutboundDistance,
        outputPath: 'test-output'
      });
      console.log('🍭 Using STANDARD lollipop service');
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
   * Generate all route types (KSP and Loop)
   */
  async generateAllRoutes(): Promise<{
    kspRoutes: RouteRecommendation[];
    loopRoutes: RouteRecommendation[];
    totalRoutes: number;
  }> {
    console.log('🎯 Generating all route types...');
    
    // Create necessary tables first
    await this.createStagingTables();
    
    const kspRoutes: RouteRecommendation[] = [];
    const loopRoutes: RouteRecommendation[] = [];

    // Generate unified network first
    if (this.unifiedNetworkGenerator) {
      console.log('🔧 Generating unified routing network...');
      const networkResult = await this.unifiedNetworkGenerator.generateUnifiedNetwork();
      if (!networkResult.success) {
        throw new Error(`Failed to generate unified network: ${networkResult.message}`);
      }
      console.log('✅ Unified network generated successfully');
    }

          // Generate out-and-back routes with unified network
      // DISABLED: Using traditional network approach
      // TODO: Remove OutAndBackRouteGeneratorService entirely and use only unified network services
      // if (this.config.generateKspRoutes && this.outAndBackService) {
      //   console.log('🛤️ Generating out-and-back routes with unified network...');
      //   const outAndBackRecommendations = await this.outAndBackService.generateOutAndBackRoutes();
      //   await this.outAndBackService.storeRouteRecommendations(outAndBackRecommendations);
      //   kspRoutes.push(...outAndBackRecommendations);
      //   console.log(`✅ Generated ${outAndBackRecommendations.length} out-and-back routes with unified network`);
      // }

    // Generate point-to-point routes (needed for true out-and-back conversion)
    if (this.config.generateP2PRoutes && this.unifiedKspService) {
      console.log('🛤️ Generating point-to-point routes for out-and-back conversion...');
      console.log(`🔍 DEBUG: generateP2PRoutes=${this.config.generateP2PRoutes}, unifiedKspService=${!!this.unifiedKspService}`);
      
      const p2pRecommendations = await this.unifiedKspService.generateKspRoutes();
      console.log(`🔍 DEBUG: P2P route generation returned ${p2pRecommendations.length} routes`);
      
      await this.storeUnifiedKspRouteRecommendations(p2pRecommendations);
      
      // Only include P2P routes in final output if configured to do so
      if (this.config.includeP2PRoutesInOutput) {
        kspRoutes.push(...p2pRecommendations);
        console.log(`✅ Generated ${p2pRecommendations.length} point-to-point routes (included in output)`);
      } else {
        console.log(`✅ Generated ${p2pRecommendations.length} point-to-point routes (excluded from output, used for out-and-back conversion)`);
      }
    } else {
      console.log(`🔍 DEBUG: Skipping P2P route generation - generateP2PRoutes=${this.config.generateP2PRoutes}, unifiedKspService=${!!this.unifiedKspService}`);
    }

    // Generate TRUE out-and-back routes (A-B-C-D-C-B-A geometry)
    if (this.config.generateKspRoutes && this.trueOutAndBackService) {
      console.log('🔄 Generating TRUE out-and-back routes with A-B-C-D-C-B-A geometry...');
      const trueOutAndBackRecommendations = await this.trueOutAndBackService.generateOutAndBackRoutes();
      await this.trueOutAndBackService.storeRouteRecommendations(trueOutAndBackRecommendations);
      kspRoutes.push(...trueOutAndBackRecommendations);
      console.log(`✅ Generated ${trueOutAndBackRecommendations.length} TRUE out-and-back routes with doubled geometry`);
    }

    // Generate Loop routes with unified network
    if (this.config.generateLoopRoutes && this.unifiedLoopService) {
      console.log('🔄 Generating loop routes with unified network...');
      console.log(`🔍 [ORCHESTRATOR] DEBUG: About to call unifiedLoopService.generateLoopRoutes()`);
      console.log(`🔍 DEBUG: Unified loop service config:`, {
        generateLoopRoutes: this.config.generateLoopRoutes,
        elevationGainRateWeight: this.config.loopConfig?.elevationGainRateWeight,
        distanceWeight: this.config.loopConfig?.distanceWeight,
        targetRoutesPerPattern: this.config.loopConfig?.targetRoutesPerPattern
      });
      const loopRecommendations = await this.unifiedLoopService.generateLoopRoutes();
      console.log(`🔍 [ORCHESTRATOR] DEBUG: Loop service returned ${loopRecommendations.length} recommendations`);
      await this.storeUnifiedLoopRouteRecommendations(loopRecommendations);
      loopRoutes.push(...loopRecommendations);
      console.log(`✅ Generated ${loopRecommendations.length} loop routes with unified network`);
    } else {
      console.log('🔍 [ORCHESTRATOR] DEBUG: Loop route generation skipped - generateLoopRoutes:', this.config.generateLoopRoutes, 'unifiedLoopService:', !!this.unifiedLoopService);
    }

    // Generate Lollipop routes (true loops with minimal edge overlap)
    if (this.config.generateLollipopRoutes && this.lollipopService) {
      console.log('🍭 Generating lollipop routes (standard)...');
      const lollipopRoutes = await this.lollipopService.generateLollipopRoutes();
      await this.lollipopService.saveToDatabase(lollipopRoutes);
      await this.lollipopService.exportToGeoJSON(lollipopRoutes);
      console.log(`✅ Generated ${lollipopRoutes.length} lollipop routes`);
    } else {
      console.log('🔍 [ORCHESTRATOR] DEBUG: Lollipop route generation skipped - generateLollipopRoutes:', this.config.generateLollipopRoutes);
    }

    const totalRoutes = kspRoutes.length + loopRoutes.length;
    console.log(`🎯 Total routes generated: ${totalRoutes} (${kspRoutes.length} out-and-back, ${loopRoutes.length} loops)`);

    return {
      kspRoutes,
      loopRoutes,
      totalRoutes
    };
  }

    /**
   * Generate only out-and-back routes
   */
  // DISABLED: Out-and-back route generation using traditional network
  // TODO: Remove this method entirely and use only unified network services
  // async generateOutAndBackRoutes(): Promise<RouteRecommendation[]> {
  //   if (!this.outAndBackService) {
  //     throw new Error('Out-and-back route generation is not enabled');
  //   }

  //   console.log('🛤️ Generating out-and-back routes...');
  //   const recommendations = await this.outAndBackService.generateOutAndBackRoutes();
  //   await this.outAndBackService.storeRouteRecommendations(recommendations);
    
  //   console.log(`✅ Generated ${recommendations.length} out-and-back routes`);
  //   return recommendations;
  // }

  /**
   * Generate only loop routes
   */
  async generateLoopRoutes(): Promise<RouteRecommendation[]> {
    if (!this.unifiedLoopService) {
      throw new Error('Loop route generation is not enabled');
    }

    console.log('🔄 Generating loop routes...');
    const recommendations = await this.unifiedLoopService.generateLoopRoutes();
          await this.storeUnifiedLoopRouteRecommendations(recommendations);
    
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
        stats.routeTypes.push('out-and-back');
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
        // Validate and convert numeric values to ensure proper data types
        const inputLengthKm = Number(recommendation.input_length_km);
        const inputElevationGain = Number(recommendation.input_elevation_gain);
        const recommendedLengthKm = Number(recommendation.recommended_length_km);
        const recommendedElevationGain = Number(recommendation.recommended_elevation_gain);
        const routeScore = Number(recommendation.route_score);
        const similarityScore = Number(recommendation.similarity_score);
        const trailCount = Number(recommendation.trail_count);

        // Validate that required numeric values are valid numbers > 0
        if (isNaN(recommendedLengthKm) || recommendedLengthKm <= 0) {
          console.error(`❌ Invalid recommended_length_km: ${recommendation.recommended_length_km} (converted to: ${recommendedLengthKm})`);
          continue; // Skip this recommendation
        }

        if (isNaN(inputLengthKm) || inputLengthKm <= 0) {
          console.error(`❌ Invalid input_length_km: ${recommendation.input_length_km} (converted to: ${inputLengthKm})`);
          continue; // Skip this recommendation
        }

        // Debug: Log the recommendation values before insertion
        console.log(`🔍 DEBUG: Inserting route recommendation:`, {
          route_uuid: recommendation.route_uuid,
          recommended_length_km: recommendedLengthKm,
          recommended_elevation_gain: recommendedElevationGain,
          input_length_km: inputLengthKm,
          input_elevation_gain: inputElevationGain,
          route_score: routeScore,
          similarity_score: similarityScore
        });
        
        await this.pgClient.query(`
          INSERT INTO ${this.config.stagingSchema}.route_recommendations (
            route_uuid,
            region,
            input_length_km,
            input_elevation_gain,
            recommended_length_km,
            recommended_elevation_gain,
            route_shape,
            trail_count,
            route_score,
            similarity_score,
            route_path,
            route_edges,
            route_name,
            route_geometry
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
          inputLengthKm,
          inputElevationGain,
          recommendedLengthKm,
          recommendedElevationGain,
          recommendation.route_shape,
          trailCount,
          routeScore,
          similarityScore,
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

  /**
   * Store unified KSP route recommendations in the database
   */
  private async storeUnifiedKspRouteRecommendations(recommendations: RouteRecommendation[]): Promise<void> {
    console.log(`💾 Storing ${recommendations.length} unified KSP route recommendations...`);
    
    try {
      for (const recommendation of recommendations) {
        // Validate and convert numeric values to ensure proper data types
        const inputLengthKm = Number(recommendation.input_length_km);
        const inputElevationGain = Number(recommendation.input_elevation_gain);
        const recommendedLengthKm = Number(recommendation.recommended_length_km);
        const recommendedElevationGain = Number(recommendation.recommended_elevation_gain);
        const routeScore = Number(recommendation.route_score);
        const similarityScore = Number(recommendation.similarity_score);
        const trailCount = Number(recommendation.trail_count);

        // Validate that required numeric values are valid numbers > 0
        if (isNaN(recommendedLengthKm) || recommendedLengthKm <= 0) {
          console.error(`❌ Invalid recommended_length_km: ${recommendation.recommended_length_km} (converted to: ${recommendedLengthKm})`);
          continue; // Skip this recommendation
        }

        if (isNaN(inputLengthKm) || inputLengthKm <= 0) {
          console.error(`❌ Invalid input_length_km: ${recommendation.input_length_km} (converted to: ${inputLengthKm})`);
          continue; // Skip this recommendation
        }

        await this.pgClient.query(`
          INSERT INTO ${this.config.stagingSchema}.route_recommendations (
            route_uuid,
            region,
            input_length_km,
            input_elevation_gain,
            recommended_length_km,
            recommended_elevation_gain,
            route_shape,
            trail_count,
            route_score,
            similarity_score,
            route_path,
            route_edges,
            route_name,
            route_geometry
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
          inputLengthKm,
          inputElevationGain,
          recommendedLengthKm,
          recommendedElevationGain,
          recommendation.route_shape,
          trailCount,
          routeScore,
          similarityScore,
          JSON.stringify(recommendation.route_path),
          JSON.stringify(recommendation.route_edges),
          recommendation.route_name,
          recommendation.route_geometry
        ]);
      }
      console.log(`✅ Stored ${recommendations.length} unified KSP route recommendations`);
    } catch (error) {
      console.error('❌ Error storing unified KSP route recommendations:', error);
      throw error;
    }
  }
}