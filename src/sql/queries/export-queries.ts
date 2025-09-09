// Export SQL queries
export const ExportQueries = {
  // Create export-ready tables in staging schema
  createExportReadyTables: (schemaName: string) => `
    -- Create export-ready nodes table with pre-computed degree counts
    CREATE TABLE IF NOT EXISTS ${schemaName}.export_nodes AS
    SELECT 
      v.id,
      v.cnt,
      ST_Y(v.the_geom) as lat,
      ST_X(v.the_geom) as lng,
      ST_AsGeoJSON(v.the_geom, 6, 0) as geojson,
      COALESCE(degree_counts.degree, 0) as degree,
      CASE 
        WHEN COALESCE(degree_counts.degree, 0) >= 3 THEN 'intersection'
        WHEN COALESCE(degree_counts.degree, 0) = 2 THEN 'connector'
        WHEN COALESCE(degree_counts.degree, 0) = 1 THEN 'endpoint'
        ELSE 'unknown'
      END as node_type
    FROM ${schemaName}.ways_noded_vertices_pgr v
    LEFT JOIN (
      SELECT 
        vertex_id,
        COUNT(*) as degree
      FROM (
        SELECT source as vertex_id FROM ${schemaName}.ways_noded WHERE source IS NOT NULL
        UNION ALL
        SELECT target as vertex_id FROM ${schemaName}.ways_noded WHERE target IS NOT NULL
      ) all_vertices
      GROUP BY vertex_id
    ) degree_counts ON v.id = degree_counts.vertex_id
    ORDER BY v.id;
  `,

  // Create export-ready trail vertices table
  createExportTrailVerticesTable: (schemaName: string) => `
    CREATE TABLE IF NOT EXISTS ${schemaName}.export_trail_vertices AS
    WITH trail_vertices AS (
      SELECT 
        t.id as trail_id,
        t.app_uuid as trail_uuid,
        t.name as trail_name,
        ST_StartPoint(t.geometry) as start_pt,
        ST_EndPoint(t.geometry) as end_pt,
        ST_AsText(ST_StartPoint(t.geometry)) as start_coords,
        ST_AsText(ST_EndPoint(t.geometry)) as end_coords
      FROM ${schemaName}.trails t
      WHERE t.geometry IS NOT NULL
    ),
    all_vertices AS (
      SELECT 
        trail_id,
        trail_uuid,
        trail_name,
        'start' as vertex_type,
        start_pt as the_geom,
        start_coords as coords
      FROM trail_vertices
      UNION ALL
      SELECT 
        trail_id,
        trail_uuid,
        trail_name,
        'end' as vertex_type,
        end_pt as the_geom,
        end_coords as coords
      FROM trail_vertices
    ),
    degree_counts AS (
      SELECT 
        vertex_coords,
        COUNT(*) as degree
      FROM (
        SELECT ST_AsText(start_pt) as vertex_coords FROM trail_vertices
        UNION ALL
        SELECT ST_AsText(end_pt) as vertex_coords FROM trail_vertices
      ) all_coords
      GROUP BY vertex_coords
    )
    SELECT 
      ROW_NUMBER() OVER (ORDER BY av.trail_id, av.vertex_type) as id,
      av.trail_uuid as node_uuid,
      ST_Y(av.the_geom) as lat,
      ST_X(av.the_geom) as lng,
      0 as elevation,
      av.vertex_type as node_type,
      av.trail_name as connected_trails,
      ARRAY[av.trail_uuid]::TEXT[] as trail_ids,
      ST_AsGeoJSON(av.the_geom) as geojson,
      COALESCE(dc.degree, 0) as degree
    FROM all_vertices av
    LEFT JOIN degree_counts dc ON ST_AsText(av.the_geom) = dc.vertex_coords
    WHERE av.the_geom IS NOT NULL
    ORDER BY av.trail_id, av.vertex_type;
  `,

  // Create export-ready edges table
  createExportEdgesTable: (schemaName: string, includeCompositionData: boolean = false) => `
    CREATE TABLE IF NOT EXISTS ${schemaName}.export_edges AS
    SELECT 
      wn.id,
      wn.source,
      wn.target,
      COALESCE(REPLACE(wn.original_trail_uuid::text, E'\n', ' '), 'edge-' || wn.id) as trail_id,
      COALESCE(wn.original_trail_name, 'Unnamed Trail') as trail_name,
      wn.length_km as length_km,
      COALESCE(wn.elevation_gain, 0) as elevation_gain,
      COALESCE(wn.elevation_loss, 0) as elevation_loss,
      ST_AsGeoJSON(wn.the_geom, 6, 0) as geojson,
      -- Add composition information (only if enabled and table exists)
      CASE 
        WHEN ${includeCompositionData} AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${schemaName}' AND table_name = 'edge_trail_composition')
        THEN (
          SELECT COALESCE(
            json_agg(
              json_build_object(
                'trail_uuid', etc.trail_uuid,
                'trail_name', etc.trail_name,
                'segment_percentage', etc.segment_percentage,
                'composition_type', etc.composition_type
              ) ORDER BY etc.segment_sequence
            ),
            '[]'::json
          )
          FROM ${schemaName}.edge_trail_composition etc
          WHERE etc.edge_id = wn.id
        )
        ELSE '[]'::json
      END as trail_composition
    FROM ${schemaName}.ways_noded wn
    WHERE wn.source IS NOT NULL AND wn.target IS NOT NULL
    ORDER BY wn.id;
  `,

  // Create export-ready routes table
  createExportRoutesTable: (schemaName: string) => `
    CREATE TABLE IF NOT EXISTS ${schemaName}.export_routes AS
    SELECT 
      rr.id,
      COALESCE(rr.route_name, 'Unnamed Route') AS name,
      NULL::text AS description,
      rr.recommended_length_km AS distance_km,
      rr.recommended_elevation_gain AS elevation_gain,
      NULL::real AS elevation_loss,
      NULL::text AS difficulty,
      NULL::text AS route_type,
      NULL::text AS color,
      ST_AsGeoJSON(rr.route_geometry, 6, 0) as geojson
    FROM ${schemaName}.route_recommendations rr
    WHERE rr.route_geometry IS NOT NULL
    ORDER BY rr.created_at DESC, rr.id;
  `,

  // Simple queries to read from export-ready tables
  getExportNodes: (schemaName: string) => `
    SELECT * FROM ${schemaName}.export_nodes ORDER BY id
  `,

  getExportTrailVertices: (schemaName: string) => `
    SELECT * FROM ${schemaName}.export_trail_vertices ORDER BY id
  `,

  getExportEdges: (schemaName: string) => `
    SELECT * FROM ${schemaName}.export_edges ORDER BY id
  `,

  getExportRoutes: (schemaName: string) => `
    SELECT 
      *,
      CASE 
        WHEN route_shape = 'loop' THEN 'Loop Route'
        WHEN route_shape = 'out-and-back' THEN 'Out-and-Back Route'
        WHEN route_shape = 'point-to-point' THEN 'Point-to-Point Route'
        ELSE 'Unknown Route Type'
      END as route_shape_display,
      CASE 
        WHEN route_shape = 'loop' THEN '#FF6B6B'        -- Red for loops
        WHEN route_shape = 'out-and-back' THEN '#4ECDC4' -- Teal for out-and-back
        WHEN route_shape = 'point-to-point' THEN '#45B7D1' -- Blue for point-to-point
        ELSE '#95A5A6'                                   -- Gray for unknown
      END as route_color
    FROM ${schemaName}.route_recommendations 
    WHERE route_geometry_geojson IS NOT NULL
    ORDER BY route_score DESC, created_at DESC
  `,

  // Get trails for export
  getTrailsForExport: (schemaName: string) => `
    SELECT 
      *,
      COALESCE(surface, 'unknown') as surface_type,
      CASE
        WHEN difficulty = 'unknown' OR difficulty IS NULL THEN 'moderate'
        ELSE difficulty
      END as difficulty,
      ST_AsGeoJSON(geometry, 6, 0) AS geojson 
    FROM ${schemaName}.trails
  `,

  // Get routing nodes for export
  exportRoutingNodesForGeoJSON: (schemaName: string) => `
    SELECT 
      v.id, 
      'node-' || v.id::text as node_uuid, 
      ST_Y(v.the_geom) as lat, 
      ST_X(v.the_geom) as lng, 
      COALESCE(ST_Z(v.the_geom), 0) as elevation, 
      CASE 
        WHEN COALESCE(degree_counts.degree, 0) >= 3 THEN 'intersection'
        WHEN COALESCE(degree_counts.degree, 0) = 2 THEN 'connector'
        WHEN COALESCE(degree_counts.degree, 0) = 1 THEN 'endpoint'
        ELSE 'unknown'
      END as node_type, 
      '' as connected_trails, 
      ARRAY[]::text[] as trail_ids, 
      ST_AsGeoJSON(v.the_geom) as geojson,
      COALESCE(degree_counts.degree, 0) as degree
    FROM ${schemaName}.ways_noded_vertices_pgr v
    LEFT JOIN (
      SELECT 
        vertex_id,
        COUNT(*) as degree
      FROM (
        SELECT source as vertex_id FROM ${schemaName}.ways_noded WHERE source IS NOT NULL
        UNION ALL
        SELECT target as vertex_id FROM ${schemaName}.ways_noded WHERE target IS NOT NULL
      ) all_vertices
      GROUP BY vertex_id
    ) degree_counts ON v.id = degree_counts.vertex_id
    ORDER BY v.id
  `,

  // Get routing nodes for export
  exportRoutingNodesForSQLite: (schemaName: string) => `
    SELECT 
      v.id, 
      v.id as node_uuid, 
      ST_Y(v.the_geom) as lat, 
      ST_X(v.the_geom) as lng, 
      0 as elevation, 
      v.node_type, 
      '' as connected_trails, 
      ARRAY[]::text[] as trail_ids, 
      NOW() as created_at,
      COALESCE(degree_counts.degree, 0) as degree
    FROM ${schemaName}.ways_noded_vertices_pgr v
    LEFT JOIN (
      SELECT 
        vertex_id,
        COUNT(*) as degree
      FROM (
        SELECT source as vertex_id FROM ${schemaName}.ways_noded WHERE source IS NOT NULL
        UNION ALL
        SELECT target as vertex_id FROM ${schemaName}.ways_noded WHERE target IS NOT NULL
      ) all_vertices
      GROUP BY vertex_id
    ) degree_counts ON v.id = degree_counts.vertex_id
    WHERE v.the_geom IS NOT NULL
    ORDER BY v.id
  `,

  // Get original trail vertices for export (from trail geometries)
  exportTrailVerticesForGeoJSON: (schemaName: string) => `
    WITH trail_vertices AS (
      SELECT 
        t.id as trail_id,
        t.app_uuid as trail_uuid,
        t.name as trail_name,
        ST_StartPoint(t.geometry) as start_pt,
        ST_EndPoint(t.geometry) as end_pt,
        ST_AsText(ST_StartPoint(t.geometry)) as start_coords,
        ST_AsText(ST_EndPoint(t.geometry)) as end_coords
      FROM ${schemaName}.trails t
      WHERE t.geometry IS NOT NULL
    ),
    all_vertices AS (
      SELECT 
        trail_id,
        trail_uuid,
        trail_name,
        'start' as vertex_type,
        start_pt as the_geom,
        start_coords as coords
      FROM trail_vertices
      UNION ALL
      SELECT 
        trail_id,
        trail_uuid,
        trail_name,
        'end' as vertex_type,
        end_pt as the_geom,
        end_coords as coords
      FROM trail_vertices
    )
    SELECT 
      ROW_NUMBER() OVER (ORDER BY trail_id, vertex_type) as id,
      trail_uuid as node_uuid,
      ST_Y(the_geom) as lat,
      ST_X(the_geom) as lng,
      0 as elevation,
      vertex_type as node_type,
      trail_name as connected_trails,
      ARRAY[trail_uuid] as trail_ids,
      ST_AsGeoJSON(the_geom) as geojson,
      0 as degree  -- Original trail vertices don't have network degree
    FROM all_vertices
    WHERE the_geom IS NOT NULL
    ORDER BY trail_id, vertex_type
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

  // Get route recommendations for export with color coding
  getRouteRecommendationsForExport: (schemaName: string) => `
    SELECT 
      route_uuid,
      'boulder' as region,  -- Add region column for SQLite export
      input_length_km,
      input_elevation_gain,
      recommended_length_km,
      recommended_elevation_gain,
      route_shape,
      trail_count,
      route_score,
      route_path,
      route_edges,
      route_name,
      created_at,
      CASE 
        WHEN route_shape = 'loop' THEN '#FF6B6B'        -- Red for loops
        WHEN route_shape = 'out-and-back' THEN '#4ECDC4' -- Teal for out-and-back
        WHEN route_shape = 'point-to-point' THEN '#45B7D1' -- Blue for point-to-point
        ELSE '#95A5A6'                                   -- Gray for unknown
      END as route_color,
      CASE 
        WHEN route_shape = 'loop' THEN 'Loop Route'
        WHEN route_shape = 'out-and-back' THEN 'Out-and-Back Route'
        WHEN route_shape = 'point-to-point' THEN 'Point-to-Point Route'
        ELSE 'Unknown Route Type'
      END as route_shape_display
    FROM ${schemaName}.route_recommendations
    WHERE route_shape = 'loop'  -- Only export loop routes
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
      (SELECT COUNT(*) FROM ${schemaName}.trails WHERE id IS NOT NULL) as trail_count,
      (SELECT COUNT(*) FROM ${schemaName}.ways_noded_vertices_pgr WHERE id IS NOT NULL) as node_count,
      (SELECT COUNT(*) FROM ${schemaName}.ways_noded WHERE id IS NOT NULL) as edge_count,
      (SELECT COUNT(*) FROM ${schemaName}.route_recommendations WHERE id IS NOT NULL) as recommendation_count
  `,

  // Get network statistics
  getNetworkStatistics: (schemaName: string) => `
    SELECT 
      (SELECT COUNT(*) FROM ${schemaName}.trails WHERE id IS NOT NULL) as trail_count,
      (SELECT COUNT(*) FROM ${schemaName}.ways_noded_vertices_pgr WHERE id IS NOT NULL) as node_count,
      (SELECT COUNT(*) FROM ${schemaName}.ways_noded WHERE id IS NOT NULL) as edge_count,
      (SELECT COUNT(*) FROM ${schemaName}.route_recommendations WHERE id IS NOT NULL) as route_count
  `
}; 