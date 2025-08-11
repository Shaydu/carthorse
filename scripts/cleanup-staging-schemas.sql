-- Cleanup script to remove old staging schemas
-- This will reclaim significant disk space

-- First, let's see what we're about to clean up
SELECT 
    'Found ' || COUNT(*) || ' staging schemas using ' || 
    pg_size_pretty(SUM(pg_total_relation_size(schemaname||'.'||tablename))) || 
    ' of disk space' as summary
FROM pg_tables 
WHERE schemaname LIKE 'carthorse_%' OR schemaname LIKE 'staging_%';

-- Show the schemas we'll be dropping (first 10)
SELECT 
    schemaname,
    COUNT(*) as table_count,
    pg_size_pretty(SUM(pg_total_relation_size(schemaname||'.'||tablename))) as size
FROM pg_tables 
WHERE schemaname LIKE 'carthorse_%' OR schemaname LIKE 'staging_%'
GROUP BY schemaname
ORDER BY schemaname
LIMIT 10;

-- Drop all carthorse_% schemas
DO $$
DECLARE
    schema_record RECORD;
    drop_count INTEGER := 0;
BEGIN
    FOR schema_record IN 
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name LIKE 'carthorse_%'
        ORDER BY schema_name
    LOOP
        EXECUTE 'DROP SCHEMA IF EXISTS ' || schema_record.schema_name || ' CASCADE';
        drop_count := drop_count + 1;
        RAISE NOTICE 'Dropped schema: %', schema_record.schema_name;
    END LOOP;
    
    RAISE NOTICE 'Total schemas dropped: %', drop_count;
END $$;

-- Drop all staging_% schemas (if any exist)
DO $$
DECLARE
    schema_record RECORD;
    drop_count INTEGER := 0;
BEGIN
    FOR schema_record IN 
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name LIKE 'staging_%'
        ORDER BY schema_name
    LOOP
        EXECUTE 'DROP SCHEMA IF EXISTS ' || schema_record.schema_name || ' CASCADE';
        drop_count := drop_count + 1;
        RAISE NOTICE 'Dropped schema: %', schema_record.schema_name;
    END LOOP;
    
    RAISE NOTICE 'Total staging schemas dropped: %', drop_count;
END $$;

-- Verify cleanup
SELECT 
    'Cleanup complete. Remaining schemas: ' || COUNT(*) as result
FROM information_schema.schemata 
WHERE schema_name LIKE 'carthorse_%' OR schema_name LIKE 'staging_%';
