#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { CoordinateBasedGraphSAGEDataPreparationService, CoordinateGraphSAGEConfig } from '../services/graphsage/CoordinateBasedGraphSAGEDataPreparationService';

async function prepareCoordinateGraphSAGEData() {
  console.log('🚀 Preparing coordinate-based GraphSAGE training data...');
  
  // Database connection
  const pgClient = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db_test',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || 'your_password_here',
  });

  try {
    // Get the latest staging schema
    const schemaResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      throw new Error('No staging schema found');
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📊 Using staging schema: ${stagingSchema}`);
    
    // Configuration
    const config: CoordinateGraphSAGEConfig = {
      stagingSchema,
      trainRatio: 0.7,
      valRatio: 0.15,
      testRatio: 0.15,
      includeOptionalFeatures: false,
      coordinateTolerance: 0.0001 // ~10 meters
    };
    
    // Create the service
    const service = new CoordinateBasedGraphSAGEDataPreparationService(pgClient, config);
    
    // Prepare the dataset
    const dataset = await service.prepareDataset();
    
    // Export to JSON
    const timestamp = Date.now();
    const outputPath = `test-output/coordinate-graphsage-data-${stagingSchema}-${timestamp}.json`;
    
    await service.exportToJSON(dataset, outputPath);
    
    console.log('\n✅ Coordinate-based GraphSAGE data preparation complete!');
    console.log(`📁 Data exported to: ${outputPath}`);
    console.log('\n📊 Dataset Summary:');
    console.log(`   • Total nodes: ${dataset.nodes.length}`);
    console.log(`   • Total edges: ${dataset.edges.length}`);
    console.log(`   • Training nodes: ${dataset.train_mask.filter(Boolean).length}`);
    console.log(`   • Validation nodes: ${dataset.val_mask.filter(Boolean).length}`);
    console.log(`   • Test nodes: ${dataset.test_mask.filter(Boolean).length}`);
    
    // Count labels
    const labelCounts = dataset.node_labels.reduce((acc, label) => {
      acc[label.label] = (acc[label.label] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);
    
    console.log('\n🏷️  Label Distribution:');
    console.log(`   • Keep as-is (0): ${labelCounts[0] || 0}`);
    console.log(`   • Merge degree-2 (1): ${labelCounts[1] || 0}`);
    console.log(`   • Split Y/T (2): ${labelCounts[2] || 0}`);
    
    // Show expert cases that were matched
    const expertCases = [
      { lat: 39.927960000000006, lng: -105.27894, note: "node-316" },
      { lat: 39.93777, lng: -105.2946, note: "node-350" },
      { lat: 39.943575, lng: -105.27403500000001, note: "node-354" },
      { lat: 39.932865, lng: -105.25599000000001, note: "node-328" },
      { lat: 39.931200000000004, lng: -105.25729500000001, note: "node-325" },
      { lat: 39.930075, lng: -105.282585, note: "degree-2 merge case" },
    ];
    
    console.log('\n🎯 Expert Cases Matched:');
    for (const expertCase of expertCases) {
      const matchedNode = dataset.nodes.find(node => 
        Math.abs(node.y - expertCase.lat) < 0.0001 && 
        Math.abs(node.x - expertCase.lng) < 0.0001
      );
      
      if (matchedNode) {
        const label = dataset.node_labels.find(l => l.spatial_id === matchedNode.spatial_id);
        console.log(`   ✅ ${expertCase.note}: (${expertCase.lat}, ${expertCase.lng}) -> Label ${label?.label}`);
      } else {
        console.log(`   ❌ ${expertCase.note}: (${expertCase.lat}, ${expertCase.lng}) -> NOT FOUND`);
      }
    }
    
    return {
      outputPath,
      dataset,
      stagingSchema
    };
    
  } catch (error) {
    console.error('❌ Error preparing coordinate-based GraphSAGE data:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the function
if (require.main === module) {
  prepareCoordinateGraphSAGEData()
    .then(result => {
      console.log('\n🎉 Coordinate-based GraphSAGE data preparation successful!');
      console.log(`📁 Ready for training: ${result.outputPath}`);
    })
    .catch(error => {
      console.error('❌ Failed to prepare coordinate-based GraphSAGE data:', error);
      process.exit(1);
    });
}

export { prepareCoordinateGraphSAGEData };
