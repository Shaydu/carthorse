// Staging environment SQL queries
export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export type BBoxOrNull = BBox | null;

export const StagingQueries = {
  // Schema creation
  createSchema: (schemaName: string) => `
    CREATE SCHEMA IF NOT EXISTS ${schemaName}
  `,

  // Data copying
  copyTrails: (sourceSchema: string, targetSchema: string, region: string, bbox?: BBoxOrNull) => `
    INSERT INTO ${targetSchema}.trails (
      original_trail_uuid, app_uuid, name, trail_type, surface, difficulty,
      geometry, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, osm_id
    )
    SELECT 
      app_uuid as original_trail_uuid,  -- Preserve original UUID
      gen_random_uuid() as app_uuid,    -- Generate new UUID for staging
      name, trail_type, surface, difficulty,
      geometry, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, osm_id
    FROM ${sourceSchema}.trails 
    WHERE region = $1 
    ${bbox ? 'AND ST_Intersects(geometry, ST_MakeEnvelope($2, $3, $4, $5, 4326))' : ''}
  `,

  // Data validation
  validateStagingData: (schemaName: string) => `
    SELECT 
      COUNT(*) as total_trails,
      COUNT(CASE WHEN geometry IS NULL THEN 1 END) as null_geometry,
      COUNT(CASE WHEN NOT ST_IsValid(geometry) THEN 1 END) as invalid_geometry,
      COUNT(CASE WHEN length_km IS NULL OR length_km <= 0 THEN 1 END) as zero_or_null_length,
      COUNT(CASE WHEN ST_StartPoint(geometry) = ST_EndPoint(geometry) THEN 1 END) as self_loops,
      COUNT(CASE WHEN ST_Length(geometry) = 0 THEN 1 END) as zero_length_geometry,
      COUNT(CASE WHEN ST_NumPoints(geometry) < 2 THEN 1 END) as single_point_geometry
    FROM ${schemaName}.trails
  `,

  // Trail validation for routing
  validateTrailsForRouting: (schemaName: string) => `
    SELECT 
      COUNT(*) as total_trails,
      COUNT(CASE WHEN geometry IS NULL THEN 1 END) as null_geometry,
      COUNT(CASE WHEN geometry IS NOT NULL AND NOT ST_IsValid(geometry) THEN 1 END) as invalid_geometry,
      COUNT(CASE WHEN length_km IS NULL OR length_km <= 0 THEN 1 END) as zero_or_null_length,
      COUNT(CASE WHEN ST_StartPoint(geometry) = ST_EndPoint(geometry) THEN 1 END) as self_loops,
      COUNT(CASE WHEN ST_Length(geometry) = 0 THEN 1 END) as zero_length_geometry,
      COUNT(CASE WHEN ST_NumPoints(geometry) < 2 THEN 1 END) as single_point_geometry
    FROM ${schemaName}.trails
  `,

  // Schema existence check
  checkSchemaExists: (schemaName: string) => `
    SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1
  `,

  // Data counts
  getTrailCount: (schemaName: string) => `
    SELECT COUNT(*) as count FROM ${schemaName}.trails
  `,

  getNodeCount: (schemaName: string) => `
    SELECT COUNT(*) as count FROM ${schemaName}.ways_noded_vertices_pgr
  `,

  getEdgeCount: (schemaName: string) => `
    SELECT COUNT(*) as count FROM ${schemaName}.ways_noded
  `,

  getIntersectionPointCount: (schemaName: string) => `
    SELECT COUNT(*) as count FROM ${schemaName}.intersection_points
  `,

  // Cleanup
  cleanupSchema: (schemaName: string) => `
    DROP SCHEMA IF EXISTS ${schemaName} CASCADE
  `,

  // Trail details for debugging
  getTrailDetails: (schemaName: string, limit: number = 10) => `
    SELECT app_uuid, name, ST_Length(geometry::geography) as length_meters 
    FROM ${schemaName}.trails 
    WHERE ST_StartPoint(geometry) = ST_EndPoint(geometry)
      AND (ST_Length(geometry) = 0 OR ST_NumPoints(geometry) < 2)
    LIMIT $1
  `
}; 