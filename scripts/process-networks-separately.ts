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

async function processNetworksSeparately() {
  try {
    await client.connect();
    console.log('🔧 Processing disconnected networks separately...');

    // Load network details
    const networkDetails = JSON.parse(fs.readFileSync('network-details.json', 'utf8'));
    const largeNetworks = networkDetails.filter((n: TrailNetwork) => n.trailCount > 10);
    
    console.log(`Found ${largeNetworks.length} networks with >10 trails`);
    
    // Create a combined table for all processed networks
    await client.query('DROP TABLE IF EXISTS staging_boulder_1754318437837.ways_combined');
    await client.query(`
      CREATE TABLE staging_boulder_1754318437837.ways_combined (
        id SERIAL PRIMARY KEY,
        trail_uuid UUID,
        name TEXT,
        the_geom GEOMETRY(LINESTRING, 4326),
        network_id INTEGER,
        original_id INTEGER
      )
    `);

    let totalProcessed = 0;
    let totalNodes = 0;
    let totalEdges = 0;
    let offset = 0;

    for (const network of largeNetworks) {
      console.log(`\n📊 Processing Network ${network.networkId} (${network.trailCount} trails)...`);
      
      try {
        // Process this network
        const result = await processSingleNetwork(network, offset);
        
        if (result.success) {
          console.log(`  ✅ Success: ${result.trailCount} trails, ${result.nodeCount} nodes, ${result.edgeCount} edges`);
          totalProcessed += result.trailCount;
          totalNodes += result.nodeCount;
          totalEdges += result.edgeCount;
          offset += result.trailCount;
        } else {
          console.log(`  ❌ Failed: ${result.error}`);
        }
        
      } catch (error) {
        console.log(`  ❌ Error processing network ${network.networkId}: ${(error as Error).message}`);
      }
    }

    console.log(`\n🎯 Summary:`);
    console.log(`  Total networks processed: ${largeNetworks.length}`);
    console.log(`  Total trails processed: ${totalProcessed}`);
    console.log(`  Total nodes created: ${totalNodes}`);
    console.log(`  Total edges created: ${totalEdges}`);

    // Create final pgRouting topology
    console.log('\n🔗 Creating final combined topology...');
    await createCombinedTopology();

    // Export results
    await exportCombinedResults();

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

async function processSingleNetwork(network: TrailNetwork, offset: number) {
  // Create temporary table for this network
  const query = `
    CREATE TEMP TABLE ways_network_${network.networkId} AS
    SELECT 
      ROW_NUMBER() OVER (ORDER BY app_uuid) + ${offset} as id,
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
    await client.query(`DROP TABLE IF EXISTS ways_network_${network.networkId}`);
    await client.query(query, [network.trails]);
    
    const countResult = await client.query(`SELECT COUNT(*) as count FROM ways_network_${network.networkId}`);
    const trailCount = parseInt(countResult.rows[0].count);
    
    if (trailCount === 0) {
      return { success: true, trailCount: 0, nodeCount: 0, edgeCount: 0 };
    }

    // Run pgr_nodeNetwork on this network
    await client.query(`SELECT pgr_nodeNetwork('ways_network_${network.networkId}', 0.000001, 'id', 'the_geom')`);
    
    // Get node and edge counts
    const nodeResult = await client.query(`SELECT COUNT(*) as count FROM ways_network_${network.networkId}_noded_vertices_pgr`);
    const edgeResult = await client.query(`SELECT COUNT(*) as count FROM ways_network_${network.networkId}_noded`);
    
    const nodeCount = parseInt(nodeResult.rows[0].count);
    const edgeCount = parseInt(edgeResult.rows[0].count);
    
    // Copy to combined table
    await client.query(`
      INSERT INTO staging_boulder_1754318437837.ways_combined (id, trail_uuid, name, the_geom, network_id, original_id)
      SELECT 
        id,
        trail_uuid,
        name,
        the_geom,
        ${network.networkId} as network_id,
        id as original_id
      FROM ways_network_${network.networkId}_noded
    `);
    
    return { success: true, trailCount, nodeCount, edgeCount };
  } catch (error) {
    return { success: false, trailCount: 0, nodeCount: 0, edgeCount: 0, error: (error as Error).message };
  }
}

async function createCombinedTopology() {
  try {
    // Create final topology from combined table
    await client.query(`SELECT pgr_createTopology('staging_boulder_1754318437837.ways_combined', 0.000001, 'the_geom', 'id')`);
    
    // Analyze the combined graph
    await client.query(`SELECT pgr_analyzeGraph('staging_boulder_1754318437837.ways_combined', 0.000001, 'the_geom', 'id')`);
    
    console.log('  ✅ Combined topology created successfully');
    
    // Get final statistics
    const statsResult = await client.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(DISTINCT network_id) as total_networks
      FROM staging_boulder_1754318437837.ways_combined
    `);
    
    const stats = statsResult.rows[0];
    console.log(`  📊 Final stats: ${stats.total_edges} edges from ${stats.total_networks} networks`);
    
  } catch (error) {
    console.log(`  ❌ Error creating combined topology: ${(error as Error).message}`);
  }
}

async function exportCombinedResults() {
  console.log('\n📁 Exporting combined results...');
  
  try {
    // Export combined network to GeoJSON
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
                'network_id', network_id
              ),
              'geometry', ST_AsGeoJSON(the_geom)::json
            )
          )
        ) as geojson
      FROM staging_boulder_1754318437837.ways_combined
    `;
    
    const result = await client.query(geojsonQuery);
    const geojson = result.rows[0].geojson;
    
    fs.writeFileSync('combined-networks.geojson', JSON.stringify(geojson, null, 2));
    console.log('  ✅ Exported to combined-networks.geojson');
    
    // Export network statistics
    const statsQuery = `
      SELECT 
        network_id,
        COUNT(*) as edge_count,
        COUNT(DISTINCT trail_uuid) as trail_count
      FROM staging_boulder_1754318437837.ways_combined
      GROUP BY network_id
      ORDER BY edge_count DESC
    `;
    
    const statsResult = await client.query(statsQuery);
    const stats = statsResult.rows.map(row => ({
      networkId: row.network_id,
      edgeCount: parseInt(row.edge_count),
      trailCount: parseInt(row.trail_count)
    }));
    
    fs.writeFileSync('combined-network-stats.json', JSON.stringify(stats, null, 2));
    console.log('  ✅ Exported to combined-network-stats.json');
    
  } catch (error) {
    console.log(`  ❌ Error exporting results: ${(error as Error).message}`);
  }
}

processNetworksSeparately(); 