// Export SQL queries
export const ExportQueries = {
  // Get trails for export
  getTrailsForExport: (schemaName: string) => `
    SELECT 
      *,
      surface as surface_type,
      CASE
        WHEN difficulty = 'unknown' THEN 'moderate'
        ELSE difficulty
      END as difficulty,
      ST_AsGeoJSON(geometry, 6, 0) AS geojson 
    FROM ${schemaName}.trails
  `,

  // Get routing nodes for export
  exportRoutingNodesForGeoJSON: (schemaName: string) => `
    SELECT 
      id, id as node_uuid, ST_Y(the_geom) as lat, ST_X(the_geom) as lng, 0 as elevation, 
      CASE 
        WHEN cnt >= 3 THEN 'intersection'
        WHEN cnt = 1 THEN 'endpoint'
        ELSE 'endpoint'  -- Default to endpoint for any remaining cases
      END as node_type, 
      '' as connected_trails, ARRAY[]::text[] as trail_ids, ST_AsGeoJSON(the_geom) as geojson
    FROM ${schemaName}.ways_noded_vertices_pgr
    WHERE the_geom IS NOT NULL AND cnt != 2  -- Filter out degree-2 connector nodes that should have been merged
    ORDER BY id
  `,

  // Get routing nodes for export  
  exportRoutingNodesForSQLite: (schemaName: string) => `
    SELECT 
      id, id as node_uuid, ST_Y(the_geom) as lat, ST_X(the_geom) as lng, 0 as elevation, 
      CASE 
        WHEN cnt >= 3 THEN 'intersection'
        WHEN cnt = 1 THEN 'endpoint'
        ELSE 'endpoint'  -- Default to endpoint for any remaining cases
      END as node_type, 
      '' as connected_trails, ARRAY[]::text[] as trail_ids, NOW() as created_at
    FROM ${schemaName}.ways_noded_vertices_pgr
    WHERE the_geom IS NOT NULL AND cnt != 2  -- Filter out degree-2 connector nodes that should have been merged
    ORDER BY id
  `,

  // Get routing edges for export (single source of truth: ways_noded)
  getRoutingEdgesForExport: (schemaName: string) => `
    SELECT 
      id,                        -- Integer ID (pgRouting domain)
      source,                    -- Integer source vertex ID
      target,                    -- Integer target vertex ID
      app_uuid as trail_id,      -- UUID trail identifier (app domain)
      name as trail_name,        -- Human-readable trail name
      length_km,
      elevation_gain,
      elevation_loss,
      true as is_bidirectional,  -- Default to bidirectional
      NOW() as created_at,
      ST_AsGeoJSON(the_geom, 6, 0) AS geojson
    FROM ${schemaName}.ways_noded
    WHERE source IS NOT NULL AND target IS NOT NULL
    ORDER BY id
  `,

  // Get route recommendations for export
  getRouteRecommendationsForExport: (schemaName: string) => `
    SELECT 
      route_uuid,
      region,
              input_length_km,
        input_elevation_gain,
        recommended_length_km,
      recommended_elevation_gain,
      route_type,
      route_shape,
      trail_count,
      route_score,
      route_path,
      route_edges,
      route_name,
      created_at
    FROM ${schemaName}.route_recommendations
  `,

  // Get routing nodes with fallback values
  getRoutingNodesForExportWithFallbacks: (schemaName: string) => `
    SELECT 
      id,
      COALESCE(node_uuid, gen_random_uuid()::text) as node_uuid,
      lat,
      lng,
      elevation,
      COALESCE(node_type, 'intersection') as node_type,
      COALESCE(connected_trails, '') as connected_trails,
      NOW() as created_at
    FROM ${schemaName}.routing_nodes
  `,

  // Get routing edges with distance column
  getRoutingEdgesForExportWithDistance: (schemaName: string) => `
    SELECT 
      id,
      source,
      target,
      app_uuid as trail_id,      -- ✅ Use ways_noded column mapping
      name as trail_name,        -- ✅ Use ways_noded column mapping
      length_km,
      ST_AsGeoJSON(the_geom, 6, 0) AS geojson,  -- ✅ Use ways_noded geometry
      NOW() as created_at
    FROM ${schemaName}.ways_noded
    WHERE source IS NOT NULL AND target IS NOT NULL
  `,

  // Check if route recommendations exist
  checkRouteRecommendationsExist: (schemaName: string) => `
    SELECT COUNT(*) as count FROM ${schemaName}.route_recommendations
  `,

  // Get export statistics
  getExportStats: (schemaName: string) => `
    SELECT 
      (SELECT COUNT(*) FROM ${schemaName}.trails) as trail_count,
      (SELECT COUNT(*) FROM ${schemaName}.ways_noded_vertices_pgr) as node_count,
      (SELECT COUNT(*) FROM ${schemaName}.ways_noded) as edge_count,
      (SELECT COUNT(*) FROM ${schemaName}.route_recommendations) as recommendation_count
  `,

  // Get network statistics
  getNetworkStatistics: (schemaName: string) => `
    SELECT 
      (SELECT COUNT(*) FROM ${schemaName}.trails) as trail_count,
      (SELECT COUNT(*) FROM ${schemaName}.ways_noded_vertices_pgr) as node_count,
      (SELECT COUNT(*) FROM ${schemaName}.ways_noded) as edge_count,
      (SELECT COUNT(*) FROM ${schemaName}.route_recommendations) as route_count
  `
}; 