-- ============================================================================
-- Migration V5: Fix Routing Schema Mismatch
-- ============================================================================
-- This migration fixes the routing_nodes and routing_edges table schemas
-- to match what the native PostGIS functions expect, without changing data.

-- Drop and recreate routing_nodes table with correct schema
DROP TABLE IF EXISTS routing_nodes CASCADE;

CREATE TABLE routing_nodes (
    id SERIAL PRIMARY KEY,
    node_uuid TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    elevation DOUBLE PRECISION,
    node_type TEXT,
    connected_trails TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Drop and recreate routing_edges table with correct schema
DROP TABLE IF EXISTS routing_edges CASCADE;

CREATE TABLE routing_edges (
    id SERIAL PRIMARY KEY,
    source INTEGER,
    target INTEGER,
    trail_id TEXT,
    trail_name TEXT,
    distance_km DOUBLE PRECISION,
    elevation_gain DOUBLE PRECISION,
    elevation_loss DOUBLE PRECISION,
    geometry GEOMETRY,
    geojson TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add spatial indexes for performance
CREATE INDEX IF NOT EXISTS idx_routing_nodes_coords ON routing_nodes(lat, lng);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_elevation ON routing_nodes(elevation) WHERE elevation IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routing_edges_source ON routing_edges(source);
CREATE INDEX IF NOT EXISTS idx_routing_edges_target ON routing_edges(target);
CREATE INDEX IF NOT EXISTS idx_routing_edges_source_target ON routing_edges(source, target);
CREATE INDEX IF NOT EXISTS idx_routing_edges_trail_id ON routing_edges(trail_id);

-- Update schema version
INSERT INTO schema_version (version, description) VALUES (5, 'Fixed routing table schema to match native PostGIS functions'); 