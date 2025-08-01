-- Extract only custom functions from production database
-- This script will generate CREATE FUNCTION statements for our custom functions only

SELECT 
    '-- Function: ' || p.proname || ' (custom function)'
    || E'\n-- Description: ' || COALESCE(pgd.description, 'No description')
    || E'\n\n'
    || pg_get_functiondef(p.oid)
    || E';\n\n'
FROM pg_proc p
LEFT JOIN pg_namespace n ON p.pronamespace = n.oid
LEFT JOIN pg_description pgd ON p.oid = pgd.objoid
WHERE n.nspname = 'public'  -- Only public schema functions
  AND p.prokind IN ('f', 'p')  -- Only functions and procedures
  AND p.proname NOT LIKE '__st_%'  -- Exclude PostGIS internal functions
  AND p.proname NOT LIKE 'st_%'    -- Exclude PostGIS public functions
  AND p.proname NOT LIKE 'pg_%'    -- Exclude PostgreSQL system functions
  AND p.proname NOT LIKE 'generate_series%'  -- Exclude PostgreSQL built-ins
  AND p.proname NOT LIKE 'unnest%'  -- Exclude PostgreSQL built-ins
  AND p.proname NOT LIKE 'array_%'  -- Exclude PostgreSQL array functions
  AND p.proname NOT LIKE 'string_%'  -- Exclude PostgreSQL string functions
  AND p.proname NOT LIKE 'json_%'   -- Exclude PostgreSQL JSON functions
  AND p.proname NOT LIKE 'gen_%'    -- Exclude PostgreSQL UUID functions
  AND p.proname NOT LIKE 'format%'  -- Exclude PostgreSQL format functions
  AND p.proname NOT LIKE 'to_%'     -- Exclude PostgreSQL type conversion functions
  AND p.proname NOT LIKE 'now%'     -- Exclude PostgreSQL time functions
  AND p.proname NOT LIKE 'current_%' -- Exclude PostgreSQL current functions
  AND p.proname NOT LIKE 'session_%' -- Exclude PostgreSQL session functions
  AND p.proname NOT LIKE 'version%' -- Exclude PostgreSQL version functions
  AND p.proname NOT LIKE 'has_%'    -- Exclude PostgreSQL has functions
  AND p.proname NOT LIKE 'has_table_privilege%' -- Exclude PostgreSQL privilege functions
  AND p.proname NOT LIKE 'has_schema_privilege%' -- Exclude PostgreSQL privilege functions
  AND p.proname NOT LIKE 'has_database_privilege%' -- Exclude PostgreSQL privilege functions
  AND p.proname NOT LIKE 'has_function_privilege%' -- Exclude PostgreSQL privilege functions
  AND p.proname NOT LIKE 'has_language_privilege%' -- Exclude PostgreSQL privilege functions
  AND p.proname NOT LIKE 'has_sequence_privilege%' -- Exclude PostgreSQL privilege functions
  AND p.proname NOT LIKE 'has_tablespace_privilege%' -- Exclude PostgreSQL privilege functions
  AND p.proname NOT LIKE 'has_type_privilege%' -- Exclude PostgreSQL privilege functions
  AND p.proname NOT LIKE 'has_server_privilege%' -- Exclude PostgreSQL privilege functions
  AND p.proname NOT LIKE 'has_foreign_data_wrapper_privilege%' -- Exclude PostgreSQL privilege functions
  AND p.proname NOT LIKE 'has_column_privilege%' -- Exclude PostgreSQL privilege functions
  AND p.proname NOT LIKE 'has_any_column_privilege%' -- Exclude PostgreSQL privilege functions
ORDER BY p.proname; 