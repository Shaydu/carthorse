#!/usr/bin/env node

const { execSync } = require('child_process');

console.log('🧪 Testing Dynamic YAML Config Values vs Static Values...\n');

// Run the YAML config tests as part of the main test suite
console.log('📋 Running YAML config tests...');
try {
  execSync('npm test -- src/__tests__/yaml-config-dynamic-values.test.ts', { 
    stdio: 'inherit',
    cwd: process.cwd()
  });
  console.log('✅ YAML config tests passed\n');
} catch (error) {
  console.error('❌ YAML config tests failed');
  process.exit(1);
}

console.log('\n🎉 Configurable value tests completed!');
console.log('\n📚 Summary:');
console.log('   ✅ YAML config files load correctly');
console.log('   ✅ Dynamic values match static values');
console.log('   ✅ Config values are within valid ranges');
console.log('   ✅ Route patterns are correctly defined');
console.log('   ✅ All static values have corresponding dynamic values');
console.log('\n💡 To run SQL config tests (requires database):');
console.log('   npm run test:sql-config'); 