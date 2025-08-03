#!/usr/bin/env node
/**
 * CARTHORSE PgRouting Export CLI
 * 
 * Command-line interface for Carthorse trail data processing using pgRouting
 * This provides the 'carthorse-pgrouting' command for pgRouting-based exports
 */

import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { readFileSync, existsSync, accessSync, constants } from 'fs';
import { getTolerances, getExportSettings } from '../utils/config-loader';

// Require database environment variables - no fallbacks
if (!process.env.PGDATABASE) {
  console.error(chalk.red('❌ PGDATABASE environment variable is required'));
  console.error(chalk.red('   Example: PGDATABASE=trail_master_db carthorse-pgrouting --region boulder --out boulder.db'));
  process.exit(1);
}
if (!process.env.PGUSER) {
  console.error(chalk.red('❌ PGUSER environment variable is required'));
  console.error(chalk.red('   Example: PGUSER=your_username carthorse-pgrouting --region boulder --out boulder.db'));
  process.exit(1);
}

// Import the pgRouting orchestrator
let PgRoutingOrchestrator: any;
try {
  const orchestratorModule = require('../orchestrator/PgRoutingOrchestrator');
  PgRoutingOrchestrator = orchestratorModule.PgRoutingOrchestrator;
} catch (error) {
  console.error(chalk.red('❌ Failed to load PgRoutingOrchestrator:'));
  console.error(chalk.red('   Make sure the orchestrator is properly compiled to JavaScript'));
  console.error(chalk.red('   Error:'), (error as Error).message);
  process.exit(1);
}

// Read version from package.json
let packageJson: any;
try {
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

// Add help text
const addHelpText = (position: 'before' | 'after', text: string) => {
  if (position === 'before') {
    program.addHelpText('before', text);
  } else {
    program.addHelpText('after', text);
  }
};

addHelpText('before', `
${chalk.blue.bold('CARTHORSE PgRouting Export Tool')}
${chalk.gray('Export trail data using pgRouting for advanced routing networks')}

${chalk.yellow('Environment Variables:')}
  PGDATABASE    PostgreSQL database name (required)
  PGUSER        PostgreSQL username (required)
  PGHOST        PostgreSQL host (default: localhost)
  PGPORT        PostgreSQL port (default: 5432)
  PGPASSWORD    PostgreSQL password (if required)

${chalk.yellow('Prerequisites:')}
  - PostgreSQL with PostGIS extension
  - pgRouting extension installed
  - trail_master_db with trail data
`);

program
  .name('carthorse-pgrouting')
  .description('Export trail data using pgRouting for advanced routing networks')
  .version(packageJson.version)
  .option('--dry-run', 'Parse arguments and exit without running export')
  .option('--env <environment>', 'Environment to use (default, bbox-phase2, test)', 'default')
  .option('--skip-cleanup-on-error', 'Skip cleanup on error for debugging (preserves staging schema)')
  .option('--skip-cleanup', 'Skip cleanup regardless of errors (preserves staging schema for debugging)')
  .allowUnknownOption()
  .description('Process and export trail data using pgRouting for a specific region')
  .requiredOption('-r, --region <region>', 'Region to process (e.g., boulder, seattle)')
  .requiredOption('-o, --out <output_path>', 'Output database path (required)')
  .option('--pgrouting-tolerance <tolerance>', 'pgRouting node network tolerance (default: 0.0001)', '0.0001')
  .option('--use-pgrouting-topology', 'Use pgRouting topology functions (default: true)', true)
  .option('--export-routing-network', 'Export the routing network (default: true)', true)
  .option('--simplify-tolerance <tolerance>', 'Geometry simplification tolerance (default: 0.001)', getExportSettings().defaultSimplifyTolerance.toString())
  .option('--intersection-tolerance <tolerance>', 'Intersection detection tolerance in meters (default: 1)', process.env.INTERSECTION_TOLERANCE || getTolerances().intersectionTolerance.toString())
  .option('--target-size <size_mb>', 'Target database size in MB', '100')
  .option('--skip-incomplete-trails', 'Skip trails with missing data')
  .option('--use-intersection-nodes', 'Create intersection nodes (default: true)', true)
  .option('--use-split-trails', 'Export split trail segments (default: true)', true)
  .option('--bbox <bbox>', 'Bounding box (minLng,minLat,maxLng,maxLat)')
  .option('--limit <limit>', 'Limit number of trails to process')
  .option('--validate', 'Validate export (default: true)', true)
  .option('--skip-validation', 'Skip all validation checks')
  .option('--skip-bbox-validation', 'Skip bbox validation checks')
  .option('--skip-geometry-validation', 'Skip geometry validation checks')
  .option('--skip-trail-validation', 'Skip trail data validation checks')
  .option('--skip-recommendations', 'Skip route recommendation generation and validation')
  .option('--replace', 'Replace existing output file')
  .option('--verbose', 'Enable verbose logging')
  .option('--skip-backup', 'Skip database backup')
  .option('--build-master', 'Build master database from OSM data')
  .option('--max-sqlite-db-size <size_mb>', 'Maximum SQLite database size in MB', '100')
  .option('--use-sqlite', 'Use regular SQLite for export')
  .option('--aggressive-cleanup', 'Clean up old staging schemas and temp files (default: true)', true)
  .option('--cleanup-old-staging-schemas', 'Drop old staging schemas for this region (default: true)', true)
  .option('--cleanup-temp-files', 'Clean up temporary files and logs (default: true)', true)
  .option('--max-staging-schemas-to-keep <count>', 'Maximum number of staging schemas to keep per region (default: 2)', '2')
  .option('--cleanup-database-logs', 'Clean up database log files (default: false)', false)
  .option('--target-schema-version <version>', 'Target schema version for export', '8')
  .action(async (options) => {
    try {
      // Parse bbox if provided
      let bbox: [number, number, number, number] | undefined;
      if (options.bbox) {
        const bboxParts = options.bbox.split(',').map(Number);
        if (bboxParts.length !== 4 || bboxParts.some(isNaN)) {
          console.error(chalk.red('❌ Invalid bbox format. Use: minLng,minLat,maxLng,maxLat'));
          process.exit(1);
        }
        bbox = bboxParts as [number, number, number, number];
      }

      // Parse numeric options
      const config = {
        region: options.region,
        outputPath: options.out,
        pgroutingTolerance: parseFloat(options.pgroutingTolerance),
        usePgroutingTopology: options.usePgroutingTopology,
        exportRoutingNetwork: options.exportRoutingNetwork,
        simplifyTolerance: parseFloat(options.simplifyTolerance),
        intersectionTolerance: parseFloat(options.intersectionTolerance),
        targetSizeMB: options.targetSize ? parseInt(options.targetSize) : null,
        maxSqliteDbSizeMB: parseInt(options.maxSqliteDbSize),
        skipIncompleteTrails: options.skipIncompleteTrails,
        useIntersectionNodes: options.useIntersectionNodes,
        useSplitTrails: options.useSplitTrails,
        bbox,
        limit: options.limit ? parseInt(options.limit) : undefined,
        validate: options.validate,
        skipValidation: options.skipValidation,
        skipBboxValidation: options.skipBboxValidation,
        skipGeometryValidation: options.skipGeometryValidation,
        skipTrailValidation: options.skipTrailValidation,
        skipRecommendations: options.skipRecommendations,
        replace: options.replace,
        verbose: options.verbose,
        skipBackup: options.skipBackup,
        buildMaster: options.buildMaster,
        useSqlite: options.useSqlite,
        aggressiveCleanup: options.aggressiveCleanup,
        cleanupOldStagingSchemas: options.cleanupOldStagingSchemas,
        cleanupTempFiles: options.cleanupTempFiles,
        maxStagingSchemasToKeep: parseInt(options.maxStagingSchemasToKeep),
        cleanupDatabaseLogs: options.cleanupDatabaseLogs,
        targetSchemaVersion: parseInt(options.targetSchemaVersion),
        skipCleanupOnError: options.skipCleanupOnError,
        skipCleanup: options.skipCleanup
      };

      // Validate configuration
      if (config.pgroutingTolerance <= 0) {
        console.error(chalk.red('❌ pgrouting-tolerance must be greater than 0'));
        process.exit(1);
      }

      if (config.simplifyTolerance < 0) {
        console.error(chalk.red('❌ simplify-tolerance must be non-negative'));
        process.exit(1);
      }

      if (config.intersectionTolerance <= 0) {
        console.error(chalk.red('❌ intersection-tolerance must be greater than 0'));
        process.exit(1);
      }

      // Check if output file exists and --replace is not specified
      if (existsSync(config.outputPath) && !config.replace) {
        console.error(chalk.red(`❌ Output file already exists: ${config.outputPath}`));
        console.error(chalk.red('   Use --replace to overwrite existing file'));
        process.exit(1);
      }

      // Check if output directory is writable
      const outputDir = path.dirname(config.outputPath);
      if (outputDir !== '.' && !existsSync(outputDir)) {
        try {
          require('fs').mkdirSync(outputDir, { recursive: true });
        } catch (error) {
          console.error(chalk.red(`❌ Cannot create output directory: ${outputDir}`));
          process.exit(1);
        }
      }

      if (outputDir !== '.') {
        try {
          accessSync(outputDir, constants.W_OK);
        } catch (error) {
          console.error(chalk.red(`❌ Output directory is not writable: ${outputDir}`));
          process.exit(1);
        }
      }

      // Dry run mode
      if (options.dryRun) {
        console.log(chalk.blue('🔍 Dry run mode - configuration validated:'));
        console.log(JSON.stringify(config, null, 2));
        process.exit(0);
      }

      // Create and run the pgRouting orchestrator
      console.log(chalk.blue('🚀 Starting pgRouting export...'));
      const orchestrator = new PgRoutingOrchestrator(config);
      await orchestrator.run();
      
      console.log(chalk.green('✅ PgRouting export completed successfully!'));
      process.exit(0);
      
    } catch (error) {
      console.error(chalk.red('❌ PgRouting export failed:'));
      console.error(chalk.red((error as Error).message));
      
      if (options.verbose) {
        console.error(chalk.red('Stack trace:'));
        console.error((error as Error).stack);
      }
      
      process.exit(1);
    }
  });

addHelpText('after', `

Examples:
  $ carthorse-pgrouting --region boulder --out data/boulder-pgrouting.db
  $ carthorse-pgrouting --region seattle --out data/seattle-pgrouting.db --pgrouting-tolerance 0.0005
  $ carthorse-pgrouting --region boulder --out data/boulder-pgrouting.db --bbox -105.281,40.066,-105.235,40.105
  $ carthorse-pgrouting --region boulder --out data/boulder-pgrouting.db --limit 1000
  $ carthorse-pgrouting --region boulder --out data/boulder-pgrouting.db --skip-validation
  $ carthorse-pgrouting --region boulder --out data/boulder-pgrouting.db --verbose

PgRouting Configuration:
  --pgrouting-tolerance <tolerance>  Tolerance for pgRouting node network (default: 0.0001)
  --use-pgrouting-topology          Use pgRouting topology functions (default: true)
  --export-routing-network          Export the routing network (default: true)

Prerequisites:
  - PostgreSQL with PostGIS extension
  - pgRouting extension installed
  - trail_master_db with trail data

Environment Variables:
  PGDATABASE=trail_master_db
  PGUSER=your_username
  PGHOST=localhost (optional)
  PGPORT=5432 (optional)
  PGPASSWORD=your_password (if required)
`);

// Error handling for unknown options
program.on('option:unknown', (option) => {
  console.error(chalk.red(`❌ Unknown option: ${option}`));
  process.exit(1);
});

// Handle errors
program.exitOverride();

try {
  program.parse();
} catch (err: any) {
  if (err.code === 'commander.version') {
    process.exit(0);
  }
  throw err;
} 