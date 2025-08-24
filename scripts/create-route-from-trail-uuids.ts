#!/usr/bin/env ts-node

import { Pool } from 'pg';

interface TrailSegment {
  id: string;
  name: string;
  original_trail_uuid: string;
  source_identifier: string;
  trail_type: string;
  surface_type?: string;
  difficulty?: string;
  length_km?: number;
  elevation_gain?: number;
  elevation_loss?: number;
  max_elevation?: number;
  min_elevation?: number;
  avg_elevation?: number;
}

async function createRouteFromTrailUUIDs() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu'
  });

  // The trail UUIDs that make up the classic Bear Canyon loop
  const trailUUIDs = [
    'c5e9a580-ea67-43ff-8480-114229b0e2c9', // Fern Canyon Trail Segment
    '2181c8f2-2252-4214-ab94-4601603c6e0a', // Bear Peak West Ridge Trail Segment  
    'de85d01b-0c71-4005-b6b3-57af1169e411', // Bear Canyon Trail Segment
    '4e34d9a7-4cf7-40cb-bde4-15101815f7f0', // Mesa Trail (Split 1) (Split 1) Segment
    '68bbbab4-39f4-438e-b479-efbbfe604330'  // Fern Canyon Trail Segment (second one)
  ];

  try {
    console.log('🎯 Creating route from Bear Canyon loop trail UUIDs...');
    
    // Use the Layer 1 test schema we just created
    const stagingSchema = 'carthorse_layer1_test_1755977888964';
    
    // Step 1: Find the edge IDs in ways_noded that correspond to these trail UUIDs
    console.log('🔍 Finding edge IDs for trail UUIDs...');
    const edgeQuery = await pgClient.query(`
      SELECT 
        wn.id as edge_id,
        wn.source,
        wn.target,
        wn.name,
        wn.app_uuid as trail_uuid,
        wn.length_km,
        wn.elevation_gain,
        wn.elevation_loss
      FROM ${stagingSchema}.ways_noded wn
      WHERE wn.app_uuid = ANY($1)
      ORDER BY wn.name
    `, [trailUUIDs]);

    if (edgeQuery.rows.length === 0) {
      console.error('❌ No edges found for the provided trail UUIDs');
      return;
    }

    console.log(`✅ Found ${edgeQuery.rows.length} edges for the trail UUIDs:`);
    edgeQuery.rows.forEach(edge => {
      console.log(`  - ${edge.name}: Edge ${edge.edge_id} (${edge.source} → ${edge.target}, ${edge.length_km?.toFixed(2)}km)`);
    });

    // Step 2: Get all unique nodes from these edges
    const allNodes = new Set<number>();
    edgeQuery.rows.forEach(edge => {
      allNodes.add(edge.source);
      allNodes.add(edge.target);
    });
    const nodeArray = Array.from(allNodes);
    
    console.log(`\n📊 Found ${nodeArray.length} unique nodes: [${nodeArray.join(', ')}]`);

    // Step 3: Try to find a path that visits all these edges using pgr_dijkstra
    // We'll start from the first node and try to find paths to all other nodes
    console.log('\n🔄 Finding optimal path through all edges...');
    
    // Get the first node as starting point
    const startNode = nodeArray[0];
    const targetNodes = nodeArray.slice(1);
    
    console.log(`🚀 Starting from node ${startNode}, targeting nodes: [${targetNodes.join(', ')}]`);

    // Try pgr_dijkstra to find shortest paths from start to each target
    const dijkstraResults = await pgClient.query(`
      SELECT 
        end_vid as target_node,
        node,
        edge,
        cost,
        agg_cost
      FROM pgr_dijkstra(
        'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded',
        $1,
        $2,
        directed := false
      )
      ORDER BY end_vid, seq
    `, [startNode, targetNodes]);

    console.log(`✅ Found ${dijkstraResults.rows.length} path segments via Dijkstra`);

    // Step 4: Try pgr_ksp to find k-shortest paths
    console.log('\n🔄 Finding k-shortest paths...');
    const kspResults = await pgClient.query(`
      SELECT 
        path_id,
        path_seq,
        node,
        edge,
        cost,
        agg_cost
      FROM pgr_ksp(
        'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded',
        $1,
        $2,
        3, -- k = 3 shortest paths
        directed := false
      )
      ORDER BY path_id, path_seq
    `, [startNode, targetNodes[targetNodes.length - 1]]); // Try to find path to last target

    console.log(`✅ Found ${kspResults.rows.length} path segments via KSP`);

    // Step 5: Try to create a custom route by manually connecting the edges
    console.log('\n🔄 Creating custom route by connecting edges...');
    
    // Get the edge IDs we want to include
    const targetEdgeIds = edgeQuery.rows.map(edge => edge.edge_id);
    
    // Find a path that includes all our target edges
    const customRoute = await pgClient.query(`
      WITH target_edges AS (
        SELECT unnest($1::integer[]) as edge_id
      ),
      edge_sequence AS (
        SELECT 
          wn.id,
          wn.source,
          wn.target,
          wn.name,
          wn.length_km,
          wn.elevation_gain,
          wn.elevation_loss,
          ROW_NUMBER() OVER (ORDER BY wn.name) as seq
        FROM ${stagingSchema}.ways_noded wn
        JOIN target_edges te ON wn.id = te.edge_id
      )
      SELECT * FROM edge_sequence
      ORDER BY seq
    `, [targetEdgeIds]);

    console.log(`✅ Custom route includes ${customRoute.rows.length} edges:`);
    let totalDistance = 0;
    let totalElevationGain = 0;
    
    customRoute.rows.forEach((edge, index) => {
      console.log(`  ${index + 1}. ${edge.name}: ${edge.source} → ${edge.target} (${edge.length_km?.toFixed(2)}km, +${edge.elevation_gain?.toFixed(0)}m)`);
      totalDistance += edge.length_km || 0;
      totalElevationGain += edge.elevation_gain || 0;
    });

    console.log(`\n📊 Route Summary:`);
    console.log(`   Total Distance: ${totalDistance.toFixed(2)}km`);
    console.log(`   Total Elevation Gain: ${totalElevationGain.toFixed(0)}m`);
    console.log(`   Edge Count: ${customRoute.rows.length}`);

    // Step 6: Try to find if this forms a loop by checking if we can connect back to start
    console.log('\n🔄 Checking if route forms a loop...');
    
    if (customRoute.rows.length > 0) {
      const firstEdge = customRoute.rows[0];
      const lastEdge = customRoute.rows[customRoute.rows.length - 1];
      
      console.log(`   First edge: ${firstEdge.source} → ${firstEdge.target}`);
      console.log(`   Last edge: ${lastEdge.source} → ${lastEdge.target}`);
      
      // Check if we can connect last edge back to first edge
      const loopCheck = await pgClient.query(`
        SELECT 
          wn.id,
          wn.source,
          wn.target,
          wn.name,
          wn.length_km
        FROM ${stagingSchema}.ways_noded wn
        WHERE (wn.source = $1 AND wn.target = $2) 
           OR (wn.source = $2 AND wn.target = $1)
           OR (wn.source = $3 AND wn.target = $4)
           OR (wn.source = $4 AND wn.target = $3)
      `, [lastEdge.target, firstEdge.source, lastEdge.source, firstEdge.target]);

      if (loopCheck.rows.length > 0) {
        console.log(`✅ Found connecting edge: ${loopCheck.rows[0].name} (${loopCheck.rows[0].source} → ${loopCheck.rows[0].target})`);
        console.log(`🎯 This forms a loop!`);
      } else {
        console.log(`⚠️ No direct connection found to complete the loop`);
        console.log(`   Need connection from ${lastEdge.target} to ${firstEdge.source} or similar`);
      }
    }

    // Step 7: Generate GeoJSON for the route
    console.log('\n🗺️ Generating GeoJSON for the route...');
    const routeGeometry = await pgClient.query(`
      WITH route_edges AS (
        SELECT unnest($1::integer[]) as edge_id
      ),
      route_geom AS (
        SELECT 
          wn.id,
          wn.name,
          wn.the_geom,
          wn.length_km,
          wn.elevation_gain,
          wn.elevation_loss
        FROM ${stagingSchema}.ways_noded wn
        JOIN route_edges re ON wn.id = re.edge_id
        WHERE wn.the_geom IS NOT NULL
      )
      SELECT 
        ST_AsGeoJSON(ST_LineMerge(ST_Union(the_geom))) as route_geometry,
        COUNT(*) as edge_count,
        SUM(length_km) as total_distance,
        SUM(elevation_gain) as total_elevation_gain
      FROM route_geom
    `, [targetEdgeIds]);

    if (routeGeometry.rows[0]?.route_geometry) {
      const geojson = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              name: "Bear Canyon Loop Route",
              description: "Classic Bear Canyon loop via Fern Canyon → Mesa Trail → Bear Canyon",
              total_distance_km: routeGeometry.rows[0].total_distance,
              total_elevation_gain_m: routeGeometry.rows[0].total_elevation_gain,
              edge_count: routeGeometry.rows[0].edge_count,
              trail_uuids: trailUUIDs
            },
            geometry: JSON.parse(routeGeometry.rows[0].route_geometry)
          }
        ]
      };

      const outputFile = `test-output/bear-canyon-loop-from-uuids.geojson`;
      const fs = require('fs');
      fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));
      
      console.log(`✅ Route GeoJSON saved to: ${outputFile}`);
      console.log(`   Distance: ${routeGeometry.rows[0].total_distance?.toFixed(2)}km`);
      console.log(`   Elevation Gain: ${routeGeometry.rows[0].total_elevation_gain?.toFixed(0)}m`);
      console.log(`   Edges: ${routeGeometry.rows[0].edge_count}`);
    }

  } catch (error) {
    console.error('❌ Error creating route from trail UUIDs:', error);
  } finally {
    await pgClient.end();
  }
}

if (require.main === module) {
  createRouteFromTrailUUIDs().catch(console.error);
}

