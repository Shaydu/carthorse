-- Extract all functions from production database
-- This script will generate CREATE FUNCTION statements for all functions

SELECT 
    '-- Function: ' || p.proname || ' (' || 
    CASE 
        WHEN p.prokind = 'f' THEN 'function'
        WHEN p.prokind = 'p' THEN 'procedure' 
        WHEN p.prokind = 'a' THEN 'aggregate'
        WHEN p.prokind = 'w' THEN 'window'
        ELSE 'unknown'
    END || ')'
    || E'\n-- Description: ' || COALESCE(pgd.description, 'No description')
    || E'\n\n'
    || pg_get_functiondef(p.oid)
    || E';\n\n'
FROM pg_proc p
LEFT JOIN pg_namespace n ON p.pronamespace = n.oid
LEFT JOIN pg_description pgd ON p.oid = pgd.objoid
WHERE n.nspname = 'public'  -- Only public schema functions
  AND p.prokind IN ('f', 'p')  -- Only functions and procedures
ORDER BY p.proname; 