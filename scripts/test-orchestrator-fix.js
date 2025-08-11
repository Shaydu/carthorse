#!/usr/bin/env node

const { CarthorseOrchestrator } = require('../src/orchestrator/CarthorseOrchestrator');

async function testOrchestratorFix() {
  console.log('🧪 Testing orchestrator with edge mapping fixes...');
  
  try {
    // Create orchestrator instance
    const orchestrator = new CarthorseOrchestrator({
      region: 'boulder',
      outputPath: '/tmp/boulder-test-fix.db',
      verbose: true,
      skipValidation: false,
      useSplitTrails: true,
      minTrailLengthMeters: 100
    });
    
    console.log('🚀 Starting KSP route generation...');
    
    // Run the orchestrator
    await orchestrator.generateKspRoutes();
    
    console.log('✅ Orchestrator completed successfully!');
    console.log('🔍 Check the output for route recommendations...');
    
  } catch (error) {
    console.error('❌ Orchestrator test failed:', error);
    process.exit(1);
  }
}

// Run the test
testOrchestratorFix().catch(console.error); 