const { Client } = require('pg');
const fs = require('fs');

async function diagnoseRoutingNetwork() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'tester',
    password: ''
  });

  try {
    await client.connect();
    console.log('🔍 Connected to database');

    // Find the most recent staging schema
    const schemaResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_boulder_%'
      ORDER BY schema_name DESC 
      LIMIT 1
    `);

    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schemas found');
      return;
    }

    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📋 Using staging schema: ${stagingSchema}`);

    // Get routing nodes with different colors for node types
    const nodesResult = await client.query(`
      SELECT 
        id,
        node_uuid,
        lat,
        lng,
        elevation,
        node_type,
        connected_trails,
        CASE 
          WHEN node_type = 'endpoint' THEN '#FF0000'  -- Red for endpoints
          WHEN node_type = 'intersection' THEN '#0000FF'  -- Blue for intersections
          ELSE '#808080'  -- Gray for unknown
        END as color,
        CASE 
          WHEN node_type = 'endpoint' THEN 8  -- Larger for endpoints
          WHEN node_type = 'intersection' THEN 6  -- Medium for intersections
          ELSE 4  -- Small for unknown
        END as size
      FROM ${stagingSchema}.routing_nodes
      ORDER BY id
    `);

    console.log(`📍 Found ${nodesResult.rows.length} routing nodes`);

    // Get routing edges
    const edgesResult = await client.query(`
      SELECT 
        id,
        source,
        target,
        trail_id,
        trail_name,
        distance_km,
        elevation_gain,
        elevation_loss,
        geojson
      FROM ${stagingSchema}.routing_edges
      WHERE source IS NOT NULL AND target IS NOT NULL
      ORDER BY id
    `);

    console.log(`🛤️ Found ${edgesResult.rows.length} routing edges`);

    // Create GeoJSON structure
    const geojson = {
      type: 'FeatureCollection',
      features: []
    };

    // Add nodes as Point features
    nodesResult.rows.forEach(node => {
      geojson.features.push({
        type: 'Feature',
        properties: {
          id: node.id,
          node_uuid: node.node_uuid,
          node_type: node.node_type,
          connected_trails: node.connected_trails,
          elevation: node.elevation,
          color: node.color,
          size: node.size,
          feature_type: 'node'
        },
        geometry: {
          type: 'Point',
          coordinates: [node.lng, node.lat, node.elevation]
        }
      });
    });

    // Add edges as LineString features
    edgesResult.rows.forEach(edge => {
      try {
        const edgeGeojson = JSON.parse(edge.geojson);
        geojson.features.push({
          type: 'Feature',
          properties: {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            trail_id: edge.trail_id,
            trail_name: edge.trail_name,
            distance_km: edge.distance_km,
            elevation_gain: edge.elevation_gain,
            elevation_loss: edge.elevation_loss,
            color: '#00FF00',  // Green for edges
            width: 2,
            feature_type: 'edge'
          },
          geometry: edgeGeojson.geometry
        });
      } catch (e) {
        console.log(`⚠️ Skipping edge ${edge.id} due to invalid GeoJSON`);
      }
    });

    // Write to file
    const outputFile = 'routing-network-diagnosis.geojson';
    fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));
    console.log(`✅ Exported routing network to ${outputFile}`);

    // Analyze connectivity
    console.log('\n🔍 Routing Network Analysis:');
    console.log(`📍 Total nodes: ${nodesResult.rows.length}`);
    console.log(`🛤️ Total edges: ${edgesResult.rows.length}`);
    
    const endpointNodes = nodesResult.rows.filter(n => n.node_type === 'endpoint').length;
    const intersectionNodes = nodesResult.rows.filter(n => n.node_type === 'intersection').length;
    console.log(`🔴 Endpoint nodes: ${endpointNodes}`);
    console.log(`🔵 Intersection nodes: ${intersectionNodes}`);

    // Find orphaned nodes (nodes not connected to any edges)
    const connectedNodeIds = new Set();
    edgesResult.rows.forEach(edge => {
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    });

    const orphanedNodes = nodesResult.rows.filter(node => !connectedNodeIds.has(node.id));
    console.log(`⚠️ Orphaned nodes: ${orphanedNodes.length}`);

    if (orphanedNodes.length > 0) {
      console.log('\n🔍 Sample orphaned nodes:');
      orphanedNodes.slice(0, 5).forEach(node => {
        console.log(`  - Node ${node.id} (${node.node_type}): ${node.connected_trails}`);
      });
    }

    // Find orphaned edges (edges pointing to non-existent nodes)
    const nodeIds = new Set(nodesResult.rows.map(n => n.id));
    const orphanedEdges = edgesResult.rows.filter(edge => 
      !nodeIds.has(edge.source) || !nodeIds.has(edge.target)
    );
    console.log(`⚠️ Orphaned edges: ${orphanedEdges.length}`);

    if (orphanedEdges.length > 0) {
      console.log('\n🔍 Sample orphaned edges:');
      orphanedEdges.slice(0, 5).forEach(edge => {
        console.log(`  - Edge ${edge.id}: ${edge.source} -> ${edge.target} (${edge.trail_name})`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

diagnoseRoutingNetwork(); 