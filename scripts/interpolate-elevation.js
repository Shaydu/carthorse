#!/usr/bin/env node

/**
 * Elevation Interpolation Script
 * 
 * This script reads a GeoJSON file and interpolates missing elevation data
 * by averaging the nearest neighbors for each point with zero or invalid elevation.
 */

const fs = require('fs');
const path = require('path');

function interpolateElevation(geojson) {
  let interpolatedCount = 0;
  let totalPoints = 0;
  
  geojson.features.forEach(feature => {
    if (feature.geometry && feature.geometry.coordinates) {
      const coords = feature.geometry.coordinates;
      
      // Handle both LineString and MultiLineString
      const coordinateArrays = feature.geometry.type === 'MultiLineString' ? coords : [coords];
      
      coordinateArrays.forEach(coordArray => {
        totalPoints += coordArray.length;
        
        // Find points with zero or invalid elevation
        const zeroElevationIndices = [];
        coordArray.forEach((point, index) => {
          if (point.length >= 3 && (point[2] === 0 || point[2] === null || point[2] === undefined)) {
            zeroElevationIndices.push(index);
          }
        });
        
        // Interpolate missing elevations
        zeroElevationIndices.forEach(index => {
          const interpolatedElevation = interpolatePointElevation(coordArray, index);
          if (interpolatedElevation !== null) {
            coordArray[index][2] = interpolatedElevation;
            interpolatedCount++;
          }
        });
      });
    }
  });
  
  console.log(`✅ Interpolated ${interpolatedCount} points out of ${totalPoints} total points`);
  return geojson;
}

function interpolatePointElevation(coords, index) {
  const point = coords[index];
  const validElevations = [];
  
  // Look for valid elevations in nearby points (within 5 points)
  const searchRadius = 5;
  const startIndex = Math.max(0, index - searchRadius);
  const endIndex = Math.min(coords.length - 1, index + searchRadius);
  
  for (let i = startIndex; i <= endIndex; i++) {
    if (i !== index && coords[i].length >= 3) {
      const elevation = coords[i][2];
      if (elevation && elevation > 0 && elevation < 5000) { // Reasonable elevation range for Colorado
        validElevations.push(elevation);
      }
    }
  }
  
  if (validElevations.length === 0) {
    // If no nearby valid elevations, try a larger radius
    for (let i = 0; i < coords.length; i++) {
      if (i !== index && coords[i].length >= 3) {
        const elevation = coords[i][2];
        if (elevation && elevation > 0 && elevation < 5000) {
          validElevations.push(elevation);
        }
      }
    }
  }
  
  if (validElevations.length > 0) {
    // Calculate weighted average (closer points have more weight)
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (let i = startIndex; i <= endIndex; i++) {
      if (i !== index && coords[i].length >= 3) {
        const elevation = coords[i][2];
        if (elevation && elevation > 0 && elevation < 5000) {
          const distance = Math.abs(i - index);
          const weight = 1 / (distance + 1); // Weight decreases with distance
          weightedSum += elevation * weight;
          totalWeight += weight;
        }
      }
    }
    
    return totalWeight > 0 ? weightedSum / totalWeight : null;
  }
  
  return null;
}

function recalculateElevationStats(geojson) {
  geojson.features.forEach(feature => {
    if (feature.properties && feature.geometry && feature.geometry.coordinates) {
      const coords = feature.geometry.coordinates;
      const coordinateArrays = feature.geometry.type === 'MultiLineString' ? coords : [coords];
      
      let allElevations = [];
      coordinateArrays.forEach(coordArray => {
        coordArray.forEach(point => {
          if (point.length >= 3 && point[2] > 0) {
            allElevations.push(point[2]);
          }
        });
      });
      
      if (allElevations.length > 0) {
        allElevations.sort((a, b) => a - b);
        
        const minElevation = allElevations[0];
        const maxElevation = allElevations[allElevations.length - 1];
        const avgElevation = allElevations.reduce((sum, elev) => sum + elev, 0) / allElevations.length;
        
        // Calculate elevation gain/loss
        let elevationGain = 0;
        let elevationLoss = 0;
        
        coordinateArrays.forEach(coordArray => {
          for (let i = 1; i < coordArray.length; i++) {
            const prevElev = coordArray[i-1][2];
            const currElev = coordArray[i][2];
            
            if (prevElev && currElev && prevElev > 0 && currElev > 0) {
              const diff = currElev - prevElev;
              if (diff > 0) {
                elevationGain += diff;
              } else {
                elevationLoss += Math.abs(diff);
              }
            }
          }
        });
        
        // Update properties
        feature.properties.min_elevation = minElevation;
        feature.properties.max_elevation = maxElevation;
        feature.properties.avg_elevation = avgElevation;
        feature.properties.elevation_gain = elevationGain;
        feature.properties.elevation_loss = elevationLoss;
      }
    }
  });
}

function main() {
  const inputFile = process.argv[2];
  const outputFile = process.argv[3] || inputFile.replace('.geojson', '-interpolated.geojson');
  
  if (!inputFile) {
    console.error('Usage: node interpolate-elevation.js <input.geojson> [output.geojson]');
    process.exit(1);
  }
  
  if (!fs.existsSync(inputFile)) {
    console.error(`Error: Input file ${inputFile} not found`);
    process.exit(1);
  }
  
  console.log(`📖 Reading GeoJSON from ${inputFile}...`);
  const geojson = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  
  console.log(`🔄 Interpolating missing elevation data...`);
  const interpolated = interpolateElevation(geojson);
  
  console.log(`📊 Recalculating elevation statistics...`);
  recalculateElevationStats(interpolated);
  
  console.log(`💾 Writing interpolated GeoJSON to ${outputFile}...`);
  fs.writeFileSync(outputFile, JSON.stringify(interpolated, null, 2));
  
  console.log(`✅ Elevation interpolation complete!`);
  console.log(`   Input: ${inputFile}`);
  console.log(`   Output: ${outputFile}`);
}

if (require.main === module) {
  main();
}

module.exports = { interpolateElevation, recalculateElevationStats };
