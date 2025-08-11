"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoutingQueries = void 0;
// Routing graph SQL queries
exports.RoutingQueries = {
    // Intersection detection
    detectIntersections: (schemaName, tolerance) => `
    SELECT * FROM detect_trail_intersections($1, 'trails', $2)
  `,
    // Node generation
    generateNodes: (schemaName, tolerance) => `
    INSERT INTO ${schemaName}.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids, created_at)
    WITH valid_trails AS (
      SELECT app_uuid, name, geometry
      FROM ${schemaName}.trails 
      WHERE geometry IS NOT NULL 
      AND ST_IsValid(geometry)
      AND ST_Length(geometry) > 0
    ),
    trail_endpoints AS (
      SELECT 
        app_uuid,
        name,
        ST_StartPoint(geometry) as start_point,
        ST_EndPoint(geometry) as end_point,
        ST_Z(ST_StartPoint(geometry)) as start_elevation,
        ST_Z(ST_EndPoint(geometry)) as end_elevation
      FROM valid_trails
    ),
    all_endpoints AS (
      SELECT 
        app_uuid,
        name,
        start_point as point,
        start_elevation as elevation,
        'endpoint' as node_type,
        name as connected_trails,
        ARRAY[app_uuid] as trail_ids
      FROM trail_endpoints
      UNION ALL
      SELECT 
        app_uuid,
        name,
        end_point as point,
        end_elevation as elevation,
        'endpoint' as node_type,
        name as connected_trails,
        ARRAY[app_uuid] as trail_ids
      FROM trail_endpoints
    ),
    intersection_points AS (
      SELECT 
        ip.intersection_point as point,
        COALESCE(ST_Z(ip.intersection_point_3d), 0) as elevation,
        'intersection' as node_type,
        array_to_string(ip.connected_trail_names, ',') as connected_trails,
        array_agg(t.app_uuid) as trail_ids
      FROM detect_trail_intersections($1, 'trails', $2) ip
      JOIN ${schemaName}.trails t ON t.id = ANY(ip.connected_trail_ids)
      WHERE array_length(ip.connected_trail_ids, 1) > 1
      GROUP BY ip.intersection_point, ip.intersection_point_3d, ip.connected_trail_names
    ),
    all_nodes AS (
      SELECT point, elevation, node_type, connected_trails, trail_ids
      FROM all_endpoints
      WHERE point IS NOT NULL
      UNION ALL
      SELECT point, elevation, node_type, connected_trails, trail_ids
      FROM intersection_points
      WHERE point IS NOT NULL
    ),
    unique_nodes AS (
      SELECT DISTINCT
        point,
        elevation,
        node_type,
        connected_trails,
        trail_ids
      FROM all_nodes
      WHERE point IS NOT NULL
    ),
    clustered_nodes AS (
      SELECT 
        point as clustered_point,
        elevation,
        node_type,
        connected_trails,
        trail_ids
      FROM unique_nodes
      WHERE point IS NOT NULL
    )
    SELECT 
      ROW_NUMBER() OVER (ORDER BY ST_X(clustered_point), ST_Y(clustered_point)) as id,
      gen_random_uuid() as node_uuid,
      ST_Y(clustered_point) as lat,
      ST_X(clustered_point) as lng,
      elevation,
      node_type,
      connected_trails,
      trail_ids,
      NOW() as created_at
    FROM clustered_nodes
    WHERE clustered_point IS NOT NULL
  `,
    // Edge generation
    generateEdges: (schemaName, tolerance) => `
    INSERT INTO ${schemaName}.routing_edges (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry, geojson)
    SELECT 
      start_node.id as source, 
      end_node.id as target, 
      t.app_uuid as trail_id, 
      t.name as trail_name, 
      t.length_km as length_km, 
      t.elevation_gain, 
      t.elevation_loss, 
      ST_MakeLine(
        ST_SetSRID(ST_MakePoint(start_node.lng, start_node.lat), 4326),
        ST_SetSRID(ST_MakePoint(end_node.lng, end_node.lat), 4326)
      ) as geometry,
      ST_AsGeoJSON(
        ST_MakeLine(
          ST_SetSRID(ST_MakePoint(start_node.lng, start_node.lat), 4326),
          ST_SetSRID(ST_MakePoint(end_node.lng, end_node.lat), 4326)
        ), 6, 0
      ) as geojson 
    FROM ${schemaName}.trails t
    JOIN LATERAL (
      SELECT n.id, n.lng, n.lat
      FROM ${schemaName}.routing_nodes n
      WHERE t.app_uuid = ANY(n.trail_ids)
      ORDER BY ST_Distance(ST_StartPoint(t.geometry), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
      LIMIT 1
    ) start_node ON true
    JOIN LATERAL (
      SELECT n.id, n.lng, n.lat
      FROM ${schemaName}.routing_nodes n
      WHERE t.app_uuid = ANY(n.trail_ids)
      ORDER BY ST_Distance(ST_EndPoint(t.geometry), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
      LIMIT 1
    ) end_node ON true
    WHERE t.geometry IS NOT NULL 
    AND ST_IsValid(t.geometry) 
    AND t.length_km > 0
    AND start_node.id IS NOT NULL 
    AND end_node.id IS NOT NULL
    AND start_node.id <> end_node.id
    AND NOT EXISTS (
      SELECT 1 FROM ${schemaName}.routing_edges e 
      WHERE e.trail_id = t.app_uuid
    )
  `,
    // Network validation
    validateNetwork: (schemaName) => `
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
    cleanupOrphanedNodes: (schemaName) => `
    DELETE FROM ${schemaName}.routing_nodes 
    WHERE id NOT IN (
      SELECT DISTINCT source FROM ${schemaName}.routing_edges 
      UNION 
      SELECT DISTINCT target FROM ${schemaName}.routing_edges
    )
  `,
    // Cleanup orphaned edges
    cleanupOrphanedEdges: (schemaName) => `
    DELETE FROM ${schemaName}.routing_edges 
    WHERE source NOT IN (SELECT id FROM ${schemaName}.routing_nodes) 
    OR target NOT IN (SELECT id FROM ${schemaName}.routing_nodes)
  `,
    // Get node type breakdown
    getNodeTypeBreakdown: (schemaName) => `
    SELECT node_type, COUNT(*) as count 
    FROM ${schemaName}.routing_nodes 
    GROUP BY node_type
  `,
    // Check for isolated nodes
    checkIsolatedNodes: (schemaName) => `
    SELECT COUNT(*) as count
    FROM ${schemaName}.routing_nodes n
    WHERE n.id NOT IN (
      SELECT DISTINCT source FROM ${schemaName}.routing_edges 
      UNION 
      SELECT DISTINCT target FROM ${schemaName}.routing_edges
    )
  `,
    // Check for orphaned edges
    checkOrphanedEdges: (schemaName) => `
    SELECT COUNT(*) as count
    FROM ${schemaName}.routing_edges e
    WHERE e.source NOT IN (SELECT id FROM ${schemaName}.routing_nodes) 
    OR e.target NOT IN (SELECT id FROM ${schemaName}.routing_nodes)
  `
};
//# sourceMappingURL=routing-queries.js.map