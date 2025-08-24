#!/usr/bin/env ts-node

import { Pool } from 'pg';

async function main() {
  console.log('🔍 Testing the specific Bear Canyon loop path...');
  
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'carthorse',
    password: process.env.PGPASSWORD,
  });

  try {
    const stagingSchema = 'bear_canyon_test';
    
    // The desired Bear Canyon loop path:
    // Fern Canyon → Mesa Trail → Bear Canyon → Bear Peak West Ridge → Bear Peak → Fern Canyon
    console.log('\n🎯 Testing Bear Canyon Loop Path:');
    console.log('   Start: Fern Canyon (node 334)');
    console.log('   → Mesa Trail (node 358)');
    console.log('   → Bear Canyon (node 341)');
    console.log('   → Bear Peak West Ridge (node 335)');
    console.log('   → Bear Peak (node 340)');
    console.log('   → Bear Peak (node 335)');
    console.log('   → Fern Canyon (node 338)');
    console.log('   → End: Fern Canyon (node 334)');
    
    // Test each segment of the path
    const pathSegments = [
      { from: 334, to: 358, description: 'Fern Canyon to Mesa Trail' },
      { from: 358, to: 341, description: 'Mesa Trail to Bear Canyon' },
      { from: 341, to: 335, description: 'Bear Canyon to Bear Peak West Ridge' },
      { from: 335, to: 340, description: 'Bear Peak West Ridge to Bear Peak' },
      { from: 340, to: 335, description: 'Bear Peak back to Bear Peak West Ridge' },
      { from: 335, to: 338, description: 'Bear Peak West Ridge to Fern Canyon' },
      { from: 338, to: 334, description: 'Fern Canyon back to start' }
    ];
    
    console.log('\n🔍 Testing each path segment:');
    
    for (const segment of pathSegments) {
      console.log(`\n   ${segment.description} (${segment.from} → ${segment.to}):`);
      
      // Check if there's a direct edge
      const directEdgeResult = await pool.query(`
        SELECT id, source, target, trail_name, length_km
        FROM ${stagingSchema}.ways_noded
        WHERE (source = $1 AND target = $2) OR (source = $2 AND target = $1)
      `, [segment.from, segment.to]);
      
      if (directEdgeResult.rows.length > 0) {
        const edge = directEdgeResult.rows[0];
        console.log(`     ✅ Direct edge ${edge.id}: ${edge.source} → ${edge.target} (${edge.trail_name}) - ${edge.length_km.toFixed(3)}km`);
      } else {
        console.log(`     ❌ No direct edge found`);
        
        // Try to find a path using Dijkstra
        const pathResult = await pool.query(`
          SELECT * FROM pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
            $1::integer, $2::integer, false
          )
        `, [segment.from, segment.to]);
        
        if (pathResult.rows.length > 0) {
          console.log(`     🔄 Path found with ${pathResult.rows.length} edges`);
          
          // Get the edges in the path
          const edgeIds = pathResult.rows.map((row: any) => row.edge);
          const edgesResult = await pool.query(`
            SELECT id, source, target, trail_name, length_km
            FROM ${stagingSchema}.ways_noded
            WHERE id = ANY($1::integer[])
            ORDER BY id
          `, [edgeIds]);
          
          edgesResult.rows.forEach((row: any) => {
            console.log(`       Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name})`);
          });
        } else {
          console.log(`     ❌ No path found between ${segment.from} and ${segment.to}`);
        }
      }
    }
    
    // Test if we can find the complete loop using a different approach
    console.log('\n🔍 Testing complete loop detection:');
    
    // Try to find a path from 334 back to 334 that includes the key trails
    const loopResult = await pool.query(`
      WITH RECURSIVE loop_search AS (
        SELECT 
          ARRAY[334] as path,
          ARRAY[334] as nodes,
          0.0 as total_length,
          0 as depth
        UNION ALL
        SELECT 
          path || next_node,
          nodes || next_node,
          total_length + edge_length,
          depth + 1
        FROM loop_search ls
        CROSS JOIN LATERAL (
          SELECT 
            CASE WHEN e.source = ls.nodes[array_length(ls.nodes, 1)] THEN e.target ELSE e.source END as next_node,
            e.length_km as edge_length
          FROM ${stagingSchema}.ways_noded e
          WHERE (e.source = ls.nodes[array_length(ls.nodes, 1)] OR e.target = ls.nodes[array_length(ls.nodes, 1)])
            AND ls.depth < 10
            AND ls.total_length < 20.0
        ) next
        WHERE next_node != 334 OR (next_node = 334 AND depth > 3)
      )
      SELECT path, nodes, total_length, depth
      FROM loop_search
      WHERE nodes[array_length(nodes, 1)] = 334 
        AND depth > 3
        AND total_length BETWEEN 8.0 AND 15.0
      ORDER BY total_length
      LIMIT 5
    `);
    
    console.log(`   Found ${loopResult.rows.length} potential loops:`);
    loopResult.rows.forEach((row: any, index: number) => {
      console.log(`   ${index + 1}. Path: ${row.nodes.join(' → ')} (${row.total_length.toFixed(2)}km, ${row.depth} edges)`);
    });
    
  } catch (error) {
    console.error('❌ Error testing Bear Canyon loop path:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
