import { Pool } from 'pg';

/**
 * Validate and repair connector trail edges so every connector has a traversable
 * routing edge across its endpoints, and edge endpoints coincide exactly with
 * vertex coordinates. Operates across the entire staging schema.
 */
export async function runConnectorIntegrity(
  pgClient: Pool,
  stagingSchema: string,
  toleranceMeters: number
): Promise<{ totalConnectors: number; insertedEdges: number; normalizedEdges: number; weldedPairs: number }> {
  const tolDegrees = toleranceMeters / 111_320; // approx for EPSG:4326

  // Map connector trails to nearest vertices and compute pairs
  const integritySql = `
    WITH connectors AS (
      SELECT 
        t.app_uuid,
        COALESCE(t.name,'Connector') AS name,
        t.geometry AS geom,
        ST_StartPoint(t.geometry) AS a,
        ST_EndPoint(t.geometry)   AS b
      FROM ${stagingSchema}.trails t
      WHERE t.geometry IS NOT NULL
        AND ST_IsValid(t.geometry)
        AND (LOWER(COALESCE(t.trail_type,'')) = 'connector' OR t.name ILIKE '%connector%')
    ), mapped AS (
      SELECT 
        c.app_uuid,
        c.name,
        c.geom,
        (SELECT v.id FROM ${stagingSchema}.ways_noded_vertices_pgr v ORDER BY v.the_geom <-> c.a LIMIT 1) AS v1,
        (SELECT v.id FROM ${stagingSchema}.ways_noded_vertices_pgr v ORDER BY v.the_geom <-> c.b LIMIT 1) AS v2
      FROM connectors c
    ), pairs AS (
      SELECT 
        m.app_uuid,
        m.name,
        m.geom,
        LEAST(m.v1,m.v2) AS src,
        GREATEST(m.v1,m.v2) AS dst
      FROM mapped m
      WHERE m.v1 IS NOT NULL AND m.v2 IS NOT NULL AND m.v1 <> m.v2
    ), weld_needed AS (
      SELECT p.*
      FROM pairs p
      WHERE ST_DWithin(
        (SELECT the_geom FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE id = p.src),
        (SELECT the_geom FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE id = p.dst),
        ${tolDegrees}
      )
    ), weld_do AS (
      -- Remap edges to canonical src (smallest id) where endpoints are within tolerance
      UPDATE ${stagingSchema}.ways_noded w
      SET source = p.src
      FROM weld_needed p
      WHERE w.source = p.dst
      RETURNING 1
    ), weld_do2 AS (
      UPDATE ${stagingSchema}.ways_noded w
      SET target = p.src
      FROM weld_needed p
      WHERE w.target = p.dst
      RETURNING 1
    ), del_orphans AS (
      DELETE FROM ${stagingSchema}.ways_noded_vertices_pgr v
      WHERE v.id IN (SELECT dst FROM weld_needed)
        AND NOT EXISTS (
          SELECT 1 FROM ${stagingSchema}.ways_noded e WHERE e.source=v.id OR e.target=v.id
        )
      RETURNING 1
    ), missing AS (
      SELECT p.*
      FROM pairs p
      WHERE NOT EXISTS (
        SELECT 1 FROM ${stagingSchema}.ways_noded w
        WHERE (w.source = p.src AND w.target = p.dst)
           OR (w.source = p.dst AND w.target = p.src)
      )
    ), idbase AS (
      SELECT COALESCE(MAX(id),0) AS base FROM ${stagingSchema}.ways_noded
    ), inserted AS (
      INSERT INTO ${stagingSchema}.ways_noded
        (id, original_trail_id, sub_id, the_geom, app_uuid, name, length_km, elevation_gain, elevation_loss, source, target)
      SELECT 
        idbase.base + ROW_NUMBER() OVER () AS id,
                  NULL::bigint AS original_trail_id,
        1 AS sub_id,
        -- normalize geometry endpoints to the exact vertex coordinates
        ST_SetPoint(
          ST_SetPoint(p.geom, 0, vsrc.the_geom),
          ST_NumPoints(p.geom)-1,
          vdst.the_geom
        ) AS the_geom,
        p.app_uuid,
        p.name,
        ST_Length(
          ST_SetPoint(
            ST_SetPoint(p.geom, 0, vsrc.the_geom),
            ST_NumPoints(p.geom)-1,
            vdst.the_geom
          )::geography
        )/1000.0 AS length_km,
        0::double precision AS elevation_gain,
        0::double precision AS elevation_loss,
        p.src AS source,
        p.dst AS target
      FROM missing p, idbase
      JOIN ${stagingSchema}.ways_noded_vertices_pgr vsrc ON vsrc.id = p.src
      JOIN ${stagingSchema}.ways_noded_vertices_pgr vdst ON vdst.id = p.dst
      RETURNING 1
    ), normalize AS (
      -- normalize existing connector edges to match vertex coordinates exactly
      WITH conn_edges AS (
        SELECT w.id, p.src, p.dst
        FROM pairs p
        JOIN ${stagingSchema}.ways_noded w
          ON (w.source=p.src AND w.target=p.dst) OR (w.source=p.dst AND w.target=p.src)
      )
      UPDATE ${stagingSchema}.ways_noded w
      SET the_geom = ST_SetPoint(ST_SetPoint(w.the_geom,0,v1.the_geom), ST_NumPoints(w.the_geom)-1, v2.the_geom),
          length_km = ST_Length(ST_SetPoint(ST_SetPoint(w.the_geom,0,v1.the_geom), ST_NumPoints(w.the_geom)-1, v2.the_geom)::geography)/1000.0,
          source = LEAST(c.src,c.dst),
          target = GREATEST(c.src,c.dst)
      FROM conn_edges c
      JOIN ${stagingSchema}.ways_noded_vertices_pgr v1 ON v1.id = LEAST(c.src,c.dst)
      JOIN ${stagingSchema}.ways_noded_vertices_pgr v2 ON v2.id = GREATEST(c.src,c.dst)
      WHERE w.id = c.id
      RETURNING 1
    )
    SELECT 
      (SELECT COUNT(*) FROM connectors) AS total_connectors,
      (SELECT COUNT(*) FROM inserted)   AS inserted_edges,
      (SELECT COUNT(*) FROM normalize)  AS normalized_edges,
      ((SELECT COUNT(*) FROM weld_do) + (SELECT COUNT(*) FROM weld_do2)) AS welded_pairs
  `;

  const result = await pgClient.query(integritySql);
  const row = result.rows[0] || {};
  return {
    totalConnectors: Number(row.total_connectors || 0),
    insertedEdges: Number(row.inserted_edges || 0),
    normalizedEdges: Number(row.normalized_edges || 0),
    weldedPairs: Number(row.welded_pairs || 0)
  };
}


