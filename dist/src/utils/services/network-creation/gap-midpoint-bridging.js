"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runGapMidpointBridging = runGapMidpointBridging;
/**
 * Enhanced gap bridging: detect endpoint gaps within tolerance and create bridge edges
 * between degree-1 vertices and nearby degree-2 vertices, creating degree-3 intersections.
 *
 * This enables degree-2 chain merging by ensuring chains can end at proper intersections.
 */
async function runGapMidpointBridging(pgClient, stagingSchema, toleranceMeters) {
    // Convert meters to degrees approximately for ST_DWithin on 4326
    const toleranceDegrees = toleranceMeters / 111320; // adequate for small tolerances
    // Create bridge edges between nearby degree-1 vertices and degree-1/degree-2 vertices
    const result = await pgClient.query(`
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
    -- Connect degree-1 to degree-1 (endpoints to endpoints)
    degree1_to_degree1 AS (
      SELECT 
        d1.id AS source_id,
        d2.id AS target_id,
        d1.the_geom AS source_geom,
        d2.the_geom AS target_geom,
        ST_Distance(d1.the_geom, d2.the_geom) AS dist_deg
      FROM degree1_vertices d1
      CROSS JOIN degree1_vertices d2
      WHERE d1.id < d2.id  -- Avoid duplicates
        AND ST_DWithin(d1.the_geom, d2.the_geom, $1)
    ),
    -- Connect degree-1 to degree-2 (endpoints to connectors)
    degree1_to_degree2 AS (
      SELECT 
        d1.id AS source_id,
        d2.id AS target_id,
        d1.the_geom AS source_geom,
        d2.the_geom AS target_geom,
        ST_Distance(d1.the_geom, d2.the_geom) AS dist_deg
      FROM degree1_vertices d1
      CROSS JOIN degree2_vertices d2
      WHERE ST_DWithin(d1.the_geom, d2.the_geom, $1)
    ),
    -- Combine all candidate pairs
    candidate_pairs AS (
      SELECT * FROM degree1_to_degree1
      UNION ALL
      SELECT * FROM degree1_to_degree2
    ),
    filtered_pairs AS (
      -- Exclude pairs already directly connected by an edge
      SELECT cp.*
      FROM candidate_pairs cp
      WHERE NOT EXISTS (
        SELECT 1 FROM ${stagingSchema}.ways_noded w
        WHERE (w.source = cp.source_id AND w.target = cp.target_id)
           OR (w.source = cp.target_id AND w.target = cp.source_id)
      )
    ),
    numbered AS (
      SELECT 
        source_id,
        target_id,
        source_geom,
        target_geom,
        dist_deg,
        ROW_NUMBER() OVER (ORDER BY source_id, target_id) AS rn
      FROM filtered_pairs
    ),
    bases AS (
      SELECT 
        (SELECT COALESCE(MAX(id), 0) FROM ${stagingSchema}.ways_noded) AS base_edge_id
    ),
    to_insert AS (
      SELECT 
        n.source_id,
        n.target_id,
        n.source_geom,
        n.target_geom,
        (SELECT base_edge_id FROM bases) + n.rn AS new_edge_id
      FROM numbered n
    ),
    inserted_edges AS (
      INSERT INTO ${stagingSchema}.ways_noded (
        id, original_trail_id, source, target, the_geom, length_km, elevation_gain, elevation_loss, app_uuid, name
      )
      SELECT 
        new_edge_id,
        NULL::bigint,
        source_id,
        target_id,
        ST_MakeLine(ST_Force2D(source_geom), ST_Force2D(target_geom)),
        ST_Distance(source_geom::geography, target_geom::geography) / 1000.0,
        0.0::double precision,
        0.0::double precision,
        NULL::text,
        'bridge-extend'::text
      FROM to_insert
      RETURNING id
    )
    SELECT COUNT(*) AS edges_count FROM inserted_edges;
    `, [toleranceDegrees]);
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
//# sourceMappingURL=gap-midpoint-bridging.js.map