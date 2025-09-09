#!/usr/bin/env python3
"""
Direct GraphSAGE Training Script for Trail Network Analysis

This script connects directly to PostgreSQL/PostGIS and trains GraphSAGE
without intermediate JSON files. It's more efficient for large networks
and allows for real-time training on live data.

Usage:
    python scripts/graphsage/train_graphsage_direct.py <schema_name> [--epochs 100]
"""

import torch
import torch.nn.functional as F
from torch_geometric.nn import GraphSAGE
from torch_geometric.data import Data
import numpy as np
import psycopg2
from sklearn.metrics import accuracy_score, classification_report
import argparse
import os
import random
from typing import Dict, Any, Tuple, List
import json

class PostGISGraphLoader:
    """Load graph data directly from PostGIS database"""
    
    def __init__(self, db_config: Dict[str, str]):
        self.db_config = db_config
        self.connection = None
    
    def connect(self):
        """Connect to PostgreSQL database"""
        self.connection = psycopg2.connect(**self.db_config)
        print("✅ Connected to PostgreSQL database")
    
    def disconnect(self):
        """Disconnect from database"""
        if self.connection:
            self.connection.close()
            print("✅ Disconnected from database")
    
    def load_graph_data(self, schema: str) -> Data:
        """Load graph data directly from PostGIS"""
        print(f"🔍 Loading graph data from schema: {schema}")
        
        cursor = self.connection.cursor()
        
        # Load node features
        print("   • Loading node features...")
        node_query = f"""
        WITH node_stats AS (
            SELECT 
                v.id,
                ST_X(v.the_geom) as x,
                ST_Y(v.the_geom) as y,
                ST_Z(v.the_geom) as z,
                COUNT(e.id) as degree,
                AVG(COALESCE(e.length_km, 0.1)) as avg_incident_edge_length
            FROM {schema}.ways_noded_vertices_pgr v
            LEFT JOIN {schema}.ways_noded e 
                ON (e.source = v.id OR e.target = v.id)
            GROUP BY v.id, v.the_geom
        )
        SELECT 
            id,
            x,
            y,
            z,
            degree,
            COALESCE(avg_incident_edge_length, 0.1) as avg_incident_edge_length
        FROM node_stats
        ORDER BY id
        """
        
        cursor.execute(node_query)
        node_rows = cursor.fetchall()
        
        # Convert to numpy arrays
        node_ids = [row[0] for row in node_rows]
        node_features = np.array([[row[1], row[2], row[3], row[4], row[5]] for row in node_rows], dtype=np.float32)
        
        # Create node ID to index mapping
        node_id_to_idx = {node_id: idx for idx, node_id in enumerate(node_ids)}
        
        print(f"   • Loaded {len(node_ids)} nodes")
        
        # Load edge data
        print("   • Loading edge data...")
        edge_query = f"""
        SELECT source, target
        FROM {schema}.ways_noded
        WHERE source IS NOT NULL AND target IS NOT NULL
        ORDER BY source, target
        """
        
        cursor.execute(edge_query)
        edge_rows = cursor.fetchall()
        
        # Convert to edge index tensor format
        edge_list = []
        for source, target in edge_rows:
            if source in node_id_to_idx and target in node_id_to_idx:
                edge_list.append([node_id_to_idx[source], node_id_to_idx[target]])
        
        edge_index = torch.tensor(edge_list, dtype=torch.long).t().contiguous()
        
        print(f"   • Loaded {len(edge_list)} edges")
        
        # Generate node labels based on topology
        print("   • Generating node labels...")
        node_labels = []
        for row in node_rows:
            degree = row[4]
            if degree == 2:
                label = 1  # Merge degree-2
            elif degree >= 4:
                label = 2  # Split Y/T intersection
            else:
                label = 0  # Keep as-is
            node_labels.append(label)
        
        y = torch.tensor(node_labels, dtype=torch.long)
        
        # Generate train/val/test masks
        print("   • Generating train/val/test masks...")
        num_nodes = len(node_ids)
        indices = list(range(num_nodes))
        random.shuffle(indices)
        
        train_end = int(num_nodes * 0.7)
        val_end = train_end + int(num_nodes * 0.15)
        
        train_mask = torch.zeros(num_nodes, dtype=torch.bool)
        val_mask = torch.zeros(num_nodes, dtype=torch.bool)
        test_mask = torch.zeros(num_nodes, dtype=torch.bool)
        
        train_mask[indices[:train_end]] = True
        val_mask[indices[train_end:val_end]] = True
        test_mask[indices[val_end:]] = True
        
        print(f"   • Training: {train_mask.sum().item()} nodes")
        print(f"   • Validation: {val_mask.sum().item()} nodes")
        print(f"   • Test: {test_mask.sum().item()} nodes")
        
        # Create PyTorch Geometric Data object
        x = torch.tensor(node_features, dtype=torch.float)
        
        data = Data(
            x=x,
            edge_index=edge_index,
            y=y,
            train_mask=train_mask,
            val_mask=val_mask,
            test_mask=test_mask
        )
        
        print(f"✅ Graph loaded: {data.num_nodes} nodes, {data.num_edges} edges")
        print(f"   • Features: {data.num_node_features}")
        print(f"   • Classes: {data.y.max().item() + 1}")
        
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

def save_predictions_to_db(predictions: np.ndarray, schema: str, db_config: Dict[str, str]):
    """Save model predictions back to PostGIS database"""
    print(f"💾 Saving predictions to PostGIS schema: {schema}")
    
    connection = psycopg2.connect(**db_config)
    cursor = connection.cursor()
    
    try:
        # Create predictions table
        create_table_query = f"""
        CREATE TABLE IF NOT EXISTS {schema}.graphsage_predictions (
            node_id INTEGER,
            prediction INTEGER,
            confidence REAL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        cursor.execute(create_table_query)
        
        # Clear existing predictions
        cursor.execute(f"DELETE FROM {schema}.graphsage_predictions")
        
        # Insert new predictions
        # Note: This is a simplified version - in practice you'd want to map back to actual node IDs
        for idx, pred in enumerate(predictions):
            cursor.execute(f"""
                INSERT INTO {schema}.graphsage_predictions (node_id, prediction, confidence)
                VALUES (%s, %s, %s)
            """, (idx, int(pred), 0.8))  # Simplified confidence score
        
        connection.commit()
        print(f"✅ Saved {len(predictions)} predictions to {schema}.graphsage_predictions")
        
    except Exception as e:
        print(f"❌ Error saving predictions: {e}")
        connection.rollback()
    finally:
        cursor.close()
        connection.close()

def main():
    parser = argparse.ArgumentParser(description='Train GraphSAGE model directly from PostGIS')
    parser.add_argument('schema', help='PostGIS schema name')
    parser.add_argument('--epochs', type=int, default=100, help='Number of training epochs')
    parser.add_argument('--hidden-dim', type=int, default=64, help='Hidden dimension size')
    parser.add_argument('--host', default='localhost', help='Database host')
    parser.add_argument('--port', default='5432', help='Database port')
    parser.add_argument('--database', default='trail_master_db', help='Database name')
    parser.add_argument('--user', default='postgres', help='Database user')
    parser.add_argument('--password', default='', help='Database password')
    
    args = parser.parse_args()
    
    # Database configuration
    db_config = {
        'host': args.host,
        'port': args.port,
        'database': args.database,
        'user': args.user,
        'password': args.password
    }
    
    # Load graph data directly from database
    loader = PostGISGraphLoader(db_config)
    try:
        loader.connect()
        data = loader.load_graph_data(args.schema)
        
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
        
        # Save predictions back to database
        save_predictions_to_db(
            evaluation_results['predictions'],
            args.schema,
            db_config
        )
        
        print(f"\n🎉 GraphSAGE training complete!")
        print(f"📊 Test Accuracy: {evaluation_results['test_accuracy']:.4f}")
        print(f"💾 Predictions saved to {args.schema}.graphsage_predictions")
        
    finally:
        loader.disconnect()

if __name__ == '__main__':
    main()

