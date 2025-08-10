import { Pool } from 'pg';

export async function runPostNodingSnap(
  pgClient: Pool,
  stagingSchema: string,
  toleranceMeters: number
): Promise<{ snappedStart: number; snappedEnd: number }> {
  const tolDegrees = toleranceMeters / 111_320;

  const snapStart = await pgClient.query(
    `
    WITH candidates AS (
      SELECT wn.id AS edge_id,
             nn.id AS node_id,
             ST_Distance(nn.the_geom, ST_StartPoint(wn.the_geom)) AS dist
      FROM ${stagingSchema}.ways_noded wn
      JOIN ${stagingSchema}.ways_noded_vertices_pgr nn
        ON ST_DWithin(nn.the_geom, ST_StartPoint(wn.the_geom), $1)
    ),
    nearest AS (
      SELECT DISTINCT ON (edge_id) edge_id, node_id
      FROM candidates
      ORDER BY edge_id, dist ASC
    )
    UPDATE ${stagingSchema}.ways_noded wn
    SET source = n.node_id
    FROM nearest n
    WHERE wn.id = n.edge_id AND (wn.source IS DISTINCT FROM n.node_id)
    RETURNING 1
    `,
    [tolDegrees]
  );

  const snapEnd = await pgClient.query(
    `
    WITH candidates AS (
      SELECT wn.id AS edge_id,
             nn.id AS node_id,
             ST_Distance(nn.the_geom, ST_EndPoint(wn.the_geom)) AS dist
      FROM ${stagingSchema}.ways_noded wn
      JOIN ${stagingSchema}.ways_noded_vertices_pgr nn
        ON ST_DWithin(nn.the_geom, ST_EndPoint(wn.the_geom), $1)
    ),
    nearest AS (
      SELECT DISTINCT ON (edge_id) edge_id, node_id
      FROM candidates
      ORDER BY edge_id, dist ASC
    )
    UPDATE ${stagingSchema}.ways_noded wn
    SET target = n.node_id
    FROM nearest n
    WHERE wn.id = n.edge_id AND (wn.target IS DISTINCT FROM n.node_id)
    RETURNING 1
    `,
    [tolDegrees]
  );

  await pgClient.query(
    `UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
     SET cnt = (
       SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
       WHERE e.source = v.id OR e.target = v.id
     )`
  );

  return {
    snappedStart: snapStart.rowCount || 0,
    snappedEnd: snapEnd.rowCount || 0
  };
}


