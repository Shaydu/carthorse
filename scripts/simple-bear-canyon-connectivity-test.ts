#!/usr/bin/env ts-node

import { Pool } from 'pg';

class SimpleBearCanyonConnectivityTest {
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

  async testConnectivity() {
    console.log('🔍 Testing Bear Canyon Loop Connectivity\n');

    // 1. Check if the target edges exist and their properties
    console.log('1. Target Edges:');
    const targetEdges = await this.pgClient.query(`
      SELECT id, from_node_id, to_node_id, trail_name, length_km, elevation_gain
      FROM ${this.schema}.routing_edges 
      WHERE id IN (81, 123, 159, 25, 54)
      ORDER BY id;
    `);
    
    targetEdges.rows.forEach(edge => {
      console.log(`   Edge ${edge.id}: ${edge.trail_name} (${edge.from_node_id}→${edge.to_node_id}, ${edge.length_km}km)`);
    });

    // 2. Check if there are any existing loops that contain these edges
    console.log('\n2. Existing Loops with Target Edges:');
    const existingLoops = await this.pgClient.query(`
      SELECT route_uuid, route_name, recommended_length_km, jsonb_array_length(route_edges::jsonb) as edge_count
      FROM ${this.schema}.route_recommendations 
      WHERE route_shape = 'loop' 
        AND (route_edges::text ILIKE '%Bear Canyon Trail%' 
             OR route_edges::text ILIKE '%Bear Peak West Ridge Trail%' 
             OR route_edges::text ILIKE '%Fern Canyon Trail%')
      ORDER BY recommended_length_km;
    `);
    
    console.log(`   Found ${existingLoops.rows.length} existing loops with target trails`);
    existingLoops.rows.forEach(loop => {
      console.log(`   - ${loop.route_name}: ${loop.recommended_length_km}km, ${loop.edge_count} edges`);
    });

    // 3. Check node connectivity
    console.log('\n3. Node Connectivity Analysis:');
    const nodes = [341, 358, 335, 338, 334, 359, 356];
    
    for (const node of nodes) {
      const connections = await this.pgClient.query(`
        SELECT id, from_node_id, to_node_id, trail_name, length_km
        FROM ${this.schema}.routing_edges 
        WHERE from_node_id = $1 OR to_node_id = $1
        ORDER BY length_km DESC;
      `, [node]);
      
      console.log(`   Node ${node} has ${connections.rows.length} connections:`);
      connections.rows.slice(0, 3).forEach(conn => {
        const direction = conn.from_node_id === node ? '→' : '←';
        const otherNode = conn.from_node_id === node ? conn.to_node_id : conn.from_node_id;
        console.log(`     ${direction} ${otherNode} via ${conn.trail_name} (${conn.length_km}km)`);
      });
    }

    // 4. Check if the specific loop path is possible
    console.log('\n4. Specific Loop Path Analysis:');
    
    // Check Bear Canyon (341→358) to Bear Peak West Ridge (341→335)
    const bearCanyonToBearPeak = await this.pgClient.query(`
      SELECT COUNT(*) as connection_count
      FROM ${this.schema}.routing_edges e1
      JOIN ${this.schema}.routing_edges e2 ON e1.to_node_id = e2.from_node_id
      WHERE e1.id = 81 AND e2.id = 123;
    `);
    
    console.log(`   Bear Canyon → Bear Peak West Ridge: ${bearCanyonToBearPeak.rows[0].connection_count > 0 ? '✅ Connected' : '❌ Not directly connected'}`);
    
    // Check Bear Peak West Ridge (341→335) to Fern Canyon (338→334)
    const bearPeakToFernCanyon = await this.pgClient.query(`
      SELECT COUNT(*) as connection_count
      FROM ${this.schema}.routing_edges e1
      JOIN ${this.schema}.routing_edges e2 ON e1.to_node_id = e2.from_node_id
      WHERE e1.id = 123 AND e2.id = 159;
    `);
    
    console.log(`   Bear Peak West Ridge → Fern Canyon: ${bearPeakToFernCanyon.rows[0].connection_count > 0 ? '✅ Connected' : '❌ Not directly connected'}`);

    // 5. Check what connects these nodes
    console.log('\n5. Missing Connections:');
    
    // Check what connects 335 to 338
    const connections335to338 = await this.pgClient.query(`
      SELECT id, from_node_id, to_node_id, trail_name, length_km
      FROM ${this.schema}.routing_edges 
      WHERE (from_node_id = 335 AND to_node_id = 338) 
         OR (from_node_id = 338 AND to_node_id = 335);
    `);
    
    if (connections335to338.rows.length > 0) {
      console.log(`   ✅ Found connection from 335 to 338:`);
      connections335to338.rows.forEach(conn => {
        console.log(`     Edge ${conn.id}: ${conn.trail_name} (${conn.length_km}km)`);
      });
    } else {
      console.log(`   ❌ No direct connection from 335 to 338`);
    }

    // Check what connects 334 to 356
    const connections334to356 = await this.pgClient.query(`
      SELECT id, from_node_id, to_node_id, trail_name, length_km
      FROM ${this.schema}.routing_edges 
      WHERE (from_node_id = 334 AND to_node_id = 356) 
         OR (from_node_id = 356 AND to_node_id = 334);
    `);
    
    if (connections334to356.rows.length > 0) {
      console.log(`   ✅ Found connection from 334 to 356:`);
      connections334to356.rows.forEach(conn => {
        console.log(`     Edge ${conn.id}: ${conn.trail_name} (${conn.length_km}km)`);
      });
    } else {
      console.log(`   ❌ No direct connection from 334 to 356`);
    }

    // 6. Check if there's a path through intermediate nodes
    console.log('\n6. Path Through Intermediate Nodes:');
    
    // Check path from 335 to 338 through any intermediate node
    const path335to338 = await this.pgClient.query(`
      WITH path AS (
        SELECT 
          e1.id as edge1_id,
          e1.trail_name as edge1_name,
          e1.length_km as edge1_length,
          e2.id as edge2_id,
          e2.trail_name as edge2_name,
          e2.length_km as edge2_length,
          e1.to_node_id as intermediate_node
        FROM ${this.schema}.routing_edges e1
        JOIN ${this.schema}.routing_edges e2 ON e1.to_node_id = e2.from_node_id
        WHERE e1.from_node_id = 335 AND e2.to_node_id = 338
      )
      SELECT * FROM path
      ORDER BY (edge1_length + edge2_length) ASC
      LIMIT 5;
    `);
    
    if (path335to338.rows.length > 0) {
      console.log(`   ✅ Found path from 335 to 338 through intermediate nodes:`);
      path335to338.rows.forEach(path => {
        console.log(`     ${path.edge1_name} → ${path.edge2_name} (via node ${path.intermediate_node}, total ${(path.edge1_length + path.edge2_length).toFixed(2)}km)`);
      });
    } else {
      console.log(`   ❌ No path found from 335 to 338 through intermediate nodes`);
    }

    // 7. Calculate the actual loop length if all connections exist
    console.log('\n7. Potential Loop Analysis:');
    
    const totalLength = targetEdges.rows.reduce((sum, edge) => sum + parseFloat(edge.length_km), 0);
    console.log(`   Total length of target edges: ${totalLength.toFixed(2)}km`);
    
    // Add any missing connector lengths
    let connectorLength = 0;
    if (connections335to338.rows.length > 0) {
      connectorLength += connections335to338.rows[0].length_km;
    }
    if (connections334to356.rows.length > 0) {
      connectorLength += connections334to356.rows[0].length_km;
    }
    
    if (connectorLength > 0) {
      console.log(`   Additional connector length: ${connectorLength.toFixed(2)}km`);
      console.log(`   Total loop length: ${(totalLength + connectorLength).toFixed(2)}km`);
    }

    await this.pgClient.end();
  }
}

async function main() {
  const tester = new SimpleBearCanyonConnectivityTest();
  await tester.testConnectivity();
}

if (require.main === module) {
  main();
}

