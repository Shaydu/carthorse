#!/usr/bin/env python3
"""
Balanced GraphSAGE Training Script for Trail Network Analysis

This script uses more conservative class weights to avoid over-predicting splits.
Expects ~1-2% of nodes to need Y/T splitting, not 50%!
"""

import json
import torch
import torch.nn.functional as F
from torch_geometric.nn import GraphSAGE
from torch_geometric.data import Data
import numpy as np
from sklearn.metrics import accuracy_score, classification_report
import argparse
import os
from typing import Dict, Any

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
    
    # Validate and filter edge indices
    num_nodes = x.size(0)
    print(f"🔍 Validating edge indices (max node index: {num_nodes - 1})...")
    
    # Check for invalid edge indices
    max_edge_index = edge_index.max().item()
    min_edge_index = edge_index.min().item()
    
    if max_edge_index >= num_nodes or min_edge_index < 0:
        print(f"⚠️  Found invalid edge indices: min={min_edge_index}, max={max_edge_index}")
        print(f"   Filtering out edges with invalid node indices...")
        
        # Filter out edges with invalid node indices
        valid_edges = (edge_index[0] < num_nodes) & (edge_index[1] < num_nodes) & (edge_index[0] >= 0) & (edge_index[1] >= 0)
        edge_index = edge_index[:, valid_edges]
        
        print(f"   ✅ Filtered to {edge_index.size(1)} valid edges (removed {valid_edges.sum().item() - edge_index.size(1)} invalid edges)")
    
    # Ensure edge indices are within valid range
    edge_index = torch.clamp(edge_index, 0, num_nodes - 1)
    
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

class BalancedGraphSAGEModel(torch.nn.Module):
    """Balanced GraphSAGE model with conservative predictions"""
    
    def __init__(self, num_features: int, num_classes: int, hidden_dim: int = 64):
        super(BalancedGraphSAGEModel, self).__init__()
        
        # Simpler architecture to avoid overfitting
        self.sage1 = GraphSAGE(num_features, hidden_dim, num_layers=2)
        self.sage2 = GraphSAGE(hidden_dim, hidden_dim, num_layers=2)
        
        # Classification head with dropout
        self.classifier = torch.nn.Sequential(
            torch.nn.Linear(hidden_dim, hidden_dim // 2),
            torch.nn.ReLU(),
            torch.nn.Dropout(0.2),
            torch.nn.Linear(hidden_dim // 2, num_classes)
        )
        
    def forward(self, x, edge_index):
        # GraphSAGE layers
        x = F.relu(self.sage1(x, edge_index))
        x = F.relu(self.sage2(x, edge_index))
        
        # Classification head
        x = self.classifier(x)
        return x

def train_model_balanced(model: BalancedGraphSAGEModel, data: Data, epochs: int = 100) -> Dict[str, Any]:
    """Train the balanced GraphSAGE model with conservative class weights"""
    print(f"🚀 Training balanced GraphSAGE model for {epochs} epochs...")
    
    # Use conservative class weights - don't over-weight minority classes
    # Target: ~1-2% splits, so we want to be conservative
    num_classes = data.y.max().item() + 1
    class_weights = torch.ones(num_classes, dtype=torch.float)
    
    # Only slightly increase weight for minority class to avoid over-prediction
    if num_classes >= 3:
        class_weights[2] = 1.5  # Only 1.5x weight for Split Y/T, not 3.4x!
    
    print(f"📊 Conservative class weights: {class_weights}")
    
    # Use weighted loss
    criterion = torch.nn.CrossEntropyLoss(weight=class_weights)
    
    # Conservative optimizer
    optimizer = torch.optim.Adam(model.parameters(), lr=0.005, weight_decay=1e-4)
    
    train_losses = []
    val_accuracies = []
    best_val_acc = 0
    patience_counter = 0
    
    model.train()
    for epoch in range(epochs):
        optimizer.zero_grad()
        
        # Forward pass
        out = model(data.x, data.edge_index)
        loss = criterion(out[data.train_mask], data.y[data.train_mask])
        
        # Backward pass
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
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
                
                # Early stopping
                if val_acc > best_val_acc:
                    best_val_acc = val_acc
                    patience_counter = 0
                else:
                    patience_counter += 1
                    
                if patience_counter >= 30:  # Stop if no improvement for 30 epochs
                    print(f"Early stopping at epoch {epoch}")
                    break
            
            model.train()
    
    return {
        'train_losses': train_losses,
        'val_accuracies': val_accuracies,
        'best_val_acc': best_val_acc
    }

def evaluate_model_balanced(model: BalancedGraphSAGEModel, data: Data) -> Dict[str, Any]:
    """Evaluate the trained model with detailed analysis"""
    print("📊 Evaluating balanced model...")
    
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
        
        # Detailed classification report
        print("\n📋 Detailed Classification Report:")
        unique_labels = torch.unique(torch.cat([test_true, test_pred])).cpu().numpy()
        target_names = ['Keep as-is', 'Merge degree-2', 'Split Y/T']
        available_names = [target_names[i] for i in unique_labels if i < len(target_names)]
        
        print(classification_report(
            test_true.cpu().numpy(), 
            test_pred.cpu().numpy(),
            labels=unique_labels,
            target_names=available_names,
            zero_division=0
        ))
        
        # Analyze predictions by class
        print("\n🔍 Prediction Analysis:")
        for class_id in range(data.y.max().item() + 1):
            class_mask = data.y == class_id
            if class_mask.sum() > 0:
                class_pred = full_pred[class_mask]
                class_true = data.y[class_mask]
                class_acc = (class_pred == class_true).float().mean()
                class_name = target_names[class_id] if class_id < len(target_names) else f"Class {class_id}"
                print(f"   {class_name}: {class_mask.sum().item()} nodes, accuracy: {class_acc.item():.3f}")
        
        # Count predictions
        pred_counts = {}
        for pred in full_pred:
            pred_counts[pred.item()] = pred_counts.get(pred.item(), 0) + 1
        
        print("\n📊 Prediction Distribution:")
        for class_id, count in sorted(pred_counts.items()):
            label = target_names[class_id] if class_id < len(target_names) else f"Class {class_id}"
            percentage = (count / len(full_pred)) * 100
            print(f"   {label}: {count} nodes ({percentage:.1f}%)")
        
        return {
            'test_accuracy': test_acc.item(),
            'predictions': full_pred.cpu().numpy(),
            'test_predictions': test_pred.cpu().numpy(),
            'test_true': test_true.cpu().numpy(),
            'prediction_counts': pred_counts
        }

def save_predictions(predictions: np.ndarray, output_path: str, metadata: Dict[str, Any]):
    """Save model predictions back to JSON format for PostGIS import"""
    print(f"💾 Saving predictions to: {output_path}")
    
    # Create prediction data structure
    prediction_data = {
        'predictions': predictions.tolist(),
        'metadata': {
            **metadata,
            'model_type': 'BalancedGraphSAGE',
            'prediction_timestamp': __import__('datetime').datetime.now().isoformat()
        }
    }
    
    with open(output_path, 'w') as f:
        json.dump(prediction_data, f, indent=2)
    
    print("✅ Predictions saved!")

def main():
    parser = argparse.ArgumentParser(description='Train balanced GraphSAGE model for trail network analysis')
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
    
    # Create balanced model
    model = BalancedGraphSAGEModel(
        num_features=data.num_node_features,
        num_classes=data.y.max().item() + 1,
        hidden_dim=args.hidden_dim
    )
    
    print(f"🏗️  Balanced model created with {sum(p.numel() for p in model.parameters())} parameters")
    
    # Train model
    training_history = train_model_balanced(model, data, args.epochs)
    
    # Evaluate model
    evaluation_results = evaluate_model_balanced(model, data)
    
    # Save predictions
    output_path = os.path.join(args.output_dir, 'balanced_graphsage_predictions.json')
    os.makedirs(args.output_dir, exist_ok=True)
    
    save_predictions(
        evaluation_results['predictions'],
        output_path,
        {
            'test_accuracy': float(evaluation_results['test_accuracy']),
            'num_nodes': int(data.num_nodes),
            'num_edges': int(data.num_edges),
            'num_features': int(data.num_node_features),
            'num_classes': int(data.y.max().item() + 1),
            'best_val_acc': float(training_history['best_val_acc']),
            'prediction_counts': evaluation_results['prediction_counts']
        }
    )
    
    print(f"\n🎉 Balanced GraphSAGE training complete!")
    print(f"📁 Predictions saved to: {output_path}")
    print(f"🏆 Best validation accuracy: {training_history['best_val_acc']:.4f}")
    
    # Check if we got reasonable split recommendations
    split_count = evaluation_results['prediction_counts'].get(2, 0)
    split_percentage = (split_count / data.num_nodes) * 100
    print(f"\n📊 Split Recommendations: {split_count} nodes ({split_percentage:.1f}%)")
    
    if split_percentage > 10:
        print("⚠️  WARNING: Still too many split recommendations!")
    elif split_percentage < 0.5:
        print("⚠️  WARNING: Too few split recommendations!")
    else:
        print("✅ Split recommendations look reasonable!")

if __name__ == '__main__':
    main()

