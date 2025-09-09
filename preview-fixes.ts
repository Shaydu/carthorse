import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function previewFixes() {
  const schema = 'carthorse_1757362430748';
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Show degree-3+ nodes that are predicted as "Keep as-is" - these should be "Split Y/T"
    console.log('\n🔍 Degree-3+ nodes currently predicted as "Keep as-is" (should be "Split Y/T"):');
    
    const degree3Query = `
      SELECT 
        p.node_id,
        p.prediction,
        p.confidence,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat,
        (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) as degree
      FROM ${schema}.graphsage_predictions p
      JOIN ${schema}.ways_noded_vertices_pgr v ON v.id = p.node_id
      WHERE p.prediction = 0 
      AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) >= 3
      ORDER BY p.node_id
      LIMIT 10
    `;
    
    const degree3Result = await pgClient.query(degree3Query);
    
    if (degree3Result.rows.length === 0) {
      console.log('   ✅ No degree-3+ nodes predicted as "Keep as-is" found');
    } else {
      console.log(`   Found ${degree3Result.rows.length} nodes (showing first 10):`);
      degree3Result.rows.forEach(node => {
        console.log(`   • Node ${node.node_id}: (${node.lat}, ${node.lng}) - degree ${node.degree} - confidence ${node.confidence}`);
      });
    }

    // Show degree-1 nodes that are predicted as "Merge degree-2" - these should be "Keep as-is"
    console.log('\n🔍 Degree-1 nodes currently predicted as "Merge degree-2" (should be "Keep as-is"):');
    
    const degree1Query = `
      SELECT 
        p.node_id,
        p.prediction,
        p.confidence,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat,
        (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) as degree
      FROM ${schema}.graphsage_predictions p
      JOIN ${schema}.ways_noded_vertices_pgr v ON v.id = p.node_id
      WHERE p.prediction = 1 
      AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) = 1
      ORDER BY p.node_id
      LIMIT 10
    `;
    
    const degree1Result = await pgClient.query(degree1Query);
    
    if (degree1Result.rows.length === 0) {
      console.log('   ✅ No degree-1 nodes predicted as "Merge degree-2" found');
    } else {
      console.log(`   Found ${degree1Result.rows.length} nodes (showing first 10):`);
      degree1Result.rows.forEach(node => {
        console.log(`   • Node ${node.node_id}: (${node.lat}, ${node.lng}) - degree ${node.degree} - confidence ${node.confidence}`);
      });
    }

    // Show degree-2 nodes that are predicted as "Keep as-is" - these might should be "Merge degree-2"
    console.log('\n🔍 Degree-2 nodes currently predicted as "Keep as-is" (might should be "Merge degree-2"):');
    
    const degree2Query = `
      SELECT 
        p.node_id,
        p.prediction,
        p.confidence,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat,
        (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) as degree
      FROM ${schema}.graphsage_predictions p
      JOIN ${schema}.ways_noded_vertices_pgr v ON v.id = p.node_id
      WHERE p.prediction = 0 
      AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) = 2
      ORDER BY p.node_id
      LIMIT 10
    `;
    
    const degree2Result = await pgClient.query(degree2Query);
    
    if (degree2Result.rows.length === 0) {
      console.log('   ✅ No degree-2 nodes predicted as "Keep as-is" found');
    } else {
      console.log(`   Found ${degree2Result.rows.length} nodes (showing first 10):`);
      degree2Result.rows.forEach(node => {
        console.log(`   • Node ${node.node_id}: (${node.lat}, ${node.lng}) - degree ${node.degree} - confidence ${node.confidence}`);
      });
    }

    // Show current summary
    console.log('\n📊 Current predictions summary:');
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

    console.log('\n🤔 Proposed fixes:');
    console.log(`   1. Change ${degree3Result.rows.length} degree-3+ nodes from "Keep as-is" → "Split Y/T"`);
    console.log(`   2. Change ${degree1Result.rows.length} degree-1 nodes from "Merge degree-2" → "Keep as-is"`);
    console.log(`   3. Consider changing ${degree2Result.rows.length} degree-2 nodes from "Keep as-is" → "Merge degree-2"`);

    console.log('\n❓ Do these fixes make sense?');
    console.log('   • Degree-3+ intersections should typically be split (Y/T intersections)');
    console.log('   • Degree-1 endpoints should typically be kept as-is (not merged)');
    console.log('   • Degree-2 connectors could be merged, but this depends on context');

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pgClient.end();
  }
}

previewFixes().catch(console.error);
