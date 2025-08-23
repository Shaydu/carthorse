#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');

// Database configuration
const dbConfig = {
  database: 'trail_master_db',
  user: 'shaydu',
  host: 'localhost',
  port: 5432,
};

const STAGING_SCHEMA = 'carthorse_1755964844744'; // Using a recent schema
const BEAR_CANYON_NODES = [356, 357, 332, 336, 333, 339];

async function analyzeBearCanyonConnectivity() {
  const pool = new Pool(dbConfig);
  
  try {
    console.log('🔍 Analyzing Bear Canyon loop connectivity...');
    console.log(`📋 Target nodes: ${BEAR_CANYON_NODES.join(', ')}`);
    
    // 1. Check if these nodes exist in ways_noded_vertices_pgr
    console.log('\n1️⃣ Checking node existence...');
    const nodesExistResult = await pool.query(`
      SELECT id, cnt, ST_AsText(the_geom) as coordinates
      FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr
      WHERE id = ANY($1::integer[])
      ORDER BY id
    `, [BEAR_CANYON_NODES]);
    
    console.log(`✅ Found ${nodesExistResult.rows.length} nodes in ways_noded_vertices_pgr:`);
    nodesExistResult.rows.forEach(row => {
      console.log(`   Node ${row.id}: degree ${row.cnt}, coords ${row.coordinates}`);
    });
    
    // 2. Check edges that connect these nodes
    console.log('\n2️⃣ Checking edges between these nodes...');
    const edgesResult = await pool.query(`
      SELECT id, source, target, trail_name, length_km, ST_AsText(the_geom) as geometry
      FROM ${STAGING_SCHEMA}.ways_noded
      WHERE (source = ANY($1::integer[]) AND target = ANY($1::integer[]))
         OR (source = ANY($1::integer[]) OR target = ANY($1::integer[]))
      ORDER BY source, target
    `, [BEAR_CANYON_NODES]);
    
    console.log(`✅ Found ${edgesResult.rows.length} edges involving these nodes:`);
    edgesResult.rows.forEach(row => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name}, ${row.length_km.toFixed(2)}km)`);
    });
    
    // 3. Check for missing connections between these nodes
    console.log('\n3️⃣ Checking for missing connections...');
    const missingConnections = [];
    for (let i = 0; i < BEAR_CANYON_NODES.length; i++) {
      for (let j = i + 1; j < BEAR_CANYON_NODES.length; j++) {
        const node1 = BEAR_CANYON_NODES[i];
        const node2 = BEAR_CANYON_NODES[j];
        
        const connectionExists = edgesResult.rows.some(edge => 
          (edge.source === node1 && edge.target === node2) ||
          (edge.source === node2 && edge.target === node1)
        );
        
        if (!connectionExists) {
          missingConnections.push([node1, node2]);
        }
      }
    }
    
    console.log(`❌ Missing connections between these node pairs:`);
    missingConnections.forEach(([node1, node2]) => {
      console.log(`   ${node1} ↔ ${node2}`);
    });
    
    // 4. Check if there are any trails that should connect these nodes
    console.log('\n4️⃣ Checking for trails that should connect these nodes...');
    const nodeCoordsResult = await pool.query(`
      SELECT id, ST_X(the_geom) as lng, ST_Y(the_geom) as lat
      FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr
      WHERE id = ANY($1::integer[])
    `, [BEAR_CANYON_NODES]);
    
    const nodeCoords = {};
    nodeCoordsResult.rows.forEach(row => {
      nodeCoords[row.id] = [row.lng, row.lat];
    });
    
    // Check for trails that start/end near these nodes
    const nearbyTrailsResult = await pool.query(`
      SELECT 
        t.id,
        t.app_uuid,
        t.name,
        ST_AsText(ST_StartPoint(t.geometry)) as start_coords,
        ST_AsText(ST_EndPoint(t.geometry)) as end_coords,
        t.length_km
      FROM ${STAGING_SCHEMA}.trails t
      WHERE EXISTS (
        SELECT 1 FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr v
        WHERE id = ANY($1::integer[])
        AND (
          ST_DWithin(ST_StartPoint(t.geometry), v.the_geom, 0.001) OR
          ST_DWithin(ST_EndPoint(t.geometry), v.the_geom, 0.001)
        )
      )
    `, [BEAR_CANYON_NODES]);
    
    console.log(`🔍 Found ${nearbyTrailsResult.rows.length} trails near these nodes:`);
    nearbyTrailsResult.rows.forEach(row => {
      console.log(`   Trail: ${row.name} (${row.length_km.toFixed(2)}km)`);
      console.log(`     Start: ${row.start_coords}`);
      console.log(`     End: ${row.end_coords}`);
    });
    
    // 5. Check the overall network connectivity
    console.log('\n5️⃣ Checking overall network connectivity...');
    const connectivityResult = await pool.query(`
      WITH node_degrees AS (
        SELECT 
          v.id,
          v.cnt as degree,
          COUNT(e.id) as actual_edges
        FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr v
        LEFT JOIN ${STAGING_SCHEMA}.ways_noded e ON v.id = e.source OR v.id = e.target
        WHERE v.id = ANY($1::integer[])
        GROUP BY v.id, v.cnt
      )
      SELECT 
        id,
        degree,
        actual_edges,
        CASE WHEN degree = actual_edges THEN 'OK' ELSE 'MISMATCH' END as status
      FROM node_degrees
      ORDER BY id
    `, [BEAR_CANYON_NODES]);
    
    console.log(`📊 Node connectivity analysis:`);
    connectivityResult.rows.forEach(row => {
      console.log(`   Node ${row.id}: expected degree ${row.degree}, actual edges ${row.actual_edges} (${row.status})`);
    });
    
    // 6. Check if there are any disconnected components
    console.log('\n6️⃣ Checking for disconnected components...');
    const componentsResult = await pool.query(`
      SELECT 'connected' as status, COUNT(*) as nodes_in_component
      FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr
      WHERE id = ANY($1::integer[])
    `, [BEAR_CANYON_NODES]);
    
    console.log(`🔗 Component analysis:`);
    componentsResult.rows.forEach(row => {
      console.log(`   Component ${row.component_id}: ${row.nodes_in_component} nodes`);
    });
    
    // 7. Generate a simple path test
    console.log('\n7️⃣ Testing path finding between nodes...');
    for (let i = 0; i < BEAR_CANYON_NODES.length - 1; i++) {
      const startNode = BEAR_CANYON_NODES[i];
      const endNode = BEAR_CANYON_NODES[i + 1];
      
      try {
        const pathResult = await pool.query(`
          SELECT * FROM pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${STAGING_SCHEMA}.ways_noded',
            $1::integer, $2::integer, false
          )
        `, [startNode, endNode]);
        
        if (pathResult.rows.length > 0) {
          console.log(`✅ Path from ${startNode} to ${endNode}: ${pathResult.rows.length} segments`);
        } else {
          console.log(`❌ No path from ${startNode} to ${endNode}`);
        }
      } catch (error) {
        console.log(`❌ Error finding path from ${startNode} to ${endNode}: ${error.message}`);
      }
    }
    
    // 8. Export the analysis results
    const analysisResults = {
      timestamp: new Date().toISOString(),
      targetNodes: BEAR_CANYON_NODES,
      nodesFound: nodesExistResult.rows,
      edgesFound: edgesResult.rows,
      missingConnections: missingConnections,
      nearbyTrails: nearbyTrailsResult.rows,
      connectivityAnalysis: connectivityResult.rows,
      components: componentsResult.rows
    };
    
    fs.writeFileSync('bear-canyon-connectivity-analysis.json', JSON.stringify(analysisResults, null, 2));
    console.log('\n📄 Analysis results saved to bear-canyon-connectivity-analysis.json');
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
  } finally {
    await pool.end();
  }
}

analyzeBearCanyonConnectivity();
