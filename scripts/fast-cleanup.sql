-- Fast Cleanup Script
-- Bypasses slow CASCADE operations by dropping tables directly

-- Function to quickly drop all staging schemas
CREATE OR REPLACE FUNCTION fast_cleanup_staging_schemas() RETURNS void AS $$
DECLARE
    schema_name text;
BEGIN
    -- Drop all staging schemas quickly
    FOR schema_name IN 
        SELECT schemaname 
        FROM pg_tables 
        WHERE schemaname LIKE 'staging_%' 
        GROUP BY schemaname
    LOOP
        -- Drop tables directly (faster than CASCADE)
        EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_name);
        RAISE NOTICE 'Dropped schema: %', schema_name;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to force drop schemas even if they have dependencies
CREATE OR REPLACE FUNCTION force_cleanup_staging_schemas() RETURNS void AS $$
DECLARE
    schema_name text;
BEGIN
    -- First, terminate any connections to staging schemas
    PERFORM pg_terminate_backend(pid) 
    FROM pg_stat_activity 
    WHERE datname = current_database() 
      AND state = 'active' 
      AND query LIKE '%staging_%';
    
    -- Drop all staging schemas with force
    FOR schema_name IN 
        SELECT schemaname 
        FROM pg_tables 
        WHERE schemaname LIKE 'staging_%' 
        GROUP BY schemaname
    LOOP
        BEGIN
            EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_name);
            RAISE NOTICE 'Force dropped schema: %', schema_name;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Failed to drop schema %: %', schema_name, SQLERRM;
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Execute fast cleanup
SELECT 'Starting fast cleanup...' as info;
SELECT fast_cleanup_staging_schemas();
SELECT 'Fast cleanup completed' as info; 