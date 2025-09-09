import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';

interface ProblemNode {
  node_id?: number; // Optional - for reference only
  lat?: number; // Optional - will be looked up from database if not provided
  lng?: number; // Optional - will be looked up from database if not provided
  elevation?: number;
  correct_label: number; // 0=keep, 1=merge degree-2, 2=split Y/T
  reason: string;
}

async function trainWithProblemNodes() {
  console.log('🎯 GraphSAGE Training with Problem Nodes');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node src/cli/train-with-problem-nodes.ts <schema_name>');
    process.exit(1);
  }

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Define problem nodes based on your expertise
    const problemNodes: ProblemNode[] = [
      // From carthorse_1757205521274 schema
      {
        node_id: 165,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Connector that should be degree 3 intersection"
      },
      {
        node_id: 351,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Endpoint that should be degree 3 intersection"
      },
      {
        node_id: 413,
        correct_label: 1, // Should be merged (degree-2 connector)
        reason: "Degree-2 connector that should be merged"
      },
      {
        node_id: 849,
        correct_label: 1, // Should be merged (degree-2 connector)
        reason: "Degree-2 connector that should be merged"
      },
      {
        node_id: 606,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Endpoint that should be degree 3 T intersection"
      },
      {
        node_id: 589,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 node that should be merged out"
      },
      {
        node_id: 612,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 node that should be merged out"
      },
      {
        node_id: 580,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      // Additional degree-2 nodes to merge (from coordinates)
      {
        node_id: -2, // Placeholder for coordinate (-105.27894, 39.92796, 0)
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 node that should be merged out"
      },
      {
        node_id: -3, // Placeholder for coordinate (-105.282585, 39.930075, 1864.044921875)
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 node that should be merged out"
      },
      // Endpoints that should be split to degree-3 intersections
      {
        node_id: 553,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Endpoint that should be split where it touches visitor and joined as degree 3"
      },
      {
        node_id: 552,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Endpoint that should be split and joined as degree 3 intersection"
      },
      {
        node_id: 537,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Endpoint that should be split and merged to degree 3"
      },
      {
        node_id: 77,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Endpoint that should be split and merged to degree 3"
      },
      // Additional degree-2 nodes to merge
      {
        node_id: 110,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      {
        node_id: 105,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      {
        node_id: 2,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      {
        node_id: 109,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      {
        node_id: 57,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      {
        node_id: 52,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      // Y intersection split at visited by visitor endpoint
      {
        node_id: 4,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Y intersection split at visited by visitor endpoint"
      },
      // Additional degree-2 nodes to merge
      {
        node_id: 576,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      {
        node_id: 561,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      // Degree 3 Y intersections that should split visited paths
      {
        node_id: 574,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Degree 3 node which should split visited path at touch/intersection point"
      },
      {
        node_id: 560,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Degree 3 Y intersection (but is an endpoint currently) - needs to split visited at coordinate by visitor endpoint"
      },
      {
        node_id: 577,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Degree 3 Y intersection (but is an endpoint currently) - needs to split visited path"
      },
      {
        node_id: 526,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Degree 3 Y intersection (but is an endpoint currently) - needs to split visited path"
      },
      // Additional degree-2 nodes to merge
      {
        node_id: 542,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      {
        node_id: 545,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      {
        node_id: 502,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      {
        node_id: 621,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      {
        node_id: 540,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Should be snapped to the nearest edge or degree 2 vertex and form a degree 3 intersection"
      },
      {
        node_id: 557,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Should be a degree 3 not a degree 1"
      },
      {
        node_id: 149,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged through"
      },
      {
        node_id: 151,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Should be degree 3 split and create degree 3 instead of degree 1"
      },
      {
        node_id: 89,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Y self intersection - split and create degree 3 node"
      },
      {
        node_id: 32,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged through"
      },
      {
        node_id: 16,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 intersection that should be merged out"
      },
      {
        node_id: 19,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      {
        node_id: 40,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      {
        node_id: 78,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out"
      },
      {
        node_id: 77,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Should be degree 3, but is degree 1 - need to snap and split into degree 3 intersection at visited trail"
      },
      {
        node_id: 53,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Should be degree 3, but is degree 1 - need to snap and split into degree 3 intersection"
      },
      {
        node_id: 76,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Should be degree 3, but is degree 1 - need to snap and split into degree 3 intersection"
      },
      {
        node_id: 65,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Should be snapped into a degree 3 intersection at the nearest trail and split the visited trail"
      },
      {
        node_id: 54,
        correct_label: 1, // Should be merged (degree-2)
        reason: "Degree-2 connector that should be merged out into a continuous edge"
      },
      {
        node_id: 106,
        correct_label: 2, // Should be split Y/T intersection
        reason: "Degree-2 that should be degree 3 after snapping and splitting"
      }
      // Note: Nodes 105 and 110 are already in the list above
      // Add more problem nodes here as you identify them
    ];

    console.log(`\n🎯 Problem Nodes to Fix:`);
    for (const node of problemNodes) {
      const labelNames = ['Keep as-is', 'Merge degree-2', 'Split Y/T'];
      console.log(`   • Node ${node.node_id}: Should be "${labelNames[node.correct_label]}" - ${node.reason}`);
    }

    // Get current predictions for these nodes
    console.log(`\n🔍 Current Model Predictions:`);
    for (const node of problemNodes) {
      const predQuery = `SELECT prediction, confidence FROM ${schema}.graphsage_predictions WHERE node_id = $1`;
      const predResult = await pgClient.query(predQuery, [node.node_id]);
      
      if (predResult.rows.length > 0) {
        const pred = predResult.rows[0];
        const predLabel = ['Keep as-is', 'Merge degree-2', 'Split Y/T'][pred.prediction];
        const correctLabel = ['Keep as-is', 'Merge degree-2', 'Split Y/T'][node.correct_label];
        const isCorrect = pred.prediction === node.correct_label;
        
        console.log(`   • Node ${node.node_id}:`);
        console.log(`     Current: ${predLabel} (confidence: ${pred.confidence.toFixed(3)})`);
        console.log(`     Correct: ${correctLabel}`);
        console.log(`     Status: ${isCorrect ? '✅ Correct' : '❌ Incorrect'}`);
      } else {
        console.log(`   • Node ${node.node_id}: No prediction found`);
      }
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
    
    const updated = await pgClient.query(updatedQuery);
    const labelNames = ['Keep as-is', 'Merge degree-2', 'Split Y/T'];
    
    for (const row of updated.rows) {
      console.log(`   • ${labelNames[row.prediction]}: ${row.count} nodes (avg confidence: ${row.avg_confidence.toFixed(3)})`);
    }

    // Export updated data for retraining
    console.log(`\n📁 Exporting updated data for retraining...`);
    
    const exportQuery = `
      SELECT 
        v.id,
        ST_X(v.the_geom) as x,
        ST_Y(v.the_geom) as y,
        ST_Z(v.the_geom) as z,
        (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = v.id OR e.target = v.id) as degree,
        (SELECT AVG(COALESCE(e.length_km, 0.1)) FROM ${schema}.ways_noded e WHERE e.source = v.id OR e.target = v.id) as avg_incident_edge_length,
        p.prediction,
        p.confidence
      FROM ${schema}.ways_noded_vertices_pgr v
      LEFT JOIN ${schema}.graphsage_predictions p ON p.node_id = v.id
      ORDER BY v.id
    `;
    
    const exportData = await pgClient.query(exportQuery);
    
    // Create PyTorch Geometric format
    const pytorchData = {
      x: exportData.rows.map(row => [
        Number(row.x), 
        Number(row.y), 
        Number(row.z), 
        Number(row.degree), 
        Number(row.avg_incident_edge_length)
      ]),
      y: exportData.rows.map(row => Number(row.prediction)),
      metadata: {
        num_nodes: exportData.rows.length,
        num_features: 5,
        num_classes: 3,
        schema: schema,
        problem_nodes_fixed: problemNodes.length,
        generated_at: new Date().toISOString(),
        problem_nodes: problemNodes
      }
    };

    // Save to file
    const fs = require('fs');
    const path = require('path');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join('test-output', `graphsage-data-${schema}-with-problem-nodes-${timestamp}.json`);
    
    fs.writeFileSync(outputPath, JSON.stringify(pytorchData, null, 2));
    
    console.log(`✅ Exported updated data to: ${outputPath}`);
    console.log(`   • ${exportData.rows.length} nodes`);
    console.log(`   • ${problemNodes.length} problem nodes corrected`);
    console.log(`   • Ready for retraining`);

    console.log(`\n🚀 Next Steps:`);
    console.log(`   1. Retrain GraphSAGE with the updated data:`);
    console.log(`      python scripts/graphsage/train_graphsage_direct.py ${schema} --user carthorse --epochs 100`);
    console.log(`   2. Or use the exported JSON file:`);
    console.log(`      python scripts/graphsage/train_graphsage.py ${outputPath} --epochs 100`);
    console.log(`   3. Add more problem nodes to the problemNodes array as you identify them`);
    console.log(`   4. Iterate until the model learns the correct patterns`);

    // Show how to add more problem nodes
    console.log(`\n💡 To add more problem nodes, edit the problemNodes array:`);
    console.log(`   const problemNodes: ProblemNode[] = [`);
    console.log(`     { node_id: 8, correct_label: 2, reason: "Degree-3 intersection that should be split" },`);
    console.log(`     { node_id: YOUR_NODE_ID, correct_label: 0|1|2, reason: "Your reason here" },`);
    console.log(`     // Add more as needed`);
    console.log(`   ];`);

  } catch (error) {
    console.error('❌ Error training with problem nodes:', error);
  } finally {
    await pgClient.end();
  }
}

trainWithProblemNodes().catch(console.error);
