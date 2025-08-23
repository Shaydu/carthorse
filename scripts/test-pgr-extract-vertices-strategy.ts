#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { PgrExtractVerticesStrategy } from '../src/utils/services/network-creation/strategies/pgr-extract-vertices-strategy';

async function testPgrExtractVerticesStrategy() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    console.log('🧪 Testing PgrExtractVerticesStrategy...');
    
    // Create a new staging schema for this test
    const timestamp = Date.now();
    const stagingSchema = `carthorse_pgr_extract_test_${timestamp}`;
    
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Create the staging schema
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
    
    // Copy Layer 1 trails to the new schema
    console.log('📋 Copying Layer 1 trails to new schema...');
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.trails AS
      SELECT * FROM carthorse_1755975294381.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
    
    const trailCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
    console.log(`✅ Copied ${trailCount.rows[0].count} trails to ${stagingSchema}`);
    
    // Create and run the PgrExtractVerticesStrategy
    const strategy = new PgrExtractVerticesStrategy();
    const config = {
      stagingSchema,
      tolerances: {
        intersectionDetectionTolerance: 0.00001,
        edgeToVertexTolerance: 0.00001,
        graphAnalysisTolerance: 0.00001,
        trueLoopTolerance: 0.00001,
        minTrailLengthMeters: 10,
        maxTrailLengthMeters: 50000
      }
    };
    const result = await strategy.createNetwork(pgClient, config);
    
    if (!result.success) {
      throw new Error(`Network creation failed: ${result.error}`);
    }
    
    // Test Bear Canyon loop discovery on the new network
    console.log('\n🧪 Testing Bear Canyon loop discovery on new network...');
    
    // Check for Bear Canyon trails
    const bearCanyonTrails = await pgClient.query(`
      SELECT DISTINCT name as trail_name, source as from_node_id, target as to_node_id, length_km
      FROM ${stagingSchema}.ways_noded
      WHERE name ILIKE '%bear canyon%'
      ORDER BY name
    `);
    
    console.log(`📊 Found ${bearCanyonTrails.rows.length} Bear Canyon trail segments:`);
    bearCanyonTrails.rows.forEach(trail => {
      console.log(`  - ${trail.trail_name}: ${trail.from_node_id} → ${trail.to_node_id} (${trail.length_km?.toFixed(2)}km)`);
    });
    
    // Check for Fern Canyon trails
    const fernCanyonTrails = await pgClient.query(`
      SELECT DISTINCT name as trail_name, source as from_node_id, target as to_node_id, length_km
      FROM ${stagingSchema}.ways_noded
      WHERE name ILIKE '%fern canyon%'
      ORDER BY name
    `);
    
    console.log(`📊 Found ${fernCanyonTrails.rows.length} Fern Canyon trail segments:`);
    fernCanyonTrails.rows.forEach(trail => {
      console.log(`  - ${trail.trail_name}: ${trail.from_node_id} → ${trail.to_node_id} (${trail.length_km?.toFixed(2)}km)`);
    });
    
    // Check for Mesa Trail segments
    const mesaTrailSegments = await pgClient.query(`
      SELECT DISTINCT name as trail_name, source as from_node_id, target as to_node_id, length_km
      FROM ${stagingSchema}.ways_noded
      WHERE name ILIKE '%mesa trail%'
      ORDER BY name
    `);
    
    console.log(`📊 Found ${mesaTrailSegments.rows.length} Mesa Trail segments:`);
    mesaTrailSegments.rows.forEach(trail => {
      console.log(`  - ${trail.trail_name}: ${trail.from_node_id} → ${trail.to_node_id} (${trail.length_km?.toFixed(2)}km)`);
    });
    
    // Test Hawick Circuits for loop detection
    console.log('\n🔄 Testing Hawick Circuits for loop detection...');
    const hawickLoops = await pgClient.query(`
      SELECT 
        path_id,
        path_seq,
        node,
        edge,
        cost,
        agg_cost
      FROM pgr_hawickcircuits(
        'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded'
      )
      ORDER BY path_id, path_seq
      LIMIT 200
    `);
    
    console.log(`✅ Found ${hawickLoops.rows.length} path segments with Hawick Circuits`);
    
    // Group loops by path_id
    const loopGroups = new Map<number, any[]>();
    hawickLoops.rows.forEach(row => {
      if (!loopGroups.has(row.path_id)) {
        loopGroups.set(row.path_id, []);
      }
      loopGroups.get(row.path_id)!.push(row);
    });
    
    console.log(`🔍 Found ${loopGroups.size} unique cycles`);
    
    // Look for Bear Canyon related loops
    console.log('🔍 Looking for Bear Canyon related loops...');
    let bearCanyonLoopCount = 0;
    for (const [pathId, cycleEdges] of loopGroups) {
      const totalDistance = Math.max(...cycleEdges.map(edge => edge.agg_cost));
      
      // Check if this cycle contains Bear Canyon related trails
      const edgeIds = cycleEdges.map(edge => edge.edge).filter(id => id !== -1);
      const bearCanyonTrails = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded 
        WHERE id = ANY($1::integer[]) 
        AND (name ILIKE '%bear%' OR name ILIKE '%fern%' OR name ILIKE '%mesa%')
      `, [edgeIds]);
      
      if (bearCanyonTrails.rows[0].count > 0) {
        bearCanyonLoopCount++;
        console.log(`🎯 Found Bear Canyon loop (path_id: ${pathId}): ${totalDistance.toFixed(2)}km with ${bearCanyonTrails.rows[0].count} Bear Canyon trails`);
        
        // Get the trail names in this loop
        const trailNames = await pgClient.query(`
          SELECT DISTINCT name FROM ${stagingSchema}.ways_noded 
          WHERE id = ANY($1::integer[])
          ORDER BY name
        `, [edgeIds]);
        
        console.log(`  Trails: ${trailNames.rows.map(r => r.name).join(', ')}`);
      }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   Total cycles found: ${loopGroups.size}`);
    console.log(`   Bear Canyon related loops: ${bearCanyonLoopCount}`);
    console.log(`   Schema: ${stagingSchema}`);
    
    if (bearCanyonLoopCount > 0) {
      console.log(`\n🎉 SUCCESS! Found ${bearCanyonLoopCount} Bear Canyon related loops with PgrExtractVerticesStrategy!`);
    } else {
      console.log(`\n⚠️ No Bear Canyon loops found with PgrExtractVerticesStrategy`);
    }
    
  } catch (error) {
    console.error('❌ Error testing PgrExtractVerticesStrategy:', error);
  } finally {
    await pgClient.end();
  }
}

if (require.main === module) {
  testPgrExtractVerticesStrategy().catch(console.error);
}
