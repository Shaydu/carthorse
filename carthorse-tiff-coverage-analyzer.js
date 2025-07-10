#!/usr/bin/env node
/**
 * Check TIFF Coverage Against App Bounding Box
 * Analyzes all TIFF files in elevation-data/ and compares with app's configured bbox
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// App's configured bounding box (from config/api-regions.json)
const APP_BBOX = {
  minLng: -105.67025,
  maxLng: -105.16744,
  minLat: 39.78208,
  maxLat: 40.52739
};

function getTiffBounds(tiffPath) {
  try {
    const output = execSync(`gdalinfo "${tiffPath}"`, { encoding: 'utf8' });
    
    // Extract corner coordinates
    const upperLeftMatch = output.match(/Upper Left\s*\(([^)]+)\)/);
    const lowerRightMatch = output.match(/Lower Right\s*\(([^)]+)\)/);
    
    if (!upperLeftMatch || !lowerRightMatch) {
      throw new Error('Could not parse corner coordinates');
    }
    
    const upperLeft = upperLeftMatch[1].split(',').map(coord => parseFloat(coord.trim()));
    const lowerRight = lowerRightMatch[1].split(',').map(coord => parseFloat(coord.trim()));
    
    return {
      minLng: Math.min(upperLeft[0], lowerRight[0]),
      maxLng: Math.max(upperLeft[0], lowerRight[0]),
      minLat: Math.min(upperLeft[1], lowerRight[1]),
      maxLat: Math.max(upperLeft[1], lowerRight[1])
    };
  } catch (error) {
    console.error(`❌ Error reading ${path.basename(tiffPath)}:`, error.message);
    return null;
  }
}

function checkCoverage() {
  console.log('🗺️ TIFF Coverage Analysis\n');
  
  // Get app bbox info
  console.log('📱 App Bounding Box:');
  console.log(`   Longitude: ${APP_BBOX.minLng} to ${APP_BBOX.maxLng}`);
  console.log(`   Latitude:  ${APP_BBOX.minLat} to ${APP_BBOX.maxLat}`);
  console.log(`   Width:     ${(APP_BBOX.maxLng - APP_BBOX.minLng).toFixed(4)}°`);
  console.log(`   Height:    ${(APP_BBOX.maxLat - APP_BBOX.minLat).toFixed(4)}°`);
  console.log();
  
  // Find all TIFF files
  const tiffDir = path.join(__dirname, '..', 'elevation-data');
  const tiffFiles = fs.readdirSync(tiffDir)
    .filter(file => file.endsWith('.tif') || file.endsWith('.tiff'))
    .map(file => path.join(tiffDir, file));
  
  if (tiffFiles.length === 0) {
    console.log('❌ No TIFF files found in elevation-data/');
    return;
  }
  
  console.log(`📁 Found ${tiffFiles.length} TIFF files:\n`);
  
  // Analyze each TIFF
  const tiffBounds = [];
  let totalMinLng = Infinity, totalMaxLng = -Infinity;
  let totalMinLat = Infinity, totalMaxLat = -Infinity;
  
  for (const tiffPath of tiffFiles) {
    const filename = path.basename(tiffPath);
    console.log(`📄 ${filename}:`);
    
    const bounds = getTiffBounds(tiffPath);
    if (!bounds) continue;
    
    tiffBounds.push({ filename, bounds });
    
    console.log(`   Bounds: [${bounds.minLng.toFixed(6)}, ${bounds.minLat.toFixed(6)}] to [${bounds.maxLng.toFixed(6)}, ${bounds.maxLat.toFixed(6)}]`);
    console.log(`   Width:  ${(bounds.maxLng - bounds.minLng).toFixed(4)}° longitude`);
    console.log(`   Height: ${(bounds.maxLat - bounds.minLat).toFixed(4)}° latitude`);
    
    // Update total coverage
    totalMinLng = Math.min(totalMinLng, bounds.minLng);
    totalMaxLng = Math.max(totalMaxLng, bounds.maxLng);
    totalMinLat = Math.min(totalMinLat, bounds.minLat);
    totalMaxLat = Math.max(totalMaxLat, bounds.maxLat);
    
    console.log();
  }
  
  // Calculate total coverage
  console.log('📊 Total TIFF Coverage:');
  console.log(`   Bounds: [${totalMinLng.toFixed(6)}, ${totalMinLat.toFixed(6)}] to [${totalMaxLng.toFixed(6)}, ${totalMaxLat.toFixed(6)}]`);
  console.log(`   Width:  ${(totalMaxLng - totalMinLng).toFixed(4)}° longitude`);
  console.log(`   Height: ${(totalMaxLat - totalMinLat).toFixed(4)}° latitude`);
  console.log();
  
  // Check if app bbox is fully covered
  const isFullyCovered = 
    APP_BBOX.minLng >= totalMinLng && 
    APP_BBOX.maxLng <= totalMaxLng && 
    APP_BBOX.minLat >= totalMinLat && 
    APP_BBOX.maxLat <= totalMaxLat;
  
  console.log('🎯 Coverage Analysis:');
  if (isFullyCovered) {
    console.log('   ✅ App bounding box is FULLY COVERED by TIFF files!');
  } else {
    console.log('   ❌ App bounding box is NOT fully covered');
    
    // Check which edges are missing
    if (APP_BBOX.minLng < totalMinLng) {
      console.log(`   ⚠️  Missing west coverage: app needs ${APP_BBOX.minLng} but TIFFs start at ${totalMinLng}`);
    }
    if (APP_BBOX.maxLng > totalMaxLng) {
      console.log(`   ⚠️  Missing east coverage: app needs ${APP_BBOX.maxLng} but TIFFs end at ${totalMaxLng}`);
    }
    if (APP_BBOX.minLat < totalMinLat) {
      console.log(`   ⚠️  Missing south coverage: app needs ${APP_BBOX.minLat} but TIFFs start at ${totalMinLat}`);
    }
    if (APP_BBOX.maxLat > totalMaxLat) {
      console.log(`   ⚠️  Missing north coverage: app needs ${APP_BBOX.maxLat} but TIFFs end at ${totalMaxLat}`);
    }
  }
  
  console.log('\n📈 Summary:');
  console.log(`   TIFF files: ${tiffFiles.length}`);
  console.log(`   Total coverage area: ${((totalMaxLng - totalMinLng) * (totalMaxLat - totalMinLat)).toFixed(3)} sq degrees`);
  console.log(`   App area: ${((APP_BBOX.maxLng - APP_BBOX.minLng) * (APP_BBOX.maxLat - APP_BBOX.minLat)).toFixed(3)} sq degrees`);
  
  if (isFullyCovered) {
    console.log('\n🚀 Ready for elevation extraction!');
  } else {
    console.log('\n⚠️  Consider downloading additional TIFF files to cover missing areas.');
  }
}

// Run the analysis
if (require.main === module) {
  checkCoverage();
}

module.exports = { checkCoverage, APP_BBOX }; 