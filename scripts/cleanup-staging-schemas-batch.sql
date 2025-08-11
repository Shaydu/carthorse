-- Batch cleanup script to remove old staging schemas
-- This processes schemas in smaller batches to avoid memory limits

-- First, let's see what we're about to clean up
SELECT 
    'Found ' || COUNT(*) || ' staging schemas using ' || 
    pg_size_pretty(SUM(pg_total_relation_size(schemaname||'.'||tablename))) || 
    ' of disk space' as summary
FROM pg_tables 
WHERE schemaname LIKE 'carthorse_%' OR schemaname LIKE 'staging_%';

-- Drop schemas in batches of 10 to avoid memory limits
DO $$
DECLARE
    schema_record RECORD;
    batch_count INTEGER := 0;
    total_dropped INTEGER := 0;
    batch_size INTEGER := 10;
BEGIN
    LOOP
        batch_count := 0;
        
        -- Drop a batch of schemas
        FOR schema_record IN 
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name LIKE 'carthorse_%'
            ORDER BY schema_name
            LIMIT batch_size
        LOOP
            EXECUTE 'DROP SCHEMA IF EXISTS ' || schema_record.schema_name || ' CASCADE';
            batch_count := batch_count + 1;
            total_dropped := total_dropped + 1;
            RAISE NOTICE 'Dropped schema: % (batch %)', schema_record.schema_name, (total_dropped / batch_size) + 1;
        END LOOP;
        
        -- If no schemas were dropped in this batch, we're done
        IF batch_count = 0 THEN
            EXIT;
        END IF;
        
        RAISE NOTICE 'Completed batch. Total dropped so far: %', total_dropped;
        
        -- Small delay to allow system to process
        PERFORM pg_sleep(0.1);
    END LOOP;
    
    RAISE NOTICE 'Total schemas dropped: %', total_dropped;
END $$;

-- Drop any remaining staging_% schemas
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
        RAISE NOTICE 'Dropped staging schema: %', schema_record.schema_name;
    END LOOP;
    
    RAISE NOTICE 'Total staging schemas dropped: %', drop_count;
END $$;

-- Verify cleanup
SELECT 
    'Cleanup complete. Remaining schemas: ' || COUNT(*) as result
FROM information_schema.schemata 
WHERE schema_name LIKE 'carthorse_%' OR schema_name LIKE 'staging_%';
