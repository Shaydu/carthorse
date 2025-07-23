import { Client } from 'pg';
import type { GeoJSONCoordinate } from '../../types';

/**
 * Helper for intersection detection, refactored from orchestrator (2024-07-23).
 * Returns a Map<trailId, IntersectionPoint[]> for use in splitting logic.
 */
export interface IntersectionPoint {
  coordinate: GeoJSONCoordinate;
  idx: number;
  distance: number;
  visitorTrailId: number;
  visitorTrailName: string;
}

export async function detectIntersectionsHelper(
  pgClient: Client,
  stagingSchema: string,
  tolerance: number
): Promise<Map<number, IntersectionPoint[]>> {
  // Clear existing intersection data
  await pgClient.query(`DELETE FROM ${stagingSchema}.intersection_points`);
  // Use the enhanced PostGIS intersection detection function (updated for geo2)
  const sql = `
    INSERT INTO ${stagingSchema}.intersection_points (point, point_3d, trail1_id, trail2_id, distance_meters)
    SELECT 
      intersection_point,
      intersection_point_3d,
      connected_trail_ids[1]::integer as trail1_id,
      connected_trail_ids[2]::integer as trail2_id,
      distance_meters
    FROM public.detect_trail_intersections_geo2('${stagingSchema}', 'trails', $1)
    WHERE array_length(connected_trail_ids, 1) >= 2
    -- DEBUG: If you see this comment in logs, you are running the latest intersection helper code with geo2
  `;
  await pgClient.query(sql, [tolerance]);

  // Load intersection data
  const intersections = await pgClient.query(`
    SELECT 
      ip.*,
      ST_X(ip.point) as lng,
      ST_Y(ip.point) as lat,
      COALESCE(ST_Z(ip.point_3d), 0) as elevation
    FROM ${stagingSchema}.intersection_points ip
    ORDER BY ip.trail1_id, ip.trail2_id
  `);

  // Group intersections by trail
  const splitPoints = new Map<number, IntersectionPoint[]>();
  for (const intersection of intersections.rows) {
    const lng = intersection.lng;
    const lat = intersection.lat;
    const elevation = intersection.elevation;
    const trail1Id = intersection.trail1_id;
    const trail2Id = intersection.trail2_id;
    // Add to trail1
    if (!splitPoints.has(trail1Id)) splitPoints.set(trail1Id, []);
    splitPoints.get(trail1Id)!.push({
      coordinate: [lng, lat, elevation] as GeoJSONCoordinate, idx: -1, distance: intersection.distance_meters,
      visitorTrailId: trail2Id, visitorTrailName: ''
    });
    // Add to trail2
    if (!splitPoints.has(trail2Id)) splitPoints.set(trail2Id, []);
    splitPoints.get(trail2Id)!.push({
      coordinate: [lng, lat, elevation] as GeoJSONCoordinate, idx: -1, distance: intersection.distance_meters,
      visitorTrailId: trail1Id, visitorTrailName: ''
    });
  }

  // Get trail names for visitor trails
  const trailNames = await pgClient.query(`
    SELECT id, name FROM ${stagingSchema}.trails 
    WHERE id IN (
      SELECT DISTINCT trail1_id FROM ${stagingSchema}.intersection_points
      UNION
      SELECT DISTINCT trail2_id FROM ${stagingSchema}.intersection_points
    )
  `);
  const nameMap = new Map(trailNames.rows.map((row: any) => [row.id, row.name]));
  for (const [trailId, points] of splitPoints) {
    for (const point of points) {
      point.visitorTrailName = nameMap.get(point.visitorTrailId) || '';
    }
  }
  return splitPoints;
} 