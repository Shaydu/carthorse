#!/usr/bin/env node

const { Client } = require('pg');
require('dotenv').config();

async function findActualEdges() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: 'carthorse',
    password: process.env.PGPASSWORD || 'your_password_here',
    database: 'trail_master_db'
  });

  try {
    await client.connect();
    console.log('🔍 Finding actual edges in routing_edges table...\n');

    console.log('1️⃣ Checking total edge count...');
    const totalEdgesResult = await client.query(`
      SELECT COUNT(*) as total_edges
      FROM public.routing_edges
    `);
    console.log(`   Total edges in routing_edges: ${totalEdgesResult.rows[0].total_edges}`);

    console.log('\n2️⃣ Finding edges with similar trail names...');
    const similarTrailsResult = await client.query(`
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
      WHERE name ILIKE '%mesa%' 
         OR name ILIKE '%bear%' 
         OR name ILIKE '%fern%' 
         OR name ILIKE '%canyon%'
      ORDER BY name
    `);

    console.log(`   Found ${similarTrailsResult.rows.length} edges with similar names:`);
    similarTrailsResult.rows.forEach((edge, i) => {
      console.log(`   ${i + 1}. Edge ${edge.id}: ${edge.name}`);
      console.log(`      Source: ${edge.source} → Target: ${edge.target}`);
      console.log(`      Length: ${edge.length_km.toFixed(2)}km, Elevation: ${edge.elevation_gain}m gain, ${edge.elevation_loss}m loss`);
      console.log(`      UUID: ${edge.app_uuid}`);
    });

    console.log('\n3️⃣ Checking first 20 edges to see the structure...');
    const firstEdgesResult = await client.query(`
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
      ORDER BY id
      LIMIT 20
    `);

    console.log(`   First 20 edges:`);
    firstEdgesResult.rows.forEach((edge, i) => {
      console.log(`   ${i + 1}. Edge ${edge.id}: ${edge.name || 'unnamed'}`);
      console.log(`      Source: ${edge.source} → Target: ${edge.target}`);
      console.log(`      Length: ${edge.length_km.toFixed(2)}km, Elevation: ${edge.elevation_gain}m gain, ${edge.elevation_loss}m loss`);
      console.log(`      UUID: ${edge.app_uuid}`);
    });

    console.log('\n4️⃣ Checking if the specific nodes exist...');
    const specificNodes = [9, 10, 12, 20, 80];
    const nodesResult = await client.query(`
      SELECT 
        id,
        lat,
        lng,
        elevation
      FROM public.routing_nodes
      WHERE id = ANY($1)
      ORDER BY id
    `, [specificNodes]);

    console.log(`   Found ${nodesResult.rows.length} of ${specificNodes.length} specific nodes:`);
    nodesResult.rows.forEach((node, i) => {
      console.log(`   ${i + 1}. Node ${node.id} at (${node.lat.toFixed(6)}, ${node.lng.toFixed(6)})`);
      console.log(`      Elevation: ${node.elevation}m`);
    });

    console.log('\n5️⃣ Checking edges connected to these nodes...');
    const connectedEdgesResult = await client.query(`
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
      WHERE source = ANY($1) OR target = ANY($1)
      ORDER BY name
    `, [specificNodes]);

    console.log(`   Found ${connectedEdgesResult.rows.length} edges connected to these nodes:`);
    connectedEdgesResult.rows.forEach((edge, i) => {
      console.log(`   ${i + 1}. Edge ${edge.id}: ${edge.name || 'unnamed'}`);
      console.log(`      Source: ${edge.source} → Target: ${edge.target}`);
      console.log(`      Length: ${edge.length_km.toFixed(2)}km, Elevation: ${edge.elevation_gain}m gain, ${edge.elevation_loss}m loss`);
      console.log(`      UUID: ${edge.app_uuid}`);
    });

    console.log('\n6️⃣ Testing connectivity of these connected edges...');
    if (connectedEdgesResult.rows.length > 0) {
      const edgeIds = connectedEdgesResult.rows.map(e => e.id);
      const nodeIds = connectedEdgesResult.rows.flatMap(e => [e.source, e.target]);
      const uniqueNodeIds = [...new Set(nodeIds)];
      
      const connectivityResult = await client.query(`
        WITH edge_nodes AS (
          SELECT DISTINCT source as node_id FROM public.routing_edges 
          WHERE id = ANY($1)
          UNION
          SELECT DISTINCT target as node_id FROM public.routing_edges 
          WHERE id = ANY($1)
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
      `, [edgeIds]);

      console.log(`   Found ${connectivityResult.rows.length} connected components for these edges:`);
      connectivityResult.rows.forEach((comp, i) => {
        console.log(`   ${i + 1}. Component ${comp.component}: ${comp.node_count} nodes`);
        console.log(`      Node IDs: [${comp.node_ids.join(', ')}]`);
      });

      if (connectivityResult.rows.length === 1) {
        console.log('   ✅ All connected edges are in the same component - THEY ARE CONNECTED!');
      } else {
        console.log('   ❌ Connected edges are in different components - THEY ARE NOT CONNECTED');
      }
    }

    console.log('\n✅ Actual edges analysis complete!');

  } catch (error) {
    console.error('❌ Error during analysis:', error);
  } finally {
    await client.end();
  }
}

findActualEdges();
