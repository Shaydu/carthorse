// Helper for region data copy and validation SQL

export function getRegionDataCopySql(schemaName: string, bbox?: [number, number, number, number]): { sql: string, params: any[] } {
  let sql = `
    INSERT INTO ${schemaName}.trails (
      id, app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
      bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
      elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      source, region, geometry, geometry_text
    )
    SELECT 
      id, app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
      bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
      elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      source, region, geometry, ST_AsText(geometry) as geometry_text
    FROM trails 
    WHERE region = $1
  `;
  const params: any[] = [schemaName.replace(/^staging_/, '')];
  if (bbox) {
    sql += ` AND ST_Intersects(geometry, ST_MakeEnvelope($2, $3, $4, $5, 4326))`;
    params.push(String(bbox[0]), String(bbox[1]), String(bbox[2]), String(bbox[3]));
  }
  return { sql, params };
}

export function validateRegionExistsSql(): string {
  return `SELECT COUNT(*) as count FROM trails WHERE region = $1`;
} 