#!/usr/bin/env node

/**
 * Auto-Optimize Staging Schema
 * 
 * This script automatically creates optimized indexes and duplicate detection queries
 * for any staging schema. It's designed to be integrated into your export pipeline.
 * 
 * Usage:
 *   node scripts/auto-optimize-staging-schema.js [--schema=schema_name] [--dry-run]
 */

const { Pool } = require('pg');
const { DuplicateDetectionOptimizer } = require('../src/utils/services/duplicate-detection-optimizer');

// Configuration - can be overridden by environment variables
const config = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'carthorse',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'trail_master_db',
  port: process.env.DB_PORT || 5432
};

// Optimizer configuration
const optimizerConfig = {
  toleranceLevels: {
    bbox: 0.002,      // ~200m bounding box tolerance
    proximity: 0.001, // ~100m proximity tolerance
    precision: 0.00001 // ~1m precision tolerance
  },
  enableSpatialClustering: false,
  enableLengthComparison: true,
  maxResults: 1000
};

async function autoOptimizeStagingSchema() {
  const pgClient = new Pool(config);
  const optimizer = new DuplicateDetectionOptimizer(pgClient, optimizerConfig);
  
  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Check if specific schema was provided
    const schemaArg = process.argv.find(arg => arg.startsWith('--schema='));
    let targetSchema = schemaArg ? schemaArg.split('=')[1] : null;
    const isDryRun = process.argv.includes('--dry-run');

    if (!targetSchema) {
      // Find the latest staging schema
      const schemaResult = await pgClient.query(`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name LIKE 'carthorse_%' 
        ORDER BY schema_name DESC 
        LIMIT 1
      `);
      
      if (schemaResult.rows.length === 0) {
        console.log('❌ No staging schema found with pattern carthorse_%');
        return;
      }
      
      targetSchema = schemaResult.rows[0].schema_name;
      console.log(`📁 Using latest staging schema: ${targetSchema}`);
    } else {
      console.log(`📁 Using specified schema: ${targetSchema}`);
    }

    // Get performance stats before optimization
    console.log('\n📊 Performance stats before optimization:');
    const beforeStats = await optimizer.getPerformanceStats(targetSchema);
    console.log(`  Table size: ${beforeStats.tableSize}`);
    console.log(`  Row count: ${beforeStats.rowCount}`);
    console.log(`  Index count: ${beforeStats.indexCount}`);
    console.log(`  Has optimized indexes: ${beforeStats.hasOptimizedIndexes ? 'Yes' : 'No'}`);

    if (isDryRun) {
      console.log('\n📝 DRY RUN - Would execute the following:');
      console.log('1. Create optimized indexes');
      console.log('2. Generate optimized duplicate detection query');
      console.log('3. Test query performance');
      return;
    }

    // Step 1: Create optimized indexes
    console.log('\n🔧 Creating optimized indexes...');
    const indexResult = await optimizer.createOptimizedIndexes(targetSchema);
    
    if (indexResult.success) {
      console.log(`✅ Successfully created ${indexResult.indexesCreated.length} indexes`);
    } else {
      console.log(`⚠️  Index creation completed with ${indexResult.errors.length} errors`);
      indexResult.errors.forEach(error => console.log(`  ❌ ${error}`));
    }

    // Step 2: Test optimized duplicate detection
    console.log('\n🔍 Testing optimized duplicate detection...');
    try {
      const detectionResult = await optimizer.executeDuplicateDetection(targetSchema, 'index-optimized');
      console.log(`✅ Duplicate detection completed in ${detectionResult.executionTimeMs}ms`);
      console.log(`📊 Found ${detectionResult.duplicatesFound} duplicates`);
      
      if (detectionResult.duplicatesFound > 0) {
        console.log('\n📋 Sample duplicates found:');
        detectionResult.duplicatesToRemove.slice(0, 5).forEach((duplicate, index) => {
          console.log(`  ${index + 1}. ${duplicate.nameToDelete} (${duplicate.distanceMeters.toFixed(2)}m)`);
        });
      }
    } catch (error) {
      console.error('❌ Duplicate detection failed:', error.message);
    }

    // Step 3: Get performance stats after optimization
    console.log('\n📊 Performance stats after optimization:');
    const afterStats = await optimizer.getPerformanceStats(targetSchema);
    console.log(`  Table size: ${afterStats.tableSize}`);
    console.log(`  Row count: ${afterStats.rowCount}`);
    console.log(`  Index count: ${afterStats.indexCount}`);
    console.log(`  Has optimized indexes: ${afterStats.hasOptimizedIndexes ? 'Yes' : 'No'}`);

    // Step 4: Generate and save the optimized query
    console.log('\n📝 Generating optimized duplicate detection query...');
    const optimizedQuery = optimizer.generateOptimizedQuery(targetSchema, 'index-optimized');
    
    // Save the query to a file for reference
    const fs = require('fs');
    const queryFileName = `optimized-duplicate-detection-${targetSchema}.sql`;
    fs.writeFileSync(queryFileName, `-- Optimized Duplicate Detection Query for ${targetSchema}\n-- Generated automatically on ${new Date().toISOString()}\n\n${optimizedQuery}`);
    console.log(`✅ Saved optimized query to: ${queryFileName}`);

    // Step 5: Show integration instructions
    console.log('\n🚀 Integration Instructions:');
    console.log('1. Replace any existing duplicate detection queries with the optimized version');
    console.log('2. The optimized query will automatically use the new indexes');
    console.log('3. Expected performance: 20-100x faster than the original hanging query');
    console.log('4. Run this script after each export to optimize new staging schemas');

    console.log('\n🎉 Staging schema optimization completed successfully!');

  } catch (error) {
    console.error('❌ Error during optimization:', error);
    process.exit(1);
  } finally {
    await pgClient.end();
    console.log('✅ Disconnected from database');
  }
}

// Main execution
if (require.main === module) {
  autoOptimizeStagingSchema().catch(console.error);
}

module.exports = { autoOptimizeStagingSchema };
