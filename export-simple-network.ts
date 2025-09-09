import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';
import * as fs from 'fs';
import * as path from 'path';

async function exportSimpleNetwork() {
  const schema = 'carthorse_1757362430748';
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // 1. Get all nodes with their current degree and predictions
    console.log('\n📁 Getting all nodes...');
    const nodesQuery = `
      SELECT 
        v.id as node_id,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat,
        ST_Z(v.the_geom) as elevation,
        (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = v.id OR e.target = v.id) as current_degree,
        p.prediction,
        p.confidence,
        CASE 
          WHEN p.prediction = 0 THEN 'Keep as-is'
          WHEN p.prediction = 1 THEN 'Merge degree-2'
          WHEN p.prediction = 2 THEN 'Split Y/T'
        END as prediction_label,
        ST_AsGeoJSON(v.the_geom) as geometry
      FROM ${schema}.ways_noded_vertices_pgr v
      LEFT JOIN ${schema}.graphsage_predictions p ON p.node_id = v.id
      ORDER BY v.id
    `;
    
    const nodesResult = await pgClient.query(nodesQuery);
    console.log(`   Found ${nodesResult.rows.length} nodes`);

    // 2. Get all edges (simplified query)
    console.log('\n📁 Getting all edges...');
    const edgesQuery = `
      SELECT 
        e.id as edge_id,
        e.source,
        e.target,
        e.length_km,
        ST_AsGeoJSON(e.the_geom) as geometry
      FROM ${schema}.ways_noded e
      ORDER BY e.id
    `;
    
    const edgesResult = await pgClient.query(edgesQuery);
    console.log(`   Found ${edgesResult.rows.length} edges`);

    // 3. Create node features with color coding
    const nodeFeatures = nodesResult.rows.map(node => {
      let color = "#999999"; // Default gray
      let markerSize = "medium";
      
      // Color based on prediction
      if (node.prediction === 0) color = "#00FF00"; // Green = Keep as-is
      else if (node.prediction === 1) color = "#FF0000"; // Red = Merge degree-2
      else if (node.prediction === 2) color = "#0000FF"; // Blue = Split Y/T
      
      // Size based on degree
      if (node.current_degree === 1) markerSize = "small";
      else if (node.current_degree === 2) markerSize = "medium";
      else if (node.current_degree >= 3) markerSize = "large";
      
      return {
        type: "Feature",
        properties: {
          feature_type: "node",
          node_id: node.node_id,
          current_degree: node.current_degree,
          prediction: node.prediction,
          prediction_label: node.prediction_label,
          confidence: node.confidence,
          elevation: node.elevation,
          color: color,
          marker_size: markerSize,
          description: `Node ${node.node_id}: Degree ${node.current_degree}, ${node.prediction_label}`
        },
        geometry: JSON.parse(node.geometry)
      };
    });

    // 4. Create edge features
    const edgeFeatures = edgesResult.rows.map(edge => ({
      type: "Feature",
      properties: {
        feature_type: "edge",
        edge_id: edge.edge_id,
        source: edge.source,
        target: edge.target,
        length_km: edge.length_km,
        color: "#666666", // Gray for edges
        stroke_width: 2,
        description: `Edge ${edge.edge_id}: ${edge.source} → ${edge.target} (${edge.length_km}km)`
      },
      geometry: JSON.parse(edge.geometry)
    }));

    // 5. Create the complete network GeoJSON
    const networkGeojson = {
      type: "FeatureCollection",
      properties: {
        title: "Complete Network Topology with GraphSAGE Predictions",
        description: "All nodes and edges showing current topology and predicted changes",
        schema: schema,
        generated_at: new Date().toISOString(),
        total_nodes: nodesResult.rows.length,
        total_edges: edgesResult.rows.length,
        legend: {
          node_colors: {
            "Green": "Keep as-is (no change needed)",
            "Red": "Merge degree-2 (will be removed/merged)",
            "Blue": "Split Y/T (will be split into intersection)"
          },
          node_sizes: {
            "Small": "Degree-1 endpoints",
            "Medium": "Degree-2 connectors", 
            "Large": "Degree-3+ intersections"
          },
          edges: {
            "Gray lines": "Trail segments connecting nodes"
          }
        }
      },
      features: [...nodeFeatures, ...edgeFeatures]
    };

    // 6. Save the complete network
    const networkPath = path.join('test-output', `complete-network-${schema}-${timestamp}.geojson`);
    fs.writeFileSync(networkPath, JSON.stringify(networkGeojson, null, 2));
    console.log(`✅ Exported complete network: ${networkPath}`);

    // 7. Show summary statistics
    console.log('\n📊 Network Summary:');
    
    const degreeStats: Record<string, number> = {};
    const predictionStats: Record<string, number> = {};
    
    nodesResult.rows.forEach(node => {
      // Count by degree
      if (!degreeStats[node.current_degree]) {
        degreeStats[node.current_degree] = 0;
      }
      degreeStats[node.current_degree]++;
      
      // Count by prediction
      if (!predictionStats[node.prediction_label]) {
        predictionStats[node.prediction_label] = 0;
      }
      predictionStats[node.prediction_label]++;
    });

    console.log('\nNode degrees:');
    Object.entries(degreeStats).forEach(([degree, count]) => {
      console.log(`   • Degree ${degree}: ${count} nodes`);
    });

    console.log('\nPredicted actions:');
    Object.entries(predictionStats).forEach(([action, count]) => {
      console.log(`   • ${action}: ${count} nodes`);
    });

    console.log(`\n🗺️  Visualization instructions:`);
    console.log(`   1. Open ${networkPath} in QGIS, ArcGIS, or geojson.io`);
    console.log(`   2. Use the color coding:`);
    console.log(`      - 🟢 Green nodes: Keep as-is (no changes)`);
    console.log(`      - 🔴 Red nodes: Merge degree-2 (will be removed)`);
    console.log(`      - 🔵 Blue nodes: Split Y/T (will become intersections)`);
    console.log(`   3. Look for:`);
    console.log(`      - Red degree-2 nodes that will be merged out`);
    console.log(`      - Blue degree-3+ nodes that will be split`);
    console.log(`      - Green degree-1 nodes that will become degree-3 when connected`);

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pgClient.end();
  }
}

exportSimpleNetwork().catch(console.error);
