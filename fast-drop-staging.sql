-- Fast staging schema cleanup
-- First, let's see what staging schemas actually exist

SELECT nspname as schema_name 
FROM pg_namespace 
WHERE nspname IN (
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
)
ORDER BY nspname;

-- Now drop them one by one with immediate feedback
\echo 'Dropping staging schemas...'

DROP SCHEMA IF EXISTS staging_boulder_1754240373908 CASCADE;
\echo 'Dropped staging_boulder_1754240373908'

DROP SCHEMA IF EXISTS staging_boulder_1754240385590 CASCADE;
\echo 'Dropped staging_boulder_1754240385590'

DROP SCHEMA IF EXISTS staging_boulder_1754240512064 CASCADE;
\echo 'Dropped staging_boulder_1754240512064'

DROP SCHEMA IF EXISTS staging_boulder_1754240810133 CASCADE;
\echo 'Dropped staging_boulder_1754240810133'

DROP SCHEMA IF EXISTS staging_boulder_1754240837892 CASCADE;
\echo 'Dropped staging_boulder_1754240837892'

DROP SCHEMA IF EXISTS staging_boulder_1754241085937 CASCADE;
\echo 'Dropped staging_boulder_1754241085937'

DROP SCHEMA IF EXISTS staging_boulder_1754241253970 CASCADE;
\echo 'Dropped staging_boulder_1754241253970'

DROP SCHEMA IF EXISTS staging_boulder_1754242202880 CASCADE;
\echo 'Dropped staging_boulder_1754242202880'

DROP SCHEMA IF EXISTS staging_boulder_1754242544683 CASCADE;
\echo 'Dropped staging_boulder_1754242544683'

DROP SCHEMA IF EXISTS staging_boulder_1754242626357 CASCADE;
\echo 'Dropped staging_boulder_1754242626357'

DROP SCHEMA IF EXISTS staging_boulder_1754242681688 CASCADE;
\echo 'Dropped staging_boulder_1754242681688'

\echo 'All staging schemas dropped successfully!' 