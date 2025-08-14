#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';
import { fromArrayBuffer } from 'geotiff';

// Boulder region bounds
const BOULDER_BOUNDS = {
  minLng: -105.81,
  maxLng: -105.13,
  minLat: 39.74,
  maxLat: 40.69
};

interface TiffInfo {
  filename: string;
  filePath: string;
  bbox: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
  overlapsBoulder: boolean;
  sizeMB: number;
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

function overlapsBoulder(bbox: any): boolean {
  return !(
    bbox.maxLng < BOULDER_BOUNDS.minLng ||
    bbox.minLng > BOULDER_BOUNDS.maxLng ||
    bbox.maxLat < BOULDER_BOUNDS.minLat ||
    bbox.minLat > BOULDER_BOUNDS.maxLat
  );
}

async function analyzeTiffFiles(): Promise<void> {
  const tiffDir = process.env.ELEVATION_TIFF_DIR || '/Users/shaydu/dev/TIFFS';
  console.log(`🔍 Analyzing TIFF files in: ${tiffDir}`);
  console.log(`📍 Boulder region bounds: ${BOULDER_BOUNDS.minLng}°W to ${BOULDER_BOUNDS.maxLng}°W, ${BOULDER_BOUNDS.minLat}°N to ${BOULDER_BOUNDS.maxLat}°N`);
  console.log('');

  if (!fs.existsSync(tiffDir)) {
    console.error('❌ TIFF directory not found!');
    return;
  }

  const files = fs.readdirSync(tiffDir).filter(f => f.endsWith('.tif'));
  console.log(`📁 Found ${files.length} TIFF files`);
  console.log('');

  const tiffInfos: TiffInfo[] = [];
  let totalSizeMB = 0;
  let boulderSizeMB = 0;

  for (const file of files) {
    try {
      const filePath = path.join(tiffDir, file);
      const stats = fs.statSync(filePath);
      const sizeMB = stats.size / (1024 * 1024);
      totalSizeMB += sizeMB;

      console.log(`📖 Analyzing ${file} (${sizeMB.toFixed(1)} MB)...`);
      
      const nodeBuffer = fs.readFileSync(filePath);
      const arrayBuffer = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength);
      const tiff = await fromArrayBuffer(arrayBuffer);
      const image = await tiff.getImage();
      
      const bbox = await getTiffBBox(image);
      const overlaps = overlapsBoulder(bbox);
      
      if (overlaps) {
        boulderSizeMB += sizeMB;
      }

      tiffInfos.push({
        filename: file,
        filePath,
        bbox,
        overlapsBoulder: overlaps,
        sizeMB
      });

      console.log(`   Coverage: ${bbox.minLng.toFixed(4)}°W to ${bbox.maxLng.toFixed(4)}°W, ${bbox.minLat.toFixed(4)}°N to ${bbox.maxLat.toFixed(4)}°N`);
      console.log(`   Overlaps Boulder: ${overlaps ? '✅ YES' : '❌ NO'}`);
      console.log('');

    } catch (error) {
      console.error(`❌ Failed to analyze ${file}:`, error);
      console.log('');
    }
  }

  // Summary
  console.log('📊 ANALYSIS SUMMARY:');
  console.log('====================');
  
  const neededFiles = tiffInfos.filter(t => t.overlapsBoulder);
  const unneededFiles = tiffInfos.filter(t => !t.overlapsBoulder);

  console.log(`✅ Files needed for Boulder: ${neededFiles.length}`);
  neededFiles.forEach(t => {
    console.log(`   - ${t.filename} (${t.sizeMB.toFixed(1)} MB)`);
  });

  console.log('');
  console.log(`❌ Files NOT needed for Boulder: ${unneededFiles.length}`);
  unneededFiles.forEach(t => {
    console.log(`   - ${t.filename} (${t.sizeMB.toFixed(1)} MB)`);
  });

  console.log('');
  console.log(`💾 Size summary:`);
  console.log(`   - Total size: ${totalSizeMB.toFixed(1)} MB`);
  console.log(`   - Boulder files: ${boulderSizeMB.toFixed(1)} MB`);
  console.log(`   - Unneeded files: ${(totalSizeMB - boulderSizeMB).toFixed(1)} MB`);
  console.log(`   - Space saved: ${((totalSizeMB - boulderSizeMB) / totalSizeMB * 100).toFixed(1)}%`);

  // Check for missing coverage
  console.log('');
  console.log('🔍 COVERAGE ANALYSIS:');
  console.log('====================');
  
  if (neededFiles.length === 0) {
    console.log('❌ NO TIFF files overlap with Boulder region!');
    console.log('   You need to download TIFF files that cover:');
    console.log(`   - Longitude: ${BOULDER_BOUNDS.minLng}°W to ${BOULDER_BOUNDS.maxLng}°W`);
    console.log(`   - Latitude: ${BOULDER_BOUNDS.minLat}°N to ${BOULDER_BOUNDS.maxLat}°N`);
  } else {
    const minLng = Math.min(...neededFiles.map(t => t.bbox.minLng));
    const maxLng = Math.max(...neededFiles.map(t => t.bbox.maxLng));
    const minLat = Math.min(...neededFiles.map(t => t.bbox.minLat));
    const maxLat = Math.max(...neededFiles.map(t => t.bbox.maxLat));

    console.log(`✅ Boulder coverage from TIFF files:`);
    console.log(`   - Longitude: ${minLng.toFixed(4)}°W to ${maxLng.toFixed(4)}°W`);
    console.log(`   - Latitude: ${minLat.toFixed(4)}°N to ${maxLat.toFixed(4)}°N`);

    // Check for gaps
    if (minLng > BOULDER_BOUNDS.minLng) {
      console.log(`⚠️  Missing western coverage: ${BOULDER_BOUNDS.minLng}°W to ${minLng.toFixed(4)}°W`);
    }
    if (maxLng < BOULDER_BOUNDS.maxLng) {
      console.log(`⚠️  Missing eastern coverage: ${maxLng.toFixed(4)}°W to ${BOULDER_BOUNDS.maxLng}°W`);
    }
    if (minLat > BOULDER_BOUNDS.minLat) {
      console.log(`⚠️  Missing southern coverage: ${BOULDER_BOUNDS.minLat}°N to ${minLat.toFixed(4)}°N`);
    }
    if (maxLat < BOULDER_BOUNDS.maxLat) {
      console.log(`⚠️  Missing northern coverage: ${maxLat.toFixed(4)}°N to ${BOULDER_BOUNDS.maxLat}°N`);
    }
  }
}

// Run the analysis
analyzeTiffFiles().catch(console.error);
