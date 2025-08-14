#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';
import { fromArrayBuffer } from 'geotiff';

// Test coordinates in the Boulder area
const TEST_COORDINATES = [
  [-105.298009722323, 40.0196745561583], // From the debug output
  [-105.296300988828, 40.0209852092569], // From the debug output
  [-105.294163250754, 40.0343628884152], // From the debug output
  [-105.29, 40.02], // Simplified test coordinate
  [-105.30, 40.02], // Another test coordinate
];

async function testTiffElevation(): Promise<void> {
  const tiffDir = process.env.ELEVATION_TIFF_DIR || '/Users/shaydu/dev/TIFFS';
  
  console.log('🧪 Testing TIFF Elevation Data');
  console.log('================================');
  console.log(`📁 TIFF Directory: ${tiffDir}`);
  console.log('');

  // Get all TIFF files
  const tiffFiles = fs.readdirSync(tiffDir).filter(file => file.endsWith('.tif'));
  console.log(`📁 Found ${tiffFiles.length} TIFF files: ${tiffFiles.join(', ')}`);
  console.log('');

  for (const coord of TEST_COORDINATES) {
    const [lng, lat] = coord;
    console.log(`📍 Testing coordinate: [${lng}, ${lat}]`);
    
    let foundInAnyTiff = false;
    
    for (const tiffFile of tiffFiles) {
      const tiffPath = path.join(tiffDir, tiffFile);
      
      try {
        const tiffData = fs.readFileSync(tiffPath);
        const tiff = await fromArrayBuffer(tiffData.buffer);
        const image = await tiff.getImage();
        const bbox = image.getBoundingBox();
        
        // Check if coordinate is within TIFF bounds
        const [minX, minY, maxX, maxY] = bbox;
        
        // Convert from Web Mercator to WGS84 if needed
        const isWebMercator = Math.abs(minX) > 1000 || Math.abs(minY) > 1000;
        let tiffMinLng, tiffMaxLng, tiffMinLat, tiffMaxLat;
        
        if (isWebMercator) {
          // Convert from Web Mercator to WGS84
          tiffMinLng = (minX / 20037508.34) * 180;
          tiffMaxLng = (maxX / 20037508.34) * 180;
          tiffMinLat = (Math.atan(Math.exp(minY * Math.PI / 20037508.34)) * 2 - Math.PI / 2) * 180 / Math.PI;
          tiffMaxLat = (Math.atan(Math.exp(maxY * Math.PI / 20037508.34)) * 2 - Math.PI / 2) * 180 / Math.PI;
        } else {
          tiffMinLng = minX;
          tiffMaxLng = maxX;
          tiffMinLat = minY;
          tiffMaxLat = maxY;
        }
        
        const inBounds = lng >= tiffMinLng && lng <= tiffMaxLng && lat >= tiffMinLat && lat <= tiffMaxLat;
        
        if (inBounds) {
          console.log(`   ✅ Found in ${tiffFile}: ${tiffMinLng.toFixed(6)}°W to ${tiffMaxLng.toFixed(6)}°W, ${tiffMinLat.toFixed(6)}°N to ${tiffMaxLat.toFixed(6)}°N`);
          foundInAnyTiff = true;
          
          // Try to get elevation data
          try {
            const width = image.getWidth();
            const height = image.getHeight();
            const rasters = await image.readRasters();
            const elevationData = rasters[0];
            
            console.log(`   📊 TIFF dimensions: ${width}x${height}, has elevation data: ${elevationData ? 'YES' : 'NO'}`);
            
                         if (elevationData && Array.isArray(elevationData)) {
               // Calculate pixel coordinates
               const pixelX = Math.floor(((lng - tiffMinLng) / (tiffMaxLng - tiffMinLng)) * width);
               const pixelY = Math.floor(((lat - tiffMinLat) / (tiffMaxLat - tiffMinLat)) * height);
               
               if (pixelX >= 0 && pixelX < width && pixelY >= 0 && pixelY < height) {
                 const elevation = elevationData[pixelY * width + pixelX];
                 console.log(`   🗻 Elevation at [${lng}, ${lat}]: ${elevation !== undefined ? elevation : 'NO DATA'}`);
               } else {
                 console.log(`   ❌ Pixel coordinates out of bounds: [${pixelX}, ${pixelY}]`);
               }
             }
          } catch (elevationError) {
            console.log(`   ❌ Error reading elevation data: ${elevationError}`);
          }
        } else {
          console.log(`   ❌ Not in ${tiffFile}: ${tiffMinLng.toFixed(6)}°W to ${tiffMaxLng.toFixed(6)}°W, ${tiffMinLat.toFixed(6)}°N to ${tiffMaxLat.toFixed(6)}°N`);
        }
        
      } catch (error) {
        console.log(`   ❌ Error reading ${tiffFile}: ${error}`);
      }
    }
    
    if (!foundInAnyTiff) {
      console.log(`   ⚠️  Coordinate [${lng}, ${lat}] not found in ANY TIFF file!`);
    }
    
    console.log('');
  }
}

// Run the test
if (require.main === module) {
  testTiffElevation().catch(console.error);
}
