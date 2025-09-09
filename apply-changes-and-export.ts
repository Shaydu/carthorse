import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';
import * as fs from 'fs';
import * as path from 'path';

async function applyChangesAndExport() {
  const schema = 'carthorse_1757362430748';
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // 1. Export BEFORE state
    console.log('\n📁 Exporting BEFORE state...');
    const beforeGeojson = await exportCurrentState(pgClient, schema, 'before');
    const beforePath = path.join('test-output', `graphsage-predictions-${schema}-BEFORE-${timestamp}.geojson`);
    fs.writeFileSync(beforePath, JSON.stringify(beforeGeojson, null, 2));
    console.log(`✅ Exported BEFORE state: ${beforePath}`);

    // 2. Apply the changes
    console.log('\n🔧 Applying proposed changes...');
    
    // Fix degree-3+ nodes: "Keep as-is" → "Split Y/T"
    const degree3Update = `
      UPDATE ${schema}.graphsage_predictions 
      SET prediction = 2, confidence = 1.0
      WHERE node_id IN (
        SELECT p.node_id
        FROM ${schema}.graphsage_predictions p
        WHERE p.prediction = 0 
        AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) >= 3
      )
    `;
    const degree3Result = await pgClient.query(degree3Update);
    console.log(`   ✅ Updated ${degree3Result.rowCount} degree-3+ nodes to "Split Y/T"`);

    // Fix degree-1 nodes: "Merge degree-2" → "Keep as-is"
    const degree1Update = `
      UPDATE ${schema}.graphsage_predictions 
      SET prediction = 0, confidence = 1.0
      WHERE node_id IN (
        SELECT p.node_id
        FROM ${schema}.graphsage_predictions p
        WHERE p.prediction = 1 
        AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) = 1
      )
    `;
    const degree1Result = await pgClient.query(degree1Update);
    console.log(`   ✅ Updated ${degree1Result.rowCount} degree-1 nodes to "Keep as-is"`);

    // Fix degree-2 nodes: "Keep as-is" → "Merge degree-2"
    const degree2Update = `
      UPDATE ${schema}.graphsage_predictions 
      SET prediction = 1, confidence = 1.0
      WHERE node_id IN (
        SELECT p.node_id
        FROM ${schema}.graphsage_predictions p
        WHERE p.prediction = 0 
        AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) = 2
      )
    `;
    const degree2Result = await pgClient.query(degree2Update);
    console.log(`   ✅ Updated ${degree2Result.rowCount} degree-2 nodes to "Merge degree-2"`);

    const totalChanges = (degree3Result.rowCount || 0) + (degree1Result.rowCount || 0) + (degree2Result.rowCount || 0);
    console.log(`\n🎉 Applied ${totalChanges} total changes`);

    // 3. Export AFTER state
    console.log('\n📁 Exporting AFTER state...');
    const afterGeojson = await exportCurrentState(pgClient, schema, 'after');
    const afterPath = path.join('test-output', `graphsage-predictions-${schema}-AFTER-${timestamp}.geojson`);
    fs.writeFileSync(afterPath, JSON.stringify(afterGeojson, null, 2));
    console.log(`✅ Exported AFTER state: ${afterPath}`);

    // 4. Show summary comparison
    console.log('\n📊 Summary comparison:');
    
    const beforeSummary = getSummary(beforeGeojson);
    const afterSummary = getSummary(afterGeojson);
    
    console.log('BEFORE:');
    console.log(`   • Keep as-is: ${beforeSummary.keep_as_is} (${beforeSummary.keep_as_is_pct}%)`);
    console.log(`   • Merge degree-2: ${beforeSummary.merge_degree2} (${beforeSummary.merge_degree2_pct}%)`);
    console.log(`   • Split Y/T: ${beforeSummary.split_yt} (${beforeSummary.split_yt_pct}%)`);
    
    console.log('AFTER:');
    console.log(`   • Keep as-is: ${afterSummary.keep_as_is} (${afterSummary.keep_as_is_pct}%)`);
    console.log(`   • Merge degree-2: ${afterSummary.merge_degree2} (${afterSummary.merge_degree2_pct}%)`);
    console.log(`   • Split Y/T: ${afterSummary.split_yt} (${afterSummary.split_yt_pct}%)`);

    // 5. Export updated training data
    console.log('\n📁 Exporting updated training data...');
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
        changes_applied: {
          degree3_to_split: degree3Result.rowCount,
          degree1_to_keep: degree1Result.rowCount,
          degree2_to_merge: degree2Result.rowCount,
          total_changes: totalChanges
        },
        generated_at: new Date().toISOString()
      }
    };

    const trainingPath = path.join('test-output', `graphsage-data-${schema}-corrected-${timestamp}.json`);
    fs.writeFileSync(trainingPath, JSON.stringify(pytorchData, null, 2));
    
    console.log(`✅ Exported updated training data: ${trainingPath}`);
    console.log(`   • ${exportData.rows.length} nodes`);
    console.log(`   • Applied ${totalChanges} corrections`);
    console.log(`   • Ready for retraining`);

    console.log(`\n🚀 Next steps:`);
    console.log(`   1. Review the BEFORE/AFTER GeoJSON files`);
    console.log(`   2. Retrain GraphSAGE with the corrected data:`);
    console.log(`      python scripts/graphsage/train_graphsage_direct.py ${schema} --user carthorse --epochs 100`);
    console.log(`   3. Or use the exported JSON file:`);
    console.log(`      python scripts/graphsage/train_graphsage.py ${trainingPath} --epochs 100`);

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pgClient.end();
  }
}

async function exportCurrentState(pgClient: Pool, schema: string, state: string) {
  const query = `
    SELECT 
      p.node_id,
      p.prediction,
      p.confidence,
      ST_X(v.the_geom) as lng,
      ST_Y(v.the_geom) as lat,
      ST_Z(v.the_geom) as elevation,
      (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) as degree,
      ST_AsGeoJSON(v.the_geom) as geometry
    FROM ${schema}.graphsage_predictions p
    JOIN ${schema}.ways_noded_vertices_pgr v ON v.id = p.node_id
    ORDER BY p.node_id
  `;
  
  const result = await pgClient.query(query);
  
  const features = result.rows.map(node => ({
    type: "Feature",
    properties: {
      node_id: node.node_id,
      prediction: node.prediction,
      label: ['Keep as-is', 'Merge degree-2', 'Split Y/T'][node.prediction],
      confidence: node.confidence,
      degree: node.degree,
      elevation: node.elevation,
      state: state
    },
    geometry: JSON.parse(node.geometry)
  }));

  return {
    type: "FeatureCollection",
    properties: {
      title: `GraphSAGE Predictions - ${state.toUpperCase()}`,
      description: `Node predictions ${state} applying corrections`,
      schema: schema,
      state: state,
      generated_at: new Date().toISOString(),
      total_nodes: features.length
    },
    features: features
  };
}

function getSummary(geojson: any) {
  const total = geojson.features.length;
  const keep_as_is = geojson.features.filter((f: any) => f.properties.prediction === 0).length;
  const merge_degree2 = geojson.features.filter((f: any) => f.properties.prediction === 1).length;
  const split_yt = geojson.features.filter((f: any) => f.properties.prediction === 2).length;
  
  return {
    keep_as_is,
    merge_degree2,
    split_yt,
    keep_as_is_pct: (keep_as_is / total * 100).toFixed(1),
    merge_degree2_pct: (merge_degree2 / total * 100).toFixed(1),
    split_yt_pct: (split_yt / total * 100).toFixed(1)
  };
}

applyChangesAndExport().catch(console.error);
