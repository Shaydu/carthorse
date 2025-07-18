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
  .action(async (options) => {
    try {
      console.log(chalk.blue(`🚀 Starting CARTHORSE for region: ${options.region}`));
      
      // Determine output path
      let outputPath = options.out;
      if (!outputPath) {
        outputPath = path.resolve(__dirname, '../../../api-service/data', `${options.region}.db`);
        console.log(chalk.gray(`ℹ️  No output path specified. Using default: ${outputPath}`));
      } else {
        // If outputPath is not absolute, resolve it relative to project root
        if (!path.isAbsolute(outputPath)) {
          outputPath = path.resolve(__dirname, '../../../', outputPath);
        }
      }

      console.log(chalk.green(`✅ Configuration:`));
      console.log(chalk.gray(`   Region: ${options.region}`));
      console.log(chalk.gray(`   Output: ${outputPath}`));
      console.log(chalk.gray(`   Simplify Tolerance: ${options.simplifyTolerance}`));
      console.log(chalk.gray(`   Intersection Tolerance: ${options.intersectionTolerance}`));
      console.log(chalk.gray(`   Replace: ${options.replace}`));
      console.log(chalk.gray(`   Validate: ${options.validate}`));
      console.log(chalk.gray(`   Verbose: ${options.verbose}`));
      console.log(chalk.gray(`   Skip Backup: ${options.skipBackup}`));
      console.log(chalk.gray(`   Build Master: ${options.buildMaster}`));
      console.log(chalk.gray(`   Skip Incomplete Trails: ${options.skipIncompleteTrails}`));
      
      if (options.targetSize) {
        console.log(chalk.gray(`   Target Size: ${options.targetSize} MB`));
      }
      console.log(chalk.gray(`   Max SpatiaLite DB Size: ${options.maxSpatialiteDbSize} MB`));

      // Create orchestrator configuration
      const config = {
        region: options.region,
        outputPath: outputPath,
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
      };

      // Create and run the actual orchestrator
      const orchestrator = new EnhancedPostgresOrchestrator(config);
      await orchestrator.run();
      
      console.log(chalk.green(`\n🎉 CARTHORSE completed successfully for region: ${options.region}`));
      console.log(chalk.gray(`   Output database: ${outputPath}`));
      
    } catch (error) {
      console.error(chalk.red('❌ CARTHORSE failed:'), error);
      process.exit(1);
    }
  });

// Export for programmatic use
export async function runExport(args: string[] = process.argv): Promise<void> {
  await program.parseAsync(args);
}

// Run if called directly
if (require.main === module) {
  runExport();
} 