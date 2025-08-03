-- Direct Drop All Staging Schemas
-- Simple and direct approach

-- Check what staging schemas exist
SELECT 'Current staging schemas:' as info;
SELECT schemaname FROM pg_tables WHERE schemaname LIKE 'staging_%' GROUP BY schemaname ORDER BY schemaname;

-- Drop each staging schema directly
DROP SCHEMA IF EXISTS staging_boulder_1754239587335 CASCADE;

-- Check if there are any other staging schemas and drop them too
DO $$
DECLARE
    schema_name text;
BEGIN
    FOR schema_name IN 
        SELECT DISTINCT schemaname 
        FROM pg_tables 
        WHERE schemaname LIKE 'staging_%'
        ORDER BY schemaname
    LOOP
        EXECUTE 'DROP SCHEMA IF EXISTS ' || quote_ident(schema_name) || ' CASCADE';
        RAISE NOTICE 'Dropped schema: %', schema_name;
    END LOOP;
END $$;

-- Verify cleanup
SELECT 'Verification - remaining staging schemas:' as info;
SELECT COUNT(*) as remaining_count
FROM pg_tables 
WHERE schemaname LIKE 'staging_%';

SELECT 'Direct drop completed!' as info; 