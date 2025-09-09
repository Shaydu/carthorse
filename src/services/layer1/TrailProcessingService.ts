import { Pool } from 'pg';
import { IntersectionSplittingService } from './IntersectionSplittingService';
import { PublicTrailIntersectionSplittingService } from './PublicTrailIntersectionSplittingService';
import { STSplitDoubleIntersectionService } from './STSplitDoubleIntersectionService';
import { EnhancedIntersectionSplittingService } from './EnhancedIntersectionSplittingService';
import { VertexBasedSplittingService } from './VertexBasedSplittingService';
import { StandaloneTrailSplittingService } from './StandaloneTrailSplittingService';
import { IntersectionBasedTrailSplitter } from './IntersectionBasedTrailSplitter';
import { YIntersectionSnappingService } from './YIntersectionSnappingService';
import { MissedIntersectionDetectionService } from './MissedIntersectionDetectionService';
import { SimpleTrailSnappingService } from './SimpleTrailSnappingService';
import { TrueCrossingSplittingService } from './TrueCrossingSplittingService';
import { MultipointIntersectionSplittingService } from './MultipointIntersectionSplittingService';
import { PointSnapAndSplitService } from './PointSnapAndSplitService';
import { CentralizedTrailSplitManager, CentralizedSplitConfig, TrailSplitOperation } from '../../utils/services/network-creation/centralized-trail-split-manager';
import { ValidatedTrailDeletionService, ValidatedDeletionConfig } from '../../utils/services/network-creation/validated-trail-deletion-service';
import { loadConfig } from '../../utils/config-loader';

export interface TrailProcessingConfig {
  stagingSchema: string;
  pgClient: Pool;
  region: string;
  bbox?: number[];
  sourceFilter?: string;
  usePgRoutingSplitting?: boolean; // Use PgRoutingSplittingService instead of legacy splitting
  splittingMethod?: 'postgis' | 'pgrouting'; // 'postgis' for ST_Node, 'pgrouting' for modern pgRouting functions
  
  // Service enable/disable flags (matching test script configuration)
  runEndpointSnapping?: boolean;
  runTrailEndpointSnapping?: boolean;
  runProximitySnappingSplitting?: boolean;
  runTrueCrossingSplitting?: boolean;
  runMultipointIntersectionSplitting?: boolean;
  runEnhancedIntersectionSplitting?: boolean;
  runTIntersectionSplitting?: boolean;
  runShortTrailSplitting?: boolean;
  runIntersectionBasedTrailSplitter?: boolean;
  runYIntersectionSnapping?: boolean;
  runVertexBasedSplitting?: boolean;
  runMissedIntersectionDetection?: boolean;
  runSimpleTrailSnapping?: boolean;
  runStandaloneTrailSplitting?: boolean;
  runPointSnapAndSplit?: boolean;
  
  // Service parameters
  toleranceMeters?: number;
  tIntersectionToleranceMeters?: number;
  minSegmentLengthMeters?: number;
  verbose?: boolean;
}

export interface TrailProcessingResult {
  trailsCopied: number;
  trailsCleaned: number;
  gapsFixed: number;
  overlapsRemoved: number;
  trailsSnapped: number;
  trailsSplit: number;
  connectivityMetrics?: any; // Layer 1 connectivity analysis results
}

export class TrailProcessingService {
  private stagingSchema: string;
  private pgClient: Pool;
  private config: TrailProcessingConfig;
  private splitManager: CentralizedTrailSplitManager;
  private layer1Config: any;

  constructor(config: TrailProcessingConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
    
    // Set default values for service flags (matching test script defaults EXACTLY)
    this.config = {
      // Default service configuration (matching test script EXACTLY)
      runEndpointSnapping: false, // DISABLED - requires Layer 2 routing_nodes
      runTrailEndpointSnapping: true, // NEW - works with trail endpoints
      runProximitySnappingSplitting: true,
      runTrueCrossingSplitting: true, // ENABLED to match test script
      runMultipointIntersectionSplitting: true,
      runEnhancedIntersectionSplitting: true, // ENABLED to match test script
      runTIntersectionSplitting: true,
      runShortTrailSplitting: false,
      runIntersectionBasedTrailSplitter: true,
      runYIntersectionSnapping: true,
      runVertexBasedSplitting: false,
      runMissedIntersectionDetection: true,
      runSimpleTrailSnapping: true,
      runStandaloneTrailSplitting: true,
      
      // Default parameters
      toleranceMeters: 5.0,
      tIntersectionToleranceMeters: 3.0,
      minSegmentLengthMeters: 5.0,
      verbose: true,
      
      // Override with provided config
      ...config
    };
    
    // Load Layer 1 configuration from YAML
    const appConfig = loadConfig();
    this.layer1Config = appConfig.layer1_trails;
    
    // Initialize centralized split manager with configuration-driven parameters
    const centralizedConfig: CentralizedSplitConfig = {
      stagingSchema: config.stagingSchema,
      intersectionToleranceMeters: this.layer1Config.intersectionDetection.trueIntersectionToleranceMeters,
      minSegmentLengthMeters: this.config.minSegmentLengthMeters || 5.0,
      preserveOriginalTrailNames: true,
      validationToleranceMeters: 1.0,
      validationTolerancePercentage: 0.05
    };
    
    this.splitManager = CentralizedTrailSplitManager.getInstance(config.pgClient, centralizedConfig);
    
    // Debug logging for configuration
    console.log('🔧 TrailProcessingService config:', {
      usePgRoutingSplitting: this.config.usePgRoutingSplitting,
      splittingMethod: this.config.splittingMethod,
      region: this.config.region,
      bbox: this.config.bbox,
      serviceFlags: {
        runEndpointSnapping: this.config.runEndpointSnapping,
        runProximitySnappingSplitting: this.config.runProximitySnappingSplitting,
        runTrueCrossingSplitting: this.config.runTrueCrossingSplitting,
        runMultipointIntersectionSplitting: this.config.runMultipointIntersectionSplitting,
        runEnhancedIntersectionSplitting: this.config.runEnhancedIntersectionSplitting,
        runTIntersectionSplitting: this.config.runTIntersectionSplitting,
        runIntersectionBasedTrailSplitter: this.config.runIntersectionBasedTrailSplitter,
        runYIntersectionSnapping: this.config.runYIntersectionSnapping,
        runMissedIntersectionDetection: this.config.runMissedIntersectionDetection,
        runSimpleTrailSnapping: this.config.runSimpleTrailSnapping,
        runStandaloneTrailSplitting: this.config.runStandaloneTrailSplitting
      },
      parameters: {
        toleranceMeters: this.config.toleranceMeters,
        tIntersectionToleranceMeters: this.config.tIntersectionToleranceMeters,
        minSegmentLengthMeters: this.config.minSegmentLengthMeters
      }
    });
  }

  /**
   * Process Layer 1: Clean trail network
   */
  async processTrails(): Promise<TrailProcessingResult> {
    console.log('🛤️ LAYER 1: TRAILS - Building clean trail network...');
    
    const result: TrailProcessingResult = {
      trailsCopied: 0,
      trailsCleaned: 0,
      gapsFixed: 0,
      overlapsRemoved: 0,
      trailsSnapped: 0,
      trailsSplit: 0
    };

    // Step 1: Create staging environment
    await this.createStagingEnvironment();
    
    // Step 1.5: DISABLED - Old working prototype splitting (replaced by simplified T-intersection logic)
    console.log('🔗 Step 1.5: Skipping old prototype splitting (using new simplified logic instead)');

    // Step 2: Copy trail data with bbox filter
    result.trailsCopied = await this.copyTrailData();
    
    // Step 2.0: Coordinate Deduplication Service - Remove duplicate coordinates
    console.log('   🧹 Step 2.0: Coordinate deduplication service...');
    const { CoordinateDeduplicationService } = await import('./CoordinateDeduplicationService');
    
    const dedupConfig = {
      stagingSchema: this.stagingSchema,
      minTrailLengthMeters: 0.1,
      verbose: true
    };
    
    const dedupService = new CoordinateDeduplicationService(
      this.pgClient,
      dedupConfig
    );
    
    const dedupResult = await dedupService.removeDuplicateCoordinates();
    
    if (dedupResult.success) {
      console.log(`   📊 Coordinate deduplication results:`);
      console.log(`      🧹 Trails processed: ${dedupResult.trailsProcessed}`);
      console.log(`      🗑️ Duplicate coordinates removed: ${dedupResult.duplicateCoordinatesRemoved}`);
    } else {
      console.log(`   ⚠️ Coordinate deduplication failed: ${dedupResult.error}`);
    }
    
    // Step 2.1: Enhanced Trail Processing Pipeline
    console.log('   🔗 Step 2.1: Enhanced trail processing pipeline...');
    
    // Use our enhanced pipeline with coordinate deduplication and proximity snapping
    // instead of the standalone service
    
    // ===== ENABLED SERVICES (Matching test-layer-1-splitting.ts EXACTLY) =====
    
    // Step 1: MultipointIntersectionSplittingService (NEW ATOMIC TRANSACTION APPROACH) - ENABLED
    if (this.config.runMultipointIntersectionSplitting) {
      console.log('   🔗 Step 1: MultipointIntersectionSplittingService (Atomic Transactions)...');
      
      const multipointConfig = {
        stagingSchema: this.stagingSchema,
        toleranceMeters: 5.0, // Match test script
        minTrailLengthMeters: 5.0, // Match test script: 5m minimum
        maxIntersectionPoints: 10,
        maxIterations: 20,
        verbose: true
      };
      
      const multipointService = new MultipointIntersectionSplittingService(this.pgClient, multipointConfig);
      
      // Get statistics before processing
      const statsBefore = await multipointService.getIntersectionStatistics();
      console.log(`   📊 Before processing: ${statsBefore.totalIntersections} multipoint intersections (${statsBefore.xIntersections} X-intersections, ${statsBefore.pIntersections} P-intersections)`);
      
      const multipointResult = await multipointService.splitMultipointIntersections();
      
      // Get statistics after processing
      const statsAfter = await multipointService.getIntersectionStatistics();
      console.log(`   📊 After processing: ${statsAfter.totalIntersections} multipoint intersections remaining`);
      
      if (multipointResult.success) {
        console.log(`   📊 Multipoint intersection splitting results:`);
        console.log(`      ✂️ Intersections processed: ${multipointResult.intersectionsProcessed}`);
        console.log(`      🔄 Segments created: ${multipointResult.segmentsCreated}`);
        console.log(`      📍 Trails split: ${multipointResult.trailsSplit}`);
      } else {
        console.log(`   ⚠️ Multipoint intersection splitting failed: ${multipointResult.error}`);
      }
      
      // Update result with multipoint intersection splitting results
      if (multipointResult.success) {
        result.trailsSplit += multipointResult.trailsSplit;
      }
    } else {
      console.log('   ⏭️ Skipping MultipointIntersectionSplittingService (disabled in config)');
    }
    
    // Step 1b: TrueCrossingSplittingService (X-intersections)
    if (this.config.runTrueCrossingSplitting) {
      console.log('   🔗 Step 1b: TrueCrossingSplittingService (X-intersections)...');
      
      const trueCrossingConfig = {
        stagingSchema: this.stagingSchema,
        pgClient: this.pgClient,
        toleranceMeters: this.config.toleranceMeters || 5.0,
        minSegmentLengthMeters: this.config.minSegmentLengthMeters || 5.0,
        verbose: this.config.verbose || true
      };
      
      const trueCrossingService = new TrueCrossingSplittingService(trueCrossingConfig);
      const trueCrossingResult = await trueCrossingService.splitTrueCrossings();
      
      if (trueCrossingResult.success) {
        console.log(`   📊 True crossing splitting results:`);
        console.log(`      🔄 Segments created: ${trueCrossingResult.segmentsCreated}`);
        console.log(`      📍 Trails split: ${trueCrossingResult.trailsSplit}`);
      } else {
        console.log(`   ⚠️ True crossing splitting failed: ${trueCrossingResult.error}`);
      }
      
      // Update result with true crossing splitting results
      if (trueCrossingResult.success) {
        result.trailsSplit += trueCrossingResult.trailsSplit;
      }
    } else {
      console.log('   ⏭️ Skipping TrueCrossingSplittingService (disabled in config)');
    }
    
    // Step 2: Endpoint Snapping Service - DISABLED (moved to Layer 2)
    if (this.config.runEndpointSnapping) {
      console.log('   ⚠️ Endpoint Snapping Service is disabled (moved to Layer 2)');
    } else {
      console.log('   ⏭️ Skipping Endpoint Snapping Service (disabled in config - moved to Layer 2)');
    }

    // Step 2b: Trail Endpoint Snapping Service - NEW (works with trail endpoints)
    if (this.config.runTrailEndpointSnapping) {
      console.log('   🔗 Step 2b: Trail endpoint snapping service...');
      
      const { TrailEndpointSnappingService } = await import('./TrailEndpointSnappingService');
      const trailEndpointSnappingService = new TrailEndpointSnappingService(
        this.stagingSchema, 
        this.pgClient, 
        this.config.toleranceMeters || 5.0
      );
      const trailEndpointResult = await trailEndpointSnappingService.processAllTrailEndpoints();
      
      console.log(`   📊 Trail endpoint snapping results:`);
      console.log(`      🔍 Endpoints processed: ${trailEndpointResult.endpointsProcessed}`);
      console.log(`      🔗 Endpoints snapped: ${trailEndpointResult.endpointsSnapped}`);
      console.log(`      ✂️ Trails split: ${trailEndpointResult.trailsSplit}`);
      console.log(`      ❌ Errors: ${trailEndpointResult.errors.length}`);
      
      if (trailEndpointResult.errors.length > 0) {
        console.log(`   ⚠️ Trail endpoint snapping failed with ${trailEndpointResult.errors.length} errors`);
        console.log(`   📋 First few errors:`);
        trailEndpointResult.errors.slice(0, 3).forEach(error => console.log(`      - ${error}`));
      }
      
      result.trailsSplit += trailEndpointResult.trailsSplit;
    } else {
      console.log('   ⏭️ Skipping Trail Endpoint Snapping Service (disabled in config)');
    }
    
    // Step 3: Proximity Snapping and Splitting Service - ENABLED
    if (this.config.runProximitySnappingSplitting) {
      console.log('   🔗 Step 3: Proximity snapping and splitting service...');
      const { ProximitySnappingSplittingService } = await import('./ProximitySnappingSplittingService');
      
      const proximityConfig = {
        stagingSchema: this.stagingSchema,
        proximityToleranceMeters: 5.0, // 5m tolerance (matching test script)
        minTrailLengthMeters: 10.0,
        maxIterations: 3,
        verbose: true
      };
      
      const proximityService = new ProximitySnappingSplittingService(
        this.pgClient,
        proximityConfig
      );
      
      const proximityResult = await proximityService.applyProximitySnappingSplitting();
      
      if (proximityResult.success) {
        console.log(`   📊 Proximity snapping and splitting results:`);
        console.log(`      🔗 Trails snapped: ${proximityResult.trailsSnapped}`);
        console.log(`      ✂️ Trails split: ${proximityResult.trailsSplit}`);
        console.log(`      📍 Vertices created: ${proximityResult.verticesCreated}`);
      } else {
        console.log(`   ⚠️ Proximity snapping failed: ${proximityResult.error}`);
      }
      
      // Update result with proximity snapping results
      if (proximityResult.success) {
        result.trailsSnapped += proximityResult.trailsSnapped;
        result.trailsSplit += proximityResult.trailsSplit;
      }
    } else {
      console.log('   ⏭️ Skipping Proximity Snapping and Splitting Service (disabled in config)');
    }
    
    // Step 5: Enhanced Intersection Splitting Service - ENABLED (matching test script)
    if (this.config.runEnhancedIntersectionSplitting) {
      console.log('   🔗 Step 5: Enhanced Intersection Splitting Service...');
      
      const enhancedService = new EnhancedIntersectionSplittingService(this.pgClient, this.stagingSchema, {
        toleranceMeters: this.config.toleranceMeters || 5.0,
        verbose: this.config.verbose || true
      });
      
      const enhancedResult = await enhancedService.applyEnhancedIntersectionSplitting();
      
      if (enhancedResult.success) {
        console.log(`   📊 Enhanced intersection splitting results:`);
        console.log(`      ✂️ Trails processed: ${enhancedResult.trailsProcessed}`);
        console.log(`      🔄 Segments created: ${enhancedResult.segmentsCreated}`);
        console.log(`      📍 Original trails deleted: ${enhancedResult.originalTrailsDeleted}`);
        console.log(`      🔗 Intersections found: ${enhancedResult.intersectionCount}`);
        
        // Update result with enhanced intersection splitting results
        result.trailsSplit += enhancedResult.trailsProcessed;
      } else {
        console.log(`   ⚠️ Enhanced intersection splitting failed: ${enhancedResult.error}`);
      }
    } else {
      console.log('   ⏭️ Skipping Enhanced Intersection Splitting Service (disabled in config)');
    }
    
    // Step 6: T-Intersection Splitting Service - ENABLED (matching test script)
    if (this.config.runTIntersectionSplitting) {
      console.log('   🔗 Step 6: T-intersection splitting service...');
      
      const { TIntersectionSplittingService } = await import('./TIntersectionSplittingService');
      const tIntersectionConfig = {
        stagingSchema: this.stagingSchema,
        pgClient: this.pgClient,
        toleranceMeters: this.layer1Config.intersectionDetection.tIntersectionToleranceMeters, // 3m from config
        minSegmentLengthMeters: 5.0, // Match test script: 5m minimum
        verbose: true
      };
      
      const tIntersectionService = new TIntersectionSplittingService(tIntersectionConfig);
      const tIntersectionResult = await tIntersectionService.execute();
      
      if (tIntersectionResult.success) {
        console.log(`   📊 T-intersection splitting results:`);
        console.log(`      📍 T-intersections found: ${tIntersectionResult.tIntersectionsFound}`);
        console.log(`      ✂️ Trails split: ${tIntersectionResult.trailsSplit}`);
        console.log(`      🔄 Segments created: ${tIntersectionResult.segmentsCreated}`);
      } else {
        console.log(`   ⚠️ T-intersection splitting failed: ${tIntersectionResult.error}`);
      }
      
      // Update result with T-intersection splitting results
      if (tIntersectionResult.success) {
        result.trailsSplit += tIntersectionResult.trailsSplit;
      }
    } else {
      console.log('   ⏭️ Skipping T-Intersection Splitting Service (disabled in config)');
    }
    
    // Step 7: Short Trail Splitting Service - DISABLED (matching test script)
    if (this.config.runShortTrailSplitting) {
      console.log('   🔗 Step 7: Short trail splitting service...');
      
      const { ShortTrailSplittingService } = await import('./ShortTrailSplittingService');
      const shortTrailConfig = {
        stagingSchema: this.stagingSchema,
        pgClient: this.pgClient,
        maxTrailLengthKm: 0.5, // Match test script
        minSegmentLengthMeters: 5.0, // Match test script: 5m minimum
        verbose: true
      };
      
      const shortTrailService = new ShortTrailSplittingService(shortTrailConfig);
      const shortTrailResult = await shortTrailService.execute();
      
      if (shortTrailResult.success) {
        console.log(`   📊 Short trail splitting results:`);
        console.log(`      ✂️ Trails split: ${shortTrailResult.trailsSplit}`);
        console.log(`      🔄 Segments created: ${shortTrailResult.segmentsCreated}`);
      } else {
        console.log(`   ⚠️ Short trail splitting failed: ${shortTrailResult.error}`);
      }
      
      // Update result with short trail splitting results
      if (shortTrailResult.success) {
        result.trailsSplit += shortTrailResult.trailsSplit;
      }
    } else {
      console.log('   ⏭️ Skipping Short Trail Splitting Service (disabled in config)');
    }
    
    // Step 8: Intersection-Based Trail Splitter - ENABLED (matching test script)
    if (this.config.runIntersectionBasedTrailSplitter) {
      console.log('   🔗 Step 8: Intersection-based trail splitter...');
      
      const intersectionBasedConfig = {
        stagingSchema: this.stagingSchema,
        pgClient: this.pgClient,
        minSegmentLengthMeters: 5.0, // Match test script: 5m minimum
        verbose: true
      };
      
      const intersectionBasedService = new IntersectionBasedTrailSplitter(intersectionBasedConfig);
      const intersectionBasedResult = await intersectionBasedService.execute();
      
      if (intersectionBasedResult.success) {
        console.log(`   📊 Intersection-based trail splitter results:`);
        console.log(`      ✂️ Trails split: ${intersectionBasedResult.trailsSplit}`);
        console.log(`      🔄 Segments created: ${intersectionBasedResult.segmentsCreated}`);
        console.log(`      📍 Intersection points used: ${intersectionBasedResult.intersectionPointsUsed}`);
      } else {
        console.log(`   ⚠️ Intersection-based trail splitter failed: ${intersectionBasedResult.error}`);
      }
      
      // Update result with intersection-based splitting results
      if (intersectionBasedResult.success) {
        result.trailsSplit += intersectionBasedResult.trailsSplit;
      }
    } else {
      console.log('   ⏭️ Skipping Intersection-Based Trail Splitter (disabled in config)');
    }
    
    // Step 9: Y-Intersection Snapping Service - ENABLED (matching test script)
    if (this.config.runYIntersectionSnapping) {
      console.log('   🔗 Step 9: Y-intersection snapping service...');
      
      const client = await this.pgClient.connect();
      const ySnappingService = new YIntersectionSnappingService(client, this.stagingSchema);
      const yIntersectionResult = await ySnappingService.processYIntersections();
      client.release();
      
      console.log(`   📊 Y-Intersection snapping results:`);
      console.log(`      🔗 Intersections processed: ${yIntersectionResult.intersectionsProcessed}`);
      console.log(`      ✂️ Trails split: ${yIntersectionResult.trailsSplit}`);
      console.log(`      🔄 Iterations run: ${yIntersectionResult.iterationsRun}`);
      
      // Update result with Y-intersection snapping results
      result.trailsSplit += yIntersectionResult.trailsSplit;
    } else {
      console.log('   ⏭️ Skipping Y-Intersection Snapping Service (disabled in config)');
    }
    
    // Step 10: Vertex-Based Splitting Service - DISABLED (matching test script - has validation issues)
    if (this.config.runVertexBasedSplitting) {
      console.log('   🔗 Step 10: Vertex-based splitting service...');
      
      const vertexConfig = {
        stagingSchema: this.stagingSchema,
        toleranceMeters: this.config.toleranceMeters || 5.0,
        verbose: this.config.verbose || true,
        region: this.config.region || 'boulder',
        sourceFilter: this.config.sourceFilter || 'cotrex'
      };
      
      const vertexSplittingService = new VertexBasedSplittingService(this.pgClient, this.stagingSchema, vertexConfig);
      const vertexResult = await vertexSplittingService.applyVertexBasedSplitting();
      
      if (vertexResult.success) {
        console.log(`   📊 Vertex-based splitting results:`);
        console.log(`      🔗 Vertices extracted: ${vertexResult.verticesExtracted}`);
        console.log(`      ✂️ Trails split: ${vertexResult.trailsSplit}`);
        console.log(`      🔄 Segments created: ${vertexResult.segmentsCreated}`);
        console.log(`      🗑️ Duplicates removed: ${vertexResult.duplicatesRemoved}`);
        console.log(`      📍 Final segments: ${vertexResult.finalSegments}`);
        
        // Update result with vertex-based splitting results
        result.trailsSplit += vertexResult.trailsSplit;
      } else {
        console.log(`   ⚠️ Vertex-based splitting failed: ${vertexResult.error}`);
      }
    } else {
      console.log('   ⏭️ Skipping Vertex-Based Splitting Service (disabled in config)');
    }
    
    // Step 11: Missed Intersection Detection Service - ENABLED (matching test script)
    if (this.config.runMissedIntersectionDetection) {
      console.log('   🔗 Step 11: Missed intersection detection service...');
      
      const missedIntersectionConfig = {
        stagingSchema: this.stagingSchema,
        pgClient: this.pgClient
      };
      
      const missedIntersectionService = new MissedIntersectionDetectionService(missedIntersectionConfig);
      const missedIntersectionResult = await missedIntersectionService.detectAndFixMissedIntersections();
      
      console.log(`   📊 Missed intersection detection results:`);
      console.log(`      🔍 Intersections found: ${missedIntersectionResult.intersectionsFound}`);
      console.log(`      ✂️ Trails split: ${missedIntersectionResult.trailsSplit}`);
      
      // Update result with missed intersection detection results
      result.trailsSplit += missedIntersectionResult.trailsSplit;
    } else {
      console.log('   ⏭️ Skipping Missed Intersection Detection Service (disabled in config)');
    }
    
    // Step 11b: Simple Trail Snapping Service - ENABLED (efficient snapping without splitting)
    if (this.config.runSimpleTrailSnapping) {
      console.log('   🔗 Step 11b: Simple trail snapping service (no splitting)...');
      
      const simpleSnappingConfig = {
        stagingSchema: this.stagingSchema,
        pgClient: this.pgClient
      };
      
      const simpleSnappingService = new SimpleTrailSnappingService(simpleSnappingConfig);
      const simpleSnappingResult = await simpleSnappingService.snapTrailsTogether();
      
      console.log(`   📊 Simple trail snapping results:`);
      console.log(`      🔍 Intersections found: ${simpleSnappingResult.intersectionsFound}`);
      console.log(`      🔗 Trails snapped: ${simpleSnappingResult.trailsSnapped}`);
      
      // Update result with simple snapping results
      result.trailsSnapped += simpleSnappingResult.trailsSnapped;
    } else {
      console.log('   ⏭️ Skipping Simple Trail Snapping Service (disabled in config)');
    }
    
    // Step 12: Standalone Trail Splitting Service - ENABLED (Key for North Sky/Foothills intersection)
    if (this.config.runStandaloneTrailSplitting) {
      console.log('   🔗 Step 12: Standalone trail splitting service...');
      
      const standaloneConfig = {
        stagingSchema: this.stagingSchema,
        intersectionTolerance: 5.0, // 5m tolerance (matching test script)
        minSegmentLength: 5.0,  // Match layer1 config
        verbose: true
      };
      
      const standaloneService = new StandaloneTrailSplittingService(this.pgClient, standaloneConfig);
      const standaloneResult = await standaloneService.splitTrailsAndReplace();
      
      if (standaloneResult.success) {
        console.log(`   📊 Standalone trail splitting results:`);
        console.log(`      📈 Original trails: ${standaloneResult.originalTrailCount}`);
        console.log(`      📈 Final trails: ${standaloneResult.finalTrailCount}`);
        console.log(`      ✂️ Segments created: ${standaloneResult.segmentsCreated}`);
        console.log(`      📍 Intersections processed: ${standaloneResult.intersectionCount}`);
        console.log(`      ⏱️ Processing time: ${standaloneResult.processingTimeMs}ms`);
      } else {
        console.log(`   ⚠️ Standalone trail splitting failed: ${standaloneResult.errors?.join(', ') || 'Unknown error'}`);
      }
      
      // Update result with standalone trail splitting results
      if (standaloneResult.success) {
        result.trailsSplit += standaloneResult.segmentsCreated;
      }
    } else {
      console.log('   ⏭️ Skipping Standalone Trail Splitting Service (disabled in config)');
    }

    
    // TEMPORARILY COMMENTED OUT FOR TESTING ST_SPLIT LOGIC
    // Step 3: Clean up trails (remove invalid geometries, short segments)
    // result.trailsCleaned = await this.cleanupTrails();
    
    // Step 4: Fill gaps in trail network (if enabled in config)
    // result.gapsFixed = await this.fillTrailGaps();
    
    // Step 5: Remove duplicates/overlaps (first step to avoid linear splitting issues)
    result.overlapsRemoved = await this.deduplicateTrails();
    
    // Step 6: Snap trails together within tolerance
    // result.trailsSnapped = await this.snapTrailsTogether();
    
    // Step 7: Split trails at Y/T intersections using prototype logic
    // result.trailsSplit = await this.splitTrailsAtYIntersections();
    
    // Step 8: Analyze Layer 1 connectivity - looking for near misses and spatial relationships
    result.connectivityMetrics = await this.analyzeLayer1Connectivity();
    
    // Step 9: Validate all trail splits to ensure geometry preservation
    console.log('🔍 Step 9: Validating trail splits...');
    try {
      const { validateAllTrailSplits, getTrailSplitValidationSummary } = await import('../../utils/validation/trail-split-validation-helpers');
      const { strictTrailSplitValidation } = await import('../../utils/validation/trail-split-validation');
      
      const validationResults = await validateAllTrailSplits(
        this.pgClient,
        this.stagingSchema,
        strictTrailSplitValidation
      );
      
      const summary = getTrailSplitValidationSummary(validationResults);
      
      if (summary.invalidTrails > 0) {
        console.error(`❌ TRAIL SPLIT VALIDATION FAILED: ${summary.invalidTrails} trails have invalid splits`);
        console.error(`   📊 Validation Summary:`);
        console.error(`      Total trails: ${summary.totalTrails}`);
        console.error(`      Valid trails: ${summary.validTrails}`);
        console.error(`      Invalid trails: ${summary.invalidTrails}`);
        console.error(`      Geometry loss: ${summary.geometryLossCount} trails`);
        console.error(`      Geometry expansion: ${summary.geometryExpansionCount} trails`);
        console.error(`      Length mismatch: ${summary.lengthMismatchCount} trails`);
        console.error(`   📏 Length differences:`);
        console.error(`      Average: ${(summary.averageLengthDifference / 1000).toFixed(3)}km`);
        console.error(`      Maximum: ${(summary.maxLengthDifference / 1000).toFixed(3)}km`);
        console.error(`   🛤️ Trails with issues: ${summary.trailsWithIssues.slice(0, 10).join(', ')}${summary.trailsWithIssues.length > 10 ? '...' : ''}`);
        throw new Error(`Trail split validation failed: ${summary.invalidTrails} trails have invalid splits (${summary.geometryLossCount} geometry loss, ${summary.geometryExpansionCount} expansion, ${summary.lengthMismatchCount} length mismatch)`);
      } else {
        console.log(`✅ Trail split validation passed: ${summary.validTrails} trails validated successfully`);
      }
    } catch (validationError) {
      console.error('❌ Trail split validation error:', validationError);
      throw new Error(`Trail split validation failed: ${validationError instanceof Error ? validationError.message : String(validationError)}`);
    }
    
    
    // Step 13: Recalculate missing trail statistics (length, elevation, etc.)
    console.log('📊 Step 13: Recalculating trail statistics...');
    await this.recalculateTrailStatistics();
    
    console.log('✅ LAYER 1 COMPLETE: Clean trail network ready');
    console.log(`📊 Layer 1 Results: ${result.trailsCopied} trails copied, ${result.trailsCleaned} cleaned, ${result.gapsFixed} gaps fixed, ${result.overlapsRemoved} overlaps removed, ${result.trailsSnapped} trails snapped, ${result.trailsSplit} trails split at Y/T intersections`);
    
    return result;
  }

  /**
   * Recalculate trail statistics (length, elevation, bbox) for all trails
   */
  private async recalculateTrailStatistics(): Promise<void> {
    console.log('   🔄 Recalculating length_km from geometry...');
    await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET length_km = ST_Length(geometry::geography) / 1000.0
      WHERE geometry IS NOT NULL
    `);

    console.log('   🔄 Recalculating bbox coordinates...');
    await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET 
        bbox_min_lng = ST_XMin(geometry),
        bbox_max_lng = ST_XMax(geometry),
        bbox_min_lat = ST_YMin(geometry),
        bbox_max_lat = ST_YMax(geometry)
      WHERE geometry IS NOT NULL
    `);

    console.log('   🔄 Recalculating elevation statistics from 3D geometry...');
    await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET 
        max_elevation = (
          SELECT MAX(ST_Z(point)) 
          FROM (SELECT (ST_DumpPoints(geometry)).geom as point) as points
          WHERE ST_Z(point) IS NOT NULL
        ),
        min_elevation = (
          SELECT MIN(ST_Z(point)) 
          FROM (SELECT (ST_DumpPoints(geometry)).geom as point) as points
          WHERE ST_Z(point) IS NOT NULL
        ),
        avg_elevation = (
          SELECT AVG(ST_Z(point)) 
          FROM (SELECT (ST_DumpPoints(geometry)).geom as point) as points
          WHERE ST_Z(point) IS NOT NULL
        )
      WHERE geometry IS NOT NULL AND ST_NDims(geometry) = 3
    `);

    console.log('   🔄 Calculating elevation gain and loss...');
    await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET 
        elevation_gain = (
          SELECT COALESCE(SUM(CASE WHEN next_elevation > current_elevation 
            THEN next_elevation - current_elevation ELSE 0 END), 0)
          FROM (
            WITH points AS (
              SELECT 
                ST_Z(point.geom) as elevation,
                point.path[1] as point_order
              FROM ST_DumpPoints(geometry) as point
              WHERE ST_Z(point.geom) IS NOT NULL
            )
            SELECT 
              elevation as current_elevation,
              LEAD(elevation) OVER (ORDER BY point_order) as next_elevation
            FROM points
          ) as elevation_changes
          WHERE current_elevation IS NOT NULL AND next_elevation IS NOT NULL
        ),
        elevation_loss = (
          SELECT COALESCE(SUM(CASE WHEN next_elevation < current_elevation 
            THEN current_elevation - next_elevation ELSE 0 END), 0)
          FROM (
            WITH points AS (
              SELECT 
                ST_Z(point.geom) as elevation,
                point.path[1] as point_order
              FROM ST_DumpPoints(geometry) as point
              WHERE ST_Z(point.geom) IS NOT NULL
            )
            SELECT 
              elevation as current_elevation,
              LEAD(elevation) OVER (ORDER BY point_order) as next_elevation
            FROM points
          ) as elevation_changes
          WHERE current_elevation IS NOT NULL AND next_elevation IS NOT NULL
        )
      WHERE geometry IS NOT NULL AND ST_NDims(geometry) = 3
    `);

    // For 2D geometries, set elevation values to 0
    console.log('   🔄 Setting elevation values to 0 for 2D geometries...');
    await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET 
        elevation_gain = 0,
        elevation_loss = 0,
        max_elevation = 0,
        min_elevation = 0,
        avg_elevation = 0
      WHERE geometry IS NOT NULL AND ST_NDims(geometry) = 2
    `);

    console.log('   ✅ Trail statistics recalculated');
  }

  /**
   * Create staging environment
   */
  private async createStagingEnvironment(): Promise<void> {
    console.log('🏗️ Creating staging environment...');
    
    // Create staging schema if it doesn't exist
    await this.pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${this.stagingSchema}`);
    
    // Drop and recreate trails table in staging schema - use 3D geometry to preserve elevation data
    await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails`);
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        original_trail_uuid UUID,
        app_uuid UUID,
        name TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        length_km DOUBLE PRECISION,
        elevation_gain DOUBLE PRECISION,
        elevation_loss DOUBLE PRECISION,
        max_elevation DOUBLE PRECISION,
        min_elevation DOUBLE PRECISION,
        avg_elevation DOUBLE PRECISION,
        bbox_min_lng DOUBLE PRECISION,
        bbox_max_lng DOUBLE PRECISION,
        bbox_min_lat DOUBLE PRECISION,
        bbox_max_lat DOUBLE PRECISION,
        source TEXT,
        source_tags JSONB,
        osm_id TEXT,
        geojson_cached TEXT,
        geometry_hash TEXT
      )
    `);
    
    // Create spatial index
    await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${this.stagingSchema}_trails_geom ON ${this.stagingSchema}.trails USING GIST(geometry)`);
    
    console.log(`✅ Staging environment created: ${this.stagingSchema}.trails`);
  }

  /**
   * Apply working prototype intersection splitting logic
   */
  private async applyWorkingPrototypeSplitting(): Promise<{ success: boolean; splitCount: number; error?: string }> {
    try {
      // Get Enchanted Mesa and Kohler Spur trails from public.trails (use OSM for intersection splitting)
      const trailsResult = await this.pgClient.query(`
        SELECT name, app_uuid, source, ST_AsText(geometry) as geom_text
        FROM public.trails 
        WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
        ORDER BY name
      `);
      
      console.log(`🔍 Found ${trailsResult.rows.length} trails for prototype splitting:`);
      trailsResult.rows.forEach(trail => {
        console.log(`   - ${trail.name} (${trail.app_uuid}) [${trail.source}]`);
      });
      
      if (trailsResult.rows.length < 2) {
        console.log('⚠️ Need both Enchanted Mesa and Kohler trails for prototype splitting');
        return { success: false, splitCount: 0, error: 'Missing required trails' };
      }
      
      const enchantedMesa = trailsResult.rows.find(t => t.name === 'Enchanted Mesa Trail');
      const kohlerSpur = trailsResult.rows.find(t => t.name === 'Enchanted-Kohler Spur Trail');
      
      console.log(`🔗 Applying working prototype logic: ${enchantedMesa.name} <-> ${kohlerSpur.name}`);
      
      // Step 1: Round coordinates to 6 decimal places (exactly like working prototype)
      const roundedResult = await this.pgClient.query(`
        WITH rounded_trails AS (
          SELECT 
            ST_GeomFromText(
              'LINESTRING(' || 
              string_agg(
                ROUND(ST_X(pt1)::numeric, 6) || ' ' || ROUND(ST_Y(pt1)::numeric, 6),
                ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($1), pt1)
              ) || 
              ')'
            ) as enchanted_mesa_rounded,
            ST_GeomFromText(
              'LINESTRING(' || 
              string_agg(
                ROUND(ST_X(pt2)::numeric, 6) || ' ' || ROUND(ST_Y(pt2)::numeric, 6),
                ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($2), pt2)
              ) || 
              ')'
            ) as kohler_spur_rounded
          FROM 
            (SELECT (ST_DumpPoints(ST_GeomFromText($1))).geom AS pt1) as points1,
            (SELECT (ST_DumpPoints(ST_GeomFromText($2))).geom AS pt2) as points2
        )
        SELECT enchanted_mesa_rounded, kohler_spur_rounded FROM rounded_trails
      `, [enchantedMesa.geom_text, kohlerSpur.geom_text]);
      
      if (roundedResult.rows.length === 0) {
        return { success: false, splitCount: 0, error: 'Failed to round coordinates' };
      }
      
      const enchantedMesaRounded = roundedResult.rows[0].enchanted_mesa_rounded;
      const kohlerSpurRounded = roundedResult.rows[0].kohler_spur_rounded;
      
      // Step 2: Snap with larger tolerance for cotrex trails (0.0001 = ~11m)
      const snappedResult = await this.pgClient.query(`
        SELECT 
          ST_Snap($1::geometry, $2::geometry, 0.0001) AS enchanted_mesa_snapped,
          ST_Snap($2::geometry, $1::geometry, 0.0001) AS kohler_spur_snapped
      `, [enchantedMesaRounded, kohlerSpurRounded]);
      
      const enchantedMesaSnapped = snappedResult.rows[0].enchanted_mesa_snapped;
      const kohlerSpurSnapped = snappedResult.rows[0].kohler_spur_snapped;
      
      // Step 3: Find intersections (exactly like working prototype)
      const intersectionResult = await this.pgClient.query(`
        SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt
      `, [enchantedMesaSnapped, kohlerSpurSnapped]);
      
      console.log(`🔍 Found ${intersectionResult.rows.length} intersection(s)`);
      
      if (intersectionResult.rows.length === 0) {
        return { success: false, splitCount: 0, error: 'No intersections found' };
      }
      
      let totalSplitCount = 0;
      
      // Step 4: Split both trails at intersection points (exactly like working prototype)
      for (const intersection of intersectionResult.rows) {
        const splitPoint = intersection.pt;
        console.log(`   ✅ Intersection point: ${splitPoint}`);
        
        // Split Enchanted Mesa
        const splitEnchantedMesaResult = await this.pgClient.query(`
          SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
        `, [enchantedMesaSnapped, splitPoint]);
        
        console.log(`   📏 Enchanted Mesa split into ${splitEnchantedMesaResult.rows.length} segments`);
        
        // Split Kohler Spur
        const splitKohlerSpurResult = await this.pgClient.query(`
          SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
        `, [kohlerSpurSnapped, splitPoint]);
        
        console.log(`   📏 Kohler Spur split into ${splitKohlerSpurResult.rows.length} segments`);
        
        // Insert split segments into staging with new app_uuid
        await this.insertPrototypeSplitSegmentsIntoStaging(
          enchantedMesa.app_uuid, enchantedMesa.name, splitEnchantedMesaResult.rows,
          kohlerSpur.app_uuid, kohlerSpur.name, splitKohlerSpurResult.rows
        );
        
        totalSplitCount += splitEnchantedMesaResult.rows.length + splitKohlerSpurResult.rows.length;
      }
      
      return { success: true, splitCount: totalSplitCount };
      
    } catch (error) {
      console.error('❌ Error in working prototype splitting:', error);
      return { success: false, splitCount: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Insert prototype split segments into staging schema
   */
  private async insertPrototypeSplitSegmentsIntoStaging(
    enchantedMesaUuid: string, enchantedMesaName: string, enchantedMesaSegments: any[],
    kohlerSpurUuid: string, kohlerSpurName: string, kohlerSpurSegments: any[]
  ): Promise<void> {
    
    let totalInserted = 0;
    
    // Insert Enchanted Mesa segments with new app_uuid (skip zero-length segments)
    for (let i = 0; i < enchantedMesaSegments.length; i++) {
      const segment = enchantedMesaSegments[i];
      
      // Check if segment has meaningful length (skip zero-length/point segments)
      const lengthResult = await this.pgClient.query(`
        SELECT ST_Length($1::geometry::geography) as length_meters
      `, [segment.segment]);
      
      const lengthMeters = lengthResult.rows[0].length_meters;
      if (lengthMeters <= 0) {
        console.log(`   ⏭️ Skipping zero-length Enchanted Mesa segment ${i + 1} (${lengthMeters}m)`);
        continue;
      }
      
      const segmentName = enchantedMesaName; // Keep original name without modification
      
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, name, geometry, trail_type, surface, difficulty, 
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        )
        SELECT 
          gen_random_uuid() as app_uuid,
          $2 as name,
          ST_Force3D($3::geometry) as geometry,
          trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        FROM public.trails 
        WHERE app_uuid = $1
      `, [enchantedMesaUuid, segmentName, segment.segment]);
      
      totalInserted++;
      console.log(`   📝 Inserted Enchanted Mesa segment ${i + 1}: ${Math.round(lengthMeters * 100) / 100}m`);
    }

    // Insert Kohler Spur segments with new app_uuid (skip zero-length segments)
    for (let i = 0; i < kohlerSpurSegments.length; i++) {
      const segment = kohlerSpurSegments[i];
      
      // Check if segment has meaningful length (skip zero-length/point segments)
      const lengthResult = await this.pgClient.query(`
        SELECT ST_Length($1::geometry::geography) as length_meters
      `, [segment.segment]);
      
      const lengthMeters = lengthResult.rows[0].length_meters;
      if (lengthMeters <= 0) {
        console.log(`   ⏭️ Skipping zero-length Kohler Spur segment ${i + 1} (${lengthMeters}m)`);
        continue;
      }
      
      const segmentName = kohlerSpurName; // Keep original name without modification
      
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, name, geometry, trail_type, surface, difficulty, 
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        )
        SELECT 
          gen_random_uuid() as app_uuid,
          $2 as name,
          ST_Force3D($3::geometry) as geometry,
          trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        FROM public.trails 
        WHERE app_uuid = $1
      `, [kohlerSpurUuid, segmentName, segment.segment]);
      
      totalInserted++;
      console.log(`   📝 Inserted Kohler Spur segment ${i + 1}: ${Math.round(lengthMeters * 100) / 100}m`);
    }

    console.log(`   📝 Inserted ${totalInserted} valid prototype split segments into staging`);
    
    // Delete the original trails from staging to prevent duplicates
    await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE app_uuid IN ($1, $2)
    `, [enchantedMesaUuid, kohlerSpurUuid]);
    
    console.log(`   🗑️ Deleted original trails from staging to prevent duplicates`);
  }

  /**
   * Apply simplified T-intersection splitting logic
   * Uses the working prototype approach: ST_Intersection to find split points
   */
  private async applySimplifiedTIntersectionSplitting(): Promise<{ success: boolean; splitCount: number; error?: string }> {
    try {
      console.log('🔍 Applying simplified T-intersection splitting logic...');
      
      // Get all trails from public.trails that match our filters
      let bboxParams: any[] = [];
      let bboxFilter = '';
      
      if (this.config.bbox && this.config.bbox.length === 4) {
        const [minLng, minLat, maxLng, maxLat] = this.config.bbox;
        const expansion = 0.01;
        const expandedMinLng = minLng - expansion;
        const expandedMaxLng = maxLng + expansion;
        const expandedMinLat = minLat - expansion;
        const expandedMaxLat = maxLat + expansion;
        
        bboxParams = [expandedMinLng, expandedMinLat, expandedMaxLng, expandedMaxLat];
        bboxFilter = `AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))`;
      } else {
        bboxFilter = `AND region = $1`;
        bboxParams = [this.config.region];
      }
      
      let sourceFilter = '';
      let sourceParams: any[] = [];
      if (this.config.sourceFilter) {
        sourceFilter = `AND source = $${bboxParams.length + 1}`;
        sourceParams = [this.config.sourceFilter];
      }

      const trailsQuery = `
        SELECT app_uuid, name, geometry, trail_type, surface, difficulty,
               length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
               region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
               source, source_tags, osm_id
        FROM public.trails
        WHERE geometry IS NOT NULL ${bboxFilter} ${sourceFilter}
        ORDER BY app_uuid
      `;
      
      const trailsResult = await this.pgClient.query(trailsQuery, [...bboxParams, ...sourceParams]);
      const trails = trailsResult.rows;
      
      console.log(`🔍 Found ${trails.length} trails for simplified T-intersection splitting`);
      
      let totalSplitCount = 0;
      const toleranceMeters = 3.0; // 3-meter tolerance for T-intersections
      
      // Use a simpler approach: process trails in smaller batches to avoid timeout
      console.log('🔍 Processing trails in batches to avoid timeout...');
      
      const batchSize = 50; // Process 50 trails at a time
      let processedCount = 0;
      
      for (let i = 0; i < trails.length; i += batchSize) {
        const batch = trails.slice(i, i + batchSize);
        console.log(`🔍 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(trails.length/batchSize)} (${batch.length} trails)`);
        
        // Process each trail in this batch against all other trails
        for (const trail1 of batch) {
          for (const trail2 of trails) {
            if (trail1.app_uuid === trail2.app_uuid) continue; // Skip self-comparison
          
          // Step 1: Round coordinates to avoid precision issues (like working prototype)
          const roundedResult = await this.pgClient.query(`
            SELECT 
              ST_SnapToGrid($1::geometry, 1e-6) AS trail1_rounded,
              ST_SnapToGrid($2::geometry, 1e-6) AS trail2_rounded
          `, [trail1.geometry, trail2.geometry]);
          
          const trail1Rounded = roundedResult.rows[0].trail1_rounded;
          const trail2Rounded = roundedResult.rows[0].trail2_rounded;
          
          // Step 2: Snap with tolerance for better intersection detection (like working prototype)
          const snappedResult = await this.pgClient.query(`
            SELECT 
              ST_Snap($1::geometry, $2::geometry, 1e-6) AS trail1_snapped,
              ST_Snap($2::geometry, $1::geometry, 1e-6) AS trail2_snapped
          `, [trail1Rounded, trail2Rounded]);
          
          const trail1Snapped = snappedResult.rows[0].trail1_snapped;
          const trail2Snapped = snappedResult.rows[0].trail2_snapped;
          
          // Step 3: Check if trails are close enough to consider for splitting (single query)
          const distanceResult = await this.pgClient.query(`
            SELECT 
              ST_Distance(ST_StartPoint($1::geometry), $2::geometry) as trail1_start_to_trail2,
              ST_Distance(ST_EndPoint($1::geometry), $2::geometry) as trail1_end_to_trail2,
              ST_Distance(ST_StartPoint($2::geometry), $1::geometry) as trail2_start_to_trail1,
              ST_Distance(ST_EndPoint($2::geometry), $1::geometry) as trail2_end_to_trail1
          `, [trail1Snapped, trail2Snapped]);
          
          const distances = distanceResult.rows[0];
          const trail1MinDistance = Math.min(distances.trail1_start_to_trail2, distances.trail1_end_to_trail2);
          const trail2MinDistance = Math.min(distances.trail2_start_to_trail1, distances.trail2_end_to_trail1);
          
          // Check if trails are close enough to consider for splitting (within 3 meters)
          if (trail1MinDistance > toleranceMeters && trail2MinDistance > toleranceMeters) {
            continue; // Skip this pair
          }
          
          // Determine which trail is the visitor (closest endpoint) and which is visited (to be split)
          let visitorTrail, visitedTrail, visitorEndpoint;
          if (trail1MinDistance < trail2MinDistance) {
            visitorTrail = trail1;
            visitedTrail = trail2;
            visitorEndpoint = trail1MinDistance === distances.trail1_start_to_trail2 ? 
              await this.pgClient.query(`SELECT ST_StartPoint($1::geometry) as endpoint`, [trail1Snapped]) :
              await this.pgClient.query(`SELECT ST_EndPoint($1::geometry) as endpoint`, [trail1Snapped]);
          } else {
            visitorTrail = trail2;
            visitedTrail = trail1;
            visitorEndpoint = trail2MinDistance === distances.trail2_start_to_trail1 ? 
              await this.pgClient.query(`SELECT ST_StartPoint($1::geometry) as endpoint`, [trail2Snapped]) :
              await this.pgClient.query(`SELECT ST_EndPoint($1::geometry) as endpoint`, [trail2Snapped]);
          }
          
          console.log(`🔗 T-intersection found: ${visitorTrail.name} endpoint within ${Math.min(trail1MinDistance, trail2MinDistance).toFixed(2)}m of ${visitedTrail.name}`);
          
          // Step 4: Find intersection point using ST_Intersection (like working prototype)
          const intersectionResult = await this.pgClient.query(`
            SELECT ST_Intersection($1::geometry, $2::geometry) as intersection_point
          `, [visitedTrail.geometry, visitorEndpoint.rows[0].endpoint]);
          
          const intersectionPoint = intersectionResult.rows[0].intersection_point;
          
          if (!intersectionPoint || intersectionPoint === null) {
            console.log(`   ⚠️ No intersection point found, skipping`);
            continue;
          }
          
          // Step 5: Split the visited trail at the intersection point
          const splitResult = await this.pgClient.query(`
            SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom as segment
          `, [visitedTrail.geometry, intersectionPoint]);
          
          if (splitResult.rows.length > 1) {
            // Insert split segments into staging
            for (let k = 0; k < splitResult.rows.length; k++) {
              const segment = splitResult.rows[k];
              const segmentName = visitedTrail.name; // Keep original name without modification
              
              await this.pgClient.query(`
                INSERT INTO ${this.stagingSchema}.trails (
                  app_uuid, name, geometry, trail_type, surface, difficulty,
                  length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                  region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                  source, source_tags, osm_id
                )
                SELECT 
                  gen_random_uuid() as app_uuid,
                  $2 as name,
                  ST_Force3D($3::geometry) as geometry,
                  trail_type, surface, difficulty,
                  length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                  region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                  source, source_tags, osm_id
                FROM public.trails 
                WHERE app_uuid = $1
              `, [visitedTrail.app_uuid, segmentName, segment.segment]);
            }
            
            totalSplitCount += splitResult.rows.length;
            console.log(`   ✅ Split ${visitedTrail.name} into ${splitResult.rows.length} segments`);
          }
        }
      }
      
      processedCount += batch.length;
      console.log(`   📊 Processed ${processedCount}/${trails.length} trails`);
    }
      
    console.log(`✅ Simplified T-intersection splitting completed: ${totalSplitCount} segments created`);
      return { success: true, splitCount: totalSplitCount };
      
    } catch (error) {
      console.error('❌ Error in simplified T-intersection splitting:', error);
      return { success: false, splitCount: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Copy trail data with bbox filter and intersection detection
   */
  private async copyTrailData(): Promise<number> {
    console.log('📊 Copying trail data with intersection detection...');
    
    let bboxParams: any[] = [];
    let bboxFilter = '';
    let bboxFilterWithAlias = '';
    
    if (this.config.bbox && this.config.bbox.length === 4) {
      const [minLng, minLat, maxLng, maxLat] = this.config.bbox;
      
      // Expand bbox by 0.01 degrees (~1km) to include connected trail segments
      const expansion = 0.01;
      const expandedMinLng = minLng - expansion;
      const expandedMaxLng = maxLng + expansion;
      const expandedMinLat = minLat - expansion;
      const expandedMaxLat = maxLat + expansion;
      
      bboxParams = [expandedMinLng, expandedMinLat, expandedMaxLng, expandedMaxLat];
      bboxFilter = `AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))`;
      bboxFilterWithAlias = `AND ST_Intersects(p.geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))`;
      
      console.log(`🗺️ Using expanded bbox filter: [${expandedMinLng}, ${expandedMinLat}, ${expandedMaxLng}, ${expandedMaxLat}] (original: [${minLng}, ${minLat}, ${maxLng}, ${maxLat}])`);
    } else {
      console.log('🗺️ Using region filter (no bbox specified)');
      bboxFilter = `AND region = $1`;
      bboxFilterWithAlias = `AND p.region = $1`;
      bboxParams = [this.config.region];
    }
    
    // Add source filter if specified
    let sourceFilter = '';
    let sourceParams: any[] = [];
    if (this.config.sourceFilter) {
      sourceFilter = `AND source = $${bboxParams.length + 1}`;
      sourceParams = [this.config.sourceFilter];
      console.log(`🔍 Using source filter: ${this.config.sourceFilter}`);
    }

    // First, check how many trails should be copied
    const expectedTrailsQuery = `
      SELECT COUNT(*) as count FROM public.trails 
      WHERE geometry IS NOT NULL ${bboxFilter} ${sourceFilter}
    `;
    const expectedTrailsResult = await this.pgClient.query(expectedTrailsQuery, [...bboxParams, ...sourceParams]);
    const expectedCount = parseInt(expectedTrailsResult.rows[0].count);
    console.log(`📊 Expected trails to copy: ${expectedCount}`);

    // SHADOW CANYON TRAIL SPECIFIC LOGGING
    console.log('🎯 SHADOW CANYON TRAIL DEBUG [TrailProcessingService]: Starting detailed tracking...');
    const shadowCanyonQuery = `
      SELECT app_uuid, name, length_km, region, source, 
             ST_AsText(ST_StartPoint(geometry)) as start_point, 
             ST_AsText(ST_EndPoint(geometry)) as end_point,
             ST_NumPoints(geometry) as num_points,
             ST_IsValid(geometry) as is_valid,
             ST_Length(geometry::geography)/1000.0 as calculated_length_km
      FROM public.trails
      WHERE app_uuid = 'e393e414-b14f-46a1-9734-e6e582c602ac'
    `;
    const shadowCanyonResult = await this.pgClient.query(shadowCanyonQuery);
    
    if (shadowCanyonResult.rowCount && shadowCanyonResult.rowCount > 0) {
      const trail = shadowCanyonResult.rows[0];
      console.log('🎯 SHADOW CANYON TRAIL FOUND IN PUBLIC.TRAILS [TrailProcessingService]:');
      console.log(`   UUID: ${trail.app_uuid}`);
      console.log(`   Name: ${trail.name}`);
      console.log(`   Region: ${trail.region}`);
      console.log(`   Source: ${trail.source}`);
      console.log(`   Length (stored): ${trail.length_km}km`);
      console.log(`   Length (calculated): ${trail.calculated_length_km}km`);
      console.log(`   Points: ${trail.num_points}`);
      console.log(`   Valid: ${trail.is_valid}`);
      console.log(`   Start: ${trail.start_point}`);
      console.log(`   End: ${trail.end_point}`);
      
      // Check if it matches our filters
      console.log('🎯 CHECKING FILTER MATCHES [TrailProcessingService]:');
      console.log(`   Region filter: ${this.config.region} (trail region: ${trail.region}) - ${trail.region === this.config.region ? 'MATCH' : 'NO MATCH'}`);
      
      if (this.config.bbox && this.config.bbox.length === 4) {
        const bboxCheckQuery = `
          SELECT ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326)) as intersects_bbox
          FROM public.trails
          WHERE app_uuid = 'e393e414-b14f-46a1-9734-e6e582c602ac'
        `;
        const bboxCheckResult = await this.pgClient.query(bboxCheckQuery, bboxParams);
        const intersectsBbox = bboxCheckResult.rows[0].intersects_bbox;
        console.log(`   Bbox filter: [${bboxParams.join(', ')}] - ${intersectsBbox ? 'INTERSECTS' : 'NO INTERSECTION'}`);
      }
      
      if (this.config.sourceFilter) {
        console.log(`   Source filter: ${this.config.sourceFilter} (trail source: ${trail.source}) - ${trail.source === this.config.sourceFilter ? 'MATCH' : 'NO MATCH'}`);
      }
    } else {
      console.log('🎯 SHADOW CANYON TRAIL NOT FOUND IN PUBLIC.TRAILS [TrailProcessingService]!');
    }

    // Create intersection detection table with proper 3D support
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${this.stagingSchema}.intersection_points (
        id SERIAL PRIMARY KEY,
        intersection_point GEOMETRY(POINT, 4326),
        intersection_point_3d GEOMETRY(POINTZ, 4326),
        connected_trail_ids TEXT[],
        connected_trail_names TEXT[],
        node_type TEXT,
        distance_meters DOUBLE PRECISION
      )
    `);

    // Copy trails one by one and detect intersections
    const trailsQuery = `
      SELECT app_uuid, name, trail_type, surface, difficulty,
             geometry, length_km, elevation_gain, elevation_loss,
             max_elevation, min_elevation, avg_elevation, region,
             bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
             source, source_tags, osm_id
      FROM public.trails
      WHERE geometry IS NOT NULL ${bboxFilter} ${sourceFilter}
      ORDER BY app_uuid
    `;
    
    const trailsResult = await this.pgClient.query(trailsQuery, [...bboxParams, ...sourceParams]);
    const trails = trailsResult.rows;
    
    // Debug: Check if our specific target trails are in the source data
    const debugTrailQuery = `
      SELECT app_uuid, name, length_km, ST_AsText(ST_StartPoint(geometry)) as start_point, ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM public.trails
      WHERE geometry IS NOT NULL ${bboxFilter} ${sourceFilter}
      AND (app_uuid = 'e393e414-b14f-46a1-9734-e6e582c602ac' OR name LIKE '%Shadow Canyon%' OR app_uuid = '45d89eb5-3749-4329-b195-fe9f18e1cea1' OR name LIKE '%Bear Peak West Ridge%')
      ORDER BY name
    `;
    const debugTrailCheck = await this.pgClient.query(debugTrailQuery, [...bboxParams, ...sourceParams]);
    
    if (debugTrailCheck.rowCount && debugTrailCheck.rowCount > 0) {
      console.log('🔍 DEBUG: Found target trails in source data:');
      debugTrailCheck.rows.forEach((trail: any) => {
        console.log(`   - ${trail.name} (${trail.app_uuid}): ${trail.length_km}km, starts at ${trail.start_point}, ends at ${trail.end_point}`);
      });
    } else {
      console.log('🔍 DEBUG: Target trails NOT found in source data');
    }
    
    let copiedCount = 0;
    let intersectionCount = 0;
    
    for (const trail of trails) {
      // SHADOW CANYON TRAIL SPECIFIC LOGGING
      if (trail.app_uuid === 'e393e414-b14f-46a1-9734-e6e582c602ac') {
        console.log('🎯 SHADOW CANYON TRAIL BEING PROCESSED [TrailProcessingService]:');
        console.log(`   UUID: ${trail.app_uuid}`);
        console.log(`   Name: ${trail.name}`);
        console.log(`   Region: ${trail.region}`);
        console.log(`   Source: ${trail.source}`);
        console.log(`   Length (stored): ${trail.length_km}km`);
        console.log(`   Points: ${trail.geometry ? 'Geometry present' : 'No geometry'}`);
      }

      // Calculate length from geometry
      const lengthResult = await this.pgClient.query('SELECT ST_Length($1::geography) / 1000.0 as length_km', [trail.geometry]);
      const calculatedLengthKm = lengthResult.rows[0].length_km;
      console.log(`🔍 DEBUG: Calculated length for ${trail.name}: ${calculatedLengthKm} km`);
      
      // SHADOW CANYON TRAIL INSERT LOGGING
      if (trail.app_uuid === 'e393e414-b14f-46a1-9734-e6e582c602ac') {
        console.log('🎯 SHADOW CANYON TRAIL INSERTING TO STAGING [TrailProcessingService]:');
        console.log(`   Calculated length: ${calculatedLengthKm}km`);
        console.log(`   About to insert with original_trail_uuid: ${trail.app_uuid}`);
      }
      
      // Insert the trail with proper UUID mapping - PRESERVE original UUID for unsplit trails
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          original_trail_uuid, app_uuid, name, trail_type, surface, difficulty,
          geometry, length_km, elevation_gain, elevation_loss,
          max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id, geojson_cached, geometry_hash
        ) VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      `, [
        trail.app_uuid, // original_trail_uuid AND app_uuid - preserve original UUID for unsplit trails
        trail.name, trail.trail_type, trail.surface, trail.difficulty,
        trail.geometry, calculatedLengthKm,
        trail.elevation_gain, trail.elevation_loss,
        trail.max_elevation, trail.min_elevation, trail.avg_elevation,
        trail.bbox_min_lng, trail.bbox_max_lng, trail.bbox_min_lat, trail.bbox_max_lat,
        trail.source, trail.source_tags, trail.osm_id,
        trail.geojson_cached || null, trail.geometry_hash || null
      ]);
      
      copiedCount++;
      
      // SHADOW CANYON TRAIL POST-INSERT CHECK
      if (trail.app_uuid === 'e393e414-b14f-46a1-9734-e6e582c602ac') {
        console.log('🎯 SHADOW CANYON TRAIL POST-INSERT CHECK [TrailProcessingService]:');
        const postInsertCheckQuery = `
          SELECT app_uuid, name, original_trail_uuid, ST_NumPoints(geometry) as num_points, length_km
          FROM ${this.stagingSchema}.trails
          WHERE original_trail_uuid = 'e393e414-b14f-46a1-9734-e6e582c602ac'
        `;
        const postInsertCheckResult = await this.pgClient.query(postInsertCheckQuery);
        
        if (postInsertCheckResult.rowCount && postInsertCheckResult.rowCount > 0) {
          const copiedTrail = postInsertCheckResult.rows[0];
          console.log('🎯 SHADOW CANYON TRAIL SUCCESSFULLY INSERTED TO STAGING [TrailProcessingService]:');
          console.log(`   App UUID: ${copiedTrail.app_uuid}`);
          console.log(`   Original UUID: ${copiedTrail.original_trail_uuid}`);
          console.log(`   UUID Match: ${copiedTrail.app_uuid === copiedTrail.original_trail_uuid ? 'YES (preserved)' : 'NO (different)'}`);
          console.log(`   Name: ${copiedTrail.name}`);
          console.log(`   Points: ${copiedTrail.num_points}`);
          console.log(`   Length: ${copiedTrail.length_km}km`);
        } else {
          console.log('🎯 SHADOW CANYON TRAIL NOT FOUND IN STAGING AFTER INSERT [TrailProcessingService]!');
          console.log('🎯 This means the INSERT failed or was rolled back.');
        }
      }
      
      // Enhanced intersection detection with proper T/Y intersection identification
      const intersectionQuery = `
        WITH current_trail AS (
          SELECT $1::uuid as app_uuid, $2 as name, $3 as geometry
        ),
        existing_trails AS (
          SELECT app_uuid, name, geometry 
          FROM ${this.stagingSchema}.trails 
          WHERE app_uuid != $1::uuid
        ),
        true_intersections AS (
          SELECT 
            ST_Force2D((ST_Dump(ST_Intersection(ct.geometry::geometry, et.geometry::geometry))).geom) as intersection_point,
            ST_Force3D((ST_Dump(ST_Intersection(ct.geometry::geometry, et.geometry::geometry))).geom) as intersection_point_3d,
            ARRAY[ct.app_uuid, et.app_uuid] as connected_trail_ids,
            ARRAY[ct.name, et.name] as connected_trail_names,
            'intersection' as node_type,
            0.0 as distance_meters
          FROM current_trail ct
          JOIN existing_trails et ON ST_Intersects(ct.geometry::geometry, et.geometry::geometry)
          WHERE ST_GeometryType(ST_Intersection(ct.geometry::geometry, et.geometry::geometry)) IN ('ST_Point', 'ST_MultiPoint')
        ),
        t_intersections AS (
          -- T-intersections: where trail endpoints are close to other trails
          SELECT 
            ST_Force2D(ST_ClosestPoint(ct.geometry::geometry, ST_StartPoint(et.geometry::geometry))) as intersection_point,
            ST_Force3D(ST_ClosestPoint(ct.geometry::geometry, ST_StartPoint(et.geometry::geometry))) as intersection_point_3d,
            ARRAY[ct.app_uuid, et.app_uuid] as connected_trail_ids,
            ARRAY[ct.name, et.name] as connected_trail_names,
            't_intersection' as node_type,
            ST_Distance(ct.geometry::geography, ST_StartPoint(et.geometry)::geography) as distance_meters
          FROM current_trail ct
          JOIN existing_trails et ON ST_DWithin(ct.geometry::geography, ST_StartPoint(et.geometry)::geography, $4)
          WHERE ST_Distance(ct.geometry::geography, ST_StartPoint(et.geometry)::geography) > 0
            AND ST_Distance(ct.geometry::geography, ST_StartPoint(et.geometry)::geography) <= $4
          UNION ALL
          SELECT 
            ST_Force2D(ST_ClosestPoint(ct.geometry::geometry, ST_EndPoint(et.geometry::geometry))) as intersection_point,
            ST_Force3D(ST_ClosestPoint(ct.geometry::geometry, ST_EndPoint(et.geometry::geometry))) as intersection_point_3d,
            ARRAY[ct.app_uuid, et.app_uuid] as connected_trail_ids,
            ARRAY[ct.name, et.name] as connected_trail_names,
            't_intersection' as node_type,
            ST_Distance(ct.geometry::geography, ST_EndPoint(et.geometry)::geography) as distance_meters
          FROM current_trail ct
          JOIN existing_trails et ON ST_DWithin(ct.geometry::geography, ST_EndPoint(et.geometry)::geography, $4)
          WHERE ST_Distance(ct.geometry::geography, ST_EndPoint(et.geometry)::geography) > 0
            AND ST_Distance(ct.geometry::geography, ST_EndPoint(et.geometry)::geography) <= $4
          UNION ALL
          -- Also check if current trail's endpoints are close to existing trails
          SELECT 
            ST_Force2D(ST_ClosestPoint(et.geometry::geometry, ST_StartPoint(ct.geometry::geometry))) as intersection_point,
            ST_Force3D(ST_ClosestPoint(et.geometry::geometry, ST_StartPoint(ct.geometry::geometry))) as intersection_point_3d,
            ARRAY[ct.app_uuid, et.app_uuid] as connected_trail_ids,
            ARRAY[ct.name, et.name] as connected_trail_names,
            't_intersection' as node_type,
            ST_Distance(et.geometry::geography, ST_StartPoint(ct.geometry)::geography) as distance_meters
          FROM current_trail ct
          JOIN existing_trails et ON ST_DWithin(et.geometry::geography, ST_StartPoint(ct.geometry)::geography, $4)
          WHERE ST_Distance(et.geometry::geography, ST_StartPoint(ct.geometry)::geography) > 0
            AND ST_Distance(et.geometry::geography, ST_StartPoint(ct.geometry)::geography) <= $4
          UNION ALL
          SELECT 
            ST_Force2D(ST_ClosestPoint(et.geometry::geometry, ST_EndPoint(ct.geometry::geometry))) as intersection_point,
            ST_Force3D(ST_ClosestPoint(et.geometry::geometry, ST_EndPoint(ct.geometry::geometry))) as intersection_point_3d,
            ARRAY[ct.app_uuid, et.app_uuid] as connected_trail_ids,
            ARRAY[ct.name, et.name] as connected_trail_names,
            't_intersection' as node_type,
            ST_Distance(et.geometry::geography, ST_EndPoint(ct.geometry)::geography) as distance_meters
          FROM current_trail ct
          JOIN existing_trails et ON ST_DWithin(et.geometry::geography, ST_EndPoint(ct.geometry)::geography, $4)
          WHERE ST_Distance(et.geometry::geography, ST_EndPoint(ct.geometry)::geography) > 0
            AND ST_Distance(et.geometry::geography, ST_EndPoint(ct.geometry)::geography) <= $4
        ),
        y_intersections AS (
          -- Y-intersections: where trails meet at acute angles (not perpendicular)
          SELECT 
            ST_Force2D((ST_Dump(ST_Intersection(ct.geometry::geometry, et.geometry::geometry))).geom) as intersection_point,
            ST_Force3D((ST_Dump(ST_Intersection(ct.geometry::geometry, et.geometry::geometry))).geom) as intersection_point_3d,
            ARRAY[ct.app_uuid, et.app_uuid] as connected_trail_ids,
            ARRAY[ct.name, et.name] as connected_trail_names,
            'y_intersection' as node_type,
            0.0 as distance_meters
          FROM current_trail ct
          JOIN existing_trails et ON ST_Intersects(ct.geometry::geometry, et.geometry::geometry)
          WHERE ST_GeometryType(ST_Intersection(ct.geometry::geometry, et.geometry::geometry)) IN ('ST_Point', 'ST_MultiPoint')
            AND ABS(ST_Azimuth(ST_StartPoint(ct.geometry), ST_EndPoint(ct.geometry)) - 
                   ST_Azimuth(ST_StartPoint(et.geometry), ST_EndPoint(et.geometry))) BETWEEN 15 AND 165
        )
        SELECT * FROM true_intersections
        UNION ALL
        SELECT * FROM t_intersections
        UNION ALL
        SELECT * FROM y_intersections
      `;
      
      // Load Layer 1 configuration for tolerances
      const { loadConfig } = await import('../../utils/config-loader');
      const config = loadConfig();
      
      const intersectionConfig = config.layer1_trails.intersectionDetection;
      const toleranceMeters = intersectionConfig.tIntersectionToleranceMeters;
      const intersectionResult = await this.pgClient.query(intersectionQuery, [
        trail.app_uuid, trail.name, trail.geometry, toleranceMeters
      ]);
      
      // Insert detected intersections with proper column mapping
      for (const intersection of intersectionResult.rows) {
        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.intersection_points (
            intersection_point, intersection_point_3d, connected_trail_ids, 
            connected_trail_names, node_type, distance_meters
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          intersection.intersection_point,        // 2D geometry
          intersection.intersection_point_3d,     // 3D geometry
          intersection.connected_trail_ids,
          intersection.connected_trail_names,
          intersection.node_type,
          intersection.distance_meters
        ]);
        intersectionCount++;
      }
      
      if (copiedCount % 100 === 0) {
        console.log(`   📊 Progress: ${copiedCount}/${trails.length} trails copied, ${intersectionCount} intersections detected`);
      }
    }
    
    console.log(`📊 Copy result: ${copiedCount} trails copied, ${intersectionCount} intersections detected`);
    return copiedCount;
  }

  /**
   * Clean up trails (remove invalid geometries, short segments)
   */
  private async cleanupTrails(): Promise<number> {
    console.log('🧹 Cleaning up trails...');
    
    // Load configuration to get minTrailLengthMeters
    const { loadConfig } = await import('../../utils/config-loader');
    const config = loadConfig();
    const minTrailLengthMeters = config.validation?.minTrailLengthMeters || 0.1; // Use 10cm (0.1m) minimum
    
    console.log(`   📏 Using minimum trail length: ${minTrailLengthMeters}m`);
    
    // DEBUG: Check initial trail count
    const initialCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
    console.log(`   📊 Initial trail count: ${initialCount.rows[0].count}`);
    
    // DEBUG: Show trail names
    const trailNames = await this.pgClient.query(`SELECT name FROM ${this.stagingSchema}.trails ORDER BY name`);
    console.log(`   📋 Trail names: ${trailNames.rows.map(r => r.name).join(', ')}`);
    
    // Step 1: Clean up GeometryCollections and complex geometries
    console.log('   🔧 Step 1: Cleaning up GeometryCollections and complex geometries...');
    
    // Clean up GeometryCollections by extracting LineStrings
    const geometryCollectionResult = await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET geometry = ST_LineMerge(ST_CollectionHomogenize(geometry))
      WHERE ST_GeometryType(geometry) = 'ST_GeometryCollection'
    `);
    console.log(`   ✅ Processed ${geometryCollectionResult.rowCount || 0} GeometryCollections`);
    
    // Convert MultiLineStrings to LineStrings
    const multiLineStringResult = await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET geometry = ST_LineMerge(geometry)
      WHERE ST_GeometryType(geometry) = 'ST_MultiLineString'
    `);
    console.log(`   ✅ Processed ${multiLineStringResult.rowCount || 0} MultiLineStrings`);
    
    // Fix invalid geometries
    const invalidGeomResult = await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET geometry = ST_MakeValid(geometry)
      WHERE NOT ST_IsValid(geometry)
    `);
    console.log(`   ✅ Fixed ${invalidGeomResult.rowCount || 0} invalid geometries`);
    
          // TEMPORARILY DISABLED: Non-simple geometry splitting is corrupting trails
      console.log('   ⚠️ Step 1.5: Non-simple geometry splitting temporarily disabled to prevent trail corruption');
      console.log('   ✅ Skipping non-simple geometry splitting (handled by other services)');

      // Step 1.6: TEMPORARILY DISABLED - Split trails that intersect twice (like the connector trail)
      console.log('   ⚠️ Step 1.6: Double intersection splitting temporarily disabled to prevent trail corruption');
      console.log('   ✅ Skipping double intersection splitting (handled by other services)');

    // Remove other problematic geometries that can't be fixed
    const problematicResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE ST_GeometryType(geometry) != 'ST_LineString'
        OR ST_IsEmpty(geometry)
        OR ST_Length(geometry) < 0.001
    `);
    console.log(`   🗑️ Removed ${problematicResult.rowCount || 0} other problematic geometries`);
    
    // Final check for any remaining problematic geometries
    const remainingProblematic = await this.pgClient.query(`
      SELECT COUNT(*) as count 
      FROM ${this.stagingSchema}.trails 
      WHERE ST_GeometryType(geometry) != 'ST_LineString'
    `);
    
    if (remainingProblematic.rows[0].count > 0) {
      console.warn(`   ⚠️ Found ${remainingProblematic.rows[0].count} problematic geometries, removing them...`);
      
      const finalCleanupResult = await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.trails 
        WHERE ST_GeometryType(geometry) != 'ST_LineString'
      `);
      console.log(`   🗑️ Removed ${finalCleanupResult.rowCount || 0} remaining problematic geometries`);
    }
    
    // Step 2: Remove very short segments (use configurable minimum length)
    const shortResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE ST_Length(geometry::geography) < $1
    `, [minTrailLengthMeters]);
    console.log(`   🗑️ Removed ${shortResult.rowCount || 0} short segments (< ${minTrailLengthMeters}m)`);

    // Step 3: Remove trails with too few points
    const fewPointsResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE ST_NumPoints(geometry) < 2
    `);
    console.log(`   🗑️ Removed ${fewPointsResult.rowCount || 0} trails with < 2 points`);

    // Get final count
    const finalCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
    const finalTrailCount = parseInt(finalCount.rows[0].count);
    console.log(`   📊 Final trail count: ${finalTrailCount}`);
    
    if (finalTrailCount === 0) {
      throw new Error('No valid trails remaining after geometry cleanup');
    }
    
    console.log(`   ✅ Geometry cleanup completed: ${finalTrailCount} trails remaining`);
    
    return (geometryCollectionResult.rowCount || 0) + (multiLineStringResult.rowCount || 0) + 
           (invalidGeomResult.rowCount || 0) + (problematicResult.rowCount || 0) + 
           (shortResult.rowCount || 0) + (fewPointsResult.rowCount || 0);
  }

  /**
   * Fill gaps in trail network (using configurable settings)
   */
  private async fillTrailGaps(): Promise<number> {
    console.log('🔗 Filling gaps in trail network...');
    
    try {
      // Load route discovery configuration
      const { RouteDiscoveryConfigLoader } = await import('../../config/route-discovery-config-loader');
      const routeConfig = RouteDiscoveryConfigLoader.getInstance().loadConfig();
      
      // Check if gap filling is disabled
      if (routeConfig.trailGapFilling.toleranceMeters <= 0 || routeConfig.trailGapFilling.maxConnectors <= 0) {
        console.log('   ⏭️ Gap filling disabled in config - skipping connector creation');
        console.log('   ✅ Trail gap filling completed (disabled)');
        return 0;
      }
      
      // Use the existing TrailGapFillingService
      const { TrailGapFillingService } = await import('../../utils/services/network-creation/trail-gap-filling-service');
      const trailGapService = new TrailGapFillingService(this.pgClient, this.stagingSchema);
      
      // Get gap filling configuration from route discovery config
      const gapConfig = {
        toleranceMeters: routeConfig.trailGapFilling.toleranceMeters,
        maxConnectorsToCreate: routeConfig.trailGapFilling.maxConnectors,
        minConnectorLengthMeters: routeConfig.trailGapFilling.minConnectorLengthMeters
      };
      
      console.log(`   🔍 Gap filling config: ${gapConfig.toleranceMeters}m tolerance, max ${gapConfig.maxConnectorsToCreate} connectors`);
      
      const gapResult = await trailGapService.detectAndFillTrailGaps(gapConfig);
      console.log(`   ✅ Trail gap filling completed: ${gapResult.connectorTrailsCreated} connectors created`);
      
      return gapResult.connectorTrailsCreated;
      
    } catch (error) {
      console.error('   ❌ Error during trail gap filling:', error);
      return 0;
    }
  }

  /**
   * Remove duplicates/overlaps while preserving all trails
   */
  private async deduplicateTrails(): Promise<number> {
    console.log('🔄 Removing duplicate trails...');
    
    try {
      const { TrailDeduplicationService } = await import('../../utils/services/network-creation/trail-deduplication-service');
      const dedupService = new TrailDeduplicationService(this.pgClient, this.stagingSchema);
      
      const duplicatesRemoved = await dedupService.deduplicateTrails();
      console.log(`   🗑️ Removed ${duplicatesRemoved} duplicate trails`);
      
      // Get final stats
      const stats = await dedupService.getTrailStats();
      console.log(`   📊 Final trail stats: ${stats.totalTrails} trails, ${stats.totalLength.toFixed(3)}km total length`);
      
      return duplicatesRemoved;
      
    } catch (error) {
      console.error('   ❌ Error during trail deduplication:', error);
      return 0;
    }
  }

  /**
   * Snap trails together within tolerance
   */
  private async snapTrailsTogether(): Promise<number> {
    console.log('🔗 Snapping trails together within tolerance...');
    
    // Load Layer 1 configuration for tolerances
    const { loadConfig } = await import('../../utils/config-loader');
    const config = loadConfig();
    const intersectionConfig = config.layer1_trails.intersectionDetection;
    const snapTolerance = intersectionConfig.tIntersectionToleranceMeters;
    
    console.log(`   📏 Using snap tolerance: ${snapTolerance} meters`);
    
    // Get initial count
    const initialCountResult = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
    const initialCount = parseInt(initialCountResult.rows[0].count);
    
    // Snap trails together using ST_Snap
    const snapResult = await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails t1
      SET geometry = (
        SELECT ST_Snap(
          t1.geometry,
          ST_Union(t2.geometry),
          ${snapTolerance / 111000.0}  -- Convert meters to degrees
        )
        FROM ${this.stagingSchema}.trails t2
        WHERE t2.id != t1.id
          AND ST_DWithin(t1.geometry, t2.geometry, ${snapTolerance / 111000.0})
      )
      WHERE EXISTS (
        SELECT 1 FROM ${this.stagingSchema}.trails t2
        WHERE t2.id != t1.id
          AND ST_DWithin(t1.geometry, t2.geometry, ${snapTolerance / 111000.0})
      )
    `);
    
    const finalCountResult = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
    const finalCount = parseInt(finalCountResult.rows[0].count);
    
    console.log(`   ✅ Snapping complete: ${initialCount} → ${finalCount} trails`);
    
    return finalCount - initialCount;
  }

  /**
   * Split trails at Y/T intersections using prototype logic
   * FIXED: Now includes all trail metadata and handles in single transaction
   */
  private async splitTrailsAtYIntersections(): Promise<number> {
    console.log('🔗 Splitting trails at Y/T intersections using prototype logic...');
    
    // Load Layer 1 configuration for tolerances
    const { loadConfig } = await import('../../utils/config-loader');
    const config = loadConfig();
    const intersectionConfig = config.layer1_trails.intersectionDetection;
    const tolerance = intersectionConfig.tIntersectionToleranceMeters;
    
    console.log(`   📏 Using T-intersection tolerance: ${tolerance} meters`);
    
    // Get initial count
    const initialCountResult = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
    const initialCount = parseInt(initialCountResult.rows[0].count);
    
    // Find Y/T intersections where one trail's endpoint is close to another trail
    const intersectionResult = await this.findYIntersectionsOptimized(tolerance);
    
    const intersectionCount = intersectionResult.length;
    console.log(`   📊 Found ${intersectionCount} Y/T intersections (optimized)`);
    
    if (intersectionCount === 0) {
      console.log('   ✅ No Y/T intersections found, no splitting needed');
      return 0;
    }
    
    // Start transaction for atomic operation
    await this.pgClient.query('BEGIN');
    
    try {
      // Create backup of original trails
      await this.pgClient.query(`CREATE TABLE ${this.stagingSchema}.trails_backup AS SELECT * FROM ${this.stagingSchema}.trails`);
      
      // Process each intersection using prototype logic
      let splitSegments = [];
      
      for (const intersection of intersectionResult) {
        const visitorEndpoint = intersection.endpoint_type === 'start' ? 
          intersection.visitor_start : intersection.visitor_end;
        
        // Find closest point on visited trail to visitor endpoint (prototype logic)
        const closestPointResult = await this.pgClient.query(`
          SELECT ST_ClosestPoint($1::geometry, $2::geometry) as closest_point
        `, [intersection.visited_geom, visitorEndpoint]);
        
        const closestPoint = closestPointResult.rows[0].closest_point;
        
        // Split visited trail at intersection point (prototype logic)
        const splitResult = await this.pgClient.query(`
          SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
        `, [intersection.visited_geom, closestPoint]);
        
        // Filter out segments shorter than 5 meters (prototype logic)
        for (let i = 0; i < splitResult.rows.length; i++) {
          const segment = splitResult.rows[i].segment;
          const lengthResult = await this.pgClient.query(`
            SELECT ST_Length($1::geography) as length_m
          `, [segment]);
          
          if (lengthResult.rows[0].length_m > 5) {
            splitSegments.push({
              original_app_uuid: intersection.visited_uuid, // Preserve original UUID for metadata lookup
              name: intersection.visited_name, // Keep original name without modification
              geometry: segment,
              length_km: lengthResult.rows[0].length_m / 1000.0
            });
          }
        }
      }
      
      // Delete original trails that were split (to prevent duplicates)
      const visitedIds = Array.from(new Set(intersectionResult.map((r: any) => r.visited_id)));
      if (visitedIds.length > 0) {
        const placeholders = visitedIds.map((_, i) => `$${i + 1}`).join(', ');
        await this.pgClient.query(`
          DELETE FROM ${this.stagingSchema}.trails
          WHERE id IN (${placeholders})
        `, visitedIds);
        console.log(`   🗑️ Deleted ${visitedIds.length} original trails that were split`);
      }
      
      // Insert split segments with COMPLETE metadata (FIXED)
      if (splitSegments.length > 0) {
        for (const segment of splitSegments) {
          await this.pgClient.query(`
            INSERT INTO ${this.stagingSchema}.trails (
              app_uuid, original_trail_uuid, name, trail_type, surface, difficulty,
              geometry, length_km, elevation_gain, elevation_loss,
              max_elevation, min_elevation, avg_elevation,
              bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
              source, source_tags, osm_id
            )
            SELECT 
              gen_random_uuid() as app_uuid,
              $1 as original_trail_uuid,
              $2 as name,
              trail_type, surface, difficulty,
              ST_Force3D($3::geometry) as geometry,
              $4 as length_km,
              elevation_gain, elevation_loss,
              max_elevation, min_elevation, avg_elevation,
              bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
              source, source_tags, osm_id
            FROM ${this.stagingSchema}.trails_backup
            WHERE app_uuid = $1
          `, [segment.original_app_uuid, segment.name, segment.geometry, segment.length_km]);
        }
        console.log(`   📝 Inserted ${splitSegments.length} split segments with complete metadata`);
      }
      
      // Recompute length for all rows to ensure consistency after splitting
      // NOTE: This UPDATE preserves original_trail_uuid to maintain data integrity
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.trails
        SET length_km = ST_Length(geometry::geography) / 1000.0
        WHERE geometry IS NOT NULL
      `);
      
      // Recalculate elevation stats (gain/loss/min/max/avg) for all trail segments
      await this.pgClient.query(`
        WITH pts AS (
          SELECT 
            t.id AS trail_id,
            (dp.path)[1] AS pt_index,
            ST_Z(dp.geom) AS z
          FROM ${this.stagingSchema}.trails t,
          LATERAL ST_DumpPoints(t.geometry) dp
        ),
        deltas AS (
          SELECT
            trail_id,
            GREATEST(z - LAG(z) OVER (PARTITION BY trail_id ORDER BY pt_index), 0) AS up,
            GREATEST(LAG(z) OVER (PARTITION BY trail_id ORDER BY pt_index) - z, 0) AS down,
            z
          FROM pts
        ),
        agg AS (
          SELECT 
            trail_id,
            COALESCE(SUM(up), 0) AS elevation_gain,
            COALESCE(SUM(down), 0) AS elevation_loss,
            MAX(z) AS max_elevation,
            MIN(z) AS min_elevation,
            AVG(z) AS avg_elevation
          FROM deltas
          GROUP BY trail_id
        )
        UPDATE ${this.stagingSchema}.trails t
        SET 
          elevation_gain = a.elevation_gain,
          elevation_loss = a.elevation_loss,
          max_elevation = a.max_elevation,
          min_elevation = a.min_elevation,
          avg_elevation = a.avg_elevation
        FROM agg a
        WHERE t.id = a.trail_id
      `);
      
      // Clean up backup table
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails_backup`);
      
      // Commit transaction
      await this.pgClient.query('COMMIT');
      
      const finalCountResult = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
      const finalCount = parseInt(finalCountResult.rows[0].count);
      const segmentsCreated = finalCount - initialCount;
      
      console.log(`   ✅ Y/T intersection splitting complete: ${initialCount} → ${finalCount} segments (+${segmentsCreated})`);
      console.log(`   🔒 Transaction committed: Split segments have complete metadata`);
      
      return segmentsCreated;
      
    } catch (error) {
      // Rollback transaction on error
      await this.pgClient.query('ROLLBACK');
      console.error('❌ Error in Y/T intersection splitting, transaction rolled back:', error);
      throw error;
    }
  }

  /**
   * Split trails at intersections using modern PostGIS ST_Node() approach
   */
  private async splitTrailsAtIntersections(): Promise<number> {
    console.log('🔗 Splitting trails at all intersections...');
    
    // TEMPORARILY DISABLED: PgRoutingSplittingService is corrupting trails
    // Use modern PgRoutingSplittingService approach
    console.log('   ⚠️ PgRoutingSplittingService temporarily disabled to prevent trail corruption');
    console.log('   ✅ Skipping intersection splitting (already handled by IntersectionBasedTrailSplitter)');
    return 0; // No additional splitting performed
  }

  /**
   * PgRouting splitting approach using PgRoutingSplittingService
   */
  private async splitTrailsWithModernApproach(): Promise<number> {
    try {
      const { PgRoutingSplittingService } = await import('./PgRoutingSplittingService');
      
      // Load Layer 1 config to get proper tolerance settings
      const { loadConfig } = await import('../../utils/config-loader');
      const config = loadConfig();
      const intersectionTolerance = config.layer1_trails?.intersectionDetection?.trueIntersectionToleranceMeters ?? 1.0;
      
      console.log(`   🔧 Using intersection tolerance from Layer 1 config: ${intersectionTolerance}m`);
      
      const splittingService = new PgRoutingSplittingService({
        stagingSchema: this.stagingSchema,
        pgClient: this.pgClient,
        toleranceMeters: 0.00001, // ~1 meter in degrees
        minSegmentLengthMeters: 1.0,
        preserveOriginalTrails: false,
        intersectionTolerance: intersectionTolerance // Use tolerance from Layer 1 config
      });

      // Use the specified splitting method
      let result;
      if (this.config.splittingMethod === 'postgis') {
        // Use PostGIS ST_Node approach
        result = await splittingService.splitTrailsAtIntersections();
      } else {
        // Default to pgRouting functions (better for near-miss scenarios)
        result = await splittingService.splitTrailsWithPgRouting();
      }

      if (!result.success) {
        throw new Error(`PgRouting splitting failed: ${result.error}`);
      }

      // Detect intersection points for analysis
      await splittingService.detectIntersectionPoints();

      // Get statistics
      const stats = await splittingService.getSplitStatistics();
      console.log(`   📊 PgRouting splitting statistics:`, stats);

      return result.splitSegmentCount;

    } catch (error) {
      console.error('   ❌ Error during PgRouting trail splitting:', error);
      throw error;
    }
  }





  /**
   * Deduplicate overlapping trail segments to ensure each coordinate is covered by only one trail
   */
  private async deduplicateOverlappingTrails(): Promise<number> {
    console.log('🔄 Deduplicating overlapping trail segments...');
    
    try {
      // Get initial count
      const initialCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      `);
      const initialCount = parseInt(initialCountResult.rows[0].count);
      
      // Create backup of current trails
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_backup_2 AS 
        SELECT * FROM ${this.stagingSchema}.trails
      `);
      
      // Find and remove overlapping segments, keeping the best representative for each unique geometry
      const deduplicationResult = await this.pgClient.query(`
        WITH overlapping_segments AS (
          -- Find segments that have any overlap
          SELECT 
            t1.app_uuid as trail1_id,
            t1.name as trail1_name,
            t1.geometry as trail1_geom,
            ST_Length(t1.geometry::geography) as trail1_length,
            t2.app_uuid as trail2_id,
            t2.name as trail2_name,
            t2.geometry as trail2_geom,
            ST_Length(t2.geometry::geography) as trail2_length,
            ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) as overlap_length
          FROM ${this.stagingSchema}.trails_backup_2 t1
          JOIN ${this.stagingSchema}.trails_backup_2 t2 ON t1.app_uuid < t2.app_uuid
          WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) > 0
        ),
        segments_to_remove AS (
          -- For each overlapping pair, decide which one to keep
          SELECT DISTINCT
            CASE 
              -- Keep the longer segment, or if same length, keep the one with better name
              WHEN trail1_length > trail2_length THEN trail2_id
              WHEN trail2_length > trail1_length THEN trail1_id
              WHEN trail1_name < trail2_name THEN trail2_id  -- Alphabetical tiebreaker
              ELSE trail1_id
            END as remove_id
          FROM overlapping_segments
        )
        SELECT COUNT(*) as duplicates_found
        FROM segments_to_remove
      `);
      
      const duplicatesFound = parseInt(deduplicationResult.rows[0].duplicates_found);
      
      if (duplicatesFound > 0) {
        // Remove duplicate segments
        await this.pgClient.query(`
          WITH overlapping_segments AS (
            SELECT 
              t1.app_uuid as trail1_id,
              t1.name as trail1_name,
              t1.geometry as trail1_geom,
              ST_Length(t1.geometry::geography) as trail1_length,
              t2.app_uuid as trail2_id,
              t2.name as trail2_name,
              t2.geometry as trail2_geom,
              ST_Length(t2.geometry::geography) as trail2_length,
              ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) as overlap_length
            FROM ${this.stagingSchema}.trails_backup_2 t1
            JOIN ${this.stagingSchema}.trails_backup_2 t2 ON t1.app_uuid < t2.app_uuid
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) > 0
          ),
          segments_to_remove AS (
            SELECT DISTINCT
              CASE 
                WHEN trail1_length > trail2_length THEN trail2_id
                WHEN trail2_length > trail1_length THEN trail1_id
                WHEN trail1_name < trail2_name THEN trail2_id
                ELSE trail1_id
              END as remove_id
            FROM overlapping_segments
          )
          DELETE FROM ${this.stagingSchema}.trails 
          WHERE app_uuid IN (SELECT remove_id FROM segments_to_remove)
        `);
        
        console.log(`   🗑️ Removed ${duplicatesFound} overlapping segments`);
      } else {
        console.log(`   ✅ No overlapping segments found`);
      }
      
      // Get final count
      const finalCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      `);
      const finalCount = parseInt(finalCountResult.rows[0].count);
      
      // Clean up backup table
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails_backup_2`);
      
      const removed = initialCount - finalCount;
      console.log(`   📊 Overlap deduplication: ${initialCount} → ${finalCount} segments (removed ${removed})`);
      
      return removed;
      
    } catch (error) {
      console.error('   ❌ Error during overlap deduplication:', error);
      throw error;
    }
  }

  /**
   * Analyze Layer 1 connectivity using pgRouting tools
   */
  private async analyzeLayer1Connectivity(): Promise<any> {
    try {
      const { PgRoutingConnectivityAnalysisService } = await import('../../utils/services/network-creation/pgrouting-connectivity-analysis-service');
      const client = await this.pgClient.connect();
      const connectivityService = new PgRoutingConnectivityAnalysisService(this.stagingSchema, client);
      
      const metrics = await connectivityService.analyzeLayer1Connectivity();
      
      console.log('📊 LAYER 1 SPATIAL RELATIONSHIP ANALYSIS:');
      console.log(`   🛤️ Total trails: ${metrics.totalTrails}`);
      console.log(`   🔗 Trail intersections: ${metrics.intersectionCount}`);
      console.log(`   🏝️ Isolated trails: ${metrics.isolatedTrails}`);
      console.log(`   📊 Connectivity percentage: ${metrics.connectivityPercentage.toFixed(2)}%`);
      console.log(`   📏 Total trail network length: ${metrics.totalTrailNetworkLength.toFixed(2)}km`);
      console.log(`   🏔️ Total elevation gain: ${metrics.totalElevationGain.toFixed(1)}m`);
      console.log(`   📉 Total elevation loss: ${metrics.totalElevationLoss.toFixed(1)}m`);
      console.log(`   📏 Max trail length: ${metrics.maxTrailLength.toFixed(2)}km`);
      console.log(`   📏 Min trail length: ${metrics.minTrailLength.toFixed(2)}km`);
      console.log(`   🎯 NEAR MISSES: ${metrics.nearMisses} endpoint pairs within 100m (avg: ${metrics.avgNearMissDistance.toFixed(1)}m)`);
      console.log(`   🔄 NEARLY INTERSECTING: ${metrics.nearlyIntersecting} trail pairs within 500m (avg: ${metrics.avgNearlyIntersectingDistance.toFixed(1)}m)`);
      console.log(`   📍 ENDPOINT PROXIMITY: ${metrics.endpointProximity} endpoints near other trails (avg: ${metrics.avgEndpointProximityDistance.toFixed(1)}m)`);
      
      // Display trail type distribution if available
      if (metrics.details?.trailTypeDistribution && Object.keys(metrics.details.trailTypeDistribution).length > 0) {
        console.log(`   🏷️ Trail type distribution:`);
        Object.entries(metrics.details.trailTypeDistribution)
          .sort((a, b) => (b[1] as number) - (a[1] as number))
          .slice(0, 5)
          .forEach(([type, count]) => {
            console.log(`      ${type}: ${count} trails`);
          });
      }
      
      // Display difficulty distribution if available
      if (metrics.details?.difficultyDistribution && Object.keys(metrics.details.difficultyDistribution).length > 0) {
        console.log(`   ⚡ Difficulty distribution:`);
        Object.entries(metrics.details.difficultyDistribution)
          .sort((a, b) => (b[1] as number) - (a[1] as number))
          .slice(0, 5)
          .forEach(([difficulty, count]) => {
            console.log(`      ${difficulty}: ${count} trails`);
          });
      }
      
      return metrics;
      
    } catch (error) {
      console.error('   ❌ Error during Layer 1 connectivity analysis:', error);
      return null;
    }
  }

  /**
   * Split a trail at its center using centralized validation
   * This ensures proper geometry validation and UUID preservation
   */
  private async splitTrailAtCenterWithValidation(trailId: number, trailName: string): Promise<void> {
    try {
      // Get the trail data
      const trailResult = await this.pgClient.query(`
        SELECT app_uuid, name, geometry, length_km, elevation_gain, elevation_loss
        FROM ${this.stagingSchema}.trails
        WHERE id = $1
      `, [trailId]);

      if (trailResult.rows.length === 0) {
        console.log(`   ⚠️ Trail ${trailName} not found for splitting`);
        return;
      }

      const trail = trailResult.rows[0];
      
      // Create split operation for centralized manager
      const splitOperation: TrailSplitOperation = {
        originalTrailId: trail.app_uuid,
        originalTrailName: trail.name,
        originalGeometry: trail.geometry,
        originalLengthKm: trail.length_km,
        originalElevationGain: trail.elevation_gain || 0,
        originalElevationLoss: trail.elevation_loss || 0,
        splitPoints: [{
          lng: 0.5, // Split at 50% along the trail
          lat: 0.5,
          distance: trail.length_km * 0.5 * 1000 // Convert to meters
        }]
      };

      // Use centralized trail split manager for validation
      const result = await this.splitManager.splitTrailAtomically(splitOperation, 'TrailProcessingService');
      
      if (result.success) {
        console.log(`   ✅ Successfully split ${trailName} with validation: ${result.segmentsCreated} segments created`);
      } else {
        console.error(`   ❌ Failed to split ${trailName}: ${result.error}`);
        throw new Error(`Trail splitting failed: ${result.error}`);
      }

    } catch (error) {
      console.error(`   ❌ Error splitting trail ${trailName}:`, error);
      throw error;
    }
  }

  /**
   * Find Y/T intersections using optimized spatial queries
   * Replaces the expensive CROSS JOIN with spatial pre-filtering
   */
  private async findYIntersectionsOptimized(tolerance: number): Promise<any[]> {
    console.log(`   🔍 Finding Y/T intersections with optimized spatial queries...`);
    
    const intersectionResult = await this.pgClient.query(`
      WITH trail_endpoints AS (
        SELECT 
          id,
          app_uuid,
          name,
          geometry,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point
        FROM ${this.stagingSchema}.trails
        WHERE ST_IsValid(geometry) AND ST_GeometryType(geometry) = 'ST_LineString'
      ),
      endpoint_pairs AS (
        -- Pre-filter using bounding boxes and distance (much faster than CROSS JOIN)
        SELECT 
          t1.id as visitor_id,
          t1.app_uuid as visitor_uuid,
          t1.name as visitor_name,
          t1.geometry as visitor_geom,
          t1.start_point as visitor_start,
          t1.end_point as visitor_end,
          t2.id as visited_id,
          t2.app_uuid as visited_uuid,
          t2.name as visited_name,
          t2.geometry as visited_geom
        FROM trail_endpoints t1
        JOIN trail_endpoints t2 ON (
          t1.id < t2.id AND  -- Avoid duplicate pairs
          t1.geometry && t2.geometry AND  -- Bounding box intersection (fast)
          ST_DWithin(t1.geometry::geography, t2.geometry::geography, $1)  -- Distance filter
        )
      ),
      start_intersections AS (
        -- Check start point intersections
        SELECT 
          visitor_id,
          visitor_uuid,
          visitor_name,
          visitor_geom,
          visitor_start,
          visitor_end,
          visited_id,
          visited_uuid,
          visited_name,
          visited_geom,
          'start' as endpoint_type,
          ST_Distance(visitor_start::geography, visited_geom::geography) as distance
        FROM endpoint_pairs
        WHERE ST_Distance(visitor_start::geography, visited_geom::geography) <= $1
      ),
      end_intersections AS (
        -- Check end point intersections
        SELECT 
          visitor_id,
          visitor_uuid,
          visitor_name,
          visitor_geom,
          visitor_start,
          visitor_end,
          visited_id,
          visited_uuid,
          visited_name,
          visited_geom,
          'end' as endpoint_type,
          ST_Distance(visitor_end::geography, visited_geom::geography) as distance
        FROM endpoint_pairs
        WHERE ST_Distance(visitor_end::geography, visited_geom::geography) <= $1
      ),
      all_intersections AS (
        SELECT * FROM start_intersections
        UNION ALL
        SELECT * FROM end_intersections
      )
      SELECT DISTINCT ON (visitor_id, visited_id)
        visitor_id,
        visitor_uuid,
        visitor_name,
        visitor_geom,
        visitor_start,
        visitor_end,
        visited_id,
        visited_uuid,
        visited_name,
        visited_geom,
        endpoint_type,
        distance
      FROM all_intersections
      ORDER BY visitor_id, visited_id, distance ASC
    `, [tolerance]);
    
    const intersectionCount = intersectionResult.rows.length;
    console.log(`   📊 Found ${intersectionCount} Y/T intersections (optimized)`);
    
    return intersectionResult.rows;
  }
}
