#!/usr/bin/env ts-node
/**
 * CARTHORSE Orchestrator CLI
 * 
 * Main orchestrator command for processing trail data and building databases
 */

import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { readFileSync } from 'fs';

// Import the real orchestrator - try multiple paths for different environments
let EnhancedPostgresOrchestrator: any;
try {
  // Try the root directory path (development)
  const orchestratorPath = path.join(__dirname, '../../carthorse-enhanced-postgres-orchestrator.ts');
  const orchestratorModule = require(orchestratorPath);
  EnhancedPostgresOrchestrator = orchestratorModule.EnhancedPostgresOrchestrator;
} catch (error) {
  try {
    // Try the package path (when installed)
    const orchestratorModule = require('carthorse/carthorse-enhanced-postgres-orchestrator');
    EnhancedPostgresOrchestrator = orchestratorModule.EnhancedPostgresOrchestrator;
  } catch (error2) {
    console.error(chalk.red('❌ Failed to load EnhancedPostgresOrchestrator:'));
    console.error(chalk.red('   Make sure carthorse-enhanced-postgres-orchestrator.ts is available'));
    process.exit(1);
  }
}

// Read version from package.json
const packageJson = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));

const program = new Command();

program
  .name('carthorse-orchestrator')
  .description('CARTHORSE Trail Data Orchestrator - Process and build trail databases')
  .version(packageJson.version);

program
  .command('run')
  .description('Run the orchestrator for a specific region')
  .requiredOption('-r, --region <region>', 'Region to process (e.g., boulder, seattle)')
  .option('-o, --out <output_path>', 'Output database path (defaults to api-service/data/<region>.db)')
  .option('--simplify-tolerance <tolerance>', 'Geometry simplification tolerance', '0.001')
  .option('--intersection-tolerance <tolerance>', 'Intersection detection tolerance (meters, default: 2, can be set via INTERSECTION_TOLERANCE env var)', process.env.INTERSECTION_TOLERANCE || '2')
  .option('--target-size <size_mb>', 'Target database size in MB')
  .option('--max-spatialite-db-size <size_mb>', 'Maximum SpatiaLite database size in MB', '400')
  .option('--replace', 'Replace existing database')
  .option('--validate', 'Run validation after processing')
  .option('--verbose', 'Enable verbose logging')
  .option('--skip-backup', 'Skip database backup')
  .option('--build-master', 'Build master database')
  .option('--deploy', 'Build and deploy to Cloud Run after processing')
  .option('--skip-incomplete-trails', 'Skip trails missing elevation data or geometry')
  .action(async (options) => {
    try {
      console.log(chalk.blue(`🚀 Starting CARTHORSE orchestrator for region: ${options.region}`));
      
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
        skipBackup: options.skipBackup || false,
        buildMaster: options.buildMaster || false,
        targetSizeMB: options.targetSize ? parseInt(options.targetSize) : null,
        maxSpatiaLiteDbSizeMB: parseInt(options.maxSpatialiteDbSize),
        skipIncompleteTrails: options.skipIncompleteTrails || false,
      };

      // Create and run the actual orchestrator
      const orchestrator = new EnhancedPostgresOrchestrator(config);
      await orchestrator.run();
      
      console.log(chalk.green(`\n🎉 Orchestrator completed successfully for region: ${options.region}`));
      console.log(chalk.gray(`   Output database: ${outputPath}`));
      
    } catch (error) {
      console.error(chalk.red('❌ Orchestrator failed:'), error);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate a region\'s data integrity')
  .requiredOption('-r, --region <region>', 'Region to validate')
  .option('--strict', 'Use strict validation rules')
  .action(async (options) => {
    try {
      console.log(chalk.blue(`🔍 Validating region: ${options.region}`));
      console.log(chalk.gray(`   Strict mode: ${options.strict}`));
      
      // This would integrate with the validation system
      console.log(chalk.yellow('Validation functionality to be implemented'));
      
    } catch (error) {
      console.error(chalk.red('❌ Validation failed:'), error);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List available regions')
  .action(async () => {
    try {
      console.log(chalk.blue(`🗺️  Available regions:`));
      console.log(chalk.gray(`   - boulder`));
      console.log(chalk.gray(`   - seattle`));
      console.log(chalk.gray(`   - portland`));
      console.log(chalk.gray(`   - denver`));
      
    } catch (error) {
      console.error(chalk.red('❌ Failed to list regions:'), error);
      process.exit(1);
    }
  });

// Export for programmatic use
export async function runOrchestrator(args: string[] = process.argv): Promise<void> {
  await program.parseAsync(args);
}

// Run if called directly
if (require.main === module) {
  runOrchestrator();
} 