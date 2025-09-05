#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { ModularSplittingOrchestrator } from '../src/services/layer1/ModularSplittingOrchestrator';

async function main() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu',
    password: 'password'
  });

  try {
    console.log('🚀 Starting Modular Splitting Orchestrator...');
    
    // Create orchestrator with strict validation
    const orchestrator = new ModularSplittingOrchestrator({
      stagingSchema: 'test_modular_splitting',
      pgClient: pool,
      verbose: true,
      enableValidation: true,
      stopOnError: true,
      exportDebugData: true,
      debugOutputPath: './test-output',
      minAccuracyPercentage: 95, // Require 95% accuracy
      validationToleranceMeters: 1, // 1 meter tolerance
      fatalOnValidationFailure: true // Stop on any validation failure
    });

    // Show available steps
    console.log('\n📋 Available splitting steps:');
    const steps = orchestrator.getSteps();
    steps.forEach((step, index) => {
      console.log(`   ${index + 1}. ${step.description} (${step.service.serviceName}) - ${step.enabled ? '✅ Enabled' : '❌ Disabled'}`);
    });

    // Show enabled steps
    console.log('\n🎯 Enabled steps:');
    const enabledSteps = orchestrator.getEnabledSteps();
    enabledSteps.forEach((step, index) => {
      console.log(`   ${index + 1}. ${step.description}`);
    });

    // Execute all enabled steps with validation
    console.log('\n🔄 Executing splitting steps with validation...');
    const results = await orchestrator.executeAll();

    // Show final summary
    const summary = orchestrator.getSummary();
    console.log('\n📊 FINAL SUMMARY:');
    console.log(`   ✅ Successful steps: ${summary.successfulSteps}/${summary.enabledSteps}`);
    console.log(`   ❌ Failed steps: ${summary.failedSteps}`);
    console.log(`   📊 Total trails processed: ${summary.totalTrailsProcessed}`);
    console.log(`   ✂️ Total trails split: ${summary.totalTrailsSplit}`);
    console.log(`   📏 Total segments created: ${summary.totalSegmentsCreated}`);
    console.log(`   🔍 Total intersections found: ${summary.totalIntersectionsFound}`);

    if (summary.failedSteps > 0) {
      console.log('\n❌ Failed steps details:');
      results.filter(r => !r.success).forEach(result => {
        console.log(`   - ${result.serviceName}: ${result.error}`);
      });
      process.exit(1);
    } else {
      console.log('\n✅ All splitting steps completed successfully with validation!');
    }

  } catch (error) {
    console.error('\n❌ Fatal error in modular splitting:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Handle command line arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: npx ts-node scripts/run-modular-splitting.ts [options]

Options:
  --help, -h          Show this help message
  --verbose           Enable verbose logging
  --no-validation     Disable validation (not recommended)
  --accuracy <num>    Set minimum accuracy percentage (default: 95)
  --tolerance <num>   Set validation tolerance in meters (default: 1)

Examples:
  npx ts-node scripts/run-modular-splitting.ts
  npx ts-node scripts/run-modular-splitting.ts --verbose --accuracy 98
  npx ts-node scripts/run-modular-splitting.ts --tolerance 0.5
`);
  process.exit(0);
}

main().catch(console.error);
