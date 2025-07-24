#!/usr/bin/env node

const { EnhancedPostgresOrchestrator } = require('./dist/orchestrator/EnhancedPostgresOrchestrator');

async function testExportMethods() {
  console.log('🧪 Testing orchestrator export methods...');
  
  // Create orchestrator config
  const config = {
    region: 'boulder',
    outputPath: './data/test-export.db',
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
    
    // Test 1: Export staging data (if staging exists)
    console.log('\n📋 Test 1: Export staging data...');
    try {
      await orchestrator.exportStagingData();
      console.log('✅ Staging data export successful');
    } catch (error) {
      console.log('⚠️ Staging data export failed (expected if no staging exists):', error.message);
    }
    
    // Test 2: Run full pipeline and export
    console.log('\n📋 Test 2: Run full pipeline and export...');
    try {
      await orchestrator.run();
      console.log('✅ Full pipeline and export successful');
    } catch (error) {
      console.log('⚠️ Full pipeline failed:', error.message);
    }
    
    // Test 3: Export database after pipeline
    console.log('\n📋 Test 3: Export database after pipeline...');
    try {
      await orchestrator.exportDatabase();
      console.log('✅ Database export successful');
    } catch (error) {
      console.log('⚠️ Database export failed:', error.message);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Clean up
    if (orchestrator.pgClient) {
      await orchestrator.pgClient.end();
    }
  }
}

// Example usage functions
async function exportExistingStaging() {
  console.log('💾 Exporting existing staging data...');
  
  const config = {
    region: 'boulder',
    outputPath: './data/boulder-export.db',
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
    await orchestrator.pgClient.connect();
    await orchestrator.exportStagingData();
    console.log('✅ Export completed successfully');
  } catch (error) {
    console.error('❌ Export failed:', error);
  } finally {
    if (orchestrator.pgClient) {
      await orchestrator.pgClient.end();
    }
  }
}

async function runFullPipelineAndExport() {
  console.log('🚀 Running full pipeline and export...');
  
  const config = {
    region: 'boulder',
    outputPath: './data/boulder-full.db',
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
    await orchestrator.run();
    console.log('✅ Full pipeline and export completed successfully');
  } catch (error) {
    console.error('❌ Full pipeline failed:', error);
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'test':
      testExportMethods();
      break;
    case 'export-staging':
      exportExistingStaging();
      break;
    case 'full-pipeline':
      runFullPipelineAndExport();
      break;
    default:
      console.log('Usage:');
      console.log('  node test-export-methods.js test           # Run all tests');
      console.log('  node test-export-methods.js export-staging # Export existing staging data');
      console.log('  node test-export-methods.js full-pipeline  # Run full pipeline and export');
      break;
  }
}

module.exports = {
  testExportMethods,
  exportExistingStaging,
  runFullPipelineAndExport
}; 