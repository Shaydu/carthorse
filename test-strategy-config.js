const yaml = require('js-yaml');
const fs = require('fs');

// Test loading the layer 3 routing config
const configPath = 'configs/layer3-routing.config.yaml';
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

console.log('🔍 Testing strategyClass configuration...');
console.log('Strategy Class:', config.routing?.strategyClass || 'Not found');
console.log('Default Strategy:', config.routing?.strategyClass || 'PostgisNodeStrategy');

// Test the available strategies
const availableStrategies = [
  'PostgisNodeStrategy',
  'PgrNodeNetworkStrategy', 
  'EndpointSnapAndSplitStrategy',
  'SnapAndSplitStrategy',
  'VertexBasedNetworkStrategy'
];

console.log('\n📋 Available strategies:');
availableStrategies.forEach(strategy => {
  const isSelected = config.routing?.strategyClass === strategy;
  console.log(`   ${isSelected ? '✅' : '  '} ${strategy}`);
});

console.log('\n🎯 Current configuration:');
console.log('   Strategy:', config.routing?.strategyClass || 'PostgisNodeStrategy (default)');
console.log('   Spatial Tolerance:', config.routing?.spatialTolerance || 'Not set');
console.log('   Degree2 Merge Tolerance:', config.routing?.degree2MergeTolerance || 'Not set');
