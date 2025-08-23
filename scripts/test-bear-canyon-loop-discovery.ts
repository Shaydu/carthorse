#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { UnifiedLoopRouteGeneratorService, UnifiedLoopRouteGeneratorConfig } from '../src/utils/services/unified-loop-route-generator-service';

async function testBearCanyonLoopDiscovery() {
  console.log('🧪 Testing Bear Canyon Loop Discovery...');
  
  // Database connection
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: 'carthorse'
  });

  try {
    // Get the most recent staging schema with routing tables
    console.log('🔍 Finding most recent staging schema with routing tables...');
    const schemaResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      AND EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = schema_name 
        AND table_name = 'ways_noded'
      )
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema with routing tables found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Check if Bear Canyon trails exist in the routing network
    console.log('\n🔍 Checking Bear Canyon trail connectivity...');
    const bearCanyonTrails = await pgClient.query(`
      SELECT DISTINCT trail_name, from_node_id, to_node_id, length_km
      FROM ${stagingSchema}.routing_edges 
      WHERE trail_name ILIKE '%bear canyon%'
      ORDER BY trail_name
    `);
    
    console.log(`\n📊 Found ${bearCanyonTrails.rows.length} Bear Canyon trail segments:`);
    bearCanyonTrails.rows.forEach((trail, index) => {
      console.log(`  ${index + 1}. ${trail.trail_name}`);
      console.log(`     Nodes: ${trail.from_node_id} → ${trail.to_node_id}`);
      console.log(`     Length: ${trail.length_km.toFixed(2)}km`);
    });
    
    // Check if Fern Canyon trails exist
    console.log('\n🔍 Checking Fern Canyon trail connectivity...');
    const fernCanyonTrails = await pgClient.query(`
      SELECT DISTINCT trail_name, from_node_id, to_node_id, length_km
      FROM ${stagingSchema}.routing_edges 
      WHERE trail_name ILIKE '%fern canyon%'
      ORDER BY trail_name
    `);
    
    console.log(`\n📊 Found ${fernCanyonTrails.rows.length} Fern Canyon trail segments:`);
    fernCanyonTrails.rows.forEach((trail, index) => {
      console.log(`  ${index + 1}. ${trail.trail_name}`);
      console.log(`     Nodes: ${trail.from_node_id} → ${trail.to_node_id}`);
      console.log(`     Length: ${trail.length_km.toFixed(2)}km`);
    });
    
    // Check if Mesa Trail segments exist
    console.log('\n🔍 Checking Mesa Trail connectivity...');
    const mesaTrailSegments = await pgClient.query(`
      SELECT DISTINCT trail_name, from_node_id, to_node_id, length_km
      FROM ${stagingSchema}.routing_edges 
      WHERE trail_name ILIKE '%mesa trail%'
      AND trail_name NOT ILIKE '%kohler%'
      AND trail_name NOT ILIKE '%reservoir%'
      AND trail_name NOT ILIKE '%shanahan%'
      ORDER BY trail_name
    `);
    
    console.log(`\n📊 Found ${mesaTrailSegments.rows.length} Mesa Trail segments:`);
    mesaTrailSegments.rows.forEach((trail, index) => {
      console.log(`  ${index + 1}. ${trail.trail_name}`);
      console.log(`     Nodes: ${trail.from_node_id} → ${trail.to_node_id}`);
      console.log(`     Length: ${trail.length_km.toFixed(2)}km`);
    });
    
    // Test the path from Fern Canyon to Bear Canyon through Mesa Trail
    console.log('\n🔍 Testing Fern Canyon → Mesa Trail → Bear Canyon path...');
    const pathTest = await pgClient.query(`
      WITH RECURSIVE path AS (
        SELECT 358 as start_node, 358 as current_node, ARRAY[358] as path, 0 as depth
        UNION ALL
        SELECT p.start_node, 
               CASE WHEN p.current_node = re.from_node_id THEN re.to_node_id ELSE re.from_node_id END,
               p.path || CASE WHEN p.current_node = re.from_node_id THEN re.to_node_id ELSE re.from_node_id END,
               p.depth + 1
        FROM path p
        JOIN ${stagingSchema}.routing_edges re ON (p.current_node = re.from_node_id OR p.current_node = re.to_node_id)
        WHERE CASE WHEN p.current_node = re.from_node_id THEN re.to_node_id ELSE re.from_node_id END != ALL(p.path)
        AND p.depth < 10
      )
      SELECT DISTINCT current_node, path
      FROM path 
      WHERE current_node IN (355, 357)
      ORDER BY current_node
    `);
    
    console.log(`\n📊 Found ${pathTest.rows.length} paths from Fern Canyon to Bear Canyon:`);
    pathTest.rows.forEach((path, index) => {
      console.log(`  ${index + 1}. To node ${path.current_node}: ${path.path.join(' → ')}`);
    });
    
    // Configure the loop service for Bear Canyon specific testing
    const loopConfig: UnifiedLoopRouteGeneratorConfig = {
      stagingSchema,
      region: 'boulder',
      targetRoutesPerPattern: 50, // Generate more loops to find Bear Canyon
      minDistanceBetweenRoutes: 0.1, // Allow closer routes
      maxLoopSearchDistance: 25, // km - allow longer loops
      elevationGainRateWeight: 0.5, // Weight for elevation gain rate matching
      distanceWeight: 0.5, // Weight for distance matching
      hawickMaxRows: 20000 // Increase limit to find more loops
    };

    const loopService = new UnifiedLoopRouteGeneratorService(pgClient, loopConfig);

    console.log('\n🔄 Testing Bear Canyon Loop Discovery with Hawick Circuits...');
    console.log('📋 Configuration:');
    console.log(`   Staging Schema: ${stagingSchema}`);
    console.log(`   Target Routes: ${loopConfig.targetRoutesPerPattern}`);
    console.log(`   Max Search Distance: ${loopConfig.maxLoopSearchDistance}km`);
    console.log(`   Hawick Max Rows: ${loopConfig.hawickMaxRows}`);

    // Generate loop routes
    const loopRoutes = await loopService.generateLoopRoutes();

    console.log('\n📊 LOOP DISCOVERY RESULTS:');
    console.log('==========================');
    console.log(`✅ Generated ${loopRoutes.length} total loop routes`);

    // Filter for Bear Canyon related loops
    const bearCanyonLoops = loopRoutes.filter(route => 
      route.route_name.toLowerCase().includes('bear canyon') ||
      route.route_name.toLowerCase().includes('bear peak') ||
      route.constituent_trails?.some(trail => 
        trail.toLowerCase().includes('bear canyon') ||
        trail.toLowerCase().includes('bear peak')
      )
    );
    
    console.log(`\n🎯 Found ${bearCanyonLoops.length} Bear Canyon related loops:`);
    
    if (bearCanyonLoops.length > 0) {
      bearCanyonLoops.forEach((route, index) => {
        console.log(`\n${index + 1}. ${route.route_name}`);
        console.log(`   📏 Distance: ${route.recommended_length_km.toFixed(2)}km`);
        console.log(`   🏔️ Elevation: ${route.recommended_elevation_gain.toFixed(0)}m`);
        console.log(`   🛤️ Trail Count: ${route.trail_count}`);
        console.log(`   🔗 Trails: ${route.constituent_trails?.join(', ') || 'Unknown'}`);
        console.log(`   ⭐ Score: ${route.route_score.toFixed(3)}`);
      });
    } else {
      console.log('\n❌ No Bear Canyon loops found!');
      
      // Show some example loops to see what was found
      console.log('\n📋 Example loops found (first 5):');
      loopRoutes.slice(0, 5).forEach((route, index) => {
        console.log(`\n${index + 1}. ${route.route_name}`);
        console.log(`   📏 Distance: ${route.recommended_length_km.toFixed(2)}km`);
        console.log(`   🏔️ Elevation: ${route.recommended_elevation_gain.toFixed(0)}m`);
        console.log(`   🛤️ Trail Count: ${route.trail_count}`);
        console.log(`   🔗 Trails: ${route.constituent_trails?.join(', ') || 'Unknown'}`);
      });
    }
    
    // Test manual Hawick Circuits query starting from Mesa/Fern Canyon connection node
    console.log('\n🔍 Testing manual Hawick Circuits query starting from Mesa/Fern Canyon node (358)...');
    const manualHawickResult = await pgClient.query(`
      SELECT
        path_id, seq, path_seq, node, edge, cost, agg_cost
      FROM pgr_hawickcircuits(
        'SELECT id, source, target, cost, reverse_cost
         FROM ${stagingSchema}.ways_noded
         WHERE source IS NOT NULL AND target IS NOT NULL AND cost <= 10.0
         AND (source = 358 OR target = 358 OR 
              source IN (SELECT DISTINCT source FROM ${stagingSchema}.ways_noded WHERE target = 358)
              OR target IN (SELECT DISTINCT target FROM ${stagingSchema}.ways_noded WHERE source = 358))
         ORDER BY id'
      )
      ORDER BY path_id, path_seq
      LIMIT 1000
    `);
    
    console.log(`\n📊 Manual Hawick Circuits found ${manualHawickResult.rows.length} path segments`);
    
    // Group by path_id to see complete loops
    const loops = new Map<number, any[]>();
    manualHawickResult.rows.forEach(row => {
      if (!loops.has(row.path_id)) {
        loops.set(row.path_id, []);
      }
      loops.get(row.path_id)!.push(row);
    });
    
    console.log(`\n🔄 Found ${loops.size} complete loops via manual Hawick Circuits`);
    
    // Check if any of these loops contain Bear Canyon nodes
    const bearCanyonNodes = new Set([355, 357, 358]); // Known Bear Canyon connection nodes
    const bearCanyonLoopsFound = Array.from(loops.entries()).filter(([pathId, pathSegments]) => {
      const nodes = pathSegments.map(seg => seg.node);
      return nodes.some(node => bearCanyonNodes.has(node));
    });
    
    console.log(`\n🎯 Found ${bearCanyonLoopsFound.length} loops containing Bear Canyon nodes:`);
    bearCanyonLoopsFound.forEach(([pathId, pathSegments], index) => {
      const nodes = pathSegments.map(seg => seg.node);
      const totalCost = pathSegments[pathSegments.length - 1]?.agg_cost || 0;
      console.log(`\n${index + 1}. Loop ${pathId}:`);
      console.log(`   📏 Total Cost: ${totalCost.toFixed(2)}km`);
      console.log(`   🔗 Nodes: ${nodes.join(' → ')}`);
      console.log(`   🎯 Bear Canyon Nodes: ${nodes.filter(n => bearCanyonNodes.has(n)).join(', ')}`);
    });
    
    // Test for loops that start and end at the Mesa/Fern Canyon connection node (358)
    console.log('\n🔍 Testing for loops that start/end at Mesa/Fern Canyon connection node (358)...');
    const loopsStartingAt358 = Array.from(loops.entries()).filter(([pathId, pathSegments]) => {
      const nodes = pathSegments.map(seg => seg.node);
      return nodes[0] === 358 && nodes[nodes.length - 1] === 358;
    });
    
    console.log(`\n🎯 Found ${loopsStartingAt358.length} loops starting/ending at node 358 (Mesa/Fern Canyon):`);
    loopsStartingAt358.forEach(([pathId, pathSegments], index) => {
      const nodes = pathSegments.map(seg => seg.node);
      const totalCost = pathSegments[pathSegments.length - 1]?.agg_cost || 0;
      console.log(`\n${index + 1}. Loop ${pathId}:`);
      console.log(`   📏 Total Cost: ${totalCost.toFixed(2)}km`);
      console.log(`   🔗 Nodes: ${nodes.join(' → ')}`);
      console.log(`   🎯 Contains Bear Canyon: ${nodes.some(n => bearCanyonNodes.has(n)) ? 'YES' : 'NO'}`);
    });
    
    // Test for any loops that pass through node 358 (Mesa/Fern Canyon connection)
    console.log('\n🔍 Testing for any loops that pass through Mesa/Fern Canyon connection node (358)...');
    const loopsThrough358 = Array.from(loops.entries()).filter(([pathId, pathSegments]) => {
      const nodes = pathSegments.map(seg => seg.node);
      return nodes.includes(358);
    });
    
    console.log(`\n🎯 Found ${loopsThrough358.length} loops passing through node 358 (Mesa/Fern Canyon):`);
    loopsThrough358.forEach(([pathId, pathSegments], index) => {
      const nodes = pathSegments.map(seg => seg.node);
      const totalCost = pathSegments[pathSegments.length - 1]?.agg_cost || 0;
      console.log(`\n${index + 1}. Loop ${pathId}:`);
      console.log(`   📏 Total Cost: ${totalCost.toFixed(2)}km`);
      console.log(`   🔗 Nodes: ${nodes.join(' → ')}`);
      console.log(`   🎯 Contains Bear Canyon: ${nodes.some(n => bearCanyonNodes.has(n)) ? 'YES' : 'NO'}`);
    });
    
  } catch (error) {
    console.error('❌ Error during Bear Canyon loop discovery test:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testBearCanyonLoopDiscovery().catch(console.error);
