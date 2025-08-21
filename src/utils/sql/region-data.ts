// Helper for region data copy and validation SQL

// Predefined bbox configurations for testing
export const TEST_BBOX_CONFIGS = {
  boulder: {
    small: [-105.28932, 39.99233, -105.282906, 39.99881], // ~0.26 sq miles, ~10 trails
    medium: [-105.295, 39.99, -105.275, 40.01], // ~2.5 sq miles, ~33 trails  
    hogback_expanded: [-105.32, 40.04, -105.27, 40.10], // Expanded area around Hogback Ridge Trail (~8 trails)
    full: undefined // No bbox filter - entire region
  },
  seattle: {
              small: [-122.20, 47.55, -122.15, 47.60], // Small area in Seattle (~33 trails)
    medium: [-122.40, 47.55, -122.25, 47.70], // Medium area in Seattle
    full: undefined // No bbox filter - entire region
  }
} as const;

export function getTestBbox(region: string, size: 'small' | 'medium' | 'full' = 'full'): [number, number, number, number] | undefined {
  // Allow override via environment variable
  const envSize = process.env.CARTHORSE_TEST_BBOX_SIZE as 'small' | 'medium' | 'full' | undefined;
  const finalSize = envSize || size;
  
  const config = TEST_BBOX_CONFIGS[region as keyof typeof TEST_BBOX_CONFIGS];
  if (!config) {
    console.warn(`No bbox config found for region: ${region}, using full region`);
    return undefined;
  }
  
  console.log(`🗺️ Using ${finalSize} bbox for region ${region}`);
  const bbox = config[finalSize];
  return bbox ? [...bbox] as [number, number, number, number] : undefined;
}

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
      source, region, geometry, 
      COALESCE(ST_AsText(geometry), '') as geometry_text,
      COALESCE(md5(ST_AsText(geometry)), md5('')) as geometry_hash
    FROM trails 
    WHERE region = $1 AND geometry IS NOT NULL
  `;
  
  // Add bbox filter if provided
  if (bbox) {
    sql += ` AND ST_Intersects(geometry, ST_MakeEnvelope($2, $3, $4, $5, 4326))`;
  }
  
  const params: any[] = [region];
  if (bbox) {
    params.push(...bbox);
  }
  
  return { sql, params };
}

export function validateRegionExistsSql(): string {
  return `SELECT COUNT(*) as count FROM trails WHERE region = $1`;
}