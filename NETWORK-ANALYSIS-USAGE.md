# Network Analysis with T/Y Intersection Detection

## Overview

The `--analyze-network` flag has been enhanced to include comprehensive T/Y intersection analysis alongside the standard network components visualization. This helps identify edge cases where T/Y intersections are being missed in Layer 1 processing.

## Usage

### Basic Usage
```bash
# Run with network analysis enabled
carthorse --region boulder --out data/boulder.db --analyze-network

# Run with network analysis for GeoJSON export
carthorse --region boulder --out data/boulder.geojson --format geojson --analyze-network
```

### What It Does

When `--analyze-network` is enabled, the system will:

1. **Process all layers normally** (Layer 1, 2, 3)
2. **Generate network components visualization** (GeoJSON file)
3. **Perform T/Y intersection analysis** to identify edge cases
4. **Output detailed analysis results** to the console
5. **Save visualization files** alongside your main export

## Output Files

### Main Export
- Your normal export file (e.g., `boulder.db` or `boulder.geojson`)

### Network Analysis Files
- `network-components-visualization.geojson` - Color-coded network components
- Console output with detailed analysis

## Analysis Results

### Network Statistics
```
📊 Network Statistics:
   Total Components: 4
   Total Edges: 233
   Total Nodes: 121
   Connectivity Score: 40/100
   Disconnected Components: 3
```

### Component Distribution
```
📋 Component Distribution:
   Component 1: 110 edges
   Component 12: 10 edges
   Component 23: 1 edges
   Component undefined: 112 edges
```

### T/Y Intersection Analysis
```
🔍 T/Y Intersection Analysis:
   Corrupted Edges: 112
   Potential T/Y Intersections: 0
   Near-Miss Candidates: 1121
📋 Recommendations:
   • Fix 112 corrupted edges with undefined source/target values
   • Implement near-miss detection for 1121 intersection candidates
```

## Interpreting Results

### Good Network (Score 80-100)
- Single connected component
- No corrupted edges
- No T/Y intersection issues detected

### Issues Detected (Score < 80)
- **Multiple components**: Network is disconnected
- **Corrupted edges**: Data integrity issues
- **Potential T/Y intersections**: Edge cases not being detected
- **Near-miss candidates**: Trails that should connect but don't

## Common Issues and Solutions

### Issue: Multiple Disconnected Components
**Symptoms**: Multiple components with different colors
**Solution**: Implement enhanced T/Y intersection detection

### Issue: Corrupted Edges
**Symptoms**: "undefined" component with many edges
**Solution**: Fix component assignment logic

### Issue: Near-Miss Candidates
**Symptoms**: High number of near-miss candidates
**Solution**: Increase intersection tolerance or implement near-miss detection

## Example Output

```bash
$ carthorse --region boulder --out data/boulder.db --analyze-network

🚀 Starting 3-Layer route generation...
🛤️ LAYER 1: TRAILS - Building clean trail network...
✅ LAYER 1 COMPLETE: Clean trail network ready
🛤️ LAYER 2: EDGES - Building fully routable edge network...
✅ LAYER 2 COMPLETE: Fully routable edge network ready
🛤️ LAYER 3: ROUTES - Generating route recommendations...
✅ LAYER 3 COMPLETE: Route generation completed

🔍 Generating network components analysis...
✅ Network analysis completed successfully
📊 Network Statistics:
   Total Components: 4
   Total Edges: 233
   Total Nodes: 121
   Connectivity Score: 40/100
   Disconnected Components: 3

📋 Component Distribution:
   Component 1: 110 edges
   Component 12: 10 edges
   Component 23: 1 edges
   Component undefined: 112 edges

🔍 T/Y Intersection Analysis:
   Corrupted Edges: 112
   Potential T/Y Intersections: 0
   Near-Miss Candidates: 1121

📋 Recommendations:
   • Fix 112 corrupted edges with undefined source/target values
   • Implement near-miss detection for 1121 intersection candidates

🗺️ Visualization saved to: test-output/network-components-visualization.geojson
📁 Network visualization copied to: data/network-components-visualization.geojson

✅ 3-Layer route generation completed successfully!
```

## Visualization

The generated GeoJSON file can be opened in mapping tools like:
- QGIS
- Mapbox
- GeoJSON.io
- GitHub (drag and drop)

Each component is color-coded to help identify disconnected network segments.

## Troubleshooting

### No Analysis Output
- Ensure `--analyze-network` flag is included
- Check that Layer 2 completed successfully
- Verify routing_edges table exists in staging schema

### Missing Visualization File
- Check console output for file paths
- Ensure output directory is writable
- Look for error messages in the analysis section

### Poor Connectivity Score
- Review T/Y intersection recommendations
- Consider implementing enhanced intersection detection
- Check for data corruption issues

## Integration with Existing Workflow

The `--analyze-network` flag is designed to be:
- **Non-intrusive**: Doesn't affect normal processing
- **Optional**: Only runs when explicitly requested
- **Informative**: Provides actionable recommendations
- **Compatible**: Works with all export formats and options

This analysis helps identify when your Layer 1 T/Y intersection detection needs improvement without requiring changes to your core processing pipeline.
