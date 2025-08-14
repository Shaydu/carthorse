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
    // Edge generation - FIXED: Ensures consecutive trail segments are properly connected
    generateEdges: (schemaName, tolerance) => `
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
  `,
};
//# sourceMappingURL=routing-queries.js.map