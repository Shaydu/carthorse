import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

// Problem nodes from train-with-problem-nodes.ts
const problemNodeIds = [
  165, 351, 413, 849, 606, 589, 612, 580, -2, -3, 553, 552, 537, 77, 110, 105, 2, 109, 57, 52, 4, 576, 561, 574, 560, 577, 526, 542, 545, 502, 621, 540, 557, 149, 151, 89, 32, 16, 19, 40, 78, 53, 76, 65, 54, 106
];

async function lookupAllProblemNodes() {
  const schema = process.argv[2];
  
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.log('Usage: npx ts-node lookup-all-problem-nodes.ts <schema_name>');
    process.exit(1);
  }

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');
    console.log(`🔍 Looking up ${problemNodeIds.length} problem nodes in schema ${schema}\n`);

    const foundNodes = [];
    const missingNodes = [];

    for (const nodeId of problemNodeIds) {
      // Skip placeholder nodes
      if (nodeId < 0) {
        console.log(`⏭️  Skipping placeholder node ${nodeId}`);
        continue;
      }

      const query = `
        SELECT 
          id as node_id,
          ST_X(the_geom) as lng,
          ST_Y(the_geom) as lat,
          ST_Z(the_geom) as elevation,
          (SELECT COUNT(*) FROM ${schema}.ways_noded e WHERE e.source = v.id OR e.target = v.id) as degree
        FROM ${schema}.ways_noded_vertices_pgr v
        WHERE v.id = $1
      `;
      
      const result = await pgClient.query(query, [nodeId]);
      
      if (result.rows.length === 0) {
        console.log(`❌ Node ${nodeId}: NOT FOUND`);
        missingNodes.push(nodeId);
      } else {
        const node = result.rows[0];
        const nodeType = node.degree === 1 ? 'endpoint' : node.degree === 2 ? 'connector' : 'intersection';
        console.log(`✅ Node ${nodeId}: (${node.lat}, ${node.lng}) - degree ${node.degree} (${nodeType})`);
        foundNodes.push({
          node_id: nodeId,
          lat: node.lat,
          lng: node.lng,
          elevation: node.elevation,
          degree: node.degree,
          node_type: nodeType
        });
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   • Found: ${foundNodes.length} nodes`);
    console.log(`   • Missing: ${missingNodes.length} nodes`);
    
    if (missingNodes.length > 0) {
      console.log(`   • Missing node IDs: ${missingNodes.join(', ')}`);
    }

    // Generate updated problem nodes array with coordinates
    console.log(`\n🔧 Updated ProblemNode array with coordinates:`);
    console.log(`const problemNodes: ProblemNode[] = [`);
    
    for (const node of foundNodes) {
      // Determine correct label based on degree and context
      let correctLabel = 0; // default: keep as-is
      let reason = "Node found in dataset";
      
      if (node.degree === 2) {
        correctLabel = 1; // merge degree-2
        reason = "Degree-2 connector that should be merged";
      } else if (node.degree >= 3) {
        correctLabel = 2; // split Y/T
        reason = "Degree-3+ intersection that should be split";
      }
      
      console.log(`  {`);
      console.log(`    node_id: ${node.node_id},`);
      console.log(`    lat: ${node.lat},`);
      console.log(`    lng: ${node.lng},`);
      console.log(`    elevation: ${node.elevation},`);
      console.log(`    correct_label: ${correctLabel}, // ${correctLabel === 0 ? 'Keep as-is' : correctLabel === 1 ? 'Merge degree-2' : 'Split Y/T'}`);
      console.log(`    reason: "${reason}"`);
      console.log(`  },`);
    }
    
    console.log(`];`);

    // Also check which nodes are actually in the GraphSAGE predictions table
    console.log(`\n🔍 Checking GraphSAGE predictions table...`);
    
    for (const node of foundNodes.slice(0, 5)) { // Check first 5 nodes
      const predQuery = `
        SELECT prediction, confidence 
        FROM ${schema}.graphsage_predictions 
        WHERE node_id = $1
      `;
      
      try {
        const predResult = await pgClient.query(predQuery, [node.node_id]);
        
        if (predResult.rows.length > 0) {
          const pred = predResult.rows[0];
          const predLabel = ['Keep as-is', 'Merge degree-2', 'Split Y/T'][pred.prediction];
          console.log(`   • Node ${node.node_id}: ${predLabel} (confidence: ${pred.confidence.toFixed(3)})`);
        } else {
          console.log(`   • Node ${node.node_id}: No prediction found`);
        }
      } catch (error) {
        console.log(`   • Node ${node.node_id}: Error checking predictions - ${error instanceof Error ? error.message : String(error)}`);
      }
    }

  } catch (error) {
    console.error('❌ Error looking up problem nodes:', error);
  } finally {
    await pgClient.end();
  }
}

lookupAllProblemNodes().catch(console.error);
