-- Create midpoint bridge segments at trail level between endpoint pairs within tolerance
-- For each pair of trail endpoints within tol_deg, insert two tiny trail rows that
-- extend each trail endpoint to the shared midpoint. These rows are regular trails so
-- downstream splitting/network/routing will include them naturally.

CREATE OR REPLACE FUNCTION public.carthorse_bridge_endpoints_midpoint_v1(
  schema_name text,
  tol_deg double precision,
  max_pairs integer DEFAULT 500
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  inserted integer := 0;
BEGIN
  -- Gather trail endpoints
  EXECUTE format('CREATE TEMP TABLE _trail_endpoints AS
    SELECT id AS trail_id, app_uuid, name, ST_StartPoint(geometry) AS pt FROM %I.trails
    UNION ALL
    SELECT id AS trail_id, app_uuid, name, ST_EndPoint(geometry)   AS pt FROM %I.trails
    WHERE geometry IS NOT NULL', schema_name, schema_name);

  -- Candidate pairs within tolerance (distinct trails)
  EXECUTE format('CREATE TEMP TABLE _pairs AS
    SELECT a.trail_id AS t1, b.trail_id AS t2,
           a.pt AS p1, b.pt AS p2,
           ST_Distance(a.pt, b.pt) AS d
    FROM _trail_endpoints a, _trail_endpoints b
    WHERE a.trail_id < b.trail_id
      AND ST_DWithin(a.pt, b.pt, %L)
    ORDER BY d ASC
    LIMIT %s', tol_deg, max_pairs);

  -- Insert two small connector trails to a shared midpoint for each pair
  EXECUTE format($f$
    WITH base AS (
      SELECT p.t1, p.t2,
             ST_LineInterpolatePoint(ST_MakeLine(p.p1, p.p2), 0.5) AS mp,
             p.p1, p.p2
      FROM _pairs p
    ), ins AS (
      INSERT INTO %I.trails (
        app_uuid, name, trail_type, surface, difficulty,
        geometry, length_km, elevation_gain, elevation_loss,
        max_elevation, min_elevation, avg_elevation, region, created_at, updated_at
      )
      SELECT gen_random_uuid()::text AS app_uuid,
             'Bridge (Midpoint)'::text AS name,
             'link'::text AS trail_type,
             'unknown'::text AS surface,
             'moderate'::text AS difficulty,
             ST_MakeLine(b.p1, b.mp) AS geometry,
             ST_Length(ST_MakeLine(b.p1, b.mp)::geography)/1000.0 AS length_km,
             0, 0, 0, 0, 0,
             (SELECT region FROM %I.trails LIMIT 1),
             NOW(), NOW()
      FROM base b
      WHERE ST_Length(ST_MakeLine(b.p1, b.mp)::geography) > 0.1
      UNION ALL
      SELECT gen_random_uuid()::text,
             'Bridge (Midpoint)'::text,
             'link','unknown','moderate',
             ST_MakeLine(b.p2, b.mp),
             ST_Length(ST_MakeLine(b.p2, b.mp)::geography)/1000.0,
             0,0,0,0,0,
             (SELECT region FROM %I.trails LIMIT 1),
             NOW(), NOW()
      FROM base b
      WHERE ST_Length(ST_MakeLine(b.p2, b.mp)::geography) > 0.1
      RETURNING 1
    )
    SELECT COUNT(*) FROM ins
  $f$, schema_name, schema_name, schema_name)
  INTO inserted;

  DROP TABLE IF EXISTS _pairs;
  DROP TABLE IF EXISTS _trail_endpoints;

  RETURN COALESCE(inserted, 0);
END;
$$;


