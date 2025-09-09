import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';
import * as fs from 'fs';
import * as path from 'path';

async function addSpecificProblemNodes() {
  const schema = 'carthorse_1757362430748';
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Define the specific problematic coordinates
    const problemCoordinates = [
      {
        lng: -105.279795,
        lat: 39.953565,
        elevation: 1920.448730469,
        reason: "Should be snapped to nearest path and split visited trail into degree 3 intersection"
      },
      {
        lng: -105.32304,
        lat: 39.952665,
        elevation: 2065.994140625,
        reason: "Should be snapped to nearest path and split visited trail into degree 3 intersection"
      },
      {
        lng: -105.31656,
        lat: 39.94488,
        elevation: 2023.697753906,
        reason: "Should be snapped to nearest path and split visited trail into degree 3 intersection"
      },
      {
        lng: -105.319575,
        lat: 39.937995,
        elevation: 2039.90637207,
        reason: "Should be snapped to nearest path and split visited trail into degree 3 intersection"
      },
      {
        lng: -105.321645,
        lat: 39.93669,
        elevation: 2054.994873047,
        reason: "Should be snapped to nearest path and split visited trail into degree 3 intersection"
      }
    ];

    console.log(`\n🔍 Processing ${problemCoordinates.length} specific problem coordinates...`);

    const tolerance = 0.001; // ~100 meters tolerance
    const foundNodes = [];
    const newNodes = [];

    for (const coord of problemCoordinates) {
      console.log(`\n🔍 Looking for node near (${coord.lat}, ${coord.lng})...`);
      
      // First, try to find existing nodes near these coordinates
      const findNodeQuery = `
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
      
      const nodeResult = await pgClient.query(findNodeQuery, [coord.lng, coord.lat, tolerance]);
      
      if (nodeResult.rows.length > 0) {
        const node = nodeResult.rows[0];
        console.log(`   ✅ Found existing node ${node.node_id}: (${node.lat}, ${node.lng}) - degree ${node.degree} - ${node.distance_meters.toFixed(2)}m away`);
        
        // Update the prediction for this node to "Split Y/T" (label 2)
        const updateQuery = `
          UPDATE ${schema}.graphsage_predictions 
          SET prediction = 2, confidence = 1.0
          WHERE node_id = $1
        `;
        
        await pgClient.query(updateQuery, [node.node_id]);
        console.log(`   🔧 Updated node ${node.node_id} to "Split Y/T"`);
        
        foundNodes.push({
          node_id: node.node_id,
          lat: node.lat,
          lng: node.lng,
          elevation: node.elevation,
          degree: node.degree,
          distance_meters: node.distance_meters,
          reason: coord.reason,
          action: "Updated existing node to Split Y/T"
        });
      } else {
        console.log(`   ⚠️  No existing node found within ${tolerance * 111000} meters`);
        
        // Find the nearest edge to snap to
        const findEdgeQuery = `
          SELECT 
            e.id as edge_id,
            e.source,
            e.target,
            e.length_km,
            ST_Distance(e.the_geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)) as distance_meters,
            ST_AsGeoJSON(e.the_geom) as edge_geometry
          FROM ${schema}.ways_noded e
          WHERE ST_DWithin(e.the_geom, ST_SetSRID(ST_MakePoint($1, $2), 4326), 0.01)
          ORDER BY ST_Distance(e.the_geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
          LIMIT 1
        `;
        
        const edgeResult = await pgClient.query(findEdgeQuery, [coord.lng, coord.lat]);
        
        if (edgeResult.rows.length > 0) {
          const edge = edgeResult.rows[0];
          console.log(`   📍 Found nearest edge ${edge.edge_id}: ${edge.distance_meters.toFixed(2)}m away`);
          
          newNodes.push({
            lng: coord.lng,
            lat: coord.lat,
            elevation: coord.elevation,
            nearest_edge_id: edge.edge_id,
            distance_to_edge: edge.distance_meters,
            reason: coord.reason,
            action: "Should be snapped to edge and create degree-3 intersection"
          });
        } else {
          console.log(`   ❌ No nearby edge found either`);
        }
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   • Found and updated: ${foundNodes.length} existing nodes`);
    console.log(`   • New coordinates to add: ${newNodes.length} points`);

    // Export updated training data
    console.log(`\n📁 Exporting updated training data...`);
    
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
        specific_problem_nodes_added: {
          existing_nodes_updated: foundNodes.length,
          new_coordinates_identified: newNodes.length,
          total_coordinates_processed: problemCoordinates.length
        },
        generated_at: new Date().toISOString(),
        specific_problem_nodes: {
          found_and_updated: foundNodes,
          new_coordinates: newNodes
        }
      }
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join('test-output', `graphsage-data-${schema}-with-specific-problems-${timestamp}.json`);
    
    fs.writeFileSync(outputPath, JSON.stringify(pytorchData, null, 2));
    
    console.log(`✅ Exported updated training data: ${outputPath}`);
    console.log(`   • ${exportData.rows.length} total nodes`);
    console.log(`   • Updated ${foundNodes.length} existing nodes to "Split Y/T"`);
    console.log(`   • Identified ${newNodes.length} new coordinates for snapping`);

    // Show details of what was found/updated
    if (foundNodes.length > 0) {
      console.log(`\n🔧 Updated existing nodes:`);
      foundNodes.forEach(node => {
        console.log(`   • Node ${node.node_id}: (${node.lat}, ${node.lng}) - degree ${node.degree} - ${node.distance_meters.toFixed(2)}m from target`);
      });
    }

    if (newNodes.length > 0) {
      console.log(`\n📍 New coordinates to snap:`);
      newNodes.forEach(node => {
        console.log(`   • (${node.lat}, ${node.lng}) - nearest edge ${node.nearest_edge_id} - ${node.distance_to_edge.toFixed(2)}m away`);
      });
    }

    console.log(`\n🚀 Next steps:`);
    console.log(`   1. Review the updated training data`);
    console.log(`   2. Retrain GraphSAGE with the updated data:`);
    console.log(`      python scripts/graphsage/train_graphsage_direct.py ${schema} --user carthorse --epochs 100`);
    console.log(`   3. Or use the exported JSON file:`);
    console.log(`      python scripts/graphsage/train_graphsage.py ${outputPath} --epochs 100`);

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pgClient.end();
  }
}

addSpecificProblemNodes().catch(console.error);
