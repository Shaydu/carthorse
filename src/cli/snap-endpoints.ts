#!/usr/bin/env node

import { Command } from 'commander';
import { Pool } from 'pg';
import { EndpointSnappingService } from '../services/layer1/EndpointSnappingService';

const program = new Command();

program
  .name('snap-endpoints')
  .description('Snap degree 1 endpoints to nearby trails and split them')
  .version('1.0.0');

program
  .command('process')
  .description('Process all degree 1 endpoints: find closest trails, snap to them, and split them')
  .requiredOption('--staging-schema <schema>', 'Staging schema name')
  .option('--dry-run', 'Show what would be done without making changes')
  .action(async (options) => {
    try {
      console.log('🔍 Starting endpoint snapping and splitting...');
      console.log(`📊 Staging schema: ${options.stagingSchema}`);

      if (options.dryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be made');
      }

      // Create database connection
      const pgClient = new Pool({
        host: process.env.PGHOST || 'localhost',
        port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
        database: process.env.PGDATABASE || 'trail_master_db',
        user: process.env.PGUSER || 'carthorse',
        password: process.env.PGPASSWORD || '',
      });

      const service = new EndpointSnappingService(options.stagingSchema, pgClient);

      const result = await service.processAllEndpoints();

      console.log('\n🎉 Endpoint snapping completed!');
      console.log(`✅ Success: ${result.success}`);
      console.log(`📊 Endpoints processed: ${result.endpointsProcessed}`);
      console.log(`🔗 Endpoints snapped: ${result.endpointsSnapped}`);
      console.log(`✂️ Trails split: ${result.trailsSplit}`);
      console.log(`❌ Errors: ${result.errors.length}`);

      if (result.errors.length > 0) {
        console.log('\n❌ Errors encountered:');
        result.errors.forEach(error => console.log(`   - ${error}`));
      }

      await pgClient.end();

    } catch (error) {
      console.error('❌ Error during endpoint snapping:', error);
      process.exit(1);
    }
  });

program.parse();
