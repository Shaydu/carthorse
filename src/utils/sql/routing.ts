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

  // Use intersection_points table to create intersection nodes
  try {
    const intersectionNodesResult = await pgClient.query(`
      INSERT INTO ${stagingSchema}.routing_nodes (lat, lng, elevation, node_type, connected_trails)
      SELECT
        ST_Y(point),
        ST_X(point),
        COALESCE(ST_Z(point_3d), 0),
        'intersection',
        array_to_string(connected_trail_names, ',')
      FROM ${stagingSchema}.intersection_points
      WHERE array_length(connected_trail_names, 1) > 1;
    `);
    const nodeCountResult = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_nodes`);
    const nodeCount = nodeCountResult.rows[0]?.count ?? 0;
    if (Number(nodeCount) === 0) {
      console.warn(`[routing] ⚠️ No intersection nodes generated in ${stagingSchema}.routing_nodes (this may be normal for regions with few intersections)`);
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

    // Use efficient PostGIS native functions for trail splitting and edge creation
  try {
    const edgesResult = await pgClient.query(`
      INSERT INTO ${stagingSchema}.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, geometry)
      WITH all_trails AS (
        SELECT 
          app_uuid, name, ST_Force2D(geometry) as geom, elevation_gain
        FROM ${stagingSchema}.${trailsTable}
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      ),
      -- Use ST_Node to automatically detect all intersection points and split all trails at once
      noded_network AS (
        SELECT ST_Node(ST_Collect(geom)) as nodes
        FROM all_trails
      ),
      -- Extract all line segments from the noded network
      split_segments AS (
        SELECT 
          (ST_Dump(ST_LineMerge(ST_Collect(geom)))).geom as segment_geom
        FROM all_trails
      ),
      -- Match segments back to original trails and create edges
      trail_segments AS (
        SELECT 
          t.app_uuid as trail_id,
          t.name as trail_name,
          t.elevation_gain,
          s.segment_geom as geom,
          ST_StartPoint(s.segment_geom) as start_point,
          ST_EndPoint(s.segment_geom) as end_point,
          t.app_uuid || '_seg' || ROW_NUMBER() OVER (PARTITION BY t.app_uuid ORDER BY ST_StartPoint(s.segment_geom)) as segment_id
        FROM all_trails t
        JOIN split_segments s ON ST_DWithin(t.geom, s.segment_geom, 0.1)
        WHERE ST_Length(s.segment_geom) > 0.1
      ),
      node_connections AS (
        SELECT 
          ts.trail_id, 
          ts.trail_name, 
          ts.segment_id,
          ts.geom, 
          ts.elevation_gain,
          fn.id as from_node_id, 
          tn.id as to_node_id
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
        segment_id as trail_id,
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