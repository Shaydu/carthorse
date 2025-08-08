-- Simple Force Drop All Staging Schemas
-- Drops schemas without killing our own connection

-- Check what staging schemas exist
SELECT 'Current staging schemas:' as info;
SELECT schemaname FROM pg_tables WHERE schemaname LIKE 'staging_%' GROUP BY schemaname ORDER BY schemaname;

-- Force drop each staging schema
DO $$
DECLARE
    schema_name text;
BEGIN
    RAISE NOTICE 'Starting force drop of staging schemas...';
    
    FOR schema_name IN 
        SELECT DISTINCT schemaname 
        FROM pg_tables 
        WHERE schemaname LIKE 'staging_%'
        ORDER BY schemaname
    LOOP
        RAISE NOTICE 'Dropping schema: %', schema_name;
        
        -- Drop all tables in the schema first
        EXECUTE format('
            DO $inner$
            DECLARE
                table_name text;
            BEGIN
                FOR table_name IN 
                    SELECT tablename 
                    FROM pg_tables 
                    WHERE schemaname = %L
                LOOP
                    EXECUTE format(''DROP TABLE IF EXISTS %I.%I CASCADE'', %L, table_name);
                END LOOP;
            END $inner$;
        ', schema_name, schema_name);
        
        -- Drop the schema itself
        EXECUTE format('DROP SCHEMA IF EXISTS %I', schema_name);
        RAISE NOTICE 'Dropped schema: %', schema_name;
    END LOOP;
    
    RAISE NOTICE 'Force drop completed';
END $$;

-- Verify cleanup
SELECT 'Verification - remaining staging schemas:' as info;
SELECT COUNT(*) as remaining_count
FROM pg_tables 
WHERE schemaname LIKE 'staging_%';

SELECT 'Force drop completed!' as info; 