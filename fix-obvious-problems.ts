import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function fixObviousProblems() {
  const schema = 'carthorse_1757362430748';
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Fix degree-3+ nodes that are predicted as "Keep as-is" - they should be "Split Y/T"
    console.log('\n🔧 Fixing degree-3+ nodes predicted as "Keep as-is"...');
    
    const updateQuery = `
      UPDATE ${schema}.graphsage_predictions 
      SET prediction = 2, confidence = 1.0
      WHERE node_id IN (
        SELECT p.node_id
        FROM ${schema}.graphsage_predictions p
        WHERE p.prediction = 0 
        AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) >= 3
      )
    `;
    
    const result = await pgClient.query(updateQuery);
    console.log(`✅ Updated ${result.rowCount} degree-3+ nodes to "Split Y/T"`);

    // Fix degree-1 nodes that are predicted as "Merge degree-2" - they should be "Keep as-is"
    console.log('\n🔧 Fixing degree-1 nodes predicted as "Merge degree-2"...');
    
    const updateQuery2 = `
      UPDATE ${schema}.graphsage_predictions 
      SET prediction = 0, confidence = 1.0
      WHERE node_id IN (
        SELECT p.node_id
        FROM ${schema}.graphsage_predictions p
        WHERE p.prediction = 1 
        AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) = 1
      )
    `;
    
    const result2 = await pgClient.query(updateQuery2);
    console.log(`✅ Updated ${result2.rowCount} degree-1 nodes to "Keep as-is"`);

    // Show updated summary
    console.log('\n📊 Updated predictions summary:');
    const summaryQuery = `
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN prediction = 0 THEN 1 END) as keep_as_is,
             COUNT(CASE WHEN prediction = 1 THEN 1 END) as merge_degree2,
             COUNT(CASE WHEN prediction = 2 THEN 1 END) as split_yt
      FROM ${schema}.graphsage_predictions
    `;
    
    const summary = await pgClient.query(summaryQuery);
    const row = summary.rows[0];
    console.log(`   • Total: ${row.total} nodes`);
    console.log(`   • Keep as-is: ${row.keep_as_is} nodes (${(row.keep_as_is/row.total*100).toFixed(1)}%)`);
    console.log(`   • Merge degree-2: ${row.merge_degree2} nodes (${(row.merge_degree2/row.total*100).toFixed(1)}%)`);
    console.log(`   • Split Y/T: ${row.split_yt} nodes (${(row.split_yt/row.total*100).toFixed(1)}%)`);

    // Export updated data
    console.log('\n📁 Exporting updated data...');
    
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
        fixes_applied: {
          degree3_to_split: result.rowCount,
          degree1_to_keep: result2.rowCount
        },
        generated_at: new Date().toISOString()
      }
    };

    const fs = require('fs');
    const path = require('path');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join('test-output', `graphsage-data-${schema}-fixed-obvious-${timestamp}.json`);
    
    fs.writeFileSync(outputPath, JSON.stringify(pytorchData, null, 2));
    
    console.log(`✅ Exported updated data to: ${outputPath}`);
    console.log(`   • ${exportData.rows.length} nodes`);
    console.log(`   • Fixed ${result.rowCount + result2.rowCount} obvious prediction errors`);
    console.log(`   • Ready for retraining`);

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pgClient.end();
  }
}

fixObviousProblems().catch(console.error);
