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
    console.log(`📍 Generating routing nodes with tolerance: ${tolerance}m`);
    
    // Clear existing routing nodes
    await this.databaseService.executeQuery(RoutingQueries.cleanupOrphanedNodes(schemaName));
    
    // Generate routing nodes
    const result = await this.databaseService.executeQuery(
      RoutingQueries.generateNodes(schemaName, tolerance),
      [schemaName, tolerance]
    );
    
    const nodeCount = result.rowCount;
    console.log(`✅ Generated ${nodeCount} routing nodes`);
    
    // Get node type breakdown
    const nodeTypesResult = await this.databaseService.executeQuery(
      RoutingQueries.getNodeTypeBreakdown(schemaName)
    );
    
    const nodeTypes = {
      endpoint: 0,
      intersection: 0
    };
    
    nodeTypesResult.rows.forEach((row: any) => {
      if (row.node_type === 'endpoint') {
        nodeTypes.endpoint = parseInt(row.count);
      } else if (row.node_type === 'intersection') {
        nodeTypes.intersection = parseInt(row.count);
      }
    });
    
    console.log('📍 Node type breakdown:');
    console.log(`  - endpoint: ${nodeTypes.endpoint} nodes`);
    console.log(`  - intersection: ${nodeTypes.intersection} nodes`);
    
    return {
      nodeCount,
      nodeTypes
    };
  }

  async generateRoutingEdges(schemaName: string, tolerance: number): Promise<EdgeGenerationResult> {
    console.log(`🛤️ Generating routing edges with tolerance: ${tolerance}m`);
    
    // Clear existing routing edges
    await this.databaseService.executeQuery(RoutingQueries.cleanupOrphanedEdges(schemaName));
    
    // Get node count for validation
    const nodeCountResult = await this.databaseService.executeQuery(
      StagingQueries.getNodeCount(schemaName)
    );
    const nodeCount = parseInt(nodeCountResult.rows[0].count);
    console.log(`📍 Found ${nodeCount} nodes to connect`);
    
    // Generate routing edges
    const result = await this.databaseService.executeQuery(
      RoutingQueries.generateEdges(schemaName, tolerance),
      [schemaName, tolerance]
    );
    
    const edgeCount = result.rowCount;
    console.log(`✅ Generated ${edgeCount} routing edges`);
    
    // Clean up orphaned nodes
    const orphanedNodesResult = await this.databaseService.executeQuery(
      RoutingQueries.cleanupOrphanedNodes(schemaName)
    );
    const orphanedNodesCount = orphanedNodesResult.rowCount;
    console.log(`🧹 Cleaned up ${orphanedNodesCount} orphaned nodes`);
    
    // Clean up orphaned edges
    const orphanedEdgesResult = await this.databaseService.executeQuery(
      RoutingQueries.cleanupOrphanedEdges(schemaName)
    );
    const orphanedEdgesCount = orphanedEdgesResult.rowCount;
    console.log(`🧹 Cleaned up ${orphanedEdgesCount} orphaned edges`);
    
    // Clean up bridge connector artifacts that create isolated degree-1 nodes
    const bridgeConnectorCleanupResult = await this.databaseService.executeQuery(
      CleanupQueries.cleanupBridgeConnectorArtifacts(schemaName)
    );
    const bridgeConnectorCleanupCount = bridgeConnectorCleanupResult.rowCount;
    if (bridgeConnectorCleanupCount > 0) {
      console.log(`🔧 Cleaned up ${bridgeConnectorCleanupCount} bridge connector artifacts`);
      
      // Recalculate node connectivity after bridge connector cleanup
      await this.databaseService.executeQuery(`
        UPDATE ${schemaName}.ways_noded_vertices_pgr 
        SET cnt = (
          SELECT COUNT(*) 
          FROM ${schemaName}.ways_noded e 
          WHERE e.source = ways_noded_vertices_pgr.id OR e.target = ways_noded_vertices_pgr.id
        )
      `);
      console.log(`✅ Recalculated node connectivity after bridge connector cleanup`);
    }
    
    // Final counts
    const finalNodeCountResult = await this.databaseService.executeQuery(
      `SELECT COUNT(*) FROM ${schemaName}.routing_nodes`
    );
    const finalEdgeCountResult = await this.databaseService.executeQuery(
      `SELECT COUNT(*) FROM ${schemaName}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL`
    );
    const finalNodeCount = parseInt(finalNodeCountResult.rows[0].count);
    const finalEdgeCount = parseInt(finalEdgeCountResult.rows[0].count);
    
    console.log(`✅ Final routing network: ${finalNodeCount} nodes, ${finalEdgeCount} edges`);
    
    return {
      edgeCount,
      orphanedNodesRemoved: orphanedNodesCount,
      orphanedEdgesRemoved: orphanedEdgesCount
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