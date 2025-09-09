#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { GraphSAGEDrivenNetworkCleaningService, GraphSAGEDrivenCleaningConfig } from '../services/graphsage/GraphSAGEDrivenNetworkCleaningService';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  console.log('🚀 GraphSAGE-Driven Network Cleaning');
  console.log('=====================================\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const predictionsPath = args[0] || 'test-output/high_confidence_graphsage_predictions.json';
  const confidenceThreshold = parseFloat(args[1]) || 0.98;
  const dryRun = args.includes('--dry-run');
  const snapTolerance = parseFloat(args[2]) || 10.0;
  const minSplitDistance = parseFloat(args[3]) || 1.0;

  console.log(`📁 Predictions file: ${predictionsPath}`);
  console.log(`🎯 Confidence threshold: ${confidenceThreshold}`);
  console.log(`🔧 Snap tolerance: ${snapTolerance}m`);
  console.log(`📏 Min split distance: ${minSplitDistance}m`);
  console.log(`🧪 Dry run: ${dryRun ? 'YES' : 'NO'}`);
  console.log('');

  // Database connection
  const pgClient = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db_test',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || 'your_password_here',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  try {
    // Test database connection
    console.log('🔌 Testing database connection...');
    await pgClient.query('SELECT 1');
    console.log('✅ Database connection successful\n');

    // Configuration
    const config: GraphSAGEDrivenCleaningConfig = {
      stagingSchema: 'carthorse_staging',
      confidence_threshold: confidenceThreshold,
      dry_run: dryRun,
      snapToleranceMeters: snapTolerance,
      minSplitDistanceMeters: minSplitDistance
    };

    // Create and run the cleaning service
    const cleaningService = new GraphSAGEDrivenNetworkCleaningService(pgClient, config);
    
    const result = await cleaningService.applyGraphSAGEDrivenCleaning(predictionsPath);
    
    // Print summary
    console.log('\n📊 FINAL SUMMARY');
    console.log('================');
    console.log(`✅ Nodes processed: ${result.nodes_processed}`);
    console.log(`✂️  Nodes split: ${result.nodes_split}`);
    console.log(`🔗 Edges created: ${result.edges_created}`);
    console.log(`🗑️  Edges removed: ${result.edges_removed}`);
    console.log(`❌ Errors: ${result.errors.length}`);
    
    if (result.cleaning_summary.length > 0) {
      console.log('\n📝 Operations performed:');
      result.cleaning_summary.forEach(op => console.log(`   • ${op}`));
    }
    
    if (result.errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      result.errors.forEach(error => console.log(`   • ${error}`));
    }

    if (!dryRun && result.nodes_split > 0) {
      console.log('\n💡 Next steps:');
      console.log('   1. Review the network changes in your database');
      console.log('   2. Run network validation to check for issues');
      console.log('   3. Export updated network for visualization');
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the main function
if (require.main === module) {
  main().catch(console.error);
}

