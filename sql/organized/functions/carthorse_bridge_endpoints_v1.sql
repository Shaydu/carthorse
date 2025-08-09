-- Bridge very close endpoints to remove artificial gaps
-- Creates connector edges between endpoint vertices that are within tol_deg
-- Optionally requires both endpoints to belong to edges with the same trail name

CREATE OR REPLACE FUNCTION public.carthorse_bridge_endpoints_v1(
  schema_name text,
  tol_deg double precision,
  require_same_name boolean DEFAULT true
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  added integer := 0;
BEGIN
  -- Build qualified table names
  EXECUTE format('CREATE TEMP TABLE _v AS
    SELECT v.id as vid, v.the_geom as geom
    FROM %I.ways_noded_vertices_pgr v
    WHERE v.cnt = 1', schema_name);

  -- Endpoints with their attached edge and name
  EXECUTE format('CREATE TEMP TABLE _ve AS
    SELECT v.vid, e.id as edge_id, e.old_id, e.name, v.geom
    FROM _v v
    JOIN %I.ways_noded e ON (e.source = v.vid OR e.target = v.vid)', schema_name);

  -- Candidate pairs within tolerance
  EXECUTE 'CREATE TEMP TABLE _pairs AS
    SELECT a.vid as v1, b.vid as v2,
           a.edge_id as e1, b.edge_id as e2,
           a.name as n1, b.name as n2,
           ST_Distance(a.geom, b.geom) as d,
           a.geom as g1, b.geom as g2
    FROM _ve a, _ve b
    WHERE a.vid < b.vid';

  -- Filter by distance and (optionally) same name
  IF require_same_name THEN
    EXECUTE format('CREATE TEMP TABLE _bridges AS
      SELECT v1, v2, e1, e2, n1, n2, g1, g2, d, ST_MakeLine(g1, g2) AS the_geom
      FROM _pairs WHERE d <= %L AND n1 IS NOT NULL AND n1 = n2', tol_deg);
  ELSE
    EXECUTE format('CREATE TEMP TABLE _bridges AS
      SELECT v1, v2, e1, e2, n1, n2, g1, g2, d, ST_MakeLine(g1, g2) AS the_geom
      FROM _pairs WHERE d <= %L', tol_deg);
  END IF;

  -- Insert connector edges
  EXECUTE format(
    'WITH mx AS (
       SELECT COALESCE(MAX(id),0) AS max_id FROM %I.ways_noded
     ), ins AS (
       INSERT INTO %I.ways_noded (id, old_id, sub_id, the_geom, app_uuid, name, length_km, elevation_gain, elevation_loss, source, target)
       SELECT mx.max_id + ROW_NUMBER() OVER () AS id,
              NULL AS old_id,
              1 AS sub_id,
              b.the_geom,
              NULL::text AS app_uuid,
              COALESCE(b.n1, b.n2, ''Bridge'') AS name,
              ST_Length(b.the_geom::geography)/1000.0 AS length_km,
              0 AS elevation_gain,
              0 AS elevation_loss,
              b.v1 AS source,
              b.v2 AS target
       FROM _bridges b CROSS JOIN mx
       WHERE ST_Length(b.the_geom::geography) > 0.1
       RETURNING 1
     )
     SELECT COUNT(*) FROM ins', schema_name, schema_name)
  INTO added;

  -- Cleanup temps
  DROP TABLE IF EXISTS _bridges;
  DROP TABLE IF EXISTS _pairs;
  DROP TABLE IF EXISTS _ve;
  DROP TABLE IF EXISTS _v;

  RETURN added;
END;
$$;


