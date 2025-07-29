// Elevation fallback service for when TIFF elevation data is not available
export interface ElevationFallbackConfig {
  enabled: boolean;
  defaultElevation: number;
  minElevation: number;
  maxElevation: number;
}

export class ElevationFallbackService {
  private config: ElevationFallbackConfig;

  constructor(config: ElevationFallbackConfig) {
    this.config = config;
  }

  /**
   * Calculate elevation from geometry when TIFF data is not available
   * This is a fallback method that estimates elevation from coordinate data
   */
  calculateElevationFromGeometry(geometry: string): {
    elevation_gain: number;
    elevation_loss: number;
    max_elevation: number;
    min_elevation: number;
    avg_elevation: number;
  } {
    // Parse geometry to extract coordinates
    const coordinates = this.parseGeometryCoordinates(geometry);
    
    if (coordinates.length < 2) {
      return {
        elevation_gain: 0,
        elevation_loss: 0,
        max_elevation: this.config.defaultElevation,
        min_elevation: this.config.defaultElevation,
        avg_elevation: this.config.defaultElevation,
      };
    }

    // Calculate elevation changes between consecutive points
    let elevationGain = 0;
    let elevationLoss = 0;
    let maxElevation = coordinates[0].z || this.config.defaultElevation;
    let minElevation = coordinates[0].z || this.config.defaultElevation;
    let totalElevation = 0;

    for (let i = 0; i < coordinates.length; i++) {
      const currentElevation = coordinates[i].z || this.config.defaultElevation;
      totalElevation += currentElevation;

      if (currentElevation > maxElevation) {
        maxElevation = currentElevation;
      }
      if (currentElevation < minElevation) {
        minElevation = currentElevation;
      }

      if (i > 0) {
        const prevElevation = coordinates[i - 1].z || this.config.defaultElevation;
        const elevationChange = currentElevation - prevElevation;
        
        if (elevationChange > 0) {
          elevationGain += elevationChange;
        } else if (elevationChange < 0) {
          elevationLoss += Math.abs(elevationChange);
        }
      }
    }

    const avgElevation = totalElevation / coordinates.length;

    return {
      elevation_gain: Math.round(elevationGain),
      elevation_loss: Math.round(elevationLoss),
      max_elevation: Math.round(maxElevation),
      min_elevation: Math.round(minElevation),
      avg_elevation: Math.round(avgElevation),
    };
  }

  /**
   * Parse geometry string to extract coordinates
   */
  private parseGeometryCoordinates(geometry: string): Array<{x: number, y: number, z?: number}> {
    try {
      // Handle WKT format: LINESTRING(x1 y1 z1, x2 y2 z2, ...)
      if (geometry.includes('LINESTRING')) {
        const coordMatch = geometry.match(/LINESTRING\(([^)]+)\)/);
        if (coordMatch) {
          const coordString = coordMatch[1];
          return coordString.split(',').map(coord => {
            const parts = coord.trim().split(' ');
            return {
              x: parseFloat(parts[0]),
              y: parseFloat(parts[1]),
              z: parts.length > 2 ? parseFloat(parts[2]) : undefined,
            };
          });
        }
      }

      // Handle GeoJSON format
      if (geometry.includes('"coordinates"')) {
        try {
          const geoJson = JSON.parse(geometry);
          if (geoJson.type === 'LineString' && Array.isArray(geoJson.coordinates)) {
            return geoJson.coordinates.map((coord: number[]) => ({
              x: coord[0],
              y: coord[1],
              z: coord.length > 2 ? coord[2] : undefined,
            }));
          }
        } catch (e) {
          // Ignore JSON parse errors
        }
      }

      return [];
    } catch (error) {
      console.warn('Failed to parse geometry for elevation calculation:', error);
      return [];
    }
  }

  /**
   * Check if elevation data is available for a given region
   */
  isElevationDataAvailable(region: string): boolean {
    // This would typically check for TIFF files or elevation data availability
    // For now, return false to indicate fallback should be used
    return false;
  }

  /**
   * Get default configuration
   */
  static getDefaultConfig(): ElevationFallbackConfig {
    return {
      enabled: true,
      defaultElevation: 1000, // Default elevation in meters
      minElevation: 0,
      maxElevation: 4000,
    };
  }
}