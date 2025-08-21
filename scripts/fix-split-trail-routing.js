#!/usr/bin/env node

const { Pool } = require('pg');

// Configuration
const config = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu',
  stagingSchema: 'carthorse_1755735378966' // Most recent staging schema with split Hogback data
};

async function fixSplitTrailRouting() {
  const client = new Pool(config);
  
  try {
    await client.connect();
    console.log('🔧 Fixing split trail routing issues...');

    // Step 1: Analyze split trail segments
    console.log('\n📊 Analyzing split trail segments...');
    const splitTrails = await client.query(`
      SELECT 
        name,
        COUNT(*) as segment_count,
        SUM(length_km) as total_length_km,
        AVG(length_km) as avg_length_km,
        MIN(length_km) as min_length_km,
        MAX(length_km) as max_length_km
      FROM ${config.stagingSchema}.trails 
      WHERE name LIKE '%Segment%' OR name LIKE '%(Segment%'
      GROUP BY name
      ORDER BY segment_count DESC, total_length_km DESC
    `);

    console.log(`Found ${splitTrails.rows.length} split trails:`);
    splitTrails.rows.forEach((trail, i) => {
      console.log(`  ${i + 1}. ${trail.name}: ${trail.segment_count} segments, ${trail.total_length_km.toFixed(2)}km total`);
    });

    // Step 2: Check for disconnected segments
    console.log('\n🔗 Checking segment connectivity...');
    const disconnectedSegments = await client.query(`
      WITH split_trail_segments AS (
        SELECT 
          name,
          app_uuid,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          geometry
        FROM ${config.stagingSchema}.trails 
        WHERE name LIKE '%Segment%' OR name LIKE '%(Segment%'
      ),
      segment_connections AS (
        SELECT 
          s1.name as trail_name,
          s1.app_uuid as segment1_uuid,
          s2.app_uuid as segment2_uuid,
          ST_Distance(s1.end_point, s2.start_point) as distance_start_start,
          ST_Distance(s1.end_point, s2.end_point) as distance_start_end,
          ST_Distance(s1.start_point, s2.start_point) as distance_end_start,
          ST_Distance(s1.start_point, s2.end_point) as distance_end_end
        FROM split_trail_segments s1
        CROSS JOIN split_trail_segments s2
        WHERE s1.name = s2.name AND s1.app_uuid < s2.app_uuid
      )
      SELECT 
        trail_name,
        segment1_uuid,
        segment2_uuid,
        LEAST(distance_start_start, distance_start_end, distance_end_start, distance_end_end) as min_distance_meters,
        CASE 
          WHEN LEAST(distance_start_start, distance_start_end, distance_end_start, distance_end_end) <= 10 THEN 'CONNECTED'
          WHEN LEAST(distance_start_start, distance_start_end, distance_end_start, distance_end_end) <= 50 THEN 'NEAR'
          ELSE 'DISCONNECTED'
        END as connection_status
      FROM segment_connections
      ORDER BY trail_name, min_distance_meters
    `);

    const disconnectedCount = disconnectedSegments.rows.filter(r => r.connection_status === 'DISCONNECTED').length;
    const nearCount = disconnectedSegments.rows.filter(r => r.connection_status === 'NEAR').length;
    
    console.log(`Connectivity analysis:`);
    console.log(`  - Disconnected segments: ${disconnectedCount}`);
    console.log(`  - Near-miss segments: ${nearCount}`);
    console.log(`  - Connected segments: ${disconnectedSegments.rows.length - disconnectedCount - nearCount}`);

    // Step 3: Fix disconnected segments by creating connector edges
    if (disconnectedCount > 0 || nearCount > 0) {
      console.log('\n🔧 Creating connector edges for disconnected segments...');
      
      await client.query(`
        INSERT INTO ${config.stagingSchema}.routing_edges (
          source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, 
          geometry, geojson, is_connector
        )
        WITH split_trail_segments AS (
          SELECT 
            name,
            app_uuid,
            ST_StartPoint(geometry) as start_point,
            ST_EndPoint(geometry) as end_point,
            geometry
          FROM ${config.stagingSchema}.trails 
          WHERE name LIKE '%Segment%' OR name LIKE '%(Segment%'
        ),
        segment_connections AS (
          SELECT 
            s1.name as trail_name,
            s1.app_uuid as segment1_uuid,
            s2.app_uuid as segment2_uuid,
            s1.end_point as point1,
            s2.start_point as point2,
            ST_Distance(s1.end_point, s2.start_point) as distance_start_start,
            ST_Distance(s1.end_point, s2.end_point) as distance_start_end,
            ST_Distance(s1.start_point, s2.start_point) as distance_end_start,
            ST_Distance(s1.start_point, s2.end_point) as distance_end_end
          FROM split_trail_segments s1
          CROSS JOIN split_trail_segments s2
          WHERE s1.name = s2.name AND s1.app_uuid < s2.app_uuid
        ),
        best_connections AS (
          SELECT 
            trail_name,
            segment1_uuid,
            segment2_uuid,
            point1,
            point2,
            LEAST(distance_start_start, distance_start_end, distance_end_start, distance_end_end) as min_distance_meters,
            CASE 
              WHEN distance_start_start = LEAST(distance_start_start, distance_start_end, distance_end_start, distance_end_end) THEN 'end_to_start'
              WHEN distance_start_end = LEAST(distance_start_start, distance_start_end, distance_end_start, distance_end_end) THEN 'end_to_end'
              WHEN distance_end_start = LEAST(distance_start_start, distance_start_end, distance_end_start, distance_end_end) THEN 'start_to_start'
              ELSE 'start_to_end'
            END as connection_type
          FROM segment_connections
          WHERE LEAST(distance_start_start, distance_start_end, distance_end_start, distance_end_end) <= 50
        ),
        connector_edges AS (
          SELECT 
            trail_name,
            segment1_uuid,
            segment2_uuid,
            point1,
            point2,
            min_distance_meters,
            connection_type,
            ST_MakeLine(point1, point2) as connector_geometry,
            ST_Length(ST_MakeLine(point1, point2)::geography) / 1000.0 as connector_length_km
          FROM best_connections
        ),
        node_mapping AS (
          SELECT 
            ce.*,
            n1.id as source_node_id,
            n2.id as target_node_id
          FROM connector_edges ce
          CROSS JOIN LATERAL (
            SELECT id FROM ${config.stagingSchema}.routing_nodes 
            WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ce.point1, 0.001)
            ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ce.point1)
            LIMIT 1
          ) n1
          CROSS JOIN LATERAL (
            SELECT id FROM ${config.stagingSchema}.routing_nodes 
            WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ce.point2, 0.001)
            ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ce.point2)
            LIMIT 1
          ) n2
          WHERE n1.id IS NOT NULL AND n2.id IS NOT NULL AND n1.id != n2.id
        )
        SELECT 
          source_node_id as source,
          target_node_id as target,
          segment1_uuid as trail_id,
          trail_name || ' (Connector)' as trail_name,
          connector_length_km as length_km,
          0 as elevation_gain,
          0 as elevation_loss,
          connector_geometry as geometry,
          ST_AsGeoJSON(connector_geometry, 6, 0) as geojson,
          true as is_connector
        FROM node_mapping
        WHERE connector_length_km > 0
      `);

      const connectorResult = await client.query(`
        SELECT COUNT(*) as connector_count FROM ${config.stagingSchema}.routing_edges WHERE is_connector = true
      `);
      console.log(`✅ Created ${connectorResult.rows[0].connector_count} connector edges`);
    }

    // Step 4: Regenerate routing nodes with better tolerance
    console.log('\n📍 Regenerating routing nodes with improved tolerance...');
    await client.query(`
      SELECT generate_routing_nodes_native($1, $2)
    `, [config.stagingSchema, 10.0]); // 10 meter tolerance for better connectivity

    console.log('✅ Routing nodes regenerated');

    // Step 5: Regenerate routing edges
    console.log('\n🛤️ Regenerating routing edges...');
    await client.query(`
      SELECT generate_routing_edges_native($1, $2)
    `, [config.stagingSchema, 10.0]); // 10 meter tolerance

    console.log('✅ Routing edges regenerated');

    // Step 6: Test route generation for split trails
    console.log('\n🛤️ Testing route generation for split trails...');
    const testRoutes = await client.query(`
      WITH split_trail_nodes AS (
        SELECT id FROM ${config.stagingSchema}.routing_nodes 
        WHERE connected_trails LIKE '%Segment%' OR connected_trails LIKE '%(Segment%'
        LIMIT 10
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
        FROM split_trail_nodes n1
        CROSS JOIN split_trail_nodes n2
        WHERE n1.id < n2.id
        LIMIT 5
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

    // Step 7: Generate loop routes for split trails
    console.log('\n🔄 Generating loop routes for split trails...');
    const loopRoutes = await client.query(`
      WITH split_trail_cycles AS (
        SELECT 
          path_id as cycle_id,
          edge as edge_id,
          cost,
          agg_cost,
          path_seq
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, length_km as cost FROM ${config.stagingSchema}.routing_edges WHERE trail_name LIKE ''%Segment%'' OR trail_name LIKE ''%(Segment%'''
        )
        WHERE cost > 0
        ORDER BY agg_cost DESC
        LIMIT 3
      )
      SELECT 
        cycle_id,
        COUNT(*) as edge_count,
        SUM(cost) as total_distance_km,
        array_agg(edge_id ORDER BY path_seq) as edge_sequence
      FROM split_trail_cycles
      GROUP BY cycle_id
      ORDER BY total_distance_km DESC
    `);

    console.log(`Loop route generation results:`);
    if (loopRoutes.rows.length > 0) {
      loopRoutes.rows.forEach((route, i) => {
        console.log(`  ${i + 1}. Loop ${route.cycle_id}: ${route.edge_count} edges, ${route.total_distance_km.toFixed(2)}km`);
      });
    } else {
      console.log('  ❌ No loop routes found');
    }

    // Step 8: Summary and recommendations
    console.log('\n📋 Summary and recommendations:');
    
    const totalEdges = await client.query(`SELECT COUNT(*) as count FROM ${config.stagingSchema}.routing_edges`);
    const totalNodes = await client.query(`SELECT COUNT(*) as count FROM ${config.stagingSchema}.routing_nodes`);
    const connectorEdges = await client.query(`SELECT COUNT(*) as count FROM ${config.stagingSchema}.routing_edges WHERE is_connector = true`);
    
    console.log(`  - Total routing edges: ${totalEdges.rows[0].count}`);
    console.log(`  - Total routing nodes: ${totalNodes.rows[0].count}`);
    console.log(`  - Connector edges created: ${connectorEdges.rows[0].count}`);
    
    if (testRoutes.rows.length > 0) {
      console.log('  ✅ Route generation is working');
    } else {
      console.log('  ❌ Route generation needs attention');
    }
    
    if (loopRoutes.rows.length > 0) {
      console.log('  ✅ Loop route generation is working');
    } else {
      console.log('  ❌ Loop route generation needs attention');
    }

    console.log('\n✅ Split trail routing fix complete!');

  } catch (error) {
    console.error('❌ Error fixing split trail routing:', error);
  } finally {
    await client.end();
  }
}

// Run the fix
fixSplitTrailRouting().catch(console.error);
