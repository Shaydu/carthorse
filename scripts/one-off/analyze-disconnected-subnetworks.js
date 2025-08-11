const { Pool } = require('pg');
const fs = require('fs');

// Configuration - using test config pattern
const config = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu'
};

const stagingSchema = 'staging_boulder_1754318437837';

async function analyzeDisconnectedSubnetworks() {
  const pgClient = new Pool(config);
  
  try {
    console.log('🔍 Analyzing Disconnected Subnetworks in Boulder Region:');
    console.log(`🎯 Using staging schema: ${stagingSchema}`);

    // Step 1: Find all connected components in the routing network
    console.log('\n📊 Step 1: Finding connected components...');
    const componentsResult = await pgClient.query(`
      SELECT 
        component,
        COUNT(*) as node_count,
        MIN(node) as min_node_id,
        MAX(node) as max_node_id
      FROM pgr_connectedComponents(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_native'
      )
      GROUP BY component
      ORDER BY node_count DESC
    `);

    console.log(`✅ Found ${componentsResult.rows.length} connected components:`);
    componentsResult.rows.forEach((comp, index) => {
      console.log(`  Component ${comp.component}: ${comp.node_count} nodes (IDs ${comp.min_node_id}-${comp.max_node_id})`);
    });

    // Additional pgRouting network analysis
    console.log('\n📊 Additional Network Analysis using pgRouting functions...');
    
    // Analyze network topology using pgr_analyzeGraph
    console.log('🔍 Analyzing network topology...');
    const topologyResult = await pgClient.query(`
      SELECT * FROM pgr_analyzeGraph(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_native',
        0.000001
      )
    `);
    
    if (topologyResult.rows.length > 0) {
      const topology = topologyResult.rows[0];
      console.log(`  📊 Topology Analysis:`);
      console.log(`    - Dead ends: ${topology.dead_ends}`);
      console.log(`    - Isolated nodes: ${topology.isolated_nodes}`);
      console.log(`    - Gaps: ${topology.gaps}`);
      console.log(`    - Invalid geometries: ${topology.invalid_geometries}`);
    }

    // Find articulation points (critical nodes that disconnect the network)
    console.log('🔍 Finding articulation points...');
    const articulationResult = await pgClient.query(`
      SELECT * FROM pgr_articulationPoints(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_native'
      )
    `);
    
    console.log(`  📊 Found ${articulationResult.rows.length} articulation points (critical nodes)`);
    if (articulationResult.rows.length > 0) {
      console.log(`    - Critical nodes: ${articulationResult.rows.map(r => r.node).join(', ')}`);
    }

    // Find bridges (critical edges that disconnect the network)
    console.log('🔍 Finding bridges...');
    const bridgesResult = await pgClient.query(`
      SELECT * FROM pgr_bridges(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_native'
      )
    `);
    
    console.log(`  📊 Found ${bridgesResult.rows.length} bridges (critical edges)`);
    if (bridgesResult.rows.length > 0) {
      console.log(`    - Critical edges: ${bridgesResult.rows.map(r => r.edge).join(', ')}`);
    }

    // Step 2: Analyze each component in detail
    console.log('\n📊 Step 2: Analyzing component details...');
    const componentDetails = [];
    
    for (const comp of componentsResult.rows) {
      console.log(`\n🔍 Analyzing Component ${comp.component} (${comp.node_count} nodes)...`);
      
      // Get nodes in this component
      const nodesResult = await pgClient.query(`
        SELECT 
          v.id,
          v.cnt as connection_count,
          ST_X(v.the_geom) as lng,
          ST_Y(v.the_geom) as lat,
          ST_AsGeoJSON(v.the_geom) as geojson
        FROM ${stagingSchema}.ways_native_vertices_pgr v
        JOIN pgr_connectedComponents(
          'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_native'
        ) cc ON v.id = cc.node
        WHERE cc.component = $1
        ORDER BY v.cnt DESC
      `, [comp.component]);

      // Get edges in this component
      const edgesResult = await pgClient.query(`
        SELECT 
          w.id,
          w.source,
          w.target,
          w.length_km,
          w.trail_uuid,
          t.name as trail_name,
          ST_AsGeoJSON(w.the_geom) as geojson
        FROM ${stagingSchema}.ways_native w
        LEFT JOIN ${stagingSchema}.trails t ON w.trail_uuid = t.app_uuid
        WHERE w.source IN (
          SELECT node FROM pgr_connectedComponents(
            'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_native'
          ) WHERE component = $1
        ) OR w.target IN (
          SELECT node FROM pgr_connectedComponents(
            'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_native'
          ) WHERE component = $1
        )
      `, [comp.component]);

      // Calculate component statistics
      const totalLength = edgesResult.rows.reduce((sum, edge) => sum + (edge.length_km || 0), 0);
      const uniqueTrails = new Set(edgesResult.rows.map(e => e.trail_uuid).filter(Boolean));
      const avgConnections = nodesResult.rows.reduce((sum, node) => sum + node.connection_count, 0) / nodesResult.rows.length;
      
      const componentInfo = {
        component_id: comp.component,
        node_count: comp.node_count,
        edge_count: edgesResult.rows.length,
        total_length_km: totalLength,
        unique_trails: uniqueTrails.size,
        avg_connections: avgConnections,
        nodes: nodesResult.rows,
        edges: edgesResult.rows
      };
      
      componentDetails.push(componentInfo);
      
      console.log(`  📊 Component ${comp.component} Statistics:`);
      console.log(`    - Nodes: ${comp.node_count}`);
      console.log(`    - Edges: ${edgesResult.rows.length}`);
      console.log(`    - Total Length: ${totalLength.toFixed(2)} km`);
      console.log(`    - Unique Trails: ${uniqueTrails.size}`);
      console.log(`    - Avg Connections: ${avgConnections.toFixed(1)}`);
      
      // Show sample trails in this component
      const sampleTrails = edgesResult.rows
        .filter(e => e.trail_name)
        .slice(0, 5)
        .map(e => e.trail_name);
      
      if (sampleTrails.length > 0) {
        console.log(`    - Sample Trails: ${sampleTrails.join(', ')}`);
      }
    }

    // Step 3: Generate GeoJSON for each component
    console.log('\n📊 Step 3: Generating component visualizations...');
    
    componentDetails.forEach((comp, index) => {
      const geojson = {
        type: "FeatureCollection",
        features: []
      };

      // Add nodes
      comp.nodes.forEach(node => {
        geojson.features.push({
          type: "Feature",
          properties: {
            name: `Component ${comp.component_id} - Node ${node.id}`,
            component_id: comp.component_id,
            node_id: node.id,
            connection_count: node.connection_count,
            node_type: "component_node",
            marker: "circle",
            "marker-size": node.connection_count >= 3 ? "medium" : "small",
            "marker-color": `#${Math.floor(Math.random()*16777215).toString(16)}`, // Random color per component
            "z-index": 100
          },
          geometry: {
            type: "Point",
            coordinates: [node.lng, node.lat]
          }
        });
      });

      // Add edges
      comp.edges.forEach(edge => {
        try {
          const geomJson = JSON.parse(edge.geojson);
          if (geomJson.coordinates && geomJson.coordinates.length > 0) {
            geojson.features.push({
              type: "Feature",
              properties: {
                name: `Component ${comp.component_id} - Edge ${edge.id}`,
                component_id: comp.component_id,
                trail_name: edge.trail_name || "Unknown Trail",
                trail_uuid: edge.trail_uuid,
                length_km: edge.length_km,
                source_node: edge.source,
                target_node: edge.target,
                stroke: `#${Math.floor(Math.random()*16777215).toString(16)}`, // Random color per component
                "stroke-width": 2,
                "stroke-opacity": 0.8,
                "z-index": 200
              },
              geometry: geomJson
            });
          }
        } catch (error) {
          console.log(`⚠️ Failed to parse geometry for edge ${edge.id}: ${error.message}`);
        }
      });

      // Write component-specific file
      const outputFile = `component-${comp.component_id}-subnetwork.geojson`;
      fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));
      console.log(`  💾 Component ${comp.component_id}: ${outputFile}`);
    });

    // Step 4: Generate summary report
    console.log('\n📊 Step 4: Generating summary report...');
    const summary = {
      analysis_date: new Date().toISOString(),
      staging_schema: stagingSchema,
      total_components: componentDetails.length,
      components: componentDetails.map(comp => ({
        component_id: comp.component_id,
        node_count: comp.node_count,
        edge_count: comp.edge_count,
        total_length_km: comp.total_length_km,
        unique_trails: comp.unique_trails,
        avg_connections: comp.avg_connections
      }))
    };

    const summaryFile = 'disconnected-subnetworks-summary.json';
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    console.log(`💾 Summary report: ${summaryFile}`);

    // Step 5: Final analysis
    console.log('\n📊 FINAL ANALYSIS:');
    console.log(`🔍 Total Connected Components: ${componentDetails.length}`);
    
    if (componentDetails.length === 1) {
      console.log('✅ Single connected network - all trails are interconnected');
    } else {
      console.log('⚠️ Multiple disconnected subnetworks detected:');
      
      // Sort by size (node count)
      const sortedComponents = componentDetails.sort((a, b) => b.node_count - a.node_count);
      
      sortedComponents.forEach((comp, index) => {
        const sizeLabel = comp.node_count > 100 ? 'LARGE' : 
                         comp.node_count > 50 ? 'MEDIUM' : 
                         comp.node_count > 10 ? 'SMALL' : 'TINY';
        
        console.log(`  ${index + 1}. Component ${comp.component_id}: ${comp.node_count} nodes, ${comp.total_length_km.toFixed(1)}km (${sizeLabel})`);
      });
      
      console.log('\n💡 RECOMMENDATIONS:');
      console.log('  - Large components can be processed independently');
      console.log('  - Small/tiny components may need data quality review');
      console.log('  - Consider merging small components if they should be connected');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

analyzeDisconnectedSubnetworks(); 