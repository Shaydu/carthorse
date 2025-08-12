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

async function analyzeSpecificGap() {
  try {
    await client.connect();
    console.log('🔍 Analyzing specific gap between trail endpoints...');

    // Trail IDs from the user
    const trail1Id = '6357ecb0-b5b6-4aa8-ba49-27bf6106595b';
    const trail2Id = 'd8ec6e2b-dfd5-49f4-baf7-10c55a6a4377';

    // Coordinates from the user
    const point1 = [-105.284692, 39.979528, 1892.259155];
    const point2 = [-105.284509, 39.979646, 1898.36731];

    console.log('\n📊 Trail Endpoints Analysis:');
    console.log(`Point 1: [${point1.join(', ')}]`);
    console.log(`Point 2: [${point2.join(', ')}]`);

    // Calculate distances using PostGIS
    const distanceAnalysis = await client.query(`
      SELECT 
        ST_Distance(
          ST_SetSRID(ST_MakePoint($1, $2, $3), 4326)::geography,
          ST_SetSRID(ST_MakePoint($4, $5, $6), 4326)::geography
        ) as distance_meters,
        ST_Distance(
          ST_SetSRID(ST_MakePoint($1, $2), 4326),
          ST_SetSRID(ST_MakePoint($4, $5), 4326)
        ) * 111000 as distance_meters_2d,
        $6 - $3 as elevation_difference_meters
    `, [point1[0], point1[1], point1[2], point2[0], point2[1], point2[2]]);

    const distance = distanceAnalysis.rows[0];
    console.log(`\n📏 Distance Analysis:`);
    console.log(`  3D Distance: ${distance.distance_meters.toFixed(3)}m`);
    console.log(`  2D Distance: ${distance.distance_meters_2d.toFixed(3)}m`);
    console.log(`  Elevation Difference: ${distance.elevation_difference_meters.toFixed(3)}m`);

    // Get the actual trail geometries and endpoints
    const trailEndpoints = await client.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsText(ST_StartPoint(geometry)) as start_point_3d,
        ST_AsText(ST_EndPoint(geometry)) as end_point_3d,
        ST_AsText(ST_Force2D(ST_StartPoint(geometry))) as start_point_2d,
        ST_AsText(ST_Force2D(ST_EndPoint(geometry))) as end_point_2d,
        ST_Length(geometry::geography) as length_meters
      FROM ${STAGING_SCHEMA}.trails 
      WHERE app_uuid IN ($1, $2)
      ORDER BY app_uuid
    `, [trail1Id, trail2Id]);

    console.log('\n🎯 Actual Trail Endpoints:');
    trailEndpoints.rows.forEach((trail, index) => {
      console.log(`\nTrail ${index + 1}: ${trail.name} (${trail.app_uuid})`);
      console.log(`  Length: ${trail.length_meters.toFixed(2)}m`);
      console.log(`  Start (3D): ${trail.start_point_3d}`);
      console.log(`  End (3D): ${trail.end_point_3d}`);
      console.log(`  Start (2D): ${trail.start_point_2d}`);
      console.log(`  End (2D): ${trail.end_point_2d}`);
    });

    // Check which endpoints are closest to the user's coordinates
    const closestEndpoints = await client.query(`
      WITH user_points AS (
        SELECT 
          ST_SetSRID(ST_MakePoint($1, $2, $3), 4326) as point1_3d,
          ST_SetSRID(ST_MakePoint($4, $5, $6), 4326) as point2_3d,
          ST_SetSRID(ST_MakePoint($1, $2), 4326) as point1_2d,
          ST_SetSRID(ST_MakePoint($4, $5), 4326) as point2_2d
      ),
      trail_endpoints AS (
        SELECT 
          app_uuid,
          name,
          ST_StartPoint(geometry) as start_3d,
          ST_EndPoint(geometry) as end_3d,
          ST_Force2D(ST_StartPoint(geometry)) as start_2d,
          ST_Force2D(ST_EndPoint(geometry)) as end_2d
        FROM ${STAGING_SCHEMA}.trails 
        WHERE app_uuid IN ($7, $8)
      )
      SELECT 
        t.app_uuid,
        t.name,
        'start' as endpoint_type,
        ST_Distance(t.start_3d, up.point1_3d) as distance_to_point1_3d,
        ST_Distance(t.start_3d, up.point2_3d) as distance_to_point2_3d,
        ST_Distance(t.start_2d, up.point1_2d) as distance_to_point1_2d,
        ST_Distance(t.start_2d, up.point2_2d) as distance_to_point2_2d,
        ST_AsText(t.start_3d) as coordinates_3d,
        ST_AsText(t.start_2d) as coordinates_2d
      FROM trail_endpoints t, user_points up
      
      UNION ALL
      
      SELECT 
        t.app_uuid,
        t.name,
        'end' as endpoint_type,
        ST_Distance(t.end_3d, up.point1_3d) as distance_to_point1_3d,
        ST_Distance(t.end_3d, up.point2_3d) as distance_to_point2_3d,
        ST_Distance(t.end_2d, up.point1_2d) as distance_to_point1_2d,
        ST_Distance(t.end_2d, up.point2_2d) as distance_to_point2_2d,
        ST_AsText(t.end_3d) as coordinates_3d,
        ST_AsText(t.end_2d) as coordinates_2d
      FROM trail_endpoints t, user_points up
      
      ORDER BY app_uuid, endpoint_type
    `, [point1[0], point1[1], point1[2], point2[0], point2[1], point2[2], trail1Id, trail2Id]);

    console.log('\n🎯 Closest Endpoint Analysis:');
    closestEndpoints.rows.forEach(endpoint => {
      console.log(`\n${endpoint.name} (${endpoint.app_uuid}) - ${endpoint.endpoint_type} point:`);
      console.log(`  Coordinates (3D): ${endpoint.coordinates_3d}`);
      console.log(`  Coordinates (2D): ${endpoint.coordinates_2d}`);
      console.log(`  Distance to Point 1 (3D): ${endpoint.distance_to_point1_3d.toFixed(6)}m`);
      console.log(`  Distance to Point 2 (3D): ${endpoint.distance_to_point2_3d.toFixed(6)}m`);
      console.log(`  Distance to Point 1 (2D): ${endpoint.distance_to_point1_2d.toFixed(6)}m`);
      console.log(`  Distance to Point 2 (2D): ${endpoint.distance_to_point2_2d.toFixed(6)}m`);
    });

    // Check current routing network status
    const routingStatus = await client.query(`
      SELECT 
        id,
        source,
        target,
        app_uuid,
        name,
        ST_AsText(ST_StartPoint(the_geom)) as edge_start,
        ST_AsText(ST_EndPoint(the_geom)) as edge_end,
        ST_Length(the_geom::geography) as length_meters
      FROM ${STAGING_SCHEMA}.ways_noded
      WHERE app_uuid IN ($1, $2)
      ORDER BY app_uuid
    `, [trail1Id, trail2Id]);

    console.log('\n🔗 Current Routing Network Status:');
    if (routingStatus.rows.length === 0) {
      console.log('  ❌ No edges found in routing network for these trails');
    } else {
      routingStatus.rows.forEach(edge => {
        console.log(`\n  Edge ${edge.id}: ${edge.name} (${edge.app_uuid})`);
        console.log(`    Source: ${edge.source}, Target: ${edge.target}`);
        console.log(`    Length: ${edge.length_meters.toFixed(2)}m`);
        console.log(`    Start: ${edge.edge_start}`);
        console.log(`    End: ${edge.edge_end}`);
      });
    }

    // Recommend solution approach
    console.log('\n💡 Solution Recommendations:');
    
    if (distance.distance_meters < 1.0) {
      console.log('  ✅ Gap is very small (< 1m) - SNAPPING is recommended');
      console.log('  🔧 Approach: Snap the endpoints together by merging vertices');
    } else if (distance.distance_meters < 10.0) {
      console.log('  ✅ Gap is small (< 10m) - EXTENDING is recommended');
      console.log('  🔧 Approach: Extend one trail to meet the other');
    } else {
      console.log('  ✅ Gap is significant (> 10m) - CONNECTOR is recommended');
      console.log('  🔧 Approach: Create a straight-line connector edge');
    }

    console.log(`\n📋 Gap Details:`);
    console.log(`  Horizontal gap: ${distance.distance_meters_2d.toFixed(3)}m`);
    console.log(`  Vertical gap: ${distance.elevation_difference_meters.toFixed(3)}m`);
    console.log(`  Total 3D gap: ${distance.distance_meters.toFixed(3)}m`);

  } catch (error) {
    console.error('❌ Error analyzing specific gap:', error);
  } finally {
    await client.end();
  }
}

analyzeSpecificGap();
