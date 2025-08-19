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
    SELECT DISTINCT ON (name, ST_Length(geometry::geography))
      app_uuid as original_trail_uuid,  -- Preserve original UUID
      gen_random_uuid() as app_uuid,    -- Generate new UUID for staging
      name, trail_type, surface, difficulty,
      geometry, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, osm_id
    FROM ${sourceSchema}.trails 
    WHERE region = $1 
    ${bbox ? 'AND ST_Intersects(geometry, ST_MakeEnvelope($2, $3, $4, $5, 4326))' : ''}
    ORDER BY name, ST_Length(geometry::geography), app_uuid
  `,

  // Deduplicated data copying with geometry similarity check
  copyTrailsDeduplicated: (sourceSchema: string, targetSchema: string, region: string, bbox?: BBoxOrNull) => `
    INSERT INTO ${targetSchema}.trails (
      original_trail_uuid, app_uuid, name, trail_type, surface, difficulty,
      geometry, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, osm_id
    )
    SELECT 
      t1.app_uuid as original_trail_uuid,
      gen_random_uuid() as app_uuid,
      t1.name, t1.trail_type, t1.surface, t1.difficulty,
      t1.geometry, t1.length_km, t1.elevation_gain, t1.elevation_loss, 
      t1.max_elevation, t1.min_elevation, t1.avg_elevation,
      t1.bbox_min_lng, t1.bbox_max_lng, t1.bbox_min_lat, t1.bbox_max_lat, 
      t1.source, t1.source_tags, t1.osm_id
    FROM ${sourceSchema}.trails t1
    WHERE t1.region = $1 
    ${bbox ? 'AND ST_Intersects(t1.geometry, ST_MakeEnvelope($2, $3, $4, $5, 4326))' : ''}
    AND NOT EXISTS (
      SELECT 1 FROM ${sourceSchema}.trails t2
      WHERE t2.region = t1.region
        AND t2.name = t1.name
        AND t2.app_uuid != t1.app_uuid
        AND (
          -- Check if geometries are very similar (within 1 meter tolerance)
          ST_DWithin(t1.geometry::geography, t2.geometry::geography, 1.0)
          OR
          -- Check if they have the same length (within 0.1% tolerance)
          ABS(ST_Length(t1.geometry::geography) - ST_Length(t2.geometry::geography)) < 0.001
        )
        AND t2.app_uuid < t1.app_uuid  -- Keep the one with smaller UUID
    )
    ORDER BY t1.name, ST_Length(t1.geometry::geography), t1.app_uuid
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