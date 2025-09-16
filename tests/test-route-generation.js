#!/usr/bin/env node

const fs = require('fs');
const yaml = require('js-yaml');

console.log('🔍 Testing route generation configuration...');

// Load the config
const config = yaml.load(fs.readFileSync('configs/layer3-routing.config.yaml', 'utf8'));

console.log('\n📋 Route generation configuration:');
console.log('   - Loops enabled:', config.routeGeneration?.enabled?.loops);
console.log('   - OutAndBack enabled:', config.routeGeneration?.enabled?.outAndBack);
console.log('   - PointToPoint enabled:', config.routeGeneration?.enabled?.pointToPoint);

console.log('\n🔍 Testing boolean logic:');

// Test the old logic (working version)
const oldLogic = {
  generateKspRoutes: config.routeGeneration?.enabled?.outAndBack !== false,
  generateLoopRoutes: config.routeGeneration?.enabled?.loops !== false,
  generateP2PRoutes: config.routeGeneration?.enabled?.pointToPoint !== false
};

// Test the new logic (failing version)
const newLogic = {
  generateKspRoutes: config.routeGeneration?.enabled?.outAndBack === true,
  generateLoopRoutes: config.routeGeneration?.enabled?.loops === true,
  generateP2PRoutes: config.routeGeneration?.enabled?.pointToPoint === true
};

console.log('\n📊 Boolean logic comparison:');
console.log('   Old logic (working):');
console.log(`     - generateKspRoutes: ${oldLogic.generateKspRoutes} (${config.routeGeneration?.enabled?.outAndBack} !== false)`);
console.log(`     - generateLoopRoutes: ${oldLogic.generateLoopRoutes} (${config.routeGeneration?.enabled?.loops} !== false)`);
console.log(`     - generateP2PRoutes: ${oldLogic.generateP2PRoutes} (${config.routeGeneration?.enabled?.pointToPoint} !== false)`);

console.log('\n   New logic (failing):');
console.log(`     - generateKspRoutes: ${newLogic.generateKspRoutes} (${config.routeGeneration?.enabled?.outAndBack} === true)`);
console.log(`     - generateLoopRoutes: ${newLogic.generateLoopRoutes} (${config.routeGeneration?.enabled?.loops} === true)`);
console.log(`     - generateP2PRoutes: ${newLogic.generateP2PRoutes} (${config.routeGeneration?.enabled?.pointToPoint} === true)`);

console.log('\n🔍 Analysis:');
if (oldLogic.generateLoopRoutes && !newLogic.generateLoopRoutes) {
  console.log('   ❌ ISSUE: Loop routes are enabled in config but new logic disables them!');
  console.log('   💡 The new logic requires explicit "true" values, but the config has boolean true');
  console.log('   💡 This is likely a JavaScript boolean vs YAML boolean issue');
}

if (oldLogic.generateKspRoutes && !newLogic.generateKspRoutes) {
  console.log('   ❌ ISSUE: Out-and-back routes are enabled in config but new logic disables them!');
}

if (oldLogic.generateP2PRoutes && !newLogic.generateP2PRoutes) {
  console.log('   ❌ ISSUE: Point-to-point routes are enabled in config but new logic disables them!');
}

console.log('\n💡 Solution:');
console.log('   Either:');
console.log('   1. Change the logic back to !== false (old working version)');
console.log('   2. Or ensure the config values are explicitly "true" strings');
console.log('   3. Or add explicit boolean conversion in the code');

// Test explicit boolean conversion
console.log('\n🧪 Testing explicit boolean conversion:');
const explicitLogic = {
  generateKspRoutes: Boolean(config.routeGeneration?.enabled?.outAndBack) === true,
  generateLoopRoutes: Boolean(config.routeGeneration?.enabled?.loops) === true,
  generateP2PRoutes: Boolean(config.routeGeneration?.enabled?.pointToPoint) === true
};

console.log('   Explicit boolean conversion:');
console.log(`     - generateKspRoutes: ${explicitLogic.generateKspRoutes}`);
console.log(`     - generateLoopRoutes: ${explicitLogic.generateLoopRoutes}`);
console.log(`     - generateP2PRoutes: ${explicitLogic.generateP2PRoutes}`);
