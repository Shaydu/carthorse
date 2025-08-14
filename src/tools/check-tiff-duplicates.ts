#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';
import { fromArrayBuffer } from 'geotiff';

// Files that ARE needed for Boulder (based on analysis)
const BOULDER_FILES = [
  'USGS_13_n39w106_20230602_renamed.tif',
  'USGS_13_n40w106_20230314_renamed.tif',
  'USGS_13_n40w106_20230602.tif',
  'USGS_13_n41w106_20230314.tif',
  'n39w106 copy.tif',
  'n39w106.tif',
  'n40w106.tif'
];

interface TiffInfo {
  filename: string;
  filePath: string;
  bbox: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
  sizeMB: number;
  hash?: string;
}

async function getTiffBBox(image: any): Promise<any> {
  const bbox = image.getBoundingBox();
  
  // Check if the coordinates are in Web Mercator (EPSG:3857) or WGS84 (EPSG:4326)
  const isWebMercator = Math.abs(bbox[0]) > 1000 || Math.abs(bbox[1]) > 1000;
  
  if (isWebMercator) {
    // Convert Web Mercator to WGS84
    const minLng = (bbox[0] * 180) / (20037508.34);
    const minLat = (Math.atan(Math.exp(bbox[1] * Math.PI / 20037508.34)) * 2 - Math.PI / 2) * 180 / Math.PI;
    const maxLng = (bbox[2] * 180) / (20037508.34);
    const maxLat = (Math.atan(Math.exp(bbox[3] * Math.PI / 20037508.34)) * 2 - Math.PI / 2) * 180 / Math.PI;
    
    return {
      minLng,
      minLat,
      maxLng,
      maxLat
    };
  } else {
    // Already in WGS84
    const minLng = Math.min(bbox[0], bbox[2]);
    const maxLng = Math.max(bbox[0], bbox[2]);
    const minLat = Math.min(bbox[1], bbox[3]);
    const maxLat = Math.max(bbox[1], bbox[3]);
    
    return {
      minLng,
      minLat,
      maxLng,
      maxLat
    };
  }
}

function createFileHash(buffer: Buffer): string {
  // Simple hash function for file content
  let hash = 0;
  for (let i = 0; i < buffer.length; i++) {
    const char = buffer[i];
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(16);
}

async function checkDuplicates(): Promise<void> {
  const tiffDir = process.env.ELEVATION_TIFF_DIR || '/Users/shaydu/dev/TIFFS';
  console.log(`🔍 Checking for duplicates among Boulder TIFF files in: ${tiffDir}`);
  console.log('');

  if (!fs.existsSync(tiffDir)) {
    console.error('❌ TIFF directory not found!');
    return;
  }

  const tiffInfos: TiffInfo[] = [];

  for (const filename of BOULDER_FILES) {
    const filePath = path.join(tiffDir, filename);
    
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  File not found: ${filename}`);
      continue;
    }

    try {
      const stats = fs.statSync(filePath);
      const sizeMB = stats.size / (1024 * 1024);
      
      console.log(`📖 Analyzing ${filename} (${sizeMB.toFixed(1)} MB)...`);
      
      const nodeBuffer = fs.readFileSync(filePath);
      const arrayBuffer = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength);
      const tiff = await fromArrayBuffer(arrayBuffer);
      const image = await tiff.getImage();
      
      const bbox = await getTiffBBox(image);
      const hash = createFileHash(nodeBuffer);

      tiffInfos.push({
        filename,
        filePath,
        bbox,
        sizeMB,
        hash
      });

      console.log(`   Coverage: ${bbox.minLng.toFixed(4)}°W to ${bbox.maxLng.toFixed(4)}°W, ${bbox.minLat.toFixed(4)}°N to ${bbox.maxLat.toFixed(4)}°N`);
      console.log(`   Hash: ${hash}`);
      console.log('');

    } catch (error) {
      console.error(`❌ Failed to analyze ${filename}:`, error);
      console.log('');
    }
  }

  // Check for duplicates by hash
  console.log('🔍 DUPLICATE ANALYSIS:');
  console.log('=====================');
  
  const hashGroups: { [hash: string]: TiffInfo[] } = {};
  
  for (const tiffInfo of tiffInfos) {
    if (tiffInfo.hash) {
      if (!hashGroups[tiffInfo.hash]) {
        hashGroups[tiffInfo.hash] = [];
      }
      hashGroups[tiffInfo.hash].push(tiffInfo);
    }
  }

  let totalDuplicates = 0;
  let totalDuplicateSizeMB = 0;

  for (const [hash, files] of Object.entries(hashGroups)) {
    if (files.length > 1) {
      console.log(`🔄 DUPLICATE GROUP (Hash: ${hash}):`);
      files.forEach((file, index) => {
        const isOriginal = index === 0;
        console.log(`   ${isOriginal ? '✅ KEEP' : '🗑️  REMOVE'}: ${file.filename} (${file.sizeMB.toFixed(1)} MB)`);
        if (!isOriginal) {
          totalDuplicates++;
          totalDuplicateSizeMB += file.sizeMB;
        }
      });
      console.log('');
    }
  }

  // Check for duplicates by coverage
  console.log('📍 COVERAGE DUPLICATES:');
  console.log('========================');
  
  const coverageGroups: { [key: string]: TiffInfo[] } = {};
  
  for (const tiffInfo of tiffInfos) {
    const coverageKey = `${tiffInfo.bbox.minLng.toFixed(4)},${tiffInfo.bbox.minLat.toFixed(4)},${tiffInfo.bbox.maxLng.toFixed(4)},${tiffInfo.bbox.maxLat.toFixed(4)}`;
    
    if (!coverageGroups[coverageKey]) {
      coverageGroups[coverageKey] = [];
    }
    coverageGroups[coverageKey].push(tiffInfo);
  }

  for (const [coverage, files] of Object.entries(coverageGroups)) {
    if (files.length > 1) {
      console.log(`🔄 SAME COVERAGE GROUP (${coverage}):`);
      files.forEach((file, index) => {
        const isOriginal = index === 0;
        console.log(`   ${isOriginal ? '✅ KEEP' : '🗑️  REMOVE'}: ${file.filename} (${file.sizeMB.toFixed(1)} MB)`);
      });
      console.log('');
    }
  }

  // Summary
  console.log('📊 SUMMARY:');
  console.log('===========');
  console.log(`   - Total Boulder files: ${tiffInfos.length}`);
  console.log(`   - Duplicate files found: ${totalDuplicates}`);
  console.log(`   - Space that could be saved: ${totalDuplicateSizeMB.toFixed(1)} MB`);
  
  if (totalDuplicates > 0) {
    console.log('');
    console.log('💡 RECOMMENDATIONS:');
    console.log('   - Keep the first file in each duplicate group');
    console.log('   - Remove the duplicate files to save space');
    console.log('   - The AtomicTrailInserter will work with fewer files');
  } else {
    console.log('');
    console.log('✅ No duplicates found! All Boulder files are unique.');
  }
}

// Run the analysis
checkDuplicates().catch(console.error);
