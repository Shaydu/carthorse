-- Versioned wrapper around pgr_nodeNetwork with safe preprocessing
-- - Snap to grid (≈1m) to eliminate near-coincident vertices
-- - Force2D, MakeValid
-- - Remove zero-length and duplicate segments
--
-- Returns the standard pgr_nodeNetwork columns but aliases geometry as the_geom

CREATE OR REPLACE FUNCTION public.carthorse_pgr_node_network_v2(
  edges_table regclass,
  tol_deg double precision,
  grid_deg double precision DEFAULT 0.000009
)
RETURNS TABLE (
  id       bigint,
  old_id   bigint,
  sub_id   integer,
  the_geom geometry,
  cnt      integer,
  chk      integer,
  ein      integer,
  eout     integer
) LANGUAGE plpgsql AS $$
BEGIN
  -- Prepare temp table within the same session
  EXECUTE format('CREATE TEMP TABLE prepped_edges AS
                  SELECT id,
                         ST_Force2D(ST_SnapToGrid(ST_MakeValid(the_geom), %L)) AS the_geom,
                         ST_SRID(the_geom) AS srid
                  FROM %s', grid_deg, edges_table::text);

  -- Remove invalid/degenerate rows
  EXECUTE 'DELETE FROM prepped_edges WHERE ST_IsEmpty(the_geom) OR NOT ST_IsValid(the_geom)';
  EXECUTE 'DELETE FROM prepped_edges WHERE ST_NumPoints(the_geom) < 2';
  EXECUTE 'DELETE FROM prepped_edges WHERE ST_Length(the_geom) < 1e-9';

  -- Deduplicate exact-geometry duplicates
  EXECUTE 'DELETE FROM prepped_edges a USING prepped_edges b
           WHERE a.ctid < b.ctid AND ST_Equals(a.the_geom, b.the_geom)';

  -- Run pgr_nodeNetwork on the prepped table; alias geom -> the_geom for callers
  RETURN QUERY
  SELECT id, old_id, sub_id, the_geom, cnt, chk, ein, eout
  FROM pgr_nodeNetwork(
    'SELECT id AS id, the_geom AS the_geom, srid AS srid FROM prepped_edges',
    tol_deg,
    'id',
    'the_geom',
    'srid',
    NULL,
    TRUE
  );
END;
$$;


