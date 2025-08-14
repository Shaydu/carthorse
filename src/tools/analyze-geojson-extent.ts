#!/usr/bin/env ts-node
import * as fs from 'fs';

interface GeoJSONFeature {
  type: 'Feature';
  properties: any;
  geometry: {
    type: string;
    coordinates: number[][];
  };
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

class GeoJSONAnalyzer {
  private geojson: GeoJSONCollection;

  constructor(filePath: string) {
    const data = fs.readFileSync(filePath, 'utf8');
    this.geojson = JSON.parse(data);
  }

  analyzeExtent(): {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
    featureCount: number;
    coordinateCount: number;
  } {
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let coordinateCount = 0;

    console.log(`📊 Analyzing ${this.geojson.features.length} features...`);

    for (const feature of this.geojson.features) {
      if (feature.geometry.type === 'LineString') {
        for (const [lng, lat] of feature.geometry.coordinates) {
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          coordinateCount++;
        }
      }
    }

    return {
      minLng,
      maxLng,
      minLat,
      maxLat,
      featureCount: this.geojson.features.length,
      coordinateCount
    };
  }

  analyzeCoordinateDistribution(): void {
    const lngs: number[] = [];
    const lats: number[] = [];

    for (const feature of this.geojson.features) {
      if (feature.geometry.type === 'LineString') {
        for (const [lng, lat] of feature.geometry.coordinates) {
          lngs.push(lng);
          lats.push(lat);
        }
      }
    }

    // Find most common longitude ranges
    const lngRanges = new Map<string, number>();
    for (const lng of lngs) {
      const range = Math.floor(lng);
      const key = `${range}°W to ${range + 1}°W`;
      lngRanges.set(key, (lngRanges.get(key) || 0) + 1);
    }

    // Find most common latitude ranges
    const latRanges = new Map<string, number>();
    for (const lat of lats) {
      const range = Math.floor(lat);
      const key = `${range}°N to ${range + 1}°N`;
      latRanges.set(key, (latRanges.get(key) || 0) + 1);
    }

    console.log('\n🎯 Coordinate Distribution:');
    console.log('Longitude ranges (most common):');
    Array.from(lngRanges.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([range, count]) => {
        console.log(`   ${range}: ${count} coordinates`);
      });

    console.log('\nLatitude ranges (most common):');
    Array.from(latRanges.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([range, count]) => {
        console.log(`   ${range}: ${count} coordinates`);
      });
  }

  findTrailsOutsideBounds(tiffBounds: { minLng: number; maxLng: number; minLat: number; maxLat: number }): string[] {
    const outsideTrails: string[] = [];

    for (const feature of this.geojson.features) {
      if (feature.geometry.type === 'LineString') {
        let hasPointOutside = false;
        
        for (const [lng, lat] of feature.geometry.coordinates) {
          if (lng < tiffBounds.minLng || lng > tiffBounds.maxLng || 
              lat < tiffBounds.minLat || lat > tiffBounds.maxLat) {
            hasPointOutside = true;
            break;
          }
        }

        if (hasPointOutside) {
          const name = feature.properties.name || `Trail ${feature.properties.OBJECTID}`;
          outsideTrails.push(name);
        }
      }
    }

    return outsideTrails;
  }
}

async function main(): Promise<void> {
  const geojsonPath = '/Users/shaydu/dev/carthorse/COTREX_Trails.geojson';
  
  if (!fs.existsSync(geojsonPath)) {
    console.error(`❌ GeoJSON file not found: ${geojsonPath}`);
    process.exit(1);
  }

  console.log('🗺️  GeoJSON Extent Analysis');
  console.log('===========================');

  const analyzer = new GeoJSONAnalyzer(geojsonPath);
  const extent = analyzer.analyzeExtent();

  console.log('\n📊 GeoJSON Extent:');
  console.log(`   Longitude: ${extent.minLng.toFixed(3)}°W to ${extent.maxLng.toFixed(3)}°W`);
  console.log(`   Latitude:  ${extent.minLat.toFixed(3)}°N to ${extent.maxLat.toFixed(3)}°N`);
  console.log(`   Features:  ${extent.featureCount}`);
  console.log(`   Coordinates: ${extent.coordinateCount}`);

  analyzer.analyzeCoordinateDistribution();

  // Compare with TIFF coverage (approximate based on available files)
  const tiffBounds = {
    minLng: -106.0, // Based on available TIFF files
    maxLng: -105.0,
    minLat: 39.0,
    maxLat: 41.0
  };

  console.log('\n🗻 TIFF Coverage (Available):');
  console.log(`   Longitude: ${tiffBounds.minLng.toFixed(3)}°W to ${tiffBounds.maxLng.toFixed(3)}°W`);
  console.log(`   Latitude:  ${tiffBounds.minLat.toFixed(3)}°N to ${tiffBounds.maxLat.toFixed(3)}°N`);

  const outsideTrails = analyzer.findTrailsOutsideBounds(tiffBounds);
  
  console.log('\n❌ Trails Outside TIFF Coverage:');
  if (outsideTrails.length === 0) {
    console.log('   ✅ All trails are within TIFF coverage');
  } else {
    console.log(`   ${outsideTrails.length} trails have coordinates outside TIFF coverage:`);
    outsideTrails.slice(0, 20).forEach(trail => {
      console.log(`   - ${trail}`);
    });
    if (outsideTrails.length > 20) {
      console.log(`   ... and ${outsideTrails.length - 20} more`);
    }
  }

  // Calculate coverage gaps
  const westernGap = tiffBounds.minLng - extent.minLng;
  const easternGap = extent.maxLng - tiffBounds.maxLng;
  const southernGap = tiffBounds.minLat - extent.minLat;
  const northernGap = extent.maxLat - tiffBounds.maxLat;

  console.log('\n📋 Coverage Gap Analysis:');
  if (westernGap > 0) {
    console.log(`   Western gap: ${westernGap.toFixed(3)}° (${extent.minLng.toFixed(3)}°W to ${tiffBounds.minLng.toFixed(3)}°W)`);
  }
  if (easternGap > 0) {
    console.log(`   Eastern gap: ${easternGap.toFixed(3)}° (${tiffBounds.maxLng.toFixed(3)}°W to ${extent.maxLng.toFixed(3)}°W)`);
  }
  if (southernGap > 0) {
    console.log(`   Southern gap: ${southernGap.toFixed(3)}° (${extent.minLat.toFixed(3)}°N to ${tiffBounds.minLat.toFixed(3)}°N)`);
  }
  if (northernGap > 0) {
    console.log(`   Northern gap: ${northernGap.toFixed(3)}° (${tiffBounds.maxLat.toFixed(3)}°N to ${extent.maxLat.toFixed(3)}°N)`);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
