/**
 * Static utility to track all split coordinates across all splitting services
 * This ensures we don't create duplicate splits within a tolerance distance
 * and helps with proper vertex snapping and noding after splitting
 */
export interface SplitCoordinate {
  uuid: string;
  x: number;
  y: number;
  trail1Id: string;
  trail2Id: string;
  trail1Name: string;
  trail2Name: string;
  splitType: 'intersection' | 'crossing' | 'y-split' | 'endpoint-snap';
  timestamp: Date;
  metadata?: Record<string, any>;
}

export class SplitCoordinateTracker {
  private static instance: SplitCoordinateTracker;
  private splitCoordinates: Map<string, SplitCoordinate> = new Map();
  private readonly defaultToleranceMeters = 1.0; // 1 meter default tolerance

  private constructor() {}

  public static getInstance(): SplitCoordinateTracker {
    if (!SplitCoordinateTracker.instance) {
      SplitCoordinateTracker.instance = new SplitCoordinateTracker();
    }
    return SplitCoordinateTracker.instance;
  }

  /**
   * Check if a coordinate is a duplicate (within tolerance) of an existing split
   * @param x Longitude coordinate
   * @param y Latitude coordinate
   * @param toleranceMeters Tolerance in meters (defaults to 1.0m)
   * @returns The existing split coordinate if duplicate found, null otherwise
   */
  public isDuplicate(
    x: number, 
    y: number, 
    toleranceMeters: number = this.defaultToleranceMeters
  ): SplitCoordinate | null {
    for (const [uuid, existing] of this.splitCoordinates) {
      const distance = this.calculateDistance(x, y, existing.x, existing.y);
      if (distance <= toleranceMeters) {
        return existing;
      }
    }
    return null;
  }

  /**
   * Add a new split coordinate to the tracker
   * @param coordinate The split coordinate to add
   * @returns The UUID of the added coordinate
   */
  public addSplitCoordinate(coordinate: Omit<SplitCoordinate, 'uuid' | 'timestamp'>): string {
    const uuid = `split-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const fullCoordinate: SplitCoordinate = {
      ...coordinate,
      uuid,
      timestamp: new Date()
    };
    
    this.splitCoordinates.set(uuid, fullCoordinate);
    
    if (process.env.NODE_ENV === 'development' || process.env.VERBOSE) {
      console.log(`📍 SplitCoordinateTracker: Added split at [${x.toFixed(6)}, ${y.toFixed(6)}] for ${coordinate.trail1Name} × ${coordinate.trail2Name}`);
    }
    
    return uuid;
  }

  /**
   * Get all split coordinates for a specific trail
   * @param trailId The trail ID to search for
   * @returns Array of split coordinates involving this trail
   */
  public getSplitsForTrail(trailId: string): SplitCoordinate[] {
    return Array.from(this.splitCoordinates.values()).filter(
      coord => coord.trail1Id === trailId || coord.trail2Id === trailId
    );
  }

  /**
   * Get all split coordinates within a bounding box
   * @param minX Minimum longitude
   * @param minY Minimum latitude
   * @param maxX Maximum longitude
   * @param maxY Maximum latitude
   * @returns Array of split coordinates within the bounding box
   */
  public getSplitsInBoundingBox(
    minX: number, 
    minY: number, 
    maxX: number, 
    maxY: number
  ): SplitCoordinate[] {
    return Array.from(this.splitCoordinates.values()).filter(
      coord => coord.x >= minX && coord.x <= maxX && coord.y >= minY && coord.y <= maxY
    );
  }

  /**
   * Get all split coordinates within a radius of a point
   * @param centerX Center longitude
   * @param centerY Center latitude
   * @param radiusMeters Radius in meters
   * @returns Array of split coordinates within the radius
   */
  public getSplitsInRadius(
    centerX: number, 
    centerY: number, 
    radiusMeters: number
  ): SplitCoordinate[] {
    return Array.from(this.splitCoordinates.values()).filter(
      coord => {
        const distance = this.calculateDistance(centerX, centerY, coord.x, coord.y);
        return distance <= radiusMeters;
      }
    );
  }

  /**
   * Get statistics about all tracked splits
   * @returns Object with split statistics
   */
  public getStatistics(): {
    totalSplits: number;
    splitsByType: Record<string, number>;
    splitsByTrail: Record<string, number>;
    boundingBox: { minX: number; minY: number; maxX: number; maxY: number } | null;
  } {
    const splitsByType: Record<string, number> = {};
    const splitsByTrail: Record<string, number> = {};
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasCoordinates = false;

    for (const coord of this.splitCoordinates.values()) {
      // Count by type
      splitsByType[coord.splitType] = (splitsByType[coord.splitType] || 0) + 1;
      
      // Count by trail
      splitsByTrail[coord.trail1Id] = (splitsByTrail[coord.trail1Id] || 0) + 1;
      splitsByTrail[coord.trail2Id] = (splitsByTrail[coord.trail2Id] || 0) + 1;
      
      // Calculate bounding box
      if (coord.x < minX) minX = coord.x;
      if (coord.x > maxX) maxX = coord.x;
      if (coord.y < minY) minY = coord.y;
      if (coord.y > maxY) maxY = coord.y;
      hasCoordinates = true;
    }

    return {
      totalSplits: this.splitCoordinates.size,
      splitsByType,
      splitsByTrail,
      boundingBox: hasCoordinates ? { minX, minY, maxX, maxY } : null
    };
  }

  /**
   * Clear all tracked coordinates (useful for testing or starting fresh)
   */
  public clear(): void {
    this.splitCoordinates.clear();
    if (process.env.NODE_ENV === 'development' || process.env.VERBOSE) {
      console.log('📍 SplitCoordinateTracker: Cleared all tracked coordinates');
    }
  }

  /**
   * Export all coordinates to JSON (useful for debugging or persistence)
   */
  public exportToJSON(): string {
    return JSON.stringify(Array.from(this.splitCoordinates.values()), null, 2);
  }

  /**
   * Calculate distance between two coordinates in meters
   * @param x1 First longitude
   * @param y1 First latitude
   * @param x2 Second longitude
   * @param y2 Second latitude
   * @returns Distance in meters
   */
  private calculateDistance(x1: number, y1: number, x2: number, y2: number): number {
    // Simple approximation: 1 degree ≈ 111,000 meters
    // For more accuracy, you could use a proper geodesic calculation library
    const deltaX = (x2 - x1) * 111000 * Math.cos((y1 + y2) / 2 * Math.PI / 180);
    const deltaY = (y2 - y1) * 111000;
    return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  }

  /**
   * Get all coordinates for debugging/logging
   */
  public getAllCoordinates(): SplitCoordinate[] {
    return Array.from(this.splitCoordinates.values());
  }

  /**
   * Check if a specific coordinate exists (exact match)
   */
  public hasExactCoordinate(x: number, y: number): boolean {
    return Array.from(this.splitCoordinates.values()).some(
      coord => coord.x === x && coord.y === y
    );
  }
}
