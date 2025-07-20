#!/usr/bin/env ts-node
/**
 * OSM Extract Reader for Trail Data Processing
 * 
 * This module reads OSM data from local .osm.pbf files instead of querying Overpass API.
 * It uses osmium-tool to convert PBF to GeoJSON, then parses the GeoJSON file.
 * It applies the same filtering criteria as the original Overpass queries to extract
 * relevant trail data for processing.
 * 
 * Usage:
 *   const reader = new OSMExtractReader('/path/to/region.osm.pbf');
 *   const trails = await reader.extractTrails();
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { TrailInsertData } from './carthorse-postgres-atomic-insert';

interface GeoJSONFeature {
  type: 'Feature';
  properties: Record<string, any>;
  geometry: {
    type: 'LineString' | 'MultiLineString';
    coordinates: Array<[number, number]> | Array<Array<[number, number]>>;
  };
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

interface TrailWay {
  id: number;
  name: string;
  trail_type: string;
  surface: string;
  difficulty: string;
  coordinates: Array<[number, number]>; // [lon, lat]
  source_tags: Record<string, string>;
}

export class OSMExtractReader {
  constructor(private osmFilePath: string) {}

  /**
   * Extract trail data from OSM .pbf file
   */
  async extractTrails(): Promise<TrailInsertData[]> {
    console.log(`📖 Reading OSM extract: ${this.osmFilePath}`);
    
    if (!fs.existsSync(this.osmFilePath)) {
      throw new Error(`OSM extract file not found: ${this.osmFilePath}`);
    }

    // Convert PBF to GeoJSON using osmium
    const geojsonPath = await this.convertPBFToGeoJSON();
    
    // Parse GeoJSON and extract trail data
    const trailWays = await this.parseGeoJSONForTrails(geojsonPath);
    
    // Convert to TrailInsertData format
    const trailData = trailWays.map(way => this.convertToTrailInsertData(way));
    
    console.log(`✅ Extracted ${trailData.length} trails from OSM extract`);
    return trailData.filter(trail => trail !== null) as TrailInsertData[];
  }

  /**
   * Convert OSM PBF to GeoJSON using osmium
   */
  private async convertPBFToGeoJSON(): Promise<string> {
    console.log('🔄 Converting OSM PBF to GeoJSON...');
    
    const outputPath = this.osmFilePath.replace('.osm.pbf', '.geojson');
    
    try {
      // Use osmium to convert PBF to GeoJSON
      // Filter for ways only (no nodes, no relations) and extract geometry
      const command = `osmium export "${this.osmFilePath}" --output-format=geojson --output="${outputPath}"`;
      
      console.log(`Running: ${command}`);
      execSync(command, { stdio: 'inherit' });
      
      console.log(`✅ Converted to: ${outputPath}`);
      return outputPath;
      
    } catch (error) {
      console.error('❌ Error converting PBF to GeoJSON:', error);
      throw new Error(`Failed to convert PBF to GeoJSON: ${error}`);
    }
  }

  /**
   * Parse GeoJSON file and extract trail data
   */
  private async parseGeoJSONForTrails(geojsonPath: string): Promise<TrailWay[]> {
    console.log('🔍 Parsing GeoJSON for trail data...');
    
    if (!fs.existsSync(geojsonPath)) {
      throw new Error(`GeoJSON file not found: ${geojsonPath}`);
    }
    
    const geojsonContent = fs.readFileSync(geojsonPath, 'utf8');
    const geojson: GeoJSONCollection = JSON.parse(geojsonContent);
    
    console.log(`📊 Found ${geojson.features.length} features in GeoJSON`);
    
    const trailWays: TrailWay[] = [];
    
    for (const feature of geojson.features) {
      if (this.isTrailFeature(feature)) {
        const trailWay = this.convertFeatureToTrailWay(feature);
        if (trailWay) {
          trailWays.push(trailWay);
        }
      }
    }
    
    console.log(`🎯 Found ${trailWays.length} trail features`);
    return trailWays;
  }

  /**
   * Check if a GeoJSON feature matches our trail criteria (same as Overpass query)
   */
  private isTrailFeature(feature: GeoJSONFeature): boolean {
    const properties = feature.properties;
    
    // Must have a name
    if (!properties.name || properties.name.trim() === '') {
      return false;
    }
    
    // Must have valid highway type
    const validHighways = ['path', 'track', 'footway', 'cycleway', 'bridleway'];
    const hasValidHighway = properties.highway && validHighways.includes(properties.highway);
    
    // Or must have valid route type
    const validRoutes = ['hiking', 'foot', 'walking'];
    const hasValidRoute = properties.route && validRoutes.includes(properties.route);
    
    // Must have valid surface type
    const validSurfaces = ['dirt', 'gravel', 'unpaved', 'ground', 'fine_gravel', 'grass', 'sand', 'rock', 'compacted', 'earth', 'natural'];
    const hasValidSurface = properties.surface && validSurfaces.includes(properties.surface);
    
    // Must have valid geometry
    const hasValidGeometry = feature.geometry.type === 'LineString' && 
                           Array.isArray(feature.geometry.coordinates) && 
                           feature.geometry.coordinates.length >= 2;
    
    return (hasValidHighway || hasValidRoute) && hasValidSurface && hasValidGeometry;
  }

  /**
   * Convert GeoJSON feature to TrailWay format
   */
  private convertFeatureToTrailWay(feature: GeoJSONFeature): TrailWay | null {
    try {
      const properties = feature.properties;
      
      // Extract coordinates from LineString geometry
      let coordinates: Array<[number, number]> = [];
      
      if (feature.geometry.type === 'LineString') {
        coordinates = feature.geometry.coordinates as Array<[number, number]>;
      } else if (feature.geometry.type === 'MultiLineString') {
        // For MultiLineString, take the first line
        const multiCoords = feature.geometry.coordinates as Array<Array<[number, number]>>;
        if (multiCoords.length > 0) {
          coordinates = multiCoords[0];
        }
      }
      
      if (coordinates.length < 2) {
        return null;
      }
      
      return {
        id: properties.osm_id || properties.id || Math.floor(Math.random() * 1000000),
        name: properties.name,
        trail_type: properties.route || 'hiking',
        surface: properties.surface || 'unknown',
        difficulty: properties.difficulty || 'unknown',
        coordinates,
        source_tags: properties
      };
      
    } catch (error) {
      console.error(`Error converting feature:`, error);
      return null;
    }
  }

  /**
   * Convert TrailWay to TrailInsertData format
   */
  private convertToTrailInsertData(trailWay: TrailWay): TrailInsertData | null {
    if (!trailWay.coordinates || trailWay.coordinates.length < 2) {
      return null;
    }
    
    return {
      osm_id: trailWay.id.toString(),
      name: trailWay.name,
      trail_type: trailWay.trail_type,
      surface: trailWay.surface,
      difficulty: trailWay.difficulty,
      coordinates: trailWay.coordinates,
      source_tags: trailWay.source_tags,
      region: this.getRegionFromFilePath()
    };
  }

  /**
   * Extract region name from file path
   */
  private getRegionFromFilePath(): string {
    const filename = path.basename(this.osmFilePath, '.osm.pbf');
    
    // Extract region from filename (e.g., "boulder-colorado" -> "boulder")
    if (filename.includes('boulder')) {
      return 'boulder';
    } else if (filename.includes('seattle')) {
      return 'seattle';
    } else if (filename.includes('denver')) {
      return 'denver';
    }
    
    // Default to filename
    return filename.split('-')[0];
  }

  /**
   * Clean up temporary GeoJSON file
   */
  async cleanup(): Promise<void> {
    const geojsonPath = this.osmFilePath.replace('.osm.pbf', '.geojson');
    if (fs.existsSync(geojsonPath)) {
      fs.unlinkSync(geojsonPath);
      console.log(`🧹 Cleaned up temporary file: ${geojsonPath}`);
    }
  }
}

/**
 * Utility function to create OSM extract reader for a region
 */
export function createOSMExtractReader(region: string): OSMExtractReader {
  const sourceDataDir = process.env.SOURCE_DATA_DIR || '/path/to/source-data';
  const osmFilePath = path.join(sourceDataDir, 'osm', `${region}-colorado.osm.pbf`);
  
  return new OSMExtractReader(osmFilePath);
} 