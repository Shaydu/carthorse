#!/usr/bin/env node
/**
 * Example: Intersection-Based Routing
 * 
 * This script demonstrates how to use the intersection-based orchestrator
 * to process trails and create a routing network.
 */

const { spawnSync } = require('child_process');
const path = require('path');

console.log('🚀 Intersection-Based Routing Example');
console.log('=====================================\n');

// Function to run CLI commands
function runCommand(command, args = []) {
  console.log(`Running: ${command} ${args.join(' ')}`);
  
  const result = spawnSync('npx', ['ts-node', command, ...args], {
    stdio: 'inherit',
    cwd: process.cwd()
  });
  
  if (result.status !== 0) {
    console.error(`❌ Command failed with status: ${result.status}`);
    process.exit(1);
  }
  
  console.log('✅ Command completed successfully\n');
}

async function main() {
  try {
    console.log('Step 1: Installing intersection-based routing system...');
    runCommand('src/cli/intersection-export.ts', ['install']);
    
    console.log('Step 2: Installing test database with sample data...');
    runCommand('src/cli/intersection-export.ts', ['install-test', '--region', 'boulder', '--limit', '100']);
    
    console.log('Step 3: Processing trails with intersection-based routing...');
    runCommand('src/cli/intersection-export.ts', [
      'process',
      '--densify', '5',
      '--snap', '0.00001',
      '--segmentize', '5'
    ]);
    
    console.log('Step 4: Validating the intersection-based network...');
    runCommand('src/cli/intersection-export.ts', ['validate']);
    
    console.log('Step 5: Getting network statistics...');
    runCommand('src/cli/intersection-export.ts', ['process']);
    
    console.log('\n🎉 Intersection-based routing example completed successfully!');
    console.log('\nThe intersection-based orchestrator has:');
    console.log('- Created a working copy of trail geometry');
    console.log('- Densified lines for better intersection detection');
    console.log('- Detected trail intersections using PostGIS');
    console.log('- Extracted unique node points');
    console.log('- Split trails at node locations');
    console.log('- Created a complete routing network');
    
    console.log('\nYou can now compare this approach with the main orchestrator!');
    
  } catch (error) {
    console.error('❌ Example failed:', error);
    process.exit(1);
  }
}

// Run the example
if (require.main === module) {
  main();
} 