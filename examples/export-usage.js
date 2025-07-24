#!/usr/bin/env node

/**
 * Example usage of the EnhancedPostgresOrchestrator export methods
 * 
 * This demonstrates how to use the orchestrator as an entrypoint for database exports
 */

const { EnhancedPostgresOrchestrator } = require('../dist/orchestrator/EnhancedPostgresOrchestrator');

// Example 1: Export existing staging data
async function exportStagingExample() {
  console.log('📋 Example 1: Export existing staging data');
  
  const config = {
    region: 'boulder',
    outputPath: './data/boulder-staging-export.db',
    simplifyTolerance: 0.001,
    intersectionTolerance: 2.0,
    replace: true,
    validate: false,
    verbose: true,
    skipBackup: true,
    buildMaster: false,
    targetSizeMB: null,
    maxSpatiaLiteDbSizeMB: 400,
    skipIncompleteTrails: false,
    useSqlite: true
  };

  const orchestrator = new EnhancedPostgresOrchestrator(config);
  
  try {
    // Connect to database
    await orchestrator.pgClient.connect();
    console.log('✅ Connected to PostgreSQL');
    
    // Export staging data (if it exists)
    await orchestrator.exportStagingData();
    console.log('✅ Staging data exported successfully');
    
  } catch (error) {
    console.error('❌ Export failed:', error.message);
  } finally {
    if (orchestrator.pgClient) {
      await orchestrator.pgClient.end();
    }
  }
}

// Example 2: Run full pipeline and export
async function fullPipelineExample() {
  console.log('📋 Example 2: Run full pipeline and export');
  
  const config = {
    region: 'boulder',
    outputPath: './data/boulder-full-pipeline.db',
    simplifyTolerance: 0.001,
    intersectionTolerance: 2.0,
    replace: true,
    validate: true,
    verbose: true,
    skipBackup: true,
    buildMaster: false,
    targetSizeMB: null,
    maxSpatiaLiteDbSizeMB: 400,
    skipIncompleteTrails: false,
    useSqlite: true
  };

  const orchestrator = new EnhancedPostgresOrchestrator(config);
  
  try {
    // This runs the full pipeline including export
    await orchestrator.run();
    console.log('✅ Full pipeline completed successfully');
    
  } catch (error) {
    console.error('❌ Full pipeline failed:', error.message);
  }
}

// Example 3: Export database after processing
async function exportAfterProcessingExample() {
  console.log('📋 Example 3: Export database after processing');
  
  const config = {
    region: 'boulder',
    outputPath: './data/boulder-post-processing.db',
    simplifyTolerance: 0.001,
    intersectionTolerance: 2.0,
    replace: true,
    validate: false,
    verbose: true,
    skipBackup: true,
    buildMaster: false,
    targetSizeMB: null,
    maxSpatiaLiteDbSizeMB: 400,
    skipIncompleteTrails: false,
    useSqlite: true
  };

  const orchestrator = new EnhancedPostgresOrchestrator(config);
  
  try {
    // Connect to database
    await orchestrator.pgClient.connect();
    console.log('✅ Connected to PostgreSQL');
    
    // Run processing steps manually (without export)
    console.log('🚀 Running processing pipeline...');
    
    // Step 1: Create staging environment
    await orchestrator.createStagingEnvironment();
    
    // Step 2: Copy region data
    await orchestrator.copyRegionDataToStaging();
    
    // Step 3: Detect intersections
    await orchestrator.detectIntersections();
    
    // Step 4: Split trails at intersections
    await orchestrator.splitTrailsAtIntersections();
    
    // Step 5: Build routing graph
    await orchestrator.buildRoutingGraph();
    
    // Step 6: Export to SQLite
    await orchestrator.exportDatabase();
    
    console.log('✅ Processing and export completed successfully');
    
  } catch (error) {
    console.error('❌ Processing failed:', error.message);
  } finally {
    if (orchestrator.pgClient) {
      await orchestrator.pgClient.end();
    }
  }
}

// Example 4: Export with custom configuration
async function customExportExample() {
  console.log('📋 Example 4: Export with custom configuration');
  
  const config = {
    region: 'seattle',
    outputPath: './data/seattle-custom.db',
    simplifyTolerance: 0.002, // More aggressive simplification
    intersectionTolerance: 5.0, // Larger intersection tolerance
    replace: true,
    validate: true,
    verbose: true,
    skipBackup: true,
    buildMaster: false,
    targetSizeMB: 50, // Target 50MB database
    maxSpatiaLiteDbSizeMB: 200, // Smaller max size
    skipIncompleteTrails: true, // Skip incomplete trails
    useSqlite: true,
    bbox: [-122.5, 47.5, -122.0, 47.8] // Custom bounding box
  };

  const orchestrator = new EnhancedPostgresOrchestrator(config);
  
  try {
    await orchestrator.run();
    console.log('✅ Custom export completed successfully');
    
  } catch (error) {
    console.error('❌ Custom export failed:', error.message);
  }
}

// Main function to run examples
async function runExamples() {
  const example = process.argv[2];
  
  switch (example) {
    case 'staging':
      await exportStagingExample();
      break;
    case 'full':
      await fullPipelineExample();
      break;
    case 'post-processing':
      await exportAfterProcessingExample();
      break;
    case 'custom':
      await customExportExample();
      break;
    default:
      console.log('Available examples:');
      console.log('  node examples/export-usage.js staging         # Export existing staging data');
      console.log('  node examples/export-usage.js full            # Run full pipeline and export');
      console.log('  node examples/export-usage.js post-processing # Export after manual processing');
      console.log('  node examples/export-usage.js custom          # Export with custom configuration');
      break;
  }
}

// Run examples if this script is executed directly
if (require.main === module) {
  runExamples().catch(console.error);
}

module.exports = {
  exportStagingExample,
  fullPipelineExample,
  exportAfterProcessingExample,
  customExportExample
}; 