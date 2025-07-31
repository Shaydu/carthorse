-- Carthorse Staging Schema Template
-- Generated: 2025-07-31T20:30:18.440Z
-- Purpose: Template for staging schemas created during export

-- ========================================
-- STAGING SCHEMA TEMPLATE
-- ========================================

-- This schema is created dynamically during export
-- Tables: trails, routing_nodes, routing_edges, intersection_points, trail_hashes
-- Functions: None (functions are called from public schema)

-- Example staging schema creation:
-- CREATE SCHEMA IF NOT EXISTS staging_boulder_<timestamp>;
-- 
-- CREATE TABLE staging_boulder_<timestamp>.trails (
--   id SERIAL PRIMARY KEY,
--   name TEXT,
--   geojson TEXT,
--   -- ... other fields
-- );
-- 
-- CREATE TABLE staging_boulder_<timestamp>.routing_nodes (
--   id SERIAL PRIMARY KEY,
--   lat DOUBLE PRECISION,
--   lng DOUBLE PRECISION,
--   node_type TEXT,
--   connected_trails TEXT
-- );
-- 
-- CREATE TABLE staging_boulder_<timestamp>.routing_edges (
--   id SERIAL PRIMARY KEY,
--   source INTEGER,
--   target INTEGER,
--   cost DOUBLE PRECISION,
--   reverse_cost DOUBLE PRECISION
-- );

