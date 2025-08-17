#!/usr/bin/env node
/**
 * Compare Export Files to Analyze Coordinate Rounding Impact
 * 
 * Compares the original export with the new export that includes coordinate rounding
 * to see if T-intersection splitting has improved.
 */

const fs = require('fs');

function compareExports() {
  console.log('🔍 Comparing export files to analyze coordinate rounding impact...');
  
  try {
    // Read both files
    const originalData = JSON.parse(fs.readFileSync('./test-output/boulder-degree-colored-export.geojson', 'utf8'));
    const roundedData = JSON.parse(fs.readFileSync('./test-output/boulder-degree-colored-export-with-rounding.geojson', 'utf8'));
    
    console.log(`📊 Original export: ${originalData.features.length} features`);
    console.log(`📊 Rounded export: ${roundedData.features.length} features`);
    
    // Find Enchanted Mesa and Kohler trails in both files
    const originalEnchanted = originalData.features.filter(f => 
      f.properties.name && f.properties.name.includes('Enchanted')
    );
    const roundedEnchanted = roundedData.features.filter(f => 
      f.properties.name && f.properties.name.includes('Enchanted')
    );
    
    console.log(`\n🎯 Enchanted Mesa trails found:`);
    console.log(`  Original: ${originalEnchanted.length} features`);
    console.log(`  Rounded: ${roundedEnchanted.length} features`);
    
    // Compare lengths
    console.log('\n📏 Length comparison:');
    originalEnchanted.forEach((feature, i) => {
      const name = feature.properties.name;
      const originalLength = feature.properties.length_km;
      const roundedFeature = roundedEnchanted.find(f => f.properties.name === name);
      const roundedLength = roundedFeature ? roundedFeature.properties.length_km : 'NOT FOUND';
      
      console.log(`  ${name}:`);
      console.log(`    Original: ${originalLength} km`);
      console.log(`    Rounded:  ${roundedLength} km`);
      if (roundedFeature) {
        const diff = Math.abs(originalLength - roundedLength);
        console.log(`    Diff:     ${diff.toFixed(6)} km`);
      }
      console.log('');
    });
    
    // Check for any new split segments
    const originalNames = originalEnchanted.map(f => f.properties.name);
    const roundedNames = roundedEnchanted.map(f => f.properties.name);
    
    const newInRounded = roundedNames.filter(name => !originalNames.includes(name));
    const missingInRounded = originalNames.filter(name => !roundedNames.includes(name));
    
    if (newInRounded.length > 0) {
      console.log('✅ NEW segments found with rounding:');
      newInRounded.forEach(name => console.log(`  + ${name}`));
    }
    
    if (missingInRounded.length > 0) {
      console.log('❌ Missing segments with rounding:');
      missingInRounded.forEach(name => console.log(`  - ${name}`));
    }
    
    // Check coordinate precision
    console.log('\n🔢 Coordinate precision comparison:');
    if (originalEnchanted.length > 0 && roundedEnchanted.length > 0) {
      const originalCoords = originalEnchanted[0].geometry.coordinates[0];
      const roundedCoords = roundedEnchanted[0].geometry.coordinates[0];
      
      console.log(`  Original precision: ${originalCoords[0].toString().split('.')[1]?.length || 0} decimal places`);
      console.log(`  Rounded precision:  ${roundedCoords[0].toString().split('.')[1]?.length || 0} decimal places`);
    }
    
  } catch (error) {
    console.error('❌ Error comparing exports:', error.message);
  }
}

// Run the comparison
if (require.main === module) {
  compareExports();
}

module.exports = { compareExports };
