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
    candidates AS (
      SELECT 
        c.cid,
        c.source AS c_src,
        c.target AS c_dst,
        c.the_geom AS c_geom,
        w.id AS eid,
        w.source AS w_src,
        w.target AS w_dst,
        CASE 
          WHEN w.target = c.source THEN 'extend_target_from_source'
          WHEN w.source = c.source THEN 'extend_source_from_source'
          WHEN w.target = c.target THEN 'extend_target_from_target'
          WHEN w.source = c.target THEN 'extend_source_from_target'
          ELSE NULL
        END AS mode
      FROM connectors c
      JOIN ${stagingSchema}.ways_noded w 
        ON (w.source = c.source OR w.target = c.source OR w.source = c.target OR w.target = c.target)
       AND w.id <> c.cid
       AND (w.name NOT ILIKE '%connector%')
    ),
    pick AS (
      -- choose one side per connector; prefer rows with non-null mode
      SELECT DISTINCT ON (cid)
        cid, c_src, c_dst, c_geom, eid, w_src, w_dst, mode
      FROM candidates
      WHERE mode IS NOT NULL
      ORDER BY cid, eid
    ),
    to_update AS (
      SELECT 
        p.cid,
        p.eid,
        p.mode,
        CASE 
          WHEN p.mode IN ('extend_target_from_source','extend_source_from_source') THEN p.c_geom
          ELSE ST_Reverse(p.c_geom)
        END AS cgeom_oriented,
        CASE 
          WHEN p.mode = 'extend_target_from_source' THEN p.c_dst
          WHEN p.mode = 'extend_source_from_source' THEN p.c_dst
          WHEN p.mode = 'extend_target_from_target' THEN p.c_src
          WHEN p.mode = 'extend_source_from_target' THEN p.c_src
        END AS new_other_vertex,
        CASE 
          WHEN p.mode LIKE 'extend_target%' THEN 'target'
          ELSE 'source'
        END AS which_end
      FROM pick p
    ),
    do_update AS (
      UPDATE ${stagingSchema}.ways_noded w
      SET 
        the_geom = CASE 
          WHEN u.which_end = 'target' THEN ST_LineMerge(ST_MakeLine(w.the_geom, u.cgeom_oriented))
          ELSE ST_LineMerge(ST_MakeLine(u.cgeom_oriented, w.the_geom))
        END,
        length_km = ST_Length(
          CASE 
            WHEN u.which_end = 'target' THEN ST_LineMerge(ST_MakeLine(w.the_geom, u.cgeom_oriented))
            ELSE ST_LineMerge(ST_MakeLine(u.cgeom_oriented, w.the_geom))
          END::geography
        ) / 1000.0,
        source = CASE WHEN u.which_end = 'source' THEN u.new_other_vertex ELSE w.source END,
        target = CASE WHEN u.which_end = 'target' THEN u.new_other_vertex ELSE w.target END
      FROM to_update u
      WHERE w.id = u.eid
      RETURNING u.cid
    ),
    del AS (
      DELETE FROM ${stagingSchema}.ways_noded w
      USING connectors c
      WHERE w.id = c.cid
      RETURNING 1
    )
    SELECT 
      (SELECT COUNT(*) FROM do_update) AS collapsed,
      (SELECT COUNT(*) FROM del) AS deleted_connectors;
  `;

  const res = await pgClient.query(sql);
  return {
    collapsed: Number(res.rows[0]?.collapsed || 0),
    deletedConnectors: Number(res.rows[0]?.deleted_connectors || 0)
  };
}


