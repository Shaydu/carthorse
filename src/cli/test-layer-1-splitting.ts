#!/usr/bin/env npx ts-node

/**
 * Layer 1 Trail Splitting Services Test Suite
 * 
 * This script allows you to test all trail splitting services in isolation or in combination.
 * You can enable/disable services by setting the CONFIG flags below.
 * 
 * Usage:
 *   npx ts-node src/cli/test-layer-1-splitting.ts
 *   npx ts-node src/cli/test-layer-1-splitting.ts --cleanup  # Clean up debug schemas
 * 
 * To test a specific service:
 *   1. Set the corresponding CONFIG.run* flag to true
 *   2. Set all other CONFIG.run* flags to false
 *   3. Run the script
 * 
 * To test multiple services in sequence:
 *   1. Set multiple CONFIG.run* flags to true
 *   2. Services will run in the order they appear in the pipeline
 *   3. Run the script
 * 
 * Services are organized by:
 *   - Main Pipeline Services: The services used in the actual TrailProcessingService pipeline
 *   - Additional Services: Other available services not in the main pipeline
 */

import { Pool } from 'pg';
import { loadConfig } from '../utils/config-loader';

// Import all splitting services in the order they appear in the orchestrator pipeline
import { EndpointSnappingService } from '../services/layer1/EndpointSnappingService';
import { TIntersectionSplittingService } from '../services/layer1/TIntersectionSplittingService';
import { ShortTrailSplittingService } from '../services/layer1/ShortTrailSplittingService';
import { IntersectionBasedTrailSplitter } from '../services/layer1/IntersectionBasedTrailSplitter';
import { EnhancedIntersectionSplittingService } from '../services/layer1/EnhancedIntersectionSplittingService';
import { YIntersectionSplittingService } from '../services/layer1/YIntersectionSplittingService';
import { VertexBasedSplittingService } from '../services/layer1/VertexBasedSplittingService';
// import { IntersectionSplittingService } from '../services/layer1/IntersectionSplittingService'; // Has TS errors
import { PublicTrailIntersectionSplittingService } from '../services/layer1/PublicTrailIntersectionSplittingService';
import { STSplitDoubleIntersectionService } from '../services/layer1/STSplitDoubleIntersectionService';
import { StandaloneTrailSplittingService } from '../services/layer1/StandaloneTrailSplittingService';
import { YIntersectionSnappingService } from '../services/layer1/YIntersectionSnappingService';
import { MissedIntersectionDetectionService } from '../services/layer1/MissedIntersectionDetectionService';
import { ComplexIntersectionSplittingService } from '../services/layer1/ComplexIntersectionSplittingService';
// import { PgRoutingSplittingService } from '../services/layer1/PgRoutingSplittingService'; // Has TS errors via IntersectionSplittingService
import { ProximitySnappingSplittingService } from '../services/layer1/ProximitySnappingSplittingService';

// Check for cleanup flag
const shouldCleanup = process.argv.includes('--cleanup');

// 🔧 CONFIGURATION FLAGS - Set these to true/false to enable/disable services
const CONFIG = {
  // Service toggles (EndpointSnapping moved to run first)
  runEndpointSnapping: true,                    // Step 1: EndpointSnappingService (moved to run first)
  runProximitySnappingSplitting: true,           // Step 2: ProximitySnappingSplittingService
  runEnhancedIntersectionSplitting: false,       // Step 3: EnhancedIntersectionSplittingService
  runTIntersectionSplitting: true,              // Step 4: TIntersectionSplittingService (ModularSplittingOrchestrator)
  runShortTrailSplitting: false,                 // Step 5: ShortTrailSplittingService (ModularSplittingOrchestrator)
  runIntersectionBasedTrailSplitter: false,      // Step 6: IntersectionBasedTrailSplitter (ModularSplittingOrchestrator)
  runYIntersectionSnapping: true,               // Step 7: YIntersectionSnappingService
  runVertexBasedSplitting: true,                 // Step 8: VertexBasedSplittingService
  runMissedIntersectionDetection: false,         // Step 9: MissedIntersectionDetectionServicewhy 
  runStandaloneTrailSplitting: false,            // Step 10: StandaloneTrailSplittingService
  
  // Additional services (not in main pipeline but available)
  runYIntersectionSplitting: false,               // YIntersectionSplittingService (has TS errors)
  runIntersectionSplitting: false,               // IntersectionSplittingService
  runPublicTrailIntersectionSplitting: false,    // PublicTrailIntersectionSplittingService
  runSTSplitDoubleIntersection: false,           // STSplitDoubleIntersectionService
  runComplexIntersectionSplitting: false,        // ComplexIntersectionSplittingService
  runPgRoutingSplitting: false,                  // PgRoutingSplittingService
  
  // Export options
  exportGeoJSON: true,            // Export results as GeoJSON
  exportMesaOnly: false,          // Export only Mesa trail (for focused testing)
  
  // Service parameters
  toleranceMeters: 5.0,           // Tolerance for spatial operations (5m for endpoint snapping)
  tIntersectionToleranceMeters: 3.0, // Tolerance for T-intersections
  yIntersectionToleranceMeters: 10.0, // Tolerance for Y-intersections
  shortTrailMaxLengthKm: 0.5,     // Max length for short trail splitting
  minSegmentLengthMeters: 5.0,    // Minimum segment length
  verbose: true,                  // Verbose logging
  
  // Debug options
  cleanupStagingSchema: false     // Keep staging schema for debugging (true = cleanup, false = keep)
};

async function cleanupDebugSchemas() {
  console.log('🧹 Cleaning up all debug schemas...');
  
  // Load configuration
  const config = loadConfig();
  const dbConfig = config.database.connection;

  // Create database connection
  const pgClient = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
  });

  try {
    // Get all debug schemas
    const debugSchemas = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'debug_%'
    `);

    if (debugSchemas.rows.length === 0) {
      console.log('✅ No debug schemas found to clean up');
      return;
    }

    console.log(`📋 Found ${debugSchemas.rows.length} debug schema(s) to clean up:`);
    debugSchemas.rows.forEach(row => {
      console.log(`   - ${row.schema_name}`);
    });

    // Drop all debug schemas
    for (const row of debugSchemas.rows) {
      console.log(`🗑️  Dropping schema: ${row.schema_name}`);
      await pgClient.query(`DROP SCHEMA IF EXISTS ${row.schema_name} CASCADE`);
    }

    console.log('✅ All debug schemas cleaned up successfully!');

  } catch (error) {
    console.error('❌ Error cleaning up debug schemas:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

async function testVertexBasedSplitting() {
  console.log('🧪 Testing Trail Splitting Services in Isolation...\n');
  console.log('🔧 Configuration:');
  console.log('   Main Pipeline Services:');
  console.log(`   - ProximitySnappingSplitting: ${CONFIG.runProximitySnappingSplitting ? '✅' : '❌'}`);
  console.log(`   - EnhancedIntersectionSplitting: ${CONFIG.runEnhancedIntersectionSplitting ? '✅' : '❌'}`);
  console.log(`   - TIntersectionSplitting: ${CONFIG.runTIntersectionSplitting ? '✅' : '❌'}`);
  console.log(`   - ShortTrailSplitting: ${CONFIG.runShortTrailSplitting ? '✅' : '❌'}`);
  console.log(`   - IntersectionBasedTrailSplitter: ${CONFIG.runIntersectionBasedTrailSplitter ? '✅' : '❌'}`);
  console.log(`   - YIntersectionSnapping: ${CONFIG.runYIntersectionSnapping ? '✅' : '❌'}`);
  console.log(`   - VertexBasedSplitting: ${CONFIG.runVertexBasedSplitting ? '✅' : '❌'}`);
  console.log(`   - MissedIntersectionDetection: ${CONFIG.runMissedIntersectionDetection ? '✅' : '❌'}`);
  console.log(`   - EndpointSnapping: ${CONFIG.runEndpointSnapping ? '✅' : '❌'}`);
  console.log(`   - StandaloneTrailSplitting: ${CONFIG.runStandaloneTrailSplitting ? '✅' : '❌'}`);
  console.log('   Additional Services:');
  console.log(`   - YIntersectionSplitting: ${CONFIG.runYIntersectionSplitting ? '✅' : '❌'} (has TS errors)`);
  console.log(`   - IntersectionSplitting: ${CONFIG.runIntersectionSplitting ? '✅' : '❌'}`);
  console.log(`   - PublicTrailIntersectionSplitting: ${CONFIG.runPublicTrailIntersectionSplitting ? '✅' : '❌'}`);
  console.log(`   - STSplitDoubleIntersection: ${CONFIG.runSTSplitDoubleIntersection ? '✅' : '❌'}`);
  console.log(`   - ComplexIntersectionSplitting: ${CONFIG.runComplexIntersectionSplitting ? '✅' : '❌'}`);
  console.log(`   - PgRoutingSplitting: ${CONFIG.runPgRoutingSplitting ? '✅' : '❌'}`);
  console.log('   Export Options:');
  console.log(`   - Export GeoJSON: ${CONFIG.exportGeoJSON ? '✅' : '❌'}`);
  console.log(`   - Export Mesa Only: ${CONFIG.exportMesaOnly ? '✅' : '❌'}`);
  console.log(`   - Tolerance: ${CONFIG.toleranceMeters}m`);
  console.log(`   - Y-Intersection Tolerance: ${CONFIG.yIntersectionToleranceMeters}m`);
  console.log(`   - Cleanup Staging Schema: ${CONFIG.cleanupStagingSchema ? '✅' : '❌'}\n`);

  // Load configuration
  const config = loadConfig();
  const dbConfig = config.database.connection;
  
  // Create database connection
  const pgClient = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
  });

  try {
    // Create a fresh staging schema for testing
    const stagingSchema = `debug_${Date.now()}`;
    console.log(`📋 Creating staging schema: ${stagingSchema}`);
    
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
    
    // Copy trails from public schema to staging schema
    // Use expanded bbox to match what VertexBasedSplittingService will validate against
    console.log('📋 Copying trails to staging schema...');
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.trails AS 
      SELECT *, app_uuid as original_trail_uuid FROM public.trails 
      WHERE ST_Intersects(geometry, ST_MakeEnvelope(-105.323322108554 - 0.01, 39.9414084228671 - 0.01, -105.246109155213 + 0.01, 40.139896554615 + 0.01, 4326))
        AND source = 'cotrex'
    `);
    
    // Copy intersection points to staging schema
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.intersection_points AS 
      SELECT * FROM public.intersection_points 
      WHERE ST_Intersects(point, ST_MakeEnvelope(-105.323322108554 - 0.01, 39.9414084228671 - 0.01, -105.246109155213 + 0.01, 40.139896554615 + 0.01, 4326))
    `);

    // Create routing_nodes table for EndpointSnappingService
    console.log('📋 Creating routing_nodes table for endpoint snapping...');
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.routing_nodes AS
      SELECT 
        id,
        gen_random_uuid() as node_uuid,
        ST_Y(geom) as lat,
        ST_X(geom) as lng,
        0 as elevation,
        'intersection' as node_type,
        array_length(connected_trails, 1) as connected_trails
      FROM (
        SELECT 
          ROW_NUMBER() OVER() as id,
          geom,
          connected_trails
        FROM (
          SELECT DISTINCT
            ST_GeomFromText(ST_AsText(point)) as geom,
            connected_trail_names as connected_trails
          FROM ${stagingSchema}.intersection_points
        ) t
      ) nodes
    `);

    // Add primary key and indexes
    await pgClient.query(`ALTER TABLE ${stagingSchema}.routing_nodes ADD PRIMARY KEY (id);`);
    await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${stagingSchema}_routing_nodes_geom ON ${stagingSchema}.routing_nodes USING gist (ST_SetSRID(ST_MakePoint(lng, lat), 4326));`);
    await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${stagingSchema}_routing_nodes_connected_trails ON ${stagingSchema}.routing_nodes (connected_trails);`);

    // Check what we have to work with
    const trailCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
    const intersectionCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.intersection_points`);
    const nodeCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_nodes`);
    
    console.log(`📊 Found ${trailCount.rows[0].count} trails, ${intersectionCount.rows[0].count} intersection points, and ${nodeCount.rows[0].count} routing nodes`);
    
    // Check specifically for Mesa trail
    const mesaTrails = await pgClient.query(`
      SELECT app_uuid, name, ST_Length(geometry::geography) as length_m, 
             ST_IsValid(geometry) as is_valid, ST_IsSimple(geometry) as is_simple
      FROM ${stagingSchema}.trails 
      WHERE name = 'Mesa'
    `);
    
    if (mesaTrails.rows.length > 0) {
      console.log(`🎯 Found ${mesaTrails.rows.length} Mesa trail(s):`);
      mesaTrails.rows.forEach((trail, index) => {
        console.log(`   ${index + 1}. UUID: ${trail.app_uuid}`);
        console.log(`      Length: ${trail.length_m.toFixed(2)}m`);
        console.log(`      Valid: ${trail.is_valid}, Simple: ${trail.is_simple}`);
      });
    }

    // Check Mesa intersection points
    const mesaIntersections = await pgClient.query(`
      SELECT node_type, connected_trail_names, ST_AsText(point) as point
      FROM ${stagingSchema}.intersection_points 
      WHERE 'Mesa' = ANY(connected_trail_names)
    `);
    
    if (mesaIntersections.rows.length > 0) {
      console.log(`🎯 Found ${mesaIntersections.rows.length} Mesa intersection point(s):`);
      mesaIntersections.rows.forEach((intersection, index) => {
        console.log(`   ${index + 1}. Type: ${intersection.node_type}`);
        console.log(`      Connected trails: ${intersection.connected_trail_names.join(', ')}`);
        console.log(`      Point: ${intersection.point}`);
      });
    }

    // Results storage
    const results: any = {};

    // Step 1: EndpointSnappingService (moved to run first)
    if (CONFIG.runEndpointSnapping) {
      console.log('\n🔧 Step 1: Running EndpointSnappingService...');
      try {
        const endpointSnappingService = new EndpointSnappingService(stagingSchema, pgClient);
        results.endpointSnapping = await endpointSnappingService.processAllEndpoints();
        console.log('✅ EndpointSnappingService completed!');
        console.log(`📊 Results: ${JSON.stringify(results.endpointSnapping, null, 2)}`);
      } catch (error) {
        console.error('❌ EndpointSnappingService failed:', error);
        results.endpointSnapping = { error: (error as Error).message };
      }
    } else {
      console.log('\n⏭️  Skipping EndpointSnappingService (disabled in config)');
    }

    // Step 2: ProximitySnappingSplittingService
    if (CONFIG.runProximitySnappingSplitting) {
      console.log('\n🔧 Step 2: Running ProximitySnappingSplittingService...');
      try {
        const proximityService = new ProximitySnappingSplittingService(pgClient, {
          stagingSchema,
          proximityToleranceMeters: CONFIG.toleranceMeters,
          minTrailLengthMeters: 10.0,
          maxIterations: 3,
          verbose: CONFIG.verbose
        });
        results.proximitySnapping = await proximityService.applyProximitySnappingSplitting();
        console.log('✅ ProximitySnappingSplittingService completed!');
        console.log(`📊 Results: ${JSON.stringify(results.proximitySnapping, null, 2)}`);
      } catch (error) {
        console.error('❌ ProximitySnappingSplittingService failed:', error);
        results.proximitySnapping = { error: (error as Error).message };
      }
    } else {
      console.log('\n⏭️  Skipping ProximitySnappingSplittingService (disabled in config)');
    }

    // Step 3: EnhancedIntersectionSplittingService
    if (CONFIG.runEnhancedIntersectionSplitting) {
      console.log('\n🔧 Step 3: Running EnhancedIntersectionSplittingService...');
      try {
        const enhancedService = new EnhancedIntersectionSplittingService(pgClient, stagingSchema, {
          toleranceMeters: CONFIG.toleranceMeters,
          verbose: CONFIG.verbose
        });
        results.enhancedIntersection = await enhancedService.applyEnhancedIntersectionSplitting();
        console.log('✅ EnhancedIntersectionSplittingService completed!');
        console.log(`📊 Results: ${JSON.stringify(results.enhancedIntersection, null, 2)}`);
      } catch (error) {
        console.error('❌ EnhancedIntersectionSplittingService failed:', error);
        results.enhancedIntersection = { error: (error as Error).message };
      }
    } else {
      console.log('\n⏭️  Skipping EnhancedIntersectionSplittingService (disabled in config)');
    }

    // Step 4: TIntersectionSplittingService
    if (CONFIG.runTIntersectionSplitting) {
      console.log('\n🔧 Step 4: Running TIntersectionSplittingService...');
      try {
        const tIntersectionService = new TIntersectionSplittingService({
          stagingSchema,
          pgClient,
          toleranceMeters: CONFIG.tIntersectionToleranceMeters,
          minSegmentLengthMeters: CONFIG.minSegmentLengthMeters,
          verbose: CONFIG.verbose
        });
        results.tIntersection = await tIntersectionService.execute();
        console.log('✅ TIntersectionSplittingService completed!');
        console.log(`📊 Results: ${JSON.stringify(results.tIntersection, null, 2)}`);
      } catch (error) {
        console.error('❌ TIntersectionSplittingService failed:', error);
        results.tIntersection = { error: (error as Error).message };
      }
    } else {
      console.log('\n⏭️  Skipping TIntersectionSplittingService (disabled in config)');
    }

    // Step 5: ShortTrailSplittingService
    if (CONFIG.runShortTrailSplitting) {
      console.log('\n🔧 Step 5: Running ShortTrailSplittingService...');
      try {
        const shortTrailService = new ShortTrailSplittingService({
          stagingSchema,
          pgClient,
          maxTrailLengthKm: CONFIG.shortTrailMaxLengthKm,
          minSegmentLengthMeters: CONFIG.minSegmentLengthMeters,
          verbose: CONFIG.verbose
        });
        results.shortTrail = await shortTrailService.execute();
        console.log('✅ ShortTrailSplittingService completed!');
        console.log(`📊 Results: ${JSON.stringify(results.shortTrail, null, 2)}`);
      } catch (error) {
        console.error('❌ ShortTrailSplittingService failed:', error);
        results.shortTrail = { error: (error as Error).message };
      }
    } else {
      console.log('\n⏭️  Skipping ShortTrailSplittingService (disabled in config)');
    }

    // Step 6: IntersectionBasedTrailSplitter
    if (CONFIG.runIntersectionBasedTrailSplitter) {
      console.log('\n🔧 Step 6: Running IntersectionBasedTrailSplitter...');
      try {
        const intersectionBasedService = new IntersectionBasedTrailSplitter({
          stagingSchema,
          pgClient,
          minSegmentLengthMeters: CONFIG.minSegmentLengthMeters,
          verbose: CONFIG.verbose
        });
        results.intersectionBased = await intersectionBasedService.execute();
        console.log('✅ IntersectionBasedTrailSplitter completed!');
        console.log(`📊 Results: ${JSON.stringify(results.intersectionBased, null, 2)}`);
      } catch (error) {
        console.error('❌ IntersectionBasedTrailSplitter failed:', error);
        results.intersectionBased = { error: (error as Error).message };
      }
    } else {
      console.log('\n⏭️  Skipping IntersectionBasedTrailSplitter (disabled in config)');
    }

    // Step 7: YIntersectionSnappingService
    if (CONFIG.runYIntersectionSnapping) {
      console.log('\n🔧 Step 7: Running YIntersectionSnappingService...');
      try {
        const client = await pgClient.connect();
        const ySnappingService = new YIntersectionSnappingService(client, stagingSchema);
        results.yIntersectionSnapping = await ySnappingService.processYIntersections();
        client.release();
        console.log('✅ YIntersectionSnappingService completed!');
        console.log(`📊 Results: ${JSON.stringify(results.yIntersectionSnapping, null, 2)}`);
      } catch (error) {
        console.error('❌ YIntersectionSnappingService failed:', error);
        results.yIntersectionSnapping = { error: (error as Error).message };
      }
    } else {
      console.log('\n⏭️  Skipping YIntersectionSnappingService (disabled in config)');
    }

    // Step 8: VertexBasedSplittingService
    if (CONFIG.runVertexBasedSplitting) {
      console.log('\n🔧 Step 8: Running VertexBasedSplittingService...');
      try {
        const serviceConfig = {
          stagingSchema: stagingSchema,
          toleranceMeters: CONFIG.toleranceMeters,
          verbose: CONFIG.verbose,
          region: 'boulder',
          sourceFilter: 'cotrex',
          bbox: [-105.323322108554, 39.9414084228671, -105.246109155213, 40.139896554615]
        };
        const vertexSplittingService = new VertexBasedSplittingService(pgClient, stagingSchema, serviceConfig);
        results.vertexBased = await vertexSplittingService.applyVertexBasedSplitting();
        console.log('✅ VertexBasedSplittingService completed!');
        console.log(`📊 Results: ${JSON.stringify(results.vertexBased, null, 2)}`);
      } catch (error) {
        console.error('❌ VertexBasedSplittingService failed:', error);
        results.vertexBased = { error: (error as Error).message };
      }
    } else {
      console.log('\n⏭️  Skipping VertexBasedSplittingService (disabled in config)');
    }

    // Step 9: MissedIntersectionDetectionService
    if (CONFIG.runMissedIntersectionDetection) {
      console.log('\n🔧 Step 9: Running MissedIntersectionDetectionService...');
      try {
        const missedIntersectionService = new MissedIntersectionDetectionService({
          stagingSchema,
          pgClient
        });
        results.missedIntersection = await missedIntersectionService.detectAndFixMissedIntersections();
        console.log('✅ MissedIntersectionDetectionService completed!');
        console.log(`📊 Results: ${JSON.stringify(results.missedIntersection, null, 2)}`);
      } catch (error) {
        console.error('❌ MissedIntersectionDetectionService failed:', error);
        results.missedIntersection = { error: (error as Error).message };
      }
    } else {
      console.log('\n⏭️  Skipping MissedIntersectionDetectionService (disabled in config)');
    }

    // Step 10: StandaloneTrailSplittingService
    if (CONFIG.runStandaloneTrailSplitting) {
      console.log('\n🔧 Step 10: Running StandaloneTrailSplittingService...');
      try {
        const standaloneService = new StandaloneTrailSplittingService(pgClient, {
          stagingSchema,
          intersectionTolerance: CONFIG.toleranceMeters,
          minSegmentLength: CONFIG.minSegmentLengthMeters,
          verbose: CONFIG.verbose
        });
        results.standaloneTrail = await standaloneService.splitTrailsAndReplace();
        console.log('✅ StandaloneTrailSplittingService completed!');
        console.log(`📊 Results: ${JSON.stringify(results.standaloneTrail, null, 2)}`);
      } catch (error) {
        console.error('❌ StandaloneTrailSplittingService failed:', error);
        results.standaloneTrail = { error: (error as Error).message };
      }
    } else {
      console.log('\n⏭️  Skipping StandaloneTrailSplittingService (disabled in config)');
    }

    // Additional Services (not in main pipeline)

    // YIntersectionSplittingService
    if (CONFIG.runYIntersectionSplitting) {
      console.log('\n🔧 Running YIntersectionSplittingService...');
      try {
        const client = await pgClient.connect();
        const yIntersectionSplittingService = new YIntersectionSplittingService(client, stagingSchema, {
          toleranceMeters: CONFIG.yIntersectionToleranceMeters,
          minTrailLengthMeters: CONFIG.minSegmentLengthMeters,
          maxIterations: 5,
          verbose: CONFIG.verbose
        });
        results.yIntersectionSplitting = await yIntersectionSplittingService.applyYIntersectionSplitting();
        client.release();
        console.log('✅ YIntersectionSplittingService completed!');
        console.log(`📊 Results: ${JSON.stringify(results.yIntersectionSplitting, null, 2)}`);
      } catch (error) {
        console.error('❌ YIntersectionSplittingService failed:', error);
        results.yIntersectionSplitting = { error: (error as Error).message };
      }
    } else {
      console.log('\n⏭️  Skipping YIntersectionSplittingService (disabled in config)');
    }

    // IntersectionSplittingService (disabled due to TypeScript errors)
    if (CONFIG.runIntersectionSplitting) {
      console.log('\n⏭️  IntersectionSplittingService is disabled due to TypeScript compilation errors');
      console.log('   To enable: Fix the TS errors in IntersectionSplittingService.ts first');
      results.intersectionSplitting = { error: 'TypeScript compilation errors prevent execution' };
    } else {
      console.log('\n⏭️  Skipping IntersectionSplittingService (disabled in config)');
    }

    // PublicTrailIntersectionSplittingService
    if (CONFIG.runPublicTrailIntersectionSplitting) {
      console.log('\n🔧 Running PublicTrailIntersectionSplittingService...');
      try {
        const publicTrailService = new PublicTrailIntersectionSplittingService(pgClient, stagingSchema, {
          region: 'boulder',
          bbox: [-105.323322108554, 39.9414084228671, -105.246109155213, 40.139896554615],
          sourceFilter: 'cotrex'
        });
        results.publicTrailIntersection = await publicTrailService.splitIntersectionsFromPublicTrails();
        console.log('✅ PublicTrailIntersectionSplittingService completed!');
        console.log(`📊 Results: ${JSON.stringify(results.publicTrailIntersection, null, 2)}`);
      } catch (error) {
        console.error('❌ PublicTrailIntersectionSplittingService failed:', error);
        results.publicTrailIntersection = { error: (error as Error).message };
      }
    } else {
      console.log('\n⏭️  Skipping PublicTrailIntersectionSplittingService (disabled in config)');
    }

    // STSplitDoubleIntersectionService
    if (CONFIG.runSTSplitDoubleIntersection) {
      console.log('\n🔧 Running STSplitDoubleIntersectionService...');
      try {
        const stSplitService = new STSplitDoubleIntersectionService({
          stagingSchema,
          pgClient,
          minTrailLengthMeters: CONFIG.minSegmentLengthMeters
        });
        results.stSplitDouble = await stSplitService.splitTrailsAtIntersections();
        console.log('✅ STSplitDoubleIntersectionService completed!');
        console.log(`📊 Results: ${JSON.stringify(results.stSplitDouble, null, 2)}`);
      } catch (error) {
        console.error('❌ STSplitDoubleIntersectionService failed:', error);
        results.stSplitDouble = { error: (error as Error).message };
      }
    } else {
      console.log('\n⏭️  Skipping STSplitDoubleIntersectionService (disabled in config)');
    }

    // ComplexIntersectionSplittingService
    if (CONFIG.runComplexIntersectionSplitting) {
      console.log('\n🔧 Running ComplexIntersectionSplittingService...');
      try {
        const complexService = new ComplexIntersectionSplittingService({
          stagingSchema,
          pgClient,
          minSegmentLengthMeters: CONFIG.minSegmentLengthMeters,
          verbose: CONFIG.verbose
        });
        results.complexIntersection = await complexService.execute();
        console.log('✅ ComplexIntersectionSplittingService completed!');
        console.log(`📊 Results: ${JSON.stringify(results.complexIntersection, null, 2)}`);
      } catch (error) {
        console.error('❌ ComplexIntersectionSplittingService failed:', error);
        results.complexIntersection = { error: (error as Error).message };
      }
    } else {
      console.log('\n⏭️  Skipping ComplexIntersectionSplittingService (disabled in config)');
    }

    // PgRoutingSplittingService (disabled due to TypeScript errors)
    if (CONFIG.runPgRoutingSplitting) {
      console.log('\n⏭️  PgRoutingSplittingService is disabled due to TypeScript compilation errors');
      console.log('   To enable: Fix the TS errors in IntersectionSplittingService.ts first');
      results.pgroutingSplitting = { error: 'TypeScript compilation errors prevent execution' };
    } else {
      console.log('\n⏭️  Skipping PgRoutingSplittingService (disabled in config)');
    }

    // Summary of all results
    console.log('\n📊 SUMMARY OF ALL SERVICES:');
    console.log('============================');
    Object.entries(results).forEach(([serviceName, result]) => {
      if (result && (result as any).error) {
        console.log(`❌ ${serviceName}: FAILED - ${(result as any).error}`);
      } else if (result) {
        console.log(`✅ ${serviceName}: SUCCESS`);
      } else {
        console.log(`⏭️  ${serviceName}: SKIPPED`);
      }
    });

    // Check Mesa trail after splitting
    const mesaAfterSplitting = await pgClient.query(`
      SELECT app_uuid, name, ST_Length(geometry::geography) as length_m,
             ST_IsValid(geometry) as is_valid, ST_IsSimple(geometry) as is_simple
      FROM ${stagingSchema}.trails 
      WHERE name = 'Mesa'
      ORDER BY ST_Length(geometry::geography) DESC
    `);
    
    if (mesaAfterSplitting.rows.length > 0) {
      console.log(`\n🎯 Mesa trail(s) after splitting:`);
      mesaAfterSplitting.rows.forEach((trail, index) => {
        console.log(`   ${index + 1}. UUID: ${trail.app_uuid}`);
        console.log(`      Length: ${trail.length_m.toFixed(2)}m`);
        console.log(`      Valid: ${trail.is_valid}, Simple: ${trail.is_simple}`);
      });
    }

    // Export split trails as GeoJSON for visualization (if enabled)
    if (CONFIG.exportGeoJSON) {
      console.log('\n📤 Exporting split trails as GeoJSON...');
      
      const whereClause = CONFIG.exportMesaOnly ? "WHERE name = 'Mesa'" : "";
      const geojsonResult = await pgClient.query(`
        SELECT jsonb_build_object(
          'type', 'FeatureCollection',
          'metadata', jsonb_build_object(
            'generated_at', NOW(),
            'staging_schema', '${stagingSchema}',
            'enabled_services', jsonb_build_object(
              'endpoint_snapping', ${CONFIG.runEndpointSnapping},
              'proximity_snapping_splitting', ${CONFIG.runProximitySnappingSplitting},
              'enhanced_intersection_splitting', ${CONFIG.runEnhancedIntersectionSplitting},
              't_intersection_splitting', ${CONFIG.runTIntersectionSplitting},
              'short_trail_splitting', ${CONFIG.runShortTrailSplitting},
              'intersection_based_trail_splitter', ${CONFIG.runIntersectionBasedTrailSplitter},
              'y_intersection_snapping', ${CONFIG.runYIntersectionSnapping},
              'vertex_based_splitting', ${CONFIG.runVertexBasedSplitting},
              'missed_intersection_detection', ${CONFIG.runMissedIntersectionDetection},
              'standalone_trail_splitting', ${CONFIG.runStandaloneTrailSplitting}
            ),
            'service_parameters', jsonb_build_object(
              'tolerance_meters', ${CONFIG.toleranceMeters},
              't_intersection_tolerance_meters', ${CONFIG.tIntersectionToleranceMeters},
              'y_intersection_tolerance_meters', ${CONFIG.yIntersectionToleranceMeters},
              'short_trail_max_length_km', ${CONFIG.shortTrailMaxLengthKm},
              'min_segment_length_meters', ${CONFIG.minSegmentLengthMeters}
            ),
            'export_options', jsonb_build_object(
              'export_geojson', ${CONFIG.exportGeoJSON},
              'export_mesa_only', ${CONFIG.exportMesaOnly},
              'cleanup_staging_schema', ${CONFIG.cleanupStagingSchema}
            )
          ),
          'features', jsonb_agg(
            jsonb_build_object(
              'type', 'Feature',
              'properties', jsonb_build_object(
                'app_uuid', app_uuid,
                'name', name,
                'length_m', ST_Length(geometry::geography),
                'is_valid', ST_IsValid(geometry),
                'is_simple', ST_IsSimple(geometry),
                'original_trail_uuid', original_trail_uuid
              ),
              'geometry', ST_AsGeoJSON(geometry)::jsonb
            )
          )
        ) as geojson
        FROM ${stagingSchema}.trails
        ${whereClause}
      `);

      const geojson = geojsonResult.rows[0].geojson;
      const serviceSuffix = CONFIG.runEndpointSnapping ? 'endpoint-vertex' : 'vertex-only';
      const mesaSuffix = CONFIG.exportMesaOnly ? '-mesa' : '';
      const outputPath = `test-output/boulder-${serviceSuffix}-splitting-test${mesaSuffix}-${stagingSchema}.geojson`;
      
      // Ensure output directory exists
      const fs = require('fs');
      const path = require('path');
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
      console.log(`✅ GeoJSON exported to: ${outputPath}`);
      console.log(`📊 Exported ${geojson.features.length} trail segments`);
    } else {
      console.log('\n⏭️  Skipping GeoJSON export (disabled in config)');
    }

          // Clean up staging schema (if enabled)
          if (CONFIG.cleanupStagingSchema) {
            console.log(`\n🧹 Cleaning up staging schema: ${stagingSchema}`);
            await pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
          } else {
            console.log(`\n🔍 Keeping staging schema for debugging: ${stagingSchema}`);
            console.log(`   You can query it with: psql -h localhost -U carthorse -d trail_master_db -c "\\dt ${stagingSchema}.*"`);
            console.log(`   To clean up all debug schemas, run: npx ts-node src/cli/test-vertex-based-splitting.ts --cleanup`);
          }

  } catch (error) {
    console.error('❌ Error testing VertexBasedSplittingService:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the test
if (require.main === module) {
  if (shouldCleanup) {
    cleanupDebugSchemas()
      .then(() => {
        console.log('\n🎉 Cleanup completed successfully!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n💥 Cleanup failed:', error);
        process.exit(1);
      });
  } else {
    testVertexBasedSplitting()
      .then(() => {
        console.log('\n🎉 Test completed successfully!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n💥 Test failed:', error);
        process.exit(1);
      });
  }
}
