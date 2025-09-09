import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';

interface ProblemNode {
  lat: number;
  lng: number;
  elevation?: number;
  correct_label: number; // 0=keep, 1=merge degree-2, 2=split Y/T
  reason: string;
}

async function trainWithProblemNodes() {
  console.log('🎯 GraphSAGE Training with Problem Nodes (Coordinate-based)');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node src/cli/train-with-problem-nodes-coords.ts <schema_name>');
    process.exit(1);
  }

  const pgClient = new Pool(getDatabasePoolConfig());
  
  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Define problem nodes based on coordinates (from your recent examples)
    const problemNodes: ProblemNode[] = [
      // Recent nodes you provided
      {
        lat: 40.03425,
        lng: -105.30549,
        elevation: 0,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 intersection that should be merged out"
      },
      {
        lat: 40.03587,
        lng: -105.298875,
        elevation: 0,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      {
        lat: 40.02003,
        lng: -105.298155,
        elevation: 0,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      {
        lat: 40.02021,
        lng: -105.29658,
        elevation: 1690.254638671875,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      {
        lat: 40.019805,
        lng: -105.296625,
        elevation: 1705.5546875,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Should be degree 3, but is degree 1 - need to snap and split into degree 3 intersection at visited trail"
      },
      {
        lat: 40.01895,
        lng: -105.296985,
        elevation: 1716.496826171875,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Should be degree 3, but is degree 1 - need to snap and split into degree 3 intersection"
      },
      {
        lat: 40.018725,
        lng: -105.2964,
        elevation: 1729.4638671875,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Should be degree 3, but is degree 1 - need to snap and split into degree 3 intersection"
      },
      {
        lat: 40.017285,
        lng: -105.29685,
        elevation: 1747.0941162109375,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Should be snapped into a degree 3 intersection at the nearest trail and split the visited trail"
      },
      {
        lat: 40.01769,
        lng: -105.29766,
        elevation: 1731.143310546875,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out into a continuous edge"
      },
      {
        lat: 40.00383,
        lng: -105.306075,
        elevation: 2108.4833984375,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Degree-2 that should be degree 3 after snapping and splitting"
      }
    ];

    console.log(`\n🎯 Problem Nodes to Fix (${problemNodes.length} total):`);
    for (const node of problemNodes) {
      const labelNames = ['Keep as-is', 'Merge degree-2', 'Split Y/T'];
      console.log(`   • (${node.lat}, ${node.lng}): Should be "${labelNames[node.correct_label]}" - ${node.reason}`);
    }

    // Check current predictions for these coordinates
    console.log(`\n🔍 Current Model Predictions:`);
    for (const node of problemNodes) {
      const tolerance = 0.00001; // ~1 meter tolerance
      const findNodeQuery = `
        SELECT node_id, ST_X(the_geom) as x, ST_Y(the_geom) as y, ST_Z(the_geom) as z
        FROM ${schema}.ways_noded_vertices_pgr
        WHERE ABS(ST_X(the_geom) - $1) < $3 
          AND ABS(ST_Y(the_geom) - $2) < $3
      `;
      
      const nodeResult = await pgClient.query(findNodeQuery, [node.lng, node.lat, tolerance]);
      
      if (nodeResult.rows.length === 0) {
        console.log(`   • (${node.lat}, ${node.lng}): No node found`);
        continue;
      }
      
      const foundNode = nodeResult.rows[0];
      const nodeId = foundNode.node_id;
      
      // Get current prediction
      const predictionQuery = `
        SELECT prediction, confidence
        FROM ${schema}.graphsage_predictions
        WHERE node_id = $1
      `;
      
      const predictionResult = await pgClient.query(predictionQuery, [nodeId]);
      
      if (predictionResult.rows.length === 0) {
        console.log(`   • Node ${nodeId} at (${node.lat}, ${node.lng}): No prediction found`);
        continue;
      }
      
      const prediction = predictionResult.rows[0];
      const labelNames = ['Keep as-is', 'Merge degree-2', 'Split Y/T'];
      const currentLabel = labelNames[prediction.prediction];
      const correctLabel = labelNames[node.correct_label];
      const status = prediction.prediction === node.correct_label ? '✅ Correct' : '❌ Incorrect';
      
      console.log(`   • Node ${nodeId} at (${node.lat}, ${node.lng}):`);
      console.log(`     Current: ${currentLabel} (confidence: ${prediction.confidence.toFixed(3)})`);
      console.log(`     Correct: ${correctLabel}`);
      console.log(`     Status: ${status}`);
    }

    // Update predictions with correct labels
    console.log(`\n🔧 Updating predictions with correct labels...`);
    
    for (const node of problemNodes) {
      // Find node by coordinates (with small tolerance for floating point precision)
      const tolerance = 0.00001; // ~1 meter tolerance
      const findNodeQuery = `
        SELECT node_id, ST_X(the_geom) as x, ST_Y(the_geom) as y, ST_Z(the_geom) as z
        FROM ${schema}.ways_noded_vertices_pgr
        WHERE ABS(ST_X(the_geom) - $1) < $3 
          AND ABS(ST_Y(the_geom) - $2) < $3
      `;
      
      const nodeResult = await pgClient.query(findNodeQuery, [node.lng, node.lat, tolerance]);
      
      if (nodeResult.rows.length === 0) {
        console.log(`   ⚠️  No node found near coordinates (${node.lat}, ${node.lng})`);
        continue;
      }
      
      if (nodeResult.rows.length > 1) {
        console.log(`   ⚠️  Multiple nodes found near coordinates (${node.lat}, ${node.lng}), using first one`);
      }
      
      const foundNode = nodeResult.rows[0];
      const nodeId = foundNode.node_id;
      
      const updateQuery = `
        UPDATE ${schema}.graphsage_predictions 
        SET prediction = $1, confidence = 1.0
        WHERE node_id = $2
      `;
      
      await pgClient.query(updateQuery, [node.correct_label, nodeId]);
      console.log(`   ✅ Updated node ${nodeId} at (${node.lat}, ${node.lng}) to label ${node.correct_label}`);
    }

    // Show updated predictions
    console.log(`\n📊 Updated Predictions:`);
    const updatedQuery = `
      SELECT 
        prediction,
        COUNT(*) as count,
        AVG(confidence) as avg_confidence
      FROM ${schema}.graphsage_predictions
      GROUP BY prediction
      ORDER BY prediction
    `;
    
    const updatedResult = await pgClient.query(updatedQuery);
    const labelNames = ['Keep as-is', 'Merge degree-2', 'Split Y/T'];
    
    for (const row of updatedResult.rows) {
      const labelName = labelNames[row.prediction];
      console.log(`   • ${labelName}: ${row.count} nodes (avg confidence: ${row.avg_confidence.toFixed(3)})`);
    }

    // Export updated data for retraining
    console.log(`\n📁 Exporting updated data for retraining...`);
    const exportQuery = `
      SELECT 
        n.node_id,
        ST_X(n.the_geom) as x,
        ST_Y(n.the_geom) as y,
        ST_Z(n.the_geom) as z,
        n.degree,
        COALESCE(AVG(ST_Length(e.the_geom)), 0) as avg_incident_edge_length,
        p.prediction as label,
        p.confidence
      FROM ${schema}.ways_noded_vertices_pgr n
      LEFT JOIN ${schema}.ways_noded e ON (
        ST_StartPoint(e.the_geom) = n.the_geom OR 
        ST_EndPoint(e.the_geom) = n.the_geom
      )
      LEFT JOIN ${schema}.graphsage_predictions p ON n.node_id = p.node_id
      GROUP BY n.node_id, n.the_geom, n.degree, p.prediction, p.confidence
      ORDER BY n.node_id
    `;
    
    const exportResult = await pgClient.query(exportQuery);
    
    const exportData = {
      nodes: exportResult.rows.map(row => ({
        node_id: row.node_id,
        x: Number(row.x),
        y: Number(row.y),
        z: Number(row.z),
        degree: Number(row.degree),
        avg_incident_edge_length: Number(row.avg_incident_edge_length)
      })),
      node_labels: exportResult.rows.map(row => ({
        node_id: row.node_id,
        label: Number(row.label)
      })),
      metadata: {
        schema: schema,
        total_nodes: exportResult.rows.length,
        problem_nodes_corrected: problemNodes.length,
        export_timestamp: new Date().toISOString()
      }
    };
    
    const filename = `test-output/graphsage-data-${schema}-with-coordinate-problem-nodes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const fs = require('fs');
    fs.writeFileSync(filename, JSON.stringify(exportData, null, 2));
    
    console.log(`✅ Exported updated data to: ${filename}`);
    console.log(`   • ${exportData.nodes.length} nodes`);
    console.log(`   • ${problemNodes.length} problem nodes corrected`);
    console.log(`   • Ready for retraining`);

    console.log(`\n🚀 Next Steps:`);
    console.log(`   1. Retrain GraphSAGE with the updated data:`);
    console.log(`      python scripts/graphsage/train_graphsage_direct.py ${schema} --user carthorse --epochs 100`);
    console.log(`   2. Or use the exported JSON file:`);
    console.log(`      python scripts/graphsage/train_graphsage.py ${filename} --epochs 100`);
    console.log(`   3. Add more problem nodes to the problemNodes array as you identify them`);
    console.log(`   4. Iterate until the model learns the correct patterns`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
    console.log('✅ Disconnected from database');
  }
}

trainWithProblemNodes();
