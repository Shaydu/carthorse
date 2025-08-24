#!/usr/bin/env ts-node

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

interface TestConfig {
  name: string;
  description: string;
  hawickMaxRows?: number;
  useHawickCircuits?: boolean;
  useKspForLoops?: boolean;
  kspLoopsPerNode?: number;
  targetRoutesPerPattern?: number;
  dedupeThreshold?: number;
  maxRouteLengthKm?: number;
  minRouteLengthKm?: number;
}

class BearCanyonLoopTester {
  private pgClient: Pool;
  private schema: string;

  constructor() {
    this.pgClient = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'trail_master_db',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    });

    // Get the latest schema
    this.schema = 'carthorse_1755987460014'; // Update this to the latest schema
  }

  async initialize() {
    console.log('🔧 Initializing Bear Canyon Loop Tester...');
    
    // Verify the target trails exist
    const targetTrails = await this.verifyTargetTrails();
    console.log(`✅ Found ${targetTrails.length} target trails`);
    
    return targetTrails;
  }

  async verifyTargetTrails() {
    const query = `
      SELECT id, from_node_id, to_node_id, trail_name, length_km 
      FROM ${this.schema}.routing_edges 
      WHERE trail_name ILIKE '%Bear Canyon%' 
         OR trail_name ILIKE '%Bear Peak West Ridge%' 
         OR trail_name ILIKE '%Fern Canyon%' 
         OR trail_name ILIKE '%Mesa Trail%'
      ORDER BY trail_name, id;
    `;
    
    const result = await this.pgClient.query(query);
    return result.rows;
  }

  async testHawickCircuits(config: TestConfig) {
    console.log(`\n🧪 Testing Hawick Circuits: ${config.name}`);
    console.log(`   ${config.description}`);
    
    const query = `
      SELECT 
        row_number() OVER () as circuit_id,
        path,
        cost,
        ST_Length(ST_LineMerge(ST_Collect(geometry))) / 1000.0 as length_km
      FROM pgr_hawickCircuits(
        'SELECT id, from_node_id as source, to_node_id as target, length_km as cost 
         FROM ${this.schema}.routing_edges 
         WHERE length_km > 0',
        directed := false
      ) 
      WHERE array_length(path, 1) > 3
      ORDER BY cost ASC
      LIMIT ${config.hawickMaxRows || 1000};
    `;

    try {
      const result = await this.pgClient.query(query);
      const matchingLoops = this.findMatchingLoops(result.rows, config);
      
      console.log(`   Found ${result.rows.length} total loops`);
      console.log(`   Found ${matchingLoops.length} matching loops`);
      
      if (matchingLoops.length > 0) {
        console.log(`   ✅ SUCCESS! Found matching loops:`);
        matchingLoops.forEach((loop, i) => {
          console.log(`      Loop ${i + 1}: ${loop.length_km.toFixed(2)}km, ${loop.path.length} edges`);
        });
      } else {
        console.log(`   ❌ No matching loops found`);
      }
      
      return matchingLoops;
    } catch (error) {
      console.error(`   ❌ Error in Hawick Circuits:`, error);
      return [];
    }
  }

  async testKspLoops(config: TestConfig) {
    console.log(`\n🧪 Testing KSP Loops: ${config.name}`);
    console.log(`   ${config.description}`);
    
    // Get starting nodes for the target trails
    const startNodes = await this.getStartingNodes();
    
    let allLoops: any[] = [];
    
    for (const startNode of startNodes.slice(0, 5)) { // Test first 5 nodes
      const query = `
        WITH ksp_paths AS (
          SELECT 
            path,
            cost,
            ST_Length(ST_LineMerge(ST_Collect(geometry))) / 1000.0 as length_km
          FROM pgr_ksp(
            'SELECT id, from_node_id as source, to_node_id as target, length_km as cost 
             FROM ${this.schema}.routing_edges 
             WHERE length_km > 0',
            ${startNode}, ${startNode}, 
            ${config.kspLoopsPerNode || 3},
            directed := false
          )
          WHERE array_length(path, 1) > 3
        )
        SELECT * FROM ksp_paths
        WHERE length_km BETWEEN ${config.minRouteLengthKm || 5} AND ${config.maxRouteLengthKm || 15}
        ORDER BY cost ASC;
      `;

      try {
        const result = await this.pgClient.query(query);
        allLoops.push(...result.rows);
      } catch (error) {
        console.error(`   ❌ Error in KSP for node ${startNode}:`, error);
      }
    }
    
    const matchingLoops = this.findMatchingLoops(allLoops, config);
    
    console.log(`   Found ${allLoops.length} total loops`);
    console.log(`   Found ${matchingLoops.length} matching loops`);
    
    if (matchingLoops.length > 0) {
      console.log(`   ✅ SUCCESS! Found matching loops:`);
      matchingLoops.forEach((loop, i) => {
        console.log(`      Loop ${i + 1}: ${loop.length_km.toFixed(2)}km, ${loop.path.length} edges`);
      });
    } else {
      console.log(`   ❌ No matching loops found`);
    }
    
    return matchingLoops;
  }

  async getStartingNodes(): Promise<number[]> {
    const query = `
      SELECT DISTINCT from_node_id as node_id
      FROM ${this.schema}.routing_edges 
      WHERE trail_name ILIKE '%Bear Canyon%' 
         OR trail_name ILIKE '%Bear Peak West Ridge%' 
         OR trail_name ILIKE '%Fern Canyon%' 
         OR trail_name ILIKE '%Mesa Trail%'
      ORDER BY node_id;
    `;
    
    const result = await this.pgClient.query(query);
    return result.rows.map(row => row.node_id);
  }

  findMatchingLoops(loops: any[], config: TestConfig): any[] {
    return loops.filter(loop => {
      // Check if loop contains target trails
      const hasBearCanyon = this.loopContainsTrail(loop, 'Bear Canyon');
      const hasBearPeak = this.loopContainsTrail(loop, 'Bear Peak West Ridge');
      const hasFernCanyon = this.loopContainsTrail(loop, 'Fern Canyon');
      const hasMesaTrail = this.loopContainsTrail(loop, 'Mesa Trail');
      
      // Check length constraints
      const lengthOk = loop.length_km >= (config.minRouteLengthKm || 5) && 
                      loop.length_km <= (config.maxRouteLengthKm || 15);
      
      // Must have at least 3 of the 4 target trails
      const trailCount = [hasBearCanyon, hasBearPeak, hasFernCanyon, hasMesaTrail]
                        .filter(Boolean).length;
      
      return trailCount >= 3 && lengthOk;
    });
  }

  loopContainsTrail(loop: any, trailName: string): boolean {
    // This is a simplified check - in practice you'd need to query the actual edges
    return loop.path && loop.path.some((edgeId: number) => {
      // You'd need to map edge IDs to trail names
      return true; // Placeholder
    });
  }

  async runAllTests() {
    console.log('🚀 Starting Bear Canyon Loop Generation Tests\n');
    
    const testConfigs: TestConfig[] = [
      {
        name: 'Default Hawick',
        description: 'Standard Hawick circuits with default parameters',
        hawickMaxRows: 1000,
        useHawickCircuits: true,
        maxRouteLengthKm: 15,
        minRouteLengthKm: 5
      },
      {
        name: 'High Hawick Rows',
        description: 'Hawick circuits with increased max rows',
        hawickMaxRows: 10000,
        useHawickCircuits: true,
        maxRouteLengthKm: 15,
        minRouteLengthKm: 5
      },
      {
        name: 'KSP Loops',
        description: 'KSP algorithm for loop generation',
        useKspForLoops: true,
        kspLoopsPerNode: 5,
        maxRouteLengthKm: 15,
        minRouteLengthKm: 5
      },
      {
        name: 'KSP High Count',
        description: 'KSP with higher loop count per node',
        useKspForLoops: true,
        kspLoopsPerNode: 10,
        maxRouteLengthKm: 15,
        minRouteLengthKm: 5
      },
      {
        name: 'Short Loop Focus',
        description: 'Focused on shorter loops (8-12km)',
        hawickMaxRows: 5000,
        useHawickCircuits: true,
        maxRouteLengthKm: 12,
        minRouteLengthKm: 8
      },
      {
        name: 'Bear Canyon Specific',
        description: 'Very specific length range for Bear Canyon loop',
        hawickMaxRows: 2000,
        useHawickCircuits: true,
        maxRouteLengthKm: 10,
        minRouteLengthKm: 9
      }
    ];

    const results: any[] = [];

    for (const config of testConfigs) {
      let testResults: any[] = [];
      
      if (config.useHawickCircuits) {
        testResults = await this.testHawickCircuits(config);
      } else if (config.useKspForLoops) {
        testResults = await this.testKspLoops(config);
      }
      
      results.push({
        config,
        results: testResults,
        success: testResults.length > 0
      });
    }

    // Generate report
    await this.generateReport(results);
    
    console.log('\n✅ All tests completed!');
  }

  async generateReport(results: any[]) {
    const report = {
      timestamp: new Date().toISOString(),
      schema: this.schema,
      totalTests: results.length,
      successfulTests: results.filter(r => r.success).length,
      results: results.map(r => ({
        config: r.config,
        success: r.success,
        loopCount: r.results.length
      }))
    };

    const reportPath = path.join(__dirname, '../test-output/bear-canyon-loop-test-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`\n📊 Report generated: ${reportPath}`);
    
    // Print summary
    console.log('\n📋 Test Summary:');
    results.forEach((result, i) => {
      const status = result.success ? '✅' : '❌';
      console.log(`   ${status} ${result.config.name}: ${result.results.length} loops found`);
    });
  }

  async cleanup() {
    await this.pgClient.end();
  }
}

async function main() {
  const tester = new BearCanyonLoopTester();
  
  try {
    await tester.initialize();
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

