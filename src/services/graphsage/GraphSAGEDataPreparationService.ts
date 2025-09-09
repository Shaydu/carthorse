import { Pool } from 'pg';

export interface NodeFeatures {
  id: number;
  x: number; // longitude
  y: number; // latitude
  z: number; // elevation
  degree: number;
  avg_incident_edge_length: number;
  // Optional features we can add later
  elevation?: number;
  slope?: number;
  curvature?: number;
}

export interface EdgeFeatures {
  source: number;
  target: number;
  length: number;
  // Optional features
  trail_type?: string;
  surface?: string;
  classification?: string;
}

export interface NodeLabels {
  node_id: number;
  label: number; // 0=keep, 1=merge degree-2, 2=split Y/T intersection
}

export interface EdgeLabels {
  source: number;
  target: number;
  label: number; // 0=valid, 1=should merge, 2=should delete
}

export interface GraphSAGEData {
  nodes: NodeFeatures[];
  edges: EdgeFeatures[];
  node_labels: NodeLabels[];
  edge_labels: EdgeLabels[];
  train_mask: boolean[];
  test_mask: boolean[];
  val_mask: boolean[];
}

export interface GraphSAGEConfig {
  stagingSchema: string;
  trainRatio: number;
  valRatio: number;
  testRatio: number;
  includeOptionalFeatures: boolean;
}

export class GraphSAGEDataPreparationService {
  private pgClient: Pool;
  private config: GraphSAGEConfig;

  constructor(pgClient: Pool, config: GraphSAGEConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  /**
   * Extract node features from PostGIS staging schema
   */
  async extractNodeFeatures(): Promise<NodeFeatures[]> {
    console.log('🔍 Extracting node features from PostGIS...');
    
    const query = `
      WITH node_stats AS (
        SELECT 
          v.id,
          ST_X(v.the_geom) as x,
          ST_Y(v.the_geom) as y,
          ST_Z(v.the_geom) as z,
          COUNT(e.id) as degree,
          AVG(COALESCE(e.length_km, 0.1)) as avg_incident_edge_length
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN ${this.config.stagingSchema}.ways_noded e 
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
    `;

    const result = await this.pgClient.query(query);
    
    console.log(`✅ Extracted ${result.rows.length} node features`);
    return result.rows;
  }

  /**
   * Extract edge features from PostGIS staging schema
   */
  async extractEdgeFeatures(): Promise<EdgeFeatures[]> {
    console.log('🔍 Extracting edge features from PostGIS...');
    
    const query = `
      SELECT 
        source,
        target,
        COALESCE(length_km, 0.1) as length
        ${this.config.includeOptionalFeatures ? `
        , trail_type
        , surface
        , classification
        ` : ''}
      FROM ${this.config.stagingSchema}.ways_noded
      WHERE source IS NOT NULL AND target IS NOT NULL
      ORDER BY source, target
    `;

    const result = await this.pgClient.query(query);
    
    console.log(`✅ Extracted ${result.rows.length} edge features`);
    return result.rows;
  }

  /**
   * Generate node labels based on network topology
   */
  async generateNodeLabels(nodes: NodeFeatures[]): Promise<NodeLabels[]> {
    console.log('🏷️  Generating node labels based on topology...');
    
    const labels: NodeLabels[] = [];
    
    for (const node of nodes) {
      let label = 0; // Default: keep node as-is
      
      if (node.degree === 2) {
        // Degree-2 nodes are candidates for merging
        label = 1;
      } else if (node.degree >= 3) {
        // High-degree nodes might need Y/T intersection splitting
        // This is a simple heuristic - you can make this more sophisticated
        if (node.degree >= 4) {
          label = 2;
        }
      }
      
      labels.push({
        node_id: node.id,
        label: label
      });
    }
    
    console.log(`✅ Generated labels for ${labels.length} nodes`);
    console.log(`   • Keep as-is (0): ${labels.filter(l => l.label === 0).length}`);
    console.log(`   • Merge degree-2 (1): ${labels.filter(l => l.label === 1).length}`);
    console.log(`   • Split Y/T (2): ${labels.filter(l => l.label === 2).length}`);
    
    return labels;
  }

  /**
   * Generate edge labels based on network topology
   */
  async generateEdgeLabels(edges: EdgeFeatures[], nodes: NodeFeatures[]): Promise<EdgeLabels[]> {
    console.log('🏷️  Generating edge labels based on topology...');
    
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const labels: EdgeLabels[] = [];
    
    for (const edge of edges) {
      let label = 0; // Default: valid edge
      
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      
      if (sourceNode && targetNode) {
        // Simple heuristics for edge labeling
        if (sourceNode.degree === 2 && targetNode.degree === 2) {
          // Both endpoints are degree-2, might be a candidate for merging
          label = 1;
        } else if (edge.length < 0.01) { // Very short edges (10m)
          // Very short edges might be artifacts
          label = 2;
        }
      }
      
      labels.push({
        source: edge.source,
        target: edge.target,
        label: label
      });
    }
    
    console.log(`✅ Generated labels for ${labels.length} edges`);
    console.log(`   • Valid (0): ${labels.filter(l => l.label === 0).length}`);
    console.log(`   • Should merge (1): ${labels.filter(l => l.label === 1).length}`);
    console.log(`   • Should delete (2): ${labels.filter(l => l.label === 2).length}`);
    
    return labels;
  }

  /**
   * Generate train/validation/test masks
   */
  generateMasks(nodeCount: number): { train_mask: boolean[], val_mask: boolean[], test_mask: boolean[] } {
    console.log('🎭 Generating train/validation/test masks...');
    
    const train_mask = new Array(nodeCount).fill(false);
    const val_mask = new Array(nodeCount).fill(false);
    const test_mask = new Array(nodeCount).fill(false);
    
    // Simple random split
    const indices = Array.from({ length: nodeCount }, (_, i) => i);
    const shuffled = indices.sort(() => Math.random() - 0.5);
    
    const trainEnd = Math.floor(nodeCount * this.config.trainRatio);
    const valEnd = trainEnd + Math.floor(nodeCount * this.config.valRatio);
    
    // Assign masks
    for (let i = 0; i < trainEnd; i++) {
      train_mask[shuffled[i]] = true;
    }
    
    for (let i = trainEnd; i < valEnd; i++) {
      val_mask[shuffled[i]] = true;
    }
    
    for (let i = valEnd; i < nodeCount; i++) {
      test_mask[shuffled[i]] = true;
    }
    
    console.log(`✅ Generated masks for ${nodeCount} nodes`);
    console.log(`   • Training: ${train_mask.filter(Boolean).length} nodes`);
    console.log(`   • Validation: ${val_mask.filter(Boolean).length} nodes`);
    console.log(`   • Test: ${test_mask.filter(Boolean).length} nodes`);
    
    return { train_mask, val_mask, test_mask };
  }

  /**
   * Main method to extract all GraphSAGE data
   */
  async extractGraphSAGEData(): Promise<GraphSAGEData> {
    console.log('🚀 Starting GraphSAGE data extraction...');
    console.log(`   Schema: ${this.config.stagingSchema}`);
    console.log(`   Train/Val/Test ratios: ${this.config.trainRatio}/${this.config.valRatio}/${this.config.testRatio}`);
    
    // Extract features
    const nodes = await this.extractNodeFeatures();
    const edges = await this.extractEdgeFeatures();
    
    // Generate labels
    const node_labels = await this.generateNodeLabels(nodes);
    const edge_labels = await this.generateEdgeLabels(edges, nodes);
    
    // Generate masks
    const { train_mask, val_mask, test_mask } = this.generateMasks(nodes.length);
    
    const data: GraphSAGEData = {
      nodes,
      edges,
      node_labels,
      edge_labels,
      train_mask,
      val_mask,
      test_mask
    };
    
    console.log('✅ GraphSAGE data extraction complete!');
    console.log(`   • Nodes: ${nodes.length}`);
    console.log(`   • Edges: ${edges.length}`);
    console.log(`   • Node labels: ${node_labels.length}`);
    console.log(`   • Edge labels: ${edge_labels.length}`);
    
    return data;
  }

  /**
   * Export data to JSON format for PyTorch Geometric
   */
  async exportToJSON(data: GraphSAGEData, outputPath: string): Promise<string> {
    console.log('📁 Exporting GraphSAGE data to JSON...');
    
    const fs = require('fs');
    const path = require('path');
    
    // Ensure output directory exists
    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    }
    
    // Prepare data for PyTorch Geometric format
    const pytorchData = {
      // Node features: [num_nodes, num_features]
      x: data.nodes.map(node => [
        Number(node.x), 
        Number(node.y), 
        Number(node.z), 
        Number(node.degree), 
        Number(node.avg_incident_edge_length)
      ]),
      
      // Edge connectivity: [2, num_edges]
      edge_index: data.edges.map(edge => [Number(edge.source), Number(edge.target)]).flat(),
      
      // Node labels
      y: data.node_labels.map(label => Number(label.label)),
      
      // Masks
      train_mask: data.train_mask,
      val_mask: data.val_mask,
      test_mask: data.test_mask,
      
      // Metadata
      metadata: {
        num_nodes: data.nodes.length,
        num_edges: data.edges.length,
        num_features: 5, // x, y, z, degree, avg_incident_edge_length
        schema: this.config.stagingSchema,
        generated_at: new Date().toISOString()
      }
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(pytorchData, null, 2));
    
    console.log(`✅ Exported GraphSAGE data to: ${outputPath}`);
    return outputPath;
  }
}
