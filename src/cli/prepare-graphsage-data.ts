import { Pool } from 'pg';
import { GraphSAGEDataPreparationService } from '../services/graphsage/GraphSAGEDataPreparationService';
import { getDatabasePoolConfig } from '../utils/config-loader';
import * as path from 'path';

async function prepareGraphSAGEData() {
  console.log('🚀 GraphSAGE Data Preparation CLI');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node src/cli/prepare-graphsage-data.ts <schema_name>');
    process.exit(1);
  }

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Configure GraphSAGE data preparation
    const graphSAGEService = new GraphSAGEDataPreparationService(pgClient, {
      stagingSchema: schema,
      trainRatio: 0.7,  // 70% training
      valRatio: 0.15,   // 15% validation
      testRatio: 0.15,  // 15% test
      includeOptionalFeatures: false // Start simple, add more features later
    });

    console.log('🔍 Extracting GraphSAGE data from PostGIS...');
    const data = await graphSAGEService.extractGraphSAGEData();

    // Export to JSON for PyTorch Geometric
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join('test-output', `graphsage-data-${schema}-${timestamp}.json`);
    
    await graphSAGEService.exportToJSON(data, outputPath);

    // Print summary statistics
    console.log('\n📊 GraphSAGE Data Summary:');
    console.log(`   • Total nodes: ${data.nodes.length}`);
    console.log(`   • Total edges: ${data.edges.length}`);
    console.log(`   • Node features: 5 (x, y, z, degree, avg_incident_edge_length)`);
    console.log(`   • Training nodes: ${data.train_mask.filter(Boolean).length}`);
    console.log(`   • Validation nodes: ${data.val_mask.filter(Boolean).length}`);
    console.log(`   • Test nodes: ${data.test_mask.filter(Boolean).length}`);
    
    // Label distribution
    const nodeLabelCounts = data.node_labels.reduce((acc, label) => {
      acc[label.label] = (acc[label.label] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);
    
    console.log('\n🏷️  Node Label Distribution:');
    console.log(`   • Keep as-is (0): ${nodeLabelCounts[0] || 0}`);
    console.log(`   • Merge degree-2 (1): ${nodeLabelCounts[1] || 0}`);
    console.log(`   • Split Y/T (2): ${nodeLabelCounts[2] || 0}`);
    
    const edgeLabelCounts = data.edge_labels.reduce((acc, label) => {
      acc[label.label] = (acc[label.label] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);
    
    console.log('\n🔗 Edge Label Distribution:');
    console.log(`   • Valid (0): ${edgeLabelCounts[0] || 0}`);
    console.log(`   • Should merge (1): ${edgeLabelCounts[1] || 0}`);
    console.log(`   • Should delete (2): ${edgeLabelCounts[2] || 0}`);

    console.log(`\n✅ GraphSAGE data preparation complete!`);
    console.log(`📁 Data exported to: ${outputPath}`);
    console.log(`\n🔧 Next steps:`);
    console.log(`   1. Load the JSON data in PyTorch Geometric`);
    console.log(`   2. Train GraphSAGE model for node classification`);
    console.log(`   3. Apply predictions back to PostGIS for network cleaning`);

  } catch (error) {
    console.error('❌ Error preparing GraphSAGE data:', error);
  } finally {
    await pgClient.end();
  }
}

prepareGraphSAGEData().catch(console.error);

