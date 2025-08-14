#!/usr/bin/env node
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface CPWFeature {
  attributes: {
    OBJECTID: number;
    TRAIL_NAME: string;
    TRAIL_TYPE: string;
    SURFACE: string;
    DIFFICULTY: string;
    LENGTH_MILES: number;
    ELEVATION_GAIN: number;
    ELEVATION_LOSS: number;
    MAX_ELEVATION: number;
    MIN_ELEVATION: number;
    REGION: string;
    [key: string]: any;
  };
  geometry: {
    paths: number[][][]; // 3D coordinates [lng, lat, elevation]
  };
}

interface CPWResponse {
  features: CPWFeature[];
  exceededTransferLimit?: boolean;
}

interface GeoJSONFeature {
  type: 'Feature';
  properties: {
    cpw_objectid: number;
    name: string;
    trail_type: string;
    surface: string;
    difficulty: string;
    length_miles: number;
    length_km: number;
    elevation_gain_ft: number;
    elevation_gain_m: number;
    elevation_loss_ft: number;
    elevation_loss_m: number;
    max_elevation_ft: number;
    max_elevation_m: number;
    min_elevation_ft: number;
    min_elevation_m: number;
    region: string;
    source: string;
    [key: string]: any;
  };
  geometry: {
    type: 'LineString';
    coordinates: number[][]; // 3D coordinates [lng, lat, elevation]
  };
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

class CPWGeoJSONDownloader {
  private readonly baseUrl = 'https://services.arcgis.com/Il8dzHtQyBAJ2Isa/arcgis/rest/services/CPWAdminData/FeatureServer/0';
  private readonly outputDir = 'data/cpw';
  private readonly batchSize = 1000;
  private readonly delayMs = 100; // Rate limiting

  constructor() {
    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async downloadAllAsGeoJSON(): Promise<void> {
    console.log('🗺️ Starting CPW GeoJSON download...');
    
    try {
      // Step 1: Get total feature count
      const totalFeatures = await this.getTotalFeatureCount();
      console.log(`📊 Total CPW features: ${totalFeatures.toLocaleString()}`);
      
      // Step 2: Download all features in batches
      const allFeatures: GeoJSONFeature[] = [];
      let processed = 0;
      
      for (let offset = 0; offset < totalFeatures; offset += this.batchSize) {
        const batch = await this.downloadBatch(offset, this.batchSize);
        allFeatures.push(...batch);
        
        processed += batch.length;
        console.log(`📥 Downloaded batch: ${processed}/${totalFeatures} features (${((processed/totalFeatures)*100).toFixed(1)}%)`);
        
        // Rate limiting
        if (offset + this.batchSize < totalFeatures) {
          await this.sleep(this.delayMs);
        }
      }
      
      // Step 3: Create GeoJSON collection
      const geojson: GeoJSONCollection = {
        type: 'FeatureCollection',
        features: allFeatures
      };
      
      // Step 4: Save to file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `cpw-trails-${timestamp}.geojson`;
      const filepath = path.join(this.outputDir, filename);
      
      fs.writeFileSync(filepath, JSON.stringify(geojson, null, 2));
      
      // Step 5: Create a symlink to latest
      const latestPath = path.join(this.outputDir, 'cpw-trails-latest.geojson');
      if (fs.existsSync(latestPath)) {
        fs.unlinkSync(latestPath);
      }
      fs.symlinkSync(filename, latestPath);
      
      // Step 6: Generate summary
      await this.generateSummary(allFeatures, filepath);
      
      console.log(`✅ CPW GeoJSON download complete!`);
      console.log(`📁 Saved to: ${filepath}`);
      console.log(`🔗 Latest symlink: ${latestPath}`);
      
    } catch (error) {
      console.error('❌ CPW GeoJSON download failed:', error);
      throw error;
    }
  }

  private async getTotalFeatureCount(): Promise<number> {
    console.log('🔍 Getting total feature count...');
    
    const response = await axios.get(`${this.baseUrl}/query`, {
      params: {
        where: '1=1',
        returnCountOnly: true,
        f: 'json'
      },
      timeout: 30000
    });
    
    return response.data.count;
  }

  private async downloadBatch(offset: number, limit: number): Promise<GeoJSONFeature[]> {
    const response = await axios.get(`${this.baseUrl}/query`, {
      params: {
        where: '1=1',
        outFields: '*',
        returnGeometry: true,
        geometryType: 'esriGeometryPolyline',
        spatialRel: 'esriSpatialRelIntersects',
        resultOffset: offset,
        resultRecordCount: limit,
        f: 'json'
      },
      timeout: 60000
    });
    
    const data: CPWResponse = response.data;
    
    if (!data.features) {
      console.warn(`⚠️ No features returned for batch offset=${offset}, limit=${limit}`);
      return [];
    }
    
    return data.features.map(feature => this.convertToGeoJSON(feature));
  }

  private convertToGeoJSON(cpwFeature: CPWFeature): GeoJSONFeature {
    const attrs = cpwFeature.attributes;
    
    // Convert miles to kilometers
    const lengthKm = (attrs.LENGTH_MILES || 0) * 1.60934;
    
    // Convert feet to meters
    const elevationGainM = (attrs.ELEVATION_GAIN || 0) * 0.3048;
    const elevationLossM = (attrs.ELEVATION_LOSS || 0) * 0.3048;
    const maxElevationM = (attrs.MAX_ELEVATION || 0) * 0.3048;
    const minElevationM = (attrs.MIN_ELEVATION || 0) * 0.3048;
    
    // Convert geometry from ArcGIS paths to GeoJSON LineString
    const coordinates = this.convertGeometry(cpwFeature.geometry);
    
    return {
      type: 'Feature',
      properties: {
        cpw_objectid: attrs.OBJECTID,
        name: attrs.TRAIL_NAME || 'Unnamed Trail',
        trail_type: attrs.TRAIL_TYPE || null,
        surface: attrs.SURFACE || null,
        difficulty: attrs.DIFFICULTY || null,
        length_miles: attrs.LENGTH_MILES || 0,
        length_km: lengthKm,
        elevation_gain_ft: attrs.ELEVATION_GAIN || 0,
        elevation_gain_m: elevationGainM,
        elevation_loss_ft: attrs.ELEVATION_LOSS || 0,
        elevation_loss_m: elevationLossM,
        max_elevation_ft: attrs.MAX_ELEVATION || 0,
        max_elevation_m: maxElevationM,
        min_elevation_ft: attrs.MIN_ELEVATION || 0,
        min_elevation_m: minElevationM,
        region: attrs.REGION || 'colorado',
        source: 'cpw',
        // Include all other attributes
        ...attrs
      },
      geometry: {
        type: 'LineString',
        coordinates: coordinates
      }
    };
  }

  private convertGeometry(arcgisGeometry: any): number[][] {
    if (!arcgisGeometry.paths || !arcgisGeometry.paths.length) {
      console.warn('⚠️ No geometry paths found');
      return [];
    }
    
    // ArcGIS paths are arrays of coordinate arrays
    // We'll take the first path (most trails should have one path)
    const path = arcgisGeometry.paths[0];
    
    if (!path || !path.length) {
      console.warn('⚠️ Empty geometry path');
      return [];
    }
    
    // Convert ArcGIS coordinates to GeoJSON format
    // ArcGIS: [x, y, z] where x=lng, y=lat
    // GeoJSON: [lng, lat, elevation]
    return path.map((coord: number[]) => {
      if (coord.length >= 3) {
        return [coord[0], coord[1], coord[2]]; // [lng, lat, elevation]
      } else if (coord.length === 2) {
        return [coord[0], coord[1], 0]; // [lng, lat, 0] - no elevation
      } else {
        console.warn('⚠️ Invalid coordinate:', coord);
        return [0, 0, 0];
      }
    });
  }

  private async generateSummary(features: GeoJSONFeature[], filepath: string): Promise<void> {
    console.log('📊 Generating summary...');
    
    const stats = {
      totalTrails: features.length,
      totalLengthKm: 0,
      totalLengthMiles: 0,
      regions: new Set<string>(),
      trailTypes: new Set<string>(),
      surfaces: new Set<string>(),
      difficulties: new Set<string>(),
      hasElevation: 0,
      hasGeometry: 0
    };
    
    for (const feature of features) {
      const props = feature.properties;
      
      stats.totalLengthKm += props.length_km || 0;
      stats.totalLengthMiles += props.length_miles || 0;
      
      if (props.region) stats.regions.add(props.region);
      if (props.trail_type) stats.trailTypes.add(props.trail_type);
      if (props.surface) stats.surfaces.add(props.surface);
      if (props.difficulty) stats.difficulties.add(props.difficulty);
      
      if (props.max_elevation_m || props.min_elevation_m) stats.hasElevation++;
      if (feature.geometry.coordinates.length > 0) stats.hasGeometry++;
    }
    
    const summary = {
      downloadDate: new Date().toISOString(),
      filepath: filepath,
      fileSizeMB: (fs.statSync(filepath).size / (1024 * 1024)).toFixed(2),
      stats: {
        totalTrails: stats.totalTrails,
        totalLengthKm: stats.totalLengthKm.toFixed(1),
        totalLengthMiles: stats.totalLengthMiles.toFixed(1),
        regions: Array.from(stats.regions).sort(),
        trailTypes: Array.from(stats.trailTypes).sort(),
        surfaces: Array.from(stats.surfaces).sort(),
        difficulties: Array.from(stats.difficulties).sort(),
        hasElevation: stats.hasElevation,
        hasGeometry: stats.hasGeometry,
        elevationPercentage: ((stats.hasElevation / stats.totalTrails) * 100).toFixed(1) + '%',
        geometryPercentage: ((stats.hasGeometry / stats.totalTrails) * 100).toFixed(1) + '%'
      }
    };
    
    // Save summary to JSON file
    const summaryPath = filepath.replace('.geojson', '-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    
    console.log('📊 Summary:');
    console.log(`   🛤️ Total trails: ${summary.stats.totalTrails.toLocaleString()}`);
    console.log(`   📏 Total length: ${summary.stats.totalLengthKm} km (${summary.stats.totalLengthMiles} miles)`);
    console.log(`   🏔️ With elevation: ${summary.stats.hasElevation} (${summary.stats.elevationPercentage})`);
    console.log(`   📍 With geometry: ${summary.stats.hasGeometry} (${summary.stats.geometryPercentage})`);
    console.log(`   📁 File size: ${summary.fileSizeMB} MB`);
    console.log(`   📋 Summary saved to: ${summaryPath}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

async function main(): Promise<void> {
  console.log('🗺️ CPW GeoJSON Downloader');
  console.log('========================');
  
  const downloader = new CPWGeoJSONDownloader();
  await downloader.downloadAllAsGeoJSON();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Download failed:', error);
    process.exit(1);
  });
}
