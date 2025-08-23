#!/usr/bin/env ts-node

import { Pool } from 'pg';

class BearCanyonSpecificStartingNodesTest {
  private pgClient: Pool;
  private schema: string;

  constructor() {
    this.pgClient = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'trail_master_db',
      user: process.env.DB_USER || 'shaydu',
      password: process.env.DB_PASSWORD || '',
    });

    this.schema = 'carthorse_1755987460014';
  }

  async testSpecificStartingNodes() {
    console.log('🧪 Testing Bear Canyon loop with specific starting nodes\n');

    // Target nodes from the Bear Canyon loop
    const targetNodes = [341, 358, 335, 338, 334, 359, 356];
    const targetEdges = [81, 123, 159, 25, 54]; // Bear Canyon, Bear Peak West Ridge, Fern Canyon, Fern Canyon, Mesa Trail

    console.log('🎯 Target Loop Nodes:', targetNodes.join(', '));
    console.log('🎯 Target Loop Edges:', targetEdges.join(', '));
    console.log('Expected Loop Length: ~9.38km\n');

    // Test 1: Force KSP to use specific starting nodes
    console.log('🔍 Test 1: KSP with specific starting nodes');
    for (const startNode of targetNodes) {
      console.log(`\n   Testing KSP from node ${startNode}:`);
      
      try {
        const query = `
          WITH ksp_results AS (
            SELECT 
              path_id,
              array_agg(edge ORDER BY path_seq) as edge_sequence,
              array_agg(node ORDER BY path_seq) as node_sequence,
              sum(cost) as total_cost,
              count(*) as edge_count
            FROM pgr_ksp(
              'SELECT id, source, target, cost 
               FROM ${this.schema}.ways_noded 
               WHERE source IS NOT NULL AND target IS NOT NULL',
              ${startNode}, ${startNode}, 
              10,
              false
            )
            WHERE edge > 0
            GROUP BY path_id
            HAVING count(*) BETWEEN 4 AND 10
          )
          SELECT * FROM ksp_results
          WHERE total_cost BETWEEN 8.0 AND 12.0
          ORDER BY total_cost ASC
          LIMIT 5;
        `;

        const result = await this.pgClient.query(query);
        
        if (result.rows.length > 0) {
          console.log(`     Found ${result.rows.length} loops in target range:`);
          result.rows.forEach((loop, i) => {
            console.log(`       Loop ${i + 1}: ${loop.total_cost.toFixed(2)}km, ${loop.edge_count} edges`);
            
            // Check if this loop contains our target edges
            const hasTargetEdges = this.checkForTargetEdges(loop.edge_sequence, targetEdges);
            if (hasTargetEdges) {
              console.log(`         ✅ CONTAINS TARGET EDGES!`);
            }
            
            console.log(`         Edges: ${loop.edge_sequence.join(' → ')}`);
            console.log(`         Nodes: ${loop.node_sequence.join(' → ')}`);
          });
        } else {
          console.log(`     No loops found in target range (8-12km)`);
        }
      } catch (error) {
        console.error(`     ❌ Error:`, error);
      }
    }

    // Test 2: Force Hawick Circuits to focus on target edges
    console.log('\n🔍 Test 2: Hawick Circuits with target edge filtering');
    try {
      const query = `
        WITH hawick_loops AS (
          SELECT 
            path_id,
            array_agg(edge ORDER BY path_seq) as edge_sequence,
            array_agg(node ORDER BY path_seq) as node_sequence,
            max(agg_cost) as total_cost,
            count(*) as edge_count
          FROM pgr_hawickcircuits(
            'SELECT id, source, target, cost 
             FROM ${this.schema}.ways_noded 
             WHERE source IS NOT NULL AND target IS NOT NULL',
            false
          )
          WHERE edge > 0
          GROUP BY path_id
          HAVING count(*) BETWEEN 4 AND 10
        )
        SELECT * FROM hawick_loops
        WHERE total_cost BETWEEN 8.0 AND 12.0
          AND (edge_sequence @> ARRAY[81] OR edge_sequence @> ARRAY[123] OR edge_sequence @> ARRAY[159] OR edge_sequence @> ARRAY[25] OR edge_sequence @> ARRAY[54])
        ORDER BY total_cost ASC
        LIMIT 10;
      `;

      const result = await this.pgClient.query(query);
      
      if (result.rows.length > 0) {
        console.log(`   Found ${result.rows.length} Hawick loops containing target edges:`);
        result.rows.forEach((loop, i) => {
          console.log(`     Loop ${i + 1}: ${loop.total_cost.toFixed(2)}km, ${loop.edge_count} edges`);
          console.log(`       Edges: ${loop.edge_sequence.join(' → ')}`);
          console.log(`       Nodes: ${loop.node_sequence.join(' → ')}`);
          
          // Check which target edges are included
          const includedEdges = targetEdges.filter(edgeId => loop.edge_sequence.includes(edgeId));
          console.log(`       Includes target edges: ${includedEdges.join(', ')}`);
        });
      } else {
        console.log(`   No Hawick loops found containing target edges`);
      }
    } catch (error) {
      console.error(`   ❌ Error with Hawick Circuits:`, error);
    }

    // Test 3: Manual loop construction with target nodes
    console.log('\n🔍 Test 3: Manual loop construction with target nodes');
    try {
      // Try to construct the exact loop manually
      const query = `
        WITH target_edges AS (
          SELECT id, source, target, cost, trail_name
          FROM ${this.schema}.ways_noded 
          WHERE id IN (81, 123, 159, 25, 54)
        ),
        edge_connections AS (
          SELECT 
            e1.id as edge1_id,
            e1.trail_name as edge1_name,
            e1.source as edge1_source,
            e1.target as edge1_target,
            e2.id as edge2_id,
            e2.trail_name as edge2_name,
            e2.source as edge2_source,
            e2.target as edge2_target,
            e1.target as connection_node
          FROM target_edges e1
          JOIN target_edges e2 ON e1.target = e2.source
          WHERE e1.id != e2.id
        )
        SELECT * FROM edge_connections
        ORDER BY edge1_id, edge2_id;
      `;

      const result = await this.pgClient.query(query);
      
      if (result.rows.length > 0) {
        console.log(`   Found ${result.rows.length} direct connections between target edges:`);
        result.rows.forEach((conn, i) => {
          console.log(`     Connection ${i + 1}: ${conn.edge1_name} → ${conn.edge2_name} (via node ${conn.connection_node})`);
        });
      } else {
        console.log(`   No direct connections found between target edges`);
      }
    } catch (error) {
      console.error(`   ❌ Error with manual construction:`, error);
    }

    // Test 4: Check if the current route generation is using these nodes
    console.log('\n🔍 Test 4: Check current route generation starting nodes');
    try {
      const query = `
        SELECT 
          id,
          cnt as degree,
          the_geom
        FROM ${this.schema}.ways_noded_vertices_pgr
        WHERE cnt >= 3
        ORDER BY RANDOM()
        LIMIT 20;
      `;

      const result = await this.pgClient.query(query);
      
      console.log(`   Current algorithm selects ${result.rows.length} random nodes with degree >= 3:`);
      result.rows.forEach((node, i) => {
        const isTarget = targetNodes.includes(node.id);
        const marker = isTarget ? '🎯' : '  ';
        console.log(`     ${marker} Node ${node.id}: degree ${node.degree}${isTarget ? ' (TARGET)' : ''}`);
      });
      
      const targetNodesFound = result.rows.filter(node => targetNodes.includes(node.id));
      console.log(`   Target nodes found in random selection: ${targetNodesFound.length}/${targetNodes.length}`);
    } catch (error) {
      console.error(`   ❌ Error checking current selection:`, error);
    }

    await this.pgClient.end();
  }

  checkForTargetEdges(edgeSequence: number[], targetEdges: number[]): boolean {
    return targetEdges.some(edgeId => edgeSequence.includes(edgeId));
  }
}

async function main() {
  const tester = new BearCanyonSpecificStartingNodesTest();
  await tester.testSpecificStartingNodes();
}

if (require.main === module) {
  main();
}
