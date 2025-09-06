#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { StandaloneTrailSplittingService, StandaloneTrailSplittingConfig } from '../services/layer1/StandaloneTrailSplittingService';

/**
 * CLI command to test the StandaloneTrailSplittingService independently
 * 
 * This service contains the specific MultiPoint intersection splitting logic
 * that handles Foothills North and North Sky intersections.
 * 
 * Usage:
 * npx ts-node src/cli/test-standalone-splitting.ts process --staging-schema carthorse_1234567890
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2 || args[0] !== 'process') {
    console.log('Usage: npx ts-node src/cli/test-standalone-splitting.ts process --staging-schema <schema_name>');
    console.log('');
    console.log('This command tests the StandaloneTrailSplittingService independently.');
    console.log('This service handles MultiPoint intersections like Foothills North ↔ North Sky.');
    process.exit(1);
  }

  const stagingSchemaArg = args.find(arg => arg.startsWith('--staging-schema='));
  const stagingSchemaIndex = args.indexOf('--staging-schema');
  let stagingSchema: string | undefined;

  if (stagingSchemaArg) {
    stagingSchema = stagingSchemaArg.split('=')[1];
  } else if (stagingSchemaIndex !== -1 && args.length > stagingSchemaIndex + 1) {
    stagingSchema = args[stagingSchemaIndex + 1];
  }

  if (!stagingSchema) {
    console.error('Error: --staging-schema argument is required.');
    process.exit(1);
  }

  // Create database connection
  const pgClient = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'carthorse',
    password: process.env.PGPASSWORD || '',
  });

  try {
    const config: StandaloneTrailSplittingConfig = {
      stagingSchema: stagingSchema,
      intersectionTolerance: 3.0, // Tolerance for intersection detection
      minSegmentLength: 1.0, // Example minimum segment length
      verbose: true,
    };

    const service = new StandaloneTrailSplittingService(pgClient, config);
    const result = await service.splitTrailsAndReplace();

    if (result.success) {
      console.log(`\n✅ StandaloneTrailSplittingService test completed successfully!`);
      console.log(`   Original trails: ${result.originalTrailCount}`);
      console.log(`   Final trails: ${result.finalTrailCount}`);
      console.log(`   Segments created: ${result.segmentsCreated}`);
      console.log(`   Original trails deleted: ${result.originalTrailsDeleted}`);
      console.log(`   Intersections found: ${result.intersectionCount}`);
      console.log(`   Processing time: ${result.processingTimeMs}ms`);
    } else {
      console.error(`\n❌ StandaloneTrailSplittingService test failed`);
      if (result.errors && result.errors.length > 0) {
        console.error(`   Errors: ${result.errors.join(', ')}`);
      }
    }
  } catch (error) {
    console.error(`\n❌ An unexpected error occurred:`, error);
  } finally {
    await pgClient.end();
  }
}

main().catch(console.error);
