#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');

// Configuration
const config = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu',
  stagingSchema: 'carthorse_1755735378966' // Most recent staging schema with split Hogback data
};

async function fixHogbackRouting() {
  const client = new Pool(config);
  
  try {
    await client.connect();
    console.log('🔍 Analyzing Hogback routing issues...');

    // Step 1: Check current state of Hogback segments
    console.log('\n📊 Current Hogback segments:');
    const hogbackSegments = await client.query(`
      SELECT 
        app_uuid,
        name,
        length_km,
        ST_NumPoints(geometry) as num_points,
        ST_IsValid(geometry) as is_valid,
        ST_IsSimple(geometry) as is_simple,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${config.stagingSchema}.trails 
      WHERE name LIKE '%Hogback%'
      ORDER BY name, length_km DESC
    `);

    console.log(`Found ${hogbackSegments.rows.length} Hogback segments:`);
    hogbackSegments.rows.forEach((segment, i) => {
      console.log(`  ${i + 1}. ${segment.name}: ${segment.length_km.toFixed(2)}km, ${segment.num_points} points, valid: ${segment.is_valid}, simple: ${segment.is_simple}`);
    });

    // Step 2: Check routing nodes for Hogback
    console.log('\n📍 Hogback routing nodes:');
    const hogbackNodes = await client.query(`
      SELECT 
        id,
        lat,
        lng,
        node_type,
        connected_trails
      FROM ${config.stagingSchema}.routing_nodes 
      WHERE connected_trails LIKE '%Hogback%'
      ORDER BY id
    `);

    console.log(`Found ${hogbackNodes.rows.length} routing nodes for Hogback:`);
    hogbackNodes.rows.forEach((node, i) => {
      console.log(`  ${i + 1}. Node ${node.id}: (${node.lat.toFixed(6)}, ${node.lng.toFixed(6)}) - ${node.node_type} - ${node.connected_trails}`);
    });

    // Step 3: Check routing edges for Hogback
    console.log('\n🛤️ Hogback routing edges:');
    const hogbackEdges = await client.query(`
      SELECT 
        id,
        source,
        target,
        trail_id,
        trail_name,
        length_km,
        elevation_gain,
        elevation_loss
      FROM ${config.stagingSchema}.routing_edges 
      WHERE trail_name LIKE '%Hogback%'
      ORDER BY trail_name, length_km DESC
    `);

    console.log(`Found ${hogbackEdges.rows.length} routing edges for Hogback:`);
    hogbackEdges.rows.forEach((edge, i) => {
      console.log(`  ${i + 1}. Edge ${edge.id}: ${edge.source} → ${edge.target} - ${edge.trail_name} (${edge.length_km.toFixed(2)}km, +${edge.elevation_gain}m)`);
    });

    // Step 4: Check connectivity between Hogback segments
    console.log('\n🔗 Hogback segment connectivity:');
    const connectivity = await client.query(`
      WITH hogback_segments AS (
        SELECT 
          app_uuid,
          name,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          geometry
        FROM ${config.stagingSchema}.trails 
        WHERE name LIKE '%Hogback%'
      ),
      segment_connections AS (
        SELECT 
          h1.name as segment1,
          h2.name as segment2,
          ST_Distance(h1.end_point, h2.start_point) as distance_start_start,
          ST_Distance(h1.end_point, h2.end_point) as distance_start_end,
          ST_Distance(h1.start_point, h2.start_point) as distance_end_start,
          ST_Distance(h1.start_point, h2.end_point) as distance_end_end
        FROM hogback_segments h1
        CROSS JOIN hogback_segments h2
        WHERE h1.app_uuid < h2.app_uuid
      )
      SELECT 
        segment1,
        segment2,
        LEAST(distance_start_start, distance_start_end, distance_end_start, distance_end_end) as min_distance_meters,
        CASE 
          WHEN LEAST(distance_start_start, distance_start_end, distance_end_start, distance_end_end) <= 10 THEN 'CONNECTED'
          WHEN LEAST(distance_start_start, distance_start_end, distance_end_start, distance_end_end) <= 50 THEN 'NEAR'
          ELSE 'DISCONNECTED'
        END as connection_status
      FROM segment_connections
      ORDER BY min_distance_meters
    `);

    console.log(`Segment connectivity analysis:`);
    connectivity.rows.forEach((conn, i) => {
      console.log(`  ${i + 1}. ${conn.segment1} ↔ ${conn.segment2}: ${conn.min_distance_meters.toFixed(1)}m (${conn.connection_status})`);
    });

    // Step 5: Generate test routes using Hogback
    console.log('\n🛤️ Testing Hogback route generation...');
    const testRoutes = await client.query(`
      WITH hogback_nodes AS (
        SELECT id FROM ${config.stagingSchema}.routing_nodes 
        WHERE connected_trails LIKE '%Hogback%'
        LIMIT 5
      ),
      route_tests AS (
        SELECT 
          n1.id as start_node,
          n2.id as end_node,
          pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${config.stagingSchema}.routing_edges',
            n1.id,
            n2.id,
            false
          ) as route_result
        FROM hogback_nodes n1
        CROSS JOIN hogback_nodes n2
        WHERE n1.id < n2.id
        LIMIT 3
      )
      SELECT 
        start_node,
        end_node,
        COUNT(*) as edge_count,
        SUM(cost) as total_cost
      FROM route_tests,
      LATERAL unnest(route_result) as route
      GROUP BY start_node, end_node
      ORDER BY total_cost
    `);

    console.log(`Route generation test results:`);
    if (testRoutes.rows.length > 0) {
      testRoutes.rows.forEach((route, i) => {
        console.log(`  ${i + 1}. Node ${route.start_node} → Node ${route.end_node}: ${route.edge_count} edges, ${route.total_cost.toFixed(2)}km`);
      });
    } else {
      console.log('  ⚠️ No routes found - possible connectivity issues');
    }

    // Step 6: Provide recommendations
    console.log('\n💡 Recommendations for Hogback routing:');
    
    const disconnectedSegments = connectivity.rows.filter(c => c.connection_status === 'DISCONNECTED');
    if (disconnectedSegments.length > 0) {
      console.log('  🔧 Issues found:');
      console.log(`    - ${disconnectedSegments.length} segment pairs are disconnected`);
      console.log('    - Consider re-running trail splitting with better intersection detection');
      console.log('    - Or manually connect segments using endpoint snapping');
    }

    const nearSegments = connectivity.rows.filter(c => c.connection_status === 'NEAR');
    if (nearSegments.length > 0) {
      console.log('  🔗 Near-miss segments:');
      console.log(`    - ${nearSegments.length} segment pairs are close but not connected`);
      console.log('    - Consider reducing intersection tolerance in splitting process');
    }

    if (hogbackEdges.rows.length === 0) {
      console.log('  ❌ No routing edges found for Hogback');
      console.log('    - Re-run routing edge generation');
      console.log('    - Check if Hogback segments have valid geometry');
    }

    if (testRoutes.rows.length === 0) {
      console.log('  ❌ No routes can be generated through Hogback');
      console.log('    - Check routing node connectivity');
      console.log('    - Verify routing edges are properly connected');
    }

    // Step 7: Generate a simple loop route using Hogback if possible
    console.log('\n🔄 Attempting to generate a Hogback loop route...');
    const loopRoute = await client.query(`
      WITH hogback_cycles AS (
        SELECT 
          path_id as cycle_id,
          edge as edge_id,
          cost,
          agg_cost,
          path_seq
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, length_km as cost FROM ${config.stagingSchema}.routing_edges WHERE trail_name LIKE ''%Hogback%'''
        )
        WHERE cost > 0
        ORDER BY agg_cost DESC
        LIMIT 1
      )
      SELECT 
        cycle_id,
        COUNT(*) as edge_count,
        SUM(cost) as total_distance_km,
        array_agg(edge_id ORDER BY path_seq) as edge_sequence
      FROM hogback_cycles
      GROUP BY cycle_id
    `);

    if (loopRoute.rows.length > 0) {
      const route = loopRoute.rows[0];
      console.log(`✅ Found Hogback loop route:`);
      console.log(`  - ${route.edge_count} edges`);
      console.log(`  - ${route.total_distance_km.toFixed(2)}km total distance`);
      console.log(`  - Edge sequence: [${route.edge_sequence.join(', ')}]`);
    } else {
      console.log('❌ No loop routes found using Hogback segments');
    }

    console.log('\n✅ Hogback routing analysis complete!');

  } catch (error) {
    console.error('❌ Error analyzing Hogback routing:', error);
  } finally {
    await client.end();
  }
}

// Run the analysis
fixHogbackRouting().catch(console.error);
