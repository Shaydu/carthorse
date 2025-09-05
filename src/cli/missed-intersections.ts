#!/usr/bin/env ts-node

import { Command } from 'commander';
import { Pool } from 'pg';
import { MissedIntersectionDetectionService } from '../services/layer1/MissedIntersectionDetectionService';

const program = new Command();

program
  .name('missed-intersections')
  .description('Detect and fix missed intersections in trail network')
  .version('1.0.0');

program
  .command('detect')
  .description('Detect and fix missed intersections')
  .requiredOption('-s, --staging-schema <schema>', 'Staging schema name')
  .option('-d, --database <db>', 'Database name', 'trail_master_db')
  .option('-u, --user <user>', 'Database user', 'shaydu')
  .option('-h, --host <host>', 'Database host', 'localhost')
  .option('-p, --port <port>', 'Database port', '5432')
  .option('--stats', 'Show network statistics before and after', false)
  .option('--dry-run', 'Show what would be done without making changes', false)
  .action(async (options) => {
    try {
      console.log('🔍 Starting missed intersection detection...');
      
      // Create database connection
      const pgClient = new Pool({
        database: options.database,
        user: options.user,
        host: options.host,
        port: parseInt(options.port),
      });

      // Create the service
      const service = new MissedIntersectionDetectionService({
        stagingSchema: options.stagingSchema,
        pgClient
      });

      // Show initial statistics if requested
      if (options.stats) {
        console.log('\n📊 Initial network statistics:');
        const initialStats = await service.getNetworkStatistics();
        console.log(`   Total trails: ${initialStats.totalTrails}`);
        console.log(`   Average trail length: ${initialStats.averageTrailLength.toFixed(2)}m`);
        console.log(`   Trails with intersections: ${initialStats.trailsWithIntersections}`);
      }

      if (options.dryRun) {
        console.log('\n🔍 DRY RUN: Finding missed intersections without making changes...');
        
        // We need to add a dry-run method to the service
        console.log('⚠️ Dry run mode not yet implemented. Use --stats to see current state.');
      } else {
        // Run the actual detection and fixing
        console.log('\n🔧 Detecting and fixing missed intersections...');
        const result = await service.detectAndFixMissedIntersections();
        
        if (result.success) {
          console.log(`\n✅ Missed intersection detection completed successfully!`);
          console.log(`   Intersections found: ${result.intersectionsFound}`);
          console.log(`   Trails split: ${result.trailsSplit}`);
        } else {
          console.error(`\n❌ Missed intersection detection failed: ${result.error}`);
          process.exit(1);
        }
      }

      // Show final statistics if requested
      if (options.stats) {
        console.log('\n📊 Final network statistics:');
        const finalStats = await service.getNetworkStatistics();
        console.log(`   Total trails: ${finalStats.totalTrails}`);
        console.log(`   Average trail length: ${finalStats.averageTrailLength.toFixed(2)}m`);
        console.log(`   Trails with intersections: ${finalStats.trailsWithIntersections}`);
      }

      await pgClient.end();
      console.log('\n🎉 Process completed successfully!');

    } catch (error) {
      console.error(`❌ Error: ${error}`);
      process.exit(1);
    }
  });

program
  .command('analyze')
  .description('Analyze potential missed intersections without fixing them')
  .requiredOption('-s, --staging-schema <schema>', 'Staging schema name')
  .option('-d, --database <db>', 'Database name', 'trail_master_db')
  .option('-u, --user <user>', 'Database user', 'shaydu')
  .option('-h, --host <host>', 'Database host', 'localhost')
  .option('-p, --port <port>', 'Database port', '5432')
  .option('--tolerance <meters>', 'Detection tolerance in meters', '0.1')
  .action(async (options) => {
    try {
      console.log('🔍 Analyzing potential missed intersections...');
      
      // Create database connection
      const pgClient = new Pool({
        database: options.database,
        user: options.user,
        host: options.host,
        port: parseInt(options.port),
      });

      // Create the service
      const service = new MissedIntersectionDetectionService({
        stagingSchema: options.stagingSchema,
        pgClient
      });

      // Show network statistics
      console.log('\n📊 Network statistics:');
      const stats = await service.getNetworkStatistics();
      console.log(`   Total trails: ${stats.totalTrails}`);
      console.log(`   Average trail length: ${stats.averageTrailLength.toFixed(2)}m`);
      console.log(`   Trails with intersections: ${stats.trailsWithIntersections}`);

      // Analyze potential intersections
      console.log(`\n🔍 Analyzing with ${options.tolerance}m tolerance...`);
      
      // We need to add an analysis method to the service
      console.log('⚠️ Analysis mode not yet implemented. Use the detect command to see what would be found.');

      await pgClient.end();

    } catch (error) {
      console.error(`❌ Error: ${error}`);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();
