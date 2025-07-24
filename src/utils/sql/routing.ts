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

async function tableExists(pgClient: Client, schema: string, table: string): Promise<boolean> {
  const res = await pgClient.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = $1 AND table_name = $2
    ) AS exists`,
    [schema, table]
  );
  return !!res.rows[0]?.exists;
}

export async function buildRoutingGraphHelper(
  pgClient: Client,
  stagingSchema: string,
  trailsTable: string,
  intersectionTolerance: number,
  edgeTolerance: number
): Promise<RoutingGraphResult> {
  // Defensive: Check required tables exist
  for (const tbl of ['routing_edges', 'routing_nodes', trailsTable]) {
    const exists = await tableExists(pgClient, stagingSchema, tbl);
    if (!exists) {
      const msg = `[routing] ❌ Table ${stagingSchema}.${tbl} does not exist. Aborting routing graph build.`;
      console.error(msg);
      throw new Error(msg);
    }
  }

  // Clear existing routing data
  await pgClient.query(`DELETE FROM ${stagingSchema}.routing_edges`);
  await pgClient.query(`DELETE FROM ${stagingSchema}.routing_nodes`);

  // Use native PostGIS functions to create intersection nodes
  try {
    const intersectionNodesResult = await pgClient.query(`
      INSERT INTO ${stagingSchema}.routing_nodes (lat, lng, elevation, node_type, connected_trails)
      SELECT DISTINCT
        ST_Y(ST_Intersection(t1.geometry, t2.geometry)) as lat,
        ST_X(ST_Intersection(t1.geometry, t2.geometry)) as lng,
        COALESCE(ST_Z(ST_Intersection(t1.geometry, t2.geometry)), 0) as elevation,
        'intersection' as node_type,
        t1.app_uuid || ',' || t2.app_uuid as connected_trails
      FROM ${stagingSchema}.${trailsTable} t1
      JOIN ${stagingSchema}.${trailsTable} t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
    `);
    const nodeCountResult = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_nodes`);
    const nodeCount = nodeCountResult.rows[0]?.count ?? 0;
    if (Number(nodeCount) === 0) {
      console.error(`[routing] ❌ No intersection nodes generated in ${stagingSchema}.routing_nodes`);
    } else {
      console.log(`[routing] ✅ Inserted intersection nodes: ${nodeCount}`);
    }
  } catch (err) {
    console.error(`[routing] ❌ Error inserting intersection nodes:`, err);
    throw err;
  }

  // Use native PostGIS functions to create endpoint nodes (not at intersections)
  try {
    const endpointNodesResult = await pgClient.query(`
      INSERT INTO ${stagingSchema}.routing_nodes (lat, lng, elevation, node_type, connected_trails)
      WITH trail_endpoints AS (
        SELECT
          ST_StartPoint(ST_Force2D(geometry)) as start_point,
          ST_EndPoint(ST_Force2D(geometry)) as end_point,
          app_uuid, name
        FROM ${stagingSchema}.${trailsTable}
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
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
    const nodeCountResult = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_nodes`);
    const nodeCount = nodeCountResult.rows[0]?.count ?? 0;
    if (Number(nodeCount) === 0) {
      console.error(`[routing] ❌ No endpoint nodes generated in ${stagingSchema}.routing_nodes`);
    } else {
      console.log(`[routing] ✅ Total routing nodes after endpoints: ${nodeCount}`);
    }
  } catch (err) {
    console.error(`[routing] ❌ Error inserting endpoint nodes:`, err);
    throw err;
  }

  // Use native PostGIS functions to create routing edges
  try {
    const edgesResult = await pgClient.query(`
      INSERT INTO ${stagingSchema}.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, geometry)
      WITH trail_segments AS (
        SELECT app_uuid, name, ST_Force2D(geometry) as geom, elevation_gain,
               ST_StartPoint(ST_Force2D(geometry)) as start_point,
               ST_EndPoint(ST_Force2D(geometry)) as end_point
        FROM ${stagingSchema}.${trailsTable}
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
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
        geom as geometry
      FROM node_connections
      WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL AND from_node_id <> to_node_id
    `);
    const edgeCountResult = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_edges`);
    const edgeCount = edgeCountResult.rows[0]?.count ?? 0;
    if (Number(edgeCount) === 0) {
      console.error(`[routing] ❌ No routing edges generated in ${stagingSchema}.routing_edges`);
    } else {
      console.log(`[routing] ✅ Inserted routing edges: ${edgeCount}`);
    }
  } catch (err) {
    console.error(`[routing] ❌ Error inserting routing edges:`, err);
    throw err;
  }

  // Get counts
  const nodeCountResult = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_nodes`);
  const edgeCountResult = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_edges`);
  const nodeCount = nodeCountResult.rows[0]?.count ?? 0;
  const edgeCount = edgeCountResult.rows[0]?.count ?? 0;

  return {
    nodeCount: Number(nodeCount),
    edgeCount: Number(edgeCount),
    validation: [],
    stats: {}
  };
} 