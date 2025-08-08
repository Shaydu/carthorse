-- Drop specific staging schemas
-- This script will drop all the staging schemas mentioned in the user's request

DO $$
DECLARE
    schema_name text;
    schemas_to_drop text[] := ARRAY[
        'staging_boulder_1754240373908',
        'staging_boulder_1754240385590', 
        'staging_boulder_1754240512064',
        'staging_boulder_1754240810133',
        'staging_boulder_1754240837892',
        'staging_boulder_1754241085937',
        'staging_boulder_1754241253970',
        'staging_boulder_1754242202880',
        'staging_boulder_1754242544683',
        'staging_boulder_1754242626357',
        'staging_boulder_1754242681688'
    ];
BEGIN
    RAISE NOTICE 'Starting to drop % staging schemas...', array_length(schemas_to_drop, 1);
    
    FOREACH schema_name IN ARRAY schemas_to_drop
    LOOP
        -- Check if schema exists before dropping
        IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = schema_name) THEN
            EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_name);
            RAISE NOTICE 'Dropped schema: %', schema_name;
        ELSE
            RAISE NOTICE 'Schema % does not exist, skipping', schema_name;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Finished dropping staging schemas';
END $$; 