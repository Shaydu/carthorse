import { Pool } from 'pg';

/**
 * Ensure an explicit routing edge spans each trail-level connector.
 * - Finds nearest vertices to each connector endpoint within tolerance
 * - Inserts a single edge in ways_noded following the connector geometry
 * - Skips if an edge already connects those two vertices
 * - Refreshes vertex degree counts
 */
export async function runConnectorEdgeSpanning(
  pgClient: Pool,
  stagingSchema: string,
  toleranceMeters: number
): Promise<{ inserted: number; matched: number }> {
  // Insert missing connector edges
  const insertResult = await pgClient.query(
    `
    WITH cfg AS (
      SELECT $1::double precision AS tol_m,
             ($1::double precision / 111320.0) AS tol_deg
    ),
    vunion AS (
      SELECT ST_UnaryUnion(ST_Collect(the_geom)) AS g
      FROM ${stagingSchema}.ways_noded_vertices_pgr
    ),
    connectors AS (
      SELECT 
        t.app_uuid,
        COALESCE(t.name, 'Connector') AS name,
        -- Snap connector geometry to existing vertex set (within tolerance) to enforce coincidence
        ST_Snap(ST_Force2D(t.geometry), (SELECT g FROM vunion), (SELECT tol_deg FROM cfg)) AS geometry
      FROM ${stagingSchema}.trails t
      WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        AND (t.trail_type = 'connector' OR t.name ILIKE '%connector%')
    ),
    nearest AS (
      SELECT 
        c.app_uuid,
        c.name,
        c.geometry,
        (SELECT v.id FROM ${stagingSchema}.ways_noded_vertices_pgr v 
           WHERE ST_DWithin(v.the_geom::geography, ST_StartPoint(c.geometry)::geography, (SELECT tol_m FROM cfg))
           ORDER BY ST_Distance(v.the_geom::geography, ST_StartPoint(c.geometry)::geography) ASC
           LIMIT 1) AS src,
        (SELECT v.id FROM ${stagingSchema}.ways_noded_vertices_pgr v 
           WHERE ST_DWithin(v.the_geom::geography, ST_EndPoint(c.geometry)::geography, (SELECT tol_m FROM cfg))
           ORDER BY ST_Distance(v.the_geom::geography, ST_EndPoint(c.geometry)::geography) ASC
           LIMIT 1) AS dst
      FROM connectors c
    ),
    candidates AS (
      SELECT * FROM nearest WHERE src IS NOT NULL AND dst IS NOT NULL AND src <> dst
    ),
    missing AS (
      SELECT n.*
      FROM candidates n
      WHERE NOT EXISTS (
        SELECT 1
        FROM ${stagingSchema}.ways_noded w
        WHERE (w.source = n.src AND w.target = n.dst)
           OR (w.source = n.dst AND w.target = n.src)
      )
    ),
    idbase AS (
      SELECT COALESCE(MAX(id), 0) AS base FROM ${stagingSchema}.ways_noded
    ),
    inserted AS (
      INSERT INTO ${stagingSchema}.ways_noded
        (id, old_id, sub_id, the_geom, app_uuid, name, length_km, elevation_gain, elevation_loss, source, target)
      SELECT 
        idbase.base + ROW_NUMBER() OVER () AS id,
        NULL::bigint AS old_id,
        1 AS sub_id,
        ST_Force2D(m.geometry) AS the_geom,
        m.app_uuid,
        m.name,
        ST_Length(m.geometry::geography) / 1000.0 AS length_km,
        0::double precision AS elevation_gain,
        0::double precision AS elevation_loss,
        m.src AS source,
        m.dst AS target
      FROM missing m, idbase
      RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM inserted) AS inserted,
           (SELECT COUNT(*) FROM candidates) AS matched;
    `,
    [toleranceMeters]
  );

  // Refresh degree counts so routing can traverse new connector edges
  await pgClient.query(
    `UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
     SET cnt = (
       SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
       WHERE e.source = v.id OR e.target = v.id
     )`
  );

  const row = insertResult.rows[0] || { inserted: 0, matched: 0 };
  return { inserted: Number(row.inserted || 0), matched: Number(row.matched || 0) };
}


