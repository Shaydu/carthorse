-- Migration script to update production database to v3 schema
-- This adds missing columns and updates the schema to match our current code

-- Add missing columns to routing_nodes
ALTER TABLE public.routing_nodes 
ADD COLUMN IF NOT EXISTS node_uuid TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')),
ADD COLUMN IF NOT EXISTS connected_trails TEXT,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Add missing columns to routing_edges  
ALTER TABLE public.routing_edges
ADD COLUMN IF NOT EXISTS trail_id TEXT,
ADD COLUMN IF NOT EXISTS trail_name TEXT,
ADD COLUMN IF NOT EXISTS distance_km REAL,
ADD COLUMN IF NOT EXISTS elevation_gain REAL,
ADD COLUMN IF NOT EXISTS elevation_loss REAL,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Update routing_edges to use the new column names
-- First, populate trail_id and trail_name from existing data
UPDATE public.routing_edges 
SET trail_id = name,
    trail_name = name
WHERE trail_id IS NULL AND name IS NOT NULL;

-- Update distance_km from length if available
UPDATE public.routing_edges 
SET distance_km = length
WHERE distance_km IS NULL AND length IS NOT NULL;

-- Add indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_routing_nodes_node_type ON public.routing_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_node_uuid ON public.routing_nodes(node_uuid);
CREATE INDEX IF NOT EXISTS idx_routing_edges_trail_id ON public.routing_edges(trail_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_trail_name ON public.routing_edges(trail_name);

-- Update schema version
INSERT INTO schema_version (version) VALUES (3) ON CONFLICT DO NOTHING; 