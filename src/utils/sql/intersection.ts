import { Client } from 'pg';
import type { GeoJSONCoordinate, IntersectionPoint } from '../../types';

/**
 * Helper for intersection detection, refactored from orchestrator (2024-07-23).
 * Returns a Map<trailId, IntersectionPoint[]> for use in splitting logic.
 */

export async function detectIntersectionsHelper(
  pgClient: Client,
  stagingSchema: string,
  tolerance: number
): Promise<Map<string, IntersectionPoint[]>> { // Changed from number to string for UUID support
  throw new Error('DEPRECATED: Use native SQL/PostGIS for intersection detection.');
} 