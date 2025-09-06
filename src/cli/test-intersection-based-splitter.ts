#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { IntersectionBasedTrailSplitter, IntersectionBasedSplittingConfig } from '../services/layer1/IntersectionBasedTrailSplitter';

/**
 * CLI command to test the IntersectionBasedTrailSplitter service independently
 * 
 * This service contains the specific North Sky and Foothills North complex intersection
 * splitting logic that was working in commit 1d42491b.
 * 
 * Usage:
 * npx ts-node src/cli/test-intersection-based-splitter.ts process --staging-schema carthorse_1234567890
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2 || args[0] !== 'process') {
    console.log('Usage: npx ts-node src/cli/test-intersection-based-splitter.ts process --staging-schema <schema_name>');
    console.log('');
    console.log('This command tests the IntersectionBasedTrailSplitter service independently');
    console.log('to verify North Sky and Foothills North complex intersection splitting.');
    console.log('');
    console.log('Key features:');
    console.log('  - T-intersection handling (handleTIntersection method)');
    console.log('  - Visitor trail snapping (snapVisitorTrailToVisitedTrail method)');
    console.log('  - Visited trail splitting at intersection points');
    console.log('  - Spatial analysis to identify visited vs visitor trails');
    process.exit(1);
  }

  const stagingSchemaIndex = args.indexOf('--staging-schema');
  if (stagingSchemaIndex === -1 || stagingSchemaIndex + 1 >= args.length) {
    console.error('❌ Error: --staging-schema argument is required');
    process.exit(1);
  }

  const stagingSchema = args[stagingSchemaIndex + 1];
  console.log(`🔍 Testing IntersectionBasedTrailSplitter on staging schema: ${stagingSchema}`);

  // Create database connection
  const pgClient = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'carthorse',
    password: process.env.PGPASSWORD || '',
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

    // Check if required tables exist
    const tablesCheck = await pgClient.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = $1 AND table_name IN ('trails', 'intersection_points')
    `, [stagingSchema]);

    const tableNames = tablesCheck.rows.map(row => row.table_name);
    if (!tableNames.includes('trails')) {
      console.error(`❌ Error: Trails table does not exist in staging schema '${stagingSchema}'`);
      process.exit(1);
    }
    if (!tableNames.includes('intersection_points')) {
      console.error(`❌ Error: Intersection_points table does not exist in staging schema '${stagingSchema}'`);
      process.exit(1);
    }

    // Get initial counts
    const beforeCounts = await pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${stagingSchema}.trails) as trail_count,
        (SELECT COUNT(*) FROM ${stagingSchema}.intersection_points) as intersection_count
    `);
    console.log(`📊 Before processing:`);
    console.log(`   - Trails: ${beforeCounts.rows[0].trail_count}`);
    console.log(`   - Intersection points: ${beforeCounts.rows[0].intersection_count}`);

    // Check for T-intersections specifically
    const tIntersectionCount = await pgClient.query(`
      SELECT COUNT(*) as count 
      FROM ${stagingSchema}.intersection_points 
      WHERE node_type = 't_intersection'
    `);
    console.log(`   - T-intersections: ${tIntersectionCount.rows[0].count}`);

    // Configure the service
    const serviceConfig: IntersectionBasedSplittingConfig = {
      stagingSchema,
      pgClient,
      minSegmentLengthMeters: 1.0,
      verbose: true,
      validationToleranceMeters: 1.0,
      validationTolerancePercentage: 0.05
    };

    // Create and run the service
    console.log('\n🚀 Running IntersectionBasedTrailSplitter...');
    const service = new IntersectionBasedTrailSplitter(serviceConfig);
    const result = await service.execute();

    // Get final counts
    const afterCounts = await pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${stagingSchema}.trails) as trail_count,
        (SELECT COUNT(*) FROM ${stagingSchema}.intersection_points) as intersection_count
    `);
    console.log(`\n📊 After processing:`);
    console.log(`   - Trails: ${afterCounts.rows[0].trail_count}`);
    console.log(`   - Intersection points: ${afterCounts.rows[0].intersection_count}`);

    // Print results
    console.log('\n🎯 IntersectionBasedTrailSplitter Results:');
    console.log(`   ✅ Success: ${result.success}`);
    console.log(`   🔗 Intersection points used: ${result.intersectionPointsUsed}`);
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

      // Show intersection points that were processed
      console.log('\n🔍 Intersection points processed:');
      const processedIntersections = await pgClient.query(`
        SELECT 
          node_type,
          connected_trail_names,
          ST_AsText(intersection_point) as intersection_wkt
        FROM ${stagingSchema}.intersection_points
        WHERE node_type IN ('intersection', 't_intersection')
        ORDER BY node_type, intersection_point
        LIMIT 10
      `);
      
      for (const intersection of processedIntersections.rows) {
        console.log(`   🔗 ${intersection.node_type}: ${intersection.connected_trail_names.join(' × ')}`);
        console.log(`      📍 ${intersection.intersection_wkt}`);
      }
    }

  } catch (error) {
    console.error('❌ Error running IntersectionBasedTrailSplitter:', error);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

if (require.main === module) {
  main().catch(console.error);
}
