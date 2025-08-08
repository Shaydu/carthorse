#!/usr/bin/env ts-node

import { Client } from 'pg';
import * as fs from 'fs';

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu'
});

interface TrailNetwork {
  networkId: number;
  trailCount: number;
  trails: string[];
  bbox: number[];
  centroid: number[];
}

interface ProcessedNetwork {
  networkId: number;
  trailCount: number;
  nodeCount: number;
  edgeCount: number;
  tableName: string;
  success: boolean;
  error?: string;
}

async function processNetworksIndependently() {
  try {
    await client.connect();
    console.log('🔧 Processing networks independently...');

    // Load network details
    const networkDetails = JSON.parse(fs.readFileSync('network-details.json', 'utf8'));
    const largeNetworks = networkDetails.filter((n: TrailNetwork) => n.trailCount > 10);
    
    console.log(`Found ${largeNetworks.length} networks with >10 trails`);
    
    const processedNetworks: ProcessedNetwork[] = [];
    let totalProcessed = 0;
    let totalNodes = 0;
    let totalEdges = 0;

    for (const network of largeNetworks) {
      console.log(`\n📊 Processing Network ${network.networkId} (${network.trailCount} trails)...`);
      
      try {
        // Process this network independently
        const result = await processSingleNetwork(network);
        processedNetworks.push(result);
        
        if (result.success) {
          console.log(`  ✅ Success: ${result.trailCount} trails, ${result.nodeCount} nodes, ${result.edgeCount} edges`);
          totalProcessed += result.trailCount;
          totalNodes += result.nodeCount;
          totalEdges += result.edgeCount;
        } else {
          console.log(`  ❌ Failed: ${result.error}`);
        }
        
      } catch (error) {
        console.log(`  ❌ Error processing network ${network.networkId}: ${(error as Error).message}`);
      }
    }

    console.log(`\n🎯 Summary:`);
    console.log(`  Total networks processed: ${largeNetworks.length}`);
    console.log(`  Successful networks: ${processedNetworks.filter(n => n.success).length}`);
    console.log(`  Total trails processed: ${totalProcessed}`);
    console.log(`  Total nodes created: ${totalNodes}`);
    console.log(`  Total edges created: ${totalEdges}`);

    // Test routing on each successful network
    console.log('\n🧪 Testing routing on each network...');
    await testRoutingOnNetworks(processedNetworks.filter(n => n.success));

    // Export results
    await exportNetworkResults(processedNetworks);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

async function processSingleNetwork(network: TrailNetwork): Promise<ProcessedNetwork> {
  const tableName = `ways_network_${network.networkId}`;
  
  // Create table for this network in the staging schema
  const query = `
    CREATE TABLE staging_boulder_1754318437837.${tableName} AS
    SELECT 
      ROW_NUMBER() OVER (ORDER BY app_uuid) as id,
      app_uuid as trail_uuid,
      name,
      CASE
        WHEN ST_IsSimple(geometry) THEN ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
        ELSE ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
      END as the_geom
    FROM staging_boulder_1754318437837.trails 
    WHERE app_uuid = ANY($1)
  `;

  try {
    await client.query(`DROP TABLE IF EXISTS staging_boulder_1754318437837.${tableName}`);
    await client.query(query, [network.trails]);
    
    const countResult = await client.query(`SELECT COUNT(*) as count FROM staging_boulder_1754318437837.${tableName}`);
    const trailCount = parseInt(countResult.rows[0].count);
    
    if (trailCount === 0) {
      return {
        networkId: network.networkId,
        trailCount: 0,
        nodeCount: 0,
        edgeCount: 0,
        tableName,
        success: true
      };
    }

    // Run pgr_nodeNetwork on this network
    await client.query(`SELECT pgr_nodeNetwork('staging_boulder_1754318437837.${tableName}', 0.000001, 'id', 'the_geom')`);
    
    // Get node and edge counts
    const nodeResult = await client.query(`SELECT COUNT(*) as count FROM staging_boulder_1754318437837.${tableName}_noded_vertices_pgr`);
    const edgeResult = await client.query(`SELECT COUNT(*) as count FROM staging_boulder_1754318437837.${tableName}_noded`);
    
    const nodeCount = parseInt(nodeResult.rows[0].count);
    const edgeCount = parseInt(edgeResult.rows[0].count);
    
    // Add routing attributes to the noded table
    await client.query(`
      ALTER TABLE staging_boulder_1754318437837.${tableName}_noded 
      ADD COLUMN IF NOT EXISTS cost DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS reverse_cost DOUBLE PRECISION
    `);
    
    await client.query(`
      UPDATE staging_boulder_1754318437837.${tableName}_noded 
      SET 
        cost = ST_Length(the_geom::geography) / 1000.0,
        reverse_cost = ST_Length(the_geom::geography) / 1000.0
    `);
    
    return {
      networkId: network.networkId,
      trailCount,
      nodeCount,
      edgeCount,
      tableName,
      success: true
    };
  } catch (error) {
    return {
      networkId: network.networkId,
      trailCount: 0,
      nodeCount: 0,
      edgeCount: 0,
      tableName,
      success: false,
      error: (error as Error).message
    };
  }
}

async function testRoutingOnNetworks(networks: ProcessedNetwork[]) {
  console.log(`\n🧪 Testing routing on ${networks.length} networks...`);
  
  for (const network of networks) {
    try {
      console.log(`\n  Testing Network ${network.networkId} (${network.tableName})...`);
      
      // Get sample nodes from this network
      const sampleNodes = await client.query(`
        SELECT DISTINCT source 
        FROM staging_boulder_1754318437837.${network.tableName}_noded 
        WHERE source IS NOT NULL 
        ORDER BY source 
        LIMIT 5
      `);
      
      if (sampleNodes.rows.length > 1) {
        const startNode = sampleNodes.rows[0].source;
        const endNode = sampleNodes.rows[sampleNodes.rows.length - 1].source;
        
        console.log(`    Testing route from node ${startNode} to node ${endNode}...`);
        
        const routeResult = await client.query(`
          SELECT 
            seq,
            node,
            edge,
            cost,
            agg_cost
          FROM pgr_dijkstra(
            'SELECT id, source, target, cost, reverse_cost FROM staging_boulder_1754318437837.${network.tableName}_noded',
            ${startNode}, ${endNode}, false
          )
        `);
        
        if (routeResult.rows.length > 0) {
          console.log(`    ✅ Route found with ${routeResult.rows.length} segments, total cost: ${routeResult.rows[routeResult.rows.length - 1].agg_cost}`);
        } else {
          console.log(`    ⚠️  No route found`);
        }
      } else {
        console.log(`    ⚠️  Not enough nodes for routing test`);
      }
      
    } catch (error) {
      console.log(`    ❌ Error testing routing: ${(error as Error).message}`);
    }
  }
}

async function exportNetworkResults(networks: ProcessedNetwork[]) {
  console.log('\n📁 Exporting network results...');
  
  try {
    // Export successful networks to GeoJSON
    const successfulNetworks = networks.filter(n => n.success);
    
    for (const network of successfulNetworks) {
      const geojsonQuery = `
        SELECT 
          json_build_object(
            'type', 'FeatureCollection',
            'features', json_agg(
              json_build_object(
                'type', 'Feature',
                'properties', json_build_object(
                  'id', id,
                  'trail_uuid', trail_uuid,
                  'name', name,
                  'source', source,
                  'target', target,
                  'cost', cost,
                  'network_id', ${network.networkId}
                ),
                'geometry', ST_AsGeoJSON(the_geom)::json
              )
            )
          ) as geojson
        FROM staging_boulder_1754318437837.${network.tableName}_noded
      `;
      
      const result = await client.query(geojsonQuery);
      const geojson = result.rows[0].geojson;
      
      fs.writeFileSync(`network-${network.networkId}.geojson`, JSON.stringify(geojson, null, 2));
      console.log(`  ✅ Exported network ${network.networkId} to network-${network.networkId}.geojson`);
    }
    
    // Export network statistics
    const stats = networks.map(network => ({
      networkId: network.networkId,
      tableName: network.tableName,
      success: network.success,
      trailCount: network.trailCount,
      nodeCount: network.nodeCount,
      edgeCount: network.edgeCount,
      error: network.error
    }));
    
    fs.writeFileSync('network-processing-stats.json', JSON.stringify(stats, null, 2));
    console.log('  ✅ Exported to network-processing-stats.json');
    
    // Create a summary of all networks for routing
    await createRoutingSummary(successfulNetworks);
    
  } catch (error) {
    console.log(`  ❌ Error exporting results: ${(error as Error).message}`);
  }
}

async function createRoutingSummary(networks: ProcessedNetwork[]) {
  console.log('\n📋 Creating routing summary...');
  
  try {
    // Create a summary table with all networks
    await client.query('DROP TABLE IF EXISTS staging_boulder_1754318437837.routing_networks_summary');
    await client.query(`
      CREATE TABLE staging_boulder_1754318437837.routing_networks_summary (
        network_id INTEGER PRIMARY KEY,
        table_name TEXT,
        trail_count INTEGER,
        node_count INTEGER,
        edge_count INTEGER,
        bbox_min_x DOUBLE PRECISION,
        bbox_min_y DOUBLE PRECISION,
        bbox_max_x DOUBLE PRECISION,
        bbox_max_y DOUBLE PRECISION
      )
    `);
    
    for (const network of networks) {
      // Get bbox for this network
      const bboxResult = await client.query(`
        SELECT 
          ST_XMin(ST_Collect(the_geom)) as min_x,
          ST_YMin(ST_Collect(the_geom)) as min_y,
          ST_XMax(ST_Collect(the_geom)) as max_x,
          ST_YMax(ST_Collect(the_geom)) as max_y
        FROM staging_boulder_1754318437837.${network.tableName}_noded
      `);
      
      const bbox = bboxResult.rows[0];
      
      await client.query(`
        INSERT INTO staging_boulder_1754318437837.routing_networks_summary 
        (network_id, table_name, trail_count, node_count, edge_count, bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        network.networkId,
        network.tableName,
        network.trailCount,
        network.nodeCount,
        network.edgeCount,
        bbox.min_x,
        bbox.min_y,
        bbox.max_x,
        bbox.max_y
      ]);
    }
    
    console.log(`  ✅ Created routing summary with ${networks.length} networks`);
    
    // Export summary to JSON
    const summaryResult = await client.query(`
      SELECT * FROM staging_boulder_1754318437837.routing_networks_summary 
      ORDER BY trail_count DESC
    `);
    
    fs.writeFileSync('routing-networks-summary.json', JSON.stringify(summaryResult.rows, null, 2));
    console.log('  ✅ Exported to routing-networks-summary.json');
    
  } catch (error) {
    console.log(`  ❌ Error creating routing summary: ${(error as Error).message}`);
  }
}

processNetworksIndependently(); 