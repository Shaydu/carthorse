#!/usr/bin/env node

const fs = require('fs');
const yaml = require('js-yaml');

console.log('🔍 Debugging route generation service...');

// Load the config
const config = yaml.load(fs.readFileSync('configs/layer3-routing.config.yaml', 'utf8'));

console.log('\n📋 Route generation configuration:');
console.log('   - Loops enabled:', config.routeGeneration?.enabled?.loops);
console.log('   - OutAndBack enabled:', config.routeGeneration?.enabled?.outAndBack);
console.log('   - PointToPoint enabled:', config.routeGeneration?.enabled?.pointToPoint);

// Test the boolean logic that's used in the service
console.log('\n🔍 Testing the exact boolean logic used in the service:');

const generateKspRoutes = config.routeGeneration?.enabled?.outAndBack === true;
const generateLoopRoutes = config.routeGeneration?.enabled?.loops === true;
const generateP2PRoutes = config.routeGeneration?.enabled?.pointToPoint === true;

console.log('   generateKspRoutes:', generateKspRoutes);
console.log('   generateLoopRoutes:', generateLoopRoutes);
console.log('   generateP2PRoutes:', generateP2PRoutes);

console.log('\n🔍 Testing service initialization logic:');

// Test what services would be initialized
if (generateKspRoutes) {
  console.log('   ✅ OutAndBackGeneratorService would be initialized');
} else {
  console.log('   ❌ OutAndBackGeneratorService would NOT be initialized');
}

if (generateP2PRoutes || generateKspRoutes) {
  console.log('   ✅ UnifiedKspRouteGeneratorService would be initialized');
} else {
  console.log('   ❌ UnifiedKspRouteGeneratorService would NOT be initialized');
}

if (generateKspRoutes) {
  console.log('   ✅ TrueOutAndBackService would be initialized');
} else {
  console.log('   ❌ TrueOutAndBackService would NOT be initialized');
}

if (generateLoopRoutes) {
  console.log('   ✅ UnifiedLoopRouteGeneratorService would be initialized');
} else {
  console.log('   ❌ UnifiedLoopRouteGeneratorService would NOT be initialized');
}

console.log('\n🔍 Testing route generation logic:');

// Test what routes would be generated
if (generateP2PRoutes) {
  console.log('   ✅ Point-to-point routes would be generated');
} else {
  console.log('   ❌ Point-to-point routes would NOT be generated');
}

if (generateKspRoutes) {
  console.log('   ✅ Out-and-back routes would be generated');
} else {
  console.log('   ❌ Out-and-back routes would NOT be generated');
}

if (generateLoopRoutes) {
  console.log('   ✅ Loop routes would be generated');
} else {
  console.log('   ❌ Loop routes would NOT be generated');
}

console.log('\n🔍 Analysis:');
if (!generateLoopRoutes) {
  console.log('   ❌ ISSUE: Loop routes are NOT being generated!');
  console.log('   💡 This means the UnifiedLoopRouteGeneratorService is not being initialized');
  console.log('   💡 And the loop generation code path is not being executed');
} else {
  console.log('   ✅ Loop routes SHOULD be generated');
}

if (!generateKspRoutes) {
  console.log('   ❌ ISSUE: Out-and-back routes are NOT being generated!');
} else {
  console.log('   ✅ Out-and-back routes SHOULD be generated');
}

console.log('\n💡 Next steps:');
console.log('   1. Check if the network generation is working properly');
console.log('   2. Check if the unified network generator is creating the required tables');
console.log('   3. Check if there are any errors in the loop generation service');
console.log('   4. Check if the database has the required data for route generation');
