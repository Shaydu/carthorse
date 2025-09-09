import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function findExistingProblemNodes() {
  const schema = 'carthorse_1757362430748';
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Get all nodes that exist in the database
    console.log('\n🔍 Finding all nodes in the database...');
    
    const allNodesQuery = `
      SELECT 
        id as node_id,
        ST_X(the_geom) as lng,
        ST_Y(the_geom) as lat,
        ST_Z(the_geom) as elevation,
        (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = v.id OR e.target = v.id) as degree
      FROM ${schema}.ways_noded_vertices_pgr v
      ORDER BY v.id
    `;
    
    const allNodesResult = await pgClient.query(allNodesQuery);
    console.log(`Found ${allNodesResult.rows.length} total nodes in database`);

    // Get all nodes that have predictions
    console.log('\n🔍 Finding nodes with predictions...');
    
    const predictionsQuery = `
      SELECT 
        p.node_id,
        p.prediction,
        p.confidence,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat,
        ST_Z(v.the_geom) as elevation,
        (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = v.id OR e.target = v.id) as degree
      FROM ${schema}.graphsage_predictions p
      JOIN ${schema}.ways_noded_vertices_pgr v ON v.id = p.node_id
      ORDER BY p.node_id
    `;
    
    const predictionsResult = await pgClient.query(predictionsQuery);
    console.log(`Found ${predictionsResult.rows.length} nodes with predictions`);

    // Analyze the predictions to find potentially problematic nodes
    console.log('\n🔍 Analyzing predictions to find problematic nodes...');
    
    const problematicNodes = [];
    const labelNames = ['Keep as-is', 'Merge degree-2', 'Split Y/T'];
    
    for (const node of predictionsResult.rows) {
      const nodeType = node.degree === 1 ? 'endpoint' : node.degree === 2 ? 'connector' : 'intersection';
      const currentLabel = labelNames[node.prediction];
      
      // Identify potentially problematic cases
      let isProblematic = false;
      let reason = '';
      let correctLabel = node.prediction;
      
      // Degree-2 nodes predicted as "Keep as-is" should probably be "Merge degree-2"
      if (node.degree === 2 && node.prediction === 0) {
        isProblematic = true;
        reason = "Degree-2 connector predicted as 'Keep as-is' but should be 'Merge degree-2'";
        correctLabel = 1;
      }
      // Degree-3+ nodes predicted as "Keep as-is" might need to be "Split Y/T"
      else if (node.degree >= 3 && node.prediction === 0) {
        isProblematic = true;
        reason = `Degree-${node.degree} intersection predicted as 'Keep as-is' but should be 'Split Y/T'`;
        correctLabel = 2;
      }
      // Degree-1 nodes predicted as "Merge degree-2" don't make sense
      else if (node.degree === 1 && node.prediction === 1) {
        isProblematic = true;
        reason = "Degree-1 endpoint predicted as 'Merge degree-2' but should be 'Keep as-is'";
        correctLabel = 0;
      }
      // Low confidence predictions might be wrong
      else if (node.confidence < 0.8) {
        isProblematic = true;
        reason = `Low confidence prediction (${node.confidence.toFixed(3)}) - needs review`;
        correctLabel = node.prediction; // Keep current prediction but flag for review
      }
      
      if (isProblematic) {
        problematicNodes.push({
          node_id: node.node_id,
          lat: node.lat,
          lng: node.lng,
          elevation: node.elevation,
          degree: node.degree,
          node_type: nodeType,
          current_prediction: node.prediction,
          current_label: currentLabel,
          confidence: node.confidence,
          correct_label: correctLabel,
          reason: reason
        });
      }
    }

    console.log(`\n📊 Found ${problematicNodes.length} potentially problematic nodes:`);
    
    for (const node of problematicNodes) {
      console.log(`\n🔍 Node ${node.node_id}: (${node.lat}, ${node.lng})`);
      console.log(`   • Type: degree ${node.degree} (${node.node_type})`);
      console.log(`   • Current: ${node.current_label} (confidence: ${node.confidence.toFixed(3)})`);
      console.log(`   • Should be: ${labelNames[node.correct_label]}`);
      console.log(`   • Reason: ${node.reason}`);
    }

    // Generate updated problem nodes array
    if (problematicNodes.length > 0) {
      console.log(`\n🔧 Generated ProblemNode array with coordinates:`);
      console.log(`const problemNodes: ProblemNode[] = [`);
      
      for (const node of problematicNodes) {
        console.log(`  {`);
        console.log(`    node_id: ${node.node_id},`);
        console.log(`    lat: ${node.lat},`);
        console.log(`    lng: ${node.lng},`);
        console.log(`    elevation: ${node.elevation},`);
        console.log(`    correct_label: ${node.correct_label}, // ${labelNames[node.correct_label]}`);
        console.log(`    reason: "${node.reason}"`);
        console.log(`  },`);
      }
      
      console.log(`];`);
    }

    // Show summary by prediction type
    console.log(`\n📈 Summary by current prediction:`);
    const summary: Record<string, { total: number; by_degree: Record<number, number> }> = {};
    for (const node of predictionsResult.rows) {
      const label = labelNames[node.prediction];
      if (!summary[label]) {
        summary[label] = { total: 0, by_degree: {} };
      }
      summary[label].total++;
      if (!summary[label].by_degree[node.degree]) {
        summary[label].by_degree[node.degree] = 0;
      }
      summary[label].by_degree[node.degree]++;
    }
    
    for (const [label, data] of Object.entries(summary)) {
      console.log(`   • ${label}: ${data.total} nodes`);
      for (const [degree, count] of Object.entries(data.by_degree)) {
        console.log(`     - Degree ${degree}: ${count} nodes`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pgClient.end();
  }
}

findExistingProblemNodes().catch(console.error);
