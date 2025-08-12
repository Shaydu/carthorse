#!/usr/bin/env node

const { Client } = require('pg');

const client = new Client({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'shaydu',
  password: process.env.PGPASSWORD || 'shaydu'
});

const STAGING_SCHEMA = 'carthorse_1754992253411';

async function analyzeTrailGap() {
  try {
    await client.connect();
    console.log('🔍 Analyzing gap between specific trails...');

    // Trail IDs from the issue
    const trail1Id = '6357ecb0-b5b6-4aa8-ba49-27bf6106595b';
    const trail2Id = 'd8ec6e2b-dfd5-49f4-baf7-10c55a6a4377';

    // Get trail details
    const trailDetails = await client.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry::geography) as length_meters,
        ST_AsText(geometry) as geometry_text
      FROM ${STAGING_SCHEMA}.trails 
      WHERE app_uuid IN ($1, $2)
      ORDER BY app_uuid
    `, [trail1Id, trail2Id]);

    console.log('\n📊 Trail Details:');
    trailDetails.rows.forEach(trail => {
      console.log(`\nTrail: ${trail.name} (${trail.app_uuid})`);
      console.log(`  Length: ${trail.length_meters.toFixed(2)}m`);
      console.log(`  Start: ${trail.start_point}`);
      console.log(`  End: ${trail.end_point}`);
    });

    // Calculate distances between all endpoints
    const distances = await client.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid,
          name,
          ST_StartPoint(geometry) as start_pt,
          ST_EndPoint(geometry) as end_pt
        FROM ${STAGING_SCHEMA}.trails 
        WHERE app_uuid IN ($1, $2)
      )
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        'start-to-start' as connection_type,
        ST_Distance(t1.start_pt, t2.start_pt) as distance_meters
      FROM trail_endpoints t1, trail_endpoints t2
      WHERE t1.app_uuid < t2.app_uuid
      
      UNION ALL
      
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        'start-to-end' as connection_type,
        ST_Distance(t1.start_pt, t2.end_pt) as distance_meters
      FROM trail_endpoints t1, trail_endpoints t2
      WHERE t1.app_uuid < t2.app_uuid
      
      UNION ALL
      
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        'end-to-start' as connection_type,
        ST_Distance(t1.end_pt, t2.start_pt) as distance_meters
      FROM trail_endpoints t1, trail_endpoints t2
      WHERE t1.app_uuid < t2.app_uuid
      
      UNION ALL
      
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        'end-to-end' as connection_type,
        ST_Distance(t1.end_pt, t2.end_pt) as distance_meters
      FROM trail_endpoints t1, trail_endpoints t2
      WHERE t1.app_uuid < t2.app_uuid
      
      ORDER BY distance_meters
    `, [trail1Id, trail2Id]);

    console.log('\n📏 Distances between endpoints:');
    distances.rows.forEach(row => {
      console.log(`  ${row.trail1_name} ${row.connection_type} ${row.trail2_name}: ${row.distance_meters.toFixed(2)}m`);
    });

    // Check if these trails are in the routing network
    const routingEdges = await client.query(`
      SELECT 
        id,
        source,
        target,
        app_uuid,
        name,
        ST_Length(the_geom::geography) as length_meters
      FROM ${STAGING_SCHEMA}.ways_noded
      WHERE app_uuid IN ($1, $2)
      ORDER BY app_uuid
    `, [trail1Id, trail2Id]);

    console.log('\n🔗 Routing Network Status:');
    if (routingEdges.rows.length === 0) {
      console.log('  ❌ Neither trail found in routing network');
    } else {
      routingEdges.rows.forEach(edge => {
        console.log(`  ✅ ${edge.name} (${edge.app_uuid}): edge ${edge.id}, source=${edge.source}, target=${edge.target}, length=${edge.length_meters.toFixed(2)}m`);
      });
    }

    // Check vertex degrees for these edges
    if (routingEdges.rows.length > 0) {
      const vertexIds = routingEdges.rows.flatMap(edge => [edge.source, edge.target]);
      const vertexDegrees = await client.query(`
        SELECT 
          id,
          cnt as degree,
          ST_AsText(the_geom) as coordinates
        FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr
        WHERE id = ANY($1)
        ORDER BY id
      `, [vertexIds]);

      console.log('\n🎯 Vertex Degrees:');
      vertexDegrees.rows.forEach(vertex => {
        console.log(`  Vertex ${vertex.id}: degree ${vertex.degree} at ${vertex.coordinates}`);
      });
    }

    // Check for nearby vertices that could bridge the gap
    const nearbyVertices = await client.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid,
          ST_StartPoint(geometry) as start_pt,
          ST_EndPoint(geometry) as end_pt
        FROM ${STAGING_SCHEMA}.trails 
        WHERE app_uuid IN ($1, $2)
      ),
      all_endpoints AS (
        SELECT start_pt as pt FROM trail_endpoints
        UNION ALL
        SELECT end_pt as pt FROM trail_endpoints
      )
      SELECT 
        v.id as vertex_id,
        v.cnt as degree,
        ST_Distance(v.the_geom, ep.pt) as distance_meters,
        ST_AsText(v.the_geom) as vertex_coords
      FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr v
      CROSS JOIN all_endpoints ep
      WHERE ST_DWithin(v.the_geom, ep.pt, 0.001)  -- Within ~100m
      ORDER BY distance_meters
      LIMIT 10
    `, [trail1Id, trail2Id]);

    console.log('\n🔍 Nearby Vertices (within 100m of trail endpoints):');
    if (nearbyVertices.rows.length === 0) {
      console.log('  ❌ No vertices found within 100m of trail endpoints');
    } else {
      nearbyVertices.rows.forEach(vertex => {
        console.log(`  Vertex ${vertex.vertex_id}: degree ${vertex.degree}, distance ${vertex.distance_meters.toFixed(2)}m, at ${vertex.vertex_coords}`);
      });
    }

    // Check current intersection tolerance setting
    const toleranceResult = await client.query(`
      SELECT get_intersection_tolerance() as tolerance_meters
    `);
    const currentTolerance = toleranceResult.rows[0].tolerance_meters;
    console.log(`\n⚙️ Current intersection tolerance: ${currentTolerance}m`);

    // Suggest solutions
    console.log('\n💡 Suggested Solutions:');
    const minDistance = Math.min(...distances.rows.map(r => r.distance_meters));
    
    if (minDistance <= currentTolerance) {
      console.log(`  ✅ Gap (${minDistance.toFixed(2)}m) is within current tolerance (${currentTolerance}m)`);
      console.log('  🔧 Solution: Increase intersection tolerance or fix noding process');
    } else {
      console.log(`  ❌ Gap (${minDistance.toFixed(2)}m) exceeds current tolerance (${currentTolerance}m)`);
      console.log('  🔧 Solution: Create bridge edge or increase tolerance');
    }

  } catch (error) {
    console.error('❌ Error analyzing trail gap:', error);
  } finally {
    await client.end();
  }
}

analyzeTrailGap();
