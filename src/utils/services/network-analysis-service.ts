import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

export interface NetworkAnalysisConfig {
  stagingSchema: string;
  outputPath?: string; // Path for network analysis GeoJSON output
  includeTYIntersectionAnalysis?: boolean; // New flag for T/Y intersection analysis
  tyIntersectionTolerance?: number; // Tolerance for T/Y intersection detection
}

export interface NetworkAnalysisResult {
  success: boolean;
  error?: string;
  analysis?: {
    totalComponents: number;
    componentSizes: { [componentId: string]: number };
    disconnectedComponents: number;
    totalEdges: number;
    totalNodes: number;
    connectivityScore: number;
    tyIntersectionAnalysis?: {
      corruptedEdges: number;
      potentialTYIntersections: number;
      nearMissCandidates: number;
      recommendations: string[];
    };
  };
  visualizationPath?: string;
}

export class NetworkAnalysisService {
  private pgClient: Pool;
  private config: NetworkAnalysisConfig;

  constructor(pgClient: Pool, config: NetworkAnalysisConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  /**
   * Analyze network components and optionally perform T/Y intersection analysis
   */
  async analyzeNetworkComponents(): Promise<NetworkAnalysisResult> {
    try {
      console.log('🔍 Starting network components analysis...');

      // Basic network analysis
      const basicAnalysis = await this.performBasicNetworkAnalysis();
      
      // Optional T/Y intersection analysis
      let tyIntersectionAnalysis = undefined;
      if (this.config.includeTYIntersectionAnalysis) {
        console.log('🔍 Performing T/Y intersection edge case analysis...');
        tyIntersectionAnalysis = await this.performTYIntersectionAnalysis();
      }

      // Generate visualization
      const visualizationPath = await this.generateNetworkVisualization(basicAnalysis);

      return {
        success: true,
        analysis: {
          ...basicAnalysis,
          tyIntersectionAnalysis
        },
        visualizationPath
      };

    } catch (error) {
      console.error('❌ Network analysis failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Perform basic network connectivity analysis
   */
  private async performBasicNetworkAnalysis(): Promise<any> {
    // Get component distribution
    const componentQuery = `
      SELECT 
        edge_component,
        COUNT(*) as edge_count,
        COUNT(DISTINCT source) + COUNT(DISTINCT target) - COUNT(DISTINCT CASE WHEN source = target THEN source END) as node_count
      FROM ${this.config.stagingSchema}.routing_edges
      WHERE edge_component IS NOT NULL
      GROUP BY edge_component
      ORDER BY edge_component
    `;

    const componentResult = await this.pgClient.query(componentQuery);
    const components = componentResult.rows;

    // Calculate metrics
    const totalComponents = components.length;
    const totalEdges = components.reduce((sum, comp) => sum + parseInt(comp.edge_count), 0);
    const totalNodes = components.reduce((sum, comp) => sum + parseInt(comp.node_count), 0);
    const disconnectedComponents = totalComponents > 1 ? totalComponents - 1 : 0;
    
    // Calculate connectivity score (0-100, higher is better)
    const connectivityScore = totalComponents === 1 ? 100 : 
      Math.max(0, 100 - (disconnectedComponents * 20));

    const componentSizes: { [componentId: string]: number } = {};
    components.forEach(comp => {
      componentSizes[comp.edge_component] = parseInt(comp.edge_count);
    });

    return {
      totalComponents,
      componentSizes,
      disconnectedComponents,
      totalEdges,
      totalNodes,
      connectivityScore
    };
  }

  /**
   * Perform T/Y intersection edge case analysis
   */
  private async performTYIntersectionAnalysis(): Promise<any> {
    // Check for corrupted edges (undefined source/target)
    const corruptedEdgesQuery = `
      SELECT COUNT(*) as count
      FROM ${this.config.stagingSchema}.routing_edges
      WHERE source IS NULL OR target IS NULL OR edge_component = 'undefined'
    `;
    const corruptedResult = await this.pgClient.query(corruptedEdgesQuery);
    const corruptedEdges = parseInt(corruptedResult.rows[0].count);

    // Find potential T/Y intersections (nodes with 3+ connections to different components)
    const tyIntersectionQuery = `
      WITH node_connections AS (
        SELECT 
          source as node_id,
          edge_component,
          COUNT(*) as connections
        FROM ${this.config.stagingSchema}.routing_edges
        WHERE source IS NOT NULL AND edge_component IS NOT NULL
        GROUP BY source, edge_component
        
        UNION ALL
        
        SELECT 
          target as node_id,
          edge_component,
          COUNT(*) as connections
        FROM ${this.config.stagingSchema}.routing_edges
        WHERE target IS NOT NULL AND edge_component IS NOT NULL
        GROUP BY target, edge_component
      ),
      node_component_summary AS (
        SELECT 
          node_id,
          COUNT(DISTINCT edge_component) as component_count,
          SUM(connections) as total_connections
        FROM node_connections
        GROUP BY node_id
      )
      SELECT COUNT(*) as count
      FROM node_component_summary
      WHERE component_count > 1 AND total_connections >= 3
    `;
    const tyResult = await this.pgClient.query(tyIntersectionQuery);
    const potentialTYIntersections = parseInt(tyResult.rows[0].count);

    // Find near-miss intersection candidates
    const nearMissQuery = `
      SELECT COUNT(*) as count
      FROM ${this.config.stagingSchema}.routing_edges e1
      JOIN ${this.config.stagingSchema}.routing_edges e2 ON e1.id < e2.id
      WHERE e1.edge_component != e2.edge_component
        AND e1.edge_component IS NOT NULL
        AND e2.edge_component IS NOT NULL
    `;
    const nearMissResult = await this.pgClient.query(nearMissQuery);
    const nearMissCandidates = parseInt(nearMissResult.rows[0].count);

    // Generate recommendations
    const recommendations: string[] = [];
    
    if (corruptedEdges > 0) {
      recommendations.push(`Fix ${corruptedEdges} corrupted edges with undefined source/target values`);
    }
    
    if (potentialTYIntersections > 0) {
      recommendations.push(`Detect and split ${potentialTYIntersections} potential T/Y intersections`);
    }
    
    if (nearMissCandidates > 0) {
      recommendations.push(`Implement near-miss detection for ${nearMissCandidates} intersection candidates`);
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Network connectivity appears optimal - no T/Y intersection issues detected');
    }

    return {
      corruptedEdges,
      potentialTYIntersections,
      nearMissCandidates,
      recommendations
    };
  }

  /**
   * Generate network components visualization
   */
  private async generateNetworkVisualization(analysis: any): Promise<string> {
    try {
      // Get all edges with component information
      const edgesQuery = `
        SELECT 
          e.id,
          e.source,
          e.target,
          e.length_km,
          e.elevation_gain,
          e.elevation_loss,
          e.source_component,
          e.target_component,
          e.edge_component,
          t.name as trail_name,
          e.geometry
        FROM ${this.config.stagingSchema}.routing_edges e
        LEFT JOIN ${this.config.stagingSchema}.trails t ON e.trail_uuid = t.app_uuid
        WHERE e.geometry IS NOT NULL
        ORDER BY e.edge_component, e.id
      `;

      const edgesResult = await this.pgClient.query(edgesQuery);
      const edges = edgesResult.rows;

      // Generate colors for components
      const colors = [
        '#4ECDC4', '#F1948A', '#FF0000', '#00FF00', '#0000FF', 
        '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500', '#800080'
      ];

      // Create GeoJSON features
      const features = edges.map((edge, index) => {
        const componentId = edge.edge_component || 'undefined';
        const colorIndex = typeof componentId === 'number' ? componentId % colors.length : 0;
        const color = colors[colorIndex];

        return {
          type: 'Feature',
          properties: {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            length_km: edge.length_km,
            elevation_gain: edge.elevation_gain,
            elevation_loss: edge.elevation_loss,
            source_component: edge.source_component,
            target_component: edge.target_component,
            edge_component: edge.edge_component,
            trail_name: edge.trail_name,
            color: color,
            stroke: color,
            stroke_width: 2,
            type: 'edge'
          },
          geometry: edge.geometry
        };
      });

      // Create GeoJSON collection
      const geojson = {
        type: 'FeatureCollection',
        features: features
      };

      // Use provided output path or generate default
      let outputPath: string;
      if (this.config.outputPath) {
        // Replace the extension with -network-analysis.geojson
        const basePath = this.config.outputPath.replace(/\.geojson$/, '');
        outputPath = `${basePath}-network-analysis.geojson`;
      } else {
        // Default fallback
        const outputDir = 'test-output';
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        outputPath = path.join(outputDir, 'network-components-visualization.geojson');
      }

      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));

      console.log(`✅ Network analysis saved to: ${outputPath}`);
      return outputPath;

    } catch (error) {
      console.error('❌ Failed to generate network visualization:', error);
      throw error;
    }
  }
}
