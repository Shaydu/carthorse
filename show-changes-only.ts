import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';
import * as fs from 'fs';
import * as path from 'path';

async function showChangesOnly() {
  const schema = 'carthorse_1757362430748';
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Get nodes that were changed
    console.log('\n🔍 Finding nodes that were changed...');
    
    const changesQuery = `
      SELECT 
        p.node_id,
        p.prediction as current_prediction,
        p.confidence,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat,
        ST_Z(v.the_geom) as elevation,
        (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) as degree,
        ST_AsGeoJSON(v.the_geom) as geometry,
        CASE 
          WHEN p.prediction = 2 AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) >= 3 THEN 'degree3_to_split'
          WHEN p.prediction = 0 AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) = 1 THEN 'degree1_to_keep'
          WHEN p.prediction = 1 AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) = 2 THEN 'degree2_to_merge'
        END as change_type
      FROM ${schema}.graphsage_predictions p
      JOIN ${schema}.ways_noded_vertices_pgr v ON v.id = p.node_id
      WHERE p.confidence = 1.0  -- Only nodes that were manually corrected
      ORDER BY change_type, p.node_id
    `;
    
    const result = await pgClient.query(changesQuery);
    console.log(`Found ${result.rows.length} changed nodes`);

    // Group by change type
    const degree3Changes = result.rows.filter(r => r.change_type === 'degree3_to_split');
    const degree1Changes = result.rows.filter(r => r.change_type === 'degree1_to_keep');
    const degree2Changes = result.rows.filter(r => r.change_type === 'degree2_to_merge');

    console.log(`\n📊 Changes by type:`);
    console.log(`   • Degree-3+ to Split: ${degree3Changes.length} nodes`);
    console.log(`   • Degree-1 to Keep: ${degree1Changes.length} nodes`);
    console.log(`   • Degree-2 to Merge: ${degree2Changes.length} nodes`);

    // Create GeoJSON with only changed nodes
    const features = result.rows.map(node => {
      let oldPrediction, oldLabel;
      
      if (node.change_type === 'degree3_to_split') {
        oldPrediction = 0;
        oldLabel = 'Keep as-is';
      } else if (node.change_type === 'degree1_to_keep') {
        oldPrediction = 1;
        oldLabel = 'Merge degree-2';
      } else if (node.change_type === 'degree2_to_merge') {
        oldPrediction = 0;
        oldLabel = 'Keep as-is';
      }

      return {
        type: "Feature",
        properties: {
          node_id: node.node_id,
          old_prediction: oldPrediction,
          old_label: oldLabel,
          new_prediction: node.current_prediction,
          new_label: ['Keep as-is', 'Merge degree-2', 'Split Y/T'][node.current_prediction],
          degree: node.degree,
          confidence: node.confidence,
          elevation: node.elevation,
          change_type: node.change_type,
          change_description: `${oldLabel} → ${['Keep as-is', 'Merge degree-2', 'Split Y/T'][node.current_prediction]}`
        },
        geometry: JSON.parse(node.geometry)
      };
    });

    const geojson = {
      type: "FeatureCollection",
      properties: {
        title: "GraphSAGE Prediction Changes Only",
        description: "Only the nodes that had their predictions changed",
        schema: schema,
        generated_at: new Date().toISOString(),
        total_changes: features.length,
        changes_by_type: {
          degree3_to_split: degree3Changes.length,
          degree1_to_keep: degree1Changes.length,
          degree2_to_merge: degree2Changes.length
        }
      },
      features: features
    };

    // Save GeoJSON
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join('test-output', `graphsage-changes-only-${schema}-${timestamp}.geojson`);
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    
    console.log(`\n✅ Exported changes-only GeoJSON: ${outputPath}`);
    console.log(`   • ${features.length} changed nodes only`);
    console.log(`   • Shows old → new predictions`);

    // Show examples
    console.log(`\n📍 Examples of changes:`);
    
    if (degree3Changes.length > 0) {
      console.log(`\nDegree-3+ nodes (Keep as-is → Split Y/T):`);
      degree3Changes.slice(0, 3).forEach(node => {
        console.log(`   • Node ${node.node_id}: (${node.lat}, ${node.lng}) - degree ${node.degree}`);
      });
    }

    if (degree1Changes.length > 0) {
      console.log(`\nDegree-1 nodes (Merge degree-2 → Keep as-is):`);
      degree1Changes.forEach(node => {
        console.log(`   • Node ${node.node_id}: (${node.lat}, ${node.lng}) - degree ${node.degree}`);
      });
    }

    if (degree2Changes.length > 0) {
      console.log(`\nDegree-2 nodes (Keep as-is → Merge degree-2):`);
      degree2Changes.slice(0, 3).forEach(node => {
        console.log(`   • Node ${node.node_id}: (${node.lat}, ${node.lng}) - degree ${node.degree}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pgClient.end();
  }
}

showChangesOnly().catch(console.error);
