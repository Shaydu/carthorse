#!/usr/bin/env ts-node

import { Pool } from 'pg';

async function testLayer2NetworkConnections() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🔍 Testing Layer 2 network connections...');
    
    // Get the most recent staging schema
    const schemaResult = await pgClient.query(`
      SELECT schemaname 
      FROM pg_tables 
      WHERE tablename = 'ways_noded' 
      ORDER BY schemaname DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema with ways_noded found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schemaname;
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Check if Bear Canyon and Fern Canyon trails exist in the original trails table
    console.log('\n🔍 Checking original trails for Bear Canyon and Fern Canyon...');
    const trailsResult = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails 
      WHERE LOWER(name) LIKE '%bear canyon%' OR LOWER(name) LIKE '%fern canyon%'
      ORDER BY name
    `);
    
    console.log(`📊 Found ${trailsResult.rows.length} relevant trails:`);
    trailsResult.rows.forEach((trail, index) => {
      console.log(`  ${index + 1}. ${trail.name} (${trail.app_uuid})`);
      console.log(`     Start: ${trail.start_point}`);
      console.log(`     End: ${trail.end_point}`);
      console.log(`     Length: ${trail.length_meters.toFixed(1)}m`);
    });
    
    // Check the ways_noded table structure
    console.log('\n🔍 Checking ways_noded table structure...');
    const structureResult = await pgClient.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'ways_noded'
      ORDER BY ordinal_position
    `, [stagingSchema]);
    
    console.log('📋 ways_noded table columns:');
    structureResult.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
    // Check if there are any edges in ways_noded that might connect Bear Canyon and Fern Canyon
    console.log('\n🔍 Checking ways_noded edges for potential connections...');
    const edgesResult = await pgClient.query(`
      SELECT 
        id,
        source,
        target,
        original_trail_uuid,
        name,
        ST_Length(the_geom::geography) as length_meters,
        ST_AsText(ST_StartPoint(the_geom)) as start_point,
        ST_AsText(ST_EndPoint(the_geom)) as end_point
      FROM ${stagingSchema}.ways_noded
      WHERE the_geom IS NOT NULL
      ORDER BY id
      LIMIT 20
    `);
    
    console.log(`📊 Sample ways_noded edges (first 20):`);
    edgesResult.rows.forEach((edge, index) => {
      console.log(`  ${index + 1}. Edge ${edge.id} (${edge.name || 'Unnamed'})`);
      console.log(`     Original Trail UUID: ${edge.original_trail_uuid}`);
      console.log(`     Source: ${edge.source} -> Target: ${edge.target}`);
      console.log(`     Start: ${edge.start_point}`);
      console.log(`     End: ${edge.end_point}`);
      console.log(`     Length: ${edge.length_meters.toFixed(1)}m`);
    });
    
    // Check vertices to see if there are any common nodes
    console.log('\n🔍 Checking ways_noded_vertices_pgr for common nodes...');
    const verticesResult = await pgClient.query(`
      SELECT 
        id,
        cnt,
        ST_AsText(the_geom) as coordinates
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      WHERE cnt >= 3
      ORDER BY cnt DESC
      LIMIT 10
    `);
    
    console.log(`📊 Top intersection nodes (degree >= 3):`);
    verticesResult.rows.forEach((vertex, index) => {
      console.log(`  ${index + 1}. Node ${vertex.id} (degree: ${vertex.cnt})`);
      console.log(`     Coordinates: ${vertex.coordinates}`);
    });
    
    // Test if we can find any paths between Bear Canyon and Fern Canyon areas
    console.log('\n🔍 Testing path finding between Bear Canyon and Fern Canyon areas...');
    
    // First, let's find some nodes in the Bear Canyon and Fern Canyon areas
    // Now we can use the original_trail_uuid to find specific trail segments
    const bearCanyonNodesResult = await pgClient.query(`
      SELECT DISTINCT v.id, v.cnt, ST_AsText(v.the_geom) as coordinates
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      JOIN ${stagingSchema}.ways_noded w ON v.id = w.source OR v.id = w.target
      WHERE w.original_trail_uuid IN (
        SELECT app_uuid FROM ${stagingSchema}.trails 
        WHERE LOWER(name) LIKE '%bear canyon%'
      )
      ORDER BY v.cnt DESC
      LIMIT 5
    `);
    
    const fernCanyonNodesResult = await pgClient.query(`
      SELECT DISTINCT v.id, v.cnt, ST_AsText(v.the_geom) as coordinates
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      JOIN ${stagingSchema}.ways_noded w ON v.id = w.source OR v.id = w.target
      WHERE w.original_trail_uuid IN (
        SELECT app_uuid FROM ${stagingSchema}.trails 
        WHERE LOWER(name) LIKE '%fern canyon%'
      )
      ORDER BY v.cnt DESC
      LIMIT 5
    `);
    
    console.log(`📊 Bear Canyon area nodes: ${bearCanyonNodesResult.rows.length}`);
    bearCanyonNodesResult.rows.forEach((node, index) => {
      console.log(`  ${index + 1}. Node ${node.id} (degree: ${node.cnt}) at ${node.coordinates}`);
    });
    
    console.log(`📊 Fern Canyon area nodes: ${fernCanyonNodesResult.rows.length}`);
    fernCanyonNodesResult.rows.forEach((node, index) => {
      console.log(`  ${index + 1}. Node ${node.id} (degree: ${node.cnt}) at ${node.coordinates}`);
    });
    
    // Try to find a path between the first Bear Canyon node and first Fern Canyon node
    if (bearCanyonNodesResult.rows.length > 0 && fernCanyonNodesResult.rows.length > 0) {
      const bearNode = bearCanyonNodesResult.rows[0].id;
      const fernNode = fernCanyonNodesResult.rows[0].id;
      
      console.log(`\n🔍 Testing path from Bear Canyon node ${bearNode} to Fern Canyon node ${fernNode}...`);
      
      try {
        const pathResult = await pgClient.query(`
          SELECT path_seq, node, edge, cost, agg_cost
          FROM pgr_dijkstra(
            'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded',
            $1::bigint, $2::bigint, false
          )
          ORDER BY path_seq
          LIMIT 20
        `, [bearNode, fernNode]);
        
        if (pathResult.rows.length > 0) {
          console.log(`✅ Path found with ${pathResult.rows.length} segments`);
          pathResult.rows.slice(0, 5).forEach((segment, index) => {
            console.log(`  ${index + 1}. Node ${segment.node} via edge ${segment.edge} (cost: ${segment.cost})`);
          });
        } else {
          console.log('❌ No path found between Bear Canyon and Fern Canyon nodes');
        }
      } catch (error) {
        console.log(`❌ Path finding failed: ${error}`);
      }
    }
    
    console.log('\n✅ Layer 2 network connection test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pgClient.end();
  }
}

testLayer2NetworkConnections().catch(console.error);
