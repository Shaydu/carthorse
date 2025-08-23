#!/usr/bin/env node

/**
 * Test Bear Canyon loop discovery using the approach from commit f66282bf
 * This script mimics the successful route generation from that commit
 */

import { Pool } from 'pg';
import { getDatabaseConfig } from '../src/utils/config-loader';

interface BearCanyonTestResult {
  success: boolean;
  error?: string;
  networkStats?: {
    totalNodes: number;
    totalEdges: number;
    connectivity: number;
  };
  bearCanyonNodes?: any[];
  loopResults?: any[];
}

async function testBearCanyonF66282bfApproach(): Promise<BearCanyonTestResult> {
  const dbConfig = getDatabaseConfig();
  const pgClient = new Pool(dbConfig);
  
  // Use the most recent test schema with PgrExtractVerticesStrategy results
  const stagingSchema = 'carthorse_pgr_extract_test_1755981131772';
  
  try {
    console.log('🧪 Testing Bear Canyon loop discovery using f66282bf approach');
    console.log(`📊 Using schema: ${stagingSchema}`);
    
    // Check if the schema exists and has the required tables
    const schemaCheck = await pgClient.query(`
      SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = $1)
    `, [stagingSchema]);
    
    if (!schemaCheck.rows[0].exists) {
      throw new Error(`Schema ${stagingSchema} does not exist`);
    }
    
    // Check for required tables (ways_noded and ways_noded_vertices_pgr)
    const tablesCheck = await pgClient.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = $1 
      AND table_name IN ('ways_noded', 'ways_noded_vertices_pgr', 'trails')
    `, [stagingSchema]);
    
    const availableTables = tablesCheck.rows.map(row => row.table_name);
    console.log(`📋 Available tables: ${availableTables.join(', ')}`);
    
    // Get network statistics
    const nodeCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded_vertices_pgr`);
    const edgeCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded`);
    
    console.log(`📊 Network: ${nodeCount.rows[0].count} nodes, ${edgeCount.rows[0].count} edges`);
    
    // Look for Bear Canyon, Fern Canyon, and Mesa Trail nodes/edges (key components of the loop)
    console.log('🔍 Searching for Bear Canyon loop components...');
    
    const bearCanyonComponents = await pgClient.query(`
      SELECT DISTINCT
        wn.id as edge_id,
        wn.source,
        wn.target, 
        wn.name,
        wn.length_km,
        ST_X(v1.the_geom) as start_lng,
        ST_Y(v1.the_geom) as start_lat,
        ST_X(v2.the_geom) as end_lng,
        ST_Y(v2.the_geom) as end_lat,
        v1.cnt as start_node_connections,
        v2.cnt as end_node_connections
      FROM ${stagingSchema}.ways_noded wn
      JOIN ${stagingSchema}.ways_noded_vertices_pgr v1 ON v1.id = wn.source
      JOIN ${stagingSchema}.ways_noded_vertices_pgr v2 ON v2.id = wn.target
      WHERE wn.name ILIKE '%bear%canyon%' 
         OR wn.name ILIKE '%fern%canyon%'
         OR wn.name ILIKE '%mesa%trail%'
      ORDER BY wn.name, wn.id
    `);
    
    console.log(`🐻 Found ${bearCanyonComponents.rows.length} Bear Canyon loop component edges:`);
    for (const comp of bearCanyonComponents.rows) {
      console.log(`  ${comp.edge_id}: ${comp.name} (${comp.source} → ${comp.target}) [${comp.start_node_connections}/${comp.end_node_connections} connections]`);
    }
    
    // Get all intersection nodes (nodes with 2+ connections) that connect Bear Canyon components
    const intersectionNodes = await pgClient.query(`
      SELECT DISTINCT
        v.id,
        v.cnt as connections,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat,
        ARRAY_AGG(DISTINCT wn.name) as connected_trails
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      JOIN ${stagingSchema}.ways_noded wn ON (wn.source = v.id OR wn.target = v.id)
      WHERE v.cnt >= 2
        AND EXISTS (
          SELECT 1 FROM ${stagingSchema}.ways_noded wn2 
          WHERE (wn2.source = v.id OR wn2.target = v.id)
            AND (wn2.name ILIKE '%bear%canyon%' 
                 OR wn2.name ILIKE '%fern%canyon%'
                 OR wn2.name ILIKE '%mesa%trail%')
        )
      GROUP BY v.id, v.cnt, v.the_geom
      ORDER BY v.cnt DESC
    `);
    
    console.log(`🔗 Found ${intersectionNodes.rows.length} intersection nodes connected to Bear Canyon components:`);
    for (const node of intersectionNodes.rows.slice(0, 10)) { // Show top 10
      console.log(`  Node ${node.id}: ${node.connections} connections to [${node.connected_trails.join(', ')}]`);
    }
    
    // Use pgr_hawickcircuits to find loops (mimicking f66282bf approach)
    console.log('🔄 Running Hawick Circuits to find loops...');
    
    const hawickResult = await pgClient.query(`
      SELECT * FROM pgr_hawickcircuits(
        'SELECT id, source, target, ST_Length(the_geom::geography) as cost 
         FROM ${stagingSchema}.ways_noded
         WHERE source != target'
      ) 
      WHERE path_id IN (
        SELECT DISTINCT h.path_id 
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, ST_Length(the_geom::geography) as cost 
           FROM ${stagingSchema}.ways_noded
           WHERE source != target'
        ) h
        JOIN ${stagingSchema}.ways_noded wn ON h.edge = wn.id
        WHERE wn.name ILIKE '%bear%canyon%' 
           OR wn.name ILIKE '%fern%canyon%'
           OR wn.name ILIKE '%mesa%trail%'
      )
      ORDER BY path_id, path_seq
    `);
    
    console.log(`🔍 Found ${hawickResult.rows.length} circuit edges in Bear Canyon-related loops`);
    
    // Group circuits by path_id to analyze individual loops
    const circuits = new Map<number, any[]>();
    for (const row of hawickResult.rows) {
      if (!circuits.has(row.path_id)) {
        circuits.set(row.path_id, []);
      }
      circuits.get(row.path_id)!.push(row);
    }
    
    console.log(`🎯 Found ${circuits.size} distinct circuits containing Bear Canyon components:`);
    
    const loopAnalysis = [];
    for (const [pathId, pathEdges] of circuits) {
      // Get edge details for this circuit
      const edgeIds = pathEdges.map(e => e.edge);
      const edgeDetails = await pgClient.query(`
        SELECT 
          wn.id,
          wn.name,
          wn.length_km,
          wn.source,
          wn.target
        FROM ${stagingSchema}.ways_noded wn
        WHERE wn.id = ANY($1::int[])
        ORDER BY wn.id
      `, [edgeIds]);
      
      const totalDistance = edgeDetails.rows.reduce((sum, edge) => sum + (edge.length_km || 0), 0);
      const trailNames = [...new Set(edgeDetails.rows.map(e => e.name).filter(n => n))];
      
      const loopInfo = {
        path_id: pathId,
        edge_count: pathEdges.length,
        total_distance_km: totalDistance,
        trail_names: trailNames,
        edges: edgeDetails.rows
      };
      
      loopAnalysis.push(loopInfo);
      
      console.log(`  Loop ${pathId}: ${pathEdges.length} edges, ${totalDistance.toFixed(2)}km`);
      console.log(`    Trails: ${trailNames.join(' → ')}`);
    }
    
    // Look for the classic Bear Canyon loop pattern
    const classicBearCanyonLoop = loopAnalysis.find(loop => 
      loop.trail_names.some(name => name && name.toLowerCase().includes('bear')) &&
      loop.trail_names.some(name => name && name.toLowerCase().includes('fern')) &&
      loop.trail_names.some(name => name && name.toLowerCase().includes('mesa')) &&
      loop.total_distance_km > 5 && loop.total_distance_km < 15
    );
    
    if (classicBearCanyonLoop) {
      console.log(`🎉 Found classic Bear Canyon loop: ${classicBearCanyonLoop.total_distance_km.toFixed(2)}km`);
      console.log(`   Trail sequence: ${classicBearCanyonLoop.trail_names.join(' → ')}`);
    } else {
      console.log(`⚠️  Classic Bear Canyon loop not found in automated discovery`);
    }
    
    // Test manual route construction between key intersection points
    console.log('🧭 Testing manual route construction between key intersections...');
    
    if (intersectionNodes.rows.length >= 2) {
      const startNode = intersectionNodes.rows[0].id;
      const endNode = intersectionNodes.rows[1].id;
      
      console.log(`🔀 Testing KSP between nodes ${startNode} and ${endNode}...`);
      
      const kspResult = await pgClient.query(`
        SELECT * FROM pgr_ksp(
          'SELECT id, source, target, ST_Length(the_geom::geography) as cost 
           FROM ${stagingSchema}.ways_noded',
          $1::integer, $2::integer, 3, false
        )
        ORDER BY path_id, path_seq
      `, [startNode, endNode]);
      
      console.log(`📍 KSP found ${kspResult.rows.length} path segments across ${new Set(kspResult.rows.map(r => r.path_id)).size} alternative routes`);
    }
    
    return {
      success: true,
      networkStats: {
        totalNodes: parseInt(nodeCount.rows[0].count),
        totalEdges: parseInt(edgeCount.rows[0].count),
        connectivity: intersectionNodes.rows.length
      },
      bearCanyonNodes: intersectionNodes.rows,
      loopResults: loopAnalysis
    };
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  } finally {
    await pgClient.end();
  }
}

// Run the test
if (require.main === module) {
  testBearCanyonF66282bfApproach()
    .then(result => {
      if (result.success) {
        console.log('\n✅ Bear Canyon test completed successfully');
        console.log(`📊 Network: ${result.networkStats?.totalNodes} nodes, ${result.networkStats?.totalEdges} edges`);
        console.log(`🔗 Intersection points: ${result.networkStats?.connectivity}`);
        console.log(`🔄 Loop circuits found: ${result.loopResults?.length || 0}`);
      } else {
        console.log('\n❌ Bear Canyon test failed:', result.error);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('💥 Unexpected error:', error);
      process.exit(1);
    });
}

export { testBearCanyonF66282bfApproach };
