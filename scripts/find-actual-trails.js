#!/usr/bin/env node

const { Client } = require('pg');
require('dotenv').config();

async function findActualTrails() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: 'carthorse',
    password: process.env.PGPASSWORD || 'your_password_here',
    database: 'trail_master_db'
  });

  try {
    await client.connect();
    console.log('🔍 Finding actual trails in database...\n');

    const trailNames = [
      'Fern Canyon Trail',
      'Bear Peak West Ridge Trail', 
      'Bear Canyon Trail',
      'Mesa Trail'
    ];

    console.log('1️⃣ Searching for trails by name...');
    for (const trailName of trailNames) {
      const trailResult = await client.query(`
        SELECT 
          app_uuid,
          name,
          length_km,
          elevation_gain,
          ST_AsText(ST_StartPoint(geometry)) as start_point,
          ST_AsText(ST_EndPoint(geometry)) as end_point
        FROM public.trails 
        WHERE name ILIKE $1
        ORDER BY name
      `, [`%${trailName}%`]);

      console.log(`\n   Searching for: "${trailName}"`);
      if (trailResult.rows.length > 0) {
        trailResult.rows.forEach((trail, i) => {
          console.log(`   ${i + 1}. ${trail.name}`);
          console.log(`      UUID: ${trail.app_uuid}`);
          console.log(`      Length: ${trail.length_km.toFixed(2)}km, Elevation: ${trail.elevation_gain}m`);
          console.log(`      Start: ${trail.start_point}`);
          console.log(`      End: ${trail.end_point}`);
        });
      } else {
        console.log(`   ❌ No trails found matching "${trailName}"`);
      }
    }

    console.log('\n2️⃣ Checking routing edges for similar trail names...');
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
      WHERE e.name ILIKE '%fern canyon%' 
         OR e.name ILIKE '%bear peak%'
         OR e.name ILIKE '%bear canyon%'
         OR e.name ILIKE '%mesa trail%'
      ORDER BY e.name
    `);

    console.log(`   Found ${edgesResult.rows.length} routing edges for similar trails:`);
    edgesResult.rows.forEach((edge, i) => {
      console.log(`   ${i + 1}. Edge ${edge.id}: ${edge.name}`);
      console.log(`      Source: ${edge.source} → Target: ${edge.target}`);
      console.log(`      Length: ${edge.length_km.toFixed(2)}km, Elevation: ${edge.elevation_gain}m`);
      console.log(`      UUID: ${edge.app_uuid}`);
    });

    console.log('\n3️⃣ Checking if these edges are connected...');
    if (edgesResult.rows.length > 0) {
      const nodeIds = edgesResult.rows.flatMap(edge => [edge.source, edge.target]);
      const uniqueNodeIds = [...new Set(nodeIds)];
      
      const connectivityResult = await client.query(`
        WITH trail_nodes AS (
          SELECT UNNEST($1::integer[]) as node_id
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
      `, [uniqueNodeIds]);

      console.log(`   Found ${connectivityResult.rows.length} connected components for these trails:`);
      connectivityResult.rows.forEach((comp, i) => {
        console.log(`   ${i + 1}. Component ${comp.component}: ${comp.node_count} nodes`);
        console.log(`      Node IDs: [${comp.node_ids.join(', ')}]`);
      });

      if (connectivityResult.rows.length === 1) {
        console.log('   ✅ All these trails are in the same connected component - THEY ARE CONNECTED!');
      } else {
        console.log('   ❌ These trails are in different connected components - THEY ARE NOT CONNECTED');
      }
    }

    console.log('\n4️⃣ Testing loop formation with found trails...');
    if (edgesResult.rows.length > 0) {
      const trailUuids = edgesResult.rows.map(edge => edge.app_uuid);
      
      try {
        const loopResult = await client.query(`
          WITH RECURSIVE path_search AS (
            -- Start with edges from found trails
            SELECT 
              e.id as edge_id,
              e.source as start_node,
              e.target as current_node,
              ARRAY[e.source, e.target] as path,
              ARRAY[e.id] as edges,
              e.length_km as total_distance,
              COALESCE(e.elevation_gain, 0) as total_elevation
            FROM public.routing_edges e
            WHERE e.app_uuid = ANY($1)
            
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
        `, [trailUuids]);

        console.log(`   Found ${loopResult.rows.length} potential loops involving these trails:`);
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
    }

    console.log('\n✅ Trail search complete!');

  } catch (error) {
    console.error('❌ Error during analysis:', error);
  } finally {
    await client.end();
  }
}

findActualTrails();
