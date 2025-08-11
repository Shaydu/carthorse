#!/usr/bin/env node
/**
 * CARTHORSE Main Export CLI
 * 
 * Main command-line interface for Carthorse trail data processing
 * This provides the primary 'carthorse' command as described in the README
 */

import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { readFileSync, existsSync, accessSync, constants } from 'fs';
import { getTolerances, getExportSettings, getDatabaseConfig } from '../utils/config-loader';

// Check database configuration
const dbConfig = getDatabaseConfig();
if (!dbConfig.database) {
  console.error(chalk.red('❌ Database configuration is missing'));
  console.error(chalk.red('   Please check your configs/carthorse.config.yaml file'));
  process.exit(1);
}

// Import the enhanced orchestrator from the compiled JavaScript
let CarthorseOrchestrator: any;
try {
  // Import the enhanced orchestrator from the compiled JavaScript
  const orchestratorModule = require('../orchestrator/CarthorseOrchestrator');
  CarthorseOrchestrator = orchestratorModule.CarthorseOrchestrator;
} catch (error) {
      console.error(chalk.red('❌ Failed to load CarthorseOrchestrator:'));
  console.error(chalk.red('   Make sure the orchestrator is properly compiled to JavaScript'));
  console.error(chalk.red('   Error:'), (error as Error).message);
  process.exit(1);
}

// Read version from package.json
// Robustly resolve the package.json location for both local and npm-installed usage
let packageJson: any;
try {
  // Try to resolve from project root
  const pkgPath = path.resolve(__dirname, '../../package.json');
  packageJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
} catch (e) {
  packageJson = { version: 'dev' };
}

// Suppress all logs for --version
if (process.argv.includes('--version')) {
  console.log(packageJson.version);
  process.exit(0);
}

const program = new Command();

// Add install command as the very first check
if (process.argv.includes('install')) {
  (async () => {
    try {
      // Parse install options from command line
      const args = process.argv.slice(2);
      const options = {
        region: 'unknown',
        limit: '1000',
        empty: false,
        skipTestPopulation: false
      };

      // Extract region if specified
      const regionIndex = args.indexOf('--region');
      if (regionIndex !== -1 && regionIndex + 1 < args.length) {
        options.region = args[regionIndex + 1];
      }

      // Extract limit if specified
      const limitIndex = args.indexOf('--limit');
      if (limitIndex !== -1 && limitIndex + 1 < args.length) {
        options.limit = args[limitIndex + 1];
      }

      // Check for empty flag
      options.empty = args.includes('--empty');
      
      // Check for skip test population flag
      options.skipTestPopulation = args.includes('--skip-test-population');

      if (options.empty) {
        console.log('🧪 Installing empty test database...');
        await CarthorseOrchestrator.installTestDatabaseEmpty();
      } else if (options.skipTestPopulation) {
        console.log('🧪 Installing test database (schema only, no data population)...');
        await CarthorseOrchestrator.installTestDatabaseEmpty();
      } else {
        const region = options.region;
        const limit = parseInt(options.limit);
        
        if (isNaN(limit) || limit <= 0) {
          console.error('❌ Invalid limit value. Must be a positive number.');
          process.exit(1);
        }
        
        console.log(`🧪 Installing test database with ${region} region data (limit: ${limit} trails)`);
        await CarthorseOrchestrator.installTestDatabase(region, limit);
      }
      console.log('✅ Installation completed successfully!');
    } catch (error) {
      console.error('❌ Installation failed:', error);
      process.exit(1);
    }
    
    process.exit(0);
  })();
  
  // Don't exit immediately - let the async function complete
}

// Add clean-test-data as a top-level command before required options
if (process.argv.includes('--clean-test-data')) {
  (async () => {
    const orchestratorModule = require('../orchestrator/CarthorseOrchestrator');
    const CarthorseOrchestrator = orchestratorModule.CarthorseOrchestrator;
    await CarthorseOrchestrator.cleanAllTestStagingSchemas();
    process.exit(0);
  })();
}

// Add install-populate as a top-level command before required options
if (process.argv.includes('install-populate')) {
  (async () => {
    try {
      const orchestratorModule = require('../orchestrator/CarthorseOrchestrator');
      const CarthorseOrchestrator = orchestratorModule.CarthorseOrchestrator;
      
      // Parse arguments manually
      const args = process.argv.slice(2);
      const regionIndex = args.indexOf('--region');
      const limitIndex = args.indexOf('--limit');
      
      const region = regionIndex !== -1 && regionIndex + 1 < args.length ? args[regionIndex + 1] : 'unknown';
      const limit = limitIndex !== -1 && limitIndex + 1 < args.length ? parseInt(args[limitIndex + 1]) : 1000;
      
      if (isNaN(limit) || limit <= 0) {
        console.error('❌ Invalid limit value. Must be a positive number.');
        process.exit(1);
      }
      
      console.log(`🧪 Installing test database with ${region} region data (limit: ${limit} trails)`);
      await CarthorseOrchestrator.installPopulateTestDatabase(region, limit);
      console.log('✅ Install-populate completed successfully!');
      process.exit(0);
    } catch (error) {
      console.error('❌ Install-populate failed:', error);
      process.exit(1);
    }
  })();
}



// Add comprehensive cleanup as a top-level command
if (process.argv.includes('--cleanup-disk-space')) {
  (async () => {
    console.log('🧹 Starting comprehensive disk space cleanup...');
    
    // Parse cleanup options from command line
    const args = process.argv.slice(2);
    const options = {
      region: 'all',
      aggressiveCleanup: !args.includes('--no-aggressive-cleanup'),
      cleanupOldStagingSchemas: !args.includes('--no-cleanup-old-staging'),
      cleanupTempFiles: !args.includes('--no-cleanup-temp-files'),
      maxStagingSchemasToKeep: 2,
      cleanupDatabaseLogs: args.includes('--cleanup-db-logs'),
      cleanupOnError: false
    };

    // Extract region if specified
    const regionIndex = args.indexOf('--region');
    if (regionIndex !== -1 && regionIndex + 1 < args.length) {
      options.region = args[regionIndex + 1];
    }

    // Extract max staging schemas if specified
    const maxSchemasIndex = args.indexOf('--max-staging-schemas');
    if (maxSchemasIndex !== -1 && maxSchemasIndex + 1 < args.length) {
      options.maxStagingSchemasToKeep = parseInt(args[maxSchemasIndex + 1]) || 2;
    }

    console.log('📋 Cleanup options:', options);

    try {
      if (options.region === 'all') {
        // Clean up all test staging schemas
        const orchestratorModule = require('../orchestrator/CarthorseOrchestrator');
        const CarthorseOrchestrator = orchestratorModule.CarthorseOrchestrator;
        await CarthorseOrchestrator.cleanAllTestStagingSchemas();
        console.log('✅ All test staging schemas cleaned up');
      } else {
        // Create a minimal orchestrator for cleanup
        const { CarthorseOrchestrator } = require('../orchestrator/CarthorseOrchestrator');
        const orchestrator = new CarthorseOrchestrator({
          region: options.region,
          outputPath: '/tmp/cleanup-temp.db', // Dummy path
          simplifyTolerance: 0.001,
          intersectionTolerance: 2.0,
          replace: false,
          validate: false,
          verbose: true,
          skipBackup: true,
          buildMaster: false,
          targetSizeMB: null,
          maxSqliteDbSizeMB: 400,
          skipIncompleteTrails: false,
          useSqlite: false,
                      noCleanup: (options as any).noCleanup || false, // Respect noCleanup flag
          aggressiveCleanup: options.aggressiveCleanup,
          cleanupOldStagingSchemas: options.cleanupOldStagingSchemas,
          cleanupTempFiles: options.cleanupTempFiles,
          maxStagingSchemasToKeep: options.maxStagingSchemasToKeep,
          cleanupDatabaseLogs: options.cleanupDatabaseLogs,
          cleanupOnError: options.cleanupOnError
        });

        // Connect and perform cleanup
        await orchestrator.pgClient.connect();
        await orchestrator.performComprehensiveCleanup();
        await orchestrator.pgClient.end();
      }

      console.log('✅ Comprehensive disk space cleanup completed successfully');
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
      process.exit(1);
    }
    
    process.exit(0);
  })();
}

// Add list-test-bboxes as a top-level command
if (process.argv.includes('--list-test-bboxes')) {
  (async () => {
    const { TEST_BBOX_CONFIGS } = require('../utils/sql/region-data');
    console.log('🗺️ Available Test Bbox Configurations:');
    console.log('');
    
    for (const [region, config] of Object.entries(TEST_BBOX_CONFIGS as Record<string, any>)) {
      console.log(`📍 ${region.toUpperCase()}:`);
      for (const [size, bbox] of Object.entries(config as Record<string, any>)) {
        if (bbox) {
          const [minLng, minLat, maxLng, maxLat] = bbox as [number, number, number, number];
          const width = Math.abs(maxLng - minLng);
          const height = Math.abs(maxLat - minLat);
          const areaSqMiles = width * height * 69 * 69 * Math.cos(minLat * Math.PI / 180);
          console.log(`  ${size.padEnd(6)}: [${minLng.toFixed(6)}, ${minLat.toFixed(6)}, ${maxLng.toFixed(6)}, ${maxLat.toFixed(6)}] (~${areaSqMiles.toFixed(2)} sq miles)`);
        } else {
          console.log(`  ${size.padEnd(6)}: full region (no bbox filter)`);
        }
      }
      console.log('');
    }
    
    console.log('💡 Usage Examples:');
    console.log('  carthorse --region boulder --out test.db --test-size small');
    console.log('  carthorse --region seattle --out test.db --test-size medium');
    console.log('  carthorse --region boulder --out full.db (default: full region)');
    process.exit(0);
  })();
}

program
  .name('carthorse')
  .description(`Carthorse Trail Data Processing Pipeline

Process and export trail data from OpenStreetMap with elevation data, routing graphs, and route recommendations.

EXAMPLES:
  Basic Export:
    $ carthorse --region boulder --out data/boulder.db

  Export with Trailhead Routes:
    $ carthorse --region boulder --out data/boulder-trailhead-routes.geojson --format geojson --use-trailheads-only

  Export with Bounding Box:
    $ carthorse --region boulder --out data/boulder-bbox.db --bbox "-105.355,39.868,-105.209,40.017"

  Build Master Database:
    $ carthorse --region boulder --out data/boulder.db --build-master

  Test Export (Small Dataset):
    $ carthorse --region boulder --out data/boulder-test.db --test-size small

  Export Routes Only:
    $ carthorse --region boulder --out data/boulder-routes.geojson --format geojson --routes-only

  Verbose Output:
    $ carthorse --region boulder --out data/boulder.db --verbose

Help:
  $ carthorse --help                                  # Show this help message
  $ carthorse --version                               # Show version
  $ carthorse install --help                          # Show install help
  $ carthorse cleanup --help                          # Show cleanup help`)
  .version(packageJson.version)
  .addHelpText('after', `

Examples:
  $ carthorse --region boulder --out data/boulder.db
  $ carthorse --region seattle --out data/seattle.db --build-master --validate
  $ carthorse --region boulder --out data/boulder.db --simplify-tolerance 0.002 --target-size 100
  $ carthorse --region boulder --out data/boulder.db --skip-incomplete-trails
  $ carthorse --region boulder --out data/boulder.db --use-intersection-nodes
  $ carthorse --region boulder --out data/boulder.db --no-intersection-nodes
  $ carthorse --region boulder --out data/boulder.db --use-split-trails
  $ carthorse --region boulder --out data/boulder.db --no-split-trails
  $ carthorse --region boulder --out data/boulder-test.db --test-size small
  $ carthorse --region seattle --out data/seattle-test.db --test-size medium
  $ carthorse --region boulder --out data/boulder-full.db --test-size full
  $ carthorse --region boulder --out data/boulder.db --skip-bbox-validation
  $ carthorse --region boulder --out data/boulder.db --skip-geometry-validation
  $ carthorse --region boulder --out data/boulder.db --bbox -105.281,40.066,-105.235,40.105
  $ carthorse --region boulder --out data/boulder.db --bbox -105.281,40.066,-105.235,40.105
  $ carthorse --region boulder --out data/boulder --format geojson --bbox -105.281,40.066,-105.235,40.105
  $ carthorse --region boulder --out data/boulder.db --max-refinement-iterations 0
  $ carthorse --region boulder --out data/boulder.db --max-refinement-iterations 1

Database Installation:
  $ carthorse install                                # Install test database with boulder data (1000 trails)
  $ carthorse install --region boulder --limit 500   # Install with 500 boulder trails
  $ carthorse install --region seattle --limit 200   # Install with 200 seattle trails
  $ carthorse install --empty                        # Install empty test database
  $ carthorse install --skip-test-population        # Install schema only, no data population

Database Cleanup:
  $ carthorse cleanup                                # Clean up old staging schemas and temp files
  $ carthorse cleanup --aggressive                   # Aggressive cleanup including old databases
  $ carthorse cleanup --max-schemas 5               # Keep only 5 most recent staging schemas
  $ carthorse cleanup --cleanup-logs                 # Clean up database logs
  $ carthorse cleanup --cleanup-on-error            # Clean up on error

Test Bbox Configurations:
  $ carthorse --list-test-bboxes                     # List available test bbox configurations

Environment:
  $ carthorse --env production                       # Use production database
  $ carthorse --env staging                          # Use staging database
  $ carthorse --env test                             # Use test database (default)

Output Formats:
  $ carthorse --region boulder --out data/boulder --format geojson
  $ carthorse --region boulder --out data/boulder --format sqlite
  $ carthorse --region boulder --out data/boulder --format trails-only

Routes Only Export:
  $ carthorse --region boulder --out data/boulder --format geojson --routes-only
  $ carthorse --region boulder --out data/boulder --format sqlite --routes-only

Validation Options:
  $ carthorse --region boulder --out data/boulder.db --skip-bbox-validation
  $ carthorse --region boulder --out data/boulder.db --skip-geometry-validation
  $ carthorse --region boulder --out data/boulder.db --skip-recommendations  # NOT IMPLEMENTED - ROADMAP

Trail Processing Options:
  $ carthorse --region boulder --out data/boulder.db --use-split-trails
  $ carthorse --region boulder --out data/boulder.db --no-split-trails
  $ carthorse --region boulder --out data/boulder.db --use-pg-node-network
  $ carthorse --region boulder --out data/boulder.db --skip-incomplete-trails

Refinement Options:
  $ carthorse --region boulder --out data/boulder.db --max-refinement-iterations 0
  $ carthorse --region boulder --out data/boulder.db --max-refinement-iterations 1
  $ carthorse --region boulder --out data/boulder.db --max-refinement-iterations 2

Cleanup Options:
  $ carthorse --region boulder --out data/boulder.db --no-cleanup
  $ carthorse --region boulder --out data/boulder.db --cleanup-old-schemas
  $ carthorse --region boulder --out data/boulder.db --cleanup-temp-files
  $ carthorse --region boulder --out data/boulder.db --max-staging-schemas 5
  $ carthorse --region boulder --out data/boulder.db --staging-schema staging_boulder_1234567890
  $ carthorse --region boulder --out data/boulder.db --cleanup-logs
  $ carthorse --region boulder --out data/boulder.db --cleanup-on-error

Verbose Output:
  $ carthorse --region boulder --out data/boulder.db --verbose

Help:
  $ carthorse --help                                  # Show this help message
  $ carthorse --version                               # Show version
  $ carthorse install --help                          # Show install help
  $ carthorse cleanup --help                          # Show cleanup help`)

  .option('-r, --region <region>', 'Region to process (e.g., boulder, seattle)', 'boulder')
  .option('-o, --out <output_path>', 'Output file path (required)', '')
  .option('-f, --format <format>', 'Output format: geojson, sqlite, or trails-only', 'sqlite')
  .option('-e, --env <environment>', 'Database environment: test, staging, or production', 'test')
  
  // Processing Options
  .option('-s, --simplify-tolerance <tolerance>', 'Geometry simplification tolerance (default: 0.001)', '0.001')
  .option('-i, --intersection-tolerance <tolerance>', 'Intersection detection tolerance in meters (default: 2.0)', '2.0')
  .option('-b, --build-master', 'Build master database from OSM data', false)
  .option('-k, --skip-incomplete-trails', 'Skip trails with incomplete data', false)
  .option('-u, --use-sqlite', 'Use SQLite for processing (default: false)', false)
  
  // Route Generation Options
  .option('--use-trailheads-only', 'Generate routes starting only from trailhead coordinates defined in YAML config (overrides trailheads.enabled)', false)
  .option('--no-trailheads', 'Disable trailhead-based route generation and use all available network nodes', false)
  .option('--disable-trailheads-only', 'Force disable trailheads-only mode and use all available network nodes (overrides YAML config)', false)
  .option('-z, --skip-recommendations', 'Skip route recommendations generation (NOT IMPLEMENTED - ROADMAP)', false)
  .option('-w, --use-intersection-nodes', 'Use intersection nodes for routing', false)
  .option('-q, --no-intersection-nodes', 'Do not use intersection nodes for routing', false)
  .option('-x, --use-split-trails', 'Split trails at intersections (default: true)', false)
  .option('-w, --no-split-trails', 'Do not split trails at intersections', false)
  .option('-m, --max-refinement-iterations <iterations>', 'Maximum refinement iterations (default: 0)', '0')
  
  // Export Options
  .option('-t, --target-size <size>', 'Target file size in MB (default: 100)', '100')
  .option('-m, --max-sqlite-db-size <size>', 'Maximum SQLite database size in MB (default: 400)', '400')
  .option('-r, --routes-only', 'Export only routes (no trails, nodes, or edges)', false)
  .option('-g, --geojson', 'Export to GeoJSON format', false)
  
  // Spatial Filtering Options
  .option('-b, --bbox <bbox>', 'Bounding box filter (minLng,minLat,maxLng,maxLat)', '')
  .option('-t, --test-size <size>', 'Test size: small, medium, large, or full', '')
  
  // Validation Options
  .option('-v, --validate', 'Enable validation (enabled by default)', true)
  .option('-d, --skip-validation', 'Skip validation (validation is enabled by default)', false)
  .option('-j, --skip-bbox-validation', 'Skip bbox validation', false)
  .option('-y, --skip-geometry-validation', 'Skip geometry validation', false)
  
  // Cleanup Options
  .option('-n, --no-cleanup', 'Skip cleanup after processing', false)
  .option('-a, --aggressive-cleanup', 'Perform aggressive cleanup', false)
  .option('-c, --cleanup-old-schemas', 'Clean up old staging schemas', false)
  .option('-p, --cleanup-temp-files', 'Clean up temporary files', false)
  .option('-x, --max-staging-schemas <count>', 'Maximum staging schemas to keep (default: 10)', '10')
  .option('-l, --cleanup-logs', 'Clean up database logs', false)
  .option('-g, --cleanup-on-error', 'Clean up on error', false)
  .option('--staging-schema <schema>', 'Use existing staging schema instead of creating new one', '')
  
  // Output Options
  .option('-v, --verbose', 'Enable verbose output', false)
  .action(async (options) => {
    console.log('[CLI] process.argv:', process.argv);
    console.log('[CLI] options.cleanup:', options.cleanup);
    console.log('[CLI] options.noCleanup:', (options as any).noCleanup);
    
    if (options.dryRun) {
      console.log('[CLI] Dry run: arguments parsed successfully.');
      process.exit(0);
    }
    // Validate numeric options
    const numericOptions = [
      { name: 'simplifyTolerance', value: options.simplifyTolerance },
      { name: 'intersectionTolerance', value: options.intersectionTolerance },
      { name: 'targetSize', value: options.targetSize },
      { name: 'maxSqliteDbSize', value: options.maxSqliteDbSize },
      { name: 'limit', value: options.limit }
    ];
    for (const opt of numericOptions) {
      if (opt.value !== undefined && opt.value !== null && isNaN(Number(opt.value))) {
        console.error(`[CLI] Invalid value for --${opt.name}: ${opt.value}`);
        process.exit(1);
      }
    }
    // Validate format option if explicitly provided
    if (options.format && !['sqlite', 'geojson', 'trails-only'].includes(options.format)) {
      console.error(`[CLI] Invalid format: ${options.format}. Must be one of: sqlite, geojson, trails-only`);
      process.exit(1);
    }
    
    // Let the orchestrator handle format detection and path resolution
    let outputPath = options.out;
    
    if (!path.isAbsolute(outputPath)) {
      outputPath = path.resolve(process.cwd(), outputPath);
    }
    const outputDir = path.dirname(outputPath);
    if (!existsSync(outputDir)) {
      console.error(`[CLI] Output directory does not exist: ${outputDir}`);
      process.exit(1);
    }
    try {
      accessSync(outputDir, constants.W_OK);
    } catch (e) {
      console.error(`[CLI] Output directory is not writable: ${outputDir}`);
      process.exit(1);
    }
    try {
      console.log('[CLI] Parsed options:', JSON.stringify(options, null, 2));
      console.log('[CLI] noCleanup flag value:', options.cleanup === false);
      console.log(`[CLI] Using environment: ${options.env}`);
      console.log('[CLI] About to resolve output path...');
      // Determine output path
      // let outputPath = options.out;
      // if (!path.isAbsolute(outputPath)) {
      //   outputPath = path.resolve(process.cwd(), outputPath);
      // }
      console.log('[CLI] Output path resolved:', outputPath);
      console.log('[CLI] About to create orchestrator config...');
      const config = {
        region: options.region,
        outputPath: outputPath,
        stagingSchema: options.stagingSchema || undefined,
        bbox: options.bbox ? (() => {
          const bboxParts = options.bbox.split(',');
          if (bboxParts.length !== 4) {
            console.error(`[CLI] Invalid bbox format. Expected 4 comma-separated values, got: ${options.bbox}`);
            process.exit(1);
          }
          const bboxValues = bboxParts.map(Number);
          if (bboxValues.some(isNaN)) {
            console.error(`[CLI] Invalid bbox values. All values must be numbers: ${options.bbox}`);
            process.exit(1);
          }
          return bboxValues;
        })() : (options.testSize ? (() => {
          // Use predefined test bbox ONLY if test-size is explicitly specified (sm/med/lg)
          const { getTestBbox } = require('../utils/sql/region-data');
          const testBbox = getTestBbox(options.region, options.testSize);
          if (testBbox) {
            console.log(`[CLI] Using ${options.testSize} test bbox for region ${options.region}`);
          } else {
            console.log(`[CLI] Using full region (no bbox filter) for region ${options.region}`);
          }
          return testBbox;
        })() : undefined),
        noCleanup: options.cleanup === false, // Default: false, enabled with --no-cleanup
        useSplitTrails: options.noSplitTrails ? false : true, // Default: true, disabled with --no-split-trails
        trailheadsEnabled: options.disableTrailheadsOnly ? false : (options.noTrailheads ? false : (options.useTrailheadsOnly || true)), // Default: true (enabled), disabled with --no-trailheads or --disable-trailheads-only, forced with --use-trailheads-only
        minTrailLengthMeters: getTolerances().minTrailLengthMeters, // Use YAML configuration instead of hardcoded value
        skipValidation: options.skipValidation || false, // Skip validation if --skip-validation is used (default: false = validation enabled)
        verbose: options.verbose || false, // Enable verbose logging if --verbose is used
        exportConfig: options.routesOnly ? {
          includeTrails: false,
          includeNodes: true,
          includeEdges: false,
          includeRoutes: true
        } : {
          includeTrails: true,
          includeNodes: true,
          includeEdges: true,
          includeRoutes: true
        }
      };
      console.log('[CLI] Orchestrator config:', JSON.stringify(config, null, 2));
      console.log('[CLI] Trailheads config debug:');
      console.log('  - disableTrailheadsOnly:', options.disableTrailheadsOnly);
      console.log('  - noTrailheads:', options.noTrailheads);
      console.log('  - useTrailheadsOnly:', options.useTrailheadsOnly);
      console.log('  - trailheadsEnabled:', config.trailheadsEnabled);
      console.log('[CLI] About to create orchestrator...');
      const orchestrator = new CarthorseOrchestrator(config);
      console.log('[CLI] Orchestrator created, about to run...');
      
      console.log(`[CLI] Starting export with format detection...`);
      await orchestrator.export(options.format as 'geojson' | 'sqlite' | 'trails-only');
      
      console.log('[CLI] Orchestrator run complete.');
      console.log('[CLI] CARTHORSE completed successfully for region:', options.region);
      if (options.geojson) {
        console.log('[CLI] GeoJSON file created successfully');
      } else {
        console.log('[CLI] Output database:', outputPath);
      }
    } catch (error) {
      console.error('[CLI] CARTHORSE failed:', error);
      process.exit(1);
    }
  });

export async function runExport(args: string[] = process.argv) {
  return program.parseAsync(args);
}

if (!process.argv.includes('--version')) {
  console.log('[CLI] Starting export CLI...');
}
program.parseAsync(process.argv).then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('[CLI] Unhandled error:', err);
  process.exit(1);
});