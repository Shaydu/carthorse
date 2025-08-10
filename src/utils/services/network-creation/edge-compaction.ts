import { Pool } from 'pg';

export interface EdgeCompactionResult {
  chainsCreated: number;
  edgesCompacted: number;
  edgesRemaining: number;
  finalEdges: number;
}

/**
 * Merge consecutive edges across degree-2 vertices into single long edges.
 * - Does NOT cross multi-trail intersections (vertices with degree != 2)
 * - Preserves routing by rebuilding vertices from compacted edges
 * - Keeps geometry contiguous by orienting each segment before ST_MakeLine
 */
export async function runEdgeCompaction(
  pgClient: Pool,
  stagingSchema: string
): Promise<EdgeCompactionResult> {
  const sql = `
    -- Ensure vertex degree counts are up to date
    UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
    SET cnt = (
      SELECT COUNT(*)
      FROM ${stagingSchema}.ways_noded e
      WHERE e.source = v.id OR e.target = v.id
    );

    WITH deg AS (
      SELECT id, cnt FROM ${stagingSchema}.ways_noded_vertices_pgr
    ),
    endpoints AS (
      SELECT id FROM deg WHERE cnt <> 2
    ),
    edges AS (
      SELECT id, source, target, the_geom FROM ${stagingSchema}.ways_noded
    ),
    -- Seed paths starting from endpoint-attached edges in both directions
    seed AS (
      SELECT 
        e.id AS last_edge,
        e.source AS start_vertex,
        e.target AS current_vertex,
        ARRAY[e.id]::bigint[] AS path_edges,
        ARRAY[e.source, e.target]::int[] AS path_vertices
      FROM edges e
      WHERE e.source IN (SELECT id FROM endpoints)
      UNION ALL
      SELECT 
        e.id AS last_edge,
        e.target AS start_vertex,
        e.source AS current_vertex,
        ARRAY[e.id]::bigint[] AS path_edges,
        ARRAY[e.target, e.source]::int[] AS path_vertices
      FROM edges e
      WHERE e.target IN (SELECT id FROM endpoints)
    ),
    -- Walk forward across degree-2 vertices, avoiding backtracking
    walk AS (
      SELECT * FROM seed
      UNION ALL
      SELECT 
        e2.id AS last_edge,
        w.start_vertex,
        CASE WHEN e2.source = w.current_vertex THEN e2.target ELSE e2.source END AS current_vertex,
        w.path_edges || e2.id,
        w.path_vertices || CASE WHEN e2.source = w.current_vertex THEN e2.target ELSE e2.source END
      FROM walk w
      JOIN edges e2 
        ON (e2.source = w.current_vertex OR e2.target = w.current_vertex)
       AND e2.id <> w.last_edge
      JOIN deg d ON d.id = w.current_vertex AND d.cnt = 2
      WHERE array_position(w.path_edges, e2.id) IS NULL
    ),
    -- Completed chains end when we reach a non-2-degree vertex
    chains_raw AS (
      SELECT DISTINCT ON (LEAST(start_vertex, current_vertex), GREATEST(start_vertex, current_vertex))
        LEAST(start_vertex, current_vertex) AS s,
        GREATEST(start_vertex, current_vertex) AS t,
        path_edges,
        path_vertices
      FROM walk w
      JOIN deg d ON d.id = w.current_vertex AND d.cnt <> 2
      WHERE w.start_vertex <> w.current_vertex
      ORDER BY LEAST(start_vertex, current_vertex), GREATEST(start_vertex, current_vertex), array_length(path_edges,1) DESC
    ),
    -- Expand edges with ordering and orient each segment to ensure continuity
    chain_edges AS (
      SELECT 
        c.s, c.t,
        pe.edge_id,
        pe.ord,
        pv.prev_vertex,
        pv.next_vertex
      FROM chains_raw c
      CROSS JOIN LATERAL unnest(c.path_edges) WITH ORDINALITY AS pe(edge_id, ord)
      JOIN LATERAL (
        SELECT 
          c.path_vertices[pe.ord]   AS prev_vertex,
          c.path_vertices[pe.ord+1] AS next_vertex
      ) pv ON true
    ),
    oriented AS (
      SELECT 
        ce.s, ce.t, ce.ord,
        CASE 
          WHEN w.source = ce.prev_vertex AND w.target = ce.next_vertex THEN w.the_geom
          WHEN w.source = ce.next_vertex AND w.target = ce.prev_vertex THEN ST_Reverse(w.the_geom)
          ELSE w.the_geom
        END AS geom
      FROM chain_edges ce
      JOIN ${stagingSchema}.ways_noded w ON w.id = ce.edge_id
    ),
    merged AS (
      SELECT 
        row_number() OVER () AS id,
        s AS source,
        t AS target,
        ST_LineMerge(ST_MakeLine(geom ORDER BY ord))::geometry(LINESTRING,4326) AS the_geom,
        ST_Length(ST_MakeLine(geom ORDER BY ord)::geography) / 1000.0 AS length_km
      FROM oriented
      GROUP BY s, t
    ),
    included_edges AS (
      SELECT DISTINCT edge_id
      FROM chain_edges
    ),
    remaining AS (
      SELECT 
        w.id,
        w.source,
        w.target,
        w.the_geom,
        ST_Length(w.the_geom::geography) / 1000.0 AS length_km
      FROM ${stagingSchema}.ways_noded w
      WHERE NOT EXISTS (
        SELECT 1 FROM included_edges ie WHERE ie.edge_id = w.id
      )
    )
    -- Build final compacted edges table with consistent schema
    ,final_compacted AS (
      SELECT 
        row_number() OVER () AS id,
        NULL::bigint AS old_id,
        1::int AS sub_id,
        the_geom,
        NULL::text AS app_uuid,
        'compacted'::text AS name,
        length_km,
        0.0::double precision AS elevation_gain,
        0.0::double precision AS elevation_loss,
        source,
        target
      FROM (
        SELECT id, source, target, the_geom, length_km FROM merged
        UNION ALL
        SELECT id, source, target, the_geom, length_km FROM remaining
      ) u
    )
    SELECT 
      (SELECT COUNT(*) FROM merged) AS chains_created,
      (SELECT COUNT(*) FROM included_edges) AS edges_compacted,
      (SELECT COUNT(*) FROM remaining) AS edges_remaining,
      (SELECT COUNT(*) FROM final_compacted) AS final_edges;
  `;

  const res = await pgClient.query(sql);
  const row = res.rows[0] || { chains_created: 0, edges_compacted: 0, edges_remaining: 0, final_edges: 0 };

  // Replace ways_noded with compacted edges, and rebuild vertices with up-to-date degree counts
  await pgClient.query(`
    DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_compacted;
    CREATE TABLE ${stagingSchema}.ways_noded_compacted AS
    SELECT * FROM (
      WITH deg AS (
        SELECT id, cnt FROM ${stagingSchema}.ways_noded_vertices_pgr
      ),
      endpoints AS (
        SELECT id FROM deg WHERE cnt <> 2
      ),
      edges AS (
        SELECT id, source, target, the_geom, app_uuid, name, length_km, elevation_gain, elevation_loss, old_id, sub_id
        FROM ${stagingSchema}.ways_noded
      ),
      seed AS (
        SELECT 
          e.id AS last_edge,
          e.source AS start_vertex,
          e.target AS current_vertex,
          ARRAY[e.id]::bigint[] AS path_edges,
          ARRAY[e.source, e.target]::int[] AS path_vertices
        FROM edges e
        WHERE e.source IN (SELECT id FROM endpoints)
        UNION ALL
        SELECT 
          e.id AS last_edge,
          e.target AS start_vertex,
          e.source AS current_vertex,
          ARRAY[e.id]::bigint[] AS path_edges,
          ARRAY[e.target, e.source]::int[] AS path_vertices
        FROM edges e
        WHERE e.target IN (SELECT id FROM endpoints)
      ),
      walk AS (
        SELECT * FROM seed
        UNION ALL
        SELECT 
          e2.id AS last_edge,
          w.start_vertex,
          CASE WHEN e2.source = w.current_vertex THEN e2.target ELSE e2.source END AS current_vertex,
          w.path_edges || e2.id,
          w.path_vertices || CASE WHEN e2.source = w.current_vertex THEN e2.target ELSE e2.source END
        FROM walk w
        JOIN edges e2 
          ON (e2.source = w.current_vertex OR e2.target = w.current_vertex)
         AND e2.id <> w.last_edge
        JOIN ${stagingSchema}.ways_noded_vertices_pgr d ON d.id = w.current_vertex AND d.cnt = 2
        WHERE array_position(w.path_edges, e2.id) IS NULL
      ),
      chains_raw AS (
        SELECT DISTINCT ON (LEAST(start_vertex, current_vertex), GREATEST(start_vertex, current_vertex))
          LEAST(start_vertex, current_vertex) AS s,
          GREATEST(start_vertex, current_vertex) AS t,
          path_edges,
          path_vertices
        FROM walk w
        JOIN ${stagingSchema}.ways_noded_vertices_pgr d ON d.id = w.current_vertex AND d.cnt <> 2
        WHERE w.start_vertex <> w.current_vertex
        ORDER BY LEAST(start_vertex, current_vertex), GREATEST(start_vertex, current_vertex), array_length(path_edges,1) DESC
      ),
      chain_edges AS (
        SELECT 
          c.s, c.t,
          pe.edge_id,
          pe.ord,
          pv.prev_vertex,
          pv.next_vertex
        FROM chains_raw c
        CROSS JOIN LATERAL unnest(c.path_edges) WITH ORDINALITY AS pe(edge_id, ord)
        JOIN LATERAL (
          SELECT 
            c.path_vertices[pe.ord]   AS prev_vertex,
            c.path_vertices[pe.ord+1] AS next_vertex
        ) pv ON true
      ),
      oriented AS (
        SELECT 
          ce.s, ce.t, ce.ord,
          CASE 
            WHEN w.source = ce.prev_vertex AND w.target = ce.next_vertex THEN w.the_geom
            WHEN w.source = ce.next_vertex AND w.target = ce.prev_vertex THEN ST_Reverse(w.the_geom)
            ELSE w.the_geom
          END AS geom
        FROM chain_edges ce
        JOIN ${stagingSchema}.ways_noded w ON w.id = ce.edge_id
      ),
      merged AS (
        SELECT 
          row_number() OVER () AS id,
          s AS source,
          t AS target,
          ST_LineMerge(ST_MakeLine(geom ORDER BY ord))::geometry(LINESTRING,4326) AS the_geom,
          ST_Length(ST_MakeLine(geom ORDER BY ord)::geography) / 1000.0 AS length_km
        FROM oriented
        GROUP BY s, t
      ),
      included_edges AS (
        SELECT DISTINCT edge_id
        FROM chain_edges
      ),
      remaining AS (
        SELECT 
          w.id,
          w.source,
          w.target,
          w.the_geom,
          ST_Length(w.the_geom::geography) / 1000.0 AS length_km,
          w.app_uuid,
          w.name,
          w.elevation_gain,
          w.elevation_loss,
          w.old_id,
          w.sub_id
        FROM ${stagingSchema}.ways_noded w
        WHERE NOT EXISTS (
          SELECT 1 FROM included_edges ie WHERE ie.edge_id = w.id
        )
      )
      SELECT 
        row_number() OVER () AS id,
        NULL::bigint AS old_id,
        1::int AS sub_id,
        the_geom,
        NULL::text AS app_uuid,
        'compacted'::text AS name,
        length_km,
        0.0::double precision AS elevation_gain,
        0.0::double precision AS elevation_loss,
        source,
        target
      FROM (
        SELECT id, source, target, the_geom, length_km FROM merged
        UNION ALL
        SELECT id, source, target, the_geom, length_km FROM remaining
      ) u
    ) q;

    DROP TABLE IF EXISTS ${stagingSchema}.ways_noded;
    ALTER TABLE ${stagingSchema}.ways_noded_compacted RENAME TO ways_noded;

    -- Rebuild vertices from compacted edges and refresh degree counts
    DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr;
    CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
    SELECT 
      row_number() OVER () AS id,
      geom AS the_geom,
      0::int AS cnt,
      0::int AS chk,
      0::int AS ein,
      0::int AS eout
    FROM (
      SELECT DISTINCT ST_StartPoint(the_geom) AS geom FROM ${stagingSchema}.ways_noded
      UNION ALL
      SELECT DISTINCT ST_EndPoint(the_geom)   AS geom FROM ${stagingSchema}.ways_noded
    ) pts;

    -- Assign nearest vertex IDs to every edge endpoint
    ALTER TABLE ${stagingSchema}.ways_noded DROP COLUMN IF EXISTS source;
    ALTER TABLE ${stagingSchema}.ways_noded DROP COLUMN IF EXISTS target;
    ALTER TABLE ${stagingSchema}.ways_noded ADD COLUMN source integer, ADD COLUMN target integer;

    WITH start_nearest AS (
      SELECT wn.id AS edge_id,
             (
               SELECT v.id
               FROM ${stagingSchema}.ways_noded_vertices_pgr v
               ORDER BY ST_Distance(v.the_geom::geography, ST_StartPoint(wn.the_geom)::geography) ASC
               LIMIT 1
             ) AS node_id
      FROM ${stagingSchema}.ways_noded wn
    ),
    end_nearest AS (
      SELECT wn.id AS edge_id,
             (
               SELECT v.id
               FROM ${stagingSchema}.ways_noded_vertices_pgr v
               ORDER BY ST_Distance(v.the_geom::geography, ST_EndPoint(wn.the_geom)::geography) ASC
               LIMIT 1
             ) AS node_id
      FROM ${stagingSchema}.ways_noded wn
    )
    UPDATE ${stagingSchema}.ways_noded wn
    SET source = sn.node_id,
        target = en.node_id
    FROM start_nearest sn
    JOIN end_nearest en ON en.edge_id = sn.edge_id
    WHERE wn.id = sn.edge_id;

    UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
    SET cnt = (
      SELECT COUNT(*)
      FROM ${stagingSchema}.ways_noded e
      WHERE e.source = v.id OR e.target = v.id
    );
  `);

  const details: EdgeCompactionResult = {
    chainsCreated: Number(row.chains_created || 0),
    edgesCompacted: Number(row.edges_compacted || 0),
    edgesRemaining: Number(row.edges_remaining || 0),
    finalEdges: Number(row.final_edges || 0)
  };

  return details;
}


