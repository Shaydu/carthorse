-- Add trail_ids array column to routing_nodes table
-- This allows nodes to be associated with multiple trails (for intersection nodes)

-- Example: Add column to existing staging schema
-- ALTER TABLE staging_boulder_1234567890.routing_nodes 
-- ADD COLUMN trail_ids TEXT[];

-- Example: Create new routing_nodes table with trail_ids column
CREATE TABLE IF NOT EXISTS example_staging.routing_nodes (
  id SERIAL PRIMARY KEY,
  node_uuid TEXT UNIQUE,
  lat REAL,
  lng REAL,
  elevation REAL,
  node_type TEXT,
  connected_trails TEXT,
  trail_ids TEXT[],  -- Array of trail UUIDs associated with this node
  created_at TIMESTAMP DEFAULT NOW()
);

-- Example: Insert data with trail_ids
-- Endpoint node (single trail)
INSERT INTO example_staging.routing_nodes (
  node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids
) VALUES (
  'node-1', 39.946274, -105.810425, 2611.7488, 'endpoint', 
  'Fraser River Trail', 
  ARRAY['fraser-river-trail-uuid']
);

-- Intersection node (multiple trails)
INSERT INTO example_staging.routing_nodes (
  node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids
) VALUES (
  'node-2', 39.803688, -105.51237, 2639.0671, 'intersection',
  'Mesa Trail, Bear Peak West Ridge',
  ARRAY['mesa-trail-uuid', 'bear-peak-west-ridge-uuid']
);

-- Example queries using trail_ids array:

-- 1. Find all nodes associated with a specific trail
-- SELECT * FROM example_staging.routing_nodes 
-- WHERE 'mesa-trail-uuid' = ANY(trail_ids);

-- 2. Find intersection nodes (nodes with multiple trails)
-- SELECT * FROM example_staging.routing_nodes 
-- WHERE array_length(trail_ids, 1) > 1;

-- 3. Find endpoint nodes (nodes with single trail)
-- SELECT * FROM example_staging.routing_nodes 
-- WHERE array_length(trail_ids, 1) = 1;

-- 4. Count trails per node
-- SELECT id, node_uuid, node_type, array_length(trail_ids, 1) as trail_count 
-- FROM example_staging.routing_nodes;

-- 5. Find isolated nodes (nodes not connected to any edges)
-- WITH isolated_nodes AS (
--   SELECT id FROM example_staging.routing_nodes 
--   WHERE id NOT IN (
--     SELECT DISTINCT source FROM example_staging.routing_edges 
--     UNION 
--     SELECT DISTINCT target FROM example_staging.routing_edges
--   )
-- )
-- SELECT rn.*, array_length(rn.trail_ids, 1) as trail_count
-- FROM example_staging.routing_nodes rn
-- JOIN isolated_nodes in ON rn.id = in.id;

-- Benefits of trail_ids array:
-- 1. Direct trail association for all nodes
-- 2. Support for intersection nodes with multiple trails
-- 3. Easy querying for trail-specific nodes
-- 4. Better data integrity and validation
-- 5. Simplified debugging and analysis 