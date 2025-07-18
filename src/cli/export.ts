#!/usr/bin/env ts-node
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

// Import the enhanced orchestrator from the compiled JavaScript
let EnhancedPostgresOrchestrator: any;
try {
  // Import the enhanced orchestrator from the compiled JavaScript
  const orchestratorModule = require('../../dist/orchestrator/EnhancedPostgresOrchestrator');
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
  .description('Process and export trail data for a specific region')
  .requiredOption('-r, --region <region>', 'Region to process (e.g., boulder, seattle)')
  .option('-o, --out <output_path>', 'Output database path (defaults to api-service/data/<region>.db)')
  .option('--simplify-tolerance <tolerance>', 'Geometry simplification tolerance (default: 0.001)', '0.001')
  .option('--intersection-tolerance <tolerance>', 'Intersection detection tolerance in meters (default: 2)', process.env.INTERSECTION_TOLERANCE || '2')
  .option('--target-size <size_mb>', 'Target database size in MB')
  .option('--max-spatialite-db-size <size_mb>', 'Maximum SpatiaLite database size in MB (default: 400)', '400')
  .option('--replace', 'Replace existing database if it exists')
  .option('--validate', 'Run validation after processing')
  .option('--verbose', 'Enable verbose logging')
  .option('--skip-backup', 'Skip database backup before export (default: true, use --no-skip-backup to perform backup)')
  .option('--build-master', 'Build master database from OSM data before export')
  .option('--deploy', 'Build and deploy to Cloud Run after processing')
  .option('--skip-incomplete-trails', 'Skip trails missing elevation data or geometry')
  .option('--bbox <minLng,minLat,maxLng,maxLat>', 'Optional: Only export trails within this bounding box (comma-separated: minLng,minLat,maxLng,maxLat)')
  .action(async (options) => {
    if (options.dryRun) {
      console.log('Dry run: arguments parsed successfully.');
      process.exit(0);
    }
    try {
      console.log(chalk.blue(`🚀 Starting CARTHORSE for region: ${options.region}`));
      // ... rest of the export logic ...
    } catch (error) {
      console.error(chalk.red('❌ CARTHORSE failed:'), error);
      process.exit(1);
    }
  });