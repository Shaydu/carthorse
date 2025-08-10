import { Pool } from 'pg';

/**
 * Weld near-coincident vertex pairs at connector endpoints by remapping all edges
 * to a single canonical vertex within tolerance. This guarantees that edges on
 * both sides of a connector share the same vertex ID and traverse.
 */
export async function runConnectorEndpointWeld(
  pgClient: Pool,
  stagingSchema: string,
  toleranceMeters: number
): Promise<{ weldedPairs: number; remappedEdges: number }> {
  const sql = `
    WITH connectors AS (
      SELECT 
        app_uuid,
        ST_StartPoint(geometry) AS a,
        ST_EndPoint(geometry)   AS b
      FROM ${stagingSchema}.trails
      WHERE geometry IS NOT NULL
        AND (trail_type = 'connector' OR name ILIKE '%connector%')
    ), mapped AS (
      SELECT 
        (SELECT v.id FROM ${stagingSchema}.ways_noded_vertices_pgr v 
          ORDER BY ST_Distance(v.the_geom::geography, c.a::geography) ASC LIMIT 1) AS v1,
        (SELECT v.id FROM ${stagingSchema}.ways_noded_vertices_pgr v 
          ORDER BY ST_Distance(v.the_geom::geography, c.b::geography) ASC LIMIT 1) AS v2
      FROM connectors c
    ), pairs AS (
      SELECT DISTINCT LEAST(v1,v2) AS canon, GREATEST(v1,v2) AS other
      FROM mapped
      WHERE v1 IS NOT NULL AND v2 IS NOT NULL AND v1 <> v2
        AND ST_DWithin(
          (SELECT the_geom::geography FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE id = v1),
          (SELECT the_geom::geography FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE id = v2),
          ${toleranceMeters}
        )
    ), upd_src AS (
      UPDATE ${stagingSchema}.ways_noded w
      SET source = p.canon
      FROM pairs p
      WHERE w.source = p.other
      RETURNING 1
    ), upd_tgt AS (
      UPDATE ${stagingSchema}.ways_noded w
      SET target = p.canon
      FROM pairs p
      WHERE w.target = p.other
      RETURNING 1
    ), del_orphans AS (
      DELETE FROM ${stagingSchema}.ways_noded_vertices_pgr v
      WHERE v.id IN (SELECT other FROM pairs)
        AND NOT EXISTS (
          SELECT 1 FROM ${stagingSchema}.ways_noded e WHERE e.source = v.id OR e.target = v.id
        )
      RETURNING 1
    )
    SELECT 
      (SELECT COUNT(*) FROM pairs) AS welded_pairs,
      (SELECT COUNT(*) FROM upd_src) + (SELECT COUNT(*) FROM upd_tgt) AS remapped_edges;
  `;

  const res = await pgClient.query(sql);
  return {
    weldedPairs: Number(res.rows[0]?.welded_pairs || 0),
    remappedEdges: Number(res.rows[0]?.remapped_edges || 0)
  };
}


