// Helper for region data copy and validation SQL

export function getRegionDataCopySql(schemaName: string, region: string, bbox?: [number, number, number, number]): { sql: string, params: any[] } {
  let sql = `
    INSERT INTO ${schemaName}.trails (
      app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
      bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
      elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      source, region, geometry, geometry_text, geometry_hash
    )
    SELECT 
      app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
      bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
      elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      source, region, geometry, ST_AsText(geometry) as geometry_text,
      md5(ST_AsText(geometry)) as geometry_hash
    FROM trails 
    WHERE region = $1
  `;
  const params: any[] = [region];
  return { sql, params };
}

export function validateRegionExistsSql(): string {
  return `SELECT COUNT(*) as count FROM trails WHERE region = $1`;
}