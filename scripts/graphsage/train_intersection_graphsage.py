#!/usr/bin/env python3
"""
GraphSAGE training script for intersection node classification.
Trains a model to classify nodes as:
- 0: keep (normal node)
- 1: merge degree-2 (should be merged out)
- 2: split Y/T intersection (should be split)
"""

import json
import torch
import torch.nn.functional as F
from torch_geometric.nn import SAGEConv
from torch_geometric.data import Data
import numpy as np
from sklearn.metrics import classification_report, confusion_matrix
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
import argparse
import sys
import os

# Add the project root to the path so we can import our modules
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))

class GraphSAGEModel(torch.nn.Module):
    """GraphSAGE model for node classification."""
    
    def __init__(self, num_features, hidden_dim=64, num_classes=3, num_layers=2):
        super(GraphSAGEModel, self).__init__()
        self.num_layers = num_layers
        self.convs = torch.nn.ModuleList()
        
        # First layer
        self.convs.append(SAGEConv(num_features, hidden_dim))
        
        # Hidden layers
        for _ in range(num_layers - 2):
            self.convs.append(SAGEConv(hidden_dim, hidden_dim))
        
        # Output layer
        self.convs.append(SAGEConv(hidden_dim, num_classes))
        
        self.dropout = torch.nn.Dropout(0.5)
        
    def forward(self, x, edge_index):
        for i, conv in enumerate(self.convs[:-1]):
            x = conv(x, edge_index)
            x = F.relu(x)
            x = self.dropout(x)
        
        x = self.convs[-1](x, edge_index)
        return F.log_softmax(x, dim=1)

def load_graphsage_data(json_path):
    """Load GraphSAGE data from JSON file."""
    print(f"Loading GraphSAGE data from {json_path}")
    
    with open(json_path, 'r') as f:
        data = json.load(f)
    
    # Convert to PyTorch tensors
    x = torch.tensor(data['x'], dtype=torch.float)
    edge_index = torch.tensor(data['edge_index'], dtype=torch.long).view(2, -1)
    y = torch.tensor(data['y'], dtype=torch.long)
    
    # Create masks
    train_mask = torch.tensor(data['train_mask'], dtype=torch.bool)
    val_mask = torch.tensor(data['val_mask'], dtype=torch.bool)
    test_mask = torch.tensor(data['test_mask'], dtype=torch.bool)
    
    # Create PyTorch Geometric Data object
    graph_data = Data(x=x, edge_index=edge_index, y=y)
    graph_data.train_mask = train_mask
    graph_data.val_mask = val_mask
    graph_data.test_mask = test_mask
    
    print(f"Loaded graph with {data['metadata']['num_nodes']} nodes and {data['metadata']['num_edges']} edges")
    print(f"Features: {data['metadata']['num_features']}")
    print(f"Training samples: {train_mask.sum().item()}")
    print(f"Validation samples: {val_mask.sum().item()}")
    print(f"Test samples: {test_mask.sum().item()}")
    
    return graph_data, data['metadata']

def train_model(model, data, optimizer, epochs=200):
    """Train the GraphSAGE model."""
    model.train()
    
    train_losses = []
    val_accuracies = []
    
    for epoch in range(epochs):
        optimizer.zero_grad()
        out = model(data.x, data.edge_index)
        loss = F.nll_loss(out[data.train_mask], data.y[data.train_mask])
        loss.backward()
        optimizer.step()
        
        # Validation
        model.eval()
        with torch.no_grad():
            val_out = model(data.x, data.edge_index)
            val_pred = val_out[data.val_mask].argmax(dim=1)
            val_acc = (val_pred == data.y[data.val_mask]).float().mean()
            val_accuracies.append(val_acc.item())
        
        model.train()
        train_losses.append(loss.item())
        
        if epoch % 20 == 0:
            print(f'Epoch {epoch:03d}, Loss: {loss:.4f}, Val Acc: {val_acc:.4f}')
    
    return train_losses, val_accuracies

def evaluate_model(model, data):
    """Evaluate the trained model."""
    model.eval()
    with torch.no_grad():
        out = model(data.x, data.edge_index)
        pred = out.argmax(dim=1)
        
        # Test set evaluation
        test_pred = pred[data.test_mask]
        test_true = data.y[data.test_mask]
        test_acc = (test_pred == test_true).float().mean()
        
        print(f'Test Accuracy: {test_acc:.4f}')
        
        # Classification report
        class_names = ['Keep', 'Merge Degree-2', 'Split Y/T']
        print("\nClassification Report:")
        print(classification_report(test_true, test_pred, target_names=class_names))
        
        # Confusion matrix
        cm = confusion_matrix(test_true, test_pred)
        print("\nConfusion Matrix:")
        print(cm)
        
        return pred, test_acc

def plot_training_history(train_losses, val_accuracies, output_dir):
    """Plot training history."""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))
    
    # Training loss
    ax1.plot(train_losses)
    ax1.set_title('Training Loss')
    ax1.set_xlabel('Epoch')
    ax1.set_ylabel('Loss')
    ax1.grid(True)
    
    # Validation accuracy
    ax2.plot(val_accuracies)
    ax2.set_title('Validation Accuracy')
    ax2.set_xlabel('Epoch')
    ax2.set_ylabel('Accuracy')
    ax2.grid(True)
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, 'training_history.png'), dpi=300, bbox_inches='tight')
    plt.close()

def plot_confusion_matrix(y_true, y_pred, output_dir):
    """Plot confusion matrix."""
    cm = confusion_matrix(y_true, y_pred)
    class_names = ['Keep', 'Merge Degree-2', 'Split Y/T']
    
    plt.figure(figsize=(8, 6))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', 
                xticklabels=class_names, yticklabels=class_names)
    plt.title('Confusion Matrix')
    plt.ylabel('True Label')
    plt.xlabel('Predicted Label')
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, 'confusion_matrix.png'), dpi=300, bbox_inches='tight')
    plt.close()

def save_predictions(predictions, metadata, output_path):
    """Save predictions to JSON file."""
    pred_data = {
        'predictions': predictions.tolist(),
        'metadata': metadata,
        'class_mapping': {
            0: 'keep',
            1: 'merge_degree_2', 
            2: 'split_y_t_intersection'
        }
    }
    
    with open(output_path, 'w') as f:
        json.dump(pred_data, f, indent=2)
    
    print(f"Predictions saved to {output_path}")

def main():
    parser = argparse.ArgumentParser(description='Train GraphSAGE model for intersection classification')
    parser.add_argument('--data', required=True, help='Path to GraphSAGE JSON data file')
    parser.add_argument('--output', default='./output', help='Output directory for results')
    parser.add_argument('--epochs', type=int, default=200, help='Number of training epochs')
    parser.add_argument('--hidden-dim', type=int, default=64, help='Hidden dimension size')
    parser.add_argument('--lr', type=float, default=0.01, help='Learning rate')
    parser.add_argument('--weight-decay', type=float, default=5e-4, help='Weight decay')
    
    args = parser.parse_args()
    
    # Create output directory
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Load data
    data, metadata = load_graphsage_data(args.data)
    
    # Create model
    num_features = data.x.size(1)
    num_classes = len(torch.unique(data.y))
    model = GraphSAGEModel(num_features, args.hidden_dim, num_classes)
    
    print(f"Model created with {num_features} input features and {num_classes} classes")
    print(f"Model parameters: {sum(p.numel() for p in model.parameters())}")
    
    # Setup training
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    
    # Train model
    print("Starting training...")
    train_losses, val_accuracies = train_model(model, data, optimizer, args.epochs)
    
    # Evaluate model
    print("\nEvaluating model...")
    predictions, test_acc = evaluate_model(model, data)
    
    # Save results
    print(f"\nSaving results to {output_dir}")
    
    # Save model
    torch.save(model.state_dict(), output_dir / 'model.pth')
    
    # Save predictions
    save_predictions(predictions, metadata, output_dir / 'predictions.json')
    
    # Plot results
    plot_training_history(train_losses, val_accuracies, output_dir)
    plot_confusion_matrix(data.y[data.test_mask], predictions[data.test_mask], output_dir)
    
    print(f"\nTraining completed!")
    print(f"Final test accuracy: {test_acc:.4f}")
    print(f"Results saved to: {output_dir}")

if __name__ == '__main__':
    main()