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

async function regenerateHogbackRouting() {
  const client = new Pool(config);
  
  try {
    await client.connect();
    console.log('🔄 Regenerating Hogback routing...');

    // Step 1: Clear existing routing data for Hogback
    console.log('\n🧹 Clearing existing Hogback routing data...');
    await client.query(`
      DELETE FROM ${config.stagingSchema}.routing_edges 
      WHERE trail_name LIKE '%Hogback%'
    `);
    
    await client.query(`
      DELETE FROM ${config.stagingSchema}.routing_nodes 
      WHERE connected_trails LIKE '%Hogback%'
    `);

    console.log('✅ Cleared existing Hogback routing data');

    // Step 2: Regenerate routing nodes for Hogback segments
    console.log('\n📍 Regenerating routing nodes for Hogback...');
    const nodeResult = await client.query(`
      SELECT generate_routing_nodes_native($1, $2)
    `, [config.stagingSchema, 5.0]); // 5 meter tolerance

    console.log('✅ Routing nodes regenerated');

    // Step 3: Regenerate routing edges for Hogback segments
    console.log('\n🛤️ Regenerating routing edges for Hogback...');
    const edgeResult = await client.query(`
      SELECT generate_routing_edges_native($1, $2)
    `, [config.stagingSchema, 5.0]); // 5 meter tolerance

    console.log('✅ Routing edges regenerated');

    // Step 4: Verify Hogback routing data
    console.log('\n🔍 Verifying Hogback routing data...');
    
    const hogbackNodes = await client.query(`
      SELECT COUNT(*) as node_count FROM ${config.stagingSchema}.routing_nodes 
      WHERE connected_trails LIKE '%Hogback%'
    `);
    
    const hogbackEdges = await client.query(`
      SELECT COUNT(*) as edge_count FROM ${config.stagingSchema}.routing_edges 
      WHERE trail_name LIKE '%Hogback%'
    `);

    console.log(`📍 Hogback nodes: ${hogbackNodes.rows[0].node_count}`);
    console.log(`🛤️ Hogback edges: ${hogbackEdges.rows[0].edge_count}`);

    // Step 5: Test route generation
    console.log('\n🛤️ Testing route generation...');
    const testRoute = await client.query(`
      WITH hogback_nodes AS (
        SELECT id FROM ${config.stagingSchema}.routing_nodes 
        WHERE connected_trails LIKE '%Hogback%'
        LIMIT 2
      ),
      route_test AS (
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
        LIMIT 1
      )
      SELECT 
        start_node,
        end_node,
        COUNT(*) as edge_count,
        SUM(cost) as total_cost
      FROM route_test,
      LATERAL unnest(route_result) as route
      GROUP BY start_node, end_node
    `);

    if (testRoute.rows.length > 0) {
      const route = testRoute.rows[0];
      console.log(`✅ Route test successful:`);
      console.log(`  - Node ${route.start_node} → Node ${route.end_node}`);
      console.log(`  - ${route.edge_count} edges, ${route.total_cost.toFixed(2)}km`);
    } else {
      console.log('❌ Route test failed - no routes found');
    }

    // Step 6: Generate a sample loop route
    console.log('\n🔄 Generating sample loop route...');
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
      console.log(`✅ Loop route generated:`);
      console.log(`  - ${route.edge_count} edges`);
      console.log(`  - ${route.total_distance_km.toFixed(2)}km total distance`);
      console.log(`  - Edge sequence: [${route.edge_sequence.join(', ')}]`);
    } else {
      console.log('❌ No loop routes found');
    }

    console.log('\n✅ Hogback routing regeneration complete!');

  } catch (error) {
    console.error('❌ Error regenerating Hogback routing:', error);
  } finally {
    await client.end();
  }
}

// Run the regeneration
regenerateHogbackRouting().catch(console.error);
