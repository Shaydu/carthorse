-- Diagnose build_routing_edges in the latest staging schema for a region
-- Usage: psql -d trail_master_db_test -f scripts/dev-utils/tmp/diagnose-build-routing-edges.sql

-- Set your region here
\set region 'boulder'

-- Find the latest staging schema for the region
WITH schemas AS (
  SELECT schema_name
  FROM information_schema.schemata
  WHERE schema_name LIKE ('staging_' || :'region' || '_%')
  ORDER BY schema_name DESC
  LIMIT 1
)
SELECT 'Using staging schema: ' || schema_name FROM schemas;

-- Set the schema for the rest of the script
\set staging_schema `psql -d :DBNAME -t -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'staging_' || :'region' || '_%' ORDER BY schema_name DESC LIMIT 1" | xargs`

-- Try running build_routing_edges (catch errors)
DO $$
DECLARE
  result RECORD;
BEGIN
  BEGIN
    EXECUTE format('SELECT %I.build_routing_edges(''%I'', ''split_trails'', 20.0)', :'staging_schema', :'staging_schema') INTO result;
    RAISE NOTICE 'build_routing_edges result: %', result;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'build_routing_edges failed: %', SQLERRM;
  END;
END$$;

-- Check counts and sample rows
EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', :'staging_schema');
EXECUTE format('SELECT * FROM %I.routing_edges LIMIT 5', :'staging_schema');

-- Optionally, print node and trail diagnostics
EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', :'staging_schema');
EXECUTE format('SELECT * FROM %I.routing_nodes LIMIT 5', :'staging_schema');
EXECUTE format('SELECT COUNT(*) FROM %I.split_trails', :'staging_schema');
EXECUTE format('SELECT * FROM %I.split_trails LIMIT 5', :'staging_schema'); 