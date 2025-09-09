# GraphSAGE for Trail Network Analysis

This directory contains the GraphSAGE implementation for analyzing and cleaning trail networks using graph neural networks.

## Overview

GraphSAGE (Graph Sample and Aggregate) is used to:
- **Node Classification**: Identify nodes that should be merged, split, or kept as-is
- **Edge Classification**: Identify edges that should be merged or deleted
- **Network Cleaning**: Automatically clean up trail network topology

## Files

- `train_graphsage.py` - Main training script for GraphSAGE model
- `requirements.txt` - Python dependencies
- `README.md` - This documentation

## Quick Start

### 1. Install Dependencies

```bash
cd scripts/graphsage
pip install -r requirements.txt
```

### 2. Prepare Data from PostGIS

```bash
# From the carthorse root directory
npx ts-node src/cli/prepare-graphsage-data.ts <schema_name>
```

This will export your PostGIS trail network data to a JSON format suitable for PyTorch Geometric.

### 3. Train GraphSAGE Model

```bash
python train_graphsage.py test-output/graphsage-data-<schema>-<timestamp>.json
```

### 4. Apply Predictions

The trained model will output predictions that can be imported back into PostGIS for network cleaning.

## Data Format

### Input (from PostGIS)
- **Nodes**: ID, coordinates (x,y,z), degree, average incident edge length
- **Edges**: Source, target, length
- **Labels**: 
  - Node labels: 0=keep, 1=merge degree-2, 2=split Y/T intersection
  - Edge labels: 0=valid, 1=should merge, 2=should delete

### Output (to PostGIS)
- **Predictions**: Node-level predictions for network cleaning decisions
- **Confidence scores**: Model confidence for each prediction

## Model Architecture

- **GraphSAGE layers**: 2 layers with ReLU activation
- **Hidden dimension**: 64 (configurable)
- **Dropout**: 0.5 for regularization
- **Optimizer**: Adam with learning rate 0.01
- **Loss**: Cross-entropy for multi-class classification

## Training Process

1. **Data Loading**: Load JSON data from PostGIS export
2. **Train/Val/Test Split**: 70%/15%/15% split
3. **Model Training**: 100 epochs (configurable)
4. **Evaluation**: Accuracy and classification report
5. **Prediction Export**: Save predictions for PostGIS import

## Configuration

### Data Preparation (TypeScript)
```typescript
const config = {
  stagingSchema: 'your_schema',
  trainRatio: 0.7,
  valRatio: 0.15,
  testRatio: 0.15,
  includeOptionalFeatures: false
};
```

### Model Training (Python)
```bash
python train_graphsage.py data.json --epochs 200 --hidden-dim 128
```

## Next Steps

1. **Feature Engineering**: Add more node/edge features (elevation, slope, trail type)
2. **Advanced Models**: Try Graph Attention Networks (GAT) or Graph Convolutional Networks (GCN)
3. **Multi-task Learning**: Train on both node and edge classification simultaneously
4. **Active Learning**: Iteratively improve the model with human feedback
5. **PostGIS Integration**: Create automated pipeline for applying predictions

## Troubleshooting

### Common Issues

1. **CUDA/GPU**: If you have GPU issues, the model will automatically fall back to CPU
2. **Memory**: For large networks, reduce batch size or use graph sampling
3. **Data Format**: Ensure your PostGIS export matches the expected JSON format

### Performance Tips

1. **Graph Sampling**: For very large networks, use neighborhood sampling
2. **Feature Scaling**: Normalize coordinates and edge lengths
3. **Class Balancing**: Handle imbalanced label distributions
4. **Hyperparameter Tuning**: Experiment with learning rates and model architecture

## References

- [GraphSAGE Paper](https://arxiv.org/abs/1706.02216)
- [PyTorch Geometric Documentation](https://pytorch-geometric.readthedocs.io/)
- [Graph Neural Networks for Network Analysis](https://distill.pub/2021/gnn-intro/)

