import { Pool } from 'pg';

/**
 * Default gap bridging: detect endpoint gaps within tolerance, create a midpoint vertex,
 * and add short connector edges from each endpoint to the midpoint so routes can traverse.
 *
 * Behavior is config-driven (meters), not gated by env flags. Intended to run after
 * ways_noded and ways_noded_vertices_pgr are created and source/target set.
 */
export async function runGapMidpointBridging(
  pgClient: Pool,
  stagingSchema: string,
  toleranceMeters: number
): Promise<{ midpointsInserted: number; edgesInserted: number }> {
  // Convert meters to degrees approximately for ST_DWithin on 4326
  const toleranceDegrees = toleranceMeters / 111_320; // adequate for small tolerances

  // Create connector midpoints and edges in a single SQL unit
  const result = await pgClient.query(
    `
    WITH endpoints AS (
      SELECT id, the_geom
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      WHERE cnt = 1
    ),
    candidate_pairs AS (
      SELECT e1.id AS node1_id,
             e2.id AS node2_id,
             e1.the_geom AS geom1,
             e2.the_geom AS geom2,
             ST_Distance(e1.the_geom, e2.the_geom) AS dist_deg
      FROM endpoints e1
      JOIN endpoints e2 ON e1.id < e2.id
      WHERE ST_DWithin(e1.the_geom, e2.the_geom, $1)
    ),
    filtered_pairs AS (
      -- Exclude pairs already directly connected by an edge
      SELECT cp.*
      FROM candidate_pairs cp
      WHERE NOT EXISTS (
        SELECT 1 FROM ${stagingSchema}.ways_noded w
        WHERE (w.source = cp.node1_id AND w.target = cp.node2_id)
           OR (w.source = cp.node2_id AND w.target = cp.node1_id)
      )
    ),
    midpoints AS (
      SELECT 
        node1_id,
        node2_id,
        geom1,
        geom2,
         ST_LineInterpolatePoint(ST_MakeLine(ST_Force2D(geom1), ST_Force2D(geom2)), 0.5) AS mid_geom,
        dist_deg
      FROM filtered_pairs
    ),
    numbered AS (
      SELECT 
        node1_id,
        node2_id,
        geom1,
        geom2,
        mid_geom,
        dist_deg,
        ROW_NUMBER() OVER (ORDER BY node1_id, node2_id) AS rn
      FROM midpoints
    ),
    bases AS (
      SELECT 
        (SELECT COALESCE(MAX(id), 0) FROM ${stagingSchema}.ways_noded_vertices_pgr) AS base_vertex_id,
        (SELECT COALESCE(MAX(id), 0) FROM ${stagingSchema}.ways_noded) AS base_edge_id
    ),
    to_insert AS (
      SELECT 
        n.node1_id,
        n.node2_id,
        n.geom1,
        n.geom2,
        n.mid_geom,
        (SELECT base_vertex_id FROM bases) + n.rn AS new_vertex_id,
        (SELECT base_edge_id FROM bases) + (n.rn * 2 - 1) AS new_edge1_id,
        (SELECT base_edge_id FROM bases) + (n.rn * 2) AS new_edge2_id
      FROM numbered n
    ),
    inserted_vertices AS (
      INSERT INTO ${stagingSchema}.ways_noded_vertices_pgr (id, the_geom, cnt, chk, ein, eout)
      SELECT new_vertex_id, ST_Force2D(mid_geom), 0, 0, 0, 0
      FROM to_insert
      RETURNING id
    ),
    inserted_edges AS (
      INSERT INTO ${stagingSchema}.ways_noded (
        id, old_id, source, target, the_geom, length_km, elevation_gain, elevation_loss, app_uuid, name
      )
      SELECT 
        new_edge1_id,
        NULL::bigint,
        node1_id,
        new_vertex_id,
        ST_MakeLine(ST_Force2D(geom1), ST_Force2D(mid_geom)),
        ST_Distance(geom1::geography, mid_geom::geography) / 1000.0,
        0.0::double precision,
        0.0::double precision,
        NULL::text,
        'bridge-extend'::text
      FROM to_insert
      UNION ALL
      SELECT 
        new_edge2_id,
        NULL::bigint,
        node2_id,
        new_vertex_id,
        ST_MakeLine(ST_Force2D(geom2), ST_Force2D(mid_geom)),
        ST_Distance(geom2::geography, mid_geom::geography) / 1000.0,
        0.0::double precision,
        0.0::double precision,
        NULL::text,
        'bridge-extend'::text
      FROM to_insert
      RETURNING id
    )
    SELECT 
      (SELECT COUNT(*) FROM inserted_vertices) AS vertices_count,
      (SELECT COUNT(*) FROM inserted_edges) AS edges_count;
    `,
    [toleranceDegrees]
  );

  // Recalculate node degree (cnt) to reflect new connections
  await pgClient.query(`
    UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
    SET cnt = (
      SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
      WHERE e.source = v.id OR e.target = v.id
    )
  `);

  const verticesInserted = parseInt(result.rows[0]?.vertices_count || '0');
  const edgesInserted = parseInt(result.rows[0]?.edges_count || '0');
  return { midpointsInserted: verticesInserted, edgesInserted };
}


