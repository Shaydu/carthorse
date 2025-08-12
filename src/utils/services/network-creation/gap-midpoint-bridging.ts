import { Pool } from 'pg';

/**
 * Minimal gap bridging: detect endpoint gaps within tolerance and create a single
 * direct bridge edge between them, avoiding unnecessary midpoint vertices.
 *
 * Behavior is config-driven (meters), not gated by env flags. Intended to run after
 * ways_noded and ways_noded_vertices_pgr are created and source/target set.
 */
export async function runGapMidpointBridging(
  pgClient: Pool,
  stagingSchema: string,
  toleranceMeters: number
): Promise<{ bridgesInserted: number }> {
  // Convert meters to degrees approximately for ST_DWithin on 4326
  const toleranceDegrees = toleranceMeters / 111_320; // adequate for small tolerances

  // Create direct bridge edges between nearby endpoints
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
    numbered AS (
      SELECT 
        node1_id,
        node2_id,
        geom1,
        geom2,
        dist_deg,
        ROW_NUMBER() OVER (ORDER BY node1_id, node2_id) AS rn
      FROM filtered_pairs
    ),
    bases AS (
      SELECT 
        (SELECT COALESCE(MAX(id), 0) FROM ${stagingSchema}.ways_noded) AS base_edge_id
    ),
    to_insert AS (
      SELECT 
        n.node1_id,
        n.node2_id,
        n.geom1,
        n.geom2,
        (SELECT base_edge_id FROM bases) + n.rn AS new_edge_id
      FROM numbered n
    ),
    inserted_edges AS (
      INSERT INTO ${stagingSchema}.ways_noded (
        id, old_id, source, target, the_geom, length_km, elevation_gain, elevation_loss, app_uuid, name
      )
      SELECT 
        new_edge_id,
        NULL::bigint,
        node1_id,
        node2_id,
        ST_MakeLine(ST_Force2D(geom1), ST_Force2D(geom2)),
        ST_Distance(geom1::geography, geom2::geography) / 1000.0,
        0.0::double precision,
        0.0::double precision,
        NULL::text,
        'bridge-extend'::text
      FROM to_insert
      RETURNING id
    )
    SELECT COUNT(*) AS edges_count FROM inserted_edges;
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

  const bridgesInserted = parseInt(result.rows[0]?.edges_count || '0');
  return { bridgesInserted };
}


