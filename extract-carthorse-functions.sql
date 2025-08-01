-- Extract only Carthorse custom functions from production database
-- This script will generate CREATE FUNCTION statements for our custom functions only

SELECT 
    '-- Function: ' || p.proname || ' (Carthorse custom function)'
    || E'\n-- Description: ' || COALESCE(pgd.description, 'No description')
    || E'\n\n'
    || pg_get_functiondef(p.oid)
    || E';\n\n'
FROM pg_proc p
LEFT JOIN pg_namespace n ON p.pronamespace = n.oid
LEFT JOIN pg_description pgd ON p.oid = pgd.objoid
WHERE n.nspname = 'public'  -- Only public schema functions
  AND p.prokind IN ('f', 'p')  -- Only functions and procedures
  AND (
    p.proname LIKE 'generate_%' OR
    p.proname LIKE 'calculate_%' OR
    p.proname LIKE 'get_%' OR
    p.proname LIKE 'show_%' OR
    p.proname LIKE 'cleanup_%' OR
    p.proname LIKE 'validate_%' OR
    p.proname LIKE 'find_%' OR
    p.proname LIKE 'build_%' OR
    p.proname LIKE 'prep_%' OR
    p.proname LIKE 'prepare_%' OR
    p.proname LIKE 'recalculate_%' OR
    p.proname LIKE 'auto_%' OR
    p.proname = 'show_routing_summary'
  )
ORDER BY p.proname; 