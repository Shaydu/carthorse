import { Pool } from 'pg';
import * as NetworkX from 'networkx';
import * as numpy from 'numpy';

export interface TrailNetworkGraph {
  nodes: TrailNode[];
  edges: TrailEdge[];
  metadata: NetworkMetadata;
}

export interface TrailNode {
  id: string;
  lat: number;
  lng: number;
  elevation?: number;
  degree: number;
  isIntersection: boolean;
  features: number[]; // ML feature vector
}

export interface TrailEdge {
  id: string;
  source: string;
  target: string;
  length: number;
  elevationGain: number;
  trailName?: string;
  features: number[]; // ML feature vector
}

export interface NetworkMetadata {
  totalNodes: number;
  totalEdges: number;
  connectedComponents: number;
  averageDegree: number;
  networkDensity: number;
  region: string;
}

export interface LoopRecommendation {
  loopId: string;
  nodes: string[];
  edges: string[];
  totalLength: number;
  totalElevationGain: number;
  qualityScore: number;
  mlScore: number;
  confidence: number;
  reasoning: string[];
}

export interface HuggingFaceConfig {
  modelName: string;
  useGPU: boolean;
  batchSize: number;
  maxSequenceLength: number;
  confidenceThreshold: number;
  enableGraphNeuralNetworks: boolean;
  enableSequenceAnalysis: boolean;
  enableQualityScoring: boolean;
}

export class HuggingFaceNetworkAnalyzer {
  private pgClient: Pool;
  private stagingSchema: string;
  private config: HuggingFaceConfig;
  private networkGraph: TrailNetworkGraph | null = null;

  constructor(
    pgClient: Pool,
    stagingSchema: string,
    config: HuggingFaceConfig
  ) {
    this.pgClient = pgClient;
    this.stagingSchema = stagingSchema;
    this.config = config;
  }

  /**
   * Load trail network data from database and convert to graph format
   */
  async loadTrailNetwork(): Promise<TrailNetworkGraph> {
    console.log('🤖 [HF-ANALYZER] Loading trail network for ML analysis...');

    try {
      // Load nodes from routing_nodes
      const nodesResult = await this.pgClient.query(`
        SELECT 
          id,
          lat,
          lng,
          elevation,
          (
            SELECT COUNT(*) 
            FROM ${this.stagingSchema}.routing_edges 
            WHERE source = rn.id OR target = rn.id
          ) as degree
        FROM ${this.stagingSchema}.routing_nodes rn
        ORDER BY id
      `);

      // Load edges from routing_edges
      const edgesResult = await this.pgClient.query(`
        SELECT 
          id,
          source,
          target,
          length_km as length,
          elevation_gain as elevation_gain,
          trail_name
        FROM ${this.stagingSchema}.routing_edges
        WHERE source IS NOT NULL AND target IS NOT NULL
        ORDER BY id
      `);

      // Convert to our graph format
      const nodes: TrailNode[] = nodesResult.rows.map(row => ({
        id: row.id.toString(),
        lat: parseFloat(row.lat),
        lng: parseFloat(row.lng),
        elevation: row.elevation ? parseFloat(row.elevation) : undefined,
        degree: parseInt(row.degree),
        isIntersection: parseInt(row.degree) >= 3,
        features: this.extractNodeFeatures(row)
      }));

      const edges: TrailEdge[] = edgesResult.rows.map(row => ({
        id: row.id.toString(),
        source: row.source.toString(),
        target: row.target.toString(),
        length: parseFloat(row.length),
        elevationGain: parseFloat(row.elevation_gain || 0),
        trailName: row.trail_name,
        features: this.extractEdgeFeatures(row)
      }));

      // Calculate network metadata
      const metadata = await this.calculateNetworkMetadata(nodes, edges);

      this.networkGraph = {
        nodes,
        edges,
        metadata
      };

      console.log(`✅ [HF-ANALYZER] Loaded network: ${nodes.length} nodes, ${edges.length} edges`);
      return this.networkGraph;

    } catch (error) {
      console.error('❌ [HF-ANALYZER] Error loading trail network:', error);
      throw error;
    }
  }

  /**
   * Extract ML features for a node
   */
  private extractNodeFeatures(node: any): number[] {
    return [
      node.lat,
      node.lng,
      node.elevation || 0,
      node.degree,
      node.degree >= 3 ? 1 : 0, // isIntersection
      node.degree >= 4 ? 1 : 0, // isMajorIntersection
      Math.log(node.degree + 1), // log degree for normalization
    ];
  }

  /**
   * Extract ML features for an edge
   */
  private extractEdgeFeatures(edge: any): number[] {
    return [
      edge.length,
      edge.elevation_gain || 0,
      edge.elevation_gain / Math.max(edge.length, 0.001), // elevation gain rate
      edge.trail_name ? 1 : 0, // has name
      edge.trail_name ? edge.trail_name.length : 0, // name length
    ];
  }

  /**
   * Calculate network metadata
   */
  private async calculateNetworkMetadata(nodes: TrailNode[], edges: TrailEdge[]): Promise<NetworkMetadata> {
    const totalNodes = nodes.length;
    const totalEdges = edges.length;
    const averageDegree = totalNodes > 0 ? (2 * totalEdges) / totalNodes : 0;
    const networkDensity = totalNodes > 1 ? (2 * totalEdges) / (totalNodes * (totalNodes - 1)) : 0;

    // Count connected components using a simple approach
    const connectedComponents = await this.countConnectedComponents(nodes, edges);

    // Get region from staging schema
    const region = this.stagingSchema.split('_')[1] || 'unknown';

    return {
      totalNodes,
      totalEdges,
      connectedComponents,
      averageDegree,
      networkDensity,
      region
    };
  }

  /**
   * Count connected components in the network
   */
  private async countConnectedComponents(nodes: TrailNode[], edges: TrailEdge[]): Promise<number> {
    try {
      // Use NetworkX to find connected components
      const G = new NetworkX.Graph();
      
      // Add nodes
      nodes.forEach(node => G.addNode(node.id));
      
      // Add edges
      edges.forEach(edge => G.addEdge(edge.source, edge.target));
      
      // Find connected components
      const components = NetworkX.connectedComponents(G);
      return components.length;
    } catch (error) {
      console.warn('⚠️ [HF-ANALYZER] Could not calculate connected components:', error);
      return 1; // Fallback
    }
  }

  /**
   * Analyze network topology using graph neural networks
   */
  async analyzeNetworkTopology(): Promise<any> {
    if (!this.networkGraph) {
      throw new Error('Network not loaded. Call loadTrailNetwork() first.');
    }

    console.log('🧠 [HF-ANALYZER] Analyzing network topology with ML models...');

    try {
      // Convert to NetworkX graph for analysis
      const G = new NetworkX.Graph();
      
      // Add nodes with features
      this.networkGraph.nodes.forEach(node => {
        G.addNode(node.id, {
          features: node.features,
          lat: node.lat,
          lng: node.lng,
          elevation: node.elevation,
          degree: node.degree,
          isIntersection: node.isIntersection
        });
      });
      
      // Add edges with features
      this.networkGraph.edges.forEach(edge => {
        G.addEdge(edge.source, edge.target, {
          features: edge.features,
          length: edge.length,
          elevationGain: edge.elevationGain,
          trailName: edge.trailName
        });
      });

      // Analyze network properties
      const analysis = {
        // Basic network metrics
        numberOfNodes: G.numberOfNodes(),
        numberOfEdges: G.numberOfEdges(),
        density: NetworkX.density(G),
        averageClustering: NetworkX.averageClustering(G),
        
        // Centrality measures
        degreeCentrality: NetworkX.degreeCentrality(G),
        betweennessCentrality: NetworkX.betweennessCentrality(G),
        closenessCentrality: NetworkX.closenessCentrality(G),
        
        // Path analysis
        averageShortestPathLength: this.calculateAverageShortestPathLength(G),
        
        // Component analysis
        connectedComponents: NetworkX.connectedComponents(G),
        numberOfConnectedComponents: NetworkX.numberOfConnectedComponents(G),
        
        // Cycle detection
        cycles: this.findSimpleCycles(G),
        
        // ML-enhanced insights
        mlInsights: await this.generateMLInsights(G)
      };

      console.log(`✅ [HF-ANALYZER] Network analysis complete: ${analysis.numberOfNodes} nodes, ${analysis.numberOfEdges} edges`);
      return analysis;

    } catch (error) {
      console.error('❌ [HF-ANALYZER] Error analyzing network topology:', error);
      throw error;
    }
  }

  /**
   * Calculate average shortest path length
   */
  private calculateAverageShortestPathLength(G: NetworkX.Graph): number {
    try {
      if (G.numberOfNodes() === 0) return 0;
      
      // For large graphs, sample a subset of nodes
      const nodes = Array.from(G.nodes());
      const sampleSize = Math.min(100, nodes.length);
      const sampledNodes = nodes.slice(0, sampleSize);
      
      let totalPathLength = 0;
      let pathCount = 0;
      
      for (let i = 0; i < sampledNodes.length; i++) {
        for (let j = i + 1; j < sampledNodes.length; j++) {
          try {
            const pathLength = NetworkX.shortestPathLength(G, sampledNodes[i], sampledNodes[j]);
            totalPathLength += pathLength;
            pathCount++;
          } catch (error) {
            // Path doesn't exist, skip
          }
        }
      }
      
      return pathCount > 0 ? totalPathLength / pathCount : 0;
    } catch (error) {
      console.warn('⚠️ [HF-ANALYZER] Could not calculate average shortest path length:', error);
      return 0;
    }
  }

  /**
   * Find simple cycles in the network
   */
  private findSimpleCycles(G: NetworkX.Graph): string[][] {
    try {
      // Use NetworkX to find simple cycles
      const cycles = NetworkX.simpleCycles(G);
      return Array.from(cycles).map(cycle => cycle.map(node => node.toString()));
    } catch (error) {
      console.warn('⚠️ [HF-ANALYZER] Could not find cycles:', error);
      return [];
    }
  }

  /**
   * Generate ML-enhanced insights about the network
   */
  private async generateMLInsights(G: NetworkX.Graph): Promise<any> {
    try {
      // This is where we would integrate with Hugging Face models
      // For now, we'll provide basic ML-style analysis
      
      const nodes = Array.from(G.nodes());
      const edges = Array.from(G.edges());
      
      // Calculate feature statistics
      const nodeFeatures = nodes.map(nodeId => {
        const nodeData = G.getNodeAttributes(nodeId);
        return nodeData.features || [];
      });
      
      const edgeFeatures = edges.map(([source, target]) => {
        const edgeData = G.getEdgeAttributes(source, target);
        return edgeData.features || [];
      });
      
      // Basic statistical analysis
      const insights = {
        nodeFeatureStats: this.calculateFeatureStatistics(nodeFeatures),
        edgeFeatureStats: this.calculateFeatureStatistics(edgeFeatures),
        networkComplexity: this.calculateNetworkComplexity(G),
        potentialLoopAreas: this.identifyPotentialLoopAreas(G),
        trailQualityIndicators: this.assessTrailQuality(G)
      };
      
      return insights;
    } catch (error) {
      console.warn('⚠️ [HF-ANALYZER] Could not generate ML insights:', error);
      return {};
    }
  }

  /**
   * Calculate statistics for feature vectors
   */
  private calculateFeatureStatistics(features: number[][]): any {
    if (features.length === 0) return {};
    
    const numFeatures = features[0].length;
    const stats: any = {};
    
    for (let i = 0; i < numFeatures; i++) {
      const values = features.map(f => f[i]).filter(v => !isNaN(v));
      if (values.length > 0) {
        stats[`feature_${i}`] = {
          mean: values.reduce((a, b) => a + b, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          std: this.calculateStandardDeviation(values)
        };
      }
    }
    
    return stats;
  }

  /**
   * Calculate standard deviation
   */
  private calculateStandardDeviation(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Calculate network complexity score
   */
  private calculateNetworkComplexity(G: NetworkX.Graph): number {
    const nodes = G.numberOfNodes();
    const edges = G.numberOfEdges();
    const density = NetworkX.density(G);
    const clustering = NetworkX.averageClustering(G);
    
    // Simple complexity score combining multiple factors
    return (density * 0.3) + (clustering * 0.3) + (Math.log(nodes + 1) * 0.2) + (Math.log(edges + 1) * 0.2);
  }

  /**
   * Identify areas with potential for good loops
   */
  private identifyPotentialLoopAreas(G: NetworkX.Graph): any[] {
    try {
      const potentialAreas: any[] = [];
      
      // Find nodes with high degree (intersections)
      const degreeCentrality = NetworkX.degreeCentrality(G);
      const highDegreeNodes = Object.entries(degreeCentrality)
        .filter(([_, centrality]) => centrality > 0.1) // Top 10% of nodes
        .map(([nodeId, centrality]) => ({ nodeId, centrality }));
      
      // For each high-degree node, analyze its neighborhood
      for (const { nodeId, centrality } of highDegreeNodes) {
        const neighbors = Array.from(G.neighbors(nodeId));
        if (neighbors.length >= 3) {
          // Check if this area has potential for loops
          const subgraph = G.subgraph([nodeId, ...neighbors]);
          const cycles = NetworkX.simpleCycles(subgraph);
          
          if (cycles.length > 0) {
            potentialAreas.push({
              centerNode: nodeId,
              centrality,
              neighborCount: neighbors.length,
              cycleCount: cycles.length,
              areaComplexity: this.calculateNetworkComplexity(subgraph)
            });
          }
        }
      }
      
      return potentialAreas.sort((a, b) => b.centrality - a.centrality);
    } catch (error) {
      console.warn('⚠️ [HF-ANALYZER] Could not identify potential loop areas:', error);
      return [];
    }
  }

  /**
   * Assess trail quality indicators
   */
  private assessTrailQuality(G: NetworkX.Graph): any {
    try {
      const edges = Array.from(G.edges());
      let totalLength = 0;
      let totalElevationGain = 0;
      let namedTrails = 0;
      
      edges.forEach(([source, target]) => {
        const edgeData = G.getEdgeAttributes(source, target);
        totalLength += edgeData.length || 0;
        totalElevationGain += edgeData.elevationGain || 0;
        if (edgeData.trailName) namedTrails++;
      });
      
      return {
        averageTrailLength: edges.length > 0 ? totalLength / edges.length : 0,
        averageElevationGain: edges.length > 0 ? totalElevationGain / edges.length : 0,
        namedTrailPercentage: edges.length > 0 ? (namedTrails / edges.length) * 100 : 0,
        totalNetworkLength: totalLength,
        totalElevationGain: totalElevationGain
      };
    } catch (error) {
      console.warn('⚠️ [HF-ANALYZER] Could not assess trail quality:', error);
      return {};
    }
  }

  /**
   * Generate ML-enhanced loop recommendations
   */
  async generateLoopRecommendations(targetDistance?: number, targetElevation?: number): Promise<LoopRecommendation[]> {
    if (!this.networkGraph) {
      throw new Error('Network not loaded. Call loadTrailNetwork() first.');
    }

    console.log('🎯 [HF-ANALYZER] Generating ML-enhanced loop recommendations...');

    try {
      const G = new NetworkX.Graph();
      
      // Build graph
      this.networkGraph.nodes.forEach(node => G.addNode(node.id, node));
      this.networkGraph.edges.forEach(edge => G.addEdge(edge.source, edge.target, edge));

      // Find all cycles
      const cycles = NetworkX.simpleCycles(G);
      const recommendations: LoopRecommendation[] = [];

      for (const cycle of cycles) {
        if (cycle.length < 3) continue; // Skip trivial cycles

        const loopId = `ml-loop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Calculate loop metrics
        const loopMetrics = this.calculateLoopMetrics(G, cycle);
        
        // Apply ML scoring
        const mlScore = await this.calculateMLScore(G, cycle, loopMetrics);
        
        // Filter by target criteria if provided
        if (targetDistance && Math.abs(loopMetrics.totalLength - targetDistance) > targetDistance * 0.3) {
          continue;
        }
        if (targetElevation && Math.abs(loopMetrics.totalElevationGain - targetElevation) > targetElevation * 0.3) {
          continue;
        }

        const recommendation: LoopRecommendation = {
          loopId,
          nodes: cycle.map(node => node.toString()),
          edges: this.getCycleEdges(G, cycle),
          totalLength: loopMetrics.totalLength,
          totalElevationGain: loopMetrics.totalElevationGain,
          qualityScore: loopMetrics.qualityScore,
          mlScore,
          confidence: Math.min(mlScore * 0.8 + loopMetrics.qualityScore * 0.2, 1.0),
          reasoning: this.generateReasoning(loopMetrics, mlScore)
        };

        recommendations.push(recommendation);
      }

      // Sort by combined score
      recommendations.sort((a, b) => (b.mlScore + b.qualityScore) - (a.mlScore + a.qualityScore));

      console.log(`✅ [HF-ANALYZER] Generated ${recommendations.length} ML-enhanced loop recommendations`);
      return recommendations.slice(0, 20); // Return top 20

    } catch (error) {
      console.error('❌ [HF-ANALYZER] Error generating loop recommendations:', error);
      throw error;
    }
  }

  /**
   * Calculate metrics for a loop
   */
  private calculateLoopMetrics(G: NetworkX.Graph, cycle: any[]): any {
    let totalLength = 0;
    let totalElevationGain = 0;
    let intersectionCount = 0;
    let namedTrailCount = 0;

    for (let i = 0; i < cycle.length; i++) {
      const currentNode = cycle[i];
      const nextNode = cycle[(i + 1) % cycle.length];
      
      const edgeData = G.getEdgeAttributes(currentNode, nextNode);
      totalLength += edgeData.length || 0;
      totalElevationGain += edgeData.elevationGain || 0;
      if (edgeData.trailName) namedTrailCount++;
      
      const nodeData = G.getNodeAttributes(currentNode);
      if (nodeData.isIntersection) intersectionCount++;
    }

    // Calculate quality score based on various factors
    const qualityScore = this.calculateQualityScore({
      totalLength,
      totalElevationGain,
      intersectionCount,
      namedTrailCount,
      cycleLength: cycle.length
    });

    return {
      totalLength,
      totalElevationGain,
      intersectionCount,
      namedTrailCount,
      cycleLength: cycle.length,
      qualityScore
    };
  }

  /**
   * Calculate quality score for a loop
   */
  private calculateQualityScore(metrics: any): number {
    let score = 0;
    
    // Length score (prefer moderate lengths)
    const lengthScore = Math.max(0, 1 - Math.abs(metrics.totalLength - 5) / 5);
    score += lengthScore * 0.3;
    
    // Elevation score (prefer moderate elevation gain)
    const elevationScore = Math.max(0, 1 - Math.abs(metrics.totalElevationGain - 200) / 200);
    score += elevationScore * 0.2;
    
    // Intersection score (prefer some intersections for variety)
    const intersectionScore = Math.min(metrics.intersectionCount / 3, 1);
    score += intersectionScore * 0.2;
    
    // Named trail score
    const namedTrailScore = metrics.namedTrailCount / Math.max(metrics.cycleLength, 1);
    score += namedTrailScore * 0.2;
    
    // Cycle length score (prefer moderate complexity)
    const cycleLengthScore = Math.max(0, 1 - Math.abs(metrics.cycleLength - 8) / 8);
    score += cycleLengthScore * 0.1;
    
    return Math.min(score, 1.0);
  }

  /**
   * Calculate ML score for a loop (placeholder for actual ML model)
   */
  private async calculateMLScore(G: NetworkX.Graph, cycle: any[], metrics: any): Promise<number> {
    // This is where we would integrate with actual Hugging Face models
    // For now, we'll use a heuristic approach that mimics ML scoring
    
    try {
      // Extract features for the loop
      const features = this.extractLoopFeatures(G, cycle, metrics);
      
      // Simple ML-like scoring based on feature analysis
      let mlScore = 0;
      
      // Feature 1: Loop connectivity (how well connected the loop is)
      const connectivityScore = this.calculateConnectivityScore(G, cycle);
      mlScore += connectivityScore * 0.3;
      
      // Feature 2: Trail diversity (variety of trails in the loop)
      const diversityScore = this.calculateDiversityScore(G, cycle);
      mlScore += diversityScore * 0.25;
      
      // Feature 3: Elevation profile (interesting elevation changes)
      const elevationScore = this.calculateElevationScore(metrics);
      mlScore += elevationScore * 0.2;
      
      // Feature 4: Network centrality (how central the loop is)
      const centralityScore = this.calculateCentralityScore(G, cycle);
      mlScore += centralityScore * 0.15;
      
      // Feature 5: Loop balance (good distribution of trail types)
      const balanceScore = this.calculateBalanceScore(G, cycle);
      mlScore += balanceScore * 0.1;
      
      return Math.min(mlScore, 1.0);
    } catch (error) {
      console.warn('⚠️ [HF-ANALYZER] Error calculating ML score:', error);
      return 0.5; // Default score
    }
  }

  /**
   * Extract features for ML analysis
   */
  private extractLoopFeatures(G: NetworkX.Graph, cycle: any[], metrics: any): number[] {
    const features: number[] = [];
    
    // Basic metrics
    features.push(metrics.totalLength);
    features.push(metrics.totalElevationGain);
    features.push(metrics.cycleLength);
    features.push(metrics.intersectionCount);
    features.push(metrics.namedTrailCount);
    
    // Network features
    features.push(this.calculateConnectivityScore(G, cycle));
    features.push(this.calculateDiversityScore(G, cycle));
    features.push(this.calculateElevationScore(metrics));
    features.push(this.calculateCentralityScore(G, cycle));
    features.push(this.calculateBalanceScore(G, cycle));
    
    return features;
  }

  /**
   * Calculate connectivity score for a loop
   */
  private calculateConnectivityScore(G: NetworkX.Graph, cycle: any[]): number {
    try {
      // Calculate how well-connected the nodes in the loop are
      let totalConnections = 0;
      let possibleConnections = 0;
      
      for (let i = 0; i < cycle.length; i++) {
        for (let j = i + 1; j < cycle.length; j++) {
          possibleConnections++;
          if (G.hasEdge(cycle[i], cycle[j])) {
            totalConnections++;
          }
        }
      }
      
      return possibleConnections > 0 ? totalConnections / possibleConnections : 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate diversity score for a loop
   */
  private calculateDiversityScore(G: NetworkX.Graph, cycle: any[]): number {
    try {
      const trailNames = new Set();
      let totalLength = 0;
      let lengthVariance = 0;
      const lengths: number[] = [];
      
      for (let i = 0; i < cycle.length; i++) {
        const currentNode = cycle[i];
        const nextNode = cycle[(i + 1) % cycle.length];
        
        const edgeData = G.getEdgeAttributes(currentNode, nextNode);
        if (edgeData.trailName) trailNames.add(edgeData.trailName);
        
        const length = edgeData.length || 0;
        lengths.push(length);
        totalLength += length;
      }
      
      // Calculate length variance
      const meanLength = totalLength / lengths.length;
      lengthVariance = lengths.reduce((sum, length) => sum + Math.pow(length - meanLength, 2), 0) / lengths.length;
      
      // Diversity score based on trail name variety and length variance
      const nameDiversity = trailNames.size / Math.max(cycle.length, 1);
      const lengthDiversity = Math.min(lengthVariance / (meanLength * meanLength), 1);
      
      return (nameDiversity * 0.6) + (lengthDiversity * 0.4);
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate elevation score for a loop
   */
  private calculateElevationScore(metrics: any): number {
    const elevationGain = metrics.totalElevationGain;
    const length = metrics.totalLength;
    
    if (length === 0) return 0;
    
    const elevationRate = elevationGain / length;
    
    // Prefer moderate elevation rates (not too flat, not too steep)
    const optimalRate = 50; // 50m elevation per km
    const score = Math.max(0, 1 - Math.abs(elevationRate - optimalRate) / optimalRate);
    
    return score;
  }

  /**
   * Calculate centrality score for a loop
   */
  private calculateCentralityScore(G: NetworkX.Graph, cycle: any[]): number {
    try {
      const degreeCentrality = NetworkX.degreeCentrality(G);
      const betweennessCentrality = NetworkX.betweennessCentrality(G);
      
      let totalDegreeCentrality = 0;
      let totalBetweennessCentrality = 0;
      
      cycle.forEach(nodeId => {
        totalDegreeCentrality += degreeCentrality[nodeId] || 0;
        totalBetweennessCentrality += betweennessCentrality[nodeId] || 0;
      });
      
      const avgDegreeCentrality = totalDegreeCentrality / cycle.length;
      const avgBetweennessCentrality = totalBetweennessCentrality / cycle.length;
      
      return (avgDegreeCentrality * 0.6) + (avgBetweennessCentrality * 0.4);
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate balance score for a loop
   */
  private calculateBalanceScore(G: NetworkX.Graph, cycle: any[]): number {
    try {
      // Calculate how balanced the loop is in terms of trail characteristics
      const lengths: number[] = [];
      const elevations: number[] = [];
      
      for (let i = 0; i < cycle.length; i++) {
        const currentNode = cycle[i];
        const nextNode = cycle[(i + 1) % cycle.length];
        
        const edgeData = G.getEdgeAttributes(currentNode, nextNode);
        lengths.push(edgeData.length || 0);
        elevations.push(edgeData.elevationGain || 0);
      }
      
      // Calculate coefficient of variation for balance
      const lengthCV = this.calculateCoefficientOfVariation(lengths);
      const elevationCV = this.calculateCoefficientOfVariation(elevations);
      
      // Lower CV means more balanced
      const lengthBalance = Math.max(0, 1 - lengthCV);
      const elevationBalance = Math.max(0, 1 - elevationCV);
      
      return (lengthBalance * 0.5) + (elevationBalance * 0.5);
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate coefficient of variation
   */
  private calculateCoefficientOfVariation(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean === 0) return 0;
    
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    return stdDev / mean;
  }

  /**
   * Get edges that form a cycle
   */
  private getCycleEdges(G: NetworkX.Graph, cycle: any[]): string[] {
    const edges: string[] = [];
    
    for (let i = 0; i < cycle.length; i++) {
      const currentNode = cycle[i];
      const nextNode = cycle[(i + 1) % cycle.length];
      
      const edgeData = G.getEdgeAttributes(currentNode, nextNode);
      if (edgeData.id) {
        edges.push(edgeData.id.toString());
      }
    }
    
    return edges;
  }

  /**
   * Generate reasoning for a loop recommendation
   */
  private generateReasoning(metrics: any, mlScore: number): string[] {
    const reasoning: string[] = [];
    
    if (metrics.totalLength > 0) {
      reasoning.push(`Loop length: ${metrics.totalLength.toFixed(2)}km`);
    }
    
    if (metrics.totalElevationGain > 0) {
      reasoning.push(`Elevation gain: ${metrics.totalElevationGain.toFixed(0)}m`);
    }
    
    if (metrics.intersectionCount > 0) {
      reasoning.push(`${metrics.intersectionCount} intersections for variety`);
    }
    
    if (metrics.namedTrailCount > 0) {
      reasoning.push(`${metrics.namedTrailCount} named trails`);
    }
    
    if (mlScore > 0.7) {
      reasoning.push('High ML quality score');
    } else if (mlScore > 0.5) {
      reasoning.push('Good ML quality score');
    }
    
    return reasoning;
  }

  /**
   * Clean up network data using ML-based approaches
   */
  async cleanNetworkData(): Promise<any> {
    if (!this.networkGraph) {
      throw new Error('Network not loaded. Call loadTrailNetwork() first.');
    }

    console.log('🧹 [HF-ANALYZER] Cleaning network data with ML approaches...');

    try {
      const G = new NetworkX.Graph();
      
      // Build graph
      this.networkGraph.nodes.forEach(node => G.addNode(node.id, node));
      this.networkGraph.edges.forEach(edge => G.addEdge(edge.source, edge.target, edge));

      const cleaningResults = {
        // Identify potential issues
        isolatedNodes: this.findIsolatedNodes(G),
        duplicateEdges: this.findDuplicateEdges(G),
        shortConnectors: this.findShortConnectors(G),
        lowQualityTrails: this.findLowQualityTrails(G),
        
        // ML-based recommendations
        recommendedMerges: this.recommendMerges(G),
        recommendedSplits: this.recommendSplits(G),
        recommendedDeletions: this.recommendDeletions(G),
        
        // Quality metrics
        networkHealth: this.assessNetworkHealth(G)
      };

      console.log('✅ [HF-ANALYZER] Network cleaning analysis complete');
      return cleaningResults;

    } catch (error) {
      console.error('❌ [HF-ANALYZER] Error cleaning network data:', error);
      throw error;
    }
  }

  /**
   * Find isolated nodes
   */
  private findIsolatedNodes(G: NetworkX.Graph): any[] {
    const isolatedNodes: any[] = [];
    
    for (const nodeId of G.nodes()) {
      if (G.degree(nodeId) === 0) {
        const nodeData = G.getNodeAttributes(nodeId);
        isolatedNodes.push({
          nodeId,
          lat: nodeData.lat,
          lng: nodeData.lng,
          reason: 'No connections'
        });
      }
    }
    
    return isolatedNodes;
  }

  /**
   * Find duplicate edges
   */
  private findDuplicateEdges(G: NetworkX.Graph): any[] {
    const duplicateEdges: any[] = [];
    const edgeMap = new Map();
    
    for (const [source, target] of G.edges()) {
      const key = [source, target].sort().join('-');
      const edgeData = G.getEdgeAttributes(source, target);
      
      if (edgeMap.has(key)) {
        duplicateEdges.push({
          source,
          target,
          existingEdge: edgeMap.get(key),
          duplicateEdge: edgeData,
          reason: 'Duplicate connection'
        });
      } else {
        edgeMap.set(key, edgeData);
      }
    }
    
    return duplicateEdges;
  }

  /**
   * Find short connectors
   */
  private findShortConnectors(G: NetworkX.Graph): any[] {
    const shortConnectors: any[] = [];
    
    for (const [source, target] of G.edges()) {
      const edgeData = G.getEdgeAttributes(source, target);
      const length = edgeData.length || 0;
      
      if (length < 0.1) { // Less than 100m
        shortConnectors.push({
          source,
          target,
          length,
          reason: 'Very short connector'
        });
      }
    }
    
    return shortConnectors;
  }

  /**
   * Find low quality trails
   */
  private findLowQualityTrails(G: NetworkX.Graph): any[] {
    const lowQualityTrails: any[] = [];
    
    for (const [source, target] of G.edges()) {
      const edgeData = G.getEdgeAttributes(source, target);
      const length = edgeData.length || 0;
      const elevationGain = edgeData.elevationGain || 0;
      
      // Low quality indicators
      if (length < 0.05 || // Very short
          (length > 0 && elevationGain / length > 200) || // Very steep
          !edgeData.trailName) { // Unnamed
        lowQualityTrails.push({
          source,
          target,
          length,
          elevationGain,
          trailName: edgeData.trailName,
          reason: this.getLowQualityReason(length, elevationGain, edgeData.trailName)
        });
      }
    }
    
    return lowQualityTrails;
  }

  /**
   * Get reason for low quality trail
   */
  private getLowQualityReason(length: number, elevationGain: number, trailName?: string): string {
    if (length < 0.05) return 'Very short trail';
    if (length > 0 && elevationGain / length > 200) return 'Very steep trail';
    if (!trailName) return 'Unnamed trail';
    return 'Multiple quality issues';
  }

  /**
   * Recommend merges
   */
  private recommendMerges(G: NetworkX.Graph): any[] {
    const recommendedMerges: any[] = [];
    
    // Find degree-2 chains that could be merged
    for (const nodeId of G.nodes()) {
      if (G.degree(nodeId) === 2) {
        const neighbors = Array.from(G.neighbors(nodeId));
        if (neighbors.length === 2) {
          const [neighbor1, neighbor2] = neighbors;
          
          // Check if this forms a simple chain
          if (G.degree(neighbor1) === 2 && G.degree(neighbor2) === 2) {
            recommendedMerges.push({
              nodeId,
              neighbors: [neighbor1, neighbor2],
              reason: 'Degree-2 chain merge candidate'
            });
          }
        }
      }
    }
    
    return recommendedMerges;
  }

  /**
   * Recommend splits
   */
  private recommendSplits(G: NetworkX.Graph): any[] {
    const recommendedSplits: any[] = [];
    
    // Find long edges that could be split
    for (const [source, target] of G.edges()) {
      const edgeData = G.getEdgeAttributes(source, target);
      const length = edgeData.length || 0;
      
      if (length > 2.0) { // Longer than 2km
        recommendedSplits.push({
          source,
          target,
          length,
          reason: 'Long edge split candidate'
        });
      }
    }
    
    return recommendedSplits;
  }

  /**
   * Recommend deletions
   */
  private recommendDeletions(G: NetworkX.Graph): any[] {
    const recommendedDeletions: any[] = [];
    
    // Find edges that could be deleted
    for (const [source, target] of G.edges()) {
      const edgeData = G.getEdgeAttributes(source, target);
      const length = edgeData.length || 0;
      const elevationGain = edgeData.elevationGain || 0;
      
      // Deletion candidates
      if (length < 0.02 || // Very short
          (length > 0 && elevationGain / length > 300) || // Extremely steep
          (!edgeData.trailName && length < 0.1)) { // Short unnamed
        recommendedDeletions.push({
          source,
          target,
          length,
          elevationGain,
          trailName: edgeData.trailName,
          reason: this.getDeletionReason(length, elevationGain, edgeData.trailName)
        });
      }
    }
    
    return recommendedDeletions;
  }

  /**
   * Get reason for deletion recommendation
   */
  private getDeletionReason(length: number, elevationGain: number, trailName?: string): string {
    if (length < 0.02) return 'Extremely short trail';
    if (length > 0 && elevationGain / length > 300) return 'Extremely steep trail';
    if (!trailName && length < 0.1) return 'Short unnamed trail';
    return 'Multiple deletion criteria';
  }

  /**
   * Assess network health
   */
  private assessNetworkHealth(G: NetworkX.Graph): any {
    const nodes = G.numberOfNodes();
    const edges = G.numberOfEdges();
    const density = NetworkX.density(G);
    const connectedComponents = NetworkX.connectedComponents(G);
    
    // Calculate health metrics
    const connectivityHealth = connectedComponents.length === 1 ? 1.0 : 1.0 / connectedComponents.length;
    const densityHealth = Math.min(density * 10, 1.0); // Scale density to 0-1
    const sizeHealth = Math.min(nodes / 100, 1.0); // Scale size to 0-1
    
    const overallHealth = (connectivityHealth * 0.4) + (densityHealth * 0.3) + (sizeHealth * 0.3);
    
    return {
      overallHealth,
      connectivityHealth,
      densityHealth,
      sizeHealth,
      metrics: {
        nodes,
        edges,
        density,
        connectedComponents: connectedComponents.length
      }
    };
  }
}
