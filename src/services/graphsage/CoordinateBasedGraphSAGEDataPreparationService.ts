import { Pool } from 'pg';

export interface CoordinateNodeFeatures {
  id: number;
  x: number; // longitude
  y: number; // latitude
  z: number; // elevation
  degree: number;
  avg_incident_edge_length: number;
  // Spatial features
  spatial_id: string; // "lat_lng" format for unique identification
}

export interface CoordinateEdgeFeatures {
  source_spatial_id: string;
  target_spatial_id: string;
  source_coords: { lat: number; lng: number };
  target_coords: { lat: number; lng: number };
  length: number;
  // Optional features
  trail_type?: string;
  surface?: string;
  classification?: string;
}

export interface CoordinateNodeLabels {
  spatial_id: string;
  label: number; // 0=keep, 1=merge degree-2, 2=split Y/T intersection
  coordinates: { lat: number; lng: number };
}

export interface CoordinateGraphSAGEData {
  nodes: CoordinateNodeFeatures[];
  edges: CoordinateEdgeFeatures[];
  node_labels: CoordinateNodeLabels[];
  train_mask: boolean[];
  test_mask: boolean[];
  val_mask: boolean[];
}

export interface CoordinateGraphSAGEConfig {
  stagingSchema: string;
  trainRatio: number;
  valRatio: number;
  testRatio: number;
  includeOptionalFeatures: boolean;
  coordinateTolerance: number; // meters - for matching coordinates
}

export class CoordinateBasedGraphSAGEDataPreparationService {
  private pgClient: Pool;
  private config: CoordinateGraphSAGEConfig;

  constructor(pgClient: Pool, config: CoordinateGraphSAGEConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  /**
   * Extract node features using coordinates instead of node IDs
   */
  async extractNodeFeatures(): Promise<CoordinateNodeFeatures[]> {
    console.log('🔍 Extracting coordinate-based node features from PostGIS...');
    
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
        COALESCE(avg_incident_edge_length, 0.1) as avg_incident_edge_length,
        CONCAT(ROUND(y::numeric, 6), '_', ROUND(x::numeric, 6)) as spatial_id
      FROM node_stats
      ORDER BY id
    `;

    const result = await this.pgClient.query(query);
    
    console.log(`✅ Extracted ${result.rows.length} coordinate-based node features`);
    return result.rows.map(row => ({
      id: row.id,
      x: row.x,
      y: row.y,
      z: row.z,
      degree: row.degree,
      avg_incident_edge_length: row.avg_incident_edge_length,
      spatial_id: row.spatial_id
    }));
  }

  /**
   * Extract edge features using coordinate-based connectivity
   */
  async extractEdgeFeatures(nodes: CoordinateNodeFeatures[]): Promise<CoordinateEdgeFeatures[]> {
    console.log('🔍 Extracting coordinate-based edge features from PostGIS...');
    
    // Create a mapping from node ID to spatial ID
    const nodeIdToSpatialId = new Map<number, string>();
    const spatialIdToCoords = new Map<string, { lat: number; lng: number }>();
    
    for (const node of nodes) {
      nodeIdToSpatialId.set(node.id, node.spatial_id);
      spatialIdToCoords.set(node.spatial_id, { lat: node.y, lng: node.x });
    }
    
    const query = `
      SELECT 
        e.source,
        e.target,
        COALESCE(e.length_km, 0.1) as length,
        ST_X(ST_StartPoint(e.the_geom)) as source_lng,
        ST_Y(ST_StartPoint(e.the_geom)) as source_lat,
        ST_X(ST_EndPoint(e.the_geom)) as target_lng,
        ST_Y(ST_EndPoint(e.the_geom)) as target_lat
        ${this.config.includeOptionalFeatures ? `
        , e.trail_type
        , e.surface
        , e.classification
        ` : ''}
      FROM ${this.config.stagingSchema}.ways_noded e
      WHERE e.source IS NOT NULL AND e.target IS NOT NULL
      ORDER BY e.source, e.target
    `;

    const result = await this.pgClient.query(query);
    
    const edges: CoordinateEdgeFeatures[] = [];
    
    for (const row of result.rows) {
      const sourceSpatialId = nodeIdToSpatialId.get(row.source);
      const targetSpatialId = nodeIdToSpatialId.get(row.target);
      
      if (sourceSpatialId && targetSpatialId) {
        edges.push({
          source_spatial_id: sourceSpatialId,
          target_spatial_id: targetSpatialId,
          source_coords: { lat: row.source_lat, lng: row.source_lng },
          target_coords: { lat: row.target_lat, lng: row.target_lng },
          length: row.length,
          ...(this.config.includeOptionalFeatures && {
            trail_type: row.trail_type,
            surface: row.surface,
            classification: row.classification
          })
        });
      }
    }
    
    console.log(`✅ Extracted ${edges.length} coordinate-based edge features`);
    return edges;
  }

  /**
   * Generate node labels based on network topology and expert knowledge
   */
  async generateNodeLabels(nodes: CoordinateNodeFeatures[]): Promise<CoordinateNodeLabels[]> {
    console.log('🏷️  Generating coordinate-based node labels...');
    
    const labels: CoordinateNodeLabels[] = [];
    
    // Expert training cases from the user's input
    const expertCases = [
      { lat: 39.927960000000006, lng: -105.27894, label: 1, note: "node-316: degree-2 should be merged" },
      { lat: 39.93777, lng: -105.2946, label: 1, note: "node-350: degree-2 connector should be merged" },
      { lat: 39.943575, lng: -105.27403500000001, label: 1, note: "node-354: degree-2 connector should be merged" },
      { lat: 39.932865, lng: -105.25599000000001, label: 1, note: "node-328: degree-2 connector should be merged" },
      { lat: 39.931200000000004, lng: -105.25729500000001, label: 1, note: "node-325: degree-2 connector should be merged" },
      { lat: 39.930075, lng: -105.282585, label: 1, note: "degree-2 should be merged out and deleted with edges merged into 1" },
    ];
    
    for (const node of nodes) {
      let label = 0; // Default: keep node as-is
      
      // Check if this node matches any expert case
      const expertCase = expertCases.find(expert => 
        Math.abs(expert.lat - node.y) < 0.0001 && 
        Math.abs(expert.lng - node.x) < 0.0001
      );
      
      if (expertCase) {
        label = expertCase.label;
        console.log(`   🎯 Expert case matched: Node at (${node.y}, ${node.x}) -> Label ${label}`);
      } else {
        // Apply heuristics for other nodes
        if (node.degree === 2) {
          // Degree-2 nodes are candidates for merging
          label = 1;
        } else if (node.degree >= 3) {
          // High-degree nodes might need Y/T intersection splitting
          if (node.degree >= 4) {
            label = 2;
          }
        }
      }
      
      labels.push({
        spatial_id: node.spatial_id,
        label: label,
        coordinates: { lat: node.y, lng: node.x }
      });
    }
    
    console.log(`✅ Generated labels for ${labels.length} nodes`);
    console.log(`   • Keep as-is (0): ${labels.filter(l => l.label === 0).length}`);
    console.log(`   • Merge degree-2 (1): ${labels.filter(l => l.label === 1).length}`);
    console.log(`   • Split Y/T (2): ${labels.filter(l => l.label === 2).length}`);
    
    return labels;
  }

  /**
   * Create train/validation/test splits
   */
  createDataSplits(nodes: CoordinateNodeFeatures[]): { train_mask: boolean[]; val_mask: boolean[]; test_mask: boolean[] } {
    console.log('📊 Creating train/validation/test splits...');
    
    const numNodes = nodes.length;
    const numTrain = Math.floor(numNodes * this.config.trainRatio);
    const numVal = Math.floor(numNodes * this.config.valRatio);
    const numTest = numNodes - numTrain - numVal;
    
    // Create masks
    const train_mask = new Array(numNodes).fill(false);
    const val_mask = new Array(numNodes).fill(false);
    const test_mask = new Array(numNodes).fill(false);
    
    // Shuffle indices
    const indices = Array.from({ length: numNodes }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    // Assign splits
    for (let i = 0; i < numTrain; i++) {
      train_mask[indices[i]] = true;
    }
    for (let i = numTrain; i < numTrain + numVal; i++) {
      val_mask[indices[i]] = true;
    }
    for (let i = numTrain + numVal; i < numNodes; i++) {
      test_mask[indices[i]] = true;
    }
    
    console.log(`✅ Created splits: Train=${numTrain}, Val=${numVal}, Test=${numTest}`);
    
    return { train_mask, val_mask, test_mask };
  }

  /**
   * Export data to JSON format for PyTorch Geometric
   */
  async exportToJSON(data: CoordinateGraphSAGEData, outputPath: string): Promise<string> {
    console.log('📁 Exporting coordinate-based GraphSAGE data to JSON...');
    
    const fs = require('fs');
    const path = require('path');
    
    // Ensure output directory exists
    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    }
    
    // Create spatial ID to index mapping
    const spatialIdToIndex = new Map<string, number>();
    data.nodes.forEach((node, index) => {
      spatialIdToIndex.set(node.spatial_id, index);
    });
    
    // Convert edges to edge_index format using spatial IDs
    const edgeIndex: number[] = [];
    for (const edge of data.edges) {
      const sourceIndex = spatialIdToIndex.get(edge.source_spatial_id);
      const targetIndex = spatialIdToIndex.get(edge.target_spatial_id);
      
      if (sourceIndex !== undefined && targetIndex !== undefined) {
        edgeIndex.push(sourceIndex, targetIndex);
      }
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
      
      // Edge connectivity: [2, num_edges] - using coordinate-based indices
      edge_index: edgeIndex,
      
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
        coordinate_based: true,
        generated_at: new Date().toISOString()
      }
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(pytorchData, null, 2));
    
    console.log(`✅ Exported coordinate-based GraphSAGE data to: ${outputPath}`);
    console.log(`   • Nodes: ${pytorchData.metadata.num_nodes}`);
    console.log(`   • Edges: ${pytorchData.metadata.num_edges}`);
    console.log(`   • Edge index length: ${edgeIndex.length / 2}`);
    
    return outputPath;
  }

  /**
   * Prepare complete GraphSAGE dataset using coordinates
   */
  async prepareDataset(): Promise<CoordinateGraphSAGEData> {
    console.log('🚀 Preparing coordinate-based GraphSAGE dataset...');
    
    // Extract node features
    const nodes = await this.extractNodeFeatures();
    
    // Extract edge features
    const edges = await this.extractEdgeFeatures(nodes);
    
    // Generate node labels
    const node_labels = await this.generateNodeLabels(nodes);
    
    // Create data splits
    const { train_mask, val_mask, test_mask } = this.createDataSplits(nodes);
    
    const dataset: CoordinateGraphSAGEData = {
      nodes,
      edges,
      node_labels,
      train_mask,
      val_mask,
      test_mask
    };
    
    console.log('✅ Coordinate-based GraphSAGE dataset prepared!');
    console.log(`   • Nodes: ${dataset.nodes.length}`);
    console.log(`   • Edges: ${dataset.edges.length}`);
    console.log(`   • Labels: ${dataset.node_labels.length}`);
    
    return dataset;
  }
}
