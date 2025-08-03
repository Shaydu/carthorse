-- Force Drop All Staging Schemas
-- Uses aggressive methods to drop schemas even if they have dependencies

-- First, terminate any active connections to staging schemas
SELECT 'Terminating active connections to staging schemas...' as info;

-- Kill any active queries on staging schemas
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE datname = current_database() 
  AND state = 'active' 
  AND query LIKE '%staging_%';

-- Force drop all staging schemas
DO $$
DECLARE
    schema_name text;
    drop_sql text;
BEGIN
    RAISE NOTICE 'Starting force drop of all staging schemas...';
    
    -- Get all staging schemas
    FOR schema_name IN 
        SELECT DISTINCT schemaname 
        FROM pg_tables 
        WHERE schemaname LIKE 'staging_%'
        ORDER BY schemaname
    LOOP
        RAISE NOTICE 'Force dropping schema: %', schema_name;
        
        -- Try multiple drop strategies
        BEGIN
            -- Strategy 1: Normal CASCADE drop
            EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_name);
            RAISE NOTICE 'Successfully dropped schema: %', schema_name;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Strategy 1 failed for %: %', schema_name, SQLERRM;
            
            BEGIN
                -- Strategy 2: Drop with RESTRICT (force)
                EXECUTE format('DROP SCHEMA IF EXISTS %I RESTRICT', schema_name);
                RAISE NOTICE 'Strategy 2 succeeded for: %', schema_name;
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'Strategy 2 failed for %: %', schema_name, SQLERRM;
                
                BEGIN
                    -- Strategy 3: Drop individual tables first
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
                    
                    -- Now drop the empty schema
                    EXECUTE format('DROP SCHEMA IF EXISTS %I', schema_name);
                    RAISE NOTICE 'Strategy 3 succeeded for: %', schema_name;
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'Strategy 3 failed for %: %', schema_name, SQLERRM;
                END;
            END;
        END;
    END LOOP;
    
    RAISE NOTICE 'Force drop completed';
END $$;

-- Verify all staging schemas are gone
SELECT 'Verifying cleanup...' as info;
SELECT COUNT(*) as remaining_staging_schemas
FROM pg_tables 
WHERE schemaname LIKE 'staging_%';

SELECT 'Force drop completed!' as info; 