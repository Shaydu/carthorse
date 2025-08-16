#!/usr/bin/env node

const { Client } = require('pg');
require('dotenv').config();

async function checkSpecificTrailsConnectivity() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: 'carthorse',
    password: process.env.PGPASSWORD || 'your_password_here',
    database: 'trail_master_db'
  });

  try {
    await client.connect();
    console.log('🔍 Checking connectivity of specific trails...\n');

    const targetTrails = [
      { id: '5dc4d501-e15c-44f6-812c-d990a0c556d2', name: 'Fern Canyon Trail' },
      { id: 'b5a596ef-4c71-421b-a359-0f74183c67dc', name: 'Bear Peak West Ridge Trail' },
      { id: '4a0437ba-e7c2-49f1-9f96-48115072612c', name: 'Bear Canyon Trail' },
      { id: 'd891b03b-cddb-470c-b26b-2aa72338401a', name: 'Mesa Trail' },
      { id: '541e5435-148d-4fb4-8145-b39e9b64ff67', name: 'Fern Canyon Trail' }
    ];

    console.log('1️⃣ Checking if trails exist in database...');
    for (const trail of targetTrails) {
      const trailResult = await client.query(`
        SELECT 
          app_uuid,
          name,
          length_km,
          elevation_gain,
          ST_AsText(ST_StartPoint(geometry)) as start_point,
          ST_AsText(ST_EndPoint(geometry)) as end_point
        FROM public.trails 
        WHERE app_uuid = $1
      `, [trail.id]);

      if (trailResult.rows.length > 0) {
        const t = trailResult.rows[0];
        console.log(`   ✅ ${t.name} (${t.length_km.toFixed(2)}km, ${t.elevation_gain}m gain)`);
        console.log(`      Start: ${t.start_point}`);
        console.log(`      End: ${t.end_point}`);
      } else {
        console.log(`   ❌ ${trail.name} (${trail.id}) - NOT FOUND`);
      }
    }

    console.log('\n2️⃣ Checking routing edges for these trails...');
    const edgesResult = await client.query(`
      SELECT 
        e.id,
        e.source,
        e.target,
        e.name,
        e.length_km,
        e.elevation_gain,
        e.app_uuid
      FROM public.routing_edges e
      WHERE e.app_uuid IN ($1, $2, $3, $4, $5)
      ORDER BY e.name
    `, targetTrails.map(t => t.id));

    console.log(`   Found ${edgesResult.rows.length} routing edges for target trails:`);
    edgesResult.rows.forEach((edge, i) => {
      console.log(`   ${i + 1}. Edge ${edge.id}: ${edge.name}`);
      console.log(`      Source: ${edge.source} → Target: ${edge.target}`);
      console.log(`      Length: ${edge.length_km.toFixed(2)}km, Elevation: ${edge.elevation_gain}m`);
      console.log(`      UUID: ${edge.app_uuid}`);
    });

    console.log('\n3️⃣ Checking routing nodes for these trails...');
    const nodeIds = edgesResult.rows.flatMap(edge => [edge.source, edge.target]);
    const uniqueNodeIds = [...new Set(nodeIds)];
    
    if (uniqueNodeIds.length > 0) {
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

      console.log(`   Found ${nodesResult.rows.length} routing nodes for target trails:`);
      nodesResult.rows.forEach((node, i) => {
        console.log(`   ${i + 1}. Node ${node.id} at (${node.lat.toFixed(6)}, ${node.lng.toFixed(6)})`);
        console.log(`      Elevation: ${node.elevation}m`);
      });
    }

    console.log('\n4️⃣ Testing connectivity between these trails...');
    
    // Check if all trails are in the same connected component
    const connectivityResult = await client.query(`
      WITH trail_nodes AS (
        SELECT DISTINCT source as node_id FROM public.routing_edges 
        WHERE app_uuid IN ($1, $2, $3, $4, $5)
        UNION
        SELECT DISTINCT target as node_id FROM public.routing_edges 
        WHERE app_uuid IN ($1, $2, $3, $4, $5)
      ),
      components AS (
        SELECT 
          tn.node_id,
          cc.component
        FROM trail_nodes tn
        JOIN pgr_connectedComponents(
          'SELECT id, source, target, length_km * 1000 as cost FROM public.routing_edges WHERE length_km > 0'
        ) cc ON tn.node_id = cc.node
      )
      SELECT 
        component,
        COUNT(*) as node_count,
        ARRAY_AGG(node_id ORDER BY node_id) as node_ids
      FROM components
      GROUP BY component
      ORDER BY node_count DESC
    `, targetTrails.map(t => t.id));

    console.log(`   Found ${connectivityResult.rows.length} connected components for target trails:`);
    connectivityResult.rows.forEach((comp, i) => {
      console.log(`   ${i + 1}. Component ${comp.component}: ${comp.node_count} nodes`);
      console.log(`      Node IDs: [${comp.node_ids.join(', ')}]`);
    });

    // Check if all trails are in the same component
    if (connectivityResult.rows.length === 1) {
      console.log('   ✅ All target trails are in the same connected component - THEY ARE CONNECTED!');
    } else {
      console.log('   ❌ Target trails are in different connected components - THEY ARE NOT CONNECTED');
    }

    console.log('\n5️⃣ Testing path finding between trail nodes...');
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

    console.log('\n6️⃣ Testing loop formation with these trails...');
    try {
      const loopResult = await client.query(`
        WITH RECURSIVE path_search AS (
          -- Start with edges from target trails
          SELECT 
            e.id as edge_id,
            e.source as start_node,
            e.target as current_node,
            ARRAY[e.source, e.target] as path,
            ARRAY[e.id] as edges,
            e.length_km as total_distance,
            COALESCE(e.elevation_gain, 0) as total_elevation
          FROM public.routing_edges e
          WHERE e.app_uuid IN ($1, $2, $3, $4, $5)
          
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
      `, targetTrails.map(t => t.id));

      console.log(`   Found ${loopResult.rows.length} potential loops involving target trails:`);
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

    console.log('\n✅ Specific trails connectivity analysis complete!');

  } catch (error) {
    console.error('❌ Error during analysis:', error);
  } finally {
    await client.end();
  }
}

checkSpecificTrailsConnectivity();
