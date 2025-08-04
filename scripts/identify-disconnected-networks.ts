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

async function identifyDisconnectedNetworks() {
  try {
    await client.connect();
    console.log('🔍 Identifying disconnected trail networks...');

    // First, let's create a simple connectivity analysis
    console.log('\n📊 Analyzing trail connectivity...');
    
    // Get all trails with their geometries
    const trailsQuery = `
      SELECT 
        app_uuid,
        name,
        ST_AsText(ST_Centroid(geometry)) as centroid_text,
        ST_X(ST_Centroid(geometry)) as centroid_x,
        ST_Y(ST_Centroid(geometry)) as centroid_y
      FROM staging_boulder_1754318437837.trails 
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
      ORDER BY app_uuid
    `;
    
    const trailsResult = await client.query(trailsQuery);
    const trails = trailsResult.rows;
    
    console.log(`Found ${trails.length} valid trails`);
    
    // Create a simple clustering based on proximity
    const networks = await clusterTrailsByProximity(trails);
    
    console.log(`\n🎯 Identified ${networks.length} disconnected networks:`);
    
    for (let i = 0; i < networks.length; i++) {
      const network = networks[i];
      console.log(`\n  Network ${i + 1}:`);
      console.log(`    Trails: ${network.trailCount}`);
      console.log(`    Bbox: [${network.bbox.join(', ')}]`);
      console.log(`    Centroid: [${network.centroid.join(', ')}]`);
      
      // Test this network with pgr_nodeNetwork
      const testResult = await testNetworkWithPgRouting(network);
      console.log(`    pgr_nodeNetwork: ${testResult.success ? '✅' : '❌'}`);
      
      if (testResult.success) {
        console.log(`    Processed trails: ${testResult.trailCount}`);
      } else {
        console.log(`    Error: ${testResult.error}`);
      }
    }
    
    // Export networks to GeoJSON for visualization
    await exportNetworksToGeoJSON(networks);
    
    // Test combining networks
    console.log('\n🔗 Testing network combinations...');
    await testNetworkCombinations(networks);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

async function clusterTrailsByProximity(trails: any[]): Promise<TrailNetwork[]> {
  const networks: TrailNetwork[] = [];
  const processed = new Set<string>();
  const proximityThreshold = 0.01; // degrees
  
  for (const trail of trails) {
    if (processed.has(trail.app_uuid)) continue;
    
    const network: TrailNetwork = {
      networkId: networks.length + 1,
      trailCount: 0,
      trails: [],
      bbox: [Infinity, Infinity, -Infinity, -Infinity],
      centroid: [0, 0]
    };
    
    // Start a new network with this trail
    const toProcess = [trail];
    let totalX = 0, totalY = 0, count = 0;
    
    while (toProcess.length > 0) {
      const currentTrail = toProcess.pop()!;
      
      if (processed.has(currentTrail.app_uuid)) continue;
      processed.add(currentTrail.app_uuid);
      
      network.trails.push(currentTrail.app_uuid);
      network.trailCount++;
      
      // Update centroid
      totalX += currentTrail.centroid_x;
      totalY += currentTrail.centroid_y;
      count++;
      
      // Update bbox
      network.bbox[0] = Math.min(network.bbox[0], currentTrail.centroid_x);
      network.bbox[1] = Math.min(network.bbox[1], currentTrail.centroid_y);
      network.bbox[2] = Math.max(network.bbox[2], currentTrail.centroid_x);
      network.bbox[3] = Math.max(network.bbox[3], currentTrail.centroid_y);
      
      // Find nearby trails
      for (const otherTrail of trails) {
        if (processed.has(otherTrail.app_uuid)) continue;
        
        const distance = Math.sqrt(
          Math.pow(currentTrail.centroid_x - otherTrail.centroid_x, 2) +
          Math.pow(currentTrail.centroid_y - otherTrail.centroid_y, 2)
        );
        
        if (distance <= proximityThreshold) {
          toProcess.push(otherTrail);
        }
      }
    }
    
    if (network.trailCount > 0) {
      network.centroid = [totalX / count, totalY / count];
      networks.push(network);
    }
  }
  
  // Sort networks by size (largest first)
  networks.sort((a, b) => b.trailCount - a.trailCount);
  
  return networks;
}

async function testNetworkWithPgRouting(network: TrailNetwork) {
  const query = `
    CREATE TEMP TABLE ways_test AS
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
    await client.query('DROP TABLE IF EXISTS ways_test');
    await client.query(query, [network.trails]);
    
    const countResult = await client.query('SELECT COUNT(*) as count FROM ways_test');
    const trailCount = parseInt(countResult.rows[0].count);
    
    if (trailCount === 0) {
      return { success: true, trailCount: 0 };
    }

    await client.query(`SELECT pgr_nodeNetwork('ways_test', 0.000001, 'id', 'the_geom')`);
    
    return { success: true, trailCount };
  } catch (error) {
    return { success: false, trailCount: 0, error: (error as Error).message };
  }
}

async function exportNetworksToGeoJSON(networks: TrailNetwork[]) {
  console.log('\n📁 Exporting networks to GeoJSON...');
  
  const features = networks.map((network, index) => ({
    type: 'Feature',
    properties: {
      networkId: network.networkId,
      trailCount: network.trailCount,
      name: `Network ${network.networkId}`
    },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [network.bbox[0], network.bbox[1]],
        [network.bbox[2], network.bbox[1]],
        [network.bbox[2], network.bbox[3]],
        [network.bbox[0], network.bbox[3]],
        [network.bbox[0], network.bbox[1]]
      ]]
    }
  }));
  
  const geojson = {
    type: 'FeatureCollection',
    features
  };
  
  fs.writeFileSync('disconnected-networks.geojson', JSON.stringify(geojson, null, 2));
  console.log('  ✅ Exported to disconnected-networks.geojson');
  
  // Export detailed network info
  const networkInfo = networks.map(network => ({
    networkId: network.networkId,
    trailCount: network.trailCount,
    trails: network.trails,
    bbox: network.bbox,
    centroid: network.centroid
  }));
  
  fs.writeFileSync('network-details.json', JSON.stringify(networkInfo, null, 2));
  console.log('  ✅ Exported to network-details.json');
}

async function testNetworkCombinations(networks: TrailNetwork[]) {
  console.log('\n🧪 Testing network combinations...');
  
  // Test combining the largest networks
  const largeNetworks = networks.filter(n => n.trailCount > 100);
  console.log(`Found ${largeNetworks.length} large networks (>100 trails)`);
  
  for (let i = 0; i < largeNetworks.length; i++) {
    for (let j = i + 1; j < largeNetworks.length; j++) {
      const network1 = largeNetworks[i];
      const network2 = largeNetworks[j];
      
      const combinedTrails = [...network1.trails, ...network2.trails];
      const result = await testNetworkWithPgRouting({
        networkId: 0,
        trailCount: network1.trailCount + network2.trailCount,
        trails: combinedTrails,
        bbox: [],
        centroid: []
      });
      
      console.log(`  Network ${network1.networkId} + ${network2.networkId}: ${result.success ? '✅' : '❌'} (${result.trailCount} trails)`);
      
      if (!result.success) {
        console.log(`    Error: ${result.error}`);
      }
    }
  }
}

identifyDisconnectedNetworks(); 