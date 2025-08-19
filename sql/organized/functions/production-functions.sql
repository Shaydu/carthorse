-- Carthorse Production Functions Export
-- Generated on: 2025-08-02T03:55:23.088Z
-- Database: trail_master_db
-- 
-- This file contains all functions from the production PostGIS database.
-- Use this file for backup and version control purposes.
--

CREATE OR REPLACE FUNCTION public.__st_countagg_transfn(agg agg_count, rast raster, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, sample_percent double precision DEFAULT 1)
 RETURNS agg_count
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		_count bigint;
		rtn_agg agg_count;
	BEGIN
		IF agg IS NULL THEN
			rtn_agg.count := 0;
			IF nband < 1 THEN
				RAISE EXCEPTION 'Band index must be greater than zero (1-based)';
			ELSE
				rtn_agg.nband := nband;
			END IF;
			IF exclude_nodata_value IS FALSE THEN
				rtn_agg.exclude_nodata_value := FALSE;
			ELSE
				rtn_agg.exclude_nodata_value := TRUE;
			END IF;
			IF sample_percent < 0. OR sample_percent > 1. THEN
				RAISE EXCEPTION 'Sample percent must be between zero and one';
			ELSE
				rtn_agg.sample_percent := sample_percent;
			END IF;
		ELSE
			rtn_agg := agg;
		END IF;
		IF rast IS NOT NULL THEN
			IF rtn_agg.exclude_nodata_value IS FALSE THEN
				SELECT width * height INTO _count FROM public.ST_Metadata(rast);
			ELSE
				SELECT count INTO _count FROM public._ST_summarystats(
					rast,
				 	rtn_agg.nband, rtn_agg.exclude_nodata_value,
					rtn_agg.sample_percent
				);
			END IF;
		END IF;
		rtn_agg.count := rtn_agg.count + _count;
		RETURN rtn_agg;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._add_overview_constraint(ovschema name, ovtable name, ovcolumn name, refschema name, reftable name, refcolumn name, factor integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		fqtn text;
		cn name;
		sql text;
	BEGIN
		fqtn := '';
		IF length($1) > 0 THEN
			fqtn := quote_ident($1) || '.';
		END IF;
		fqtn := fqtn || quote_ident($2);
		cn := 'enforce_overview_' || $3;
		sql := 'ALTER TABLE ' || fqtn
			|| ' ADD CONSTRAINT ' || quote_ident(cn)
			|| ' CHECK ( public._overview_constraint(' || quote_ident($3)
			|| ',' || $7
			|| ',' || quote_literal($4)
			|| ',' || quote_literal($5)
			|| ',' || quote_literal($6)
			|| '))';
		RETURN  public._add_raster_constraint(cn, sql);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._add_raster_constraint(cn name, sql text)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	BEGIN
		BEGIN
			EXECUTE sql;
		EXCEPTION
			WHEN duplicate_object THEN
				RAISE NOTICE 'The constraint "%" already exists.  To replace the existing constraint, delete the constraint and call ApplyRasterConstraints again', cn;
			WHEN OTHERS THEN
				RAISE NOTICE 'Unable to add constraint: %', cn;
				RAISE NOTICE 'SQL used for failed constraint: %', sql;
				RAISE NOTICE 'Returned error message: % (%)', SQLERRM, SQLSTATE;
				RETURN FALSE;
		END;
		RETURN TRUE;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._add_raster_constraint_alignment(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		fqtn text;
		cn name;
		sql text;
		attr text;
	BEGIN
		fqtn := '';
		IF length($1) > 0 THEN
			fqtn := quote_ident($1) || '.';
		END IF;
		fqtn := fqtn || quote_ident($2);
		cn := 'enforce_same_alignment_' || $3;
		sql := 'SELECT public.st_makeemptyraster(1, 1, upperleftx, upperlefty, scalex, scaley, skewx, skewy, srid) FROM public.st_metadata((SELECT '
			|| quote_ident($3)
			|| ' FROM '
			|| fqtn
			|| ' WHERE '
			|| quote_ident($3)
			|| ' IS NOT NULL LIMIT 1))';
		BEGIN
			EXECUTE sql INTO attr;
		EXCEPTION WHEN OTHERS THEN
			RAISE NOTICE 'Unable to get the alignment of a sample raster: % (%)',
        SQLERRM, SQLSTATE;
			RETURN FALSE;
		END;
		sql := 'ALTER TABLE ' || fqtn ||
			' ADD CONSTRAINT ' || quote_ident(cn) ||
			' CHECK (public.st_samealignment(' || quote_ident($3) || ', ''' || attr || '''::raster))';
		RETURN  public._add_raster_constraint(cn, sql);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._add_raster_constraint_blocksize(rastschema name, rasttable name, rastcolumn name, axis text)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		fqtn text;
		cn name;
		sql text;
		attrset integer[];
		attr integer;
	BEGIN
		IF lower($4) != 'width' AND lower($4) != 'height' THEN
			RAISE EXCEPTION 'axis must be either "width" or "height"';
			RETURN FALSE;
		END IF;
		fqtn := '';
		IF length($1) > 0 THEN
			fqtn := quote_ident($1) || '.';
		END IF;
		fqtn := fqtn || quote_ident($2);
		cn := 'enforce_' || $4 || '_' || $3;
		sql := 'SELECT public.st_' || $4 || '('
			|| quote_ident($3)
			|| ') FROM ' || fqtn
			|| ' GROUP BY 1 ORDER BY count(*) DESC';
		BEGIN
			attrset := ARRAY[]::integer[];
			FOR attr IN EXECUTE sql LOOP
				attrset := attrset || attr;
			END LOOP;
		EXCEPTION WHEN OTHERS THEN
			RAISE NOTICE 'Unable to get the % of a sample raster: % (%)',
        $4, SQLERRM, SQLSTATE;
			RETURN FALSE;
		END;
		sql := 'ALTER TABLE ' || fqtn
			|| ' ADD CONSTRAINT ' || quote_ident(cn)
			|| ' CHECK (st_' || $4 || '('
			|| quote_ident($3)
			|| ') IN (' || array_to_string(attrset, ',') || '))';
		RETURN  public._add_raster_constraint(cn, sql);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._add_raster_constraint_coverage_tile(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		fqtn text;
		cn name;
		sql text;
		_scalex double precision;
		_scaley double precision;
		_skewx double precision;
		_skewy double precision;
		_tilewidth integer;
		_tileheight integer;
		_alignment boolean;
		_covextent public.geometry;
		_covrast public.raster;
	BEGIN
		fqtn := '';
		IF length($1) > 0 THEN
			fqtn := quote_ident($1) || '.';
		END IF;
		fqtn := fqtn || quote_ident($2);
		cn := 'enforce_coverage_tile_' || $3;
		BEGIN
			sql := 'WITH foo AS (SELECT public.ST_Metadata(' || quote_ident($3) || ') AS meta, public.ST_ConvexHull(' || quote_ident($3) || ') AS hull FROM ' || fqtn || ') SELECT max((meta).scalex), max((meta).scaley), max((meta).skewx), max((meta).skewy), max((meta).width), max((meta).height), public.ST_Union(hull) FROM foo';
			EXECUTE sql INTO _scalex, _scaley, _skewx, _skewy, _tilewidth, _tileheight, _covextent;
		EXCEPTION WHEN OTHERS THEN
			RAISE DEBUG 'Unable to get coverage metadata for %.%: % (%)',
        fqtn, quote_ident($3), SQLERRM, SQLSTATE;
		END;
		BEGIN
			_covrast := public.ST_AsRaster(_covextent, _scalex, _scaley, '8BUI', 1, 0, NULL, NULL, _skewx, _skewy);
			IF _covrast IS NULL THEN
				RAISE NOTICE 'Unable to create coverage raster: ST_AsRaster returned NULL.';
				RETURN FALSE;
			END IF;
			_covrast := ST_MakeEmptyRaster(_covrast);
		EXCEPTION WHEN OTHERS THEN
			RAISE NOTICE 'Unable to create coverage raster. Cannot add coverage tile constraint: % (%)',
        SQLERRM, SQLSTATE;
			RETURN FALSE;
		END;
		sql := 'ALTER TABLE ' || fqtn ||
			' ADD CONSTRAINT ' || quote_ident(cn) ||
			' CHECK (public.st_iscoveragetile(' || quote_ident($3) || ', ''' || _covrast || '''::raster, ' || _tilewidth || ', ' || _tileheight || '))';
		RETURN  public._add_raster_constraint(cn, sql);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._add_raster_constraint_extent(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT COST 9000
AS $function$
	DECLARE
		fqtn text;
		cn name;
		sql text;
		attr text; srid integer;
	BEGIN
		fqtn := '';
		IF length(rastschema) > 0 THEN
			fqtn := quote_ident(rastschema) || '.';
		END IF;
		fqtn := fqtn || quote_ident(rasttable);
		sql := 'SELECT public.ST_SRID('
			|| quote_ident(rastcolumn)
			|| ') FROM '
			|| fqtn
			|| ' WHERE '
			|| quote_ident(rastcolumn)
			|| ' IS NOT NULL LIMIT 1;';
                EXECUTE sql INTO srid;
    IF srid IS NULL THEN
      RETURN false;
    END IF;
		cn := 'enforce_max_extent_' || rastcolumn;
		sql := 'SELECT public.st_ashexewkb( public.st_setsrid( public.st_extent( public.st_envelope('
			|| quote_ident(rastcolumn)
			|| ')), ' || srid || ')) FROM '
			|| fqtn;
		EXECUTE sql INTO attr;
		sql := 'ALTER TABLE ' || fqtn
			|| ' ADD CONSTRAINT ' || quote_ident(cn)
			|| ' CHECK ( public.st_envelope('
			|| quote_ident(rastcolumn)
			|| ') @ ''' || attr || '''::geometry) NOT VALID';
		RETURN  public._add_raster_constraint(cn, sql);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._add_raster_constraint_nodata_values(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		fqtn text;
		cn name;
		sql text;
		attr numeric[];
		max int;
	BEGIN
		fqtn := '';
		IF length($1) > 0 THEN
			fqtn := quote_ident($1) || '.';
		END IF;
		fqtn := fqtn || quote_ident($2);
		cn := 'enforce_nodata_values_' || $3;
		sql := 'SELECT public._raster_constraint_nodata_values(' || quote_ident($3)
			|| ') FROM ' || fqtn
			|| ' WHERE '
			|| quote_ident($3)
			|| ' IS NOT NULL LIMIT 1;';
		BEGIN
			EXECUTE sql INTO attr;
		EXCEPTION WHEN OTHERS THEN
			RAISE NOTICE 'Unable to get the nodata values of a sample raster: % (%)',
        SQLERRM, SQLSTATE;
			RETURN FALSE;
		END;
		max := array_length(attr, 1);
		IF max < 1 OR max IS NULL THEN
			RAISE NOTICE 'Unable to get the nodata values of a sample raster (max < 1 or null)';
			RETURN FALSE;
		END IF;
		sql := 'ALTER TABLE ' || fqtn
			|| ' ADD CONSTRAINT ' || quote_ident(cn)
			|| ' CHECK (public._raster_constraint_nodata_values(' || quote_ident($3)
			|| ')::numeric[] = ''{';
		FOR x in 1..max LOOP
			IF attr[x] IS NULL THEN
				sql := sql || 'NULL';
			ELSE
				sql := sql || attr[x];
			END IF;
			IF x < max THEN
				sql := sql || ',';
			END IF;
		END LOOP;
		sql := sql || '}''::numeric[])';
		RETURN  public._add_raster_constraint(cn, sql);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._add_raster_constraint_num_bands(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		fqtn text;
		cn name;
		sql text;
		attr int;
	BEGIN
		fqtn := '';
		IF length($1) > 0 THEN
			fqtn := quote_ident($1) || '.';
		END IF;
		fqtn := fqtn || quote_ident($2);
		cn := 'enforce_num_bands_' || $3;
		sql := 'SELECT public.st_numbands(' || quote_ident($3)
			|| ') FROM '
			|| fqtn
			|| ' WHERE '
			|| quote_ident($3)
			|| ' IS NOT NULL LIMIT 1;';
		BEGIN
			EXECUTE sql INTO attr;
		EXCEPTION WHEN OTHERS THEN
			RAISE NOTICE 'Unable to get the number of bands of a sample raster: % (%)',
        SQLERRM, SQLSTATE;
			RETURN FALSE;
		END;
		sql := 'ALTER TABLE ' || fqtn
			|| ' ADD CONSTRAINT ' || quote_ident(cn)
			|| ' CHECK (public.st_numbands(' || quote_ident($3)
			|| ') = ' || attr
			|| ')';
		RETURN  public._add_raster_constraint(cn, sql);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._add_raster_constraint_out_db(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		fqtn text;
		cn name;
		sql text;
		attr boolean[];
		max int;
	BEGIN
		fqtn := '';
		IF length($1) > 0 THEN
			fqtn := quote_ident($1) || '.';
		END IF;
		fqtn := fqtn || quote_ident($2);
		cn := 'enforce_out_db_' || $3;
		sql := 'SELECT public._raster_constraint_out_db(' || quote_ident($3)
			|| ') FROM ' || fqtn
			|| ' WHERE '
			|| quote_ident($3)
			|| ' IS NOT NULL LIMIT 1;';
		BEGIN
			EXECUTE sql INTO attr;
		EXCEPTION WHEN OTHERS THEN
			RAISE NOTICE 'Unable to get the out-of-database bands of a sample raster: % (%)',
        SQLERRM, SQLSTATE;
			RETURN FALSE;
		END;
		max := array_length(attr, 1);
		IF max < 1 OR max IS NULL THEN
			RAISE NOTICE 'Unable to get the out-of-database bands of a sample raster (max < 1 or null)';
			RETURN FALSE;
		END IF;
		sql := 'ALTER TABLE ' || fqtn
			|| ' ADD CONSTRAINT ' || quote_ident(cn)
			|| ' CHECK ( public._raster_constraint_out_db(' || quote_ident($3)
			|| ') = ''{';
		FOR x in 1..max LOOP
			IF attr[x] IS FALSE THEN
				sql := sql || 'FALSE';
			ELSE
				sql := sql || 'TRUE';
			END IF;
			IF x < max THEN
				sql := sql || ',';
			END IF;
		END LOOP;
		sql := sql || '}''::boolean[])';
		RETURN  public._add_raster_constraint(cn, sql);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._add_raster_constraint_pixel_types(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		fqtn text;
		cn name;
		sql text;
		attr text[];
		max int;
	BEGIN
		fqtn := '';
		IF length($1) > 0 THEN
			fqtn := quote_ident($1) || '.';
		END IF;
		fqtn := fqtn || quote_ident($2);
		cn := 'enforce_pixel_types_' || $3;
		sql := 'SELECT public._raster_constraint_pixel_types(' || quote_ident($3)
			|| ') FROM ' || fqtn
			|| ' WHERE '
			|| quote_ident($3)
			|| ' IS NOT NULL LIMIT 1;';
		BEGIN
			EXECUTE sql INTO attr;
		EXCEPTION WHEN OTHERS THEN
			RAISE NOTICE 'Unable to get the pixel types of a sample raster: % (%)',
        SQLERRM, SQLSTATE;
			RETURN FALSE;
		END;
		max := array_length(attr, 1);
		IF max < 1 OR max IS NULL THEN
			RAISE NOTICE 'Unable to get the pixel types of a sample raster (max < 1 or null)';
			RETURN FALSE;
		END IF;
		sql := 'ALTER TABLE ' || fqtn
			|| ' ADD CONSTRAINT ' || quote_ident(cn)
			|| ' CHECK (public._raster_constraint_pixel_types(' || quote_ident($3)
			|| ') = ''{';
		FOR x in 1..max LOOP
			sql := sql || '"' || attr[x] || '"';
			IF x < max THEN
				sql := sql || ',';
			END IF;
		END LOOP;
		sql := sql || '}''::text[])';
		RETURN  public._add_raster_constraint(cn, sql);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._add_raster_constraint_scale(rastschema name, rasttable name, rastcolumn name, axis character)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		fqtn text;
		cn name;
		sql text;
		attr double precision;
	BEGIN
		IF lower($4) != 'x' AND lower($4) != 'y' THEN
			RAISE EXCEPTION 'axis must be either "x" or "y"';
			RETURN FALSE;
		END IF;
		fqtn := '';
		IF length($1) > 0 THEN
			fqtn := quote_ident($1) || '.';
		END IF;
		fqtn := fqtn || quote_ident($2);
		cn := 'enforce_scale' || $4 || '_' || $3;
		sql := 'SELECT st_scale' || $4 || '('
			|| quote_ident($3)
			|| ') FROM '
			|| fqtn
			|| ' WHERE '
			|| quote_ident($3)
			|| ' IS NOT NULL LIMIT 1;';
		BEGIN
			EXECUTE sql INTO attr;
		EXCEPTION WHEN OTHERS THEN
			RAISE NOTICE 'Unable to get the %-scale of a sample raster: % (%)',
        upper($4), SQLERRM, SQLSTATE;
			RETURN FALSE;
		END;
		sql := 'ALTER TABLE ' || fqtn
			|| ' ADD CONSTRAINT ' || quote_ident(cn)
			|| ' CHECK (round(public.st_scale' || $4 || '('
			|| quote_ident($3)
			|| ')::numeric, 10) = round(' || text(attr) || '::numeric, 10))';
		RETURN  public._add_raster_constraint(cn, sql);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._add_raster_constraint_spatially_unique(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		fqtn text;
		cn name;
		sql text;
		attr text;
		meta record;
	BEGIN
		fqtn := '';
		IF length($1) > 0 THEN
			fqtn := quote_ident($1) || '.';
		END IF;
		fqtn := fqtn || quote_ident($2);
		cn := 'enforce_spatially_unique_' || quote_ident($2) || '_'|| $3;
		sql := 'ALTER TABLE ' || fqtn ||
			' ADD CONSTRAINT ' || quote_ident(cn) ||
			' EXCLUDE ((' || quote_ident($3) || '::geometry) WITH =)';
		RETURN  public._add_raster_constraint(cn, sql);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._add_raster_constraint_srid(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		fqtn text;
		cn name;
		sql text;
		attr int;
	BEGIN
		fqtn := '';
		IF length($1) > 0 THEN
			fqtn := quote_ident($1) || '.';
		END IF;
		fqtn := fqtn || quote_ident($2);
		cn := 'enforce_srid_' || $3;
		sql := 'SELECT public.st_srid('
			|| quote_ident($3)
			|| ') FROM ' || fqtn
			|| ' WHERE '
			|| quote_ident($3)
			|| ' IS NOT NULL LIMIT 1;';
		BEGIN
			EXECUTE sql INTO attr;
		EXCEPTION WHEN OTHERS THEN
			RAISE NOTICE 'Unable to get the SRID of a sample raster: % (%)',
        SQLERRM, SQLSTATE;
			RETURN FALSE;
		END;
		sql := 'ALTER TABLE ' || fqtn
			|| ' ADD CONSTRAINT ' || quote_ident(cn)
			|| ' CHECK (public.st_srid('
			|| quote_ident($3)
			|| ') = ' || attr || ')';
		RETURN  public._add_raster_constraint(cn, sql);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._drop_overview_constraint(ovschema name, ovtable name, ovcolumn name)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT  public._drop_raster_constraint($1, $2, 'enforce_overview_' || $3) $function$
;

CREATE OR REPLACE FUNCTION public._drop_raster_constraint(rastschema name, rasttable name, cn name)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		fqtn text;
	BEGIN
		fqtn := '';
		IF length($1) > 0 THEN
			fqtn := quote_ident($1) || '.';
		END IF;
		fqtn := fqtn || quote_ident($2);
		BEGIN
			EXECUTE 'ALTER TABLE '
				|| fqtn
				|| ' DROP CONSTRAINT '
				|| quote_ident(cn);
			RETURN TRUE;
		EXCEPTION
			WHEN undefined_object THEN
				RAISE NOTICE 'The constraint "%" does not exist.  Skipping', cn;
			WHEN OTHERS THEN
				RAISE NOTICE 'Unable to drop constraint "%": % (%)',
          cn, SQLERRM, SQLSTATE;
				RETURN FALSE;
		END;
		RETURN TRUE;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._drop_raster_constraint_alignment(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT  public._drop_raster_constraint($1, $2, 'enforce_same_alignment_' || $3) $function$
;

CREATE OR REPLACE FUNCTION public._drop_raster_constraint_blocksize(rastschema name, rasttable name, rastcolumn name, axis text)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	BEGIN
		IF lower($4) != 'width' AND lower($4) != 'height' THEN
			RAISE EXCEPTION 'axis must be either "width" or "height"';
			RETURN FALSE;
		END IF;
		RETURN  public._drop_raster_constraint($1, $2, 'enforce_' || $4 || '_' || $3);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._drop_raster_constraint_coverage_tile(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT  public._drop_raster_constraint($1, $2, 'enforce_coverage_tile_' || $3) $function$
;

CREATE OR REPLACE FUNCTION public._drop_raster_constraint_extent(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT  public._drop_raster_constraint($1, $2, 'enforce_max_extent_' || $3) $function$
;

CREATE OR REPLACE FUNCTION public._drop_raster_constraint_nodata_values(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT  public._drop_raster_constraint($1, $2, 'enforce_nodata_values_' || $3) $function$
;

CREATE OR REPLACE FUNCTION public._drop_raster_constraint_num_bands(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT  public._drop_raster_constraint($1, $2, 'enforce_num_bands_' || $3) $function$
;

CREATE OR REPLACE FUNCTION public._drop_raster_constraint_out_db(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT  public._drop_raster_constraint($1, $2, 'enforce_out_db_' || $3) $function$
;

CREATE OR REPLACE FUNCTION public._drop_raster_constraint_pixel_types(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT  public._drop_raster_constraint($1, $2, 'enforce_pixel_types_' || $3) $function$
;

CREATE OR REPLACE FUNCTION public._drop_raster_constraint_regular_blocking(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT public._drop_raster_constraint($1, $2, 'enforce_regular_blocking_' || $3) $function$
;

CREATE OR REPLACE FUNCTION public._drop_raster_constraint_scale(rastschema name, rasttable name, rastcolumn name, axis character)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	BEGIN
		IF lower($4) != 'x' AND lower($4) != 'y' THEN
			RAISE EXCEPTION 'axis must be either "x" or "y"';
			RETURN FALSE;
		END IF;
		RETURN  public._drop_raster_constraint($1, $2, 'enforce_scale' || $4 || '_' || $3);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._drop_raster_constraint_spatially_unique(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		cn text;
	BEGIN
		SELECT
			s.conname INTO cn
		FROM pg_class c, pg_namespace n, pg_attribute a
		, (SELECT connamespace, conname, conrelid, conkey, conindid, contype, conexclop, pg_get_constraintdef(oid) As consrc
			FROM pg_constraint) AS s
		, pg_index idx, pg_operator op
		WHERE n.nspname = $1
			AND c.relname = $2
			AND a.attname = $3
			AND a.attrelid = c.oid
			AND s.connamespace = n.oid
			AND s.conrelid = c.oid
			AND s.contype = 'x'
			AND 0::smallint = ANY (s.conkey)
			AND idx.indexrelid = s.conindid
			AND pg_get_indexdef(idx.indexrelid, 1, true) LIKE '(' || quote_ident($3) || '::geometry)'
			AND s.conexclop[1] = op.oid
			AND op.oprname = '=';
		RETURN  public._drop_raster_constraint($1, $2, cn);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._drop_raster_constraint_srid(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT  public._drop_raster_constraint($1, $2, 'enforce_srid_' || $3) $function$
;

CREATE OR REPLACE FUNCTION public._overview_constraint(ov raster, factor integer, refschema name, reftable name, refcolumn name)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ SELECT COALESCE((SELECT TRUE FROM public.raster_columns WHERE r_table_catalog = current_database() AND r_table_schema = $3 AND r_table_name = $4 AND r_raster_column = $5), FALSE) $function$
;

CREATE OR REPLACE FUNCTION public._overview_constraint_info(ovschema name, ovtable name, ovcolumn name, OUT refschema name, OUT reftable name, OUT refcolumn name, OUT factor integer)
 RETURNS record
 LANGUAGE sql
 STABLE STRICT
AS $function$
	SELECT
		split_part(split_part(s.consrc, '''::name', 1), '''', 2)::name,
		split_part(split_part(s.consrc, '''::name', 2), '''', 2)::name,
		split_part(split_part(s.consrc, '''::name', 3), '''', 2)::name,
		trim(both from split_part(s.consrc, ',', 2))::integer
	FROM pg_class c, pg_namespace n, pg_attribute a
		, (SELECT connamespace, conrelid, conkey, pg_get_constraintdef(oid) As consrc
		    FROM pg_constraint) AS s
	WHERE n.nspname = $1
		AND c.relname = $2
		AND a.attname = $3
		AND a.attrelid = c.oid
		AND s.connamespace = n.oid
		AND s.conrelid = c.oid
		AND a.attnum = ANY (s.conkey)
		AND s.consrc LIKE '%_overview_constraint(%' LIMIT 1
	$function$
;

CREATE OR REPLACE FUNCTION public._pgr_alphashape(text, alpha double precision DEFAULT 0, OUT seq1 bigint, OUT textgeom text)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_alphashape$function$
;

-- Function: _pgr_alphashape
-- Comment: pgrouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_array_reverse(anyarray)
 RETURNS anyarray
 LANGUAGE sql
 IMMUTABLE STRICT
AS $function$
SELECT ARRAY(
    SELECT $1[i]
    FROM generate_subscripts($1,1) AS s(i)
    ORDER BY i DESC
);
$function$
;

-- Function: _pgr_array_reverse
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_articulationpoints(edges_sql text, OUT seq integer, OUT node bigint)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_articulationpoints$function$
;

-- Function: _pgr_articulationpoints
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_astar(edges_sql text, combinations_sql text, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor double precision DEFAULT 1.0, epsilon double precision DEFAULT 1.0, only_cost boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_astar$function$
;

-- Function: _pgr_astar
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_astar(edges_sql text, start_vids anyarray, end_vids anyarray, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor double precision DEFAULT 1.0, epsilon double precision DEFAULT 1.0, only_cost boolean DEFAULT false, normal boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_astar$function$
;

-- Function: _pgr_astar
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_bdastar(text, anyarray, anyarray, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor double precision DEFAULT 1.0, epsilon double precision DEFAULT 1.0, only_cost boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_bdastar$function$
;

-- Function: _pgr_bdastar
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_bdastar(text, text, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor double precision DEFAULT 1.0, epsilon double precision DEFAULT 1.0, only_cost boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_bdastar$function$
;

-- Function: _pgr_bdastar
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_bddijkstra(text, anyarray, anyarray, directed boolean, only_cost boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_bddijkstra$function$
;

-- Function: _pgr_bddijkstra
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_bddijkstra(text, text, directed boolean, only_cost boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_bddijkstra$function$
;

-- Function: _pgr_bddijkstra
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_bellmanford(edges_sql text, from_vids anyarray, to_vids anyarray, directed boolean, only_cost boolean, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_bellmanford$function$
;

-- Function: _pgr_bellmanford
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_bellmanford(edges_sql text, combinations_sql text, directed boolean, only_cost boolean, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_bellmanford$function$
;

-- Function: _pgr_bellmanford
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_betweennesscentrality(edges_sql text, directed boolean, OUT vid bigint, OUT centrality double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_betweennesscentrality$function$
;

-- Function: _pgr_betweennesscentrality
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_biconnectedcomponents(edges_sql text, OUT seq bigint, OUT component bigint, OUT edge bigint)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_biconnectedcomponents$function$
;

-- Function: _pgr_biconnectedcomponents
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_binarybreadthfirstsearch(edges_sql text, from_vids anyarray, to_vids anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_binarybreadthfirstsearch$function$
;

-- Function: _pgr_binarybreadthfirstsearch
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_binarybreadthfirstsearch(edges_sql text, combinations_sql text, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_binarybreadthfirstsearch$function$
;

-- Function: _pgr_binarybreadthfirstsearch
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_bipartite(edges_sql text, OUT node bigint, OUT color bigint)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_bipartite$function$
;

-- Function: _pgr_bipartite
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_boost_version()
 RETURNS text
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_boost_version$function$
;

-- Function: _pgr_boost_version
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_breadthfirstsearch(edges_sql text, from_vids anyarray, max_depth bigint, directed boolean, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_breadthfirstsearch$function$
;

-- Function: _pgr_breadthfirstsearch
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_bridges(edges_sql text, OUT seq integer, OUT edge bigint)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_bridges$function$
;

-- Function: _pgr_bridges
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_build_type()
 RETURNS text
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_build_type$function$
;

-- Function: _pgr_build_type
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_checkcolumn(text, text, text, is_optional boolean DEFAULT false, dryrun boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
  has_column BOOLEAN := TRUE;
  rec RECORD;
  sqlhint TEXT;
BEGIN
  BEGIN
    EXECUTE format('SELECT %1$s FROM ( %2$s ) AS __a__ limit 1', $2, $1);
    EXCEPTION WHEN OTHERS THEN
      BEGIN
      IF NOT is_optional THEN
        RAISE EXCEPTION '%', SQLERRM USING HINT = $1, ERRCODE = SQLSTATE;
      ELSE
        has_column := FALSE;
      END IF;
      END;
  END;
  BEGIN
    EXECUTE format('SELECT pg_typeof(%1$s) FROM ( %2$s ) AS __a__ limit 1', $2, $1)
    INTO rec;
    EXCEPTION WHEN OTHERS THEN
      has_column := FALSE;
  END;
  IF dryrun THEN
    RETURN has_column;
  END IF;
  IF NOT is_optional AND NOT has_column THEN
    RAISE EXCEPTION 'Missing column'
    USING HINT = format('Column "%1$s" missing in: %2$s', $2, $1);
  END IF;
  IF has_column THEN
    CASE $3
    WHEN 'ANY-INTEGER' THEN
      IF  rec.pg_typeof NOT IN ('smallint','integer','bigint') THEN
        RAISE EXCEPTION 'Expected type of column "%" is ANY-INTEGER', $2
        USING HINT = 'Query: ' || $1;
      END IF;
    WHEN 'ANY-INTEGER[]' THEN
      IF  rec.pg_typeof NOT IN ('smallint[]','integer[]','bigint[]') THEN
        RAISE EXCEPTION 'Expected type of column "%" is ANY-INTEGER-ARRAY', $2
        USING HINT = 'Query: ' || $1;
      END IF;
    WHEN 'ANY-NUMERICAL' THEN
      IF  rec.pg_typeof NOT IN ('smallint','integer','bigint','real','float','numeric') THEN
        RAISE EXCEPTION 'Expected type of column "%s" is ANY-NUMERICAL', $2
        USING HINT = 'Query: ' || $1;
      END IF;
    ELSE
      IF rec.pg_typeof::TEXT != $3 THEN
        RAISE EXCEPTION 'Expected type of column "%" is %', $2, $3
        USING HINT = 'Query: ' || $1;
      END IF;
    END CASE;
  END IF;
  RETURN has_column;
END;
$function$
;

-- Function: _pgr_checkcolumn
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_checkquery(text)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
  main_sql TEXT;
BEGIN
  IF $1 !~ '[[:space:]]' THEN
    EXECUTE format($$
      SELECT regexp_replace(regexp_replace(statement, %1$L,'','i'),';$','')
      FROM pg_prepared_statements WHERE name = %2$L$$,
      '.*' || $1 || '\s*as', $1)
    INTO main_sql;
    IF main_sql IS NULL THEN
      RAISE EXCEPTION 'prepared statement "%" does not exist', $1;
    END IF;
  ELSE
    main_sql := $1;
  END IF;
  BEGIN
    EXECUTE format('SELECT * FROM ( %1$s ) AS __a__ limit 1', main_sql);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '%', SQLERRM USING HINT = $1, ERRCODE = SQLSTATE;
  END;
  RETURN main_sql;
END;
$function$
;

-- Function: _pgr_checkquery
-- Comment: pgrouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_checkverttab(vertname text, columnsarr text[], reporterrs integer DEFAULT 1, fnname text DEFAULT '_pgr_checkVertTab'::text, OUT sname text, OUT vname text)
 RETURNS record
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
    cname text;
    colname text;
    naming record;
    debuglevel text;
    err  boolean;
    msgKind int;
BEGIN
    msgKind = 0; -- debug_
    execute 'show client_min_messages' into debuglevel;
    perform _pgr_msg(msgKind, fnName, 'Checking table ' || vertname || ' exists');
       select * from _pgr_getTableName(vertname, 0, fnName) into naming;
       sname=naming.sname;
       vname=naming.tname;
       err = sname is NULL or vname is NULL;
    perform _pgr_onError( err, 2, fnName,
          'Vertex Table: ' || vertname || ' not found',
          'Please create ' || vertname || ' using  _pgr_createTopology()',
          'Vertex Table: ' || vertname || ' found');
    perform _pgr_msg(msgKind, fnName, 'Checking columns of ' || vertname);
      FOREACH cname IN ARRAY columnsArr
      loop
         select _pgr_getcolumnName(vertname, cname, 0, fnName) into colname;
         if colname is null then
           perform _pgr_msg(msgKind, fnName, 'Adding column ' || cname || ' in ' || vertname);
           set client_min_messages  to warning;
                execute 'ALTER TABLE '||_pgr_quote_ident(vertname)||' ADD COLUMN '||cname|| ' integer';
           execute 'set client_min_messages  to '|| debuglevel;
           perform _pgr_msg(msgKind, fnName);
         end if;
      end loop;
    perform _pgr_msg(msgKind, fnName, 'Finished checking columns of ' || vertname);
    perform _pgr_createIndex(vertname , 'id' , 'btree', reportErrs, fnName);
 END
$function$
;

-- Function: _pgr_checkverttab
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_chinesepostman(edges_sql text, only_cost boolean, OUT seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_chinesepostman$function$
;

-- Function: _pgr_chinesepostman
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_compilation_date()
 RETURNS text
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_compilation_date$function$
;

-- Function: _pgr_compilation_date
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_compiler_version()
 RETURNS text
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_compiler_version$function$
;

-- Function: _pgr_compiler_version
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_connectedcomponents(edges_sql text, OUT seq bigint, OUT component bigint, OUT node bigint)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_connectedcomponents$function$
;

-- Function: _pgr_connectedcomponents
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_contraction(edges_sql text, contraction_order bigint[], max_cycles integer DEFAULT 1, forbidden_vertices bigint[] DEFAULT ARRAY[]::bigint[], directed boolean DEFAULT true, OUT type text, OUT id bigint, OUT contracted_vertices bigint[], OUT source bigint, OUT target bigint, OUT cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_contraction$function$
;

-- Function: _pgr_contraction
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_contractionhierarchies(edges_sql text, forbidden_vertices bigint[], directed boolean, OUT type text, OUT id bigint, OUT contracted_vertices bigint[], OUT source bigint, OUT target bigint, OUT cost double precision, OUT metric bigint, OUT vertex_order bigint)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_contractionhierarchies$function$
;

-- Function: _pgr_contractionhierarchies
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_createindex(sname text, tname text, colname text, indext text, reporterrs integer DEFAULT 1, fnname text DEFAULT '_pgr_createIndex'::text)
 RETURNS void
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
    debuglevel text;
    naming record;
    tabname text;
    query text;
    msgKind int;
BEGIN
  msgKind = 0; -- debug_
  execute 'show client_min_messages' into debuglevel;
  tabname=_pgr_quote_ident(sname||'.'||tname);
  perform _pgr_msg(msgKind, fnName, 'Checking ' || colname || ' column in ' || tabname || ' is indexed');
    IF (_pgr_isColumnIndexed(sname,tname,colname, 0, fnName)) then
       perform _pgr_msg(msgKind, fnName);
    else
      if indext = 'gist' then
        query = 'create  index '||_pgr_quote_ident(tname||'_'||colname||'_idx')||'
                         on '||tabname||' using gist('||quote_ident(colname)||')';
      else
        query = 'create  index '||_pgr_quote_ident(tname||'_'||colname||'_idx')||'
                         on '||tabname||' using btree('||quote_ident(colname)||')';
      end if;
      perform _pgr_msg(msgKind, fnName, 'Adding index ' || tabname || '_' ||  colname || '_idx');
      perform _pgr_msg(msgKind, fnName, ' Using ' ||  query);
      set client_min_messages  to warning;
      BEGIN
        execute query;
        EXCEPTION WHEN others THEN
          perform _pgr_onError( true, reportErrs, fnName,
            'Could not create index on:' || colname, SQLERRM);
      END;
      execute 'set client_min_messages  to '|| debuglevel;
      perform _pgr_msg(msgKind, fnName);
    END IF;
END;
$function$
;

-- Function: _pgr_createindex
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_createindex(tabname text, colname text, indext text, reporterrs integer DEFAULT 1, fnname text DEFAULT '_pgr_createIndex'::text)
 RETURNS void
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
    naming record;
    sname text;
    tname text;
BEGIN
    select * from _pgr_getTableName(tabname, 2, fnName)  into naming;
    sname=naming.sname;
    tname=naming.tname;
    execute _pgr_createIndex(sname, tname, colname, indext, reportErrs, fnName);
END;
$function$
;

-- Function: _pgr_createindex
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_cuthillmckeeordering(text, OUT seq bigint, OUT node bigint)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_cuthillmckeeordering$function$
;

-- Function: _pgr_cuthillmckeeordering
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_dagshortestpath(text, text, directed boolean DEFAULT true, only_cost boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_dagshortestpath$function$
;

-- Function: _pgr_dagshortestpath
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_dagshortestpath(text, anyarray, anyarray, directed boolean DEFAULT true, only_cost boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_dagshortestpath$function$
;

-- Function: _pgr_dagshortestpath
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_depthfirstsearch(edges_sql text, root_vids anyarray, directed boolean, max_depth bigint, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_depthfirstsearch$function$
;

-- Function: _pgr_depthfirstsearch
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_dijkstra(edges_sql text, combinations_sql text, directed boolean, only_cost boolean, n_goals bigint, global boolean, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_dijkstra$function$
;

-- Function: _pgr_dijkstra
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_dijkstra(edges_sql text, combinations_sql text, directed boolean DEFAULT true, only_cost boolean DEFAULT false, normal boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_dijkstra$function$
;

-- Function: _pgr_dijkstra
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_dijkstra(edges_sql text, start_vids anyarray, end_vids anyarray, directed boolean, only_cost boolean, normal boolean, n_goals bigint, global boolean, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_dijkstra$function$
;

-- Function: _pgr_dijkstra
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_dijkstra(edges_sql text, start_vids anyarray, end_vids anyarray, directed boolean DEFAULT true, only_cost boolean DEFAULT false, normal boolean DEFAULT true, n_goals bigint DEFAULT 0, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_dijkstra$function$
;

-- Function: _pgr_dijkstra
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_dijkstranear(text, anyarray, bigint, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
AS $function$
    SELECT seq, path_seq, start_vid, node, edge, cost, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], $5, false, false, $4);
$function$
;

-- Function: _pgr_dijkstranear
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_dijkstranear(text, bigint, anyarray, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
AS $function$
    SELECT seq, path_seq, end_vid, node, edge, cost, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], $5, false, true, $4);
$function$
;

-- Function: _pgr_dijkstranear
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_dijkstranear(text, anyarray, anyarray, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT end_vid bigint, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], $5, false, false, $4);
$function$
;

-- Function: _pgr_dijkstranear
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_dijkstravia(edges_sql text, via_vids anyarray, directed boolean, strict boolean, u_turn_on_edge boolean, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision, OUT route_agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_dijkstravia$function$
;

-- Function: _pgr_dijkstravia
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_drivingdistance(edges_sql text, start_vids anyarray, distance double precision, directed boolean DEFAULT true, equicost boolean DEFAULT false, OUT seq integer, OUT from_v bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_drivingdistance$function$
;

-- Function: _pgr_drivingdistance
-- Comment: pgRouting internal function deprecated on v3.6.0
-- 
CREATE OR REPLACE FUNCTION public._pgr_drivingdistancev4(text, anyarray, double precision, boolean, boolean, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_drivingdistancev4$function$
;

-- Function: _pgr_drivingdistancev4
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_edgecoloring(edges_sql text, OUT edge_id bigint, OUT color_id bigint)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_edgecoloring$function$
;

-- Function: _pgr_edgecoloring
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_edgedisjointpaths(text, text, directed boolean, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_edgedisjointpaths$function$
;

-- Function: _pgr_edgedisjointpaths
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_edgedisjointpaths(text, anyarray, anyarray, directed boolean, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_edgedisjointpaths$function$
;

-- Function: _pgr_edgedisjointpaths
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_edwardmoore(edges_sql text, from_vids anyarray, to_vids anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_edwardmoore$function$
;

-- Function: _pgr_edwardmoore
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_edwardmoore(edges_sql text, combinations_sql text, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_edwardmoore$function$
;

-- Function: _pgr_edwardmoore
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_endpoint(g geometry)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE
AS $function$
SELECT CASE WHEN geometryType($1) ~ '^MULTI' THEN ST_EndPoint(st_geometryN($1,1))
ELSE ST_EndPoint($1)
END;
$function$
;

-- Function: _pgr_endpoint
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_floydwarshall(edges_sql text, directed boolean, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_floydwarshall$function$
;

-- Function: _pgr_floydwarshall
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_get_statement(o_sql text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE STRICT
AS $function$
DECLARE
sql TEXT;
BEGIN
    EXECUTE 'SELECT statement FROM pg_prepared_statements WHERE name ='  || quote_literal(o_sql) || ' limit 1 ' INTO sql;
    IF (sql IS NULL) THEN
      RETURN   o_sql;
    ELSE
      RETURN  regexp_replace(regexp_replace(regexp_replace(sql, '\s(as)\s', '___foo___', 'i'), '^.*___foo___', '','i'), ';$', '');
    END IF;
END
$function$
;

-- Function: _pgr_get_statement
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_getcolumnname(sname text, tname text, col text, reporterrs integer DEFAULT 1, fnname text DEFAULT '_pgr_getColumnName'::text)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
    cname text;
    naming record;
    err boolean;
BEGIN
    execute 'SELECT column_name FROM information_schema.columns
          WHERE table_name='||quote_literal(tname)||' and table_schema='||quote_literal(sname)||' and column_name='||quote_literal(col) into cname;
    IF cname is null  THEN
    execute 'SELECT column_name FROM information_schema.columns
          WHERE table_name='||quote_literal(tname)||' and table_schema='||quote_literal(sname)||' and column_name='||quote_literal(lower(col))  into cname;
    END if;
    err = cname is null;
    perform _pgr_onError(err, reportErrs, fnName,  'Column '|| col ||' not found', ' Check your column name','Column '|| col || ' found');
    RETURN cname;
END;
$function$
;

-- Function: _pgr_getcolumnname
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_getcolumnname(tab text, col text, reporterrs integer DEFAULT 1, fnname text DEFAULT '_pgr_getColumnName'::text)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
    sname text;
    tname text;
    cname text;
    naming record;
    err boolean;
BEGIN
    select a.sname, a.tname into naming from _pgr_getTableName(tab,reportErrs, fnName) AS a;
    sname=naming.sname;
    tname=naming.tname;
    select _pgr_getColumnName into cname from _pgr_getColumnName(sname,tname,col,reportErrs, fnName);
    RETURN cname;
END;
$function$
;

-- Function: _pgr_getcolumnname
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_getcolumntype(sname text, tname text, cname text, reporterrs integer DEFAULT 0, fnname text DEFAULT '_pgr_getColumnType'::text)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
    ctype text;
    naming record;
    err boolean;
BEGIN
    EXECUTE 'select data_type  from information_schema.columns '
            || 'where table_name = '||quote_literal(tname)
                 || ' and table_schema=' || quote_literal(sname)
                 || ' and column_name='||quote_literal(cname)
       into ctype;
    err = ctype is null;
    perform _pgr_onError(err, reportErrs, fnName,
            'Type of Column '|| cname ||' not found',
            'Check your column name',
            'OK: Type of Column '|| cname || ' is ' || ctype);
    RETURN ctype;
END;
$function$
;

-- Function: _pgr_getcolumntype
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_getcolumntype(tab text, col text, reporterrs integer DEFAULT 0, fnname text DEFAULT '_pgr_getColumnType'::text)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
    sname text;
    tname text;
    cname text;
    ctype text;
    naming record;
    err boolean;
BEGIN
    select * into naming from _pgr_getTableName(tab,reportErrs, fnName) ;
    sname=naming.sname;
    tname=naming.tname;
    select _pgr_getColumnName into cname from _pgr_getColumnName(tab,col,reportErrs, fnName) ;
    select _pgr_getColumnType into ctype from _pgr_getColumnType(sname,tname,cname,reportErrs, fnName);
    RETURN ctype;
END;
$function$
;

-- Function: _pgr_getcolumntype
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_gettablename(tab text, reporterrs integer DEFAULT 0, fnname text DEFAULT '_pgr_getTableName'::text, OUT sname text, OUT tname text)
 RETURNS record
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
        naming record;
        i integer;
        query text;
        sn text; -- schema name
        tn text; -- table name
        ttype text; --table type for future use
        err boolean;
        debuglevel text;
        var_types text[] = ARRAY['BASE TABLE', 'VIEW'];
BEGIN
    execute 'show client_min_messages' into debuglevel;
    perform _pgr_msg( 0, fnName, 'Checking table ' || tab || ' exists');
    i := strpos(tab,'.');
    IF (i <> 0) THEN
        sn := split_part(tab, '.',1);
        tn := split_part(tab, '.',2);
    ELSE
        sn := current_schema;
        tn := tab;
    END IF;
   SELECT schema_name INTO sname
   FROM information_schema.schemata WHERE schema_name = sn;
    IF sname IS NOT NULL THEN -- found schema (as is)
       SELECT table_name, table_type INTO tname, ttype
       FROM information_schema.tables
       WHERE
                table_type = ANY(var_types) and
                table_schema = sname and
                table_name = tn ;
        IF tname is NULL THEN
            SELECT table_name, table_type INTO tname, ttype
            FROM information_schema.tables
            WHERE
                table_type  = ANY(var_types) and
                table_schema = sname and
                table_name = lower(tn) ORDER BY table_name;
        END IF;
    END IF;
    IF sname is NULL or tname is NULL THEN --schema not found or table not found
        SELECT schema_name INTO sname
        FROM information_schema.schemata
        WHERE schema_name = lower(sn) ;
        IF sname IS NOT NULL THEN -- found schema (with lower caps)
            SELECT table_name, table_type INTO tname, ttype
            FROM information_schema.tables
            WHERE
                table_type  =  ANY(var_types) and
                table_schema = sname and
                table_name= tn ;
           IF tname IS NULL THEN
                SELECT table_name, table_type INTO tname, ttype
                FROM information_schema.tables
                WHERE
                    table_type  =  ANY(var_types) and
                    table_schema = sname and
                    table_name= lower(tn) ;
           END IF;
        END IF;
    END IF;
   err = (sname IS NULL OR tname IS NULL);
   perform _pgr_onError(err, reportErrs, fnName, 'Table ' || tab ||' not found',' Check your table name', 'Table '|| tab || ' found');
END;
$function$
;

-- Function: _pgr_gettablename
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_git_hash()
 RETURNS text
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_git_hash$function$
;

-- Function: _pgr_git_hash
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_hawickcircuits(text, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_hawickcircuits$function$
;

-- Function: _pgr_hawickcircuits
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_iscolumnindexed(tab text, col text, reporterrs integer DEFAULT 1, fnname text DEFAULT '_pgr_isColumnIndexed'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
    naming record;
    rec record;
    sname text;
    tname text;
    cname text;
    pkey text;
    value boolean;
BEGIN
    SELECT a.sname, a.tname into naming FROM _pgr_getTableName(tab, 0, fnName) AS a;
    sname=naming.sname;
    tname=naming.tname;
    IF sname IS NULL OR tname IS NULL THEN
        RETURN FALSE;
    END IF;
    SELECT _pgr_getColumnName into cname from _pgr_getColumnName(sname, tname, col, 0, fnName) ;
    IF cname IS NULL THEN
        RETURN FALSE;
    END IF;
    select _pgr_isColumnIndexed into value  from _pgr_isColumnIndexed(sname, tname, cname, reportErrs, fnName);
    return value;
END
$function$
;

-- Function: _pgr_iscolumnindexed
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_iscolumnindexed(sname text, tname text, cname text, reporterrs integer DEFAULT 1, fnname text DEFAULT '_pgr_isColumnIndexed'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
    naming record;
    rec record;
    pkey text;
BEGIN
    SELECT
          pg_attribute.attname into pkey
          FROM pg_index, pg_class, pg_attribute
          WHERE
                  pg_class.oid = _pgr_quote_ident(sname||'.'||tname)::regclass AND
                  indrelid = pg_class.oid AND
                  pg_attribute.attrelid = pg_class.oid AND
                  pg_attribute.attnum = any(pg_index.indkey)
                  AND indisprimary;
    IF pkey=cname then
          RETURN TRUE;
    END IF;
    SELECT a.index_name,
           b.attname,
           b.attnum,
           a.indisunique,
           a.indisprimary
      INTO rec
      FROM ( SELECT a.indrelid,
                    a.indisunique,
                    a.indisprimary,
                    c.relname index_name,
                    unnest(a.indkey) index_num
               FROM pg_index a,
                    pg_class b,
                    pg_class c,
                    pg_namespace d
              WHERE b.relname=tname
                AND b.relnamespace=d.oid
                AND d.nspname=sname
                AND b.oid=a.indrelid
                AND a.indexrelid=c.oid
           ) a,
           pg_attribute b
     WHERE a.indrelid = b.attrelid
       AND a.index_num = b.attnum
       AND b.attname = cname
  ORDER BY a.index_name,
           a.index_num;
  RETURN FOUND;
  EXCEPTION WHEN OTHERS THEN
    perform _pgr_onError( true, reportErrs, fnName,
    'Error when checking for the postgres system attributes', SQLERR);
    RETURN FALSE;
END;
$function$
;

-- Function: _pgr_iscolumnindexed
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_iscolumnintable(tab text, col text)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
    cname text;
BEGIN
    select _pgr_getColumnName from _pgr_getColumnName(tab,col,0, '_pgr_isColumnInTable') into cname;
    return cname is not null;
END;
$function$
;

-- Function: _pgr_iscolumnintable
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_isplanar(text)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_isplanar$function$
;

-- Function: _pgr_isplanar
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_johnson(edges_sql text, directed boolean, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_johnson$function$
;

-- Function: _pgr_johnson
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_kruskal(text, anyarray, fn_suffix text, max_depth bigint, distance double precision, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_kruskal$function$
;

-- Function: _pgr_kruskal
-- Comment: pgRouting internal function deprecated on v3.7.0
-- 
CREATE OR REPLACE FUNCTION public._pgr_kruskalv4(text, anyarray, text, bigint, double precision, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_kruskalv4$function$
;

-- Function: _pgr_kruskalv4
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_ksp(edges_sql text, start_vid bigint, end_vid bigint, k integer, directed boolean, heap_paths boolean, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_ksp$function$
;

-- Function: _pgr_ksp
-- Comment: pgRouting internal function deprecated on v3.6.0
-- 
CREATE OR REPLACE FUNCTION public._pgr_ksp(text, text, integer, boolean, boolean, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_ksp$function$
;

-- Function: _pgr_ksp
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_ksp(text, anyarray, anyarray, integer, boolean, boolean, boolean, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_ksp$function$
;

-- Function: _pgr_ksp
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_lengauertarjandominatortree(edges_sql text, root_vid bigint, OUT seq integer, OUT vid bigint, OUT idom bigint)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_lengauertarjandominatortree$function$
;

-- Function: _pgr_lengauertarjandominatortree
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_lib_version()
 RETURNS text
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_lib_version$function$
;

-- Function: _pgr_lib_version
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_linegraph(text, directed boolean, OUT seq integer, OUT source bigint, OUT target bigint, OUT cost double precision, OUT reverse_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_linegraph$function$
;

-- Function: _pgr_linegraph
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_linegraphfull(text, OUT seq integer, OUT source bigint, OUT target bigint, OUT cost double precision, OUT edge bigint)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_linegraphfull$function$
;

-- Function: _pgr_linegraphfull
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_makeconnected(text, OUT seq bigint, OUT start_vid bigint, OUT end_vid bigint)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_makeconnected$function$
;

-- Function: _pgr_makeconnected
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_maxcardinalitymatch(edges_sql text, directed boolean, OUT seq integer, OUT edge bigint, OUT source bigint, OUT target bigint)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_maxcardinalitymatch$function$
;

-- Function: _pgr_maxcardinalitymatch
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_maxflow(edges_sql text, combinations_sql text, algorithm integer DEFAULT 1, only_flow boolean DEFAULT false, OUT seq integer, OUT edge_id bigint, OUT source bigint, OUT target bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_maxflow$function$
;

-- Function: _pgr_maxflow
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_maxflow(edges_sql text, sources anyarray, targets anyarray, algorithm integer DEFAULT 1, only_flow boolean DEFAULT false, OUT seq integer, OUT edge_id bigint, OUT source bigint, OUT target bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_maxflow$function$
;

-- Function: _pgr_maxflow
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_maxflowmincost(edges_sql text, combinations_sql text, only_cost boolean DEFAULT false, OUT seq integer, OUT edge bigint, OUT source bigint, OUT target bigint, OUT flow bigint, OUT residual_capacity bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_maxflowmincost$function$
;

-- Function: _pgr_maxflowmincost
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_maxflowmincost(edges_sql text, sources anyarray, targets anyarray, only_cost boolean DEFAULT false, OUT seq integer, OUT edge bigint, OUT source bigint, OUT target bigint, OUT flow bigint, OUT residual_capacity bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_maxflowmincost$function$
;

-- Function: _pgr_maxflowmincost
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_msg(msgkind integer, fnname text, msg text DEFAULT '---->OK'::text)
 RETURNS void
 LANGUAGE plpgsql
 STRICT
AS $function$
BEGIN
  if msgKind = 0 then
       raise debug '----> PGR DEBUG in %: %',fnName,msg;
  else
       raise notice '----> PGR NOTICE in %: %',fnName,msg;
  end if;
END;
$function$
;

-- Function: _pgr_msg
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_onerror(errcond boolean, reporterrs integer, fnname text, msgerr text, hinto text DEFAULT 'No hint'::text, msgok text DEFAULT 'OK'::text)
 RETURNS void
 LANGUAGE plpgsql
 STRICT
AS $function$
BEGIN
  if errCond=true then
     if reportErrs=0 then
       raise debug '----> PGR DEBUG in %: %',fnName,msgerr USING HINT = '  ---->'|| hinto;
     else
       if reportErrs = 2 then
         raise notice '----> PGR ERROR in %: %',fnName,msgerr USING HINT = '  ---->'|| hinto;
         raise raise_exception;
       else
         raise notice '----> PGR NOTICE in %: %',fnName,msgerr USING HINT = '  ---->'|| hinto;
       end if;
     end if;
  else
       raise debug 'PGR ----> %: %',fnName,msgok;
  end if;
END;
$function$
;

-- Function: _pgr_onerror
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_operating_system()
 RETURNS text
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_operating_system$function$
;

-- Function: _pgr_operating_system
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_parameter_check(fn text, sql text, big boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 COST 1
AS $function$
  DECLARE
  rec record;
  rec1 record;
  has_rcost boolean;
  safesql text;
  BEGIN
    IF (big) THEN
       RAISE EXCEPTION 'This function is for old style functions';
    END IF;
    BEGIN
      safesql =  'select * from ('||sql||' ) AS __a__ limit 1';
      execute safesql into rec;
      EXCEPTION
        WHEN OTHERS THEN
            RAISE EXCEPTION 'Could not execute query please verify syntax of: '
              USING HINT = sql;
    END;
    IF fn IN ('dijkstra','astar') THEN
        BEGIN
          execute 'select id,source,target,cost  from ('||safesql||') as __b__' into rec;
          EXCEPTION
            WHEN OTHERS THEN
                RAISE EXCEPTION 'An expected column was not found in the query'
                  USING ERRCODE = 'XX000',
                   HINT = 'Please veryfy the column names: id, source, target, cost';
        END;
        execute 'select pg_typeof(id)::text as id_type, pg_typeof(source)::text as source_type, pg_typeof(target)::text as target_type, pg_typeof(cost)::text as cost_type'
            || ' from ('||safesql||') AS __b__ ' into rec;
        IF NOT(   (rec.id_type in ('integer'::text))
              AND (rec.source_type in ('integer'::text))
              AND (rec.target_type in ('integer'::text))
              AND (rec.cost_type = 'double precision'::text)) THEN
            RAISE EXCEPTION 'Error, columns ''source'', ''target'' must be of type int4, ''cost'' must be of type float8'
            USING ERRCODE = 'XX000';
        END IF;
    END IF;
    IF fn IN ('astar') THEN
        BEGIN
          execute 'select x1,y1,x2,y2  from ('||safesql||') as __b__' into rec;
          EXCEPTION
            WHEN OTHERS THEN
                RAISE EXCEPTION 'An expected column was not found in the query'
                  USING ERRCODE = 'XX000',
                   HINT = 'Please veryfy the column names: x1,y1, x2,y2';
        END;
        execute 'select pg_typeof(x1)::text as x1_type, pg_typeof(y1)::text as y1_type, pg_typeof(x2)::text as x2_type, pg_typeof(y2)::text as y2_type'
            || ' from ('||safesql||') AS __b__ ' into rec;
        IF NOT(   (rec.x1_type = 'double precision'::text)
              AND (rec.y1_type = 'double precision'::text)
              AND (rec.x2_type = 'double precision'::text)
              AND (rec.y2_type = 'double precision'::text)) THEN
            RAISE EXCEPTION 'Columns: x1, y1, x2, y2 must be of type float8'
            USING ERRCODE = 'XX000';
        END IF;
    END IF;
    IF fn IN ('johnson') THEN
        BEGIN
          execute 'select source,target,cost  from ('||safesql||') as __b__' into rec;
          EXCEPTION
            WHEN OTHERS THEN
                RAISE EXCEPTION 'An expected column was not found in the query'
                  USING HINT = 'Please veryfy the column names: id, source, target, cost',
                         ERRCODE = 'XX000';
        END;
        execute 'select pg_typeof(source)::text as source_type, pg_typeof(target)::text as target_type, pg_typeof(cost)::text as cost_type'
            || ' from ('||safesql||') AS __b__ ' into rec;
        IF NOT(   (rec.source_type in ('integer'::text))
              AND (rec.target_type in ('integer'::text))
              AND (rec.cost_type = 'double precision'::text)) THEN
            RAISE EXCEPTION 'Support for source,target columns only of type: integer. Support for Cost: double precision'
            USING ERRCODE = 'XX000';
        END IF;
    END IF;
    has_rcost := false;
    IF fn IN ('johnson','dijkstra','astar') THEN
      BEGIN
        execute 'select reverse_cost, pg_typeof(reverse_cost)::text as rev_type  from ('||safesql||' ) AS __b__ limit 1 ' into rec1;
        has_rcost := true;
        EXCEPTION
          WHEN OTHERS THEN
            has_rcost = false;
            return has_rcost;
      END;
      if (has_rcost) then
        IF (big) then
           IF  not (rec1.rev_type in ('bigint'::text, 'integer'::text, 'smallint'::text, 'double precision'::text, 'real'::text)) then
             RAISE EXCEPTION 'Illegar type in optional parameter reverse_cost.'
             USING ERRCODE = 'XX000';
           END IF;
        ELSE -- Version 2.0.0 is more restrictive
           IF (rec1.rev_type != 'double precision') then
             RAISE EXCEPTION 'Illegal type in optional parameter reverse_cost, must be of type float8'
             USING ERRCODE = 'XX000';
           END IF;
        END IF;
      end if;
      return true;
    END IF;
    return true;
  END
  $function$
;

-- Function: _pgr_parameter_check
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_pgsql_version()
 RETURNS text
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_pgsql_version$function$
;

-- Function: _pgr_pgsql_version
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_pickdeliver(text, text, text, factor double precision DEFAULT 1, max_cycles integer DEFAULT 10, initial_sol integer DEFAULT 4, OUT seq integer, OUT vehicle_seq integer, OUT vehicle_id bigint, OUT stop_seq integer, OUT stop_type integer, OUT stop_id bigint, OUT order_id bigint, OUT cargo double precision, OUT travel_time double precision, OUT arrival_time double precision, OUT wait_time double precision, OUT service_time double precision, OUT departure_time double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_pickdeliver$function$
;

-- Function: _pgr_pickdeliver
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_pickdelivereuclidean(text, text, factor double precision DEFAULT 1, max_cycles integer DEFAULT 10, initial_sol integer DEFAULT 4, OUT seq integer, OUT vehicle_seq integer, OUT vehicle_id bigint, OUT stop_seq integer, OUT stop_type integer, OUT order_id bigint, OUT cargo double precision, OUT travel_time double precision, OUT arrival_time double precision, OUT wait_time double precision, OUT service_time double precision, OUT departure_time double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_pickdelivereuclidean$function$
;

-- Function: _pgr_pickdelivereuclidean
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_pointtoid(point geometry, tolerance double precision, vertname text, srid integer)
 RETURNS bigint
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
    rec record;
    pid bigint;
BEGIN
    EXECUTE 'SELECT ST_Distance(
        the_geom,
        ST_GeomFromText(ST_AsText('
                || quote_literal(point::text)
                || '),'
            || srid ||')) AS d, id, the_geom
    FROM '||_pgr_quote_ident(vertname)||'
    WHERE ST_DWithin(
        the_geom,
        ST_GeomFromText(
            ST_AsText(' || quote_literal(point::text) ||'),
            ' || srid || '),' || tolerance||')
    ORDER BY d
    LIMIT 1' INTO rec ;
    IF rec.id IS NOT NULL THEN
        pid := rec.id;
    ELSE
        execute 'INSERT INTO '||_pgr_quote_ident(vertname)||' (the_geom) VALUES ('||quote_literal(point::text)||')';
        pid := lastval();
END IF;
RETURN pid;
END;
$function$
;

-- Function: _pgr_pointtoid
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_prim(text, anyarray, order_by text, max_depth bigint, distance double precision, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_prim$function$
;

-- Function: _pgr_prim
-- Comment: pgRouting internal function deprecated on v3.7.0
-- 
CREATE OR REPLACE FUNCTION public._pgr_primv4(text, anyarray, text, bigint, double precision, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_primv4$function$
;

-- Function: _pgr_primv4
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_quote_ident(idname text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
    t text[];
    pgver text;
begin
    pgver := regexp_replace(version(), E'^PostgreSQL ([^ ]+)[ ,].*$', E'\\1');
    if _pgr_versionless(pgver, '9.2') then
        select into t array_agg(quote_ident(term)) from
            (select nullif(unnest, '') as term
               from unnest(string_to_array(idname, '.'))) as foo;
    else
        select into t array_agg(quote_ident(term)) from
            (select unnest(string_to_array(idname, '.', '')) as term) as foo;
    end if;
    return array_to_string(t, '.');
end;
$function$
;

-- Function: _pgr_quote_ident
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_sequentialvertexcoloring(edges_sql text, OUT vertex_id bigint, OUT color_id bigint)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_sequentialvertexcoloring$function$
;

-- Function: _pgr_sequentialvertexcoloring
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_startpoint(g geometry)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE
AS $function$
SELECT CASE WHEN geometryType($1) ~ '^MULTI' THEN ST_StartPoint(ST_geometryN($1,1))
ELSE ST_StartPoint($1)
END;
$function$
;

-- Function: _pgr_startpoint
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_stoerwagner(edges_sql text, OUT seq integer, OUT edge bigint, OUT cost double precision, OUT mincut double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_stoerwagner$function$
;

-- Function: _pgr_stoerwagner
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_strongcomponents(edges_sql text, OUT seq bigint, OUT component bigint, OUT node bigint)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_strongcomponents$function$
;

-- Function: _pgr_strongcomponents
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_topologicalsort(edges_sql text, OUT seq integer, OUT sorted_v bigint)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_topologicalsort$function$
;

-- Function: _pgr_topologicalsort
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_transitiveclosure(edges_sql text, OUT seq integer, OUT vid bigint, OUT target_array bigint[])
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_transitiveclosure$function$
;

-- Function: _pgr_transitiveclosure
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_trsp(text, text, anyarray, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.start_vid, a.node, a.edge, a.cost, a.agg_cost
        FROM _trsp(
            _pgr_get_statement($1),
            _pgr_get_statement($2),
            $3::bigint[],
            ARRAY[$4]::BIGINT[],
            $5) AS a;
$function$
;

-- Function: _pgr_trsp
-- Comment: pgRouting internal function deprecated on v3.4.0
-- 
CREATE OR REPLACE FUNCTION public._pgr_trsp(sql text, source_eid integer, source_pos double precision, target_eid integer, target_pos double precision, directed boolean, has_reverse_cost boolean, turn_restrict_sql text DEFAULT NULL::text, OUT seq integer, OUT id1 integer, OUT id2 integer, OUT cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE
AS '$libdir/libpgrouting-3.8', $function$_pgr_trsp$function$
;

-- Function: _pgr_trsp
-- Comment: pgRouting internal function deprecated on v3.4.0
-- 
CREATE OR REPLACE FUNCTION public._pgr_trsp(text, text, bigint, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.node, a.edge, a.cost, a.agg_cost
        FROM _trsp(
            _pgr_get_statement($1),
            _pgr_get_statement($2),
            ARRAY[$3]::BIGINT[],
            ARRAY[$4]::BIGINT[],
            directed) AS a;
$function$
;

-- Function: _pgr_trsp
-- Comment: pgRouting internal function deprecated on v3.4.0
-- 
CREATE OR REPLACE FUNCTION public._pgr_trsp(text, text, anyarray, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.start_vid, a.end_vid, a.node, a.edge, a.cost, a.agg_cost
        FROM _trsp(
            _pgr_get_statement($1),
            _pgr_get_statement($2),
            $3::bigint[],
            $4::bigint[],
            $5) AS a;
$function$
;

-- Function: _pgr_trsp
-- Comment: pgRouting internal function deprecated on v3.4.0
-- 
CREATE OR REPLACE FUNCTION public._pgr_trsp(text, text, bigint, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.end_vid, a.node, a.edge, a.cost, a.agg_cost
        FROM _trsp(
            _pgr_get_statement($1),
            _pgr_get_statement($2),
            ARRAY[$3]::BIGINT[],
            $4::bigint[],
            directed) AS a;
$function$
;

-- Function: _pgr_trsp
-- Comment: pgRouting internal function deprecated on v3.4.0
-- 
CREATE OR REPLACE FUNCTION public._pgr_trsp_withpoints(text, text, text, text, directed boolean, driving_side character, details boolean, OUT seq integer, OUT path_seq integer, OUT departure bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_trsp_withpoints$function$
;

-- Function: _pgr_trsp_withpoints
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_trsp_withpoints(text, text, text, anyarray, anyarray, directed boolean, driving_side character, details boolean, OUT seq integer, OUT path_seq integer, OUT departure bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
AS '$libdir/libpgrouting-3.8', $function$_pgr_trsp_withpoints$function$
;

-- Function: _pgr_trsp_withpoints
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_trspv4(text, text, anyarray, anyarray, boolean, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
AS '$libdir/libpgrouting-3.8', $function$_pgr_trspv4$function$
;

-- Function: _pgr_trspv4
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_trspv4(text, text, text, boolean, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
AS '$libdir/libpgrouting-3.8', $function$_pgr_trspv4$function$
;

-- Function: _pgr_trspv4
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_trspvia(text, text, anyarray, boolean, boolean, boolean, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision, OUT route_agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_trspvia$function$
;

-- Function: _pgr_trspvia
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_trspvia_withpoints(text, text, text, anyarray, boolean, boolean, boolean, character, boolean, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision, OUT route_agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_trspvia_withpoints$function$
;

-- Function: _pgr_trspvia_withpoints
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_trspviavertices(sql text, vids integer[], directed boolean, has_rcost boolean, turn_restrict_sql text DEFAULT NULL::text, OUT seq integer, OUT id1 integer, OUT id2 integer, OUT id3 integer, OUT cost double precision)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
    i integer;
    rr RECORD;
    lrr RECORD;
    lrra boolean := false;
    seq1 integer := 0;
    seq2 integer := 0;
    restrictions_query TEXT;
begin
    IF (turn_restrict_sql IS NULL) THEN
        RAISE EXCEPTION 'Restrictions Missing';
    END IF;
    restrictions_query = $$
    WITH old_restrictions AS ( $$ ||
        $5 || $$
    )
    SELECT ROW_NUMBER() OVER() AS id,
    _pgr_array_reverse(array_prepend(target_id, string_to_array(via_path, ',')::INTEGER[])) AS path,
    to_cost AS cost
    FROM old_restrictions;
    $$;
    for i in 1 .. array_length(vids, 1)-1 loop
        seq2 := seq2 + 1;
        for rr in select a.seq, seq2 as id1, a.node::INTEGER as id2, a.edge::INTEGER as id3, a.cost
                    from _pgr_trsp(sql, restrictions_query, vids[i], vids[i+1], directed) as a loop
            if rr.id3 = -1 then
                lrr := rr;
                lrra := true;
            else
                seq1 := seq1 + 1;
                rr.seq := seq1;
                seq := rr.seq;
                id1 := rr.id1;
                id2 := rr.id2;
                id3 := rr.id3;
                cost := rr.cost;
                return next;
            end if;
        end loop;
    end loop;
    if lrra then
        seq1 := seq1 + 1;
        lrr.seq := seq1;
        seq := lrr.seq;
        id1 := lrr.id1;
        id2 := lrr.id2;
        id3 := lrr.id3;
        cost := lrr.cost;
        return next;
    end if;
    return;
end;
$function$
;

-- Function: _pgr_trspviavertices
-- Comment: pgRouting internal function deprecated on v3.4.0
-- 
CREATE OR REPLACE FUNCTION public._pgr_tsp(matrix_row_sql text, start_id bigint DEFAULT 0, end_id bigint DEFAULT 0, max_processing_time double precision DEFAULT 'Infinity'::double precision, tries_per_temperature integer DEFAULT 500, max_changes_per_temperature integer DEFAULT 60, max_consecutive_non_changes integer DEFAULT 100, initial_temperature double precision DEFAULT 100, final_temperature double precision DEFAULT 0.1, cooling_factor double precision DEFAULT 0.9, randomize boolean DEFAULT true, OUT seq integer, OUT node bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_tsp$function$
;

-- Function: _pgr_tsp
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_tspeuclidean(coordinates_sql text, start_id bigint DEFAULT 0, end_id bigint DEFAULT 0, max_processing_time double precision DEFAULT 'Infinity'::double precision, tries_per_temperature integer DEFAULT 500, max_changes_per_temperature integer DEFAULT 60, max_consecutive_non_changes integer DEFAULT 100, initial_temperature double precision DEFAULT 100, final_temperature double precision DEFAULT 0.1, cooling_factor double precision DEFAULT 0.9, randomize boolean DEFAULT true, OUT seq integer, OUT node bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_tspeuclidean$function$
;

-- Function: _pgr_tspeuclidean
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_turnrestrictedpath(text, text, bigint, bigint, integer, directed boolean, heap_paths boolean, stop_on_first boolean, strict boolean, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_turnrestrictedpath$function$
;

-- Function: _pgr_turnrestrictedpath
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_versionless(v1 text, v2 text)
 RETURNS boolean
 LANGUAGE plpgsql
 COST 1
AS $function$
declare
    v1a text[];
    v2a text[];
    nv1 integer;
    nv2 integer;
    ne1 integer;
    ne2 integer;
begin
    v1a := regexp_matches(v1, E'^(\\d+)(?:[\\.](\\d+))?(?:[\\.](\\d+))?[-+\\.]?(.*)$');
    v2a := regexp_matches(v2, E'^(\\d+)(?:[\\.](\\d+))?(?:[\\.](\\d+))?[-+\\.]?(.*)$');
    ne1 := case when v1a[4] is null or v1a[4]='' then 5
                when v1a[4] ilike 'rc%' then 4
                when v1a[4] ilike 'beta%' then 3
                when v1a[4] ilike 'alpha%' then 2
                when v1a[4] ilike 'dev%' then 1
                else 0 end;
    ne2 := case when v2a[4] is null or v2a[4]='' then 5
                when v2a[4] ilike 'rc%' then 4
                when v2a[4] ilike 'beta%' then 3
                when v2a[4] ilike 'alpha%' then 2
                when v2a[4] ilike 'dev%' then 1
                else 0 end;
    nv1 := v1a[1]::integer * 10000 +
           coalesce(v1a[2], '0')::integer * 1000 +
           coalesce(v1a[3], '0')::integer *  100 + ne1;
    nv2 := v2a[1]::integer * 10000 +
           coalesce(v2a[2], '0')::integer * 1000 +
           coalesce(v2a[3], '0')::integer *  100 + ne2;
    return nv1 < nv2;
end;
$function$
;

-- Function: _pgr_versionless
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_vrponedepot(text, text, text, integer, OUT seq integer, OUT vehicle_seq integer, OUT vehicle_id bigint, OUT stop_seq integer, OUT stop_type integer, OUT stop_id bigint, OUT order_id bigint, OUT cargo double precision, OUT travel_time double precision, OUT arrival_time double precision, OUT wait_time double precision, OUT service_time double precision, OUT departure_time double precision)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
orders_sql TEXT;
trucks_sql TEXT;
matrix_sql TEXT;
final_sql TEXT;
BEGIN
    orders_sql = $$WITH
    vrp_orders AS ($$ || $1 || $$ ),
    pickups AS (
        SELECT id, x AS p_x, y AS p_y, open_time AS p_open, close_time AS p_close, service_time AS p_service
        FROM vrp_orders
        WHERE id = $$ || $4 || $$
    )
    SELECT vrp_orders.id AS id, order_unit AS demand, pickups.id AS p_node_id, p_x, p_y, p_open, p_close, p_service,
    vrp_orders.id AS d_node_id, x AS d_x, y AS d_y, open_time AS d_open, close_time AS d_close, service_time AS d_service
    FROM vrp_orders, pickups
    WHERE vrp_orders.id != $$ || $4;
    trucks_sql = $$ WITH
    vrp_orders AS ($$ || $1 || $$ ),
    vrp_vehicles AS ($$ || $2 || $$ ),
    starts AS (
        SELECT id AS start_node_id, x AS start_x, y AS start_y, open_time AS start_open, close_time AS start_close, service_time AS start_service
        FROM vrp_orders
        WHERE id = $$ || $4 || $$
    )
    SELECT vehicle_id AS id, capacity, starts.* FROM vrp_vehicles, starts;
    $$;
    final_sql = '
    SELECT seq, vehicle_seq, vehicle_id, stop_seq, stop_type, stop_id, order_id, cargo, travel_time, arrival_time,
           wait_time, service_time, departure_time
    FROM _pgr_pickDeliver(
            $$' || orders_sql || '$$,
            $$' || trucks_sql || '$$,
            $$' || $3 || '$$,
            max_cycles := 3,
            initial_sol := 7 ); ';
    RAISE DEBUG '%', orders_sql;
    RAISE DEBUG '%', trucks_sql;
    RAISE DEBUG '%', $3;
    RAISE DEBUG '%', final_sql;
    RETURN QUERY EXECUTE final_sql;
END;
$function$
;

-- Function: _pgr_vrponedepot
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_withpoints(edges_sql text, points_sql text, start_pids anyarray, end_pids anyarray, directed boolean, driving_side character, details boolean, only_cost boolean DEFAULT false, normal boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_pid bigint, OUT end_pid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
AS '$libdir/libpgrouting-3.8', $function$_pgr_withpoints$function$
;

-- Function: _pgr_withpoints
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_withpoints(edges_sql text, points_sql text, combinations_sql text, directed boolean, driving_side character, details boolean, only_cost boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT start_pid bigint, OUT end_pid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_withpoints$function$
;

-- Function: _pgr_withpoints
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_withpointsdd(edges_sql text, points_sql text, start_pid anyarray, distance double precision, directed boolean DEFAULT true, driving_side character DEFAULT 'b'::bpchar, details boolean DEFAULT false, equicost boolean DEFAULT false, OUT seq integer, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_withpointsdd$function$
;

-- Function: _pgr_withpointsdd
-- Comment: pgRouting internal function deprecated on v3.6.0
-- 
CREATE OR REPLACE FUNCTION public._pgr_withpointsddv4(text, text, anyarray, double precision, character, boolean, boolean, boolean, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_withpointsddv4$function$
;

-- Function: _pgr_withpointsddv4
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_withpointsksp(text, text, text, integer, character, boolean, boolean, boolean, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_withpointsksp$function$
;

-- Function: _pgr_withpointsksp
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_withpointsksp(text, text, anyarray, anyarray, integer, character, boolean, boolean, boolean, boolean, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_withpointsksp$function$
;

-- Function: _pgr_withpointsksp
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._pgr_withpointsksp(edges_sql text, points_sql text, start_pid bigint, end_pid bigint, k integer, directed boolean, heap_paths boolean, driving_side character, details boolean, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STABLE STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_withpointsksp$function$
;

-- Function: _pgr_withpointsksp
-- Comment: pgRouting internal function deprecated on v3.6.0
-- 
CREATE OR REPLACE FUNCTION public._pgr_withpointsvia(sql text, via_edges bigint[], fraction double precision[], directed boolean DEFAULT true, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision, OUT route_agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
  DECLARE
  has_rcost boolean;
  sql_new_vertices text := ' ';
  sql_on_vertex text;
  v_union text := ' ';
  dummyrec record;
  rec1 record;
  via_vertices int[];
  sql_safe text;
  new_edges text;
  BEGIN
     BEGIN
        sql_safe = 'SELECT id, source, target, cost, reverse_cost FROM ('|| sql || ') AS __a';
        EXECUTE 'select reverse_cost, pg_typeof(reverse_cost)::text as rev_type  from ('||sql_safe||' ) AS __b__ limit 1 ' INTO rec1;
        has_rcost := true;
        EXCEPTION
          WHEN OTHERS THEN
            has_rcost = false;
     END;
      IF array_length(via_edges, 1) != array_length(fraction, 1) then
        RAISE EXCEPTION 'The length of via_edges is different of length of via_edges';
      END IF;
      FOR i IN 1 .. array_length(via_edges, 1)
      LOOP
          IF fraction[i] = 0 THEN
              sql_on_vertex := 'SELECT source FROM ('|| sql || ') __a where id = ' || via_edges[i];
              EXECUTE sql_on_vertex into dummyrec;
              via_vertices[i] = dummyrec.source;
          ELSE IF fraction[i] = 1 THEN
              sql_on_vertex := 'SELECT target FROM ('|| sql || ') __a where id = ' || via_edges[i];
              EXECUTE sql_on_vertex into dummyrec;
              via_vertices[i] = dummyrec.target;
          ELSE
              via_vertices[i] = -i;
              IF has_rcost THEN
                   sql_new_vertices = sql_new_vertices || v_union ||
                          '(SELECT id, source, ' ||  -i || ' AS target, cost * ' || fraction[i] || ' AS cost,
                              reverse_cost * (1 - ' || fraction[i] || ')  AS reverse_cost
                          FROM (SELECT * FROM (' || sql || ') __b' || i || ' WHERE id = ' || via_edges[i] || ') __a' || i ||')
                             UNION
                          (SELECT id, ' ||  -i || ' AS source, target, cost * (1 -' || fraction[i] || ') AS cost,
                              reverse_cost *  ' || fraction[i] || '  AS reverse_cost
                          FROM (SELECT * FROM (' || sql || ') __b' || i || ' where id = ' || via_edges[i] || ') __a' || i ||')';
                      v_union = ' UNION ';
               ELSE
                   sql_new_vertices = sql_new_vertices || v_union ||
                          '(SELECT id, source, ' ||  -i || ' AS target, cost * ' || fraction[i] || ' AS cost
                          FROM (SELECT * FROM (' || sql || ') __b' || i || ' WHERE id = ' || via_edges[i] || ') __a' || i ||')
                             UNION
                          (SELECT id, ' ||  -i || ' AS source, target, cost * (1 -' || fraction[i] || ') AS cost
                          FROM (SELECT * FROM (' || sql || ') __b' || i || ' WHERE id = ' || via_edges[i] || ') __a' || i ||')';
                      v_union = ' UNION ';
               END IF;
          END IF;
          END IF;
     END LOOP;
     IF sql_new_vertices = ' ' THEN
         new_edges := sql;
     ELSE
         IF has_rcost THEN
            new_edges:= 'WITH
                   orig AS ( ' || sql || '),
                   original AS (SELECT id, source, target, cost, reverse_cost FROM orig),
                   the_union AS ( ' || sql_new_vertices || '),
                   first_part AS ( SELECT * FROM (SELECT id, target AS source,  lead(target) OVER w  AS target,
                         lead(cost) OVER w  - cost AS cost,
                         lead(cost) OVER w  - cost AS reverse_cost
                      FROM  the_union  WHERE source > 0 AND cost > 0
                      WINDOW w AS (PARTITION BY id  ORDER BY cost ASC) ) as n2
                      WHERE target IS NOT NULL),
                   second_part AS ( SELECT * FROM (SELECT id, lead(source) OVER w  AS source, source as target,
                         reverse_cost - lead(reverse_cost) OVER w  AS cost,
                         reverse_cost - lead(reverse_cost) OVER w  AS reverse_cost
                      FROM  the_union  WHERE target > 0 and reverse_cost > 0
                      WINDOW w AS (PARTITION BY id  ORDER BY reverse_cost ASC) ) as n2
                      WHERE source IS NOT NULL),
                   more_union AS ( SELECT * from (
                       (SELECT * FROM original)
                             UNION
                       (SELECT * FROM the_union)
                             UNION
                       (SELECT * FROM first_part)
                             UNION
                       (SELECT * FROM second_part) ) _union )
                  SELECT *  FROM more_union';
         ELSE
            new_edges:= 'WITH
                   orig AS ( ' || sql || '),
                   original AS (SELECT id, source, target, cost FROM orig),
                   the_union AS ( ' || sql_new_vertices || '),
                   first_part AS ( SELECT * FROM (SELECT id, target AS source,  lead(target) OVER w  AS target,
                         lead(cost) OVER w  - cost AS cost
                      FROM  the_union  WHERE source > 0 AND cost > 0
                      WINDOW w AS (PARTITION BY id  ORDER BY cost ASC) ) as n2
                      WHERE target IS NOT NULL ),
                   more_union AS ( SELECT * from (
                       (SELECT * FROM original)
                             UNION
                       (SELECT * FROM the_union)
                             UNION
                       (SELECT * FROM first_part) ) _union )
                  SELECT *  FROM more_union';
          END IF;
      END IF;
     sql_new_vertices := sql_new_vertices || v_union || ' (' || sql || ')';
     RETURN query SELECT *
         FROM pgr_dijkstraVia(new_edges, via_vertices, directed, has_rcost);
  END
  $function$
;

-- Function: _pgr_withpointsvia
-- Comment: pgRouting internal function deprecated on v3.4.0
-- 
CREATE OR REPLACE FUNCTION public._pgr_withpointsvia(text, text, anyarray, boolean, boolean, boolean, character, boolean, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision, OUT route_agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
 STRICT
AS '$libdir/libpgrouting-3.8', $function$_pgr_withpointsvia$function$
;

-- Function: _pgr_withpointsvia
-- Comment: pgRouting internal function
-- 
CREATE OR REPLACE FUNCTION public._postgis_deprecate(oldname text, newname text, version text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE STRICT COST 250
AS $function$
DECLARE
  curver_text text;
BEGIN
	curver_text := '3.5.3';
	IF pg_catalog.split_part(curver_text,'.',1)::int > pg_catalog.split_part(version,'.',1)::int OR
	   ( pg_catalog.split_part(curver_text,'.',1) = pg_catalog.split_part(version,'.',1) AND
		 pg_catalog.split_part(curver_text,'.',2) != split_part(version,'.',2) )
	THEN
	  RAISE WARNING '% signature was deprecated in %. Please use %', oldname, version, newname;
	ELSE
	  RAISE DEBUG '% signature was deprecated in %. Please use %', oldname, version, newname;
	END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public._postgis_index_extent(tbl regclass, col text)
 RETURNS box2d
 LANGUAGE c
 STABLE STRICT
AS '$libdir/postgis-3', $function$_postgis_gserialized_index_extent$function$
;

CREATE OR REPLACE FUNCTION public._postgis_join_selectivity(regclass, text, regclass, text, text DEFAULT '2'::text)
 RETURNS double precision
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$_postgis_gserialized_joinsel$function$
;

CREATE OR REPLACE FUNCTION public._postgis_pgsql_version()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
	SELECT CASE WHEN pg_catalog.split_part(s,'.',1)::integer > 9 THEN pg_catalog.split_part(s,'.',1) || '0'
	ELSE pg_catalog.split_part(s,'.', 1) || pg_catalog.split_part(s,'.', 2) END AS v
	FROM pg_catalog.substring(version(), E'PostgreSQL ([0-9\\.]+)') AS s;
$function$
;

CREATE OR REPLACE FUNCTION public._postgis_scripts_pgsql_version()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$SELECT '140'::text AS version$function$
;

CREATE OR REPLACE FUNCTION public._postgis_selectivity(tbl regclass, att_name text, geom geometry, mode text DEFAULT '2'::text)
 RETURNS double precision
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$_postgis_gserialized_sel$function$
;

CREATE OR REPLACE FUNCTION public._postgis_stats(tbl regclass, att_name text, text DEFAULT '2'::text)
 RETURNS text
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$_postgis_gserialized_stats$function$
;

CREATE OR REPLACE FUNCTION public._raster_constraint_info_alignment(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE sql
 STABLE STRICT
AS $function$
	SELECT
		TRUE
	FROM pg_class c, pg_namespace n, pg_attribute a
		, (SELECT connamespace, conrelid, conkey, pg_get_constraintdef(oid) As consrc
			FROM pg_constraint) AS s
	WHERE n.nspname = $1
		AND c.relname = $2
		AND a.attname = $3
		AND a.attrelid = c.oid
		AND s.connamespace = n.oid
		AND s.conrelid = c.oid
		AND a.attnum = ANY (s.conkey)
		AND s.consrc LIKE '%st_samealignment(%';
	$function$
;

CREATE OR REPLACE FUNCTION public._raster_constraint_info_blocksize(rastschema name, rasttable name, rastcolumn name, axis text)
 RETURNS integer
 LANGUAGE sql
 STABLE STRICT
AS $function$
	SELECT
		CASE
			WHEN strpos(s.consrc, 'ANY (ARRAY[') > 0 THEN
				split_part((substring(s.consrc FROM E'ARRAY\\[(.*?){1}\\]')), ',', 1)::integer
			ELSE
				regexp_replace(
					split_part(s.consrc, '= ', 2),
					E'[\\(\\)]', '', 'g'
				)::integer
			END
	FROM pg_class c, pg_namespace n, pg_attribute a
		, (SELECT connamespace, conrelid, conkey, pg_get_constraintdef(oid) As consrc
			FROM pg_constraint) AS s
	WHERE n.nspname = $1
		AND c.relname = $2
		AND a.attname = $3
		AND a.attrelid = c.oid
		AND s.connamespace = n.oid
		AND s.conrelid = c.oid
		AND a.attnum = ANY (s.conkey)
		AND s.consrc LIKE '%st_' || $4 || '(%= %';
	$function$
;

CREATE OR REPLACE FUNCTION public._raster_constraint_info_coverage_tile(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE sql
 STABLE STRICT
AS $function$
	SELECT
		TRUE
	FROM pg_class c, pg_namespace n, pg_attribute a
			, (SELECT connamespace, conrelid, conkey, pg_get_constraintdef(oid) As consrc
			FROM pg_constraint) AS s
	WHERE n.nspname = $1
		AND c.relname = $2
		AND a.attname = $3
		AND a.attrelid = c.oid
		AND s.connamespace = n.oid
		AND s.conrelid = c.oid
		AND a.attnum = ANY (s.conkey)
		AND s.consrc LIKE '%st_iscoveragetile(%';
	$function$
;

CREATE OR REPLACE FUNCTION public._raster_constraint_info_extent(rastschema name, rasttable name, rastcolumn name)
 RETURNS geometry
 LANGUAGE sql
 STABLE STRICT
AS $function$
	SELECT
		trim(both '''' from split_part(trim(split_part(s.consrc, ' @ ', 2)), '::', 1))::geometry
	FROM pg_class c, pg_namespace n, pg_attribute a
		, (SELECT connamespace, conrelid, conkey, pg_get_constraintdef(oid) As consrc
			FROM pg_constraint) AS s
	WHERE n.nspname = $1
		AND c.relname = $2
		AND a.attname = $3
		AND a.attrelid = c.oid
		AND s.connamespace = n.oid
		AND s.conrelid = c.oid
		AND a.attnum = ANY (s.conkey)
		AND s.consrc LIKE '%st_envelope(% @ %';
	$function$
;

CREATE OR REPLACE FUNCTION public._raster_constraint_info_index(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE sql
 STABLE STRICT
AS $function$
		SELECT
			TRUE
		FROM pg_catalog.pg_class c
		JOIN pg_catalog.pg_index i
			ON i.indexrelid = c.oid
		JOIN pg_catalog.pg_class c2
			ON i.indrelid = c2.oid
		JOIN pg_catalog.pg_namespace n
			ON n.oid = c.relnamespace
		JOIN pg_am am
			ON c.relam = am.oid
		JOIN pg_attribute att
			ON att.attrelid = c2.oid
				AND pg_catalog.format_type(att.atttypid, att.atttypmod) = 'raster'
		WHERE c.relkind IN ('i')
			AND n.nspname = $1
			AND c2.relname = $2
			AND att.attname = $3
			AND am.amname = 'gist'
			AND strpos(pg_catalog.pg_get_expr(i.indexprs, i.indrelid), att.attname) > 0;
	$function$
;

CREATE OR REPLACE FUNCTION public._raster_constraint_info_nodata_values(rastschema name, rasttable name, rastcolumn name)
 RETURNS double precision[]
 LANGUAGE sql
 STABLE STRICT
AS $function$
	SELECT
		trim(both '''' from
			split_part(
				regexp_replace(
					split_part(s.consrc, ' = ', 2),
					E'[\\(\\)]', '', 'g'
				),
				'::', 1
			)
		)::double precision[]
	FROM pg_class c, pg_namespace n, pg_attribute a
		, (SELECT connamespace, conrelid, conkey, pg_get_constraintdef(oid) As consrc
			FROM pg_constraint) AS s
	WHERE n.nspname = $1
		AND c.relname = $2
		AND a.attname = $3
		AND a.attrelid = c.oid
		AND s.connamespace = n.oid
		AND s.conrelid = c.oid
		AND a.attnum = ANY (s.conkey)
		AND s.consrc LIKE '%_raster_constraint_nodata_values(%';
	$function$
;

CREATE OR REPLACE FUNCTION public._raster_constraint_info_num_bands(rastschema name, rasttable name, rastcolumn name)
 RETURNS integer
 LANGUAGE sql
 STABLE STRICT
AS $function$
	SELECT
		regexp_replace(
			split_part(s.consrc, ' = ', 2),
			E'[\\(\\)]', '', 'g'
		)::integer
	FROM pg_class c, pg_namespace n, pg_attribute a
		, (SELECT connamespace, conrelid, conkey, pg_get_constraintdef(oid) As consrc
			FROM pg_constraint) AS s
	WHERE n.nspname = $1
		AND c.relname = $2
		AND a.attname = $3
		AND a.attrelid = c.oid
		AND s.connamespace = n.oid
		AND s.conrelid = c.oid
		AND a.attnum = ANY (s.conkey)
		AND s.consrc LIKE '%st_numbands(%';
	$function$
;

CREATE OR REPLACE FUNCTION public._raster_constraint_info_out_db(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean[]
 LANGUAGE sql
 STABLE STRICT
AS $function$
	SELECT
		trim(
			both '''' from split_part(
				regexp_replace(
					split_part(s.consrc, ' = ', 2),
					E'[\\(\\)]', '', 'g'
				),
				'::', 1
			)
		)::boolean[]
	FROM pg_class c, pg_namespace n, pg_attribute a
			, (SELECT connamespace, conrelid, conkey, pg_get_constraintdef(oid) As consrc
			FROM pg_constraint) AS s
	WHERE n.nspname = $1
		AND c.relname = $2
		AND a.attname = $3
		AND a.attrelid = c.oid
		AND s.connamespace = n.oid
		AND s.conrelid = c.oid
		AND a.attnum = ANY (s.conkey)
		AND s.consrc LIKE '%_raster_constraint_out_db(%';
	$function$
;

CREATE OR REPLACE FUNCTION public._raster_constraint_info_pixel_types(rastschema name, rasttable name, rastcolumn name)
 RETURNS text[]
 LANGUAGE sql
 STABLE STRICT
AS $function$
	SELECT
		trim(
			both '''' from split_part(
				regexp_replace(
					split_part(s.consrc, ' = ', 2),
					E'[\\(\\)]', '', 'g'
				),
				'::', 1
			)
		)::text[]
	FROM pg_class c, pg_namespace n, pg_attribute a
		, (SELECT connamespace, conrelid, conkey, pg_get_constraintdef(oid) As consrc
			FROM pg_constraint) AS s
	WHERE n.nspname = $1
		AND c.relname = $2
		AND a.attname = $3
		AND a.attrelid = c.oid
		AND s.connamespace = n.oid
		AND s.conrelid = c.oid
		AND a.attnum = ANY (s.conkey)
		AND s.consrc LIKE '%_raster_constraint_pixel_types(%';
	$function$
;

CREATE OR REPLACE FUNCTION public._raster_constraint_info_regular_blocking(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE STRICT
AS $function$
	DECLARE
		covtile boolean;
		spunique boolean;
	BEGIN
		covtile := COALESCE( public._raster_constraint_info_coverage_tile($1, $2, $3), FALSE);
		spunique := COALESCE( public._raster_constraint_info_spatially_unique($1, $2, $3), FALSE);
		RETURN (covtile AND spunique);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._raster_constraint_info_scale(rastschema name, rasttable name, rastcolumn name, axis character)
 RETURNS double precision
 LANGUAGE sql
 STABLE STRICT
AS $function$
	WITH c AS (SELECT
		regexp_replace(
			replace(
				split_part(
					split_part(s.consrc, ' = ', 2),
					'::', 1
				),
				'round(', ''
			),
			E'[ ''''\\(\\)]', '', 'g'
		)::text AS val
	FROM pg_class c, pg_namespace n, pg_attribute a
		, (SELECT connamespace, conrelid, conkey, pg_get_constraintdef(oid) As consrc
		    FROM pg_constraint) AS s
	WHERE n.nspname = $1
		AND c.relname = $2
		AND a.attname = $3
		AND a.attrelid = c.oid
		AND s.connamespace = n.oid
		AND s.conrelid = c.oid
		AND a.attnum = ANY (s.conkey)
		AND s.consrc LIKE '%st_scale' || $4 || '(% = %')
   SELECT CASE WHEN split_part(c.val,',', 2) > ''
        THEN round( split_part(c.val, ',',1)::numeric, split_part(c.val,',',2)::integer )::float8
        ELSE c.val::float8 END
        FROM c;
	$function$
;

CREATE OR REPLACE FUNCTION public._raster_constraint_info_spatially_unique(rastschema name, rasttable name, rastcolumn name)
 RETURNS boolean
 LANGUAGE sql
 STABLE STRICT
AS $function$
	SELECT
		TRUE
	FROM pg_class c, pg_namespace n, pg_attribute a
		, (SELECT connamespace, conrelid, conindid, conkey, contype, conexclop, pg_get_constraintdef(oid) As consrc
			FROM pg_constraint) AS s
		, pg_index idx, pg_operator op
	WHERE n.nspname = $1
		AND c.relname = $2
		AND a.attname = $3
		AND a.attrelid = c.oid
		AND s.connamespace = n.oid
		AND s.conrelid = c.oid
		AND s.contype = 'x'
		AND 0::smallint = ANY (s.conkey)
		AND idx.indexrelid = s.conindid
		AND pg_get_indexdef(idx.indexrelid, 1, true) LIKE '(' || quote_ident($3) || '::geometry)'
		AND s.conexclop[1] = op.oid
		AND op.oprname = '=';
	$function$
;

CREATE OR REPLACE FUNCTION public._raster_constraint_info_srid(rastschema name, rasttable name, rastcolumn name)
 RETURNS integer
 LANGUAGE sql
 STABLE STRICT
AS $function$
	SELECT
		regexp_replace(
			split_part(s.consrc, ' = ', 2),
			E'[\\(\\)]', '', 'g'
		)::integer
	FROM pg_class c, pg_namespace n, pg_attribute a
		, (SELECT connamespace, conrelid, conkey, pg_get_constraintdef(oid) As consrc
		    FROM pg_constraint) AS s
	WHERE n.nspname = $1
		AND c.relname = $2
		AND a.attname = $3
		AND a.attrelid = c.oid
		AND s.connamespace = n.oid
		AND s.conrelid = c.oid
		AND a.attnum = ANY (s.conkey)
		AND s.consrc LIKE '%st_srid(% = %';
	$function$
;

CREATE OR REPLACE FUNCTION public._raster_constraint_nodata_values(rast raster)
 RETURNS numeric[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT pg_catalog.array_agg(pg_catalog.round(nodatavalue::numeric, 10))::numeric[] FROM public.ST_BandMetaData($1, ARRAY[]::int[]); $function$
;

CREATE OR REPLACE FUNCTION public._raster_constraint_out_db(rast raster)
 RETURNS boolean[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT pg_catalog.array_agg(isoutdb)::boolean[] FROM public.ST_BandMetaData($1, ARRAY[]::int[]); $function$
;

CREATE OR REPLACE FUNCTION public._raster_constraint_pixel_types(rast raster)
 RETURNS text[]
 LANGUAGE sql
 STABLE STRICT
AS $function$ SELECT pg_catalog.array_agg(pixeltype)::text[] FROM  public.ST_BandMetaData($1, ARRAY[]::int[]); $function$
;

CREATE OR REPLACE FUNCTION public._st_3ddfullywithin(geom1 geometry, geom2 geometry, double precision)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$LWGEOM_dfullywithin3d$function$
;

CREATE OR REPLACE FUNCTION public._st_3ddwithin(geom1 geometry, geom2 geometry, double precision)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$LWGEOM_dwithin3d$function$
;

CREATE OR REPLACE FUNCTION public._st_3dintersects(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_3DIntersects$function$
;

CREATE OR REPLACE FUNCTION public._st_asgml(integer, geometry, integer, integer, text, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$LWGEOM_asGML$function$
;

CREATE OR REPLACE FUNCTION public._st_aspect4ma(value double precision[], pos integer[], VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		x integer;
		y integer;
		z integer;
		_width double precision;
		_height double precision;
		_units text;
		dz_dx double precision;
		dz_dy double precision;
		aspect double precision;
		halfpi double precision;
		_value double precision[][][];
		ndims int;
	BEGIN
		ndims := array_ndims(value);
		IF ndims = 2 THEN
			_value := public._ST_convertarray4ma(value);
		ELSEIF ndims != 3 THEN
			RAISE EXCEPTION 'First parameter of function must be a 3-dimension array';
		ELSE
			_value := value;
		END IF;
		IF (
			array_lower(_value, 2) != 1 OR array_upper(_value, 2) != 3 OR
			array_lower(_value, 3) != 1 OR array_upper(_value, 3) != 3
		) THEN
			RAISE EXCEPTION 'First parameter of function must be a 1x3x3 array with each of the lower bounds starting from 1';
		END IF;
		IF array_length(userargs, 1) < 3 THEN
			RAISE EXCEPTION 'At least three elements must be provided for the third parameter';
		END IF;
		IF array_length(_value, 1) > 1 THEN
			RAISE NOTICE 'Only using the values from the first raster';
		END IF;
		z := array_lower(_value, 1);
		_width := userargs[1]::double precision;
		_height := userargs[2]::double precision;
		_units := userargs[3];
		IF _value[z][2][2] IS NULL THEN
			RETURN NULL;
		ELSE
			FOR y IN 1..3 LOOP
				FOR x IN 1..3 LOOP
					IF _value[z][y][x] IS NULL THEN
						_value[z][y][x] = _value[z][2][2];
					END IF;
				END LOOP;
			END LOOP;
		END IF;
		dz_dy := ((_value[z][3][1] + _value[z][3][2] + _value[z][3][2] + _value[z][3][3]) -
			(_value[z][1][1] + _value[z][1][2] + _value[z][1][2] + _value[z][1][3]));
		dz_dx := ((_value[z][1][3] + _value[z][2][3] + _value[z][2][3] + _value[z][3][3]) -
			(_value[z][1][1] + _value[z][2][1] + _value[z][2][1] + _value[z][3][1]));
		IF abs(dz_dx) = 0::double precision AND abs(dz_dy) = 0::double precision THEN
			RETURN -1;
		END IF;
		aspect := atan2(dz_dy, -dz_dx);
		halfpi := pi() / 2.0;
		IF aspect > halfpi THEN
			aspect := (5.0 * halfpi) - aspect;
		ELSE
			aspect := halfpi - aspect;
		END IF;
		IF aspect = 2 * pi() THEN
			aspect := 0.;
		END IF;
		CASE substring(upper(trim(leading from _units)) for 3)
			WHEN 'rad' THEN
				RETURN aspect;
			ELSE
				RETURN degrees(aspect);
		END CASE;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._st_asraster(geom geometry, scalex double precision DEFAULT 0, scaley double precision DEFAULT 0, width integer DEFAULT 0, height integer DEFAULT 0, pixeltype text[] DEFAULT ARRAY['8BUI'::text], value double precision[] DEFAULT ARRAY[(1)::double precision], nodataval double precision[] DEFAULT ARRAY[(0)::double precision], upperleftx double precision DEFAULT NULL::double precision, upperlefty double precision DEFAULT NULL::double precision, gridx double precision DEFAULT NULL::double precision, gridy double precision DEFAULT NULL::double precision, skewx double precision DEFAULT 0, skewy double precision DEFAULT 0, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_asRaster$function$
;

CREATE OR REPLACE FUNCTION public._st_asx3d(integer, geometry, integer, integer, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$LWGEOM_asX3D$function$
;

CREATE OR REPLACE FUNCTION public._st_bestsrid(geography, geography)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$geography_bestsrid$function$
;

CREATE OR REPLACE FUNCTION public._st_bestsrid(geography)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$geography_bestsrid$function$
;

CREATE OR REPLACE FUNCTION public._st_clip(rast raster, nband integer[], geom geometry, nodataval double precision[] DEFAULT NULL::double precision[], crop boolean DEFAULT true, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_clip$function$
;

CREATE OR REPLACE FUNCTION public._st_colormap(rast raster, nband integer, colormap text, method text DEFAULT 'INTERPOLATE'::text)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_colorMap$function$
;

CREATE OR REPLACE FUNCTION public._st_contains(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE STRICT COST 1000
AS '$libdir/postgis_raster-3', $function$RASTER_contains$function$
;

CREATE OR REPLACE FUNCTION public._st_contains(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$contains$function$
;

CREATE OR REPLACE FUNCTION public._st_containsproperly(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$containsproperly$function$
;

CREATE OR REPLACE FUNCTION public._st_containsproperly(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 1000
AS '$libdir/postgis_raster-3', $function$RASTER_containsProperly$function$
;

CREATE OR REPLACE FUNCTION public._st_convertarray4ma(value double precision[])
 RETURNS double precision[]
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	DECLARE
		_value double precision[][][];
		x int;
		y int;
	BEGIN
		IF array_ndims(value) != 2 THEN
			RAISE EXCEPTION 'Function parameter must be a 2-dimension array';
		END IF;
		_value := array_fill(NULL::double precision, ARRAY[1, array_length(value, 1), array_length(value, 2)]::int[], ARRAY[1, array_lower(value, 1), array_lower(value, 2)]::int[]);
		FOR y IN array_lower(value, 1)..array_upper(value, 1) LOOP
			FOR x IN array_lower(value, 2)..array_upper(value, 2) LOOP
				_value[1][y][x] = value[y][x];
			END LOOP;
		END LOOP;
		RETURN _value;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._st_count(rast raster, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, sample_percent double precision DEFAULT 1)
 RETURNS bigint
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	DECLARE
		rtn bigint;
	BEGIN
		IF exclude_nodata_value IS FALSE THEN
			SELECT width * height INTO rtn FROM public.ST_Metadata(rast);
		ELSE
			SELECT count INTO rtn FROM public._ST_summarystats($1, $2, $3, $4);
		END IF;
		RETURN rtn;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._st_countagg_finalfn(agg agg_count)
 RETURNS bigint
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	BEGIN
		IF agg IS NULL THEN
			RAISE EXCEPTION 'Cannot count coverage';
		END IF;
		RETURN agg.count;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._st_countagg_transfn(agg agg_count, rast raster, exclude_nodata_value boolean)
 RETURNS agg_count
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		rtn_agg agg_count;
	BEGIN
		rtn_agg :=  public.__ST_countagg_transfn(
			agg,
			rast,
			1, exclude_nodata_value,
			1
		);
		RETURN rtn_agg;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._st_countagg_transfn(agg agg_count, rast raster, nband integer, exclude_nodata_value boolean)
 RETURNS agg_count
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		rtn_agg agg_count;
	BEGIN
		rtn_agg :=  public.__ST_countagg_transfn(
			agg,
			rast,
			nband, exclude_nodata_value,
			1
		);
		RETURN rtn_agg;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._st_countagg_transfn(agg agg_count, rast raster, nband integer, exclude_nodata_value boolean, sample_percent double precision)
 RETURNS agg_count
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		rtn_agg agg_count;
	BEGIN
		rtn_agg :=  public.__st_countagg_transfn(
			agg,
			rast,
			nband, exclude_nodata_value,
			sample_percent
		);
		RETURN rtn_agg;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._st_coveredby(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$coveredby$function$
;

CREATE OR REPLACE FUNCTION public._st_coveredby(geog1 geography, geog2 geography)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$geography_coveredby$function$
;

CREATE OR REPLACE FUNCTION public._st_coveredby(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 1000
AS '$libdir/postgis_raster-3', $function$RASTER_coveredby$function$
;

CREATE OR REPLACE FUNCTION public._st_covers(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$covers$function$
;

CREATE OR REPLACE FUNCTION public._st_covers(geog1 geography, geog2 geography)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$geography_covers$function$
;

CREATE OR REPLACE FUNCTION public._st_covers(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 1000
AS '$libdir/postgis_raster-3', $function$RASTER_covers$function$
;

CREATE OR REPLACE FUNCTION public._st_crosses(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$crosses$function$
;

CREATE OR REPLACE FUNCTION public._st_dfullywithin(rast1 raster, nband1 integer, rast2 raster, nband2 integer, distance double precision)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 1000
AS '$libdir/postgis_raster-3', $function$RASTER_dfullywithin$function$
;

CREATE OR REPLACE FUNCTION public._st_dfullywithin(geom1 geometry, geom2 geometry, double precision)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$LWGEOM_dfullywithin$function$
;

CREATE OR REPLACE FUNCTION public._st_distancetree(geography, geography, double precision, boolean)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE STRICT COST 5000
AS '$libdir/postgis-3', $function$geography_distance_tree$function$
;

CREATE OR REPLACE FUNCTION public._st_distancetree(geography, geography)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE STRICT
AS $function$SELECT public._ST_DistanceTree($1, $2, 0.0, true)$function$
;

CREATE OR REPLACE FUNCTION public._st_distanceuncached(geography, geography, double precision, boolean)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE STRICT COST 5000
AS '$libdir/postgis-3', $function$geography_distance_uncached$function$
;

CREATE OR REPLACE FUNCTION public._st_distanceuncached(geography, geography, boolean)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE STRICT
AS $function$SELECT public._ST_DistanceUnCached($1, $2, 0.0, $3)$function$
;

CREATE OR REPLACE FUNCTION public._st_distanceuncached(geography, geography)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE STRICT
AS $function$SELECT public._ST_DistanceUnCached($1, $2, 0.0, true)$function$
;

CREATE OR REPLACE FUNCTION public._st_dwithin(rast1 raster, nband1 integer, rast2 raster, nband2 integer, distance double precision)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 1000
AS '$libdir/postgis_raster-3', $function$RASTER_dwithin$function$
;

CREATE OR REPLACE FUNCTION public._st_dwithin(geog1 geography, geog2 geography, tolerance double precision, use_spheroid boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$geography_dwithin$function$
;

CREATE OR REPLACE FUNCTION public._st_dwithin(geom1 geometry, geom2 geometry, double precision)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$LWGEOM_dwithin$function$
;

CREATE OR REPLACE FUNCTION public._st_dwithinuncached(geography, geography, double precision, boolean)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE STRICT COST 5000
AS '$libdir/postgis-3', $function$geography_dwithin_uncached$function$
;

CREATE OR REPLACE FUNCTION public._st_dwithinuncached(geography, geography, double precision)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$SELECT $1 OPERATOR(public.&&) public._ST_Expand($2,$3) AND $2 OPERATOR(public.&&) public._ST_Expand($1,$3) AND public._ST_DWithinUnCached($1, $2, $3, true)$function$
;

CREATE OR REPLACE FUNCTION public._st_equals(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_Equals$function$
;

CREATE OR REPLACE FUNCTION public._st_expand(geography, double precision)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$geography_expand$function$
;

CREATE OR REPLACE FUNCTION public._st_gdalwarp(rast raster, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125, srid integer DEFAULT NULL::integer, scalex double precision DEFAULT 0, scaley double precision DEFAULT 0, gridx double precision DEFAULT NULL::double precision, gridy double precision DEFAULT NULL::double precision, skewx double precision DEFAULT 0, skewy double precision DEFAULT 0, width integer DEFAULT NULL::integer, height integer DEFAULT NULL::integer)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_GDALWarp$function$
;

CREATE OR REPLACE FUNCTION public._st_geomfromgml(text, integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$geom_from_gml$function$
;

CREATE OR REPLACE FUNCTION public._st_grayscale4ma(value double precision[], pos integer[], VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		ndims integer;
		_value double precision[][][];
		red double precision;
		green double precision;
		blue double precision;
		gray double precision;
	BEGIN
		ndims := array_ndims(value);
		IF ndims = 2 THEN
			_value := public._ST_convertarray4ma(value);
		ELSEIF ndims != 3 THEN
			RAISE EXCEPTION 'First parameter of function must be a 3-dimension array';
		ELSE
			_value := value;
		END IF;
		red := _value[1][1][1];
		green := _value[2][1][1];
		blue := _value[3][1][1];
		gray = round(0.2989 * red + 0.5870 * green + 0.1140 * blue);
		RETURN gray;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._st_hillshade4ma(value double precision[], pos integer[], VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		_pixwidth double precision;
		_pixheight double precision;
		_width double precision;
		_height double precision;
		_azimuth double precision;
		_altitude double precision;
		_bright double precision;
		_scale double precision;
		dz_dx double precision;
		dz_dy double precision;
		azimuth double precision;
		zenith double precision;
		slope double precision;
		aspect double precision;
		shade double precision;
		_value double precision[][][];
		ndims int;
		z int;
	BEGIN
		ndims := array_ndims(value);
		IF ndims = 2 THEN
			_value := public._ST_convertarray4ma(value);
		ELSEIF ndims != 3 THEN
			RAISE EXCEPTION 'First parameter of function must be a 3-dimension array';
		ELSE
			_value := value;
		END IF;
		IF (
			array_lower(_value, 2) != 1 OR array_upper(_value, 2) != 3 OR
			array_lower(_value, 3) != 1 OR array_upper(_value, 3) != 3
		) THEN
			RAISE EXCEPTION 'First parameter of function must be a 1x3x3 array with each of the lower bounds starting from 1';
		END IF;
		IF array_length(userargs, 1) < 8 THEN
			RAISE EXCEPTION 'At least eight elements must be provided for the third parameter';
		END IF;
		IF array_length(_value, 1) > 1 THEN
			RAISE NOTICE 'Only using the values from the first raster';
		END IF;
		z := array_lower(_value, 1);
		_pixwidth := userargs[1]::double precision;
		_pixheight := userargs[2]::double precision;
		_width := userargs[3]::double precision;
		_height := userargs[4]::double precision;
		_azimuth := userargs[5]::double precision;
		_altitude := userargs[6]::double precision;
		_bright := userargs[7]::double precision;
		_scale := userargs[8]::double precision;
		IF (pos[1][1] = 1 OR pos[1][2] = 1) OR (pos[1][1] = _width OR pos[1][2] = _height) THEN
			RETURN NULL;
		END IF;
		IF _azimuth < 0. THEN
			RAISE NOTICE 'Clamping provided azimuth value % to 0', _azimuth;
			_azimuth := 0.;
		ELSEIF _azimuth >= 360. THEN
			RAISE NOTICE 'Converting provided azimuth value % to be between 0 and 360', _azimuth;
			_azimuth := _azimuth - (360. * floor(_azimuth / 360.));
		END IF;
		azimuth := 360. - _azimuth + 90.;
		IF azimuth >= 360. THEN
			azimuth := azimuth - 360.;
		END IF;
		azimuth := radians(azimuth);
		IF _altitude < 0. THEN
			RAISE NOTICE 'Clamping provided altitude value % to 0', _altitude;
			_altitude := 0.;
		ELSEIF _altitude > 90. THEN
			RAISE NOTICE 'Clamping provided altitude value % to 90', _altitude;
			_altitude := 90.;
		END IF;
		zenith := radians(90. - _altitude);
		IF _bright < 0. THEN
			RAISE NOTICE 'Clamping provided bright value % to 0', _bright;
			_bright := 0.;
		ELSEIF _bright > 255. THEN
			RAISE NOTICE 'Clamping provided bright value % to 255', _bright;
			_bright := 255.;
		END IF;
		dz_dy := ((_value[z][3][1] + _value[z][3][2] + _value[z][3][2] + _value[z][3][3]) -
			(_value[z][1][1] + _value[z][1][2] + _value[z][1][2] + _value[z][1][3])) / (8 * _pixheight);
		dz_dx := ((_value[z][1][3] + _value[z][2][3] + _value[z][2][3] + _value[z][3][3]) -
			(_value[z][1][1] + _value[z][2][1] + _value[z][2][1] + _value[z][3][1])) / (8 * _pixwidth);
		slope := atan(sqrt(dz_dx * dz_dx + dz_dy * dz_dy) / _scale);
		IF dz_dx != 0. THEN
			aspect := atan2(dz_dy, -dz_dx);
			IF aspect < 0. THEN
				aspect := aspect + (2.0 * pi());
			END IF;
		ELSE
			IF dz_dy > 0. THEN
				aspect := pi() / 2.;
			ELSEIF dz_dy < 0. THEN
				aspect := (2. * pi()) - (pi() / 2.);
			ELSE
				aspect := pi();
			END IF;
		END IF;
		shade := _bright * ((cos(zenith) * cos(slope)) + (sin(zenith) * sin(slope) * cos(azimuth - aspect)));
		IF shade < 0. THEN
			shade := 0;
		END IF;
		RETURN shade;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._st_histogram(rast raster, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, sample_percent double precision DEFAULT 1, bins integer DEFAULT 0, width double precision[] DEFAULT NULL::double precision[], "right" boolean DEFAULT false, min double precision DEFAULT NULL::double precision, max double precision DEFAULT NULL::double precision, OUT min double precision, OUT max double precision, OUT count bigint, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_histogram$function$
;

CREATE OR REPLACE FUNCTION public._st_intersects(geom geometry, rast raster, nband integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$
	DECLARE
		hasnodata boolean := TRUE;
		_geom public.geometry;
	BEGIN
		IF public.ST_SRID(rast) != public.ST_SRID(geom) THEN
			RAISE EXCEPTION 'Raster and geometry do not have the same SRID';
		END IF;
		_geom := public.ST_ConvexHull(rast);
		IF nband IS NOT NULL THEN
			SELECT CASE WHEN bmd.nodatavalue IS NULL THEN FALSE ELSE NULL END INTO hasnodata FROM public.ST_BandMetaData(rast, nband) AS bmd;
		END IF;
		IF public.ST_Intersects(geom, _geom) IS NOT TRUE THEN
			RETURN FALSE;
		ELSEIF nband IS NULL OR hasnodata IS FALSE THEN
			RETURN TRUE;
		END IF;
		SELECT public.ST_Buffer(public.ST_Collect(t.geom), 0) INTO _geom FROM public.ST_PixelAsPolygons(rast, nband) AS t;
		RETURN public.ST_Intersects(geom, _geom);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._st_intersects(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 1000
AS '$libdir/postgis_raster-3', $function$RASTER_intersects$function$
;

CREATE OR REPLACE FUNCTION public._st_intersects(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_Intersects$function$
;

CREATE OR REPLACE FUNCTION public._st_linecrossingdirection(line1 geometry, line2 geometry)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_LineCrossingDirection$function$
;

CREATE OR REPLACE FUNCTION public._st_longestline(geom1 geometry, geom2 geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_longestline2d$function$
;

CREATE OR REPLACE FUNCTION public._st_mapalgebra(rastbandargset rastbandarg[], expression text, pixeltype text DEFAULT NULL::text, extenttype text DEFAULT 'INTERSECTION'::text, nodata1expr text DEFAULT NULL::text, nodata2expr text DEFAULT NULL::text, nodatanodataval double precision DEFAULT NULL::double precision)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_nMapAlgebraExpr$function$
;

CREATE OR REPLACE FUNCTION public._st_mapalgebra(rastbandargset rastbandarg[], callbackfunc regprocedure, pixeltype text DEFAULT NULL::text, distancex integer DEFAULT 0, distancey integer DEFAULT 0, extenttype text DEFAULT 'INTERSECTION'::text, customextent raster DEFAULT NULL::raster, mask double precision[] DEFAULT NULL::double precision[], weighted boolean DEFAULT NULL::boolean, VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_nMapAlgebra$function$
;

CREATE OR REPLACE FUNCTION public._st_maxdistance(geom1 geometry, geom2 geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_maxdistance2d_linestring$function$
;

CREATE OR REPLACE FUNCTION public._st_neighborhood(rast raster, band integer, columnx integer, rowy integer, distancex integer, distancey integer, exclude_nodata_value boolean DEFAULT true)
 RETURNS double precision[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_neighborhood$function$
;

CREATE OR REPLACE FUNCTION public._st_orderingequals(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$LWGEOM_same$function$
;

CREATE OR REPLACE FUNCTION public._st_overlaps(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE STRICT COST 1000
AS '$libdir/postgis_raster-3', $function$RASTER_overlaps$function$
;

CREATE OR REPLACE FUNCTION public._st_overlaps(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$overlaps$function$
;

CREATE OR REPLACE FUNCTION public._st_pixelascentroids(rast raster, band integer DEFAULT 1, columnx integer DEFAULT NULL::integer, rowy integer DEFAULT NULL::integer, exclude_nodata_value boolean DEFAULT true)
 RETURNS TABLE(geom geometry, val double precision, x integer, y integer)
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_getPixelCentroids$function$
;

CREATE OR REPLACE FUNCTION public._st_pixelaspolygons(rast raster, band integer DEFAULT 1, columnx integer DEFAULT NULL::integer, rowy integer DEFAULT NULL::integer, exclude_nodata_value boolean DEFAULT true)
 RETURNS TABLE(geom geometry, val double precision, x integer, y integer)
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_getPixelPolygons$function$
;

CREATE OR REPLACE FUNCTION public._st_pointoutside(geography)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/postgis-3', $function$geography_point_outside$function$
;

CREATE OR REPLACE FUNCTION public._st_quantile(rast raster, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, sample_percent double precision DEFAULT 1, quantiles double precision[] DEFAULT NULL::double precision[], OUT quantile double precision, OUT value double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_quantile$function$
;

CREATE OR REPLACE FUNCTION public._st_rastertoworldcoord(rast raster, columnx integer DEFAULT NULL::integer, rowy integer DEFAULT NULL::integer, OUT longitude double precision, OUT latitude double precision)
 RETURNS record
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_rasterToWorldCoord$function$
;

CREATE OR REPLACE FUNCTION public._st_reclass(rast raster, VARIADIC reclassargset reclassarg[])
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_reclass$function$
;

CREATE OR REPLACE FUNCTION public._st_roughness4ma(value double precision[], pos integer[], VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		x integer;
		y integer;
		z integer;
		minimum double precision;
		maximum double precision;
		_value double precision[][][];
		ndims int;
	BEGIN
		ndims := array_ndims(value);
		IF ndims = 2 THEN
			_value := public._ST_convertarray4ma(value);
		ELSEIF ndims != 3 THEN
			RAISE EXCEPTION 'First parameter of function must be a 3-dimension array';
		ELSE
			_value := value;
		END IF;
		IF array_length(_value, 1) > 1 THEN
			RAISE NOTICE 'Only using the values from the first raster';
		END IF;
		z := array_lower(_value, 1);
		IF (
			array_lower(_value, 2) != 1 OR array_upper(_value, 2) != 3 OR
			array_lower(_value, 3) != 1 OR array_upper(_value, 3) != 3
		) THEN
			RAISE EXCEPTION 'First parameter of function must be a 1x3x3 array with each of the lower bounds starting from 1';
		END IF;
		IF _value[z][2][2] IS NULL THEN
			RETURN NULL;
		ELSE
			FOR y IN 1..3 LOOP
				FOR x IN 1..3 LOOP
					IF _value[z][y][x] IS NULL THEN
						_value[z][y][x] = _value[z][2][2];
					END IF;
				END LOOP;
			END LOOP;
		END IF;
		minimum := _value[z][1][1];
		maximum := _value[z][1][1];
		FOR Y IN 1..3 LOOP
		    FOR X IN 1..3 LOOP
		    	 IF _value[z][y][x] < minimum THEN
			    minimum := _value[z][y][x];
			 ELSIF _value[z][y][x] > maximum THEN
			    maximum := _value[z][y][x];
			 END IF;
		    END LOOP;
		END LOOP;
		RETURN maximum - minimum;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._st_samealignment_finalfn(agg agg_samealignment)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT $1.aligned $function$
;

CREATE OR REPLACE FUNCTION public._st_samealignment_transfn(agg agg_samealignment, rast raster)
 RETURNS agg_samealignment
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		m record;
		aligned boolean;
	BEGIN
		IF agg IS NULL THEN
			agg.refraster := NULL;
			agg.aligned := NULL;
		END IF;
		IF rast IS NULL THEN
			agg.aligned := NULL;
		ELSE
			IF agg.refraster IS NULL THEN
				m := public.ST_Metadata(rast);
				agg.refraster := public.ST_MakeEmptyRaster(1, 1, m.upperleftx, m.upperlefty, m.scalex, m.scaley, m.skewx, m.skewy, m.srid);
				agg.aligned := TRUE;
			ELSIF agg.aligned IS TRUE THEN
				agg.aligned := public.ST_SameAlignment(agg.refraster, rast);
			END IF;
		END IF;
		RETURN agg;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._st_setvalues(rast raster, nband integer, x integer, y integer, newvalueset double precision[], noset boolean[] DEFAULT NULL::boolean[], hasnosetvalue boolean DEFAULT false, nosetvalue double precision DEFAULT NULL::double precision, keepnodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_setPixelValuesArray$function$
;

CREATE OR REPLACE FUNCTION public._st_slope4ma(value double precision[], pos integer[], VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		x integer;
		y integer;
		z integer;
		_pixwidth double precision;
		_pixheight double precision;
		_width double precision;
		_height double precision;
		_units text;
		_scale double precision;
		dz_dx double precision;
		dz_dy double precision;
		slope double precision;
		_value double precision[][][];
		ndims int;
	BEGIN
		ndims := array_ndims(value);
		IF ndims = 2 THEN
			_value := public._ST_convertarray4ma(value);
		ELSEIF ndims != 3 THEN
			RAISE EXCEPTION 'First parameter of function must be a 3-dimension array';
		ELSE
			_value := value;
		END IF;
		IF array_length(_value, 1) > 1 THEN
			RAISE NOTICE 'Only using the values from the first raster';
		END IF;
		z := array_lower(_value, 1);
		IF (
			array_lower(_value, 2) != 1 OR array_upper(_value, 2) != 3 OR
			array_lower(_value, 3) != 1 OR array_upper(_value, 3) != 3
		) THEN
			RAISE EXCEPTION 'First parameter of function must be a 1x3x3 array with each of the lower bounds starting from 1';
		END IF;
		IF array_length(userargs, 1) < 6 THEN
			RAISE EXCEPTION 'At least six elements must be provided for the third parameter';
		END IF;
		_pixwidth := userargs[1]::double precision;
		_pixheight := userargs[2]::double precision;
		_width := userargs[3]::double precision;
		_height := userargs[4]::double precision;
		_units := userargs[5];
		_scale := userargs[6]::double precision;
		IF _value[z][2][2] IS NULL THEN
			RETURN NULL;
		ELSE
			FOR y IN 1..3 LOOP
				FOR x IN 1..3 LOOP
					IF _value[z][y][x] IS NULL THEN
						_value[z][y][x] = _value[z][2][2];
					END IF;
				END LOOP;
			END LOOP;
		END IF;
		dz_dy := ((_value[z][3][1] + _value[z][3][2] + _value[z][3][2] + _value[z][3][3]) -
			(_value[z][1][1] + _value[z][1][2] + _value[z][1][2] + _value[z][1][3])) / _pixheight;
		dz_dx := ((_value[z][1][3] + _value[z][2][3] + _value[z][2][3] + _value[z][3][3]) -
			(_value[z][1][1] + _value[z][2][1] + _value[z][2][1] + _value[z][3][1])) / _pixwidth;
		slope := sqrt(dz_dx * dz_dx + dz_dy * dz_dy) / (8 * _scale);
		CASE substring(upper(trim(leading from _units)) for 3)
			WHEN 'PER' THEN
				slope := 100.0 * slope;
			WHEN 'rad' THEN
				slope := atan(slope);
			ELSE
				slope := degrees(atan(slope));
		END CASE;
		RETURN slope;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._st_sortablehash(geom geometry)
 RETURNS bigint
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$_ST_SortableHash$function$
;

CREATE OR REPLACE FUNCTION public._st_summarystats(rast raster, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, sample_percent double precision DEFAULT 1)
 RETURNS summarystats
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_summaryStats$function$
;

CREATE OR REPLACE FUNCTION public._st_summarystats_finalfn(internal)
 RETURNS summarystats
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_summaryStats_finalfn$function$
;

CREATE OR REPLACE FUNCTION public._st_summarystats_transfn(internal, raster, integer, boolean)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_summaryStats_transfn$function$
;

CREATE OR REPLACE FUNCTION public._st_summarystats_transfn(internal, raster, boolean, double precision)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_summaryStats_transfn$function$
;

CREATE OR REPLACE FUNCTION public._st_summarystats_transfn(internal, raster, integer, boolean, double precision)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_summaryStats_transfn$function$
;

CREATE OR REPLACE FUNCTION public._st_tile(rast raster, width integer, height integer, nband integer[] DEFAULT NULL::integer[], padwithnodata boolean DEFAULT false, nodataval double precision DEFAULT NULL::double precision)
 RETURNS SETOF raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_tile$function$
;

CREATE OR REPLACE FUNCTION public._st_touches(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$touches$function$
;

CREATE OR REPLACE FUNCTION public._st_touches(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 1000
AS '$libdir/postgis_raster-3', $function$RASTER_touches$function$
;

CREATE OR REPLACE FUNCTION public._st_tpi4ma(value double precision[], pos integer[], VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		x integer;
		y integer;
		z integer;
		Z1 double precision;
		Z2 double precision;
		Z3 double precision;
		Z4 double precision;
		Z5 double precision;
		Z6 double precision;
		Z7 double precision;
		Z8 double precision;
		Z9 double precision;
		tpi double precision;
		mean double precision;
		_value double precision[][][];
		ndims int;
	BEGIN
		ndims := array_ndims(value);
		IF ndims = 2 THEN
			_value := public._ST_convertarray4ma(value);
		ELSEIF ndims != 3 THEN
			RAISE EXCEPTION 'First parameter of function must be a 3-dimension array';
		ELSE
			_value := value;
		END IF;
		IF array_length(_value, 1) > 1 THEN
			RAISE NOTICE 'Only using the values from the first raster';
		END IF;
		z := array_lower(_value, 1);
		IF (
			array_lower(_value, 2) != 1 OR array_upper(_value, 2) != 3 OR
			array_lower(_value, 3) != 1 OR array_upper(_value, 3) != 3
		) THEN
			RAISE EXCEPTION 'First parameter of function must be a 1x3x3 array with each of the lower bounds starting from 1';
		END IF;
		IF _value[z][2][2] IS NULL THEN
			RETURN NULL;
		ELSE
			FOR y IN 1..3 LOOP
				FOR x IN 1..3 LOOP
					IF _value[z][y][x] IS NULL THEN
						_value[z][y][x] = _value[z][2][2];
					END IF;
				END LOOP;
			END LOOP;
		END IF;
		Z1 := _value[z][1][1];
		Z2 := _value[z][2][1];
		Z3 := _value[z][3][1];
		Z4 := _value[z][1][2];
		Z5 := _value[z][2][2];
		Z6 := _value[z][3][2];
		Z7 := _value[z][1][3];
		Z8 := _value[z][2][3];
		Z9 := _value[z][3][3];
		mean := (Z1 + Z2 + Z3 + Z4 + Z6 + Z7 + Z8 + Z9)/8;
		tpi := Z5-mean;
		return tpi;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._st_tri4ma(value double precision[], pos integer[], VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		x integer;
		y integer;
		z integer;
		Z1 double precision;
		Z2 double precision;
		Z3 double precision;
		Z4 double precision;
		Z5 double precision;
		Z6 double precision;
		Z7 double precision;
		Z8 double precision;
		Z9 double precision;
		tri double precision;
		_value double precision[][][];
		ndims int;
	BEGIN
		ndims := array_ndims(value);
		IF ndims = 2 THEN
			_value := public._ST_convertarray4ma(value);
		ELSEIF ndims != 3 THEN
			RAISE EXCEPTION 'First parameter of function must be a 3-dimension array';
		ELSE
			_value := value;
		END IF;
		IF array_length(_value, 1) > 1 THEN
			RAISE NOTICE 'Only using the values from the first raster';
		END IF;
		z := array_lower(_value, 1);
		IF (
			array_lower(_value, 2) != 1 OR array_upper(_value, 2) != 3 OR
			array_lower(_value, 3) != 1 OR array_upper(_value, 3) != 3
		) THEN
			RAISE EXCEPTION 'First parameter of function must be a 1x3x3 array with each of the lower bounds starting from 1';
		END IF;
		IF _value[z][2][2] IS NULL THEN
			RETURN NULL;
		ELSE
			FOR y IN 1..3 LOOP
				FOR x IN 1..3 LOOP
					IF _value[z][y][x] IS NULL THEN
						_value[z][y][x] = _value[z][2][2];
					END IF;
				END LOOP;
			END LOOP;
		END IF;
		Z1 := _value[z][1][1];
		Z2 := _value[z][2][1];
		Z3 := _value[z][3][1];
		Z4 := _value[z][1][2];
		Z5 := _value[z][2][2];
		Z6 := _value[z][3][2];
		Z7 := _value[z][1][3];
		Z8 := _value[z][2][3];
		Z9 := _value[z][3][3];
		tri := ( abs(Z1 - Z5 ) + abs( Z2 - Z5 ) + abs( Z3 - Z5 ) + abs( Z4 - Z5 ) + abs( Z6 - Z5 ) + abs( Z7 - Z5 ) + abs( Z8 - Z5 ) + abs ( Z9 - Z5 )) / 8;
		return tri;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._st_union_finalfn(internal)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_union_finalfn$function$
;

CREATE OR REPLACE FUNCTION public._st_union_transfn(internal, raster, integer)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_union_transfn$function$
;

CREATE OR REPLACE FUNCTION public._st_union_transfn(internal, raster, integer, text)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_union_transfn$function$
;

CREATE OR REPLACE FUNCTION public._st_union_transfn(internal, raster, text)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_union_transfn$function$
;

CREATE OR REPLACE FUNCTION public._st_union_transfn(internal, raster, unionarg[])
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_union_transfn$function$
;

CREATE OR REPLACE FUNCTION public._st_union_transfn(internal, raster)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_union_transfn$function$
;

CREATE OR REPLACE FUNCTION public._st_valuecount(rast raster, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, searchvalues double precision[] DEFAULT NULL::double precision[], roundto double precision DEFAULT 0, OUT value double precision, OUT count integer, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_valueCount$function$
;

CREATE OR REPLACE FUNCTION public._st_valuecount(rastertable text, rastercolumn text, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, searchvalues double precision[] DEFAULT NULL::double precision[], roundto double precision DEFAULT 0, OUT value double precision, OUT count integer, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE c
 STABLE
AS '$libdir/postgis_raster-3', $function$RASTER_valueCountCoverage$function$
;

CREATE OR REPLACE FUNCTION public._st_voronoi(g1 geometry, clip geometry DEFAULT NULL::geometry, tolerance double precision DEFAULT 0.0, return_polygons boolean DEFAULT true)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 5000
AS '$libdir/postgis-3', $function$ST_Voronoi$function$
;

CREATE OR REPLACE FUNCTION public._st_within(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$SELECT public._ST_Contains($2,$1)$function$
;

CREATE OR REPLACE FUNCTION public._st_within(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT public._st_contains($3, $4, $1, $2) $function$
;

CREATE OR REPLACE FUNCTION public._st_worldtorastercoord(rast raster, longitude double precision DEFAULT NULL::double precision, latitude double precision DEFAULT NULL::double precision, OUT columnx integer, OUT rowy integer)
 RETURNS record
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_worldToRasterCoord$function$
;

CREATE OR REPLACE FUNCTION public._trsp(text, text, anyarray, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE c
AS '$libdir/libpgrouting-3.8', $function$_trsp$function$
;

-- Function: _trsp
-- Comment: pgRouting internal function deprecated on v3.4.0
-- 
CREATE OR REPLACE FUNCTION public._updaterastersrid(schema_name name, table_name name, column_name name, new_srid integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
	DECLARE
		fqtn text;
		schema name;
		sql text;
		srid integer;
		ct boolean;
	BEGIN
		schema := NULL;
		IF length($1) > 0 THEN
			sql := 'SELECT nspname FROM pg_namespace '
				|| 'WHERE nspname = ' || quote_literal($1)
				|| 'LIMIT 1';
			EXECUTE sql INTO schema;
			IF schema IS NULL THEN
				RAISE EXCEPTION 'The value provided for schema is invalid';
				RETURN FALSE;
			END IF;
		END IF;
		IF schema IS NULL THEN
			sql := 'SELECT n.nspname AS schemaname '
				|| 'FROM pg_catalog.pg_class c '
				|| 'JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace '
				|| 'WHERE c.relkind = ' || quote_literal('r')
				|| ' AND n.nspname NOT IN (' || quote_literal('pg_catalog')
				|| ', ' || quote_literal('pg_toast')
				|| ') AND pg_catalog.pg_table_is_visible(c.oid)'
				|| ' AND c.relname = ' || quote_literal($2);
			EXECUTE sql INTO schema;
			IF schema IS NULL THEN
				RAISE EXCEPTION 'The table % does not occur in the search_path', quote_literal($2);
				RETURN FALSE;
			END IF;
		END IF;
		IF new_srid < 0 THEN
			srid :=  public.ST_SRID('POINT EMPTY'::public.geometry);
			RAISE NOTICE 'SRID % converted to the officially unknown SRID %', new_srid, srid;
		ELSE
			srid := new_srid;
		END IF;
		ct := public._raster_constraint_info_coverage_tile(schema, $2, $3);
		IF ct IS TRUE THEN
			PERFORM  public._drop_raster_constraint_coverage_tile(schema, $2, $3);
		END IF;
		PERFORM  public.DropRasterConstraints(schema, $2, $3, 'extent', 'alignment', 'srid');
		fqtn := '';
		IF length($1) > 0 THEN
			fqtn := quote_ident($1) || '.';
		END IF;
		fqtn := fqtn || quote_ident($2);
		sql := 'UPDATE ' || fqtn ||
			' SET ' || quote_ident($3) ||
			' =  public.ST_SetSRID(' || quote_ident($3) ||
			'::public.raster, ' || srid || ')';
		RAISE NOTICE 'sql = %', sql;
		EXECUTE sql;
		PERFORM  public.AddRasterConstraints(schema, $2, $3, 'srid', 'extent', 'alignment');
		IF ct IS TRUE THEN
			PERFORM  public._add_raster_constraint_coverage_tile(schema, $2, $3);
		END IF;
		RETURN TRUE;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public._v4trsp(text, text, text, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
  SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
  FROM _pgr_trspv4( $1, $2, $3, $4);
$function$
;

-- Function: _v4trsp
-- Comment: pgRouting internal function deprecated on v3.6.0
-- 
CREATE OR REPLACE FUNCTION public._v4trsp(text, text, anyarray, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
  SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
  FROM _pgr_trspv4( $1, $2, $3, $4, $5);
$function$
;

-- Function: _v4trsp
-- Comment: pgRouting internal function deprecated on v3.6.0
-- 
CREATE OR REPLACE FUNCTION public.addgeometrycolumn(table_name character varying, column_name character varying, new_srid integer, new_type character varying, new_dim integer, use_typmod boolean DEFAULT true)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
	ret  text;
BEGIN
	SELECT public.AddGeometryColumn('','',$1,$2,$3,$4,$5, $6) into ret;
	RETURN ret;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.addgeometrycolumn(schema_name character varying, table_name character varying, column_name character varying, new_srid integer, new_type character varying, new_dim integer, use_typmod boolean DEFAULT true)
 RETURNS text
 LANGUAGE plpgsql
 STABLE STRICT
AS $function$
DECLARE
	ret  text;
BEGIN
	SELECT public.AddGeometryColumn('',$1,$2,$3,$4,$5,$6,$7) into ret;
	RETURN ret;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.addgeometrycolumn(catalog_name character varying, schema_name character varying, table_name character varying, column_name character varying, new_srid_in integer, new_type character varying, new_dim integer, use_typmod boolean DEFAULT true)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
	rec RECORD;
	sr varchar;
	real_schema name;
	sql text;
	new_srid integer;
BEGIN
	IF (postgis_type_name(new_type,new_dim) IS NULL )
	THEN
		RAISE EXCEPTION 'Invalid type name "%(%)" - valid ones are:
	POINT, MULTIPOINT,
	LINESTRING, MULTILINESTRING,
	POLYGON, MULTIPOLYGON,
	CIRCULARSTRING, COMPOUNDCURVE, MULTICURVE,
	CURVEPOLYGON, MULTISURFACE,
	GEOMETRY, GEOMETRYCOLLECTION,
	POINTM, MULTIPOINTM,
	LINESTRINGM, MULTILINESTRINGM,
	POLYGONM, MULTIPOLYGONM,
	CIRCULARSTRINGM, COMPOUNDCURVEM, MULTICURVEM
	CURVEPOLYGONM, MULTISURFACEM, TRIANGLE, TRIANGLEM,
	POLYHEDRALSURFACE, POLYHEDRALSURFACEM, TIN, TINM
	or GEOMETRYCOLLECTIONM', new_type, new_dim;
		RETURN 'fail';
	END IF;
	IF ( (new_dim >4) OR (new_dim <2) ) THEN
		RAISE EXCEPTION 'invalid dimension';
		RETURN 'fail';
	END IF;
	IF ( (new_type LIKE '%M') AND (new_dim!=3) ) THEN
		RAISE EXCEPTION 'TypeM needs 3 dimensions';
		RETURN 'fail';
	END IF;
	IF ( new_srid_in > 0 ) THEN
		IF new_srid_in > 998999 THEN
			RAISE EXCEPTION 'AddGeometryColumn() - SRID must be <= %', 998999;
		END IF;
		new_srid := new_srid_in;
		SELECT SRID INTO sr FROM public.spatial_ref_sys WHERE SRID = new_srid;
		IF NOT FOUND THEN
			RAISE EXCEPTION 'AddGeometryColumn() - invalid SRID';
			RETURN 'fail';
		END IF;
	ELSE
		new_srid := public.ST_SRID('POINT EMPTY'::public.geometry);
		IF ( new_srid_in != new_srid ) THEN
			RAISE NOTICE 'SRID value % converted to the officially unknown SRID value %', new_srid_in, new_srid;
		END IF;
	END IF;
	IF ( schema_name IS NOT NULL AND schema_name != '' ) THEN
		sql := 'SELECT nspname FROM pg_namespace ' ||
			'WHERE text(nspname) = ' || quote_literal(schema_name) ||
			'LIMIT 1';
		RAISE DEBUG '%', sql;
		EXECUTE sql INTO real_schema;
		IF ( real_schema IS NULL ) THEN
			RAISE EXCEPTION 'Schema % is not a valid schemaname', quote_literal(schema_name);
			RETURN 'fail';
		END IF;
	END IF;
	IF ( real_schema IS NULL ) THEN
		RAISE DEBUG 'Detecting schema';
		sql := 'SELECT n.nspname AS schemaname ' ||
			'FROM pg_catalog.pg_class c ' ||
			  'JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace ' ||
			'WHERE c.relkind = ' || quote_literal('r') ||
			' AND n.nspname NOT IN (' || quote_literal('pg_catalog') || ', ' || quote_literal('pg_toast') || ')' ||
			' AND pg_catalog.pg_table_is_visible(c.oid)' ||
			' AND c.relname = ' || quote_literal(table_name);
		RAISE DEBUG '%', sql;
		EXECUTE sql INTO real_schema;
		IF ( real_schema IS NULL ) THEN
			RAISE EXCEPTION 'Table % does not occur in the search_path', quote_literal(table_name);
			RETURN 'fail';
		END IF;
	END IF;
	IF use_typmod THEN
		 sql := 'ALTER TABLE ' ||
			quote_ident(real_schema) || '.' || quote_ident(table_name)
			|| ' ADD COLUMN ' || quote_ident(column_name) ||
			' geometry(' || public.postgis_type_name(new_type, new_dim) || ', ' || new_srid::text || ')';
		RAISE DEBUG '%', sql;
	ELSE
		sql := 'ALTER TABLE ' ||
			quote_ident(real_schema) || '.' || quote_ident(table_name)
			|| ' ADD COLUMN ' || quote_ident(column_name) ||
			' geometry ';
		RAISE DEBUG '%', sql;
	END IF;
	EXECUTE sql;
	IF NOT use_typmod THEN
		sql := 'ALTER TABLE ' ||
			quote_ident(real_schema) || '.' || quote_ident(table_name)
			|| ' ADD CONSTRAINT '
			|| quote_ident('enforce_srid_' || column_name)
			|| ' CHECK (st_srid(' || quote_ident(column_name) ||
			') = ' || new_srid::text || ')' ;
		RAISE DEBUG '%', sql;
		EXECUTE sql;
		sql := 'ALTER TABLE ' ||
			quote_ident(real_schema) || '.' || quote_ident(table_name)
			|| ' ADD CONSTRAINT '
			|| quote_ident('enforce_dims_' || column_name)
			|| ' CHECK (st_ndims(' || quote_ident(column_name) ||
			') = ' || new_dim::text || ')' ;
		RAISE DEBUG '%', sql;
		EXECUTE sql;
		IF ( NOT (new_type = 'GEOMETRY')) THEN
			sql := 'ALTER TABLE ' ||
				quote_ident(real_schema) || '.' || quote_ident(table_name) || ' ADD CONSTRAINT ' ||
				quote_ident('enforce_geotype_' || column_name) ||
				' CHECK (GeometryType(' ||
				quote_ident(column_name) || ')=' ||
				quote_literal(new_type) || ' OR (' ||
				quote_ident(column_name) || ') is null)';
			RAISE DEBUG '%', sql;
			EXECUTE sql;
		END IF;
	END IF;
	RETURN
		real_schema || '.' ||
		table_name || '.' || column_name ||
		' SRID:' || new_srid::text ||
		' TYPE:' || new_type ||
		' DIMS:' || new_dim::text || ' ';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.addoverviewconstraints(ovschema name, ovtable name, ovcolumn name, refschema name, reftable name, refcolumn name, ovfactor integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		x int;
		s name;
		t name;
		oschema name;
		rschema name;
		sql text;
		rtn boolean;
	BEGIN
		FOR x IN 1..2 LOOP
			s := '';
			IF x = 1 THEN
				s := $1;
				t := $2;
			ELSE
				s := $4;
				t := $5;
			END IF;
			IF length(s) > 0 THEN
				sql := 'SELECT nspname FROM pg_namespace '
					|| 'WHERE nspname = ' || quote_literal(s)
					|| 'LIMIT 1';
				EXECUTE sql INTO s;
				IF s IS NULL THEN
					RAISE EXCEPTION 'The value % is not a valid schema', quote_literal(s);
					RETURN FALSE;
				END IF;
			END IF;
			IF length(s) < 1 THEN
				sql := 'SELECT n.nspname AS schemaname '
					|| 'FROM pg_catalog.pg_class c '
					|| 'JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace '
					|| 'WHERE c.relkind = ' || quote_literal('r')
					|| ' AND n.nspname NOT IN (' || quote_literal('pg_catalog')
					|| ', ' || quote_literal('pg_toast')
					|| ') AND pg_catalog.pg_table_is_visible(c.oid)'
					|| ' AND c.relname = ' || quote_literal(t);
				EXECUTE sql INTO s;
				IF s IS NULL THEN
					RAISE EXCEPTION 'The table % does not occur in the search_path', quote_literal(t);
					RETURN FALSE;
				END IF;
			END IF;
			IF x = 1 THEN
				oschema := s;
			ELSE
				rschema := s;
			END IF;
		END LOOP;
		rtn :=  public._add_overview_constraint(oschema, $2, $3, rschema, $5, $6, $7);
		IF rtn IS FALSE THEN
			RAISE EXCEPTION 'Unable to add the overview constraint.  Is the schema name, table name or column name incorrect?';
			RETURN FALSE;
		END IF;
		RETURN TRUE;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.addoverviewconstraints(ovtable name, ovcolumn name, reftable name, refcolumn name, ovfactor integer)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT  public.AddOverviewConstraints('', $1, $2, '', $3, $4, $5) $function$
;

CREATE OR REPLACE FUNCTION public.addrasterconstraints(rastschema name, rasttable name, rastcolumn name, VARIADIC constraints text[])
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		max int;
		cnt int;
		sql text;
		schema name;
		x int;
		kw text;
		rtn boolean;
	BEGIN
		cnt := 0;
		max := array_length(constraints, 1);
		IF max < 1 THEN
			RAISE NOTICE 'No constraints indicated to be added.  Doing nothing';
			RETURN TRUE;
		END IF;
		schema := NULL;
		IF length($1) > 0 THEN
			sql := 'SELECT nspname FROM pg_namespace '
				|| 'WHERE nspname = ' || quote_literal($1)
				|| 'LIMIT 1';
			EXECUTE sql INTO schema;
			IF schema IS NULL THEN
				RAISE EXCEPTION 'The value provided for schema is invalid';
				RETURN FALSE;
			END IF;
		END IF;
		IF schema IS NULL THEN
			sql := 'SELECT n.nspname AS schemaname '
				|| 'FROM pg_catalog.pg_class c '
				|| 'JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace '
				|| 'WHERE c.relkind = ' || quote_literal('r')
				|| ' AND n.nspname NOT IN (' || quote_literal('pg_catalog')
				|| ', ' || quote_literal('pg_toast')
				|| ') AND pg_catalog.pg_table_is_visible(c.oid)'
				|| ' AND c.relname = ' || quote_literal($2);
			EXECUTE sql INTO schema;
			IF schema IS NULL THEN
				RAISE EXCEPTION 'The table % does not occur in the search_path', quote_literal($2);
				RETURN FALSE;
			END IF;
		END IF;
		<<kwloop>>
		FOR x in 1..max LOOP
			kw := trim(both from lower(constraints[x]));
			BEGIN
				CASE
					WHEN kw = 'srid' THEN
						RAISE NOTICE 'Adding SRID constraint';
						rtn :=  public._add_raster_constraint_srid(schema, $2, $3);
					WHEN kw IN ('scale_x', 'scalex') THEN
						RAISE NOTICE 'Adding scale-X constraint';
						rtn :=  public._add_raster_constraint_scale(schema, $2, $3, 'x');
					WHEN kw IN ('scale_y', 'scaley') THEN
						RAISE NOTICE 'Adding scale-Y constraint';
						rtn :=  public._add_raster_constraint_scale(schema, $2, $3, 'y');
					WHEN kw = 'scale' THEN
						RAISE NOTICE 'Adding scale-X constraint';
						rtn :=  public._add_raster_constraint_scale(schema, $2, $3, 'x');
						RAISE NOTICE 'Adding scale-Y constraint';
						rtn :=  public._add_raster_constraint_scale(schema, $2, $3, 'y');
					WHEN kw IN ('blocksize_x', 'blocksizex', 'width') THEN
						RAISE NOTICE 'Adding blocksize-X constraint';
						rtn :=  public._add_raster_constraint_blocksize(schema, $2, $3, 'width');
					WHEN kw IN ('blocksize_y', 'blocksizey', 'height') THEN
						RAISE NOTICE 'Adding blocksize-Y constraint';
						rtn :=  public._add_raster_constraint_blocksize(schema, $2, $3, 'height');
					WHEN kw = 'blocksize' THEN
						RAISE NOTICE 'Adding blocksize-X constraint';
						rtn :=  public._add_raster_constraint_blocksize(schema, $2, $3, 'width');
						RAISE NOTICE 'Adding blocksize-Y constraint';
						rtn :=  public._add_raster_constraint_blocksize(schema, $2, $3, 'height');
					WHEN kw IN ('same_alignment', 'samealignment', 'alignment') THEN
						RAISE NOTICE 'Adding alignment constraint';
						rtn :=  public._add_raster_constraint_alignment(schema, $2, $3);
					WHEN kw IN ('regular_blocking', 'regularblocking') THEN
						RAISE NOTICE 'Adding coverage tile constraint required for regular blocking';
						rtn :=  public._add_raster_constraint_coverage_tile(schema, $2, $3);
						IF rtn IS NOT FALSE THEN
							RAISE NOTICE 'Adding spatially unique constraint required for regular blocking';
							rtn :=  public._add_raster_constraint_spatially_unique(schema, $2, $3);
						END IF;
					WHEN kw IN ('num_bands', 'numbands') THEN
						RAISE NOTICE 'Adding number of bands constraint';
						rtn :=  public._add_raster_constraint_num_bands(schema, $2, $3);
					WHEN kw IN ('pixel_types', 'pixeltypes') THEN
						RAISE NOTICE 'Adding pixel type constraint';
						rtn :=  public._add_raster_constraint_pixel_types(schema, $2, $3);
					WHEN kw IN ('nodata_values', 'nodatavalues', 'nodata') THEN
						RAISE NOTICE 'Adding nodata value constraint';
						rtn :=  public._add_raster_constraint_nodata_values(schema, $2, $3);
					WHEN kw IN ('out_db', 'outdb') THEN
						RAISE NOTICE 'Adding out-of-database constraint';
						rtn :=  public._add_raster_constraint_out_db(schema, $2, $3);
					WHEN kw = 'extent' THEN
						RAISE NOTICE 'Adding maximum extent constraint';
						rtn :=  public._add_raster_constraint_extent(schema, $2, $3);
					ELSE
						RAISE NOTICE 'Unknown constraint: %.  Skipping', quote_literal(constraints[x]);
						CONTINUE kwloop;
				END CASE;
			END;
			IF rtn IS FALSE THEN
				cnt := cnt + 1;
				RAISE WARNING 'Unable to add constraint: %.  Skipping', quote_literal(constraints[x]);
			END IF;
		END LOOP kwloop;
		IF cnt = max THEN
			RAISE EXCEPTION 'None of the constraints specified could be added.  Is the schema name, table name or column name incorrect?';
			RETURN FALSE;
		END IF;
		RETURN TRUE;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.addrasterconstraints(rasttable name, rastcolumn name, VARIADIC constraints text[])
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT public.AddRasterConstraints('', $1, $2, VARIADIC $3) $function$
;

CREATE OR REPLACE FUNCTION public.addrasterconstraints(rasttable name, rastcolumn name, srid boolean DEFAULT true, scale_x boolean DEFAULT true, scale_y boolean DEFAULT true, blocksize_x boolean DEFAULT true, blocksize_y boolean DEFAULT true, same_alignment boolean DEFAULT true, regular_blocking boolean DEFAULT false, num_bands boolean DEFAULT true, pixel_types boolean DEFAULT true, nodata_values boolean DEFAULT true, out_db boolean DEFAULT true, extent boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT public.AddRasterConstraints('', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) $function$
;

CREATE OR REPLACE FUNCTION public.addrasterconstraints(rastschema name, rasttable name, rastcolumn name, srid boolean DEFAULT true, scale_x boolean DEFAULT true, scale_y boolean DEFAULT true, blocksize_x boolean DEFAULT true, blocksize_y boolean DEFAULT true, same_alignment boolean DEFAULT true, regular_blocking boolean DEFAULT false, num_bands boolean DEFAULT true, pixel_types boolean DEFAULT true, nodata_values boolean DEFAULT true, out_db boolean DEFAULT true, extent boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		constraints text[];
	BEGIN
		IF srid IS TRUE THEN
			constraints := constraints || 'srid'::text;
		END IF;
		IF scale_x IS TRUE THEN
			constraints := constraints || 'scale_x'::text;
		END IF;
		IF scale_y IS TRUE THEN
			constraints := constraints || 'scale_y'::text;
		END IF;
		IF blocksize_x IS TRUE THEN
			constraints := constraints || 'blocksize_x'::text;
		END IF;
		IF blocksize_y IS TRUE THEN
			constraints := constraints || 'blocksize_y'::text;
		END IF;
		IF same_alignment IS TRUE THEN
			constraints := constraints || 'same_alignment'::text;
		END IF;
		IF regular_blocking IS TRUE THEN
			constraints := constraints || 'regular_blocking'::text;
		END IF;
		IF num_bands IS TRUE THEN
			constraints := constraints || 'num_bands'::text;
		END IF;
		IF pixel_types IS TRUE THEN
			constraints := constraints || 'pixel_types'::text;
		END IF;
		IF nodata_values IS TRUE THEN
			constraints := constraints || 'nodata_values'::text;
		END IF;
		IF out_db IS TRUE THEN
			constraints := constraints || 'out_db'::text;
		END IF;
		IF extent IS TRUE THEN
			constraints := constraints || 'extent'::text;
		END IF;
		RETURN public.AddRasterConstraints($1, $2, $3, VARIADIC constraints);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.auto_calculate_bbox()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.geometry IS NOT NULL AND 
     (NEW.bbox_min_lng IS NULL OR NEW.bbox_max_lng IS NULL OR 
      NEW.bbox_min_lat IS NULL OR NEW.bbox_max_lat IS NULL) THEN
    NEW.bbox_min_lng := ST_XMin(NEW.geometry);
    NEW.bbox_max_lng := ST_XMax(NEW.geometry);
    NEW.bbox_min_lat := ST_YMin(NEW.geometry);
    NEW.bbox_max_lat := ST_YMax(NEW.geometry);
  END IF;
  RETURN NEW;
END;
$function$
;

-- Function: auto_calculate_bbox
-- Comment: Automatically calculates bounding box from geometry
-- 
CREATE OR REPLACE FUNCTION public.auto_calculate_length()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.geometry IS NOT NULL AND (NEW.length_km IS NULL OR NEW.length_km <= 0) THEN
    NEW.length_km := ST_Length(NEW.geometry, true) / 1000.0; -- Convert meters to kilometers
  END IF;
  RETURN NEW;
END;
$function$
;

-- Function: auto_calculate_length
-- Comment: Automatically calculates trail length from geometry
-- 
CREATE OR REPLACE FUNCTION public.box(box3d)
 RETURNS box
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$BOX3D_to_BOX$function$
;

CREATE OR REPLACE FUNCTION public.box(geometry)
 RETURNS box
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_to_BOX$function$
;

CREATE OR REPLACE FUNCTION public.box2d(geometry)
 RETURNS box2d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_to_BOX2D$function$
;

CREATE OR REPLACE FUNCTION public.box2d(box3d)
 RETURNS box2d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$BOX3D_to_BOX2D$function$
;

CREATE OR REPLACE FUNCTION public.box2d_in(cstring)
 RETURNS box2d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$BOX2D_in$function$
;

CREATE OR REPLACE FUNCTION public.box2d_out(box2d)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$BOX2D_out$function$
;

CREATE OR REPLACE FUNCTION public.box2df_in(cstring)
 RETURNS box2df
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$box2df_in$function$
;

CREATE OR REPLACE FUNCTION public.box2df_out(box2df)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$box2df_out$function$
;

CREATE OR REPLACE FUNCTION public.box3d(raster)
 RETURNS box3d
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select box3d( public.ST_convexhull($1))$function$
;

CREATE OR REPLACE FUNCTION public.box3d(box2d)
 RETURNS box3d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$BOX2D_to_BOX3D$function$
;

CREATE OR REPLACE FUNCTION public.box3d(geometry)
 RETURNS box3d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_to_BOX3D$function$
;

CREATE OR REPLACE FUNCTION public.box3d_in(cstring)
 RETURNS box3d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$BOX3D_in$function$
;

CREATE OR REPLACE FUNCTION public.box3d_out(box3d)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$BOX3D_out$function$
;

CREATE OR REPLACE FUNCTION public.box3dtobox(box3d)
 RETURNS box
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$BOX3D_to_BOX$function$
;

CREATE OR REPLACE FUNCTION public.build_routing_nodes_with_trail_ids(staging_schema text, trails_table text, intersection_tolerance_meters double precision DEFAULT 2.0)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    node_count integer;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Insert routing nodes using optimized PostGIS spatial functions with trail_ids
    EXECUTE format('
        INSERT INTO %I.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids)
        WITH trail_endpoints AS (
            -- Extract start and end points of all trails using PostGIS functions
            -- Preserve 3D geometry by removing ST_Force2D()
            SELECT 
                ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point,
                app_uuid,
                name
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        intersection_points AS (
            -- Use the enhanced intersection detection function
            SELECT 
                intersection_point,
                intersection_point_3d,
                connected_trail_ids,
                connected_trail_names,
                node_type,
                distance_meters
            FROM detect_trail_intersections(''%I'', ''%I'', GREATEST($1, 0.001))
            WHERE array_length(connected_trail_ids, 1) > 1  -- Only true intersections
        ),
        all_nodes AS (
            -- Combine intersection points and trail endpoints
            SELECT 
                intersection_point as point,
                intersection_point_3d as point_3d,
                unnest(connected_trail_names) as connected_trail,
                connected_trail_ids as trail_ids,
                ''intersection'' as node_type
            FROM intersection_points
            
            UNION ALL
            
            -- Trail start points
            SELECT 
                start_point as point,
                ST_Force3D(start_point) as point_3d,
                name as connected_trail,
                ARRAY[app_uuid] as trail_ids,
                ''endpoint'' as node_type
            FROM trail_endpoints
            
            UNION ALL
            
            -- Trail end points
            SELECT 
                end_point as point,
                ST_Force3D(end_point) as point_3d,
                name as connected_trail,
                ARRAY[app_uuid] as trail_ids,
                ''endpoint'' as node_type
            FROM trail_endpoints
        ),
        grouped_nodes AS (
            -- Group nearby nodes to avoid duplicates using spatial clustering
            SELECT 
                ST_X(point) as lng,
                ST_Y(point) as lat,
                COALESCE(ST_Z(point_3d), 0) as elevation,
                array_agg(DISTINCT connected_trail) as all_connected_trails,
                array_agg(DISTINCT unnest(trail_ids)) as all_trail_ids,
                CASE 
                    WHEN array_length(array_agg(DISTINCT connected_trail), 1) > 1 THEN ''intersection''
                    ELSE ''endpoint''
                END as node_type,
                point,
                point_3d
            FROM all_nodes
            GROUP BY point, point_3d
        ),
        final_nodes AS (
            -- Remove duplicate nodes within tolerance distance
            SELECT DISTINCT ON (ST_SnapToGrid(point, GREATEST($1, 0.001)/1000))
                lng,
                lat,
                elevation,
                all_connected_trails,
                all_trail_ids,
                node_type
            FROM grouped_nodes
            ORDER BY ST_SnapToGrid(point, GREATEST($1, 0.001)/1000), array_length(all_connected_trails, 1) DESC
        )
        SELECT 
            gen_random_uuid()::text as node_uuid,
            lat,
            lng,
            elevation,
            node_type,
            array_to_string(all_connected_trails, '','') as connected_trails,
            all_trail_ids as trail_ids
        FROM final_nodes
        WHERE array_length(all_connected_trails, 1) > 0
    ', staging_schema, staging_schema, trails_table, staging_schema, trails_table)
    USING intersection_tolerance_meters;
    
    -- Get the count of inserted nodes
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    
    RETURN node_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.bytea(geography)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_to_bytea$function$
;

CREATE OR REPLACE FUNCTION public.bytea(raster)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_to_bytea$function$
;

CREATE OR REPLACE FUNCTION public.bytea(geometry)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_to_bytea$function$
;

CREATE OR REPLACE FUNCTION public.calculate_route_connectivity_score(trail_count integer, route_distance_km real)
 RETURNS real
 LANGUAGE plpgsql
AS $function$
DECLARE
    connectivity_score REAL;
BEGIN
    IF trail_count IS NULL OR route_distance_km IS NULL OR route_distance_km <= 0 THEN
        RETURN NULL;
    END IF;
    connectivity_score := trail_count::REAL / route_distance_km;
    connectivity_score := LEAST(1.0, connectivity_score / 5.0);
    RETURN connectivity_score;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_route_cost(steepness_m_per_km double precision, distance_km double precision)
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
DECLARE
    weights json;
BEGIN
    weights := get_cost_weights();
    RETURN (steepness_m_per_km * (weights ->> 'steepness_weight')::float) + 
           (distance_km * (weights ->> 'distance_weight')::float);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_route_difficulty(elevation_gain_rate real)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF elevation_gain_rate IS NULL THEN
        RETURN NULL;
    END IF;
    IF elevation_gain_rate < 50 THEN
        RETURN 'easy';
    ELSIF elevation_gain_rate < 100 THEN
        RETURN 'moderate';
    ELSIF elevation_gain_rate < 150 THEN
        RETURN 'hard';
    ELSE
        RETURN 'expert';
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_route_elevation_stats(route_edges_json jsonb)
 RETURNS TABLE(min_elevation real, max_elevation real, avg_elevation real)
 LANGUAGE plpgsql
AS $function$
DECLARE
    edge_record RECORD;
    min_elev REAL := 9999;
    max_elev REAL := -9999;
    total_elev REAL := 0;
    edge_count INTEGER := 0;
BEGIN
    FOR edge_record IN 
        SELECT 
            (edge->>'min_elevation')::REAL as min_elev,
            (edge->>'max_elevation')::REAL as max_elev,
            (edge->>'avg_elevation')::REAL as avg_elev
        FROM jsonb_array_elements(route_edges_json) as edge
        WHERE edge->>'min_elevation' IS NOT NULL
          AND edge->>'max_elevation' IS NOT NULL
          AND edge->>'avg_elevation' IS NOT NULL
    LOOP
        IF edge_record.min_elev < min_elev THEN
            min_elev := edge_record.min_elev;
        END IF;
        IF edge_record.max_elev > max_elev THEN
            max_elev := edge_record.max_elev;
        END IF;
        total_elev := total_elev + edge_record.avg_elev;
        edge_count := edge_count + 1;
    END LOOP;
    IF edge_count = 0 THEN
        RETURN QUERY SELECT NULL::REAL, NULL::REAL, NULL::REAL;
        RETURN;
    END IF;
    RETURN QUERY SELECT 
        CASE WHEN min_elev = 9999 THEN NULL ELSE min_elev END,
        CASE WHEN max_elev = -9999 THEN NULL ELSE max_elev END,
        total_elev / edge_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_route_estimated_time(distance_km real, elevation_gain_rate real)
 RETURNS real
 LANGUAGE plpgsql
AS $function$
DECLARE
    base_speed_kmh REAL := 4.0; -- Base hiking speed on flat terrain
    elevation_factor REAL;
    estimated_hours REAL;
BEGIN
    IF distance_km IS NULL OR distance_km <= 0 THEN
        RETURN NULL;
    END IF;
    IF elevation_gain_rate IS NULL OR elevation_gain_rate < 50 THEN
        elevation_factor := 1.0; -- No penalty for easy terrain
    ELSIF elevation_gain_rate < 100 THEN
        elevation_factor := 0.8; -- 20% slower for moderate terrain
    ELSIF elevation_gain_rate < 150 THEN
        elevation_factor := 0.6; -- 40% slower for hard terrain
    ELSE
        elevation_factor := 0.4; -- 60% slower for expert terrain
    END IF;
    estimated_hours := distance_km / (base_speed_kmh * elevation_factor);
    RETURN GREATEST(0.5, LEAST(24.0, estimated_hours));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_route_gain_rate(route_distance_km real, route_elevation_gain real)
 RETURNS real
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF route_distance_km IS NULL OR route_distance_km <= 0 THEN
        RETURN NULL;
    END IF;
    IF route_elevation_gain IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN route_elevation_gain / route_distance_km;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_route_parametric_metrics(route_distance_km real, route_elevation_gain real, route_trail_count integer, route_edges_json jsonb)
 RETURNS TABLE(elevation_gain_rate real, difficulty text, estimated_time_hours real, connectivity_score real, min_elevation real, max_elevation real, avg_elevation real)
 LANGUAGE plpgsql
AS $function$
DECLARE
    gain_rate REAL;
    route_difficulty TEXT;
    estimated_time REAL;
    connectivity REAL;
    elevation_stats RECORD;
BEGIN
    gain_rate := calculate_route_gain_rate(route_distance_km, route_elevation_gain);
    route_difficulty := calculate_route_difficulty(gain_rate);
    estimated_time := calculate_route_estimated_time(route_distance_km, gain_rate);
    connectivity := calculate_route_connectivity_score(route_trail_count, route_distance_km);
    SELECT * INTO elevation_stats FROM calculate_route_elevation_stats(route_edges_json);
    RETURN QUERY SELECT 
        gain_rate,
        route_difficulty,
        estimated_time,
        connectivity,
        elevation_stats.min_elevation,
        elevation_stats.max_elevation,
        elevation_stats.avg_elevation;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_route_similarity_score(actual_distance_km double precision, target_distance_km double precision, actual_elevation_gain double precision, target_elevation_gain double precision)
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Simple similarity score based on how close we are to target
    RETURN GREATEST(0, 1 - ABS(actual_distance_km - target_distance_km) / target_distance_km);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_trail_stats()
 RETURNS TABLE(total_trails bigint, total_length_km double precision, avg_elevation_gain double precision, regions_count bigint)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_trails,
        COALESCE(SUM(length_km), 0) as total_length_km,
        COALESCE(AVG(elevation_gain), 0) as avg_elevation_gain,
        COUNT(DISTINCT region) as regions_count
    FROM trails;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_database_integrity()
 RETURNS TABLE(check_name text, status text, count bigint, details text)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    'Incomplete Trails'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
    COUNT(*),
    'Trails missing required data'::TEXT
  FROM incomplete_trails;
  RETURN QUERY
  SELECT 
    '2D Geometries'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END::TEXT,
    COUNT(*),
    'Trails with 2D geometry (should be 3D)'::TEXT
  FROM trails_with_2d_geometry;
  RETURN QUERY
  SELECT 
    'Invalid Geometries'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
    COUNT(*),
    'Trails with invalid geometry'::TEXT
  FROM invalid_geometries;
  RETURN QUERY
  SELECT 
    'Inconsistent Elevation'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
    COUNT(*),
    'Trails with inconsistent elevation data'::TEXT
  FROM inconsistent_elevation_data;
  RETURN QUERY
  SELECT 
    'Orphaned Routing Edges'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
    COUNT(*),
    'Routing edges referencing non-existent trails'::TEXT
  FROM routing_edges re
  WHERE NOT EXISTS (SELECT 1 FROM trails t WHERE t.app_uuid = re.trail_id);
END;
$function$
;

-- Function: check_database_integrity
-- Comment: Comprehensive database integrity check
-- 
CREATE OR REPLACE FUNCTION public.cleanup_orphaned_nodes(staging_schema text)
 RETURNS TABLE(success boolean, message text, cleaned_nodes integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
    orphaned_nodes_count integer := 0;
    total_nodes_before integer := 0;
    total_nodes_after integer := 0;
BEGIN
    -- Get count before cleanup
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO total_nodes_before;

    -- Remove orphaned nodes (nodes not connected to any trails)
    -- These are nodes that were created but don't actually connect any trail segments
    EXECUTE format($f$
        DELETE FROM %I.routing_nodes n
        WHERE NOT EXISTS (
            SELECT 1 FROM %I.trails t
            WHERE ST_DWithin(
                ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326),
                t.geometry,
                0.001
            )
        )
    $f$, staging_schema, staging_schema);

    GET DIAGNOSTICS orphaned_nodes_count = ROW_COUNT;

    -- Get count after cleanup
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO total_nodes_after;

    -- Return results
    RETURN QUERY SELECT
        true as success,
        format('Cleaned up %s orphaned nodes (before: %s, after: %s)', 
               orphaned_nodes_count, total_nodes_before, total_nodes_after) as message,
        orphaned_nodes_count as cleaned_nodes;

    RAISE NOTICE 'Cleaned up % orphaned nodes', orphaned_nodes_count;

EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT
        false,
        format('Error during orphaned nodes cleanup: %s', SQLERRM) as message,
        0 as cleaned_nodes;

    RAISE NOTICE 'Error during orphaned nodes cleanup: %', SQLERRM;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_routing_graph(staging_schema text)
 RETURNS TABLE(orphaned_nodes integer, orphaned_edges integer, message text)
 LANGUAGE plpgsql
AS $function$ DECLARE orphaned_nodes_count integer := 0; orphaned_edges_count integer := 0; BEGIN EXECUTE format($f$ DELETE FROM %I.routing_nodes WHERE id NOT IN (SELECT DISTINCT source FROM %I.routing_edges UNION SELECT DISTINCT target FROM %I.routing_edges) $f$, staging_schema, staging_schema, staging_schema, staging_schema); GET DIAGNOSTICS orphaned_nodes_count = ROW_COUNT; EXECUTE format($f$ DELETE FROM %I.routing_edges WHERE source NOT IN (SELECT id FROM %I.routing_nodes) OR target NOT IN (SELECT id FROM %I.routing_nodes) $f$, staging_schema, staging_schema, staging_schema, staging_schema); GET DIAGNOSTICS orphaned_edges_count = ROW_COUNT; RETURN QUERY SELECT orphaned_nodes_count, orphaned_edges_count, format('Cleaned up %s orphaned nodes and %s orphaned edges', orphaned_nodes_count, orphaned_edges_count) as message; END; $function$
;

CREATE OR REPLACE FUNCTION public.contains_2d(box2df, box2df)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_contains_box2df_box2df_2d$function$
;

CREATE OR REPLACE FUNCTION public.contains_2d(geometry, box2df)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 1
AS $function$SELECT $2 OPERATOR(public.@) $1;$function$
;

CREATE OR REPLACE FUNCTION public.contains_2d(box2df, geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_contains_box2df_geom_2d$function$
;

CREATE OR REPLACE FUNCTION public.copy_and_split_trails_to_staging_native(staging_schema text, source_table text, region_filter text, bbox_min_lng real DEFAULT NULL::real, bbox_min_lat real DEFAULT NULL::real, bbox_max_lng real DEFAULT NULL::real, bbox_max_lat real DEFAULT NULL::real, trail_limit integer DEFAULT NULL::integer, tolerance_meters real DEFAULT 1.0)
 RETURNS TABLE(original_count integer, split_count integer, intersection_count integer, success boolean, message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    original_count_var integer := 0;
    split_count_var integer := 0;
    intersection_count_var integer := 0;
    source_query text;
    limit_clause text := '';
BEGIN
    -- Clear existing data
    EXECUTE format('DELETE FROM %I.trails', staging_schema);
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);

    -- Build source query with filters
    source_query := format('SELECT * FROM %I WHERE region = %L', source_table, region_filter);

    -- Add bbox filter if provided
    IF bbox_min_lng IS NOT NULL AND bbox_min_lat IS NOT NULL AND bbox_max_lng IS NOT NULL AND bbox_max_lat IS NOT NULL THEN
        source_query := source_query || format(' AND ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))', bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat);
    END IF;

    -- Add limit
    IF trail_limit IS NOT NULL THEN
        limit_clause := format(' LIMIT %s', trail_limit);
    END IF;

    source_query := source_query || limit_clause;

    -- Step 1: Copy and split trails using native PostGIS ST_Split
    EXECUTE format($f$
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
            geometry, created_at, updated_at
        )
        WITH trail_intersections AS (
            SELECT DISTINCT
                t1.app_uuid as trail1_uuid,
                t2.app_uuid as trail2_uuid,
                ST_Intersection(t1.geometry, t2.geometry) as intersection_point
            FROM (%s) t1
            JOIN (%s) t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ),
        all_trails AS (
            SELECT
                id, app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
                bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                source, created_at, updated_at, geometry
            FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        ),
        trails_with_intersections AS (
            SELECT
                at.id, at.app_uuid, at.osm_id, at.name, at.region, at.trail_type, at.surface, at.difficulty, at.source_tags,
                at.bbox_min_lng, at.bbox_max_lng, at.bbox_min_lat, at.bbox_max_lat,
                at.length_km, at.elevation_gain, at.elevation_loss, at.max_elevation, at.min_elevation, at.avg_elevation,
                at.source, at.created_at, at.updated_at, at.geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).geom as split_geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).path[1] as segment_order
            FROM all_trails at
            JOIN trail_intersections ti ON at.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
        ),
        trails_without_intersections AS (
            SELECT
                at.id, at.app_uuid, at.osm_id, at.name, at.region, at.trail_type, at.surface, at.difficulty, at.source_tags,
                at.bbox_min_lng, at.bbox_max_lng, at.bbox_min_lat, at.bbox_max_lat,
                at.length_km, at.elevation_gain, at.elevation_loss, at.max_elevation, at.min_elevation, at.avg_elevation,
                at.source, at.created_at, at.updated_at, at.geometry,
                at.geometry as split_geometry,
                1 as segment_order
            FROM all_trails at
            WHERE at.app_uuid NOT IN (
                SELECT DISTINCT trail1_uuid FROM trail_intersections
                UNION
                SELECT DISTINCT trail2_uuid FROM trail_intersections
            )
        ),
        processed_trails AS (
            SELECT * FROM trails_with_intersections
            UNION ALL
            SELECT * FROM trails_without_intersections
        )
        SELECT
            gen_random_uuid() as app_uuid,
            osm_id,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            source_tags,
            ST_XMin(split_geometry) as bbox_min_lng,
            ST_XMax(split_geometry) as bbox_max_lng,
            ST_YMin(split_geometry) as bbox_min_lat,
            ST_YMax(split_geometry) as bbox_max_lat,
            ST_Length(split_geometry::geography) / 1000.0 as length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            split_geometry as geometry,
            NOW() as created_at,
            NOW() as updated_at
        FROM processed_trails pt
        WHERE ST_IsValid(pt.split_geometry)
          AND pt.app_uuid IS NOT NULL
    $f$, staging_schema, source_query, source_query, source_query);

    GET DIAGNOSTICS split_count_var = ROW_COUNT;

    -- Get original count from source query
    EXECUTE format('SELECT COUNT(*) FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)', source_query) INTO original_count_var;

    -- Step 2: Detect intersections between split trail segments
    PERFORM detect_trail_intersections(staging_schema, 'trails', tolerance_meters);

    -- Get intersection count
    EXECUTE format('SELECT COUNT(*) FROM %I.intersection_points', staging_schema) INTO intersection_count_var;

    -- Clear routing data in staging schema since it needs to be regenerated from split trails
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);

    -- Create optimized spatial indexes
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geometry ON %I.trails USING GIST(geometry)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON %I.trails(app_uuid)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_name ON %I.trails(name)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_intersection_points ON %I.intersection_points USING GIST(point)', staging_schema);

    -- Return results
    RETURN QUERY SELECT
        original_count_var,
        split_count_var,
        intersection_count_var,
        true as success,
        format('Successfully copied and split %s trails into %s segments with %s intersections',
               original_count_var, split_count_var, intersection_count_var) as message;

    RAISE NOTICE 'Native PostgreSQL copy and split: % original trails -> % split segments with % intersections',
        original_count_var, split_count_var, intersection_count_var;

EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT
        0, 0, 0, false,
        format('Error during copy and split: %s', SQLERRM) as message;

    RAISE NOTICE 'Error during native PostgreSQL copy and split: %', SQLERRM;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.copy_and_split_trails_to_staging_native_v12(staging_schema text, region_filter text, bbox_min_lng real DEFAULT NULL::real, bbox_min_lat real DEFAULT NULL::real, bbox_max_lng real DEFAULT NULL::real, bbox_max_lat real DEFAULT NULL::real, trail_limit integer DEFAULT NULL::integer, tolerance_meters real DEFAULT 2.0)
 RETURNS TABLE(original_count integer, split_count integer, intersection_count integer, success boolean, message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    original_count_var integer := 0;
    split_count_var integer := 0;
    intersection_count_var integer := 0;
    source_query text;
    limit_clause text := '';
    source_table text := 'trails';  -- Hardcode the source table
    full_sql text;
BEGIN
    -- Debug: Log the parameters we received
    RAISE NOTICE 'Function received parameters: staging_schema=%, region_filter=%', staging_schema, region_filter;
    RAISE NOTICE 'DEBUG: staging_schema=% staging_schema type=%', staging_schema, pg_typeof(staging_schema);
    RAISE NOTICE 'FUNCTION IS BEING CALLED - V12 VERSION';
    
    -- Clear existing data
    EXECUTE format('DELETE FROM %I.trails', staging_schema);
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);
    
    -- Build source query with filters
    source_query := format('SELECT * FROM %I WHERE region = %L', source_table, region_filter);
    
    -- Add bbox filter if provided
    IF bbox_min_lng IS NOT NULL AND bbox_min_lat IS NOT NULL AND bbox_max_lng IS NOT NULL AND bbox_max_lat IS NOT NULL THEN
        source_query := source_query || format(' AND ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))', bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat);
    END IF;
    
    -- Add limit
    IF trail_limit IS NOT NULL THEN
        limit_clause := format(' LIMIT %s', trail_limit);
    END IF;
    
    source_query := source_query || limit_clause;
    
    -- Debug: Log the source_query
    RAISE NOTICE 'Source query: %', source_query;
    
    -- Build the full SQL dynamically to avoid parameter passing issues
    full_sql := format($f$
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
            geometry, created_at, updated_at
        )
        WITH trail_intersections AS (
            -- Find all intersection points between trails using 3D coordinates
            SELECT DISTINCT
                t1.app_uuid as trail1_uuid,
                t2.app_uuid as trail2_uuid,
                ST_Intersection(t1.geometry, t2.geometry) as intersection_point
            FROM (%s) t1
            JOIN (%s) t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ),
        all_trails AS (
            -- Get all source trails
            SELECT 
                id, app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
                bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                source, created_at, updated_at, geometry
            FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        ),
        trails_with_intersections AS (
            -- Get trails that have intersections and split them
            SELECT 
                at.id, at.app_uuid, at.osm_id, at.name, at.region, at.trail_type, at.surface, at.difficulty, at.source_tags,
                at.bbox_min_lng, at.bbox_max_lng, at.bbox_min_lat, at.bbox_max_lat,
                at.length_km, at.elevation_gain, at.elevation_loss, at.max_elevation, at.min_elevation, at.avg_elevation,
                at.source, at.created_at, at.updated_at, at.geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).geom as split_geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).path[1] as segment_order
            FROM all_trails at
            JOIN trail_intersections ti ON at.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
        ),
        trails_without_intersections AS (
            -- Get trails that don't have intersections (keep original geometry)
            SELECT 
                at.id, at.app_uuid, at.osm_id, at.name, at.region, at.trail_type, at.surface, at.difficulty, at.source_tags,
                at.bbox_min_lng, at.bbox_max_lng, at.bbox_min_lat, at.bbox_max_lat,
                at.length_km, at.elevation_gain, at.elevation_loss, at.max_elevation, at.min_elevation, at.avg_elevation,
                at.source, at.created_at, at.updated_at, at.geometry,
                at.geometry as split_geometry,
                1 as segment_order
            FROM all_trails at
            WHERE at.app_uuid NOT IN (
                SELECT DISTINCT trail1_uuid FROM trail_intersections
                UNION
                SELECT DISTINCT trail2_uuid FROM trail_intersections
            )
        ),
        processed_trails AS (
            -- Combine both sets
            SELECT * FROM trails_with_intersections
            UNION ALL
            SELECT * FROM trails_without_intersections
        )
        SELECT 
            gen_random_uuid() as app_uuid,  -- Generate new UUID for ALL segments
            osm_id,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            source_tags,
            ST_XMin(split_geometry) as bbox_min_lng,
            ST_XMax(split_geometry) as bbox_max_lng,
            ST_YMin(split_geometry) as bbox_min_lat,
            ST_YMax(split_geometry) as bbox_max_lat,
            ST_Length(split_geometry::geography) / 1000.0 as length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            split_geometry as geometry,
            NOW() as created_at,
            NOW() as updated_at
        FROM processed_trails pt
        WHERE ST_IsValid(pt.split_geometry)  -- Only include valid geometries
          AND pt.app_uuid IS NOT NULL    -- Ensure app_uuid is not null
    $f$, staging_schema, source_query, source_query, source_query);
    
    -- Debug: Log the full SQL
    RAISE NOTICE 'Full SQL: %', full_sql;
    
    -- Execute the SQL
    EXECUTE full_sql;
    
    GET DIAGNOSTICS split_count_var = ROW_COUNT;
    
    -- Get original count from source query
    EXECUTE format('SELECT COUNT(*) FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)', source_query) INTO original_count_var;
    
    -- Step 2: Detect intersections between split trail segments
    EXECUTE format($f$
        INSERT INTO %I.intersection_points (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT DISTINCT
            ST_Force2D(intersection_point) as point,
            ST_Force3D(intersection_point) as point_3d,
            ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
            ARRAY[t1.name, t2.name] as connected_trail_names,
            'intersection' as node_type,
            $1 as distance_meters
        FROM (
            SELECT 
                (ST_Dump(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)))).geom as intersection_point,
                t1.app_uuid as t1_uuid,
                t2.app_uuid as t2_uuid
            FROM %I.trails t1
            JOIN %I.trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ) AS intersections
    $f$, staging_schema, tolerance_meters, staging_schema, staging_schema);

    GET DIAGNOSTICS intersection_count_var = ROW_COUNT;

    -- Clear routing data in staging schema since it needs to be regenerated from split trails
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);

    -- Create optimized spatial indexes
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geometry ON %I.trails USING GIST(geometry)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON %I.trails(app_uuid)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_name ON %I.trails(name)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_intersection_points ON %I.intersection_points USING GIST(point)', staging_schema);

    -- Return results
    RETURN QUERY SELECT 
        original_count_var,
        split_count_var,
        intersection_count_var,
        true as success,
        format('Successfully copied and split %s trails into %s segments with %s intersections (v12)',
               original_count_var, split_count_var, intersection_count_var) as message;

    RAISE NOTICE 'Native PostgreSQL copy and split: % original trails -> % split segments with % intersections',
        original_count_var, split_count_var, intersection_count_var;

EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, 0, 0, false, 
        format('Error during copy and split (v12): %s', SQLERRM) as message;

    RAISE NOTICE 'Error during native PostgreSQL copy and split: %', SQLERRM;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.copy_and_split_trails_to_staging_native_v13(staging_schema text, region_filter text, bbox_min_lng real DEFAULT NULL::real, bbox_min_lat real DEFAULT NULL::real, bbox_max_lng real DEFAULT NULL::real, bbox_max_lat real DEFAULT NULL::real, trail_limit integer DEFAULT NULL::integer, tolerance_meters real DEFAULT 2.0)
 RETURNS TABLE(original_count integer, split_count integer, intersection_count integer, success boolean, message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    original_count_var integer := 0;
    split_count_var integer := 0;
    intersection_count_var integer := 0;
    source_query text;
    limit_clause text := '';
    source_table text := 'trails';  -- Hardcode the source table
    full_sql text;
BEGIN
    -- Debug: Log the parameters we received
    RAISE NOTICE 'Function received parameters: staging_schema=%, region_filter=%', staging_schema, region_filter;
    RAISE NOTICE 'DEBUG: staging_schema=% staging_schema type=%', staging_schema, pg_typeof(staging_schema);
    RAISE NOTICE 'FUNCTION IS BEING CALLED - V13 VERSION';
    
    -- Clear existing data
    EXECUTE format('DELETE FROM %I.trails', staging_schema);
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);
    
    -- Build source query with filters
    source_query := format('SELECT * FROM %I WHERE region = %L', source_table, region_filter);
    
    -- Add bbox filter if provided
    IF bbox_min_lng IS NOT NULL AND bbox_min_lat IS NOT NULL AND bbox_max_lng IS NOT NULL AND bbox_max_lat IS NOT NULL THEN
        source_query := source_query || format(' AND ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))', bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat);
    END IF;
    
    -- Add limit
    IF trail_limit IS NOT NULL THEN
        limit_clause := format(' LIMIT %s', trail_limit);
    END IF;
    
    source_query := source_query || limit_clause;
    
    -- Debug: Log the source_query
    RAISE NOTICE 'Source query: %', source_query;
    
    -- Build the full SQL dynamically to avoid parameter passing issues
    full_sql := format($f$
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
            geometry, created_at, updated_at
        )
        WITH trail_intersections AS (
            -- Find all intersection points between trails using 3D coordinates
            SELECT DISTINCT
                t1.app_uuid as trail1_uuid,
                t2.app_uuid as trail2_uuid,
                ST_Intersection(t1.geometry, t2.geometry) as intersection_point
            FROM (%s) t1
            JOIN (%s) t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ),
        all_trails AS (
            -- Get all source trails
            SELECT 
                id, app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
                bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                source, created_at, updated_at, geometry
            FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        ),
        trails_with_intersections AS (
            -- Get trails that have intersections and split them
            SELECT 
                at.id, at.app_uuid, at.osm_id, at.name, at.region, at.trail_type, at.surface, at.difficulty, at.source_tags,
                at.bbox_min_lng, at.bbox_max_lng, at.bbox_min_lat, at.bbox_max_lat,
                at.length_km, at.elevation_gain, at.elevation_loss, at.max_elevation, at.min_elevation, at.avg_elevation,
                at.source, at.created_at, at.updated_at, at.geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).geom as split_geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).path[1] as segment_order
            FROM all_trails at
            JOIN trail_intersections ti ON at.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
        ),
        trails_without_intersections AS (
            -- Get trails that don't have intersections (keep original geometry)
            SELECT 
                at.id, at.app_uuid, at.osm_id, at.name, at.region, at.trail_type, at.surface, at.difficulty, at.source_tags,
                at.bbox_min_lng, at.bbox_max_lng, at.bbox_min_lat, at.bbox_max_lat,
                at.length_km, at.elevation_gain, at.elevation_loss, at.max_elevation, at.min_elevation, at.avg_elevation,
                at.source, at.created_at, at.updated_at, at.geometry,
                at.geometry as split_geometry,
                1 as segment_order
            FROM all_trails at
            WHERE at.app_uuid NOT IN (
                SELECT DISTINCT trail1_uuid FROM trail_intersections
                UNION
                SELECT DISTINCT trail2_uuid FROM trail_intersections
            )
        ),
        processed_trails AS (
            -- Combine both sets
            SELECT * FROM trails_with_intersections
            UNION ALL
            SELECT * FROM trails_without_intersections
        )
        SELECT 
            gen_random_uuid() as app_uuid,  -- Generate new UUID for ALL segments
            osm_id,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            source_tags,
            ST_XMin(split_geometry) as bbox_min_lng,
            ST_XMax(split_geometry) as bbox_max_lng,
            ST_YMin(split_geometry) as bbox_min_lat,
            ST_YMax(split_geometry) as bbox_max_lat,
            ST_Length(split_geometry::geography) / 1000.0 as length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            split_geometry as geometry,
            NOW() as created_at,
            NOW() as updated_at
        FROM processed_trails pt
        WHERE ST_IsValid(pt.split_geometry)  -- Only include valid geometries
          AND pt.app_uuid IS NOT NULL    -- Ensure app_uuid is not null
    $f$, staging_schema, source_query, source_query, source_query);
    
    -- Debug: Log the full SQL
    RAISE NOTICE 'Full SQL: %', full_sql;
    
    -- Execute the SQL
    EXECUTE full_sql;
    
    GET DIAGNOSTICS split_count_var = ROW_COUNT;
    
    -- Get original count from source query
    EXECUTE format('SELECT COUNT(*) FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)', source_query) INTO original_count_var;
    
    -- Step 2: Detect intersections between split trail segments
    EXECUTE format($f$
        INSERT INTO %I.intersection_points (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT DISTINCT
            ST_Force2D(intersection_point) as point,
            ST_Force3D(intersection_point) as point_3d,
            ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
            ARRAY[t1.name, t2.name] as connected_trail_names,
            'intersection' as node_type,
            $1 as distance_meters
        FROM (
            SELECT 
                (ST_Dump(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)))).geom as intersection_point,
                t1.app_uuid as t1_uuid,
                t2.app_uuid as t2_uuid
            FROM %I.trails t1
            JOIN %I.trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ) AS intersections
    $f$, staging_schema, tolerance_meters, staging_schema, staging_schema);

    GET DIAGNOSTICS intersection_count_var = ROW_COUNT;

    -- Clear routing data in staging schema since it needs to be regenerated from split trails
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);

    -- Create optimized spatial indexes
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geometry ON %I.trails USING GIST(geometry)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON %I.trails(app_uuid)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_name ON %I.trails(name)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_intersection_points ON %I.intersection_points USING GIST(point)', staging_schema);

    -- Return results
    RETURN QUERY SELECT 
        original_count_var,
        split_count_var,
        intersection_count_var,
        true as success,
        format('Successfully copied and split %s trails into %s segments with %s intersections (v13)',
               original_count_var, split_count_var, intersection_count_var) as message;

    RAISE NOTICE 'Native PostgreSQL copy and split: % original trails -> % split segments with % intersections',
        original_count_var, split_count_var, intersection_count_var;

EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, 0, 0, false, 
        format('Error during copy and split (v13): %s', SQLERRM) as message;

    RAISE NOTICE 'Error during native PostgreSQL copy and split: %', SQLERRM;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.copy_and_split_trails_to_staging_native_v14(staging_schema text, region_filter text, bbox_min_lng real DEFAULT NULL::real, bbox_min_lat real DEFAULT NULL::real, bbox_max_lng real DEFAULT NULL::real, bbox_max_lat real DEFAULT NULL::real, trail_limit integer DEFAULT NULL::integer, tolerance_meters real DEFAULT 2.0)
 RETURNS TABLE(original_count integer, split_count integer, intersection_count integer, success boolean, message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    original_count_var integer := 0;
    split_count_var integer := 0;
    intersection_count_var integer := 0;
    source_query text;
    limit_clause text := '';
    source_table text := 'trails';  -- Hardcode the source table
    full_sql text;
BEGIN
    -- Debug: Log the parameters we received
    RAISE NOTICE 'Function received parameters: staging_schema=%, region_filter=%', staging_schema, region_filter;
    RAISE NOTICE 'DEBUG: staging_schema=% staging_schema type=%', staging_schema, pg_typeof(staging_schema);
    RAISE NOTICE 'FUNCTION IS BEING CALLED - V14 VERSION';
    RAISE NOTICE 'DEBUG: source_table=%', source_table;
    
    -- Clear existing data
    EXECUTE format('DELETE FROM %I.trails', staging_schema);
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);
    
    -- Build source query with filters - explicitly use hardcoded table name
    source_query := format('SELECT * FROM trails WHERE region = %L', region_filter);
    
    -- Add bbox filter if provided
    IF bbox_min_lng IS NOT NULL AND bbox_min_lat IS NOT NULL AND bbox_max_lng IS NOT NULL AND bbox_max_lat IS NOT NULL THEN
        source_query := source_query || format(' AND ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))', bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat);
    END IF;
    
    -- Add limit
    IF trail_limit IS NOT NULL THEN
        limit_clause := format(' LIMIT %s', trail_limit);
    END IF;
    
    source_query := source_query || limit_clause;
    
    -- Debug: Log the source_query
    RAISE NOTICE 'Source query: %', source_query;
    
    -- Build the full SQL dynamically to avoid parameter passing issues
    full_sql := format($f$
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
            geometry, created_at, updated_at
        )
        WITH trail_intersections AS (
            -- Find all intersection points between trails using 3D coordinates
            SELECT DISTINCT
                t1.app_uuid as trail1_uuid,
                t2.app_uuid as trail2_uuid,
                ST_Intersection(t1.geometry, t2.geometry) as intersection_point
            FROM (%s) t1
            JOIN (%s) t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ),
        all_trails AS (
            -- Get all source trails
            SELECT 
                id, app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
                bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                source, created_at, updated_at, geometry
            FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        ),
        trails_with_intersections AS (
            -- Get trails that have intersections and split them
            SELECT 
                at.id, at.app_uuid, at.osm_id, at.name, at.region, at.trail_type, at.surface, at.difficulty, at.source_tags,
                at.bbox_min_lng, at.bbox_max_lng, at.bbox_min_lat, at.bbox_max_lat,
                at.length_km, at.elevation_gain, at.elevation_loss, at.max_elevation, at.min_elevation, at.avg_elevation,
                at.source, at.created_at, at.updated_at, at.geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).geom as split_geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).path[1] as segment_order
            FROM all_trails at
            JOIN trail_intersections ti ON at.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
        ),
        trails_without_intersections AS (
            -- Get trails that don't have intersections (keep original geometry)
            SELECT 
                at.id, at.app_uuid, at.osm_id, at.name, at.region, at.trail_type, at.surface, at.difficulty, at.source_tags,
                at.bbox_min_lng, at.bbox_max_lng, at.bbox_min_lat, at.bbox_max_lat,
                at.length_km, at.elevation_gain, at.elevation_loss, at.max_elevation, at.min_elevation, at.avg_elevation,
                at.source, at.created_at, at.updated_at, at.geometry,
                at.geometry as split_geometry,
                1 as segment_order
            FROM all_trails at
            WHERE at.app_uuid NOT IN (
                SELECT DISTINCT trail1_uuid FROM trail_intersections
                UNION
                SELECT DISTINCT trail2_uuid FROM trail_intersections
            )
        ),
        processed_trails AS (
            -- Combine both sets
            SELECT * FROM trails_with_intersections
            UNION ALL
            SELECT * FROM trails_without_intersections
        )
        SELECT 
            gen_random_uuid() as app_uuid,  -- Generate new UUID for ALL segments
            osm_id,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            source_tags,
            ST_XMin(split_geometry) as bbox_min_lng,
            ST_XMax(split_geometry) as bbox_max_lng,
            ST_YMin(split_geometry) as bbox_min_lat,
            ST_YMax(split_geometry) as bbox_max_lat,
            ST_Length(split_geometry::geography) / 1000.0 as length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            split_geometry as geometry,
            NOW() as created_at,
            NOW() as updated_at
        FROM processed_trails pt
        WHERE ST_IsValid(pt.split_geometry)  -- Only include valid geometries
          AND pt.app_uuid IS NOT NULL    -- Ensure app_uuid is not null
    $f$, staging_schema, source_query, source_query, source_query);
    
    -- Debug: Log the full SQL
    RAISE NOTICE 'Full SQL: %', full_sql;
    
    -- Execute the SQL
    EXECUTE full_sql;
    
    GET DIAGNOSTICS split_count_var = ROW_COUNT;
    
    -- Get original count from source query
    EXECUTE format('SELECT COUNT(*) FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)', source_query) INTO original_count_var;
    
    -- Step 2: Detect intersections between split trail segments
    EXECUTE format($f$
        INSERT INTO %I.intersection_points (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT DISTINCT
            ST_Force2D(intersection_point) as point,
            ST_Force3D(intersection_point) as point_3d,
            ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
            ARRAY[t1.name, t2.name] as connected_trail_names,
            'intersection' as node_type,
            $1 as distance_meters
        FROM (
            SELECT 
                (ST_Dump(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)))).geom as intersection_point,
                t1.app_uuid as t1_uuid,
                t2.app_uuid as t2_uuid
            FROM %I.trails t1
            JOIN %I.trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ) AS intersections
    $f$, staging_schema, tolerance_meters, staging_schema, staging_schema);

    GET DIAGNOSTICS intersection_count_var = ROW_COUNT;

    -- Clear routing data in staging schema since it needs to be regenerated from split trails
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);

    -- Create optimized spatial indexes
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geometry ON %I.trails USING GIST(geometry)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON %I.trails(app_uuid)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_name ON %I.trails(name)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_intersection_points ON %I.intersection_points USING GIST(point)', staging_schema);

    -- Return results
    RETURN QUERY SELECT 
        original_count_var,
        split_count_var,
        intersection_count_var,
        true as success,
        format('Successfully copied and split %s trails into %s segments with %s intersections (v14)',
               original_count_var, split_count_var, intersection_count_var) as message;

    RAISE NOTICE 'Native PostgreSQL copy and split: % original trails -> % split segments with % intersections',
        original_count_var, split_count_var, intersection_count_var;

EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, 0, 0, false, 
        format('Error during copy and split (v14): %s', SQLERRM) as message;

    RAISE NOTICE 'Error during native PostgreSQL copy and split: %', SQLERRM;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.copy_and_split_trails_to_staging_native_v15(staging_schema text, source_table text, region_filter text, bbox_min_lng numeric, bbox_min_lat numeric, bbox_max_lng numeric, bbox_max_lat numeric, trail_limit integer, tolerance_meters numeric)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    source_query text;
    full_sql text;
    result_count integer := 0;
BEGIN
    RAISE NOTICE 'DEBUG V15: Function called with parameters:';
    RAISE NOTICE '  staging_schema: %', staging_schema;
    RAISE NOTICE '  source_table: %', source_table;
    RAISE NOTICE '  region_filter: %', region_filter;
    RAISE NOTICE '  bbox_min_lng: %', bbox_min_lng;
    RAISE NOTICE '  bbox_min_lat: %', bbox_min_lat;
    RAISE NOTICE '  bbox_max_lng: %', bbox_max_lng;
    RAISE NOTICE '  bbox_max_lat: %', bbox_max_lat;
    RAISE NOTICE '  trail_limit: %', trail_limit;
    RAISE NOTICE '  tolerance_meters: %', tolerance_meters;
    
    -- Build source query using format() with %I for table name
    source_query := format('SELECT * FROM %I WHERE region = %L', source_table, region_filter);
    
    RAISE NOTICE 'DEBUG V15: source_query: %', source_query;
    
    -- Build full SQL using format() to handle nulls properly
    full_sql := format($f$
        WITH source_trails AS (
            %s
        ),
        split_trails AS (
            SELECT 
                gen_random_uuid() as app_uuid,
                osm_id,
                name,
                region,
                ST_GeometryType(geometry) as geometry_type,
                geometry,
                elevation,
                length_meters,
                created_at,
                updated_at
            FROM source_trails
            WHERE ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))
            LIMIT %s
        ),
        intersection_splits AS (
            SELECT 
                t.app_uuid,
                t.osm_id,
                t.name,
                t.region,
                t.geometry_type,
                CASE 
                    WHEN ST_Intersects(t.geometry, i.geometry) THEN 
                        ST_Split(t.geometry, i.geometry)
                    ELSE 
                        t.geometry
                END as split_geometry,
                t.elevation,
                t.length_meters,
                t.created_at,
                t.updated_at
            FROM split_trails t
            CROSS JOIN (
                SELECT geometry 
                FROM %I 
                WHERE region = %L
                AND ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))
                AND ST_DWithin(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326), %s)
            ) i
        )
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, geometry_type, geometry, elevation, length_meters, created_at, updated_at
        )
        SELECT 
            gen_random_uuid() as app_uuid,
            osm_id,
            name,
            region,
            geometry_type,
            split_geometry as geometry,
            elevation,
            length_meters,
            created_at,
            updated_at
        FROM intersection_splits
        WHERE ST_GeometryType(split_geometry) = 'LINESTRING'
        AND ST_Length(split_geometry) > 0;
    $f$, 
        source_query,
        bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat, trail_limit,
        source_table, region_filter,
        bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat,
        bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat, tolerance_meters,
        staging_schema
    );
    
    RAISE NOTICE 'DEBUG V15: About to execute full_sql';
    RAISE NOTICE 'DEBUG V15: full_sql: %', full_sql;
    
    EXECUTE full_sql;
    
    GET DIAGNOSTICS result_count = ROW_COUNT;
    
    RAISE NOTICE 'DEBUG V15: Inserted % rows', result_count;
    
    RETURN result_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.copy_and_split_trails_to_staging_native_v15(staging_schema text, region_filter text, bbox_min_lng numeric, bbox_min_lat numeric, bbox_max_lng numeric, bbox_max_lat numeric, trail_limit integer, tolerance_meters numeric)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    source_query text;
    full_sql text;
    result_count integer := 0;
BEGIN
    RAISE NOTICE 'DEBUG V15: Function called with parameters:';
    RAISE NOTICE '  staging_schema: %', staging_schema;
    RAISE NOTICE '  region_filter: %', region_filter;
    RAISE NOTICE '  bbox_min_lng: %', bbox_min_lng;
    RAISE NOTICE '  bbox_min_lat: %', bbox_min_lat;
    RAISE NOTICE '  bbox_max_lng: %', bbox_max_lng;
    RAISE NOTICE '  bbox_max_lat: %', bbox_max_lat;
    RAISE NOTICE '  trail_limit: %', trail_limit;
    RAISE NOTICE '  tolerance_meters: %', tolerance_meters;
    
    -- Build source query using format() to handle nulls properly
    source_query := format('SELECT * FROM trails WHERE region = %L', region_filter);
    
    RAISE NOTICE 'DEBUG V15: source_query: %', source_query;
    
    -- Build full SQL using format() to handle nulls properly
    full_sql := format($f$
        WITH source_trails AS (
            %s
        ),
        split_trails AS (
            SELECT 
                gen_random_uuid() as app_uuid,
                osm_id,
                name,
                region,
                ST_GeometryType(geometry) as geometry_type,
                geometry,
                elevation,
                length_meters,
                created_at,
                updated_at
            FROM source_trails
            WHERE ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))
            LIMIT %s
        ),
        intersection_splits AS (
            SELECT 
                t.app_uuid,
                t.osm_id,
                t.name,
                t.region,
                t.geometry_type,
                CASE 
                    WHEN ST_Intersects(t.geometry, i.geometry) THEN 
                        ST_Split(t.geometry, i.geometry)
                    ELSE 
                        t.geometry
                END as split_geometry,
                t.elevation,
                t.length_meters,
                t.created_at,
                t.updated_at
            FROM split_trails t
            CROSS JOIN (
                SELECT geometry 
                FROM trails 
                WHERE region = %L
                AND ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))
                AND ST_DWithin(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326), %s)
            ) i
        )
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, geometry_type, geometry, elevation, length_meters, created_at, updated_at
        )
        SELECT 
            gen_random_uuid() as app_uuid,
            osm_id,
            name,
            region,
            geometry_type,
            split_geometry as geometry,
            elevation,
            length_meters,
            created_at,
            updated_at
        FROM intersection_splits
        WHERE ST_GeometryType(split_geometry) = 'LINESTRING'
        AND ST_Length(split_geometry) > 0;
    $f$, 
        source_query,
        bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat, trail_limit,
        region_filter,
        bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat,
        bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat, tolerance_meters,
        staging_schema
    );
    
    RAISE NOTICE 'DEBUG V15: About to execute full_sql';
    RAISE NOTICE 'DEBUG V15: full_sql: %', full_sql;
    
    EXECUTE full_sql;
    
    GET DIAGNOSTICS result_count = ROW_COUNT;
    
    RAISE NOTICE 'DEBUG V15: Inserted % rows', result_count;
    
    RETURN result_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.copy_and_split_trails_to_staging_native_v16(staging_schema text, source_table text, region_filter text, bbox_min_lng numeric DEFAULT NULL::numeric, bbox_min_lat numeric DEFAULT NULL::numeric, bbox_max_lng numeric DEFAULT NULL::numeric, bbox_max_lat numeric DEFAULT NULL::numeric, trail_limit integer DEFAULT NULL::integer, tolerance_meters numeric DEFAULT 1.0)
 RETURNS TABLE(original_count integer, split_count integer, intersection_count integer, success boolean, message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    original_count_var integer := 0;
    split_count_var integer := 0;
    intersection_count_var integer := 0;
    source_query text;
    limit_clause text := '';
BEGIN
    RAISE NOTICE 'DEBUG V16: Function called with parameters:';
    RAISE NOTICE '  staging_schema: %', staging_schema;
    RAISE NOTICE '  source_table: %', source_table;
    RAISE NOTICE '  region_filter: %', region_filter;
    RAISE NOTICE '  bbox_min_lng: %', bbox_min_lng;
    RAISE NOTICE '  bbox_min_lat: %', bbox_min_lat;
    RAISE NOTICE '  bbox_max_lng: %', bbox_max_lng;
    RAISE NOTICE '  bbox_max_lat: %', bbox_max_lat;
    RAISE NOTICE '  trail_limit: %', trail_limit;
    RAISE NOTICE '  tolerance_meters: %', tolerance_meters;

    -- Clear existing data
    EXECUTE format('DELETE FROM %I.trails', staging_schema);
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);

    -- Build source query with filters
    source_query := format('SELECT * FROM %I WHERE region = %L', source_table, region_filter);

    -- Add bbox filter if provided
    IF bbox_min_lng IS NOT NULL AND bbox_min_lat IS NOT NULL AND bbox_max_lng IS NOT NULL AND bbox_max_lat IS NOT NULL THEN
        source_query := source_query || format(' AND ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))', bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat);
    END IF;

    -- Add limit
    IF trail_limit IS NOT NULL THEN
        limit_clause := format(' LIMIT %s', trail_limit);
    END IF;

    source_query := source_query || limit_clause;

    RAISE NOTICE 'DEBUG V16: source_query: %', source_query;

    -- Step 1: Copy and split trails using native PostGIS ST_Split
    EXECUTE format($f$
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
            geometry, created_at, updated_at
        )
        WITH trail_intersections AS (
            SELECT DISTINCT
                t1.app_uuid as trail1_uuid,
                t2.app_uuid as trail2_uuid,
                ST_Intersection(t1.geometry, t2.geometry) as intersection_point
            FROM (%s) t1
            JOIN (%s) t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ),
        all_trails AS (
            SELECT
                id, app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
                bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                source, created_at, updated_at, geometry
            FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        ),
        trails_with_intersections AS (
            SELECT
                at.id, at.app_uuid, at.osm_id, at.name, at.region, at.trail_type, at.surface, at.difficulty, at.source_tags,
                at.bbox_min_lng, at.bbox_max_lng, at.bbox_min_lat, at.bbox_max_lat,
                at.length_km, at.elevation_gain, at.elevation_loss, at.max_elevation, at.min_elevation, at.avg_elevation,
                at.source, at.created_at, at.updated_at, at.geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).geom as split_geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).path[1] as segment_order
            FROM all_trails at
            JOIN trail_intersections ti ON at.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
        ),
        trails_without_intersections AS (
            SELECT
                at.id, at.app_uuid, at.osm_id, at.name, at.region, at.trail_type, at.surface, at.difficulty, at.source_tags,
                at.bbox_min_lng, at.bbox_max_lng, at.bbox_min_lat, at.bbox_max_lat,
                at.length_km, at.elevation_gain, at.elevation_loss, at.max_elevation, at.min_elevation, at.avg_elevation,
                at.source, at.created_at, at.updated_at, at.geometry,
                at.geometry as split_geometry,
                1 as segment_order
            FROM all_trails at
            WHERE at.app_uuid NOT IN (
                SELECT DISTINCT trail1_uuid FROM trail_intersections
                UNION
                SELECT DISTINCT trail2_uuid FROM trail_intersections
            )
        ),
        processed_trails AS (
            SELECT * FROM trails_with_intersections
            UNION ALL
            SELECT * FROM trails_without_intersections
        )
        SELECT
            gen_random_uuid() as app_uuid,
            osm_id,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            source_tags,
            ST_XMin(split_geometry) as bbox_min_lng,
            ST_XMax(split_geometry) as bbox_max_lng,
            ST_YMin(split_geometry) as bbox_min_lat,
            ST_YMax(split_geometry) as bbox_max_lat,
            ST_Length(split_geometry::geography) / 1000.0 as length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            split_geometry as geometry,
            NOW() as created_at,
            NOW() as updated_at
        FROM processed_trails pt
        WHERE ST_IsValid(pt.split_geometry)
          AND pt.app_uuid IS NOT NULL
    $f$, staging_schema, source_query, source_query, source_query);

    GET DIAGNOSTICS split_count_var = ROW_COUNT;

    -- Get original count from source query
    EXECUTE format('SELECT COUNT(*) FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)', source_query) INTO original_count_var;

    -- Step 2: Detect intersections between split trail segments
    PERFORM detect_trail_intersections(staging_schema, 'trails', tolerance_meters);

    -- Get intersection count
    EXECUTE format('SELECT COUNT(*) FROM %I.intersection_points', staging_schema) INTO intersection_count_var;

    -- Clear routing data in staging schema since it needs to be regenerated from split trails
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);

    -- Create optimized spatial indexes
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geometry ON %I.trails USING GIST(geometry)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON %I.trails(app_uuid)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_name ON %I.trails(name)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_intersection_points ON %I.intersection_points USING GIST(point)', staging_schema);

    -- Return results
    RETURN QUERY SELECT
        original_count_var,
        split_count_var,
        intersection_count_var,
        true as success,
        format('Successfully copied and split %s trails into %s segments with %s intersections',
               original_count_var, split_count_var, intersection_count_var) as message;

    RAISE NOTICE 'Native PostgreSQL copy and split: % original trails -> % split segments with % intersections',
        original_count_var, split_count_var, intersection_count_var;

EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT
        0, 0, 0, false,
        format('Error during copy and split: %s', SQLERRM) as message;

    RAISE NOTICE 'Error during native PostgreSQL copy and split: %', SQLERRM;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.detect_trail_intersections(staging_schema text, tolerance_meters real DEFAULT 1.0)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    intersection_count integer := 0;
BEGIN
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);
    EXECUTE format($f$
        INSERT INTO %I.intersection_points (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT DISTINCT
            ST_Force2D(intersection_point) as point,
            ST_Force3D(intersection_point) as point_3d,
            ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
            ARRAY[t1.name, t2.name] as connected_trail_names,
            'intersection' as node_type,
            $1 as distance_meters
        FROM (
            SELECT 
                (ST_Dump(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)))).geom as intersection_point,
                t1.app_uuid as t1_uuid,
                t2.app_uuid as t2_uuid
            FROM %I.trails t1
            JOIN %I.trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5  -- Reduced from 10 to 5 meters
              AND ST_Length(t2.geometry::geography) > 5  -- Reduced from 10 to 5 meters
        ) intersections
        JOIN %I.trails t1 ON t1.app_uuid = intersections.t1_uuid
        JOIN %I.trails t2 ON t2.app_uuid = intersections.t2_uuid
        WHERE ST_Length(intersection_point::geography) = 0  -- Point intersections only
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_meters;
    GET DIAGNOSTICS intersection_count = ROW_COUNT;
    RAISE NOTICE 'Detected % intersection points', intersection_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.detect_trail_intersections(trails_schema text, trails_table text, intersection_tolerance_meters double precision DEFAULT 2.0)
 RETURNS TABLE(intersection_point geometry, intersection_point_3d geometry, connected_trail_ids integer[], connected_trail_names text[], node_type text, distance_meters double precision)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY EXECUTE format('
        WITH noded_trails AS (
            SELECT id, name, (ST_Dump(ST_Node(geometry))).geom as noded_geom
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        true_intersections AS (
            SELECT 
                ST_Intersection(t1.noded_geom, t2.noded_geom) as intersection_point,
                ST_Force3D(ST_Intersection(t1.noded_geom, t2.noded_geom)) as intersection_point_3d,
                ARRAY[t1.id, t2.id] as connected_trail_ids,
                ARRAY[t1.name, t2.name] as connected_trail_names,
                ''intersection'' as node_type,
                ST_Distance(t1.noded_geom::geography, t2.noded_geom::geography) as distance_meters
            FROM noded_trails t1
            JOIN noded_trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.noded_geom, t2.noded_geom)
            AND ST_GeometryType(ST_Intersection(t1.noded_geom, t2.noded_geom)) = ''ST_Point''
        )
        SELECT 
            intersection_point,
            intersection_point_3d,
            connected_trail_ids,
            connected_trail_names,
            node_type,
            distance_meters
        FROM true_intersections
        WHERE distance_meters <= $1
    ', trails_schema, trails_table) USING intersection_tolerance_meters;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.difference(text, text)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/fuzzystrmatch', $function$difference$function$
;

CREATE OR REPLACE FUNCTION public.dmetaphone(text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/fuzzystrmatch', $function$dmetaphone$function$
;

CREATE OR REPLACE FUNCTION public.dmetaphone_alt(text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/fuzzystrmatch', $function$dmetaphone_alt$function$
;

CREATE OR REPLACE FUNCTION public.dropgeometrycolumn(catalog_name character varying, schema_name character varying, table_name character varying, column_name character varying)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
	myrec RECORD;
	okay boolean;
	real_schema name;
BEGIN
	IF ( schema_name != '' ) THEN
		okay = false;
		FOR myrec IN SELECT nspname FROM pg_namespace WHERE text(nspname) = schema_name LOOP
			okay := true;
		END LOOP;
		IF ( okay <>  true ) THEN
			RAISE NOTICE 'Invalid schema name - using current_schema()';
			SELECT current_schema() into real_schema;
		ELSE
			real_schema = schema_name;
		END IF;
	ELSE
		SELECT current_schema() into real_schema;
	END IF;
	okay = false;
	FOR myrec IN SELECT * from public.geometry_columns where f_table_schema = text(real_schema) and f_table_name = table_name and f_geometry_column = column_name LOOP
		okay := true;
	END LOOP;
	IF (okay <> true) THEN
		RAISE EXCEPTION 'column not found in geometry_columns table';
		RETURN false;
	END IF;
	EXECUTE 'ALTER TABLE ' || quote_ident(real_schema) || '.' ||
		quote_ident(table_name) || ' DROP COLUMN ' ||
		quote_ident(column_name);
	RETURN real_schema || '.' || table_name || '.' || column_name ||' effectively removed.';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dropgeometrycolumn(schema_name character varying, table_name character varying, column_name character varying)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
	ret text;
BEGIN
	SELECT public.DropGeometryColumn('',$1,$2,$3) into ret;
	RETURN ret;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dropgeometrycolumn(table_name character varying, column_name character varying)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
	ret text;
BEGIN
	SELECT public.DropGeometryColumn('','',$1,$2) into ret;
	RETURN ret;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dropgeometrytable(schema_name character varying, table_name character varying)
 RETURNS text
 LANGUAGE sql
 STRICT
AS $function$ SELECT public.DropGeometryTable('',$1,$2) $function$
;

CREATE OR REPLACE FUNCTION public.dropgeometrytable(catalog_name character varying, schema_name character varying, table_name character varying)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
	real_schema name;
BEGIN
	IF ( schema_name = '' ) THEN
		SELECT current_schema() into real_schema;
	ELSE
		real_schema = schema_name;
	END IF;
	EXECUTE 'DROP TABLE IF EXISTS '
		|| quote_ident(real_schema) || '.' ||
		quote_ident(table_name) || ' RESTRICT';
	RETURN
		real_schema || '.' ||
		table_name ||' dropped.';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dropgeometrytable(table_name character varying)
 RETURNS text
 LANGUAGE sql
 STRICT
AS $function$ SELECT public.DropGeometryTable('','',$1) $function$
;

CREATE OR REPLACE FUNCTION public.dropoverviewconstraints(ovschema name, ovtable name, ovcolumn name)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		schema name;
		sql text;
		rtn boolean;
	BEGIN
		schema := NULL;
		IF length($1) > 0 THEN
			sql := 'SELECT nspname FROM pg_namespace '
				|| 'WHERE nspname = ' || quote_literal($1)
				|| 'LIMIT 1';
			EXECUTE sql INTO schema;
			IF schema IS NULL THEN
				RAISE EXCEPTION 'The value provided for schema is invalid';
				RETURN FALSE;
			END IF;
		END IF;
		IF schema IS NULL THEN
			sql := 'SELECT n.nspname AS schemaname '
				|| 'FROM pg_catalog.pg_class c '
				|| 'JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace '
				|| 'WHERE c.relkind = ' || quote_literal('r')
				|| ' AND n.nspname NOT IN (' || quote_literal('pg_catalog')
				|| ', ' || quote_literal('pg_toast')
				|| ') AND pg_catalog.pg_table_is_visible(c.oid)'
				|| ' AND c.relname = ' || quote_literal($2);
			EXECUTE sql INTO schema;
			IF schema IS NULL THEN
				RAISE EXCEPTION 'The table % does not occur in the search_path', quote_literal($2);
				RETURN FALSE;
			END IF;
		END IF;
		rtn :=  public._drop_overview_constraint(schema, $2, $3);
		IF rtn IS FALSE THEN
			RAISE EXCEPTION 'Unable to drop the overview constraint .  Is the schema name, table name or column name incorrect?';
			RETURN FALSE;
		END IF;
		RETURN TRUE;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.dropoverviewconstraints(ovtable name, ovcolumn name)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT  public.DropOverviewConstraints('', $1, $2) $function$
;

CREATE OR REPLACE FUNCTION public.droprasterconstraints(rastschema name, rasttable name, rastcolumn name, srid boolean DEFAULT true, scale_x boolean DEFAULT true, scale_y boolean DEFAULT true, blocksize_x boolean DEFAULT true, blocksize_y boolean DEFAULT true, same_alignment boolean DEFAULT true, regular_blocking boolean DEFAULT true, num_bands boolean DEFAULT true, pixel_types boolean DEFAULT true, nodata_values boolean DEFAULT true, out_db boolean DEFAULT true, extent boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		constraints text[];
	BEGIN
		IF srid IS TRUE THEN
			constraints := constraints || 'srid'::text;
		END IF;
		IF scale_x IS TRUE THEN
			constraints := constraints || 'scale_x'::text;
		END IF;
		IF scale_y IS TRUE THEN
			constraints := constraints || 'scale_y'::text;
		END IF;
		IF blocksize_x IS TRUE THEN
			constraints := constraints || 'blocksize_x'::text;
		END IF;
		IF blocksize_y IS TRUE THEN
			constraints := constraints || 'blocksize_y'::text;
		END IF;
		IF same_alignment IS TRUE THEN
			constraints := constraints || 'same_alignment'::text;
		END IF;
		IF regular_blocking IS TRUE THEN
			constraints := constraints || 'regular_blocking'::text;
		END IF;
		IF num_bands IS TRUE THEN
			constraints := constraints || 'num_bands'::text;
		END IF;
		IF pixel_types IS TRUE THEN
			constraints := constraints || 'pixel_types'::text;
		END IF;
		IF nodata_values IS TRUE THEN
			constraints := constraints || 'nodata_values'::text;
		END IF;
		IF out_db IS TRUE THEN
			constraints := constraints || 'out_db'::text;
		END IF;
		IF extent IS TRUE THEN
			constraints := constraints || 'extent'::text;
		END IF;
		RETURN DropRasterConstraints($1, $2, $3, VARIADIC constraints);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.droprasterconstraints(rasttable name, rastcolumn name, srid boolean DEFAULT true, scale_x boolean DEFAULT true, scale_y boolean DEFAULT true, blocksize_x boolean DEFAULT true, blocksize_y boolean DEFAULT true, same_alignment boolean DEFAULT true, regular_blocking boolean DEFAULT true, num_bands boolean DEFAULT true, pixel_types boolean DEFAULT true, nodata_values boolean DEFAULT true, out_db boolean DEFAULT true, extent boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT public.DropRasterConstraints('', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) $function$
;

CREATE OR REPLACE FUNCTION public.droprasterconstraints(rasttable name, rastcolumn name, VARIADIC constraints text[])
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT  public.DropRasterConstraints('', $1, $2, VARIADIC $3) $function$
;

CREATE OR REPLACE FUNCTION public.droprasterconstraints(rastschema name, rasttable name, rastcolumn name, VARIADIC constraints text[])
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
AS $function$
	DECLARE
		max int;
		x int;
		schema name;
		sql text;
		kw text;
		rtn boolean;
		cnt int;
	BEGIN
		cnt := 0;
		max := array_length(constraints, 1);
		IF max < 1 THEN
			RAISE NOTICE 'No constraints indicated to be dropped.  Doing nothing';
			RETURN TRUE;
		END IF;
		schema := NULL;
		IF length($1) > 0 THEN
			sql := 'SELECT nspname FROM pg_namespace '
				|| 'WHERE nspname = ' || quote_literal($1)
				|| 'LIMIT 1';
			EXECUTE sql INTO schema;
			IF schema IS NULL THEN
				RAISE EXCEPTION 'The value provided for schema is invalid';
				RETURN FALSE;
			END IF;
		END IF;
		IF schema IS NULL THEN
			sql := 'SELECT n.nspname AS schemaname '
				|| 'FROM pg_catalog.pg_class c '
				|| 'JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace '
				|| 'WHERE c.relkind = ' || quote_literal('r')
				|| ' AND n.nspname NOT IN (' || quote_literal('pg_catalog')
				|| ', ' || quote_literal('pg_toast')
				|| ') AND pg_catalog.pg_table_is_visible(c.oid)'
				|| ' AND c.relname = ' || quote_literal($2);
			EXECUTE sql INTO schema;
			IF schema IS NULL THEN
				RAISE EXCEPTION 'The table % does not occur in the search_path', quote_literal($2);
				RETURN FALSE;
			END IF;
		END IF;
		<<kwloop>>
		FOR x in 1..max LOOP
			kw := trim(both from lower(constraints[x]));
			BEGIN
				CASE
					WHEN kw = 'srid' THEN
						RAISE NOTICE 'Dropping SRID constraint';
						rtn :=  public._drop_raster_constraint_srid(schema, $2, $3);
					WHEN kw IN ('scale_x', 'scalex') THEN
						RAISE NOTICE 'Dropping scale-X constraint';
						rtn :=  public._drop_raster_constraint_scale(schema, $2, $3, 'x');
					WHEN kw IN ('scale_y', 'scaley') THEN
						RAISE NOTICE 'Dropping scale-Y constraint';
						rtn :=  public._drop_raster_constraint_scale(schema, $2, $3, 'y');
					WHEN kw = 'scale' THEN
						RAISE NOTICE 'Dropping scale-X constraint';
						rtn :=  public._drop_raster_constraint_scale(schema, $2, $3, 'x');
						RAISE NOTICE 'Dropping scale-Y constraint';
						rtn :=  public._drop_raster_constraint_scale(schema, $2, $3, 'y');
					WHEN kw IN ('blocksize_x', 'blocksizex', 'width') THEN
						RAISE NOTICE 'Dropping blocksize-X constraint';
						rtn :=  public._drop_raster_constraint_blocksize(schema, $2, $3, 'width');
					WHEN kw IN ('blocksize_y', 'blocksizey', 'height') THEN
						RAISE NOTICE 'Dropping blocksize-Y constraint';
						rtn :=  public._drop_raster_constraint_blocksize(schema, $2, $3, 'height');
					WHEN kw = 'blocksize' THEN
						RAISE NOTICE 'Dropping blocksize-X constraint';
						rtn :=  public._drop_raster_constraint_blocksize(schema, $2, $3, 'width');
						RAISE NOTICE 'Dropping blocksize-Y constraint';
						rtn :=  public._drop_raster_constraint_blocksize(schema, $2, $3, 'height');
					WHEN kw IN ('same_alignment', 'samealignment', 'alignment') THEN
						RAISE NOTICE 'Dropping alignment constraint';
						rtn :=  public._drop_raster_constraint_alignment(schema, $2, $3);
					WHEN kw IN ('regular_blocking', 'regularblocking') THEN
						rtn :=  public._drop_raster_constraint_regular_blocking(schema, $2, $3);
						RAISE NOTICE 'Dropping coverage tile constraint required for regular blocking';
						rtn :=  public._drop_raster_constraint_coverage_tile(schema, $2, $3);
						IF rtn IS NOT FALSE THEN
							RAISE NOTICE 'Dropping spatially unique constraint required for regular blocking';
							rtn :=  public._drop_raster_constraint_spatially_unique(schema, $2, $3);
						END IF;
					WHEN kw IN ('num_bands', 'numbands') THEN
						RAISE NOTICE 'Dropping number of bands constraint';
						rtn :=  public._drop_raster_constraint_num_bands(schema, $2, $3);
					WHEN kw IN ('pixel_types', 'pixeltypes') THEN
						RAISE NOTICE 'Dropping pixel type constraint';
						rtn :=  public._drop_raster_constraint_pixel_types(schema, $2, $3);
					WHEN kw IN ('nodata_values', 'nodatavalues', 'nodata') THEN
						RAISE NOTICE 'Dropping nodata value constraint';
						rtn :=  public._drop_raster_constraint_nodata_values(schema, $2, $3);
					WHEN kw IN ('out_db', 'outdb') THEN
						RAISE NOTICE 'Dropping out-of-database constraint';
						rtn :=  public._drop_raster_constraint_out_db(schema, $2, $3);
					WHEN kw = 'extent' THEN
						RAISE NOTICE 'Dropping maximum extent constraint';
						rtn :=  public._drop_raster_constraint_extent(schema, $2, $3);
					ELSE
						RAISE NOTICE 'Unknown constraint: %.  Skipping', quote_literal(constraints[x]);
						CONTINUE kwloop;
				END CASE;
			END;
			IF rtn IS FALSE THEN
				cnt := cnt + 1;
				RAISE WARNING 'Unable to drop constraint: %.  Skipping', quote_literal(constraints[x]);
			END IF;
		END LOOP kwloop;
		IF cnt = max THEN
			RAISE EXCEPTION 'None of the constraints specified could be dropped.  Is the schema name, table name or column name incorrect?';
			RETURN FALSE;
		END IF;
		RETURN TRUE;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.equals(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_Equals$function$
;

CREATE OR REPLACE FUNCTION public.find_out_and_back_spatial(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, tolerance_percent double precision DEFAULT 30.0)
 RETURNS TABLE(route_id text, start_node integer, end_node integer, total_distance_km double precision, total_elevation_gain double precision, route_path integer[], route_edges integer[], route_shape text, trail_count integer, similarity_score double precision)
 LANGUAGE plpgsql
AS $function$
DECLARE
    min_distance float;
    max_distance float;
    min_elevation float;
    max_elevation float;
BEGIN
    min_distance := target_distance_km * (1 - tolerance_percent / 100.0);
    max_distance := target_distance_km * (1 + tolerance_percent / 100.0);
    min_elevation := target_elevation_gain * (1 - tolerance_percent / 100.0);
    max_elevation := target_elevation_gain * (1 + tolerance_percent / 100.0);
    RETURN QUERY EXECUTE format($f$
        WITH out_and_back AS (
            SELECT 
                e1.id as edge1_id,
                e1.source as start_node,
                e1.target as mid_node,
                e2.id as edge2_id,
                e2.target as end_node,
                e1.distance_km + e2.distance_km as total_distance,
                COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0) as total_elevation,
                ARRAY[e1.source, e1.target, e2.target] as path,
                ARRAY[e1.id, e2.id] as edges,
                ARRAY[e1.trail_name, e2.trail_name] as trail_names
            FROM %I.routing_edges e1
            JOIN %I.routing_edges e2 ON e1.target = e2.source
            WHERE e1.source = e2.target  -- Forms a loop back to start
              AND e1.distance_km + e2.distance_km BETWEEN $1 AND $2
              AND COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0) BETWEEN $3 AND $4
        ),
        valid_routes AS (
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance as total_distance_km,
                total_elevation as total_elevation_gain,
                path,
                edges,
                'out-and-back' as route_shape,
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                calculate_route_similarity_score(
                    total_distance, $5,
                    total_elevation, $6
                ) as similarity_score
            FROM out_and_back
            GROUP BY start_node, end_node, total_distance, total_elevation, path, edges
        )
        SELECT * FROM valid_routes
        WHERE similarity_score >= get_min_route_score()
        ORDER BY similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema, staging_schema)
    USING min_distance, max_distance, min_elevation, max_elevation,
          target_distance_km, target_elevation_gain;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.find_routes_for_criteria(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, desired_route_shape text DEFAULT NULL::text, max_routes integer DEFAULT 10)
 RETURNS TABLE(route_id text, total_distance_km double precision, total_elevation_gain double precision, route_shape text, trail_count integer, similarity_score double precision, route_path integer[], route_edges integer[])
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY EXECUTE format($f$
        SELECT 
            route_id,
            total_distance_km,
            total_elevation_gain,
            route_shape,
            trail_count,
            similarity_score,
            route_path,
            route_edges
        FROM find_routes_recursive($1, $2, $3, 20.0, 8)
        WHERE ($4 IS NULL OR route_shape = $4)
        ORDER BY similarity_score DESC
        LIMIT $5
    $f$, staging_schema)
    USING target_distance_km, target_elevation_gain, desired_route_shape, max_routes;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.find_routes_for_criteria_configurable(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, desired_route_shape text DEFAULT NULL::text, max_routes integer DEFAULT NULL::integer)
 RETURNS TABLE(route_id text, total_distance_km double precision, total_elevation_gain double precision, route_shape text, trail_count integer, similarity_score double precision, route_path integer[], route_edges integer[])
 LANGUAGE plpgsql
AS $function$
DECLARE
    config_max_routes integer;
BEGIN
    IF max_routes IS NULL THEN
        config_max_routes := get_max_routes_per_bin();
    ELSE
        config_max_routes := max_routes;
    END IF;
    RETURN QUERY EXECUTE format($f$
        SELECT 
            route_id,
            total_distance_km,
            total_elevation_gain,
            route_shape,
            trail_count,
            similarity_score,
            route_path,
            route_edges
        FROM find_routes_recursive_configurable($1, $2, $3, 20.0, 8)
        WHERE ($4 IS NULL OR route_shape = $4)
        ORDER BY similarity_score DESC
        LIMIT $5
    $f$, staging_schema)
    USING staging_schema, target_distance_km, target_elevation_gain, desired_route_shape, config_max_routes;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.find_routes_recursive(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, tolerance_percent double precision DEFAULT 20.0, max_depth integer DEFAULT 8)
 RETURNS TABLE(route_id text, start_node integer, end_node integer, total_distance_km double precision, total_elevation_gain double precision, route_path integer[], route_edges integer[], route_shape text, trail_count integer, similarity_score double precision)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY EXECUTE format($f$
        WITH RECURSIVE route_search AS (
            SELECT 
                id as start_node,
                id as current_node,
                id as end_node,
                ARRAY[id] as path,
                ARRAY[]::integer[] as edges,
                0.0::double precision as total_distance,
                0.0::double precision as total_elevation_gain,
                0 as depth,
                ARRAY[]::text[] as trail_names
            FROM %I.routing_nodes
            WHERE node_type IN ('intersection', 'endpoint')
            UNION ALL
            SELECT 
                rs.start_node,
                e.target as current_node,
                e.target as end_node,
                rs.path || e.target,
                rs.edges || e.id,
                (rs.total_distance + e.distance_km)::double precision,
                (rs.total_elevation_gain + COALESCE(e.elevation_gain, 0))::double precision,
                rs.depth + 1,
                rs.trail_names || e.trail_name
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.current_node = e.source
            WHERE rs.depth < $1  -- Limit depth to prevent infinite loops
              AND e.target != ALL(rs.path)  -- Avoid cycles
              AND rs.total_distance < $2 * (1 + $3 / 100.0)  -- Distance tolerance
              AND rs.total_elevation_gain < $4 * (1 + $3 / 100.0)  -- Elevation tolerance
        ),
        valid_routes AS (
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance as total_distance_km,
                total_elevation_gain,
                path as route_path,
                edges as route_edges,
                CASE 
                    WHEN start_node = end_node THEN 'loop'
                    WHEN array_length(path, 1) = 2 THEN 'out-and-back'
                    WHEN array_length(path, 1) > 2 AND start_node = end_node THEN 'loop'
                    ELSE 'point-to-point'
                END as route_shape,
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                calculate_route_similarity_score(total_distance, $2, total_elevation_gain, $4) as similarity_score
            FROM route_search
            WHERE total_distance >= $2 * (1 - $3 / 100.0)  -- Minimum distance
              AND total_distance <= $2 * (1 + $3 / 100.0)  -- Maximum distance
              AND total_elevation_gain >= $4 * (1 - $3 / 100.0)  -- Minimum elevation
              AND total_elevation_gain <= $4 * (1 + $3 / 100.0)  -- Maximum elevation
              AND array_length(path, 1) >= 2  -- At least 2 nodes
            GROUP BY start_node, end_node, total_distance, total_elevation_gain, route_path, route_edges
        )
        SELECT 
            route_id,
            start_node,
            end_node,
            total_distance_km,
            total_elevation_gain,
            route_path,
            route_edges,
            route_shape,
            trail_count,
            similarity_score
        FROM valid_routes
        ORDER BY similarity_score DESC, total_distance_km
        LIMIT get_max_routes_per_bin()  -- Limit results
    $f$, staging_schema, staging_schema)
    USING max_depth, target_distance_km, tolerance_percent, target_elevation_gain;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.find_routes_recursive_configurable(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, tolerance_percent double precision DEFAULT NULL::double precision, max_depth integer DEFAULT 8)
 RETURNS TABLE(route_id text, start_node integer, end_node integer, total_distance_km double precision, total_elevation_gain double precision, route_path integer[], route_edges integer[], route_shape text, trail_count integer, similarity_score double precision)
 LANGUAGE plpgsql
AS $function$
DECLARE
    config_tolerance float;
    distance_limits json;
    elevation_limits json;
BEGIN
    -- Get configurable values
    IF tolerance_percent IS NULL THEN
        config_tolerance := 20.0;  -- Default from config
    ELSE
        config_tolerance := tolerance_percent;
    END IF;
    
    distance_limits := get_route_distance_limits();
    elevation_limits := get_elevation_gain_limits();
    
    RETURN QUERY EXECUTE format($f$
        WITH RECURSIVE route_search AS (
            -- Start with all intersection nodes as potential starting points
            SELECT 
                id as start_node,
                id as current_node,
                id as end_node,
                ARRAY[id] as path,
                ARRAY[]::integer[] as edges,
                0.0::float as total_distance_km,
                0.0::float as total_elevation_gain,
                0 as depth,
                ARRAY[]::text[] as trail_names
            FROM %I.routing_nodes
            
            UNION ALL
            
            -- Recursively explore connected nodes
            SELECT 
                rs.start_node,
                e.target as current_node,
                e.target as end_node,
                rs.path || e.target,
                rs.edges || e.id,
                rs.total_distance_km + e.length_km,
                rs.total_elevation_gain + COALESCE(e.elevation_gain, 0),
                rs.depth + 1,
                rs.trail_names || e.trail_name
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.current_node = e.source
            WHERE rs.depth < $1  -- Limit depth to prevent infinite loops
              AND e.target != ALL(rs.path)  -- Avoid cycles
              AND rs.total_distance_km < $2 * (1 + $3 / 100.0)  -- Distance tolerance
              AND rs.total_elevation_gain < $4 * (1 + $3 / 100.0)  -- Elevation tolerance
        ),
        valid_routes AS (
            -- Filter to routes that meet our criteria
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance_km,
                total_elevation_gain,
                path,
                edges,
                -- Classify route shape
                CASE 
                    WHEN start_node = end_node THEN 'loop'
                    WHEN array_length(path, 1) = 2 THEN 'out-and-back'
                    WHEN array_length(path, 1) > 2 AND start_node = end_node THEN 'loop'
                    ELSE 'point-to-point'
                END as route_shape,
                -- Count unique trails
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                -- Calculate similarity score
                calculate_route_similarity_score(
                    total_distance_km, $2,
                    total_elevation_gain, $4
                ) as similarity_score
            FROM route_search
            WHERE total_distance_km >= $2 * (1 - $3 / 100.0)  -- Minimum distance
              AND total_elevation_gain >= $4 * (1 - $3 / 100.0)  -- Minimum elevation
            GROUP BY start_node, end_node, total_distance_km, total_elevation_gain, path, edges
        )
        SELECT * FROM valid_routes
        WHERE similarity_score >= get_min_route_score()
        ORDER BY similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema, staging_schema)
    USING max_depth, target_distance_km, config_tolerance, target_elevation_gain;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.find_routes_spatial(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, tolerance_percent double precision DEFAULT 20.0, max_depth integer DEFAULT 6)
 RETURNS TABLE(route_id text, start_node integer, end_node integer, total_distance_km double precision, total_elevation_gain double precision, route_path integer[], route_edges integer[], route_shape text, trail_count integer, similarity_score double precision)
 LANGUAGE plpgsql
AS $function$
DECLARE
    min_distance float;
    max_distance float;
    min_elevation float;
    max_elevation float;
    route_detail record;
BEGIN
    min_distance := target_distance_km * (1 - tolerance_percent / 100.0);
    max_distance := target_distance_km * (1 + tolerance_percent / 100.0);
    min_elevation := target_elevation_gain * (1 - tolerance_percent / 100.0);
    max_elevation := target_elevation_gain * (1 + tolerance_percent / 100.0);
    RETURN QUERY EXECUTE format($f$
        WITH RECURSIVE route_search AS (
            SELECT 
                e.id as edge_id,
                e.source as start_node,
                e.target as current_node,
                e.source as end_node,
                ARRAY[e.source, e.target] as path,
                ARRAY[e.id] as edges,
                e.distance_km as total_distance_km,
                COALESCE(e.elevation_gain, 0) as total_elevation_gain,
                1 as depth,
                ARRAY[e.trail_name] as trail_names
            FROM %I.routing_edges e
            WHERE e.distance_km <= $1  -- Start with edges that fit our target
            UNION ALL
            SELECT 
                rs.edge_id,
                rs.start_node,
                e.target as current_node,
                e.target as end_node,
                rs.path || e.target,
                rs.edges || e.id,
                rs.total_distance_km + e.distance_km,
                rs.total_elevation_gain + COALESCE(e.elevation_gain, 0),
                rs.depth + 1,
                rs.trail_names || e.trail_name
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.current_node = e.source
            WHERE rs.depth < $2  -- Limit depth
              AND e.target != ALL(rs.path)  -- Avoid cycles
              AND rs.total_distance_km + e.distance_km <= $3  -- Distance tolerance
              AND rs.total_elevation_gain + COALESCE(e.elevation_gain, 0) <= $4  -- Elevation tolerance
        ),
        valid_routes AS (
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance_km,
                total_elevation_gain,
                path,
                edges,
                CASE 
                    WHEN start_node = end_node THEN 'loop'
                    WHEN array_length(path, 1) = 2 THEN 'out-and-back'
                    WHEN array_length(path, 1) > 2 AND start_node = end_node THEN 'loop'
                    ELSE 'point-to-point'
                END as route_shape,
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                calculate_route_similarity_score(
                    total_distance_km, $5,
                    total_elevation_gain, $6
                ) as similarity_score
            FROM route_search
            WHERE total_distance_km >= $7  -- Minimum distance
              AND total_elevation_gain >= $8  -- Minimum elevation
              AND array_length(path, 1) >= 2  -- At least 2 nodes
            GROUP BY start_node, end_node, total_distance_km, total_elevation_gain, path, edges
        )
        SELECT * FROM valid_routes
        WHERE similarity_score >= get_min_route_score()
        ORDER BY similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema, staging_schema)
    USING max_distance, max_depth, max_distance, max_elevation, 
          target_distance_km, target_elevation_gain, min_distance, min_elevation;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.find_routes_with_cost_configurable(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, max_cost double precision DEFAULT NULL::double precision)
 RETURNS TABLE(route_id text, total_distance_km double precision, total_elevation_gain double precision, route_cost double precision, steepness_m_per_km double precision, similarity_score double precision, route_shape text)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY EXECUTE format($f$
        WITH route_costs AS (
            SELECT 
                r.route_id,
                r.total_distance_km,
                r.total_elevation_gain,
                r.route_shape,
                r.similarity_score,
                CASE 
                    WHEN r.total_distance_km > 0 THEN r.total_elevation_gain / r.total_distance_km
                    ELSE 0
                END as steepness_m_per_km,
                calculate_route_cost(
                    CASE 
                        WHEN r.total_distance_km > 0 THEN r.total_elevation_gain / r.total_distance_km
                        ELSE 0
                    END,
                    r.total_distance_km
                ) as route_cost
            FROM find_routes_recursive_configurable($1, $2::float, $3::float, 20.0, 8) r
        )
        SELECT 
            route_id,
            total_distance_km,
            total_elevation_gain,
            route_cost,
            steepness_m_per_km,
            similarity_score,
            route_shape
        FROM route_costs
        WHERE ($4 IS NULL OR route_cost <= $4)
        ORDER BY route_cost ASC, similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema)
    USING target_distance_km, target_elevation_gain, max_cost;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.find_simple_loops_spatial(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, tolerance_percent double precision DEFAULT 30.0)
 RETURNS TABLE(route_id text, start_node integer, end_node integer, total_distance_km double precision, total_elevation_gain double precision, route_path integer[], route_edges integer[], route_shape text, trail_count integer, similarity_score double precision)
 LANGUAGE plpgsql
AS $function$
DECLARE
    min_distance float;
    max_distance float;
    min_elevation float;
    max_elevation float;
BEGIN
    min_distance := target_distance_km * (1 - tolerance_percent / 100.0);
    max_distance := target_distance_km * (1 + tolerance_percent / 100.0);
    min_elevation := target_elevation_gain * (1 - tolerance_percent / 100.0);
    max_elevation := target_elevation_gain * (1 + tolerance_percent / 100.0);
    RETURN QUERY EXECUTE format($f$
        WITH potential_loops AS (
            SELECT 
                e1.id as edge1_id,
                e1.source as start_node,
                e1.target as mid_node,
                e2.id as edge2_id,
                e2.target as end_node,
                e1.distance_km + e2.distance_km as total_distance,
                COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0) as total_elevation,
                ARRAY[e1.source, e1.target, e2.target] as path,
                ARRAY[e1.id, e2.id] as edges,
                ARRAY[e1.trail_name, e2.trail_name] as trail_names
            FROM %I.routing_edges e1
            JOIN %I.routing_edges e2 ON e1.target = e2.source
            WHERE e1.source != e2.target  -- Not a self-loop
              AND e1.distance_km + e2.distance_km BETWEEN $1 AND $2
              AND COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0) BETWEEN $3 AND $4
        ),
        valid_loops AS (
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance as total_distance_km,
                total_elevation as total_elevation_gain,
                path,
                edges,
                'loop' as route_shape,
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                calculate_route_similarity_score(
                    total_distance, $5,
                    total_elevation, $6
                ) as similarity_score
            FROM potential_loops
            GROUP BY start_node, end_node, total_distance, total_elevation, path, edges
        )
        SELECT * FROM valid_loops
        WHERE similarity_score >= get_min_route_score()
        ORDER BY similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema, staging_schema)
    USING min_distance, max_distance, min_elevation, max_elevation,
          target_distance_km, target_elevation_gain;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.find_simple_routes_with_logging(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, tolerance_percent double precision DEFAULT 30.0)
 RETURNS TABLE(route_id text, start_node integer, end_node integer, total_distance_km double precision, total_elevation_gain double precision, route_path integer[], route_edges integer[], route_shape text, trail_count integer, similarity_score double precision)
 LANGUAGE plpgsql
AS $function$
DECLARE
    min_distance float;
    max_distance float;
    min_elevation float;
    max_elevation float;
    edge_count integer;
    route_count integer;
BEGIN
    min_distance := target_distance_km * (1 - tolerance_percent / 100.0);
    max_distance := target_distance_km * (1 + tolerance_percent / 100.0);
    min_elevation := target_elevation_gain * (1 - tolerance_percent / 100.0);
    max_elevation := target_elevation_gain * (1 + tolerance_percent / 100.0);
    RAISE NOTICE 'Searching for routes: distance %.1f-%.1f km, elevation %.0f-%.0f m', 
        min_distance, max_distance, min_elevation, max_elevation;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges WHERE distance_km BETWEEN %s AND %s', 
        staging_schema, min_distance, max_distance) INTO edge_count;
    RAISE NOTICE 'Found % edges in distance range', edge_count;
    RETURN QUERY EXECUTE format($f$
        WITH simple_routes AS (
            SELECT 
                gen_random_uuid()::text as route_id,
                e1.source as start_node,
                e2.target as end_node,
                (e1.distance_km + e2.distance_km)::double precision as total_distance_km,
                (COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0))::double precision as total_elevation_gain,
                ARRAY[e1.source, e1.target, e2.target] as route_path,
                ARRAY[e1.id, e2.id] as route_edges,
                CASE 
                    WHEN e1.source = e2.target THEN 'loop'
                    ELSE 'out-and-back'
                END as route_shape,
                2 as trail_count,
                calculate_route_similarity_score(
                    e1.distance_km + e2.distance_km, $1,
                    COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0), $2
                ) as similarity_score
            FROM %I.routing_edges e1
            JOIN %I.routing_edges e2 ON e1.target = e2.source
            WHERE e1.distance_km + e2.distance_km BETWEEN $3 AND $4
              AND COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0) BETWEEN $5 AND $6
              AND e1.source != e2.target  -- Avoid self-loops
        ),
        valid_routes AS (
            SELECT * FROM simple_routes
            WHERE similarity_score >= get_min_route_score()
            ORDER BY similarity_score DESC
            LIMIT get_max_routes_per_bin()
        )
        SELECT * FROM valid_routes
    $f$, staging_schema, staging_schema)
    USING target_distance_km, target_elevation_gain, min_distance, max_distance, min_elevation, max_elevation;
    GET DIAGNOSTICS route_count = ROW_COUNT;
    RAISE NOTICE 'Generated % routes', route_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.find_srid(character varying, character varying, character varying)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE STRICT
AS $function$
DECLARE
	schem varchar =  $1;
	tabl varchar = $2;
	sr int4;
BEGIN
	IF ( schem = '' and strpos(tabl,'.') > 0 ) THEN
	 schem = substr(tabl,1,strpos(tabl,'.')-1);
	 tabl = substr(tabl,length(schem)+2);
	END IF;
	select SRID into sr from public.geometry_columns where (f_table_schema = schem or schem = '') and f_table_name = tabl and f_geometry_column = $3;
	IF NOT FOUND THEN
	   RAISE EXCEPTION 'find_srid() - could not find the corresponding SRID - is the geometry registered in the GEOMETRY_COLUMNS table?  Is there an uppercase/lowercase mismatch?';
	END IF;
	return sr;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_app_uuid()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.app_uuid IS NULL OR NEW.app_uuid = '' THEN
        NEW.app_uuid := gen_random_uuid();
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_route_name(route_edges integer[], route_shape text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  trail_names text[];
  unique_trail_names text[];
  route_name text;
BEGIN
  -- Extract unique trail names from route edges
  SELECT array_agg(DISTINCT trail_name ORDER BY trail_name) INTO trail_names
  FROM routing_edges 
  WHERE id = ANY(route_edges);
  
  -- Remove duplicates while preserving order
  SELECT array_agg(DISTINCT name ORDER BY name) INTO unique_trail_names
  FROM unnest(trail_names) AS name;
  
  -- Apply naming convention based on number of unique trails
  IF array_length(unique_trail_names, 1) = 1 THEN
    -- Single trail: use trail name directly
    route_name := unique_trail_names[1];
  ELSIF array_length(unique_trail_names, 1) = 2 THEN
    -- Two trails: {First Trail}/{Second Trail} Route
    route_name := unique_trail_names[1] || '/' || unique_trail_names[2] || ' Route';
  ELSE
    -- More than 2 trails: {First Trail}/{Last Trail} Route
    route_name := unique_trail_names[1] || '/' || unique_trail_names[array_length(unique_trail_names, 1)] || ' Route';
  END IF;
  
  -- Add route shape suffix if not already present
  IF route_name NOT LIKE '%' || route_shape || '%' THEN
    route_name := route_name || ' ' || route_shape;
  END IF;
  
  RETURN route_name;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_route_recommendations(staging_schema text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN generate_route_recommendations_configurable(staging_schema, 'boulder');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_route_recommendations_adaptive(staging_schema text, region_name text DEFAULT 'boulder'::text, min_routes_per_pattern integer DEFAULT 10, max_tolerance_percent integer DEFAULT 50)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    route_count integer := 0;
    pattern record;
    total_routes integer := 0;
    current_tolerance float;
    routes_found integer;
    max_iterations integer := 5; -- Prevent infinite loops
    iteration integer;
BEGIN
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.route_trails (
            id SERIAL PRIMARY KEY,
            route_uuid TEXT NOT NULL,
            trail_id TEXT NOT NULL,
            trail_name TEXT NOT NULL,
            segment_order INTEGER NOT NULL,
            segment_distance_km REAL CHECK(segment_distance_km > 0),
            segment_elevation_gain REAL CHECK(segment_elevation_gain >= 0),
            segment_elevation_loss REAL CHECK(segment_elevation_loss >= 0),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ', staging_schema);
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.route_recommendations (
            id SERIAL PRIMARY KEY,
            route_uuid TEXT UNIQUE NOT NULL,
            region TEXT NOT NULL,
            input_distance_km REAL CHECK(input_distance_km > 0),
            input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
            recommended_distance_km REAL CHECK(recommended_distance_km > 0),
            recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
            route_type TEXT,
            route_shape TEXT,
            trail_count INTEGER,
            route_score INTEGER,
            route_path JSONB,
            route_edges JSONB,
            route_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ', staging_schema);
    FOR pattern IN SELECT * FROM get_route_patterns() LOOP
        current_tolerance := pattern.tolerance_percent;
        routes_found := 0;
        iteration := 0;
        WHILE routes_found < min_routes_per_pattern AND iteration < max_iterations AND current_tolerance <= max_tolerance_percent LOOP
            EXECUTE format('DELETE FROM %I.route_recommendations 
            WHERE input_distance_km = $1 
              AND input_elevation_gain = $2
              AND route_shape = $3', staging_schema)
            USING pattern.target_distance_km, pattern.target_elevation_gain, pattern.route_shape;
            EXECUTE format('INSERT INTO %I.route_recommendations (
                route_uuid,
                region,
                input_distance_km,
                input_elevation_gain,
                recommended_distance_km,
                recommended_elevation_gain,
                route_type,
                route_shape,
                trail_count,
                route_score,
                route_path,
                route_edges,
                route_name,
                created_at
            )
            SELECT 
                r.route_id,
                $1 as region,
                $2,
                $3,
                r.total_distance_km,
                r.total_elevation_gain,
                ''similar_distance'' as route_type,
                r.route_shape,
                r.trail_count,
                (r.similarity_score * 100)::integer as route_score,
                json_build_object(
                    ''type'', ''LineString'',
                    ''coordinates'', array_agg(
                        json_build_array(n.lng, n.lat, n.elevation)
                        ORDER BY array_position(r.route_path, n.id)
                    )
                )::jsonb as route_path,
                json_agg(r.route_edges)::jsonb as route_edges,
                generate_route_name(r.route_edges, r.route_shape) as route_name,
                NOW() as created_at
            FROM find_routes_recursive_configurable($4, $2, $3, $5, $6) r
            JOIN %I.routing_nodes n ON n.id = ANY(r.route_path)
            WHERE r.route_shape = $7
              AND r.similarity_score >= get_min_route_score()  -- Use configurable minimum score
            GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                     r.route_shape, r.trail_count, r.similarity_score, r.route_edges', staging_schema, staging_schema)
            USING region_name, pattern.target_distance_km, pattern.target_elevation_gain, staging_schema, current_tolerance, 8, pattern.route_shape;
            GET DIAGNOSTICS routes_found = ROW_COUNT;
            IF routes_found > 0 THEN
                RAISE NOTICE 'Routes found in iteration % (tolerance: %%%) for pattern %:', 
                    iteration, current_tolerance - 10.0, pattern.pattern_name;
                DECLARE
                    route_detail RECORD;
                    route_query TEXT;
                BEGIN
                    route_query := format('
                        SELECT 
                            route_name,
                            recommended_distance_km,
                            recommended_elevation_gain,
                            ROUND(recommended_elevation_gain / recommended_distance_km, 1) as gain_rate_m_per_km,
                            route_shape,
                            trail_count,
                            route_score
                        FROM %I.route_recommendations 
                        WHERE input_distance_km = %s 
                          AND input_elevation_gain = %s 
                          AND route_shape = ''%s''
                        ORDER BY route_score DESC
                        LIMIT 5', 
                        staging_schema, 
                        pattern.target_distance_km, 
                        pattern.target_elevation_gain, 
                        pattern.route_shape);
                    FOR route_detail IN EXECUTE route_query LOOP
                        RAISE NOTICE '  - %: %.1fkm, %.0fm gain (%.1f m/km), % shape, % trails, score: %', 
                            route_detail.route_name,
                            route_detail.recommended_distance_km,
                            route_detail.recommended_elevation_gain,
                            route_detail.gain_rate_m_per_km,
                            route_detail.route_shape,
                            route_detail.trail_count,
                            route_detail.route_score;
                    END LOOP;
                END;
            END IF;
            EXECUTE format('INSERT INTO %I.route_trails (
                route_uuid,
                trail_id,
                trail_name,
                segment_order,
                segment_distance_km,
                segment_elevation_gain,
                segment_elevation_loss
            )
            SELECT 
                r.route_id,
                e.app_uuid,
                e.trail_name,
                ROW_NUMBER() OVER (PARTITION BY r.route_id ORDER BY array_position(r.route_path, e.source)) as segment_order,
                e.length_km,
                e.elevation_gain,
                e.elevation_loss
            FROM find_routes_recursive_configurable($1, $2, $3, $4, $5) r
            JOIN %I.routing_edges e ON e.id = ANY(r.route_edges)
            WHERE r.route_shape = $6
              AND r.similarity_score >= get_min_route_score()', staging_schema, staging_schema)
            USING staging_schema, pattern.target_distance_km, pattern.target_elevation_gain, current_tolerance, 8, pattern.route_shape;
            current_tolerance := current_tolerance + 10.0;
            iteration := iteration + 1;
            RAISE NOTICE 'Pattern: %, Iteration: %, Tolerance: %%%, Routes found: %', 
                pattern.pattern_name, iteration, current_tolerance - 10.0, routes_found;
        END LOOP;
        total_routes := total_routes + routes_found;
        RAISE NOTICE 'Final: Generated % routes for pattern: % (tolerance: %%%)', 
            routes_found, pattern.pattern_name, current_tolerance - 10.0;
    END LOOP;
    RAISE NOTICE '=== ROUTE GENERATION SUMMARY ===';
    RAISE NOTICE 'Total routes generated: %', total_routes;
    RAISE NOTICE 'Patterns processed: %', (SELECT COUNT(*) FROM route_patterns);
    RAISE NOTICE '================================';
    RETURN total_routes;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_route_recommendations_configurable(staging_schema text, region_name text DEFAULT 'boulder'::text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    route_count integer := 0;
    pattern record;
    total_routes integer := 0;
BEGIN
    -- Generate recommendations for each pattern from config
    FOR pattern IN SELECT * FROM get_route_patterns() LOOP
        INSERT INTO route_recommendations (
            route_uuid,
            region,
            input_distance_km,
            input_elevation_gain,
            recommended_distance_km,
            recommended_elevation_gain,
            route_type,
            route_shape,
            trail_count,
            route_score,
            route_path,
            route_edges,
            route_name,
            created_at
        )
        SELECT 
            r.route_id,
            region_name as region,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            r.total_distance_km,
            r.total_elevation_gain,
            'similar_distance' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            -- Convert path to GeoJSON (simplified) - FIXED: Use jsonb
            json_build_object(
                'type', 'LineString',
                'coordinates', array_agg(
                    json_build_array(lng, lat, elevation)
                    ORDER BY array_position(r.route_path, id)
                )
            )::jsonb as route_path,
            -- Convert edges to JSON array - FIXED: Use jsonb
            json_agg(r.route_edges)::jsonb as route_edges,
            -- Generate proper route name
            generate_route_name(r.route_edges, r.route_shape) as route_name,
            NOW() as created_at
        FROM find_routes_recursive_configurable(
            staging_schema,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            pattern.tolerance_percent,
            8
        ) r
        JOIN routing_nodes n ON n.id = ANY(r.route_path)
        WHERE r.route_shape = pattern.route_shape
          AND r.similarity_score >= get_min_route_score()  -- Use configurable minimum score
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.route_edges;
        
        -- Populate route_trails junction table with trail composition data
        INSERT INTO route_trails (
            route_uuid,
            trail_id,
            trail_name,
            segment_order,
            segment_distance_km,
            segment_elevation_gain,
            segment_elevation_loss
        )
        SELECT 
            r.route_id,
            e.app_uuid,
            e.trail_name,
            ROW_NUMBER() OVER (PARTITION BY r.route_id ORDER BY array_position(r.route_path, e.source)) as segment_order,
            e.length_km,
            e.elevation_gain,
            e.elevation_loss
        FROM find_routes_recursive_configurable(
            staging_schema,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            pattern.tolerance_percent,
            8
        ) r
        JOIN routing_edges e ON e.id = ANY(r.route_edges)
        WHERE r.route_shape = pattern.route_shape
          AND r.similarity_score >= get_min_route_score();
        
        GET DIAGNOSTICS route_count = ROW_COUNT;
        total_routes := total_routes + route_count;
        RAISE NOTICE 'Generated % routes for pattern: %', route_count, pattern.pattern_name;
    END LOOP;
    
    RETURN total_routes;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_route_recommendations_configurable(staging_schema text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    route_count integer := 0;
    pattern record;
    total_routes integer := 0;
BEGIN
    FOR pattern IN SELECT * FROM get_route_patterns() LOOP
        INSERT INTO route_recommendations (
            route_uuid,
            region,
            input_distance_km,
            input_elevation_gain,
            recommended_distance_km,
            recommended_elevation_gain,
            route_type,
            route_shape,
            trail_count,
            route_score,
            route_path,
            route_edges,
            route_name,
            created_at
        )
        SELECT 
            r.route_id,
            'boulder' as region,  -- TODO: Make this dynamic
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            r.total_distance_km,
            r.total_elevation_gain,
            'similar_distance' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            json_build_object(
                'type', 'LineString',
                'coordinates', array_agg(
                    json_build_array(n.lng, n.lat, n.elevation)
                    ORDER BY array_position(r.route_path, n.id)
                )
            )::text as route_path,
            json_agg(r.route_edges)::text as route_edges,
            generate_route_name(r.route_edges, r.route_shape) as route_name,
            NOW() as created_at
        FROM find_routes_recursive_configurable(
            staging_schema,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            pattern.tolerance_percent,
            8
        ) r
        JOIN routing_nodes n ON n.id = ANY(r.route_path)
        WHERE r.route_shape = pattern.route_shape
          AND r.similarity_score >= get_min_route_score()  -- Use configurable minimum score
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.route_edges;
        GET DIAGNOSTICS route_count = ROW_COUNT;
        total_routes := total_routes + route_count;
        RAISE NOTICE 'Generated % routes for pattern: %', route_count, pattern.pattern_name;
    END LOOP;
    RETURN total_routes;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_route_recommendations_large_dataset(staging_schema text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    route_count integer := 0;
    pattern record;
    total_routes integer := 0;
BEGIN
    FOR pattern IN SELECT * FROM get_route_patterns() LOOP
        INSERT INTO route_recommendations (
            route_uuid,
            region,
            input_distance_km,
            input_elevation_gain,
            recommended_distance_km,
            recommended_elevation_gain,
            route_type,
            route_shape,
            trail_count,
            route_score,
            route_path,
            route_edges,
            route_name,
            created_at
        )
        SELECT 
            r.route_id,
            'boulder' as region,  -- TODO: Make this dynamic
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            r.total_distance_km,
            r.total_elevation_gain,
            'similar_distance' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            json_build_object(
                'type', 'LineString',
                'coordinates', array_agg(
                    json_build_array(n.lng, n.lat, n.elevation)
                    ORDER BY array_position(r.route_path, n.id)
                )
            )::text as route_path,
            json_agg(r.route_edges)::text as route_edges,
            generate_route_name(r.route_edges, r.route_shape) as route_name,
            NOW() as created_at
        FROM find_routes_recursive_configurable(
            staging_schema,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            pattern.tolerance_percent,
            12  -- Increased max depth for large datasets
        ) r
        JOIN routing_nodes n ON n.id = ANY(r.route_path)
        WHERE r.route_shape = pattern.route_shape
          AND r.similarity_score >= 0.3  -- Lower threshold for large datasets
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.route_edges;
        GET DIAGNOSTICS route_count = ROW_COUNT;
        total_routes := total_routes + route_count;
        RAISE NOTICE 'Generated % routes for pattern: %', route_count, pattern.pattern_name;
    END LOOP;
    RETURN total_routes;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_route_recommendations_large_dataset(staging_schema text, region_name text DEFAULT 'boulder'::text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    route_count integer := 0;
    pattern record;
    total_routes integer := 0;
BEGIN
    FOR pattern IN SELECT * FROM get_route_patterns() LOOP
        INSERT INTO route_recommendations (
            route_uuid,
            region,
            input_distance_km,
            input_elevation_gain,
            recommended_distance_km,
            recommended_elevation_gain,
            route_type,
            route_shape,
            trail_count,
            route_score,
            route_path,
            route_edges,
            route_name,
            created_at
        )
        SELECT 
            r.route_id,
            region_name as region,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            r.total_distance_km,
            r.total_elevation_gain,
            'similar_distance' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            json_build_object(
                'type', 'LineString',
                'coordinates', array_agg(
                    json_build_array(n.lng, n.lat, n.elevation)
                    ORDER BY array_position(r.route_path, n.id)
                )
            ) as route_path,
            json_agg(r.route_edges) as route_edges,
            generate_route_name(r.route_edges, r.route_shape) as route_name,
            NOW() as created_at
        FROM find_routes_recursive_configurable(
            staging_schema,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            pattern.tolerance_percent,
            12  -- Increased max depth for large datasets
        ) r
        JOIN routing_nodes n ON n.id = ANY(r.route_path)
        WHERE r.route_shape = pattern.route_shape
          AND r.similarity_score >= 0.3  -- Lower threshold for large datasets
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.route_edges;
        GET DIAGNOSTICS route_count = ROW_COUNT;
        total_routes := total_routes + route_count;
        RAISE NOTICE 'Generated % routes for pattern: %', route_count, pattern.pattern_name;
    END LOOP;
    RETURN total_routes;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_routing_edges_native(staging_schema text, tolerance_meters real DEFAULT 2.0)
 RETURNS TABLE(edge_count integer, success boolean, message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    edge_count_var integer := 0;
    node_count_var integer := 0;
    max_node_id_var integer := 0;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Get node count and max node ID for validation
    EXECUTE format('SELECT COUNT(*), MAX(id) FROM %I.routing_nodes', staging_schema) INTO node_count_var, max_node_id_var;
    
    -- Validate that we have nodes to work with
    IF node_count_var = 0 THEN
        RETURN QUERY SELECT 
            0, false, 
            'No routing nodes available for edge generation' as message;
        RETURN;
    END IF;
    
    -- Generate routing edges from trail segments with improved validation
    EXECUTE format($f$
        INSERT INTO %I.routing_edges (id, app_uuid, name, trail_type, length_km, elevation_gain, elevation_loss, geom, source, target)
        SELECT 
            nextval('routing_edges_id_seq') as id,
            t.app_uuid,
            t.name,
            t.trail_type,
            t.length_km,
            t.elevation_gain,
            t.elevation_loss,
            t.geometry as geom,
            source_node.id as source,
            target_node.id as target
        FROM %I.trails t
        CROSS JOIN LATERAL (
            SELECT id FROM %I.routing_nodes 
            WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_StartPoint(t.geometry), $1)
              AND id IS NOT NULL
              AND id <= $2  -- Ensure node ID is within valid range
            ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_StartPoint(t.geometry))
            LIMIT 1
        ) source_node
        CROSS JOIN LATERAL (
            SELECT id FROM %I.routing_nodes 
            WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_EndPoint(t.geometry), $1)
              AND id IS NOT NULL
              AND id <= $2  -- Ensure node ID is within valid range
            ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_EndPoint(t.geometry))
            LIMIT 1
        ) target_node
        WHERE t.geometry IS NOT NULL 
          AND ST_IsValid(t.geometry) 
          AND t.length_km IS NOT NULL AND t.length_km > 0
          AND ST_Length(t.geometry) > 0
          AND ST_NumPoints(t.geometry) >= 2
          AND source_node.id IS NOT NULL
          AND target_node.id IS NOT NULL
          AND source_node.id <= $2  -- Double-check source node ID
          AND target_node.id <= $2  -- Double-check target node ID
    $f$, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_meters, max_node_id_var;
    
    GET DIAGNOSTICS edge_count_var = ROW_COUNT;
    
    -- Validate that no orphaned edges were created
    EXECUTE format($f$
        SELECT COUNT(*) FROM %I.routing_edges e
        WHERE e.source NOT IN (SELECT id FROM %I.routing_nodes)
           OR e.target NOT IN (SELECT id FROM %I.routing_nodes)
    $f$, staging_schema, staging_schema) INTO edge_count_var;
    
    IF edge_count_var > 0 THEN
        RETURN QUERY SELECT 
            0, false, 
            format('Validation failed: %s edges reference non-existent nodes', edge_count_var) as message;
        RETURN;
    END IF;
    
    -- Get final edge count
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count_var;
    
    -- Return results
    RETURN QUERY SELECT 
        edge_count_var,
        true as success,
        format('Successfully generated %s routing edges from %s nodes (max node ID: %s)', 
               edge_count_var, node_count_var, max_node_id_var) as message;
    
    RAISE NOTICE 'Generated % routing edges from % nodes (max node ID: %)', 
                 edge_count_var, node_count_var, max_node_id_var;
        
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing edges generation: %s', SQLERRM) as message;
    
    RAISE NOTICE 'Error during routing edges generation: %', SQLERRM;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_routing_edges_native_v2(staging_schema text, tolerance_meters real DEFAULT 0.5)
 RETURNS TABLE(edge_count integer, success boolean, message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    edge_count_var integer := 0;
    node_count_var integer := 0;
    orphaned_count integer := 0;
    orphaned_edges_count integer := 0;
    tolerance_degrees real := tolerance_meters / 111000.0;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Get node count for validation
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count_var;
    
    -- Generate routing edges from actual trail segments (simplified version)
    EXECUTE format($f$
        INSERT INTO %I.routing_edges (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry, geojson)
        SELECT 
            start_node.id as source, 
            end_node.id as target, 
            t.app_uuid as trail_id, 
            t.name as trail_name, 
            t.length_km as length_km, 
            t.elevation_gain, 
            t.elevation_loss, 
            t.geometry, 
            ST_AsGeoJSON(t.geometry, 6, 0) as geojson 
        FROM %I.trails t
        JOIN %I.routing_nodes start_node ON ST_DWithin(ST_StartPoint(t.geometry), ST_SetSRID(ST_MakePoint(start_node.lng, start_node.lat), 4326), %L)
        JOIN %I.routing_nodes end_node ON ST_DWithin(ST_EndPoint(t.geometry), ST_SetSRID(ST_MakePoint(end_node.lng, end_node.lat), 4326), %L)
        WHERE t.geometry IS NOT NULL 
        AND ST_IsValid(t.geometry) 
        AND t.length_km > 0
        AND start_node.id IS NOT NULL 
        AND end_node.id IS NOT NULL
        AND start_node.id <> end_node.id
    $f$, staging_schema, staging_schema, staging_schema, tolerance_degrees, staging_schema, tolerance_degrees);
    
    GET DIAGNOSTICS edge_count_var = ROW_COUNT;
    
    -- Clean up orphaned nodes (nodes that have no edges)
    EXECUTE format($f$
        DELETE FROM %I.routing_nodes 
        WHERE id NOT IN (
            SELECT DISTINCT source FROM %I.routing_edges 
            UNION 
            SELECT DISTINCT target FROM %I.routing_edges
        )
    $f$, staging_schema, staging_schema, staging_schema, staging_schema);
    
    GET DIAGNOSTICS orphaned_count = ROW_COUNT;
    
    -- Clean up orphaned edges (edges that point to non-existent nodes)
    EXECUTE format($f$
        DELETE FROM %I.routing_edges 
        WHERE source NOT IN (SELECT id FROM %I.routing_nodes) 
        OR target NOT IN (SELECT id FROM %I.routing_nodes)
    $f$, staging_schema, staging_schema, staging_schema, staging_schema);
    
    GET DIAGNOSTICS orphaned_edges_count = ROW_COUNT;
    
    RETURN QUERY SELECT 
        edge_count_var,
        true as success,
        format('Generated %s routing edges from %s nodes, cleaned up %s orphaned nodes and %s orphaned edges (v2, routable only, tolerance: %s m)', edge_count_var, node_count_var, orphaned_count, orphaned_edges_count, tolerance_meters) as message;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing edges generation (v2): %s', SQLERRM) as message;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_routing_nodes_native(staging_schema text, intersection_tolerance_meters real DEFAULT 2.0)
 RETURNS TABLE(node_count integer, success boolean, message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    node_count_var integer := 0;
    tolerance_degrees real := intersection_tolerance_meters / 111000.0;
BEGIN
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, created_at)
        WITH valid_trails AS (
            SELECT app_uuid, name, geometry
            FROM %I.trails 
            WHERE geometry IS NOT NULL 
            AND ST_IsValid(geometry)
            AND ST_Length(geometry) > 0
        ),
        trail_endpoints AS (
            SELECT 
                app_uuid,
                name,
                ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point,
                ST_Z(ST_StartPoint(geometry)) as start_elevation,
                ST_Z(ST_EndPoint(geometry)) as end_elevation
            FROM valid_trails
        ),
        all_endpoints AS (
            SELECT 
                app_uuid,
                name,
                start_point as point,
                start_elevation as elevation,
                'endpoint' as node_type,
                name as connected_trails
            FROM trail_endpoints
            UNION ALL
            SELECT 
                app_uuid,
                name,
                end_point as point,
                end_elevation as elevation,
                'endpoint' as node_type,
                name as connected_trails
            FROM trail_endpoints
        ),
        unique_nodes AS (
            SELECT DISTINCT
                point,
                elevation,
                node_type,
                connected_trails
            FROM all_endpoints
            WHERE point IS NOT NULL
        ),
        clustered_nodes AS (
            SELECT 
                point as clustered_point,
                elevation,
                node_type,
                connected_trails
            FROM unique_nodes
            WHERE point IS NOT NULL
        )
        SELECT 
            ROW_NUMBER() OVER (ORDER BY ST_X(clustered_point), ST_Y(clustered_point)) as id,
            gen_random_uuid() as node_uuid,
            ST_Y(clustered_point) as lat,
            ST_X(clustered_point) as lng,
            elevation,
            node_type,
            connected_trails,
            NOW() as created_at
        FROM clustered_nodes
        WHERE clustered_point IS NOT NULL
    $f$, staging_schema, staging_schema);
    GET DIAGNOSTICS node_count_var = ROW_COUNT;
    RETURN QUERY SELECT 
        node_count_var,
        true as success,
        format('Generated %s routing nodes (routable only, tolerance: %s m)', node_count_var, intersection_tolerance_meters) as message;
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing nodes generation: %s', SQLERRM) as message;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_routing_nodes_native_v2(staging_schema text, intersection_tolerance_meters real DEFAULT 2.0)
 RETURNS TABLE(node_count integer, success boolean, message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    node_count_var integer := 0;
    tolerance_degrees real := intersection_tolerance_meters / 111000.0;
BEGIN
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, created_at)
        WITH valid_trails AS (
            SELECT app_uuid, name, geometry
            FROM %I.trails 
            WHERE geometry IS NOT NULL 
            AND ST_IsValid(geometry)
            AND ST_Length(geometry) > 0
        ),
        trail_endpoints AS (
            SELECT 
                app_uuid,
                name,
                ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point,
                ST_Z(ST_StartPoint(geometry)) as start_elevation,
                ST_Z(ST_EndPoint(geometry)) as end_elevation
            FROM valid_trails
        ),
        all_endpoints AS (
            SELECT 
                app_uuid,
                name,
                start_point as point,
                start_elevation as elevation,
                'endpoint' as node_type,
                name as connected_trails
            FROM trail_endpoints
            UNION ALL
            SELECT 
                app_uuid,
                name,
                end_point as point,
                end_elevation as elevation,
                'endpoint' as node_type,
                name as connected_trails
            FROM trail_endpoints
        ),
        unique_nodes AS (
            SELECT DISTINCT
                point,
                elevation,
                node_type,
                connected_trails
            FROM all_endpoints
            WHERE point IS NOT NULL
        ),
        clustered_nodes AS (
            SELECT 
                point as clustered_point,
                elevation,
                node_type,
                connected_trails
            FROM unique_nodes
            WHERE point IS NOT NULL
        )
        SELECT 
            ROW_NUMBER() OVER (ORDER BY ST_X(clustered_point), ST_Y(clustered_point)) as id,
            gen_random_uuid() as node_uuid,
            ST_Y(clustered_point) as lat,
            ST_X(clustered_point) as lng,
            elevation,
            node_type,
            connected_trails,
            NOW() as created_at
        FROM clustered_nodes
        WHERE clustered_point IS NOT NULL
    $f$, staging_schema, staging_schema);
    GET DIAGNOSTICS node_count_var = ROW_COUNT;
    RETURN QUERY SELECT 
        node_count_var,
        true as success,
        format('Generated %s routing nodes (v2, routable only, tolerance: %s m)', node_count_var, intersection_tolerance_meters) as message;
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing nodes generation (v2): %s', SQLERRM) as message;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_routing_nodes_native_v2_with_trail_ids(staging_schema text, intersection_tolerance_meters real DEFAULT 2.0)
 RETURNS TABLE(node_count integer, success boolean, message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    node_count_var integer := 0;
    tolerance_degrees real := intersection_tolerance_meters / 111000.0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Generate routing nodes from actual trail endpoints and intersections with trail_ids
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids, created_at)
        WITH valid_trails AS (
            SELECT app_uuid, name, geometry
            FROM %I.trails 
            WHERE geometry IS NOT NULL 
            AND ST_IsValid(geometry)
            AND ST_Length(geometry) > 0
        ),
        trail_endpoints AS (
            SELECT 
                app_uuid,
                name,
                ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point,
                ST_Z(ST_StartPoint(geometry)) as start_elevation,
                ST_Z(ST_EndPoint(geometry)) as end_elevation
            FROM valid_trails
        ),
        all_endpoints AS (
            SELECT 
                app_uuid,
                name,
                start_point as point,
                start_elevation as elevation,
                'endpoint' as node_type,
                name as connected_trails,
                ARRAY[app_uuid] as trail_ids
            FROM trail_endpoints
            UNION ALL
            SELECT 
                app_uuid,
                name,
                end_point as point,
                end_elevation as elevation,
                'endpoint' as node_type,
                name as connected_trails,
                ARRAY[app_uuid] as trail_ids
            FROM trail_endpoints
        ),
        intersection_points AS (
            -- Get intersection points from detect_trail_intersections function
            -- Convert integer trail IDs to text UUIDs by looking them up
            SELECT 
                ip.intersection_point as point,
                COALESCE(ST_Z(ip.intersection_point_3d), 0) as elevation,
                'intersection' as node_type,
                array_to_string(ip.connected_trail_names, ',') as connected_trails,
                array_agg(t.app_uuid) as trail_ids
            FROM detect_trail_intersections($1, 'trails', $2) ip
            JOIN %I.trails t ON t.id = ANY(ip.connected_trail_ids)
            WHERE array_length(ip.connected_trail_ids, 1) > 1
            GROUP BY ip.intersection_point, ip.intersection_point_3d, ip.connected_trail_names
        ),
        all_nodes AS (
            SELECT point, elevation, node_type, connected_trails, trail_ids
            FROM all_endpoints
            WHERE point IS NOT NULL
            UNION ALL
            SELECT point, elevation, node_type, connected_trails, trail_ids
            FROM intersection_points
            WHERE point IS NOT NULL
        ),
        unique_nodes AS (
            SELECT DISTINCT
                point,
                elevation,
                node_type,
                connected_trails,
                trail_ids
            FROM all_nodes
            WHERE point IS NOT NULL
        ),
        clustered_nodes AS (
            SELECT 
                point as clustered_point,
                elevation,
                node_type,
                connected_trails,
                trail_ids
            FROM unique_nodes
            WHERE point IS NOT NULL
        )
        SELECT 
            ROW_NUMBER() OVER (ORDER BY ST_X(clustered_point), ST_Y(clustered_point)) as id,
            gen_random_uuid() as node_uuid,
            ST_Y(clustered_point) as lat,
            ST_X(clustered_point) as lng,
            elevation,
            node_type,
            connected_trails,
            trail_ids,
            NOW() as created_at
        FROM clustered_nodes
        WHERE clustered_point IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema)
    USING staging_schema, intersection_tolerance_meters;
    
    GET DIAGNOSTICS node_count_var = ROW_COUNT;
    
    RETURN QUERY SELECT 
        node_count_var,
        true as success,
        format('Generated %s routing nodes with trail_ids (v2, routable only, tolerance: %s m)', node_count_var, intersection_tolerance_meters) as message;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing nodes generation with trail_ids (v2): %s', SQLERRM) as message;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_simple_route_recommendations(staging_schema text, region_name text DEFAULT 'boulder'::text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    pattern record;
    routes_found integer := 0;
    total_routes integer := 0;
BEGIN
    RAISE NOTICE 'Starting simple route generation for region: %', region_name;
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.route_recommendations (
            id SERIAL PRIMARY KEY,
            route_uuid TEXT UNIQUE NOT NULL,
            region TEXT NOT NULL,
            input_distance_km REAL CHECK(input_distance_km > 0),
            input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
            recommended_distance_km REAL CHECK(recommended_distance_km > 0),
            recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
            route_type TEXT,
            route_shape TEXT,
            trail_count INTEGER,
            route_score INTEGER,
            route_path JSONB,
            route_edges JSONB,
            route_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ', staging_schema);
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.route_trails (
            id SERIAL PRIMARY KEY,
            route_uuid TEXT NOT NULL,
            trail_id TEXT NOT NULL,
            trail_name TEXT NOT NULL,
            segment_order INTEGER NOT NULL,
            segment_distance_km REAL CHECK(segment_distance_km > 0),
            segment_elevation_gain REAL CHECK(segment_elevation_gain >= 0),
            segment_elevation_loss REAL CHECK(segment_elevation_loss >= 0),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ', staging_schema);
    EXECUTE format('DELETE FROM %I.route_recommendations', staging_schema);
    EXECUTE format('DELETE FROM %I.route_trails', staging_schema);
    FOR pattern IN SELECT * FROM route_patterns WHERE pattern_name LIKE '%Loop%' OR pattern_name LIKE '%Out-and-Back%' ORDER BY target_distance_km LOOP
        RAISE NOTICE 'Processing pattern: % (%.1f km, %.0f m)', 
            pattern.pattern_name, pattern.target_distance_km, pattern.target_elevation_gain;
        EXECUTE format('
            INSERT INTO %I.route_recommendations (
                route_uuid, region, input_distance_km, input_elevation_gain,
                recommended_distance_km, recommended_elevation_gain, route_type,
                route_shape, trail_count, route_score, route_path, route_edges, route_name
            )
            SELECT 
                r.route_id,
                $1 as region,
                $2 as input_distance_km,
                $3 as input_elevation_gain,
                r.total_distance_km,
                r.total_elevation_gain,
                ''similar_distance'' as route_type,
                r.route_shape,
                r.trail_count,
                (r.similarity_score * 100)::integer as route_score,
                json_build_object(
                    ''type'', ''LineString'',
                    ''coordinates'', array_agg(
                        json_build_array(n.lng, n.lat, n.elevation)
                        ORDER BY array_position(r.route_path, n.id)
                    )
                )::jsonb as route_path,
                json_agg(r.route_edges)::jsonb as route_edges,
                ''Generated Route '' || r.route_id as route_name
            FROM find_simple_routes_with_logging($4, $2, $3, $5) r
            JOIN %I.routing_nodes n ON n.id = ANY(r.route_path)
            WHERE r.route_shape = $6
            GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain,
                     r.route_shape, r.trail_count, r.similarity_score, r.route_edges
        ', staging_schema, staging_schema)
        USING region_name, pattern.target_distance_km, pattern.target_elevation_gain, 
              staging_schema, pattern.tolerance_percent, pattern.route_shape;
        GET DIAGNOSTICS routes_found = ROW_COUNT;
        total_routes := total_routes + routes_found;
        RAISE NOTICE 'Found % routes for pattern %', routes_found, pattern.pattern_name;
    END LOOP;
    RAISE NOTICE 'Total routes generated: %', total_routes;
    RETURN total_routes;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.geog_brin_inclusion_add_value(internal, internal, internal, internal)
 RETURNS boolean
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$geog_brin_inclusion_add_value$function$
;

CREATE OR REPLACE FUNCTION public.geog_brin_inclusion_merge(internal, internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$geog_brin_inclusion_merge$function$
;

CREATE OR REPLACE FUNCTION public.geography(geography, integer, boolean)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_enforce_typmod$function$
;

CREATE OR REPLACE FUNCTION public.geography(bytea)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_from_binary$function$
;

CREATE OR REPLACE FUNCTION public.geography(geometry)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_from_geometry$function$
;

CREATE OR REPLACE FUNCTION public.geography_analyze(internal)
 RETURNS boolean
 LANGUAGE c
 STRICT
AS '$libdir/postgis-3', $function$gserialized_analyze_nd$function$
;

CREATE OR REPLACE FUNCTION public.geography_cmp(geography, geography)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_cmp$function$
;

CREATE OR REPLACE FUNCTION public.geography_distance_knn(geography, geography)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 100
AS '$libdir/postgis-3', $function$geography_distance_knn$function$
;

CREATE OR REPLACE FUNCTION public.geography_eq(geography, geography)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_eq$function$
;

CREATE OR REPLACE FUNCTION public.geography_ge(geography, geography)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_ge$function$
;

CREATE OR REPLACE FUNCTION public.geography_gist_compress(internal)
 RETURNS internal
 LANGUAGE c
AS '$libdir/postgis-3', $function$gserialized_gist_compress$function$
;

CREATE OR REPLACE FUNCTION public.geography_gist_consistent(internal, geography, integer)
 RETURNS boolean
 LANGUAGE c
AS '$libdir/postgis-3', $function$gserialized_gist_consistent$function$
;

CREATE OR REPLACE FUNCTION public.geography_gist_decompress(internal)
 RETURNS internal
 LANGUAGE c
AS '$libdir/postgis-3', $function$gserialized_gist_decompress$function$
;

CREATE OR REPLACE FUNCTION public.geography_gist_distance(internal, geography, integer)
 RETURNS double precision
 LANGUAGE c
AS '$libdir/postgis-3', $function$gserialized_gist_geog_distance$function$
;

CREATE OR REPLACE FUNCTION public.geography_gist_penalty(internal, internal, internal)
 RETURNS internal
 LANGUAGE c
AS '$libdir/postgis-3', $function$gserialized_gist_penalty$function$
;

CREATE OR REPLACE FUNCTION public.geography_gist_picksplit(internal, internal)
 RETURNS internal
 LANGUAGE c
AS '$libdir/postgis-3', $function$gserialized_gist_picksplit$function$
;

CREATE OR REPLACE FUNCTION public.geography_gist_same(box2d, box2d, internal)
 RETURNS internal
 LANGUAGE c
AS '$libdir/postgis-3', $function$gserialized_gist_same$function$
;

CREATE OR REPLACE FUNCTION public.geography_gist_union(bytea, internal)
 RETURNS internal
 LANGUAGE c
AS '$libdir/postgis-3', $function$gserialized_gist_union$function$
;

CREATE OR REPLACE FUNCTION public.geography_gt(geography, geography)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_gt$function$
;

CREATE OR REPLACE FUNCTION public.geography_in(cstring, oid, integer)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_in$function$
;

CREATE OR REPLACE FUNCTION public.geography_le(geography, geography)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_le$function$
;

CREATE OR REPLACE FUNCTION public.geography_lt(geography, geography)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_lt$function$
;

CREATE OR REPLACE FUNCTION public.geography_out(geography)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_out$function$
;

CREATE OR REPLACE FUNCTION public.geography_overlaps(geography, geography)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_overlaps$function$
;

CREATE OR REPLACE FUNCTION public.geography_recv(internal, oid, integer)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_recv$function$
;

CREATE OR REPLACE FUNCTION public.geography_send(geography)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_send$function$
;

CREATE OR REPLACE FUNCTION public.geography_spgist_choose_nd(internal, internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_choose_nd$function$
;

CREATE OR REPLACE FUNCTION public.geography_spgist_compress_nd(internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_compress_nd$function$
;

CREATE OR REPLACE FUNCTION public.geography_spgist_config_nd(internal, internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_config_nd$function$
;

CREATE OR REPLACE FUNCTION public.geography_spgist_inner_consistent_nd(internal, internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_inner_consistent_nd$function$
;

CREATE OR REPLACE FUNCTION public.geography_spgist_leaf_consistent_nd(internal, internal)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_leaf_consistent_nd$function$
;

CREATE OR REPLACE FUNCTION public.geography_spgist_picksplit_nd(internal, internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_picksplit_nd$function$
;

CREATE OR REPLACE FUNCTION public.geography_typmod_in(cstring[])
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_typmod_in$function$
;

CREATE OR REPLACE FUNCTION public.geography_typmod_out(integer)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$postgis_typmod_out$function$
;

CREATE OR REPLACE FUNCTION public.geom2d_brin_inclusion_add_value(internal, internal, internal, internal)
 RETURNS boolean
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$geom2d_brin_inclusion_add_value$function$
;

CREATE OR REPLACE FUNCTION public.geom2d_brin_inclusion_merge(internal, internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$geom2d_brin_inclusion_merge$function$
;

CREATE OR REPLACE FUNCTION public.geom3d_brin_inclusion_add_value(internal, internal, internal, internal)
 RETURNS boolean
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$geom3d_brin_inclusion_add_value$function$
;

CREATE OR REPLACE FUNCTION public.geom3d_brin_inclusion_merge(internal, internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$geom3d_brin_inclusion_merge$function$
;

CREATE OR REPLACE FUNCTION public.geom4d_brin_inclusion_add_value(internal, internal, internal, internal)
 RETURNS boolean
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$geom4d_brin_inclusion_add_value$function$
;

CREATE OR REPLACE FUNCTION public.geom4d_brin_inclusion_merge(internal, internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$geom4d_brin_inclusion_merge$function$
;

CREATE OR REPLACE FUNCTION public.geometry(text)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$parse_WKT_lwgeom$function$
;

CREATE OR REPLACE FUNCTION public.geometry(point)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$point_to_geometry$function$
;

CREATE OR REPLACE FUNCTION public.geometry(geometry, integer, boolean)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geometry_enforce_typmod$function$
;

CREATE OR REPLACE FUNCTION public.geometry(geography)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geometry_from_geography$function$
;

CREATE OR REPLACE FUNCTION public.geometry(box2d)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$BOX2D_to_LWGEOM$function$
;

CREATE OR REPLACE FUNCTION public.geometry(path)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$path_to_geometry$function$
;

CREATE OR REPLACE FUNCTION public.geometry(polygon)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$polygon_to_geometry$function$
;

CREATE OR REPLACE FUNCTION public.geometry(box3d)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$BOX3D_to_LWGEOM$function$
;

CREATE OR REPLACE FUNCTION public.geometry(bytea)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_from_bytea$function$
;

CREATE OR REPLACE FUNCTION public.geometry_above(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_above_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_analyze(internal)
 RETURNS boolean
 LANGUAGE c
 STRICT
AS '$libdir/postgis-3', $function$gserialized_analyze_nd$function$
;

CREATE OR REPLACE FUNCTION public.geometry_below(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_below_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_cmp(geom1 geometry, geom2 geometry)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$lwgeom_cmp$function$
;

CREATE OR REPLACE FUNCTION public.geometry_contained_3d(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_contained_3d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_contained_by_raster(geometry, raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1 OPERATOR(public.@) $2::public.geometry$function$
;

CREATE OR REPLACE FUNCTION public.geometry_contains(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_contains_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_contains_3d(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_contains_3d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_contains_nd(geometry, geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_contains$function$
;

CREATE OR REPLACE FUNCTION public.geometry_distance_box(geom1 geometry, geom2 geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_distance_box_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_distance_centroid(geom1 geometry, geom2 geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_Distance$function$
;

CREATE OR REPLACE FUNCTION public.geometry_distance_centroid_nd(geometry, geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_distance_nd$function$
;

CREATE OR REPLACE FUNCTION public.geometry_distance_cpa(geometry, geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_DistanceCPA$function$
;

CREATE OR REPLACE FUNCTION public.geometry_eq(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$lwgeom_eq$function$
;

CREATE OR REPLACE FUNCTION public.geometry_ge(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$lwgeom_ge$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_compress_2d(internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_compress_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_compress_nd(internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_compress$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_consistent_2d(internal, geometry, integer)
 RETURNS boolean
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_consistent_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_consistent_nd(internal, geometry, integer)
 RETURNS boolean
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_consistent$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_decompress_2d(internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_decompress_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_decompress_nd(internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_decompress$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_distance_2d(internal, geometry, integer)
 RETURNS double precision
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_distance_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_distance_nd(internal, geometry, integer)
 RETURNS double precision
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_distance$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_penalty_2d(internal, internal, internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_penalty_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_penalty_nd(internal, internal, internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_penalty$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_picksplit_2d(internal, internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_picksplit_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_picksplit_nd(internal, internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_picksplit$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_same_2d(geom1 geometry, geom2 geometry, internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_same_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_same_nd(geometry, geometry, internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_same$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_sortsupport_2d(internal)
 RETURNS void
 LANGUAGE c
 STRICT
AS '$libdir/postgis-3', $function$gserialized_gist_sortsupport_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_union_2d(bytea, internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_union_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gist_union_nd(bytea, internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_union$function$
;

CREATE OR REPLACE FUNCTION public.geometry_gt(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$lwgeom_gt$function$
;

CREATE OR REPLACE FUNCTION public.geometry_hash(geometry)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$lwgeom_hash$function$
;

CREATE OR REPLACE FUNCTION public.geometry_in(cstring)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_in$function$
;

CREATE OR REPLACE FUNCTION public.geometry_le(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$lwgeom_le$function$
;

CREATE OR REPLACE FUNCTION public.geometry_left(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_left_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_lt(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$lwgeom_lt$function$
;

CREATE OR REPLACE FUNCTION public.geometry_neq(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$lwgeom_neq$function$
;

CREATE OR REPLACE FUNCTION public.geometry_out(geometry)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_out$function$
;

CREATE OR REPLACE FUNCTION public.geometry_overabove(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_overabove_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_overbelow(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_overbelow_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_overlaps(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_overlaps_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_overlaps_3d(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_overlaps_3d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_overlaps_nd(geometry, geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_overlaps$function$
;

CREATE OR REPLACE FUNCTION public.geometry_overleft(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_overleft_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_overright(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_overright_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_raster_contain(geometry, raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1 OPERATOR(public.~) $2::public.geometry$function$
;

CREATE OR REPLACE FUNCTION public.geometry_raster_overlap(geometry, raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1 OPERATOR(public.&&) $2::public.geometry$function$
;

CREATE OR REPLACE FUNCTION public.geometry_recv(internal)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_recv$function$
;

CREATE OR REPLACE FUNCTION public.geometry_right(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_right_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_same(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_same_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_same_3d(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_same_3d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_same_nd(geometry, geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_same$function$
;

CREATE OR REPLACE FUNCTION public.geometry_send(geometry)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_send$function$
;

CREATE OR REPLACE FUNCTION public.geometry_sortsupport(internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$lwgeom_sortsupport$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_choose_2d(internal, internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_choose_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_choose_3d(internal, internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_choose_3d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_choose_nd(internal, internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_choose_nd$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_compress_2d(internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_compress_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_compress_3d(internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_compress_3d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_compress_nd(internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_compress_nd$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_config_2d(internal, internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_config_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_config_3d(internal, internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_config_3d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_config_nd(internal, internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_config_nd$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_inner_consistent_2d(internal, internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_inner_consistent_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_inner_consistent_3d(internal, internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_inner_consistent_3d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_inner_consistent_nd(internal, internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_inner_consistent_nd$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_leaf_consistent_2d(internal, internal)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_leaf_consistent_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_leaf_consistent_3d(internal, internal)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_leaf_consistent_3d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_leaf_consistent_nd(internal, internal)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_leaf_consistent_nd$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_picksplit_2d(internal, internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_picksplit_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_picksplit_3d(internal, internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_picksplit_3d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_spgist_picksplit_nd(internal, internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_spgist_picksplit_nd$function$
;

CREATE OR REPLACE FUNCTION public.geometry_typmod_in(cstring[])
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geometry_typmod_in$function$
;

CREATE OR REPLACE FUNCTION public.geometry_typmod_out(integer)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$postgis_typmod_out$function$
;

CREATE OR REPLACE FUNCTION public.geometry_within(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_within_2d$function$
;

CREATE OR REPLACE FUNCTION public.geometry_within_nd(geometry, geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_within$function$
;

CREATE OR REPLACE FUNCTION public.geometrytype(geography)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_getTYPE$function$
;

CREATE OR REPLACE FUNCTION public.geometrytype(geometry)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_getTYPE$function$
;

CREATE OR REPLACE FUNCTION public.geomfromewkb(bytea)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOMFromEWKB$function$
;

CREATE OR REPLACE FUNCTION public.geomfromewkt(text)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$parse_WKT_lwgeom$function$
;

CREATE OR REPLACE FUNCTION public.get_batch_size()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN (get_carthorse_config() ->> 'batch_size')::integer;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_carthorse_config()
 RETURNS json
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN json_build_object(
        'intersection_tolerance', 2,
        'edge_tolerance', 2,
        'simplify_tolerance', 0.001,
        'batch_size', 1000,
        'timeout_ms', 30000,
        'min_trail_length_meters', 1,
        'max_trail_length_meters', 100000,
        'min_elevation_meters', 0,
        'max_elevation_meters', 9000,
        'min_coordinate_points', 2,
        'max_coordinate_points', 10000,
        'max_routes_per_bin', 10,
        'min_route_score', 0.3,
        'min_route_distance_km', 1,
        'max_route_distance_km', 20,
        'min_elevation_gain_meters', 10,
        'max_elevation_gain_meters', 5000,
        'distance_weight', 0.5,
        'elevation_weight', 0.3,
        'quality_weight', 0.3,
        'steepness_weight', 2,
        'routing_distance_weight', 0.5
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_cost_weights()
 RETURNS json
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN json_build_object(
        'steepness_weight', (get_carthorse_config() ->> 'steepness_weight')::float,
        'distance_weight', (get_carthorse_config() ->> 'routing_distance_weight')::float
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_edge_tolerance()
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN (get_carthorse_config() ->> 'edge_tolerance')::float;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_elevation_gain_limits()
 RETURNS json
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN json_build_object(
        'min_meters', (get_carthorse_config() ->> 'min_elevation_gain_meters')::float,
        'max_meters', (get_carthorse_config() ->> 'max_elevation_gain_meters')::float
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_intersection_stats(staging_schema text)
 RETURNS TABLE(total_nodes integer, intersection_nodes integer, endpoint_nodes integer, total_edges integer, node_to_trail_ratio double precision, processing_time_ms integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
    start_time timestamp;
    end_time timestamp;
    trail_count integer;
BEGIN
    start_time := clock_timestamp();
    EXECUTE format('SELECT COUNT(*) FROM %I.trails', staging_schema) INTO trail_count;
    RETURN QUERY EXECUTE format('
        SELECT 
            (SELECT COUNT(*) FROM %I.routing_nodes) as total_nodes,
            (SELECT COUNT(*) FROM %I.routing_nodes WHERE node_type = ''intersection'') as intersection_nodes,
            (SELECT COUNT(*) FROM %I.routing_nodes WHERE node_type = ''endpoint'') as endpoint_nodes,
            (SELECT COUNT(*) FROM %I.routing_edges) as total_edges,
            CASE 
                WHEN $1 > 0 THEN (SELECT COUNT(*) FROM %I.routing_nodes)::float / $1
                ELSE 0
            END as node_to_trail_ratio,
            EXTRACT(EPOCH FROM (clock_timestamp() - $2::timestamp)) * 1000 as processing_time_ms
    ', staging_schema, staging_schema, staging_schema, staging_schema, staging_schema)
    USING trail_count, start_time;
    end_time := clock_timestamp();
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_intersection_tolerance()
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN (get_carthorse_config() ->> 'intersection_tolerance')::float;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_max_routes_per_bin()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN 10; -- Default max routes per bin
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_min_route_score()
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN 0.3; -- Default minimum score
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_proj4_from_srid(integer)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	BEGIN
	RETURN proj4text::text FROM public.spatial_ref_sys WHERE srid= $1;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.get_route_distance_limits()
 RETURNS json
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN json_build_object(
        'min_km', (get_carthorse_config() ->> 'min_route_distance_km')::float,
        'max_km', (get_carthorse_config() ->> 'max_route_distance_km')::float
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_route_patterns()
 RETURNS TABLE(pattern_name text, target_distance_km double precision, target_elevation_gain double precision, route_shape text, tolerance_percent double precision)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY SELECT 
        rp.pattern_name,
        rp.target_distance_km,
        rp.target_elevation_gain,
        rp.route_shape,
        rp.tolerance_percent
    FROM route_patterns rp
    ORDER BY rp.target_distance_km, rp.target_elevation_gain;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_scoring_weights()
 RETURNS json
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN json_build_object(
        'distance_weight', (get_carthorse_config() ->> 'distance_weight')::float,
        'elevation_weight', (get_carthorse_config() ->> 'elevation_weight')::float,
        'quality_weight', (get_carthorse_config() ->> 'quality_weight')::float
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_simplify_tolerance()
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN (get_carthorse_config() ->> 'simplify_tolerance')::float;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_timeout_ms()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN (get_carthorse_config() ->> 'timeout_ms')::integer;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_trails_with_geojson(p_region text DEFAULT NULL::text, p_limit integer DEFAULT 100)
 RETURNS TABLE(id integer, app_uuid text, name text, region text, length_km real, elevation_gain real, geojson text)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        t.id,
        t.app_uuid,
        t.name,
        t.region,
        t.length_km,
        t.elevation_gain,
        COALESCE(t.geojson_cached, ST_AsGeoJSON(t.geometry, 6, 0)) as geojson
    FROM trails t
    WHERE (p_region IS NULL OR t.region = p_region)
    ORDER BY t.name
    LIMIT p_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.gidx_in(cstring)
 RETURNS gidx
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gidx_in$function$
;

CREATE OR REPLACE FUNCTION public.gidx_out(gidx)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gidx_out$function$
;

CREATE OR REPLACE FUNCTION public.gserialized_gist_joinsel_2d(internal, oid, internal, smallint)
 RETURNS double precision
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_joinsel_2d$function$
;

CREATE OR REPLACE FUNCTION public.gserialized_gist_joinsel_nd(internal, oid, internal, smallint)
 RETURNS double precision
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_joinsel_nd$function$
;

CREATE OR REPLACE FUNCTION public.gserialized_gist_sel_2d(internal, oid, internal, integer)
 RETURNS double precision
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_sel_2d$function$
;

CREATE OR REPLACE FUNCTION public.gserialized_gist_sel_nd(internal, oid, internal, integer)
 RETURNS double precision
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/postgis-3', $function$gserialized_gist_sel_nd$function$
;

CREATE OR REPLACE FUNCTION public.is_contained_2d(geometry, box2df)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 1
AS $function$SELECT $2 OPERATOR(public.~) $1;$function$
;

CREATE OR REPLACE FUNCTION public.is_contained_2d(box2df, box2df)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_contains_box2df_box2df_2d$function$
;

CREATE OR REPLACE FUNCTION public.is_contained_2d(box2df, geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_within_box2df_geom_2d$function$
;

CREATE OR REPLACE FUNCTION public.json(geometry)
 RETURNS json
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geometry_to_json$function$
;

CREATE OR REPLACE FUNCTION public.jsonb(geometry)
 RETURNS jsonb
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geometry_to_jsonb$function$
;

CREATE OR REPLACE FUNCTION public.levenshtein(text, text)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/fuzzystrmatch', $function$levenshtein$function$
;

CREATE OR REPLACE FUNCTION public.levenshtein(text, text, integer, integer, integer)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/fuzzystrmatch', $function$levenshtein_with_costs$function$
;

CREATE OR REPLACE FUNCTION public.levenshtein_less_equal(text, text, integer, integer, integer, integer)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/fuzzystrmatch', $function$levenshtein_less_equal_with_costs$function$
;

CREATE OR REPLACE FUNCTION public.levenshtein_less_equal(text, text, integer)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/fuzzystrmatch', $function$levenshtein_less_equal$function$
;

CREATE OR REPLACE FUNCTION public.metaphone(text, integer)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/fuzzystrmatch', $function$metaphone$function$
;

CREATE OR REPLACE FUNCTION public.overlaps_2d(geometry, box2df)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 1
AS $function$SELECT $2 OPERATOR(public.&&) $1;$function$
;

CREATE OR REPLACE FUNCTION public.overlaps_2d(box2df, box2df)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_contains_box2df_box2df_2d$function$
;

CREATE OR REPLACE FUNCTION public.overlaps_2d(box2df, geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_overlaps_box2df_geom_2d$function$
;

CREATE OR REPLACE FUNCTION public.overlaps_geog(gidx, geography)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/postgis-3', $function$gserialized_gidx_geog_overlaps$function$
;

CREATE OR REPLACE FUNCTION public.overlaps_geog(gidx, gidx)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/postgis-3', $function$gserialized_gidx_gidx_overlaps$function$
;

CREATE OR REPLACE FUNCTION public.overlaps_geog(geography, gidx)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE STRICT
AS $function$SELECT $2 OPERATOR(public.&&) $1;$function$
;

CREATE OR REPLACE FUNCTION public.overlaps_nd(gidx, geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_gidx_geom_overlaps$function$
;

CREATE OR REPLACE FUNCTION public.overlaps_nd(gidx, gidx)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$gserialized_gidx_gidx_overlaps$function$
;

CREATE OR REPLACE FUNCTION public.overlaps_nd(geometry, gidx)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 1
AS $function$SELECT $2 OPERATOR(public.&&&) $1;$function$
;

CREATE OR REPLACE FUNCTION public.path(geometry)
 RETURNS path
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geometry_to_path$function$
;

CREATE OR REPLACE FUNCTION public.pgis_asflatgeobuf_finalfn(internal)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_asflatgeobuf_finalfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_asflatgeobuf_transfn(internal, anyelement)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$pgis_asflatgeobuf_transfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_asflatgeobuf_transfn(internal, anyelement, boolean)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$pgis_asflatgeobuf_transfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_asflatgeobuf_transfn(internal, anyelement, boolean, text)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$pgis_asflatgeobuf_transfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_asgeobuf_finalfn(internal)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_asgeobuf_finalfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_asgeobuf_transfn(internal, anyelement, text)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$pgis_asgeobuf_transfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_asgeobuf_transfn(internal, anyelement)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$pgis_asgeobuf_transfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_asmvt_combinefn(internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_asmvt_combinefn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_asmvt_deserialfn(bytea, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_asmvt_deserialfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_asmvt_finalfn(internal)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_asmvt_finalfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_asmvt_serialfn(internal)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_asmvt_serialfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_asmvt_transfn(internal, anyelement, text, integer, text, text)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_asmvt_transfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_asmvt_transfn(internal, anyelement, text, integer)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_asmvt_transfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_asmvt_transfn(internal, anyelement, text, integer, text)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_asmvt_transfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_asmvt_transfn(internal, anyelement, text)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_asmvt_transfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_asmvt_transfn(internal, anyelement)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_asmvt_transfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_geometry_accum_transfn(internal, geometry)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$pgis_geometry_accum_transfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_geometry_accum_transfn(internal, geometry, double precision, integer)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$pgis_geometry_accum_transfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_geometry_accum_transfn(internal, geometry, double precision)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$pgis_geometry_accum_transfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_geometry_clusterintersecting_finalfn(internal)
 RETURNS geometry[]
 LANGUAGE c
 PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_geometry_clusterintersecting_finalfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_geometry_clusterwithin_finalfn(internal)
 RETURNS geometry[]
 LANGUAGE c
 PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_geometry_clusterwithin_finalfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_geometry_collect_finalfn(internal)
 RETURNS geometry
 LANGUAGE c
 PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_geometry_collect_finalfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_geometry_coverageunion_finalfn(internal)
 RETURNS geometry
 LANGUAGE c
 PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_geometry_coverageunion_finalfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_geometry_makeline_finalfn(internal)
 RETURNS geometry
 LANGUAGE c
 PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_geometry_makeline_finalfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_geometry_polygonize_finalfn(internal)
 RETURNS geometry
 LANGUAGE c
 PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_geometry_polygonize_finalfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_geometry_union_parallel_combinefn(internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis-3', $function$pgis_geometry_union_parallel_combinefn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_geometry_union_parallel_deserialfn(bytea, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$pgis_geometry_union_parallel_deserialfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_geometry_union_parallel_finalfn(internal)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$pgis_geometry_union_parallel_finalfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_geometry_union_parallel_serialfn(internal)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$pgis_geometry_union_parallel_serialfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_geometry_union_parallel_transfn(internal, geometry, double precision)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$pgis_geometry_union_parallel_transfn$function$
;

CREATE OR REPLACE FUNCTION public.pgis_geometry_union_parallel_transfn(internal, geometry)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis-3', $function$pgis_geometry_union_parallel_transfn$function$
;

CREATE OR REPLACE FUNCTION public.pgr_alphashape(geometry, alpha double precision DEFAULT 0)
 RETURNS geometry
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
geom      geometry;
delauny_query   TEXT;
BEGIN
    RAISE WARNING 'pgr_alphashape(geometry,double precision) deprecated function on v3.8.0';
    delauny_query = format($$
        WITH
        original AS (
            SELECT %1$L::geometry AS geom
        ),
        delauny AS (
            SELECT (ST_Dump(ST_DelaunayTriangles(geom, 0 , 0))).*
                FROM original
        ),
        delauny_info AS (
            SELECT delauny.path[1] AS id,
            (ST_DumpPoints(delauny.geom)).path[2] as seq,
            (ST_DumpPoints(delauny.geom)).geom
            FROM delauny
        )
        SELECT
            id,
            seq AS source,
            1 AS cost,
            ST_X(geom)::FLOAT AS x1,
            ST_Y(geom)::FLOAT AS y1,
            0::FLOAT AS x2,
            0::FLOAT AS y2
        FROM delauny_info WHERE seq != 4;
        $$, $1);
    WITH a AS (SELECT 'GEOMETRYCOLLECTION(' || string_agg(textgeom,',') || ')' as geome
        FROM _pgr_alphaShape(delauny_query, $2))
    SELECT ST_GeomFromText(geome) FROM a
    INTO geom;
    RETURN geom;
END
$function$
;

-- Function: pgr_alphashape
-- Comment: pgr_alphaShape deprecated function on v3.8.0
-- 
CREATE OR REPLACE FUNCTION public.pgr_analyzegraph(text, double precision, the_geom text DEFAULT 'the_geom'::text, id text DEFAULT 'id'::text, source text DEFAULT 'source'::text, target text DEFAULT 'target'::text, rows_where text DEFAULT 'true'::text)
 RETURNS character varying
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
    edge_table TEXT := $1;
    tolerance TEXT := $2;
    points record;
    seg record;
    naming record;
    sridinfo record;
    srid INTEGER;
    ecnt INTEGER;
    vertname TEXT;
    sname TEXT;
    tname TEXT;
    vname TEXT;
    idname TEXT;
    sourcename TEXT;
    targetname TEXT;
    sourcetype TEXT;
    targettype TEXT;
    geotype TEXT;
    gname TEXT;
    tabName TEXT;
    flag boolean ;
    query TEXT;
    selectionquery TEXT;
    i INTEGER;
    tot INTEGER;
    NumIsolated INTEGER;
    numdeadends INTEGER;
    numgaps INTEGER;
    NumCrossing INTEGER;
    numRings INTEGER;
    debuglevel TEXT;
BEGIN
  RAISE WARNING 'pgr_analyzegraph(text,double precision,text,text,text,text,text) deprecated function on v3.8.0';
  RAISE NOTICE 'PROCESSING:';
  RAISE NOTICE 'pgr_analyzeGraph(''%'',%,''%'',''%'',''%'',''%'',''%'')',edge_table,tolerance,the_geom,id,source,target,rows_where;
  RAISE NOTICE 'Performing checks, please wait ...';
  EXECUTE 'show client_min_messages' INTO debuglevel;
  BEGIN
    RAISE DEBUG 'Checking % exists',edge_table;
    EXECUTE 'select * FROM _pgr_getTableName('||quote_literal(edge_table)||',2)' INTO naming;
    sname=naming.sname;
    tname=naming.tname;
    tabname=sname||'.'||tname;
    vname=tname||'_vertices_pgr';
    vertname= sname||'.'||vname;
    rows_where = ' AND ('||rows_where||')';
    RAISE DEBUG '     --> OK';
  END;
  BEGIN
       RAISE DEBUG 'Checking Vertices table';
       EXECUTE 'select * FROM  _pgr_checkVertTab('||quote_literal(vertname) ||', ''{"id","cnt","chk"}''::TEXT[])' INTO naming;
       EXECUTE 'UPDATE '||_pgr_quote_ident(vertname)||' SET cnt=0 ,chk=0';
       RAISE DEBUG '     --> OK';
       EXCEPTION WHEN raise_exception THEN
          RAISE NOTICE 'ERROR: something went wrong checking the vertices table';
          RETURN 'FAIL';
  END;
  BEGIN
       RAISE DEBUG 'Checking column names in edge table';
       SELECT _pgr_getColumnName INTO idname     FROM _pgr_getColumnName(sname, tname,id,2);
       SELECT _pgr_getColumnName INTO sourcename FROM _pgr_getColumnName(sname, tname,source,2);
       SELECT _pgr_getColumnName INTO targetname FROM _pgr_getColumnName(sname, tname,target,2);
       SELECT _pgr_getColumnName INTO gname      FROM _pgr_getColumnName(sname, tname,the_geom,2);
       perform _pgr_onError( sourcename IN (targetname,idname,gname) OR  targetname IN (idname,gname) OR idname=gname, 2,
                       'pgr_analyzeGraph',  'Two columns share the same name', 'Parameter names for id,the_geom,source and target  must be different',
                       'Column names are OK');
        RAISE DEBUG '     --> OK';
       EXCEPTION WHEN raise_exception THEN
          RAISE NOTICE 'ERROR: something went wrong checking the column names';
          RETURN 'FAIL';
  END;
  BEGIN
       RAISE DEBUG 'Checking column types in edge table';
       SELECT _pgr_getColumnType INTO sourcetype FROM _pgr_getColumnType(sname,tname,sourcename,1);
       SELECT _pgr_getColumnType INTO targettype FROM _pgr_getColumnType(sname,tname,targetname,1);
       perform _pgr_onError(sourcetype NOT in('integer','smallint','bigint') , 2,
                       'pgr_analyzeGraph',  'Wrong type of Column '|| sourcename, ' Expected type of '|| sourcename || ' is integer, smallint or bigint but '||sourcetype||' was found',
                       'Type of Column '|| sourcename || ' is ' || sourcetype);
       perform _pgr_onError(targettype NOT in('integer','smallint','bigint') , 2,
                       'pgr_analyzeGraph',  'Wrong type of Column '|| targetname, ' Expected type of '|| targetname || ' is integer, smallint or bigint but '||targettype||' was found',
                       'Type of Column '|| targetname || ' is ' || targettype);
       RAISE DEBUG '     --> OK';
       EXCEPTION WHEN raise_exception THEN
          RAISE NOTICE 'ERROR: something went wrong checking the column types';
          RETURN 'FAIL';
   END;
   BEGIN
       RAISE DEBUG 'Checking SRID of geometry column';
         query= 'SELECT ST_SRID(' || quote_ident(gname) || ') AS srid '
            || ' FROM ' || _pgr_quote_ident(tabname)
            || ' WHERE ' || quote_ident(gname)
            || ' IS NOT NULL LIMIT 1';
         EXECUTE QUERY INTO sridinfo;
         perform _pgr_onError( sridinfo IS NULL OR sridinfo.srid IS NULL,2,
                 'Can not determine the srid of the geometry '|| gname ||' in table '||tabname, 'Check the geometry of column '||gname,
                 'SRID of '||gname||' is '||sridinfo.srid);
         IF sridinfo IS NULL OR sridinfo.srid IS NULL THEN
             RAISE NOTICE ' Can not determine the srid of the geometry "%" in table %', the_geom,tabname;
             RETURN 'FAIL';
         END IF;
         srid := sridinfo.srid;
         RAISE DEBUG '     --> OK';
         EXCEPTION WHEN OTHERS THEN
             RAISE NOTICE 'Got %', SQLERRM;--issue 210,211,213
             RAISE NOTICE 'ERROR: something went wrong when checking for SRID of % in table %', the_geom,tabname;
             RETURN 'FAIL';
    END;
    BEGIN
       RAISE DEBUG 'Checking  indices in edge table';
       perform _pgr_createIndex(tabname , idname , 'btree');
       perform _pgr_createIndex(tabname , sourcename , 'btree');
       perform _pgr_createIndex(tabname , targetname , 'btree');
       perform _pgr_createIndex(tabname , gname , 'gist');
       gname=quote_ident(gname);
       sourcename=quote_ident(sourcename);
       targetname=quote_ident(targetname);
       idname=quote_ident(idname);
       RAISE DEBUG '     --> OK';
       EXCEPTION WHEN raise_exception THEN
          RAISE NOTICE 'ERROR: something went wrong checking indices';
          RETURN 'FAIL';
    END;
    BEGIN
        query='select count(*) from '||_pgr_quote_ident(tabname)||' WHERE true  '||rows_where;
        EXECUTE query INTO ecnt;
        RAISE DEBUG '-->Rows WHERE condition: OK';
        RAISE DEBUG '     --> OK';
         EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Got %', SQLERRM;  --issue 210,211,213
            RAISE NOTICE 'ERROR: Condition is not correct. Please execute the following query to test your condition';
            RAISE NOTICE '%',query;
            RETURN 'FAIL';
    END;
    selectionquery ='with
           selectedRows as( (select '||sourcename||' AS id FROM '||_pgr_quote_ident(tabname)||' WHERE true '||rows_where||')
                           UNION
                           (select '||targetname||' AS id FROM '||_pgr_quote_ident(tabname)||' WHERE true '||rows_where||'))';
   BEGIN
       RAISE NOTICE 'Analyzing for dead ends. Please wait...';
       query= 'with countingsource AS (select a.'||sourcename||' AS id,count(*) AS cnts
               FROM (select * FROM '||_pgr_quote_ident(tabname)||' WHERE true '||rows_where||' ) a  GROUP BY a.'||sourcename||')
                     ,countingtarget AS (select a.'||targetname||' AS id,count(*) AS cntt
                    FROM (select * FROM '||_pgr_quote_ident(tabname)||' WHERE true '||rows_where||' ) a  GROUP BY a.'||targetname||')
                   ,totalcount AS (select id,case when cnts is NULL AND cntt is NULL then 0
                                                   when cnts is NULL then cntt
                                                   when cntt is NULL then cnts
                                                   else cnts+cntt end as totcnt
                                   FROM ('||_pgr_quote_ident(vertname)||' AS a left
                                   join countingsource AS t using(id) ) left join countingtarget using(id))
               UPDATE '||_pgr_quote_ident(vertname)||' AS a set cnt=totcnt FROM totalcount AS b WHERE a.id=b.id';
       RAISE DEBUG '%',query;
       EXECUTE query;
       query=selectionquery||'
              select count(*)  FROM '||_pgr_quote_ident(vertname)||' WHERE cnt=1 AND id IN (select id FROM selectedRows)';
       RAISE DEBUG '%',query;
       EXECUTE query  INTO numdeadends;
       RAISE DEBUG '     --> OK';
       EXCEPTION WHEN raise_exception THEN
          RAISE NOTICE 'Got %', SQLERRM;  --issue 210,211,213
          RAISE NOTICE 'ERROR: something went wrong when analizing for dead ends';
          RETURN 'FAIL';
   END;
    BEGIN
          RAISE NOTICE 'Analyzing for gaps. Please wait...';
          query = 'with
                   buffer AS (select id,st_buffer(the_geom,'||tolerance||') AS buff FROM '||_pgr_quote_ident(vertname)||' WHERE cnt=1)
                   ,veryclose AS (select b.id,st_crosses(a.'||gname||',b.buff) AS flag
                   FROM  (select * FROM '||_pgr_quote_ident(tabname)||' WHERE true '||rows_where||' ) AS a
                   join buffer AS b on (a.'||gname||'&&b.buff)
                   WHERE '||sourcename||'!=b.id AND '||targetname||'!=b.id )
                   UPDATE '||_pgr_quote_ident(vertname)||' set chk=1 WHERE id IN (select distinct id FROM veryclose WHERE flag=true)';
          RAISE DEBUG '%' ,query;
          EXECUTE query;
          GET DIAGNOSTICS  numgaps= ROW_COUNT;
          RAISE DEBUG '     --> OK';
          EXCEPTION WHEN raise_exception THEN
            RAISE NOTICE 'ERROR: something went wrong when Analyzing for gaps';
            RETURN 'FAIL';
    END;
    BEGIN
        RAISE NOTICE 'Analyzing for isolated edges. Please wait...';
        query=selectionquery|| ' select count(*) FROM (select * FROM '||_pgr_quote_ident(tabname)||' WHERE true '||rows_where||' )  AS a,
                                                 '||_pgr_quote_ident(vertname)||' AS b,
                                                 '||_pgr_quote_ident(vertname)||' AS c
                            WHERE b.id IN (select id FROM selectedRows) AND a.'||sourcename||' =b.id
                            AND b.cnt=1 AND a.'||targetname||' =c.id
                            AND c.cnt=1';
        RAISE DEBUG '%' ,query;
        EXECUTE query  INTO NumIsolated;
        RAISE DEBUG '     --> OK';
        EXCEPTION WHEN raise_exception THEN
            RAISE NOTICE 'ERROR: something went wrong when Analyzing for isolated edges';
            RETURN 'FAIL';
    END;
    BEGIN
        RAISE NOTICE 'Analyzing for ring geometries. Please wait...';
        EXECUTE 'select geometrytype('||gname||')  FROM '||_pgr_quote_ident(tabname) limit 1 INTO geotype;
        IF (geotype='MULTILINESTRING') THEN
            query ='select count(*)  FROM '||_pgr_quote_ident(tabname)||'
                                 WHERE true  '||rows_where||' AND st_isRing(st_linemerge('||gname||'))';
            RAISE DEBUG '%' ,query;
            EXECUTE query  INTO numRings;
        ELSE query ='select count(*)  FROM '||_pgr_quote_ident(tabname)||'
                                  WHERE true  '||rows_where||' AND st_isRing('||gname||')';
            RAISE DEBUG '%' ,query;
            EXECUTE query  INTO numRings;
        END IF;
        RAISE DEBUG '     --> OK';
        EXCEPTION WHEN raise_exception THEN
            RAISE NOTICE 'ERROR: something went wrong when Analyzing for ring geometries';
            RETURN 'FAIL';
    END;
    BEGIN
        RAISE NOTICE 'Analyzing for intersections. Please wait...';
        query = 'select count(*) FROM (select distinct case when a.'||idname||' < b.'||idname||' then a.'||idname||'
                                                        else b.'||idname||' end,
                                                   case when a.'||idname||' < b.'||idname||' then b.'||idname||'
                                                        else a.'||idname||' end
                                    FROM (select * FROM '||_pgr_quote_ident(tabname)||' WHERE true '||rows_where||') AS a
                                    JOIN (select * FROM '||_pgr_quote_ident(tabname)||' WHERE true '||rows_where||') AS b
                                    ON (a.'|| gname||' && b.'||gname||')
                                    WHERE a.'||idname||' != b.'||idname|| '
                                        AND (a.'||sourcename||' IN (b.'||sourcename||',b.'||targetname||')
                                              OR a.'||targetname||' IN (b.'||sourcename||',b.'||targetname||')) = false
                                        AND st_intersects(a.'||gname||', b.'||gname||')=true) AS d ';
        RAISE DEBUG '%' ,query;
        EXECUTE query  INTO numCrossing;
        RAISE DEBUG '     --> OK';
        EXCEPTION WHEN raise_exception THEN
            RAISE NOTICE 'ERROR: something went wrong when Analyzing for intersections';
            RETURN 'FAIL';
    END;
    RAISE NOTICE '            ANALYSIS RESULTS FOR SELECTED EDGES:';
    RAISE NOTICE '                  Isolated segments: %', NumIsolated;
    RAISE NOTICE '                          Dead ends: %', numdeadends;
    RAISE NOTICE 'Potential gaps found near dead ends: %', numgaps;
    RAISE NOTICE '             Intersections detected: %',numCrossing;
    RAISE NOTICE '                    Ring geometries: %',numRings;
    RETURN 'OK';
END;
$function$
;

-- Function: pgr_analyzegraph
-- Comment: pgr_analyzeGraph deprecated function on v3.8.0
-- 
CREATE OR REPLACE FUNCTION public.pgr_analyzeoneway(text, text[], text[], text[], text[], two_way_if_null boolean DEFAULT true, oneway text DEFAULT 'oneway'::text, source text DEFAULT 'source'::text, target text DEFAULT 'target'::text)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
    edge_table TEXT := $1;
    s_in_rules TEXT[] := $2;
    s_out_rules TEXT[] := $3;
    t_in_rules TEXT[] := $4;
    t_out_rules TEXT[] := $5;
    rule TEXT;
    ecnt INTEGER;
    instr TEXT;
    naming record;
    sname TEXT;
    tname TEXT;
    tabname TEXT;
    vname TEXT;
    owname TEXT;
    sourcename TEXT;
    targetname TEXT;
    sourcetype TEXT;
    targettype TEXT;
    vertname TEXT;
    debuglevel TEXT;
BEGIN
  RAISE WARNING 'pgr_analyzeoneway(text,text[],text[],text[],text[],boolean,text,text,text) deprecated function on v3.8.0';
  RAISE NOTICE 'PROCESSING:';
  RAISE NOTICE 'pgr_analyzeOneway(''%'',''%'',''%'',''%'',''%'',''%'',''%'',''%'',%)',
		edge_table, s_in_rules , s_out_rules, t_in_rules, t_out_rules, oneway, source ,target,two_way_if_null ;
  EXECUTE 'show client_min_messages' INTO debuglevel;
  BEGIN
    RAISE DEBUG 'Checking % exists',edge_table;
    EXECUTE 'SELECT sname, tname FROM _pgr_getTableName('||quote_literal(edge_table)||',2)' INTO naming;
    sname=naming.sname;
    tname=naming.tname;
    tabname=sname||'.'||tname;
    vname=tname||'_vertices_pgr';
    vertname= sname||'.'||vname;
    RAISE DEBUG '     --> OK';
    EXCEPTION WHEN raise_exception THEN
      RAISE NOTICE 'ERROR: something went wrong checking the table name';
      RETURN 'FAIL';
  END;
  BEGIN
       RAISE DEBUG 'Checking Vertices table';
       EXECUTE 'SELECT sname, vname FROM  _pgr_checkVertTab('||quote_literal(vertname) ||', ''{"id","ein","eout"}''::TEXT[])' INTO naming;
       EXECUTE 'UPDATE '||_pgr_quote_ident(vertname)||' SET eout=0 ,ein=0';
       RAISE DEBUG '     --> OK';
       EXCEPTION WHEN raise_exception THEN
          RAISE NOTICE 'ERROR: something went wrong checking the vertices table';
          RETURN 'FAIL';
  END;
  BEGIN
       RAISE DEBUG 'Checking column names in edge table';
       SELECT _pgr_getColumnName INTO sourcename FROM _pgr_getColumnName(sname, tname,source,2);
       SELECT _pgr_getColumnName INTO targetname FROM _pgr_getColumnName(sname, tname,target,2);
       SELECT _pgr_getColumnName INTO owname FROM _pgr_getColumnName(sname, tname,oneway,2);
       perform _pgr_onError( sourcename IN (targetname,owname) or  targetname=owname, 2,
                       '_pgr_createToplogy',  'Two columns share the same name', 'Parameter names for oneway,source and target  must be different',
                       'Column names are OK');
       RAISE DEBUG '     --> OK';
       EXCEPTION WHEN raise_exception THEN
          RAISE NOTICE 'ERROR: something went wrong checking the column names';
          RETURN 'FAIL';
  END;
  BEGIN
       RAISE DEBUG 'Checking column types in edge table';
       SELECT _pgr_getColumnType INTO sourcetype FROM _pgr_getColumnType(sname,tname,sourcename,1);
       SELECT _pgr_getColumnType INTO targettype FROM _pgr_getColumnType(sname,tname,targetname,1);
       perform _pgr_onError(sourcetype NOT IN('integer','smallint','bigint') , 2,
                       '_pgr_createTopology',  'Wrong type of Column '|| sourcename, ' Expected type of '|| sourcename || ' is INTEGER,smallint OR BIGINT but '||sourcetype||' was found',
                       'Type of Column '|| sourcename || ' is ' || sourcetype);
       perform _pgr_onError(targettype NOT IN('integer','smallint','bigint') , 2,
                       '_pgr_createTopology',  'Wrong type of Column '|| targetname, ' Expected type of '|| targetname || ' is INTEGER,smallint OR BIGINTi but '||targettype||' was found',
                       'Type of Column '|| targetname || ' is ' || targettype);
       RAISE DEBUG '     --> OK';
       EXCEPTION WHEN raise_exception THEN
          RAISE NOTICE 'ERROR: something went wrong checking the column types';
          RETURN 'FAIL';
   END;
    RAISE NOTICE 'Analyzing graph for one way street errors.';
    rule := CASE WHEN two_way_if_null
            THEN owname || ' IS NULL OR '
            ELSE '' END;
    instr := '''' || array_to_string(s_in_rules, ''',''') || '''';
       EXECUTE 'UPDATE '||_pgr_quote_ident(vertname)||' a set ein=coalesce(ein,0)+b.cnt
      FROM (
         SELECT '|| sourcename ||', count(*) AS cnt
           FROM '|| tabname ||'
          WHERE '|| rule || owname ||' IN ('|| instr ||')
          GROUP BY '|| sourcename ||' ) b
     WHERE a.id=b.'|| sourcename;
    RAISE NOTICE 'Analysis 25%% complete ...';
    instr := '''' || array_to_string(t_in_rules, ''',''') || '''';
    EXECUTE 'UPDATE '||_pgr_quote_ident(vertname)||' a set ein=coalesce(ein,0)+b.cnt
        FROM (
         SELECT '|| targetname ||', count(*) AS cnt
           FROM '|| tabname ||'
          WHERE '|| rule || owname ||' IN ('|| instr ||')
          GROUP BY '|| targetname ||' ) b
        WHERE a.id=b.'|| targetname;
    RAISE NOTICE 'Analysis 50%% complete ...';
    instr := '''' || array_to_string(s_out_rules, ''',''') || '''';
    EXECUTE 'UPDATE '||_pgr_quote_ident(vertname)||' a set eout=coalesce(eout,0)+b.cnt
        FROM (
         SELECT '|| sourcename ||', count(*) AS cnt
           FROM '|| tabname ||'
          WHERE '|| rule || owname ||' IN ('|| instr ||')
          GROUP BY '|| sourcename ||' ) b
        WHERE a.id=b.'|| sourcename;
    RAISE NOTICE 'Analysis 75%% complete ...';
    instr := '''' || array_to_string(t_out_rules, ''',''') || '''';
    EXECUTE 'UPDATE '||_pgr_quote_ident(vertname)||' a set eout=coalesce(eout,0)+b.cnt
        FROM (
         SELECT '|| targetname ||', count(*) AS cnt
           FROM '|| tabname ||'
          WHERE '|| rule || owname ||' IN ('|| instr ||')
          GROUP BY '|| targetname ||' ) b
        WHERE a.id=b.'|| targetname;
    RAISE NOTICE 'Analysis 100%% complete ...';
    EXECUTE 'SELECT count(*)  FROM '||_pgr_quote_ident(vertname)||' WHERE ein=0 OR eout=0' INTO ecnt;
    RAISE NOTICE 'Found % potential problems in directionality' ,ecnt;
    RETURN 'OK';
END;
$function$
;

-- Function: pgr_analyzeoneway
-- Comment: pgr_analyzeOneWay deprecated function on v3.8.0
-- 
CREATE OR REPLACE FUNCTION public.pgr_articulationpoints(text, OUT node bigint)
 RETURNS SETOF bigint
 LANGUAGE sql
 STRICT
AS $function$
    SELECT node
    FROM _pgr_articulationPoints(_pgr_get_statement($1));
$function$
;

-- Function: pgr_articulationpoints
-- Comment: pgr_articulationPoints
- Undirected graph
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_articulationPoints.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_astar(text, bigint, bigint, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor double precision DEFAULT 1.0, epsilon double precision DEFAULT 1.0, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_aStar(_pgr_get_statement($1), ARRAY[$2]::BIGINT[],  ARRAY[$3]::BIGINT[], $4, $5, $6::FLOAT, $7::FLOAT);
$function$
;

-- Function: pgr_astar
-- Comment: pgr_aStar(One to One)
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
  - From vertex identifier
  - To vertex identifier
- Optional Parameters:
  - directed := true
  - heuristic := 5
  - factor := 1
  - epsilon := 1
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_aStar.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_astar(text, text, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor double precision DEFAULT 1.0, epsilon double precision DEFAULT 1.0, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_aStar(_pgr_get_statement($1), _pgr_get_statement($2), $3, $4, $5::FLOAT, $6::FLOAT);
$function$
;

-- Function: pgr_astar
-- Comment: pgr_aStar(Combinations)
 - Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
   - Combinations SQL with columns: source, target
 - Optional Parameters:
   - directed := true
   - heuristic := 5
   - factor := 1
   - epsilon := 1
 - Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_aStar.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_astar(text, anyarray, anyarray, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor double precision DEFAULT 1.0, epsilon double precision DEFAULT 1.0, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_aStar(_pgr_get_statement($1), $2::BIGINT[],  $3::BIGINT[], $4, $5, $6::FLOAT, $7::FLOAT);
$function$
;

-- Function: pgr_astar
-- Comment: pgr_aStar(Many to Many)
 - Parameters:
   - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
   - From ARRAY[vertices identifiers]
   - To ARRAY[vertices identifiers]
 - Optional Parameters:
   - directed := true
   - heuristic := 5
   - factor := 1
   - epsilon := 1
 - Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_aStar.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_astar(text, bigint, anyarray, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor double precision DEFAULT 1.0, epsilon double precision DEFAULT 1.0, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_aStar(_pgr_get_statement($1), ARRAY[$2]::BIGINT[],  $3::BIGINT[], $4, $5, $6::FLOAT, $7::FLOAT);
$function$
;

-- Function: pgr_astar
-- Comment: pgr_aStar(One to Many)
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
  - From vertex identifier
  - To ARRAY[vertices identifiers]
- Optional Parameters:
  - directed := true
  - heuristic := 5
  - factor := 1
  - epsilon := 1
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_aStar.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_astar(text, anyarray, bigint, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor double precision DEFAULT 1.0, epsilon double precision DEFAULT 1.0, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_aStar(_pgr_get_statement($1), $2::BIGINT[],  ARRAY[$3]::BIGINT[], $4, $5, $6::FLOAT, $7::FLOAT, normal:=false);
$function$
;

-- Function: pgr_astar
-- Comment: pgr_aStar(Many to One)
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
  - From ARRAY[vertices identifiers]
  - To vertex identifier
- Optional Parameters:
  - directed := true
  - heuristic := 5
  - factor := 1
  - epsilon := 1
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_aStar.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_astarcost(text, anyarray, anyarray, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor double precision DEFAULT 1.0, epsilon double precision DEFAULT 1.0, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_aStar(_pgr_get_statement($1), $2::BIGINT[],  $3::BIGINT[], $4, $5, $6::FLOAT, $7::FLOAT, true) AS a
    ORDER BY  a.start_vid, a.end_vid;
$function$
;

-- Function: pgr_astarcost
-- Comment: pgr_aStarCost(Many to Many)
 - Parameters:
   - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
   - From ARRAY[vertices identifiers]
   - To ARRAY[vertices identifiers]
 - Optional Parameters:
   - directed := true
   - heuristic := 5
   - factor := 1
   - epsilon := 1
 - Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_aStarCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_astarcost(text, text, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor double precision DEFAULT 1.0, epsilon double precision DEFAULT 1.0, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_aStar(_pgr_get_statement($1), _pgr_get_statement($2), $3, $4, $5::FLOAT, $6::FLOAT, true) AS a
    ORDER BY  a.start_vid, a.end_vid;
$function$
;

-- Function: pgr_astarcost
-- Comment: pgr_aStarCost(Combinations)
 - Parameters:
   - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
   - Combinations SQL with columns: source, target
 - Optional Parameters:
   - directed := true
   - heuristic := 5
   - factor := 1
   - epsilon := 1
 - Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_aStarCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_astarcost(text, bigint, bigint, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor double precision DEFAULT 1.0, epsilon double precision DEFAULT 1.0, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_aStar(_pgr_get_statement($1), ARRAY[$2]::BIGINT[],  ARRAY[$3]::BIGINT[], $4, $5, $6::FLOAT, $7::FLOAT, true) AS a
    ORDER BY  a.start_vid, a.end_vid;
$function$
;

-- Function: pgr_astarcost
-- Comment: pgr_aStarCost(One to One)
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
  - From vertex identifier
  - To vertex identifier
- Optional Parameters:
  - directed := true
  - heuristic := 5
  - factor := 1
  - epsilon := 1
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_aStarCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_astarcost(text, bigint, anyarray, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor double precision DEFAULT 1.0, epsilon double precision DEFAULT 1.0, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_aStar(_pgr_get_statement($1), ARRAY[$2]::BIGINT[],  $3::BIGINT[], $4, $5, $6::FLOAT, $7::FLOAT, true) AS a
    ORDER BY  a.start_vid, a.end_vid;
$function$
;

-- Function: pgr_astarcost
-- Comment: pgr_aStarCost(One to Many)
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
  - From vertex identifier
  - To ARRAY[vertices identifiers]
- Optional Parameters:
  - directed := true
  - heuristic := 5
  - factor := 1
  - epsilon := 1
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_aStarCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_astarcost(text, anyarray, bigint, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor double precision DEFAULT 1.0, epsilon double precision DEFAULT 1.0, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_aStar(_pgr_get_statement($1), $2::BIGINT[],  ARRAY[$3]::BIGINT[], $4, $5, $6::FLOAT, $7::FLOAT, true, normal:=false) AS a
    ORDER BY  a.start_vid, a.end_vid;
$function$
;

-- Function: pgr_astarcost
-- Comment: pgr_aStarCost(Many to One)
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
  - From ARRAY[vertices identifiers]
  - To vertex identifier
- Optional Parameters:
  - directed := true
  - heuristic := 5
  - factor := 1
  - epsilon := 1
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_aStarCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_astarcostmatrix(text, anyarray, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor double precision DEFAULT 1.0, epsilon double precision DEFAULT 1.0, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_astar(_pgr_get_statement($1), $2, $2, $3, $4, $5::FLOAT, $6::FLOAT, true) a;
$function$
;

-- Function: pgr_astarcostmatrix
-- Comment: pgr_aStarCostMatrix
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
    - ARRAY [vertices identifiers]
- Optional Parameters:
    - directed := true
    - heuristic := 5
    - factor := 1
    - epsilon := 1
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_aStarCostMatrix.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bdastar(text, anyarray, bigint, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor numeric DEFAULT 1.0, epsilon numeric DEFAULT 1.0, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_bdAstar(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], $4, $5, $6::FLOAT, $7::FLOAT, false);
$function$
;

-- Function: pgr_bdastar
-- Comment: pgr_bdAstar(Many to One)
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
  - From ARRAY[vertices identifiers]
  - To vertex identifier
- Optional Parameters:
  - directed := true
  - heuristic := 5
  - factor := 1
  - epsilon := 1
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdAstar.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bdastar(text, bigint, bigint, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor numeric DEFAULT 1.0, epsilon numeric DEFAULT 1.0, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_bdAstar(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], $4, $5, $6::FLOAT, $7::FLOAT, false);
$function$
;

-- Function: pgr_bdastar
-- Comment: pgr_bdAstar(One to One)
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
  - From vertex identifier
  - To vertex identifier
- Optional Parameters:
  - directed := true
  - heuristic := 5
  - factor := 1
  - epsilon := 1
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdAstar.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bdastar(text, anyarray, anyarray, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor numeric DEFAULT 1.0, epsilon numeric DEFAULT 1.0, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_bdAstar(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], $4, $5, $6::FLOAT, $7::FLOAT, false);
$function$
;

-- Function: pgr_bdastar
-- Comment: pgr_bdAstar(Many to Many)
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
  - From ARRAY[vertices identifiers]
  - To ARRAY[vertices identifiers]
- Optional Parameters:
  - directed := true
  - heuristic := 5
  - factor := 1
  - epsilon := 1
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdAstar.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bdastar(text, text, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor numeric DEFAULT 1.0, epsilon numeric DEFAULT 1.0, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_bdAstar(_pgr_get_statement($1), _pgr_get_statement($2), $3, $4, $5::FLOAT, $6::FLOAT, false);
$function$
;

-- Function: pgr_bdastar
-- Comment: pgr_bdAstar(Combinations)
- Parameters:
  - Edges SQL with columns: id, source, target, cost [, reverse_cost], x1, y1, x2, y2
  - Combinations SQL with columns: source, target
- Optional Parameters:
  - directed := true
  - heuristic := 5
  - factor := 1
  - epsilon := 1
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdAstar.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bdastar(text, bigint, anyarray, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor numeric DEFAULT 1.0, epsilon numeric DEFAULT 1.0, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_bdAstar(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], $4, $5, $6::FLOAT, $7::FLOAT, false);
$function$
;

-- Function: pgr_bdastar
-- Comment: pgr_bdAstar(One to Many)
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
  - From vertex identifier
  - To ARRAY[vertices identifiers]
- Optional Parameters:
  - directed := true
  - heuristic := 5
  - factor := 1
  - epsilon := 1
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdAstar.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bdastarcost(text, anyarray, bigint, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor numeric DEFAULT 1.0, epsilon numeric DEFAULT 1.0, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_bdAstar(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], $4, $5, $6::FLOAT, $7::FLOAT, true) AS a;
$function$
;

-- Function: pgr_bdastarcost
-- Comment: pgr_bdAstarCost(Many to One)
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
  - From ARRAY[vertices identifiers]
  - To vertex identifier
- Optional Parameters:
  - directed := true
  - heuristic := 5
  - factor := 1
  - epsilon := 1
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdAstarCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bdastarcost(text, text, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor numeric DEFAULT 1.0, epsilon numeric DEFAULT 1.0, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_bdAstar(_pgr_get_statement($1), _pgr_get_statement($2), $3, $4, $5::FLOAT, $6::FLOAT, true) AS a;
$function$
;

-- Function: pgr_bdastarcost
-- Comment: pgr_bdAstarCost(Combinations)
- Parameters:
  - Edges SQL with columns: id, source, target, cost [, reverse_cost], x1, y1, x2, y2
  - Combinations SQL with columns: source, target
- Optional Parameters:
  - directed := true
  - heuristic := 5
  - factor := 1
  - epsilon := 1
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdAstarCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bdastarcost(text, anyarray, anyarray, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor numeric DEFAULT 1.0, epsilon numeric DEFAULT 1.0, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_bdAstar(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], $4, $5, $6::FLOAT, $7::FLOAT, true) AS a;
$function$
;

-- Function: pgr_bdastarcost
-- Comment: pgr_bdAstarCost(Many to Many)
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
  - From ARRAY[vertices identifiers]
  - To ARRAY[vertices identifiers]
- Optional Parameters:
  - directed := true
  - heuristic := 5
  - factor := 1
  - epsilon := 1
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdAstarCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bdastarcost(text, bigint, bigint, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor numeric DEFAULT 1.0, epsilon numeric DEFAULT 1.0, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_bdAstar(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], $4, $5, $6::FLOAT, $7::FLOAT, true) AS a;
$function$
;

-- Function: pgr_bdastarcost
-- Comment: pgr_bdAstarCost(One to One)
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
  - From vertex identifier
  - To vertex identifier
- Optional Parameters:
  - directed := true
  - heuristic := 5
  - factor := 1
  - epsilon := 1
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdAstarCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bdastarcost(text, bigint, anyarray, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor numeric DEFAULT 1.0, epsilon numeric DEFAULT 1.0, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_bdAstar(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], $4, $5, $6::FLOAT, $7::FLOAT, true) AS a;
$function$
;

-- Function: pgr_bdastarcost
-- Comment: pgr_bdAstarCost(One to Many)
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
  - From vertex identifier
  - To ARRAY[vertices identifiers]
- Optional Parameters:
  - directed := true
  - heuristic := 5
  - factor := 1
  - epsilon := 1
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdAstarCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bdastarcostmatrix(text, anyarray, directed boolean DEFAULT true, heuristic integer DEFAULT 5, factor numeric DEFAULT 1.0, epsilon numeric DEFAULT 1.0, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_bdAstar(_pgr_get_statement($1), $2::BIGINT[], $2::BIGINT[], $3, $4, $5::FLOAT, $6::FLOAT, true) a;
$function$
;

-- Function: pgr_bdastarcostmatrix
-- Comment: pgr_bdAstarCostMatrix
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost], x1, y1, x2, y2
    - ARRAY [vertices identifiers]
- Optional Parameters:
    - directed := true
    - heuristic := 5
    - factor := 1
    - epsilon := 1
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_bdAstarCostMatrix.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bddijkstra(text, anyarray, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_bdDijkstra(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], directed, false);
$function$
;

-- Function: pgr_bddijkstra
-- Comment: pgr_bdDijkstra(Many to Many)
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]
  - To ARRAY[vertices identifiers]
- Optional Parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdDijkstra.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bddijkstra(text, bigint, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, end_vid, node, edge, cost, agg_cost
    FROM _pgr_bdDijkstra(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], $4, false);
$function$
;

-- Function: pgr_bddijkstra
-- Comment: pgr_bdDijkstra(One to Many)
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From vertex identifier
  - To ARRAY[vertices identifiers]
- Optional Parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdDijkstra.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bddijkstra(text, bigint, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, node, edge, cost, agg_cost
    FROM _pgr_bdDijkstra(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], $4, false);
$function$
;

-- Function: pgr_bddijkstra
-- Comment: pgr_bdDijkstra(One to One)
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From vertex identifier
  - To vertex identifier
- Optional Parameters:
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdDijkstra.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bddijkstra(text, anyarray, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, node, edge, cost, agg_cost
    FROM _pgr_bdDijkstra(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], $4, false);
$function$
;

-- Function: pgr_bddijkstra
-- Comment: pgr_bdDijkstra(Many to One)
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]
  - To vertex identifier
- Optional Parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdDijkstra.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bddijkstra(text, text, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_bdDijkstra(_pgr_get_statement($1), _pgr_get_statement($2), directed, false);
$function$
;

-- Function: pgr_bddijkstra
-- Comment: pgr_bdDijkstra(Combinations)
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Combinations SQL with columns: source, target
- Optional Parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdDijkstra.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bddijkstracost(text, bigint, anyarray, directed boolean DEFAULT true, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_bdDijkstra(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], $4, true) as a;
$function$
;

-- Function: pgr_bddijkstracost
-- Comment: pgr_bdDijkstraCost(One to Many)
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From vertex identifier
  - To ARRAY[vertices identifiers]
- Optional Parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdDijkstraCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bddijkstracost(text, bigint, bigint, directed boolean DEFAULT true, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_bdDijkstra(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], $4, true) AS a;
$function$
;

-- Function: pgr_bddijkstracost
-- Comment: pgr_bdDijkstraCost(One to One)
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From vertex identifier
  - To vertex identifier
- Optional Parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdDijkstraCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bddijkstracost(text, anyarray, anyarray, directed boolean DEFAULT true, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_bdDijkstra(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], directed, true) as a;
$function$
;

-- Function: pgr_bddijkstracost
-- Comment: pgr_bdDijkstraCost(Many to Many)
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]
  - To ARRAY[vertices identifiers]
- Optional Parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdDijkstraCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bddijkstracost(text, text, directed boolean DEFAULT true, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_bdDijkstra(_pgr_get_statement($1), _pgr_get_statement($2), directed, true) as a;
$function$
;

-- Function: pgr_bddijkstracost
-- Comment: pgr_bdDijkstraCost(Combinations)
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Combinations SQL with columns: source, target
- Optional Parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdDijkstraCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bddijkstracost(text, anyarray, bigint, directed boolean DEFAULT true, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_bdDijkstra(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], $4, true) as a;
$function$
;

-- Function: pgr_bddijkstracost
-- Comment: pgr_bdDijkstraCost(Many to One)
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]
  - To vertex identifier
- Optional Parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bdDijkstraCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bddijkstracostmatrix(text, anyarray, directed boolean DEFAULT true, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_bdDijkstra(_pgr_get_statement($1), $2::BIGINT[], $2::BIGINT[], $3, true) a;
$function$
;

-- Function: pgr_bddijkstracostmatrix
-- Comment: pgr_bdDijkstraCostMatrix
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - ARRAY [vertices identifiers]
- Optional Parameters
    - directed := true
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_bdDijkstraCostMatrix.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bellmanford(text, bigint, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_bellmanFord(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], directed, false) AS a;
$function$
;

-- Function: pgr_bellmanford
-- Comment: pgr_bellmanFord(One to One)
- EXPERIMENTAL
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From vertex identifier
  - To vertex identifier
- Optional Parameters:
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bellmanFord.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bellmanford(text, text, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.start_vid, a.end_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_bellmanFord(_pgr_get_statement($1), _pgr_get_statement($2), directed, false ) AS a;
$function$
;

-- Function: pgr_bellmanford
-- Comment: pgr_bellmanFord(Combinations)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Combinations SQL with columns: source, target
- Optional Parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bellmanFord.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bellmanford(text, bigint, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.end_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_bellmanFord(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], directed, false) AS a;
$function$
;

-- Function: pgr_bellmanford
-- Comment: pgr_bellmanFord(One to Many)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From vertex identifier
  - To ARRAY[vertices identifiers]
- Optional Parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bellmanFord.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bellmanford(text, anyarray, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.start_vid, a.end_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_bellmanFord(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], directed, false ) AS a;
$function$
;

-- Function: pgr_bellmanford
-- Comment: pgr_bellmanFord(Many to Many)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]
  - To ARRAY[vertices identifiers]
- Optional Parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bellmanFord.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bellmanford(text, anyarray, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.start_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_bellmanFord(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], directed, false) AS a;
$function$
;

-- Function: pgr_bellmanford
-- Comment: pgr_bellmanFord(Many to One)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]
  - To vertex identifier
- Optional Parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bellmanFord.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_betweennesscentrality(text, directed boolean DEFAULT true, OUT vid bigint, OUT centrality double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT vid, centrality
    FROM _pgr_betweennesscentrality(_pgr_get_statement($1), $2);
$function$
;

-- Function: pgr_betweennesscentrality
-- Comment: pgr_betweennessCentrality
- EXPERIMENTAL
- Parameters:
    - edges SQL with columns: source, target, cost [,reverse_cost])
- Optional Parameters:
    - directed := true
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_centrality.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_biconnectedcomponents(text, OUT seq bigint, OUT component bigint, OUT edge bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, component, edge
    FROM _pgr_biconnectedComponents(_pgr_get_statement($1)) ;
$function$
;

-- Function: pgr_biconnectedcomponents
-- Comment: pgr_biconnectedComponents
- Undirected graph
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_biconnectedComponents.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_binarybreadthfirstsearch(text, bigint, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_binaryBreadthFirstSearch(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], $4) AS a;
$function$
;

-- Function: pgr_binarybreadthfirstsearch
-- Comment: pgr_binaryBreadthFirstSearch(One to One)
- EXPERIMENTAL
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From vertex identifier
   - To vertex identifier
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_binaryBreadthFirstSearch.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_binarybreadthfirstsearch(text, anyarray, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.start_vid, a.end_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_binaryBreadthFirstSearch(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], $4) AS a;
$function$
;

-- Function: pgr_binarybreadthfirstsearch
-- Comment: pgr_binaryBreadthFirstSearch(Many to Many)
- EXPERIMENTAL
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From ARRAY[vertices identifiers]
   - To ARRAY[vertices identifiers]
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_binaryBreadthFirstSearch.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_binarybreadthfirstsearch(text, anyarray, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.start_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_binaryBreadthFirstSearch(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], $4) AS a;
$function$
;

-- Function: pgr_binarybreadthfirstsearch
-- Comment: pgr_binaryBreadthFirstSearch(Many to One)
- EXPERIMENTAL
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From ARRAY[vertices identifiers]
   - To vertex identifier
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_binaryBreadthFirstSearch.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_binarybreadthfirstsearch(text, text, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.start_vid, a.end_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_binaryBreadthFirstSearch(_pgr_get_statement($1), _pgr_get_statement($2), $3) AS a;
$function$
;

-- Function: pgr_binarybreadthfirstsearch
-- Comment: pgr_binaryBreadthFirstSearch(Combinations)
- EXPERIMENTAL
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - Combinations SQL with columns: source, target
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_binaryBreadthFirstSearch.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_binarybreadthfirstsearch(text, bigint, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.end_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_binaryBreadthFirstSearch(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], $4) AS a;
$function$
;

-- Function: pgr_binarybreadthfirstsearch
-- Comment: pgr_binaryBreadthFirstSearch(One to Many)
- EXPERIMENTAL
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From vertex identifier
   - To ARRAY[vertices identifiers]
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_binaryBreadthFirstSearch.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bipartite(text, OUT vertex_id bigint, OUT color_id bigint)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
BEGIN
    RETURN QUERY
    SELECT node, color
    FROM _pgr_bipartite(_pgr_get_statement($1));
END;
$function$
;

-- Function: pgr_bipartite
-- Comment: pgr_bipartite
- EXPERIMENTAL
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_bipartite.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_boykovkolmogorov(text, bigint, anyarray, OUT seq integer, OUT edge bigint, OUT start_vid bigint, OUT end_vid bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
        SELECT seq, edge_id, source, target, flow, residual_capacity
        FROM _pgr_maxflow(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], 2);
  $function$
;

-- Function: pgr_boykovkolmogorov
-- Comment: pgr_boykovKolmogorov(One to Many)
- Directed graph
- Parameters:
  - edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - from vertex
  - to ARRAY[vertices identifiers]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_boykovKolmogorov.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_boykovkolmogorov(text, bigint, bigint, OUT seq integer, OUT edge bigint, OUT start_vid bigint, OUT end_vid bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
        SELECT seq, edge_id, source, target, flow, residual_capacity
        FROM _pgr_maxflow(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], 2);
  $function$
;

-- Function: pgr_boykovkolmogorov
-- Comment: pgr_boykovKolmogorov(One to One)
- Directed graph
- Parameters:
  - edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - from vertex
  - to vertex
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_boykovKolmogorov.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_boykovkolmogorov(text, text, OUT seq integer, OUT edge bigint, OUT start_vid bigint, OUT end_vid bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
        SELECT seq, edge_id, source, target, flow, residual_capacity
        FROM _pgr_maxflow(_pgr_get_statement($1), _pgr_get_statement($2), 2);
  $function$
;

-- Function: pgr_boykovkolmogorov
-- Comment: pgr_boykovKolmogorov(Combinations)
 - Directed graph
 - Parameters:
   - Edges SQL with columns: id, source, target, capacity [,reverse_capacity]
   - Combinations SQL with columns: source, target
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_boykovKolmogorov.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_boykovkolmogorov(text, anyarray, anyarray, OUT seq integer, OUT edge bigint, OUT start_vid bigint, OUT end_vid bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
        SELECT seq, edge_id, source, target, flow, residual_capacity
        FROM _pgr_maxflow(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], 2);
  $function$
;

-- Function: pgr_boykovkolmogorov
-- Comment: pgr_boykovKolmogorov(Many to Many)
 - Directed graph
 - Parameters:
   - edges SQL with columns: id, source, target, capacity [,reverse_capacity]
   - from ARRAY[vertices identifiers]
   - to ARRAY[vertices identifiers]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_boykovKolmogorov.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_boykovkolmogorov(text, anyarray, bigint, OUT seq integer, OUT edge bigint, OUT start_vid bigint, OUT end_vid bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
        SELECT seq, edge_id, source, target, flow, residual_capacity
        FROM _pgr_maxflow(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], 2);
  $function$
;

-- Function: pgr_boykovkolmogorov
-- Comment: pgr_boykovKolmogorov(Many to One)
- Directed graph
- Parameters:
  - edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - from ARRAY[vertices identifiers]
  - to vertex
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_boykovKolmogorov.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_breadthfirstsearch(text, anyarray, max_depth bigint DEFAULT '9223372036854775807'::bigint, directed boolean DEFAULT true, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
BEGIN
    IF $3 < 0 THEN
        RAISE EXCEPTION 'Negative value found on ''max_depth'''
        USING HINT = format('Value found: %s', $3);
    END IF;
    RETURN QUERY
    SELECT a.seq, a.depth, a.start_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_breadthFirstSearch(_pgr_get_statement($1), $2::BIGINT[], max_depth, directed) AS a;
END;
$function$
;

-- Function: pgr_breadthfirstsearch
-- Comment: pgr_breadthFirstSearch(Many to Depth)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]
- Optional Parameters
  - Maximum Depth := 9223372036854775807
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_breadthFirstSearch.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_breadthfirstsearch(text, bigint, max_depth bigint DEFAULT '9223372036854775807'::bigint, directed boolean DEFAULT true, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
BEGIN
    IF $3 < 0 THEN
        RAISE EXCEPTION 'Negative value found on ''max_depth'''
        USING HINT = format('Value found: %s', $3);
    END IF;
    RETURN QUERY
    SELECT a.seq, a.depth, a.start_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_breadthFirstSearch(_pgr_get_statement($1),  ARRAY[$2]::BIGINT[], max_depth, directed) AS a;
END;
$function$
;

-- Function: pgr_breadthfirstsearch
-- Comment: pgr_breadthFirstSearch(One to Depth)
- EXPERIMENTAL
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From vertex identifier
- Optional Parameters:
  - Maximum Depth := 9223372036854775807
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_breadthFirstSearch.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_bridges(text, OUT edge bigint)
 RETURNS SETOF bigint
 LANGUAGE sql
 STRICT
AS $function$
    SELECT edge
    FROM _pgr_bridges(_pgr_get_statement($1));
$function$
;

-- Function: pgr_bridges
-- Comment: pgr_bridges
- Undirected graph
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_bridges.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_chinesepostman(text, OUT seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, node, edge, cost, agg_cost
    FROM _pgr_chinesePostman(_pgr_get_statement($1), only_cost := false);
$function$
;

-- Function: pgr_chinesepostman
-- Comment: pgr_chinesePostman
- EXPERIMENTAL
- Directed graph
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_chinesePostman.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_chinesepostmancost(text)
 RETURNS double precision
 LANGUAGE sql
 STRICT
AS $function$
    SELECT cost
    FROM _pgr_chinesePostman(_pgr_get_statement($1), only_cost := true);
$function$
;

-- Function: pgr_chinesepostmancost
-- Comment: pgr_chinesePostmanCost
- EXPERIMENTAL
- Directed graph
- Parameters:
	- Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
	- https://docs.pgrouting.org/latest/en/pgr_chinesePostmanCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_connectedcomponents(text, OUT seq bigint, OUT component bigint, OUT node bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, component, node
    FROM _pgr_connectedComponents(_pgr_get_statement($1));
$function$
;

-- Function: pgr_connectedcomponents
-- Comment: pgr_connectedComponents
- Undirected graph
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_connectedComponents.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_contraction(text, directed boolean DEFAULT true, methods integer[] DEFAULT ARRAY[1, 2], cycles integer DEFAULT 1, forbidden bigint[] DEFAULT ARRAY[]::bigint[], OUT type text, OUT id bigint, OUT contracted_vertices bigint[], OUT source bigint, OUT target bigint, OUT cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
  SELECT type, id, contracted_vertices, source, target, cost
  FROM _pgr_contraction(_pgr_get_statement($1), methods::BIGINT[], cycles, forbidden, directed);
$function$
;

-- Function: pgr_contraction
-- Comment: pgr_contraction
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Optional Parameters
    - directed := true
    - methods := ARRAY[1,2]
    - cycles := 1
    - forbidden := ARRAY[]::BIGINT[]
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_contraction.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_contraction(text, bigint[], max_cycles integer DEFAULT 1, forbidden_vertices bigint[] DEFAULT ARRAY[]::bigint[], directed boolean DEFAULT true, OUT type text, OUT id bigint, OUT contracted_vertices bigint[], OUT source bigint, OUT target bigint, OUT cost double precision)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
BEGIN
    RAISE NOTICE 'Deprecated Signature pgr_contraction(text,bigint[],integer,integer[],bigint[],boolean) in v3.8.0';
    RETURN QUERY
    SELECT a.type, a.id, a.contracted_vertices, a.source, a.target, a.cost
    FROM _pgr_contraction(_pgr_get_statement($1), $2::BIGINT[],  $3, $4, $5) AS a;
END;
$function$
;

-- Function: pgr_contraction
-- Comment: pgr_contraction deprecated in 3.8.0
-- 
CREATE OR REPLACE FUNCTION public.pgr_contractiondeadend(text, directed boolean DEFAULT true, forbidden bigint[] DEFAULT ARRAY[]::bigint[], OUT type text, OUT id bigint, OUT contracted_vertices bigint[], OUT source bigint, OUT target bigint, OUT cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT type, id, contracted_vertices, source, target, cost
    FROM _pgr_contraction(_pgr_get_statement($1), ARRAY[1]::BIGINT[], 1, $3, $2);
$function$
;

-- Function: pgr_contractiondeadend
-- Comment: pgr_contractionDeadEnd
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Optional Parameters
    - directed := true
    - forbidden := ARRAY[]::BIGINT[]
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_contractionDeadEnd.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_contractionhierarchies(text, directed boolean DEFAULT true, forbidden bigint[] DEFAULT ARRAY[]::bigint[], OUT type text, OUT id bigint, OUT contracted_vertices bigint[], OUT source bigint, OUT target bigint, OUT cost double precision, OUT metric bigint, OUT vertex_order bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT type, id, contracted_vertices, source, target, cost, metric, vertex_order
    FROM _pgr_contractionhierarchies(_pgr_get_statement($1), $3::BIGINT[], $2);
$function$
;

-- Function: pgr_contractionhierarchies
-- Comment: pgr_contractionHierarchies
- EXPERIMENTAL
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Optional Parameters
    - forbidden := ARRAY[]::BIGINT[]
    - directed := true
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_contractionHierarchies.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_contractionlinear(text, directed boolean DEFAULT true, forbidden bigint[] DEFAULT ARRAY[]::bigint[], OUT type text, OUT id bigint, OUT contracted_vertices bigint[], OUT source bigint, OUT target bigint, OUT cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT type, id, contracted_vertices, source, target, cost
    FROM _pgr_contraction(_pgr_get_statement($1), ARRAY[2]::BIGINT[], 1, $3, $2);
$function$
;

-- Function: pgr_contractionlinear
-- Comment: pgr_contractionLinear
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Optional Parameters
    - directed := true
    - forbidden := ARRAY[]::BIGINT[]
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_contractionLinear.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_createtopology(text, double precision, the_geom text DEFAULT 'the_geom'::text, id text DEFAULT 'id'::text, source text DEFAULT 'source'::text, target text DEFAULT 'target'::text, rows_where text DEFAULT 'true'::text, clean boolean DEFAULT false)
 RETURNS character varying
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
    edge_table TEXT := $1;
    tolerance FLOAT := $2;
    points record;
    sridinfo record;
    source_id BIGINT;
    target_id BIGINT;
    totcount BIGINT;
    rowcount BIGINT;
    srid INTEGER;
    sql TEXT;
    sname TEXT;
    tname TEXT;
    tabname TEXT;
    vname TEXT;
    vertname TEXT;
    gname TEXT;
    idname TEXT;
    sourcename TEXT;
    targetname TEXT;
    notincluded INTEGER;
    i INTEGER;
    naming record;
    info record;
    flag boolean;
    query TEXT;
    idtype TEXT;
    gtype TEXT;
    sourcetype TEXT;
    targettype TEXT;
    debuglevel TEXT;
    dummyRec record;
    fnName TEXT;
    err bool;
    msgKind int;
    emptied BOOLEAN;
BEGIN
    msgKind = 1; -- notice
    RAISE WARNING 'pgr_createtopology(text,double precision,text,text,text,text,text,boolean) deprecated function on v3.8.0';
    fnName = 'pgr_createTopology';
    RAISE notice 'PROCESSING:';
    RAISE notice 'pgr_createTopology(''%'', %, ''%'', ''%'', ''%'', ''%'', rows_where := ''%'', clean := %)',edge_table,tolerance,the_geom,id,source,target,rows_where, clean;
    EXECUTE 'show client_min_messages' INTO debuglevel;
    RAISE notice 'Performing checks, please wait .....';
        EXECUTE 'SELECT sname, tname FROM _pgr_getTableName('|| quote_literal(edge_table)
                                                  || ',2,' || quote_literal(fnName) ||' )' INTO naming;
        sname=naming.sname;
        tname=naming.tname;
        tabname=sname||'.'||tname;
        vname=tname||'_vertices_pgr';
        vertname= sname||'.'||vname;
        rows_where = ' AND ('||rows_where||')';
      RAISE DEBUG '     --> OK';
      RAISE debug 'Checking column names in edge table';
        SELECT _pgr_getColumnName INTO idname     FROM _pgr_getColumnName(sname, tname,id,2,fnName);
        SELECT _pgr_getColumnName INTO sourcename FROM _pgr_getColumnName(sname, tname,source,2,fnName);
        SELECT _pgr_getColumnName INTO targetname FROM _pgr_getColumnName(sname, tname,target,2,fnName);
        SELECT _pgr_getColumnName INTO gname      FROM _pgr_getColumnName(sname, tname,the_geom,2,fnName);
        err = sourcename in (targetname,idname,gname) OR  targetname in (idname,gname) OR idname=gname;
        perform _pgr_onError( err, 2, fnName,
               'Two columns share the same name', 'Parameter names for id,the_geom,source and target  must be different',
	       'Column names are OK');
      RAISE DEBUG '     --> OK';
      RAISE debug 'Checking column types in edge table';
        SELECT _pgr_getColumnType INTO sourcetype FROM _pgr_getColumnType(sname,tname,sourcename,1, fnName);
        SELECT _pgr_getColumnType INTO targettype FROM _pgr_getColumnType(sname,tname,targetname,1, fnName);
        SELECT _pgr_getColumnType INTO idtype FROM _pgr_getColumnType(sname,tname,idname,1, fnName);
        err = idtype NOT in('integer','smallint','bigint');
        perform _pgr_onError(err, 2, fnName,
	       'Wrong type of Column id:'|| idname, ' Expected type of '|| idname || ' is integer,smallint or bigint but '||idtype||' was found');
        err = sourcetype NOT in('integer','smallint','bigint');
        perform _pgr_onError(err, 2, fnName,
	       'Wrong type of Column source:'|| sourcename, ' Expected type of '|| sourcename || ' is integer,smallint or bigint but '||sourcetype||' was found');
        err = targettype NOT in('integer','smallint','bigint');
        perform _pgr_onError(err, 2, fnName,
	       'Wrong type of Column target:'|| targetname, ' Expected type of '|| targetname || ' is integer,smallint or bigint but '||targettype||' was found');
      RAISE DEBUG '     --> OK';
      RAISE debug 'Checking SRID of geometry column';
         query= 'SELECT ST_SRID(' || quote_ident(gname) || ') AS srid '
            || ' FROM ' || _pgr_quote_ident(tabname)
            || ' WHERE ' || quote_ident(gname)
            || ' IS NOT NULL LIMIT 1';
         RAISE debug '%',query;
         EXECUTE query INTO sridinfo;
         err =  sridinfo IS NULL OR sridinfo.srid IS NULL;
         perform _pgr_onError(err, 2, fnName,
	     'Can not determine the srid of the geometry '|| gname ||' in table '||tabname, 'Check the geometry of column '||gname);
         srid := sridinfo.srid;
      RAISE DEBUG '     --> OK';
      RAISE debug 'Checking and creating indices in edge table';
        perform _pgr_createIndex(sname, tname , idname , 'btree'::TEXT);
        perform _pgr_createIndex(sname, tname , sourcename , 'btree'::TEXT);
        perform _pgr_createIndex(sname, tname , targetname , 'btree'::TEXT);
        perform _pgr_createIndex(sname, tname , gname , 'gist'::TEXT);
        gname=quote_ident(gname);
        idname=quote_ident(idname);
        sourcename=quote_ident(sourcename);
        targetname=quote_ident(targetname);
      RAISE DEBUG '     --> OK';
    BEGIN
        sql = 'SELECT '||idname ||','|| sourcename ||','|| targetname ||','|| gname || ' FROM '||_pgr_quote_ident(tabname)||' WHERE true'||rows_where ||' limit 1';
        EXECUTE sql INTO dummyRec;
        sql = 'SELECT count(*) FROM '||_pgr_quote_ident(tabname)||' WHERE (' || gname || ' IS NOT NULL AND '||
	    idname||' IS NOT NULL)=false '||rows_where;
        EXECUTE SQL  INTO notincluded;
        if clean then
            RAISE debug 'Cleaning previous Topology ';
               EXECUTE 'UPDATE ' || _pgr_quote_ident(tabname) ||
               ' SET '||sourcename||' = NULL,'||targetname||' = NULL';
        else
            RAISE debug 'Creating topology for edges with non assigned topology';
            if rows_where=' AND (true)' then
                rows_where=  ' AND ('||quote_ident(sourcename)||' is NULL OR '||quote_ident(targetname)||' is  NULL)';
            end if;
        end if;
        EXCEPTION WHEN OTHERS THEN
             RAISE NOTICE 'Got %', SQLERRM; -- issue 210,211
             RAISE NOTICE 'ERROR: Condition is not correct, please execute the following query to test your condition';
             RAISE NOTICE '%',sql;
             RETURN 'FAIL';
    END;
    BEGIN
         RAISE DEBUG 'initializing %',vertname;
         EXECUTE 'SELECT sname, tname FROM _pgr_getTableName('||quote_literal(vertname)
                                                  || ',0,' || quote_literal(fnName) ||' )' INTO naming;
         emptied = false;
         set client_min_messages  to warning;
         IF sname=naming.sname AND vname=naming.tname  THEN
            if clean then
                EXECUTE 'TRUNCATE TABLE '||_pgr_quote_ident(vertname)||' RESTART IDENTITY';
                EXECUTE 'SELECT DROPGEOMETRYCOLUMN('||quote_literal(sname)||','||quote_literal(vname)||','||quote_literal('the_geom')||')';
                emptied = true;
            end if;
         ELSE -- table doesn't exist
            EXECUTE 'CREATE TABLE '||_pgr_quote_ident(vertname)||' (id bigserial PRIMARY KEY,cnt integer,chk integer,ein integer,eout integer)';
            emptied = true;
         END IF;
         IF (emptied) THEN
             EXECUTE 'SELECT addGeometryColumn('||quote_literal(sname)||','||quote_literal(vname)||','||
	         quote_literal('the_geom')||','|| srid||', '||quote_literal('POINT')||', 2)';
             perform _pgr_createIndex(vertname , 'the_geom'::TEXT , 'gist'::TEXT);
         END IF;
         EXECUTE 'SELECT _pgr_checkVertTab FROM  _pgr_checkVertTab('||quote_literal(vertname) ||', ''{"id"}''::TEXT[])' INTO naming;
         EXECUTE 'set client_min_messages  to '|| debuglevel;
         RAISE DEBUG  '  ------>OK';
         EXCEPTION WHEN OTHERS THEN
             RAISE NOTICE 'Got %', SQLERRM; -- issue 210,211
             RAISE NOTICE 'ERROR: something went wrong when initializing the verties table';
             RETURN 'FAIL';
    END;
    RAISE notice 'Creating Topology, Please wait...';
        rowcount := 0;
        FOR points IN EXECUTE 'SELECT ' || idname || '::BIGINT AS id,'
            || ' _pgr_StartPoint(' || gname || ') AS source,'
            || ' _pgr_EndPoint('   || gname || ') AS target'
            || ' FROM '  || _pgr_quote_ident(tabname)
            || ' WHERE ' || gname || ' IS NOT NULL AND ' || idname||' IS NOT NULL '||rows_where
        LOOP
            rowcount := rowcount + 1;
            IF rowcount % 1000 = 0 THEN
                RAISE NOTICE '% edges processed', rowcount;
            END IF;
            source_id := _pgr_pointToId(points.source, tolerance,vertname,srid);
            target_id := _pgr_pointToId(points.target, tolerance,vertname,srid);
            BEGIN
                sql := 'UPDATE ' || _pgr_quote_ident(tabname) ||
                    ' SET '||sourcename||' = '|| source_id::TEXT || ','||targetname||' = ' || target_id::TEXT ||
                    ' WHERE ' || idname || ' =  ' || points.id::TEXT;
                IF sql IS NULL THEN
                    RAISE NOTICE 'WARNING: UPDATE % SET source = %, target = % WHERE % = % ', tabname, source_id::TEXT, target_id::TEXT, idname,  points.id::TEXT;
                ELSE
                    EXECUTE sql;
                END IF;
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE '%', SQLERRM;
                    RAISE NOTICE '%',sql;
                    RETURN 'FAIL';
            end;
        END LOOP;
        RAISE notice '-------------> TOPOLOGY CREATED FOR  % edges', rowcount;
        RAISE NOTICE 'Rows with NULL geometry or NULL id: %',notincluded;
        RAISE notice 'Vertices table for table % is: %',_pgr_quote_ident(tabname), _pgr_quote_ident(vertname);
        RAISE notice '----------------------------------------------';
    RETURN 'OK';
 EXCEPTION WHEN OTHERS THEN
   RAISE NOTICE 'Unexpected error %', SQLERRM; -- issue 210,211
   RETURN 'FAIL';
END;
$function$
;

-- Function: pgr_createtopology
-- Comment: pgr_createTopology deprecated function on v3.8.0
-- 
CREATE OR REPLACE FUNCTION public.pgr_createverticestable(text, the_geom text DEFAULT 'the_geom'::text, source text DEFAULT 'source'::text, target text DEFAULT 'target'::text, rows_where text DEFAULT 'true'::text)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
    edge_table TEXT := $1;
    naming record;
    sridinfo record;
    sname TEXT;
    tname TEXT;
    tabname TEXT;
    vname TEXT;
    vertname TEXT;
    gname TEXT;
    sourcename TEXT;
    targetname TEXT;
    query TEXT;
    ecnt BIGINT;
    srid INTEGER;
    sourcetype TEXT;
    targettype TEXT;
    sql TEXT;
    totcount INTEGER;
    i INTEGER;
    notincluded INTEGER;
    included INTEGER;
    debuglevel TEXT;
    dummyRec record;
    fnName TEXT;
    err bool;
BEGIN
  fnName = 'pgr_createVerticesTable';
  RAISE WARNING 'pgr_createverticestable(text,text,text,text,text) deprecated function on v3.8.0';
  RAISE NOTICE 'PROCESSING:';
  RAISE NOTICE 'pgr_createVerticesTable(''%'',''%'',''%'',''%'',''%'')',edge_table,the_geom,source,target,rows_where;
  EXECUTE 'show client_min_messages' INTO debuglevel;
  RAISE NOTICE 'Performing checks, please wait .....';
  RAISE DEBUG 'Checking % exists',edge_table;
        EXECUTE 'select * from _pgr_getTableName('|| quote_literal(edge_table)
                                                  || ',2,' || quote_literal(fnName) ||' )' INTO naming;
    sname=naming.sname;
    tname=naming.tname;
    tabname=sname||'.'||tname;
    vname=tname||'_vertices_pgr';
    vertname= sname||'.'||vname;
    rows_where = ' AND ('||rows_where||')';
  RAISE DEBUG '--> Edge table exists: OK';
  RAISE DEBUG 'Checking column names';
    select * INTO sourcename FROM _pgr_getColumnName(sname, tname,source,2, fnName);
    select * INTO targetname FROM _pgr_getColumnName(sname, tname,target,2, fnName);
    select * INTO gname      FROM _pgr_getColumnName(sname, tname,the_geom,2, fnName);
    err = sourcename IN (targetname,gname) OR  targetname=gname;
    perform _pgr_onError(err, 2, fnName,
        'Two columns share the same name', 'Parameter names for the_geom,source and target  must be different');
  RAISE DEBUG '--> Column names: OK';
  RAISE DEBUG 'Checking column types in edge table';
    select * INTO sourcetype FROM _pgr_getColumnType(sname,tname,sourcename,1, fnName);
    select * INTO targettype FROM _pgr_getColumnType(sname,tname,targetname,1, fnName);
    err = sourcetype not in('integer','smallint','bigint');
    perform _pgr_onError(err, 2, fnName,
        'Wrong type of Column source: '|| sourcename, ' Expected type of '|| sourcename || ' is integer, smallint or bigint but '||sourcetype||' was found');
    err = targettype not in('integer','smallint','bigint');
    perform _pgr_onError(err, 2, fnName,
        'Wrong type of Column target: '|| targetname, ' Expected type of '|| targetname || ' is integer, smallint or bigint but '||targettype||' was found');
  RAISE DEBUG '-->Column types:OK';
  RAISE DEBUG 'Checking SRID of geometry column';
     query= 'SELECT ST_SRID(' || quote_ident(gname) || ') as srid '
        || ' FROM ' || _pgr_quote_ident(tabname)
        || ' WHERE ' || quote_ident(gname)
        || ' IS NOT NULL LIMIT 1';
     RAISE DEBUG '%',query;
     EXECUTE query INTO sridinfo;
     err =  sridinfo IS NULL OR sridinfo.srid IS NULL;
     perform _pgr_onError(err, 2, fnName,
         'Can not determine the srid of the geometry '|| gname ||' in table '||tabname, 'Check the geometry of column '||gname);
     srid := sridinfo.srid;
  RAISE DEBUG '     --> OK';
  RAISE DEBUG 'Checking and creating Indices';
     perform _pgr_createIndex(sname, tname , sourcename , 'btree'::TEXT);
     perform _pgr_createIndex(sname, tname , targetname , 'btree'::TEXT);
     perform _pgr_createIndex(sname, tname , gname , 'gist'::TEXT);
  RAISE DEBUG '-->Check and create indices: OK';
     gname=quote_ident(gname);
     sourcename=quote_ident(sourcename);
     targetname=quote_ident(targetname);
  BEGIN
  RAISE DEBUG 'Checking Condition';
    sql = 'select * from '||_pgr_quote_ident(tabname)||' WHERE true'||rows_where ||' limit 1';
    EXECUTE sql INTO dummyRec;
    sql = 'select count(*) from '||_pgr_quote_ident(tabname)||' WHERE (' || gname || ' IS NULL or '||
		sourcename||' is null or '||targetname||' is null)=true '||rows_where;
    RAISE DEBUG '%',sql;
    EXECUTE SQL  INTO notincluded;
    EXCEPTION WHEN OTHERS THEN
         RAISE NOTICE 'Got %', SQLERRM; -- issue 210,211
         RAISE NOTICE 'ERROR: Condition is not correct, please execute the following query to test your condition';
         RAISE NOTICE '%',sql;
         RETURN 'FAIL';
  END;
  BEGIN
     RAISE DEBUG 'initializing %',vertname;
       EXECUTE 'select * from _pgr_getTableName('||quote_literal(vertname)||',0)' INTO naming;
       IF sname=naming.sname  AND vname=naming.tname  THEN
           EXECUTE 'TRUNCATE TABLE '||_pgr_quote_ident(vertname)||' RESTART IDENTITY';
           EXECUTE 'SELECT DROPGEOMETRYCOLUMN('||quote_literal(sname)||','||quote_literal(vname)||','||quote_literal('the_geom')||')';
       ELSE
           set client_min_messages  to warning;
       	   EXECUTE 'CREATE TABLE '||_pgr_quote_ident(vertname)||' (id bigserial PRIMARY KEY,cnt INTEGER,chk INTEGER,ein INTEGER,eout INTEGER)';
       END IF;
       EXECUTE 'select addGeometryColumn('||quote_literal(sname)||','||quote_literal(vname)||','||
                quote_literal('the_geom')||','|| srid||', '||quote_literal('POINT')||', 2)';
       EXECUTE 'CREATE INDEX '||quote_ident(vname||'_the_geom_idx')||' ON '||_pgr_quote_ident(vertname)||'  USING GIST (the_geom)';
       EXECUTE 'set client_min_messages  to '|| debuglevel;
       RAISE DEBUG  '  ------>OK';
       EXCEPTION WHEN OTHERS THEN
         RAISE NOTICE 'Got %', SQLERRM; -- issue 210,211
         RAISE NOTICE 'ERROR: Initializing vertex table';
         RAISE NOTICE '%',sql;
         RETURN 'FAIL';
  END;
  BEGIN
       RAISE NOTICE 'Populating %, please wait...',vertname;
       sql= 'with
		lines as ((select distinct '||sourcename||' as id, _pgr_startpoint(st_linemerge('||gname||')) as the_geom from '||_pgr_quote_ident(tabname)||
		                  ' where ('|| gname || ' IS NULL
                                    OR '||sourcename||' is null
                                    OR '||targetname||' is null)=false
                                     '||rows_where||')
			UNION (select distinct '||targetname||' as id,_pgr_endpoint(st_linemerge('||gname||')) as the_geom from '||_pgr_quote_ident(tabname)||
			          ' where ('|| gname || ' IS NULL
                                    OR '||sourcename||' is null
                                    OR '||targetname||' is null)=false
                                     '||rows_where||'))
		,numberedLines as (select row_number() OVER (ORDER BY id) AS i,* from lines )
		,maxid as (select id,max(i) as maxi from numberedLines GROUP BY id)
		insert INTO '||_pgr_quote_ident(vertname)||'(id,the_geom)  (select id,the_geom  from numberedLines join maxid using(id) where i=maxi ORDER BY id)';
       RAISE DEBUG '%',sql;
       EXECUTE sql;
       GET DIAGNOSTICS totcount = ROW_COUNT;
       sql = 'select count(*) from '||_pgr_quote_ident(tabname)||' a, '||_pgr_quote_ident(vertname)||' b
            where '||sourcename||'=b.id AND '|| targetname||' IN (select id from '||_pgr_quote_ident(vertname)||')';
       RAISE DEBUG '%',sql;
       EXECUTE sql INTO included;
       EXECUTE 'select max(id) from '||_pgr_quote_ident(vertname) INTO ecnt;
       EXECUTE 'SELECT setval('||quote_literal(vertname||'_id_seq')||','||coalesce(ecnt,1)||' , false)';
       RAISE NOTICE '  ----->   VERTICES TABLE CREATED WITH  % VERTICES', totcount;
       RAISE NOTICE '                                       FOR   %  EDGES', included+notincluded;
       RAISE NOTICE '  Edges with NULL geometry,source or target: %',notincluded;
       RAISE NOTICE '                            Edges processed: %',included;
       RAISE NOTICE 'Vertices table for table % is: %',_pgr_quote_ident(tabname),_pgr_quote_ident(vertname);
       RAISE NOTICE '----------------------------------------------';
    END;
    RETURN 'OK';
 EXCEPTION WHEN OTHERS THEN
   RAISE NOTICE 'Unexpected error %', SQLERRM; -- issue 210,211
   RETURN 'FAIL';
END;
$function$
;

-- Function: pgr_createverticestable
-- Comment: pgr_createVerticesTable deprecated function on v3.8.0
-- 
CREATE OR REPLACE FUNCTION public.pgr_cuthillmckeeordering(text, OUT seq bigint, OUT node bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, node
    FROM _pgr_cuthillMckeeOrdering(_pgr_get_statement($1));
$function$
;

-- Function: pgr_cuthillmckeeordering
-- Comment: pgr_cuthillMckeeOrdering
- EXPERIMENTAL
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_cuthillMckeeOrdering.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dagshortestpath(text, bigint, bigint, OUT seq integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_dagShortestPath(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], true, false ) AS a;
$function$
;

-- Function: pgr_dagshortestpath
-- Comment: pgr_dagShortestPath(One to One)
- EXPERIMENTAL
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From vertex identifier
    - To vertex identifier
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_dagShortestPath.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dagshortestpath(text, anyarray, anyarray, OUT seq integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_dagShortestPath(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], true, false ) AS a;
$function$
;

-- Function: pgr_dagshortestpath
-- Comment: pgr_dagShortestPath(Many to Many)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]
  - To ARRAY[vertices identifiers]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_dagShortestPath.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dagshortestpath(text, anyarray, bigint, OUT seq integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_dagShortestPath(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], true, false ) AS a;
$function$
;

-- Function: pgr_dagshortestpath
-- Comment: pgr_dagShortestPath(Many to One)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]
  - To vertex identifier
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_dagShortestPath.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dagshortestpath(text, bigint, anyarray, OUT seq integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_dagShortestPath(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], true, false ) AS a;
$function$
;

-- Function: pgr_dagshortestpath
-- Comment: pgr_dagShortestPath(One to Many)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From vertex identifier
  - To ARRAY[vertices identifiers]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_dagShortestPath.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dagshortestpath(text, text, OUT seq integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_dagShortestPath(_pgr_get_statement($1), _pgr_get_statement($2), true, false ) AS a;
$function$
;

-- Function: pgr_dagshortestpath
-- Comment: pgr_dagShortestPath(Combinations)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Combinations SQL with columns: source, target
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_dagShortestPath.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_degree(text, dryrun boolean DEFAULT false, OUT node bigint, OUT degree bigint)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
  edges_sql TEXT;
  has_id BOOLEAN;
  has_source BOOLEAN;
  has_target BOOLEAN;
  eids TEXT;
  query TEXT;
  sqlhint TEXT;
BEGIN
  BEGIN
    edges_sql := _pgr_checkQuery($1);
    has_id :=  _pgr_checkColumn(edges_sql, 'id', 'ANY-INTEGER', dryrun => $2);
    has_source :=  _pgr_checkColumn(edges_sql, 'source', 'ANY-INTEGER', dryrun => $2);
    has_target :=  _pgr_checkColumn(edges_sql, 'target', 'ANY-INTEGER', dryrun => $2);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS sqlhint = PG_EXCEPTION_HINT;
      RAISE EXCEPTION '%', SQLERRM USING HINT = sqlhint, ERRCODE = SQLSTATE;
  END;
  query := format($q$
    WITH
    g_edges AS (
      %1$s
    ),
    g_vertices AS (
      SELECT source, id FROM g_edges
      UNION ALL
      SELECT target, id FROM g_edges
    ),
    totals AS (
      SELECT source AS node, count(*) AS degree
      FROM g_vertices
      GROUP BY node
    )
    SELECT node::BIGINT, degree::BIGINT
    FROM totals
    $q$, edges_sql);
  IF dryrun THEN
    RAISE NOTICE '%', query || ';';
  ELSE
    RETURN QUERY EXECUTE query;
  END IF;
END;
$function$
;

-- Function: pgr_degree
-- Comment: pgr_degree
- Parameters
- Edges SQL with columns: id
- Documentation:
- https://docs.pgrouting.org/latest/en/pgr_degree.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_degree(text, text, dryrun boolean DEFAULT false, OUT node bigint, OUT degree bigint)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
  edges_sql TEXT;
  vertices_sql TEXT;
  has_in_edges BOOLEAN := TRUE;
  has_out_edges BOOLEAN := TRUE;
  eids TEXT;
  query TEXT;
  sqlhint TEXT;
BEGIN
  BEGIN
    edges_sql := _pgr_checkQuery($1);
    PERFORM _pgr_checkColumn(edges_sql, 'id', 'ANY-INTEGER', dryrun => $3);
    vertices_sql := _pgr_checkQuery($2);
    PERFORM _pgr_checkColumn(vertices_sql, 'id', 'ANY-INTEGER', dryrun => $3);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS sqlhint = PG_EXCEPTION_HINT;
      RAISE EXCEPTION '%', SQLERRM USING HINT = sqlhint, ERRCODE = SQLSTATE;
  END;
  has_in_edges := _pgr_checkColumn(vertices_sql, 'in_edges', 'ANY-INTEGER[]', true, dryrun => $3);
  has_out_edges := _pgr_checkColumn(vertices_sql, 'out_edges', 'ANY-INTEGER[]', true, dryrun => $3);
  IF NOT has_in_edges AND NOT has_out_edges THEN
      RAISE EXCEPTION 'column "in_edges" does not exist' USING HINT = vertices_sql, ERRCODE = 42703;
  END IF;
  IF has_in_edges THEN
    eids = $$coalesce(in_edges::BIGINT[], '{}'::BIGINT[])$$;
  END IF;
  IF has_out_edges THEN
    IF has_in_edges THEN
      eids = E'\n          ' || eids
            || E'\n          ||\n          '
            || $$coalesce(out_edges::BIGINT[], '{}'::BIGINT[])$$;
    ELSE
      eids = $$coalesce(out_edges::BIGINT[], '{}'::BIGINT[])$$;
    END IF;
  ELSE
    IF NOT has_in_edges THEN
      RAISE EXCEPTION 'Missing column'
      USING HINT = 'Column "in_edges" and/or "out_edges" is missing in'||E'\n'||vertices_sql;
    END IF;
  END IF;
  query := format($q$
    WITH
    g_edges AS (
      $q$ || edges_sql || $q$
    ),
    all_vertices AS (
      $q$ || vertices_sql || $q$
    ),
    g_vertices AS (
      SELECT id,
        unnest(%s) AS eid
      FROM all_vertices
    ),
    totals AS (
      SELECT v.id, count(*)
      FROM g_vertices v
      JOIN g_edges e ON (v.eid = e.id) GROUP BY v.id
    )
    SELECT id::BIGINT, count::BIGINT FROM all_vertices JOIN totals USING (id)
    $q$, eids);
  IF dryrun THEN
    RAISE NOTICE '%', query || ';';
  ELSE
    RETURN QUERY EXECUTE query;
  END IF;
END;
$function$
;

-- Function: pgr_degree
-- Comment: pgr_degree
- Parameters
- Edges SQL with columns: id
- Vertices SQL with columns: id, in_edges, out_edges
- Documentation:
- https://docs.pgrouting.org/latest/en/pgr_degree.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_depthfirstsearch(text, anyarray, directed boolean DEFAULT true, max_depth bigint DEFAULT '9223372036854775807'::bigint, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
BEGIN
    IF $4 < 0 THEN
        RAISE EXCEPTION 'Negative value found on ''max_depth'''
        USING HINT = format('Value found: %s', $4);
    END IF;
    RETURN QUERY
    SELECT a.seq, a.depth, a.start_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_depthFirstSearch(_pgr_get_statement($1), $2, directed, max_depth) AS a;
END;
$function$
;

-- Function: pgr_depthfirstsearch
-- Comment: pgr_depthFirstSearch(Multiple Vertices)
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From ARRAY[root vertices identifiers]
- Optional parameters
    - directed := true
    - max_depth := 9223372036854775807
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_depthFirstSearch.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_depthfirstsearch(text, bigint, directed boolean DEFAULT true, max_depth bigint DEFAULT '9223372036854775807'::bigint, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
BEGIN
    IF $4 < 0 THEN
        RAISE EXCEPTION 'Negative value found on ''max_depth'''
        USING HINT = format('Value found: %s', $4);
    END IF;
    RETURN QUERY
    SELECT a.seq, a.depth, a.start_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_depthFirstSearch(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], directed, max_depth) AS a;
END;
$function$
;

-- Function: pgr_depthfirstsearch
-- Comment: pgr_depthFirstSearch(Single Vertex)
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From root vertex identifier
- Optional parameters
    - directed := true
    - max_depth := 9223372036854775807
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_depthFirstSearch.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstra(text, anyarray, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], $4, false, true, 0, false);
$function$
;

-- Function: pgr_dijkstra
-- Comment: pgr_dijkstra(Many to Many)
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From ARRAY[vertices identifiers]
   - To ARRAY[vertices identifiers]
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_dijkstra.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstra(text, anyarray, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], $4, false, false, 0, false);
$function$
;

-- Function: pgr_dijkstra
-- Comment: pgr_dijkstra(Many to One)
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From ARRAY[vertices identifiers]
   - To vertex identifier
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_dijkstra.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstra(text, bigint, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], $4, false, true, 0, false);
$function$
;

-- Function: pgr_dijkstra
-- Comment: pgr_dijkstra(One to Many)
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From vertex identifier
   - To ARRAY[vertices identifiers]
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_dijkstra.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstra(text, text, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), _pgr_get_statement($2), $3, false, 0, false);
$function$
;

-- Function: pgr_dijkstra
-- Comment: pgr_dijkstra(Combinations)
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - Combinations SQL with columns: source, target
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_dijkstra.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstra(text, bigint, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], $4, false, true, 0, false);
$function$
;

-- Function: pgr_dijkstra
-- Comment: pgr_dijkstra(One to One)
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From vertex identifier
   - To vertex identifier
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_dijkstra.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstracost(text, anyarray, anyarray, directed boolean DEFAULT true, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT start_vid, end_vid, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], $4, true, true, 0, false);
$function$
;

-- Function: pgr_dijkstracost
-- Comment: pgr_dijkstraCost(Many to Many)
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From ARRAY[vertices identifiers]
   - To ARRAY[vertices identifiers]
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_dijkstraCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstracost(text, bigint, bigint, directed boolean DEFAULT true, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT start_vid, end_vid, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], $4, true, true, 0, false);
$function$
;

-- Function: pgr_dijkstracost
-- Comment: pgr_dijkstraCost(One to One)
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From vertex identifier
   - To vertex identifier
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_dijkstraCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstracost(text, text, directed boolean DEFAULT true, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT start_vid, end_vid, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), _pgr_get_statement($2), $3, true, 0, false);
$function$
;

-- Function: pgr_dijkstracost
-- Comment: pgr_dijkstraCost(Combinations SQL)
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - Combinations SQL with columns: source, target
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_dijkstraCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstracost(text, bigint, anyarray, directed boolean DEFAULT true, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT start_vid, end_vid, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], $4, true, true, 0, false);
$function$
;

-- Function: pgr_dijkstracost
-- Comment: pgr_dijkstraCost(One to Many)
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From vertex identifier
   - To ARRAY[vertices identifiers]
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_dijkstraCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstracost(text, anyarray, bigint, directed boolean DEFAULT true, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT start_vid, end_vid, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], $4, true, true, 0, false);
$function$
;

-- Function: pgr_dijkstracost
-- Comment: pgr_dijkstraCost(Many to One)
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From ARRAY[vertices identifiers]
   - To vertex identifier
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_dijkstraCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstracostmatrix(text, anyarray, directed boolean DEFAULT true, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_vid, a.end_vid, a.agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), $2, $2, $3, true, true, 0, false) a;
$function$
;

-- Function: pgr_dijkstracostmatrix
-- Comment: pgr_dijkstraCostMatrix
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - ARRAY [vertices identifiers]
- Optional Parameters
    - directed := true
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_dijkstraCostMatrix.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstranear(text, text, directed boolean DEFAULT true, cap bigint DEFAULT 1, global boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), _pgr_get_statement($2), directed, false, cap, global);
$function$
;

-- Function: pgr_dijkstranear
-- Comment: pgr_dijkstraNear(Combinations)
- PROPOSED
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Combinations SQL with columns: source, target
- Optional Parameters
  - directed => true
  - cap => 1 (nth found)
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_dijkstraNear.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstranear(text, bigint, anyarray, directed boolean DEFAULT true, cap bigint DEFAULT 1, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], directed, false, true, cap, false);
$function$
;

-- Function: pgr_dijkstranear
-- Comment: pgr_dijkstraNear(One to Many)
- PROPOSED
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From vertex identifier
  - To ARRAY[vertices identifiers]
- Optional Parameters
  - directed => true
  - cap => 1 (nth found)
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_dijkstraNear.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstranear(text, anyarray, bigint, directed boolean DEFAULT true, cap bigint DEFAULT 1, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], directed, false, false, cap, false);
$function$
;

-- Function: pgr_dijkstranear
-- Comment: pgr_dijkstraNear(Many to One)
- PROPOSED
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]
  - To vertex identifier
- Optional Parameters
  - directed => true
  - cap => 1 (nth found)
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_dijkstraNear.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstranear(text, anyarray, anyarray, directed boolean DEFAULT true, cap bigint DEFAULT 1, global boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], directed, false, true, cap, global);
$function$
;

-- Function: pgr_dijkstranear
-- Comment: pgr_dijkstraNear(Many to Many)
- PROPOSED
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]
  - To ARRAY[vertices identifiers]
- Optional Parameters
  - directed => true
  - cap => 1 (nth found)
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_dijkstraNear.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstranearcost(text, anyarray, anyarray, directed boolean DEFAULT true, cap bigint DEFAULT 1, global boolean DEFAULT true, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT start_vid, end_vid, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], directed, true, true, cap, global);
$function$
;

-- Function: pgr_dijkstranearcost
-- Comment: pgr_dijkstraNearCost(Many to Many)
- PROPOSED
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]
  - To ARRAY[vertices identifiers]
- Optional Parameters
  - directed => true
  - cap => 1 (nth found)
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_dijkstraNearCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstranearcost(text, text, directed boolean DEFAULT true, cap bigint DEFAULT 1, global boolean DEFAULT true, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT start_vid, end_vid, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), _pgr_get_statement($2), directed, true, cap, global);
$function$
;

-- Function: pgr_dijkstranearcost
-- Comment: pgr_dijkstraNearCost(Combinations)
- PROPOSED
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Combinations SQL with columns: source, target
- Optional Parameters
  - directed => true
  - cap => 1 (nth found)
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_dijkstraNearCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstranearcost(text, anyarray, bigint, directed boolean DEFAULT true, cap bigint DEFAULT 1, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT start_vid, end_vid, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], directed, true, false, cap, true);
$function$
;

-- Function: pgr_dijkstranearcost
-- Comment: pgr_dijkstraNearCost(Many to One)
- PROPOSED
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]
  - To vertex identifier
- Optional Parameters
  - directed => true
  - cap => 1 (nth found)
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_dijkstraNearCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstranearcost(text, bigint, anyarray, directed boolean DEFAULT true, cap bigint DEFAULT 1, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT start_vid, end_vid, agg_cost
    FROM _pgr_dijkstra(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], directed, true, true, cap, true);
$function$
;

-- Function: pgr_dijkstranearcost
-- Comment: pgr_dijkstraNearCost(One to Many)
- PROPOSED
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From vertex identifier
  - To ARRAY[vertices identifiers]
- Optional Parameters
  - directed => true
  - cap => 1 (nth found)
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_dijkstraNearCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_dijkstravia(text, anyarray, directed boolean DEFAULT true, strict boolean DEFAULT false, u_turn_on_edge boolean DEFAULT true, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision, OUT route_agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost, route_agg_cost
    FROM _pgr_dijkstraVia(_pgr_get_statement($1), $2, $3 , $4, $5);
$function$
;

-- Function: pgr_dijkstravia
-- Comment: pgr_dijkstraVia
- PROPOSED
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - ARRAY[via vertices identifiers]
- Optional Parameters
   - directed := true
   - strict := false
   - U_turn_on_edge := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_dijkstraVia.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_drivingdistance(text, anyarray, double precision, directed boolean DEFAULT true, equicost boolean DEFAULT false, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_drivingDistancev4(_pgr_get_statement($1), $2, $3, $4, $5);
$function$
;

-- Function: pgr_drivingdistance
-- Comment: pgr_drivingDistance(Multiple vertices)
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From ARRAY[vertices identifiers]
   - Distance from vertices identifiers
- Optional Parameters
   - directed := true
   - equicost := false
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_drivingDistance.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_drivingdistance(text, bigint, double precision, directed boolean DEFAULT true, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_drivingDistancev4(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3, $4, false);
$function$
;

-- Function: pgr_drivingdistance
-- Comment: pgr_drivingDistance(Single_vertex)
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From vertex identifier
   - Distance from vertex identifier
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_drivingDistance.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_edgecoloring(text, OUT edge_id bigint, OUT color_id bigint)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
BEGIN
    RETURN QUERY
    SELECT a.edge_id, a.color_id
    FROM _pgr_edgeColoring(_pgr_get_statement($1)) AS a;
END;
$function$
;

-- Function: pgr_edgecoloring
-- Comment: pgr_edgeColoring
- EXPERIMENTAL
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_edgeColoring.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_edgedisjointpaths(text, text, directed boolean DEFAULT true, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_edgeDisjointPaths(_pgr_get_statement($1), _pgr_get_statement($2), $3)
  $function$
;

-- Function: pgr_edgedisjointpaths
-- Comment: pgr_edgeDisjointPaths(Combinations)
 - Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - Combinations SQL with columns: source, target
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_edgeDisjointPaths.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_edgedisjointpaths(text, anyarray, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
  SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_edgeDisjointPaths(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], $4);
  $function$
;

-- Function: pgr_edgedisjointpaths
-- Comment: pgr_edgeDisjointPaths(Many to Many)
 - Parameters:
   - edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From ARRAY[vertices identifiers]
   - to ARRAY[vertices identifiers]
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_edgeDisjointPaths.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_edgedisjointpaths(text, anyarray, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_id, path_seq, start_vid, node, edge, cost, agg_cost
    FROM _pgr_edgeDisjointPaths(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], $4);
  $function$
;

-- Function: pgr_edgedisjointpaths
-- Comment: pgr_edgeDisjointPaths(Many to One)
 - Parameters:
   - edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From ARRAY[vertices identifiers]
   - to vertex identifier
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_edgeDisjointPaths.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_edgedisjointpaths(text, bigint, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_id, path_seq, node, edge, cost, agg_cost
    From _pgr_edgeDisjointPaths(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], $4);
  $function$
;

-- Function: pgr_edgedisjointpaths
-- Comment: pgr_edgeDisjointPaths(One to One)
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From vertex identifier
  - to vertex identifier
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_edgeDisjointPaths.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_edgedisjointpaths(text, bigint, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_id, path_seq, end_vid, node, edge, cost, agg_cost
    FROM _pgr_edgeDisjointPaths(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], $4);
  $function$
;

-- Function: pgr_edgedisjointpaths
-- Comment: pgr_edgeDisjointPaths(One to Many)
 - Parameters:
   - dges SQL with columns: id, source, target, cost [,reverse_cost]
   - From vertex identifier
   - to ARRAY[vertices identifiers]
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_edgeDisjointPaths.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_edmondskarp(text, bigint, anyarray, OUT seq integer, OUT edge bigint, OUT start_vid bigint, OUT end_vid bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
        SELECT seq, edge_id, source, target, flow, residual_capacity
        FROM _pgr_maxflow(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], 3);
  $function$
;

-- Function: pgr_edmondskarp
-- Comment: pgr_edmondsKarp(One to Many)
- Directed graph
- Parameters:
  - Edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - From vertex
  - to ARRAY[vertices identifiers]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_edmondsKarp.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_edmondskarp(text, bigint, bigint, OUT seq integer, OUT edge bigint, OUT start_vid bigint, OUT end_vid bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
        SELECT seq, edge_id, source, target, flow, residual_capacity
        FROM _pgr_maxflow(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], 3);
  $function$
;

-- Function: pgr_edmondskarp
-- Comment: pgr_edmondsKarp(One to One)
- Directed graph
- Parameters:
   - Edges SQL with columns: id, source, target, capacity [,reverse_capacity]
   - From vertex
   - to vertex
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_edmondsKarp.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_edmondskarp(text, text, OUT seq integer, OUT edge bigint, OUT start_vid bigint, OUT end_vid bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
        SELECT seq, edge_id, source, target, flow, residual_capacity
        FROM _pgr_maxflow(_pgr_get_statement($1), _pgr_get_statement($2), 3);
  $function$
;

-- Function: pgr_edmondskarp
-- Comment: pgr_edmondsKarp(Combinations)
- Directed graph
- Parameters:
  - Edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - Combinations SQL with columns: source, target
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_edmondsKarp.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_edmondskarp(text, anyarray, bigint, OUT seq integer, OUT edge bigint, OUT start_vid bigint, OUT end_vid bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
        SELECT seq, edge_id, source, target, flow, residual_capacity
        FROM _pgr_maxflow(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], 3);
  $function$
;

-- Function: pgr_edmondskarp
-- Comment: pgr_edmondsKarp(Many to One)
- Directed graph
- Parameters:
  - Edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - From ARRAY[vertices identifiers]
  - to vertex
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_edmondsKarp.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_edmondskarp(text, anyarray, anyarray, OUT seq integer, OUT edge bigint, OUT start_vid bigint, OUT end_vid bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
        SELECT seq, edge_id, source, target, flow, residual_capacity
        FROM _pgr_maxflow(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], 3);
  $function$
;

-- Function: pgr_edmondskarp
-- Comment: pgr_edmondsKarp(Many to Many)
- Directed graph
- Parameters:
  - Edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - From ARRAY[vertices identifiers]
  - to ARRAY[vertices identifiers]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_edmondsKarp.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_edwardmoore(text, anyarray, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.start_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_edwardMoore(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], $4) AS a;
$function$
;

-- Function: pgr_edwardmoore
-- Comment: pgr_edwardMoore(Many to One)
- EXPERIMENTAL
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From ARRAY[vertices identifiers]
   - To vertex identifier
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_edwardMoore.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_edwardmoore(text, text, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.start_vid, a.end_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_edwardMoore(_pgr_get_statement($1), _pgr_get_statement($2), $3) AS a;
$function$
;

-- Function: pgr_edwardmoore
-- Comment: pgr_edwardMoore(Combinations)
- EXPERIMENTAL
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - Combinations SQL with columns: source, target
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_edwardMoore.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_edwardmoore(text, bigint, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_edwardMoore(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], $4) AS a;
$function$
;

-- Function: pgr_edwardmoore
-- Comment: pgr_edwardMoore(One to One)
- EXPERIMENTAL
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From vertex identifier
   - To vertex identifier
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_edwardMoore.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_edwardmoore(text, bigint, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.end_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_edwardMoore(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], $4) AS a;
$function$
;

-- Function: pgr_edwardmoore
-- Comment: pgr_edwardMoore(One to Many)
- EXPERIMENTAL
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From vertex identifier
   - To ARRAY[vertices identifiers]
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_edwardMoore.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_edwardmoore(text, anyarray, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.start_vid, a.end_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_edwardMoore(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], $4) AS a;
$function$
;

-- Function: pgr_edwardmoore
-- Comment: pgr_edwardMoore(Many to Many)
- EXPERIMENTAL
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - From ARRAY[vertices identifiers]
   - To ARRAY[vertices identifiers]
- Optional Parameters
   - directed := true
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_edwardMoore.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_extractvertices(text, dryrun boolean DEFAULT false, OUT id bigint, OUT in_edges bigint[], OUT out_edges bigint[], OUT x double precision, OUT y double precision, OUT geom geometry)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
    edges_SQL TEXT;
    quoted TEXT;
    query TEXT;
    has_geom BOOLEAN := TRUE;
    has_st BOOLEAN := TRUE;
    has_source BOOLEAN := TRUE;
    has_target BOOLEAN := TRUE;
    has_points BOOLEAN := TRUE;
    has_start BOOLEAN := TRUE;
    has_end BOOLEAN := TRUE;
    has_id BOOLEAN := TRUE;
    rec RECORD;
    sqlhint TEXT;
BEGIN
  BEGIN
    edges_sql := _pgr_checkQuery($1);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS sqlhint = PG_EXCEPTION_HINT;
      RAISE EXCEPTION '%', SQLERRM USING HINT = sqlhint, ERRCODE = SQLSTATE;
  END;
  has_id := _pgr_checkColumn(edges_sql, 'id', 'ANY-INTEGER', true, dryrun => $2);
  has_source := _pgr_checkColumn(edges_sql, 'source', 'ANY-INTEGER', true, dryrun => $2);
  has_target := _pgr_checkColumn(edges_sql, 'target', 'ANY-INTEGER', true, dryrun => $2);
  has_geom := _pgr_checkColumn(edges_sql, 'geom', 'geometry', true, dryrun => $2);
  has_start := _pgr_checkColumn(edges_sql, 'startpoint', 'geometry', true, dryrun => $2);
  has_end   := _pgr_checkColumn(edges_sql, 'endpoint', 'geometry', true, dryrun => $2);
  has_points := has_start AND has_end;
  has_st := has_source AND has_target;
  IF (NOT has_geom) THEN
    IF (has_target AND NOT has_source) THEN
        RAISE EXCEPTION 'column "source" does not exist' USING HINT = $1, ERRCODE = 42703;
    ELSIF (NOT has_target AND has_source) THEN
        RAISE EXCEPTION 'column "target" does not exist' USING HINT = $1, ERRCODE = 42703;
    ELSIF (has_start AND NOT has_end) THEN
      RAISE EXCEPTION 'column "endpoint" does not exist' USING HINT = $1, ERRCODE = 42703;
    ELSIF (NOT has_start AND has_end) THEN
      RAISE EXCEPTION 'column "startpoint" does not exist' USING HINT = $1, ERRCODE = 42703;
    ELSIF (NOT has_st AND NOT has_points AND NOT has_geom) THEN
      RAISE EXCEPTION 'column "geom" does not exist' USING HINT = $1, ERRCODE = 42703;
    END IF;
  END IF;
    IF has_geom AND has_id THEN
      query := $q$
        WITH
        main_sql AS (
          $q$ || edges_sql || $q$
        ),
        the_out AS (
          SELECT id::BIGINT AS out_edge, ST_StartPoint(geom) AS geom
          FROM main_sql
        ),
        agg_out AS (
          SELECT array_agg(out_edge ORDER BY out_edge) AS out_edges, ST_x(geom) AS x, ST_Y(geom) AS y, geom
          FROM the_out
          GROUP BY geom
        ),
        the_in AS (
          SELECT id::BIGINT AS in_edge, ST_EndPoint(geom) AS geom
          FROM main_sql
        ),
        agg_in AS (
          SELECT array_agg(in_edge ORDER BY in_edge) AS in_edges, ST_x(geom) AS x, ST_Y(geom) AS y, geom
          FROM the_in
          GROUP BY geom
        ),
        the_points AS (
          SELECT in_edges, out_edges, coalesce(agg_out.geom, agg_in.geom) AS geom
          FROM agg_out
          FULL OUTER JOIN agg_in USING (x, y)
        )
        SELECT row_number() over(ORDER BY ST_X(geom), ST_Y(geom)) AS id, in_edges, out_edges, ST_X(geom), ST_Y(geom), geom
        FROM the_points$q$;
    ELSIF has_geom AND NOT has_id THEN
      query := $q$
        WITH
        main_sql AS (
          $q$ || edges_sql || $q$
        ),
        sub_main AS (
          SELECT ST_StartPoint(geom) AS startpoint, ST_EndPoint(geom) AS endpoint
          FROM main_sql
        ),
        the_out AS (
          SELECT  DISTINCT ST_X(startpoint) AS x, ST_Y(startpoint) AS y, startpoint AS geom
          FROM sub_main
        ),
        the_in AS (
            SELECT DISTINCT ST_X(endpoint) AS x, ST_Y(endpoint) AS y, endpoint AS geom
          FROM sub_main
        ),
        the_points AS (
          SELECT x, y, coalesce(the_out.geom, the_in.geom) AS geom
          FROM the_out
          FULL OUTER JOIN the_in USING (x, y)
        )
        SELECT row_number() over(ORDER BY  ST_X(geom), ST_Y(geom)) AS id, NULL::BIGINT[], NULL::BIGINT[], x, y, geom
        FROM the_points$q$;
    ELSIF has_points AND has_id THEN
      query := $q$
        WITH
        main_sql AS (
          $q$ || edges_sql || $q$
        ),
        the_out AS (
          SELECT id::BIGINT AS out_edge, startpoint AS geom
          FROM main_sql
        ),
        agg_out AS (
          SELECT array_agg(out_edge ORDER BY out_edge) AS out_edges, ST_x(geom) AS x, ST_Y(geom) AS y, geom
          FROM the_out
          GROUP BY geom
        ),
        the_in AS (
          SELECT id::BIGINT AS in_edge, endpoint AS geom
          FROM main_sql
        ),
        agg_in AS (
          SELECT array_agg(in_edge ORDER BY in_edge) AS in_edges, ST_x(geom) AS x, ST_Y(geom) AS y, geom
          FROM the_in
          GROUP BY geom
        ),
        the_points AS (
          SELECT in_edges, out_edges, coalesce(agg_out.geom, agg_in.geom) AS geom
          FROM agg_out
          FULL OUTER JOIN agg_in USING (x, y)
        )
        SELECT row_number() over(ORDER BY  ST_X(geom), ST_Y(geom)) AS id, in_edges, out_edges, ST_X(geom), ST_Y(geom), geom
        FROM the_points$q$;
    ELSIF has_points AND NOT has_id THEN
      query := $q$
        WITH
        main_sql AS (
          $q$ || edges_sql || $q$
        ),
        the_out AS (
          SELECT DISTINCT ST_X(startpoint) AS x, ST_Y(startpoint) AS y, startpoint AS geom
          FROM main_sql
        ),
        the_in AS (
            SELECT DISTINCT ST_X(endpoint) AS x, ST_Y(endpoint) AS y, endpoint AS geom
          FROM main_sql
        ),
        the_points AS (
          SELECT x, y, coalesce(the_out.geom, the_in.geom) AS geom
          FROM the_out
          FULL OUTER JOIN the_in USING (x, y)
        )
        SELECT row_number() over(ORDER BY  ST_X(geom), ST_Y(geom)) AS id, NULL::BIGINT[], NULL::BIGINT[], x, y, geom
        FROM the_points$q$;
    ELSIF has_st AND has_id THEN
      query := $q$ WITH
        main_sql AS (
          $q$ || edges_sql || $q$
        ),
        agg_out AS (
          SELECT source AS vid, array_agg(id::BIGINT) AS out_edges
          FROM main_sql
          GROUP BY source
        ),
        agg_in AS (
          SELECT target AS vid, array_agg(id::BIGINT) AS in_edges
          FROM main_sql
          GROUP BY target
        ),
        the_points AS (
          SELECT vid, in_edges, out_edges
          FROM agg_out
          FULL OUTER JOIN agg_in USING (vid)
        )
        SELECT vid::BIGINT AS id, in_edges, out_edges, NULL::FLOAT, NULL::FLOAT, NULL::geometry
        FROM the_points$q$;
    ELSIF has_st AND NOT has_id THEN
      query := $q$
        WITH
        main_sql AS (
          $q$ || edges_sql || $q$
        ),
        the_points AS (
          SELECT source AS vid FROM main_sql
          UNION
          SELECT target FROM main_sql
        )
        SELECT DISTINCT vid::BIGINT AS id, NULL::BIGINT[], NULL::BIGINT[], NULL::FLOAT, NULL::FLOAT, NULL::geometry
        FROM the_points$q$;
    END IF;
    IF dryrun THEN
      RAISE NOTICE '%', query || ';';
    ELSE
      RETURN QUERY EXECUTE query;
    END IF;
END;
$function$
;

-- Function: pgr_extractvertices
-- Comment: pgr_extractVertices
- Parameters
  - Edges SQL with columns: [id,] startpoint, endpoint
        OR
  - Edges SQL with columns: [id,] source, target
        OR
  - Edges SQL with columns: [id,] geom
- Documentation:
- https://docs.pgrouting.org/latest/en/pgr_extractVertices.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_findcloseedges(text, geometry[], double precision, cap integer DEFAULT 1, dryrun boolean DEFAULT false, OUT edge_id bigint, OUT fraction double precision, OUT side character, OUT distance double precision, OUT geom geometry, OUT edge geometry)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT COST 5
AS $function$
DECLARE
  geom_arr geometry[] := $2;
  tolerance FLOAT := $3;
  cap INTEGER := $4;
  dryrun BOOLEAN := $5;
  edges_SQL TEXT;
  has_id BOOLEAN;
  has_geom BOOLEAN;
  ret_query TEXT;
  ret_query_end TEXT;

  sqlhint TEXT;

BEGIN

  IF (tolerance < 0) THEN
    RAISE EXCEPTION 'Invalid value for "tolerance"';
  END IF;

  IF (cap < 0) THEN
    RAISE EXCEPTION 'Invalid value for "cap"';
  END IF;

  BEGIN
    edges_sql := _pgr_checkQuery($1);
    has_id := _pgr_checkColumn(edges_sql, 'id', 'ANY-INTEGER', false, dryrun => dryrun);
    has_geom := _pgr_checkColumn(edges_sql, 'geom', 'geometry', false, dryrun => dryrun);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS sqlhint = PG_EXCEPTION_HINT;
      RAISE EXCEPTION '%', SQLERRM USING HINT = sqlhint, ERRCODE = SQLSTATE;
  END;

  ret_query = format(
    $q$
WITH
edges_sql AS (%1$s),
point_sql AS (SELECT unnest(%2$L::geometry[]) AS point),
results AS (
  SELECT
    id::BIGINT AS edge_id,
    ST_LineLocatePoint(geom, point) AS fraction,
    CASE WHEN ST_Intersects(ST_Buffer(geom, %3$s, 'side=right endcap=flat'), point)
         THEN 'r'
         ELSE 'l' END::CHAR AS side,
    geom <-> point AS distance,
    point,
    $q$, edges_sql, geom_arr, tolerance);

  ret_query_end = format(
    $q$
  FROM  edges_sql, point_sql
  WHERE ST_DWithin(geom, point, %1$s)
  ORDER BY geom <-> point),
prepare_cap AS (
  SELECT row_number() OVER (PARTITION BY point ORDER BY point, distance) AS rn, *
  FROM results)
SELECT edge_id, fraction, side, distance, point, new_line
FROM prepare_cap
WHERE rn <= %2$s
    $q$, tolerance, cap);

    ret_query = ret_query
      || $q$ST_MakeLine(point, ST_ClosestPoint(geom, point)) AS new_line $q$
      || ret_query_end;

  IF dryrun THEN
    RAISE NOTICE '%', ret_query;
    RETURN;
  END IF;

  RETURN query EXECUTE ret_query;

END;
$function$
;

-- Function: pgr_findcloseedges
-- Comment: pgr_findCloseEdges(Many Points)
- Parameters:
  - Edges SQL with columns: id, geom
  - Array of POINT geometries
  - Maximum separation between geometries
- Optional Parameters
  - cap => 1: at most one answer
  - dryrun => false: do not output code
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_findCloseEdges.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_findcloseedges(text, geometry, double precision, cap integer DEFAULT 1, dryrun boolean DEFAULT false, OUT edge_id bigint, OUT fraction double precision, OUT side character, OUT distance double precision, OUT geom geometry, OUT edge geometry)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT COST 5
AS $function$
  SELECT edge_id, fraction, side, distance, geom, edge
  FROM pgr_findCloseEdges($1, ARRAY[$2]::GEOMETRY[], $3, cap, dryrun);
$function$
;

-- Function: pgr_findcloseedges
-- Comment: pgr_findCloseEdges(One Point)
- Parameters:
  - Edges SQL with columns: id, geom
  - POINT geometry
  - Maximum separation between geometries
- Optional Parameters
  - cap => 1: at most one answer
  - dryrun => false: do not output code
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_findCloseEdges.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_findcloseedges(text, geometry, double precision, cap integer, partial boolean, dryrun boolean, OUT edge_id bigint, OUT fraction double precision, OUT side character, OUT distance double precision, OUT geom geometry, OUT edge geometry)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT COST 5
AS $function$
  SELECT edge_id, fraction, side, distance, geom, edge
  FROM pgr_findCloseEdges($1, ARRAY[$2]::GEOMETRY[], $3, cap, dryrun);
$function$
;

-- Function: pgr_findcloseedges
-- Comment: pgr_findCloseEdges deprecated signature on v3.8.0
-- 
CREATE OR REPLACE FUNCTION public.pgr_findcloseedges(text, geometry[], double precision, cap integer, partial boolean, dryrun boolean, OUT edge_id bigint, OUT fraction double precision, OUT side character, OUT distance double precision, OUT geom geometry, OUT edge geometry)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT COST 5
AS $function$
  SELECT edge_id, fraction, side, distance, geom, edge
  FROM pgr_findCloseEdges($1, $2, $3, cap, dryrun);
$function$
;

-- Function: pgr_findcloseedges
-- Comment: pgr_findCloseEdges deprecated signature on v3.8.0
-- 
CREATE OR REPLACE FUNCTION public.pgr_floydwarshall(text, directed boolean DEFAULT true, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$

    SELECT start_vid, end_vid, agg_cost
    FROM _pgr_floydWarshall(_pgr_get_statement($1), $2);

$function$
;

-- Function: pgr_floydwarshall
-- Comment: pgr_floydWarshall
- Parameters:
    - edges SQL with columns: source, target, cost [,reverse_cost])
- Optional Parameters:
    - directed := true
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_floydWarshall.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_full_version(OUT version text, OUT build_type text, OUT compile_date text, OUT library text, OUT system text, OUT postgresql text, OUT compiler text, OUT boost text, OUT hash text)
 RETURNS record
 LANGUAGE sql
 IMMUTABLE
AS $function$
    SELECT pgr_version(),
        _pgr_build_type(),
        _pgr_compilation_date(),
        _pgr_lib_version(),
        _pgr_operating_system(),
        _pgr_pgsql_version(),
        _pgr_compiler_version(),
        _pgr_boost_version(),
        _pgr_git_hash()
$function$
;

-- Function: pgr_full_version
-- Comment: pgr_full_version
- Documentation
  - https://docs.pgrouting.org/latest/en/pgr_full_version.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_hawickcircuits(text, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
BEGIN
    RETURN QUERY
    SELECT a.seq, a.path_id, a.path_seq, a.start_vid, a.end_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_hawickCircuits(_pgr_get_statement($1)) AS a;
END;
$function$
;

-- Function: pgr_hawickcircuits
-- Comment: pgr_hawickCircuits
- EXPERIMENTAL
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_hawickCircuits.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_isplanar(text)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$
    SELECT _pgr_isPlanar(_pgr_get_statement($1));
$function$
;

-- Function: pgr_isplanar
-- Comment: pgr_isPlanar
- EXPERIMENTAL
- Undirected graph
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_isPlanar.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_johnson(text, directed boolean DEFAULT true, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$

    SELECT start_vid, end_vid, agg_cost
    FROM _pgr_johnson(_pgr_get_statement($1), $2);

$function$
;

-- Function: pgr_johnson
-- Comment: pgr_johnson
- Parameters:
    - edges SQL with columns: source, target, cost [,reverse_cost])
- Optional Parameters:
    - directed := true
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_johnson.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_kruskal(text, OUT edge bigint, OUT cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT edge, cost
    FROM _pgr_kruskalv4(_pgr_get_statement($1), ARRAY[0]::BIGINT[], '', -1, -1);
$function$
;

-- Function: pgr_kruskal
-- Comment: pgr_kruskal
- Undirected graph
- Parameters:
	- Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
	- https://docs.pgrouting.org/latest/en/pgr_kruskal.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_kruskalbfs(text, bigint, max_depth bigint DEFAULT '9223372036854775807'::bigint, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_kruskalv4(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], 'BFS', $3, -1);
$function$
;

-- Function: pgr_kruskalbfs
-- Comment: pgr_kruskalBFS(Single Vertex)
- Undirected graph
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From root vertex identifier
- Optional parameters
    - max_depth: default := 9223372036854775807
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_kruskalBFS.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_kruskalbfs(text, anyarray, max_depth bigint DEFAULT '9223372036854775807'::bigint, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_kruskalv4(_pgr_get_statement($1), $2, 'BFS', $3, -1);
$function$
;

-- Function: pgr_kruskalbfs
-- Comment: pgr_kruskalBFS(multiple Vertices)
- Undirected graph
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From ARRAY[root vertices identifiers]
- Optional parameters
    - max_depth: default := 9223372036854775807
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_kruskalBFS.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_kruskaldd(text, anyarray, double precision, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_kruskalv4(_pgr_get_statement($1), $2, 'DD', -1, $3::FLOAT);
$function$
;

-- Function: pgr_kruskaldd
-- Comment: pgr_kruskalDD(Multiple Vertices)
- Undirected graph
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From ARRAY[root vertices identifiers]
    - Distance
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_kruskalDD.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_kruskaldd(text, bigint, double precision, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_kruskalv4(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], 'DD', -1, $3::FLOAT);
$function$
;

-- Function: pgr_kruskaldd
-- Comment: pgr_kruskalDD(Single Vertex)
- Undirected graph
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From root vertex identifier
    - Distance
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_kruskalDD.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_kruskaldd(text, anyarray, numeric, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_kruskalv4(_pgr_get_statement($1), $2, 'DD', -1, $3);
$function$
;

-- Function: pgr_kruskaldd
-- Comment: pgr_kruskalDD(Multiple Vertices)
- Undirected graph
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From ARRAY[root vertices identifiers]
    - Distance
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_kruskalDD.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_kruskaldd(text, bigint, numeric, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_kruskalv4(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], 'DD', -1, $3::FLOAT);
$function$
;

-- Function: pgr_kruskaldd
-- Comment: pgr_kruskalDD(Single Vertex)
- Undirected graph
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From root vertex identifier
    - Distance
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_kruskalDD.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_kruskaldfs(text, anyarray, max_depth bigint DEFAULT '9223372036854775807'::bigint, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_kruskalv4(_pgr_get_statement($1), $2, 'DFS', $3, -1);
$function$
;

-- Function: pgr_kruskaldfs
-- Comment: pgr_kruskalDFS(Multiple Vertices)
- Undirected graph
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost]
  - from ARRAY[root vertices identifiers]
- Optional parameters
  - max_depth: default 9223372036854775807
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_kruskalDFS.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_kruskaldfs(text, bigint, max_depth bigint DEFAULT '9223372036854775807'::bigint, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_kruskalv4(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], 'DFS', $3, -1);
$function$
;

-- Function: pgr_kruskaldfs
-- Comment: pgr_kruskalDFS(Single Vertex)
- Undirected graph
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost]
  - from root vertex identifier
- Optional parameters
  - max_depth: default 9223372036854775807
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_kruskalDFS.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_ksp(text, anyarray, anyarray, integer, directed boolean DEFAULT true, heap_paths boolean DEFAULT false, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM  _pgr_ksp(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], $4, $5, $6, true);
$function$
;

-- Function: pgr_ksp
-- Comment: pgr_KSP(Many to Many)
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From ARRAY[vertex identifier]
    - To ARRAY[vertex identifier]
    - K
- Optional Parameters
    - directed := true
    - heap_paths := false
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_KSP.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_ksp(text, text, integer, directed boolean DEFAULT true, heap_paths boolean DEFAULT false, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM  _pgr_ksp(_pgr_get_statement($1), _pgr_get_statement($2), $3, $4, $5);
$function$
;

-- Function: pgr_ksp
-- Comment: pgr_KSP(Combinations)
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Combinations SQL with columns: source, target
    - K
- Optional Parameters
    - directed := true
    - heap_paths := false
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_KSP.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_ksp(text, anyarray, bigint, integer, directed boolean DEFAULT true, heap_paths boolean DEFAULT false, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM  _pgr_ksp(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], $4, $5, $6, true);
$function$
;

-- Function: pgr_ksp
-- Comment: pgr_KSP(Many to One)
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From ARRAY[vertex identifier]
    - To vertex identifier
    - K
- Optional Parameters
    - directed := true
    - heap_paths := false
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_KSP.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_ksp(text, bigint, anyarray, integer, directed boolean DEFAULT true, heap_paths boolean DEFAULT false, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM  _pgr_ksp(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], $4, $5, $6, true);
$function$
;

-- Function: pgr_ksp
-- Comment: pgr_KSP(One to Many)
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From vertex identifier
    - To ARRAY[vertex identifier]
    - K
- Optional Parameters
    - directed := true
    - heap_paths := false
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_KSP.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_ksp(text, bigint, bigint, integer, directed boolean DEFAULT true, heap_paths boolean DEFAULT false, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_ksp(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], $4, $5, $6, true);
$function$
;

-- Function: pgr_ksp
-- Comment: pgr_KSP
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From vertex identifier
    - To vertex identifier
    - K
- Optional Parameters
    - directed := true
    - heap_paths := false
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_KSP.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_lengauertarjandominatortree(text, bigint, OUT seq integer, OUT vertex_id bigint, OUT idom bigint)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
BEGIN

    RETURN QUERY
    SELECT a.seq, vid, a.idom
    FROM _pgr_lengauerTarjanDominatorTree(_pgr_get_statement($1),$2) AS a;
END;
$function$
;

-- Function: pgr_lengauertarjandominatortree
-- Comment: pgr_lengauerTarjanDominatorTree
- EXPERIMENTAL
- Directed graph
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_lengauerTarjanDominatorTree.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_linegraph(text, directed boolean DEFAULT true, OUT seq integer, OUT source bigint, OUT target bigint, OUT cost double precision, OUT reverse_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, source, target, cost, reverse_cost
    FROM _pgr_lineGraph(_pgr_get_statement($1), $2)
$function$
;

-- Function: pgr_linegraph
-- Comment: pgr_lineGraph
- PROPOSED
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost]
- Optional Parameters:
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_lineGraph.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_linegraphfull(text, OUT seq integer, OUT source bigint, OUT target bigint, OUT cost double precision, OUT edge bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, source, target, cost, edge
    FROM _pgr_lineGraphFull(_pgr_get_statement($1))
$function$
;

-- Function: pgr_linegraphfull
-- Comment: pgr_lineGraphFull
- EXPERIMENTAL
- For Directed Graph
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_lineGraphFull.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_makeconnected(text, OUT seq bigint, OUT start_vid bigint, OUT end_vid bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, start_vid, end_vid
    FROM _pgr_makeConnected(_pgr_get_statement($1));
$function$
;

-- Function: pgr_makeconnected
-- Comment: pgr_makeConnected
- EXPERIMENTAL
- Undirected graph
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_makeConnected.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_maxcardinalitymatch(text, OUT edge bigint)
 RETURNS SETOF bigint
 LANGUAGE sql
 STRICT
AS $function$
SELECT edge
FROM _pgr_maxCardinalityMatch(_pgr_get_statement($1), false)
$function$
;

-- Function: pgr_maxcardinalitymatch
-- Comment: pgr_maxCardinalityMatch
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_maxCardinalityMatch.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_maxcardinalitymatch(text, directed boolean, OUT seq integer, OUT edge bigint, OUT source bigint, OUT target bigint)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
BEGIN
RAISE WARNING 'pgr_maxCardinalityMatch(text,boolean) deprecated signature on v3.4.0';
RETURN QUERY SELECT a.seq, a.edge, a.source, a.target
FROM _pgr_maxCardinalityMatch(_pgr_get_statement($1), $2) AS a;
END
$function$
;

-- Function: pgr_maxcardinalitymatch
-- Comment: pgr_maxCardinalityMatch deprecated signature on v3.4.0
- Documentation: https://docs.pgrouting.org/latest/en/pgr_maxCardinalityMatch.html
-- 
CREATE OR REPLACE FUNCTION public.pgr_maxflow(text, text)
 RETURNS bigint
 LANGUAGE sql
 STRICT
AS $function$
        SELECT flow
        FROM _pgr_maxflow(_pgr_get_statement($1), _pgr_get_statement($2), algorithm := 1, only_flow := true);
  $function$
;

-- Function: pgr_maxflow
-- Comment: pgr_maxFlow(Combinations)
- Directed graph
- Parameters:
  - Edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - Combinations SQL with columns: source, target
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_maxFlow.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_maxflow(text, bigint, anyarray)
 RETURNS bigint
 LANGUAGE sql
 STRICT
AS $function$
        SELECT flow
        FROM _pgr_maxflow(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], algorithm := 1, only_flow := true);
  $function$
;

-- Function: pgr_maxflow
-- Comment: pgr_maxFlow(One to Many)
- Directed graph
- Parameters:
  - edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - from vertex
  - to ARRAY[vertices identifiers]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_maxFlow.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_maxflow(text, bigint, bigint)
 RETURNS bigint
 LANGUAGE sql
 STRICT
AS $function$
        SELECT flow
        FROM _pgr_maxflow(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], algorithm := 1, only_flow := true);
  $function$
;

-- Function: pgr_maxflow
-- Comment: pgr_maxFlow(One to One)
- Directed graph
- Parameters:
  - edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - from vertex
  - to vertex
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_maxFlow.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_maxflow(text, anyarray, bigint)
 RETURNS bigint
 LANGUAGE sql
 STRICT
AS $function$
        SELECT flow
        FROM _pgr_maxflow(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], algorithm := 1, only_flow := true);
  $function$
;

-- Function: pgr_maxflow
-- Comment: pgr_maxFlow(Many to One)
- Directed graph
- Parameters:
  - edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - from ARRAY[vertices identifiers]
  - to vertex
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_maxFlow.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_maxflow(text, anyarray, anyarray)
 RETURNS bigint
 LANGUAGE sql
 STRICT
AS $function$
        SELECT flow
        FROM _pgr_maxflow(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], algorithm := 1, only_flow := true);
  $function$
;

-- Function: pgr_maxflow
-- Comment: pgr_maxFlow(Many to Many)
- Directed graph
- Parameters:
  - edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - from ARRAY[vertices identifiers]
  - to ARRAY[vertices identifiers]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_maxFlow.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_maxflowmincost(text, anyarray, bigint, OUT seq integer, OUT edge bigint, OUT source bigint, OUT target bigint, OUT flow bigint, OUT residual_capacity bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, edge, source, target, flow, residual_capacity, cost, agg_cost
    FROM _pgr_maxFlowMinCost(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], only_cost := false);
$function$
;

-- Function: pgr_maxflowmincost
-- Comment: pgr_maxFlowMinCost(Many to One)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]vertex identifier
  - To vertex identifier
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_maxFlowMinCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_maxflowmincost(text, bigint, anyarray, OUT seq integer, OUT edge bigint, OUT source bigint, OUT target bigint, OUT flow bigint, OUT residual_capacity bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, edge, source, target, flow, residual_capacity, cost, agg_cost
    FROM _pgr_maxFlowMinCost(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], only_cost := false);
$function$
;

-- Function: pgr_maxflowmincost
-- Comment: pgr_maxFlowMinCost(One to Many)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From vertex identifier
  - To ARRAY[vertices identifiers]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_maxFlowMinCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_maxflowmincost(text, text, OUT seq integer, OUT edge bigint, OUT source bigint, OUT target bigint, OUT flow bigint, OUT residual_capacity bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, edge, source, target, flow, residual_capacity, cost, agg_cost
    FROM _pgr_maxFlowMinCost(_pgr_get_statement($1), _pgr_get_statement($2), only_cost := false);
$function$
;

-- Function: pgr_maxflowmincost
-- Comment: pgr_maxFlowMinCost(Combinations)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Combinations SQL with columns: source, target
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_maxFlowMinCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_maxflowmincost(text, anyarray, anyarray, OUT seq integer, OUT edge bigint, OUT source bigint, OUT target bigint, OUT flow bigint, OUT residual_capacity bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, edge, source, target, flow, residual_capacity, cost, agg_cost
    FROM _pgr_maxFlowMinCost(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], only_cost := false);
$function$
;

-- Function: pgr_maxflowmincost
-- Comment: pgr_maxFlowMinCost(Many to Many)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]
  - To ARRAY[vertices identifiers]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_maxFlowMinCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_maxflowmincost(text, bigint, bigint, OUT seq integer, OUT edge bigint, OUT source bigint, OUT target bigint, OUT flow bigint, OUT residual_capacity bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, edge, source, target, flow, residual_capacity, cost, agg_cost
    FROM _pgr_maxFlowMinCost(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], only_cost := false);
$function$
;

-- Function: pgr_maxflowmincost
-- Comment: pgr_maxFlowMinCost(One to One)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From vertex identifier
  - To vertex identifier
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_maxFlowMinCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_maxflowmincost_cost(text, anyarray, anyarray)
 RETURNS double precision
 LANGUAGE sql
 STRICT
AS $function$
    SELECT cost
    FROM _pgr_maxFlowMinCost(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], only_cost := true);
$function$
;

-- Function: pgr_maxflowmincost_cost
-- Comment: pgr_maxFlowMinCost_Cost (Many to Many)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]
  - To ARRAY[vertices identifiers]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_maxFlowMinCost_Cost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_maxflowmincost_cost(text, anyarray, bigint)
 RETURNS double precision
 LANGUAGE sql
 STRICT
AS $function$
    SELECT cost
    FROM _pgr_maxFlowMinCost(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], only_cost := true);
$function$
;

-- Function: pgr_maxflowmincost_cost
-- Comment: pgr_maxFlowMinCost_Cost (Many to One)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From ARRAY[vertices identifiers]
  - To vertex identifier
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_maxFlowMinCost_Cost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_maxflowmincost_cost(text, bigint, bigint)
 RETURNS double precision
 LANGUAGE sql
 STRICT
AS $function$
    SELECT cost
    FROM _pgr_maxFlowMinCost(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], only_cost := true);
$function$
;

-- Function: pgr_maxflowmincost_cost
-- Comment: pgr_maxFlowMinCost_Cost (One to One)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From vertex identifier
  - To vertex identifier
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_maxFlowMinCost_Cost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_maxflowmincost_cost(text, bigint, anyarray)
 RETURNS double precision
 LANGUAGE sql
 STRICT
AS $function$
    SELECT cost
    FROM _pgr_maxFlowMinCost(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], only_cost := true);
$function$
;

-- Function: pgr_maxflowmincost_cost
-- Comment: pgr_maxFlowMinCost_Cost(One to Many)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - From vertex identifier
  - To ARRAY[vertices identifiers]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_maxFlowMinCost_Cost.html
  
-- 
CREATE OR REPLACE FUNCTION public.pgr_maxflowmincost_cost(text, text)
 RETURNS double precision
 LANGUAGE sql
 STRICT
AS $function$
    SELECT cost
    FROM _pgr_maxFlowMinCost(_pgr_get_statement($1), _pgr_get_statement($2), only_cost := true);
$function$
;

-- Function: pgr_maxflowmincost_cost
-- Comment: pgr_maxFlowMinCost_Cost (Combinations)
- EXPERIMENTAL
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Combinations SQL with columns: source, target
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_maxFlowMinCost_Cost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_nodenetwork(text, double precision, id text DEFAULT 'id'::text, the_geom text DEFAULT 'the_geom'::text, table_ending text DEFAULT 'noded'::text, rows_where text DEFAULT ''::text, outall boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
  
  sname TEXT;  -- schema of tables
  tname TEXT;  -- in table name
  oname TEXT;  -- out table name

  sridinfo record;
  splits BIGINT := 0;
  touched BIGINT := 0;
  untouched BIGINT := 0;
  geomtype TEXT;
  debuglevel TEXT;
  rows_where_out TEXT;

  the_query TEXT;
  the_out_query TEXT;
  the_table TEXT[];
  sqlhint TEXT;
  out_table_exists BOOLEAN;

BEGIN
  RAISE WARNING 'pgr_nodenetwork(text,double precision,text,text,text,text,boolean) deprecated function on v3.8.0';
  RAISE NOTICE 'PROCESSING:';
  RAISE NOTICE 'id: %', id;
  RAISE NOTICE 'the_geom: %', the_geom;
  RAISE NOTICE 'table_ending: %', table_ending;
  RAISE NOTICE 'rows_where: %', rows_where;
  RAISE NOTICE 'outall: %', outall;
  RAISE NOTICE 'pgr_nodeNetwork(''%'', %, ''%'', ''%'', ''%'', ''%'',  %)',
    $1, $2, id,  the_geom, table_ending, rows_where, outall;
  RAISE NOTICE 'Performing checks, please wait .....';
  EXECUTE 'SHOW client_min_messages' INTO debuglevel;

  the_table := parse_ident($1);

  IF array_length(the_table,1) = 1 THEN
    the_table[2] := the_table[1];
    the_table[1] := (SELECT current_schema);
  END IF;

  sname := the_table[1];
  tname := the_table[2];
  oname := the_table[2] || '_' || table_ending;

  rows_where_out = CASE WHEN length(rows_where) > 2 AND NOT outall THEN ' AND (' || rows_where || ')' ELSE '' END;
  rows_where = CASE WHEN length(rows_where) > 2 THEN rows_where ELSE 'true' END;

  -- building query
  BEGIN
    the_query := format(
      $$
      SELECT %s AS id, %s AS the_geom, ST_SRID(%s) AS srid FROM %I.%I WHERE (%s)
      $$,
      id, the_geom, the_geom, sname, tname, rows_where);
    RAISE DEBUG 'Checking: %',the_query;
    the_query := _pgr_checkQuery(the_query);

    EXECUTE format($$SELECT geometrytype(%s) FROM %I.%I limit 1$$, the_geom, sname, tname) INTO geomtype;
    IF geomtype IS NULL THEN
      RAISE WARNING '-------> Table %.% must contain invalid geometries',sname, tname;
      RETURN 'FAIL';
    END IF;

    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS sqlhint = PG_EXCEPTION_HINT;
      RAISE EXCEPTION '%', SQLERRM USING HINT = sqlhint, ERRCODE = SQLSTATE;
  END;

  -- checking query columns
  BEGIN
    RAISE DEBUG 'Checking %', $1;

    IF NOT _pgr_checkColumn(the_query, 'id', 'ANY-INTEGER', true) THEN
      RAISE NOTICE  'ERROR: id column "%"  NOT found IN %.%', id, sname, tname;
      RETURN 'FAIL';
    END IF;

    IF NOT _pgr_checkColumn(the_query, 'the_geom', 'geometry', true) THEN
      RAISE NOTICE  'ERROR: the_geom  column "%"  NOT found IN %.%', the_geom, sname, tname;
      RETURN 'FAIL';
    END IF;

    EXECUTE the_query || ' LIMIT 1' INTO sridinfo;

    IF sridinfo IS NULL OR sridinfo.srid IS NULL THEN
      RAISE NOTICE 'ERROR: Can NOT determine the srid of the geometry "%" IN table %.%', the_geom, sname, tname;
      RETURN 'FAIL';
    END IF;
    RAISE DEBUG '  -----> SRID found %', sridinfo.srid;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'ERROR: Can NOT determine the srid of the geometry "%" IN table %.%', the_geom, sname, tname;
      RETURN 'FAIL';
  END;

---------------
  -- building query to check if table_noded exists
  BEGIN
    the_out_query := format(
      $$
      SELECT id, old_id, sub_id, source, target, %s FROM %I.%I LIMIT 1
      $$,
      the_geom, sname, oname);

    the_out_query := _pgr_checkQuery(the_out_query);
    out_table_exists := true;

    EXCEPTION WHEN OTHERS THEN
      out_table_exists := false;
  END;

---------------
  BEGIN
    RAISE DEBUG 'initializing %.%', sname, oname;
    IF out_table_exists THEN
      EXECUTE format(
        $$TRUNCATE TABLE %I.%I RESTART IDENTITY$$,
        sname, oname);
    ELSE
      SET client_min_messages TO warning;
      EXECUTE format('CREATE TABLE %I.%I (
        id bigserial PRIMARY KEY,
        old_id BIGINT,
        sub_id INTEGER,
        source BIGINT,
        target BIGINT)',
        sname, oname);
      RAISE DEBUG '  ------> Create geometry column of type %', geomtype;
      EXECUTE format($$
        SELECT addGeometryColumn('%I', '%I', '%I', %s, %L, 2)$$,
        sname, oname, the_geom, sridinfo.srid, geomtype);
      EXECUTE 'SET client_min_messages TO '|| debuglevel;
      RAISE DEBUG '  ------>OK';
    END IF;
  END;
----------------

  RAISE NOTICE 'Processing, please wait .....';


  EXECUTE format(
    $$
      INSERT INTO %2$I.%3$I (old_id, sub_id, %4$I)
      SELECT id, sub_id, geom FROM pgr_separateCrossing(replace('%1$s', 'AS the_geom', 'AS geom'), %5$s)
      UNION
      SELECT id, sub_id, geom FROM pgr_separateTouching(replace('%1$s', 'AS the_geom', 'AS geom'), %5$s)
    $$,
    the_query, sname, oname, the_geom, $2);

  GET DIAGNOSTICS splits = ROW_COUNT;

  EXECUTE format(
    $$
    WITH diff AS (SELECT DISTINCT old_id FROM %I.%I)
    SELECT count(*) FROM diff
    $$,
    sname, oname) INTO touched;

  -- here, it misses all original line that did not need to be cut by intersection points: these lines
  -- are already clean
  -- inserts them in the final result: all lines which gid is not in the res table.
  EXECUTE format(
    $$
      INSERT INTO %2$I.%3$I (old_id , sub_id, %5$I) (
        WITH
        original AS (%1$s),
        used AS (SELECT DISTINCT old_id FROM %2$I.%3$I)
        SELECT id, 1 AS sub_id, the_geom
        FROM original
        WHERE id NOT IN (SELECT old_id FROM used) %4$s)
    $$,
  the_query, sname, oname, rows_where_out, the_geom);
  GET DIAGNOSTICS untouched = ROW_COUNT;

  RAISE NOTICE '  Split Edges: %', touched;
  RAISE NOTICE ' Untouched Edges: %', untouched;
  RAISE NOTICE '     Total original Edges: %', touched+untouched;
  RAISE NOTICE ' Edges generated: %', splits;
  RAISE NOTICE ' Untouched Edges: %',untouched;
  RAISE NOTICE '       Total New segments: %', splits+untouched;
  RAISE NOTICE ' New Table: %.%', sname, oname;
  RAISE NOTICE '----------------------------------';

  RETURN 'OK';
END;
$function$
;

-- Function: pgr_nodenetwork
-- Comment: pgr_nodeNetwork deprecated function on v3.8.0
-- 
CREATE OR REPLACE FUNCTION public.pgr_pickdeliver(text, text, text, factor double precision DEFAULT 1, max_cycles integer DEFAULT 10, initial_sol integer DEFAULT 4, OUT seq integer, OUT vehicle_seq integer, OUT vehicle_id bigint, OUT stop_seq integer, OUT stop_type integer, OUT stop_id bigint, OUT order_id bigint, OUT cargo double precision, OUT travel_time double precision, OUT arrival_time double precision, OUT wait_time double precision, OUT service_time double precision, OUT departure_time double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, vehicle_seq, vehicle_id, stop_seq, stop_type, stop_id, order_id, cargo, travel_time, arrival_time,
           wait_time, service_time, departure_time
    FROM _pgr_pickDeliver(_pgr_get_statement($1), _pgr_get_statement($2), $3, $4, $5);
$function$
;

-- Function: pgr_pickdeliver
-- Comment: pgr_pickDeliver
 - EXPERIMENTAL
 - Parameters:
   - orders SQL with columns:
     - id, demand, p_node_id, p_open, p_close, d_node_id, d_open, d_close
     - optional columns:
        - p_service := 0
        - d_service := 0
   - vehicles SQL with columns:
     - id, capacity, start_open, start_close
     - optional columns:
        - speed := 1
        - start_service := 0
        - end_open := start_open
        - end_close := start_close
        - end_service := 0
   - Matrix
     - start_vid
     - end_vid
     - agg_cost
 - Optional Parameters:
   - factor: default := 1
   - max_cycles: default := 10
   - initial_sol: default := 4
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_pickDeliver.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_pickdelivereuclidean(text, text, factor double precision DEFAULT 1, max_cycles integer DEFAULT 10, initial_sol integer DEFAULT 4, OUT seq integer, OUT vehicle_seq integer, OUT vehicle_id bigint, OUT stop_seq integer, OUT stop_type integer, OUT order_id bigint, OUT cargo double precision, OUT travel_time double precision, OUT arrival_time double precision, OUT wait_time double precision, OUT service_time double precision, OUT departure_time double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, vehicle_seq, vehicle_id, stop_seq, stop_type, order_id, cargo, travel_time, arrival_time,
           wait_time, service_time, departure_time
    FROM _pgr_pickDeliverEuclidean(_pgr_get_statement($1), _pgr_get_statement($2), $3, $4, $5);
$function$
;

-- Function: pgr_pickdelivereuclidean
-- Comment: pgr_pickDeliverEuclidean
 - EXPERIMENTAL
 - Parameters:
   - orders SQL with columns:
     - id, demand, p_x, p_t, d_x, d_y, p_open, p_close, d_open, d_close
     - optional columns:
       - p_service := 0
       - d_service := 0
   - vehicles SQL with columns:
     - id, start_x, start_y, capacity, start_open, start_close
     - optional columns:
       - speed := 1
       - start_service := 0
       - end_x := start_x
       - end_y := start_y
       - end_open := start_open
       - end_close := start_close
       - end_service := 0
 - Optional Parameters:
   - factor: default := 1
   - max_cycles: default := 10
   - initial_sol: default := 4
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_pickDeliver.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_prim(text, OUT edge bigint, OUT cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT edge, cost
    FROM _pgr_primv4(_pgr_get_statement($1), ARRAY[0]::BIGINT[], '', -1, -1);
$function$
;

-- Function: pgr_prim
-- Comment: pgr_prim
- Undirected graph
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_prim.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_primbfs(text, bigint, max_depth bigint DEFAULT '9223372036854775807'::bigint, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_primv4(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], 'BFS', $3, -1);
$function$
;

-- Function: pgr_primbfs
-- Comment: pgr_primBFS(Single Vertex)
- Undirected graph
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From root vertex identifier
- Optional parameters
    - max_depth := 9223372036854775807
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_primBFS.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_primbfs(text, anyarray, max_depth bigint DEFAULT '9223372036854775807'::bigint, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_primv4(_pgr_get_statement($1), $2, 'BFS', $3, -1);
$function$
;

-- Function: pgr_primbfs
-- Comment: pgr_primBFS(multiple Vertices)
- Undirected graph
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From ARRAY[root vertices identifiers]
- Optional parameters
    - max_depth := 9223372036854775807
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_primBFS.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_primdd(text, anyarray, double precision, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_primv4(_pgr_get_statement($1), $2, 'DD', -1, $3::FLOAT);
$function$
;

-- Function: pgr_primdd
-- Comment: pgr_primDD(Multiple Vertices)
- Undirected graph
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From ARRAY[root vertices identifiers]
    - Distance
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_primDD.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_primdd(text, bigint, numeric, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_primv4(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], 'DD', -1, $3::FLOAT);
$function$
;

-- Function: pgr_primdd
-- Comment: pgr_primDD(Single Vertex)
- Undirected graph
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From root vertex identifier
    - Distance
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_primDD.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_primdd(text, anyarray, numeric, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_primv4(_pgr_get_statement($1), $2, 'DD', -1, $3);
$function$
;

-- Function: pgr_primdd
-- Comment: pgr_primDD(Multiple Vertices)
- Undirected graph
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From ARRAY[root vertices identifiers]
    - Distance
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_primDD.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_primdd(text, bigint, double precision, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_primv4(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], 'DD', -1, $3::FLOAT);
$function$
;

-- Function: pgr_primdd
-- Comment: pgr_primDD(Single Vertex)
- Undirected graph
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From root vertex identifier
    - Distance
- DocumentatiEdgeson:
    - https://docs.pgrouting.org/latest/en/pgr_primDD.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_primdfs(text, anyarray, max_depth bigint DEFAULT '9223372036854775807'::bigint, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_primv4(_pgr_get_statement($1), $2, 'DFS', $3, -1);
$function$
;

-- Function: pgr_primdfs
-- Comment: pgr_primDFS(Multiple Vertices)
- Undirected graph
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From ARRAY[root vertices identifiers]
- Optional parameters
    - max_depth := 9223372036854775807
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_primDFS.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_primdfs(text, bigint, max_depth bigint DEFAULT '9223372036854775807'::bigint, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_primv4(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], 'DFS', $3, -1);
$function$
;

-- Function: pgr_primdfs
-- Comment: pgr_primDFS(Single Vertex)
- Undirected graph
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - From root vertex identifier
- Optional parameters
    - max_depth := 9223372036854775807
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_primDFS.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_pushrelabel(text, text, OUT seq integer, OUT edge bigint, OUT start_vid bigint, OUT end_vid bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
        SELECT seq, edge_id, source, target, flow, residual_capacity
        FROM _pgr_maxflow(_pgr_get_statement($1), _pgr_get_statement($2), 1);
  $function$
;

-- Function: pgr_pushrelabel
-- Comment: pgr_pushRelabel(Combinations)
- Directed graph
- Parameters:
  - Edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - Combinations SQL with columns: source, target
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_pushRelabel.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_pushrelabel(text, bigint, anyarray, OUT seq integer, OUT edge bigint, OUT start_vid bigint, OUT end_vid bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
        SELECT seq, edge_id, source, target, flow, residual_capacity
        FROM _pgr_maxflow(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], $3::BIGINT[], 1);
  $function$
;

-- Function: pgr_pushrelabel
-- Comment: pgr_pushRelabel(One to Many)
- Directed graph
- Parameters:
  - Edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - From vertex identifie
  - To ARRAY[vertices identifiers]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_pushRelabel.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_pushrelabel(text, bigint, bigint, OUT seq integer, OUT edge bigint, OUT start_vid bigint, OUT end_vid bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
        SELECT seq, edge_id, source, target, flow, residual_capacity
        FROM _pgr_maxflow(_pgr_get_statement($1), ARRAY[$2]::BIGINT[], ARRAY[$3]::BIGINT[], 1);
  $function$
;

-- Function: pgr_pushrelabel
-- Comment: pgr_pushRelabel(One to One)
- Directed graph
- Parameters:
  - Edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - From vertex identifier
  - To vertex identifier
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_pushRelabel.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_pushrelabel(text, anyarray, bigint, OUT seq integer, OUT edge bigint, OUT start_vid bigint, OUT end_vid bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
        SELECT seq, edge_id, source, target, flow, residual_capacity
        FROM _pgr_maxflow(_pgr_get_statement($1), $2::BIGINT[], ARRAY[$3]::BIGINT[], 1);
  $function$
;

-- Function: pgr_pushrelabel
-- Comment: pgr_pushRelabel(Many to One)
- Directed graph
- Parameters:
  - Edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - From ARRAY[vertices identifiers]
  - To vertex identifie
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_pushRelabel.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_pushrelabel(text, anyarray, anyarray, OUT seq integer, OUT edge bigint, OUT start_vid bigint, OUT end_vid bigint, OUT flow bigint, OUT residual_capacity bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
        SELECT seq, edge_id, source, target, flow, residual_capacity
        FROM _pgr_maxflow(_pgr_get_statement($1), $2::BIGINT[], $3::BIGINT[], 1);
  $function$
;

-- Function: pgr_pushrelabel
-- Comment: pgr_pushRelabel(Many to Many)
- Directed graph
- Parameters:
  - Edges SQL with columns: id, source, target, capacity [,reverse_capacity]
  - From ARRAY[vertices identifiers]
  - To ARRAY[vertices identifiers]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_pushRelabel.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_separatecrossing(text, tolerance double precision DEFAULT 0.01, dryrun boolean DEFAULT false, OUT seq integer, OUT id bigint, OUT sub_id integer, OUT geom geometry)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
  edges_sql TEXT := $1;

  the_query TEXT;
  sqlhint TEXT;
  has_geom BOOLEAN;
  has_id BOOLEAN;
BEGIN

  IF tolerance <= 0 THEN
    RAISE EXCEPTION $$'tolerance' must be a positive number (given %)$$, tolerance
      USING ERRCODE = '22023'; -- invalid_parameter_value
  END IF;

  BEGIN
    edges_sql := _pgr_checkQuery($1);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS sqlhint = PG_EXCEPTION_HINT;
      RAISE EXCEPTION '%', SQLERRM USING HINT = sqlhint, ERRCODE = SQLSTATE;
  END;

  has_id := _pgr_checkColumn(edges_sql, 'id', 'ANY-INTEGER', false, dryrun);
  has_geom := _pgr_checkColumn(edges_sql, 'geom', 'geometry', false, dryrun);

  IF NOT has_id OR NOT has_geom THEN
    RAISE EXCEPTION $$'id' or 'geom' are missing$$ USING HINT = edges_sql;
  END IF;

  the_query := format(
    $$
    WITH
        edges_table AS (
          %s
        ),

    get_crossings AS (
      SELECT e1.id id1, e2.id id2, e1.geom AS g1, e2.geom AS g2, ST_Intersection(e1.geom, e2.geom) AS point
      FROM edges_table e1, edges_table e2
      WHERE e1.id < e2.id AND ST_Crosses(e1.geom, e2.geom)
    ),

    crossings AS (
      SELECT id1, g1, point FROM get_crossings
      UNION
      SELECT id2, g2, point FROM get_crossings
    ),

    blades AS (
      SELECT id1, g1, ST_UnaryUnion(ST_Collect(point)) AS blade
      FROM crossings
      GROUP BY id1, g1
    ),

    collection AS (
      SELECT id1, (st_dump(st_split(st_snap(g1, blade, %2$s), blade))).*
      FROM blades
    )

    SELECT row_number() over()::INTEGER AS seq, id1::BIGINT, path[1], geom
    FROM collection;
    $$,

    edges_sql, tolerance);

    IF dryrun THEN
      RAISE NOTICE '%', the_query || ';';
    ELSE
      RETURN QUERY EXECUTE the_query;
    END IF;

END;
$function$
;

-- Function: pgr_separatecrossing
-- Comment: pgr_separateCrossing
- Parameters
  - Edges SQL with columns: id, geom
- Optional parameters
  - tolerance => 0.01
  - dryrun => true
- DOCUMENTATION:
  - https://docs.pgrouting.org/latest/en/pgr_separateCrossing.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_separatetouching(text, tolerance double precision DEFAULT 0.01, dryrun boolean DEFAULT false, OUT seq integer, OUT id bigint, OUT sub_id integer, OUT geom geometry)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
  edges_sql TEXT := $1;

  the_query TEXT;
  sqlhint TEXT;
  has_geom BOOLEAN;
  has_id BOOLEAN;
BEGIN

  BEGIN
    edges_sql := _pgr_checkQuery($1);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS sqlhint = PG_EXCEPTION_HINT;
      RAISE EXCEPTION '%', SQLERRM USING HINT = sqlhint, ERRCODE = SQLSTATE;
  END;

  has_id := _pgr_checkColumn(edges_sql, 'id', 'ANY-INTEGER', true, dryrun => $3);
  has_geom := _pgr_checkColumn(edges_sql, 'geom', 'geometry', true, dryrun => $3);

  the_query := format($$
    WITH
    edges_table AS (
      %s
    ),

    get_touching AS (
      SELECT e1.id id1, e2.id id2, ST_Snap(e1.geom, e2.geom, %2$s) AS geom, e1.geom AS g1, e2.geom AS g2
      FROM edges_table e1, edges_table e2
      WHERE e1.id != e2.id AND ST_DWithin(e1.geom, e2.geom, %2$s) AND NOT(
        ST_StartPoint(e1.geom) = ST_StartPoint(e2.geom) OR ST_StartPoint(e1.geom) = ST_EndPoint(e2.geom)
        OR ST_EndPoint(e1.geom) = ST_StartPoint(e2.geom) OR ST_EndPoint(e1.geom) = ST_EndPoint(e2.geom))
    ),

    touchings AS (
      SELECT  id1, g1, g2, st_intersection(geom, g2) AS point
      FROM get_touching
      WHERE  NOT (geom = g1) OR
         (ST_touches(g1, g2) AND NOT
            (ST_Intersection(geom, g2) = ST_StartPoint(g1)
             OR ST_Intersection(geom, g2) = ST_EndPoint(g1)))
    ),

    blades AS (
      SELECT id1, g1, ST_UnaryUnion(ST_Collect(point)) AS blade
      FROM touchings
      GROUP BY id1, g1
    ),

    collection AS (
      SELECT id1, (st_dump(st_split(st_snap(g1, blade, %2$s), blade))).*
      FROM blades
    )

    SELECT row_number() over()::INTEGER AS seq, id1::BIGINT, path[1], geom
    FROM collection;
    $$,

    edges_sql, tolerance);

    IF dryrun THEN
      RAISE NOTICE '%', the_query || ';';
    ELSE
      RETURN QUERY EXECUTE the_query;
    END IF;

END;
$function$
;

-- Function: pgr_separatetouching
-- Comment: pgr_separateTouching
- Parameters
  - Edges SQL with columns: id, geom
- Optional parameters
  - tolerance => 0.01
  - dryrun => true
- DOCUMENTATION:
  - https://docs.pgrouting.org/latest/en/pgr_separateTouching.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_sequentialvertexcoloring(text, OUT vertex_id bigint, OUT color_id bigint)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
BEGIN
    RETURN QUERY
    SELECT a.vertex_id, a.color_id
    FROM _pgr_sequentialVertexColoring(_pgr_get_statement($1)) AS a;
END;
$function$
;

-- Function: pgr_sequentialvertexcoloring
-- Comment: pgr_sequentialVertexColoring
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_sequentialVertexColoring.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_stoerwagner(text, OUT seq integer, OUT edge bigint, OUT cost double precision, OUT mincut double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, edge, cost, mincut
    FROM _pgr_stoerWagner(_pgr_get_statement($1));
$function$
;

-- Function: pgr_stoerwagner
-- Comment: pgr_stoerWagner
- EXPERIMENTAL
- Undirected graph
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_stoerWagner.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_strongcomponents(text, OUT seq bigint, OUT component bigint, OUT node bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, component, node
    FROM _pgr_strongComponents(_pgr_get_statement($1));
$function$
;

-- Function: pgr_strongcomponents
-- Comment: pgr_strongComponents
- Directed graph
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_strongComponents.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_topologicalsort(text, OUT seq integer, OUT sorted_v bigint)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, sorted_v
    FROM _pgr_topologicalSort(_pgr_get_statement($1));
$function$
;

-- Function: pgr_topologicalsort
-- Comment: pgr_topologicalSort
- EXPERIMENTAL
- Directed graph
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_topologicalSort.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_transitiveclosure(text, OUT seq integer, OUT vid bigint, OUT target_array bigint[])
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, vid, target_array
    FROM _pgr_transitiveClosure(_pgr_get_statement($1));
$function$
;

-- Function: pgr_transitiveclosure
-- Comment: pgr_transitiveClosure
- EXPERIMENTAL
- Directed graph
- Parameters:
  - edges SQL with columns: id, source, target, cost [,reverse_cost]
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_transitiveClosure.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_trsp(text, integer, integer, boolean, boolean, restrictions_sql text DEFAULT NULL::text, OUT seq integer, OUT id1 integer, OUT id2 integer, OUT cost double precision)
 RETURNS SETOF record
 LANGUAGE plpgsql
AS $function$
DECLARE
    edges_sql TEXT    := $1;
    start_vid INTEGER := $2;
    end_vid INTEGER   := $3;
    directed BOOLEAN  := $4;
    has_rcost BOOLEAN := $5;

has_reverse BOOLEAN;
new_sql TEXT;
restrictions_query TEXT;
trsp_sql TEXT;
BEGIN
  RAISE WARNING 'pgr_trsp(text,integer,integer,boolean,boolean) deprecated signature on v3.4.0';
    has_reverse =_pgr_parameter_check('dijkstra', edges_sql, false);

    new_sql := edges_sql;
    IF (has_reverse != has_rcost) THEN  -- user contradiction
        IF (has_reverse) THEN  -- it has reverse_cost but user don't want it.
            -- to be on the safe side because it reads the data wrong, sending only postitive values
            new_sql :=
            'WITH old_sql AS (' || edges_sql || ')' ||
            '   SELECT id, source, target, cost FROM old_sql';
        ELSE -- it does not have reverse_cost but user wants it
            RAISE EXCEPTION 'Error, reverse_cost is used, but query did''t return ''reverse_cost'' column'
            USING ERRCODE := 'XX000';
        END IF;
    END IF;

    IF (restrictions_sql IS NULL OR length(restrictions_sql) = 0) THEN
        -- no restrictions then its a dijkstra
        RETURN query SELECT a.seq - 1 AS seq, node::INTEGER AS id1, edge::INTEGER AS id2, a.cost
        FROM pgr_dijkstra(new_sql, start_vid, end_vid, directed) a;
        RETURN;
    END IF;


    restrictions_query = $$
        WITH old_restrictions AS ( $$ ||
            $6 || $$
        )
        SELECT ROW_NUMBER() OVER() AS id,
            _pgr_array_reverse(array_prepend(target_id, string_to_array(via_path::text, ',')::INTEGER[])) AS path,
            to_cost AS cost
        FROM old_restrictions;
    $$;



    RETURN query
        SELECT (a.seq - 1)::INTEGER, a.node::INTEGER, a.edge::INTEGER, a.cost
        FROM _pgr_trsp(new_sql, restrictions_query, start_vid, end_vid, directed) AS a;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Error computing path: Path Not Found';
    END IF;

END
$function$
;

-- Function: pgr_trsp
-- Comment: pgr_trsp deprecated signature on v3.4.0
- Documentation: https://docs.pgrouting.org/latest/en/pgr_trsp.html
-- 
CREATE OR REPLACE FUNCTION public.pgr_trsp(text, text, anyarray, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
  SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
  FROM _pgr_trspv4(
    _pgr_get_statement($1),
    _pgr_get_statement($2),
    $3::BIGINT[],
    $4::BIGINT[],
    $5) AS a;
$function$
;

-- Function: pgr_trsp
-- Comment: pgr_trsp(many to many)
- PROPOSED
- Parameters
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Restrictions SQL with columns: cost, path
  - Departures ARRAY[vertices identifier]
  - Destinations ARRAY[vertices identifier]
- Optional parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_trsp.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_trsp(text, integer, double precision, integer, double precision, boolean, boolean, turn_restrict_sql text DEFAULT NULL::text, OUT seq integer, OUT id1 integer, OUT id2 integer, OUT cost double precision)
 RETURNS SETOF record
 LANGUAGE plpgsql
AS $function$
DECLARE
    sql TEXT                 := $1;
    source_eid INTEGER       := $2;
    source_pos FLOAT         := $3;
    target_eid INTEGER       := $4;
    target_pos FLOAT         := $5;
    directed BOOLEAN         := $6;
    has_reverse_cost BOOLEAN := $7;

has_reverse BOOLEAN;
new_sql TEXT;
trsp_sql TEXT;
source_sql TEXT;
target_sql TEXT;
union_sql TEXT;
union_sql1 TEXT;
union_sql2 TEXT;
final_sql TEXT;

BEGIN
    IF $2 IS NULL OR $3 IS NULL OR $4 IS NULL OR $5 IS NULL OR $6 IS NULL THEN
        RETURN;
    END IF;
  RAISE WARNING 'pgr_trsp(text,integer,float,integer,float,boolean,boolean) deprecated signature on v3.4.0';
    has_reverse =_pgr_parameter_check('dijkstra', sql, false);

    new_sql := sql;
    IF (has_reverse != has_reverse_cost) THEN  -- user contradiction
        IF (has_reverse) THEN
            -- it has reverse_cost but user don't want it.
            -- to be on the safe side because it reads the data wrong, sending only postitive values
            new_sql :=
            'WITH old_sql AS (' || sql || ')' ||
            '   SELECT id, source, target, cost FROM old_sql';
        ELSE -- it does not have reverse_cost but user wants it
            RAISE EXCEPTION 'Error, reverse_cost is used, but query did''t return ''reverse_cost'' column'
            USING ERRCODE := 'XX000';
        END IF;
    END IF;

    IF (turn_restrict_sql IS NULL OR length(turn_restrict_sql) = 0) THEN
        -- no restrictions then its a withPoints or dijkstra
        IF source_pos = 0 THEN
            source_sql = '(SELECT source FROM (' || sql || ') b WHERE id = ' ||  source_eid || ')';
        ELSE IF source_pos = 1 THEN
            source_sql = '(SELECT target FROM (' || sql || ') b WHERE id = ' || source_eid || ')';
        ELSE
            source_sql = '-1';
            union_sql1 =  '(SELECT 1 as pid, ' || source_eid || ' as edge_id, ' || source_pos || '::float8 as fraction)';
        END IF;
        END IF;
        -- raise notice 'source_sql %', source_sql;
        -- raise notice 'union_sql1 %', union_sql1;


        IF target_pos = 0 THEN
            target_sql = '(SELECT source FROM (' || sql || ') c WHERE id = ' ||  target_eid || ')';
        ELSE IF target_pos = 1 THEN
            target_sql = '(SELECT target FROM (' || sql || ') c WHERE id = ' ||  target_eid || ')';
        ELSE
            target_sql = '-2';
            union_sql2 =  ' (SELECT 2 as pid, ' || target_eid || ' as edge_id, ' || target_pos || '::float8 as fraction)';
        END IF;
        END IF;

        -- raise notice 'target_sql %', target_sql;
        -- raise notice 'union_sql2 %', union_sql2;

        IF union_sql1 IS NOT NULL AND union_sql2 IS NOT NULL THEN
            union_sql = union_sql1 || ' UNION ' || union_sql2;
        ELSE IF union_sql1 IS NOT NULL AND union_sql2 IS NULL THEN
            union_sql = union_sql1;
        ELSE IF union_sql1 IS NULL AND union_sql2 IS NOT NULL THEN
            union_sql = union_sql2;
        END IF;
        END IF;
        END IF;

        IF union_sql IS NULL THEN
            -- no points then its a dijkstra
            final_sql = 'WITH final_sql AS (
                 SELECT  a.seq-1 AS seq, node::INTEGER AS id1, edge::INTEGER AS id2, cost FROM pgr_dijkstra($$' || new_sql || '$$
                ,' || source_sql || '
                ,' || target_sql || '
                , directed := ' || directed || '
            ) a )
            SELECT seq, id1, id2, cost  FROM final_sql ORDER BY seq';
        ELSE
            -- points then its a withPoints
            final_sql = 'WITH final_sql AS (
                SELECT  a.seq-1 AS seq, node::INTEGER AS id1, edge::INTEGER AS id2, cost FROM pgr_withpoints($$' || new_sql || '$$
                , $$' || union_sql || '$$
                ,' || source_sql || '
                ,' || target_sql || '
                , directed := ' || directed || '
            ) a )
            SELECT seq, CASE WHEN seq = 0 AND ' || source_pos || '=0 THEN id1
                             WHEN seq = 0 AND ' || source_pos || '!=0 THEN -1
                             WHEN id2 = -1 AND ' || target_pos || '=0 THEN id1
                             WHEN id2 = -1 AND ' || target_pos || '!=0 THEN id1
                             ELSE id1 END AS id1, id2, cost  FROM final_sql ORDER BY seq';
        END IF;


        -- raise notice 'final_sql %', final_sql;
        RETURN QUERY EXECUTE final_sql;
        RETURN;

    END IF;

    -- with restrictions calls the original code
    RETURN query
    SELECT a.seq, a.id1, a.id2, a.cost
    FROM _pgr_trsp(new_sql, source_eid, source_pos, target_eid, target_pos, directed, has_reverse_cost, turn_restrict_sql) AS a;
    RETURN;

END
$function$
;

-- Function: pgr_trsp
-- Comment: pgr_trsp deprecated signature on v3.4.0
- Documentation: https://docs.pgrouting.org/latest/en/pgr_trsp_withPoints.html
-- 
CREATE OR REPLACE FUNCTION public.pgr_trsp(text, text, anyarray, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
  SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
  FROM _pgr_trspv4(
    _pgr_get_statement($1),
    _pgr_get_statement($2),
    $3::BIGINT[],
    ARRAY[$4]::BIGINT[],
    $5) AS a;
$function$
;

-- Function: pgr_trsp
-- Comment: pgr_trsp(many to one)
- PROPOSED
- Parameters
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Restrictions SQL with columns: cost, path
  - Departures ARRAY[vertices identifier]
  - Destination vertex identifier
- Optional parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_trsp.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_trsp(text, text, text, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
  SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
  FROM _pgr_trspv4(
    _pgr_get_statement($1),
    _pgr_get_statement($2),
    _pgr_get_statement($3),
    $4) AS a;
$function$
;

-- Function: pgr_trsp
-- Comment: pgr_trsp(combinations)
- PROPOSED
- Parameters
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Restrictions SQL with columns: cost, path
  - Combinations SQL with columns: source, target
- Optional parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_trsp.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_trsp(text, text, bigint, anyarray, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
  SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
  FROM _pgr_trspv4(
    _pgr_get_statement($1),
    _pgr_get_statement($2),
    ARRAY[$3]::BIGINT[],
    $4::BIGINT[],
    directed) AS a;
$function$
;

-- Function: pgr_trsp
-- Comment: pgr_trsp(one to many)
- PROPOSED
- Parameters
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Restrictions SQL with columns: cost, path
  - Departure vertex identifier
  - Destinations ARRAY[vertices identifier]
- Optional parameters
  - directed := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_trsp.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_trsp(text, text, bigint, bigint, directed boolean DEFAULT true, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$

  SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
  FROM _pgr_trspv4(
    _pgr_get_statement($1),
    _pgr_get_statement($2),
    ARRAY[$3]::BIGINT[],
    ARRAY[$4]::BIGINT[],
    directed) AS a;

$function$
;

-- Function: pgr_trsp
-- Comment: pgr_trsp(one to one)
- PROPOSED
- Parameters
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Restrictions SQL with columns: cost, path
  - Departure vertex identifier
  - Destination vertex identifier
- Optional parameters
  - directed
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_trsp.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_trsp_withpoints(text, text, text, bigint, anyarray, directed boolean DEFAULT true, driving_side character DEFAULT 'r'::bpchar, details boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
SELECT seq, path_seq, departure, end_vid, node, edge, cost, agg_cost
FROM _pgr_trsp_withPoints(
  _pgr_get_statement($1),
  _pgr_get_statement($2),
  _pgr_get_statement($3),
  ARRAY[$4]::BIGINT[], $5::BIGINT[], $6, $7, $8);
$function$
;

-- Function: pgr_trsp_withpoints
-- Comment: pgr_trsp_withPoints(One to Many)
- PROPOSED
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Restrictions SQL with columns: id, cost, path
  - Points SQL with columns: [pid], edge_id, fraction [,side]
  - Departure vertex/point identifier
  - Destinations ARRAY[vertices/Points identifier]
- Optional Parameters:
  - directed := 'true'
  - driving_side := 'r'
  - details := 'false'
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_trsp_withPoints.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_trsp_withpoints(text, text, text, bigint, bigint, directed boolean DEFAULT true, driving_side character DEFAULT 'r'::bpchar, details boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
SELECT seq, path_seq, departure, end_vid, node, edge, cost, agg_cost
FROM _pgr_trsp_withPoints(
  _pgr_get_statement($1),
  _pgr_get_statement($2),
  _pgr_get_statement($3),
  ARRAY[$4]::BIGINT[], ARRAY[$5]::BIGINT[], $6, $7, $8);
$function$
;

-- Function: pgr_trsp_withpoints
-- Comment: pgr_trsp_withPoints (One to One)
- PROPOSED
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Restrictions SQL with columns: id, cost, path
  - Points SQL with columns: [pid], edge_id, fraction [,side]
  - Departure vertex/point identifier
  - Destination vertex/point identifier
- Optional Parameters:
  - directed := 'true'
  - driving_side := 'r'
  - details := 'false'
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_trsp_withPoints.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_trsp_withpoints(text, text, text, anyarray, bigint, directed boolean DEFAULT true, driving_side character DEFAULT 'r'::bpchar, details boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
SELECT seq, path_seq, departure, end_vid, node, edge, cost, agg_cost
FROM _pgr_trsp_withPoints(
  _pgr_get_statement($1),
  _pgr_get_statement($2),
  _pgr_get_statement($3),
  $4::BIGINT[], ARRAY[$5]::BIGINT[], $6, $7, $8);
$function$
;

-- Function: pgr_trsp_withpoints
-- Comment: pgr_trsp_withPoints(Many to One)
- PROPOSED
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Restrictions SQL with columns: id, cost, path
  - Points SQL with columns: [pid], edge_id, fraction [,side]
  - Departures ARRAY[vertices/Points identifier]
  - Destination vertex/point identifier
- Optional Parameters:
  - directed := 'true'
  - driving_side := 'r'
  - details := 'false'
- Documentation:
- https://docs.pgrouting.org/latest/en/pgr_trsp_withPoints.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_trsp_withpoints(text, text, text, anyarray, anyarray, directed boolean DEFAULT true, driving_side character DEFAULT 'r'::bpchar, details boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
SELECT seq, path_seq, departure, end_vid, node, edge, cost, agg_cost
FROM _pgr_trsp_withPoints(
  _pgr_get_statement($1),
  _pgr_get_statement($2),
  _pgr_get_statement($3),
  $4::BIGINT[], $5::BIGINT[], $6, $7, $8);
$function$
;

-- Function: pgr_trsp_withpoints
-- Comment: pgr_trsp_withPoints(Many to Many)
- PROPOSED
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Restrictions SQL with columns: id, cost, path
  - Points SQL with columns: [pid], edge_id, fraction [,side]
  - Departures ARRAY[vertices/Points identifier]
  - Destinations ARRAY[vertices/Points identifier]
- Optional Parameters:
  - directed := 'true'
  - driving_side := 'r'
  - details := 'false'
- Documentation:
- https://docs.pgrouting.org/latest/en/pgr_trsp_withPoints.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_trsp_withpoints(text, text, text, text, directed boolean DEFAULT true, driving_side character DEFAULT 'r'::bpchar, details boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
SELECT seq, path_seq, departure, end_vid, node, edge, cost, agg_cost
FROM _pgr_trsp_withPoints(
  _pgr_get_statement($1),
  _pgr_get_statement($2),
  _pgr_get_statement($3),
  _pgr_get_statement($4),
  $5, $6, $7);
$function$
;

-- Function: pgr_trsp_withpoints
-- Comment: pgr_trsp_withPoints(Combinations)
- PROPOSED
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Restrictions SQL with columns: id, path, cost
  - Points SQL with columns: [pid], edge_id, fraction [,side]
  - Combinations SQL with columns: source, target
- Optional Parameters:
  - directed := 'true'
  - driving_side := 'r'
  - details := 'false'
- Documentation:
- https://docs.pgrouting.org/latest/en/pgr_trsp_withPoints.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_trspvia(text, text, anyarray, directed boolean DEFAULT true, strict boolean DEFAULT false, u_turn_on_edge boolean DEFAULT true, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision, OUT route_agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost, route_agg_cost
FROM _pgr_trspVia(
  _pgr_get_statement($1),
  _pgr_get_statement($2),
  $3 , $4, $5, $6);
$function$
;

-- Function: pgr_trspvia
-- Comment: pgr_trspVia
- PROPOSED
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Restrictions SQL with columns: cost, path
  - ARRAY[via vertices identifiers]
- Optional Parameters
  - directed := true
  - strict := false
  - U_turn_on_edge := true
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_trspVia.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_trspvia_withpoints(text, text, text, anyarray, directed boolean DEFAULT true, strict boolean DEFAULT false, u_turn_on_edge boolean DEFAULT true, driving_side character DEFAULT 'r'::bpchar, details boolean DEFAULT false, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision, OUT route_agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost, route_agg_cost
FROM _pgr_trspVia_withPoints(
  _pgr_get_statement($1),
  _pgr_get_statement($2),
  _pgr_get_statement($3),
  $4, $5, $6, $7, $8, $9);
$function$
;

-- Function: pgr_trspvia_withpoints
-- Comment: pgr_trspVia_withPoints
- PROPOSED
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Restrictions SQL with columns: cost, path
  - Points SQL with columns: [pid], edge_id, fraction [,side]
  - ARRAY[via vertices identifiers]
- Optional Parameters
  - directed := true
  - strict := false
  - U_turn_on_edge := true
  - driving_side := 'r'
  - details := 'false'
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_trspVia_withPoints.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_trspviaedges(text, integer[], double precision[], boolean, boolean, turn_restrict_sql text DEFAULT NULL::text, OUT seq integer, OUT id1 integer, OUT id2 integer, OUT id3 integer, OUT cost double precision)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STABLE
AS $function$

declare
    sql TEXT          := $1;
    eids INTEGER[]    := $2;
    pcts FLOAT[]      := $3;
    directed BOOLEAN  := $4;
    has_rcost BOOLEAN := $5;

    i integer;
    rr RECORD;
    lrr RECORD;
    first boolean := true;
    seq1 integer := 0;
    seq2 integer :=0;
    has_reverse BOOLEAN;
    point_is_vertex BOOLEAN := false;
    edges_sql TEXT;
    f float;

begin
  RAISE WARNING 'pgr_trspViaEdges(text,integer[],float[],boolean,boolean,text) deprecated function on v3.4.0';
    SELECT 0::INTEGER AS seq, NULL::INTEGER AS id1, NULL::INTEGER AS id2, NULL::INTEGER AS id3, NULL::FLOAT AS cost INTO lrr;
    has_reverse =_pgr_parameter_check('dijkstra', sql, false);
    edges_sql := sql;
    IF (has_reverse != has_rcost) THEN
        IF (NOT has_rcost) THEN
            -- user does not want to use reverse cost column
            edges_sql = 'SELECT id, source, target, cost FROM (' || sql || ') a';
        ELSE
            raise EXCEPTION 'has_rcost set to true but reverse_cost not found';
        END IF;
    END IF;

    FOREACH f IN ARRAY pcts LOOP
        IF f in (0,1) THEN
           point_is_vertex := true;
        END IF;
    END LOOP;

    IF (turn_restrict_sql IS NULL OR length(turn_restrict_sql) = 0) AND NOT point_is_vertex THEN
        -- no restrictions then its a _pgr_withPointsVia
        RETURN query SELECT a.seq::INTEGER, path_id::INTEGER AS id1, node::INTEGER AS id2, edge::INTEGER AS id3, a.cost
        FROM _pgr_withPointsVia(edges_sql, eids, pcts, directed) a;
        RETURN;
    END IF;

    if array_length(eids, 1) != array_length(pcts, 1) then
        raise exception 'The length of arrays eids and pcts must be the same!';
    end if;

    -- loop through each pair of vids and compute the path
    for i in 1 .. array_length(eids, 1)-1 loop
        seq2 := seq2 + 1;
        for rr in select a.seq, seq2 as id1, a.id1 as id2, a.id2 as id3, a.cost
                    from pgr_trsp(edges_sql,
                                  eids[i], pcts[i],
                                  eids[i+1], pcts[i+1],
                                  directed,
                                  has_rcost,
                                  turn_restrict_sql) as a loop
            -- combine intermediate via costs when cost is split across
            -- two parts of a segment because it stops it and
            -- restarts the next leg also on it
            -- we might not want to do this so we can know where the via points are in the path result
            -- but this needs more thought
            --
            -- there are multiple condition we have to deal with
            -- between the end of one leg and start of the next
            -- 1. same vertex_id. edge_id=-1; drop record with edge_id=-1
            -- means: path ends on vertex
            -- NOTICE:  rr: (19,1,44570022,-1,0)
            -- NOTICE:  rr: (0,2,44570022,1768045,2.89691196717448)
            -- 2. vertex_id=-1; sum cost components
            -- means: path end/starts with the segment
            -- NOTICE:  rr: (11,2,44569628,1775909,9.32885885148532)
            -- NOTICE:  rr: (0,3,-1,1775909,0.771386350984395)

            --raise notice 'rr: %', rr;
            if first then
                lrr := rr;
                first := false;
            else
                if lrr.id3 = -1 then
                    lrr := rr;
                elsif lrr.id3 = rr.id3 then
                    lrr.cost := lrr.cost + rr.cost;
                    if rr.id2 = -1 then
                        rr.id2 := lrr.id2;
                    end if;
                else
                    seq1 := seq1 + 1;
                    lrr.seq := seq1;

                    seq := lrr.seq;
                    id1 := lrr.id1;
                    id2 := lrr.id2;
                    id3 := lrr.id3;
                    cost := lrr.cost;
                    return next;
                    lrr := rr;
                end if;
            end if;
        end loop;
    end loop;

    seq1 := seq1 + 1;
    lrr.seq := seq1;

    seq := lrr.seq;
    id1 := lrr.id1;
    id2 := lrr.id2;
    id3 := lrr.id3;
    cost := lrr.cost;
    return next;
    return;
end;
$function$
;

-- Function: pgr_trspviaedges
-- Comment: pgr_trspViaEdges deprecated function on v3.4.0
- Documentation: https://docs.pgrouting.org/latest/en/pgr_trspVia_withPoints.html
-- 
CREATE OR REPLACE FUNCTION public.pgr_trspviavertices(text, anyarray, boolean, boolean, restrictions_sql text DEFAULT NULL::text, OUT seq integer, OUT id1 integer, OUT id2 integer, OUT id3 integer, OUT cost double precision)
 RETURNS SETOF record
 LANGUAGE plpgsql
AS $function$
DECLARE
    edges_sql TEXT     := $1;
    via_vids INTEGER[] := $2;
    directed BOOLEAN   := $3;
    has_rcost BOOLEAN  := $4;

has_reverse BOOLEAN;
new_sql TEXT;
BEGIN
  RAISE WARNING 'pgr_trspViaVertices(text,anyarray,boolean,boolean,text) deprecated function on v3.4.0';

    has_reverse =_pgr_parameter_check('dijkstra', edges_sql, false);

    new_sql := edges_sql;
    IF (has_reverse != has_rcost) THEN  -- user contradiction
        IF (has_reverse) THEN  -- it has reverse_cost but user don't want it.
            new_sql :=
               'WITH old_sql AS (' || edges_sql || ')' ||
                '   SELECT id, source, target, cost FROM old_sql';
        ELSE -- it does not have reverse_cost but user wants it
            RAISE EXCEPTION 'Error, reverse_cost is used, but query did''t return ''reverse_cost'' column'
            USING ERRCODE := 'XX000';
        END IF;
    END IF;

    IF (restrictions_sql IS NULL OR length(restrictions_sql) = 0) THEN
        RETURN query SELECT (row_number() over())::INTEGER, path_id:: INTEGER, node::INTEGER,
            (CASE WHEN edge = -2 THEN -1 ELSE edge END)::INTEGER, a.cost
            FROM pgr_dijkstraVia(new_sql, via_vids, directed, strict:=true) AS a WHERE edge != -1;
        RETURN;
    END IF;


    -- make the call without contradiction from part of the user
    RETURN query SELECT a.seq, a.id1, a.id2, a.id3, a.cost FROM _pgr_trspViaVertices(new_sql, via_vids::INTEGER[], directed, has_rcost, restrictions_sql) AS a;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Error computing path: Path Not Found';
    END IF;
END
$function$
;

-- Function: pgr_trspviavertices
-- Comment: pgr_trspViaVertices deprecated function on v3.4.0
- Documentation: https://docs.pgrouting.org/latest/en/pgr_trspVia.html
-- 
CREATE OR REPLACE FUNCTION public.pgr_tsp(text, start_id bigint DEFAULT 0, end_id bigint DEFAULT 0, max_processing_time double precision DEFAULT 'Infinity'::double precision, tries_per_temperature integer DEFAULT 500, max_changes_per_temperature integer DEFAULT 60, max_consecutive_non_changes integer DEFAULT 100, initial_temperature double precision DEFAULT 100, final_temperature double precision DEFAULT 0.1, cooling_factor double precision DEFAULT 0.9, randomize boolean DEFAULT true, OUT seq integer, OUT node bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, node, cost, agg_cost
    FROM _pgr_TSP(_pgr_get_statement($1), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
$function$
;

-- Function: pgr_tsp
-- Comment: pgr_TSP
- Parameters
   - matrix SQL with columns: start_vid, end_vid, agg_cost
- Optional parameters
    - start_id := 0
    - end_id := 0

    - max_processing_time := '+infinity'::FLOAT

    - tries_per_temperature := 500
    - max_changes_per_temperature :=  60
    - max_consecutive_non_changes :=  100

    - initial_temperature FLOAT := 100
    - final_temperature := 0.1
    - cooling_factor := 0.9

    - randomize := true
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_TSP.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_tspeuclidean(text, start_id bigint DEFAULT 0, end_id bigint DEFAULT 0, max_processing_time double precision DEFAULT 'Infinity'::double precision, tries_per_temperature integer DEFAULT 500, max_changes_per_temperature integer DEFAULT 60, max_consecutive_non_changes integer DEFAULT 100, initial_temperature double precision DEFAULT 100, final_temperature double precision DEFAULT 0.1, cooling_factor double precision DEFAULT 0.9, randomize boolean DEFAULT true, OUT seq integer, OUT node bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, node, cost, agg_cost
    FROM _pgr_TSPeuclidean(_pgr_get_statement($1), $2,$3, $4, $5,$6,$7, $8,$9,$10, $11);
$function$
;

-- Function: pgr_tspeuclidean
-- Comment: pgr_TSPeuclidean
- Parameters
   - coordinates SQL with columns: id, x, y
- Optional parameters
    - start_id := 0
    - end_id := 0

    - max_processing_time := '+infinity'::FLOAT

    - tries_per_temperature := 500
    - max_changes_per_temperature :=  60
    - max_consecutive_non_changes :=  100

    - initial_temperature FLOAT := 100
    - final_temperature := 0.1
    - cooling_factor := 0.9

    - randomize := true
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_TSPeuclidean.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_turnrestrictedpath(text, text, bigint, bigint, integer, directed boolean DEFAULT true, heap_paths boolean DEFAULT false, stop_on_first boolean DEFAULT true, strict boolean DEFAULT false, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_id, path_seq, node, edge, cost, agg_cost
    FROM _pgr_turnRestrictedPath(_pgr_get_statement($1), _pgr_get_statement($2), $3, $4, $5, $6, $7, $8, $9);
$function$
;

-- Function: pgr_turnrestrictedpath
-- Comment: pgr_turnRestrictedPath
- EXPERIMENTAL
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Restrictions SQL with columns: id, cost, path
    - From vertex identifier
    - To vertex identifier
    - K
- Optional Parameters
    - directed := true
    - heap paths := false
    - stop on first := true
    - strict := false
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_turnRestrictedPath.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_version()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
    SELECT '3.8.0'::varchar AS pgr_version;
$function$
;

-- Function: pgr_version
-- Comment: pgr_version
- Documentation
  - https://docs.pgrouting.org/latest/en/pgr_version.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_vrponedepot(text, text, text, integer, OUT oid integer, OUT opos integer, OUT vid integer, OUT tarrival integer, OUT tdepart integer)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT COST 1000
AS $function$
    SELECT order_id::INTEGER, stop_seq::INTEGER, vehicle_id::INTEGER, arrival_time::INTEGER, departure_time::INTEGER
    FROM _pgr_vrpOneDepot($1, $2,
       '
            SELECT src_id AS start_vid, dest_id AS end_vid, traveltime AS agg_cost FROM ('||$3||') AS a
       ',
       $4);
$function$
;

-- Function: pgr_vrponedepot
-- Comment: pgr_vrpOneDepot
- EXPERIMENTAL
- Parameters
  - orders SQL with columns: id, x, y, order_unit, open_time, close_time, service_time
  - vehicle SQL with columns: vehicle_id, capacity, case_no
  - cost SQL with columns: src_id, dest_id, cost, distance, traveltime
  - depot id
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_vrpOneDepot.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_withpoints(text, text, anyarray, anyarray, directed boolean DEFAULT true, driving_side character DEFAULT 'b'::bpchar, details boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT start_pid bigint, OUT end_pid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
SELECT a.seq, a.path_seq, a.start_pid, a.end_pid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_withPoints(_pgr_get_statement($1), $2, $3::bigint[], $4::bigint[], $5, $6, $7) AS a;
$function$
;

-- Function: pgr_withpoints
-- Comment: pgr_withPoints (Many to Many)
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction[,side]
    - From ARRAY[vertices/points identifiers]
    - To ARRAY[vertices/points identifiers]
- Optional Parameters
    - directed := 'true'
    - driving_side := 'b'
    - details := 'false'
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_withPoints.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_withpoints(text, text, text, directed boolean DEFAULT true, driving_side character DEFAULT 'b'::bpchar, details boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT start_pid bigint, OUT end_pid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.start_pid, a.end_pid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_withPoints(_pgr_get_statement($1), _pgr_get_statement($2), _pgr_get_statement($3),
        $4, $5, $6) AS a;
$function$
;

-- Function: pgr_withpoints
-- Comment: pgr_withPoints(Combinations)
- Parameters:
   - Edges SQL with columns: id, source, target, cost [,reverse_cost]
   - Points SQL with columns: [pid], edge_id, fraction [,side]
   - Combinations SQL with columns: source, target
- Optional Parameters
    - directed := 'true'
    - driving_side := 'b'
    - details := 'false'
- Documentation:
   - https://docs.pgrouting.org/latest/en/pgr_withPoints.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_withpoints(text, text, anyarray, bigint, directed boolean DEFAULT true, driving_side character DEFAULT 'b'::bpchar, details boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT start_pid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
SELECT a.seq, a.path_seq, a.start_pid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_withPoints(_pgr_get_statement($1), $2, $3::bigint[], ARRAY[$4]::bigint[], $5, $6, $7, FALSE, FALSE) AS a;
$function$
;

-- Function: pgr_withpoints
-- Comment: pgr_withPoints (Many to One)
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction[,side]
    - From  ARRAY[vertices/points identifiers]
    - To vertex identifier/point identifier
- Optional Parameters
    - directed := 'true'
    - driving_side := 'b'
    - details := 'false'
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_withPoints.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_withpoints(text, text, bigint, anyarray, directed boolean DEFAULT true, driving_side character DEFAULT 'b'::bpchar, details boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT end_pid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
SELECT a.seq, a.path_seq, a.end_pid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_withPoints(_pgr_get_statement($1), $2, ARRAY[$3]::bigint[], $4::bigint[], $5, $6, $7) AS a;
$function$
;

-- Function: pgr_withpoints
-- Comment: pgr_withPoints (One to Many)
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction[,side]
    - From vertex identifier/point identifier
    - To ARRAY[vertices/points identifier]
- Optional Parameters
    - directed := 'true'
    - driving_side := 'b'
    - details := 'false'
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_withPoints.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_withpoints(text, text, bigint, bigint, directed boolean DEFAULT true, driving_side character DEFAULT 'b'::bpchar, details boolean DEFAULT false, OUT seq integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.seq, a.path_seq, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_withPoints(_pgr_get_statement($1), $2, ARRAY[$3]::bigint[], ARRAY[$4]::bigint[], $5, $6, $7) AS a;
$function$
;

-- Function: pgr_withpoints
-- Comment: pgr_withPoints (One to One)
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction[,side]
    - From vertex identifier/point identifier
    - To vertex identifier/point identifier
- Optional Parameters
    - directed := 'true'
    - driving_side := 'b'
    - details := 'false'
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_withPoints.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointscost(text, text, bigint, bigint, directed boolean DEFAULT true, driving_side character DEFAULT 'b'::bpchar, OUT start_pid bigint, OUT end_pid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT $3, $4, a.agg_cost
    FROM _pgr_withPoints(_pgr_get_statement($1), $2, ARRAY[$3]::BIGINT[], ARRAY[$4]::BIGINT[], $5, $6, TRUE, TRUE) AS a;
$function$
;

-- Function: pgr_withpointscost
-- Comment: pgr_withPointsCost (One to One)
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction[,side]
    - From vertex/point identifier
    - To vertex/point identifier
- Optional Parameters
    - directed := 'true'
    - driving_side := 'b'
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_withPointsCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointscost(text, text, bigint, anyarray, directed boolean DEFAULT true, driving_side character DEFAULT 'b'::bpchar, OUT start_pid bigint, OUT end_pid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT $3, a.end_pid, a.agg_cost
    FROM _pgr_withPoints(_pgr_get_statement($1), $2, ARRAY[$3]::BIGINT[], $4::BIGINT[], $5, $6, TRUE, TRUE) AS a;
$function$
;

-- Function: pgr_withpointscost
-- Comment: pgr_withPointsCost (One to Many)
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction[,side]
    - From vertex/point identifier
    - To ARRAY[vertices/points identifiers]
- Optional Parameters
    - directed := 'true'
    - driving_side := 'b'
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_withPointsCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointscost(text, text, anyarray, bigint, directed boolean DEFAULT true, driving_side character DEFAULT 'b'::bpchar, OUT start_pid bigint, OUT end_pid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_pid, $4, a.agg_cost
    FROM _pgr_withPoints(_pgr_get_statement($1), $2, $3::BIGINT[], ARRAY[$4]::BIGINT[], $5, $6, TRUE, TRUE) AS a;
$function$
;

-- Function: pgr_withpointscost
-- Comment: pgr_withPointsCost (Many to One)
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction[,side]
    - From ARRAY[vertices/points identifiers]
    - To vertex/point identifier
- Optional Parameters
    - directed := 'true'
    - driving_side := 'b'
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_withPointsCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointscost(text, text, anyarray, anyarray, directed boolean DEFAULT true, driving_side character DEFAULT 'b'::bpchar, OUT start_pid bigint, OUT end_pid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_pid, a.end_pid, a.agg_cost
    FROM _pgr_withPoints(_pgr_get_statement($1), $2, $3::BIGINT[], $4::BIGINT[], $5,  $6, TRUE, TRUE) AS a;
$function$
;

-- Function: pgr_withpointscost
-- Comment: pgr_withPointsCost (Many to Many)
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction[,side]
    - From ARRAY[vertices/points identifiers]
    - To ARRAY[vertices/points identifiers]
- Optional Parameters
    - directed := 'true'
    - driving_side := 'b'
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_withPointsCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointscost(text, text, text, directed boolean DEFAULT true, driving_side character DEFAULT 'b'::bpchar, OUT start_pid bigint, OUT end_pid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_pid, a.end_pid, a.agg_cost
    FROM _pgr_withPoints(_pgr_get_statement($1), _pgr_get_statement($2), _pgr_get_statement($3), $4, $5, TRUE, TRUE) AS a;
$function$
;

-- Function: pgr_withpointscost
-- Comment: pgr_withPointsCost(Combinations)
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction [,side]
    - Combinations SQL with columns: source, target
- Optional Parameters
    - directed := 'true'
    - driving_side := 'b'
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_withPointsCost.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointscostmatrix(text, text, anyarray, directed boolean DEFAULT true, driving_side character DEFAULT 'b'::bpchar, OUT start_vid bigint, OUT end_vid bigint, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT a.start_pid, a.end_pid, a.agg_cost
    FROM _pgr_withPoints(_pgr_get_statement($1), _pgr_get_statement($2), $3, $3, $4,  $5, TRUE, TRUE) AS a;
$function$
;

-- Function: pgr_withpointscostmatrix
-- Comment: pgr_withPointsCostMatrix
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction[,side]
    - ARRAY [points identifiers],
- Optional Parameters
    - directed := true
    - driving_side := 'b'
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_withPointsCostMatrix.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointsdd(text, text, anyarray, double precision, character, directed boolean DEFAULT true, details boolean DEFAULT false, equicost boolean DEFAULT false, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_withPointsDDv4(_pgr_get_statement($1), _pgr_get_statement($2), $3, $4, $5, $6, $7, $8);
$function$
;

-- Function: pgr_withpointsdd
-- Comment: pgr_withPointsDD(Multiple Vertices)
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction[,side]
    - From ARRAY[vertices identifiers]
    - Distance
    - Driving_side
- Optional Parameters
    - directed := true
    - details := false
    - equicost := false
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_withPointsDD.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointsdd(text, text, anyarray, double precision, directed boolean DEFAULT true, driving_side character DEFAULT 'b'::bpchar, details boolean DEFAULT false, equicost boolean DEFAULT false, OUT seq integer, OUT start_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
BEGIN
  RAISE WARNING 'pgr_withpointsdd(text,text,anyarray,double precision,boolean,character,boolean,boolean) deprecated signature on v3.6.0';
  RETURN QUERY
    SELECT a.seq, a.start_vid, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_withPointsDD(_pgr_get_statement($1), _pgr_get_statement($2), $3, $4, $5, $6, $7, $8) AS a;
END;
$function$
;

-- Function: pgr_withpointsdd
-- Comment: pgRouting deprecated signature on v3.6.0
- Documentation: https://docs.pgrouting.org/latest/en/pgr_withPointsDD.html
-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointsdd(text, text, bigint, double precision, directed boolean DEFAULT true, driving_side character DEFAULT 'b'::bpchar, details boolean DEFAULT false, OUT seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
BEGIN
    RAISE WARNING 'pgr_withpointsdd(text,text,bigint,double precision,boolean,character,boolean) deprecated signature on 3.6.0';
    RETURN QUERY
    SELECT a.seq, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_withPointsDD(_pgr_get_statement($1), _pgr_get_statement($2), ARRAY[$3]::BIGINT[], $4, $5, $6, $7, false) AS a;
END;
$function$
;

-- Function: pgr_withpointsdd
-- Comment: pgRouting deprecated signature on v3.6.0
- Documentation: https://docs.pgrouting.org/latest/en/pgr_withPointsDD.html
-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointsdd(text, text, bigint, double precision, character, directed boolean DEFAULT true, details boolean DEFAULT false, OUT seq bigint, OUT depth bigint, OUT start_vid bigint, OUT pred bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, depth, start_vid, pred, node, edge, cost, agg_cost
    FROM _pgr_withPointsDDv4(_pgr_get_statement($1), _pgr_get_statement($2), ARRAY[$3]::BIGINT[], $4, $5, $6, $7, false);
$function$
;

-- Function: pgr_withpointsdd
-- Comment: pgr_withPointsDD(Single Vertex)
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction[,side]
    - From vertex identifier
    - Distance
    - Driving_side
- Optional Parameters
    - directed := true
    - details := false
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_withPointsDD.html

-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointsksp(text, text, anyarray, anyarray, integer, character, directed boolean DEFAULT true, heap_paths boolean DEFAULT false, details boolean DEFAULT false, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_withPointsKSP(_pgr_get_statement($1), _pgr_get_statement($2), $3::BIGINT[], $4::BIGINT[], $5, $6, $7, $8, $9, true);
$function$
;

-- Function: pgr_withpointsksp
-- Comment: pgr_withPointsKSP
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction[,side]
    - From ARRAY[vertices identifier]
    - To ARRAY[vertices identifiers]
    - K
    - driving side
- Optional Parameters
    - directed := true
    - heap paths := false
    - details := false
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_withPointsKSP.html
-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointsksp(text, text, anyarray, bigint, integer, character, directed boolean DEFAULT true, heap_paths boolean DEFAULT false, details boolean DEFAULT false, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_withPointsKSP(_pgr_get_statement($1), _pgr_get_statement($2), $3::BIGINT[], ARRAY[$4]::BIGINT[], $5, $6, $7, $8, $9, true);
$function$
;

-- Function: pgr_withpointsksp
-- Comment: pgr_withPointsKSP
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction[,side]
    - From ARRAY[vertices identifier]
    - To vertex identifier
    - K
    - driving side
- Optional Parameters
    - directed := true
    - heap paths := false
    - details := false
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_withPointsKSP.html
-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointsksp(text, text, text, integer, character, directed boolean DEFAULT true, heap_paths boolean DEFAULT false, details boolean DEFAULT false, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_withPointsKSP(_pgr_get_statement($1), _pgr_get_statement($2), _pgr_get_statement($3), $4, $5, $6, $7, $8);
$function$
;

-- Function: pgr_withpointsksp
-- Comment: pgr_withPointsKSP
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction[,side]
    - Combinations SQL with columns: source, target
    - K
    - driving side
- Optional Parameters
    - directed := true
    - heap paths := false
    - details := false
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_withPointsKSP.html
-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointsksp(text, text, bigint, anyarray, integer, character, directed boolean DEFAULT true, heap_paths boolean DEFAULT false, details boolean DEFAULT false, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_withPointsKSP(_pgr_get_statement($1), _pgr_get_statement($2), ARRAY[$3]::BIGINT[], $4::BIGINT[], $5, $6, $7, $8, $9, true);
$function$
;

-- Function: pgr_withpointsksp
-- Comment: pgr_withPointsKSP
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction[,side]
    - From vertex identifier
    - To ARRAY[vertices identifiers]
    - K
    - driving side
- Optional Parameters
    - directed := true
    - heap paths := false
    - details := false
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_withPointsKSP.html
-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointsksp(text, text, bigint, bigint, integer, character, directed boolean DEFAULT true, heap_paths boolean DEFAULT false, details boolean DEFAULT false, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
    SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
    FROM _pgr_withPointsKSP(_pgr_get_statement($1), _pgr_get_statement($2), ARRAY[$3]::BIGINT[], ARRAY[$4]::BIGINT[], $5, $6, $7, $8, $9, true);
$function$
;

-- Function: pgr_withpointsksp
-- Comment: pgr_withPointsKSP
- PROPOSED
- Parameters:
    - Edges SQL with columns: id, source, target, cost [,reverse_cost]
    - Points SQL with columns: [pid], edge_id, fraction[,side]
    - From vertex identifier
    - To vertex identifier
    - K
    - driving side
- Optional Parameters
    - directed := true
    - heap paths := false
    - details := false
- Documentation:
    - https://docs.pgrouting.org/latest/en/pgr_withPointsKSP.html
-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointsksp(text, text, bigint, bigint, integer, directed boolean DEFAULT true, heap_paths boolean DEFAULT false, driving_side character DEFAULT 'b'::bpchar, details boolean DEFAULT false, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STRICT
AS $function$
BEGIN
    RAISE WARNING 'pgr_withPointsKSP(text,text,bigint,bigint,integer,boolean,boolean,char,boolean) deprecated signature on v3.6.0';
    RETURN QUERY
    SELECT a.seq, a.path_id, a.path_seq, a.node, a.edge, a.cost, a.agg_cost
    FROM _pgr_withPointsKSP(_pgr_get_statement($1), _pgr_get_statement($2), $3, $4, $5, $6, $7, $8, $9) AS a;
END
$function$
;

-- Function: pgr_withpointsksp
-- Comment: pgr_withPointsKSP deprecated signature on v3.6.0
- Documentation: https://docs.pgrouting.org/latest/en/pgr_withPointsKSP.html
-- 
CREATE OR REPLACE FUNCTION public.pgr_withpointsvia(text, text, anyarray, directed boolean DEFAULT true, strict boolean DEFAULT false, u_turn_on_edge boolean DEFAULT true, driving_side character DEFAULT 'b'::bpchar, details boolean DEFAULT false, OUT seq integer, OUT path_id integer, OUT path_seq integer, OUT start_vid bigint, OUT end_vid bigint, OUT node bigint, OUT edge bigint, OUT cost double precision, OUT agg_cost double precision, OUT route_agg_cost double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STRICT
AS $function$
  SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost, route_agg_cost
  FROM _pgr_withPointsVia( _pgr_get_statement($1), _pgr_get_statement($2), $3, $4, $5, $6, $7, $8);
$function$
;

-- Function: pgr_withpointsvia
-- Comment: pgr_withPointsVia
- PROPOSED
- Parameters:
  - Edges SQL with columns: id, source, target, cost [,reverse_cost]
  - Points SQL with columns: [pid], edge_id, fraction [,side]
  - ARRAY[via vertices identifiers]
- Optional Parameters
  - directed := true
  - strict := false
  - U_turn_on_edge := true
  - driving_side := 'b'
  - details := 'false'
- Documentation:
  - https://docs.pgrouting.org/latest/en/pgr_withPointsVia.html

-- 
CREATE OR REPLACE FUNCTION public.point(geometry)
 RETURNS point
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geometry_to_point$function$
;

CREATE OR REPLACE FUNCTION public.polygon(geometry)
 RETURNS polygon
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geometry_to_polygon$function$
;

CREATE OR REPLACE FUNCTION public.populate_geometry_columns(use_typmod boolean DEFAULT true)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
	inserted	integer;
	oldcount	integer;
	probed	  integer;
	stale	   integer;
	gcs		 RECORD;
	gc		  RECORD;
	gsrid	   integer;
	gndims	  integer;
	gtype	   text;
	query	   text;
	gc_is_valid boolean;

BEGIN
	SELECT count(*) INTO oldcount FROM public.geometry_columns;
	inserted := 0;

	-- Count the number of geometry columns in all tables and views
	SELECT count(DISTINCT c.oid) INTO probed
	FROM pg_class c,
		 pg_attribute a,
		 pg_type t,
		 pg_namespace n
	WHERE c.relkind IN('r','v','f', 'p')
		AND t.typname = 'geometry'
		AND a.attisdropped = false
		AND a.atttypid = t.oid
		AND a.attrelid = c.oid
		AND c.relnamespace = n.oid
		AND n.nspname NOT ILIKE 'pg_temp%' AND c.relname != 'raster_columns' ;

	-- Iterate through all non-dropped geometry columns
	RAISE DEBUG 'Processing Tables.....';

	FOR gcs IN
	SELECT DISTINCT ON (c.oid) c.oid, n.nspname, c.relname
		FROM pg_class c,
			 pg_attribute a,
			 pg_type t,
			 pg_namespace n
		WHERE c.relkind IN( 'r', 'f', 'p')
		AND t.typname = 'geometry'
		AND a.attisdropped = false
		AND a.atttypid = t.oid
		AND a.attrelid = c.oid
		AND c.relnamespace = n.oid
		AND n.nspname NOT ILIKE 'pg_temp%' AND c.relname != 'raster_columns'
	LOOP

		inserted := inserted + public.populate_geometry_columns(gcs.oid, use_typmod);
	END LOOP;

	IF oldcount > inserted THEN
		stale = oldcount-inserted;
	ELSE
		stale = 0;
	END IF;

	RETURN 'probed:' ||probed|| ' inserted:'||inserted;
END

$function$
;

CREATE OR REPLACE FUNCTION public.populate_geometry_columns(tbl_oid oid, use_typmod boolean DEFAULT true)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
	gcs		 RECORD;
	gc		  RECORD;
	gc_old	  RECORD;
	gsrid	   integer;
	gndims	  integer;
	gtype	   text;
	query	   text;
	gc_is_valid boolean;
	inserted	integer;
	constraint_successful boolean := false;

BEGIN
	inserted := 0;

	-- Iterate through all geometry columns in this table
	FOR gcs IN
	SELECT n.nspname, c.relname, a.attname, c.relkind
		FROM pg_class c,
			 pg_attribute a,
			 pg_type t,
			 pg_namespace n
		WHERE c.relkind IN('r', 'f', 'p')
		AND t.typname = 'geometry'
		AND a.attisdropped = false
		AND a.atttypid = t.oid
		AND a.attrelid = c.oid
		AND c.relnamespace = n.oid
		AND n.nspname NOT ILIKE 'pg_temp%'
		AND c.oid = tbl_oid
	LOOP

		RAISE DEBUG 'Processing column %.%.%', gcs.nspname, gcs.relname, gcs.attname;

		gc_is_valid := true;
		-- Find the srid, coord_dimension, and type of current geometry
		-- in geometry_columns -- which is now a view

		SELECT type, srid, coord_dimension, gcs.relkind INTO gc_old
			FROM geometry_columns
			WHERE f_table_schema = gcs.nspname AND f_table_name = gcs.relname AND f_geometry_column = gcs.attname;

		IF upper(gc_old.type) = 'GEOMETRY' THEN
		-- This is an unconstrained geometry we need to do something
		-- We need to figure out what to set the type by inspecting the data
			EXECUTE 'SELECT public.ST_srid(' || quote_ident(gcs.attname) || ') As srid, public.GeometryType(' || quote_ident(gcs.attname) || ') As type, public.ST_NDims(' || quote_ident(gcs.attname) || ') As dims ' ||
					 ' FROM ONLY ' || quote_ident(gcs.nspname) || '.' || quote_ident(gcs.relname) ||
					 ' WHERE ' || quote_ident(gcs.attname) || ' IS NOT NULL LIMIT 1;'
				INTO gc;
			IF gc IS NULL THEN -- there is no data so we can not determine geometry type
				RAISE WARNING 'No data in table %.%, so no information to determine geometry type and srid', gcs.nspname, gcs.relname;
				RETURN 0;
			END IF;
			gsrid := gc.srid; gtype := gc.type; gndims := gc.dims;

			IF use_typmod THEN
				BEGIN
					EXECUTE 'ALTER TABLE ' || quote_ident(gcs.nspname) || '.' || quote_ident(gcs.relname) || ' ALTER COLUMN ' || quote_ident(gcs.attname) ||
						' TYPE geometry(' || postgis_type_name(gtype, gndims, true) || ', ' || gsrid::text  || ') ';
					inserted := inserted + 1;
				EXCEPTION
						WHEN invalid_parameter_value OR feature_not_supported THEN
						RAISE WARNING 'Could not convert ''%'' in ''%.%'' to use typmod with srid %, type %: %', quote_ident(gcs.attname), quote_ident(gcs.nspname), quote_ident(gcs.relname), gsrid, postgis_type_name(gtype, gndims, true), SQLERRM;
							gc_is_valid := false;
				END;

			ELSE
				-- Try to apply srid check to column
				constraint_successful = false;
				IF (gsrid > 0 AND postgis_constraint_srid(gcs.nspname, gcs.relname,gcs.attname) IS NULL ) THEN
					BEGIN
						EXECUTE 'ALTER TABLE ONLY ' || quote_ident(gcs.nspname) || '.' || quote_ident(gcs.relname) ||
								 ' ADD CONSTRAINT ' || quote_ident('enforce_srid_' || gcs.attname) ||
								 ' CHECK (ST_srid(' || quote_ident(gcs.attname) || ') = ' || gsrid || ')';
						constraint_successful := true;
					EXCEPTION
						WHEN check_violation THEN
							RAISE WARNING 'Not inserting ''%'' in ''%.%'' into geometry_columns: could not apply constraint CHECK (st_srid(%) = %)', quote_ident(gcs.attname), quote_ident(gcs.nspname), quote_ident(gcs.relname), quote_ident(gcs.attname), gsrid;
							gc_is_valid := false;
					END;
				END IF;

				-- Try to apply ndims check to column
				IF (gndims IS NOT NULL AND postgis_constraint_dims(gcs.nspname, gcs.relname,gcs.attname) IS NULL ) THEN
					BEGIN
						EXECUTE 'ALTER TABLE ONLY ' || quote_ident(gcs.nspname) || '.' || quote_ident(gcs.relname) || '
								 ADD CONSTRAINT ' || quote_ident('enforce_dims_' || gcs.attname) || '
								 CHECK (st_ndims(' || quote_ident(gcs.attname) || ') = '||gndims||')';
						constraint_successful := true;
					EXCEPTION
						WHEN check_violation THEN
							RAISE WARNING 'Not inserting ''%'' in ''%.%'' into geometry_columns: could not apply constraint CHECK (st_ndims(%) = %)', quote_ident(gcs.attname), quote_ident(gcs.nspname), quote_ident(gcs.relname), quote_ident(gcs.attname), gndims;
							gc_is_valid := false;
					END;
				END IF;

				-- Try to apply geometrytype check to column
				IF (gtype IS NOT NULL AND postgis_constraint_type(gcs.nspname, gcs.relname,gcs.attname) IS NULL ) THEN
					BEGIN
						EXECUTE 'ALTER TABLE ONLY ' || quote_ident(gcs.nspname) || '.' || quote_ident(gcs.relname) || '
						ADD CONSTRAINT ' || quote_ident('enforce_geotype_' || gcs.attname) || '
						CHECK (geometrytype(' || quote_ident(gcs.attname) || ') = ' || quote_literal(gtype) || ')';
						constraint_successful := true;
					EXCEPTION
						WHEN check_violation THEN
							-- No geometry check can be applied. This column contains a number of geometry types.
							RAISE WARNING 'Could not add geometry type check (%) to table column: %.%.%', gtype, quote_ident(gcs.nspname),quote_ident(gcs.relname),quote_ident(gcs.attname);
					END;
				END IF;
				 --only count if we were successful in applying at least one constraint
				IF constraint_successful THEN
					inserted := inserted + 1;
				END IF;
			END IF;
		END IF;

	END LOOP;

	RETURN inserted;
END

$function$
;

CREATE OR REPLACE FUNCTION public.postgis_addbbox(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_addBBOX$function$
;

CREATE OR REPLACE FUNCTION public.postgis_cache_bbox()
 RETURNS trigger
 LANGUAGE c
AS '$libdir/postgis-3', $function$cache_bbox$function$
;

CREATE OR REPLACE FUNCTION public.postgis_constraint_dims(geomschema text, geomtable text, geomcolumn text)
 RETURNS integer
 LANGUAGE sql
 STABLE PARALLEL SAFE STRICT COST 250
AS $function$
SELECT  replace(split_part(s.consrc, ' = ', 2), ')', '')::integer
		 FROM pg_class c, pg_namespace n, pg_attribute a
		 , (SELECT connamespace, conrelid, conkey, pg_get_constraintdef(oid) As consrc
			FROM pg_constraint) AS s
		 WHERE n.nspname = $1
		 AND c.relname = $2
		 AND a.attname = $3
		 AND a.attrelid = c.oid
		 AND s.connamespace = n.oid
		 AND s.conrelid = c.oid
		 AND a.attnum = ANY (s.conkey)
		 AND s.consrc LIKE '%ndims(% = %';
$function$
;

CREATE OR REPLACE FUNCTION public.postgis_constraint_srid(geomschema text, geomtable text, geomcolumn text)
 RETURNS integer
 LANGUAGE sql
 STABLE PARALLEL SAFE STRICT COST 250
AS $function$
SELECT replace(replace(split_part(s.consrc, ' = ', 2), ')', ''), '(', '')::integer
		 FROM pg_class c, pg_namespace n, pg_attribute a
		 , (SELECT connamespace, conrelid, conkey, pg_get_constraintdef(oid) As consrc
			FROM pg_constraint) AS s
		 WHERE n.nspname = $1
		 AND c.relname = $2
		 AND a.attname = $3
		 AND a.attrelid = c.oid
		 AND s.connamespace = n.oid
		 AND s.conrelid = c.oid
		 AND a.attnum = ANY (s.conkey)
		 AND s.consrc LIKE '%srid(% = %';
$function$
;

CREATE OR REPLACE FUNCTION public.postgis_constraint_type(geomschema text, geomtable text, geomcolumn text)
 RETURNS character varying
 LANGUAGE sql
 STABLE PARALLEL SAFE STRICT COST 250
AS $function$
SELECT  replace(split_part(s.consrc, '''', 2), ')', '')::varchar
		 FROM pg_class c, pg_namespace n, pg_attribute a
		 , (SELECT connamespace, conrelid, conkey, pg_get_constraintdef(oid) As consrc
			FROM pg_constraint) AS s
		 WHERE n.nspname = $1
		 AND c.relname = $2
		 AND a.attname = $3
		 AND a.attrelid = c.oid
		 AND s.connamespace = n.oid
		 AND s.conrelid = c.oid
		 AND a.attnum = ANY (s.conkey)
		 AND s.consrc LIKE '%geometrytype(% = %';
$function$
;

CREATE OR REPLACE FUNCTION public.postgis_dropbbox(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_dropBBOX$function$
;

CREATE OR REPLACE FUNCTION public.postgis_extensions_upgrade(target_version text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
	rec record;
	sql text;
	var_schema text;
BEGIN

	FOR rec IN
		SELECT name, default_version, installed_version
		FROM pg_catalog.pg_available_extensions
		WHERE name IN (
			'postgis',
			'postgis_raster',
			'postgis_sfcgal',
			'postgis_topology',
			'postgis_tiger_geocoder'
		)
		ORDER BY length(name) -- this is to make sure 'postgis' is first !
	LOOP --{

		IF target_version IS NULL THEN
			target_version := rec.default_version;
		END IF;

		IF rec.installed_version IS NULL THEN --{
			-- If the support installed by available extension
			-- is found unpackaged, we package it
			IF --{
				 -- PostGIS is always available (this function is part of it)
				 rec.name = 'postgis'

				 -- PostGIS raster is available if type 'raster' exists
				 OR ( rec.name = 'postgis_raster' AND EXISTS (
							SELECT 1 FROM pg_catalog.pg_type
							WHERE typname = 'raster' ) )

				 -- PostGIS SFCGAL is available if
				 -- 'postgis_sfcgal_version' function exists
				 OR ( rec.name = 'postgis_sfcgal' AND EXISTS (
							SELECT 1 FROM pg_catalog.pg_proc
							WHERE proname = 'postgis_sfcgal_version' ) )

				 -- PostGIS Topology is available if
				 -- 'topology.topology' table exists
				 -- NOTE: watch out for https://trac.osgeo.org/postgis/ticket/2503
				 OR ( rec.name = 'postgis_topology' AND EXISTS (
							SELECT 1 FROM pg_catalog.pg_class c
							JOIN pg_catalog.pg_namespace n ON (c.relnamespace = n.oid )
							WHERE n.nspname = 'topology' AND c.relname = 'topology') )

				 OR ( rec.name = 'postgis_tiger_geocoder' AND EXISTS (
							SELECT 1 FROM pg_catalog.pg_class c
							JOIN pg_catalog.pg_namespace n ON (c.relnamespace = n.oid )
							WHERE n.nspname = 'tiger' AND c.relname = 'geocode_settings') )
			THEN --}{ -- the code is unpackaged
				-- Force install in same schema as postgis
				SELECT INTO var_schema n.nspname
				  FROM pg_namespace n, pg_proc p
				  WHERE p.proname = 'postgis_full_version'
					AND n.oid = p.pronamespace
				  LIMIT 1;
				IF rec.name NOT IN('postgis_topology', 'postgis_tiger_geocoder')
				THEN
					sql := format(
							  'CREATE EXTENSION %1$I SCHEMA %2$I VERSION unpackaged;'
							  'ALTER EXTENSION %1$I UPDATE TO %3$I',
							  rec.name, var_schema, target_version);
				ELSE
					sql := format(
							 'CREATE EXTENSION %1$I VERSION unpackaged;'
							 'ALTER EXTENSION %1$I UPDATE TO %2$I',
							 rec.name, target_version);
				END IF;
				RAISE NOTICE 'Packaging and updating %', rec.name;
				RAISE DEBUG '%', sql;
				EXECUTE sql;
			ELSE
				RAISE DEBUG 'Skipping % (not in use)', rec.name;
			END IF; --}
		ELSE -- The code is already packaged, upgrade it --}{
			sql = format(
				'ALTER EXTENSION %1$I UPDATE TO "ANY";'
				'ALTER EXTENSION %1$I UPDATE TO %2$I',
				rec.name, target_version
				);
			RAISE NOTICE 'Updating extension % %', rec.name, rec.installed_version;
			RAISE DEBUG '%', sql;
			EXECUTE sql;
		END IF; --}

	END LOOP; --}

	RETURN format(
		'Upgrade to version %s completed, run SELECT postgis_full_version(); for details',
		target_version
	);


END
$function$
;

CREATE OR REPLACE FUNCTION public.postgis_full_version()
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
	libver text;
	librev text;
	projver text;
	projver_compiled text;
	geosver text;
	geosver_compiled text;
	sfcgalver text;
	gdalver text := NULL;
	libxmlver text;
	liblwgeomver text;
	dbproc text;
	relproc text;
	fullver text;
	rast_lib_ver text := NULL;
	rast_scr_ver text := NULL;
	topo_scr_ver text := NULL;
	json_lib_ver text;
	protobuf_lib_ver text;
	wagyu_lib_ver text;
	sfcgal_lib_ver text;
	sfcgal_scr_ver text;
	pgsql_scr_ver text;
	pgsql_ver text;
	core_is_extension bool;
BEGIN
	SELECT public.postgis_lib_version() INTO libver;
	SELECT public.postgis_proj_version() INTO projver;
	SELECT public.postgis_geos_version() INTO geosver;
	SELECT public.postgis_geos_compiled_version() INTO geosver_compiled;
	SELECT public.postgis_proj_compiled_version() INTO projver_compiled;
	SELECT public.postgis_libjson_version() INTO json_lib_ver;
	SELECT public.postgis_libprotobuf_version() INTO protobuf_lib_ver;
	SELECT public.postgis_wagyu_version() INTO wagyu_lib_ver;
	SELECT public._postgis_scripts_pgsql_version() INTO pgsql_scr_ver;
	SELECT public._postgis_pgsql_version() INTO pgsql_ver;
	BEGIN
		SELECT public.postgis_gdal_version() INTO gdalver;
	EXCEPTION
		WHEN undefined_function THEN
			RAISE DEBUG 'Function postgis_gdal_version() not found.  Is raster support enabled and rtpostgis.sql installed?';
	END;
	BEGIN
		SELECT public.postgis_sfcgal_full_version() INTO sfcgalver;
		BEGIN
			SELECT public.postgis_sfcgal_scripts_installed() INTO sfcgal_scr_ver;
		EXCEPTION
			WHEN undefined_function THEN
				sfcgal_scr_ver := 'missing';
		END;
	EXCEPTION
		WHEN undefined_function THEN
			RAISE DEBUG 'Function postgis_sfcgal_scripts_installed() not found. Is sfcgal support enabled and sfcgal.sql installed?';
	END;
	SELECT public.postgis_liblwgeom_version() INTO liblwgeomver;
	SELECT public.postgis_libxml_version() INTO libxmlver;
	SELECT public.postgis_scripts_installed() INTO dbproc;
	SELECT public.postgis_scripts_released() INTO relproc;
	SELECT public.postgis_lib_revision() INTO librev;
	BEGIN
		SELECT topology.postgis_topology_scripts_installed() INTO topo_scr_ver;
	EXCEPTION
		WHEN undefined_function OR invalid_schema_name THEN
			RAISE DEBUG 'Function postgis_topology_scripts_installed() not found. Is topology support enabled and topology.sql installed?';
		WHEN insufficient_privilege THEN
			RAISE NOTICE 'Topology support cannot be inspected. Is current user granted USAGE on schema "topology" ?';
		WHEN OTHERS THEN
			RAISE NOTICE 'Function postgis_topology_scripts_installed() could not be called: % (%)', SQLERRM, SQLSTATE;
	END;

	BEGIN
		SELECT postgis_raster_scripts_installed() INTO rast_scr_ver;
	EXCEPTION
		WHEN undefined_function THEN
			RAISE DEBUG 'Function postgis_raster_scripts_installed() not found. Is raster support enabled and rtpostgis.sql installed?';
		WHEN OTHERS THEN
			RAISE NOTICE 'Function postgis_raster_scripts_installed() could not be called: % (%)', SQLERRM, SQLSTATE;
	END;

	BEGIN
		SELECT public.postgis_raster_lib_version() INTO rast_lib_ver;
	EXCEPTION
		WHEN undefined_function THEN
			RAISE DEBUG 'Function postgis_raster_lib_version() not found. Is raster support enabled and rtpostgis.sql installed?';
		WHEN OTHERS THEN
			RAISE NOTICE 'Function postgis_raster_lib_version() could not be called: % (%)', SQLERRM, SQLSTATE;
	END;

	fullver = 'POSTGIS="' || libver;

	IF  librev IS NOT NULL THEN
		fullver = fullver || ' ' || librev;
	END IF;

	fullver = fullver || '"';

	IF EXISTS (
		SELECT * FROM pg_catalog.pg_extension
		WHERE extname = 'postgis')
	THEN
			fullver = fullver || ' [EXTENSION]';
			core_is_extension := true;
	ELSE
			core_is_extension := false;
	END IF;

	IF liblwgeomver != relproc THEN
		fullver = fullver || ' (liblwgeom version mismatch: "' || liblwgeomver || '")';
	END IF;

	fullver = fullver || ' PGSQL="' || pgsql_scr_ver || '"';
	IF pgsql_scr_ver != pgsql_ver THEN
		fullver = fullver || ' (procs need upgrade for use with PostgreSQL "' || pgsql_ver || '")';
	END IF;

	IF  geosver IS NOT NULL THEN
		fullver = fullver || ' GEOS="' || geosver || '"';
		IF (string_to_array(geosver, '.'))[1:2] != (string_to_array(geosver_compiled, '.'))[1:2]
		THEN
			fullver = format('%s (compiled against GEOS %s)', fullver, geosver_compiled);
		END IF;
	END IF;

	IF  sfcgalver IS NOT NULL THEN
		fullver = fullver || ' SFCGAL="' || sfcgalver || '"';
	END IF;

	IF  projver IS NOT NULL THEN
		fullver = fullver || ' PROJ="' || projver || '"';
		IF (string_to_array(projver, '.'))[1:3] != (string_to_array(projver_compiled, '.'))[1:3]
		THEN
			fullver = format('%s (compiled against PROJ %s)', fullver, projver_compiled);
		END IF;
	END IF;

	IF  gdalver IS NOT NULL THEN
		fullver = fullver || ' GDAL="' || gdalver || '"';
	END IF;

	IF  libxmlver IS NOT NULL THEN
		fullver = fullver || ' LIBXML="' || libxmlver || '"';
	END IF;

	IF json_lib_ver IS NOT NULL THEN
		fullver = fullver || ' LIBJSON="' || json_lib_ver || '"';
	END IF;

	IF protobuf_lib_ver IS NOT NULL THEN
		fullver = fullver || ' LIBPROTOBUF="' || protobuf_lib_ver || '"';
	END IF;

	IF wagyu_lib_ver IS NOT NULL THEN
		fullver = fullver || ' WAGYU="' || wagyu_lib_ver || '"';
	END IF;

	IF dbproc != relproc THEN
		fullver = fullver || ' (core procs from "' || dbproc || '" need upgrade)';
	END IF;

	IF topo_scr_ver IS NOT NULL THEN
		fullver = fullver || ' TOPOLOGY';
		IF topo_scr_ver != relproc THEN
			fullver = fullver || ' (topology procs from "' || topo_scr_ver || '" need upgrade)';
		END IF;
		IF core_is_extension AND NOT EXISTS (
			SELECT * FROM pg_catalog.pg_extension
			WHERE extname = 'postgis_topology')
		THEN
				fullver = fullver || ' [UNPACKAGED!]';
		END IF;
	END IF;

	IF rast_lib_ver IS NOT NULL THEN
		fullver = fullver || ' RASTER';
		IF rast_lib_ver != relproc THEN
			fullver = fullver || ' (raster lib from "' || rast_lib_ver || '" need upgrade)';
		END IF;
		IF core_is_extension AND NOT EXISTS (
			SELECT * FROM pg_catalog.pg_extension
			WHERE extname = 'postgis_raster')
		THEN
				fullver = fullver || ' [UNPACKAGED!]';
		END IF;
	END IF;

	IF rast_scr_ver IS NOT NULL AND rast_scr_ver != relproc THEN
		fullver = fullver || ' (raster procs from "' || rast_scr_ver || '" need upgrade)';
	END IF;

	IF sfcgal_scr_ver IS NOT NULL AND sfcgal_scr_ver != relproc THEN
		fullver = fullver || ' (sfcgal procs from "' || sfcgal_scr_ver || '" need upgrade)';
	END IF;

	-- Check for the presence of deprecated functions
	IF EXISTS ( SELECT oid FROM pg_catalog.pg_proc WHERE proname LIKE '%_deprecated_by_postgis_%' )
	THEN
		fullver = fullver || ' (deprecated functions exist, upgrade is not complete)';
	END IF;

	RETURN fullver;
END
$function$
;

CREATE OR REPLACE FUNCTION public.postgis_gdal_version()
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_gdal_version$function$
;

CREATE OR REPLACE FUNCTION public.postgis_geos_compiled_version()
 RETURNS text
 LANGUAGE c
 IMMUTABLE
AS '$libdir/postgis-3', $function$postgis_geos_compiled_version$function$
;

CREATE OR REPLACE FUNCTION public.postgis_geos_noop(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$GEOSnoop$function$
;

CREATE OR REPLACE FUNCTION public.postgis_geos_version()
 RETURNS text
 LANGUAGE c
 IMMUTABLE
AS '$libdir/postgis-3', $function$postgis_geos_version$function$
;

CREATE OR REPLACE FUNCTION public.postgis_getbbox(geometry)
 RETURNS box2d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_to_BOX2DF$function$
;

CREATE OR REPLACE FUNCTION public.postgis_hasbbox(geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_hasBBOX$function$
;

CREATE OR REPLACE FUNCTION public.postgis_index_supportfn(internal)
 RETURNS internal
 LANGUAGE c
AS '$libdir/postgis-3', $function$postgis_index_supportfn$function$
;

CREATE OR REPLACE FUNCTION public.postgis_lib_build_date()
 RETURNS text
 LANGUAGE c
 IMMUTABLE
AS '$libdir/postgis-3', $function$postgis_lib_build_date$function$
;

CREATE OR REPLACE FUNCTION public.postgis_lib_revision()
 RETURNS text
 LANGUAGE c
 IMMUTABLE
AS '$libdir/postgis-3', $function$postgis_lib_revision$function$
;

CREATE OR REPLACE FUNCTION public.postgis_lib_version()
 RETURNS text
 LANGUAGE c
 IMMUTABLE
AS '$libdir/postgis-3', $function$postgis_lib_version$function$
;

CREATE OR REPLACE FUNCTION public.postgis_libjson_version()
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$postgis_libjson_version$function$
;

CREATE OR REPLACE FUNCTION public.postgis_liblwgeom_version()
 RETURNS text
 LANGUAGE c
 IMMUTABLE
AS '$libdir/postgis-3', $function$postgis_liblwgeom_version$function$
;

CREATE OR REPLACE FUNCTION public.postgis_libprotobuf_version()
 RETURNS text
 LANGUAGE c
 IMMUTABLE STRICT
AS '$libdir/postgis-3', $function$postgis_libprotobuf_version$function$
;

CREATE OR REPLACE FUNCTION public.postgis_libxml_version()
 RETURNS text
 LANGUAGE c
 IMMUTABLE
AS '$libdir/postgis-3', $function$postgis_libxml_version$function$
;

CREATE OR REPLACE FUNCTION public.postgis_noop(raster)
 RETURNS geometry
 LANGUAGE c
 STABLE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_noop$function$
;

CREATE OR REPLACE FUNCTION public.postgis_noop(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_noop$function$
;

CREATE OR REPLACE FUNCTION public.postgis_proj_compiled_version()
 RETURNS text
 LANGUAGE c
 IMMUTABLE
AS '$libdir/postgis-3', $function$postgis_proj_compiled_version$function$
;

CREATE OR REPLACE FUNCTION public.postgis_proj_version()
 RETURNS text
 LANGUAGE c
 IMMUTABLE
AS '$libdir/postgis-3', $function$postgis_proj_version$function$
;

CREATE OR REPLACE FUNCTION public.postgis_raster_lib_build_date()
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_lib_build_date$function$
;

CREATE OR REPLACE FUNCTION public.postgis_raster_lib_version()
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_lib_version$function$
;

CREATE OR REPLACE FUNCTION public.postgis_raster_scripts_installed()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT trim('3.5.3'::text || $rev$ 0 $rev$) AS version $function$
;

CREATE OR REPLACE FUNCTION public.postgis_scripts_build_date()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$SELECT ''::text AS version$function$
;

CREATE OR REPLACE FUNCTION public.postgis_scripts_installed()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$ SELECT trim('3.5.3'::text || $rev$ 0 $rev$) AS version $function$
;

CREATE OR REPLACE FUNCTION public.postgis_scripts_released()
 RETURNS text
 LANGUAGE c
 IMMUTABLE
AS '$libdir/postgis-3', $function$postgis_scripts_released$function$
;

CREATE OR REPLACE FUNCTION public.postgis_srs(auth_name text, auth_srid text)
 RETURNS TABLE(auth_name text, auth_srid text, srname text, srtext text, proj4text text, point_sw geometry, point_ne geometry)
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$postgis_srs_entry$function$
;

CREATE OR REPLACE FUNCTION public.postgis_srs_all()
 RETURNS TABLE(auth_name text, auth_srid text, srname text, srtext text, proj4text text, point_sw geometry, point_ne geometry)
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$postgis_srs_entry_all$function$
;

CREATE OR REPLACE FUNCTION public.postgis_srs_codes(auth_name text)
 RETURNS SETOF text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$postgis_srs_codes$function$
;

CREATE OR REPLACE FUNCTION public.postgis_srs_search(bounds geometry, authname text DEFAULT 'EPSG'::text)
 RETURNS TABLE(auth_name text, auth_srid text, srname text, srtext text, proj4text text, point_sw geometry, point_ne geometry)
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$postgis_srs_search$function$
;

CREATE OR REPLACE FUNCTION public.postgis_svn_version()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
	SELECT public._postgis_deprecate(
		'postgis_svn_version', 'postgis_lib_revision', '3.1.0');
	SELECT public.postgis_lib_revision();
$function$
;

CREATE OR REPLACE FUNCTION public.postgis_transform_geometry(geom geometry, text, text, integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$transform_geom$function$
;

CREATE OR REPLACE FUNCTION public.postgis_transform_pipeline_geometry(geom geometry, pipeline text, forward boolean, to_srid integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$transform_pipeline_geom$function$
;

CREATE OR REPLACE FUNCTION public.postgis_type_name(geomname character varying, coord_dimension integer, use_new_name boolean DEFAULT true)
 RETURNS character varying
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS $function$
	SELECT CASE WHEN $3 THEN new_name ELSE old_name END As geomname
	FROM
	( VALUES
			('GEOMETRY', 'Geometry', 2),
			('GEOMETRY', 'GeometryZ', 3),
			('GEOMETRYM', 'GeometryM', 3),
			('GEOMETRY', 'GeometryZM', 4),

			('GEOMETRYCOLLECTION', 'GeometryCollection', 2),
			('GEOMETRYCOLLECTION', 'GeometryCollectionZ', 3),
			('GEOMETRYCOLLECTIONM', 'GeometryCollectionM', 3),
			('GEOMETRYCOLLECTION', 'GeometryCollectionZM', 4),

			('POINT', 'Point', 2),
			('POINT', 'PointZ', 3),
			('POINTM','PointM', 3),
			('POINT', 'PointZM', 4),

			('MULTIPOINT','MultiPoint', 2),
			('MULTIPOINT','MultiPointZ', 3),
			('MULTIPOINTM','MultiPointM', 3),
			('MULTIPOINT','MultiPointZM', 4),

			('POLYGON', 'Polygon', 2),
			('POLYGON', 'PolygonZ', 3),
			('POLYGONM', 'PolygonM', 3),
			('POLYGON', 'PolygonZM', 4),

			('MULTIPOLYGON', 'MultiPolygon', 2),
			('MULTIPOLYGON', 'MultiPolygonZ', 3),
			('MULTIPOLYGONM', 'MultiPolygonM', 3),
			('MULTIPOLYGON', 'MultiPolygonZM', 4),

			('MULTILINESTRING', 'MultiLineString', 2),
			('MULTILINESTRING', 'MultiLineStringZ', 3),
			('MULTILINESTRINGM', 'MultiLineStringM', 3),
			('MULTILINESTRING', 'MultiLineStringZM', 4),

			('LINESTRING', 'LineString', 2),
			('LINESTRING', 'LineStringZ', 3),
			('LINESTRINGM', 'LineStringM', 3),
			('LINESTRING', 'LineStringZM', 4),

			('CIRCULARSTRING', 'CircularString', 2),
			('CIRCULARSTRING', 'CircularStringZ', 3),
			('CIRCULARSTRINGM', 'CircularStringM' ,3),
			('CIRCULARSTRING', 'CircularStringZM', 4),

			('COMPOUNDCURVE', 'CompoundCurve', 2),
			('COMPOUNDCURVE', 'CompoundCurveZ', 3),
			('COMPOUNDCURVEM', 'CompoundCurveM', 3),
			('COMPOUNDCURVE', 'CompoundCurveZM', 4),

			('CURVEPOLYGON', 'CurvePolygon', 2),
			('CURVEPOLYGON', 'CurvePolygonZ', 3),
			('CURVEPOLYGONM', 'CurvePolygonM', 3),
			('CURVEPOLYGON', 'CurvePolygonZM', 4),

			('MULTICURVE', 'MultiCurve', 2),
			('MULTICURVE', 'MultiCurveZ', 3),
			('MULTICURVEM', 'MultiCurveM', 3),
			('MULTICURVE', 'MultiCurveZM', 4),

			('MULTISURFACE', 'MultiSurface', 2),
			('MULTISURFACE', 'MultiSurfaceZ', 3),
			('MULTISURFACEM', 'MultiSurfaceM', 3),
			('MULTISURFACE', 'MultiSurfaceZM', 4),

			('POLYHEDRALSURFACE', 'PolyhedralSurface', 2),
			('POLYHEDRALSURFACE', 'PolyhedralSurfaceZ', 3),
			('POLYHEDRALSURFACEM', 'PolyhedralSurfaceM', 3),
			('POLYHEDRALSURFACE', 'PolyhedralSurfaceZM', 4),

			('TRIANGLE', 'Triangle', 2),
			('TRIANGLE', 'TriangleZ', 3),
			('TRIANGLEM', 'TriangleM', 3),
			('TRIANGLE', 'TriangleZM', 4),

			('TIN', 'Tin', 2),
			('TIN', 'TinZ', 3),
			('TINM', 'TinM', 3),
			('TIN', 'TinZM', 4) )
			 As g(old_name, new_name, coord_dimension)
	WHERE (upper(old_name) = upper($1) OR upper(new_name) = upper($1))
		AND coord_dimension = $2;
$function$
;

CREATE OR REPLACE FUNCTION public.postgis_typmod_dims(integer)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$postgis_typmod_dims$function$
;

CREATE OR REPLACE FUNCTION public.postgis_typmod_srid(integer)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$postgis_typmod_srid$function$
;

CREATE OR REPLACE FUNCTION public.postgis_typmod_type(integer)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$postgis_typmod_type$function$
;

CREATE OR REPLACE FUNCTION public.postgis_version()
 RETURNS text
 LANGUAGE c
 IMMUTABLE
AS '$libdir/postgis-3', $function$postgis_version$function$
;

CREATE OR REPLACE FUNCTION public.postgis_wagyu_version()
 RETURNS text
 LANGUAGE c
 IMMUTABLE
AS '$libdir/postgis-3', $function$postgis_wagyu_version$function$
;

CREATE OR REPLACE FUNCTION public.raster_above(raster, raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1::public.geometry |>> $2::public.geometry$function$
;

CREATE OR REPLACE FUNCTION public.raster_below(raster, raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1::public.geometry <<| $2::public.geometry$function$
;

CREATE OR REPLACE FUNCTION public.raster_contain(raster, raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1::public.geometry ~ $2::public.geometry$function$
;

CREATE OR REPLACE FUNCTION public.raster_contained(raster, raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1::public.geometry OPERATOR(public.@) $2::public.geometry$function$
;

CREATE OR REPLACE FUNCTION public.raster_contained_by_geometry(raster, geometry)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1::public.geometry OPERATOR(public.@) $2$function$
;

CREATE OR REPLACE FUNCTION public.raster_eq(raster, raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.raster_hash($1) = public.raster_hash($2) $function$
;

CREATE OR REPLACE FUNCTION public.raster_geometry_contain(raster, geometry)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1::public.geometry ~ $2$function$
;

CREATE OR REPLACE FUNCTION public.raster_geometry_overlap(raster, geometry)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1::public.geometry OPERATOR(public.&&) $2$function$
;

CREATE OR REPLACE FUNCTION public.raster_hash(raster)
 RETURNS integer
 LANGUAGE internal
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$hashvarlena$function$
;

CREATE OR REPLACE FUNCTION public.raster_in(cstring)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_in$function$
;

CREATE OR REPLACE FUNCTION public.raster_left(raster, raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1::public.geometry << $2::public.geometry$function$
;

CREATE OR REPLACE FUNCTION public.raster_out(raster)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_out$function$
;

CREATE OR REPLACE FUNCTION public.raster_overabove(raster, raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1::public.geometry |&> $2::public.geometry$function$
;

CREATE OR REPLACE FUNCTION public.raster_overbelow(raster, raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1::public.geometry &<| $2::public.geometry$function$
;

CREATE OR REPLACE FUNCTION public.raster_overlap(raster, raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1::public.geometry OPERATOR(public.&&) $2::public.geometry$function$
;

CREATE OR REPLACE FUNCTION public.raster_overleft(raster, raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1::public.geometry &< $2::public.geometry$function$
;

CREATE OR REPLACE FUNCTION public.raster_overright(raster, raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1::public.geometry &> $2::public.geometry$function$
;

CREATE OR REPLACE FUNCTION public.raster_right(raster, raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1::public.geometry >> $2::public.geometry$function$
;

CREATE OR REPLACE FUNCTION public.raster_same(raster, raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select $1::public.geometry ~= $2::public.geometry$function$
;

CREATE OR REPLACE FUNCTION public.recalculate_elevation_data(geometry geometry)
 RETURNS TABLE(elevation_gain real, elevation_loss real)
 LANGUAGE plpgsql
AS $function$ DECLARE total_gain real := 0; total_loss real := 0; prev_elevation real; curr_elevation real; point_geom geometry; BEGIN FOR i IN 1..ST_NPoints($1) LOOP point_geom := ST_PointN($1, i); curr_elevation := ST_Z(point_geom); IF i > 1 THEN IF curr_elevation > prev_elevation THEN total_gain := total_gain + (curr_elevation - prev_elevation); ELSIF curr_elevation < prev_elevation THEN total_loss := total_loss + (prev_elevation - curr_elevation); END IF; END IF; prev_elevation := curr_elevation; END LOOP; RETURN QUERY SELECT total_gain, total_loss; END; $function$
;

CREATE OR REPLACE FUNCTION public.show_routing_summary()
 RETURNS TABLE(function_name text, version text, description text)
 LANGUAGE plpgsql
AS $function$ BEGIN RETURN QUERY VALUES ('generate_routing_nodes_native', 'v1', 'Original version - creates nodes at trail endpoints'), ('generate_routing_nodes_native_v2', 'v2', 'Latest version - creates nodes at trail endpoints with improved clustering'), ('generate_routing_edges_native', 'v1', 'Original version - creates edges between nodes'), ('generate_routing_edges_native_v2', 'v2', 'Latest version - creates edges between nodes with improved tolerance handling'), ('cleanup_routing_graph', 'v1', 'Cleans up orphaned nodes and edges'), ('show_routing_summary', 'v1', 'Shows available routing functions and versions'); END; $function$
;

CREATE OR REPLACE FUNCTION public.soundex(text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/fuzzystrmatch', $function$soundex$function$
;

CREATE OR REPLACE FUNCTION public.spheroid_in(cstring)
 RETURNS spheroid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$ellipsoid_in$function$
;

CREATE OR REPLACE FUNCTION public.spheroid_out(spheroid)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$ellipsoid_out$function$
;

CREATE OR REPLACE FUNCTION public.st_3dclosestpoint(geom1 geometry, geom2 geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_closestpoint3d$function$
;

CREATE OR REPLACE FUNCTION public.st_3ddfullywithin(geom1 geometry, geom2 geometry, double precision)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$LWGEOM_dfullywithin3d$function$
;

CREATE OR REPLACE FUNCTION public.st_3ddistance(geom1 geometry, geom2 geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_3DDistance$function$
;

CREATE OR REPLACE FUNCTION public.st_3ddwithin(geom1 geometry, geom2 geometry, double precision)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$LWGEOM_dwithin3d$function$
;

CREATE OR REPLACE FUNCTION public.st_3dintersects(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$ST_3DIntersects$function$
;

CREATE OR REPLACE FUNCTION public.st_3dlength(geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_length_linestring$function$
;

CREATE OR REPLACE FUNCTION public.st_3dlineinterpolatepoint(geometry, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_3DLineInterpolatePoint$function$
;

CREATE OR REPLACE FUNCTION public.st_3dlongestline(geom1 geometry, geom2 geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_longestline3d$function$
;

CREATE OR REPLACE FUNCTION public.st_3dmakebox(geom1 geometry, geom2 geometry)
 RETURNS box3d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$BOX3D_construct$function$
;

CREATE OR REPLACE FUNCTION public.st_3dmaxdistance(geom1 geometry, geom2 geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_maxdistance3d$function$
;

CREATE OR REPLACE FUNCTION public.st_3dperimeter(geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_perimeter_poly$function$
;

CREATE OR REPLACE FUNCTION public.st_3dshortestline(geom1 geometry, geom2 geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_shortestline3d$function$
;

CREATE OR REPLACE FUNCTION public.st_addband(torast raster, fromrasts raster[], fromband integer DEFAULT 1, torastindex integer DEFAULT NULL::integer)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_addBandRasterArray$function$
;

CREATE OR REPLACE FUNCTION public.st_addband(rast raster, addbandargset addbandarg[])
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_addBand$function$
;

CREATE OR REPLACE FUNCTION public.st_addband(torast raster, fromrast raster, fromband integer DEFAULT 1, torastindex integer DEFAULT NULL::integer)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_copyBand$function$
;

CREATE OR REPLACE FUNCTION public.st_addband(rast raster, index integer, pixeltype text, initialvalue double precision DEFAULT '0'::numeric, nodataval double precision DEFAULT NULL::double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT  public.ST_addband($1, ARRAY[ROW($2, $3, $4, $5)]::public.addbandarg[]) $function$
;

CREATE OR REPLACE FUNCTION public.st_addband(rast raster, index integer, outdbfile text, outdbindex integer[], nodataval double precision DEFAULT NULL::double precision)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_addBandOutDB$function$
;

CREATE OR REPLACE FUNCTION public.st_addband(rast raster, outdbfile text, outdbindex integer[], index integer DEFAULT NULL::integer, nodataval double precision DEFAULT NULL::double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_AddBand($1, $4, $2, $3, $5) $function$
;

CREATE OR REPLACE FUNCTION public.st_addband(rast raster, pixeltype text, initialvalue double precision DEFAULT '0'::numeric, nodataval double precision DEFAULT NULL::double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT  public.ST_addband($1, ARRAY[ROW(NULL, $2, $3, $4)]::public.addbandarg[]) $function$
;

CREATE OR REPLACE FUNCTION public.st_addmeasure(geometry, double precision, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_AddMeasure$function$
;

CREATE OR REPLACE FUNCTION public.st_addpoint(geom1 geometry, geom2 geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_addpoint$function$
;

CREATE OR REPLACE FUNCTION public.st_addpoint(geom1 geometry, geom2 geometry, integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_addpoint$function$
;

CREATE OR REPLACE FUNCTION public.st_affine(geometry, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_affine$function$
;

CREATE OR REPLACE FUNCTION public.st_affine(geometry, double precision, double precision, double precision, double precision, double precision, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_Affine($1,  $2, $3, 0,  $4, $5, 0,  0, 0, 1,  $6, $7, 0)$function$
;

CREATE OR REPLACE FUNCTION public.st_angle(line1 geometry, line2 geometry)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_Angle(public.St_StartPoint($1), public.ST_EndPoint($1), public.ST_StartPoint($2), public.ST_EndPoint($2))$function$
;

CREATE OR REPLACE FUNCTION public.st_angle(pt1 geometry, pt2 geometry, pt3 geometry, pt4 geometry DEFAULT '0101000000000000000000F87F000000000000F87F'::geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_angle$function$
;

CREATE OR REPLACE FUNCTION public.st_approxcount(rast raster, nband integer, sample_percent double precision)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_count($1, $2, TRUE, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxcount(rast raster, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, sample_percent double precision DEFAULT 0.1)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_count($1, $2, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxcount(rast raster, sample_percent double precision)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_count($1, 1, TRUE, $2) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxcount(rast raster, exclude_nodata_value boolean, sample_percent double precision DEFAULT 0.1)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_count($1, 1, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxhistogram(rast raster, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, sample_percent double precision DEFAULT 0.1, bins integer DEFAULT 0, width double precision[] DEFAULT NULL::double precision[], "right" boolean DEFAULT false, OUT min double precision, OUT max double precision, OUT count bigint, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT min, max, count, percent FROM public._ST_histogram($1, $2, $3, $4, $5, $6, $7) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxhistogram(rast raster, nband integer, sample_percent double precision, bins integer, "right" boolean, OUT min double precision, OUT max double precision, OUT count bigint, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT min, max, count, percent FROM public._ST_histogram($1, $2, TRUE, $3, $4, NULL, $5) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxhistogram(rast raster, nband integer, sample_percent double precision, bins integer, width double precision[] DEFAULT NULL::double precision[], "right" boolean DEFAULT false, OUT min double precision, OUT max double precision, OUT count bigint, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT min, max, count, percent FROM public._ST_histogram($1, $2, TRUE, $3, $4, $5, $6) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxhistogram(rast raster, sample_percent double precision, OUT min double precision, OUT max double precision, OUT count bigint, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT min, max, count, percent FROM public._ST_histogram($1, 1, TRUE, $2, 0, NULL, FALSE) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxhistogram(rast raster, nband integer, sample_percent double precision, OUT min double precision, OUT max double precision, OUT count bigint, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT min, max, count, percent FROM public._ST_histogram($1, $2, TRUE, $3, 0, NULL, FALSE) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxhistogram(rast raster, nband integer, exclude_nodata_value boolean, sample_percent double precision, bins integer, "right" boolean, OUT min double precision, OUT max double precision, OUT count bigint, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT min, max, count, percent FROM public._ST_histogram($1, $2, $3, $4, $5, NULL, $6) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxquantile(rast raster, nband integer, sample_percent double precision, quantiles double precision[] DEFAULT NULL::double precision[], OUT quantile double precision, OUT value double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_quantile($1, $2, TRUE, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxquantile(rast raster, quantiles double precision[], OUT quantile double precision, OUT value double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_quantile($1, 1, TRUE, 0.1, $2) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxquantile(rast raster, nband integer, exclude_nodata_value boolean, sample_percent double precision, quantile double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT ( public._ST_quantile($1, $2, $3, $4, ARRAY[$5]::double precision[])).value $function$
;

CREATE OR REPLACE FUNCTION public.st_approxquantile(rast raster, nband integer, sample_percent double precision, quantile double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT ( public._ST_quantile($1, $2, TRUE, $3, ARRAY[$4]::double precision[])).value $function$
;

CREATE OR REPLACE FUNCTION public.st_approxquantile(rast raster, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, sample_percent double precision DEFAULT 0.1, quantiles double precision[] DEFAULT NULL::double precision[], OUT quantile double precision, OUT value double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_quantile($1, $2, $3, $4, $5) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxquantile(rast raster, exclude_nodata_value boolean, quantile double precision DEFAULT NULL::double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT ( public._ST_quantile($1, 1, $2, 0.1, ARRAY[$3]::double precision[])).value $function$
;

CREATE OR REPLACE FUNCTION public.st_approxquantile(rast raster, sample_percent double precision, quantile double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT ( public._ST_quantile($1, 1, TRUE, $2, ARRAY[$3]::double precision[])).value $function$
;

CREATE OR REPLACE FUNCTION public.st_approxquantile(rast raster, quantile double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT ( public._ST_quantile($1, 1, TRUE, 0.1, ARRAY[$2]::double precision[])).value $function$
;

CREATE OR REPLACE FUNCTION public.st_approxquantile(rast raster, sample_percent double precision, quantiles double precision[] DEFAULT NULL::double precision[], OUT quantile double precision, OUT value double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_quantile($1, 1, TRUE, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxsummarystats(rast raster, exclude_nodata_value boolean, sample_percent double precision DEFAULT 0.1)
 RETURNS summarystats
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_summarystats($1, 1, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxsummarystats(rast raster, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, sample_percent double precision DEFAULT 0.1)
 RETURNS summarystats
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_summarystats($1, $2, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxsummarystats(rast raster, sample_percent double precision)
 RETURNS summarystats
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_summarystats($1, 1, TRUE, $2) $function$
;

CREATE OR REPLACE FUNCTION public.st_approxsummarystats(rast raster, nband integer, sample_percent double precision)
 RETURNS summarystats
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_summarystats($1, $2, TRUE, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_area(text)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.ST_Area($1::public.geometry);  $function$
;

CREATE OR REPLACE FUNCTION public.st_area(geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_Area$function$
;

CREATE OR REPLACE FUNCTION public.st_area(geog geography, use_spheroid boolean DEFAULT true)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$geography_area$function$
;

CREATE OR REPLACE FUNCTION public.st_area2d(geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_Area$function$
;

CREATE OR REPLACE FUNCTION public.st_asbinary(geography)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_asBinary$function$
;

CREATE OR REPLACE FUNCTION public.st_asbinary(geometry, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_asBinary$function$
;

CREATE OR REPLACE FUNCTION public.st_asbinary(geography, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$LWGEOM_asBinary$function$
;

CREATE OR REPLACE FUNCTION public.st_asbinary(raster, outasin boolean DEFAULT false)
 RETURNS bytea
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.ST_AsWKB($1, $2) $function$
;

CREATE OR REPLACE FUNCTION public.st_asbinary(geometry)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_asBinary$function$
;

CREATE OR REPLACE FUNCTION public.st_asencodedpolyline(geom geometry, nprecision integer DEFAULT 5)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_asEncodedPolyline$function$
;

CREATE OR REPLACE FUNCTION public.st_asewkb(geometry)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$WKBFromLWGEOM$function$
;

CREATE OR REPLACE FUNCTION public.st_asewkb(geometry, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$WKBFromLWGEOM$function$
;

CREATE OR REPLACE FUNCTION public.st_asewkt(geometry, integer)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_asEWKT$function$
;

CREATE OR REPLACE FUNCTION public.st_asewkt(geography)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_asEWKT$function$
;

CREATE OR REPLACE FUNCTION public.st_asewkt(geography, integer)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_asEWKT$function$
;

CREATE OR REPLACE FUNCTION public.st_asewkt(text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$ SELECT public.ST_AsEWKT($1::public.geometry);  $function$
;

CREATE OR REPLACE FUNCTION public.st_asewkt(geometry)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_asEWKT$function$
;

CREATE OR REPLACE FUNCTION public.st_asgdalraster(rast raster, format text, options text[] DEFAULT NULL::text[], srid integer DEFAULT NULL::integer)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_asGDALRaster$function$
;

CREATE OR REPLACE FUNCTION public.st_asgeojson(geom geometry, maxdecimaldigits integer DEFAULT 9, options integer DEFAULT 8)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_asGeoJson$function$
;

CREATE OR REPLACE FUNCTION public.st_asgeojson(geog geography, maxdecimaldigits integer DEFAULT 9, options integer DEFAULT 0)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geography_as_geojson$function$
;

CREATE OR REPLACE FUNCTION public.st_asgeojson(text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$ SELECT public.ST_AsGeoJson($1::public.geometry, 9, 0);  $function$
;

CREATE OR REPLACE FUNCTION public.st_asgeojson(r record, geom_column text DEFAULT ''::text, maxdecimaldigits integer DEFAULT 9, pretty_bool boolean DEFAULT false, id_column text DEFAULT ''::text)
 RETURNS text
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_AsGeoJsonRow$function$
;

CREATE OR REPLACE FUNCTION public.st_asgml(geog geography, maxdecimaldigits integer DEFAULT 15, options integer DEFAULT 0, nprefix text DEFAULT 'gml'::text, id text DEFAULT ''::text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geography_as_gml$function$
;

CREATE OR REPLACE FUNCTION public.st_asgml(text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$ SELECT public._ST_AsGML(2,$1::public.geometry,15,0, NULL, NULL);  $function$
;

CREATE OR REPLACE FUNCTION public.st_asgml(version integer, geom geometry, maxdecimaldigits integer DEFAULT 15, options integer DEFAULT 0, nprefix text DEFAULT NULL::text, id text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$LWGEOM_asGML$function$
;

CREATE OR REPLACE FUNCTION public.st_asgml(version integer, geog geography, maxdecimaldigits integer DEFAULT 15, options integer DEFAULT 0, nprefix text DEFAULT 'gml'::text, id text DEFAULT ''::text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geography_as_gml$function$
;

CREATE OR REPLACE FUNCTION public.st_asgml(geom geometry, maxdecimaldigits integer DEFAULT 15, options integer DEFAULT 0)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$LWGEOM_asGML$function$
;

CREATE OR REPLACE FUNCTION public.st_ashexewkb(geometry)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_asHEXEWKB$function$
;

CREATE OR REPLACE FUNCTION public.st_ashexewkb(geometry, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_asHEXEWKB$function$
;

CREATE OR REPLACE FUNCTION public.st_ashexwkb(raster, outasin boolean DEFAULT false)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_asHexWKB$function$
;

CREATE OR REPLACE FUNCTION public.st_asjpeg(rast raster, nbands integer[], quality integer)
 RETURNS bytea
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	DECLARE
		quality2 int;
		options text[];
	BEGIN
		IF quality IS NOT NULL THEN
			IF quality > 100 THEN
				quality2 := 100;
			ELSEIF quality < 10 THEN
				quality2 := 10;
			ELSE
				quality2 := quality;
			END IF;

			options := array_append(options, 'QUALITY=' || quality2);
		END IF;

		RETURN public.st_asjpeg(public.st_band($1, $2), options);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_asjpeg(rast raster, nband integer, quality integer)
 RETURNS bytea
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.st_asjpeg($1, ARRAY[$2], $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_asjpeg(rast raster, options text[] DEFAULT NULL::text[])
 RETURNS bytea
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		rast2 public.raster;
		num_bands int;
		i int;
	BEGIN
		IF rast IS NULL THEN
			RETURN NULL;
		END IF;

		num_bands := public.st_numbands($1);

		-- JPEG allows 1 or 3 bands
		IF num_bands <> 1 AND num_bands <> 3 THEN
			RAISE NOTICE 'The JPEG format only permits one or three bands.  The first band will be used.';
			rast2 := public.st_band(rast, ARRAY[1]);
			num_bands := public.st_numbands(rast);
		ELSE
			rast2 := rast;
		END IF;

		-- JPEG only supports 8BUI pixeltype
		FOR i IN 1..num_bands LOOP
			IF public.ST_BandPixelType(rast, i) != '8BUI' THEN
				RAISE EXCEPTION 'The pixel type of band % in the raster is not 8BUI.  The JPEG format can only be used with the 8BUI pixel type.', i;
			END IF;
		END LOOP;

		RETURN public.st_asgdalraster(rast2, 'JPEG', $2, NULL);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_asjpeg(rast raster, nbands integer[], options text[] DEFAULT NULL::text[])
 RETURNS bytea
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.st_asjpeg(public.st_band($1, $2), $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_asjpeg(rast raster, nband integer, options text[] DEFAULT NULL::text[])
 RETURNS bytea
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.st_asjpeg(st_band($1, $2), $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_askml(geog geography, maxdecimaldigits integer DEFAULT 15, nprefix text DEFAULT ''::text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geography_as_kml$function$
;

CREATE OR REPLACE FUNCTION public.st_askml(text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$ SELECT public.ST_AsKML($1::public.geometry, 15);  $function$
;

CREATE OR REPLACE FUNCTION public.st_askml(geom geometry, maxdecimaldigits integer DEFAULT 15, nprefix text DEFAULT ''::text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_asKML$function$
;

CREATE OR REPLACE FUNCTION public.st_aslatlontext(geom geometry, tmpl text DEFAULT ''::text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_to_latlon$function$
;

CREATE OR REPLACE FUNCTION public.st_asmarc21(geom geometry, format text DEFAULT 'hdddmmss'::text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_AsMARC21$function$
;

CREATE OR REPLACE FUNCTION public.st_asmvtgeom(geom geometry, bounds box2d, extent integer DEFAULT 4096, buffer integer DEFAULT 256, clip_geom boolean DEFAULT true)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$ST_AsMVTGeom$function$
;

CREATE OR REPLACE FUNCTION public.st_aspect(rast raster, nband integer DEFAULT 1, pixeltype text DEFAULT '32BF'::text, units text DEFAULT 'DEGREES'::text, interpolate_nodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_aspect($1, $2, NULL::public.raster, $3, $4, $5) $function$
;

CREATE OR REPLACE FUNCTION public.st_aspect(rast raster, nband integer, customextent raster, pixeltype text DEFAULT '32BF'::text, units text DEFAULT 'DEGREES'::text, interpolate_nodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		_rast public.raster;
		_nband integer;
		_pixtype text;
		_width integer;
		_height integer;
		_customextent public.raster;
		_extenttype text;
	BEGIN
		_customextent := customextent;
		IF _customextent IS NULL THEN
			_extenttype := 'FIRST';
		ELSE
			_extenttype := 'CUSTOM';
		END IF;

		IF interpolate_nodata IS TRUE THEN
			_rast := public.ST_MapAlgebra(
				ARRAY[ROW(rast, nband)]::rastbandarg[],
				'public.st_invdistweight4ma(double precision[][][], integer[][], text[])'::regprocedure,
				pixeltype,
				'FIRST', NULL,
				1, 1
			);
			_nband := 1;
			_pixtype := NULL;
		ELSE
			_rast := rast;
			_nband := nband;
			_pixtype := pixeltype;
		END IF;

		-- get properties
		SELECT width, height INTO _width, _height FROM public.ST_Metadata(_rast);

		RETURN public.ST_MapAlgebra(
			ARRAY[ROW(_rast, _nband)]::public.rastbandarg[],
			' public._ST_aspect4ma(double precision[][][], integer[][], text[])'::regprocedure,
			_pixtype,
			_extenttype, _customextent,
			1, 1,
			_width::text, _height::text,
			units::text
		);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_aspng(rast raster, nband integer, options text[] DEFAULT NULL::text[])
 RETURNS bytea
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.st_aspng(public.st_band($1, $2), $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_aspng(rast raster, options text[] DEFAULT NULL::text[])
 RETURNS bytea
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		rast2 public.raster;
		num_bands int;
		i int;
		pt text;
	BEGIN
		IF rast IS NULL THEN
			RETURN NULL;
		END IF;

		num_bands := st_numbands($1);

		-- PNG allows 1, 3 or 4 bands
		IF num_bands <> 1 AND num_bands <> 3 AND num_bands <> 4 THEN
			RAISE NOTICE 'The PNG format only permits one, three or four bands.  The first band will be used.';
			rast2 := public.st_band($1, ARRAY[1]);
			num_bands := public.st_numbands(rast2);
		ELSE
			rast2 := rast;
		END IF;

		-- PNG only supports 8BUI and 16BUI pixeltype
		FOR i IN 1..num_bands LOOP
			pt = public.ST_BandPixelType(rast, i);
			IF pt != '8BUI' AND pt != '16BUI' THEN
				RAISE EXCEPTION 'The pixel type of band % in the raster is not 8BUI or 16BUI.  The PNG format can only be used with 8BUI and 16BUI pixel types.', i;
			END IF;
		END LOOP;

		RETURN public.st_asgdalraster(rast2, 'PNG', $2, NULL);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_aspng(rast raster, nband integer, compression integer)
 RETURNS bytea
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.st_aspng($1, ARRAY[$2], $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_aspng(rast raster, nbands integer[], options text[] DEFAULT NULL::text[])
 RETURNS bytea
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.st_aspng(st_band($1, $2), $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_aspng(rast raster, nbands integer[], compression integer)
 RETURNS bytea
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	DECLARE
		compression2 int;
		options text[];
	BEGIN
		IF compression IS NOT NULL THEN
			IF compression > 9 THEN
				compression2 := 9;
			ELSEIF compression < 1 THEN
				compression2 := 1;
			ELSE
				compression2 := compression;
			END IF;

			options := array_append(options, 'ZLEVEL=' || compression2);
		END IF;

		RETURN public.st_aspng(public.st_band($1, $2), options);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_asraster(geom geometry, ref raster, pixeltype text, value double precision DEFAULT 1, nodataval double precision DEFAULT 0, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT  public.ST_AsRaster($1, $2, ARRAY[$3]::text[], ARRAY[$4]::double precision[], ARRAY[$5]::double precision[], $6) $function$
;

CREATE OR REPLACE FUNCTION public.st_asraster(geom geometry, scalex double precision, scaley double precision, gridx double precision DEFAULT NULL::double precision, gridy double precision DEFAULT NULL::double precision, pixeltype text[] DEFAULT ARRAY['8BUI'::text], value double precision[] DEFAULT ARRAY[(1)::double precision], nodataval double precision[] DEFAULT ARRAY[(0)::double precision], skewx double precision DEFAULT 0, skewy double precision DEFAULT 0, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_asraster($1, $2, $3, NULL, NULL, $6, $7, $8, NULL, NULL, $4, $5, $9, $10, $11) $function$
;

CREATE OR REPLACE FUNCTION public.st_asraster(geom geometry, scalex double precision, scaley double precision, pixeltype text[], value double precision[] DEFAULT ARRAY[(1)::double precision], nodataval double precision[] DEFAULT ARRAY[(0)::double precision], upperleftx double precision DEFAULT NULL::double precision, upperlefty double precision DEFAULT NULL::double precision, skewx double precision DEFAULT 0, skewy double precision DEFAULT 0, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_asraster($1, $2, $3, NULL, NULL, $4, $5, $6, $7, $8, NULL, NULL,	$9, $10, $11) $function$
;

CREATE OR REPLACE FUNCTION public.st_asraster(geom geometry, width integer, height integer, gridx double precision DEFAULT NULL::double precision, gridy double precision DEFAULT NULL::double precision, pixeltype text[] DEFAULT ARRAY['8BUI'::text], value double precision[] DEFAULT ARRAY[(1)::double precision], nodataval double precision[] DEFAULT ARRAY[(0)::double precision], skewx double precision DEFAULT 0, skewy double precision DEFAULT 0, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_asraster($1, NULL, NULL, $2, $3, $6, $7, $8, NULL, NULL, $4, $5, $9, $10, $11) $function$
;

CREATE OR REPLACE FUNCTION public.st_asraster(geom geometry, width integer, height integer, pixeltype text[], value double precision[] DEFAULT ARRAY[(1)::double precision], nodataval double precision[] DEFAULT ARRAY[(0)::double precision], upperleftx double precision DEFAULT NULL::double precision, upperlefty double precision DEFAULT NULL::double precision, skewx double precision DEFAULT 0, skewy double precision DEFAULT 0, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_asraster($1, NULL, NULL, $2, $3, $4, $5, $6, $7, $8, NULL, NULL,	$9, $10, $11) $function$
;

CREATE OR REPLACE FUNCTION public.st_asraster(geom geometry, scalex double precision, scaley double precision, gridx double precision, gridy double precision, pixeltype text, value double precision DEFAULT 1, nodataval double precision DEFAULT 0, skewx double precision DEFAULT 0, skewy double precision DEFAULT 0, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_asraster($1, $2, $3, NULL, NULL, ARRAY[$6]::text[], ARRAY[$7]::double precision[], ARRAY[$8]::double precision[], NULL, NULL, $4, $5, $9, $10, $11) $function$
;

CREATE OR REPLACE FUNCTION public.st_asraster(geom geometry, scalex double precision, scaley double precision, pixeltype text, value double precision DEFAULT 1, nodataval double precision DEFAULT 0, upperleftx double precision DEFAULT NULL::double precision, upperlefty double precision DEFAULT NULL::double precision, skewx double precision DEFAULT 0, skewy double precision DEFAULT 0, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_asraster($1, $2, $3, NULL, NULL, ARRAY[$4]::text[], ARRAY[$5]::double precision[], ARRAY[$6]::double precision[], $7, $8, NULL, NULL, $9, $10, $11) $function$
;

CREATE OR REPLACE FUNCTION public.st_asraster(geom geometry, width integer, height integer, gridx double precision, gridy double precision, pixeltype text, value double precision DEFAULT 1, nodataval double precision DEFAULT 0, skewx double precision DEFAULT 0, skewy double precision DEFAULT 0, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_asraster($1, NULL, NULL, $2, $3, ARRAY[$6]::text[], ARRAY[$7]::double precision[], ARRAY[$8]::double precision[], NULL, NULL, $4, $5, $9, $10, $11) $function$
;

CREATE OR REPLACE FUNCTION public.st_asraster(geom geometry, width integer, height integer, pixeltype text, value double precision DEFAULT 1, nodataval double precision DEFAULT 0, upperleftx double precision DEFAULT NULL::double precision, upperlefty double precision DEFAULT NULL::double precision, skewx double precision DEFAULT 0, skewy double precision DEFAULT 0, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_asraster($1, NULL, NULL, $2, $3, ARRAY[$4]::text[], ARRAY[$5]::double precision[], ARRAY[$6]::double precision[], $7, $8, NULL, NULL,$9, $10, $11) $function$
;

CREATE OR REPLACE FUNCTION public.st_asraster(geom geometry, ref raster, pixeltype text[] DEFAULT ARRAY['8BUI'::text], value double precision[] DEFAULT ARRAY[(1)::double precision], nodataval double precision[] DEFAULT ARRAY[(0)::double precision], touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		g public.geometry;
		g_srid integer;

		ul_x double precision;
		ul_y double precision;
		scale_x double precision;
		scale_y double precision;
		skew_x double precision;
		skew_y double precision;
		sr_id integer;
	BEGIN
		SELECT upperleftx, upperlefty, scalex, scaley, skewx, skewy, srid INTO ul_x, ul_y, scale_x, scale_y, skew_x, skew_y, sr_id FROM public.ST_Metadata(ref);
		--RAISE NOTICE '%, %, %, %, %, %, %', ul_x, ul_y, scale_x, scale_y, skew_x, skew_y, sr_id;

		-- geometry and raster has different SRID
		g_srid := public.ST_SRID(geom);
		IF g_srid != sr_id THEN
			RAISE NOTICE 'The geometry''s SRID (%) is not the same as the raster''s SRID (%).  The geometry will be transformed to the raster''s projection', g_srid, sr_id;
			g := public.ST_Transform(geom, sr_id);
		ELSE
			g := geom;
		END IF;

		RETURN public._ST_asraster(g, scale_x, scale_y, NULL, NULL, $3, $4, $5, NULL, NULL, ul_x, ul_y, skew_x, skew_y, $6);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_assvg(geom geometry, rel integer DEFAULT 0, maxdecimaldigits integer DEFAULT 15)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_asSVG$function$
;

CREATE OR REPLACE FUNCTION public.st_assvg(text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$ SELECT public.ST_AsSVG($1::public.geometry,0,15);  $function$
;

CREATE OR REPLACE FUNCTION public.st_assvg(geog geography, rel integer DEFAULT 0, maxdecimaldigits integer DEFAULT 15)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geography_as_svg$function$
;

CREATE OR REPLACE FUNCTION public.st_astext(geography, integer)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_asText$function$
;

CREATE OR REPLACE FUNCTION public.st_astext(text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$ SELECT public.ST_AsText($1::public.geometry);  $function$
;

CREATE OR REPLACE FUNCTION public.st_astext(geometry)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_asText$function$
;

CREATE OR REPLACE FUNCTION public.st_astext(geometry, integer)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_asText$function$
;

CREATE OR REPLACE FUNCTION public.st_astext(geography)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_asText$function$
;

CREATE OR REPLACE FUNCTION public.st_astiff(rast raster, nbands integer[], compression text, srid integer DEFAULT NULL::integer)
 RETURNS bytea
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.st_astiff(public.st_band($1, $2), $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_astiff(rast raster, nbands integer[], options text[] DEFAULT NULL::text[], srid integer DEFAULT NULL::integer)
 RETURNS bytea
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.st_astiff(public.st_band($1, $2), $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_astiff(rast raster, options text[] DEFAULT NULL::text[], srid integer DEFAULT NULL::integer)
 RETURNS bytea
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		i int;
		num_bands int;
		nodata double precision;
		last_nodata double precision;
	BEGIN
		IF rast IS NULL THEN
			RETURN NULL;
		END IF;

		num_bands := st_numbands($1);

		-- TIFF only allows one NODATA value for ALL bands
		FOR i IN 1..num_bands LOOP
			nodata := st_bandnodatavalue($1, i);
			IF last_nodata IS NULL THEN
				last_nodata := nodata;
			ELSEIF nodata != last_nodata THEN
				RAISE NOTICE 'The TIFF format only permits one NODATA value for all bands.  The value used will be the last band with a NODATA value.';
			END IF;
		END LOOP;

		RETURN st_asgdalraster($1, 'GTiff', $2, $3);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_astiff(rast raster, compression text, srid integer DEFAULT NULL::integer)
 RETURNS bytea
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		compression2 text;
		c_type text;
		c_level int;
		i int;
		num_bands int;
		options text[];
	BEGIN
		IF rast IS NULL THEN
			RETURN NULL;
		END IF;

		compression2 := trim(both from upper(compression));

		IF length(compression2) > 0 THEN
			-- JPEG
			IF position('JPEG' in compression2) != 0 THEN
				c_type := 'JPEG';
				c_level := substring(compression2 from '[0-9]+$');

				IF c_level IS NOT NULL THEN
					IF c_level > 100 THEN
						c_level := 100;
					ELSEIF c_level < 1 THEN
						c_level := 1;
					END IF;

					options := array_append(options, 'JPEG_QUALITY=' || c_level);
				END IF;

				-- per band pixel type check
				num_bands := st_numbands($1);
				FOR i IN 1..num_bands LOOP
					IF public.ST_BandPixelType($1, i) != '8BUI' THEN
						RAISE EXCEPTION 'The pixel type of band % in the raster is not 8BUI.  JPEG compression can only be used with the 8BUI pixel type.', i;
					END IF;
				END LOOP;

			-- DEFLATE
			ELSEIF position('DEFLATE' in compression2) != 0 THEN
				c_type := 'DEFLATE';
				c_level := substring(compression2 from '[0-9]+$');

				IF c_level IS NOT NULL THEN
					IF c_level > 9 THEN
						c_level := 9;
					ELSEIF c_level < 1 THEN
						c_level := 1;
					END IF;

					options := array_append(options, 'ZLEVEL=' || c_level);
				END IF;

			ELSE
				c_type := compression2;

				-- CCITT
				IF position('CCITT' in compression2) THEN
					-- per band pixel type check
					num_bands := st_numbands($1);
					FOR i IN 1..num_bands LOOP
						IF public.ST_BandPixelType($1, i) != '1BB' THEN
							RAISE EXCEPTION 'The pixel type of band % in the raster is not 1BB.  CCITT compression can only be used with the 1BB pixel type.', i;
						END IF;
					END LOOP;
				END IF;

			END IF;

			-- compression type check
			IF ARRAY[c_type] <@ ARRAY['JPEG', 'LZW', 'PACKBITS', 'DEFLATE', 'CCITTRLE', 'CCITTFAX3', 'CCITTFAX4', 'NONE'] THEN
				options := array_append(options, 'COMPRESS=' || c_type);
			ELSE
				RAISE NOTICE 'Unknown compression type: %.  The outputted TIFF will not be COMPRESSED.', c_type;
			END IF;
		END IF;

		RETURN st_astiff($1, options, $3);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_astwkb(geom geometry, prec integer DEFAULT NULL::integer, prec_z integer DEFAULT NULL::integer, prec_m integer DEFAULT NULL::integer, with_sizes boolean DEFAULT NULL::boolean, with_boxes boolean DEFAULT NULL::boolean)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$TWKBFromLWGEOM$function$
;

CREATE OR REPLACE FUNCTION public.st_astwkb(geom geometry[], ids bigint[], prec integer DEFAULT NULL::integer, prec_z integer DEFAULT NULL::integer, prec_m integer DEFAULT NULL::integer, with_sizes boolean DEFAULT NULL::boolean, with_boxes boolean DEFAULT NULL::boolean)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$TWKBFromLWGEOMArray$function$
;

CREATE OR REPLACE FUNCTION public.st_aswkb(raster, outasin boolean DEFAULT false)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_asWKB$function$
;

CREATE OR REPLACE FUNCTION public.st_asx3d(geom geometry, maxdecimaldigits integer DEFAULT 15, options integer DEFAULT 0)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 250
AS $function$SELECT public._ST_AsX3D(3,$1,$2,$3,'');$function$
;

CREATE OR REPLACE FUNCTION public.st_azimuth(geom1 geometry, geom2 geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_azimuth$function$
;

CREATE OR REPLACE FUNCTION public.st_azimuth(geog1 geography, geog2 geography)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geography_azimuth$function$
;

CREATE OR REPLACE FUNCTION public.st_band(rast raster, nband integer)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT  public.ST_band($1, ARRAY[$2]) $function$
;

CREATE OR REPLACE FUNCTION public.st_band(rast raster, nbands text, delimiter character DEFAULT ','::bpchar)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT  public.ST_band($1, pg_catalog.regexp_split_to_array(pg_catalog.regexp_replace($2, '[[:space:]]', '', 'g'), E'\\' || pg_catalog.array_to_string(pg_catalog.regexp_split_to_array($3, ''), E'\\'))::int[]) $function$
;

CREATE OR REPLACE FUNCTION public.st_band(rast raster, nbands integer[] DEFAULT ARRAY[1])
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_band$function$
;

CREATE OR REPLACE FUNCTION public.st_bandfilesize(rast raster, band integer DEFAULT 1)
 RETURNS bigint
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getBandFileSize$function$
;

CREATE OR REPLACE FUNCTION public.st_bandfiletimestamp(rast raster, band integer DEFAULT 1)
 RETURNS bigint
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getBandFileTimestamp$function$
;

CREATE OR REPLACE FUNCTION public.st_bandisnodata(rast raster, forcechecking boolean)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.ST_bandisnodata($1, 1, $2) $function$
;

CREATE OR REPLACE FUNCTION public.st_bandisnodata(rast raster, band integer DEFAULT 1, forcechecking boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_bandIsNoData$function$
;

CREATE OR REPLACE FUNCTION public.st_bandmetadata(rast raster, band integer[])
 RETURNS TABLE(bandnum integer, pixeltype text, nodatavalue double precision, isoutdb boolean, path text, outdbbandnum integer, filesize bigint, filetimestamp bigint)
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_bandmetadata$function$
;

CREATE OR REPLACE FUNCTION public.st_bandmetadata(rast raster, band integer DEFAULT 1)
 RETURNS TABLE(pixeltype text, nodatavalue double precision, isoutdb boolean, path text, outdbbandnum integer, filesize bigint, filetimestamp bigint)
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT pixeltype, nodatavalue, isoutdb, path, outdbbandnum, filesize, filetimestamp FROM public.ST_BandMetaData($1, ARRAY[$2]::int[]) LIMIT 1 $function$
;

CREATE OR REPLACE FUNCTION public.st_bandnodatavalue(rast raster, band integer DEFAULT 1)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getBandNoDataValue$function$
;

CREATE OR REPLACE FUNCTION public.st_bandpath(rast raster, band integer DEFAULT 1)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getBandPath$function$
;

CREATE OR REPLACE FUNCTION public.st_bandpixeltype(rast raster, band integer DEFAULT 1)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getBandPixelTypeName$function$
;

CREATE OR REPLACE FUNCTION public.st_bdmpolyfromtext(text, integer)
 RETURNS geometry
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
DECLARE
	geomtext alias for $1;
	srid alias for $2;
	mline public.geometry;
	geom public.geometry;
BEGIN
	mline := public.ST_MultiLineStringFromText(geomtext, srid);

	IF mline IS NULL
	THEN
		RAISE EXCEPTION 'Input is not a MultiLinestring';
	END IF;

	geom := public.ST_Multi(public.ST_BuildArea(mline));

	RETURN geom;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.st_bdpolyfromtext(text, integer)
 RETURNS geometry
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
DECLARE
	geomtext alias for $1;
	srid alias for $2;
	mline public.geometry;
	geom public.geometry;
BEGIN
	mline := public.ST_MultiLineStringFromText(geomtext, srid);

	IF mline IS NULL
	THEN
		RAISE EXCEPTION 'Input is not a MultiLinestring';
	END IF;

	geom := public.ST_BuildArea(mline);

	IF public.GeometryType(geom) != 'POLYGON'
	THEN
		RAISE EXCEPTION 'Input returns more then a single polygon, try using BdMPolyFromText instead';
	END IF;

	RETURN geom;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.st_boundary(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$boundary$function$
;

CREATE OR REPLACE FUNCTION public.st_boundingdiagonal(geom geometry, fits boolean DEFAULT false)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$ST_BoundingDiagonal$function$
;

CREATE OR REPLACE FUNCTION public.st_box2dfromgeohash(text, integer DEFAULT NULL::integer)
 RETURNS box2d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$box2d_from_geohash$function$
;

CREATE OR REPLACE FUNCTION public.st_buffer(geom geometry, radius double precision, quadsegs integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS $function$ SELECT public.ST_Buffer($1, $2, CAST('quad_segs='||CAST($3 AS text) as text)) $function$
;

CREATE OR REPLACE FUNCTION public.st_buffer(geom geometry, radius double precision, options text DEFAULT ''::text)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$buffer$function$
;

CREATE OR REPLACE FUNCTION public.st_buffer(geography, double precision)
 RETURNS geography
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$SELECT public.geography(public.ST_Transform(public.ST_Buffer(public.ST_Transform(public.geometry($1), public._ST_BestSRID($1)), $2), public.ST_SRID($1)))$function$
;

CREATE OR REPLACE FUNCTION public.st_buffer(geography, double precision, integer)
 RETURNS geography
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$SELECT public.geography(public.ST_Transform(public.ST_Buffer(public.ST_Transform(public.geometry($1), public._ST_BestSRID($1)), $2, $3), public.ST_SRID($1)))$function$
;

CREATE OR REPLACE FUNCTION public.st_buffer(geography, double precision, text)
 RETURNS geography
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$SELECT public.geography(public.ST_Transform(public.ST_Buffer(public.ST_Transform(public.geometry($1), public._ST_BestSRID($1)), $2, $3), public.ST_SRID($1)))$function$
;

CREATE OR REPLACE FUNCTION public.st_buffer(text, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.ST_Buffer($1::public.geometry, $2);  $function$
;

CREATE OR REPLACE FUNCTION public.st_buffer(text, double precision, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.ST_Buffer($1::public.geometry, $2, $3);  $function$
;

CREATE OR REPLACE FUNCTION public.st_buffer(text, double precision, text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.ST_Buffer($1::public.geometry, $2, $3);  $function$
;

CREATE OR REPLACE FUNCTION public.st_buildarea(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_BuildArea$function$
;

CREATE OR REPLACE FUNCTION public.st_centroid(geography, use_spheroid boolean DEFAULT true)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geography_centroid$function$
;

CREATE OR REPLACE FUNCTION public.st_centroid(text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.ST_Centroid($1::public.geometry);  $function$
;

CREATE OR REPLACE FUNCTION public.st_centroid(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$centroid$function$
;

CREATE OR REPLACE FUNCTION public.st_chaikinsmoothing(geometry, integer DEFAULT 1, boolean DEFAULT false)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_ChaikinSmoothing$function$
;

CREATE OR REPLACE FUNCTION public.st_cleangeometry(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_CleanGeometry$function$
;

CREATE OR REPLACE FUNCTION public.st_clip(rast raster, geom geometry, nodataval double precision[] DEFAULT NULL::double precision[], crop boolean DEFAULT true, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_Clip(rast, NULL, geom, nodataval, crop, touched) $function$
;

CREATE OR REPLACE FUNCTION public.st_clip(rast raster, geom geometry, nodataval double precision, crop boolean DEFAULT true, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_Clip(rast, NULL, geom, ARRAY[nodataval]::float8[], crop, touched) $function$
;

CREATE OR REPLACE FUNCTION public.st_clip(rast raster, geom geometry, crop boolean, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_Clip(rast, NULL, geom, null::float8[], crop, touched) $function$
;

CREATE OR REPLACE FUNCTION public.st_clip(rast raster, nband integer, geom geometry, nodataval double precision, crop boolean DEFAULT true, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_Clip(rast, ARRAY[nband]::integer[], geom, ARRAY[nodataval]::float8[], crop, touched) $function$
;

CREATE OR REPLACE FUNCTION public.st_clip(rast raster, nband integer, geom geometry, crop boolean DEFAULT true, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_Clip(rast, ARRAY[nband]::integer[], geom, null::double precision[], crop, touched) $function$
;

CREATE OR REPLACE FUNCTION public.st_clip(rast raster, nband integer[], geom geometry, nodataval double precision[], crop boolean DEFAULT true, touched boolean DEFAULT false)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	BEGIN
		-- short-cut if geometry's extent fully contains raster's extent
		IF (nodataval IS NULL OR array_length(nodataval, 1) < 1) AND public.ST_Contains(geom, public.ST_Envelope(rast)) THEN
			RETURN rast;
		END IF;

		RETURN public._ST_Clip(rast, nband, geom, nodataval, crop, touched);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_clipbybox2d(geom geometry, box box2d)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_ClipByBox2d$function$
;

CREATE OR REPLACE FUNCTION public.st_closestpoint(geom1 geometry, geom2 geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_closestpoint$function$
;

CREATE OR REPLACE FUNCTION public.st_closestpoint(text, text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_ClosestPoint($1::public.geometry, $2::public.geometry);  $function$
;

CREATE OR REPLACE FUNCTION public.st_closestpoint(geography, geography, use_spheroid boolean DEFAULT true)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_closestpoint$function$
;

CREATE OR REPLACE FUNCTION public.st_closestpointofapproach(geometry, geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_ClosestPointOfApproach$function$
;

CREATE OR REPLACE FUNCTION public.st_clusterintersecting(geometry[])
 RETURNS geometry[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$clusterintersecting_garray$function$
;

CREATE OR REPLACE FUNCTION public.st_clusterwithin(geometry[], double precision)
 RETURNS geometry[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$cluster_within_distance_garray$function$
;

CREATE OR REPLACE FUNCTION public.st_collect(geometry[])
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_collect_garray$function$
;

CREATE OR REPLACE FUNCTION public.st_collect(geom1 geometry, geom2 geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$LWGEOM_collect$function$
;

CREATE OR REPLACE FUNCTION public.st_collectionextract(geometry, integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_CollectionExtract$function$
;

CREATE OR REPLACE FUNCTION public.st_collectionextract(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_CollectionExtract$function$
;

CREATE OR REPLACE FUNCTION public.st_collectionhomogenize(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_CollectionHomogenize$function$
;

CREATE OR REPLACE FUNCTION public.st_colormap(rast raster, colormap text, method text DEFAULT 'INTERPOLATE'::text)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.ST_ColorMap($1, 1, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_colormap(rast raster, nband integer DEFAULT 1, colormap text DEFAULT 'grayscale'::text, method text DEFAULT 'INTERPOLATE'::text)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	DECLARE
		_ismap boolean;
		_colormap text;
		_element text[];
	BEGIN
		_ismap := TRUE;

		-- clean colormap to see what it is
		_colormap := split_part(colormap, E'\n', 1);
		_colormap := regexp_replace(_colormap, E':+', ' ', 'g');
		_colormap := regexp_replace(_colormap, E',+', ' ', 'g');
		_colormap := regexp_replace(_colormap, E'\\t+', ' ', 'g');
		_colormap := regexp_replace(_colormap, E' +', ' ', 'g');
		_element := regexp_split_to_array(_colormap, ' ');

		-- treat as colormap
		IF (array_length(_element, 1) > 1) THEN
			_colormap := colormap;
		-- treat as keyword
		ELSE
			method := 'INTERPOLATE';
			CASE lower(trim(both from _colormap))
				WHEN 'grayscale', 'greyscale' THEN
					_colormap := '
100%   0
  0% 254
  nv 255
					';
				WHEN 'pseudocolor' THEN
					_colormap := '
100% 255   0   0 255
 50%   0 255   0 255
  0%   0   0 255 255
  nv   0   0   0   0
					';
				WHEN 'fire' THEN
					_colormap := '
  100% 243 255 221 255
93.75% 242 255 178 255
 87.5% 255 255 135 255
81.25% 255 228  96 255
   75% 255 187  53 255
68.75% 255 131   7 255
 62.5% 255  84   0 255
56.25% 255  42   0 255
   50% 255   0   0 255
43.75% 255  42   0 255
 37.5% 224  74   0 255
31.25% 183  91   0 255
   25% 140  93   0 255
18.75%  99  82   0 255
 12.5%  58  58   1 255
 6.25%  12  15   0 255
    0%   0   0   0 255
    nv   0   0   0   0
					';
				WHEN 'bluered' THEN
					_colormap := '
100.00% 165   0  33 255
 94.12% 216  21  47 255
 88.24% 247  39  53 255
 82.35% 255  61  61 255
 76.47% 255 120  86 255
 70.59% 255 172 117 255
 64.71% 255 214 153 255
 58.82% 255 241 188 255
 52.94% 255 255 234 255
 47.06% 234 255 255 255
 41.18% 188 249 255 255
 35.29% 153 234 255 255
 29.41% 117 211 255 255
 23.53%  86 176 255 255
 17.65%  61 135 255 255
 11.76%  40  87 255 255
  5.88%  24  28 247 255
  0.00%  36   0 216 255
     nv   0   0   0   0
					';
				ELSE
					RAISE EXCEPTION 'Unknown colormap keyword: %', colormap;
			END CASE;
		END IF;

		RETURN public._ST_colormap($1, $2, _colormap, $4);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_combinebbox(box3d, geometry)
 RETURNS box3d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$BOX3D_combine$function$
;

CREATE OR REPLACE FUNCTION public.st_combinebbox(box2d, geometry)
 RETURNS box2d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis-3', $function$BOX2D_combine$function$
;

CREATE OR REPLACE FUNCTION public.st_combinebbox(box3d, box3d)
 RETURNS box3d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$BOX3D_combine_BOX3D$function$
;

CREATE OR REPLACE FUNCTION public.st_concavehull(param_geom geometry, param_pctconvex double precision, param_allow_holes boolean DEFAULT false)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_ConcaveHull$function$
;

CREATE OR REPLACE FUNCTION public.st_contains(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$contains$function$
;

CREATE OR REPLACE FUNCTION public.st_contains(rast1 raster, rast2 raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT public.st_contains($1, NULL::integer, $2, NULL::integer) $function$
;

CREATE OR REPLACE FUNCTION public.st_contains(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT $1 OPERATOR(public.&&) $3 AND CASE WHEN $2 IS NULL OR $4 IS NULL THEN public._st_contains(public.st_convexhull($1), public.st_convexhull($3)) ELSE public._st_contains($1, $2, $3, $4) END $function$
;

CREATE OR REPLACE FUNCTION public.st_containsproperly(rast1 raster, rast2 raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT public.st_containsproperly($1, NULL::integer, $2, NULL::integer) $function$
;

CREATE OR REPLACE FUNCTION public.st_containsproperly(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT $1 OPERATOR(public.&&) $3 AND CASE WHEN $2 IS NULL OR $4 IS NULL THEN public._st_containsproperly(public.st_convexhull($1), public.st_convexhull($3)) ELSE public._st_containsproperly($1, $2, $3, $4) END $function$
;

CREATE OR REPLACE FUNCTION public.st_containsproperly(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$containsproperly$function$
;

CREATE OR REPLACE FUNCTION public.st_contour(rast raster, bandnumber integer DEFAULT 1, level_interval double precision DEFAULT 100.0, level_base double precision DEFAULT 0.0, fixed_levels double precision[] DEFAULT ARRAY[]::double precision[], polygonize boolean DEFAULT false)
 RETURNS TABLE(geom geometry, id integer, value double precision)
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 10000
AS '$libdir/postgis_raster-3', $function$RASTER_Contour$function$
;

CREATE OR REPLACE FUNCTION public.st_convexhull(raster)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE STRICT COST 300
AS '$libdir/postgis_raster-3', $function$RASTER_convex_hull$function$
;

CREATE OR REPLACE FUNCTION public.st_convexhull(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$convexhull$function$
;

CREATE OR REPLACE FUNCTION public.st_coorddim(geometry geometry)
 RETURNS smallint
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_ndims$function$
;

CREATE OR REPLACE FUNCTION public.st_count(rast raster, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_count($1, $2, $3, 1) $function$
;

CREATE OR REPLACE FUNCTION public.st_count(rast raster, exclude_nodata_value boolean)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_count($1, 1, $2, 1) $function$
;

CREATE OR REPLACE FUNCTION public.st_coverageunion(geometry[])
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_CoverageUnion$function$
;

CREATE OR REPLACE FUNCTION public.st_coveredby(rast1 raster, rast2 raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT public.st_coveredby($1, NULL::integer, $2, NULL::integer) $function$
;

CREATE OR REPLACE FUNCTION public.st_coveredby(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT $1 OPERATOR(public.&&) $3 AND CASE WHEN $2 IS NULL OR $4 IS NULL THEN public._st_coveredby(public.st_convexhull($1), public.st_convexhull($3)) ELSE public._st_coveredby($1, $2, $3, $4) END $function$
;

CREATE OR REPLACE FUNCTION public.st_coveredby(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$coveredby$function$
;

CREATE OR REPLACE FUNCTION public.st_coveredby(text, text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_CoveredBy($1::public.geometry, $2::public.geometry);  $function$
;

CREATE OR REPLACE FUNCTION public.st_coveredby(geog1 geography, geog2 geography)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$geography_coveredby$function$
;

CREATE OR REPLACE FUNCTION public.st_covers(rast1 raster, rast2 raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT public.st_covers($1, NULL::integer, $2, NULL::integer) $function$
;

CREATE OR REPLACE FUNCTION public.st_covers(geog1 geography, geog2 geography)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$geography_covers$function$
;

CREATE OR REPLACE FUNCTION public.st_covers(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$covers$function$
;

CREATE OR REPLACE FUNCTION public.st_covers(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT $1 OPERATOR(public.&&) $3 AND CASE WHEN $2 IS NULL OR $4 IS NULL THEN public._st_covers(public.st_convexhull($1), public.st_convexhull($3)) ELSE public._st_covers($1, $2, $3, $4) END $function$
;

CREATE OR REPLACE FUNCTION public.st_covers(text, text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_Covers($1::public.geometry, $2::public.geometry);  $function$
;

CREATE OR REPLACE FUNCTION public.st_cpawithin(geometry, geometry, double precision)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_CPAWithin$function$
;

CREATE OR REPLACE FUNCTION public.st_createoverview(tab regclass, col name, factor integer, algo text DEFAULT 'NearestNeighbour'::text)
 RETURNS regclass
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
  sinfo RECORD; -- source info
  sql TEXT;
  ttab TEXT;
BEGIN

  -- 0. Check arguments, we need to ensure:
  --    a. Source table has a raster column with given name
  --    b. Source table has a fixed scale (or "factor" would have no meaning)
  --    c. Source table has a known extent ? (we could actually compute it)
  --    d. Source table has a fixed tile size (or "factor" would have no meaning?)
  -- # all of the above can be checked with a query to raster_columns
  sql := 'SELECT r.r_table_schema sch, r.r_table_name tab, '
      || 'r.scale_x sfx, r.scale_y sfy, r.blocksize_x tw, '
      || 'r.blocksize_y th, r.extent ext, r.srid FROM public.raster_columns r, '
      || 'pg_class c, pg_catalog.pg_namespace n WHERE r.r_table_schema = n.nspname '
      || 'AND r.r_table_name = c.relname AND r_raster_column = $2 AND '
      || ' c.relnamespace = n.oid AND c.oid = $1'
  ;
  EXECUTE sql INTO sinfo USING tab, col;
  IF sinfo IS NULL THEN
      RAISE EXCEPTION '%.% raster column does not exist', tab::text, col;
  END IF;
  IF sinfo.sfx IS NULL or sinfo.sfy IS NULL THEN
    RAISE EXCEPTION 'cannot create overview without scale constraint, try select AddRasterConstraints(''%'', ''%'');', tab::text, col;
  END IF;
  IF sinfo.tw IS NULL or sinfo.tw IS NULL THEN
    RAISE EXCEPTION 'cannot create overview without tilesize constraint, try select AddRasterConstraints(''%'', ''%'');', tab::text, col;
  END IF;
  IF sinfo.ext IS NULL THEN
    RAISE EXCEPTION 'cannot create overview without extent constraint, try select AddRasterConstraints(''%'', ''%'');', tab::text, col;
  END IF;

  -- TODO: lookup in raster_overviews to see if there's any
  --       lower-resolution table to start from

  ttab := 'o_' || factor || '_' || sinfo.tab;
  sql := 'CREATE TABLE ' || quote_ident(sinfo.sch)
      || '.' || quote_ident(ttab)
      || ' AS SELECT public.ST_Retile($1, $2, $3, $4, $5, $6, $7) '
      || quote_ident(col);
  EXECUTE sql USING tab, col, sinfo.ext,
                    sinfo.sfx * factor, sinfo.sfy * factor,
                    sinfo.tw, sinfo.th, algo;

  -- TODO: optimize this using knowledge we have about
  --       the characteristics of the target column ?
  PERFORM public.AddRasterConstraints(sinfo.sch, ttab, col);

  PERFORM  public.AddOverviewConstraints(sinfo.sch, ttab, col,
                                 sinfo.sch, sinfo.tab, col, factor);

    -- return the schema as well as the table
  RETURN sinfo.sch||'.'||ttab;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.st_crosses(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$crosses$function$
;

CREATE OR REPLACE FUNCTION public.st_curven(geometry geometry, i integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_CurveN$function$
;

CREATE OR REPLACE FUNCTION public.st_curvetoline(geom geometry, tol double precision DEFAULT 32, toltype integer DEFAULT 0, flags integer DEFAULT 0)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_CurveToLine$function$
;

CREATE OR REPLACE FUNCTION public.st_delaunaytriangles(g1 geometry, tolerance double precision DEFAULT 0.0, flags integer DEFAULT 0)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_DelaunayTriangles$function$
;

CREATE OR REPLACE FUNCTION public.st_dfullywithin(rast1 raster, rast2 raster, distance double precision)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT public.ST_DFullyWithin($1, NULL::integer, $2, NULL::integer, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_dfullywithin(rast1 raster, nband1 integer, rast2 raster, nband2 integer, distance double precision)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT $1::public.geometry OPERATOR(public.&&) public.ST_Expand(public.ST_ConvexHull($3), $5) AND $3::geometry OPERATOR(public.&&) public.ST_Expand(public.ST_ConvexHull($1), $5) AND CASE WHEN $2 IS NULL OR $4 IS NULL THEN public._ST_DFullyWithin(public.ST_ConvexHull($1), public.ST_Convexhull($3), $5) ELSE public._ST_DFullyWithin($1, $2, $3, $4, $5) END $function$
;

CREATE OR REPLACE FUNCTION public.st_dfullywithin(geom1 geometry, geom2 geometry, double precision)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$LWGEOM_dfullywithin$function$
;

CREATE OR REPLACE FUNCTION public.st_difference(geom1 geometry, geom2 geometry, gridsize double precision DEFAULT '-1.0'::numeric)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_Difference$function$
;

CREATE OR REPLACE FUNCTION public.st_dimension(geometry)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_dimension$function$
;

CREATE OR REPLACE FUNCTION public.st_disjoint(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$disjoint$function$
;

CREATE OR REPLACE FUNCTION public.st_disjoint(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT CASE WHEN $2 IS NULL OR $4 IS NULL THEN public.ST_Disjoint(public.ST_ConvexHull($1), public.ST_ConvexHull($3)) ELSE NOT public._ST_intersects($1, $2, $3, $4) END $function$
;

CREATE OR REPLACE FUNCTION public.st_disjoint(rast1 raster, rast2 raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT public.ST_Disjoint($1, NULL::integer, $2, NULL::integer) $function$
;

CREATE OR REPLACE FUNCTION public.st_distance(geog1 geography, geog2 geography, use_spheroid boolean DEFAULT true)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$geography_distance$function$
;

CREATE OR REPLACE FUNCTION public.st_distance(text, text)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.ST_Distance($1::public.geometry, $2::public.geometry);  $function$
;

CREATE OR REPLACE FUNCTION public.st_distance(geom1 geometry, geom2 geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_Distance$function$
;

CREATE OR REPLACE FUNCTION public.st_distancecpa(geometry, geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_DistanceCPA$function$
;

CREATE OR REPLACE FUNCTION public.st_distancesphere(geom1 geometry, geom2 geometry, radius double precision)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE STRICT COST 5000
AS '$libdir/postgis-3', $function$LWGEOM_distance_sphere$function$
;

CREATE OR REPLACE FUNCTION public.st_distancesphere(geom1 geometry, geom2 geometry)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$select public.ST_distance( public.geography($1), public.geography($2),false)$function$
;

CREATE OR REPLACE FUNCTION public.st_distancespheroid(geom1 geometry, geom2 geometry, spheroid)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_distance_ellipsoid$function$
;

CREATE OR REPLACE FUNCTION public.st_distancespheroid(geom1 geometry, geom2 geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_distance_ellipsoid$function$
;

CREATE OR REPLACE FUNCTION public.st_distinct4ma(matrix double precision[], nodatamode text, VARIADIC args text[])
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT COUNT(DISTINCT unnest)::float FROM unnest($1) $function$
;

CREATE OR REPLACE FUNCTION public.st_distinct4ma(value double precision[], pos integer[], VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT COUNT(DISTINCT unnest)::double precision FROM unnest($1) $function$
;

CREATE OR REPLACE FUNCTION public.st_dump(geometry)
 RETURNS SETOF geometry_dump
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_dump$function$
;

CREATE OR REPLACE FUNCTION public.st_dumpaspolygons(rast raster, band integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true)
 RETURNS SETOF geomval
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_dumpAsPolygons$function$
;

CREATE OR REPLACE FUNCTION public.st_dumppoints(geometry)
 RETURNS SETOF geometry_dump
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$LWGEOM_dumppoints$function$
;

CREATE OR REPLACE FUNCTION public.st_dumprings(geometry)
 RETURNS SETOF geometry_dump
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_dump_rings$function$
;

CREATE OR REPLACE FUNCTION public.st_dumpsegments(geometry)
 RETURNS SETOF geometry_dump
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$LWGEOM_dumpsegments$function$
;

CREATE OR REPLACE FUNCTION public.st_dumpvalues(rast raster, nband integer[] DEFAULT NULL::integer[], exclude_nodata_value boolean DEFAULT true)
 RETURNS TABLE(nband integer, valarray double precision[])
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_dumpValues$function$
;

CREATE OR REPLACE FUNCTION public.st_dumpvalues(rast raster, nband integer, exclude_nodata_value boolean DEFAULT true)
 RETURNS double precision[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT valarray FROM public.ST_dumpvalues($1, ARRAY[$2]::integer[], $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_dwithin(geom1 geometry, geom2 geometry, double precision)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$LWGEOM_dwithin$function$
;

CREATE OR REPLACE FUNCTION public.st_dwithin(rast1 raster, nband1 integer, rast2 raster, nband2 integer, distance double precision)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT $1::public.geometry OPERATOR(public.&&) ST_Expand(ST_ConvexHull($3), $5) AND $3::geometry OPERATOR(public.&&) ST_Expand(ST_ConvexHull($1), $5) AND CASE WHEN $2 IS NULL OR $4 IS NULL THEN public._ST_dwithin(st_convexhull($1), st_convexhull($3), $5) ELSE public._ST_dwithin($1, $2, $3, $4, $5) END $function$
;

CREATE OR REPLACE FUNCTION public.st_dwithin(rast1 raster, rast2 raster, distance double precision)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT public.st_dwithin($1, NULL::integer, $2, NULL::integer, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_dwithin(text, text, double precision)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_DWithin($1::public.geometry, $2::public.geometry, $3);  $function$
;

CREATE OR REPLACE FUNCTION public.st_dwithin(geog1 geography, geog2 geography, tolerance double precision, use_spheroid boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$geography_dwithin$function$
;

CREATE OR REPLACE FUNCTION public.st_endpoint(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_endpoint_linestring$function$
;

CREATE OR REPLACE FUNCTION public.st_envelope(raster)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_envelope$function$
;

CREATE OR REPLACE FUNCTION public.st_envelope(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_envelope$function$
;

CREATE OR REPLACE FUNCTION public.st_equals(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$ST_Equals$function$
;

CREATE OR REPLACE FUNCTION public.st_estimatedextent(text, text)
 RETURNS box2d
 LANGUAGE c
 STABLE STRICT
AS '$libdir/postgis-3', $function$gserialized_estimated_extent$function$
;

CREATE OR REPLACE FUNCTION public.st_estimatedextent(text, text, text)
 RETURNS box2d
 LANGUAGE c
 STABLE STRICT
AS '$libdir/postgis-3', $function$gserialized_estimated_extent$function$
;

CREATE OR REPLACE FUNCTION public.st_estimatedextent(text, text, text, boolean)
 RETURNS box2d
 LANGUAGE c
 STABLE STRICT
AS '$libdir/postgis-3', $function$gserialized_estimated_extent$function$
;

CREATE OR REPLACE FUNCTION public.st_expand(box2d, double precision)
 RETURNS box2d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$BOX2D_expand$function$
;

CREATE OR REPLACE FUNCTION public.st_expand(geom geometry, dx double precision, dy double precision, dz double precision DEFAULT 0, dm double precision DEFAULT 0)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_expand$function$
;

CREATE OR REPLACE FUNCTION public.st_expand(geometry, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_expand$function$
;

CREATE OR REPLACE FUNCTION public.st_expand(box box2d, dx double precision, dy double precision)
 RETURNS box2d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$BOX2D_expand$function$
;

CREATE OR REPLACE FUNCTION public.st_expand(box box3d, dx double precision, dy double precision, dz double precision DEFAULT 0)
 RETURNS box3d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$BOX3D_expand$function$
;

CREATE OR REPLACE FUNCTION public.st_expand(box3d, double precision)
 RETURNS box3d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$BOX3D_expand$function$
;

CREATE OR REPLACE FUNCTION public.st_exteriorring(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_exteriorring_polygon$function$
;

CREATE OR REPLACE FUNCTION public.st_filterbym(geometry, double precision, double precision DEFAULT NULL::double precision, boolean DEFAULT false)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$LWGEOM_FilterByM$function$
;

CREATE OR REPLACE FUNCTION public.st_findextent(text, text)
 RETURNS box2d
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE STRICT
AS $function$
DECLARE
	tablename alias for $1;
	columnname alias for $2;
	myrec RECORD;

BEGIN
	FOR myrec IN EXECUTE 'SELECT public.ST_Extent("' || columnname || '") As extent FROM "' || tablename || '"' LOOP
		return myrec.extent;
	END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.st_findextent(text, text, text)
 RETURNS box2d
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE STRICT
AS $function$
DECLARE
	schemaname alias for $1;
	tablename alias for $2;
	columnname alias for $3;
	myrec RECORD;
BEGIN
	FOR myrec IN EXECUTE 'SELECT public.ST_Extent("' || columnname || '") As extent FROM "' || schemaname || '"."' || tablename || '"' LOOP
		return myrec.extent;
	END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.st_flipcoordinates(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_FlipCoordinates$function$
;

CREATE OR REPLACE FUNCTION public.st_force2d(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_force_2d$function$
;

CREATE OR REPLACE FUNCTION public.st_force3d(geom geometry, zvalue double precision DEFAULT 0.0)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_Force3DZ($1, $2)$function$
;

CREATE OR REPLACE FUNCTION public.st_force3dm(geom geometry, mvalue double precision DEFAULT 0.0)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_force_3dm$function$
;

CREATE OR REPLACE FUNCTION public.st_force3dz(geom geometry, zvalue double precision DEFAULT 0.0)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_force_3dz$function$
;

CREATE OR REPLACE FUNCTION public.st_force4d(geom geometry, zvalue double precision DEFAULT 0.0, mvalue double precision DEFAULT 0.0)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_force_4d$function$
;

CREATE OR REPLACE FUNCTION public.st_forcecollection(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_force_collection$function$
;

CREATE OR REPLACE FUNCTION public.st_forcecurve(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_force_curve$function$
;

CREATE OR REPLACE FUNCTION public.st_forcepolygonccw(geometry)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$ SELECT public.ST_Reverse(public.ST_ForcePolygonCW($1)) $function$
;

CREATE OR REPLACE FUNCTION public.st_forcepolygoncw(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_force_clockwise_poly$function$
;

CREATE OR REPLACE FUNCTION public.st_forcerhr(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_force_clockwise_poly$function$
;

CREATE OR REPLACE FUNCTION public.st_forcesfs(geometry, version text)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_force_sfs$function$
;

CREATE OR REPLACE FUNCTION public.st_forcesfs(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_force_sfs$function$
;

CREATE OR REPLACE FUNCTION public.st_frechetdistance(geom1 geometry, geom2 geometry, double precision DEFAULT '-1'::integer)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_FrechetDistance$function$
;

CREATE OR REPLACE FUNCTION public.st_fromflatgeobuf(anyelement, bytea)
 RETURNS SETOF anyelement
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$pgis_fromflatgeobuf$function$
;

CREATE OR REPLACE FUNCTION public.st_fromflatgeobuftotable(text, text, bytea)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$pgis_tablefromflatgeobuf$function$
;

CREATE OR REPLACE FUNCTION public.st_fromgdalraster(gdaldata bytea, srid integer DEFAULT NULL::integer)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_fromGDALRaster$function$
;

CREATE OR REPLACE FUNCTION public.st_gdaldrivers(OUT idx integer, OUT short_name text, OUT long_name text, OUT can_read boolean, OUT can_write boolean, OUT create_options text)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getGDALDrivers$function$
;

CREATE OR REPLACE FUNCTION public.st_generatepoints(area geometry, npoints integer)
 RETURNS geometry
 LANGUAGE c
 PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_GeneratePoints$function$
;

CREATE OR REPLACE FUNCTION public.st_generatepoints(area geometry, npoints integer, seed integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_GeneratePoints$function$
;

CREATE OR REPLACE FUNCTION public.st_geogfromtext(text)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geography_from_text$function$
;

CREATE OR REPLACE FUNCTION public.st_geogfromwkb(bytea)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$geography_from_binary$function$
;

CREATE OR REPLACE FUNCTION public.st_geographyfromtext(text)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geography_from_text$function$
;

CREATE OR REPLACE FUNCTION public.st_geohash(geog geography, maxchars integer DEFAULT 0)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_GeoHash$function$
;

CREATE OR REPLACE FUNCTION public.st_geohash(geom geometry, maxchars integer DEFAULT 0)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_GeoHash$function$
;

CREATE OR REPLACE FUNCTION public.st_geomcollfromtext(text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$
	SELECT CASE
	WHEN public.geometrytype(public.ST_GeomFromText($1)) = 'GEOMETRYCOLLECTION'
	THEN public.ST_GeomFromText($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_geomcollfromtext(text, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$
	SELECT CASE
	WHEN public.geometrytype(public.ST_GeomFromText($1, $2)) = 'GEOMETRYCOLLECTION'
	THEN public.ST_GeomFromText($1,$2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_geomcollfromwkb(bytea)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE
	WHEN public.geometrytype(public.ST_GeomFromWKB($1)) = 'GEOMETRYCOLLECTION'
	THEN public.ST_GeomFromWKB($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_geomcollfromwkb(bytea, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE
	WHEN public.geometrytype(public.ST_GeomFromWKB($1, $2)) = 'GEOMETRYCOLLECTION'
	THEN public.ST_GeomFromWKB($1, $2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_geometricmedian(g geometry, tolerance double precision DEFAULT NULL::double precision, max_iter integer DEFAULT 10000, fail_if_not_converged boolean DEFAULT false)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 5000
AS '$libdir/postgis-3', $function$ST_GeometricMedian$function$
;

CREATE OR REPLACE FUNCTION public.st_geometryfromtext(text)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_from_text$function$
;

CREATE OR REPLACE FUNCTION public.st_geometryfromtext(text, integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_from_text$function$
;

CREATE OR REPLACE FUNCTION public.st_geometryn(geometry, integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_geometryn_collection$function$
;

CREATE OR REPLACE FUNCTION public.st_geometrytype(geometry)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geometry_geometrytype$function$
;

CREATE OR REPLACE FUNCTION public.st_geomfromewkb(bytea)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOMFromEWKB$function$
;

CREATE OR REPLACE FUNCTION public.st_geomfromewkt(text)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$parse_WKT_lwgeom$function$
;

CREATE OR REPLACE FUNCTION public.st_geomfromgeohash(text, integer DEFAULT NULL::integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 50
AS $function$ SELECT CAST(public.ST_Box2dFromGeoHash($1, $2) AS geometry); $function$
;

CREATE OR REPLACE FUNCTION public.st_geomfromgeojson(jsonb)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$SELECT public.ST_GeomFromGeoJson($1::text)$function$
;

CREATE OR REPLACE FUNCTION public.st_geomfromgeojson(text)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geom_from_geojson$function$
;

CREATE OR REPLACE FUNCTION public.st_geomfromgeojson(json)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$SELECT public.ST_GeomFromGeoJson($1::text)$function$
;

CREATE OR REPLACE FUNCTION public.st_geomfromgml(text, integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geom_from_gml$function$
;

CREATE OR REPLACE FUNCTION public.st_geomfromgml(text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$SELECT public._ST_GeomFromGML($1, 0)$function$
;

CREATE OR REPLACE FUNCTION public.st_geomfromkml(text)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geom_from_kml$function$
;

CREATE OR REPLACE FUNCTION public.st_geomfrommarc21(marc21xml text)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 500
AS '$libdir/postgis-3', $function$ST_GeomFromMARC21$function$
;

CREATE OR REPLACE FUNCTION public.st_geomfromtext(text)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_from_text$function$
;

CREATE OR REPLACE FUNCTION public.st_geomfromtext(text, integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_from_text$function$
;

CREATE OR REPLACE FUNCTION public.st_geomfromtwkb(bytea)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOMFromTWKB$function$
;

CREATE OR REPLACE FUNCTION public.st_geomfromwkb(bytea, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_SetSRID(public.ST_GeomFromWKB($1), $2)$function$
;

CREATE OR REPLACE FUNCTION public.st_geomfromwkb(bytea)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_from_WKB$function$
;

CREATE OR REPLACE FUNCTION public.st_georeference(rast raster, format text DEFAULT 'GDAL'::text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
    DECLARE
				scale_x numeric;
				scale_y numeric;
				skew_x numeric;
				skew_y numeric;
				ul_x numeric;
				ul_y numeric;

        result text;
    BEGIN
			SELECT scalex::numeric, scaley::numeric, skewx::numeric, skewy::numeric, upperleftx::numeric, upperlefty::numeric
				INTO scale_x, scale_y, skew_x, skew_y, ul_x, ul_y FROM public.ST_Metadata(rast);

						-- scale x
            result := trunc(scale_x, 10) || E'\n';

						-- skew y
            result := result || trunc(skew_y, 10) || E'\n';

						-- skew x
            result := result || trunc(skew_x, 10) || E'\n';

						-- scale y
            result := result || trunc(scale_y, 10) || E'\n';

        IF format = 'ESRI' THEN
						-- upper left x
            result := result || trunc((ul_x + scale_x * 0.5), 10) || E'\n';

						-- upper left y
            result = result || trunc((ul_y + scale_y * 0.5), 10) || E'\n';
        ELSE -- IF format = 'GDAL' THEN
						-- upper left x
            result := result || trunc(ul_x, 10) || E'\n';

						-- upper left y
            result := result || trunc(ul_y, 10) || E'\n';
        END IF;

        RETURN result;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.st_geotransform(raster, OUT imag double precision, OUT jmag double precision, OUT theta_i double precision, OUT theta_ij double precision, OUT xoffset double precision, OUT yoffset double precision)
 RETURNS record
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_getGeotransform$function$
;

CREATE OR REPLACE FUNCTION public.st_gmltosql(text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$SELECT public._ST_GeomFromGML($1, 0)$function$
;

CREATE OR REPLACE FUNCTION public.st_gmltosql(text, integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geom_from_gml$function$
;

CREATE OR REPLACE FUNCTION public.st_grayscale(rast raster, redband integer DEFAULT 1, greenband integer DEFAULT 2, blueband integer DEFAULT 3, extenttype text DEFAULT 'INTERSECTION'::text)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
	BEGIN

		RETURN public.ST_Grayscale(
			ARRAY[
				ROW(rast, redband)::rastbandarg,
				ROW(rast, greenband)::rastbandarg,
				ROW(rast, blueband)::rastbandarg
			]::rastbandarg[],
			extenttype
		);

	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_grayscale(rastbandargset rastbandarg[], extenttype text DEFAULT 'INTERSECTION'::text)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE

		_NBANDS integer DEFAULT 3;
		_NODATA integer DEFAULT 255;
		_PIXTYPE text DEFAULT '8BUI';

		_set public.rastbandarg[];

		nrast integer;
		idx integer;
		rast public.raster;
		nband integer;

		stats public.summarystats;
		nodata double precision;
		nodataval integer;
		reclassexpr text;

	BEGIN

		-- check for three rastbandarg
		nrast := array_length(rastbandargset, 1);
		IF nrast < _NBANDS THEN
			RAISE EXCEPTION '''rastbandargset'' must have three bands for red, green and blue';
		ELSIF nrast > _NBANDS THEN
			RAISE WARNING 'Only the first three elements of ''rastbandargset'' will be used';
			_set := rastbandargset[1:3];
		ELSE
			_set := rastbandargset;
		END IF;

		FOR idx IN 1.._NBANDS LOOP

			rast := _set[idx].rast;
			nband := _set[idx].nband;

			-- check that each raster has the specified band
			IF public.ST_HasNoBand(rast, nband) THEN

				RAISE EXCEPTION 'Band at index ''%'' not found for raster ''%''', nband, idx;

			-- check that each band is 8BUI. if not, reclassify to 8BUI
			ELSIF public.ST_BandPixelType(rast, nband) != _PIXTYPE THEN

				stats := public.ST_SummaryStats(rast, nband);
				nodata := public.ST_BandNoDataValue(rast, nband);

				IF nodata IS NOT NULL THEN
					nodataval := _NODATA;
					reclassexpr := concat(
						concat('[', nodata , '-', nodata, ']:', _NODATA, '-', _NODATA, ','),
						concat('[', stats.min , '-', stats.max , ']:0-', _NODATA - 1)
					);
				ELSE
					nodataval := NULL;
					reclassexpr := concat('[', stats.min , '-', stats.max , ']:0-', _NODATA);
				END IF;

				_set[idx] := ROW(
					public.ST_Reclass(
						rast,
						ROW(nband, reclassexpr, _PIXTYPE, nodataval)::reclassarg
					),
					nband
				)::rastbandarg;

			END IF;

		END LOOP;

		-- call map algebra with _st_grayscale4ma
		RETURN public.ST_MapAlgebra(
			_set,
			'public._ST_Grayscale4MA(double precision[][][], integer[][], text[])'::regprocedure,
			'8BUI',
			extenttype
		);

	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_hasarc(geometry geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_has_arc$function$
;

CREATE OR REPLACE FUNCTION public.st_hasm(geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_hasm$function$
;

CREATE OR REPLACE FUNCTION public.st_hasnoband(rast raster, nband integer DEFAULT 1)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_hasNoBand$function$
;

CREATE OR REPLACE FUNCTION public.st_hasz(geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_hasz$function$
;

CREATE OR REPLACE FUNCTION public.st_hausdorffdistance(geom1 geometry, geom2 geometry, double precision)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$hausdorffdistancedensify$function$
;

CREATE OR REPLACE FUNCTION public.st_hausdorffdistance(geom1 geometry, geom2 geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$hausdorffdistance$function$
;

CREATE OR REPLACE FUNCTION public.st_height(raster)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getHeight$function$
;

CREATE OR REPLACE FUNCTION public.st_hexagon(size double precision, cell_i integer, cell_j integer, origin geometry DEFAULT '010100000000000000000000000000000000000000'::geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_Hexagon$function$
;

CREATE OR REPLACE FUNCTION public.st_hexagongrid(size double precision, bounds geometry, OUT geom geometry, OUT i integer, OUT j integer)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_ShapeGrid$function$
;

CREATE OR REPLACE FUNCTION public.st_hillshade(rast raster, nband integer, customextent raster, pixeltype text DEFAULT '32BF'::text, azimuth double precision DEFAULT 315.0, altitude double precision DEFAULT 45.0, max_bright double precision DEFAULT 255.0, scale double precision DEFAULT 1.0, interpolate_nodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		_rast public.raster;
		_nband integer;
		_pixtype text;
		_pixwidth double precision;
		_pixheight double precision;
		_width integer;
		_height integer;
		_customextent public.raster;
		_extenttype text;
	BEGIN
		_customextent := customextent;
		IF _customextent IS NULL THEN
			_extenttype := 'FIRST';
		ELSE
			_extenttype := 'CUSTOM';
		END IF;

		IF interpolate_nodata IS TRUE THEN
			_rast := public.ST_MapAlgebra(
				ARRAY[ROW(rast, nband)]::public.rastbandarg[],
				'public.st_invdistweight4ma(double precision[][][], integer[][], text[])'::regprocedure,
				pixeltype,
				'FIRST', NULL,
				1, 1
			);
			_nband := 1;
			_pixtype := NULL;
		ELSE
			_rast := rast;
			_nband := nband;
			_pixtype := pixeltype;
		END IF;

		-- get properties
		_pixwidth := public.ST_PixelWidth(_rast);
		_pixheight := public.ST_PixelHeight(_rast);
		SELECT width, height, scalex INTO _width, _height FROM public.ST_Metadata(_rast);

		RETURN public.ST_MapAlgebra(
			ARRAY[ROW(_rast, _nband)]::public.rastbandarg[],
			' public._ST_hillshade4ma(double precision[][][], integer[][], text[])'::regprocedure,
			_pixtype,
			_extenttype, _customextent,
			1, 1,
			_pixwidth::text, _pixheight::text,
			_width::text, _height::text,
			$5::text, $6::text,
			$7::text, $8::text
		);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_hillshade(rast raster, nband integer DEFAULT 1, pixeltype text DEFAULT '32BF'::text, azimuth double precision DEFAULT 315.0, altitude double precision DEFAULT 45.0, max_bright double precision DEFAULT 255.0, scale double precision DEFAULT 1.0, interpolate_nodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_hillshade($1, $2, NULL::public.raster, $3, $4, $5, $6, $7, $8) $function$
;

CREATE OR REPLACE FUNCTION public.st_histogram(rast raster, nband integer, exclude_nodata_value boolean, bins integer, "right" boolean, OUT min double precision, OUT max double precision, OUT count bigint, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT min, max, count, percent FROM public._ST_histogram($1, $2, $3, 1, $4, NULL, $5) $function$
;

CREATE OR REPLACE FUNCTION public.st_histogram(rast raster, nband integer, bins integer, "right" boolean, OUT min double precision, OUT max double precision, OUT count bigint, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT min, max, count, percent FROM public._ST_histogram($1, $2, TRUE, 1, $3, NULL, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_histogram(rast raster, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, bins integer DEFAULT 0, width double precision[] DEFAULT NULL::double precision[], "right" boolean DEFAULT false, OUT min double precision, OUT max double precision, OUT count bigint, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT min, max, count, percent FROM public._ST_histogram($1, $2, $3, 1, $4, $5, $6) $function$
;

CREATE OR REPLACE FUNCTION public.st_histogram(rast raster, nband integer, bins integer, width double precision[] DEFAULT NULL::double precision[], "right" boolean DEFAULT false, OUT min double precision, OUT max double precision, OUT count bigint, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT min, max, count, percent FROM public._ST_histogram($1, $2, TRUE, 1, $3, $4, $5) $function$
;

CREATE OR REPLACE FUNCTION public.st_interiorringn(geometry, integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_interiorringn_polygon$function$
;

CREATE OR REPLACE FUNCTION public.st_interpolatepoint(line geometry, point geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_InterpolatePoint$function$
;

CREATE OR REPLACE FUNCTION public.st_interpolateraster(geom geometry, options text, rast raster, bandnumber integer DEFAULT 1)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 10000
AS '$libdir/postgis_raster-3', $function$RASTER_InterpolateRaster$function$
;

CREATE OR REPLACE FUNCTION public.st_intersection(rast1 raster, rast2 raster, returnband text DEFAULT 'BOTH'::text, nodataval double precision[] DEFAULT NULL::double precision[])
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.st_intersection($1, 1, $2, 1, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_intersection(geom1 geometry, geom2 geometry, gridsize double precision DEFAULT '-1'::integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_Intersection$function$
;

CREATE OR REPLACE FUNCTION public.st_intersection(rast1 raster, rast2 raster, nodataval double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.st_intersection($1, 1, $2, 1, 'BOTH', ARRAY[$3, $3]) $function$
;

CREATE OR REPLACE FUNCTION public.st_intersection(rast1 raster, band1 integer, rast2 raster, band2 integer, returnband text DEFAULT 'BOTH'::text, nodataval double precision[] DEFAULT NULL::double precision[])
 RETURNS raster
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
AS $function$
	DECLARE
		rtn public.raster;
		_returnband text;
		newnodata1 float8;
		newnodata2 float8;
	BEGIN
		IF ST_SRID(rast1) != ST_SRID(rast2) THEN
			RAISE EXCEPTION 'The two rasters do not have the same SRID';
		END IF;

		newnodata1 := coalesce(nodataval[1], public.ST_BandNodataValue(rast1, band1), public.ST_MinPossibleValue(public.ST_BandPixelType(rast1, band1)));
		newnodata2 := coalesce(nodataval[2], public.ST_BandNodataValue(rast2, band2), public.ST_MinPossibleValue(public.ST_BandPixelType(rast2, band2)));

		_returnband := upper(returnband);

		rtn := NULL;
		CASE
			WHEN _returnband = 'BAND1' THEN
				rtn := public.ST_MapAlgebraExpr(rast1, band1, rast2, band2, '[rast1.val]', public.ST_BandPixelType(rast1, band1), 'INTERSECTION', newnodata1::text, newnodata1::text, newnodata1);
				rtn := public.ST_SetBandNodataValue(rtn, 1, newnodata1);
			WHEN _returnband = 'BAND2' THEN
				rtn := public.ST_MapAlgebraExpr(rast1, band1, rast2, band2, '[rast2.val]', public.ST_BandPixelType(rast2, band2), 'INTERSECTION', newnodata2::text, newnodata2::text, newnodata2);
				rtn := public.ST_SetBandNodataValue(rtn, 1, newnodata2);
			WHEN _returnband = 'BOTH' THEN
				rtn := public.ST_MapAlgebraExpr(rast1, band1, rast2, band2, '[rast1.val]', public.ST_BandPixelType(rast1, band1), 'INTERSECTION', newnodata1::text, newnodata1::text, newnodata1);
				rtn := public.ST_SetBandNodataValue(rtn, 1, newnodata1);
				rtn := public.ST_AddBand(rtn, public.ST_MapAlgebraExpr(rast1, band1, rast2, band2, '[rast2.val]', public.ST_BandPixelType(rast2, band2), 'INTERSECTION', newnodata2::text, newnodata2::text, newnodata2));
				rtn := public.ST_SetBandNodataValue(rtn, 2, newnodata2);
			ELSE
				RAISE EXCEPTION 'Unknown value provided for returnband: %', returnband;
				RETURN NULL;
		END CASE;

		RETURN rtn;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_intersection(rast1 raster, band1 integer, rast2 raster, band2 integer, returnband text, nodataval double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.st_intersection($1, $2, $3, $4, $5, ARRAY[$6, $6]) $function$
;

CREATE OR REPLACE FUNCTION public.st_intersection(rast1 raster, band1 integer, rast2 raster, band2 integer, nodataval double precision[])
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.st_intersection($1, $2, $3, $4, 'BOTH', $5) $function$
;

CREATE OR REPLACE FUNCTION public.st_intersection(rast1 raster, band1 integer, rast2 raster, band2 integer, nodataval double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.st_intersection($1, $2, $3, $4, 'BOTH', ARRAY[$5, $5]) $function$
;

CREATE OR REPLACE FUNCTION public.st_intersection(rast1 raster, rast2 raster, nodataval double precision[])
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.st_intersection($1, 1, $2, 1, 'BOTH', $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_intersection(rast1 raster, rast2 raster, returnband text, nodataval double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.st_intersection($1, 1, $2, 1, $3, ARRAY[$4, $4]) $function$
;

CREATE OR REPLACE FUNCTION public.st_intersection(text, text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS $function$ SELECT public.ST_Intersection($1::public.geometry, $2::public.geometry);  $function$
;

CREATE OR REPLACE FUNCTION public.st_intersection(geography, geography)
 RETURNS geography
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$SELECT public.geography(public.ST_Transform(public.ST_Intersection(public.ST_Transform(public.geometry($1), public._ST_BestSRID($1, $2)), public.ST_Transform(public.geometry($2), public._ST_BestSRID($1, $2))), public.ST_SRID($1)))$function$
;

CREATE OR REPLACE FUNCTION public.st_intersection(geomin geometry, rast raster, band integer DEFAULT 1)
 RETURNS SETOF geomval
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	DECLARE
		intersects boolean := FALSE; same_srid boolean := FALSE;
	BEGIN
		same_srid :=  (public.ST_SRID(geomin) = public.ST_SRID(rast));
		IF NOT same_srid THEN
			RAISE EXCEPTION 'SRIDS of geometry: % and raster: % are not the same',
				public.ST_SRID(geomin), public.ST_SRID(rast)
				USING HINT = 'Verify using ST_SRID function';
		END IF;
		intersects :=  public.ST_Intersects(geomin, rast, band);
		IF intersects THEN
			-- Return the intersections of the geometry with the vectorized parts of
			-- the raster and the values associated with those parts, if really their
			-- intersection is not empty.
			RETURN QUERY
				SELECT
					intgeom,
					val
				FROM (
					SELECT
						public.ST_Intersection((gv).geom, geomin) AS intgeom,
						(gv).val
					FROM public.ST_DumpAsPolygons(rast, band) gv
					WHERE public.ST_Intersects((gv).geom, geomin)
				) foo
				WHERE NOT public.ST_IsEmpty(intgeom);
		ELSE
			-- If the geometry does not intersect with the raster, return an empty
			-- geometry and a null value
			RETURN QUERY
				SELECT
					emptygeom,
					NULL::float8
				FROM public.ST_GeomCollFromText('GEOMETRYCOLLECTION EMPTY', public.ST_SRID($1)) emptygeom;
		END IF;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_intersection(rast raster, band integer, geomin geometry)
 RETURNS SETOF geomval
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.ST_Intersection($3, $1, $2) $function$
;

CREATE OR REPLACE FUNCTION public.st_intersection(rast raster, geomin geometry)
 RETURNS SETOF geomval
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.ST_Intersection($2, $1, 1) $function$
;

CREATE OR REPLACE FUNCTION public.st_intersects(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT $1 OPERATOR(public.&&) $3 AND CASE WHEN $2 IS NULL OR $4 IS NULL THEN public._st_intersects(public.st_convexhull($1), public.st_convexhull($3)) ELSE public._st_intersects($1, $2, $3, $4) END $function$
;

CREATE OR REPLACE FUNCTION public.st_intersects(rast1 raster, rast2 raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT public.st_intersects($1, NULL::integer, $2, NULL::integer) $function$
;

CREATE OR REPLACE FUNCTION public.st_intersects(geom geometry, rast raster, nband integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT $1 OPERATOR(public.&&) $2::public.geometry AND public._st_intersects($1, $2, $3); $function$
;

CREATE OR REPLACE FUNCTION public.st_intersects(rast raster, geom geometry, nband integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT $1::public.geometry OPERATOR(public.&&) $2 AND public._st_intersects($2, $1, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_intersects(rast raster, nband integer, geom geometry)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT $1::public.geometry OPERATOR(public.&&) $3 AND public._st_intersects($3, $1, $2) $function$
;

CREATE OR REPLACE FUNCTION public.st_intersects(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$ST_Intersects$function$
;

CREATE OR REPLACE FUNCTION public.st_intersects(text, text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_Intersects($1::public.geometry, $2::public.geometry);  $function$
;

CREATE OR REPLACE FUNCTION public.st_intersects(geog1 geography, geog2 geography)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$geography_intersects$function$
;

CREATE OR REPLACE FUNCTION public.st_invdistweight4ma(value double precision[], pos integer[], VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		_value double precision[][][];
		ndims int;

		k double precision DEFAULT 1.;
		_k double precision DEFAULT 1.;
		z double precision[];
		d double precision[];
		_d double precision;
		z0 double precision;

		_z integer;
		x integer;
		y integer;

		cx integer;
		cy integer;
		cv double precision;
		cw double precision DEFAULT NULL;

		w integer;
		h integer;
		max_dx double precision;
		max_dy double precision;
	BEGIN
--		RAISE NOTICE 'value = %', value;
--		RAISE NOTICE 'userargs = %', userargs;

		ndims := array_ndims(value);
		-- add a third dimension if 2-dimension
		IF ndims = 2 THEN
			_value := public._ST_convertarray4ma(value);
		ELSEIF ndims != 3 THEN
			RAISE EXCEPTION 'First parameter of function must be a 3-dimension array';
		ELSE
			_value := value;
		END IF;

		-- only use the first raster passed to this function
		IF array_length(_value, 1) > 1 THEN
			RAISE NOTICE 'Only using the values from the first raster';
		END IF;
		_z := array_lower(_value, 1);

		-- width and height (0-based)
		h := array_upper(_value, 2) - array_lower(_value, 2);
		w := array_upper(_value, 3) - array_lower(_value, 3);

		-- max distance from center pixel
		max_dx := w / 2;
		max_dy := h / 2;
--		RAISE NOTICE 'max_dx, max_dy = %, %', max_dx, max_dy;

		-- correct width and height (1-based)
		w := w + 1;
		h := h + 1;
--		RAISE NOTICE 'w, h = %, %', w, h;

		-- width and height should be odd numbers
		IF w % 2. != 1 THEN
			RAISE EXCEPTION 'Width of neighborhood array does not permit for a center pixel';
		END IF;
		IF h % 2. != 1 THEN
			RAISE EXCEPTION 'Height of neighborhood array does not permit for a center pixel';
		END IF;

		-- center pixel's coordinates
		cy := max_dy + array_lower(_value, 2);
		cx := max_dx + array_lower(_value, 3);
--		RAISE NOTICE 'cx, cy = %, %', cx, cy;

		-- if userargs provided, only use the first two args
		IF userargs IS NOT NULL AND array_ndims(userargs) = 1 THEN
			-- first arg is power factor
			k := userargs[array_lower(userargs, 1)]::double precision;
			IF k IS NULL THEN
				k := _k;
			ELSEIF k < 0. THEN
				RAISE NOTICE 'Power factor (< 0) must be between 0 and 1.  Defaulting to 0';
				k := 0.;
			ELSEIF k > 1. THEN
				RAISE NOTICE 'Power factor (> 1) must be between 0 and 1.  Defaulting to 1';
				k := 1.;
			END IF;

			-- second arg is what to do if center pixel has a value
			-- this will be a weight to apply for the center pixel
			IF array_length(userargs, 1) > 1 THEN
				cw := abs(userargs[array_lower(userargs, 1) + 1]::double precision);
				IF cw IS NOT NULL THEN
					IF cw < 0. THEN
						RAISE NOTICE 'Weight (< 0) of center pixel value must be between 0 and 1.  Defaulting to 0';
						cw := 0.;
					ELSEIF cw > 1 THEN
						RAISE NOTICE 'Weight (> 1) of center pixel value must be between 0 and 1.  Defaulting to 1';
						cw := 1.;
					END IF;
				END IF;
			END IF;
		END IF;
--		RAISE NOTICE 'k = %', k;
		k = abs(k) * -1;

		-- center pixel value
		cv := _value[_z][cy][cx];

		-- check to see if center pixel has value
--		RAISE NOTICE 'cw = %', cw;
		IF cw IS NULL AND cv IS NOT NULL THEN
			RETURN cv;
		END IF;

		FOR y IN array_lower(_value, 2)..array_upper(_value, 2) LOOP
			FOR x IN array_lower(_value, 3)..array_upper(_value, 3) LOOP
--				RAISE NOTICE 'value[%][%][%] = %', _z, y, x, _value[_z][y][x];

				-- skip NODATA values and center pixel
				IF _value[_z][y][x] IS NULL OR (x = cx AND y = cy) THEN
					CONTINUE;
				END IF;

				z := z || _value[_z][y][x];

				-- use pythagorean theorem
				_d := sqrt(power(cx - x, 2) + power(cy - y, 2));
--				RAISE NOTICE 'distance = %', _d;

				d := d || _d;
			END LOOP;
		END LOOP;
--		RAISE NOTICE 'z = %', z;
--		RAISE NOTICE 'd = %', d;

		-- neighborhood is NODATA
		IF z IS NULL OR array_length(z, 1) < 1 THEN
			-- center pixel has value
			IF cv IS NOT NULL THEN
				RETURN cv;
			ELSE
				RETURN NULL;
			END IF;
		END IF;

		z0 := 0;
		_d := 0;
		FOR x IN array_lower(z, 1)..array_upper(z, 1) LOOP
			d[x] := power(d[x], k);
			z[x] := z[x] * d[x];
			_d := _d + d[x];
			z0 := z0 + z[x];
		END LOOP;
		z0 := z0 / _d;
--		RAISE NOTICE 'z0 = %', z0;

		-- apply weight for center pixel if center pixel has value
		IF cv IS NOT NULL THEN
			z0 := (cw * cv) + ((1 - cw) * z0);
--			RAISE NOTICE '*z0 = %', z0;
		END IF;

		RETURN z0;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_inversetransformpipeline(geom geometry, pipeline text, to_srid integer DEFAULT 0)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS $function$SELECT public.postgis_transform_pipeline_geometry($1, $2, FALSE, $3)$function$
;

CREATE OR REPLACE FUNCTION public.st_isclosed(geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_isclosed$function$
;

CREATE OR REPLACE FUNCTION public.st_iscollection(geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$ST_IsCollection$function$
;

CREATE OR REPLACE FUNCTION public.st_iscoveragetile(rast raster, coverage raster, tilewidth integer, tileheight integer)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	DECLARE
		_rastmeta record;
		_covmeta record;
		cr record;
		max integer[];
		tile integer[];
		edge integer[];
	BEGIN
		IF NOT public.ST_SameAlignment(rast, coverage) THEN
			RAISE NOTICE 'Raster and coverage are not aligned';
			RETURN FALSE;
		END IF;

		_rastmeta := public.ST_Metadata(rast);
		_covmeta := public.ST_Metadata(coverage);

		-- get coverage grid coordinates of upper-left of rast
		cr := public.ST_WorldToRasterCoord(coverage, _rastmeta.upperleftx, _rastmeta.upperlefty);

		-- rast is not part of coverage
		IF
			(cr.columnx < 1 OR cr.columnx > _covmeta.width) OR
			(cr.rowy < 1 OR cr.rowy > _covmeta.height)
		THEN
			RAISE NOTICE 'Raster is not in the coverage';
			RETURN FALSE;
		END IF;

		-- rast isn't on the coverage's grid
		IF
			((cr.columnx - 1) % tilewidth != 0) OR
			((cr.rowy - 1) % tileheight != 0)
		THEN
			RAISE NOTICE 'Raster is not aligned to tile grid of coverage';
			RETURN FALSE;
		END IF;

		-- max # of tiles on X and Y for coverage
		max[0] := ceil(_covmeta.width::double precision / tilewidth::double precision)::integer;
		max[1] := ceil(_covmeta.height::double precision / tileheight::double precision)::integer;

		-- tile # of rast in coverage
		tile[0] := (cr.columnx / tilewidth) + 1;
		tile[1] := (cr.rowy / tileheight) + 1;

		-- inner tile
		IF tile[0] < max[0] AND tile[1] < max[1] THEN
			IF
				(_rastmeta.width != tilewidth) OR
				(_rastmeta.height != tileheight)
			THEN
				RAISE NOTICE 'Raster width/height is invalid for interior tile of coverage';
				RETURN FALSE;
			ELSE
				RETURN TRUE;
			END IF;
		END IF;

		-- edge tile

		-- edge tile may have same size as inner tile
		IF
			(_rastmeta.width = tilewidth) AND
			(_rastmeta.height = tileheight)
		THEN
			RETURN TRUE;
		END IF;

		-- get edge tile width and height
		edge[0] := _covmeta.width - ((max[0] - 1) * tilewidth);
		edge[1] := _covmeta.height - ((max[1] - 1) * tileheight);

		-- edge tile not of expected tile size
		-- right and bottom
		IF tile[0] = max[0] AND tile[1] = max[1] THEN
			IF
				_rastmeta.width != edge[0] OR
				_rastmeta.height != edge[1]
			THEN
				RAISE NOTICE 'Raster width/height is invalid for right-most AND bottom-most tile of coverage';
				RETURN FALSE;
			END IF;
		ELSEIF tile[0] = max[0] THEN
			IF
				_rastmeta.width != edge[0] OR
				_rastmeta.height != tileheight
			THEN
				RAISE NOTICE 'Raster width/height is invalid for right-most tile of coverage';
				RETURN FALSE;
			END IF;
		ELSE
			IF
				_rastmeta.width != tilewidth OR
				_rastmeta.height != edge[1]
			THEN
				RAISE NOTICE 'Raster width/height is invalid for bottom-most tile of coverage';
				RETURN FALSE;
			END IF;
		END IF;

		RETURN TRUE;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_isempty(geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_isempty$function$
;

CREATE OR REPLACE FUNCTION public.st_isempty(rast raster)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_isEmpty$function$
;

CREATE OR REPLACE FUNCTION public.st_ispolygonccw(geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_IsPolygonCCW$function$
;

CREATE OR REPLACE FUNCTION public.st_ispolygoncw(geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_IsPolygonCW$function$
;

CREATE OR REPLACE FUNCTION public.st_isring(geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$isring$function$
;

CREATE OR REPLACE FUNCTION public.st_issimple(geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$issimple$function$
;

CREATE OR REPLACE FUNCTION public.st_isvalid(geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$isvalid$function$
;

CREATE OR REPLACE FUNCTION public.st_isvalid(geometry, integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS $function$SELECT (public.ST_isValidDetail($1, $2)).valid$function$
;

CREATE OR REPLACE FUNCTION public.st_isvaliddetail(geom geometry, flags integer DEFAULT 0)
 RETURNS valid_detail
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$isvaliddetail$function$
;

CREATE OR REPLACE FUNCTION public.st_isvalidreason(geometry)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$isvalidreason$function$
;

CREATE OR REPLACE FUNCTION public.st_isvalidreason(geometry, integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS $function$
	SELECT CASE WHEN valid THEN 'Valid Geometry' ELSE reason END FROM (
		SELECT (public.ST_isValidDetail($1, $2)).*
	) foo
	$function$
;

CREATE OR REPLACE FUNCTION public.st_isvalidtrajectory(geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_IsValidTrajectory$function$
;

CREATE OR REPLACE FUNCTION public.st_largestemptycircle(geom geometry, tolerance double precision DEFAULT 0.0, boundary geometry DEFAULT '0101000000000000000000F87F000000000000F87F'::geometry, OUT center geometry, OUT nearest geometry, OUT radius double precision)
 RETURNS record
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_LargestEmptyCircle$function$
;

CREATE OR REPLACE FUNCTION public.st_length(text)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.ST_Length($1::public.geometry);  $function$
;

CREATE OR REPLACE FUNCTION public.st_length(geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_length2d_linestring$function$
;

CREATE OR REPLACE FUNCTION public.st_length(geog geography, use_spheroid boolean DEFAULT true)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geography_length$function$
;

CREATE OR REPLACE FUNCTION public.st_length2d(geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_length2d_linestring$function$
;

CREATE OR REPLACE FUNCTION public.st_length2dspheroid(geometry, spheroid)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_length2d_ellipsoid$function$
;

CREATE OR REPLACE FUNCTION public.st_lengthspheroid(geometry, spheroid)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_length_ellipsoid_linestring$function$
;

CREATE OR REPLACE FUNCTION public.st_letters(letters text, font json DEFAULT NULL::json)
 RETURNS geometry
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE COST 250
 SET standard_conforming_strings TO 'on'
AS $function$
DECLARE
  letterarray text[];
  letter text;
  geom geometry;
  prevgeom geometry = NULL;
  adjustment float8 = 0.0;
  position float8 = 0.0;
  text_height float8 = 100.0;
  width float8;
  m_width float8;
  spacing float8;
  dist float8;
  wordarr geometry[];
  wordgeom geometry;
  -- geometry has been run through replace(encode(st_astwkb(geom),'base64'), E'\n', '')
  font_default_height float8 = 1000.0;
  font_default json = '{
  "!":"BgACAQhUrgsTFOQCABQAExELiwi5AgAJiggBYQmJCgAOAg4CDAIOBAoEDAYKBgoGCggICAgICAgGCgYKBgoGCgQMBAoECgQMAgoADAIKAAoADAEKAAwBCgMKAQwDCgMKAwoFCAUKBwgHBgcIBwYJBgkECwYJBAsCDQILAg0CDQANAQ0BCwELAwsDCwUJBQkFCQcHBwcHBwcFCQUJBQkFCQMLAwkDCQMLAQkACwEJAAkACwIJAAsCCQQJAgsECQQJBAkGBwYJCAcIBQgHCAUKBQoDDAUKAQwDDgEMAQ4BDg==",
  "&":"BgABAskBygP+BowEAACZAmcAANsCAw0FDwUNBQ0FDQcLBw0HCwcLCQsJCwkLCQkJCwsJCwkLCQ0HCwcNBw8HDQUPBQ8DDwMRAw8DEQERAREBEQERABcAFQIXAhUCEwQVBBMGEwYTBhEIEQgPChEKDwoPDA0MDQwNDgsOCRAJEAkQBxAHEgUSBRQFFAMUAxQBFgEWARgAigEAFAISABICEgQQAhAEEAQQBg4GEAoOCg4MDg4ODgwSDgsMCwoJDAcMBwwFDgUMAw4DDgEOARABDgEQARIBEAASAHgAIAQeBB4GHAgaChoMGA4WDhYQFBISEhISDhQQFAwWDBYKFgoYBhgIGAQYBBgCGgAaABgBGAMYAxYHFgUWCRYJFAsUCxIPEg0SERARDhMOFQwVDBcIGQYbBhsCHQIfAR+dAgAADAAKAQoBCgEIAwgFBgUGBQYHBAUEBwQHAgcCBwIHAAcABwAHAQcBBwMHAwUDBwUFBQUHBQUBBwMJAQkBCQAJAJcBAAUCBQAFAgUEBQIDBAUEAwQDBgMEAQYDBgEGAAgBBgAKSeECAJ8BFi84HUQDQCAAmAKNAQAvExMx",
  "\"":"BgACAQUmwguEAgAAkwSDAgAAlAQBBfACAIACAACTBP8BAACUBA==",
  "''":"BgABAQUmwguEAgAAkwSDAgAAlAQ=",
  "(":"BgABAUOQBNwLDScNKw0rCysLLwsxCTEJMwc1BzcHNwM7AzsDPwE/AEEANwI1AjMEMwIzBjEGLwYvCC0ILQgrCCkKKQonCicMJbkCAAkqCSoHLAksBywFLgcuBS4FMAMwAzADMgEwATQBMgA0ADwCOgI6BDoEOAY4BjYINgg2CjQKMgoyCjIMMAwwDi7AAgA=",
  ")":"BgABAUMQ3Au6AgAOLQwvDC8KMQoxCjEKMwg1CDUGNQY3BDcEOQI5AjkAOwAzATEBMQExAy8DLwMvBS8FLQctBS0HKwktBykJKwkpswIADCYKKAooCioIKggsCC4ILgYwBjAGMgQ0AjQCNAI2ADgAQgFAAz4DPAM8BzgHOAc2CTQJMgsyCzALLg0sDSoNKg==",
  "+":"BgABAQ3IBOwGALcBuAEAANUBtwEAALcB0wEAALgBtwEAANYBuAEAALgB1AEA",
  "/":"BgABAQVCAoIDwAuyAgCFA78LrQIA",
  "4":"BgABAhDkBr4EkgEAEREApwJ/AADxARIR5QIAEhIA9AHdAwAA7ALIA9AG6gIAEREA8QYFqwIAAIIDwwH/AgABxAEA",
  "v":"BgABASDmA5AEPu4CROwBExb6AgAZFdMC0wgUFaECABIU0wLWCBcW+AIAExVE6wEEFQQXBBUEFwQVBBUEFwQVBBUEFwQVBBUEFwQXBBUEFwYA",
  ",":"BgABAWMYpAEADgIOAgwCDgQMBAoGDAYKBgoICAgICAgICAoGCgYKBAoEDAQKBAoCDAIKAgwCCgAKAAwACgEMAQoBCgMMAwoDCgUKBQgFCgUIBwYJCAcGCQYJBAsGCQQLAg0CCwINAg0AAwABAAMAAwADAQMAAwADAAMBBQAFAQcBBwEHAwcBCQMJAQsDCwMLAw0FDQMNBQ8FDwURBxMFEwkTBxcJFwkXswEAIMgBCQYJBgkGBwYJCAcIBQgHCgUKBQoFDAEMAwwBDgEOABA=",
  "-":"BgABAQUq0AMArALEBAAAqwLDBAA=",
  ".":"BgABAWFOrAEADgIOAg4CDgQMBAoGDAYKBgoICAgKCAgIBgoGCgYKBgoEDAQKBAwECgIMAAwCDAAMAAwBCgAMAQoDDAMKAwoDCgUKBQgFCgUIBwgJBgcICQYJBgsGCQQLAg0CDQINAA0ADQENAQ0BCwMNAwkFCwUJBQkHBwcJBwUHBwkFCQUJBQkDCwMJAwsDCQELAAsBCwALAAsCCQALAgkECwQJBAkECQYJBgcGBwgJBgcKBQgHCgUKBQwFCgEOAwwBDgEOAA4=",
  "0":"BgABAoMB+APaCxwAHAEaARoDFgMYBRYFFAcUBxIJEgkQCRALEAsOCwwNDA0MDQoPCg0IDwgPBhEGDwYRBA8EEQIRAhMCEQITABMA4QUAEQETAREBEQMRAxEFEQURBREHDwkPBw8JDwsNCw0LDQ0NDQsNCw8JEQkRCREJEwcTBxUFFQUVAxUDFwEXARkAGQAZAhcCFwQXBBUGEwYTCBMIEQoRCg8KDwoPDA0MDQ4NDgsOCQ4JEAkQBxAHEAUSBRIDEgMSAxIDEgESARQAEgDiBQASAhQCEgISBBIEEgYSBhIGEggQChAIEAoQDBAMDgwODg4ODA4MEgwQChIKEggUCBQIFgYWBBYGGAQYAhgCGgILZIcDHTZBEkMRHTUA4QUeOUITRBIePADiBQ==",
  "2":"BgABAWpUwALUA44GAAoBCAEKAQgDBgMGBQYFBgUEBwQFBAUCBwIHAgUABwAHAAUBBwMFAQcFBQMHBQUHBQcFBwMJAwkBCQELAQsAC68CAAAUAhIAFAISBBQCEgQUBBIEEgYUCBIGEAgSChAKEAoQDBAMDg4ODgwQDBIMEgoSChQIFggWCBgGGAQaAhwCHAIWABQBFgEUARQDFAMSAxQFEgUSBxIHEAkQCRALDgsODQ4NDA8KDwwRCBMKEwgTBhUGFwQXBBcEGwAbABsAHQEftwPJBdIDAACpAhIPzwYAFBIArgI=",
  "1":"BgABARCsBLALAJ0LEhERADcA2QEANwATABQSAOYIpwEAALgCERKEBAASABER",
  "3":"BgABAZ0B/gbEC/sB0QQOAwwBDAMMAwwFCgMKBQoFCgUIBwoFCAcICQgJBgkICQYLCAsECwYLBA0GDwINBA8CDwQRAhECEQITABUCFQAVAH0AEQETAREBEQETAxEDEQURBREFDwcRBw8JDwkNCQ8LDQsNDQsNCw0LDwsPCREJEQcRBxMFFQUVBRUDFwEXARkAGQAZAhkCFwQVBBUEEwYTCBEIEQgRCg0MDwoNDA0OCw4LDgkQCRAHEAkQBRAFEgUSAxIDFAMSAxYBFAEWARYAFqQCAAALAgkCCQQHAgcGBwYHBgUIBQYDCAMIAwYDCAEIAQgACAAIAAgCCAIIAgYCCAQIBAgGBgYEBgQIBAoCCgAKAAwAvAEABgEIAAYBBgMGAwQDBgMEBQQDBAUCBQQFAgUABwIFAJkBAACmAaIB3ALbAgAREQDmAhIRggYA",
  "5":"BgABAaAB0APgBxIAFAESABIBEgMSARADEgMQAxIFEAcOBRAHDgkOCQ4JDgsMCwwLCgsKDQoPCA0IDwgPBhEEEwYTAhMEFwIXABcAiQIAEwETABEBEQMTAxEDDwMRBQ8FDwUPBw8JDQcNCQ0LDQsLCwsNCw0JDwkPCREHEQcTBxMFEwMVAxcDGQEZARkAFwAVAhUCFQQTBBMGEwYRCBEIDwoPCg8KDQwNDA0MCw4LDgkOCRAJEAcOBxAHEgUQBRIDEAMSAxIBEgEUARIAFLgCAAAFAgUABQIFBAUCBQQDBAUEAwYDBgMIAwgBCAEIAQoACAAIAgYACAQGAgQEBgQEBAQGBAQCBgIGAgYCBgIIAAYA4AEABgEIAAYBBgMGAQQDBgMEAwQFBAMCBQQFAgUABwIFAPkBAG+OAQCCBRESAgAAAuYFABMRAK8CjQMAAJ8BNgA=",
  "7":"BgABAQrQBsILhQOvCxQR7wIAEhK+AvYIiwMAAKgCERKwBgA=",
  "6":"BgABAsYBnAOqBxgGFgYYBBYEFgIWABQBFgEUAxQDFAUUBRIFEAcSCRAJEAkOCw4NDgsMDQoPCg8KDwgRCBEGEQYRBBMCEwITAhUAkwIBAAERAREBEQEPAxEFEQMPBREFDwcPBw8HDwkNCQ0LDQsNCwsNCw0LDQkPCQ8JDwcRBxEHEwUTAxMFFQEXAxcBGQAVABUCEwIVBBMEEQYTBhEIEQgPChEKDQoPDA0MDQwNDgsOCxALDgkQCRAHEgcQBxIFEgUSBRIBFAMSARIBFAASAOIFABACEgIQAhIEEAQQBhIGEAYQCBAKEAgOChAMDgwMDA4ODA4MDgwODBAKEAoQChIIEggSBhQGFgYUAhYCGAIYABoAGAEYARYBFgMUBRQFEgUSBxAHEAcQCQ4LDgkMCwwNDA0KDQgPCg0GEQgPBhEEEQQRBBMEEwITAhMCFQIVABWrAgAACgEIAQoBCAEGAwYDBgUGBQQFBAUEBQQFAgUABwIFAAUABwEFAAUBBQMFAwUDBQMFBQMFAwUBBQEHAQkBBwAJAJcBDUbpBDASFi4A4AETLC8SBQAvERUrAN8BFC0yEQQA",
  "8":"BgABA9gB6gPYCxYAFAEUARYBEgMUBRQFEgUSBxIHEAcSCQ4JEAkOCw4LDgsMDQwNCg0KDQoPCg8IDwgPBhEGEQQPBBMCEQIRABMAQwAxAA8BEQEPAREDDwMRAw8FEQUPBxEJDwkPCQ8NDw0PDQ8IBwYHCAcGBwgHBgkGBwYJBgcECQYJBAkGCQQJBAsECwQLBA0CCwINAg8CDwIPAA8AaQATAREBEwERAxEFEQURBREHEQcPBw8JDwkPCw8LDQsNDQ0LCw0LDwsNCQ8JDwcPBw8HEQURAxEFEQMRARMBEwFDABEAEwIRAhEEEQQRBg8GEQgPCA8KDwoPCg0MDQwNDAsOCw4LDgkQCRAJDgkQBxIHEAcSBRADEgMUAxIBFAEUABQAagAOAhAADgIOAg4EDAIOBAwEDAQMBgwECgYMBAoGCAYKBgoGCggKBgoICgYICAoICA0MCwwLDgsOCRAHEAcQBxIFEgUSAxIDEgMSARABEgASADIARAASAhICEgQSAhIGEAYSBhAIEAgQCBAKDgoODA4MDgwMDgwODA4KEAwQCBIKEggSCBQIFAYUBBQEFgQWAhYCGAANT78EFis0EwYANBIYLgC0ARcsMRQFADERGS0AswELogHtAhcuNxA3DRkvALMBGjE6ETYSGDIAtAE=",
  "9":"BgABAsYBpASeBBcFFQUXAxUDFQEVABMCFQITBBMEEwYRBhMGDwgRCg8KDwoNDA0OCwwNDgkQCRAJEAcSBxIFEgUSAxQBFAEUARYAlAICAAISAhICEgQSAhAGEgQQBhIGEAgSCA4IEAoOChAMDAwODAwODA4MEAoOChAKEAgSCBIIFAYUBBQGFgIYBBgCGgAWABYBFAEWAxQDEgUUBRIHEgcQCRIJEAkOCw4LDgsODQwNDA0MDwoPCg8IDwgRCBEGEQYRBhEEEQITAhECEwARAOEFAA8BEQEPAREDDwMPBREFDwUPBw8JDwcNCQ8LDQsLCw0NCw0LDQsNCw8JEQkPCREHEQcTBRMFEwUTARUBFQEXABkAFwIXAhcCFQQTBhMGEQYRCA8IDwgNCg8MCwoLDAsOCQ4JDgkQBxAHEAUQBRIFEgMSAxQDFAEUAxQAFgEWABamAgAACwIJAgkCCQIHBAcEBwYFBgUGAwYDBgMGAQgBBgEIAAgABgIIAgYCBgQGBAYEBgYGBgQIBAgECAIKAgoCCgAMAJgBDUXqBC8RFS0A3wEUKzARBgAwEhYsAOABEy4xEgMA",
  ":":"BgACAWE0rAEADgIOAg4CDgQMBAoGDAYKBgoICAgKCAgIBgoGCgYKBgoEDAQKBAwECgIMAAwCDAAMAAwBCgAMAQoDDAMKAwoDCgUKBQgFCgUIBwgJBgcICQYJBgsGCQQLAg0CDQINAA0ADQENAQ0BCwMNAwkFCwUJBQkHBwcJBwUHBwkFCQUJBQkDCwMJAwsDCQELAAsBCwALAAsCCQALAgkECwQJBAkECQYJBgcGBwgJBgcKBQgHCgUKBQwFCgEOAwwBDgEOAA4BYQDqBAAOAg4CDgIOBAwECgYMBgoGCggICAoICAgGCgYKBgoGCgQMBAoEDAQKAgwADAIMAAwADAEKAAwBCgMMAwoDCgMKBQoFCAUKBQgHCAkGBwgJBgkGCwYJBAsCDQINAg0ADQANAQ0BDQELAw0DCQULBQkFCQcHBwkHBQcHCQUJBQkFCQMLAwkDCwEJAwsACwELAAsACwIJAAsECQILBAkECQQJBgkGBwYHCAkGBwoFCAcKBQoFDAUKAQ4DDAEOAQ4ADg==",
  "x":"BgABARHmAoAJMIMBNLUBNrYBMIQB1AIA9QG/BI4CvwTVAgA5hgFBwAFFxwE1fdUCAI4CwATzAcAE1AIA",
  ";":"BgACAWEslgYADgIOAg4CDgQMBAoGDAYKBgoICAgKCAgIBgoGCgYKBgoEDAQKBAwECgIMAAwCDAAMAAwBCgAMAQoDDAMKAwoDCgUKBQgFCgUIBwgJBgcICQYJBgsGCQQLAg0CDQINAA0ADQENAQ0BCwMNAwkFCwUJBQkHBwcJBwUHBwkFCQUJBQkDCwMJAwsBCQMLAAsBCwALAAsCCQALBAkCCwQJBAkECQYJBgcGBwgJBgcKBQgHCgUKBQwFCgEOAwwBDgEOAA4BYwjxBAAOAg4CDAIOBAwECgYMBgoGCggICAgICAgICgYKBgoECgQMBAoECgIMAgoCDAIKAAoADAAKAQwBCgEKAwwDCgMKBQoFCAUKBQgHBgkIBwYJBgkECwYJBAsCDQILAg0CDQADAAEAAwADAAMBAwADAAMAAwEFAAUBBwEHAQcDBwEJAwkBCwMLAwsDDQUNAw0FDwUPBREHEwUTCRMHFwkXCRezAQAgyAEJBgkGCQYHBgkIBwgFCAcKBQoFCgUMAQwDDAEOAQ4AEA==",
  "=":"BgACAQUawAUA5gHEBAAA5QHDBAABBQC5AgDsAcQEAADrAcMEAA==",
  "B":"BgABA2e2BMQLFgAUARQBFAEUAxIDEgUSBRIFEAcQBxAJDgkOCQ4LDgsMCwwNDA0KDQgNCg0IDwYPBg8GDwQRBBEEEQIRAhMAEwAHAAkABwEHAAkBCQAHAQkBCQEHAQkBCQMJAwcDCQMJAwkFBwUJAwkHCQUHBQkHCQcJBwcHBwkHBwcJBwsHCQUQBQ4FDgcOCQ4JDAkMCwoNCg0IDwgRBhMEFQQXAhcCGwDJAQEvAysFJwklDSMPHREbFRkXFRsTHw8fCyUJJwcrAy0B6wMAEhIAoAsREuYDAAiRAYEElgEAKioSSA1EOR6JAQAA0wEJkAGPBSwSEiwAzAETKikSjwEAAMUCkAEA",
  "A":"BgABAg/KBfIBqQIAN98BEhHzAgAWEuwCngsREvwCABMR8gKdCxIR8QIAFBI54AEFlwGCBk3TA6ABAE3UAwMA",
  "?":"BgACAe4BsgaYCAAZABkBFwEXBRUDEwUTBxEHEQcPCQ8JDQkNCQ0LCwsLCwsLCQsJCwcNBwsHDQcLBQsFDQULAwkFCwMLAwkDCQMBAAABAQABAAEBAQABAAEAAQABAAABAQAAAQEAEwcBAQABAAMBAwADAAUABQAFAAcABwAFAAcABwAFAgcABQAHAAUAW7cCAABcABgBFgAUAhQAFAISAhACEAIQBA4EDgQMBgwGDAYMBgoICgYKCAgKCggICAgKBgoICgYMCAwGDAgOBg4GEAYQBgIAAgIEAAICBAACAgQCBAIKBAoGCAQKBggIBgYICAYIBggGCgQIBAoECAQKAggCCgIKAAgACgAKAAgBCAEKAwgDCAMIAwgFBgMIBQYHBAUGBQQFBAcCBQQHAgcCCQIHAgkCBwAJAgkACQAJAAkBCQAJAQsACQELAQsDCwELAwsDCwMLAwsDCwULAwsFCwMLBV2YAgYECAQKBAwGDAQMBhAIEAYSBhIIEgYUBhIEFgYUBBYEFgQWAhgCFgIYABYAGAAYARgBGAMWBRYHFgcWCRYLFA0IBQYDCAUIBwYFCAcGBwgHBgcICQYJCAkGCQYJCAsGCwYLBgsGDQYNBA0GDQQNBA8EDwQPAg8EEQIRAhEAEQITAWGpBesGAA4CDgIOAg4EDAQKBgwGCgYKCAgICggICAYKBgoGCgYKBAwECgQMBAoCDAAMAgwADAAMAQoADAEKAwwDCgMKAwoFCgUIBQoFCAcICQYHCAkGCQYLBgkECwINAg0CDQANAA0BDQENAQsDDQMJBQsFCQUJBwcHCQcFBwcJBQkFCQUJAwsDCQMLAwkBCwALAQsACwALAgkACwIJBAsECQQJBAkGCQYHBgcICQYHCgUIBwoFCgUMBQoBDgMMAQ4BDgAO",
  "C":"BgABAWmmA4ADAAUCBQAFAgUEBQIDBAUEAwQDBgMEAQYDBgEGAAgBBgDWAgAAwQLVAgATABMCEQITBBEEEQQRBhEIEQgPCA8KDwoNCg0MDQwNDAsOCw4LDgkOCxAHEAkQBxIHEgUSBRIDEgEUARIBFAAUAMIFABQCFAISBBQEEgQSBhIIEggSCBAKEAoQCg4MDgwODA4ODA4MDgwQDA4KEggQChIIEggSBhIGFAQSAhQCEgIUAMYCAADBAsUCAAUABwEFAAUBBQMDAQUDAwMDAwMFAQMDBQEFAAUBBwAFAMEF",
  "L":"BgABAQmcBhISEdkFABIQALQLwgIAAIEJ9AIAAK8C",
  "D":"BgABAkeyBMQLFAAUARIBFAESAxIDEgMSBRIFEAcQBxAHDgkOCQ4LDgsMCwwNDA0KDwoPCg8IDwgRCBEGEwQTBBMEEwIVAhUAFwDBBQAXARcBFwMTAxUDEwUTBxEHEQcPCQ8JDwkNCw0LCwsLDQsNCQ0JDQcPBw8HDwcRBREFEQMRAxEDEwERARMBEwDfAwASEgCgCxES4AMACT6BAxEuKxKLAQAAvwaMAQAsEhIsAMIF",
  "F":"BgABARGABoIJ2QIAAIECsgIAEhIA4QIRErECAACvBBIR5QIAEhIAsgucBQASEgDlAhES",
  "E":"BgABARRkxAuWBQAQEgDlAhES0QIAAP0BtgIAEhIA5wIRFLUCAAD/AfACABISAOUCERLDBQASEgCyCw==",
  "G":"BgABAZsBjgeIAgMNBQ8FDQUNBQ0HCwcNBwsHCwkLCQsJCwsJCwsLCQsJDQkLBw0HDwcNBw8FDwUPAw8DEQMPAxEBEQERARMBEQAXABUCFwIVAhMEFQQTBhMGEwYRCBEIDwoRCg8KDwwNDA0MDQ4LDgkQCRAJEAcQBxIFEgUUBRQDFAMUARYBFgEYAMoFABQCFAASBBQCEgQSBBIEEgYSBhAGEAgQCBAKDgoOCg4MDgwMDgwOChAKEAoSCBIIFAgUBhQEGAYWAhgEGAIaAOoCAAC3AukCAAcABwEFAQUBBQMFAwMFAwUDBQEFAQcBBQEFAQUABwAFAMUFAAUCBwIFAgUCBQQFBAMGBQYDBgUGAwgDBgMIAQgDCAEIAQoBCAEIAAgACgAIAAgCCAIIAggECgQGBAgECAYIBgC6AnEAAJwCmAMAAJcF",
  "H":"BgABARbSB7ILAQAAnwsSEeUCABISAOAE5QEAAN8EEhHlAgASEgCiCxEQ5gIAEREA/QPmAQAAgAQPEOYCABER",
  "I":"BgABAQmuA7ILAJ8LFBHtAgAUEgCgCxMS7gIAExE=",
  "J":"BgABAWuqB7ILALEIABEBEwERAREDEwMRAxEFEQURBw8HEQcPCQ0LDwsNCw0NDQ0LDwsPCxEJEQkTCRMJFQcVBxcFFwMZAxsBGwEbAB8AHQIbAhsEGQYXBhcGFQgTCBMKEwoRDA8KDwwNDA0OCw4LDgkQCRAJEAcQBRIFEgUSAxQDEgESARIBFAESABIAgAEREtoCABERAn8ACQIHBAcEBwYHBgUIBQoDCgMKAwoDDAEKAQwBCgEMAAwACgAMAgoCDAIKBAoECgYKBggGBgYGCAQGBAgCCgAIALIIERLmAgAREQ==",
  "M":"BgACAQRm1gsUABMAAAABE5wIAQDBCxIR5QIAEhIA6gIK5gLVAe0B1wHuAQztAgDhAhIR5QIAEhIAxAsUAPoDtwT4A7YEFgA=",
  "K":"BgABAVXMCRoLBQsDCQMLAwsDCwMLAwsBCwELAQsBCwELAQ0ACwELAAsADQALAg0ACwILAA0CCwILAgsCDQQLBAsECwYNBAsGCwYLCAsGCwgJCgsICQoJCgkMCQwJDAkOCRALEAkQCRKZAdICUQAAiwQSEecCABQSAKALExLoAgAREQC3BEIA+AG4BAEAERKCAwAREdkCzQXGAYUDCA0KDQgJCgkMBwoFDAUMAQwBDgAMAg4CDAQOBAwGDghmlQI=",
  "O":"BgABAoMBsATaCxwAHAEaARoDGgMYBRYFFgcWBxQJEgkSCRILEAsODQ4NDg0MDwoNDA8KDwgPCBEIDwYRBg8GEQQRAhMCEQITABMA0QUAEQETAREBEQMTBREFEQURBxEHDwcRCQ8LDQsPCw0NDQ0NDwsPCw8LEQkTCRMJEwkVBxUHFwUXAxkDGQEbARsAGwAZAhkCGQQXBhcGFQYVCBUIEwoRChEMEQoRDA8MDQ4NDg0OCxAJEAsQCRAHEgcSBxIFFAMSAxIDEgEUARIAEgDSBQASAhQCEgISBBIEEgYSBhIIEggQCBAKEgwODBAMEA4ODg4QDhIMEAwSChQKFAgUCBYIFgYYBBoGGgQcAh4CHgILggGLAylCWxZbFSlBANEFKklcGVwYKkwA0gU=",
  "N":"BgABAQ+YA/oEAOUEEhHVAgASEgC+CxQAwATnBQDIBRMS2AIAExEAzQsRAL8ElgU=",
  "P":"BgABAkqoB5AGABcBFQEVAxMDEwMTBREHEQcRBw8JDwkNCQ0LDQsNCwsNCw0JDQkNCQ8HDwcPBxEFEQURAxEDEQMTAREBEwETAH8AAIMDEhHlAgASEgCgCxES1AMAFAAUARIAFAESAxIDEgMSAxIFEAUQBRAHDgkOCQ4JDgsMCwwNDA0KDQoNCg8IDwgRCBEGEwQTBBUEFQIXAhkAGQCzAgnBAsoCESwrEn8AANUDgAEALBISLgDYAg==",
  "R":"BgABAj9msgsREvYDABQAFAESARQBEgESAxIDEgUSBRAFEAcQBw4JDgkOCQ4LDAsMDQwLCg0KDwoNCA8IDwgPBhEEEwYTAhMEFQIXABcAowIAEwEVARMDEwMTBRMFEQcTBxELEQsRDQ8PDREPEQ0VC8QB/QMSEfkCABQSiQGyA3EAALEDFBHnAgASEgCgCwnCAscFogEALhISLACqAhEsLRKhAQAApQM=",
  "Q":"BgABA4YBvAniAbkB8wGZAYABBQUFAwUFBQUHBQUDBwUFBQcFBQMHBQcDBwUJAwcDCQMJAwkDCQMJAQsDCwMLAQsDCwENAw0BDQEPAA8BDwAPABsAGwIZAhcEGQQXBBUGFQgVCBMIEQoTChEKDwwPDA8ODQ4NDgsQCxAJEAkQBxIHEgUSBRQFFAMUARQDFAEWABYAxgUAEgIUAhICEgQSBBIGEgYSCBIIEAgQChIMDgwQDBAODg4OEA4SDBAMEgoUChQIFAgWCBYGGAQaBhoEHAIeAh4CHAAcARoBGgMaAxgFFgUWBxYHFAkSCRIJEgsQCw4NDg0ODQwPCg0MDwoPCA8IEQgPBhEGDwYRBBECEwIRAhMAEwC7BdgBrwEImQSyAwC6AylAWxZbFSk/AP0BjAK7AQeLAoMCGEc4J0wHVBbvAaYBAEM=",
  "S":"BgABAYMC8gOEBxIFEgUQBxIFEgcSBxIJEgcSCRIJEAkQCRALEAsOCw4NDg0MDQ4PDA0KEQoPChEKEQgRCBMGFQQTBBcCFQAXABkBEwARAREBEQMPAQ8DDwMPAw0DDQUNAw0FCwULBwsFCwUJBwsFCQcHBQkHCQUHBwcHBwUHBwUFBQcHBwUHAwcFEQsRCxMJEwkTBxMFEwUVBRUDFQMVARMBFwEVABUAFQIVAhUCFQQVBBUEEwYVBhMIEwgTCBMIEwgRCBMKEQgRCmK6AgwFDgUMAw4FEAUOBRAFEAUQBRAFEAMSAw4DEAMQAxABEAEOAQ4AEAIMAg4CDgQMBAwGCggKCAoKBgwGDgYQBBACCgAMAAoBCAMKBQgFCAcIBwgJCAsGCQgLCA0IDQgNCA8IDQgPCA8IDwgPChEIDwgPCBEKDwoPDBEMDwwPDg8ODw4NEA0QCxALEgsSCRIHEgcUBRQFGAUYAxgBGgEcAR4CJAYkBiAIIAweDBwQHBAYEhgUFBYUFhQWEBoQGg4aDBwKHAoeBh4GIAQgAiACIgEiASIFIgUiBSAJIgkgCyINZ58CBwQJAgkECwQLAgsECwINBA0CDQQNAg0CDQALAg0ADQANAAsBCwELAQsDCwULBQkFCQcHBwcJBwkFCwMLAw0BDQENAAsCCwQLBAkGCQgJCAkKBwoJCgcMBQoHDAcMBQwF",
  "V":"BgABARG2BM4DXrYEbKwDERL0AgAVEesCnQsSEfsCABQS8QKeCxES8gIAExFuqwNgtQQEAA==",
  "T":"BgABAQskxAv0BgAAtQKVAgAA+wgSEeUCABISAPwImwIAALYC",
  "U":"BgABAW76B7ALAKMIABcBFwMXARUFFQUTBxMHEwkRCREJEQsPDQ0LDw0NDwsPCw8LEQkPCRMJEQcTBxMFEwUVBRUDEwMXARUBFQEXABUAEwIVAhMCFQQTBBUEEwYTBhMIEwgRChEIEQwRDA8MDw4PDg0OCxANEAsSCRIJEgcUBxQHFAMWBRYBGAEYARgApggBAREU9AIAExMAAgClCAALAgkECQQHBAcIBwgHCAUKBQoDCgMKAwwBCgEMAQwADAAMAgoCDAIKAgoECgQKBggGCAYICAYKBAgCCgIMAgwApggAARMU9AIAExM=",
  "X":"BgABARmsCBISEYkDABQSS54BWYICXYkCRZUBEhGJAwAUEtYCzgXVAtIFExKIAwATEVClAVj3AVb0AVKqAREShgMAERHXAtEF2ALNBQ==",
  "W":"BgABARuODcQLERHpAp8LFBHlAgASEnW8A2+7AxIR6wIAFBKNA6ALERKSAwATEdQB7wZigARZ8AIREugCAA8RaKsDYsMDXsoDaqYDExLqAgA=",
  "Y":"BgABARK4BcQLhgMAERHnAvMGAKsEEhHnAgAUEgCsBOkC9AYREoYDABERWOEBUJsCUqICVtwBERI=",
  "Z":"BgABAQmAB8QLnwOBCaADAADBAusGAMgDggmhAwAAwgLGBgA=",
  "`":"BgABAQfqAd4JkQHmAQAOlgJCiAGpAgALiwIA",
  "c":"BgABAW3UA84GBQAFAQUABQEFAwMBBQMDAwMDAwUBAwMFAQUABQEHAAUAnQMABQIFAAUCBQQFAgMEBQQDBAMGAwQBBgMGAQYABgEGAPABABoMAMsCGw7tAQATABMCEwARAhMEEQIPBBEEDwQPBg8IDwYNCA0KDQoNCgsMCwwLDAkOCRAHDgcQBxIFEgUUBRQDFAEWAxgBGAAYAKQDABQCFAISBBQCEgYSBhAGEggQCBAIEAoQCg4MDAwODAwODAwKDgwQCg4IEAgQCBAIEAYSBhIGEgQSAhQCFAIUAOABABwOAM0CGQzbAQA=",
  "a":"BgABApoB8AYCxwF+BwkHCQcJCQkHBwkHBwcJBQkFBwUJBQkFCQMHBQkDCQMJAwcDCQEHAQkBBwEJAQcABwAHAQcABQAHAAUBBQAFABMAEwITAhEEEwQPBBEGDwgPCA0IDwoLCg0KCwwLDAsMCQ4JDgkOBw4HEAcQBRAFEAUSAxADEgESAxIBFAESABQAFAISAhQCEgQSBBIEEgYSBhIIEAgQChAIDgwODA4MDg4MDgwODBAMEAoSCBIKEggUCBQGFgYWBBgEGAIaAhoAcgAADgEMAQoBCgEIAwgDBgUEBQQFBAcCBwIHAgkCCQAJAKsCABcPAMwCHAvCAgAUABYBEgAUARIDFAMQAxIDEAUSBQ4FEAcOCRAJDAkOCwwLDA0MCwoNCg8IDwgPCA8GEQYRBhMEEwIXAhUCFwAZAIMGFwAKmQLqA38ATxchQwgnGiMwD1AMUDYAdg==",
  "b":"BgABAkqmBIIJGAAYARYBFgEUAxQDEgUSBRIFEAcQCQ4HDgkOCw4LDAsMDQoNCg0KDQgPBg8GDwYRBBEEEQQTBBECEwIVAhMAFQD/AgAZARcBFwEXAxUDEwUTBREFEQcPBw8JDwkNCQ0LDQsLCwsNCQ0JDQcPBw8HDwURAxEDEQMTAxMBEwMVARUAFQHPAwAUEgCWCxEY5gIAERkAowKCAQAJOvECESwrEn8AAJsEgAEALBISLgCeAw==",
  "d":"BgABAkryBgDLAXAREQ8NEQ0PDREJDwkRBw8FDwURAw8DDwERAw8BEQEPACMCHwQfCB0MGw4bEhcUFxgVGhEeDSANJAkmBSgDKgEuAIADABYCFAIUAhQCFAQUBBIGEgYSBhAIEAgQCBAKDgoODAwMDAwMDgoOCg4KEAgQCBIGEgYSBhQEFgQWBBYCGAIYAHwAAKQCERrmAgARFwCnCxcADOsCugJGMgDmA3sAKxERLQCfAwolHBUmBSQKBAA=",
  "e":"BgABAqMBigP+AgAJAgkCCQQHBAcGBwYFCAUIBQgDCgMIAQoDCAEKAQoACgAKAAoCCAIKAggECgQIBAgGCAYGBgQIBAoECAIKAAyiAgAAGQEXARcBFwMVBRMFEwURBxEHDwcPCQ8LDQkNCwsNCw0LDQkNBw8JDwcPBQ8FEQURAxEDEwMTAxMBFQAVARcALwIrBCkIJwwlDiESHxQbGBkaFR4TIA0iCyQJKAMqASwAggMAFAIUABIEFAISBBIEEgQSBhIGEAgQCBAIEAoODA4MDgwODgwQDBAKEAoSChIIFAgUCBYGGAQYBhoCGgQcAh4ALgEqAygFJgkkDSANHhEaFRgXFBsSHQ4fDCUIJwQpAi0AGQEXAxcDFQcTBRMJEQkPCw8LDQ0PDQsNDQ8LEQsRCxEJEwkTCRMJEwcTBxUHFQUVBRUHFQUVBRUHFwcVBRUHCs4BkAMfOEUURxEfMwBvbBhAGBwaBiA=",
  "h":"BgABAUHYBJAGAAYBBgAGAQYDBgEEAwYDBAMEBQQDAgUEBQIFAAUCBQB1AAC5BhIT5wIAFhQAlAsRGOYCABEZAKMCeAAYABgBFgEWARQDFAMSBRIFEgUQBxAJDgcOCQ4LDgsMCwwNCg0KDQoNCA8GDwYPBhEEEQQRBBMEEQITAhUCEwAVAO0FFhPnAgAUEgD+BQ==",
  "g":"BgABArkBkAeACQCNCw8ZERkRFxEVExMVERUPFQ8XDRcLGQkZBxsFGwUdAR0BDQALAA0ADQINAAsCDQANAg0CDQILAg0EDQINBA0GDQQNBg0EDQYNCA0GDwgNCA0IDQgPCg0KDwwNDA8MDw4PDqIB7gEQDRALEAkQCQ4JEAcOBw4FDgUOAwwFDgMMAQwBDAEMAQwACgEKAAoACAIIAAgCCAIGAggCBgIGBAYCBgQEAgYEAqIBAQADAAEBAwADAAMABQADAAUAAwAFAAMABQAFAAMABQA3ABMAEwIRAhMCEQQRBBEEEQYRBg8IDwgPCA0KDQoNCg0MCwwLDgsOCQ4JDgkQBxAHEgcSBRIDFAMWAxQBFgEYABgA/gIAFgIWAhQEFgQUBBIGFAgSCBIIEAoSChAKDgwODA4MDg4MDgwODA4KEAgQCBAIEgYSBhIEEgYSBBQCEgIUAhQCOgAQABABDgEQAQ4BEAMOAw4FDgUOBQwFDgcMBQ4HDAkMB4oBUBgACbsCzQYAnAR/AC0RES0AnQMSKy4RgAEA",
  "f":"BgABAUH8A6QJBwAHAAUABwEFAQcBBQEFAwUDBQMDAwMDAwUDAwMFAQUAwQHCAQAWEgDZAhUUwQEAAOMEFhftAgAWFADKCQoSChIKEAoQCg4KDgwOCgwMDAoKDAwMCgwIDAgMCAwIDAYOCAwEDgYMBA4GDAIOBA4CDgQOAg4CDgAOAg4ADgC2AQAcDgDRAhkQowEA",
  "i":"BgACAQlQABISALoIERLqAgAREQC5CBIR6QIAAWELyAoADgIOAgwEDgIKBgwGCgYKCAoGCAgICggIBggGCgYKBAoECgQMBAoCDAIMAgwCDAAMAAwADAEMAQoBDAMKAwoDCgUKBQgFCgUIBwgHCAcICQgJBgkECwQJBA0CCwANAA0ADQELAQ0BCwMJBQsFCQUJBwkFBwcHBwcJBQcFCQUJBQkDCQMLAwkBCwELAQsACwALAAsCCwILAgkCCwIJBAkECQQJBgcGCQYHCAcIBwgHCgUKBQwFCgMMAQwBDgEMAA4=",
  "j":"BgACAWFKyAoADgIOAgwEDgIKBgwGCgYKCAoGCAgICggIBggGCgYKBAoECgQMBAoCDAIMAgwCDAAMAAwADAEMAQoBDAMKAwoDCgUKBQgFCgUIBwgHCAcICQgJBgkECwQJBA0CCwANAA0ADQELAQ0BCwMJBQsFCQUJBwkFBwcHBwcJBQcFCQUJBQkDCQMLAwkBCwELAQsACwALAAsCCwILAgkCCwIJBAkECQQJBgcGCQYHCAcIBwgHCgUKBQwFCgMMAQwBDgEMAA4BO+YCnwwJEQkRCQ8JDwsNCQ0LDQkLCwsJCQsLCQkLBwsHCwcLBwsFCwcNAwsFDQMLBQ0BDQMNAQ0DDQENAQ0ADQENAA0AVwAbDQDSAhoPQgAIAAgABgAIAgYCCAIGAgYEBgQGBAQEBAQEBgQEBAYCBgC4CRES6gIAEREAowo=",
  "k":"BgABARKoA/QFIAC0AYoD5gIAjwK5BJICwwTfAgDDAbIDFwAAnwMSEeUCABISAJILERLmAgAREQCvBQ==",
  "n":"BgABAW1yggmQAU8GBAgEBgQGBgYCCAQGBAYEBgQIAgYECAQGAggEBgIIBAgCCAQIAggCCAIIAgoACAIKAAgCCgAKAgoADAAKAgwAFgAWARQAFAEUAxQDFAMSAxIFEgUQBRIHEAkOBxAJDgsOCwwLDA0MDQoPCA8IEQgRBhEGEwYVBBUEFQIXAhkCGQDtBRQR5QIAFBAA/AUACAEIAQYBCAMGBQQFBgUEBwQFBAcCBwIHAgcCCQIHAAcACQAHAQcABwMHAQUDBwMFAwUFBQUDBQEFAwcBBwAHAPkFEhHjAgASEgDwCBAA",
  "m":"BgABAZoBfoIJigFbDAwMCg4KDggOCA4IDgYQBhAGEAQQBBAEEAISAhACEgAmASQDJAciCyANHhEcFRwXDg4QDBAKEAwQCBAKEggSBhIGEgYSBBQEEgIUAhICFAAUABQBEgEUARIDEgMSAxIFEgUQBxAHEAcQBw4JDgkOCw4LDAsMDQoNCg8KDwgPCBEIEQYRBBMEEwQTAhMCFQAVAP0FEhHlAgASEgCCBgAIAQgBBgEGAwYFBgUEBQQHBAUEBwIHAgcCBwIJAAcABwAJAAcBBwEHAQUBBwMFAwUDBQMDBQMFAwUBBQEHAQcAgQYSEeUCABISAIIGAAgBCAEGAQYDBgUGBQQFBAcEBQQHAgcCBwIHAgkABwAHAAkABwEHAQcBBQEHAwUDBQMFAwMFAwUDBQEFAQcBBwCBBhIR5QIAEhIA8AgYAA==",
  "l":"BgABAQnAAwDrAgASFgDWCxEa6gIAERkA0wsUFw==",
  "y":"BgABAZ8BogeNAg8ZERkRFxEVExMVERUPFQ8XDRcLGQkZBxsFGwUdAR0BDQALAA0ADQINAAsCDQANAg0CDQILAg0EDQINBA0GDQQNBg0EDQYNCA0GDwgNCA0IDQgPCg0KDwwNDA8MDw4PDqIB7gEQDRALEAkQCQ4JEAcOBw4FDgUOAwwFDgMMAQwBDAEMAQwACgEKAAoACAIIAAgCCAIGAggCBgIGBAYCBgQEAgYEAqIBAQADAAEBAwADAAMABQADAAUAAwAFAAMABQAFAAMABQA3ABMAEwIRABECEwQRAg8EEQQPBBEGDwgNCA8IDQgNCg0MDQwLDAkOCw4JDgcQBxAHEgUSBRQFFAMWARgDGAEaABwA9AUTEuQCABEPAP8FAAUCBQAFAgUEBQIDBAUEAwQDBgMEAQYDBgEGAAgBBgCAAQAAvAYREuICABMPAP0K",
  "q":"BgABAmj0A4YJFgAWARQAEgESAxADEAMOAw4FDgUMBQ4HDgcOBwwJDgmeAU4A2QwWGesCABYaAN4DAwADAAMBAwADAAUAAwADAAMABQAFAAUABwAHAQcACQAVABUCFQATAhUCEwQRAhMEEQQRBhEGDwgPCA8IDQoNDA0MCwwLDgkOCRAJEAkQBxIHEgUUBRYDFgMYARoBGgAcAP4CABYCFgIWBBYEFAQSBhQIEggSCBAKEgoQDA4MDgwODg4ODBAMDgwQChIIEAoSCBIGEgYUBhQEFAQWAhYCFgIWAApbkQYSKy4ReAAAjARTEjkRHykJMwDvAg==",
  "p":"BgABAmiCBIYJFgAWARYBFAEWAxQDEgUUBRIFEgcSBxAJEAkQCQ4LDgsOCwwNDA0KDwoPCg8IEQgRCBEGEwQTBhMCFQQVAhUAFQD9AgAbARkBFwMXAxcDEwUTBxMHEQcRCQ8JDQsNCw0LCw0LDQkPCQ0JDwURBxEFEQURAxMDEQMTARUBEwEVARUBFQAJAAcABwAFAAcABQAFAAMAAwADAAUAAwIDAAMAAwIDAADdAxYZ6wIAFhoA2gyeAU0OCgwIDgoMCA4GDgYMBg4GDgQQBBAEEgQUAhQCFgIWAApcoQMJNB8qNxJVEQCLBHgALhISLADwAg==",
  "o":"BgABAoMB8gOICRYAFgEWARQBFgMUAxIDFAUSBRIHEgcQBxAJEAkOCw4LDgsMDQwNCg8KDwoPCg8IEQgRBhMGEwQTBBMCFQIVABcAiwMAFwEVARUDEwMTAxMFEwcRBxEHDwkPCQ8LDQsNCw0NCw0LDwkNCw8HEQkPBxEHEQcRBRMFEwMTAxUDFQEVABUAFQAVAhUCFQITBBMEEwYTBhEGEQgRCA8KDwoPCg0KDQwNDAsOCw4JDgkQCRAJEgcSBxIFFAUUAxQDFgEWARYAFgCMAwAYAhYCFgQUBBQEFAYUCBIIEggQChAKEAwODA4MDg4MDgwQCg4KEgoQChIIEggSBhQGEgYUBBYEFAIWAhYCFgALYv0CHTZBFEMRHTcAjwMcNUITQhIiOACQAw==",
  "r":"BgACAQRigAkQAA8AAAABShAAhAFXDAwODAwKDgoOCBAIDgYQBhAEEAQQBBAEEAISABACEAAQAA4BEAAQARADEAEQAxADEAUSBRIHFAcUCxQLFA0WDVJFsQHzAQsMDQwLCgkICwgLCAkGCQYJBAkGBwIJBAcCBwQHAAcCBwAFAgcABQAHAQUABQEFAQUBBQEDAQUBAwMDAQMDAwEAmwYSEeMCABISAO4IEAA=",
  "u":"BgABAV2KBwGPAVANCQsHDQcNBw0FCwUNBQ0FDQMPAw8DEQMTARMBFQEVABUAFQITABMEEwITBBMEEQQRBhEGDwYRCA8KDQgPCg0MDQwLDAsOCRALDgcQBxIHEgUUBRQFFAMWAxgBGAEYARoA7gUTEuYCABMPAPsFAAcCBwIFBAcCBQYDBgUGAwgDBgMIAQgBCAEIAQoBCAAIAAoACAIIAggCCAIGBAgEBgQGBgYGBAYCBgQIAggACAD6BRES5AIAEREA7wgPAA==",
  "s":"BgABAasC/gLwBQoDCgMMBQ4DDgUOBRAFEAUSBRAHEgcQCRIJEAkSCxALEAsQDRANDg0ODw4PDA8MDwoRChEIEwYTBBcCFQIXABkBGQEXAxcFFQUTBRMHEwcRCREJDwkNCQ8LDQ0LCwsNCw0JDQkPBw8HDwUPBREDEQMRAREDEQETABEBEwARABMADwIRABECEQIRBBMCEwQVBBUEFQYVBhMIFwgVChUKFQxgsAIIAwYDCAMKAQgDCAMKAQoDCgEKAwoBCgMKAQwDCgEKAwoBDAMKAQoBCgEMAQoACgEKAAoBCgAKAQgACgAIAQgABgoECAIKAgoCCgAMAQoBDAUEBwIHBAcEBwIHBAkECQQJBAkECQYLBAkGCwYJBgsGCwYJCAsGCwgJBgsICQgLCAkICwgJCgkKCQoJCgcKCQwHDAcMBwwFDAcMAw4FDAMOAw4BDgMQARAAEAESABIAEgIQAg4CDgIOBA4CDgQMBAwEDAQMBgoECgYKBgoGCgYIBggGCAgIBggGBgYIBgYGBgYGBgYGBAgGBgQIBAYECAQQChIIEggSBhIEEgQSBBQCFAISABQAEgASABIAEgESARIBEAEQAxIDDgMQAxADDgUOBQwDDAMMAwoDCAMIAQYBe6cCAwIDAgUAAwIFAgUCBwIFAgcCBQIHAgUCBwIHAAUCBwIHAgUABwIHAgcABQIHAAcCBwAFAgUABQIFAAUABQIDAAEAAQABAQEAAQEBAQEBAQEBAQEDAQEAAwEBAQMAAwEDAAMBAwADAQMAAwABAQMAAwADAAEAAwIBAAMCAQQDAgE=",
  "t":"BgABAUe8BLACWAAaEADRAhsOaQANAA0ADwINAA0CDQANAg0CDQINBA0CCwYNBA0GCwYNBgsIDQgLCAsKCwgJDAsKCQwJDAkOCQ4HEAcSBxIHEgUUAOAEawAVEQDWAhYTbAAAygIVFOYCABUXAMUCogEAFhQA1QIVEqEBAADzAwIFBAMEBQQDBAMEAwYDBgMGAwYBCAEGAQgBBgEIAAgA",
  "w":"BgABARz8BsAEINYCKNgBERLuAgARD+8B3QgSEc0CABQSW7YCV7UCFBHJAgASEpMC3AgREvACABERmAHxBDDaAVeYAxES7gIAEREo1QE81wIIAA==",
  "z":"BgABAQ6cA9AGuQIAFw8AzAIaC9QFAAAr9wKjBuACABYQAMsCGQyZBgCaA9AG"
   }';
BEGIN

  IF font IS NULL THEN
    font := font_default;
  END IF;

  -- For character spacing, use m as guide size
  geom := ST_GeomFromTWKB(decode(font->>'m', 'base64'));
  m_width := ST_XMax(geom) - ST_XMin(geom);
  spacing := m_width / 12;

  letterarray := regexp_split_to_array(replace(letters, ' ', E'\t'), E'');
  FOREACH letter IN ARRAY letterarray
  LOOP
    geom := ST_GeomFromTWKB(decode(font->>(letter), 'base64'));
    -- Chars are not already zeroed out, so do it now
    geom := ST_Translate(geom, -1 * ST_XMin(geom), 0.0);
    -- unknown characters are treated as spaces
    IF geom IS NULL THEN
      -- spaces are a "quarter m" in width
      width := m_width / 3.5;
    ELSE
      width := (ST_XMax(geom) - ST_XMin(geom));
    END IF;
    geom := ST_Translate(geom, position, 0.0);
    -- Tighten up spacing when characters have a large gap
    -- between them like Yo or To
    adjustment := 0.0;
    IF prevgeom IS NOT NULL AND geom IS NOT NULL THEN
      dist = ST_Distance(prevgeom, geom);
      IF dist > spacing THEN
        adjustment = spacing - dist;
        geom := ST_Translate(geom, adjustment, 0.0);
      END IF;
    END IF;
    prevgeom := geom;
    position := position + width + spacing + adjustment;
    wordarr := array_append(wordarr, geom);
  END LOOP;
  -- apply the start point and scaling options
  wordgeom := ST_CollectionExtract(ST_Collect(wordarr));
  wordgeom := ST_Scale(wordgeom,
                text_height/font_default_height,
                text_height/font_default_height);
  return wordgeom;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.st_linecrossingdirection(line1 geometry, line2 geometry)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$ST_LineCrossingDirection$function$
;

CREATE OR REPLACE FUNCTION public.st_lineextend(geom geometry, distance_forward double precision, distance_backward double precision DEFAULT 0.0)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$geometry_line_extend$function$
;

CREATE OR REPLACE FUNCTION public.st_linefromencodedpolyline(txtin text, nprecision integer DEFAULT 5)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$line_from_encoded_polyline$function$
;

CREATE OR REPLACE FUNCTION public.st_linefrommultipoint(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_line_from_mpoint$function$
;

CREATE OR REPLACE FUNCTION public.st_linefromtext(text, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromText($1, $2)) = 'LINESTRING'
	THEN public.ST_GeomFromText($1,$2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_linefromtext(text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromText($1)) = 'LINESTRING'
	THEN public.ST_GeomFromText($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_linefromwkb(bytea)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1)) = 'LINESTRING'
	THEN public.ST_GeomFromWKB($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_linefromwkb(bytea, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1, $2)) = 'LINESTRING'
	THEN public.ST_GeomFromWKB($1, $2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_lineinterpolatepoint(geometry, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_line_interpolate_point$function$
;

CREATE OR REPLACE FUNCTION public.st_lineinterpolatepoint(geography, double precision, use_spheroid boolean DEFAULT true)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_line_interpolate_point$function$
;

CREATE OR REPLACE FUNCTION public.st_lineinterpolatepoint(text, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_LineInterpolatePoint($1::public.geometry, $2);  $function$
;

CREATE OR REPLACE FUNCTION public.st_lineinterpolatepoints(text, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_LineInterpolatePoints($1::public.geometry, $2);  $function$
;

CREATE OR REPLACE FUNCTION public.st_lineinterpolatepoints(geography, double precision, use_spheroid boolean DEFAULT true, repeat boolean DEFAULT true)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_line_interpolate_point$function$
;

CREATE OR REPLACE FUNCTION public.st_lineinterpolatepoints(geometry, double precision, repeat boolean DEFAULT true)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_line_interpolate_point$function$
;

CREATE OR REPLACE FUNCTION public.st_linelocatepoint(geography, geography, use_spheroid boolean DEFAULT true)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_line_locate_point$function$
;

CREATE OR REPLACE FUNCTION public.st_linelocatepoint(text, text)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_LineLocatePoint($1::public.geometry, $2::public.geometry);  $function$
;

CREATE OR REPLACE FUNCTION public.st_linelocatepoint(geom1 geometry, geom2 geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_line_locate_point$function$
;

CREATE OR REPLACE FUNCTION public.st_linemerge(geometry, boolean)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$linemerge$function$
;

CREATE OR REPLACE FUNCTION public.st_linemerge(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$linemerge$function$
;

CREATE OR REPLACE FUNCTION public.st_linestringfromwkb(bytea, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1, $2)) = 'LINESTRING'
	THEN public.ST_GeomFromWKB($1, $2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_linestringfromwkb(bytea)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1)) = 'LINESTRING'
	THEN public.ST_GeomFromWKB($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_linesubstring(text, double precision, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_LineSubstring($1::public.geometry, $2, $3);  $function$
;

CREATE OR REPLACE FUNCTION public.st_linesubstring(geometry, double precision, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_line_substring$function$
;

CREATE OR REPLACE FUNCTION public.st_linesubstring(geography, double precision, double precision)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_line_substring$function$
;

CREATE OR REPLACE FUNCTION public.st_linetocurve(geometry geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$LWGEOM_line_desegmentize$function$
;

CREATE OR REPLACE FUNCTION public.st_locatealong(geometry geometry, measure double precision, leftrightoffset double precision DEFAULT 0.0)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_LocateAlong$function$
;

CREATE OR REPLACE FUNCTION public.st_locatebetween(geometry geometry, frommeasure double precision, tomeasure double precision, leftrightoffset double precision DEFAULT 0.0)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_LocateBetween$function$
;

CREATE OR REPLACE FUNCTION public.st_locatebetweenelevations(geometry geometry, fromelevation double precision, toelevation double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_LocateBetweenElevations$function$
;

CREATE OR REPLACE FUNCTION public.st_longestline(geom1 geometry, geom2 geometry)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS $function$SELECT public._ST_LongestLine(public.ST_ConvexHull($1), public.ST_ConvexHull($2))$function$
;

CREATE OR REPLACE FUNCTION public.st_m(geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_m_point$function$
;

CREATE OR REPLACE FUNCTION public.st_makebox2d(geom1 geometry, geom2 geometry)
 RETURNS box2d
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$BOX2D_construct$function$
;

CREATE OR REPLACE FUNCTION public.st_makeemptycoverage(tilewidth integer, tileheight integer, width integer, height integer, upperleftx double precision, upperlefty double precision, scalex double precision, scaley double precision, skewx double precision, skewy double precision, srid integer DEFAULT 0)
 RETURNS SETOF raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
    DECLARE
        ulx double precision;  -- upper left x of raster
        uly double precision;  -- upper left y of raster
        rw int;                -- raster width (may change at edges)
        rh int;                -- raster height (may change at edges)
        x int;                 -- x index of coverage
        y int;                 -- y index of coverage
        template public.raster;       -- an empty template raster, where each cell
                               -- represents a tile in the coverage
        minY double precision;
        maxX double precision;
    BEGIN
        template := public.ST_MakeEmptyRaster(
            ceil(width::float8/tilewidth)::int,
            ceil(height::float8/tileheight)::int,
            upperleftx,
            upperlefty,
            tilewidth * scalex,
            tileheight * scaley,
            tileheight * skewx,
            tilewidth * skewy,
            srid
        );

        FOR y IN 1..st_height(template) LOOP
            maxX := public.ST_RasterToWorldCoordX(template, 1, y) + width * scalex;
            FOR x IN 1..st_width(template) LOOP
                minY := public.ST_RasterToWorldCoordY(template, x, 1) + height * scaley;
                uly := public.ST_RasterToWorldCoordY(template, x, y);
                IF uly + (tileheight * scaley) < minY THEN
                    --raise notice 'uly, minY: %, %', uly, minY;
                    rh := ceil((minY - uly)/scaleY)::int;
                ELSE
                    rh := tileheight;
                END IF;

                ulx := public.ST_RasterToWorldCoordX(template, x, y);
                IF ulx + (tilewidth * scalex) > maxX THEN
                    --raise notice 'ulx, maxX: %, %', ulx, maxX;
                    rw := ceil((maxX - ulx)/scaleX)::int;
                ELSE
                    rw := tilewidth;
                END IF;

                RETURN NEXT public.ST_MakeEmptyRaster(rw, rh, ulx, uly, scalex, scaley, skewx, skewy, srid);
            END LOOP;
        END LOOP;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.st_makeemptyraster(rast raster)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
		DECLARE
			w int;
			h int;
			ul_x double precision;
			ul_y double precision;
			scale_x double precision;
			scale_y double precision;
			skew_x double precision;
			skew_y double precision;
			sr_id int;
		BEGIN
			SELECT width, height, upperleftx, upperlefty, scalex, scaley, skewx, skewy, srid INTO w, h, ul_x, ul_y, scale_x, scale_y, skew_x, skew_y, sr_id FROM public.ST_Metadata(rast);
			RETURN  public.ST_makeemptyraster(w, h, ul_x, ul_y, scale_x, scale_y, skew_x, skew_y, sr_id);
		END;
    $function$
;

CREATE OR REPLACE FUNCTION public.st_makeemptyraster(width integer, height integer, upperleftx double precision, upperlefty double precision, scalex double precision, scaley double precision, skewx double precision, skewy double precision, srid integer DEFAULT 0)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_makeEmpty$function$
;

CREATE OR REPLACE FUNCTION public.st_makeemptyraster(width integer, height integer, upperleftx double precision, upperlefty double precision, pixelsize double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT  public.ST_makeemptyraster($1, $2, $3, $4, $5, -($5), 0, 0, public.ST_SRID('POINT(0 0)'::public.geometry)) $function$
;

CREATE OR REPLACE FUNCTION public.st_makeenvelope(double precision, double precision, double precision, double precision, integer DEFAULT 0)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_MakeEnvelope$function$
;

CREATE OR REPLACE FUNCTION public.st_makeline(geom1 geometry, geom2 geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_makeline$function$
;

CREATE OR REPLACE FUNCTION public.st_makeline(geometry[])
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_makeline_garray$function$
;

CREATE OR REPLACE FUNCTION public.st_makepoint(double precision, double precision, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_makepoint$function$
;

CREATE OR REPLACE FUNCTION public.st_makepoint(double precision, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_makepoint$function$
;

CREATE OR REPLACE FUNCTION public.st_makepoint(double precision, double precision, double precision, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_makepoint$function$
;

CREATE OR REPLACE FUNCTION public.st_makepointm(double precision, double precision, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_makepoint3dm$function$
;

CREATE OR REPLACE FUNCTION public.st_makepolygon(geometry, geometry[])
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_makepoly$function$
;

CREATE OR REPLACE FUNCTION public.st_makepolygon(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_makepoly$function$
;

CREATE OR REPLACE FUNCTION public.st_makevalid(geom geometry, params text)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_MakeValid$function$
;

CREATE OR REPLACE FUNCTION public.st_makevalid(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_MakeValid$function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebra(rast raster, nband integer[], callbackfunc regprocedure, pixeltype text DEFAULT NULL::text, extenttype text DEFAULT 'FIRST'::text, customextent raster DEFAULT NULL::raster, distancex integer DEFAULT 0, distancey integer DEFAULT 0, VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		x int;
		argset rastbandarg[];
	BEGIN
		IF $2 IS NULL OR array_ndims($2) < 1 OR array_length($2, 1) < 1 THEN
			RAISE EXCEPTION 'Populated 1D array must be provided for nband';
			RETURN NULL;
		END IF;

		FOR x IN array_lower($2, 1)..array_upper($2, 1) LOOP
			IF $2[x] IS NULL THEN
				CONTINUE;
			END IF;

			argset := argset || ROW($1, $2[x])::rastbandarg;
		END LOOP;

		IF array_length(argset, 1) < 1 THEN
			RAISE EXCEPTION 'Populated 1D array must be provided for nband';
			RETURN NULL;
		END IF;

		RETURN public._ST_MapAlgebra(argset, $3, $4, $7, $8, $5, $6,NULL::double precision [],NULL::boolean, VARIADIC $9);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebra(rast1 raster, rast2 raster, expression text, pixeltype text DEFAULT NULL::text, extenttype text DEFAULT 'INTERSECTION'::text, nodata1expr text DEFAULT NULL::text, nodata2expr text DEFAULT NULL::text, nodatanodataval double precision DEFAULT NULL::double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_mapalgebra($1, 1, $2, 1, $3, $4, $5, $6, $7, $8) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebra(rast raster, nband integer, pixeltype text, expression text, nodataval double precision DEFAULT NULL::double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_mapalgebra(ARRAY[ROW($1, $2)]::public.rastbandarg[], $4, $3, 'FIRST', $5::text) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebra(rast raster, nband integer, callbackfunc regprocedure, mask double precision[], weighted boolean, pixeltype text DEFAULT NULL::text, extenttype text DEFAULT 'INTERSECTION'::text, customextent raster DEFAULT NULL::raster, VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
	select public._ST_mapalgebra(ARRAY[ROW($1,$2)]::public.rastbandarg[],$3,$6,NULL::integer,NULL::integer,$7,$8,$4,$5,VARIADIC $9)
	$function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebra(rast1 raster, nband1 integer, rast2 raster, nband2 integer, callbackfunc regprocedure, pixeltype text DEFAULT NULL::text, extenttype text DEFAULT 'INTERSECTION'::text, customextent raster DEFAULT NULL::raster, distancex integer DEFAULT 0, distancey integer DEFAULT 0, VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_MapAlgebra(ARRAY[ROW($1, $2), ROW($3, $4)]::public.rastbandarg[], $5, $6, $9, $10, $7, $8,NULL::double precision [],NULL::boolean, VARIADIC $11) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebra(rast raster, nband integer, callbackfunc regprocedure, pixeltype text DEFAULT NULL::text, extenttype text DEFAULT 'FIRST'::text, customextent raster DEFAULT NULL::raster, distancex integer DEFAULT 0, distancey integer DEFAULT 0, VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_MapAlgebra(ARRAY[ROW($1, $2)]::public.rastbandarg[], $3, $4, $7, $8, $5, $6,NULL::double precision [],NULL::boolean, VARIADIC $9) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebra(rast raster, pixeltype text, expression text, nodataval double precision DEFAULT NULL::double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_mapalgebra($1, 1, $2, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebra(rastbandargset rastbandarg[], callbackfunc regprocedure, pixeltype text DEFAULT NULL::text, extenttype text DEFAULT 'INTERSECTION'::text, customextent raster DEFAULT NULL::raster, distancex integer DEFAULT 0, distancey integer DEFAULT 0, VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_MapAlgebra($1, $2, $3, $6, $7, $4, $5,NULL::double precision [],NULL::boolean, VARIADIC $8) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebra(rast1 raster, band1 integer, rast2 raster, band2 integer, expression text, pixeltype text DEFAULT NULL::text, extenttype text DEFAULT 'INTERSECTION'::text, nodata1expr text DEFAULT NULL::text, nodata2expr text DEFAULT NULL::text, nodatanodataval double precision DEFAULT NULL::double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_mapalgebra(ARRAY[ROW($1, $2), ROW($3, $4)]::public.rastbandarg[], $5, $6, $7, $8, $9, $10) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebraexpr(rast raster, band integer, pixeltype text, expression text, nodataval double precision DEFAULT NULL::double precision)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_mapAlgebraExpr$function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebraexpr(rast raster, pixeltype text, expression text, nodataval double precision DEFAULT NULL::double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_mapalgebraexpr($1, 1, $2, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebraexpr(rast1 raster, rast2 raster, expression text, pixeltype text DEFAULT NULL::text, extenttype text DEFAULT 'INTERSECTION'::text, nodata1expr text DEFAULT NULL::text, nodata2expr text DEFAULT NULL::text, nodatanodataval double precision DEFAULT NULL::double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_mapalgebraexpr($1, 1, $2, 1, $3, $4, $5, $6, $7, $8) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebraexpr(rast1 raster, band1 integer, rast2 raster, band2 integer, expression text, pixeltype text DEFAULT NULL::text, extenttype text DEFAULT 'INTERSECTION'::text, nodata1expr text DEFAULT NULL::text, nodata2expr text DEFAULT NULL::text, nodatanodataval double precision DEFAULT NULL::double precision)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_mapAlgebra2$function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebrafct(rast raster, pixeltype text, onerastuserfunc regprocedure)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_mapalgebrafct($1, 1, $2, $3, NULL) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebrafct(rast1 raster, rast2 raster, tworastuserfunc regprocedure, pixeltype text DEFAULT NULL::text, extenttype text DEFAULT 'INTERSECTION'::text, VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_mapalgebrafct($1, 1, $2, 1, $3, $4, $5, VARIADIC $6) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebrafct(rast raster, pixeltype text, onerastuserfunc regprocedure, VARIADIC args text[])
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_mapalgebrafct($1, 1, $2, $3, VARIADIC $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebrafct(rast1 raster, band1 integer, rast2 raster, band2 integer, tworastuserfunc regprocedure, pixeltype text DEFAULT NULL::text, extenttype text DEFAULT 'INTERSECTION'::text, VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_mapAlgebra2$function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebrafct(rast raster, band integer, pixeltype text, onerastuserfunc regprocedure, VARIADIC args text[])
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_mapAlgebraFct$function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebrafct(rast raster, onerastuserfunc regprocedure)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_mapalgebrafct($1, 1, NULL, $2, NULL) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebrafct(rast raster, onerastuserfunc regprocedure, VARIADIC args text[])
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_mapalgebrafct($1, 1, NULL, $2, VARIADIC $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebrafct(rast raster, band integer, onerastuserfunc regprocedure)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_mapalgebrafct($1, $2, NULL, $3, NULL) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebrafct(rast raster, band integer, onerastuserfunc regprocedure, VARIADIC args text[])
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_mapalgebrafct($1, $2, NULL, $3, VARIADIC $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebrafct(rast raster, band integer, pixeltype text, onerastuserfunc regprocedure)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_mapalgebrafct($1, $2, $3, $4, NULL) $function$
;

CREATE OR REPLACE FUNCTION public.st_mapalgebrafctngb(rast raster, band integer, pixeltype text, ngbwidth integer, ngbheight integer, onerastngbuserfunc regprocedure, nodatamode text, VARIADIC args text[])
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_mapAlgebraFctNgb$function$
;

CREATE OR REPLACE FUNCTION public.st_max4ma(matrix double precision[], nodatamode text, VARIADIC args text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
    DECLARE
        _matrix float[][];
        max float;
    BEGIN
        _matrix := matrix;
        max := '-Infinity'::float;
        FOR x in array_lower(_matrix, 1)..array_upper(_matrix, 1) LOOP
            FOR y in array_lower(_matrix, 2)..array_upper(_matrix, 2) LOOP
                IF _matrix[x][y] IS NULL THEN
                    IF NOT nodatamode = 'ignore' THEN
                        _matrix[x][y] := nodatamode::float;
                    END IF;
                END IF;
                IF max < _matrix[x][y] THEN
                    max := _matrix[x][y];
                END IF;
            END LOOP;
        END LOOP;
        RETURN max;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.st_max4ma(value double precision[], pos integer[], VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		_value double precision[][][];
		max double precision;
		x int;
		y int;
		z int;
		ndims int;
	BEGIN
		max := '-Infinity'::double precision;

		ndims := array_ndims(value);
		-- add a third dimension if 2-dimension
		IF ndims = 2 THEN
			_value := public._ST_convertarray4ma(value);
		ELSEIF ndims != 3 THEN
			RAISE EXCEPTION 'First parameter of function must be a 3-dimension array';
		ELSE
			_value := value;
		END IF;

		-- raster
		FOR z IN array_lower(_value, 1)..array_upper(_value, 1) LOOP
			-- row
			FOR y IN array_lower(_value, 2)..array_upper(_value, 2) LOOP
				-- column
				FOR x IN array_lower(_value, 3)..array_upper(_value, 3) LOOP
					IF _value[z][y][x] IS NULL THEN
						IF array_length(userargs, 1) > 0 THEN
							_value[z][y][x] = userargs[array_lower(userargs, 1)]::double precision;
						ELSE
							CONTINUE;
						END IF;
					END IF;

					IF _value[z][y][x] > max THEN
						max := _value[z][y][x];
					END IF;
				END LOOP;
			END LOOP;
		END LOOP;

		IF max = '-Infinity'::double precision THEN
			RETURN NULL;
		END IF;

		RETURN max;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_maxdistance(geom1 geometry, geom2 geometry)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS $function$SELECT public._ST_MaxDistance(public.ST_ConvexHull($1), public.ST_ConvexHull($2))$function$
;

CREATE OR REPLACE FUNCTION public.st_maximuminscribedcircle(geometry, OUT center geometry, OUT nearest geometry, OUT radius double precision)
 RETURNS record
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_MaximumInscribedCircle$function$
;

CREATE OR REPLACE FUNCTION public.st_mean4ma(value double precision[], pos integer[], VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		_value double precision[][][];
		sum double precision;
		count int;
		x int;
		y int;
		z int;
		ndims int;
	BEGIN
		sum := 0;
		count := 0;

		ndims := array_ndims(value);
		-- add a third dimension if 2-dimension
		IF ndims = 2 THEN
			_value := public._ST_convertarray4ma(value);
		ELSEIF ndims != 3 THEN
			RAISE EXCEPTION 'First parameter of function must be a 3-dimension array';
		ELSE
			_value := value;
		END IF;

		-- raster
		FOR z IN array_lower(_value, 1)..array_upper(_value, 1) LOOP
			-- row
			FOR y IN array_lower(_value, 2)..array_upper(_value, 2) LOOP
				-- column
				FOR x IN array_lower(_value, 3)..array_upper(_value, 3) LOOP
					IF _value[z][y][x] IS NULL THEN
						IF array_length(userargs, 1) > 0 THEN
							_value[z][y][x] = userargs[array_lower(userargs, 1)]::double precision;
						ELSE
							CONTINUE;
						END IF;
					END IF;

					sum := sum + _value[z][y][x];
					count := count + 1;
				END LOOP;
			END LOOP;
		END LOOP;

		IF count < 1 THEN
			RETURN NULL;
		END IF;

		RETURN sum / count::double precision;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_mean4ma(matrix double precision[], nodatamode text, VARIADIC args text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
    DECLARE
        _matrix float[][];
        sum float;
        count float;
    BEGIN
        _matrix := matrix;
        sum := 0;
        count := 0;
        FOR x in array_lower(matrix, 1)..array_upper(matrix, 1) LOOP
            FOR y in array_lower(matrix, 2)..array_upper(matrix, 2) LOOP
                IF _matrix[x][y] IS NULL THEN
                    IF nodatamode = 'ignore' THEN
                        _matrix[x][y] := 0;
                    ELSE
                        _matrix[x][y] := nodatamode::float;
                        count := count + 1;
                    END IF;
                ELSE
                    count := count + 1;
                END IF;
                sum := sum + _matrix[x][y];
            END LOOP;
        END LOOP;
        IF count = 0 THEN
            RETURN NULL;
        END IF;
        RETURN sum / count;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.st_memsize(raster)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_memsize$function$
;

CREATE OR REPLACE FUNCTION public.st_memsize(geometry)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_mem_size$function$
;

CREATE OR REPLACE FUNCTION public.st_metadata(rast raster, OUT upperleftx double precision, OUT upperlefty double precision, OUT width integer, OUT height integer, OUT scalex double precision, OUT scaley double precision, OUT skewx double precision, OUT skewy double precision, OUT srid integer, OUT numbands integer)
 RETURNS record
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_metadata$function$
;

CREATE OR REPLACE FUNCTION public.st_min4ma(matrix double precision[], nodatamode text, VARIADIC args text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
    DECLARE
        _matrix float[][];
        min float;
    BEGIN
        _matrix := matrix;
        min := 'Infinity'::float;
        FOR x in array_lower(_matrix, 1)..array_upper(_matrix, 1) LOOP
            FOR y in array_lower(_matrix, 2)..array_upper(_matrix, 2) LOOP
                IF _matrix[x][y] IS NULL THEN
                    IF NOT nodatamode = 'ignore' THEN
                        _matrix[x][y] := nodatamode::float;
                    END IF;
                END IF;
                IF min > _matrix[x][y] THEN
                    min := _matrix[x][y];
                END IF;
            END LOOP;
        END LOOP;
        RETURN min;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.st_min4ma(value double precision[], pos integer[], VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		_value double precision[][][];
		min double precision;
		x int;
		y int;
		z int;
		ndims int;
	BEGIN
		min := 'Infinity'::double precision;

		ndims := array_ndims(value);
		-- add a third dimension if 2-dimension
		IF ndims = 2 THEN
			_value := public._ST_convertarray4ma(value);
		ELSEIF ndims != 3 THEN
			RAISE EXCEPTION 'First parameter of function must be a 3-dimension array';
		ELSE
			_value := value;
		END IF;

		-- raster
		FOR z IN array_lower(_value, 1)..array_upper(_value, 1) LOOP
			-- row
			FOR y IN array_lower(_value, 2)..array_upper(_value, 2) LOOP
				-- column
				FOR x IN array_lower(_value, 3)..array_upper(_value, 3) LOOP
					IF _value[z][y][x] IS NULL THEN
						IF array_length(userargs, 1) > 0 THEN
							_value[z][y][x] = userargs[array_lower(userargs, 1)]::double precision;
						ELSE
							CONTINUE;
						END IF;
					END IF;

					IF _value[z][y][x] < min THEN
						min := _value[z][y][x];
					END IF;
				END LOOP;
			END LOOP;
		END LOOP;

		IF min = 'Infinity'::double precision THEN
			RETURN NULL;
		END IF;

		RETURN min;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_minconvexhull(rast raster, nband integer DEFAULT NULL::integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_convex_hull$function$
;

CREATE OR REPLACE FUNCTION public.st_mindist4ma(value double precision[], pos integer[], VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		_value double precision[][][];
		ndims int;

		d double precision DEFAULT NULL;
		_d double precision;

		z integer;
		x integer;
		y integer;

		cx integer;
		cy integer;
		cv double precision;

		w integer;
		h integer;
		max_dx double precision;
		max_dy double precision;
	BEGIN

		ndims := array_ndims(value);
		-- add a third dimension if 2-dimension
		IF ndims = 2 THEN
			_value := public._ST_convertarray4ma(value);
		ELSEIF ndims != 3 THEN
			RAISE EXCEPTION 'First parameter of function must be a 3-dimension array';
		ELSE
			_value := value;
		END IF;

		-- only use the first raster passed to this function
		IF array_length(_value, 1) > 1 THEN
			RAISE NOTICE 'Only using the values from the first raster';
		END IF;
		z := array_lower(_value, 1);

		-- width and height (0-based)
		h := array_upper(_value, 2) - array_lower(_value, 2);
		w := array_upper(_value, 3) - array_lower(_value, 3);

		-- max distance from center pixel
		max_dx := w / 2;
		max_dy := h / 2;

		-- correct width and height (1-based)
		w := w + 1;
		h := h + 1;

		-- width and height should be odd numbers
		IF w % 2. != 1 THEN
			RAISE EXCEPTION 'Width of neighborhood array does not permit for a center pixel';
		END IF;
		IF h % 2. != 1 THEN
			RAISE EXCEPTION 'Height of neighborhood array does not permit for a center pixel';
		END IF;

		-- center pixel's coordinates
		cy := max_dy + array_lower(_value, 2);
		cx := max_dx + array_lower(_value, 3);

		-- center pixel value
		cv := _value[z][cy][cx];

		-- check to see if center pixel has value
		IF cv IS NOT NULL THEN
			RETURN 0.;
		END IF;

		FOR y IN array_lower(_value, 2)..array_upper(_value, 2) LOOP
			FOR x IN array_lower(_value, 3)..array_upper(_value, 3) LOOP

				-- skip NODATA values and center pixel
				IF _value[z][y][x] IS NULL OR (x = cx AND y = cy) THEN
					CONTINUE;
				END IF;

				-- use pythagorean theorem
				_d := sqrt(power(cx - x, 2) + power(cy - y, 2));
--				RAISE NOTICE 'distance = %', _d;

				IF d IS NULL OR _d < d THEN
					d := _d;
				END IF;
			END LOOP;
		END LOOP;
--		RAISE NOTICE 'd = %', d;

		RETURN d;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_minimumboundingcircle(inputgeom geometry, segs_per_quarter integer DEFAULT 48)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_MinimumBoundingCircle$function$
;

CREATE OR REPLACE FUNCTION public.st_minimumboundingradius(geometry, OUT center geometry, OUT radius double precision)
 RETURNS record
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_MinimumBoundingRadius$function$
;

CREATE OR REPLACE FUNCTION public.st_minimumclearance(geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_MinimumClearance$function$
;

CREATE OR REPLACE FUNCTION public.st_minimumclearanceline(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_MinimumClearanceLine$function$
;

CREATE OR REPLACE FUNCTION public.st_minpossiblevalue(pixeltype text)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_minPossibleValue$function$
;

CREATE OR REPLACE FUNCTION public.st_mlinefromtext(text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromText($1)) = 'MULTILINESTRING'
	THEN public.ST_GeomFromText($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_mlinefromtext(text, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$
	SELECT CASE
	WHEN public.geometrytype(public.ST_GeomFromText($1, $2)) = 'MULTILINESTRING'
	THEN public.ST_GeomFromText($1,$2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_mlinefromwkb(bytea)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1)) = 'MULTILINESTRING'
	THEN public.ST_GeomFromWKB($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_mlinefromwkb(bytea, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1, $2)) = 'MULTILINESTRING'
	THEN public.ST_GeomFromWKB($1, $2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_mpointfromtext(text, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromText($1, $2)) = 'MULTIPOINT'
	THEN ST_GeomFromText($1, $2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_mpointfromtext(text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromText($1)) = 'MULTIPOINT'
	THEN public.ST_GeomFromText($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_mpointfromwkb(bytea, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1, $2)) = 'MULTIPOINT'
	THEN public.ST_GeomFromWKB($1, $2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_mpointfromwkb(bytea)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1)) = 'MULTIPOINT'
	THEN public.ST_GeomFromWKB($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_mpolyfromtext(text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromText($1)) = 'MULTIPOLYGON'
	THEN public.ST_GeomFromText($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_mpolyfromtext(text, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromText($1, $2)) = 'MULTIPOLYGON'
	THEN public.ST_GeomFromText($1,$2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_mpolyfromwkb(bytea)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1)) = 'MULTIPOLYGON'
	THEN public.ST_GeomFromWKB($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_mpolyfromwkb(bytea, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1, $2)) = 'MULTIPOLYGON'
	THEN public.ST_GeomFromWKB($1, $2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_multi(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_force_multi$function$
;

CREATE OR REPLACE FUNCTION public.st_multilinefromwkb(bytea)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1)) = 'MULTILINESTRING'
	THEN public.ST_GeomFromWKB($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_multilinestringfromtext(text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$SELECT public.ST_MLineFromText($1)$function$
;

CREATE OR REPLACE FUNCTION public.st_multilinestringfromtext(text, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$SELECT public.ST_MLineFromText($1, $2)$function$
;

CREATE OR REPLACE FUNCTION public.st_multipointfromtext(text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$SELECT public.ST_MPointFromText($1)$function$
;

CREATE OR REPLACE FUNCTION public.st_multipointfromwkb(bytea)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1)) = 'MULTIPOINT'
	THEN public.ST_GeomFromWKB($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_multipointfromwkb(bytea, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1,$2)) = 'MULTIPOINT'
	THEN public.ST_GeomFromWKB($1, $2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_multipolyfromwkb(bytea)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1)) = 'MULTIPOLYGON'
	THEN public.ST_GeomFromWKB($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_multipolyfromwkb(bytea, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1, $2)) = 'MULTIPOLYGON'
	THEN public.ST_GeomFromWKB($1, $2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_multipolygonfromtext(text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$SELECT public.ST_MPolyFromText($1)$function$
;

CREATE OR REPLACE FUNCTION public.st_multipolygonfromtext(text, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$SELECT public.ST_MPolyFromText($1, $2)$function$
;

CREATE OR REPLACE FUNCTION public.st_ndims(geometry)
 RETURNS smallint
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_ndims$function$
;

CREATE OR REPLACE FUNCTION public.st_nearestvalue(rast raster, pt geometry, exclude_nodata_value boolean DEFAULT true)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.st_nearestvalue($1, 1, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_nearestvalue(rast raster, band integer, pt geometry, exclude_nodata_value boolean DEFAULT true)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_nearestValue$function$
;

CREATE OR REPLACE FUNCTION public.st_nearestvalue(rast raster, columnx integer, rowy integer, exclude_nodata_value boolean DEFAULT true)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.st_nearestvalue($1, 1, public.st_setsrid(public.st_makepoint(public.st_rastertoworldcoordx($1, $2, $3), public.st_rastertoworldcoordy($1, $2, $3)), public.st_srid($1)), $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_nearestvalue(rast raster, band integer, columnx integer, rowy integer, exclude_nodata_value boolean DEFAULT true)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.st_nearestvalue($1, $2, public.st_setsrid(public.st_makepoint(public.st_rastertoworldcoordx($1, $3, $4), public.st_rastertoworldcoordy($1, $3, $4)), public.st_srid($1)), $5) $function$
;

CREATE OR REPLACE FUNCTION public.st_neighborhood(rast raster, pt geometry, distancex integer, distancey integer, exclude_nodata_value boolean DEFAULT true)
 RETURNS double precision[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.st_neighborhood($1, 1, $2, $3, $4, $5) $function$
;

CREATE OR REPLACE FUNCTION public.st_neighborhood(rast raster, band integer, pt geometry, distancex integer, distancey integer, exclude_nodata_value boolean DEFAULT true)
 RETURNS double precision[]
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	DECLARE
		wx double precision;
		wy double precision;
		rtn double precision[][];
	BEGIN
		IF (public.st_geometrytype($3) != 'ST_Point') THEN
			RAISE EXCEPTION 'Attempting to get the neighbor of a pixel with a non-point geometry';
		END IF;

		IF public.ST_SRID(rast) != public.ST_SRID(pt) THEN
			RAISE EXCEPTION 'Raster and geometry do not have the same SRID';
		END IF;

		wx := public.st_x($3);
		wy := public.st_y($3);

		SELECT public._ST_neighborhood(
			$1, $2,
			public.st_worldtorastercoordx(rast, wx, wy),
			public.st_worldtorastercoordy(rast, wx, wy),
			$4, $5,
			$6
		) INTO rtn;
		RETURN rtn;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_neighborhood(rast raster, band integer, columnx integer, rowy integer, distancex integer, distancey integer, exclude_nodata_value boolean DEFAULT true)
 RETURNS double precision[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_neighborhood($1, $2, $3, $4, $5, $6, $7) $function$
;

CREATE OR REPLACE FUNCTION public.st_neighborhood(rast raster, columnx integer, rowy integer, distancex integer, distancey integer, exclude_nodata_value boolean DEFAULT true)
 RETURNS double precision[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_neighborhood($1, 1, $2, $3, $4, $5, $6) $function$
;

CREATE OR REPLACE FUNCTION public.st_node(g geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_Node$function$
;

CREATE OR REPLACE FUNCTION public.st_normalize(geom geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_Normalize$function$
;

CREATE OR REPLACE FUNCTION public.st_notsamealignmentreason(rast1 raster, rast2 raster)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_notSameAlignmentReason$function$
;

CREATE OR REPLACE FUNCTION public.st_npoints(geometry)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_npoints$function$
;

CREATE OR REPLACE FUNCTION public.st_nrings(geometry)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_nrings$function$
;

CREATE OR REPLACE FUNCTION public.st_numbands(raster)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getNumBands$function$
;

CREATE OR REPLACE FUNCTION public.st_numcurves(geometry geometry)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_NumCurves$function$
;

CREATE OR REPLACE FUNCTION public.st_numgeometries(geometry)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_numgeometries_collection$function$
;

CREATE OR REPLACE FUNCTION public.st_numinteriorring(geometry)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_numinteriorrings_polygon$function$
;

CREATE OR REPLACE FUNCTION public.st_numinteriorrings(geometry)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_numinteriorrings_polygon$function$
;

CREATE OR REPLACE FUNCTION public.st_numpatches(geometry)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.ST_GeometryType($1) = 'ST_PolyhedralSurface'
	THEN public.ST_NumGeometries($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_numpoints(geometry)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_numpoints_linestring$function$
;

CREATE OR REPLACE FUNCTION public.st_offsetcurve(line geometry, distance double precision, params text DEFAULT ''::text)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_OffsetCurve$function$
;

CREATE OR REPLACE FUNCTION public.st_orderingequals(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$LWGEOM_same$function$
;

CREATE OR REPLACE FUNCTION public.st_orientedenvelope(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_OrientedEnvelope$function$
;

CREATE OR REPLACE FUNCTION public.st_overlaps(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT $1 OPERATOR(public.&&) $3 AND CASE WHEN $2 IS NULL OR $4 IS NULL THEN public._st_overlaps(public.st_convexhull($1), public.st_convexhull($3)) ELSE public._ST_overlaps($1, $2, $3, $4) END $function$
;

CREATE OR REPLACE FUNCTION public.st_overlaps(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$overlaps$function$
;

CREATE OR REPLACE FUNCTION public.st_overlaps(rast1 raster, rast2 raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT public.st_overlaps($1, NULL::integer, $2, NULL::integer) $function$
;

CREATE OR REPLACE FUNCTION public.st_patchn(geometry, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.ST_GeometryType($1) = 'ST_PolyhedralSurface'
	THEN public.ST_GeometryN($1, $2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_perimeter(geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_perimeter2d_poly$function$
;

CREATE OR REPLACE FUNCTION public.st_perimeter(geog geography, use_spheroid boolean DEFAULT true)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geography_perimeter$function$
;

CREATE OR REPLACE FUNCTION public.st_perimeter2d(geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_perimeter2d_poly$function$
;

CREATE OR REPLACE FUNCTION public.st_pixelascentroid(rast raster, x integer, y integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT geom FROM public._ST_pixelascentroids($1, NULL, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_pixelascentroids(rast raster, band integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true)
 RETURNS TABLE(geom geometry, val double precision, x integer, y integer)
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT geom, val, x, y FROM public._ST_pixelascentroids($1, $2, NULL, NULL, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_pixelaspoint(rast raster, x integer, y integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.ST_PointN(public.ST_ExteriorRing(geom), 1) FROM public._ST_pixelaspolygons($1, NULL, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_pixelaspoints(rast raster, band integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true)
 RETURNS TABLE(geom geometry, val double precision, x integer, y integer)
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.ST_PointN(  public.ST_ExteriorRing(geom), 1), val, x, y FROM public._ST_pixelaspolygons($1, $2, NULL, NULL, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_pixelaspolygon(rast raster, x integer, y integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT geom FROM public._ST_pixelaspolygons($1, NULL, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_pixelaspolygons(rast raster, band integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true)
 RETURNS TABLE(geom geometry, val double precision, x integer, y integer)
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT geom, val, x, y FROM public._ST_pixelaspolygons($1, $2, NULL, NULL, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_pixelheight(raster)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getPixelHeight$function$
;

CREATE OR REPLACE FUNCTION public.st_pixelofvalue(rast raster, search double precision[], exclude_nodata_value boolean DEFAULT true)
 RETURNS TABLE(val double precision, x integer, y integer)
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT val, x, y FROM public.ST_PixelOfValue($1, 1, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_pixelofvalue(rast raster, nband integer, search double precision, exclude_nodata_value boolean DEFAULT true)
 RETURNS TABLE(x integer, y integer)
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT x, y FROM public.ST_PixelofValue($1, $2, ARRAY[$3], $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_pixelofvalue(rast raster, search double precision, exclude_nodata_value boolean DEFAULT true)
 RETURNS TABLE(x integer, y integer)
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT x, y FROM public.ST_PixelOfValue($1, 1, ARRAY[$2], $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_pixelofvalue(rast raster, nband integer, search double precision[], exclude_nodata_value boolean DEFAULT true)
 RETURNS TABLE(val double precision, x integer, y integer)
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_pixelOfValue$function$
;

CREATE OR REPLACE FUNCTION public.st_pixelwidth(raster)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getPixelWidth$function$
;

CREATE OR REPLACE FUNCTION public.st_point(double precision, double precision, srid integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_Point$function$
;

CREATE OR REPLACE FUNCTION public.st_point(double precision, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_makepoint$function$
;

CREATE OR REPLACE FUNCTION public.st_pointfromgeohash(text, integer DEFAULT NULL::integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 50
AS '$libdir/postgis-3', $function$point_from_geohash$function$
;

CREATE OR REPLACE FUNCTION public.st_pointfromtext(text, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromText($1, $2)) = 'POINT'
	THEN public.ST_GeomFromText($1, $2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_pointfromtext(text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromText($1)) = 'POINT'
	THEN public.ST_GeomFromText($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_pointfromwkb(bytea)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1)) = 'POINT'
	THEN public.ST_GeomFromWKB($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_pointfromwkb(bytea, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1, $2)) = 'POINT'
	THEN public.ST_GeomFromWKB($1, $2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_pointinsidecircle(geometry, double precision, double precision, double precision)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_inside_circle_point$function$
;

CREATE OR REPLACE FUNCTION public.st_pointm(xcoordinate double precision, ycoordinate double precision, mcoordinate double precision, srid integer DEFAULT 0)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_PointM$function$
;

CREATE OR REPLACE FUNCTION public.st_pointn(geometry, integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_pointn_linestring$function$
;

CREATE OR REPLACE FUNCTION public.st_pointonsurface(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$pointonsurface$function$
;

CREATE OR REPLACE FUNCTION public.st_points(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_Points$function$
;

CREATE OR REPLACE FUNCTION public.st_pointz(xcoordinate double precision, ycoordinate double precision, zcoordinate double precision, srid integer DEFAULT 0)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_PointZ$function$
;

CREATE OR REPLACE FUNCTION public.st_pointzm(xcoordinate double precision, ycoordinate double precision, zcoordinate double precision, mcoordinate double precision, srid integer DEFAULT 0)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_PointZM$function$
;

CREATE OR REPLACE FUNCTION public.st_polyfromtext(text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromText($1)) = 'POLYGON'
	THEN public.ST_GeomFromText($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_polyfromtext(text, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromText($1, $2)) = 'POLYGON'
	THEN public.ST_GeomFromText($1, $2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_polyfromwkb(bytea)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1)) = 'POLYGON'
	THEN public.ST_GeomFromWKB($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_polyfromwkb(bytea, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1, $2)) = 'POLYGON'
	THEN public.ST_GeomFromWKB($1, $2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_polygon(geometry, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT public.ST_SetSRID(public.ST_MakePolygon($1), $2)
	$function$
;

CREATE OR REPLACE FUNCTION public.st_polygon(rast raster, band integer DEFAULT 1)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getPolygon$function$
;

CREATE OR REPLACE FUNCTION public.st_polygonfromtext(text, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$SELECT public.ST_PolyFromText($1, $2)$function$
;

CREATE OR REPLACE FUNCTION public.st_polygonfromtext(text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$SELECT public.ST_PolyFromText($1)$function$
;

CREATE OR REPLACE FUNCTION public.st_polygonfromwkb(bytea)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1)) = 'POLYGON'
	THEN public.ST_GeomFromWKB($1)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_polygonfromwkb(bytea, integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$
	SELECT CASE WHEN public.geometrytype(public.ST_GeomFromWKB($1,$2)) = 'POLYGON'
	THEN public.ST_GeomFromWKB($1, $2)
	ELSE NULL END
	$function$
;

CREATE OR REPLACE FUNCTION public.st_polygonize(geometry[])
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$polygonize_garray$function$
;

CREATE OR REPLACE FUNCTION public.st_project(geog_from geography, geog_to geography, distance double precision)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geography_project_geography$function$
;

CREATE OR REPLACE FUNCTION public.st_project(geog geography, distance double precision, azimuth double precision)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$geography_project$function$
;

CREATE OR REPLACE FUNCTION public.st_project(geom1 geometry, distance double precision, azimuth double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$geometry_project_direction$function$
;

CREATE OR REPLACE FUNCTION public.st_project(geom1 geometry, geom2 geometry, distance double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$geometry_project_geometry$function$
;

CREATE OR REPLACE FUNCTION public.st_quantile(rast raster, nband integer, exclude_nodata_value boolean, quantile double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT ( public._ST_quantile($1, $2, $3, 1, ARRAY[$4]::double precision[])).value $function$
;

CREATE OR REPLACE FUNCTION public.st_quantile(rast raster, nband integer, quantile double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT ( public._ST_quantile($1, $2, TRUE, 1, ARRAY[$3]::double precision[])).value $function$
;

CREATE OR REPLACE FUNCTION public.st_quantile(rast raster, exclude_nodata_value boolean, quantile double precision DEFAULT NULL::double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT ( public._ST_quantile($1, 1, $2, 1, ARRAY[$3]::double precision[])).value $function$
;

CREATE OR REPLACE FUNCTION public.st_quantile(rast raster, quantile double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT ( public._ST_quantile($1, 1, TRUE, 1, ARRAY[$2]::double precision[])).value $function$
;

CREATE OR REPLACE FUNCTION public.st_quantile(rast raster, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, quantiles double precision[] DEFAULT NULL::double precision[], OUT quantile double precision, OUT value double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_quantile($1, $2, $3, 1, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_quantile(rast raster, nband integer, quantiles double precision[], OUT quantile double precision, OUT value double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_quantile($1, $2, TRUE, 1, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_quantile(rast raster, quantiles double precision[], OUT quantile double precision, OUT value double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_quantile($1, 1, TRUE, 1, $2) $function$
;

CREATE OR REPLACE FUNCTION public.st_quantizecoordinates(g geometry, prec_x integer, prec_y integer DEFAULT NULL::integer, prec_z integer DEFAULT NULL::integer, prec_m integer DEFAULT NULL::integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE COST 250
AS '$libdir/postgis-3', $function$ST_QuantizeCoordinates$function$
;

CREATE OR REPLACE FUNCTION public.st_range4ma(value double precision[], pos integer[], VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		_value double precision[][][];
		min double precision;
		max double precision;
		x int;
		y int;
		z int;
		ndims int;
	BEGIN
		min := 'Infinity'::double precision;
		max := '-Infinity'::double precision;

		ndims := array_ndims(value);
		-- add a third dimension if 2-dimension
		IF ndims = 2 THEN
			_value := public._ST_convertarray4ma(value);
		ELSEIF ndims != 3 THEN
			RAISE EXCEPTION 'First parameter of function must be a 3-dimension array';
		ELSE
			_value := value;
		END IF;

		-- raster
		FOR z IN array_lower(_value, 1)..array_upper(_value, 1) LOOP
			-- row
			FOR y IN array_lower(_value, 2)..array_upper(_value, 2) LOOP
				-- column
				FOR x IN array_lower(_value, 3)..array_upper(_value, 3) LOOP
					IF _value[z][y][x] IS NULL THEN
						IF array_length(userargs, 1) > 0 THEN
							_value[z][y][x] = userargs[array_lower(userargs, 1)]::double precision;
						ELSE
							CONTINUE;
						END IF;
					END IF;

					IF _value[z][y][x] < min THEN
						min := _value[z][y][x];
					END IF;
					IF _value[z][y][x] > max THEN
						max := _value[z][y][x];
					END IF;
				END LOOP;
			END LOOP;
		END LOOP;

		IF max = '-Infinity'::double precision OR min = 'Infinity'::double precision THEN
			RETURN NULL;
		END IF;

		RETURN max - min;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_range4ma(matrix double precision[], nodatamode text, VARIADIC args text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
    DECLARE
        _matrix float[][];
        min float;
        max float;
    BEGIN
        _matrix := matrix;
        min := 'Infinity'::float;
        max := '-Infinity'::float;
        FOR x in array_lower(matrix, 1)..array_upper(matrix, 1) LOOP
            FOR y in array_lower(matrix, 2)..array_upper(matrix, 2) LOOP
                IF _matrix[x][y] IS NULL THEN
                    IF NOT nodatamode = 'ignore' THEN
                        _matrix[x][y] := nodatamode::float;
                    END IF;
                END IF;
                IF min > _matrix[x][y] THEN
                    min = _matrix[x][y];
                END IF;
                IF max < _matrix[x][y] THEN
                    max = _matrix[x][y];
                END IF;
            END LOOP;
        END LOOP;
        IF max = '-Infinity'::float OR min = 'Infinity'::float THEN
            RETURN NULL;
        END IF;
        RETURN max - min;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.st_rastertoworldcoord(rast raster, columnx integer, rowy integer, OUT longitude double precision, OUT latitude double precision)
 RETURNS record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT longitude, latitude FROM public._ST_rastertoworldcoord($1, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_rastertoworldcoordx(rast raster, xr integer)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT longitude FROM public._ST_rastertoworldcoord($1, $2, NULL) $function$
;

CREATE OR REPLACE FUNCTION public.st_rastertoworldcoordx(rast raster, xr integer, yr integer)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT longitude FROM public._ST_rastertoworldcoord($1, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_rastertoworldcoordy(rast raster, xr integer, yr integer)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT latitude FROM public._ST_rastertoworldcoord($1, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_rastertoworldcoordy(rast raster, yr integer)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT latitude FROM public._ST_rastertoworldcoord($1, NULL, $2) $function$
;

CREATE OR REPLACE FUNCTION public.st_rastfromhexwkb(text)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_fromHexWKB$function$
;

CREATE OR REPLACE FUNCTION public.st_rastfromwkb(bytea)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_fromWKB$function$
;

CREATE OR REPLACE FUNCTION public.st_reclass(rast raster, nband integer, reclassexpr text, pixeltype text, nodataval double precision DEFAULT NULL::double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.st_reclass($1, ROW($2, $3, $4, $5)) $function$
;

CREATE OR REPLACE FUNCTION public.st_reclass(rast raster, reclassexpr text, pixeltype text)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.st_reclass($1, ROW(1, $2, $3, NULL)) $function$
;

CREATE OR REPLACE FUNCTION public.st_reclass(rast raster, VARIADIC reclassargset reclassarg[])
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	DECLARE
		i int;
		expr text;
	BEGIN
		-- for each reclassarg, validate elements as all except nodataval cannot be NULL
		FOR i IN SELECT * FROM generate_subscripts($2, 1) LOOP
			IF $2[i].nband IS NULL OR $2[i].reclassexpr IS NULL OR $2[i].pixeltype IS NULL THEN
				RAISE WARNING 'Values are required for the nband, reclassexpr and pixeltype attributes.';
				RETURN rast;
			END IF;
		END LOOP;

		RETURN public._ST_reclass($1, VARIADIC $2);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_reduceprecision(geom geometry, gridsize double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_ReducePrecision$function$
;

CREATE OR REPLACE FUNCTION public.st_relate(geom1 geometry, geom2 geometry, text)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$relate_pattern$function$
;

CREATE OR REPLACE FUNCTION public.st_relate(geom1 geometry, geom2 geometry)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$relate_full$function$
;

CREATE OR REPLACE FUNCTION public.st_relate(geom1 geometry, geom2 geometry, integer)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$relate_full$function$
;

CREATE OR REPLACE FUNCTION public.st_relatematch(text, text)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_RelateMatch$function$
;

CREATE OR REPLACE FUNCTION public.st_removeirrelevantpointsforview(geometry, box2d, boolean DEFAULT false)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_RemoveIrrelevantPointsForView$function$
;

CREATE OR REPLACE FUNCTION public.st_removepoint(geometry, integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_removepoint$function$
;

CREATE OR REPLACE FUNCTION public.st_removerepeatedpoints(geom geometry, tolerance double precision DEFAULT 0.0)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_RemoveRepeatedPoints$function$
;

CREATE OR REPLACE FUNCTION public.st_removesmallparts(geometry, double precision, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_RemoveSmallParts$function$
;

CREATE OR REPLACE FUNCTION public.st_resample(rast raster, ref raster, usescale boolean, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.st_resample($1, $2, $4, $5, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_resample(rast raster, ref raster, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125, usescale boolean DEFAULT true)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	DECLARE
		rastsrid int;

		_srid int;
		_dimx int;
		_dimy int;
		_scalex double precision;
		_scaley double precision;
		_gridx double precision;
		_gridy double precision;
		_skewx double precision;
		_skewy double precision;
	BEGIN
		SELECT srid, width, height, scalex, scaley, upperleftx, upperlefty, skewx, skewy INTO _srid, _dimx, _dimy, _scalex, _scaley, _gridx, _gridy, _skewx, _skewy FROM st_metadata($2);

		rastsrid := public.ST_SRID($1);

		-- both rasters must have the same SRID
		IF (rastsrid != _srid) THEN
			RAISE EXCEPTION 'The raster to be resampled has a different SRID from the reference raster';
			RETURN NULL;
		END IF;

		IF usescale IS TRUE THEN
			_dimx := NULL;
			_dimy := NULL;
		ELSE
			_scalex := NULL;
			_scaley := NULL;
		END IF;

		RETURN public._ST_gdalwarp($1, $3, $4, NULL, _scalex, _scaley, _gridx, _gridy, _skewx, _skewy, _dimx, _dimy);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_resample(rast raster, scalex double precision DEFAULT 0, scaley double precision DEFAULT 0, gridx double precision DEFAULT NULL::double precision, gridy double precision DEFAULT NULL::double precision, skewx double precision DEFAULT 0, skewy double precision DEFAULT 0, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_gdalwarp($1, $8,	$9, NULL, $2, $3, $4, $5, $6, $7) $function$
;

CREATE OR REPLACE FUNCTION public.st_resample(rast raster, width integer, height integer, gridx double precision DEFAULT NULL::double precision, gridy double precision DEFAULT NULL::double precision, skewx double precision DEFAULT 0, skewy double precision DEFAULT 0, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_gdalwarp($1, $8,	$9, NULL, NULL, NULL, $4, $5, $6, $7, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_rescale(rast raster, scalexy double precision, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT  public._ST_GdalWarp($1, $3, $4, NULL, $2, $2) $function$
;

CREATE OR REPLACE FUNCTION public.st_rescale(rast raster, scalex double precision, scaley double precision, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT  public._ST_GdalWarp($1, $4, $5, NULL, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_resize(rast raster, width integer, height integer, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_gdalwarp($1, $4, $5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, abs($2), abs($3)) $function$
;

CREATE OR REPLACE FUNCTION public.st_resize(rast raster, percentwidth double precision, percentheight double precision, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	DECLARE
		_width integer;
		_height integer;
	BEGIN
		-- range check
		IF $2 <= 0. OR $2 > 1. OR $3 <= 0. OR $3 > 1. THEN
			RAISE EXCEPTION 'Percentages must be a value greater than zero and less than or equal to one, e.g. 0.5 for 50%%';
		END IF;

		SELECT width, height INTO _width, _height FROM public.ST_Metadata($1);

		_width := round(_width::double precision * $2)::integer;
		_height:= round(_height::double precision * $3)::integer;

		IF _width < 1 THEN
			_width := 1;
		END IF;
		IF _height < 1 THEN
			_height := 1;
		END IF;

		RETURN public._ST_gdalwarp(
			$1,
			$4, $5,
			NULL,
			NULL, NULL,
			NULL, NULL,
			NULL, NULL,
			_width, _height
		);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_resize(rast raster, width text, height text, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	DECLARE
		i integer;

		wh text[2];

		whi integer[2];
		whd double precision[2];

		_width integer;
		_height integer;
	BEGIN
		wh[1] := trim(both from $2);
		wh[2] := trim(both from $3);

		-- see if width and height are percentages
		FOR i IN 1..2 LOOP
			IF position('%' in wh[i]) > 0 THEN
				BEGIN
					wh[i] := (regexp_matches(wh[i], E'^(\\d*.?\\d*)%{1}$'))[1];
					IF length(wh[i]) < 1 THEN
						RAISE invalid_parameter_value;
					END IF;

					whd[i] := wh[i]::double precision * 0.01;
				EXCEPTION WHEN OTHERS THEN -- TODO: WHEN invalid_parameter_value !
					RAISE EXCEPTION 'Invalid percentage value provided for width/height';
					RETURN NULL;
				END;
			ELSE
				BEGIN
					whi[i] := abs(wh[i]::integer);
				EXCEPTION WHEN OTHERS THEN -- TODO: only handle appropriate SQLSTATE
					RAISE EXCEPTION 'Non-integer value provided for width/height';
					RETURN NULL;
				END;
			END IF;
		END LOOP;

		IF whd[1] IS NOT NULL OR whd[2] IS NOT NULL THEN
			SELECT foo.width, foo.height INTO _width, _height FROM public.ST_Metadata($1) AS foo;

			IF whd[1] IS NOT NULL THEN
				whi[1] := round(_width::double precision * whd[1])::integer;
			END IF;

			IF whd[2] IS NOT NULL THEN
				whi[2] := round(_height::double precision * whd[2])::integer;
			END IF;

		END IF;

		-- should NEVER be here
		IF whi[1] IS NULL OR whi[2] IS NULL THEN
			RAISE EXCEPTION 'Unable to determine appropriate width or height';
			RETURN NULL;
		END IF;

		FOR i IN 1..2 LOOP
			IF whi[i] < 1 THEN
				whi[i] = 1;
			END IF;
		END LOOP;

		RETURN public._ST_gdalwarp(
			$1,
			$4, $5,
			NULL,
			NULL, NULL,
			NULL, NULL,
			NULL, NULL,
			whi[1], whi[2]
		);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_reskew(rast raster, skewx double precision, skewy double precision, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_GdalWarp($1, $4, $5, NULL, 0, 0, NULL, NULL, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_reskew(rast raster, skewxy double precision, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_GdalWarp($1, $3, $4, NULL, 0, 0, NULL, NULL, $2, $2) $function$
;

CREATE OR REPLACE FUNCTION public.st_retile(tab regclass, col name, ext geometry, sfx double precision, sfy double precision, tw integer, th integer, algo text DEFAULT 'NearestNeighbour'::text)
 RETURNS SETOF raster
 LANGUAGE plpgsql
 STABLE STRICT
AS $function$
DECLARE
  rec RECORD;
  ipx FLOAT8;
  ipy FLOAT8;
  tx int;
  ty int;
  te public.GEOMETRY; -- tile extent
  ncols int;
  nlins int;
  srid int;
  sql TEXT;
BEGIN

  RAISE DEBUG 'Target coverage will have sfx=%, sfy=%', sfx, sfy;

  -- 2. Loop over each target tile and build it from source tiles
  ipx := st_xmin(ext);
  ncols := ceil((public.st_xmax(ext)-ipx)/sfx/tw);
  IF sfy < 0 THEN
    ipy := public.st_ymax(ext);
    nlins := ceil((public.st_ymin(ext)-ipy)/sfy/th);
  ELSE
    ipy := public.st_ymin(ext);
    nlins := ceil((public.st_ymax(ext)-ipy)/sfy/th);
  END IF;

  srid := public.ST_Srid(ext);

  RAISE DEBUG 'Target coverage will have % x % tiles, each of approx size % x %', ncols, nlins, tw, th;
  RAISE DEBUG 'Target coverage will cover extent %', ext::box2d;

  FOR tx IN 0..ncols-1 LOOP
    FOR ty IN 0..nlins-1 LOOP
      te := public.ST_MakeEnvelope(ipx + tx     *  tw  * sfx,
                             ipy + ty     *  th  * sfy,
                             ipx + (tx+1) *  tw  * sfx,
                             ipy + (ty+1) *  th  * sfy,
                             srid);
      --RAISE DEBUG 'sfx/sfy: %, %', sfx, sfy;
      --RAISE DEBUG 'tile extent %', te;
      sql := 'SELECT count(*),  public.ST_Clip(  public.ST_Union(  public.ST_SnapToGrid(  public.ST_Rescale(  public.ST_Clip(' || quote_ident(col)
          || ',  public.ST_Expand($3, greatest($1,$2))),$1, $2, $6), $4, $5, $1, $2)), $3) g FROM ' || tab::text
          || ' WHERE  public.ST_Intersects(' || quote_ident(col) || ', $3)';
      --RAISE DEBUG 'SQL: %', sql;
      FOR rec IN EXECUTE sql USING sfx, sfy, te, ipx, ipy, algo LOOP
        --RAISE DEBUG '% source tiles intersect target tile %,% with extent %', rec.count, tx, ty, te::public.box2d;
        IF rec.g IS NULL THEN
          RAISE WARNING 'No source tiles cover target tile %,% with extent %',
            tx, ty, te::public.box2d;
        ELSE
          --RAISE DEBUG 'Tile for extent % has size % x %', te::public.box2d, public.st_width(rec.g), public.st_height(rec.g);
          RETURN NEXT rec.g;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.st_reverse(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_reverse$function$
;

CREATE OR REPLACE FUNCTION public.st_rotate(geometry, double precision, double precision, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_Affine($1,  cos($2), -sin($2), 0,  sin($2),  cos($2), 0, 0, 0, 1,	$3 - cos($2) * $3 + sin($2) * $4, $4 - sin($2) * $3 - cos($2) * $4, 0)$function$
;

CREATE OR REPLACE FUNCTION public.st_rotate(geometry, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_Affine($1,  cos($2), -sin($2), 0,  sin($2), cos($2), 0,  0, 0, 1,  0, 0, 0)$function$
;

CREATE OR REPLACE FUNCTION public.st_rotate(geometry, double precision, geometry)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_Affine($1,  cos($2), -sin($2), 0,  sin($2),  cos($2), 0, 0, 0, 1, public.ST_X($3) - cos($2) * public.ST_X($3) + sin($2) * public.ST_Y($3), public.ST_Y($3) - sin($2) * public.ST_X($3) - cos($2) * public.ST_Y($3), 0)$function$
;

CREATE OR REPLACE FUNCTION public.st_rotatex(geometry, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_Affine($1, 1, 0, 0, 0, cos($2), -sin($2), 0, sin($2), cos($2), 0, 0, 0)$function$
;

CREATE OR REPLACE FUNCTION public.st_rotatey(geometry, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_Affine($1,  cos($2), 0, sin($2),  0, 1, 0,  -sin($2), 0, cos($2), 0,  0, 0)$function$
;

CREATE OR REPLACE FUNCTION public.st_rotatez(geometry, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_Rotate($1, $2)$function$
;

CREATE OR REPLACE FUNCTION public.st_rotation(raster)
 RETURNS double precision
 LANGUAGE sql
AS $function$ SELECT ( public.ST_Geotransform($1)).theta_i $function$
;

CREATE OR REPLACE FUNCTION public.st_roughness(rast raster, nband integer DEFAULT 1, pixeltype text DEFAULT '32BF'::text, interpolate_nodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_roughness($1, $2, NULL::public.raster, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_roughness(rast raster, nband integer, customextent raster, pixeltype text DEFAULT '32BF'::text, interpolate_nodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		_rast public.raster;
		_nband integer;
		_pixtype text;
		_pixwidth double precision;
		_pixheight double precision;
		_width integer;
		_height integer;
		_customextent public.raster;
		_extenttype text;
	BEGIN
		_customextent := customextent;
		IF _customextent IS NULL THEN
			_extenttype := 'FIRST';
		ELSE
			_extenttype := 'CUSTOM';
		END IF;

		IF interpolate_nodata IS TRUE THEN
			_rast := public.ST_MapAlgebra(
				ARRAY[ROW(rast, nband)]::rastbandarg[],
				'public.st_invdistweight4ma(double precision[][][], integer[][], text[])'::regprocedure,
				pixeltype,
				'FIRST', NULL,
				1, 1
			);
			_nband := 1;
			_pixtype := NULL;
		ELSE
			_rast := rast;
			_nband := nband;
			_pixtype := pixeltype;
		END IF;

		RETURN public.ST_MapAlgebra(
			ARRAY[ROW(_rast, _nband)]::public.rastbandarg[],
			' public._ST_roughness4ma(double precision[][][], integer[][], text[])'::regprocedure,
			_pixtype,
			_extenttype, _customextent,
			1, 1);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_samealignment(rast1 raster, rast2 raster)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_sameAlignment$function$
;

CREATE OR REPLACE FUNCTION public.st_samealignment(ulx1 double precision, uly1 double precision, scalex1 double precision, scaley1 double precision, skewx1 double precision, skewy1 double precision, ulx2 double precision, uly2 double precision, scalex2 double precision, scaley2 double precision, skewx2 double precision, skewy2 double precision)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.st_samealignment(public.st_makeemptyraster(1, 1, $1, $2, $3, $4, $5, $6), public.st_makeemptyraster(1, 1, $7, $8, $9, $10, $11, $12)) $function$
;

CREATE OR REPLACE FUNCTION public.st_scale(geometry, geometry, origin geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_Scale$function$
;

CREATE OR REPLACE FUNCTION public.st_scale(geometry, double precision, double precision, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_Scale($1, public.ST_MakePoint($2, $3, $4))$function$
;

CREATE OR REPLACE FUNCTION public.st_scale(geometry, double precision, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_Scale($1, $2, $3, 1)$function$
;

CREATE OR REPLACE FUNCTION public.st_scale(geometry, geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_Scale$function$
;

CREATE OR REPLACE FUNCTION public.st_scalex(raster)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getXScale$function$
;

CREATE OR REPLACE FUNCTION public.st_scaley(raster)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getYScale$function$
;

CREATE OR REPLACE FUNCTION public.st_scroll(geometry, geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_Scroll$function$
;

CREATE OR REPLACE FUNCTION public.st_segmentize(geog geography, max_segment_length double precision)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$geography_segmentize$function$
;

CREATE OR REPLACE FUNCTION public.st_segmentize(geometry, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_segmentize2d$function$
;

CREATE OR REPLACE FUNCTION public.st_setbandindex(rast raster, band integer, outdbindex integer, force boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.ST_SetBandPath($1, $2, NULL, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_setbandisnodata(rast raster, band integer DEFAULT 1)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_setBandIsNoData$function$
;

CREATE OR REPLACE FUNCTION public.st_setbandnodatavalue(rast raster, band integer, nodatavalue double precision, forcechecking boolean DEFAULT false)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_setBandNoDataValue$function$
;

CREATE OR REPLACE FUNCTION public.st_setbandnodatavalue(rast raster, nodatavalue double precision)
 RETURNS raster
 LANGUAGE sql
AS $function$ SELECT public.ST_setbandnodatavalue($1, 1, $2, FALSE) $function$
;

CREATE OR REPLACE FUNCTION public.st_setbandpath(rast raster, band integer, outdbpath text, outdbindex integer, force boolean DEFAULT false)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_setBandPath$function$
;

CREATE OR REPLACE FUNCTION public.st_seteffectivearea(geometry, double precision DEFAULT '-1'::integer, integer DEFAULT 1)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$LWGEOM_SetEffectiveArea$function$
;

CREATE OR REPLACE FUNCTION public.st_setgeoreference(rast raster, georef text, format text DEFAULT 'GDAL'::text)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
    DECLARE
        params text[];
        rastout public.raster;
    BEGIN
        IF rast IS NULL THEN
            RAISE WARNING 'Cannot set georeferencing on a null raster in st_setgeoreference.';
            RETURN rastout;
        END IF;

        SELECT regexp_matches(georef,
            E'(-?\\d+(?:\\.\\d+)?)\\s(-?\\d+(?:\\.\\d+)?)\\s(-?\\d+(?:\\.\\d+)?)\\s' ||
            E'(-?\\d+(?:\\.\\d+)?)\\s(-?\\d+(?:\\.\\d+)?)\\s(-?\\d+(?:\\.\\d+)?)') INTO params;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'st_setgeoreference requires a string with 6 floating point values.';
        END IF;

        IF format = 'ESRI' THEN
            -- params array is now:
            -- {scalex, skewy, skewx, scaley, upperleftx, upperlefty}
            rastout := public.ST_setscale(rast, params[1]::float8, params[4]::float8);
            rastout := public.ST_setskew(rastout, params[3]::float8, params[2]::float8);
            rastout := public.ST_setupperleft(rastout,
                                   params[5]::float8 - (params[1]::float8 * 0.5),
                                   params[6]::float8 - (params[4]::float8 * 0.5));
        ELSE
            IF format != 'GDAL' THEN
                RAISE WARNING 'Format ''%'' is not recognized, defaulting to GDAL format.', format;
            END IF;
            -- params array is now:
            -- {scalex, skewy, skewx, scaley, upperleftx, upperlefty}

            rastout := public.ST_setscale(rast, params[1]::float8, params[4]::float8);
            rastout := public.ST_setskew( rastout, params[3]::float8, params[2]::float8);
            rastout := public.ST_setupperleft(rastout, params[5]::float8, params[6]::float8);
        END IF;
        RETURN rastout;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.st_setgeoreference(rast raster, upperleftx double precision, upperlefty double precision, scalex double precision, scaley double precision, skewx double precision, skewy double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.ST_setgeoreference($1, array_to_string(ARRAY[$4, $7, $6, $5, $2, $3], ' ')) $function$
;

CREATE OR REPLACE FUNCTION public.st_setgeotransform(rast raster, imag double precision, jmag double precision, theta_i double precision, theta_ij double precision, xoffset double precision, yoffset double precision)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_setGeotransform$function$
;

CREATE OR REPLACE FUNCTION public.st_setm(rast raster, geom geometry, resample text DEFAULT 'nearest'::text, band integer DEFAULT 1)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getGeometryValues$function$
;

CREATE OR REPLACE FUNCTION public.st_setpoint(geometry, integer, geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_setpoint_linestring$function$
;

CREATE OR REPLACE FUNCTION public.st_setrotation(rast raster, rotation double precision)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_setRotation$function$
;

CREATE OR REPLACE FUNCTION public.st_setscale(rast raster, scale double precision)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_setScale$function$
;

CREATE OR REPLACE FUNCTION public.st_setscale(rast raster, scalex double precision, scaley double precision)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_setScaleXY$function$
;

CREATE OR REPLACE FUNCTION public.st_setskew(rast raster, skewx double precision, skewy double precision)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_setSkewXY$function$
;

CREATE OR REPLACE FUNCTION public.st_setskew(rast raster, skew double precision)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_setSkew$function$
;

CREATE OR REPLACE FUNCTION public.st_setsrid(geog geography, srid integer)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_set_srid$function$
;

CREATE OR REPLACE FUNCTION public.st_setsrid(geom geometry, srid integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_set_srid$function$
;

CREATE OR REPLACE FUNCTION public.st_setsrid(rast raster, srid integer)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_setSRID$function$
;

CREATE OR REPLACE FUNCTION public.st_setupperleft(rast raster, upperleftx double precision, upperlefty double precision)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_setUpperLeftXY$function$
;

CREATE OR REPLACE FUNCTION public.st_setvalue(rast raster, nband integer, geom geometry, newvalue double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_setvalues($1, $2, ARRAY[ROW($3, $4)]::geomval[], FALSE) $function$
;

CREATE OR REPLACE FUNCTION public.st_setvalue(rast raster, x integer, y integer, newvalue double precision)
 RETURNS raster
 LANGUAGE sql
AS $function$ SELECT public.ST_SetValue($1, 1, $2, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_setvalue(rast raster, band integer, x integer, y integer, newvalue double precision)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_setPixelValue$function$
;

CREATE OR REPLACE FUNCTION public.st_setvalue(rast raster, geom geometry, newvalue double precision)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_setvalues($1, 1, ARRAY[ROW($2, $3)]::geomval[], FALSE) $function$
;

CREATE OR REPLACE FUNCTION public.st_setvalues(rast raster, nband integer, x integer, y integer, newvalueset double precision[], nosetvalue double precision, keepnodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_setvalues($1, $2, $3, $4, $5, NULL, TRUE, $6, $7) $function$
;

CREATE OR REPLACE FUNCTION public.st_setvalues(rast raster, nband integer, x integer, y integer, width integer, height integer, newvalue double precision, keepnodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	BEGIN
		IF width <= 0 OR height <= 0 THEN
			RAISE EXCEPTION 'Values for width and height must be greater than zero';
			RETURN NULL;
		END IF;
		RETURN public._ST_setvalues($1, $2, $3, $4, array_fill($7, ARRAY[$6, $5]::int[]), NULL, FALSE, NULL, $8);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_setvalues(rast raster, nband integer, geomvalset geomval[], keepnodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/postgis_raster-3', $function$RASTER_setPixelValuesGeomval$function$
;

CREATE OR REPLACE FUNCTION public.st_setvalues(rast raster, x integer, y integer, width integer, height integer, newvalue double precision, keepnodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	BEGIN
		IF width <= 0 OR height <= 0 THEN
			RAISE EXCEPTION 'Values for width and height must be greater than zero';
			RETURN NULL;
		END IF;
		RETURN public._ST_setvalues($1, 1, $2, $3, array_fill($6, ARRAY[$5, $4]::int[]), NULL, FALSE, NULL, $7);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_setvalues(rast raster, nband integer, x integer, y integer, newvalueset double precision[], noset boolean[] DEFAULT NULL::boolean[], keepnodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_setvalues($1, $2, $3, $4, $5, $6, FALSE, NULL, $7) $function$
;

CREATE OR REPLACE FUNCTION public.st_setz(rast raster, geom geometry, resample text DEFAULT 'nearest'::text, band integer DEFAULT 1)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getGeometryValues$function$
;

CREATE OR REPLACE FUNCTION public.st_sharedpaths(geom1 geometry, geom2 geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_SharedPaths$function$
;

CREATE OR REPLACE FUNCTION public.st_shiftlongitude(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_longitude_shift$function$
;

CREATE OR REPLACE FUNCTION public.st_shortestline(text, text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_ShortestLine($1::public.geometry, $2::public.geometry);  $function$
;

CREATE OR REPLACE FUNCTION public.st_shortestline(geography, geography, use_spheroid boolean DEFAULT true)
 RETURNS geography
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$geography_shortestline$function$
;

CREATE OR REPLACE FUNCTION public.st_shortestline(geom1 geometry, geom2 geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_shortestline2d$function$
;

CREATE OR REPLACE FUNCTION public.st_simplify(geometry, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_simplify2d$function$
;

CREATE OR REPLACE FUNCTION public.st_simplify(geometry, double precision, boolean)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_simplify2d$function$
;

CREATE OR REPLACE FUNCTION public.st_simplifypolygonhull(geom geometry, vertex_fraction double precision, is_outer boolean DEFAULT true)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_SimplifyPolygonHull$function$
;

CREATE OR REPLACE FUNCTION public.st_simplifypreservetopology(geometry, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$topologypreservesimplify$function$
;

CREATE OR REPLACE FUNCTION public.st_simplifyvw(geometry, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$LWGEOM_SetEffectiveArea$function$
;

CREATE OR REPLACE FUNCTION public.st_skewx(raster)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getXSkew$function$
;

CREATE OR REPLACE FUNCTION public.st_skewy(raster)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getYSkew$function$
;

CREATE OR REPLACE FUNCTION public.st_slope(rast raster, nband integer DEFAULT 1, pixeltype text DEFAULT '32BF'::text, units text DEFAULT 'DEGREES'::text, scale double precision DEFAULT 1.0, interpolate_nodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_slope($1, $2, NULL::public.raster, $3, $4, $5, $6) $function$
;

CREATE OR REPLACE FUNCTION public.st_slope(rast raster, nband integer, customextent raster, pixeltype text DEFAULT '32BF'::text, units text DEFAULT 'DEGREES'::text, scale double precision DEFAULT 1.0, interpolate_nodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		_rast public.raster;
		_nband integer;
		_pixtype text;
		_pixwidth double precision;
		_pixheight double precision;
		_width integer;
		_height integer;
		_customextent public.raster;
		_extenttype text;
	BEGIN
		_customextent := customextent;
		IF _customextent IS NULL THEN
			_extenttype := 'FIRST';
		ELSE
			_extenttype := 'CUSTOM';
		END IF;

		IF interpolate_nodata IS TRUE THEN
			_rast := public.ST_MapAlgebra(
				ARRAY[ROW(rast, nband)]::rastbandarg[],
				'public.st_invdistweight4ma(double precision[][][], integer[][], text[])'::regprocedure,
				pixeltype,
				'FIRST', NULL,
				1, 1
			);
			_nband := 1;
			_pixtype := NULL;
		ELSE
			_rast := rast;
			_nband := nband;
			_pixtype := pixeltype;
		END IF;

		-- get properties
		_pixwidth := public.ST_PixelWidth(_rast);
		_pixheight := public.ST_PixelHeight(_rast);
		SELECT width, height INTO _width, _height FROM public.ST_Metadata(_rast);

		RETURN public.ST_MapAlgebra(
			ARRAY[ROW(_rast, _nband)]::rastbandarg[],
			' public._ST_slope4ma(double precision[][][], integer[][], text[])'::regprocedure,
			_pixtype,
			_extenttype, _customextent,
			1, 1,
			_pixwidth::text, _pixheight::text,
			_width::text, _height::text,
			units::text, scale::text
		);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_snap(geom1 geometry, geom2 geometry, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_Snap$function$
;

CREATE OR REPLACE FUNCTION public.st_snaptogrid(rast raster, gridx double precision, gridy double precision, scalexy double precision, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_gdalwarp($1, $5, $6, NULL, $4, $4, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_snaptogrid(geom1 geometry, geom2 geometry, double precision, double precision, double precision, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_snaptogrid_pointoff$function$
;

CREATE OR REPLACE FUNCTION public.st_snaptogrid(geometry, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_SnapToGrid($1, 0, 0, $2, $2)$function$
;

CREATE OR REPLACE FUNCTION public.st_snaptogrid(geometry, double precision, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_SnapToGrid($1, 0, 0, $2, $3)$function$
;

CREATE OR REPLACE FUNCTION public.st_snaptogrid(geometry, double precision, double precision, double precision, double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_snaptogrid$function$
;

CREATE OR REPLACE FUNCTION public.st_snaptogrid(rast raster, gridx double precision, gridy double precision, scalex double precision, scaley double precision, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_gdalwarp($1, $6, $7, NULL, $4, $5, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_snaptogrid(rast raster, gridx double precision, gridy double precision, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125, scalex double precision DEFAULT 0, scaley double precision DEFAULT 0)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_GdalWarp($1, $4, $5, NULL, $6, $7, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_split(geom1 geometry, geom2 geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_Split$function$
;

CREATE OR REPLACE FUNCTION public.st_square(size double precision, cell_i integer, cell_j integer, origin geometry DEFAULT '010100000000000000000000000000000000000000'::geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_Square$function$
;

CREATE OR REPLACE FUNCTION public.st_squaregrid(size double precision, bounds geometry, OUT geom geometry, OUT i integer, OUT j integer)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$ST_ShapeGrid$function$
;

CREATE OR REPLACE FUNCTION public.st_srid(geog geography)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_get_srid$function$
;

CREATE OR REPLACE FUNCTION public.st_srid(geom geometry)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_get_srid$function$
;

CREATE OR REPLACE FUNCTION public.st_srid(raster)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getSRID$function$
;

CREATE OR REPLACE FUNCTION public.st_startpoint(geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_startpoint_linestring$function$
;

CREATE OR REPLACE FUNCTION public.st_stddev4ma(value double precision[], pos integer[], VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT stddev(unnest) FROM unnest($1) $function$
;

CREATE OR REPLACE FUNCTION public.st_stddev4ma(matrix double precision[], nodatamode text, VARIADIC args text[])
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT stddev(unnest) FROM unnest($1) $function$
;

CREATE OR REPLACE FUNCTION public.st_subdivide(geom geometry, maxvertices integer DEFAULT 256, gridsize double precision DEFAULT '-1.0'::numeric)
 RETURNS SETOF geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_Subdivide$function$
;

CREATE OR REPLACE FUNCTION public.st_sum4ma(value double precision[], pos integer[], VARIADIC userargs text[] DEFAULT NULL::text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		_value double precision[][][];
		sum double precision;
		x int;
		y int;
		z int;
		ndims int;
	BEGIN
		sum := 0;

		ndims := array_ndims(value);
		-- add a third dimension if 2-dimension
		IF ndims = 2 THEN
			_value := public._ST_convertarray4ma(value);
		ELSEIF ndims != 3 THEN
			RAISE EXCEPTION 'First parameter of function must be a 3-dimension array';
		ELSE
			_value := value;
		END IF;

		-- raster
		FOR z IN array_lower(_value, 1)..array_upper(_value, 1) LOOP
			-- row
			FOR y IN array_lower(_value, 2)..array_upper(_value, 2) LOOP
				-- column
				FOR x IN array_lower(_value, 3)..array_upper(_value, 3) LOOP
					IF _value[z][y][x] IS NULL THEN
						IF array_length(userargs, 1) > 0 THEN
							_value[z][y][x] = userargs[array_lower(userargs, 1)]::double precision;
						ELSE
							CONTINUE;
						END IF;
					END IF;

					sum := sum + _value[z][y][x];
				END LOOP;
			END LOOP;
		END LOOP;

		RETURN sum;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_sum4ma(matrix double precision[], nodatamode text, VARIADIC args text[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
    DECLARE
        _matrix float[][];
        sum float;
    BEGIN
        _matrix := matrix;
        sum := 0;
        FOR x in array_lower(matrix, 1)..array_upper(matrix, 1) LOOP
            FOR y in array_lower(matrix, 2)..array_upper(matrix, 2) LOOP
                IF _matrix[x][y] IS NULL THEN
                    IF nodatamode = 'ignore' THEN
                        _matrix[x][y] := 0;
                    ELSE
                        _matrix[x][y] := nodatamode::float;
                    END IF;
                END IF;
                sum := sum + _matrix[x][y];
            END LOOP;
        END LOOP;
        RETURN sum;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.st_summary(rast raster)
 RETURNS text
 LANGUAGE plpgsql
 STABLE STRICT
AS $function$
	DECLARE
		extent box2d;
		metadata record;
		bandmetadata record;
		msg text;
		msgset text[];
	BEGIN
		extent := public.ST_Extent(rast::geometry);
		metadata := public.ST_Metadata(rast);

		msg := 'Raster of ' || metadata.width || 'x' || metadata.height || ' pixels has ' || metadata.numbands || ' ';

		IF metadata.numbands = 1 THEN
			msg := msg || 'band ';
		ELSE
			msg := msg || 'bands ';
		END IF;
		msg := msg || 'and extent of ' || extent;

		IF
			round(metadata.skewx::numeric, 10) <> round(0::numeric, 10) OR
			round(metadata.skewy::numeric, 10) <> round(0::numeric, 10)
		THEN
			msg := 'Skewed ' || overlay(msg placing 'r' from 1 for 1);
		END IF;

		msgset := Array[]::text[] || msg;

		FOR bandmetadata IN SELECT * FROM public.ST_BandMetadata(rast, ARRAY[]::int[]) LOOP
			msg := 'band ' || bandmetadata.bandnum || ' of pixtype ' || bandmetadata.pixeltype || ' is ';
			IF bandmetadata.isoutdb IS FALSE THEN
				msg := msg || 'in-db ';
			ELSE
				msg := msg || 'out-db ';
			END IF;

			msg := msg || 'with ';
			IF bandmetadata.nodatavalue IS NOT NULL THEN
				msg := msg || 'NODATA value of ' || bandmetadata.nodatavalue;
			ELSE
				msg := msg || 'no NODATA value';
			END IF;

			msgset := msgset || ('    ' || msg);
		END LOOP;

		RETURN array_to_string(msgset, E'\n');
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_summary(geography)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_summary$function$
;

CREATE OR REPLACE FUNCTION public.st_summary(geometry)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_summary$function$
;

CREATE OR REPLACE FUNCTION public.st_summarystats(rast raster, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true)
 RETURNS summarystats
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_summarystats($1, $2, $3, 1) $function$
;

CREATE OR REPLACE FUNCTION public.st_summarystats(rast raster, exclude_nodata_value boolean)
 RETURNS summarystats
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_summarystats($1, 1, $2, 1) $function$
;

CREATE OR REPLACE FUNCTION public.st_swapordinates(geom geometry, ords cstring)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_SwapOrdinates$function$
;

CREATE OR REPLACE FUNCTION public.st_symdifference(geom1 geometry, geom2 geometry, gridsize double precision DEFAULT '-1.0'::numeric)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_SymDifference$function$
;

CREATE OR REPLACE FUNCTION public.st_symmetricdifference(geom1 geometry, geom2 geometry)
 RETURNS geometry
 LANGUAGE sql
AS $function$SELECT public.ST_SymDifference(geom1, geom2, -1.0);$function$
;

CREATE OR REPLACE FUNCTION public.st_tile(rast raster, width integer, height integer, padwithnodata boolean DEFAULT false, nodataval double precision DEFAULT NULL::double precision)
 RETURNS SETOF raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_tile($1, $2, $3, NULL::integer[], $4, $5) $function$
;

CREATE OR REPLACE FUNCTION public.st_tile(rast raster, nband integer[], width integer, height integer, padwithnodata boolean DEFAULT false, nodataval double precision DEFAULT NULL::double precision)
 RETURNS SETOF raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_tile($1, $3, $4, $2, $5, $6) $function$
;

CREATE OR REPLACE FUNCTION public.st_tile(rast raster, nband integer, width integer, height integer, padwithnodata boolean DEFAULT false, nodataval double precision DEFAULT NULL::double precision)
 RETURNS SETOF raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_tile($1, $3, $4, ARRAY[$2]::integer[], $5, $6) $function$
;

CREATE OR REPLACE FUNCTION public.st_tileenvelope(zoom integer, x integer, y integer, bounds geometry DEFAULT '0102000020110F00000200000093107C45F81B73C193107C45F81B73C193107C45F81B734193107C45F81B7341'::geometry, margin double precision DEFAULT 0.0)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_TileEnvelope$function$
;

CREATE OR REPLACE FUNCTION public.st_touches(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$touches$function$
;

CREATE OR REPLACE FUNCTION public.st_touches(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT $1 OPERATOR(public.&&) $3 AND CASE WHEN $2 IS NULL OR $4 IS NULL THEN public._st_touches(public.st_convexhull($1), public.st_convexhull($3)) ELSE public._st_touches($1, $2, $3, $4) END $function$
;

CREATE OR REPLACE FUNCTION public.st_touches(rast1 raster, rast2 raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT public.st_touches($1, NULL::integer, $2, NULL::integer) $function$
;

CREATE OR REPLACE FUNCTION public.st_tpi(rast raster, nband integer, customextent raster, pixeltype text DEFAULT '32BF'::text, interpolate_nodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		_rast public.raster;
		_nband integer;
		_pixtype text;
		_pixwidth double precision;
		_pixheight double precision;
		_width integer;
		_height integer;
		_customextent public.raster;
		_extenttype text;
	BEGIN
		_customextent := customextent;
		IF _customextent IS NULL THEN
			_extenttype := 'FIRST';
		ELSE
			_extenttype := 'CUSTOM';
		END IF;

		IF interpolate_nodata IS TRUE THEN
			_rast := public.ST_MapAlgebra(
				ARRAY[ROW(rast, nband)]::rastbandarg[],
				'public.st_invdistweight4ma(double precision[][][], integer[][], text[])'::regprocedure,
				pixeltype,
				'FIRST', NULL,
				1, 1
			);
			_nband := 1;
			_pixtype := NULL;
		ELSE
			_rast := rast;
			_nband := nband;
			_pixtype := pixeltype;
		END IF;

		-- get properties
		_pixwidth := public.ST_PixelWidth(_rast);
		_pixheight := public.ST_PixelHeight(_rast);
		SELECT width, height INTO _width, _height FROM public.ST_Metadata(_rast);

		RETURN public.ST_MapAlgebra(
			ARRAY[ROW(_rast, _nband)]::rastbandarg[],
			' public._ST_tpi4ma(double precision[][][], integer[][], text[])'::regprocedure,
			_pixtype,
			_extenttype, _customextent,
			1, 1);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_tpi(rast raster, nband integer DEFAULT 1, pixeltype text DEFAULT '32BF'::text, interpolate_nodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_tpi($1, $2, NULL::public.raster, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_transform(geom geometry, to_proj text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS $function$SELECT public.postgis_transform_geometry($1, proj4text, $2, 0)
	FROM public.spatial_ref_sys WHERE srid=public.ST_SRID($1);$function$
;

CREATE OR REPLACE FUNCTION public.st_transform(geometry, integer)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$transform$function$
;

CREATE OR REPLACE FUNCTION public.st_transform(rast raster, srid integer, scalexy double precision, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_gdalwarp($1, $4, $5, $2, $3, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_transform(geom geometry, from_proj text, to_srid integer)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS $function$SELECT public.postgis_transform_geometry($1, $2, proj4text, $3)
	FROM public.spatial_ref_sys WHERE srid=$3;$function$
;

CREATE OR REPLACE FUNCTION public.st_transform(geom geometry, from_proj text, to_proj text)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS $function$SELECT public.postgis_transform_geometry($1, $2, $3, 0)$function$
;

CREATE OR REPLACE FUNCTION public.st_transform(rast raster, alignto raster, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	DECLARE
		_srid integer;
		_scalex double precision;
		_scaley double precision;
		_gridx double precision;
		_gridy double precision;
		_skewx double precision;
		_skewy double precision;
	BEGIN
		SELECT srid, scalex, scaley, upperleftx, upperlefty, skewx, skewy INTO _srid, _scalex, _scaley, _gridx, _gridy, _skewx, _skewy FROM st_metadata($2);

		RETURN public._ST_gdalwarp($1, $3, $4, _srid, _scalex, _scaley, _gridx, _gridy, _skewx, _skewy, NULL, NULL);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_transform(rast raster, srid integer, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125, scalex double precision DEFAULT 0, scaley double precision DEFAULT 0)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_gdalwarp($1, $3, $4, $2, $5, $6) $function$
;

CREATE OR REPLACE FUNCTION public.st_transform(rast raster, srid integer, scalex double precision, scaley double precision, algorithm text DEFAULT 'NearestNeighbour'::text, maxerr double precision DEFAULT 0.125)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public._ST_gdalwarp($1, $5, $6, $2, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_transformpipeline(geom geometry, pipeline text, to_srid integer DEFAULT 0)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS $function$SELECT public.postgis_transform_pipeline_geometry($1, $2, TRUE, $3)$function$
;

CREATE OR REPLACE FUNCTION public.st_translate(geometry, double precision, double precision, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_Affine($1, 1, 0, 0, 0, 1, 0, 0, 0, 1, $2, $3, $4)$function$
;

CREATE OR REPLACE FUNCTION public.st_translate(geometry, double precision, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_Translate($1, $2, $3, 0)$function$
;

CREATE OR REPLACE FUNCTION public.st_transscale(geometry, double precision, double precision, double precision, double precision)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS $function$SELECT public.ST_Affine($1,  $4, 0, 0,  0, $5, 0,
		0, 0, 1,  $2 * $4, $3 * $5, 0)$function$
;

CREATE OR REPLACE FUNCTION public.st_tri(rast raster, nband integer, customextent raster, pixeltype text DEFAULT '32BF'::text, interpolate_nodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
	DECLARE
		_rast public.raster;
		_nband integer;
		_pixtype text;
		_pixwidth double precision;
		_pixheight double precision;
		_width integer;
		_height integer;
		_customextent public.raster;
		_extenttype text;
	BEGIN
		_customextent := customextent;
		IF _customextent IS NULL THEN
			_extenttype := 'FIRST';
		ELSE
			_extenttype := 'CUSTOM';
		END IF;

		IF interpolate_nodata IS TRUE THEN
			_rast := public.ST_MapAlgebra(
				ARRAY[ROW(rast, nband)]::rastbandarg[],
				'public.st_invdistweight4ma(double precision[][][], integer[][], text[])'::regprocedure,
				pixeltype,
				'FIRST', NULL,
				1, 1
			);
			_nband := 1;
			_pixtype := NULL;
		ELSE
			_rast := rast;
			_nband := nband;
			_pixtype := pixeltype;
		END IF;

		-- get properties
		_pixwidth := public.ST_PixelWidth(_rast);
		_pixheight := public.ST_PixelHeight(_rast);
		SELECT width, height INTO _width, _height FROM public.ST_Metadata(_rast);

		RETURN public.ST_MapAlgebra(
			ARRAY[ROW(_rast, _nband)]::rastbandarg[],
			' public._ST_tri4ma(double precision[][][], integer[][], text[])'::regprocedure,
			_pixtype,
			_extenttype, _customextent,
			1, 1);
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_tri(rast raster, nband integer DEFAULT 1, pixeltype text DEFAULT '32BF'::text, interpolate_nodata boolean DEFAULT false)
 RETURNS raster
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public.ST_tri($1, $2, NULL::public.raster, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_triangulatepolygon(g1 geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_TriangulatePolygon$function$
;

CREATE OR REPLACE FUNCTION public.st_unaryunion(geometry, gridsize double precision DEFAULT '-1.0'::numeric)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_UnaryUnion$function$
;

CREATE OR REPLACE FUNCTION public.st_union(geom1 geometry, geom2 geometry)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_Union$function$
;

CREATE OR REPLACE FUNCTION public.st_union(geometry[])
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$pgis_union_geometry_array$function$
;

CREATE OR REPLACE FUNCTION public.st_union(geom1 geometry, geom2 geometry, gridsize double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000
AS '$libdir/postgis-3', $function$ST_Union$function$
;

CREATE OR REPLACE FUNCTION public.st_upperleftx(raster)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getXUpperLeft$function$
;

CREATE OR REPLACE FUNCTION public.st_upperlefty(raster)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getYUpperLeft$function$
;

CREATE OR REPLACE FUNCTION public.st_value(rast raster, band integer, pt geometry, exclude_nodata_value boolean DEFAULT true, resample text DEFAULT 'nearest'::text)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis_raster-3', $function$RASTER_getPixelValueResample$function$
;

CREATE OR REPLACE FUNCTION public.st_value(rast raster, pt geometry, exclude_nodata_value boolean DEFAULT true)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$ SELECT public.ST_value($1, 1::integer, $2, $3, 'nearest'::text) $function$
;

CREATE OR REPLACE FUNCTION public.st_value(rast raster, x integer, y integer, exclude_nodata_value boolean DEFAULT true)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS $function$ SELECT public.st_value($1, 1::integer, $2, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_value(rast raster, band integer, x integer, y integer, exclude_nodata_value boolean DEFAULT true)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getPixelValue$function$
;

CREATE OR REPLACE FUNCTION public.st_valuecount(rast raster, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, searchvalues double precision[] DEFAULT NULL::double precision[], roundto double precision DEFAULT 0, OUT value double precision, OUT count integer)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT value, count FROM public._ST_valuecount($1, $2, $3, $4, $5) $function$
;

CREATE OR REPLACE FUNCTION public.st_valuecount(rastertable text, rastercolumn text, searchvalue double precision, roundto double precision DEFAULT 0)
 RETURNS integer
 LANGUAGE sql
 STABLE STRICT
AS $function$ SELECT ( public._ST_valuecount($1, $2, 1, TRUE, ARRAY[$3]::double precision[], $4)).count $function$
;

CREATE OR REPLACE FUNCTION public.st_valuecount(rastertable text, rastercolumn text, nband integer, searchvalue double precision, roundto double precision DEFAULT 0)
 RETURNS integer
 LANGUAGE sql
 STABLE STRICT
AS $function$ SELECT ( public._ST_valuecount($1, $2, $3, TRUE, ARRAY[$4]::double precision[], $5)).count $function$
;

CREATE OR REPLACE FUNCTION public.st_valuecount(rastertable text, rastercolumn text, nband integer, exclude_nodata_value boolean, searchvalue double precision, roundto double precision DEFAULT 0)
 RETURNS integer
 LANGUAGE sql
 STABLE STRICT
AS $function$ SELECT ( public._ST_valuecount($1, $2, $3, $4, ARRAY[$5]::double precision[], $6)).count $function$
;

CREATE OR REPLACE FUNCTION public.st_valuecount(rastertable text, rastercolumn text, searchvalues double precision[], roundto double precision DEFAULT 0, OUT value double precision, OUT count integer)
 RETURNS SETOF record
 LANGUAGE sql
 STABLE
AS $function$ SELECT value, count FROM public._ST_valuecount($1, $2, 1, TRUE, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_valuecount(rastertable text, rastercolumn text, nband integer, searchvalues double precision[], roundto double precision DEFAULT 0, OUT value double precision, OUT count integer)
 RETURNS SETOF record
 LANGUAGE sql
 STABLE
AS $function$ SELECT value, count FROM public._ST_valuecount($1, $2, $3, TRUE, $4, $5) $function$
;

CREATE OR REPLACE FUNCTION public.st_valuecount(rastertable text, rastercolumn text, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, searchvalues double precision[] DEFAULT NULL::double precision[], roundto double precision DEFAULT 0, OUT value double precision, OUT count integer)
 RETURNS SETOF record
 LANGUAGE sql
 STABLE
AS $function$ SELECT value, count FROM public._ST_valuecount($1, $2, $3, $4, $5, $6) $function$
;

CREATE OR REPLACE FUNCTION public.st_valuecount(rast raster, searchvalue double precision, roundto double precision DEFAULT 0)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT ( public._ST_valuecount($1, 1, TRUE, ARRAY[$2]::double precision[], $3)).count $function$
;

CREATE OR REPLACE FUNCTION public.st_valuecount(rast raster, nband integer, searchvalue double precision, roundto double precision DEFAULT 0)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT ( public._ST_valuecount($1, $2, TRUE, ARRAY[$3]::double precision[], $4)).count $function$
;

CREATE OR REPLACE FUNCTION public.st_valuecount(rast raster, nband integer, exclude_nodata_value boolean, searchvalue double precision, roundto double precision DEFAULT 0)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT ( public._ST_valuecount($1, $2, $3, ARRAY[$4]::double precision[], $5)).count $function$
;

CREATE OR REPLACE FUNCTION public.st_valuecount(rast raster, searchvalues double precision[], roundto double precision DEFAULT 0, OUT value double precision, OUT count integer)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT value, count FROM public._ST_valuecount($1, 1, TRUE, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_valuecount(rast raster, nband integer, searchvalues double precision[], roundto double precision DEFAULT 0, OUT value double precision, OUT count integer)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT value, count FROM public._ST_valuecount($1, $2, TRUE, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_valuepercent(rastertable text, rastercolumn text, searchvalue double precision, roundto double precision DEFAULT 0)
 RETURNS double precision
 LANGUAGE sql
 STABLE STRICT
AS $function$ SELECT ( public._ST_valuecount($1, $2, 1, TRUE, ARRAY[$3]::double precision[], $4)).percent $function$
;

CREATE OR REPLACE FUNCTION public.st_valuepercent(rastertable text, rastercolumn text, searchvalues double precision[], roundto double precision DEFAULT 0, OUT value double precision, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STABLE
AS $function$ SELECT value, percent FROM public._ST_valuecount($1, $2, 1, TRUE, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_valuepercent(rast raster, searchvalue double precision, roundto double precision DEFAULT 0)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT ( public._ST_valuecount($1, 1, TRUE, ARRAY[$2]::double precision[], $3)).percent $function$
;

CREATE OR REPLACE FUNCTION public.st_valuepercent(rast raster, nband integer, searchvalue double precision, roundto double precision DEFAULT 0)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT ( public._ST_valuecount($1, $2, TRUE, ARRAY[$3]::double precision[], $4)).percent $function$
;

CREATE OR REPLACE FUNCTION public.st_valuepercent(rastertable text, rastercolumn text, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, searchvalues double precision[] DEFAULT NULL::double precision[], roundto double precision DEFAULT 0, OUT value double precision, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STABLE
AS $function$ SELECT value, percent FROM public._ST_valuecount($1, $2, $3, $4, $5, $6) $function$
;

CREATE OR REPLACE FUNCTION public.st_valuepercent(rast raster, nband integer, exclude_nodata_value boolean, searchvalue double precision, roundto double precision DEFAULT 0)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT ( public._ST_valuecount($1, $2, $3, ARRAY[$4]::double precision[], $5)).percent $function$
;

CREATE OR REPLACE FUNCTION public.st_valuepercent(rast raster, searchvalues double precision[], roundto double precision DEFAULT 0, OUT value double precision, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT value, percent FROM public._ST_valuecount($1, 1, TRUE, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_valuepercent(rast raster, nband integer, searchvalues double precision[], roundto double precision DEFAULT 0, OUT value double precision, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT value, percent FROM public._ST_valuecount($1, $2, TRUE, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.st_valuepercent(rast raster, nband integer DEFAULT 1, exclude_nodata_value boolean DEFAULT true, searchvalues double precision[] DEFAULT NULL::double precision[], roundto double precision DEFAULT 0, OUT value double precision, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT value, percent FROM public._ST_valuecount($1, $2, $3, $4, $5) $function$
;

CREATE OR REPLACE FUNCTION public.st_valuepercent(rastertable text, rastercolumn text, nband integer, searchvalues double precision[], roundto double precision DEFAULT 0, OUT value double precision, OUT percent double precision)
 RETURNS SETOF record
 LANGUAGE sql
 STABLE
AS $function$ SELECT value, percent FROM public._ST_valuecount($1, $2, $3, TRUE, $4, $5) $function$
;

CREATE OR REPLACE FUNCTION public.st_valuepercent(rastertable text, rastercolumn text, nband integer, searchvalue double precision, roundto double precision DEFAULT 0)
 RETURNS double precision
 LANGUAGE sql
 STABLE STRICT
AS $function$ SELECT ( public._ST_valuecount($1, $2, $3, TRUE, ARRAY[$4]::double precision[], $5)).percent $function$
;

CREATE OR REPLACE FUNCTION public.st_valuepercent(rastertable text, rastercolumn text, nband integer, exclude_nodata_value boolean, searchvalue double precision, roundto double precision DEFAULT 0)
 RETURNS double precision
 LANGUAGE sql
 STABLE STRICT
AS $function$ SELECT ( public._ST_valuecount($1, $2, $3, $4, ARRAY[$5]::double precision[], $6)).percent $function$
;

CREATE OR REPLACE FUNCTION public.st_voronoilines(g1 geometry, tolerance double precision DEFAULT 0.0, extend_to geometry DEFAULT NULL::geometry)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_Voronoi(g1, extend_to, tolerance, false) $function$
;

CREATE OR REPLACE FUNCTION public.st_voronoipolygons(g1 geometry, tolerance double precision DEFAULT 0.0, extend_to geometry DEFAULT NULL::geometry)
 RETURNS geometry
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$ SELECT public._ST_Voronoi(g1, extend_to, tolerance, true) $function$
;

CREATE OR REPLACE FUNCTION public.st_width(raster)
 RETURNS integer
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis_raster-3', $function$RASTER_getWidth$function$
;

CREATE OR REPLACE FUNCTION public.st_within(geom1 geometry, geom2 geometry)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 5000 SUPPORT postgis_index_supportfn
AS '$libdir/postgis-3', $function$within$function$
;

CREATE OR REPLACE FUNCTION public.st_within(rast1 raster, nband1 integer, rast2 raster, nband2 integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT $1 OPERATOR(public.&&) $3 AND CASE WHEN $2 IS NULL OR $4 IS NULL THEN public._st_within(public.st_convexhull($1), public.st_convexhull($3)) ELSE public._st_contains($3, $4, $1, $2) END $function$
;

CREATE OR REPLACE FUNCTION public.st_within(rast1 raster, rast2 raster)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE COST 1000
AS $function$ SELECT public.st_within($1, NULL::integer, $2, NULL::integer) $function$
;

CREATE OR REPLACE FUNCTION public.st_wkbtosql(wkb bytea)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_from_WKB$function$
;

CREATE OR REPLACE FUNCTION public.st_wkttosql(text)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 250
AS '$libdir/postgis-3', $function$LWGEOM_from_text$function$
;

CREATE OR REPLACE FUNCTION public.st_worldtorastercoord(rast raster, longitude double precision, latitude double precision, OUT columnx integer, OUT rowy integer)
 RETURNS record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT columnx, rowy FROM public._ST_worldtorastercoord($1, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_worldtorastercoord(rast raster, pt geometry, OUT columnx integer, OUT rowy integer)
 RETURNS record
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	DECLARE
		rx integer;
		ry integer;
	BEGIN
		IF public.ST_geometrytype(pt) != 'ST_Point' THEN
			RAISE EXCEPTION 'Attempting to compute raster coordinate with a non-point geometry';
		END IF;
		IF public.ST_SRID(rast) != public.ST_SRID(pt) THEN
			RAISE EXCEPTION 'Raster and geometry do not have the same SRID';
		END IF;

		SELECT rc.columnx AS x, rc.rowy AS y INTO columnx, rowy FROM public._ST_worldtorastercoord($1, public.ST_x(pt), public.ST_y(pt)) AS rc;
		RETURN;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_worldtorastercoordx(rast raster, xw double precision)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT columnx FROM public._ST_worldtorastercoord($1, $2, NULL) $function$
;

CREATE OR REPLACE FUNCTION public.st_worldtorastercoordx(rast raster, xw double precision, yw double precision)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT columnx FROM public._ST_worldtorastercoord($1, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_worldtorastercoordx(rast raster, pt geometry)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	DECLARE
		xr integer;
	BEGIN
		IF ( public.ST_geometrytype(pt) != 'ST_Point' ) THEN
			RAISE EXCEPTION 'Attempting to compute raster coordinate with a non-point geometry';
		END IF;
		IF public.ST_SRID(rast) != public.ST_SRID(pt) THEN
			RAISE EXCEPTION 'Raster and geometry do not have the same SRID';
		END IF;
		SELECT columnx INTO xr FROM public._ST_worldtorastercoord($1, public.ST_x(pt), public.ST_y(pt));
		RETURN xr;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_worldtorastercoordy(rast raster, yw double precision)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT rowy FROM public._ST_worldtorastercoord($1, NULL, $2) $function$
;

CREATE OR REPLACE FUNCTION public.st_worldtorastercoordy(rast raster, pt geometry)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
	DECLARE
		yr integer;
	BEGIN
		IF ( st_geometrytype(pt) != 'ST_Point' ) THEN
			RAISE EXCEPTION 'Attempting to compute raster coordinate with a non-point geometry';
		END IF;
		IF ST_SRID(rast) != ST_SRID(pt) THEN
			RAISE EXCEPTION 'Raster and geometry do not have the same SRID';
		END IF;
		SELECT rowy INTO yr FROM public._ST_worldtorastercoord($1, st_x(pt), st_y(pt));
		RETURN yr;
	END;
	$function$
;

CREATE OR REPLACE FUNCTION public.st_worldtorastercoordy(rast raster, xw double precision, yw double precision)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT rowy FROM public._ST_worldtorastercoord($1, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.st_wrapx(geom geometry, wrap double precision, move double precision)
 RETURNS geometry
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$ST_WrapX$function$
;

CREATE OR REPLACE FUNCTION public.st_x(geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_x_point$function$
;

CREATE OR REPLACE FUNCTION public.st_xmax(box3d)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$BOX3D_xmax$function$
;

CREATE OR REPLACE FUNCTION public.st_xmin(box3d)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$BOX3D_xmin$function$
;

CREATE OR REPLACE FUNCTION public.st_y(geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_y_point$function$
;

CREATE OR REPLACE FUNCTION public.st_ymax(box3d)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$BOX3D_ymax$function$
;

CREATE OR REPLACE FUNCTION public.st_ymin(box3d)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$BOX3D_ymin$function$
;

CREATE OR REPLACE FUNCTION public.st_z(geometry)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_z_point$function$
;

CREATE OR REPLACE FUNCTION public.st_zmax(box3d)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$BOX3D_zmax$function$
;

CREATE OR REPLACE FUNCTION public.st_zmflag(geometry)
 RETURNS smallint
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$LWGEOM_zmflag$function$
;

CREATE OR REPLACE FUNCTION public.st_zmin(box3d)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/postgis-3', $function$BOX3D_zmin$function$
;

CREATE OR REPLACE FUNCTION public.test_edge_generation(staging_schema text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$ BEGIN RETURN (SELECT COUNT(*) FROM staging_boulder_1754077262506.trails vt JOIN staging_boulder_1754077262506.routing_nodes start_node ON ST_DWithin(ST_StartPoint(vt.geometry), ST_SetSRID(ST_MakePoint(start_node.lng, start_node.lat), 4326), 0.0001) WHERE vt.geometry IS NOT NULL AND ST_IsValid(vt.geometry) AND vt.length_km > 0 LIMIT 5); END; $function$
;

CREATE OR REPLACE FUNCTION public.test_function_v13()
 RETURNS text
 LANGUAGE plpgsql
AS $function$ BEGIN RAISE NOTICE 'TEST FUNCTION CALLED'; RETURN 'SUCCESS'; END; $function$
;

CREATE OR REPLACE FUNCTION public.test_route_finding(staging_schema text)
 RETURNS TABLE(test_name text, result text, details text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    route_count integer;
    node_count integer;
    edge_count integer;
BEGIN
    -- Test 1: Check if routing graph exists
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    IF node_count > 0 AND edge_count > 0 THEN
        RETURN QUERY SELECT 
            'Routing Graph'::text,
            'PASS'::text,
            format('Found %s nodes and %s edges', node_count, edge_count)::text;
    ELSE
        RETURN QUERY SELECT 
            'Routing Graph'::text,
            'FAIL'::text,
            format('Missing routing graph: %s nodes, %s edges', node_count, edge_count)::text;
    END IF;
    
    -- Test 2: Try to find a simple route
    SELECT COUNT(*) INTO route_count
    FROM find_routes_recursive(staging_schema, 5.0, 200.0, 20.0, 5);
    
    IF route_count > 0 THEN
        RETURN QUERY SELECT 
            'Route Finding'::text,
            'PASS'::text,
            format('Found %s routes for 5km/200m criteria', route_count)::text;
    ELSE
        RETURN QUERY SELECT 
            'Route Finding'::text,
            'FAIL'::text,
            'No routes found for 5km/200m criteria'::text;
    END IF;
    
    -- Test 3: Check route quality
    IF EXISTS (
        SELECT 1 FROM find_routes_recursive(staging_schema, 5.0, 200.0, 20.0, 5)
        WHERE similarity_score >= get_min_route_score()
    ) THEN
        RETURN QUERY SELECT 
            'Route Quality'::text,
            'PASS'::text,
            'Found high-quality routes (similarity > 0.8)'::text;
    ELSE
        RETURN QUERY SELECT 
            'Route Quality'::text,
            'WARN'::text,
            'No high-quality routes found - check criteria'::text;
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.test_route_finding_configurable(staging_schema text)
 RETURNS TABLE(test_name text, result text, details text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    route_count integer;
    node_count integer;
    edge_count integer;
    config_min_score float;
BEGIN
    -- Test 1: Check if routing graph exists
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    IF node_count > 0 AND edge_count > 0 THEN
        RETURN QUERY SELECT 
            'Routing Graph'::text,
            'PASS'::text,
            format('Found %s nodes and %s edges', node_count, edge_count)::text;
    ELSE
        RETURN QUERY SELECT 
            'Routing Graph'::text,
            'FAIL'::text,
            format('Missing routing graph: %s nodes, %s edges', node_count, edge_count)::text;
    END IF;
    
    -- Test 2: Try to find a simple route with configurable values
    SELECT COUNT(*) INTO route_count
    FROM find_routes_recursive_configurable(staging_schema, 5.0, 200.0, 20.0, 5);
    
    IF route_count > 0 THEN
        RETURN QUERY SELECT 
            'Route Finding'::text,
            'PASS'::text,
            format('Found %s routes for 5km/200m criteria', route_count)::text;
    ELSE
        RETURN QUERY SELECT 
            'Route Finding'::text,
            'FAIL'::text,
            'No routes found for 5km/200m criteria'::text;
    END IF;
    
    -- Test 3: Check route quality using configurable minimum score
    config_min_score := get_min_route_score();
    IF EXISTS (
        SELECT 1 FROM find_routes_recursive_configurable(staging_schema, 5.0, 200.0, 20.0, 5)
        WHERE similarity_score >= config_min_score
    ) THEN
        RETURN QUERY SELECT 
            'Route Quality'::text,
            'PASS'::text,
            format('Found high-quality routes (similarity >= %s)', config_min_score)::text;
    ELSE
        RETURN QUERY SELECT 
            'Route Quality'::text,
            'WARN'::text,
            format('No high-quality routes found (similarity >= %s) - check criteria', config_min_score)::text;
    END IF;
    
    -- Test 4: Check configurable limits
    IF (get_route_distance_limits() ->> 'min_km')::float > 0 THEN
        RETURN QUERY SELECT 
            'Config Limits'::text,
            'PASS'::text,
            'Configurable distance and elevation limits are set'::text;
    ELSE
        RETURN QUERY SELECT 
            'Config Limits'::text,
            'WARN'::text,
            'Distance/elevation limits may be too restrictive'::text;
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.text(geometry)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT COST 50
AS '$libdir/postgis-3', $function$LWGEOM_to_text$function$
;

CREATE OR REPLACE FUNCTION public.text_soundex(text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/fuzzystrmatch', $function$soundex$function$
;

CREATE OR REPLACE FUNCTION public.update_geojson_cache()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.geojson_cached = ST_AsGeoJSON(NEW.geometry, 6, 0);
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.updategeometrysrid(character varying, character varying, character varying, integer)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
	ret  text;
BEGIN
	SELECT public.UpdateGeometrySRID('',$1,$2,$3,$4) into ret;
	RETURN ret;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.updategeometrysrid(character varying, character varying, integer)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
	ret  text;
BEGIN
	SELECT public.UpdateGeometrySRID('','',$1,$2,$3) into ret;
	RETURN ret;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.updategeometrysrid(catalogn_name character varying, schema_name character varying, table_name character varying, column_name character varying, new_srid_in integer)
 RETURNS text
 LANGUAGE plpgsql
 STRICT
AS $function$
DECLARE
	myrec RECORD;
	okay boolean;
	cname varchar;
	real_schema name;
	unknown_srid integer;
	new_srid integer := new_srid_in;

BEGIN

	-- Find, check or fix schema_name
	IF ( schema_name != '' ) THEN
		okay = false;

		FOR myrec IN SELECT nspname FROM pg_namespace WHERE text(nspname) = schema_name LOOP
			okay := true;
		END LOOP;

		IF ( okay <> true ) THEN
			RAISE EXCEPTION 'Invalid schema name';
		ELSE
			real_schema = schema_name;
		END IF;
	ELSE
		SELECT INTO real_schema current_schema()::text;
	END IF;

	-- Ensure that column_name is in geometry_columns
	okay = false;
	FOR myrec IN SELECT type, coord_dimension FROM public.geometry_columns WHERE f_table_schema = text(real_schema) and f_table_name = table_name and f_geometry_column = column_name LOOP
		okay := true;
	END LOOP;
	IF (NOT okay) THEN
		RAISE EXCEPTION 'column not found in geometry_columns table';
		RETURN false;
	END IF;

	-- Ensure that new_srid is valid
	IF ( new_srid > 0 ) THEN
		IF ( SELECT count(*) = 0 from public.spatial_ref_sys where srid = new_srid ) THEN
			RAISE EXCEPTION 'invalid SRID: % not found in spatial_ref_sys', new_srid;
			RETURN false;
		END IF;
	ELSE
		unknown_srid := public.ST_SRID('POINT EMPTY'::public.geometry);
		IF ( new_srid != unknown_srid ) THEN
			new_srid := unknown_srid;
			RAISE NOTICE 'SRID value % converted to the officially unknown SRID value %', new_srid_in, new_srid;
		END IF;
	END IF;

	IF postgis_constraint_srid(real_schema, table_name, column_name) IS NOT NULL THEN
	-- srid was enforced with constraints before, keep it that way.
		-- Make up constraint name
		cname = 'enforce_srid_'  || column_name;

		-- Drop enforce_srid constraint
		EXECUTE 'ALTER TABLE ' || quote_ident(real_schema) ||
			'.' || quote_ident(table_name) ||
			' DROP constraint ' || quote_ident(cname);

		-- Update geometries SRID
		EXECUTE 'UPDATE ' || quote_ident(real_schema) ||
			'.' || quote_ident(table_name) ||
			' SET ' || quote_ident(column_name) ||
			' = public.ST_SetSRID(' || quote_ident(column_name) ||
			', ' || new_srid::text || ')';

		-- Reset enforce_srid constraint
		EXECUTE 'ALTER TABLE ' || quote_ident(real_schema) ||
			'.' || quote_ident(table_name) ||
			' ADD constraint ' || quote_ident(cname) ||
			' CHECK (st_srid(' || quote_ident(column_name) ||
			') = ' || new_srid::text || ')';
	ELSE
		-- We will use typmod to enforce if no srid constraints
		-- We are using postgis_type_name to lookup the new name
		-- (in case Paul changes his mind and flips geometry_columns to return old upper case name)
		EXECUTE 'ALTER TABLE ' || quote_ident(real_schema) || '.' || quote_ident(table_name) ||
		' ALTER COLUMN ' || quote_ident(column_name) || ' TYPE  geometry(' || public.postgis_type_name(myrec.type, myrec.coord_dimension, true) || ', ' || new_srid::text || ') USING public.ST_SetSRID(' || quote_ident(column_name) || ',' || new_srid::text || ');' ;
	END IF;

	RETURN real_schema || '.' || table_name || '.' || column_name ||' SRID changed to ' || new_srid::text;

END;
$function$
;

CREATE OR REPLACE FUNCTION public.updaterastersrid(table_name name, column_name name, new_srid integer)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT  public._UpdateRasterSRID('', $1, $2, $3) $function$
;

CREATE OR REPLACE FUNCTION public.updaterastersrid(schema_name name, table_name name, column_name name, new_srid integer)
 RETURNS boolean
 LANGUAGE sql
 STRICT
AS $function$ SELECT  public._UpdateRasterSRID($1, $2, $3, $4) $function$
;

CREATE OR REPLACE FUNCTION public.validate_intersection_detection(staging_schema text)
 RETURNS TABLE(validation_check text, status text, details text)
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Check if nodes exist
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Nodes exist'' as validation_check,
            CASE WHEN COUNT(*) > 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' nodes found'' as details
        FROM %I.routing_nodes
    ', staging_schema);
    
    -- Check if edges exist
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Edges exist'' as validation_check,
            CASE WHEN COUNT(*) > 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' edges found'' as details
        FROM %I.routing_edges
    ', staging_schema);
    
    -- Check node types
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Node types valid'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' invalid node types found'' as details
        FROM %I.routing_nodes 
        WHERE node_type NOT IN (''intersection'', ''endpoint'')
    ', staging_schema);
    
    -- Check for self-loops
    RETURN QUERY EXECUTE format('
        SELECT 
            ''No self-loops'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' self-loops found'' as details
        FROM %I.routing_edges 
        WHERE from_node_id = to_node_id
    ', staging_schema);
    
    -- Check node-to-trail ratio
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Node-to-trail ratio'' as validation_check,
            CASE 
                WHEN ratio <= 0.5 THEN ''PASS''
                WHEN ratio <= 1.0 THEN ''WARNING''
                ELSE ''FAIL''
            END as status,
            ROUND(ratio * 100, 1)::text || ''%% ratio (target: <50%%)'' as details
        FROM (
            SELECT 
                (SELECT COUNT(*) FROM %I.routing_nodes)::float / 
                (SELECT COUNT(*) FROM %I.trails) as ratio
        ) ratios
    ', staging_schema, staging_schema);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_spatial_data_integrity(staging_schema text)
 RETURNS TABLE(validation_check text, status text, details text, severity text)
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Validate all geometries are valid using ST_IsValid()
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Geometry validity'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' invalid geometries found'' as details,
            ''ERROR'' as severity
        FROM %I.trails 
        WHERE geometry IS NOT NULL AND NOT ST_IsValid(geometry)
    ', staging_schema);
    
    -- Ensure coordinate system consistency (SRID 4326)
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Coordinate system consistency'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' geometries with wrong SRID'' as details,
            ''ERROR'' as severity
        FROM %I.trails 
        WHERE geometry IS NOT NULL AND ST_SRID(geometry) != 4326
    ', staging_schema);
    
    -- Validate intersection nodes have proper trail connections
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Intersection node connections'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' intersection nodes with <2 connected trails'' as details,
            ''ERROR'' as severity
        FROM %I.routing_nodes 
        WHERE node_type = ''intersection'' AND 
              array_length(string_to_array(connected_trails, '',''), 1) < 2
    ', staging_schema);
    
    -- Check for spatial containment issues
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Spatial containment'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''WARNING'' END as status,
            COUNT(*)::text || '' trails outside region bbox'' as details,
            ''WARNING'' as severity
        FROM %I.trails t
        WHERE geometry IS NOT NULL AND NOT ST_Within(
            geometry, 
            ST_MakeEnvelope(
                MIN(bbox_min_lng), MIN(bbox_min_lat), 
                MAX(bbox_max_lng), MAX(bbox_max_lat), 4326
            )
        )
    ', staging_schema);
    
    -- Validate elevation data consistency
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Elevation data consistency'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''WARNING'' END as status,
            COUNT(*)::text || '' trails with inconsistent elevation data'' as details,
            ''WARNING'' as severity
        FROM %I.trails 
        WHERE geometry IS NOT NULL AND ST_NDims(geometry) = 3 AND
              (elevation_gain IS NULL OR elevation_loss IS NULL OR 
               max_elevation IS NULL OR min_elevation IS NULL)
    ', staging_schema);
    
    -- Check for duplicate nodes within tolerance
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Node uniqueness'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''WARNING'' END as status,
            COUNT(*)::text || '' duplicate nodes within tolerance'' as details,
            ''WARNING'' as severity
        FROM (
            SELECT COUNT(*) as dup_count
            FROM %I.routing_nodes n1
            JOIN %I.routing_nodes n2 ON (
                n1.id != n2.id AND
                ST_DWithin(
                    ST_SetSRID(ST_Point(n1.lng, n1.lat), 4326),
                    ST_SetSRID(ST_Point(n2.lng, n2.lat), 4326),
                    0.001
                )
            )
        ) duplicates
        WHERE dup_count > 0
    ', staging_schema, staging_schema);
    
    -- Validate edge connectivity
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Edge connectivity'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' edges with invalid node connections'' as details,
            ''ERROR'' as severity
        FROM %I.routing_edges e
        LEFT JOIN %I.routing_nodes n1 ON e.from_node_id = n1.id
        LEFT JOIN %I.routing_nodes n2 ON e.to_node_id = n2.id
        WHERE n1.id IS NULL OR n2.id IS NULL
    ', staging_schema, staging_schema, staging_schema);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_trail_completeness()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Ensure complete trails have all required elevation data
  IF NEW.geometry IS NOT NULL AND 
     (NEW.elevation_gain IS NULL OR NEW.max_elevation IS NULL OR 
      NEW.min_elevation IS NULL OR NEW.avg_elevation IS NULL) THEN
    RAISE EXCEPTION 'Complete trails must have all elevation data (elevation_gain, max_elevation, min_elevation, avg_elevation)';
  END IF;
  
  -- Ensure 3D geometry has elevation data
  IF NEW.geometry IS NOT NULL AND ST_NDims(NEW.geometry) = 3 AND 
     (NEW.elevation_gain IS NULL OR NEW.elevation_gain = 0) THEN
    RAISE EXCEPTION '3D geometry must have valid elevation_gain data';
  END IF;
  
  -- Ensure bbox is calculated if geometry exists
  IF NEW.geometry IS NOT NULL AND 
     (NEW.bbox_min_lng IS NULL OR NEW.bbox_max_lng IS NULL OR 
      NEW.bbox_min_lat IS NULL OR NEW.bbox_max_lat IS NULL) THEN
    RAISE EXCEPTION 'Trails with geometry must have calculated bounding box';
  END IF;
  
  -- Ensure length is calculated if geometry exists
  IF NEW.geometry IS NOT NULL AND (NEW.length_km IS NULL OR NEW.length_km <= 0) THEN
    RAISE EXCEPTION 'Trails with geometry must have calculated length_km';
  END IF;
  
  RETURN NEW;
END;
$function$
;

-- Function: validate_trail_completeness
-- Comment: Ensures complete trails have all required elevation and geometry data
-- 

-- ============================================================================
-- DECOMPOSED FUNCTIONS: Split the massive v16 function into smaller, focused functions
-- ============================================================================

-- Function 1: Copy trails to staging (decomposed from v16)
CREATE OR REPLACE FUNCTION public.copy_trails_to_staging_v1(
    staging_schema text, 
    source_table text, 
    region_filter text, 
    bbox_min_lng numeric DEFAULT NULL::numeric, 
    bbox_min_lat numeric DEFAULT NULL::numeric, 
    bbox_max_lng numeric DEFAULT NULL::numeric, 
    bbox_max_lat numeric DEFAULT NULL::numeric, 
    trail_limit integer DEFAULT NULL::integer
)
RETURNS TABLE(
    original_count integer, 
    copied_count integer, 
    success boolean, 
    message text
)
LANGUAGE plpgsql
AS $function$
DECLARE
    original_count_var integer := 0;
    copied_count_var integer := 0;
    source_query text;
    limit_clause text := '';
BEGIN
    RAISE NOTICE 'COPY V1: Function called with parameters:';
    RAISE NOTICE '  staging_schema: %', staging_schema;
    RAISE NOTICE '  source_table: %', source_table;
    RAISE NOTICE '  region_filter: %', region_filter;
    RAISE NOTICE '  bbox_min_lng: %', bbox_min_lng;
    RAISE NOTICE '  bbox_min_lat: %', bbox_min_lat;
    RAISE NOTICE '  bbox_max_lng: %', bbox_max_lng;
    RAISE NOTICE '  bbox_max_lat: %', bbox_max_lat;
    RAISE NOTICE '  trail_limit: %', trail_limit;

    -- Clear existing trails data
    EXECUTE format('DELETE FROM %I.trails', staging_schema);

    -- Build source query with filters
    source_query := format('SELECT * FROM %I WHERE region = %L', source_table, region_filter);

    -- Add bbox filter if provided
    IF bbox_min_lng IS NOT NULL AND bbox_min_lat IS NOT NULL AND bbox_max_lng IS NOT NULL AND bbox_max_lat IS NOT NULL THEN
        source_query := source_query || format(' AND ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))', bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat);
    END IF;

    -- Add limit
    IF trail_limit IS NOT NULL THEN
        limit_clause := format(' LIMIT %s', trail_limit);
    END IF;

    source_query := source_query || limit_clause;

    RAISE NOTICE 'COPY V1: source_query: %', source_query;

    -- Copy trails to staging (without splitting)
    EXECUTE format($f$
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
            geometry, geog, created_at, updated_at
        )
        SELECT
            app_uuid,
            osm_id,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            source_tags,
            bbox_min_lng,
            bbox_max_lng,
            bbox_min_lat,
            bbox_max_lat,
            length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            geometry,
            ST_Force2D(geometry)::geography as geog,
            NOW() as created_at,
            NOW() as updated_at
        FROM (%s) t 
        WHERE t.geometry IS NOT NULL 
          AND ST_IsValid(t.geometry)
          AND t.app_uuid IS NOT NULL
    $f$, staging_schema, source_query);

    GET DIAGNOSTICS copied_count_var = ROW_COUNT;

    -- Get original count from source query
    EXECUTE format('SELECT COUNT(*) FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)', source_query) INTO original_count_var;

    -- Create basic indexes for performance
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geometry ON %I.trails USING GIST(geometry)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geography ON %I.trails USING GIST(geog)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON %I.trails(app_uuid)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_name ON %I.trails(name)', staging_schema);

    -- Return results
    RETURN QUERY SELECT
        original_count_var,
        copied_count_var,
        true as success,
        format('Successfully copied %s trails to staging (from %s original)',
               copied_count_var, original_count_var) as message;

    RAISE NOTICE 'COPY V1: Copied %s trails to staging (from %s original)',
        copied_count_var, original_count_var;

EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT
        0, 0, false,
        format('Error during copy to staging: %s', SQLERRM) as message;

    RAISE NOTICE 'Error during copy to staging: %', SQLERRM;
END;
$function$;

-- Function 2: Split trails in staging (decomposed from v16)
CREATE OR REPLACE FUNCTION public.split_trails_in_staging_v1(
    staging_schema text, 
    tolerance_meters numeric DEFAULT 1.0
)
RETURNS TABLE(
    original_count integer, 
    split_count integer, 
    intersection_count integer, 
    success boolean, 
    message text
)
LANGUAGE plpgsql
AS $function$
DECLARE
    original_count_var integer := 0;
    split_count_var integer := 0;
    intersection_count_var integer := 0;
BEGIN
    RAISE NOTICE 'SPLIT V1: Function called with parameters:';
    RAISE NOTICE '  staging_schema: %', staging_schema;
    RAISE NOTICE '  tolerance_meters: %', tolerance_meters;

    -- Get original count before splitting
    EXECUTE format('SELECT COUNT(*) FROM %I.trails', staging_schema) INTO original_count_var;

    -- Clear intersection points
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);

    -- Step 1: Split trails at intersection points using native PostGIS ST_Split
    EXECUTE format($f$
        WITH trail_intersections AS (
            SELECT DISTINCT
                t1.app_uuid as trail1_uuid,
                t2.app_uuid as trail2_uuid,
                ST_Intersection(t1.geometry, t2.geometry) as intersection_point
            FROM %I.trails t1
            JOIN %I.trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ),
        trails_with_intersections AS (
            SELECT
                t.id, t.app_uuid, t.osm_id, t.name, t.region, t.trail_type, t.surface, t.difficulty, t.source_tags,
                t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
                t.length_km, t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
                t.source, t.created_at, t.updated_at, t.geometry,
                (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).geom as split_geometry,
                (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).path[1] as segment_order
            FROM %I.trails t
            JOIN trail_intersections ti ON t.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
        ),
        trails_without_intersections AS (
            SELECT
                t.id, t.app_uuid, t.osm_id, t.name, t.region, t.trail_type, t.surface, t.difficulty, t.source_tags,
                t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
                t.length_km, t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
                t.source, t.created_at, t.updated_at, t.geometry,
                t.geometry as split_geometry,
                1 as segment_order
            FROM %I.trails t
            WHERE t.app_uuid NOT IN (
                SELECT DISTINCT trail1_uuid FROM trail_intersections
                UNION
                SELECT DISTINCT trail2_uuid FROM trail_intersections
            )
        ),
        processed_trails AS (
            SELECT * FROM trails_with_intersections
            UNION ALL
            SELECT * FROM trails_without_intersections
        )
        -- Replace existing trails with split versions
        DELETE FROM %I.trails;
        
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
            geometry, created_at, updated_at
        )
        SELECT
            gen_random_uuid() as app_uuid,
            osm_id,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            source_tags,
            ST_XMin(split_geometry) as bbox_min_lng,
            ST_XMax(split_geometry) as bbox_max_lng,
            ST_YMin(split_geometry) as bbox_min_lat,
            ST_YMax(split_geometry) as bbox_max_lat,
            ST_Length(split_geometry::geography) / 1000.0 as length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            split_geometry as geometry,
            NOW() as created_at,
            NOW() as updated_at
        FROM processed_trails pt
        WHERE ST_IsValid(pt.split_geometry)
          AND pt.app_uuid IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema);

    GET DIAGNOSTICS split_count_var = ROW_COUNT;

    -- Step 2: Detect intersections between split trail segments
    PERFORM detect_trail_intersections(staging_schema, 'trails', tolerance_meters);

    -- Get intersection count
    EXECUTE format('SELECT COUNT(*) FROM %I.intersection_points', staging_schema) INTO intersection_count_var;

    -- Clear routing data in staging schema since it needs to be regenerated from split trails
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);

    -- Recreate optimized spatial indexes
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geometry ON %I.trails USING GIST(geometry)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON %I.trails(app_uuid)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_name ON %I.trails(name)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_intersection_points ON %I.intersection_points USING GIST(point)', staging_schema);

    -- Return results
    RETURN QUERY SELECT
        original_count_var,
        split_count_var,
        intersection_count_var,
        true as success,
        format('Successfully split %s trails into %s segments with %s intersections',
               original_count_var, split_count_var, intersection_count_var) as message;

    RAISE NOTICE 'SPLIT V1: Split %s trails into %s segments with %s intersections',
        original_count_var, split_count_var, intersection_count_var;

EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT
        0, 0, 0, false,
        format('Error during split in staging: %s', SQLERRM) as message;

    RAISE NOTICE 'Error during split in staging: %', SQLERRM;
END;
$function$;

-- ============================================================================
