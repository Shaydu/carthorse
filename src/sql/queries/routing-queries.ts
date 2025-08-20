// Routing graph SQL queries
export const RoutingQueries = {
  // Intersection detection - Use optimized function
  detectIntersections: (schemaName: string, tolerance: number) => `
    SELECT * FROM detect_trail_intersections_fast($1, 'trails', $2)
  `,

  // Node generation - Use optimized function
  generateNodes: (schemaName: string, tolerance: number) => `
    SELECT generate_routing_nodes_fast($1, $2)
  `,

  // Edge generation - FIXED: Ensures consecutive trail segments are properly connected
  generateEdges: (schemaName: string, tolerance: number) => `
    INSERT INTO ${schemaName}.routing_edges (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry, geojson)
    WITH trail_segments AS (
      SELECT 
        id,
        app_uuid as trail_id,
        name as trail_name,
        geometry,
        ST_Length(geometry::geography) / 1000.0 as length_km,
        elevation_gain,
        elevation_loss
      FROM ${schemaName}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    ),
    connected_segments AS (
      SELECT 
        t1.id,
        t1.trail_id,
        t1.trail_name,
        t1.geometry,
        t1.length_km,
        t1.elevation_gain,
        t1.elevation_loss,
        -- Create source node at start of segment
        ST_X(ST_StartPoint(t1.geometry)) as source_lng,
        ST_Y(ST_StartPoint(t1.geometry)) as source_lat,
        -- Create target node at end of segment
        ST_X(ST_EndPoint(t1.geometry)) as target_lng,
        ST_Y(ST_EndPoint(t1.geometry)) as target_lat,
        -- Generate node IDs based on coordinates
        ROW_NUMBER() OVER (ORDER BY ST_X(ST_StartPoint(t1.geometry)), ST_Y(ST_StartPoint(t1.geometry))) as source_node_id,
        ROW_NUMBER() OVER (ORDER BY ST_X(ST_EndPoint(t1.geometry)), ST_Y(ST_EndPoint(t1.geometry))) as target_node_id
      FROM trail_segments t1
    )
    SELECT 
      source_node_id as source,
      target_node_id as target,
      trail_id,
      trail_name,
      length_km,
      elevation_gain,
      elevation_loss,
      geometry,
      ST_AsGeoJSON(geometry, 6, 0) as geojson
    FROM connected_segments
    ORDER BY trail_id, source_node_id
  `,

  // Network validation
  validateNetwork: (schemaName: string) => `
    WITH node_degrees AS (
      SELECT 
        n.id,
        n.node_type,
        COUNT(DISTINCT e.source) + COUNT(DISTINCT e.target) as degree
      FROM ${schemaName}.routing_nodes n
      LEFT JOIN ${schemaName}.routing_edges e ON n.id = e.source OR n.id = e.target
      GROUP BY n.id, n.node_type
    )
    SELECT 
      node_type,
      COUNT(*) as total_nodes,
      COUNT(CASE WHEN degree = 0 THEN 1 END) as isolated_nodes,
      COUNT(CASE WHEN degree = 1 THEN 1 END) as leaf_nodes,
      COUNT(CASE WHEN degree > 1 THEN 1 END) as connected_nodes,
      AVG(degree) as avg_degree
    FROM node_degrees
    GROUP BY node_type
  `,

  // Cleanup orphaned nodes
  cleanupOrphanedNodes: (schemaName: string) => `
    DELETE FROM ${schemaName}.routing_nodes 
    WHERE id NOT IN (
      SELECT DISTINCT source FROM ${schemaName}.routing_edges 
      UNION 
      SELECT DISTINCT target FROM ${schemaName}.routing_edges
    )
  `,

  // Cleanup orphaned edges
  cleanupOrphanedEdges: (schemaName: string) => `
    DELETE FROM ${schemaName}.routing_edges 
    WHERE source NOT IN (SELECT id FROM ${schemaName}.routing_nodes) 
    OR target NOT IN (SELECT id FROM ${schemaName}.routing_nodes)
  `,

  // Get node type breakdown
  getNodeTypeBreakdown: (schemaName: string) => `
    SELECT node_type, COUNT(*) as count 
    FROM ${schemaName}.routing_nodes 
    GROUP BY node_type
  `,

  // Check for isolated nodes
  checkIsolatedNodes: (schemaName: string) => `
    SELECT COUNT(*) as count
    FROM ${schemaName}.routing_nodes n
    WHERE n.id NOT IN (
      SELECT DISTINCT source FROM ${schemaName}.routing_edges 
      UNION 
      SELECT DISTINCT target FROM ${schemaName}.routing_edges
    )
  `,

  // Check for orphaned edges
  checkOrphanedEdges: (schemaName: string) => `
    SELECT COUNT(*) as count
    FROM ${schemaName}.routing_edges e
    WHERE e.source NOT IN (SELECT id FROM ${schemaName}.routing_nodes) 
    OR e.target NOT IN (SELECT id FROM ${schemaName}.routing_nodes)
  `,
}; 