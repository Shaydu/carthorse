#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';

// Files to REMOVE (duplicates based on analysis)
const DUPLICATE_FILES = [
  'USGS_13_n40w106_20230602.tif',
  'n39w106 copy.tif',
  'n39w106.tif',
  'USGS_13_n41w106_20230314.tif',
  'n40w106.tif'
];

// Files to KEEP (unique files)
const KEEP_FILES = [
  'USGS_13_n39w106_20230602_renamed.tif',
  'USGS_13_n40w106_20230314_renamed.tif'
];

async function removeDuplicates(): Promise<void> {
  const tiffDir = process.env.ELEVATION_TIFF_DIR || '/Users/shaydu/dev/TIFFS';
  const duplicatesDir = path.join(tiffDir, 'duplicates-removed');
  
  console.log(`🗂️  Removing duplicate TIFF files to: ${duplicatesDir}`);
  console.log('');

  // Create the duplicates directory if it doesn't exist
  if (!fs.existsSync(duplicatesDir)) {
    fs.mkdirSync(duplicatesDir, { recursive: true });
    console.log(`✅ Created directory: ${duplicatesDir}`);
  }

  let totalMoved = 0;
  let totalSizeMB = 0;

  console.log('📦 Moving duplicate files...');
  console.log('');

  for (const filename of DUPLICATE_FILES) {
    const sourcePath = path.join(tiffDir, filename);
    const destPath = path.join(duplicatesDir, filename);

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
  console.log('===========');
  console.log(`   - Duplicate files moved: ${totalMoved}`);
  console.log(`   - Space saved: ${totalSizeMB.toFixed(1)} MB`);
  console.log(`   - Destination: ${duplicatesDir}`);
  console.log('');
  
  console.log('✅ FILES REMAINING FOR BOULDER:');
  console.log('================================');
  for (const filename of KEEP_FILES) {
    const filePath = path.join(tiffDir, filename);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const sizeMB = stats.size / (1024 * 1024);
      console.log(`   ✅ ${filename} (${sizeMB.toFixed(1)} MB)`);
    } else {
      console.log(`   ⚠️  ${filename} (not found)`);
    }
  }
  
  console.log('');
  console.log('🎉 Duplicate removal complete!');
  console.log('   The AtomicTrailInserter will now only load 2 unique TIFF files instead of 7.');
  console.log('   This will significantly reduce memory usage and loading time.');
}

// Run the script
removeDuplicates().catch(console.error);
