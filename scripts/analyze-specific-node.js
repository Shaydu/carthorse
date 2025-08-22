#!/usr/bin/env node

const { Client } = require('pg');

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'trail_master_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
};

async function analyzeNode(nodeId) {
  const client = new Client(config);
  
  try {
    await client.connect();
    console.log(`🔍 Analyzing node ${nodeId}...\n`);

    // First, find the latest staging schema
    const schemaResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema found!');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📋 Using staging schema: ${stagingSchema}\n`);

    // Get node details
    const nodeResult = await client.query(`
      SELECT id, node_uuid, lat, lng, node_type, connected_trails, created_at
      FROM ${stagingSchema}.routing_nodes
      WHERE id = $1
    `, [nodeId]);

    if (nodeResult.rows.length === 0) {
      console.error(`❌ Node ${nodeId} not found!`);
      return;
    }

    const node = nodeResult.rows[0];
    console.log(`📍 Node ${nodeId} Details:`);
    console.log(`   Type: ${node.node_type}`);
    console.log(`   Connected trails: ${node.connected_trails}`);
    console.log(`   Location: (${node.lat}, ${node.lng})`);
    console.log(`   UUID: ${node.node_uuid}`);
    console.log(`   Created: ${node.created_at}\n`);

    // Get all edges connected to this node
    const edgesResult = await client.query(`
      SELECT id, source, target, trail_id, trail_name, length_km, 
             ST_AsText(ST_StartPoint(geometry)) as start_point,
             ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${stagingSchema}.routing_edges
      WHERE source = $1 OR target = $1
      ORDER BY trail_name, id
    `, [nodeId]);

    console.log(`🔗 Connected Edges (${edgesResult.rows.length}):`);
    console.log('-'.repeat(80));
    
    const connectedTrails = new Set();
    const sourceEdges = [];
    const targetEdges = [];

    for (const edge of edgesResult.rows) {
      connectedTrails.add(edge.trail_name);
      
      if (edge.source === parseInt(nodeId)) {
        sourceEdges.push(edge);
        console.log(`  → ${edge.trail_name} (to node ${edge.target}) - ${edge.length_km}km`);
      } else {
        targetEdges.push(edge);
        console.log(`  ← ${edge.trail_name} (from node ${edge.source}) - ${edge.length_km}km`);
      }
    }

    console.log('\n📊 Analysis:');
    console.log(`   Total connected trails: ${connectedTrails.size}`);
    console.log(`   Outgoing edges: ${sourceEdges.length}`);
    console.log(`   Incoming edges: ${targetEdges.length}`);
    console.log(`   Total edges: ${edgesResult.rows.length}`);

    // Determine if this is an intersection or endpoint
    const isIntersection = edgesResult.rows.length > 2;
    const isEndpoint = edgesResult.rows.length <= 2;
    
    console.log('\n🎯 Classification:');
    if (isIntersection) {
      console.log(`   ✅ This is an INTERSECTION (${edgesResult.rows.length} edges)`);
      console.log(`   Reason: More than 2 edges connected, indicating multiple trail segments meet here`);
    } else if (isEndpoint) {
      console.log(`   📍 This is an ENDPOINT (${edgesResult.rows.length} edges)`);
      console.log(`   Reason: 2 or fewer edges connected, indicating trail start/end point`);
    }

    // Check if any of the connected trails have this node as an actual endpoint
    console.log('\n🔍 Checking if node is actual trail endpoint:');
    const endpointCheckResult = await client.query(`
      SELECT name, 
             ST_Distance(
               ST_GeomFromText('POINT(${node.lng} ${node.lat})', 4326)::geography,
               ST_StartPoint(geometry)::geography
             ) as distance_to_start,
             ST_Distance(
               ST_GeomFromText('POINT(${node.lng} ${node.lat})', 4326)::geography,
               ST_EndPoint(geometry)::geography
             ) as distance_to_end
      FROM ${stagingSchema}.trails
      WHERE name = ANY($1)
    `, [Array.from(connectedTrails)]);

    for (const trail of endpointCheckResult.rows) {
      const isStartEndpoint = trail.distance_to_start < 1; // Within 1 meter
      const isEndEndpoint = trail.distance_to_end < 1; // Within 1 meter
      
      if (isStartEndpoint || isEndEndpoint) {
        console.log(`   📍 ${trail.name}: ${isStartEndpoint ? 'START' : 'END'} endpoint (${Math.min(trail.distance_to_start, trail.distance_to_end).toFixed(2)}m)`);
      } else {
        console.log(`   🔗 ${trail.name}: Mid-trail point (start: ${trail.distance_to_start.toFixed(2)}m, end: ${trail.distance_to_end.toFixed(2)}m)`);
      }
    }

    console.log('\n💡 Summary:');
    if (isIntersection) {
      console.log(`   Node ${nodeId} is correctly classified as an intersection because it has ${edgesResult.rows.length} connected edges.`);
      console.log(`   This means multiple trail segments meet at this point.`);
    } else {
      console.log(`   Node ${nodeId} is classified as an endpoint because it has ${edgesResult.rows.length} connected edges.`);
      console.log(`   This typically represents a trail start/end point.`);
    }

  } catch (error) {
    console.error('❌ Error analyzing node:', error);
  } finally {
    await client.end();
  }
}

// Get node ID from command line argument
const nodeId = process.argv[2];
if (!nodeId) {
  console.error('❌ Please provide a node ID as an argument');
  console.error('Usage: node scripts/analyze-specific-node.js <node_id>');
  process.exit(1);
}

analyzeNode(nodeId);
