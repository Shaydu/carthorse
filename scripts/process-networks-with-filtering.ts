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
  method: 'nodeNetwork' | 'createTopology';
  error?: string;
}

async function processNetworksWithFiltering() {
  try {
    await client.connect();
    console.log('🔧 Processing networks with geometry filtering...');

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
        // Process this network with filtering
        const result = await processSingleNetworkWithFiltering(network);
        processedNetworks.push(result);
        
        if (result.success) {
          console.log(`  ✅ Success (${result.method}): ${result.trailCount} trails, ${result.nodeCount} nodes, ${result.edgeCount} edges`);
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
    console.log(`  nodeNetwork method: ${processedNetworks.filter(n => n.success && n.method === 'nodeNetwork').length}`);
    console.log(`  createTopology method: ${processedNetworks.filter(n => n.success && n.method === 'createTopology').length}`);
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

async function processSingleNetworkWithFiltering(network: TrailNetwork): Promise<ProcessedNetwork> {
  const tableName = `ways_network_${network.networkId}`;
  
  // Create table for this network with geometry filtering
  const query = `
    CREATE TABLE staging_boulder_1754318437837.${tableName} AS
    SELECT 
      ROW_NUMBER() OVER (ORDER BY app_uuid) as id,
      app_uuid as trail_uuid,
      name,
      CASE
        WHEN ST_IsSimple(geometry) THEN ST_Force2D(ST_Force2D(geometry))
        ELSE ST_Force2D(ST_Force2D(geometry))
      END as the_geom
    FROM staging_boulder_1754318437837.trails 
    WHERE app_uuid = ANY($1)
      AND geometry IS NOT NULL 
      AND ST_IsValid(geometry)
      AND ST_IsSimple(geometry)  -- Filter out loops and self-intersections
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
        success: true,
        method: 'createTopology'
      };
    }

    // Try pgr_nodeNetwork first
    try {
      await client.query(`SELECT pgr_nodeNetwork('staging_boulder_1754318437837.${tableName}', 0.000001, 'id', 'the_geom')`);
      
      // Get node and edge counts
      const nodeResult = await client.query(`SELECT COUNT(*) as count FROM staging_boulder_1754318437837.${tableName}_noded_vertices_pgr`);
      const edgeResult = await client.query(`SELECT COUNT(*) as count FROM staging_boulder_1754318437837.${tableName}_noded`);
      
      const nodeCount = parseInt(nodeResult.rows[0].count);
      const edgeCount = parseInt(edgeResult.rows[0].count);
      
      // Add routing attributes
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
        success: true,
        method: 'nodeNetwork'
      };
      
    } catch (nodeNetworkError) {
      console.log(`    ⚠️  pgr_nodeNetwork failed, trying pgr_createTopology...`);
      
      // Fallback to pgr_createTopology
      await client.query(`SELECT pgr_createTopology('staging_boulder_1754318437837.${tableName}', 0.000001, 'the_geom', 'id')`);
      
      // Get node and edge counts
      const nodeResult = await client.query(`SELECT COUNT(*) as count FROM staging_boulder_1754318437837.${tableName}_vertices_pgr`);
      const edgeResult = await client.query(`SELECT COUNT(*) as count FROM staging_boulder_1754318437837.${tableName}`);
      
      const nodeCount = parseInt(nodeResult.rows[0].count);
      const edgeCount = parseInt(edgeResult.rows[0].count);
      
      // Add routing attributes
      await client.query(`
        ALTER TABLE staging_boulder_1754318437837.${tableName} 
        ADD COLUMN IF NOT EXISTS cost DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS reverse_cost DOUBLE PRECISION
      `);
      
      await client.query(`
        UPDATE staging_boulder_1754318437837.${tableName} 
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
        success: true,
        method: 'createTopology'
      };
    }
    
  } catch (error) {
    return {
      networkId: network.networkId,
      trailCount: 0,
      nodeCount: 0,
      edgeCount: 0,
      tableName,
      success: false,
      method: 'createTopology',
      error: (error as Error).message
    };
  }
}

async function testRoutingOnNetworks(networks: ProcessedNetwork[]) {
  console.log(`\n🧪 Testing routing on ${networks.length} networks...`);
  
  for (const network of networks) {
    try {
      console.log(`\n  Testing Network ${network.networkId} (${network.tableName}, ${network.method})...`);
      
      // Get sample nodes from this network
      const tableSuffix = network.method === 'nodeNetwork' ? '_noded' : '';
      const verticesSuffix = network.method === 'nodeNetwork' ? '_noded_vertices_pgr' : '_vertices_pgr';
      
      const sampleNodes = await client.query(`
        SELECT DISTINCT source 
        FROM staging_boulder_1754318437837.${network.tableName}${tableSuffix}
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
            'SELECT id, source, target, cost, reverse_cost FROM staging_boulder_1754318437837.${network.tableName}${tableSuffix}',
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
      const tableSuffix = network.method === 'nodeNetwork' ? '_noded' : '';
      
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
                  'network_id', ${network.networkId},
                  'method', '${network.method}'
                ),
                'geometry', ST_AsGeoJSON(the_geom)::json
              )
            )
          ) as geojson
        FROM staging_boulder_1754318437837.${network.tableName}${tableSuffix}
      `;
      
      const result = await client.query(geojsonQuery);
      const geojson = result.rows[0].geojson;
      
      fs.writeFileSync(`network-${network.networkId}-${network.method}.geojson`, JSON.stringify(geojson, null, 2));
      console.log(`  ✅ Exported network ${network.networkId} (${network.method}) to network-${network.networkId}-${network.method}.geojson`);
    }
    
    // Export network statistics
    const stats = networks.map(network => ({
      networkId: network.networkId,
      tableName: network.tableName,
      success: network.success,
      method: network.method,
      trailCount: network.trailCount,
      nodeCount: network.nodeCount,
      edgeCount: network.edgeCount,
      error: network.error
    }));
    
    fs.writeFileSync('network-processing-stats-filtered.json', JSON.stringify(stats, null, 2));
    console.log('  ✅ Exported to network-processing-stats-filtered.json');
    
  } catch (error) {
    console.log(`  ❌ Error exporting results: ${(error as Error).message}`);
  }
}

processNetworksWithFiltering(); 