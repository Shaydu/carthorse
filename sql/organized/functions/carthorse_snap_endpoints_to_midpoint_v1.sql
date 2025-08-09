-- Snap pairs of trail endpoints within tolerance to their shared midpoint.
-- This modifies the original trail geometries so they share an identical endpoint vertex.

CREATE OR REPLACE FUNCTION public.carthorse_snap_endpoints_to_midpoint_v1(
  schema_name text,
  tol_deg double precision,
  max_pairs integer DEFAULT 500
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  affected integer := 0;
BEGIN
  -- Collect trail endpoints
  EXECUTE format('CREATE TEMP TABLE _eps AS
    SELECT id AS trail_id,
           ST_StartPoint(geometry) AS pt
    FROM %I.trails
    WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    UNION ALL
    SELECT id AS trail_id,
           ST_EndPoint(geometry) AS pt
    FROM %I.trails
    WHERE geometry IS NOT NULL AND ST_IsValid(geometry)', schema_name, schema_name);

  -- Candidate endpoint pairs within tolerance (distinct trails)
  EXECUTE format('CREATE TEMP TABLE _pairs AS
    SELECT a.trail_id AS t1,
           b.trail_id AS t2,
           ST_LineInterpolatePoint(ST_MakeLine(a.pt, b.pt), 0.5) AS mp,
           ST_Distance(a.pt, b.pt) AS d
    FROM _eps a, _eps b
    WHERE a.trail_id < b.trail_id
      AND ST_DWithin(a.pt, b.pt, %L)
    ORDER BY d ASC
    LIMIT %s', tol_deg, max_pairs);

  -- Snap both trails in each pair so their closest endpoint coincides at mp
  EXECUTE format($f$
    WITH upd AS (
      UPDATE %I.trails t
      SET geometry = ST_Snap(t.geometry, p.mp, %L)
      FROM _pairs p
      WHERE t.id IN (p.t1, p.t2)
      RETURNING 1
    )
    SELECT COUNT(*) FROM upd
  $f$, schema_name, tol_deg)
  INTO affected;

  DROP TABLE IF EXISTS _pairs;
  DROP TABLE IF EXISTS _eps;

  RETURN COALESCE(affected, 0);
END;
$$;


