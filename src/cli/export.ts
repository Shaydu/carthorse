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
import { getTolerances, getExportSettings } from '../utils/config-loader';

// Require database environment variables - no fallbacks
if (!process.env.PGDATABASE) {
  console.error(chalk.red('❌ PGDATABASE environment variable is required'));
  console.error(chalk.red('   Example: PGDATABASE=trail_master_db carthorse --region boulder --out boulder.db'));
  process.exit(1);
}
if (!process.env.PGUSER) {
  console.error(chalk.red('❌ PGUSER environment variable is required'));
  console.error(chalk.red('   Example: PGUSER=your_username carthorse --region boulder --out boulder.db'));
  process.exit(1);
}

// Import the enhanced orchestrator from the compiled JavaScript
let CarthorseOrchestrator: any;
let PgRoutingOrchestrator: any;
try {
  // Import the enhanced orchestrator from the compiled JavaScript
  const orchestratorModule = require('../orchestrator/CarthorseOrchestrator');
  CarthorseOrchestrator = orchestratorModule.CarthorseOrchestrator;
  
  // Import the pgRouting orchestrator
  const pgroutingModule = require('../orchestrator/PgRoutingOrchestrator');
  PgRoutingOrchestrator = pgroutingModule.PgRoutingOrchestrator;
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
        region: 'boulder',
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
      
      const region = regionIndex !== -1 && regionIndex + 1 < args.length ? args[regionIndex + 1] : 'boulder';
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
          skipCleanup: (options as any).skipCleanupOnError || false, // Respect skipCleanupOnError flag
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
  $ carthorse --region boulder --out data/boulder.db --skip-validation
  $ carthorse --region boulder --out data/boulder.db --skip-bbox-validation
  $ carthorse --region boulder --out data/boulder.db --skip-geometry-validation
  $ carthorse --region boulder --out data/boulder.db --bbox -105.281,40.066,-105.235,40.105
  $ carthorse --region boulder --out data/boulder.db --limit 60
  $ carthorse --region boulder --out data/boulder.db --bbox -105.281,40.066,-105.235,40.105 --limit 60
  $ carthorse --region boulder --out data/boulder --format geojson --bbox -105.281,40.066,-105.235,40.105

Database Installation:
  $ carthorse install                                # Install test database with boulder data (1000 trails)
  $ carthorse install --region seattle               # Install test database with seattle data
  $ carthorse install --region boulder --limit 500   # Install with 500 boulder trails
  $ carthorse install --skip-test-population        # Install test database (schema only, no data population)

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

// Add install command before the main export command
program
  .command('install')
  .description('Install a fresh Carthorse database with all required schema and functions')
  .option('-r, --region <region>', 'Region to populate from (default: boulder)', 'boulder')
  .option('-l, --limit <limit>', 'Maximum number of trails to copy (default: 1000)', '1000')
  .option('--empty', 'Install empty database (no data population)')
  .option('--skip-test-population', 'Install test database (schema only, no data population)')
  .action(async (options) => {
    try {
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
      process.exit(0);
    } catch (error) {
      console.error('❌ Installation failed:', error);
      process.exit(1);
    }
  });

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
  .option('--skip-cleanup-on-error', 'Skip cleanup on error for debugging (preserves staging schema)')
  .option('--skip-cleanup', 'Skip cleanup regardless of errors (preserves staging schema for debugging)')
  .option('--pgrouting', 'Use PgRoutingOrchestrator for export (experimental)')
  .allowUnknownOption()
  .description('Process and export trail data for a specific region')
  .requiredOption('-r, --region <region>', 'Region to process (e.g., boulder, seattle)')
  .requiredOption('-o, --out <output_path>', 'Output database path (required)')
  .option('--simplify-tolerance <tolerance>', 'Geometry simplification tolerance (default: 0.001)', getExportSettings().defaultSimplifyTolerance.toString())
      .option('--intersection-tolerance <tolerance>', 'Intersection detection tolerance in meters (default: 1)', process.env.INTERSECTION_TOLERANCE || getTolerances().intersectionTolerance.toString())
  .option('--target-size <size_mb>', 'Target database size in MB', getExportSettings().defaultTargetSizeMb.toString())
  .option('--max-sqlite-db-size <size_mb>', 'Maximum SQLite database size in MB (default: 400)', getExportSettings().defaultMaxDbSizeMb.toString())
  .option('--use-sqlite', 'Use regular SQLite for export (default: enabled)')
  .option('--use-intersection-nodes', 'Enable intersection nodes for better routing (default: enabled)')
  .option('--no-intersection-nodes', 'Disable intersection nodes (use endpoint-only routing)')
  .option('--use-split-trails', 'Export split trail segments instead of original trails (default: enabled)')
  .option('--no-split-trails', 'Export original trails without splitting at intersections')
  .option('--skip-validation', 'Skip all validation checks (useful for edge cases or testing)')
  .option('--skip-bbox-validation', 'Skip bbox validation checks (useful for small trail segments)')
  .option('--skip-geometry-validation', 'Skip geometry validation checks')
  .option('--skip-trail-validation', 'Skip trail data validation checks')
  .option('--bbox <minLng,minLat,maxLng,maxLat>', 'Optional: Only export trails within this bounding box (comma-separated: minLng,minLat,maxLng,maxLat)')
  .option('--limit <limit>', 'Maximum number of trails to export (default: no limit)', '0')

      .option('--format <format>', 'Output format: sqlite, geojson, or trails-only', 'sqlite')
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
      { name: 'maxSqliteDbSize', value: options.maxSqliteDbSize },
      { name: 'limit', value: options.limit }
    ];
    for (const opt of numericOptions) {
      if (opt.value !== undefined && opt.value !== null && isNaN(Number(opt.value))) {
        console.error(`[CLI] Invalid value for --${opt.name}: ${opt.value}`);
        process.exit(1);
      }
    }
    // Determine output format first
    let outputFormat: 'geojson' | 'sqlite' | 'trails-only';
    
    // Validate format option
    if (options.format && !['sqlite', 'geojson', 'trails-only'].includes(options.format)) {
      console.error(`[CLI] Invalid format: ${options.format}. Must be one of: sqlite, geojson, trails-only`);
      process.exit(1);
    }
    
    // Use format option
    if (options.format) {
      outputFormat = options.format as 'geojson' | 'sqlite' | 'trails-only';
    } else {
      outputFormat = 'sqlite';
    }
    
    // Fail fast if output path is invalid or not writable
    let outputPath = options.out;
    
    // Auto-append appropriate extension based on format
    if (outputFormat === 'sqlite' && !outputPath.endsWith('.db')) {
      outputPath = outputPath + '.db';
    } else if (outputFormat === 'geojson' && !outputPath.endsWith('.geojson')) {
      outputPath = outputPath + '.geojson';
    } else if (outputFormat === 'trails-only' && !outputPath.endsWith('.geojson')) {
      outputPath = outputPath + '.geojson';
    }
    
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
        // Cleanup options - single flag controls all cleanup
        skipCleanupOnError: (options as any).skipCleanupOnError || false, // Default: false, enabled with --skip-cleanup-on-error
        skipCleanup: (options as any).skipCleanup || false, // Default: false, enabled with --skip-cleanup
        useIntersectionNodes: options.noIntersectionNodes ? false : true, // Default: true, can be disabled with --no-intersection-nodes
        useSplitTrails: options.splitTrails !== false, // Default: true, can be disabled with --no-split-trails
        // Validation options
        skipValidation: options.skipValidation || false, // Default: false, enabled with --skip-validation
        skipBboxValidation: options.skipBboxValidation || false, // Default: false, enabled with --skip-bbox-validation
        skipGeometryValidation: options.skipGeometryValidation || false, // Default: false, enabled with --skip-geometry-validation
        skipTrailValidation: options.skipTrailValidation || false, // Default: false, enabled with --skip-trail-validation
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
      console.log('[CLI] Orchestrator config:', JSON.stringify(config, null, 2));
      console.log('[CLI] About to create orchestrator...');
      
      // Choose orchestrator based on flags
      let orchestrator;
      if (options.pgrouting) {
        console.log('[CLI] Using PgRoutingOrchestrator for pgRouting-based export...');
        orchestrator = new PgRoutingOrchestrator(config);
      } else {
        console.log('[CLI] Using standard CarthorseOrchestrator...');
        orchestrator = new CarthorseOrchestrator(config);
      }
      console.log('[CLI] Orchestrator created, about to run...');
      
      console.log(`[CLI] Exporting to ${outputFormat.toUpperCase()} format...`);
      
      // Handle different orchestrator interfaces
      if (options.pgrouting) {
        // PgRoutingOrchestrator uses run() method
        await orchestrator.run();
      } else {
        // CarthorseOrchestrator uses export() method
        await orchestrator.export(outputFormat);
      }
      
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