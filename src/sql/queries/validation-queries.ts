// Validation SQL queries
export const ValidationQueries = {
  // Check schema version
  checkSchemaVersion: () => `
    SELECT version FROM schema_version ORDER BY id DESC LIMIT 1
  `,

  // Check required functions
  checkRequiredFunctions: (requiredFunctions: string[]) => `
    SELECT proname FROM pg_proc WHERE proname = ANY($1)
  `,

  // Check required tables
  checkRequiredTables: (requiredTables: string[]) => `
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = ANY($1)
  `,

  // Check data availability
  checkDataAvailability: (region: string, bbox?: [number, number, number, number]) => {
    let query = `SELECT COUNT(*) as count FROM public.trails WHERE region = $1`;
    const params: any[] = [region];
    let paramIndex = 2;
    
    if (bbox && bbox.length === 4) {
      const [bboxMinLng, bboxMinLat, bboxMaxLng, bboxMaxLat] = bbox;
      query += ` AND ST_Intersects(geometry, ST_MakeEnvelope($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, 4326))`;
      params.push(bboxMinLng, bboxMinLat, bboxMaxLng, bboxMaxLat);
    }
    
    return { query, params };
  },

  // Get available regions
  getAvailableRegions: () => `
    SELECT DISTINCT region, COUNT(*) as count 
    FROM trails 
    WHERE region IS NOT NULL 
    GROUP BY region 
    ORDER BY count DESC
  `,

  // Validate trail data
  validateTrailData: (schemaName: string) => `
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

  // Validate bbox data
  validateBboxData: (schemaName: string) => `
    SELECT 
      COUNT(*) as total_trails,
      COUNT(CASE WHEN bbox_min_lng IS NULL OR bbox_max_lng IS NULL OR bbox_min_lat IS NULL OR bbox_max_lat IS NULL THEN 1 END) as null_bbox,
      COUNT(CASE WHEN bbox_min_lng >= bbox_max_lng OR bbox_min_lat >= bbox_max_lat THEN 1 END) as invalid_bbox
    FROM ${schemaName}.trails
  `,

  // Validate geometry data
  validateGeometryData: (schemaName: string) => `
    SELECT 
      COUNT(*) as total_trails,
      COUNT(CASE WHEN geometry IS NULL THEN 1 END) as null_geometry,
      COUNT(CASE WHEN NOT ST_IsValid(geometry) THEN 1 END) as invalid_geometry,
      COUNT(CASE WHEN ST_NDims(geometry) != 3 THEN 1 END) as non_3d_geometry,
      COUNT(CASE WHEN ST_SRID(geometry) != 4326 THEN 1 END) as wrong_srid
    FROM ${schemaName}.trails
  `,

  // Network validation
  validateRoutingNetwork: (schemaName: string) => `
    SELECT
      COUNT(*) as total_nodes,
      COUNT(CASE WHEN cnt = 0 THEN 1 END) as isolated_nodes,
      COUNT(CASE WHEN cnt = 1 THEN 1 END) as leaf_nodes,
      COUNT(CASE WHEN cnt > 1 THEN 1 END) as connected_nodes,
      AVG(cnt) as avg_degree
    FROM ${schemaName}.ways_noded_vertices_pgr
  `,

  // Check for orphaned nodes
  checkOrphanedNodes: (schemaName: string) => `
    SELECT COUNT(*) as count
    FROM ${schemaName}.ways_noded_vertices_pgr n
    WHERE n.id NOT IN (
      SELECT DISTINCT source FROM ${schemaName}.ways_noded 
      UNION 
      SELECT DISTINCT target FROM ${schemaName}.ways_noded
    )
  `,

  // Check for orphaned edges
  checkOrphanedEdges: (schemaName: string) => `
    SELECT COUNT(*) as count
    FROM ${schemaName}.ways_noded e
    WHERE e.source NOT IN (SELECT id FROM ${schemaName}.ways_noded_vertices_pgr) 
    OR e.target NOT IN (SELECT id FROM ${schemaName}.ways_noded_vertices_pgr)
  `,

  // Get trail details for debugging
  getTrailDetailsForDebugging: (schemaName: string, limit: number = 10) => `
    SELECT app_uuid, name, ST_Length(geometry::geography) as length_meters 
    FROM ${schemaName}.trails 
    WHERE ST_StartPoint(geometry) = ST_EndPoint(geometry)
      AND (ST_Length(geometry) = 0 OR ST_NumPoints(geometry) < 2)
    LIMIT $1
  `,

  // Check PostGIS extension
  checkPostgisExtension: () => `
    SELECT extname FROM pg_extension WHERE extname = 'postgis'
  `,

  // Check schema existence
  checkSchemaExists: (schemaName: string) => `
    SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1
  `,

  // Check table existence
  checkTableExists: (schemaName: string, tableName: string) => `
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = $1 AND table_name = $2
  `
}; 