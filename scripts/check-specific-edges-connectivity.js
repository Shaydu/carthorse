#!/usr/bin/env node

const { Client } = require('pg');
require('dotenv').config();

async function checkSpecificEdgesConnectivity() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: 'carthorse',
    password: process.env.PGPASSWORD || 'your_password_here',
    database: 'trail_master_db'
  });

  try {
    await client.connect();
    console.log('🔍 Checking connectivity of specific routing edges...\n');

    const targetEdges = [
      { id: 32, source: 12, target: 20, trail_name: 'Mesa Trail', trail_id: '39779637-6983-4b29-a350-6548b2185fe0' },
      { id: 28, source: 9, target: 12, trail_name: 'Bear Peak Trail', trail_id: '3d7678db-d767-4012-866b-d5bfa0972227' },
      { id: 46, source: 10, target: 80, trail_name: 'Fern Canyon Trail', trail_id: '541e5435-148d-4fb4-8145-b39e9b64ff67' }
    ];

    console.log('1️⃣ Checking if these edges exist in routing_edges table...');
    for (const edge of targetEdges) {
      const edgeResult = await client.query(`
        SELECT 
          id,
          source,
          target,
          name,
          length_km,
          elevation_gain,
          elevation_loss,
          app_uuid
        FROM public.routing_edges 
        WHERE id = $1
      `, [edge.id]);

      if (edgeResult.rows.length > 0) {
        const e = edgeResult.rows[0];
        console.log(`   ✅ Edge ${e.id}: ${e.name}`);
        console.log(`      Source: ${e.source} → Target: ${e.target}`);
        console.log(`      Length: ${e.length_km.toFixed(2)}km, Elevation: ${e.elevation_gain}m gain, ${e.elevation_loss}m loss`);
        console.log(`      UUID: ${e.app_uuid}`);
      } else {
        console.log(`   ❌ Edge ${edge.id} (${edge.trail_name}) - NOT FOUND`);
      }
    }

    console.log('\n2️⃣ Checking routing nodes for these edges...');
    const nodeIds = targetEdges.flatMap(edge => [edge.source, edge.target]);
    const uniqueNodeIds = [...new Set(nodeIds)];
    
    const nodesResult = await client.query(`
      SELECT 
        id,
        lat,
        lng,
        elevation
      FROM public.routing_nodes
      WHERE id = ANY($1)
      ORDER BY id
    `, [uniqueNodeIds]);

    console.log(`   Found ${nodesResult.rows.length} routing nodes for target edges:`);
    nodesResult.rows.forEach((node, i) => {
      console.log(`   ${i + 1}. Node ${node.id} at (${node.lat.toFixed(6)}, ${node.lng.toFixed(6)})`);
      console.log(`      Elevation: ${node.elevation}m`);
    });

    console.log('\n3️⃣ Testing connectivity between these edges...');
    
    // Check if all edges are in the same connected component
    const connectivityResult = await client.query(`
      WITH edge_nodes AS (
        SELECT DISTINCT source as node_id FROM public.routing_edges 
        WHERE id IN (32, 28, 46)
        UNION
        SELECT DISTINCT target as node_id FROM public.routing_edges 
        WHERE id IN (32, 28, 46)
      ),
      components AS (
        SELECT 
          en.node_id,
          cc.component
        FROM edge_nodes en
        JOIN pgr_connectedComponents(
          'SELECT id, source, target, length_km * 1000 as cost FROM public.routing_edges WHERE length_km > 0'
        ) cc ON en.node_id = cc.node
      )
      SELECT 
        component,
        COUNT(*) as node_count,
        ARRAY_AGG(node_id ORDER BY node_id) as node_ids
      FROM components
      GROUP BY component
      ORDER BY node_count DESC
    `);

    console.log(`   Found ${connectivityResult.rows.length} connected components for target edges:`);
    connectivityResult.rows.forEach((comp, i) => {
      console.log(`   ${i + 1}. Component ${comp.component}: ${comp.node_count} nodes`);
      console.log(`      Node IDs: [${comp.node_ids.join(', ')}]`);
    });

    // Check if all edges are in the same component
    if (connectivityResult.rows.length === 1) {
      console.log('   ✅ All target edges are in the same connected component - THEY ARE CONNECTED!');
    } else {
      console.log('   ❌ Target edges are in different connected components - THEY ARE NOT CONNECTED');
    }

    console.log('\n4️⃣ Testing path finding between edge nodes...');
    if (uniqueNodeIds.length >= 2) {
      // Test path finding between first and last node
      const startNode = uniqueNodeIds[0];
      const endNode = uniqueNodeIds[uniqueNodeIds.length - 1];
      
      try {
        const pathResult = await client.query(`
          SELECT 
            seq,
            node,
            edge,
            cost,
            agg_cost
          FROM pgr_dijkstra(
            'SELECT id, source, target, length_km * 1000 as cost FROM public.routing_edges WHERE length_km > 0',
            $1, $2, false
          )
          ORDER BY seq
        `, [startNode, endNode]);

        if (pathResult.rows.length > 0) {
          console.log(`   ✅ Path found from node ${startNode} to node ${endNode}:`);
          console.log(`      Total cost: ${pathResult.rows[pathResult.rows.length - 1].agg_cost.toFixed(0)}m`);
          console.log(`      Path length: ${pathResult.rows.length} steps`);
          console.log(`      Path: [${pathResult.rows.map(r => r.node).join(' → ')}]`);
        } else {
          console.log(`   ❌ No path found from node ${startNode} to node ${endNode}`);
        }
      } catch (error) {
        console.log(`   ❌ Path finding failed: ${error.message}`);
      }
    }

    console.log('\n5️⃣ Testing loop formation with these edges...');
    try {
      const loopResult = await client.query(`
        WITH RECURSIVE path_search AS (
          -- Start with target edges
          SELECT 
            e.id as edge_id,
            e.source as start_node,
            e.target as current_node,
            ARRAY[e.source, e.target] as path,
            ARRAY[e.id] as edges,
            e.length_km as total_distance,
            COALESCE(e.elevation_gain, 0) as total_elevation
          FROM public.routing_edges e
          WHERE e.id IN (32, 28, 46)
          
          UNION ALL
          
          -- Recursively explore connected edges
          SELECT 
            ps.edge_id,
            ps.start_node,
            e.target as current_node,
            ps.path || e.target,
            ps.edges || e.id,
            ps.total_distance + e.length_km,
            ps.total_elevation + COALESCE(e.elevation_gain, 0)
          FROM path_search ps
          JOIN public.routing_edges e ON ps.current_node = e.source
          WHERE e.target != ALL(ps.path)  -- Avoid cycles
            AND array_length(ps.path, 1) < 20  -- Limit path length
            AND ps.total_distance < 20  -- Limit total distance
        )
        SELECT 
          start_node,
          current_node,
          array_length(path, 1) as path_length,
          total_distance,
          total_elevation,
          path
        FROM path_search
        WHERE current_node = start_node  -- Found a loop!
          AND array_length(path, 1) > 3  -- Must have at least 3 nodes
        ORDER BY total_distance
        LIMIT 5
      `);

      console.log(`   Found ${loopResult.rows.length} potential loops involving target edges:`);
      loopResult.rows.forEach((loop, i) => {
        console.log(`   ${i + 1}. Loop starting at node ${loop.start_node}:`);
        console.log(`      Path length: ${loop.path_length} nodes`);
        console.log(`      Total distance: ${loop.total_distance.toFixed(2)}km`);
        console.log(`      Total elevation: ${loop.total_elevation.toFixed(0)}m`);
        console.log(`      Path: [${loop.path.join(' → ')}]`);
      });
    } catch (error) {
      console.log(`   ❌ Loop detection failed: ${error.message}`);
    }

    console.log('\n6️⃣ Checking for Bear Canyon Trail connectivity...');
    const bearCanyonResult = await client.query(`
      SELECT 
        id,
        source,
        target,
        name,
        length_km,
        elevation_gain
      FROM public.routing_edges
      WHERE name ILIKE '%bear canyon%'
      ORDER BY name
    `);

    console.log(`   Found ${bearCanyonResult.rows.length} Bear Canyon edges:`);
    bearCanyonResult.rows.forEach((edge, i) => {
      console.log(`   ${i + 1}. Edge ${edge.id}: ${edge.name}`);
      console.log(`      Source: ${edge.source} → Target: ${edge.target}`);
      console.log(`      Length: ${edge.length_km.toFixed(2)}km, Elevation: ${edge.elevation_gain}m`);
    });

    // Check if Bear Canyon connects to our target edges
    if (bearCanyonResult.rows.length > 0) {
      const bearCanyonNodeIds = bearCanyonResult.rows.flatMap(edge => [edge.source, edge.target]);
      const allNodeIds = [...new Set([...uniqueNodeIds, ...bearCanyonNodeIds])];
      
      const combinedConnectivityResult = await client.query(`
        WITH all_nodes AS (
          SELECT UNNEST($1::int[]) as node_id
        ),
        components AS (
          SELECT 
            an.node_id,
            cc.component
          FROM all_nodes an
          JOIN pgr_connectedComponents(
            'SELECT id, source, target, length_km * 1000 as cost FROM public.routing_edges WHERE length_km > 0'
          ) cc ON an.node_id = cc.node
        )
        SELECT 
          component,
          COUNT(*) as node_count,
          ARRAY_AGG(node_id ORDER BY node_id) as node_ids
        FROM components
        GROUP BY component
        ORDER BY node_count DESC
      `, [allNodeIds]);

      console.log(`   Combined connectivity: ${combinedConnectivityResult.rows.length} components`);
      if (combinedConnectivityResult.rows.length === 1) {
        console.log('   ✅ Bear Canyon + target edges are all connected!');
      } else {
        console.log('   ❌ Bear Canyon + target edges are in separate components');
      }
    }

    console.log('\n✅ Specific edges connectivity analysis complete!');

  } catch (error) {
    console.error('❌ Error during analysis:', error);
  } finally {
    await client.end();
  }
}

checkSpecificEdgesConnectivity();
