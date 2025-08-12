-- Populate Staging Schema with Boulder Trails
-- This script populates the staging schema with trails for testing the routing fix

-- Set the staging schema
\set staging_schema 'staging_boulder_1754918168168'

-- Clear existing data
DELETE FROM :staging_schema.trails;
DELETE FROM :staging_schema.routing_nodes;
DELETE FROM :staging_schema.routing_edges;

-- Populate staging schema with boulder trails
INSERT INTO :staging_schema.trails (
    id, app_uuid, name, region, length_km, elevation_gain, elevation_loss, geometry, trail_type
)
SELECT 
    id, app_uuid, name, region, length_km, elevation_gain, elevation_loss, geometry, trail_type
FROM trails 
WHERE region = 'boulder'
  AND geometry IS NOT NULL 
  AND ST_IsValid(geometry)
  AND length_km > 0;

-- Show the count of trails copied
SELECT 
    'Trails copied to staging' as operation,
    COUNT(*) as count
FROM :staging_schema.trails;

-- Show sample trails
SELECT 
    id,
    name,
    length_km,
    ST_AsText(ST_StartPoint(geometry)) as start_point,
    ST_AsText(ST_EndPoint(geometry)) as end_point
FROM :staging_schema.trails
LIMIT 5;



