#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';

// Files that are NOT needed for Boulder (based on analysis)
const UNNEEDED_FILES = [
  'USGS_13_n39w105_20230602 2.tif',
  'USGS_13_n39w105_20230602.tif',
  'USGS_13_n39w106_20230602.tif',
  'USGS_13_n40w105_20230602 2.tif',
  'USGS_13_n40w105_20230602.tif',
  'USGS_13_n48w123_20240327 2.tif',
  'USGS_13_n48w123_20240327.tif'
];

async function moveUnneededTiffs(): Promise<void> {
  const tiffDir = process.env.ELEVATION_TIFF_DIR || '/Users/shaydu/dev/TIFFS';
  const unneededDir = path.join(tiffDir, 'unneeded-for-boulder');
  
  console.log(`🗂️  Moving unneeded TIFF files to: ${unneededDir}`);
  console.log('');

  // Create the unneeded directory if it doesn't exist
  if (!fs.existsSync(unneededDir)) {
    fs.mkdirSync(unneededDir, { recursive: true });
    console.log(`✅ Created directory: ${unneededDir}`);
  }

  let totalMoved = 0;
  let totalSizeMB = 0;

  for (const filename of UNNEEDED_FILES) {
    const sourcePath = path.join(tiffDir, filename);
    const destPath = path.join(unneededDir, filename);

    if (fs.existsSync(sourcePath)) {
      try {
        const stats = fs.statSync(sourcePath);
        const sizeMB = stats.size / (1024 * 1024);
        
        console.log(`📦 Moving ${filename} (${sizeMB.toFixed(1)} MB)...`);
        
        fs.renameSync(sourcePath, destPath);
        
        totalMoved++;
        totalSizeMB += sizeMB;
        
        console.log(`✅ Moved: ${filename}`);
      } catch (error) {
        console.error(`❌ Failed to move ${filename}:`, error);
      }
    } else {
      console.log(`⚠️  File not found: ${filename}`);
    }
  }

  console.log('');
  console.log('📊 SUMMARY:');
  console.log(`   - Files moved: ${totalMoved}`);
  console.log(`   - Space freed: ${totalSizeMB.toFixed(1)} MB`);
  console.log(`   - Destination: ${unneededDir}`);
  console.log('');
  console.log('✅ Unneeded TIFF files have been moved!');
  console.log('   The AtomicTrailInserter will now only load the Boulder-relevant files.');
}

// Run the script
moveUnneededTiffs().catch(console.error);
