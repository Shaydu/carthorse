-- Populate test database with data from production
-- This script copies trails and related data from production to test database

-- Copy trails from production to test database
INSERT INTO trail_master_db_test.public.trails 
SELECT * FROM trail_master_db.public.trails 
WHERE region = 'boulder';

-- Copy any related data (if there are other tables with trail data)
-- Note: We'll need to handle this carefully since we can't directly reference across databases
-- For now, let's just copy the trails table

-- Let's also copy some sample data from other regions for testing
INSERT INTO trail_master_db_test.public.trails 
SELECT * FROM trail_master_db.public.trails 
WHERE region IN ('denver', 'fort_collins') 
LIMIT 50;

-- Update the schema version
UPDATE trail_master_db_test.public.schema_version 
SET version = 7, updated_at = NOW() 
WHERE id = 1; 