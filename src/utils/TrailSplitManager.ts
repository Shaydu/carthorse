import { Pool } from 'pg';

export interface SplitCoordinate {
  x: number;
  y: number;
  z?: number;
}

export interface SplitRecord {
  trailUuid: string;
  trailName: string;
  intersectionCoords: SplitCoordinate;
  timestamp: Date;
  serviceType: string;
  iteration: number;
}

/**
 * Static utility class to manage trail split coordinates and prevent duplicate splits
 * within a specified tolerance across all splitting service types.
 */
export class TrailSplitManager {
  private static instance: TrailSplitManager;
  private splitRecords: Map<string, SplitRecord[]> = new Map();
  private toleranceMeters: number = 1.0;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): TrailSplitManager {
    if (!TrailSplitManager.instance) {
      TrailSplitManager.instance = new TrailSplitManager();
    }
    return TrailSplitManager.instance;
  }

  /**
   * Set tolerance for duplicate detection (in meters)
   */
  public setTolerance(meters: number): void {
    this.toleranceMeters = meters;
  }

  /**
   * Get current tolerance
   */
  public getTolerance(): number {
    return this.toleranceMeters;
  }

  /**
   * Check if a split at the given coordinates is a duplicate for the specified trail
   * @param trailUuid - UUID of the trail being split
   * @param coords - Coordinates of the intersection point
   * @returns true if this is a duplicate split, false if it's unique
   */
  public isDuplicateSplit(trailUuid: string, coords: SplitCoordinate): boolean {
    const existingSplits = this.splitRecords.get(trailUuid);
    if (!existingSplits || existingSplits.length === 0) {
      return false;
    }

    // Check if any existing split is within tolerance
    for (const record of existingSplits) {
      const distance = this.calculateDistance(coords, record.intersectionCoords);
      if (distance <= this.toleranceMeters) {
        return true;
      }
    }

    return false;
  }

  /**
   * Record a new split for a trail
   * @param trailUuid - UUID of the trail being split
   * @param trailName - Name of the trail
   * @param coords - Coordinates of the intersection point
   * @param serviceType - Type of splitting service (e.g., 'YIntersection', 'STSplit', 'PgRouting')
   * @param iteration - Current iteration number
   */
  public recordSplit(
    trailUuid: string,
    trailName: string,
    coords: SplitCoordinate,
    serviceType: string,
    iteration: number
  ): void {
    const record: SplitRecord = {
      trailUuid,
      trailName,
      intersectionCoords: coords,
      timestamp: new Date(),
      serviceType,
      iteration
    };

    if (!this.splitRecords.has(trailUuid)) {
      this.splitRecords.set(trailUuid, []);
    }

    this.splitRecords.get(trailUuid)!.push(record);
  }

  /**
   * Get all split records for a specific trail
   * @param trailUuid - UUID of the trail
   * @returns Array of split records for the trail
   */
  public getTrailSplits(trailUuid: string): SplitRecord[] {
    return this.splitRecords.get(trailUuid) || [];
  }

  /**
   * Get all split records across all trails
   * @returns Array of all split records
   */
  public getAllSplits(): SplitRecord[] {
    const allSplits: SplitRecord[] = [];
    for (const splits of this.splitRecords.values()) {
      allSplits.push(...splits);
    }
    return allSplits;
  }

  /**
   * Get split statistics
   * @returns Object with split statistics
   */
  public getSplitStats(): {
    totalTrails: number;
    totalSplits: number;
    averageSplitsPerTrail: number;
    serviceBreakdown: Record<string, number>;
  } {
    const totalTrails = this.splitRecords.size;
    let totalSplits = 0;
    const serviceBreakdown: Record<string, number> = {};

    for (const splits of this.splitRecords.values()) {
      totalSplits += splits.length;
      for (const split of splits) {
        serviceBreakdown[split.serviceType] = (serviceBreakdown[split.serviceType] || 0) + 1;
      }
    }

    return {
      totalTrails,
      totalSplits,
      averageSplitsPerTrail: totalTrails > 0 ? totalSplits / totalTrails : 0,
      serviceBreakdown
    };
  }

  /**
   * Clear all split records
   */
  public clearAllSplits(): void {
    this.splitRecords.clear();
  }

  /**
   * Clear split records for a specific trail
   * @param trailUuid - UUID of the trail
   */
  public clearTrailSplits(trailUuid: string): void {
    this.splitRecords.delete(trailUuid);
  }

  /**
   * Export split records to JSON
   * @returns JSON string of all split records
   */
  public exportToJson(): string {
    return JSON.stringify({
      toleranceMeters: this.toleranceMeters,
      timestamp: new Date().toISOString(),
      stats: this.getSplitStats(),
      splits: this.getAllSplits()
    }, null, 2);
  }

  /**
   * Import split records from JSON
   * @param jsonData - JSON string containing split records
   */
  public importFromJson(jsonData: string): void {
    try {
      const data = JSON.parse(jsonData);
      if (data.toleranceMeters) {
        this.toleranceMeters = data.toleranceMeters;
      }
      if (data.splits && Array.isArray(data.splits)) {
        this.clearAllSplits();
        for (const split of data.splits) {
          if (split.trailUuid && split.intersectionCoords) {
            this.recordSplit(
              split.trailUuid,
              split.trailName || 'Unknown',
              split.intersectionCoords,
              split.serviceType || 'Unknown',
              split.iteration || 0
            );
          }
        }
      }
    } catch (error) {
      console.error('Error importing split records from JSON:', error);
    }
  }

  /**
   * Calculate distance between two coordinates in meters
   * @param coords1 - First coordinate set
   * @param coords2 - Second coordinate set
   * @returns Distance in meters
   */
  private calculateDistance(coords1: SplitCoordinate, coords2: SplitCoordinate): number {
    const dx = coords1.x - coords2.x;
    const dy = coords1.y - coords2.y;
    const dz = (coords1.z || 0) - (coords2.z || 0);
    
    // Convert to meters (assuming coordinates are in degrees)
    // 1 degree latitude ≈ 111,320 meters
    // 1 degree longitude ≈ 111,320 * cos(latitude) meters
    const lat = (coords1.y + coords2.y) / 2; // Average latitude for longitude conversion
    const latRad = lat * Math.PI / 180;
    
    const dxMeters = dx * 111320 * Math.cos(latRad);
    const dyMeters = dy * 111320;
    const dzMeters = dz; // Assuming elevation is already in meters
    
    return Math.sqrt(dxMeters * dxMeters + dyMeters * dyMeters + dzMeters * dzMeters);
  }

  /**
   * Extract coordinates from PostGIS geometry object
   * @param geometry - PostGIS geometry object
   * @returns SplitCoordinate or null if extraction fails
   */
  public static extractCoordinates(geometry: any): SplitCoordinate | null {
    try {
      // Handle different PostGIS geometry formats
      if (geometry && typeof geometry === 'object') {
        // Check if it has coordinates property
        if (geometry.coordinates && Array.isArray(geometry.coordinates)) {
          const coords = geometry.coordinates;
          if (coords.length >= 2) {
            return {
              x: parseFloat(coords[0]),
              y: parseFloat(coords[1]),
              z: coords.length >= 3 ? parseFloat(coords[2]) : undefined
            };
          }
        }
        
        // Check if it has x, y properties
        if (geometry.x !== undefined && geometry.y !== undefined) {
          return {
            x: parseFloat(geometry.x),
            y: parseFloat(geometry.y),
            z: geometry.z !== undefined ? parseFloat(geometry.z) : undefined
          };
        }
        
        // Check if it has lat, lng properties
        if (geometry.lat !== undefined && geometry.lng !== undefined) {
          return {
            x: parseFloat(geometry.lng),
            y: parseFloat(geometry.lat),
            z: geometry.elevation !== undefined ? parseFloat(geometry.elevation) : undefined
          };
        }
      }
      
      // If it's a string, try to parse it
      if (typeof geometry === 'string') {
        // Handle WKT format like "POINT(-105.291405 40.06998)"
        const match = geometry.match(/POINT\(([^)]+)\)/);
        if (match) {
          const coords = match[1].split(' ');
          if (coords.length >= 2) {
            return {
              x: parseFloat(coords[0]),
              y: parseFloat(coords[1]),
              z: coords.length >= 3 ? parseFloat(coords[2]) : undefined
            };
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting coordinates from geometry:', error);
      return null;
    }
  }

  /**
   * Log current state for debugging
   */
  public logState(): void {
    const stats = this.getSplitStats();
    console.log('=== TrailSplitManager State ===');
    console.log(`Tolerance: ${this.toleranceMeters}m`);
    console.log(`Total trails with splits: ${stats.totalTrails}`);
    console.log(`Total splits: ${stats.totalSplits}`);
    console.log(`Average splits per trail: ${stats.averageSplitsPerTrail.toFixed(2)}`);
    console.log('Service breakdown:', stats.serviceBreakdown);
    
    if (stats.totalTrails > 0) {
      console.log('\nTrails with multiple splits:');
      for (const [trailUuid, splits] of this.splitRecords.entries()) {
        if (splits.length > 1) {
          console.log(`  ${splits[0].trailName} (${trailUuid}): ${splits.length} splits`);
          for (const split of splits) {
            console.log(`    - ${split.serviceType} (iter ${split.iteration}): [${split.intersectionCoords.x.toFixed(6)}, ${split.intersectionCoords.y.toFixed(6)}]`);
          }
        }
      }
    }
    console.log('===============================');
  }
}
