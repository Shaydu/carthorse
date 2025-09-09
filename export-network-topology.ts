import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';
import * as fs from 'fs';
import * as path from 'path';

async function exportNetworkTopology() {
  const schema = 'carthorse_1757362430748';
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // 1. Export current network topology (nodes + edges)
    console.log('\n📁 Exporting current network topology...');
    
    // Get all nodes with their current degree and predictions
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

    // Get all edges
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

    // Create node features
    const nodeFeatures = nodesResult.rows.map(node => ({
      type: "Feature",
      properties: {
        feature_type: "node",
        node_id: node.node_id,
        current_degree: node.current_degree,
        prediction: node.prediction,
        prediction_label: node.prediction_label,
        confidence: node.confidence,
        elevation: node.elevation,
        // Color coding based on prediction
        color: node.prediction === 0 ? "#00FF00" : node.prediction === 1 ? "#FF0000" : "#0000FF", // Green=Keep, Red=Merge, Blue=Split
        marker_size: node.current_degree === 1 ? "small" : node.current_degree === 2 ? "medium" : "large"
      },
      geometry: JSON.parse(node.geometry)
    }));

    // Create edge features
    const edgeFeatures = edgesResult.rows.map(edge => ({
      type: "Feature",
      properties: {
        feature_type: "edge",
        edge_id: edge.edge_id,
        source: edge.source,
        target: edge.target,
        length_km: edge.length_km,
        color: "#666666", // Gray for edges
        stroke_width: 2
      },
      geometry: JSON.parse(edge.geometry)
    }));

    // Create the complete network GeoJSON
    const networkGeojson = {
      type: "FeatureCollection",
      properties: {
        title: "Complete Network Topology with GraphSAGE Predictions",
        description: "Nodes and edges showing current topology and predicted changes",
        schema: schema,
        generated_at: new Date().toISOString(),
        total_nodes: nodesResult.rows.length,
        total_edges: edgesResult.rows.length,
        legend: {
          nodes: {
            "Keep as-is (Green)": "Nodes that should remain unchanged",
            "Merge degree-2 (Red)": "Degree-2 nodes that should be merged out",
            "Split Y/T (Blue)": "Nodes that should be split into intersections"
          },
          edges: {
            "Gray lines": "Trail segments connecting nodes"
          },
          marker_sizes: {
            "Small": "Degree-1 endpoints",
            "Medium": "Degree-2 connectors", 
            "Large": "Degree-3+ intersections"
          }
        }
      },
      features: [...nodeFeatures, ...edgeFeatures]
    };

    const networkPath = path.join('test-output', `network-topology-${schema}-${timestamp}.geojson`);
    fs.writeFileSync(networkPath, JSON.stringify(networkGeojson, null, 2));
    console.log(`✅ Exported complete network: ${networkPath}`);

    // 2. Create a summary of what the changes would look like
    console.log('\n📊 Network change summary:');
    
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

    console.log('\nCurrent node degrees:');
    Object.entries(degreeStats).forEach(([degree, count]) => {
      console.log(`   • Degree ${degree}: ${count} nodes`);
    });

    console.log('\nPredicted actions:');
    Object.entries(predictionStats).forEach(([action, count]) => {
      console.log(`   • ${action}: ${count} nodes`);
    });

    // 3. Create a simplified view showing only problematic nodes
    console.log('\n📁 Creating simplified view of changes...');
    
    const problematicNodes = nodesResult.rows.filter(node => 
      (node.current_degree >= 3 && node.prediction === 2) || // Degree-3+ to split
      (node.current_degree === 1 && node.prediction === 0) || // Degree-1 to keep
      (node.current_degree === 2 && node.prediction === 1)    // Degree-2 to merge
    );

    const simplifiedFeatures = problematicNodes.map(node => ({
      type: "Feature",
      properties: {
        node_id: node.node_id,
        current_degree: node.current_degree,
        prediction: node.prediction,
        prediction_label: node.prediction_label,
        confidence: node.confidence,
        change_description: getChangeDescription(node),
        color: node.prediction === 0 ? "#00FF00" : node.prediction === 1 ? "#FF0000" : "#0000FF"
      },
      geometry: JSON.parse(node.geometry)
    }));

    const simplifiedGeojson = {
      type: "FeatureCollection",
      properties: {
        title: "Problematic Nodes Only",
        description: "Only nodes that need changes based on GraphSAGE predictions",
        schema: schema,
        generated_at: new Date().toISOString(),
        total_problematic_nodes: simplifiedFeatures.length
      },
      features: simplifiedFeatures
    };

    const simplifiedPath = path.join('test-output', `problematic-nodes-only-${schema}-${timestamp}.geojson`);
    fs.writeFileSync(simplifiedPath, JSON.stringify(simplifiedGeojson, null, 2));
    console.log(`✅ Exported problematic nodes only: ${simplifiedPath}`);

    console.log(`\n🗺️  Visualization instructions:`);
    console.log(`   1. Open the complete network GeoJSON in QGIS or geojson.io`);
    console.log(`   2. Use the color coding:`);
    console.log(`      - Green nodes: Keep as-is`);
    console.log(`      - Red nodes: Merge degree-2 (will be removed)`);
    console.log(`      - Blue nodes: Split Y/T (will become intersections)`);
    console.log(`   3. Look for degree-2 red nodes - these will be merged out`);
    console.log(`   4. Look for degree-1 green nodes - these will become degree-3 when connected`);

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pgClient.end();
  }
}

function getChangeDescription(node: any): string {
  if (node.current_degree >= 3 && node.prediction === 2) {
    return `Degree-${node.current_degree} intersection should be split (Y/T)`;
  } else if (node.current_degree === 1 && node.prediction === 0) {
    return `Degree-1 endpoint should be kept as-is`;
  } else if (node.current_degree === 2 && node.prediction === 1) {
    return `Degree-2 connector should be merged out`;
  } else {
    return `No change needed`;
  }
}

exportNetworkTopology().catch(console.error);
