import { Client } from 'pg';

/**
 * Helper for routing graph creation (nodes and edges), refactored from orchestrator (2024-07-23).
 * Returns node/edge counts and validation results.
 */
export interface RoutingGraphResult {
  nodeCount: number;
  edgeCount: number;
  validation: any[];
  stats: any;
}

export async function buildRoutingGraphHelper(
  pgClient: Client,
  stagingSchema: string,
  trailsTable: string,
  intersectionTolerance: number,
  edgeTolerance: number
): Promise<RoutingGraphResult> {
  // Clear existing routing data
  await pgClient.query(`DELETE FROM ${stagingSchema}.routing_edges`);
  await pgClient.query(`DELETE FROM ${stagingSchema}.routing_nodes`);

  // Use native PostGIS functions to create intersection nodes
  const intersectionNodesResult = await pgClient.query(`
    INSERT INTO ${stagingSchema}.routing_nodes (lat, lng, elevation, node_type, connected_trails)
    SELECT DISTINCT
      ST_Y(ST_Intersection(t1.geo2, t2.geo2)) as lat,
      ST_X(ST_Intersection(t1.geo2, t2.geo2)) as lng,
      COALESCE(ST_Z(ST_Intersection(t1.geo2, t2.geo2)), 0) as elevation,
      'intersection' as node_type,
      t1.app_uuid || ',' || t2.app_uuid as connected_trails
    FROM ${stagingSchema}.${trailsTable} t1
    JOIN ${stagingSchema}.${trailsTable} t2 ON t1.id < t2.id
    WHERE ST_Intersects(t1.geo2, t2.geo2)
      AND ST_GeometryType(ST_Intersection(t1.geo2, t2.geo2)) = 'ST_Point'
  `);
  
  // Use native PostGIS functions to create endpoint nodes (not at intersections)
  const endpointNodesResult = await pgClient.query(`
    INSERT INTO ${stagingSchema}.routing_nodes (lat, lng, elevation, node_type, connected_trails)
    WITH trail_endpoints AS (
      SELECT
        ST_StartPoint(ST_Force2D(geo2)) as start_point,
        ST_EndPoint(ST_Force2D(geo2)) as end_point,
        app_uuid, name
      FROM ${stagingSchema}.${trailsTable}
      WHERE geo2 IS NOT NULL AND ST_IsValid(geo2)
    ),
    all_endpoints AS (
      SELECT start_point as point, app_uuid, name FROM trail_endpoints
      UNION ALL
      SELECT end_point as point, app_uuid, name FROM trail_endpoints
    ),
    unique_endpoints AS (
      SELECT DISTINCT ON (ST_AsText(point))
        point,
        array_agg(DISTINCT app_uuid) as connected_trails
      FROM all_endpoints
      GROUP BY point
    ),
    endpoints_not_at_intersections AS (
      SELECT ue.point, ue.connected_trails
      FROM unique_endpoints ue
      WHERE NOT EXISTS (
        SELECT 1 FROM ${stagingSchema}.routing_nodes rn
        WHERE rn.node_type = 'intersection'
          AND ST_DWithin(ue.point, ST_SetSRID(ST_MakePoint(rn.lng, rn.lat), 4326), ${intersectionTolerance})
      )
    )
    SELECT
      ST_Y(point) as lat,
      ST_X(point) as lng,
      0 as elevation,
      'endpoint' as node_type,
      array_to_string(connected_trails, ',') as connected_trails
    FROM endpoints_not_at_intersections
    WHERE point IS NOT NULL
  `);
  
  // Use native PostGIS functions to create routing edges
  const edgesResult = await pgClient.query(`
    INSERT INTO ${stagingSchema}.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, geo2)
    WITH trail_segments AS (
      SELECT app_uuid, name, ST_Force2D(geo2) as geom, elevation_gain,
             ST_StartPoint(ST_Force2D(geo2)) as start_point,
             ST_EndPoint(ST_Force2D(geo2)) as end_point
      FROM ${stagingSchema}.${trailsTable}
      WHERE geo2 IS NOT NULL AND ST_IsValid(geo2)
    ),
    node_connections AS (
      SELECT ts.app_uuid as trail_id, ts.name as trail_name, ts.geom, ts.elevation_gain,
             fn.id as from_node_id, tn.id as to_node_id
      FROM trail_segments ts
      LEFT JOIN LATERAL (
        SELECT n.id
        FROM ${stagingSchema}.routing_nodes n
        WHERE ST_DWithin(ts.start_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), ${edgeTolerance})
        ORDER BY ST_Distance(ts.start_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
        LIMIT 1
      ) fn ON true
      LEFT JOIN LATERAL (
        SELECT n.id
        FROM ${stagingSchema}.routing_nodes n
        WHERE ST_DWithin(ts.end_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), ${edgeTolerance})
        ORDER BY ST_Distance(ts.end_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
        LIMIT 1
      ) tn ON true
    )
    SELECT
      from_node_id,
      to_node_id,
      trail_id,
      trail_name,
      ST_Length(geom::geography) / 1000 as distance_km,
      COALESCE(elevation_gain, 0) as elevation_gain,
      geom as geo2
    FROM node_connections
    WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL AND from_node_id <> to_node_id
  `);
  
  // Get counts
  const nodeCountResult = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_nodes`);
  const edgeCountResult = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_edges`);
  
  const nodeCount = nodeCountResult.rows[0]?.count ?? 0;
  const edgeCount = edgeCountResult.rows[0]?.count ?? 0;

  // Simple validation - check that we have reasonable node/edge counts
  const validation = [
    { check: 'node_count', value: nodeCount, status: nodeCount > 0 ? 'PASS' : 'FAIL' },
    { check: 'edge_count', value: edgeCount, status: edgeCount > 0 ? 'PASS' : 'FAIL' },
    { check: 'node_to_edge_ratio', value: nodeCount > 0 ? edgeCount / nodeCount : 0, status: 'INFO' }
  ];

  // Simple stats
  const stats = {
    total_nodes: nodeCount,
    total_edges: edgeCount,
    intersection_nodes: 0,
    endpoint_nodes: 0
  };

  // Get node type breakdown
  try {
    const nodeTypes = await pgClient.query(`
      SELECT node_type, COUNT(*) as count 
      FROM ${stagingSchema}.routing_nodes 
      GROUP BY node_type
    `);
    
    for (const row of nodeTypes.rows) {
      if (row.node_type === 'intersection') {
        stats.intersection_nodes = row.count;
      } else if (row.node_type === 'endpoint') {
        stats.endpoint_nodes = row.count;
      }
    }
  } catch (error) {
    console.warn('Could not get node type breakdown:', error);
  }

  return { nodeCount, edgeCount, validation, stats };
} 