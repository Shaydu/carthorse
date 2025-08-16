#!/usr/bin/env node

const { Client } = require('pg');
require('dotenv').config();

async function checkBearCanyonRouting() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: 'carthorse',
    password: process.env.PGPASSWORD || 'your_password_here',
    database: 'trail_master_db'
  });

  try {
    await client.connect();
    console.log('🔍 Checking Bear Canyon Loop routing connectivity...\n');

    // Check what databases/schemas exist
    const schemasResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%' OR schema_name = 'public'
      ORDER BY schema_name
    `);

    console.log('📊 Available schemas:');
    schemasResult.rows.forEach(row => {
      console.log(`   - ${row.schema_name}`);
    });

    // Try to find routing data in public schema first
    console.log('\n1️⃣ Checking public schema for routing data...');
    
    // Check if routing tables exist
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('routing_nodes', 'routing_edges', 'ways_noded', 'ways_noded_vertices_pgr')
      ORDER BY table_name
    `);

    console.log(`   Found ${tablesResult.rows.length} routing tables in public schema:`);
    tablesResult.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });

    if (tablesResult.rows.length > 0) {
      // Check Bear Canyon trails in public schema
      const bearCanyonTrailsResult = await client.query(`
        SELECT 
          app_uuid,
          name,
          length_km,
          elevation_gain,
          ST_AsText(ST_StartPoint(geometry)) as start_point,
          ST_AsText(ST_EndPoint(geometry)) as end_point
        FROM public.trails 
        WHERE name ILIKE '%bear canyon%'
        ORDER BY name
      `);

      console.log(`\n   Found ${bearCanyonTrailsResult.rows.length} Bear Canyon trails in public schema:`);
      bearCanyonTrailsResult.rows.forEach((trail, i) => {
        console.log(`   ${i + 1}. ${trail.name} (${trail.length_km.toFixed(2)}km, ${trail.elevation_gain}m gain)`);
        console.log(`      Start: ${trail.start_point}`);
        console.log(`      End: ${trail.end_point}`);
      });

              // Check routing nodes near Bear Canyon
        if (bearCanyonTrailsResult.rows.length > 0) {
          console.log('\n2️⃣ Checking routing nodes near Bear Canyon...');
          
          // First, let's see what columns exist in routing_nodes
          const nodeColumnsResult = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'routing_nodes'
            ORDER BY ordinal_position
          `);
          
          console.log('   Routing nodes table structure:');
          nodeColumnsResult.rows.forEach(col => {
            console.log(`   - ${col.column_name} (${col.data_type})`);
          });
          
          const nodesResult = await client.query(`
            SELECT 
              id,
              lat,
              lng
            FROM public.routing_nodes
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
          console.log(`   ${i + 1}. Node ${node.id} at (${node.lat.toFixed(6)}, ${node.lng.toFixed(6)})`);
        });

        // Check routing edges structure first
        console.log('\n3️⃣ Checking routing edges structure...');
        const edgeColumnsResult = await client.query(`
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = 'routing_edges'
          ORDER BY ordinal_position
        `);
        
        console.log('   Routing edges table structure:');
        edgeColumnsResult.rows.forEach(col => {
          console.log(`   - ${col.column_name} (${col.data_type})`);
        });
        
        // Check routing edges involving Bear Canyon
        console.log('\n4️⃣ Checking routing edges involving Bear Canyon...');
        const edgesResult = await client.query(`
          SELECT 
            e.id,
            e.source,
            e.target,
            e.length_km,
            e.elevation_gain
          FROM public.routing_edges e
          ORDER BY e.id
          LIMIT 10
        `);

        console.log(`   Found ${edgesResult.rows.length} routing edges (showing first 10):`);
        edgesResult.rows.forEach((edge, i) => {
          console.log(`   ${i + 1}. Edge ${edge.id}: Source ${edge.source} → Target ${edge.target}`);
          console.log(`      Length: ${edge.length_km.toFixed(2)}km, Elevation: ${edge.elevation_gain}m`);
        });

        // Test pgRouting loop detection
        console.log('\n5️⃣ Testing pgRouting loop detection...');
        try {
          const loopResult = await client.query(`
            SELECT 
              path_id as cycle_id,
              edge as edge_id,
              cost,
              agg_cost,
              path_seq
            FROM pgr_hawickcircuits(
              'SELECT id, source, target, length_km as cost FROM public.routing_edges WHERE length_km > 0'
            )
            ORDER BY path_id, path_seq
            LIMIT 20
          `);

          console.log(`   Found ${loopResult.rows.length} loop edges from pgr_hawickcircuits`);
          if (loopResult.rows.length > 0) {
            console.log('   First few loop edges:');
            loopResult.rows.slice(0, 10).forEach((edge, i) => {
              console.log(`   ${i + 1}. Cycle ${edge.cycle_id}, Edge ${edge.edge_id}, Cost: ${edge.cost.toFixed(2)}`);
            });
          }
        } catch (error) {
          console.log(`   ❌ pgr_hawickcircuits failed: ${error.message}`);
        }

        // Test connectivity with pgr_connectedComponents
        console.log('\n6️⃣ Testing network connectivity...');
        try {
          const connectivityResult = await client.query(`
            SELECT 
              component,
              COUNT(*) as node_count
            FROM pgr_connectedComponents(
              'SELECT id, source, target, length_km * 1000 as cost FROM public.routing_edges WHERE length_km > 0'
            )
            GROUP BY component
            ORDER BY node_count DESC
          `);

          console.log(`   Found ${connectivityResult.rows.length} connected components:`);
          connectivityResult.rows.forEach((comp, i) => {
            console.log(`   ${i + 1}. Component ${comp.component}: ${comp.node_count} nodes`);
          });
        } catch (error) {
          console.log(`   ❌ pgr_connectedComponents failed: ${error.message}`);
        }

        // Check for specific Bear Canyon loop formation
        console.log('\n7️⃣ Checking for Bear Canyon loop formation...');
        const bearCanyonLoopResult = await client.query(`
          WITH RECURSIVE path_search AS (
            -- Start with Bear Canyon edges
            SELECT 
              e.id as edge_id,
              e.source as start_node,
              e.target as current_node,
              ARRAY[e.source, e.target] as path,
              ARRAY[e.id] as edges,
              e.length_km as total_distance,
              COALESCE(e.elevation_gain, 0) as total_elevation
            FROM public.routing_edges e
            WHERE e.source IN (4057, 1737, 163, 2282, 162, 4799, 2676, 1529, 4058, 2281, 4798, 1668, 1726, 4703, 2, 645, 4327, 1, 4704, 646, 4328, 1420, 214, 1530, 1755, 1886, 2620, 1754, 1218, 1512, 2490)
            
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
              AND array_length(ps.path, 1) < 15  -- Limit path length
              AND ps.total_distance < 15  -- Limit total distance
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

        console.log(`   Found ${bearCanyonLoopResult.rows.length} potential Bear Canyon loops:`);
        bearCanyonLoopResult.rows.forEach((loop, i) => {
          console.log(`   ${i + 1}. Loop starting at node ${loop.start_node}:`);
          console.log(`      Path length: ${loop.path_length} nodes`);
          console.log(`      Total distance: ${loop.total_distance.toFixed(2)}km`);
          console.log(`      Total elevation: ${loop.total_elevation.toFixed(0)}m`);
          console.log(`      Path: [${loop.path.join(' → ')}]`);
        });
      }
    }

    console.log('\n✅ Bear Canyon routing analysis complete!');

  } catch (error) {
    console.error('❌ Error during analysis:', error);
  } finally {
    await client.end();
  }
}

checkBearCanyonRouting();
