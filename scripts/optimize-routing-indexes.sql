-- Optimize Routing Performance Indexes
-- This script adds missing indexes to improve routing query performance

-- 1. Add indexes for routing edges JOIN operations
CREATE INDEX IF NOT EXISTS idx_routing_edges_source ON staging_boulder_1754237646232.routing_edges (source);
CREATE INDEX IF NOT EXISTS idx_routing_edges_target ON staging_boulder_1754237646232.routing_edges (target);
CREATE INDEX IF NOT EXISTS idx_routing_edges_source_target ON staging_boulder_1754237646232.routing_edges (source, target);

-- 2. Add index for trails app_uuid JOIN operations
CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON staging_boulder_1754237646232.trails (app_uuid);

-- 3. Add index for routing nodes id JOIN operations
CREATE INDEX IF NOT EXISTS idx_routing_nodes_id ON staging_boulder_1754237646232.routing_nodes (id);

-- 4. Add composite index for intersection detection optimization
CREATE INDEX IF NOT EXISTS idx_trails_intersection_optimized ON staging_boulder_1754237646232.trails 
USING GIST (geometry) WHERE ST_Length(geometry::geography) > 5;

-- 5. Add index for route recommendations table
CREATE INDEX IF NOT EXISTS idx_route_recommendations_trail_id ON staging_boulder_1754237646232.route_recommendations (trail_id);

-- 6. Add spatial index for node proximity searches
CREATE INDEX IF NOT EXISTS idx_routing_nodes_spatial ON staging_boulder_1754237646232.routing_nodes 
USING GIST (ST_SetSRID(ST_MakePoint(lng, lat), 4326));

-- 7. Add index for trail length filtering
CREATE INDEX IF NOT EXISTS idx_trails_length ON staging_boulder_1754237646232.trails (ST_Length(geometry::geography)) 
WHERE geometry IS NOT NULL;

-- 8. Add index for trail validation
CREATE INDEX IF NOT EXISTS idx_trails_valid ON staging_boulder_1754237646232.trails (id) 
WHERE geometry IS NOT NULL AND ST_IsValid(geometry);

-- Show index creation results
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'staging_boulder_1754237646232' 
AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname; 