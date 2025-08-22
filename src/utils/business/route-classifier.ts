/**
 * Route Classification System
 * 
 * Classifies routes as loops or out-and-back based on:
 * - Start/end point analysis
 * - Edge traversal patterns
 * - Node visitation patterns
 */

export interface RouteClassification {
  type: 'loop' | 'out-and-back' | 'point-to-point';
  confidence: number; // 0-1 scale
  details: {
    sameStartEnd: boolean;
    duplicateEdges: boolean;
    duplicateEdgeCount: number;
    totalEdges: number;
    duplicateNodes: boolean;
    duplicateNodeCount: number;
    totalNodes: number;
    traversalPattern: string;
  };
}

export interface RouteEdge {
  id: number;
  source: number;
  target: number;
  trail_name?: string;
  length_km?: number;
}

export interface RoutePath {
  route_path?: any; // pgRouting path result
  route_edges: RouteEdge[];
}

export class RouteClassifier {
  
  /**
   * Classify a route based on its path and edges
   */
  static classifyRoute(route: RoutePath): RouteClassification {
    const edges = route.route_edges || [];
    const pathNodes = this.extractNodesFromPath(route.route_path);
    
    if (edges.length === 0) {
      return {
        type: 'point-to-point',
        confidence: 0,
        details: {
          sameStartEnd: false,
          duplicateEdges: false,
          duplicateEdgeCount: 0,
          totalEdges: 0,
          duplicateNodes: false,
          duplicateNodeCount: 0,
          totalNodes: 0,
          traversalPattern: 'empty'
        }
      };
    }

    // Analyze edge traversal patterns
    const edgeAnalysis = this.analyzeEdgeTraversal(edges);
    
    // Analyze node visitation patterns
    const nodeAnalysis = this.analyzeNodeVisitation(pathNodes);
    
    // Check if start and end points are the same
    const sameStartEnd = this.hasSameStartEnd(edges, pathNodes);
    
    // Determine route type based on analysis
    const classification = this.determineRouteType(
      sameStartEnd,
      edgeAnalysis,
      nodeAnalysis
    );
    
    return {
      type: classification.type,
      confidence: classification.confidence,
      details: {
        sameStartEnd,
        duplicateEdges: edgeAnalysis.hasDuplicates,
        duplicateEdgeCount: edgeAnalysis.duplicateCount,
        totalEdges: edges.length,
        duplicateNodes: nodeAnalysis.hasDuplicates,
        duplicateNodeCount: nodeAnalysis.duplicateCount,
        totalNodes: nodeAnalysis.totalNodes,
        traversalPattern: classification.pattern
      }
    };
  }

  /**
   * Extract nodes from pgRouting path result
   */
  private static extractNodesFromPath(routePath: any): number[] {
    if (!routePath) return [];
    
    // Handle different path formats
    if (Array.isArray(routePath)) {
      return routePath.map(step => step.node).filter(node => node != null);
    }
    
    if (routePath.path && Array.isArray(routePath.path)) {
      return routePath.path.map(step => step.node).filter(node => node != null);
    }
    
    return [];
  }

  /**
   * Analyze edge traversal patterns to detect duplicates
   */
  private static analyzeEdgeTraversal(edges: RouteEdge[]): {
    hasDuplicates: boolean;
    duplicateCount: number;
    edgeFrequency: Map<number, number>;
  } {
    const edgeFrequency = new Map<number, number>();
    
    // Count frequency of each edge ID
    for (const edge of edges) {
      const count = edgeFrequency.get(edge.id) || 0;
      edgeFrequency.set(edge.id, count + 1);
    }
    
    // Count how many edges are traversed more than once
    let duplicateCount = 0;
    for (const [edgeId, frequency] of edgeFrequency) {
      if (frequency > 1) {
        duplicateCount += frequency - 1; // Count extra traversals
      }
    }
    
    return {
      hasDuplicates: duplicateCount > 0,
      duplicateCount,
      edgeFrequency
    };
  }

  /**
   * Analyze node visitation patterns
   */
  private static analyzeNodeVisitation(nodes: number[]): {
    hasDuplicates: boolean;
    duplicateCount: number;
    totalNodes: number;
    nodeFrequency: Map<number, number>;
  } {
    if (nodes.length === 0) {
      return {
        hasDuplicates: false,
        duplicateCount: 0,
        totalNodes: 0,
        nodeFrequency: new Map()
      };
    }

    const nodeFrequency = new Map<number, number>();
    
    // Count frequency of each node
    for (const node of nodes) {
      const count = nodeFrequency.get(node) || 0;
      nodeFrequency.set(node, count + 1);
    }
    
    // Count duplicate visits (excluding start/end which can be the same)
    let duplicateCount = 0;
    for (const [nodeId, frequency] of nodeFrequency) {
      if (frequency > 1) {
        // For start/end node being the same, only count as duplicate if visited more than twice
        if (nodeId === nodes[0] && nodeId === nodes[nodes.length - 1]) {
          if (frequency > 2) {
            duplicateCount += frequency - 2;
          }
        } else {
          duplicateCount += frequency - 1;
        }
      }
    }
    
    return {
      hasDuplicates: duplicateCount > 0,
      duplicateCount,
      totalNodes: nodes.length,
      nodeFrequency
    };
  }

  /**
   * Check if route has same start and end point
   */
  private static hasSameStartEnd(edges: RouteEdge[], pathNodes: number[]): boolean {
    if (pathNodes.length >= 2) {
      return pathNodes[0] === pathNodes[pathNodes.length - 1];
    }
    
    // Fallback: check edges
    if (edges.length >= 1) {
      const firstEdge = edges[0];
      const lastEdge = edges[edges.length - 1];
      return firstEdge.source === lastEdge.target;
    }
    
    return false;
  }

  /**
   * Determine route type based on analysis
   */
  private static determineRouteType(
    sameStartEnd: boolean,
    edgeAnalysis: { hasDuplicates: boolean; duplicateCount: number },
    nodeAnalysis: { hasDuplicates: boolean; duplicateCount: number; totalNodes: number }
  ): { type: 'loop' | 'out-and-back' | 'point-to-point'; confidence: number; pattern: string } {
    
    // Same start/end point - could be loop or out-and-back
    if (sameStartEnd) {
      if (edgeAnalysis.hasDuplicates) {
        // Traverses same edges multiple times = out-and-back
        const confidence = Math.min(0.95, 0.7 + (edgeAnalysis.duplicateCount / 10));
        return {
          type: 'out-and-back',
          confidence,
          pattern: `same-start-end-with-${edgeAnalysis.duplicateCount}-duplicate-edges`
        };
      } else {
        // No duplicate edges = true loop
        const confidence = nodeAnalysis.hasDuplicates ? 0.9 : 0.95;
        return {
          type: 'loop',
          confidence,
          pattern: 'same-start-end-no-duplicate-edges'
        };
      }
    }
    
    // Different start/end points
    if (edgeAnalysis.hasDuplicates) {
      // Has duplicate edges but different endpoints = likely out-and-back with different start/end
      return {
        type: 'out-and-back',
        confidence: 0.8,
        pattern: `different-endpoints-with-${edgeAnalysis.duplicateCount}-duplicate-edges`
      };
    }
    
    // Different start/end, no duplicate edges = point-to-point
    return {
      type: 'point-to-point',
      confidence: 0.9,
      pattern: 'different-endpoints-no-duplicates'
    };
  }

  /**
   * Generate appropriate route name based on classification
   */
  static generateRouteName(
    baseTrailNames: string[],
    classification: RouteClassification,
    fallbackName?: string
  ): string {
    const trailPart = this.formatTrailNames(baseTrailNames);
    const typeSuffix = this.getTypeSuffix(classification);
    
    if (trailPart) {
      return `${trailPart} ${typeSuffix}`;
    }
    
    return fallbackName || `${typeSuffix} Route`;
  }

  /**
   * Format trail names for route naming
   */
  private static formatTrailNames(trailNames: string[]): string {
    const uniqueNames = [...new Set(trailNames.filter(name => name && name !== 'Unnamed Trail'))];
    
    if (uniqueNames.length === 0) return '';
    if (uniqueNames.length === 1) return uniqueNames[0];
    if (uniqueNames.length === 2) return `${uniqueNames[0]}/${uniqueNames[1]}`;
    
    // More than 2 trails: use first and last
    return `${uniqueNames[0]}/${uniqueNames[uniqueNames.length - 1]}`;
  }

  /**
   * Get type suffix for route naming
   */
  private static getTypeSuffix(classification: RouteClassification): string {
    switch (classification.type) {
      case 'loop':
        return 'Loop';
      case 'out-and-back':
        return 'Out & Back';
      case 'point-to-point':
        return 'Route';
      default:
        return 'Route';
    }
  }

  /**
   * Get detailed classification summary for logging/debugging
   */
  static getClassificationSummary(classification: RouteClassification): string {
    const { type, confidence, details } = classification;
    const confidencePercent = Math.round(confidence * 100);
    
    let summary = `${type.toUpperCase()} (${confidencePercent}% confidence)`;
    
    if (details.sameStartEnd) {
      summary += ` - Same start/end`;
    }
    
    if (details.duplicateEdges) {
      summary += ` - ${details.duplicateEdgeCount}/${details.totalEdges} duplicate edges`;
    }
    
    if (details.duplicateNodes) {
      summary += ` - ${details.duplicateNodeCount} duplicate nodes`;
    }
    
    return summary;
  }
}
