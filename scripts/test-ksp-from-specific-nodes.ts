#!/usr/bin/env ts-node

import { Pool } from 'pg';

class KspFromSpecificNodesTest {
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

  async testKspFromSpecificNodes() {
    console.log('🧪 Testing KSP from specific Bear Canyon loop nodes\n');

    // Target nodes from the Bear Canyon loop
    const targetNodes = [341, 358, 335, 338, 334, 359, 356];
    const targetEdges = [81, 123, 159, 25, 54]; // Bear Canyon, Bear Peak West Ridge, Fern Canyon, Fern Canyon, Mesa Trail

    console.log('🎯 Target Loop Nodes:', targetNodes.join(', '));
    console.log('🎯 Target Loop Edges:', targetNodes.join(', '));
    console.log('Expected Loop Length: ~9.38km\n');

    for (const startNode of targetNodes) {
      console.log(`\n🔍 Testing KSP from node ${startNode}:`);
      
      try {
        // Test KSP with different K values
        for (const k of [5, 10, 15]) {
          console.log(`   KSP with K=${k}:`);
          
          const query = `
            WITH ksp_results AS (
              SELECT 
                path,
                cost,
                array_length(path, 1) as edge_count
              FROM pgr_ksp(
                'SELECT id, from_node_id as source, to_node_id as target, length_km as cost 
                 FROM ${this.schema}.routing_edges 
                 WHERE length_km > 0',
                ${startNode}, ${startNode}, 
                ${k},
                directed := false
              )
              WHERE array_length(path, 1) BETWEEN 4 AND 10
            )
            SELECT * FROM ksp_results
            WHERE cost BETWEEN 8.0 AND 12.0
            ORDER BY cost ASC
            LIMIT 5;
          `;

          const result = await this.pgClient.query(query);
          
          if (result.rows.length > 0) {
            console.log(`     Found ${result.rows.length} loops in target length range:`);
            result.rows.forEach((loop, i) => {
              console.log(`       Loop ${i + 1}: ${loop.cost.toFixed(2)}km, ${loop.edge_count} edges`);
              
              // Check if this loop contains our target edges
              const hasTargetEdges = this.checkForTargetEdges(loop.path, targetEdges);
              if (hasTargetEdges) {
                console.log(`         ✅ CONTAINS TARGET EDGES!`);
              }
              
              console.log(`         Path: ${loop.path.join(' → ')}`);
            });
          } else {
            console.log(`     No loops found in target length range (8-12km)`);
          }
        }
      } catch (error) {
        console.error(`   ❌ Error testing KSP from node ${startNode}:`, error);
      }
    }

    // Test with a more specific query that looks for loops containing our target edges
    console.log('\n🎯 Testing for loops containing specific target edges:');
    
    for (const startNode of targetNodes.slice(0, 3)) { // Test first 3 nodes
      console.log(`\n🔍 Testing from node ${startNode} for target edge combinations:`);
      
      try {
        const query = `
          WITH ksp_results AS (
            SELECT 
              path,
              cost,
              array_length(path, 1) as edge_count
            FROM pgr_ksp(
              'SELECT id, from_node_id as source, to_node_id as target, length_km as cost 
               FROM ${this.schema}.routing_edges 
               WHERE length_km > 0',
              ${startNode}, ${startNode}, 
              20,
              directed := false
            )
            WHERE array_length(path, 1) BETWEEN 4 AND 10
          ),
          target_edge_loops AS (
            SELECT *
            FROM ksp_results
            WHERE cost BETWEEN 8.0 AND 12.0
              AND (path @> ARRAY[81] OR path @> ARRAY[123] OR path @> ARRAY[159] OR path @> ARRAY[25] OR path @> ARRAY[54])
          )
          SELECT * FROM target_edge_loops
          ORDER BY cost ASC
          LIMIT 10;
        `;

        const result = await this.pgClient.query(query);
        
        if (result.rows.length > 0) {
          console.log(`   Found ${result.rows.length} loops containing target edges:`);
          result.rows.forEach((loop, i) => {
            console.log(`     Loop ${i + 1}: ${loop.cost.toFixed(2)}km, ${loop.edge_count} edges`);
            console.log(`       Path: ${loop.path.join(' → ')}`);
            
            // Check which target edges are included
            const includedEdges = targetEdges.filter(edgeId => loop.path.includes(edgeId));
            console.log(`       Includes target edges: ${includedEdges.join(', ')}`);
          });
        } else {
          console.log(`   No loops found containing target edges`);
        }
      } catch (error) {
        console.error(`   ❌ Error in target edge search:`, error);
      }
    }

    await this.pgClient.end();
  }

  checkForTargetEdges(path: number[], targetEdges: number[]): boolean {
    return targetEdges.some(edgeId => path.includes(edgeId));
  }
}

async function main() {
  const tester = new KspFromSpecificNodesTest();
  await tester.testKspFromSpecificNodes();
}

if (require.main === module) {
  main();
}
