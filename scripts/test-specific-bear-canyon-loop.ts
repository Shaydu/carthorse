#!/usr/bin/env ts-node

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

interface TargetLoop {
  name: string;
  description: string;
  expectedEdges: number[];
  expectedLength: number;
  expectedNodes: number[];
}

class SpecificBearCanyonLoopTester {
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

  async initialize() {
    console.log('🔧 Initializing Specific Bear Canyon Loop Tester...');
    
    // Define the target loop we're looking for
    const targetLoop: TargetLoop = {
      name: 'Bear Canyon Clockwise Loop',
      description: 'Bear Canyon → Bear Peak West Ridge → Fern Canyon → Mesa Trail',
      expectedEdges: [81, 123, 159, 25, 54], // Edge IDs in clockwise order
      expectedLength: 9.58, // Expected total length in km
      expectedNodes: [341, 358, 335, 338, 334, 359, 356] // Expected node sequence
    };

    console.log(`🎯 Target Loop: ${targetLoop.name}`);
    console.log(`   ${targetLoop.description}`);
    console.log(`   Expected Length: ${targetLoop.expectedLength}km`);
    console.log(`   Expected Edges: ${targetLoop.expectedEdges.join(' → ')}`);
    
    return targetLoop;
  }

  async verifyTargetEdges(targetLoop: TargetLoop) {
    console.log('\n🔍 Verifying target edges exist...');
    
    const query = `
      SELECT id, from_node_id, to_node_id, trail_name, length_km, elevation_gain
      FROM ${this.schema}.routing_edges 
      WHERE id = ANY($1)
      ORDER BY id;
    `;
    
    const result = await this.pgClient.query(query, [targetLoop.expectedEdges]);
    
    console.log(`   Found ${result.rows.length}/${targetLoop.expectedEdges.length} target edges:`);
    result.rows.forEach(edge => {
      console.log(`     Edge ${edge.id}: ${edge.trail_name} (${edge.from_node_id}→${edge.to_node_id}, ${edge.length_km}km)`);
    });
    
    return result.rows;
  }

  async testDirectPathQuery(targetLoop: TargetLoop) {
    console.log('\n🧪 Testing direct path query...');
    
    // Try to find a path that includes our target edges
    const query = `
      WITH target_edges AS (
        SELECT id, from_node_id, to_node_id, trail_name, length_km
        FROM ${this.schema}.routing_edges 
        WHERE id = ANY($1)
      ),
      path_combinations AS (
        SELECT 
          array_agg(id ORDER BY id) as edge_sequence,
          array_agg(from_node_id ORDER BY id) as from_nodes,
          array_agg(to_node_id ORDER BY id) as to_nodes,
          sum(length_km) as total_length
        FROM target_edges
        GROUP BY 1
      )
      SELECT * FROM path_combinations
      WHERE total_length BETWEEN ${targetLoop.expectedLength * 0.8} AND ${targetLoop.expectedLength * 1.2};
    `;
    
    try {
      const result = await this.pgClient.query(query, [targetLoop.expectedEdges]);
      console.log(`   Found ${result.rows.length} potential path combinations`);
      
      if (result.rows.length > 0) {
        result.rows.forEach((row, i) => {
          console.log(`     Combination ${i + 1}: ${row.total_length.toFixed(2)}km`);
          console.log(`       Edges: ${row.edge_sequence.join(' → ')}`);
        });
      }
      
      return result.rows;
    } catch (error) {
      console.error(`   ❌ Error in direct path query:`, error);
      return [];
    }
  }

  async testHawickWithEdgeFilter(targetLoop: TargetLoop) {
    console.log('\n🧪 Testing Hawick Circuits with edge filtering...');
    
    const query = `
      WITH filtered_edges AS (
        SELECT id, from_node_id as source, to_node_id as target, length_km as cost
        FROM ${this.schema}.routing_edges 
        WHERE length_km > 0
          AND (trail_name ILIKE '%Bear Canyon%' 
               OR trail_name ILIKE '%Bear Peak West Ridge%' 
               OR trail_name ILIKE '%Fern Canyon%' 
               OR trail_name ILIKE '%Mesa Trail%'
               OR from_node_id = ANY($1) 
               OR to_node_id = ANY($1))
      )
      SELECT 
        row_number() OVER () as circuit_id,
        path,
        cost,
        array_length(path, 1) as edge_count
      FROM pgr_hawickCircuits(
        'SELECT * FROM filtered_edges',
        directed := false
      ) 
      WHERE array_length(path, 1) BETWEEN 4 AND 8
        AND cost BETWEEN ${targetLoop.expectedLength * 0.8} AND ${targetLoop.expectedLength * 1.2}
      ORDER BY cost ASC
      LIMIT 50;
    `;
    
    try {
      const result = await this.pgClient.query(query, [targetLoop.expectedNodes]);
      const matchingLoops = this.findExactMatches(result.rows, targetLoop);
      
      console.log(`   Found ${result.rows.length} total loops`);
      console.log(`   Found ${matchingLoops.length} matching loops`);
      
      if (matchingLoops.length > 0) {
        console.log(`   ✅ SUCCESS! Found exact matches:`);
        matchingLoops.forEach((loop, i) => {
          console.log(`     Loop ${i + 1}: ${loop.cost.toFixed(2)}km, ${loop.edge_count} edges`);
          console.log(`       Path: ${loop.path.join(' → ')}`);
        });
      }
      
      return matchingLoops;
    } catch (error) {
      console.error(`   ❌ Error in Hawick with edge filter:`, error);
      return [];
    }
  }

  async testKspFromSpecificNodes(targetLoop: TargetLoop) {
    console.log('\n🧪 Testing KSP from specific nodes...');
    
    // Test KSP from each of our target nodes
    const startNodes = [341, 358, 335, 338, 334, 359, 356];
    let allLoops: any[] = [];
    
    for (const startNode of startNodes) {
      const query = `
        WITH ksp_paths AS (
          SELECT 
            path,
            cost,
            array_length(path, 1) as edge_count
          FROM pgr_ksp(
            'SELECT id, from_node_id as source, to_node_id as target, length_km as cost 
             FROM ${this.schema}.routing_edges 
             WHERE length_km > 0',
            ${startNode}, ${startNode}, 
            5,
            directed := false
          )
          WHERE array_length(path, 1) BETWEEN 4 AND 8
        )
        SELECT * FROM ksp_paths
        WHERE cost BETWEEN ${targetLoop.expectedLength * 0.8} AND ${targetLoop.expectedLength * 1.2}
        ORDER BY cost ASC;
      `;

      try {
        const result = await this.pgClient.query(query);
        allLoops.push(...result.rows.map(row => ({ ...row, startNode })));
      } catch (error) {
        console.error(`   ❌ Error in KSP for node ${startNode}:`, error);
      }
    }
    
    const matchingLoops = this.findExactMatches(allLoops, targetLoop);
    
    console.log(`   Found ${allLoops.length} total loops`);
    console.log(`   Found ${matchingLoops.length} matching loops`);
    
    if (matchingLoops.length > 0) {
      console.log(`   ✅ SUCCESS! Found exact matches:`);
      matchingLoops.forEach((loop, i) => {
        console.log(`     Loop ${i + 1}: ${loop.cost.toFixed(2)}km, ${loop.edge_count} edges (from node ${loop.startNode})`);
        console.log(`       Path: ${loop.path.join(' → ')}`);
      });
    }
    
    return matchingLoops;
  }

  findExactMatches(loops: any[], targetLoop: TargetLoop): any[] {
    return loops.filter(loop => {
      // Check if the loop contains our target edges
      const hasTargetEdges = targetLoop.expectedEdges.every(edgeId => 
        loop.path.includes(edgeId)
      );
      
      // Check length is close to expected
      const lengthMatch = Math.abs(loop.cost - targetLoop.expectedLength) < 2.0;
      
      // Check edge count is reasonable
      const edgeCountMatch = loop.edge_count >= 4 && loop.edge_count <= 8;
      
      return hasTargetEdges && lengthMatch && edgeCountMatch;
    });
  }

  async testManualLoopConstruction(targetLoop: TargetLoop) {
    console.log('\n🧪 Testing manual loop construction...');
    
    // Try to manually construct the loop by finding connecting paths
    const query = `
      WITH target_edges AS (
        SELECT id, from_node_id, to_node_id, trail_name, length_km
        FROM ${this.schema}.routing_edges 
        WHERE id = ANY($1)
      ),
      connections AS (
        SELECT 
          e1.id as edge1_id,
          e1.trail_name as edge1_name,
          e1.length_km as edge1_length,
          e2.id as edge2_id,
          e2.trail_name as edge2_name,
          e2.length_km as edge2_length,
          e1.to_node_id as connection_node
        FROM target_edges e1
        JOIN target_edges e2 ON e1.to_node_id = e2.from_node_id
        WHERE e1.id != e2.id
      )
      SELECT * FROM connections
      ORDER BY (edge1_length + edge2_length) DESC;
    `;
    
    try {
      const result = await this.pgClient.query(query, [targetLoop.expectedEdges]);
      console.log(`   Found ${result.rows.length} direct connections between target edges`);
      
      if (result.rows.length > 0) {
        result.rows.slice(0, 5).forEach((row, i) => {
          console.log(`     Connection ${i + 1}: ${row.edge1_name} → ${row.edge2_name} (via node ${row.connection_node})`);
          console.log(`       Total length: ${(row.edge1_length + row.edge2_length).toFixed(2)}km`);
        });
      }
      
      return result.rows;
    } catch (error) {
      console.error(`   ❌ Error in manual loop construction:`, error);
      return [];
    }
  }

  async runAllTests() {
    console.log('🚀 Starting Specific Bear Canyon Loop Tests\n');
    
    const targetLoop = await this.initialize();
    const targetEdges = await this.verifyTargetEdges(targetLoop);
    
    const results = {
      targetLoop,
      targetEdges,
      directPath: await this.testDirectPathQuery(targetLoop),
      hawickFiltered: await this.testHawickWithEdgeFilter(targetLoop),
      kspSpecific: await this.testKspFromSpecificNodes(targetLoop),
      manualConstruction: await this.testManualLoopConstruction(targetLoop)
    };

    // Generate report
    await this.generateReport(results);
    
    console.log('\n✅ All specific tests completed!');
    
    return results;
  }

  async generateReport(results: any) {
    const report = {
      timestamp: new Date().toISOString(),
      schema: this.schema,
      targetLoop: results.targetLoop,
      targetEdges: results.targetEdges,
      testResults: {
        directPath: { count: results.directPath.length, success: results.directPath.length > 0 },
        hawickFiltered: { count: results.hawickFiltered.length, success: results.hawickFiltered.length > 0 },
        kspSpecific: { count: results.kspSpecific.length, success: results.kspSpecific.length > 0 },
        manualConstruction: { count: results.manualConstruction.length, success: results.manualConstruction.length > 0 }
      }
    };

    const reportPath = path.join(__dirname, '../test-output/specific-bear-canyon-loop-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`\n📊 Report generated: ${reportPath}`);
    
    // Print summary
    console.log('\n📋 Test Summary:');
    Object.entries(report.testResults).forEach(([test, result]) => {
      const status = result.success ? '✅' : '❌';
      console.log(`   ${status} ${test}: ${result.count} results`);
    });
  }

  async cleanup() {
    await this.pgClient.end();
  }
}

async function main() {
  const tester = new SpecificBearCanyonLoopTester();
  
  try {
    await tester.runAllTests();
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await tester.cleanup();
  }
}

if (require.main === module) {
  main();
}
