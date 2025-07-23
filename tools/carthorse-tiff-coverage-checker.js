#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

// USGS 3DEP 1/3 arc-second DEM coverage
// Format: USGS_13_n{lat}w{lng}_{date}.tif
// Example: USGS_13_n40w105_20230602.tif

class TiffCoverageChecker {
  constructor() {
    this.tiffDir = path.join(process.cwd(), 'api-service', 'elevation-data');
    this.regionBboxes = {
      boulder: {
        minLng: -105.67025,
        maxLng: -105.16744,
        minLat: 39.78208,
        maxLat: 40.52739
      }
    };
  }

  // Get all TIFF files in the directory
  getExistingTiffs() {
    if (!fs.existsSync(this.tiffDir)) {
      console.log('📁 Creating TIFF directory...');
      fs.mkdirSync(this.tiffDir, { recursive: true });
      return [];
    }

    const files = fs.readdirSync(this.tiffDir)
      .filter(f => f.endsWith('.tif'))
      .map(f => this.parseTiffFilename(f))
      .filter(tiff => tiff !== null);

    console.log(`📁 Found ${files.length} existing TIFF files:`);
    files.forEach(tiff => {
      console.log(`   ${tiff.filename} - ${tiff.lat}°N, ${tiff.lng}°W`);
    });

    return files;
  }

  // Parse TIFF filename to extract coordinates
  parseTiffFilename(filename) {
    // Format: USGS_13_n{lat}w{lng}_{date}.tif
    const match = filename.match(/USGS_13_n(\d+)w(\d+)_(\d+)\.tif/);
    if (!match) return null;

    const lat = parseInt(match[1]);
    const lng = parseInt(match[2]);
    const date = match[3];

    return {
      filename,
      lat,
      lng,
      date,
      bbox: {
        minLat: lat,
        maxLat: lat + 1,
        minLng: -lng - 1,
        maxLng: -lng
      }
    };
  }

  // Calculate required TIFF files for a region
  calculateRequiredTiffs(regionKey) {
    const bbox = this.regionBboxes[regionKey];
    if (!bbox) {
      throw new Error(`Unknown region: ${regionKey}`);
    }

    console.log(`🗺️  Calculating required TIFF coverage for ${regionKey}:`);
    console.log(`   Bbox: ${bbox.minLng}°W to ${bbox.maxLng}°W, ${bbox.minLat}°N to ${bbox.maxLat}°N`);

    const requiredTiffs = [];
    
    // Calculate required latitude tiles
    const minLatTile = Math.floor(bbox.minLat);
    const maxLatTile = Math.floor(bbox.maxLat);
    
    // Calculate required longitude tiles
    const minLngTile = Math.floor(Math.abs(bbox.minLng));
    const maxLngTile = Math.floor(Math.abs(bbox.maxLng));

    console.log(`   Required tiles: ${minLatTile}°N to ${maxLatTile}°N, ${minLngTile}°W to ${maxLngTile}°W`);

    for (let lat = minLatTile; lat <= maxLatTile; lat++) {
      for (let lng = minLngTile; lng <= maxLngTile; lng++) {
        const filename = `USGS_13_n${lat}w${lng}_20230602.tif`;
        requiredTiffs.push({
          filename,
          lat,
          lng,
          bbox: {
            minLat: lat,
            maxLat: lat + 1,
            minLng: -lng - 1,
            maxLng: -lng
          }
        });
      }
    }

    console.log(`📋 Required TIFF files: ${requiredTiffs.length}`);
    requiredTiffs.forEach(tiff => {
      console.log(`   ${tiff.filename} - ${tiff.lat}°N, ${tiff.lng}°W`);
    });

    return requiredTiffs;
  }

  // Check which TIFF files are missing
  findMissingTiffs(regionKey) {
    const existing = this.getExistingTiffs();
    const required = this.calculateRequiredTiffs(regionKey);

    const missing = required.filter(requiredTiff => {
      return !existing.some(existingTiff => 
        existingTiff.lat === requiredTiff.lat && 
        existingTiff.lng === requiredTiff.lng
      );
    });

    console.log(`\n❌ Missing TIFF files: ${missing.length}`);
    missing.forEach(tiff => {
      console.log(`   ${tiff.filename} - ${tiff.lat}°N, ${tiff.lng}°W`);
    });

    return missing;
  }

  // Download TIFF file from USGS
  async downloadTiff(tiffInfo) {
    const { filename, lat, lng } = tiffInfo;
    
    // USGS 3DEP download URL format
    // https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/USGS_13_n{lat}w{lng}_{date}.tif
    const url = `https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/${filename}`;
    const filePath = path.join(this.tiffDir, filename);

    console.log(`⬇️  Downloading ${filename}...`);
    console.log(`   URL: ${url}`);

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(filePath);
      
      https.get(url, (response) => {
        if (response.statusCode === 200) {
          response.pipe(file);
          
          let downloadedBytes = 0;
          const totalBytes = parseInt(response.headers['content-length'] || '0');
          
          response.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (totalBytes > 0) {
              const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
              process.stdout.write(`\r   Progress: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(1)}MB)`);
            }
          });

          file.on('finish', () => {
            console.log(`\n✅ Downloaded ${filename} (${(downloadedBytes / 1024 / 1024).toFixed(1)}MB)`);
            resolve();
          });

          file.on('error', (err) => {
            fs.unlink(filePath, () => {}); // Delete partial file
            reject(err);
          });
        } else {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        }
      }).on('error', (err) => {
        reject(err);
      });
    });
  }

  // Download all missing TIFF files
  async downloadMissingTiffs(regionKey) {
    const missing = this.findMissingTiffs(regionKey);
    
    if (missing.length === 0) {
      console.log('✅ All required TIFF files are present!');
      return;
    }

    console.log(`\n⬇️  Downloading ${missing.length} missing TIFF files...`);
    
    for (let i = 0; i < missing.length; i++) {
      const tiff = missing[i];
      try {
        await this.downloadTiff(tiff);
        console.log(`   (${i + 1}/${missing.length}) ✅ ${tiff.filename}`);
      } catch (error) {
        console.error(`   (${i + 1}/${missing.length}) ❌ ${tiff.filename}: ${error.message}`);
      }
    }

    console.log('\n📊 Download summary:');
    const finalMissing = this.findMissingTiffs(regionKey);
    if (finalMissing.length === 0) {
      console.log('✅ All required TIFF files are now present!');
    } else {
      console.log(`❌ ${finalMissing.length} TIFF files still missing:`);
      finalMissing.forEach(tiff => {
        console.log(`   ${tiff.filename}`);
      });
    }
  }

  // Validate TIFF coverage for a region
  validateCoverage(regionKey) {
    const bbox = this.regionBboxes[regionKey];
    const existing = this.getExistingTiffs();
    
    console.log(`\n🔍 Validating TIFF coverage for ${regionKey}...`);
    console.log(`   Region bbox: ${bbox.minLng}°W to ${bbox.maxLng}°W, ${bbox.minLat}°N to ${bbox.maxLat}°N`);

    let covered = true;
    let coverageDetails = [];

    // Check if region is fully covered by existing TIFF files
    for (const tiff of existing) {
      const overlap = this.calculateOverlap(bbox, tiff.bbox);
      if (overlap > 0) {
        coverageDetails.push({
          tiff: tiff.filename,
          overlap: overlap,
          coverage: `${tiff.bbox.minLat}°N-${tiff.bbox.maxLat}°N, ${tiff.bbox.minLng}°W-${tiff.bbox.maxLng}°W`
        });
      }
    }

    if (coverageDetails.length === 0) {
      console.log('❌ No TIFF coverage found for this region!');
      covered = false;
    } else {
      console.log('📊 TIFF coverage found:');
      coverageDetails.forEach(detail => {
        console.log(`   ${detail.tiff}: ${detail.coverage} (${detail.overlap.toFixed(1)}% overlap)`);
      });
    }

    return covered;
  }

  // Calculate overlap percentage between two bounding boxes
  calculateOverlap(bbox1, bbox2) {
    const overlapLng = Math.max(0, 
      Math.min(bbox1.maxLng, bbox2.maxLng) - Math.max(bbox1.minLng, bbox2.minLng)
    );
    const overlapLat = Math.max(0,
      Math.min(bbox1.maxLat, bbox2.maxLat) - Math.max(bbox1.minLat, bbox2.minLat)
    );

    const area1 = (bbox1.maxLng - bbox1.minLng) * (bbox1.maxLat - bbox1.minLat);
    const overlapArea = overlapLng * overlapLat;

    return area1 > 0 ? (overlapArea / area1) * 100 : 0;
  }
}

// Main execution
async function main() {
  const checker = new TiffCoverageChecker();
  const region = process.argv[2] || 'boulder';

  console.log('🗻 USGS TIFF Coverage Checker');
  console.log('================================');

  try {
    // Check current coverage
    checker.validateCoverage(region);

    // Find and download missing TIFF files
    await checker.downloadMissingTiffs(region);

    // Final validation
    console.log('\n🔍 Final coverage validation:');
    const finalCoverage = checker.validateCoverage(region);
    
    if (finalCoverage) {
      console.log('\n✅ TIFF coverage is complete for this region!');
      process.exit(0);
    } else {
      console.log('\n❌ TIFF coverage is incomplete. Some elevation data may be missing.');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = TiffCoverageChecker; 