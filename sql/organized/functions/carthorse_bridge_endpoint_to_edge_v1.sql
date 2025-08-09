-- and adding two short connectors: endpoint -> cp, cp -> nearest endpoint of the edge.
-- Proximity-only; no name checks. Idempotent-ish via simple duplicate guards.

CREATE OR REPLACE FUNCTION public.carthorse_bridge_endpoint_to_edge_v1(
  schema_name text,
  tol_deg double precision
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  added integer := 0;
  vrec RECORD;
  edge_id bigint;
  edge_geom geometry;
  cp geometry;
  cp_vid integer;
  max_vid integer;
  max_eid integer;
  src_id integer;
  tgt_id integer;
  src_geom geometry;
  tgt_geom geometry;
  u_vid integer;
  exists_bridge boolean;
BEGIN
  -- Build endpoint vertices (cnt=1)
  EXECUTE format('CREATE TEMP TABLE _endpoints AS
    SELECT id AS vid, the_geom AS geom
    FROM %I.ways_noded_vertices_pgr
    WHERE cnt = 1', schema_name);

  -- Prepare max ids
  EXECUTE format('SELECT COALESCE(MAX(id),0) FROM %I.ways_noded_vertices_pgr', schema_name) INTO max_vid;
  EXECUTE format('SELECT COALESCE(MAX(id),0) FROM %I.ways_noded', schema_name) INTO max_eid;

  FOR vrec IN EXECUTE 'SELECT * FROM _endpoints' LOOP
    -- Find nearest edge within tolerance
    EXECUTE format('SELECT id, the_geom FROM %I.ways_noded
                    WHERE ST_DWithin(the_geom, $1, $2)
                    ORDER BY ST_Distance(the_geom, $1)
                    LIMIT 1', schema_name)
      INTO edge_id, edge_geom
      USING vrec.geom, tol_deg;

    IF edge_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Closest point on the target edge
    SELECT ST_ClosestPoint(edge_geom, vrec.geom) INTO cp;

    -- Skip if connector already exists (same geometry)
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.ways_noded WHERE ST_Equals(the_geom, $1))', schema_name)
      INTO exists_bridge USING ST_MakeLine(vrec.geom, cp);
    IF exists_bridge THEN CONTINUE; END IF;

    -- Insert new vertex at cp
    max_vid := max_vid + 1;
    EXECUTE format('INSERT INTO %I.ways_noded_vertices_pgr (id, the_geom, cnt, chk, ein, eout, node_type)
                    VALUES ($1, $2, 2, 0, 0, 0, ''intersection'')', schema_name)
      USING max_vid, cp;
    cp_vid := max_vid;

    -- Find nearest endpoint vertex of the target edge (source or target)
    EXECUTE format('SELECT source, target FROM %I.ways_noded WHERE id=$1', schema_name)
      INTO src_id, tgt_id USING edge_id;
    EXECUTE format('SELECT the_geom FROM %I.ways_noded_vertices_pgr WHERE id=$1', schema_name)
      INTO src_geom USING src_id;
    EXECUTE format('SELECT the_geom FROM %I.ways_noded_vertices_pgr WHERE id=$1', schema_name)
      INTO tgt_geom USING tgt_id;
    IF ST_Distance(src_geom, cp) <= ST_Distance(tgt_geom, cp) THEN
      u_vid := src_id;
    ELSE
      u_vid := tgt_id;
    END IF;

    -- Insert bridge edges (endpoint->cp) and (cp->nearest endpoint)
    max_eid := max_eid + 1;
    EXECUTE format('INSERT INTO %I.ways_noded (id, old_id, sub_id, the_geom, app_uuid, name, length_km, elevation_gain, elevation_loss, source, target)
                    VALUES ($1, NULL, 1, $2, NULL, ''Bridge'', ST_Length($2::geography)/1000.0, 0, 0, $3, $4)', schema_name)
      USING max_eid, ST_MakeLine(vrec.geom, cp), vrec.vid, cp_vid;

    max_eid := max_eid + 1;
    EXECUTE format('INSERT INTO %I.ways_noded (id, old_id, sub_id, the_geom, app_uuid, name, length_km, elevation_gain, elevation_loss, source, target)
                    VALUES ($1, NULL, 1, ST_MakeLine($2, (SELECT the_geom FROM %I.ways_noded_vertices_pgr WHERE id=$3)), NULL, ''Bridge'', ST_Length(ST_MakeLine($2, (SELECT the_geom FROM %I.ways_noded_vertices_pgr WHERE id=$3))::geography)/1000.0, 0, 0, $4, $3)', schema_name, schema_name)
      USING max_eid, cp, u_vid, cp_vid;

    added := added + 2;
  END LOOP;

  DROP TABLE IF EXISTS _endpoints;
  RETURN added;
END;
$$;


