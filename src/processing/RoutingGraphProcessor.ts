import { RoutingService } from '../services/RoutingService';
import { DatabaseService } from '../services/DatabaseService';
import { getPgRoutingConfig } from '../utils/config-loader';

export interface RoutingConfig {
  nodeTolerance: number;
  spatialTolerance: number;
  minTrailLengthMeters: number;
  enableIntersectionDetection: boolean;
  enableNodeGeneration: boolean;
  enableEdgeGeneration: boolean;
  enableNetworkValidation: boolean;
}

export interface GraphResult {
  success: boolean;
  nodeCount: number;
  edgeCount: number;
  intersectionCount: number;
  orphanedNodesRemoved: number;
  orphanedEdgesRemoved: number;
  isConnected: boolean;
  isolatedNodes: number;
  orphanedEdges: number;
  connectivityStats: {
    totalNodes: number;
    connectedNodes: number;
    leafNodes: number;
    avgDegree: number;
  };
  errors: string[];
  warnings: string[];
}

export interface OptimizationConfig {
  removeIsolatedNodes: boolean;
  removeOrphanedEdges: boolean;
  mergeCloseNodes: boolean;
  nodeMergeTolerance: number;
}

export interface OptimizationResult {
  success: boolean;
  nodesRemoved: number;
  edgesRemoved: number;
  nodesMerged: number;
  errors: string[];
  warnings: string[];
}

export interface RoutingGraphProcessor {
  buildRoutingGraph(schemaName: string, config: RoutingConfig): Promise<GraphResult>;
  optimizeRoutingGraph(schemaName: string, config: OptimizationConfig): Promise<OptimizationResult>;
  validateRoutingGraph(schemaName: string): Promise<GraphResult>;
}

export class PostgresRoutingGraphProcessor implements RoutingGraphProcessor {
  private routingService: RoutingService;
  private databaseService: DatabaseService;

  constructor(routingService: RoutingService, databaseService: DatabaseService) {
    this.routingService = routingService;
    this.databaseService = databaseService;
  }

  async buildRoutingGraph(schemaName: string, config: RoutingConfig): Promise<GraphResult> {
    // Check if we should use pgRouting direct topology
    const pgroutingConfig = getPgRoutingConfig();
    
    if (pgroutingConfig.enableDirectTopology) {
      console.log(`🛤️ Building routing graph with pgRouting direct topology for schema '${schemaName}'`);
      return this.buildRoutingGraphWithPgRouting(schemaName, pgroutingConfig);
    }
    
    console.log(`🛤️ Building routing graph with custom generation for schema '${schemaName}'`);
    console.log(`📋 Configuration:`);
    console.log(`   - Node tolerance: ${config.nodeTolerance}m`);
    console.log(`   - Spatial tolerance: ${config.spatialTolerance}m`);
    console.log(`   - Min trail length: ${config.minTrailLengthMeters}m`);
    console.log(`   - Enable intersection detection: ${config.enableIntersectionDetection}`);
    console.log(`   - Enable node generation: ${config.enableNodeGeneration}`);
    console.log(`   - Enable edge generation: ${config.enableEdgeGeneration}`);
    console.log(`   - Enable network validation: ${config.enableNetworkValidation}`);

    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      let intersectionCount = 0;
      let nodeCount = 0;
      let edgeCount = 0;
      let orphanedNodesRemoved = 0;
      let orphanedEdgesRemoved = 0;

      // Step 1: Detect intersections
      if (config.enableIntersectionDetection) {
        console.log(`🔍 Step 1: Detecting trail intersections...`);
        const intersectionResult = await this.routingService.detectIntersections(schemaName, config.nodeTolerance);
        intersectionCount = intersectionResult.intersectionCount;
        console.log(`✅ Detected ${intersectionCount} intersections`);
      } else {
        console.log(`⏭️ Skipping intersection detection as requested`);
      }

      // Step 2: Generate routing nodes
      if (config.enableNodeGeneration) {
        console.log(`📍 Step 2: Generating routing nodes...`);
        const nodeResult = await this.routingService.generateRoutingNodes(schemaName, config.nodeTolerance);
        nodeCount = nodeResult.nodeCount;
        console.log(`✅ Generated ${nodeCount} routing nodes`);
        console.log(`   - Endpoint nodes: ${nodeResult.nodeTypes.endpoint}`);
        console.log(`   - Intersection nodes: ${nodeResult.nodeTypes.intersection}`);
      } else {
        console.log(`⏭️ Skipping node generation as requested`);
      }

      // Step 3: Generate routing edges
      if (config.enableEdgeGeneration) {
        console.log(`🛤️ Step 3: Generating routing edges...`);
        const edgeResult = await this.routingService.generateRoutingEdges(schemaName, config.spatialTolerance);
        edgeCount = edgeResult.edgeCount;
        orphanedNodesRemoved = edgeResult.orphanedNodesRemoved;
        orphanedEdgesRemoved = edgeResult.orphanedEdgesRemoved;
        console.log(`✅ Generated ${edgeCount} routing edges`);
        console.log(`   - Orphaned nodes removed: ${orphanedNodesRemoved}`);
        console.log(`   - Orphaned edges removed: ${orphanedEdgesRemoved}`);
      } else {
        console.log(`⏭️ Skipping edge generation as requested`);
      }

      // Step 4: Validate routing network
      let isConnected = false;
      let isolatedNodes = 0;
      let orphanedEdges = 0;
      let connectivityStats = {
        totalNodes: 0,
        connectedNodes: 0,
        leafNodes: 0,
        avgDegree: 0
      };

      if (config.enableNetworkValidation) {
        console.log(`🔍 Step 4: Validating routing network...`);
        const validationResult = await this.routingService.validateRoutingNetwork(schemaName);
        isConnected = validationResult.isConnected;
        isolatedNodes = validationResult.isolatedNodes;
        orphanedEdges = validationResult.orphanedEdges;
        connectivityStats = validationResult.connectivityStats;
        
        if (!isConnected) {
          warnings.push(`Routing network is not fully connected (${isolatedNodes} isolated nodes, ${orphanedEdges} orphaned edges)`);
        }
      } else {
        console.log(`⏭️ Skipping network validation as requested`);
      }

      console.log(`✅ Routing graph construction completed successfully`);
      console.log(`📊 Final graph statistics:`);
      console.log(`   - Nodes: ${nodeCount}`);
      console.log(`   - Edges: ${edgeCount}`);
      console.log(`   - Intersections: ${intersectionCount}`);
      console.log(`   - Connected: ${isConnected ? 'Yes' : 'No'}`);
      console.log(`   - Isolated nodes: ${isolatedNodes}`);
      console.log(`   - Orphaned edges: ${orphanedEdges}`);

      return {
        success: true,
        nodeCount,
        edgeCount,
        intersectionCount,
        orphanedNodesRemoved,
        orphanedEdgesRemoved,
        isConnected,
        isolatedNodes,
        orphanedEdges,
        connectivityStats,
        errors,
        warnings
      };

    } catch (error) {
      console.error('❌ Routing graph construction failed:', error);
      return {
        success: false,
        nodeCount: 0,
        edgeCount: 0,
        intersectionCount: 0,
        orphanedNodesRemoved: 0,
        orphanedEdgesRemoved: 0,
        isConnected: false,
        isolatedNodes: 0,
        orphanedEdges: 0,
        connectivityStats: {
          totalNodes: 0,
          connectedNodes: 0,
          leafNodes: 0,
          avgDegree: 0
        },
        errors: [error instanceof Error ? error.message : String(error)],
        warnings
      };
    }
  }

  async optimizeRoutingGraph(schemaName: string, config: OptimizationConfig): Promise<OptimizationResult> {
    console.log(`🔧 Optimizing routing graph for schema '${schemaName}'`);
    console.log(`📋 Optimization configuration:`);
    console.log(`   - Remove isolated nodes: ${config.removeIsolatedNodes}`);
    console.log(`   - Remove orphaned edges: ${config.removeOrphanedEdges}`);
    console.log(`   - Merge close nodes: ${config.mergeCloseNodes}`);
    console.log(`   - Node merge tolerance: ${config.nodeMergeTolerance}m`);

    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      let nodesRemoved = 0;
      let edgesRemoved = 0;
      let nodesMerged = 0;

      // Remove isolated nodes
      if (config.removeIsolatedNodes) {
        console.log(`🧹 Removing isolated nodes...`);
        nodesRemoved = await this.routingService.cleanupOrphanedNodes(schemaName);
        console.log(`✅ Removed ${nodesRemoved} isolated nodes`);
      }

      // Remove orphaned edges
      if (config.removeOrphanedEdges) {
        console.log(`🧹 Removing orphaned edges...`);
        const orphanedEdgesResult = await this.databaseService.executeQuery(`
          DELETE FROM ${schemaName}.routing_edges 
          WHERE source NOT IN (SELECT id FROM ${schemaName}.routing_nodes) 
          OR target NOT IN (SELECT id FROM ${schemaName}.routing_nodes)
        `);
        edgesRemoved = orphanedEdgesResult.rowCount;
        console.log(`✅ Removed ${edgesRemoved} orphaned edges`);
      }

      // Merge close nodes (if implemented)
      if (config.mergeCloseNodes) {
        console.log(`🔗 Merging close nodes (tolerance: ${config.nodeMergeTolerance}m)...`);
        // This would be a more complex operation that merges nodes within the tolerance
        // For now, we'll just log that it's not implemented
        warnings.push('Node merging is not yet implemented');
      }

      console.log(`✅ Routing graph optimization completed successfully`);
      console.log(`📊 Optimization results:`);
      console.log(`   - Nodes removed: ${nodesRemoved}`);
      console.log(`   - Edges removed: ${edgesRemoved}`);
      console.log(`   - Nodes merged: ${nodesMerged}`);

      return {
        success: true,
        nodesRemoved,
        edgesRemoved,
        nodesMerged,
        errors,
        warnings
      };

    } catch (error) {
      console.error('❌ Routing graph optimization failed:', error);
      return {
        success: false,
        nodesRemoved: 0,
        edgesRemoved: 0,
        nodesMerged: 0,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings
      };
    }
  }

  async validateRoutingGraph(schemaName: string): Promise<GraphResult> {
    console.log(`🔍 Validating routing graph for schema '${schemaName}'`);
    
    try {
      const validationResult = await this.routingService.validateRoutingNetwork(schemaName);
      
      // Get node and edge counts
      const nodeCountResult = await this.databaseService.executeQuery(`SELECT COUNT(*) FROM ${schemaName}.routing_nodes`);
      const edgeCountResult = await this.databaseService.executeQuery(`SELECT COUNT(*) FROM ${schemaName}.routing_edges`);
      const intersectionCountResult = await this.databaseService.executeQuery(`SELECT COUNT(*) FROM ${schemaName}.intersection_points`);
      
      const nodeCount = parseInt(nodeCountResult.rows[0].count);
      const edgeCount = parseInt(edgeCountResult.rows[0].count);
      const intersectionCount = parseInt(intersectionCountResult.rows[0].count);

      console.log(`✅ Routing graph validation completed`);
      console.log(`📊 Graph statistics:`);
      console.log(`   - Nodes: ${nodeCount}`);
      console.log(`   - Edges: ${edgeCount}`);
      console.log(`   - Intersections: ${intersectionCount}`);
      console.log(`   - Connected: ${validationResult.isConnected ? 'Yes' : 'No'}`);
      console.log(`   - Isolated nodes: ${validationResult.isolatedNodes}`);
      console.log(`   - Orphaned edges: ${validationResult.orphanedEdges}`);

      return {
        success: validationResult.isConnected,
        nodeCount,
        edgeCount,
        intersectionCount,
        orphanedNodesRemoved: 0,
        orphanedEdgesRemoved: 0,
        isConnected: validationResult.isConnected,
        isolatedNodes: validationResult.isolatedNodes,
        orphanedEdges: validationResult.orphanedEdges,
        connectivityStats: validationResult.connectivityStats,
        errors: validationResult.isConnected ? [] : ['Routing graph is not fully connected'],
        warnings: []
      };

    } catch (error) {
      console.error('❌ Routing graph validation failed:', error);
      return {
        success: false,
        nodeCount: 0,
        edgeCount: 0,
        intersectionCount: 0,
        orphanedNodesRemoved: 0,
        orphanedEdgesRemoved: 0,
        isConnected: false,
        isolatedNodes: 0,
        orphanedEdges: 0,
        connectivityStats: {
          totalNodes: 0,
          connectedNodes: 0,
          leafNodes: 0,
          avgDegree: 0
        },
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: []
      };
    }
  }

  /**
   * Build routing graph using pgRouting direct topology creation
   * This bypasses custom node/edge generation and lets pgRouting handle everything
   */
  private async buildRoutingGraphWithPgRouting(schemaName: string, pgroutingConfig: any): Promise<GraphResult> {
    console.log(`🛤️ Building routing graph with pgRouting direct topology...`);
    console.log(`📋 pgRouting Configuration:`);
    console.log(`   - Topology tolerance: ${pgroutingConfig.topologyTolerance} degrees (${(pgroutingConfig.topologyTolerance * 111000).toFixed(1)}m)`);
    console.log(`   - Use Layer 2 network: ${pgroutingConfig.useLayer2Network}`);
    console.log(`   - Skip custom node generation: ${pgroutingConfig.skipCustomNodeGeneration}`);
    console.log(`   - Skip custom edge generation: ${pgroutingConfig.skipCustomEdgeGeneration}`);

    try {
      // Step 1: Create routing_edges from source
      console.log(`📋 Step 1: Creating routing edges from source...`);
      const edgeCount = await this.createRoutingEdgesFromSource(schemaName, pgroutingConfig);
      console.log(`✅ Created ${edgeCount} routing edges`);

      // Step 2: Create pgRouting topology
      console.log(`🔗 Step 2: Creating pgRouting topology...`);
      const topologySuccess = await this.createPgRoutingTopology(schemaName, pgroutingConfig.topologyTolerance);
      if (!topologySuccess) {
        throw new Error('Failed to create pgRouting topology');
      }
      console.log(`✅ Created pgRouting topology successfully`);

      // Step 3: Create nodes from pgRouting vertices
      console.log(`📍 Step 3: Creating nodes from pgRouting vertices...`);
      const nodeCount = await this.createNodesFromPgRoutingVertices(schemaName);
      console.log(`✅ Created ${nodeCount} routing nodes`);

      // Step 4: Validate connectivity
      console.log(`🔍 Step 4: Validating connectivity...`);
      const connectivityResult = await this.validateConnectivity(schemaName);
      console.log(`✅ Connectivity validation completed`);

      return {
        success: true,
        nodeCount,
        edgeCount,
        intersectionCount: 0, // Not applicable for pgRouting direct topology
        orphanedNodesRemoved: 0,
        orphanedEdgesRemoved: 0,
        isConnected: connectivityResult.isConnected,
        isolatedNodes: connectivityResult.isolatedNodes,
        orphanedEdges: connectivityResult.orphanedEdges,
        connectivityStats: connectivityResult.connectivityStats,
        errors: connectivityResult.isConnected ? [] : ['Routing graph is not fully connected'],
        warnings: []
      };

    } catch (error) {
      console.error('❌ pgRouting direct topology creation failed:', error);
      return {
        success: false,
        nodeCount: 0,
        edgeCount: 0,
        intersectionCount: 0,
        orphanedNodesRemoved: 0,
        orphanedEdgesRemoved: 0,
        isConnected: false,
        isolatedNodes: 0,
        orphanedEdges: 0,
        connectivityStats: {
          totalNodes: 0,
          connectedNodes: 0,
          leafNodes: 0,
          avgDegree: 0
        },
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: []
      };
    }
  }

  /**
   * Create routing edges from source (Layer 2 network or trails)
   */
  private async createRoutingEdgesFromSource(schemaName: string, pgroutingConfig: any): Promise<number> {
    if (pgroutingConfig.useLayer2Network) {
      // TODO: Import Layer 2 network GeoJSON and create routing_edges
      // For now, use trails as fallback
      console.log(`⚠️ Layer 2 network import not yet implemented, using trails as fallback`);
    }

    // Create routing_edges from trails
    await this.databaseService.executeQuery(`
      CREATE TABLE ${schemaName}.routing_edges AS
      SELECT 
        id,
        app_uuid,
        name,
        trail_type,
        length_km,
        elevation_gain,
        elevation_loss,
        ST_SimplifyPreserveTopology(ST_Force2D(geometry), 0.0001) as geom
      FROM ${schemaName}.trails
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND length_km > 0
    `);

    // Add routing topology columns
    await this.databaseService.executeQuery(`
      ALTER TABLE ${schemaName}.routing_edges 
      ADD COLUMN source INTEGER,
      ADD COLUMN target INTEGER
    `);

    const result = await this.databaseService.executeQuery(`SELECT COUNT(*) FROM ${schemaName}.routing_edges`);
    return parseInt(result.rows[0].count);
  }

  /**
   * Create pgRouting topology directly
   */
  private async createPgRoutingTopology(schemaName: string, tolerance: number): Promise<boolean> {
    try {
      const result = await this.databaseService.executeQuery(`
        SELECT pgr_createTopology('${schemaName}.routing_edges', ${tolerance}, 'geom', 'id')
      `);
      
      return result.rows[0].pgr_createtopology === 'OK';
    } catch (error) {
      console.error('❌ pgRouting topology creation failed:', error);
      return false;
    }
  }

  /**
   * Create nodes from pgRouting vertices
   */
  private async createNodesFromPgRoutingVertices(schemaName: string): Promise<number> {
    // Get vertices table name
    const tablesResult = await this.databaseService.executeQuery(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = '${schemaName}' 
      AND table_name LIKE '%vertices%'
    `);

    if (tablesResult.rows.length === 0) {
      throw new Error('No vertices table found after pgRouting topology creation');
    }

    const verticesTableName = `${schemaName}.${tablesResult.rows[0].table_name}`;
    
    // Create nodes table from vertices
    await this.databaseService.executeQuery(`
      CREATE TABLE ${schemaName}.routing_nodes AS
      SELECT 
        id,
        the_geom,
        cnt,
        ST_X(the_geom) as lng,
        ST_Y(the_geom) as lat,
        ST_Z(the_geom) as elevation
      FROM ${verticesTableName}
    `);

    const result = await this.databaseService.executeQuery(`SELECT COUNT(*) FROM ${schemaName}.routing_nodes`);
    return parseInt(result.rows[0].count);
  }

  /**
   * Validate connectivity using pgRouting
   */
  private async validateConnectivity(schemaName: string): Promise<any> {
    const connectivityResult = await this.databaseService.executeQuery(`
      SELECT 
        component,
        COUNT(*) as node_count
      FROM pgr_connectedComponents(
        'SELECT id, source, target, length_km * 1000 as cost FROM ${schemaName}.routing_edges WHERE length_km > 0'
      )
      GROUP BY component
      ORDER BY node_count DESC
    `);

    const componentCount = connectivityResult.rows.length;
    const isConnected = componentCount === 1;
    const isolatedNodes = componentCount > 1 ? componentCount - 1 : 0;

    // Get additional stats
    const nodeCountResult = await this.databaseService.executeQuery(`SELECT COUNT(*) FROM ${schemaName}.routing_nodes`);
    const edgeCountResult = await this.databaseService.executeQuery(`SELECT COUNT(*) FROM ${schemaName}.routing_edges`);
    
    const totalNodes = parseInt(nodeCountResult.rows[0].count);
    const totalEdges = parseInt(edgeCountResult.rows[0].count);

    console.log(`📊 Connectivity results:`);
    console.log(`   - Components: ${componentCount}`);
    console.log(`   - Connected: ${isConnected ? 'Yes' : 'No'}`);
    console.log(`   - Isolated nodes: ${isolatedNodes}`);

    return {
      isConnected,
      isolatedNodes,
      orphanedEdges: 0, // Not applicable for pgRouting topology
      connectivityStats: {
        totalNodes,
        connectedNodes: isConnected ? totalNodes : totalNodes - isolatedNodes,
        leafNodes: 0, // Would need additional calculation
        avgDegree: totalEdges > 0 ? (totalEdges * 2) / totalNodes : 0
      }
    };
  }
} 