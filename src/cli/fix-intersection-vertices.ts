import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

interface GeoJSONFeature {
  type: string;
  geometry: {
    type: string;
    coordinates: number[][];
  };
  properties: {
    id: string;
    node_uuid: string;
    lat: number;
    lng: number;
    elevation: number;
    node_type: string;
    degree: string;
    type: string;
    color: string;
    stroke: string;
    strokeWidth: number;
    fillOpacity: number;
    radius: number;
  };
}

interface GeoJSONCollection {
  type: string;
  features: GeoJSONFeature[];
}

interface IntersectionPoint {
  lng: number;
  lat: number;
  elevation: number;
  connectedVertices: string[];
  intersectionType: 'Y' | 'T' | 'X';
}

class IntersectionVertexFixer {
  private features: GeoJSONFeature[];
  private tolerance: number; // in degrees (roughly meters)

  constructor(features: GeoJSONFeature[], tolerance: number = 0.0001) {
    this.features = features;
    this.tolerance = tolerance;
  }

  /**
   * Detect Y, T, and X intersections in the network
   */
  detectIntersections(): IntersectionPoint[] {
    const intersections: IntersectionPoint[] = [];
    const vertexMap = new Map<string, { lng: number; lat: number; elevation: number }>();

    // Build vertex map
    this.features.forEach(feature => {
      if (feature.geometry.type === 'Point') {
        const [lng, lat, elevation] = feature.geometry.coordinates;
        vertexMap.set(feature.properties.node_uuid, { lng, lat, elevation });
      }
    });

    // Find vertices that are close to each other (potential intersections)
    const processedPairs = new Set<string>();
    
    for (const [uuid1, pos1] of vertexMap) {
      for (const [uuid2, pos2] of vertexMap) {
        if (uuid1 === uuid2) continue;
        
        const pairKey = [uuid1, uuid2].sort().join('-');
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);

        const distance = this.calculateDistance(pos1, pos2);
        if (distance <= this.tolerance) {
          // Found a potential intersection
          const intersectionType = this.determineIntersectionType(uuid1, uuid2, vertexMap);
          if (intersectionType) {
            // Use the average position for the intersection point
            const avgLng = (pos1.lng + pos2.lng) / 2;
            const avgLat = (pos1.lat + pos2.lat) / 2;
            const avgElevation = (pos1.elevation + pos2.elevation) / 2;

            intersections.push({
              lng: avgLng,
              lat: avgLat,
              elevation: avgElevation,
              connectedVertices: [uuid1, uuid2],
              intersectionType
            });
          }
        }
      }
    }

    return intersections;
  }

  /**
   * Determine if two vertices form a Y, T, or X intersection
   */
  private determineIntersectionType(uuid1: string, uuid2: string, vertexMap: Map<string, any>): 'Y' | 'T' | 'X' | null {
    // For now, we'll classify based on the degree of the vertices
    // This is a simplified approach - in a real implementation you'd analyze the network topology
    
    const feature1 = this.features.find(f => f.properties.node_uuid === uuid1);
    const feature2 = this.features.find(f => f.properties.node_uuid === uuid2);
    
    if (!feature1 || !feature2) return null;

    const degree1 = parseInt(feature1.properties.degree);
    const degree2 = parseInt(feature2.properties.degree);

    // Simple classification based on degrees
    if (degree1 === 1 && degree2 === 3) return 'T';
    if (degree1 === 3 && degree2 === 1) return 'T';
    if (degree1 === 3 && degree2 === 3) return 'X';
    if (degree1 === 1 && degree2 === 1) return 'Y'; // Could be a Y intersection
    
    return null;
  }

  /**
   * Calculate distance between two points
   */
  private calculateDistance(pos1: { lng: number; lat: number }, pos2: { lng: number; lat: number }): number {
    const dLng = pos1.lng - pos2.lng;
    const dLat = pos1.lat - pos2.lat;
    return Math.sqrt(dLng * dLng + dLat * dLat);
  }

  /**
   * Snap vertices to intersection points and create new intersection features
   */
  fixIntersectionVertices(): { fixedFeatures: GeoJSONFeature[]; newIntersections: GeoJSONFeature[] } {
    const intersections = this.detectIntersections();
    const fixedFeatures = [...this.features];
    const newIntersections: GeoJSONFeature[] = [];

    console.log(`🔍 Found ${intersections.length} intersections to fix`);

    intersections.forEach((intersection, index) => {
      console.log(`   📍 Intersection ${index + 1}: ${intersection.intersectionType} at (${intersection.lng.toFixed(6)}, ${intersection.lat.toFixed(6)})`);

      // Create a new intersection feature
      const intersectionFeature: GeoJSONFeature = {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [intersection.lng, intersection.lat, intersection.elevation]
        },
        properties: {
          id: `intersection-${index + 1}`,
          node_uuid: `intersection-${index + 1}`,
          lat: intersection.lat,
          lng: intersection.lng,
          elevation: intersection.elevation,
          node_type: 'intersection',
          degree: intersection.connectedVertices.length.toString(),
          type: 'intersection_vertex',
          color: '#FF6B35', // Orange for intersections
          stroke: '#FF6B35',
          strokeWidth: 4,
          fillOpacity: 0.9,
          radius: 8
        }
      };

      newIntersections.push(intersectionFeature);

      // Snap the connected vertices to the intersection point
      intersection.connectedVertices.forEach(vertexUuid => {
        const featureIndex = fixedFeatures.findIndex(f => f.properties.node_uuid === vertexUuid);
        if (featureIndex !== -1) {
          const feature = fixedFeatures[featureIndex];
          feature.geometry.coordinates = [intersection.lng, intersection.lat, intersection.elevation];
          feature.properties.lat = intersection.lat;
          feature.properties.lng = intersection.lng;
          feature.properties.elevation = intersection.elevation;
          feature.properties.node_type = 'intersection';
          feature.properties.color = '#FF6B35';
          feature.properties.stroke = '#FF6B35';
          feature.properties.strokeWidth = 4;
          feature.properties.radius = 6;
        }
      });
    });

    return { fixedFeatures, newIntersections };
  }
}

const program = new Command();

program
  .name('fix-intersection-vertices')
  .description('Fix intersection vertices in GeoJSON network data by snapping to actual Y, T, X intersections')
  .argument('<input-file>', 'Input GeoJSON file path')
  .argument('<output-file>', 'Output GeoJSON file path')
  .option('-t, --tolerance <meters>', 'Tolerance for intersection detection in meters', '5')
  .option('--dry-run', 'Show what would be done without making changes')
  .parse();

async function fixIntersectionVertices() {
  const options = program.opts();
  const [inputFile, outputFile] = program.args;
  
  console.log('🔧 Fixing intersection vertices in GeoJSON network...');
  console.log(`   Input: ${inputFile}`);
  console.log(`   Output: ${outputFile}`);
  console.log(`   Tolerance: ${options.tolerance}m`);
  console.log(`   Dry Run: ${options.dryRun ? 'Yes' : 'No'}`);

  try {
    // Read input file
    const inputData = fs.readFileSync(inputFile, 'utf8');
    const geojson: GeoJSONCollection = JSON.parse(inputData);

    console.log(`📊 Input data: ${geojson.features.length} features`);

    // Filter to only point features (vertices)
    const vertexFeatures = geojson.features.filter(f => f.geometry.type === 'Point');
    console.log(`📍 Vertex features: ${vertexFeatures.length}`);

    // Convert tolerance from meters to degrees (approximate)
    const toleranceDegrees = parseFloat(options.tolerance) / 111320; // Rough conversion

    // Create fixer and detect intersections
    const fixer = new IntersectionVertexFixer(vertexFeatures, toleranceDegrees);
    
    if (options.dryRun) {
      const intersections = fixer.detectIntersections();
      console.log(`🔍 DRY RUN: Would fix ${intersections.length} intersections`);
      intersections.forEach((intersection, index) => {
        console.log(`   📍 Intersection ${index + 1}: ${intersection.intersectionType} at (${intersection.lng.toFixed(6)}, ${intersection.lat.toFixed(6)})`);
        console.log(`      Connected vertices: ${intersection.connectedVertices.join(', ')}`);
      });
      return;
    }

    // Fix intersections
    const { fixedFeatures, newIntersections } = fixer.fixIntersectionVertices();

    // Create output GeoJSON
    const outputGeoJSON: GeoJSONCollection = {
      type: 'FeatureCollection',
      features: [...fixedFeatures, ...newIntersections]
    };

    // Write output file
    fs.writeFileSync(outputFile, JSON.stringify(outputGeoJSON, null, 2));
    
    console.log(`✅ Fixed intersection vertices successfully!`);
    console.log(`📊 Output: ${outputGeoJSON.features.length} features`);
    console.log(`📍 New intersection features: ${newIntersections.length}`);

  } catch (error) {
    console.error('❌ Error fixing intersection vertices:', error);
    process.exit(1);
  }
}

// Run the fix
fixIntersectionVertices();
