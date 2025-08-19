#!/usr/bin/env ts-node

import { Pool } from 'pg';

async function debugBearCanyonFernCanyonConnection() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🔍 Debugging Bear Canyon and Fern Canyon connection...');
    
    // Get the most recent staging schema
    const schemaResult = await pgClient.query(`
      SELECT schemaname 
      FROM pg_tables 
      WHERE tablename = 'export_edges' 
      ORDER BY schemaname DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema with export_edges found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schemaname;
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Find Bear Canyon and Fern Canyon trails specifically
    console.log('\n🎯 Finding Bear Canyon and Fern Canyon trails...');
    
    const bearCanyonTrails = await pgClient.query(`
      SELECT id, source, target, trail_name, length_km, elevation_gain, elevation_loss
      FROM ${stagingSchema}.export_edges
      WHERE trail_name ILIKE '%bear canyon%'
      ORDER BY trail_name, id
    `);
    
    const fernCanyonTrails = await pgClient.query(`
      SELECT id, source, target, trail_name, length_km, elevation_gain, elevation_loss
      FROM ${stagingSchema}.export_edges
      WHERE trail_name ILIKE '%fern canyon%'
      ORDER BY trail_name, id
    `);
    
    console.log(`\n🐻 Bear Canyon trails (${bearCanyonTrails.rows.length}):`);
    bearCanyonTrails.rows.forEach(trail => {
      console.log(`  ${trail.id}: ${trail.trail_name} (${trail.source} → ${trail.target}, ${trail.length_km.toFixed(2)}km)`);
    });
    
    console.log(`\n🌿 Fern Canyon trails (${fernCanyonTrails.rows.length}):`);
    fernCanyonTrails.rows.forEach(trail => {
      console.log(`  ${trail.id}: ${trail.trail_name} (${trail.source} → ${trail.target}, ${trail.length_km.toFixed(2)}km)`);
    });
    
    // Check if these trails are connected in the ways_noded table
    console.log('\n🔗 Checking connections in ways_noded table...');
    
    const bearCanyonNodes = bearCanyonTrails.rows.map(t => [t.source, t.target]).flat();
    const fernCanyonNodes = fernCanyonTrails.rows.map(t => [t.source, t.target]).flat();
    
    console.log(`Bear Canyon nodes: ${bearCanyonNodes.join(', ')}`);
    console.log(`Fern Canyon nodes: ${fernCanyonNodes.join(', ')}`);
    
    // Find common nodes between Bear Canyon and Fern Canyon
    const commonNodes = bearCanyonNodes.filter(node => fernCanyonNodes.includes(node));
    console.log(`\n🔗 Common nodes between Bear Canyon and Fern Canyon: ${commonNodes.join(', ')}`);
    
    // Check if there are any edges connecting these trails
    const connectingEdges = await pgClient.query(`
      SELECT wn.id, wn.source, wn.target, wn.cost, ee.trail_name
      FROM ${stagingSchema}.ways_noded wn
      LEFT JOIN ${stagingSchema}.export_edges ee ON wn.id = ee.id
      WHERE (wn.source = ANY($1) AND wn.target = ANY($2))
         OR (wn.source = ANY($2) AND wn.target = ANY($1))
      ORDER BY wn.id
    `, [bearCanyonNodes, fernCanyonNodes]);
    
    console.log(`\n🔗 Direct connecting edges (${connectingEdges.rows.length}):`);
    connectingEdges.rows.forEach(edge => {
      console.log(`  ${edge.id}: ${edge.source} → ${edge.target} (${edge.trail_name || 'Unknown'}, ${edge.cost.toFixed(2)}km)`);
    });
    
    // Check if there are any paths between Bear Canyon and Fern Canyon using pgRouting
    console.log('\n🛤️ Checking for paths between Bear Canyon and Fern Canyon...');
    
    if (bearCanyonNodes.length > 0 && fernCanyonNodes.length > 0) {
      // Try to find paths from Bear Canyon to Fern Canyon
      const pathResult = await pgClient.query(`
        SELECT path_seq, node, edge, cost, agg_cost
        FROM pgr_dijkstra(
          'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded',
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
    
    // Check if the trails are properly split and connected
    console.log('\n✂️ Checking trail splitting status...');
    
    const splitStatus = await pgClient.query(`
      SELECT 
        t.app_uuid,
        t.name,
        ST_NumPoints(t.geometry) as num_points,
        ST_IsSimple(t.geometry) as is_simple,
        ST_IsValid(t.geometry) as is_valid,
        ST_Length(t.geometry::geography) as length_m
      FROM ${stagingSchema}.trails t
      WHERE t.name ILIKE '%bear canyon%' OR t.name ILIKE '%fern canyon%'
      ORDER BY t.name
    `);
    
    console.log(`\n📊 Trail splitting status:`);
    splitStatus.rows.forEach(trail => {
      console.log(`  ${trail.name}: ${trail.num_points} points, simple: ${trail.is_simple}, valid: ${trail.is_valid}, length: ${(trail.length_m/1000).toFixed(2)}km`);
    });
    
    // Check if there are any intersection points between these trails
    console.log('\n🔍 Checking for intersection points...');
    
    const intersectionResult = await pgClient.query(`
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_point,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type
      FROM ${stagingSchema}.trails t1
      JOIN ${stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
      WHERE (t1.name ILIKE '%bear canyon%' AND t2.name ILIKE '%fern canyon%')
         OR (t1.name ILIKE '%fern canyon%' AND t2.name ILIKE '%bear canyon%')
      AND ST_Intersects(t1.geometry, t2.geometry)
    `);
    
    console.log(`\n🔗 Intersection points (${intersectionResult.rows.length}):`);
    intersectionResult.rows.forEach(intersection => {
      console.log(`  ${intersection.trail1_name} ∩ ${intersection.trail2_name}: ${intersection.intersection_point} (${intersection.intersection_type})`);
    });
    
  } catch (error) {
    console.error('❌ Error during debug:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the debug script
debugBearCanyonFernCanyonConnection().catch(console.error);
