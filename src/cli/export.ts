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
import { readFileSync } from 'fs';
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
const packageJson = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));

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
`);

program
  .option('--version', 'Show version', () => {
    const pkg = require('../../package.json');
    console.log(`carthorse ${pkg.version}`);
    process.exit(0);
  })
  .option('--dry-run', 'Parse arguments and exit without running export')
  .option('--env <environment>', 'Environment to use (default, bbox-phase2, test)', 'default')
  .option('--clean-test-data', 'Clean up all test-related staging schemas and exit')
  .allowUnknownOption()
  .description('Process and export trail data for a specific region')
  .requiredOption('-r, --region <region>', 'Region to process (e.g., boulder, seattle)')
  .requiredOption('-o, --out <output_path>', 'Output database path (required)')
  .option('--simplify-tolerance <tolerance>', 'Geometry simplification tolerance (default: 0.001)', '0.001')
  .option('--intersection-tolerance <tolerance>', 'Intersection detection tolerance in meters (default: 1)', process.env.INTERSECTION_TOLERANCE || INTERSECTION_TOLERANCE.toString())
  .option('--target-size <size_mb>', 'Target database size in MB')
  .option('--max-spatialite-db-size <size_mb>', 'Maximum SpatiaLite database size in MB (default: 400)', '400')
  .option('--replace', 'Replace existing database if it exists')
  .option('--validate', 'Run validation after processing')
  .option('--verbose', 'Enable verbose logging')
  .option('--skip-backup', 'Skip database backup before export (default: true, use --no-skip-backup to perform backup)')
  .option('--build-master', 'Build master database from OSM data before export')
  .option('--deploy', 'Build and deploy to Cloud Run after processing')
  .option('--skip-incomplete-trails', 'Skip trails missing elevation data or geometry')
  .option('--use-sqlite', 'Use regular SQLite instead of SpatiaLite for export')
  .option('--bbox <minLng,minLat,maxLng,maxLat>', 'Optional: Only export trails within this bounding box (comma-separated: minLng,minLat,maxLng,maxLat)')
  .action(async (options) => {
    if (options.dryRun) {
      console.log('[CLI] Dry run: arguments parsed successfully.');
      process.exit(0);
    }
    try {
      console.log('[CLI] Parsed options:', options);
      console.log(`[CLI] Using environment: ${options.env}`);
      console.log('[CLI] About to resolve output path...');
      // Determine output path
      let outputPath = options.out;
      if (!path.isAbsolute(outputPath)) {
        outputPath = path.resolve(process.cwd(), outputPath);
      }
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
        maxSpatiaLiteDbSizeMB: parseInt(options.maxSpatialiteDbSize),
        skipIncompleteTrails: options.skipIncompleteTrails || false,
        useSqlite: options.useSqlite || false,
        bbox: options.bbox ? options.bbox.split(',').map(Number) : undefined,
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

console.log('[CLI] Starting export CLI...');
program.parseAsync(process.argv).then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('[CLI] Unhandled error:', err);
  process.exit(1);
});