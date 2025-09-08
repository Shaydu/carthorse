#!/usr/bin/env python3
"""
GraphSAGE Training Script for Trail Network Analysis

This script loads the GraphSAGE data exported from PostGIS and trains
a GraphSAGE model for node classification tasks like:
- Node merging (degree-2 nodes)
- Y/T intersection splitting
- Network cleaning decisions

Usage:
    python scripts/graphsage/train_graphsage.py <path_to_json_data>
"""

import json
import torch
import torch.nn.functional as F
from torch_geometric.nn import GraphSAGE
from torch_geometric.data import Data
from torch_geometric.loader import DataLoader
import numpy as np
from sklearn.metrics import accuracy_score, classification_report
import argparse
import os
from typing import Dict, Any, Tuple

def load_graphsage_data(json_path: str) -> Data:
    """Load GraphSAGE data from JSON export"""
    print(f"📁 Loading GraphSAGE data from: {json_path}")
    
    with open(json_path, 'r') as f:
        data_dict = json.load(f)
    
    # Convert to PyTorch tensors
    x = torch.tensor(data_dict['x'], dtype=torch.float)
    edge_index = torch.tensor(data_dict['edge_index'], dtype=torch.long).view(2, -1)
    y = torch.tensor(data_dict['y'], dtype=torch.long)
    train_mask = torch.tensor(data_dict['train_mask'], dtype=torch.bool)
    val_mask = torch.tensor(data_dict['val_mask'], dtype=torch.bool)
    test_mask = torch.tensor(data_dict['test_mask'], dtype=torch.bool)
    
    # Create PyTorch Geometric Data object
    data = Data(
        x=x,
        edge_index=edge_index,
        y=y,
        train_mask=train_mask,
        val_mask=val_mask,
        test_mask=test_mask
    )
    
    print(f"✅ Loaded graph with {data.num_nodes} nodes and {data.num_edges} edges")
    print(f"   • Features: {data.num_node_features}")
    print(f"   • Classes: {data.y.max().item() + 1}")
    print(f"   • Training nodes: {train_mask.sum().item()}")
    print(f"   • Validation nodes: {val_mask.sum().item()}")
    print(f"   • Test nodes: {test_mask.sum().item()}")
    
    return data

class GraphSAGEModel(torch.nn.Module):
    """GraphSAGE model for node classification"""
    
    def __init__(self, num_features: int, num_classes: int, hidden_dim: int = 64):
        super(GraphSAGEModel, self).__init__()
        
        self.sage1 = GraphSAGE(num_features, hidden_dim, num_layers=2)
        self.sage2 = GraphSAGE(hidden_dim, hidden_dim, num_layers=2)
        self.classifier = torch.nn.Linear(hidden_dim, num_classes)
        self.dropout = torch.nn.Dropout(0.5)
        
    def forward(self, x, edge_index):
        # GraphSAGE layers
        x = F.relu(self.sage1(x, edge_index))
        x = self.dropout(x)
        x = F.relu(self.sage2(x, edge_index))
        x = self.dropout(x)
        
        # Classification head
        x = self.classifier(x)
        return x

def train_model(model: GraphSAGEModel, data: Data, epochs: int = 100) -> Dict[str, Any]:
    """Train the GraphSAGE model"""
    print(f"🚀 Training GraphSAGE model for {epochs} epochs...")
    
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01, weight_decay=5e-4)
    criterion = torch.nn.CrossEntropyLoss()
    
    train_losses = []
    val_accuracies = []
    
    model.train()
    for epoch in range(epochs):
        optimizer.zero_grad()
        
        # Forward pass
        out = model(data.x, data.edge_index)
        loss = criterion(out[data.train_mask], data.y[data.train_mask])
        
        # Backward pass
        loss.backward()
        optimizer.step()
        
        # Validation
        if epoch % 10 == 0:
            model.eval()
            with torch.no_grad():
                val_out = model(data.x, data.edge_index)
                val_pred = val_out[data.val_mask].argmax(dim=1)
                val_acc = (val_pred == data.y[data.val_mask]).float().mean()
                
                train_losses.append(loss.item())
                val_accuracies.append(val_acc.item())
                
                print(f"Epoch {epoch:3d}: Loss={loss.item():.4f}, Val Acc={val_acc.item():.4f}")
            
            model.train()
    
    return {
        'train_losses': train_losses,
        'val_accuracies': val_accuracies
    }

def evaluate_model(model: GraphSAGEModel, data: Data) -> Dict[str, Any]:
    """Evaluate the trained model"""
    print("📊 Evaluating model...")
    
    model.eval()
    with torch.no_grad():
        out = model(data.x, data.edge_index)
        
        # Test set evaluation
        test_pred = out[data.test_mask].argmax(dim=1)
        test_true = data.y[data.test_mask]
        test_acc = (test_pred == test_true).float().mean()
        
        # Full dataset predictions
        full_pred = out.argmax(dim=1)
        
        print(f"✅ Test Accuracy: {test_acc.item():.4f}")
        
        # Classification report
        print("\n📋 Classification Report:")
        print(classification_report(
            test_true.cpu().numpy(), 
            test_pred.cpu().numpy(),
            target_names=['Keep as-is', 'Merge degree-2', 'Split Y/T']
        ))
        
        return {
            'test_accuracy': test_acc.item(),
            'predictions': full_pred.cpu().numpy(),
            'test_predictions': test_pred.cpu().numpy(),
            'test_true': test_true.cpu().numpy()
        }

def save_predictions(predictions: np.ndarray, output_path: str, metadata: Dict[str, Any]):
    """Save model predictions back to JSON format for PostGIS import"""
    print(f"💾 Saving predictions to: {output_path}")
    
    # Create prediction data structure
    prediction_data = {
        'predictions': predictions.tolist(),
        'metadata': {
            **metadata,
            'model_type': 'GraphSAGE',
            'prediction_timestamp': torch.datetime.now().isoformat()
        }
    }
    
    with open(output_path, 'w') as f:
        json.dump(prediction_data, f, indent=2)
    
    print("✅ Predictions saved!")

def main():
    parser = argparse.ArgumentParser(description='Train GraphSAGE model for trail network analysis')
    parser.add_argument('data_path', help='Path to GraphSAGE JSON data file')
    parser.add_argument('--epochs', type=int, default=100, help='Number of training epochs')
    parser.add_argument('--hidden-dim', type=int, default=64, help='Hidden dimension size')
    parser.add_argument('--output-dir', default='test-output', help='Output directory for results')
    
    args = parser.parse_args()
    
    # Check if data file exists
    if not os.path.exists(args.data_path):
        print(f"❌ Data file not found: {args.data_path}")
        return
    
    # Load data
    data = load_graphsage_data(args.data_path)
    
    # Create model
    model = GraphSAGEModel(
        num_features=data.num_node_features,
        num_classes=data.y.max().item() + 1,
        hidden_dim=args.hidden_dim
    )
    
    print(f"🏗️  Model created with {sum(p.numel() for p in model.parameters())} parameters")
    
    # Train model
    training_history = train_model(model, data, args.epochs)
    
    # Evaluate model
    evaluation_results = evaluate_model(model, data)
    
    # Save predictions
    output_path = os.path.join(args.output_dir, 'graphsage_predictions.json')
    os.makedirs(args.output_dir, exist_ok=True)
    
    save_predictions(
        evaluation_results['predictions'],
        output_path,
        {
            'test_accuracy': evaluation_results['test_accuracy'],
            'num_nodes': data.num_nodes,
            'num_edges': data.num_edges,
            'num_features': data.num_node_features,
            'num_classes': data.y.max().item() + 1
        }
    )
    
    print(f"\n🎉 GraphSAGE training complete!")
    print(f"📁 Predictions saved to: {output_path}")
    print(f"\n🔧 Next steps:")
    print(f"   1. Import predictions back to PostGIS")
    print(f"   2. Apply network cleaning based on predictions")
    print(f"   3. Validate results and iterate")

if __name__ == '__main__':
    main()
