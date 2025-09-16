import { Client } from 'pg';
import { RoutingQueries, StagingQueries } from '../sql/queries';
import { DatabaseService } from './DatabaseService';
import { CleanupQueries } from '../sql/queries';

export interface IntersectionResult {
  intersectionCount: number;
  intersections: any[];
}

export interface NodeGenerationResult {
  nodeCount: number;
  nodeTypes: {
    endpoint: number;
    intersection: number;
  };
}

export interface EdgeGenerationResult {
  edgeCount: number;
  orphanedNodesRemoved: number;
  orphanedEdgesRemoved: number;
  bridgeConnectorCleanupCount: number;
}

export interface NetworkValidationResult {
  isConnected: boolean;
  isolatedNodes: number;
  orphanedEdges: number;
  connectivityStats: {
    totalNodes: number;
    connectedNodes: number;
    leafNodes: number;
    avgDegree: number;
  };
}

export interface RoutingService {
  detectIntersections(schemaName: string, tolerance: number): Promise<IntersectionResult>;
  generateRoutingNodes(schemaName: string, tolerance: number): Promise<NodeGenerationResult>;
  generateRoutingEdges(schemaName: string, tolerance: number): Promise<EdgeGenerationResult>;
  validateRoutingNetwork(schemaName: string): Promise<NetworkValidationResult>;
  cleanupOrphanedNodes(schemaName: string): Promise<number>;
}

export class PostgresRoutingService implements RoutingService {
  private client: Client;
  private databaseService: DatabaseService;

  constructor(client: Client, databaseService: DatabaseService) {
    this.client = client;
    this.databaseService = databaseService;
  }

  async detectIntersections(schemaName: string, tolerance: number): Promise<IntersectionResult> {
    console.log(`🔍 Detecting trail intersections with tolerance: ${tolerance}m`);
    
    const result = await this.databaseService.executeQuery(
      RoutingQueries.detectIntersections(schemaName, tolerance),
      [schemaName, tolerance]
    );
    
    const intersectionCount = result.rows.length;
    console.log(`✅ Detected ${intersectionCount} trail intersections`);
    
    return {
      intersectionCount,
      intersections: result.rows
    };
  }

  async generateRoutingNodes(schemaName: string, tolerance: number): Promise<NodeGenerationResult> {
    console.log(`📍 Generating routing nodes with connection validation...`);
    
    try {
      // Load Layer 1 configuration for tolerances
      const { loadConfig } = await import('../utils/config-loader');
      const config = loadConfig();
      
      const intersectionConfig = config.layer1_trails.intersectionDetection;
      
      // Use much more conservative tolerances to prevent orphaned nodes
      const tIntersectionTolerance = Math.min(intersectionConfig.tIntersectionToleranceMeters, 10.0); // Cap at 10m
      const trueIntersectionTolerance = intersectionConfig.trueIntersectionToleranceMeters;
      const endpointNearMissTolerance = Math.min(intersectionConfig.endpointNearMissToleranceMeters, 5.0); // Cap at 5m
      const edgeGenerationTolerance = tolerance; // Use the same tolerance for edge generation
      
      console.log(`🎯 Using connection-validated intersection detection with tolerances:`);
      console.log(`   T-intersection: ${tIntersectionTolerance}m (capped)`);
      console.log(`   True intersection: ${trueIntersectionTolerance}m`);
      console.log(`   Endpoint near miss: ${endpointNearMissTolerance}m (capped)`);
      console.log(`   Edge generation: ${edgeGenerationTolerance}m`);
      
      // Use new function with connection validation and cleanup
      const result = await this.databaseService.executeQuery(`
        SELECT * FROM enhanced_generate_routing_nodes_with_validation($1, $2, $3, $4, $5)
      `, [schemaName, tIntersectionTolerance, trueIntersectionTolerance, endpointNearMissTolerance, edgeGenerationTolerance]);
      
      const nodeCount = parseInt(result.rows[0].node_count);
      const success = result.rows[0].success;
      const message = result.rows[0].message;
      
      if (!success) {
        throw new Error(`Node generation failed: ${message}`);
      }
      
      console.log(`✅ ${message}`);
      
      // Get node type breakdown
      const nodeTypesResult = await this.databaseService.executeQuery(
        RoutingQueries.getNodeTypeBreakdown(schemaName)
      );
      
      const nodeTypes = {
        endpoint: 0,
        intersection: 0,
        t_intersection: 0,
        endpoint_near_miss: 0
      };
      
      nodeTypesResult.rows.forEach((row: any) => {
        if (row.node_type === 'endpoint') {
          nodeTypes.endpoint = parseInt(row.count);
        } else if (row.node_type === 'intersection') {
          nodeTypes.intersection = parseInt(row.count);
        } else if (row.node_type === 't_intersection') {
          nodeTypes.t_intersection = parseInt(row.count);
        } else if (row.node_type === 'endpoint_near_miss') {
          nodeTypes.endpoint_near_miss = parseInt(row.count);
        }
      });
      
      console.log('📍 Node type breakdown:');
      console.log(`  - endpoint: ${nodeTypes.endpoint} nodes`);
      console.log(`  - intersection: ${nodeTypes.intersection} nodes`);
      console.log(`  - t_intersection: ${nodeTypes.t_intersection} nodes`);
      console.log(`  - endpoint_near_miss: ${nodeTypes.endpoint_near_miss} nodes`);
      
      return {
        nodeCount,
        nodeTypes
      };
      
    } catch (error) {
      console.error('❌ Error during connection-validated node generation:', error);
      throw error;
    }
  }

  async generateRoutingEdges(schemaName: string, tolerance: number): Promise<EdgeGenerationResult> {
    console.log(`🛤️ Generating routing edges with tolerance: ${tolerance}m`);
    
    // Note: Edge generation is now handled within the node generation function
    // with connection validation, so this method is simplified
    
    // Get final counts for reporting
    const nodeCountResult = await this.databaseService.executeQuery(
      StagingQueries.getNodeCount(schemaName)
    );
    const nodeCount = parseInt(nodeCountResult.rows[0].count);
    console.log(`📍 Final node count: ${nodeCount} nodes`);
    
    const edgeCountResult = await this.databaseService.executeQuery(
      `SELECT COUNT(*) as count FROM ${schemaName}.routing_edges`
    );
    const edgeCount = parseInt(edgeCountResult.rows[0].count);
    console.log(`🛤️ Final edge count: ${edgeCount} edges`);
    
    // Clean up any remaining orphaned edges (should be minimal now)
    const orphanedEdgesResult = await this.databaseService.executeQuery(
      RoutingQueries.cleanupOrphanedEdges(schemaName)
    );
    const orphanedEdgesCount = orphanedEdgesResult.rowCount;
    if (orphanedEdgesCount > 0) {
      console.log(`🧹 Cleaned up ${orphanedEdgesCount} remaining orphaned edges`);
    }
    
    // Clean up bridge connector artifacts that create isolated degree-1 nodes
    const bridgeConnectorCleanupResult = await this.databaseService.executeQuery(
      CleanupQueries.cleanupBridgeConnectorArtifacts(schemaName)
    );
    const bridgeConnectorCleanupCount = bridgeConnectorCleanupResult.rowCount;
    if (bridgeConnectorCleanupCount > 0) {
      console.log(`🔧 Cleaned up ${bridgeConnectorCleanupCount} bridge connector artifacts`);
    }
    
    return {
      edgeCount,
      orphanedNodesRemoved: 0, // Now handled in node generation
      orphanedEdgesRemoved: orphanedEdgesCount,
      bridgeConnectorCleanupCount
    };
  }

  async validateRoutingNetwork(schemaName: string): Promise<NetworkValidationResult> {
    console.log('🔍 Validating routing network connectivity...');
    
    // Check for isolated nodes
    const isolatedNodesResult = await this.databaseService.executeQuery(
      RoutingQueries.checkIsolatedNodes(schemaName)
    );
    const isolatedNodesCount = parseInt(isolatedNodesResult.rows[0].count);
    
    // Check for orphaned edges
    const orphanedEdgesResult = await this.databaseService.executeQuery(
      RoutingQueries.checkOrphanedEdges(schemaName)
    );
    const orphanedEdgesCount = parseInt(orphanedEdgesResult.rows[0].count);
    
    // Check connectivity statistics
    const connectivityResult = await this.databaseService.executeQuery(
      RoutingQueries.validateNetwork(schemaName)
    );
    
    const connectivityStats = {
      totalNodes: 0,
      connectedNodes: 0,
      leafNodes: 0,
      avgDegree: 0
    };
    
    connectivityResult.rows.forEach((row: any) => {
      connectivityStats.totalNodes += parseInt(row.total_nodes);
      connectivityStats.connectedNodes += parseInt(row.connected_nodes);
      connectivityStats.leafNodes += parseInt(row.leaf_nodes);
      connectivityStats.avgDegree = parseFloat(row.avg_degree);
    });
    
    console.log('🔍 Routing network validation results:');
    console.log(`  - Isolated nodes: ${isolatedNodesCount}`);
    console.log(`  - Orphaned edges: ${orphanedEdgesCount}`);
    console.log(`  - Total nodes: ${connectivityStats.totalNodes}`);
    console.log(`  - Connected nodes: ${connectivityStats.connectedNodes}`);
    console.log(`  - Leaf nodes: ${connectivityStats.leafNodes}`);
    console.log(`  - Average degree: ${connectivityStats.avgDegree.toFixed(1)}`);
    
    const isConnected = isolatedNodesCount === 0 && orphanedEdgesCount === 0;
    
    if (isolatedNodesCount > 0 || orphanedEdgesCount > 0) {
      console.log(`⚠️ Warning: Found ${isolatedNodesCount} isolated nodes and ${orphanedEdgesCount} orphaned edges`);
    } else {
      console.log('✅ Routing network is fully connected!');
    }
    
    return {
      isConnected,
      isolatedNodes: isolatedNodesCount,
      orphanedEdges: orphanedEdgesCount,
      connectivityStats
    };
  }

  async cleanupOrphanedNodes(schemaName: string): Promise<number> {
    const result = await this.databaseService.executeQuery(
      RoutingQueries.cleanupOrphanedNodes(schemaName)
    );
    return result.rowCount;
  }
} 