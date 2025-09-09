import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function showFullTrainingDataset() {
  const schema = 'carthorse_1757362430748';
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Get the complete training dataset
    console.log('\n📊 Complete Training Dataset:');
    
    const query = `
      SELECT 
        v.id as node_id,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat,
        ST_Z(v.the_geom) as elevation,
        (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = v.id OR e.target = v.id) as degree,
        (SELECT AVG(COALESCE(e.length_km, 0.1)) FROM ${schema}.ways_noded e WHERE e.source = v.id OR e.target = v.id) as avg_incident_edge_length,
        p.prediction,
        p.confidence,
        CASE 
          WHEN p.prediction = 0 THEN 'Keep as-is'
          WHEN p.prediction = 1 THEN 'Merge degree-2'
          WHEN p.prediction = 2 THEN 'Split Y/T'
        END as prediction_label
      FROM ${schema}.ways_noded_vertices_pgr v
      LEFT JOIN ${schema}.graphsage_predictions p ON p.node_id = v.id
      ORDER BY v.id
    `;
    
    const result = await pgClient.query(query);
    console.log(`\nTotal nodes in training dataset: ${result.rows.length}`);

    // Show summary by prediction
    const summary: Record<string, number> = {};
    result.rows.forEach(row => {
      const label = row.prediction_label || 'No prediction';
      summary[label] = (summary[label] || 0) + 1;
    });

    console.log('\n📈 Summary by prediction:');
    Object.entries(summary).forEach(([label, count]) => {
      const percentage = (count / result.rows.length * 100).toFixed(1);
      console.log(`   • ${label}: ${count} nodes (${percentage}%)`);
    });

    // Show the specific problem nodes you provided
    console.log('\n🎯 Your Specific Problem Nodes:');
    
    const problemNodeIds = [231, 181, 182, 185, 177, 106, 105, 23]; // The nodes you identified
    
    problemNodeIds.forEach(nodeId => {
      const node = result.rows.find(row => row.node_id === nodeId);
      if (node) {
        console.log(`\n   Node ${node.node_id}:`);
        console.log(`     • Coordinates: (${node.lat}, ${node.lng})`);
        console.log(`     • Elevation: ${node.elevation}`);
        console.log(`     • Degree: ${node.degree}`);
        console.log(`     • Avg edge length: ${node.avg_incident_edge_length.toFixed(3)} km`);
        console.log(`     • Prediction: ${node.prediction_label} (confidence: ${node.confidence})`);
      }
    });

    // Show all nodes with their full features
    console.log('\n📋 Complete Dataset (first 20 nodes):');
    console.log('Node ID | Lat      | Lng       | Elevation | Degree | Avg Edge Len | Prediction | Confidence');
    console.log('--------|----------|-----------|-----------|--------|--------------|------------|-----------');
    
    result.rows.slice(0, 20).forEach(row => {
      const lat = row.lat.toFixed(6);
      const lng = row.lng.toFixed(6);
      const elevation = row.elevation.toFixed(1);
      const avgLen = row.avg_incident_edge_length.toFixed(3);
      const prediction = row.prediction_label || 'None';
      const confidence = row.confidence ? row.confidence.toFixed(3) : 'N/A';
      
      console.log(`${row.node_id.toString().padStart(7)} | ${lat.padStart(8)} | ${lng.padStart(9)} | ${elevation.padStart(9)} | ${row.degree.toString().padStart(6)} | ${avgLen.padStart(12)} | ${prediction.padStart(10)} | ${confidence.padStart(10)}`);
    });

    if (result.rows.length > 20) {
      console.log(`\n... and ${result.rows.length - 20} more nodes`);
    }

    // Show nodes by degree
    console.log('\n📊 Nodes by Degree:');
    const degreeStats: Record<number, { total: number; predictions: Record<string, number> }> = {};
    
    result.rows.forEach(row => {
      const degree = row.degree;
      const prediction = row.prediction_label || 'No prediction';
      
      if (!degreeStats[degree]) {
        degreeStats[degree] = { total: 0, predictions: {} };
      }
      degreeStats[degree].total++;
      degreeStats[degree].predictions[prediction] = (degreeStats[degree].predictions[prediction] || 0) + 1;
    });

    Object.entries(degreeStats).forEach(([degree, stats]) => {
      console.log(`\n   Degree ${degree} (${stats.total} nodes):`);
      Object.entries(stats.predictions).forEach(([prediction, count]) => {
        const percentage = (count / stats.total * 100).toFixed(1);
        console.log(`     • ${prediction}: ${count} nodes (${percentage}%)`);
      });
    });

    // Export to JSON for easy viewing
    console.log('\n💾 Exporting complete dataset...');
    
    const exportData = {
      metadata: {
        total_nodes: result.rows.length,
        schema: schema,
        generated_at: new Date().toISOString(),
        summary: summary
      },
      nodes: result.rows.map(row => ({
        node_id: row.node_id,
        coordinates: {
          lat: row.lat,
          lng: row.lng,
          elevation: row.elevation
        },
        features: {
          degree: row.degree,
          avg_incident_edge_length: row.avg_incident_edge_length
        },
        prediction: {
          value: row.prediction,
          label: row.prediction_label,
          confidence: row.confidence
        }
      }))
    };

    const fs = require('fs');
    const path = require('path');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join('test-output', `complete-training-dataset-${schema}-${timestamp}.json`);
    
    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
    console.log(`✅ Exported complete dataset to: ${outputPath}`);

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pgClient.end();
  }
}

showFullTrainingDataset().catch(console.error);
