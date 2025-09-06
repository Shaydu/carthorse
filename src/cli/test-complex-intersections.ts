#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { ComplexIntersectionSplittingService, ComplexIntersectionSplittingConfig } from '../services/layer1/ComplexIntersectionSplittingService';
import { loadConfig } from '../utils/config-loader';

/**
 * CLI command to test the ComplexIntersectionSplittingService independently
 * 
 * Usage:
 * npx ts-node src/cli/test-complex-intersections.ts process --staging-schema carthorse_1234567890
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2 || args[0] !== 'process') {
    console.log('Usage: npx ts-node src/cli/test-complex-intersections.ts process --staging-schema <schema_name>');
    console.log('');
    console.log('This command tests the ComplexIntersectionSplittingService independently');
    console.log('to verify North Sky and Foothills North complex intersection splitting.');
    process.exit(1);
  }

  const stagingSchemaIndex = args.indexOf('--staging-schema');
  if (stagingSchemaIndex === -1 || stagingSchemaIndex + 1 >= args.length) {
    console.error('❌ Error: --staging-schema argument is required');
    process.exit(1);
  }

  const stagingSchema = args[stagingSchemaIndex + 1];
  console.log(`🔍 Testing ComplexIntersectionSplittingService on staging schema: ${stagingSchema}`);

  // Load configuration
  const config = loadConfig();
  const dbConfig = config.database;

  // Create database connection
  const pgClient = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
  });

  try {
    // Verify staging schema exists
    const schemaCheck = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name = $1
    `, [stagingSchema]);

    if (schemaCheck.rows.length === 0) {
      console.error(`❌ Error: Staging schema '${stagingSchema}' does not exist`);
      process.exit(1);
    }

    // Check if trails table exists in staging schema
    const tableCheck = await pgClient.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = $1 AND table_name = 'trails'
    `, [stagingSchema]);

    if (tableCheck.rows.length === 0) {
      console.error(`❌ Error: Trails table does not exist in staging schema '${stagingSchema}'`);
      process.exit(1);
    }

    // Get trail count before processing
    const beforeCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.trails
    `);
    console.log(`📊 Trails before processing: ${beforeCount.rows[0].count}`);

    // Configure the service
    const serviceConfig: ComplexIntersectionSplittingConfig = {
      stagingSchema,
      pgClient,
      minSegmentLengthMeters: 1.0,
      verbose: true,
      tIntersectionToleranceMeters: 5.0,
      yIntersectionToleranceMeters: 3.0
    };

    // Create and run the service
    const service = new ComplexIntersectionSplittingService(serviceConfig);
    const result = await service.execute();

    // Get trail count after processing
    const afterCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.trails
    `);
    console.log(`📊 Trails after processing: ${afterCount.rows[0].count}`);

    // Print results
    console.log('\n🎯 Complex Intersection Splitting Results:');
    console.log(`   ✅ Success: ${result.success}`);
    console.log(`   🔗 T-intersections processed: ${result.tIntersectionsProcessed}`);
    console.log(`   🔗 Y-intersections processed: ${result.yIntersectionsProcessed}`);
    console.log(`   🔗 Total complex intersections: ${result.complexIntersectionsProcessed}`);
    console.log(`   ✂️ Trails split: ${result.trailsSplit}`);
    console.log(`   📊 Segments created: ${result.segmentsCreated}`);
    
    if (result.error) {
      console.log(`   ❌ Error: ${result.error}`);
    }

    // Show some example trails that were processed
    if (result.trailsSplit > 0) {
      console.log('\n🔍 Sample of processed trails:');
      const sampleTrails = await pgClient.query(`
        SELECT name, ST_Length(geometry::geography) as length_meters
        FROM ${stagingSchema}.trails
        WHERE name LIKE '%North%' OR name LIKE '%Foothills%' OR name LIKE '%Sky%'
        ORDER BY length_meters DESC
        LIMIT 10
      `);
      
      for (const trail of sampleTrails.rows) {
        console.log(`   📍 ${trail.name}: ${trail.length_meters.toFixed(1)}m`);
      }
    }

  } catch (error) {
    console.error('❌ Error running ComplexIntersectionSplittingService:', error);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

