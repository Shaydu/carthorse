import { Pool } from 'pg';

/**
 * Enhanced gap bridging: detect endpoint gaps within tolerance and create bridge edges
 * between degree-1 vertices and nearby degree-2 vertices, creating degree-3 intersections.
 *
 * This enables degree-2 chain merging by ensuring chains can end at proper intersections.
 */
export async function runGapMidpointBridging(
  pgClient: Pool,
  stagingSchema: string,
  toleranceMeters: number
): Promise<{ bridgesInserted: number }> {
  // Convert meters to degrees approximately for ST_DWithin on 4326
  const toleranceDegrees = toleranceMeters / 111_320; // adequate for small tolerances

  // Create bridge edges between nearby degree-1 and degree-2 vertices
  const result = await pgClient.query(
    `
    WITH degree1_vertices AS (
      SELECT id, the_geom
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      WHERE cnt = 1
    ),
    degree2_vertices AS (
      SELECT id, the_geom
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      WHERE cnt = 2
    ),
    candidate_pairs AS (
      SELECT 
        d1.id AS degree1_id,
        d2.id AS degree2_id,
        d1.the_geom AS geom1,
        d2.the_geom AS geom2,
        ST_Distance(d1.the_geom, d2.the_geom) AS dist_deg
      FROM degree1_vertices d1
      CROSS JOIN degree2_vertices d2
      WHERE ST_DWithin(d1.the_geom, d2.the_geom, $1)
    ),
    filtered_pairs AS (
      -- Exclude pairs already directly connected by an edge
      SELECT cp.*
      FROM candidate_pairs cp
      WHERE NOT EXISTS (
        SELECT 1 FROM ${stagingSchema}.ways_noded w
        WHERE (w.source = cp.degree1_id AND w.target = cp.degree2_id)
           OR (w.source = cp.degree2_id AND w.target = cp.degree1_id)
      )
    ),
    numbered AS (
      SELECT 
        degree1_id,
        degree2_id,
        geom1,
        geom2,
        dist_deg,
        ROW_NUMBER() OVER (ORDER BY degree1_id, degree2_id) AS rn
      FROM filtered_pairs
    ),
    bases AS (
      SELECT 
        (SELECT COALESCE(MAX(id), 0) FROM ${stagingSchema}.ways_noded) AS base_edge_id
    ),
    to_insert AS (
      SELECT 
        n.degree1_id,
        n.degree2_id,
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
        degree1_id,
        degree2_id,
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

  const bridgesInserted = parseInt(result.rows[0].edges_count);
  
  if (bridgesInserted > 0) {
    console.log(`🔗 Gap midpoint bridging: ${bridgesInserted} bridge edges inserted between degree-1 and degree-2 vertices`);
  }
  
  return { bridgesInserted };
}


