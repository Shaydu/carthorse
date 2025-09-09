import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';
import * as fs from 'fs';
import * as path from 'path';

async function createCoordinateList() {
  const schema = 'carthorse_1757362430748';
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Get all proposed changes with coordinates
    const query = `
      SELECT 
        p.node_id,
        p.prediction as current_prediction,
        p.confidence,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat,
        ST_Z(v.the_geom) as elevation,
        (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) as degree,
        CASE 
          WHEN p.prediction = 0 AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) >= 3 THEN 'degree3_to_split'
          WHEN p.prediction = 1 AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) = 1 THEN 'degree1_to_keep'
          WHEN p.prediction = 0 AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) = 2 THEN 'degree2_to_merge'
        END as change_type
      FROM ${schema}.graphsage_predictions p
      JOIN ${schema}.ways_noded_vertices_pgr v ON v.id = p.node_id
      WHERE (
        (p.prediction = 0 AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) >= 3) OR
        (p.prediction = 1 AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) = 1) OR
        (p.prediction = 0 AND (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = p.node_id OR e.target = p.node_id) = 2)
      )
      ORDER BY change_type, p.node_id
    `;
    
    const result = await pgClient.query(query);
    console.log(`Found ${result.rows.length} proposed changes`);

    // Create coordinate list
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join('test-output', `proposed-changes-coordinates-${schema}-${timestamp}.txt`);
    
    let output = `Proposed GraphSAGE Prediction Changes\n`;
    output += `Schema: ${schema}\n`;
    output += `Generated: ${new Date().toISOString()}\n`;
    output += `Total changes: ${result.rows.length}\n\n`;

    // Group by change type
    const degree3Changes = result.rows.filter(r => r.change_type === 'degree3_to_split');
    const degree1Changes = result.rows.filter(r => r.change_type === 'degree1_to_keep');
    const degree2Changes = result.rows.filter(r => r.change_type === 'degree2_to_merge');

    output += `=== DEGREE-3+ NODES: "Keep as-is" → "Split Y/T" (${degree3Changes.length} nodes) ===\n`;
    degree3Changes.forEach(node => {
      output += `Node ${node.node_id}: (${node.lat}, ${node.lng}) - degree ${node.degree} - confidence ${node.confidence}\n`;
    });

    output += `\n=== DEGREE-1 NODES: "Merge degree-2" → "Keep as-is" (${degree1Changes.length} nodes) ===\n`;
    degree1Changes.forEach(node => {
      output += `Node ${node.node_id}: (${node.lat}, ${node.lng}) - degree ${node.degree} - confidence ${node.confidence}\n`;
    });

    output += `\n=== DEGREE-2 NODES: "Keep as-is" → "Merge degree-2" (${degree2Changes.length} nodes) ===\n`;
    degree2Changes.forEach(node => {
      output += `Node ${node.node_id}: (${node.lat}, ${node.lng}) - degree ${node.degree} - confidence ${node.confidence}\n`;
    });

    fs.writeFileSync(outputPath, output);
    
    console.log(`\n✅ Created coordinate list: ${outputPath}`);
    console.log(`   • ${degree3Changes.length} degree-3+ nodes: "Keep as-is" → "Split Y/T"`);
    console.log(`   • ${degree1Changes.length} degree-1 nodes: "Merge degree-2" → "Keep as-is"`);
    console.log(`   • ${degree2Changes.length} degree-2 nodes: "Keep as-is" → "Merge degree-2"`);

    // Also show first few examples
    console.log(`\n📍 First few examples:`);
    console.log(`\nDegree-3+ nodes (should be split):`);
    degree3Changes.slice(0, 5).forEach(node => {
      console.log(`   • Node ${node.node_id}: (${node.lat}, ${node.lng})`);
    });

    if (degree1Changes.length > 0) {
      console.log(`\nDegree-1 nodes (should be kept):`);
      degree1Changes.forEach(node => {
        console.log(`   • Node ${node.node_id}: (${node.lat}, ${node.lng})`);
      });
    }

    if (degree2Changes.length > 0) {
      console.log(`\nDegree-2 nodes (might be merged):`);
      degree2Changes.slice(0, 5).forEach(node => {
        console.log(`   • Node ${node.node_id}: (${node.lat}, ${node.lng})`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pgClient.end();
  }
}

createCoordinateList().catch(console.error);
