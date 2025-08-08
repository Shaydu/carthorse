const fs = require('fs');

function generateFixedEdgeSQL(stagingSchema, toleranceDegrees) {
    return `
      INSERT INTO ${stagingSchema}.routing_edges (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry, geojson)
      WITH trail_segments AS (
        -- For each trail segment, find its start and end points
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          ST_Force2D(geometry) as trail_geometry
        FROM ${stagingSchema}.trails
        WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry) 
        AND length_km > 0
      ),
      start_nodes AS (
        -- Find the closest node to each trail start point
        SELECT DISTINCT ON (ts.trail_id)
          ts.trail_id,
          ts.trail_name,
          ts.length_km,
          ts.elevation_gain,
          ts.elevation_loss,
          ts.trail_geometry,
          n.id as source_id,
          ST_Distance(
            ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326),
            ts.start_point
          ) as start_distance
        FROM trail_segments ts
        JOIN ${stagingSchema}.routing_nodes n ON 
          ST_DWithin(
            ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326),
            ts.start_point,
            ${toleranceDegrees}
          )
        ORDER BY ts.trail_id, start_distance ASC
      ),
      end_nodes AS (
        -- Find the closest node to each trail end point
        SELECT DISTINCT ON (sn.trail_id)
          sn.trail_id,
          sn.trail_name,
          sn.length_km,
          sn.elevation_gain,
          sn.elevation_loss,
          sn.trail_geometry,
          sn.source_id,
          n.id as target_id,
          ST_Distance(
            ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326),
            ts.end_point
          ) as end_distance
        FROM start_nodes sn
        JOIN trail_segments ts ON sn.trail_id = ts.trail_id
        JOIN ${stagingSchema}.routing_nodes n ON 
          ST_DWithin(
            ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326),
            ts.end_point,
            ${toleranceDegrees}
          )
        ORDER BY sn.trail_id, end_distance ASC
      )
      SELECT DISTINCT
        source_id as source,
        target_id as target,
        trail_id,
        trail_name,
        length_km,
        elevation_gain,
        elevation_loss,
        ST_MakeLine(
          ST_SetSRID(ST_MakePoint(n1.lng, n1.lat), 4326),
          ST_SetSRID(ST_MakePoint(n2.lng, n2.lat), 4326)
        ) as geometry,
        ST_AsGeoJSON(
          ST_MakeLine(
            ST_SetSRID(ST_MakePoint(n1.lng, n1.lat), 4326),
            ST_SetSRID(ST_MakePoint(n2.lng, n2.lat), 4326)
          ), 6, 0
        ) as geojson
      FROM end_nodes
      JOIN ${stagingSchema}.routing_nodes n1 ON n1.id = source_id
      JOIN ${stagingSchema}.routing_nodes n2 ON n2.id = target_id
      WHERE source_id IS NOT NULL 
      AND target_id IS NOT NULL
      AND source_id <> target_id
    `;
}

function generateAlternativeEdgeSQL(stagingSchema, toleranceDegrees) {
    return `
      INSERT INTO ${stagingSchema}.routing_edges (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry, geojson)
      WITH trail_endpoints AS (
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point
        FROM ${stagingSchema}.trails
        WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry) 
        AND length_km > 0
      ),
      unique_connections AS (
        -- Use DISTINCT to ensure only one edge per trail segment
        SELECT DISTINCT
          te.trail_id,
          te.trail_name,
          te.length_km,
          te.elevation_gain,
          te.elevation_loss,
          -- Find the closest start node
          (SELECT n.id 
           FROM ${stagingSchema}.routing_nodes n 
           WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), te.start_point, ${toleranceDegrees})
           ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), te.start_point)
           LIMIT 1) as source_id,
          -- Find the closest end node
          (SELECT n.id 
           FROM ${stagingSchema}.routing_nodes n 
           WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), te.end_point, ${toleranceDegrees})
           ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), te.end_point)
           LIMIT 1) as target_id
        FROM trail_endpoints te
        WHERE te.trail_id IS NOT NULL
      )
      SELECT 
        source_id as source,
        target_id as target,
        trail_id,
        trail_name,
        length_km,
        elevation_gain,
        elevation_loss,
        ST_MakeLine(
          ST_SetSRID(ST_MakePoint(n1.lng, n1.lat), 4326),
          ST_SetSRID(ST_MakePoint(n2.lng, n2.lat), 4326)
        ) as geometry,
        ST_AsGeoJSON(
          ST_MakeLine(
            ST_SetSRID(ST_MakePoint(n1.lng, n1.lat), 4326),
            ST_SetSRID(ST_MakePoint(n2.lng, n2.lat), 4326)
          ), 6, 0
        ) as geojson
      FROM unique_connections
      JOIN ${stagingSchema}.routing_nodes n1 ON n1.id = source_id
      JOIN ${stagingSchema}.routing_nodes n2 ON n2.id = target_id
      WHERE source_id IS NOT NULL 
      AND target_id IS NOT NULL
      AND source_id <> target_id
    `;
}

// Generate both SQL versions
const stagingSchema = 'staging_example';
const toleranceDegrees = 0.0001; // ~11 meters

console.log('🔧 Generating fixed edge generation SQL...\n');

console.log('=== VERSION 1: DISTINCT ON Approach ===');
console.log(generateFixedEdgeSQL(stagingSchema, toleranceDegrees));

console.log('\n=== VERSION 2: Subquery Approach ===');
console.log(generateAlternativeEdgeSQL(stagingSchema, toleranceDegrees));

console.log('\n=== RECOMMENDATION ===');
console.log('Use VERSION 1 (DISTINCT ON) as it:');
console.log('1. Ensures only one edge per trail segment');
console.log('2. Selects the closest node to each endpoint');
console.log('3. Prevents duplicate edges with the same trail_id');
console.log('4. Maintains routing network integrity');

// Save the fixed SQL to a file
const fixedSQL = generateFixedEdgeSQL(stagingSchema, toleranceDegrees);
fs.writeFileSync('scripts/fixed-edge-generation.sql', fixedSQL);
console.log('\n✅ Fixed SQL saved to scripts/fixed-edge-generation.sql'); 