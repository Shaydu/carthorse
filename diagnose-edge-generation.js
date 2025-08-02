const { Client } = require('pg');

async function diagnoseEdgeGeneration() {
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

    // Analyze trail segments vs original trails
    console.log('\n🔍 Analyzing trail segments:');
    
    const trailSegmentsResult = await client.query(`
      SELECT 
        COUNT(*) as total_segments,
        COUNT(DISTINCT app_uuid) as unique_trail_uuids,
        COUNT(DISTINCT name) as unique_trail_names,
        AVG(length_km) as avg_length,
        MIN(length_km) as min_length,
        MAX(length_km) as max_length
      FROM ${stagingSchema}.trails
    `);
    
    const segments = trailSegmentsResult.rows[0];
    console.log(`  - Total trail segments: ${segments.total_segments}`);
    console.log(`  - Unique trail UUIDs: ${segments.unique_trail_uuids}`);
    console.log(`  - Unique trail names: ${segments.unique_trail_names}`);
    console.log(`  - Average length: ${parseFloat(segments.avg_length).toFixed(3)} km`);
    console.log(`  - Length range: ${parseFloat(segments.min_length).toFixed(3)} - ${parseFloat(segments.max_length).toFixed(3)} km`);

    // Analyze routing nodes
    console.log('\n🔍 Analyzing routing nodes:');
    
    const nodesResult = await client.query(`
      SELECT 
        COUNT(*) as total_nodes,
        COUNT(CASE WHEN node_type = 'endpoint' THEN 1 END) as endpoint_nodes,
        COUNT(CASE WHEN node_type = 'intersection' THEN 1 END) as intersection_nodes
      FROM ${stagingSchema}.routing_nodes
    `);
    
    const nodes = nodesResult.rows[0];
    console.log(`  - Total nodes: ${nodes.total_nodes}`);
    console.log(`  - Endpoint nodes: ${nodes.endpoint_nodes}`);
    console.log(`  - Intersection nodes: ${nodes.intersection_nodes}`);

    // Analyze routing edges
    console.log('\n🔍 Analyzing routing edges:');
    
    const edgesResult = await client.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(DISTINCT trail_id) as unique_trail_ids,
        COUNT(DISTINCT trail_name) as unique_trail_names,
        AVG(length_km) as avg_distance,
        MIN(length_km) as min_distance,
        MAX(length_km) as max_distance
      FROM ${stagingSchema}.routing_edges
    `);
    
    const edges = edgesResult.rows[0];
    console.log(`  - Total edges: ${edges.total_edges}`);
    console.log(`  - Unique trail IDs: ${edges.unique_trail_ids}`);
    console.log(`  - Unique trail names: ${edges.unique_trail_names}`);
    console.log(`  - Average distance: ${parseFloat(edges.avg_distance).toFixed(3)} km`);
    console.log(`  - Distance range: ${parseFloat(edges.min_distance).toFixed(3)} - ${parseFloat(edges.max_distance).toFixed(3)} km`);

    // Check for duplicate edges
    console.log('\n🔍 Checking for duplicate edges:');
    
    const duplicateEdgesResult = await client.query(`
      SELECT 
        source, target, trail_id, trail_name, COUNT(*) as count
      FROM ${stagingSchema}.routing_edges
      GROUP BY source, target, trail_id, trail_name
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 10
    `);
    
    if (duplicateEdgesResult.rows.length > 0) {
      console.log(`  - Found ${duplicateEdgesResult.rows.length} edge groups with duplicates:`);
      duplicateEdgesResult.rows.forEach(row => {
        console.log(`    * ${row.source} -> ${row.target} (${row.trail_name}): ${row.count} duplicates`);
      });
    } else {
      console.log('  - No duplicate edges found');
    }

    // Check edge-to-node ratio
    const edgeToNodeRatio = edges.total_edges / nodes.total_nodes;
    console.log(`\n📊 Edge-to-Node Ratio: ${edgeToNodeRatio.toFixed(2)} edges per node`);
    
    if (edgeToNodeRatio > 10) {
      console.log('⚠️  WARNING: Very high edge-to-node ratio suggests potential issues');
    } else if (edgeToNodeRatio > 5) {
      console.log('⚠️  WARNING: High edge-to-node ratio');
    } else {
      console.log('✅ Edge-to-node ratio looks reasonable');
    }

    // Sample some edges to understand the pattern
    console.log('\n🔍 Sample edges:');
    
    const sampleEdgesResult = await client.query(`
      SELECT 
        source, target, trail_id, trail_name, length_km
      FROM ${stagingSchema}.routing_edges
      ORDER BY length_km DESC
      LIMIT 5
    `);
    
    sampleEdgesResult.rows.forEach((edge, i) => {
      console.log(`  ${i + 1}. ${edge.source} -> ${edge.target}: ${edge.trail_name} (${parseFloat(edge.length_km).toFixed(3)} km)`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

diagnoseEdgeGeneration(); 