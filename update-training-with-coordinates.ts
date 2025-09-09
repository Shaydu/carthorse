import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

interface ProblemNodeByCoordinates {
  lat: number;
  lng: number;
  correct_label: number; // 0=keep, 1=merge degree-2, 2=split Y/T
  reason: string;
  tolerance?: number; // meters - default 10m
}

async function updateTrainingWithCoordinates() {
  const schema = process.argv[2];
  
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.log('Usage: npx ts-node update-training-with-coordinates.ts <schema_name>');
    process.exit(1);
  }

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Define problem nodes by coordinates (not IDs)
    const problemNodes: ProblemNodeByCoordinates[] = [
      // From your example - node 237
      {
        lat: 39.961305,
        lng: -105.26499000000001,
        correct_label: 1, // Should be merged (degree-2 connector)
        reason: "Degree-2 connector that should be merged",
        tolerance: 10 // 10 meter tolerance
      },
      // Add more problem nodes by coordinates here
      // You can find these by looking at the GraphSAGE data or by inspecting the network
    ];

    console.log(`🔍 Looking for ${problemNodes.length} problem nodes by coordinates...\n`);

    const foundNodes = [];
    const tolerance = 0.0001; // ~10 meters in degrees

    for (const problemNode of problemNodes) {
      console.log(`🔍 Looking for node near (${problemNode.lat}, ${problemNode.lng})...`);
      
      const query = `
        SELECT 
          id as node_id,
          ST_X(the_geom) as lng,
          ST_Y(the_geom) as lat,
          ST_Z(the_geom) as elevation,
          (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = v.id OR e.target = v.id) as degree,
          ST_Distance(the_geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)) as distance_meters
        FROM ${schema}.ways_noded_vertices_pgr v
        WHERE ST_DWithin(the_geom, ST_SetSRID(ST_MakePoint($1, $2), 4326), $3)
        ORDER BY ST_Distance(the_geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
        LIMIT 1
      `;
      
      const result = await pgClient.query(query, [problemNode.lng, problemNode.lat, tolerance]);
      
      if (result.rows.length === 0) {
        console.log(`   ❌ No node found within ${tolerance * 111000} meters`);
        continue;
      }

      const node = result.rows[0];
      const nodeType = node.degree === 1 ? 'endpoint' : node.degree === 2 ? 'connector' : 'intersection';
      
      console.log(`   ✅ Found node ${node.node_id}: (${node.lat}, ${node.lng}) - degree ${node.degree} (${nodeType}) - ${node.distance_meters.toFixed(2)}m away`);
      
      foundNodes.push({
        node_id: node.node_id,
        lat: node.lat,
        lng: node.lng,
        elevation: node.elevation,
        degree: node.degree,
        distance_meters: node.distance_meters,
        correct_label: problemNode.correct_label,
        reason: problemNode.reason
      });
    }

    console.log(`\n📊 Found ${foundNodes.length} nodes to update`);

    if (foundNodes.length === 0) {
      console.log('❌ No nodes found to update');
      return;
    }

    // Update GraphSAGE predictions
    console.log(`\n🔧 Updating GraphSAGE predictions...`);
    
    for (const node of foundNodes) {
      const updateQuery = `
        UPDATE ${schema}.graphsage_predictions 
        SET prediction = $1, confidence = 1.0
        WHERE node_id = $2
      `;
      
      try {
        await pgClient.query(updateQuery, [node.correct_label, node.node_id]);
        const labelNames = ['Keep as-is', 'Merge degree-2', 'Split Y/T'];
        console.log(`   ✅ Updated node ${node.node_id} to "${labelNames[node.correct_label]}"`);
      } catch (error) {
        console.log(`   ❌ Failed to update node ${node.node_id}: ${error instanceof Error ? error.message : String(error)}`);
      }
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
        problem_nodes_fixed: foundNodes.length,
        generated_at: new Date().toISOString(),
        problem_nodes: foundNodes.map(node => ({
          node_id: node.node_id,
          lat: node.lat,
          lng: node.lng,
          correct_label: node.correct_label,
          reason: node.reason,
          distance_meters: node.distance_meters
        }))
      }
    };

    // Save to file
    const fs = require('fs');
    const path = require('path');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join('test-output', `graphsage-data-${schema}-coordinate-based-${timestamp}.json`);
    
    fs.writeFileSync(outputPath, JSON.stringify(pytorchData, null, 2));
    
    console.log(`✅ Exported updated data to: ${outputPath}`);
    console.log(`   • ${exportData.rows.length} nodes`);
    console.log(`   • ${foundNodes.length} problem nodes corrected by coordinates`);
    console.log(`   • Ready for retraining`);

    console.log(`\n🚀 Next Steps:`);
    console.log(`   1. Add more problem nodes by coordinates to the problemNodes array`);
    console.log(`   2. Retrain GraphSAGE with the updated data:`);
    console.log(`      python scripts/graphsage/train_graphsage_direct.py ${schema} --user carthorse --epochs 100`);
    console.log(`   3. Or use the exported JSON file:`);
    console.log(`      python scripts/graphsage/train_graphsage.py ${outputPath} --epochs 100`);

  } catch (error) {
    console.error('❌ Error updating training with coordinates:', error);
  } finally {
    await pgClient.end();
  }
}

updateTrainingWithCoordinates().catch(console.error);
