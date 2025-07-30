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
import { INTERSECTION_TOLERANCE } from '../constants';

// Force test environment for all test runs unless explicitly overridden
process.env.PGDATABASE = process.env.PGDATABASE || 'trail_master_db_test';
process.env.PGUSER = process.env.PGUSER || 'tester';

// Import the enhanced orchestrator from the compiled JavaScript
let EnhancedPostgresOrchestrator: any;
try {
  // Import the enhanced orchestrator from the compiled JavaScript
  const orchestratorModule = require('../orchestrator/EnhancedPostgresOrchestrator');
  EnhancedPostgresOrchestrator = orchestratorModule.EnhancedPostgresOrchestrator;
} catch (error) {
  console.error(chalk.red('❌ Failed to load EnhancedPostgresOrchestrator:'));
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

// Add clean-test-data as a top-level command before required options
if (process.argv.includes('--clean-test-data')) {
  (async () => {
    const orchestratorModule = require('../orchestrator/EnhancedPostgresOrchestrator');
    const EnhancedPostgresOrchestrator = orchestratorModule.EnhancedPostgresOrchestrator;
    await EnhancedPostgresOrchestrator.cleanAllTestStagingSchemas();
    process.exit(0);
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
        const orchestratorModule = require('../orchestrator/EnhancedPostgresOrchestrator');
        const EnhancedPostgresOrchestrator = orchestratorModule.EnhancedPostgresOrchestrator;
        await EnhancedPostgresOrchestrator.cleanAllTestStagingSchemas();
        console.log('✅ All test staging schemas cleaned up');
      } else {
        // Create a minimal orchestrator for cleanup
        const { EnhancedPostgresOrchestrator } = require('../orchestrator/EnhancedPostgresOrchestrator');
        const orchestrator = new EnhancedPostgresOrchestrator({
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
          skipCleanup: true, // Don't clean up the staging schema we're about to create
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
  .description('CARTHORSE Trail Data Processing Pipeline')
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

Disk Space Management:
  $ carthorse --region boulder --out data/boulder.db --max-staging-schemas 1
  $ carthorse --region boulder --out data/boulder.db --no-aggressive-cleanup
  $ carthorse --region boulder --out data/boulder.db --cleanup-on-error
  $ carthorse --region boulder --out data/boulder.db --cleanup-db-logs

Additional Commands:
  $ carthorse --list-test-bboxes                    # List available test bbox configurations
  $ carthorse --clean-test-data                     # Clean up test staging schemas
  $ carthorse --cleanup-disk-space                  # Comprehensive disk space cleanup
  $ carthorse --cleanup-disk-space --region boulder # Clean up specific region
  $ carthorse --cleanup-disk-space --max-staging-schemas 1 # Keep only 1 staging schema per region
`);

// Remove redundant --version option (handled by .version())
// Add exitOverride to handle help/version gracefully
program.exitOverride((err) => {
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
    process.exit(0);
  }
  throw err;
});

program
  .option('--dry-run', 'Parse arguments and exit without running export')
  .option('--env <environment>', 'Environment to use (default, bbox-phase2, test)', 'default')
  .option('--clean-test-data', 'Clean up all test-related staging schemas and exit')
  .option('--no-aggressive-cleanup', 'Disable aggressive cleanup (default: enabled)')
  .option('--no-cleanup-old-staging', 'Disable cleanup of old staging schemas (default: enabled)')
  .option('--no-cleanup-temp-files', 'Disable cleanup of temporary files (default: enabled)')
  .option('--cleanup-db-logs', 'Enable cleanup of database logs (default: disabled)')
  .option('--max-staging-schemas <number>', 'Maximum staging schemas to keep per region (default: 2)', '2')
  .option('--cleanup-on-error', 'Perform cleanup even if export fails (default: disabled)')
  .allowUnknownOption()
  .description('Process and export trail data for a specific region')
  .requiredOption('-r, --region <region>', 'Region to process (e.g., boulder, seattle)')
  .requiredOption('-o, --out <output_path>', 'Output database path (required)')
  .option('--simplify-tolerance <tolerance>', 'Geometry simplification tolerance (default: 0.001)', '0.001')
  .option('--intersection-tolerance <tolerance>', 'Intersection detection tolerance in meters (default: 1)', process.env.INTERSECTION_TOLERANCE || INTERSECTION_TOLERANCE.toString())
  .option('--target-size <size_mb>', 'Target database size in MB')
  .option('--max-sqlite-db-size <size_mb>', 'Maximum SQLite database size in MB (default: 400)', '400')
  .option('--use-sqlite', 'Use regular SQLite for export (default: enabled)')
  .option('--use-intersection-nodes', 'Enable intersection nodes for better routing (default: enabled)')
  .option('--no-intersection-nodes', 'Disable intersection nodes (use endpoint-only routing)')
  .option('--use-split-trails', 'Export split trail segments instead of original trails (default: enabled)')
  .option('--no-split-trails', 'Export original trails without splitting at intersections')
  .option('--skip-elevation-processing', 'Skip elevation data processing (useful when TIFF files are not available)')
  .option('--bbox <minLng,minLat,maxLng,maxLat>', 'Optional: Only export trails within this bounding box (comma-separated: minLng,minLat,maxLng,maxLat)')
  .action(async (options) => {
    if (options.dryRun) {
      console.log('[CLI] Dry run: arguments parsed successfully.');
      process.exit(0);
    }
    // Validate numeric options
    const numericOptions = [
      { name: 'simplifyTolerance', value: options.simplifyTolerance },
      { name: 'intersectionTolerance', value: options.intersectionTolerance },
      { name: 'targetSize', value: options.targetSize },
      { name: 'maxSqliteDbSize', value: options.maxSqliteDbSize }
    ];
    for (const opt of numericOptions) {
      if (opt.value !== undefined && opt.value !== null && isNaN(Number(opt.value))) {
        console.error(`[CLI] Invalid value for --${opt.name}: ${opt.value}`);
        process.exit(1);
      }
    }
    // Fail fast if output path is invalid or not writable
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
      console.log('[CLI] Parsed options:', options);
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
        environment: options.env,
        simplifyTolerance: parseFloat(options.simplifyTolerance),
        intersectionTolerance: parseFloat(options.intersectionTolerance),
        replace: options.replace || false,
        validate: options.validate || false,
        verbose: options.verbose || false,
        skipBackup: options.skipBackup !== undefined ? options.skipBackup : true,
        buildMaster: options.buildMaster || false,
        targetSizeMB: options.targetSize ? parseInt(options.targetSize) : null,
        maxSqliteDbSizeMB: parseInt(options.maxSqliteDbSize),
        skipIncompleteTrails: options.skipIncompleteTrails || false,
        useSqlite: options.useSqlite || false,
        // New cleanup options for disk space management
        aggressiveCleanup: options.aggressiveCleanup !== false, // Default: true, can be disabled with --no-aggressive-cleanup
        cleanupOldStagingSchemas: options.cleanupOldStaging !== false, // Default: true, can be disabled with --no-cleanup-old-staging
        cleanupTempFiles: options.cleanupTempFiles !== false, // Default: true, can be disabled with --no-cleanup-temp-files
        maxStagingSchemasToKeep: options.maxStagingSchemas ? parseInt(options.maxStagingSchemas) : 2,
        cleanupDatabaseLogs: options.cleanupDbLogs || false, // Default: false, enabled with --cleanup-db-logs
        cleanupOnError: options.cleanupOnError || false, // Default: false, enabled with --cleanup-on-error
        useIntersectionNodes: options.noIntersectionNodes ? false : true, // Default: true, can be disabled with --no-intersection-nodes
        useSplitTrails: options.splitTrails !== false, // Default: true, can be disabled with --no-split-trails
        skipElevationProcessing: options.skipElevationProcessing || false, // Default: false, enabled with --skip-elevation-processing
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
        })() : undefined), // Default: undefined = full region // Default: undefined (full region)
      };
      console.log('[CLI] Orchestrator config:', config);
      console.log('[CLI] About to create orchestrator...');
      const orchestrator = new EnhancedPostgresOrchestrator(config);
      console.log('[CLI] Orchestrator created, about to run...');
      await orchestrator.run();
      console.log('[CLI] Orchestrator run complete.');
      console.log('[CLI] CARTHORSE completed successfully for region:', options.region);
      console.log('[CLI] Output database:', outputPath);
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