-- Test Routing Fix on Specific Bbox
-- This script tests the routing tolerance fix on the specified bbox

-- Set the staging schema
\set staging_schema 'staging_boulder_1754918168168'

-- Clear existing routing data
DELETE FROM :staging_schema.routing_nodes;
DELETE FROM :staging_schema.routing_edges;

-- Generate routing nodes with proper tolerance (50 meters)
SELECT * FROM generate_routing_nodes_native(:'staging_schema', 50.0);

-- Generate routing edges with proper tolerance (50 meters)
SELECT * FROM generate_routing_edges_native(:'staging_schema', 50.0);

-- Analyze connectivity
SELECT * FROM analyze_routing_connectivity(:'staging_schema');

-- Show some sample data
SELECT 
    'Nodes' as table_name,
    COUNT(*) as count
FROM :staging_schema.routing_nodes

UNION ALL

SELECT 
    'Edges' as table_name,
    COUNT(*) as count
FROM :staging_schema.routing_edges;

-- Show sample nodes
SELECT 
    id,
    node_type,
    connected_trails,
    lat,
    lng
FROM :staging_schema.routing_nodes
LIMIT 10;

-- Show sample edges
SELECT 
    source,
    target,
    trail_name,
    distance_km
FROM :staging_schema.routing_edges
LIMIT 10;

-- Check for Mesa Trail specifically
SELECT 
    'Mesa Trail Edges' as check_type,
    COUNT(*) as count
FROM :staging_schema.routing_edges
WHERE trail_name LIKE '%Mesa Trail%'

UNION ALL

SELECT 
    'Mesa Trail Nodes' as check_type,
    COUNT(*) as count
FROM :staging_schema.routing_nodes
WHERE connected_trails LIKE '%Mesa Trail%';
