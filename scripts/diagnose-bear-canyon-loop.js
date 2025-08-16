#!/usr/bin/env node

const { Client } = require('pg');
require('dotenv').config();

async function diagnoseBearCanyonLoop() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/trail_master_db'
  });

  try {
    await client.connect();
    console.log('🔍 Diagnosing Bear Canyon Loop routing connectivity...\n');

    // Find the most recent staging schema
    const schemaResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_boulder_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);

    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schemas found');
      return;
    }

    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📊 Using staging schema: ${stagingSchema}\n`);

    // 1. Check Bear Canyon Trail specifically
    console.log('1️⃣ Checking Bear Canyon Trail data...');
    const bearCanyonResult = await client.query(`
      SELECT 
        app_uuid,
        name,
        length_km,
        elevation_gain,
        elevation_loss,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry::geography) as actual_length_meters
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%bear canyon%'
      ORDER BY name
    `);

    console.log(`   Found ${bearCanyonResult.rows.length} Bear Canyon trails:`);
    bearCanyonResult.rows.forEach((trail, i) => {
      console.log(`   ${i + 1}. ${trail.name} (${trail.length_km.toFixed(2)}km, ${trail.elevation_gain}m gain)`);
      console.log(`      Start: ${trail.start_point}`);
      console.log(`      End: ${trail.end_point}`);
    });

    // 2. Check routing nodes near Bear Canyon
    console.log('\n2️⃣ Checking routing nodes near Bear Canyon...');
    const nodesResult = await client.query(`
      SELECT 
        id,
        node_uuid,
        lat,
        lng,
        node_type,
        connected_trails,
        elevation
      FROM ${stagingSchema}.routing_nodes
      WHERE ST_DWithin(
        ST_SetSRID(ST_MakePoint(lng, lat), 4326),
        ST_SetSRID(ST_MakePoint(-105.2777543, 39.9856735), 4326), -- Bear Canyon Trailhead
        0.01 -- ~1km radius
      )
      ORDER BY ST_Distance(
        ST_SetSRID(ST_MakePoint(lng, lat), 4326),
        ST_SetSRID(ST_MakePoint(-105.2777543, 39.9856735), 4326)
      )
    `);

    console.log(`   Found ${nodesResult.rows.length} routing nodes near Bear Canyon:`);
    nodesResult.rows.forEach((node, i) => {
      console.log(`   ${i + 1}. Node ${node.id} (${node.node_type}) at (${node.lat.toFixed(6)}, ${node.lng.toFixed(6)})`);
      console.log(`      Connected trails: ${node.connected_trails || 'None'}`);
    });

    // 3. Check routing edges involving Bear Canyon
    console.log('\n3️⃣ Checking routing edges involving Bear Canyon...');
    const edgesResult = await client.query(`
      SELECT 
        e.id,
        e.source,
        e.target,
        e.trail_name,
        e.distance_km,
        e.elevation_gain,
        e.elevation_loss,
        ST_AsText(ST_StartPoint(e.geometry)) as edge_start,
        ST_AsText(ST_EndPoint(e.geometry)) as edge_end
      FROM ${stagingSchema}.routing_edges e
      WHERE e.trail_name ILIKE '%bear canyon%'
      ORDER BY e.trail_name
    `);

    console.log(`   Found ${edgesResult.rows.length} routing edges for Bear Canyon:`);
    edgesResult.rows.forEach((edge, i) => {
      console.log(`   ${i + 1}. Edge ${edge.id}: ${edge.trail_name}`);
      console.log(`      Source: ${edge.source} → Target: ${edge.target}`);
      console.log(`      Distance: ${edge.distance_km.toFixed(2)}km, Elevation: ${edge.elevation_gain}m`);
    });

    // 4. Check for connectivity issues
    console.log('\n4️⃣ Checking for connectivity issues...');
    
    // Check for orphaned nodes (nodes with no edges)
    const orphanedNodesResult = await client.query(`
      SELECT COUNT(*) as count
      FROM ${stagingSchema}.routing_nodes n
      WHERE NOT EXISTS (
        SELECT 1 FROM ${stagingSchema}.routing_edges e 
        WHERE e.source = n.id OR e.target = n.id
      )
    `);
    
    console.log(`   Orphaned nodes (no edges): ${orphanedNodesResult.rows[0].count}`);

    // Check for disconnected components
    const componentsResult = await client.query(`
      SELECT COUNT(DISTINCT component) as component_count
      FROM pgr_connectedComponents(
        'SELECT id, source, target, distance_km * 1000 as cost FROM ${stagingSchema}.routing_edges'
      )
    `);
    
    console.log(`   Disconnected components: ${componentsResult.rows[0].component_count}`);

    // 5. Check for potential loop formation
    console.log('\n5️⃣ Checking for potential loop formation...');
    const loopCheckResult = await client.query(`
      WITH RECURSIVE path_search AS (
        -- Start with Bear Canyon edges
        SELECT 
          e.id as edge_id,
          e.source as start_node,
          e.target as current_node,
          ARRAY[e.source, e.target] as path,
          ARRAY[e.id] as edges,
          e.distance_km as total_distance,
          e.elevation_gain as total_elevation
        FROM ${stagingSchema}.routing_edges e
        WHERE e.trail_name ILIKE '%bear canyon%'
        
        UNION ALL
        
        -- Recursively explore connected edges
        SELECT 
          ps.edge_id,
          ps.start_node,
          e.target as current_node,
          ps.path || e.target,
          ps.edges || e.id,
          ps.total_distance + e.distance_km,
          ps.total_elevation + COALESCE(e.elevation_gain, 0)
        FROM path_search ps
        JOIN ${stagingSchema}.routing_edges e ON ps.current_node = e.source
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
        path,
        edges
      FROM path_search
      WHERE current_node = start_node  -- Found a loop!
        AND array_length(path, 1) > 3  -- Must have at least 3 nodes
      ORDER BY total_distance
      LIMIT 10
    `);

    console.log(`   Found ${loopCheckResult.rows.length} potential loops involving Bear Canyon:`);
    loopCheckResult.rows.forEach((loop, i) => {
      console.log(`   ${i + 1}. Loop starting at node ${loop.start_node}:`);
      console.log(`      Path length: ${loop.path_length} nodes`);
      console.log(`      Total distance: ${loop.total_distance.toFixed(2)}km`);
      console.log(`      Total elevation: ${loop.total_elevation.toFixed(0)}m`);
      console.log(`      Path: [${loop.path.join(' → ')}]`);
    });

    // 6. Check for missing connections
    console.log('\n6️⃣ Checking for missing connections...');
    const missingConnectionsResult = await client.query(`
      WITH bear_canyon_nodes AS (
        SELECT DISTINCT n.id, n.lat, n.lng
        FROM ${stagingSchema}.routing_nodes n
        JOIN ${stagingSchema}.routing_edges e ON n.id = e.source OR n.id = e.target
        WHERE e.trail_name ILIKE '%bear canyon%'
      ),
      nearby_nodes AS (
        SELECT 
          bcn.id as bear_node_id,
          n.id as nearby_node_id,
          ST_Distance(
            ST_SetSRID(ST_MakePoint(bcn.lng, bcn.lat), 4326),
            ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)
          ) as distance_meters
        FROM bear_canyon_nodes bcn
        CROSS JOIN ${stagingSchema}.routing_nodes n
        WHERE n.id != bcn.id
          AND ST_DWithin(
            ST_SetSRID(ST_MakePoint(bcn.lng, bcn.lat), 4326),
            ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326),
            0.001  -- ~100m
          )
      )
      SELECT 
        bn.id as bear_node_id,
        nn.id as nearby_node_id,
        nn.distance_meters,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM ${stagingSchema}.routing_edges e 
            WHERE (e.source = bn.id AND e.target = nn.id) 
               OR (e.source = nn.id AND e.target = bn.id)
          ) THEN 'Connected'
          ELSE 'Missing connection'
        END as connection_status
      FROM bear_canyon_nodes bn
      JOIN nearby_nodes nn ON bn.id = nn.bear_node_id
      ORDER BY nn.distance_meters
      LIMIT 20
    `);

    console.log(`   Found ${missingConnectionsResult.rows.length} nearby node pairs:`);
    missingConnectionsResult.rows.forEach((connection, i) => {
      console.log(`   ${i + 1}. Bear Canyon node ${connection.bear_node_id} ↔ Node ${connection.nearby_node_id}`);
      console.log(`      Distance: ${connection.distance_meters.toFixed(1)}m`);
      console.log(`      Status: ${connection.connection_status}`);
    });

    console.log('\n✅ Bear Canyon Loop diagnosis complete!');

  } catch (error) {
    console.error('❌ Error during diagnosis:', error);
  } finally {
    await client.end();
  }
}

diagnoseBearCanyonLoop();
