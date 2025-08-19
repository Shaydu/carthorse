import { Pool } from 'pg';

/**
 * Collapse connector edges by extending a neighboring non-connector edge over the
 * connector geometry and removing the standalone connector edge. This guarantees
 * traversal without introducing extra edge complexity.
 */
export async function runConnectorEdgeCollapse(
  pgClient: Pool,
  stagingSchema: string
): Promise<{ collapsed: number; deletedConnectors: number }> {
  const sql = `
    WITH conn_trails AS (
      SELECT app_uuid FROM ${stagingSchema}.trails
      WHERE trail_type = 'connector' OR name ILIKE '%connector%'
    ),
    connectors AS (
      SELECT w.id AS cid, w.source, w.target, w.the_geom, w.app_uuid, w.name
      FROM ${stagingSchema}.ways_noded w
      WHERE w.app_uuid IN (SELECT app_uuid FROM conn_trails) OR w.name ILIKE '%connector%'
    ),
    -- pick one non-connector neighbor on the source side
    src_neighbors AS (
      SELECT c.cid, w.id AS eid, w.source, w.target,
             CASE WHEN w.source = c.source THEN w.target ELSE w.source END AS outer_vertex,
             CASE WHEN w.source = c.source THEN w.the_geom ELSE ST_Reverse(w.the_geom) END AS geom_oriented
      FROM connectors c
      JOIN ${stagingSchema}.ways_noded w ON (w.source = c.source OR w.target = c.source) AND w.id <> c.cid
      WHERE w.name NOT ILIKE '%connector%'
    ),
    -- pick one non-connector neighbor on the target side
    dst_neighbors AS (
      SELECT c.cid, w.id AS eid, w.source, w.target,
             CASE WHEN w.source = c.target THEN w.target ELSE w.source END AS outer_vertex,
             CASE WHEN w.source = c.target THEN w.the_geom ELSE ST_Reverse(w.the_geom) END AS geom_oriented
      FROM connectors c
      JOIN ${stagingSchema}.ways_noded w ON (w.source = c.target OR w.target = c.target) AND w.id <> c.cid
      WHERE w.name NOT ILIKE '%connector%'
    ),
    pick_src AS (
      SELECT DISTINCT ON (cid) * FROM src_neighbors ORDER BY cid, eid
    ),
    pick_dst AS (
      SELECT DISTINCT ON (cid) * FROM dst_neighbors ORDER BY cid, eid
    ),
    oriented_connector AS (
      SELECT c.cid,
             CASE 
               WHEN ST_Distance(ST_StartPoint(c.the_geom), vs.the_geom) <= ST_Distance(ST_EndPoint(c.the_geom), vs.the_geom)
               THEN c.the_geom ELSE ST_Reverse(c.the_geom)
             END AS cgeom_oriented
      FROM connectors c
      JOIN ${stagingSchema}.ways_noded_vertices_pgr vs ON vs.id = c.source
    ),
    to_bridge AS (
      SELECT c.cid,
             ps.eid AS src_eid,
             pd.eid AS dst_eid,
             ps.outer_vertex AS new_source,
             pd.outer_vertex AS new_target,
             ST_LineMerge(ST_MakeLine(ST_MakeLine(ps.geom_oriented, oc.cgeom_oriented), pd.geom_oriented)) AS new_geom,
             ST_Length(ST_LineMerge(ST_MakeLine(ST_MakeLine(ps.geom_oriented, oc.cgeom_oriented), pd.geom_oriented))::geography) AS new_length_meters,
             -- Validate that edges actually connect properly
             ST_Distance(ST_EndPoint(ps.geom_oriented), ST_StartPoint(oc.cgeom_oriented)) AS src_connector_gap,
             ST_Distance(ST_EndPoint(oc.cgeom_oriented), ST_StartPoint(pd.geom_oriented)) AS connector_dst_gap
      FROM connectors c
      JOIN pick_src ps ON ps.cid = c.cid
      JOIN pick_dst pd ON pd.cid = c.cid
      JOIN oriented_connector oc ON oc.cid = c.cid
    ),
    -- Filter out bridged edges that are too long or have gaps
    filtered_bridge AS (
      SELECT * FROM to_bridge 
      WHERE new_length_meters <= 100.0
        AND src_connector_gap <= 1.0  -- Maximum 1 meter gap between source and connector
        AND connector_dst_gap <= 1.0  -- Maximum 1 meter gap between connector and destination
    ),
    idbase AS (
      SELECT COALESCE(MAX(id), 0) AS base FROM ${stagingSchema}.ways_noded
    ),
    inserted AS (
      INSERT INTO ${stagingSchema}.ways_noded
        (id, original_trail_id, sub_id, the_geom, app_uuid, name, length_km, elevation_gain, elevation_loss, source, target)
      SELECT 
        idbase.base + ROW_NUMBER() OVER () AS id,
        NULL::bigint,
        1,
        new_geom,
        'connector-' || gen_random_uuid()::text,
        'connector-bridged'::text,
        ST_Length(new_geom::geography) / 1000.0,
        0.0::double precision,
        0.0::double precision,
        new_source,
        new_target
      FROM filtered_bridge, idbase
      RETURNING id
    ),
    del_edges AS (
      DELETE FROM ${stagingSchema}.ways_noded w
      USING filtered_bridge tb
      WHERE w.id IN (tb.src_eid, tb.dst_eid)
      RETURNING 1
    ),
    del_connectors AS (
      DELETE FROM ${stagingSchema}.ways_noded w
      USING filtered_bridge tb
      WHERE w.id = tb.cid
      RETURNING 1
    ),
    recalc AS (
      UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e WHERE e.source = v.id OR e.target = v.id
      )
      RETURNING 1
    )
    SELECT 
      (SELECT COUNT(*) FROM inserted) AS collapsed,
      (SELECT COUNT(*) FROM del_connectors) AS deleted_connectors;
  `;

  const res = await pgClient.query(sql);
  return {
    collapsed: Number(res.rows[0]?.collapsed || 0),
    deletedConnectors: Number(res.rows[0]?.deleted_connectors || 0)
  };
}


