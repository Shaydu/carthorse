#!/usr/bin/env ts-node

import { Pool } from 'pg';

async function debugWaysNodedConnection() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🔍 Debugging ways_noded table for Bear Canyon and Fern Canyon connection...');
    
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
    
    // Check what's in the ways_noded table for Bear Canyon and Fern Canyon
    console.log('\n🎯 Checking ways_noded table for Bear Canyon and Fern Canyon...');
    
    const bearCanyonWays = await pgClient.query(`
      SELECT id, source, target, name, length_km, the_geom
      FROM ${stagingSchema}.ways_noded
      WHERE name ILIKE '%bear canyon%'
      ORDER BY name, id
    `);
    
    const fernCanyonWays = await pgClient.query(`
      SELECT id, source, target, name, length_km, the_geom
      FROM ${stagingSchema}.ways_noded
      WHERE name ILIKE '%fern canyon%'
      ORDER BY name, id
    `);
    
    console.log(`\n🐻 Bear Canyon ways_noded entries (${bearCanyonWays.rows.length}):`);
    bearCanyonWays.rows.forEach(way => {
      console.log(`  ${way.id}: ${way.name} (${way.source} → ${way.target}, ${way.length_km.toFixed(2)}km)`);
    });
    
    console.log(`\n🌿 Fern Canyon ways_noded entries (${fernCanyonWays.rows.length}):`);
    fernCanyonWays.rows.forEach(way => {
      console.log(`  ${way.id}: ${way.name} (${way.source} → ${way.target}, ${way.length_km.toFixed(2)}km)`);
    });
    
    // Check the vertices table
    console.log('\n🔗 Checking ways_noded_vertices_pgr table...');
    
    const bearCanyonNodes = bearCanyonWays.rows.map(w => [w.source, w.target]).flat();
    const fernCanyonNodes = fernCanyonWays.rows.map(w => [w.source, w.target]).flat();
    
    console.log(`Bear Canyon nodes: ${bearCanyonNodes.join(', ')}`);
    console.log(`Fern Canyon nodes: ${fernCanyonNodes.join(', ')}`);
    
    // Find common nodes
    const commonNodes = bearCanyonNodes.filter(node => fernCanyonNodes.includes(node));
    console.log(`\n🔗 Common nodes between Bear Canyon and Fern Canyon: ${commonNodes.join(', ')}`);
    
    // Check if there are any edges connecting these trails
    const connectingEdges = await pgClient.query(`
      SELECT wn.id, wn.source, wn.target, wn.name, wn.length_km
      FROM ${stagingSchema}.ways_noded wn
      WHERE (wn.source = ANY($1) AND wn.target = ANY($2))
         OR (wn.source = ANY($2) AND wn.target = ANY($1))
      ORDER BY wn.id
    `, [bearCanyonNodes, fernCanyonNodes]);
    
    console.log(`\n🔗 Direct connecting edges in ways_noded (${connectingEdges.rows.length}):`);
    connectingEdges.rows.forEach(edge => {
      console.log(`  ${edge.id}: ${edge.source} → ${edge.target} (${edge.name || 'Unknown'}, ${edge.length_km.toFixed(2)}km)`);
    });
    
    // Check if there are any paths between Bear Canyon and Fern Canyon using pgRouting
    console.log('\n🛤️ Checking for paths between Bear Canyon and Fern Canyon using ways_noded...');
    
    if (bearCanyonNodes.length > 0 && fernCanyonNodes.length > 0) {
      // Try to find paths from Bear Canyon to Fern Canyon
      const pathResult = await pgClient.query(`
        SELECT path_seq, node, edge, cost, agg_cost
        FROM pgr_dijkstra(
          'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
          $1::bigint, $2::bigint, false
        )
        ORDER BY path_seq
        LIMIT 20
      `, [bearCanyonNodes[0], fernCanyonNodes[0]]);
      
      if (pathResult.rows.length > 0) {
        console.log(`✅ Found path from ${bearCanyonNodes[0]} to ${fernCanyonNodes[0]} (${pathResult.rows.length} segments):`);
        pathResult.rows.forEach(segment => {
          console.log(`  ${segment.path_seq}: ${segment.node} (via edge ${segment.edge}, cost: ${segment.cost.toFixed(2)})`);
        });
      } else {
        console.log(`❌ No path found from ${bearCanyonNodes[0]} to ${fernCanyonNodes[0]}`);
      }
    }
    
    // Check if the trails are properly split in the ways_noded table
    console.log('\n✂️ Checking trail splitting in ways_noded table...');
    
    const splitStatus = await pgClient.query(`
      SELECT 
        name,
        COUNT(*) as segment_count,
        SUM(length_km) as total_length_km,
        array_agg(id) as way_ids,
        array_agg(source) as sources,
        array_agg(target) as targets
      FROM ${stagingSchema}.ways_noded
      WHERE name ILIKE '%bear canyon%' OR name ILIKE '%fern canyon%'
      GROUP BY name
      ORDER BY name
    `);
    
    console.log(`\n📊 Trail splitting status in ways_noded:`);
    splitStatus.rows.forEach(trail => {
      console.log(`  ${trail.name}: ${trail.segment_count} segments, ${trail.total_length_km.toFixed(2)}km total`);
      console.log(`    Way IDs: ${trail.way_ids.join(', ')}`);
      console.log(`    Sources: ${trail.sources.join(', ')}`);
      console.log(`    Targets: ${trail.targets.join(', ')}`);
    });
    
    // Check if there are any intersection points in the ways_noded_vertices_pgr table
    console.log('\n🔍 Checking intersection points in ways_noded_vertices_pgr...');
    
    const intersectionVertices = await pgClient.query(`
      SELECT 
        v.id,
        v.cnt as connection_count,
        ST_AsText(v.the_geom) as location,
        array_agg(DISTINCT wn.name) as connected_trails
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      JOIN ${stagingSchema}.ways_noded wn ON v.id = wn.source OR v.id = wn.target
      WHERE v.cnt > 1  -- Only intersection nodes
        AND (wn.name ILIKE '%bear canyon%' OR wn.name ILIKE '%fern canyon%')
      GROUP BY v.id, v.cnt, v.the_geom
      ORDER BY v.cnt DESC
    `);
    
    console.log(`\n🔗 Intersection vertices (${intersectionVertices.rows.length}):`);
    intersectionVertices.rows.forEach(vertex => {
      console.log(`  Node ${vertex.id}: ${vertex.connection_count} connections at ${vertex.location}`);
      console.log(`    Connected trails: ${vertex.connected_trails.join(', ')}`);
    });
    
  } catch (error) {
    console.error('❌ Error during ways_noded debug:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the debug script
debugWaysNodedConnection().catch(console.error);
