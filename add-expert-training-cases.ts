#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';

interface TrainingNode {
  node_id: string;
  coordinates: {
    lat: number;
    lng: number;
    elevation: number;
  };
  features: {
    degree: string;
    avg_incident_edge_length: number;
  };
  prediction: {
    value: number;
    label: string;
    confidence: number;
  };
}

interface TrainingDataset {
  metadata: {
    total_nodes: number;
    schema: string;
    generated_at: string;
    summary: Record<string, number>;
  };
  nodes: TrainingNode[];
}

// New expert training cases to add
const newExpertCases = [
  {
    coordinates: { lat: 39.927960000000006, lng: -105.27894, elevation: 0 },
    features: { degree: "2", avg_incident_edge_length: 1.5 },
    prediction: { value: 1, label: "Merge degree-2", confidence: 0.95 },
    note: "Expert case: degree-2 node should be merged"
  },
  {
    coordinates: { lat: 39.93777, lng: -105.2946, elevation: 0 },
    features: { degree: "2", avg_incident_edge_length: 1.8 },
    prediction: { value: 1, label: "Merge degree-2", confidence: 0.95 },
    note: "Expert case: degree-2 connector node should be merged"
  },
  {
    coordinates: { lat: 39.943575, lng: -105.27403500000001, elevation: 1856.12890625 },
    features: { degree: "2", avg_incident_edge_length: 2.1 },
    prediction: { value: 1, label: "Merge degree-2", confidence: 0.95 },
    note: "Expert case: degree-2 connector node should be merged"
  },
  {
    coordinates: { lat: 39.932865, lng: -105.25599000000001, elevation: 0 },
    features: { degree: "2", avg_incident_edge_length: 1.7 },
    prediction: { value: 1, label: "Merge degree-2", confidence: 0.95 },
    note: "Expert case: degree-2 connector node should be merged"
  },
  {
    coordinates: { lat: 39.931200000000004, lng: -105.25729500000001, elevation: 1759.3272705078125 },
    features: { degree: "2", avg_incident_edge_length: 1.9 },
    prediction: { value: 1, label: "Merge degree-2", confidence: 0.95 },
    note: "Expert case: degree-2 connector node should be merged"
  },
  {
    coordinates: { lat: 39.930075, lng: -105.282585, elevation: 1864.044921875 },
    features: { degree: "2", avg_incident_edge_length: 2.0 },
    prediction: { value: 1, label: "Merge degree-2", confidence: 0.95 },
    note: "Expert case: degree-2 node should be merged out and deleted with edges merged into 1"
  }
];

async function addExpertTrainingCases() {
  console.log('🔧 Adding expert training cases to the dataset...');
  
  // Load existing training dataset
  const datasetPath = 'test-output/complete-training-dataset-carthorse_1757362430748-2025-09-08T21-56-05-497Z.json';
  
  if (!fs.existsSync(datasetPath)) {
    console.error(`❌ Training dataset not found: ${datasetPath}`);
    return;
  }
  
  const dataset: TrainingDataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  console.log(`📊 Current dataset has ${dataset.nodes.length} nodes`);
  
  // Find the highest existing node ID to generate new IDs
  const maxNodeId = Math.max(...dataset.nodes.map(n => parseInt(n.node_id)));
  let nextNodeId = maxNodeId + 1;
  
  // Add new expert cases
  const addedNodes: TrainingNode[] = [];
  
  for (const expertCase of newExpertCases) {
    const newNode: TrainingNode = {
      node_id: nextNodeId.toString(),
      coordinates: expertCase.coordinates,
      features: expertCase.features,
      prediction: expertCase.prediction
    };
    
    dataset.nodes.push(newNode);
    addedNodes.push(newNode);
    nextNodeId++;
    
    console.log(`✅ Added expert case: Node ${newNode.node_id} at (${expertCase.coordinates.lat}, ${expertCase.coordinates.lng}) - ${expertCase.prediction.label}`);
  }
  
  // Update metadata
  dataset.metadata.total_nodes = dataset.nodes.length;
  dataset.metadata.generated_at = new Date().toISOString();
  
  // Update summary
  const summary = dataset.nodes.reduce((acc, node) => {
    const label = node.prediction.label;
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  dataset.metadata.summary = summary;
  
  // Save updated dataset
  const outputPath = `test-output/complete-training-dataset-with-expert-cases-${Date.now()}.json`;
  fs.writeFileSync(outputPath, JSON.stringify(dataset, null, 2));
  
  console.log(`\n📊 Updated dataset summary:`);
  console.log(`   • Total nodes: ${dataset.metadata.total_nodes}`);
  console.log(`   • Added expert cases: ${addedNodes.length}`);
  Object.entries(dataset.metadata.summary).forEach(([label, count]) => {
    console.log(`   • ${label}: ${count}`);
  });
  
  console.log(`\n💾 Updated dataset saved to: ${outputPath}`);
  
  // Also create a summary of the expert cases for reference
  const expertSummaryPath = `test-output/expert-training-cases-summary-${Date.now()}.json`;
  const expertSummary = {
    added_at: new Date().toISOString(),
    total_cases_added: addedNodes.length,
    cases: addedNodes.map(node => ({
      node_id: node.node_id,
      coordinates: node.coordinates,
      prediction: node.prediction,
      note: newExpertCases.find(c => 
        Math.abs(c.coordinates.lat - node.coordinates.lat) < 0.0001 &&
        Math.abs(c.coordinates.lng - node.coordinates.lng) < 0.0001
      )?.note
    }))
  };
  
  fs.writeFileSync(expertSummaryPath, JSON.stringify(expertSummary, null, 2));
  console.log(`📋 Expert cases summary saved to: ${expertSummaryPath}`);
  
  return {
    datasetPath: outputPath,
    expertSummaryPath,
    addedNodes: addedNodes.length
  };
}

// Run the function
if (require.main === module) {
  addExpertTrainingCases()
    .then(result => {
      console.log('\n🎉 Expert training cases added successfully!');
      console.log(`📁 Dataset: ${result?.datasetPath}`);
      console.log(`📋 Summary: ${result?.expertSummaryPath}`);
    })
    .catch(error => {
      console.error('❌ Error adding expert training cases:', error);
      process.exit(1);
    });
}

export { addExpertTrainingCases };

