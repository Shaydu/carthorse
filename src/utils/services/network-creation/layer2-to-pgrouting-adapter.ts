import { Pool } from 'pg';

export interface Layer2ToPgRoutingConfig {
  stagingSchema: string;
  preserveOriginalNetwork: boolean; // Keep original Layer 2 network intact
  useExistingNodes: boolean; // Use existing node IDs from Layer 2
  useExistingEdges: boolean; // Use existing edge IDs from Layer 2
}

export interface Layer2ToPgRoutingResult {
  success: boolean;
  nodesAdapted: number;
  edgesAdapted: number;
  connectivityPreserved: boolean;
  error?: string;
  details?: {
    originalNodeCount: number;
    originalEdgeCount: number;
    adaptedNodeCount: number;
    adaptedEdgeCount: number;
    connectivityMetrics: {
      connectedComponents: number;
      isolatedNodes: number;
      averageDegree: number;
    };
  };
}

export class Layer2ToPgRoutingAdapter {
  private pgClient: Pool;
  private config: Layer2ToPgRoutingConfig;

  constructor(pgClient: Pool, config: Layer2ToPgRoutingConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  /**
   * Adapt existing Layer 2 network to pgRouting-compatible format
   */
  async adaptLayer2NetworkToPgRouting(): Promise<Layer2ToPgRoutingResult> {
    console.log('🔄 Adapting existing Layer 2 network to pgRouting format...');
    
    try {
      // Step 1: Analyze existing Layer 2 network structure
      const networkAnalysis = await this.analyzeExistingNetwork();
      console.log(`📊 Existing network: ${networkAnalysis.nodeCount} nodes, ${networkAnalysis.edgeCount} edges`);

      // Step 2: Create pgRouting-compatible nodes table
      const nodesResult = await this.createPgRoutingNodesTable();
      console.log(`✅ Created pgRouting nodes table: ${nodesResult.nodeCount} nodes`);

      // Step 3: Create pgRouting-compatible edges table
      const edgesResult = await this.createPgRoutingEdgesTable();
      console.log(`✅ Created pgRouting edges table: ${edgesResult.edgeCount} edges`);

      // Step 4: Validate connectivity is preserved
      const connectivityResult = await this.validateConnectivityPreservation();
      console.log(`✅ Connectivity validation: ${connectivityResult.connectedComponents} components`);

      // Step 5: Create pgRouting topology
      await this.createPgRoutingTopology();
      console.log('✅ Created pgRouting topology');

      return {
        success: true,
        nodesAdapted: nodesResult.nodeCount,
        edgesAdapted: edgesResult.edgeCount,
        connectivityPreserved: connectivityResult.isValid,
        details: {
          originalNodeCount: networkAnalysis.nodeCount,
          originalEdgeCount: networkAnalysis.edgeCount,
          adaptedNodeCount: nodesResult.nodeCount,
          adaptedEdgeCount: edgesResult.edgeCount,
          connectivityMetrics: connectivityResult.metrics
        }
      };

    } catch (error) {
      console.error('❌ Error adapting Layer 2 network to pgRouting:', error);
      return {
        success: false,
        nodesAdapted: 0,
        edgesAdapted: 0,
        connectivityPreserved: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Analyze the existing Layer 2 network structure
   */
  private async analyzeExistingNetwork(): Promise<{
    nodeCount: number;
    edgeCount: number;
    hasValidStructure: boolean;
  }> {
    // Check if we have the Layer 2 network structure
    const nodeCountResult = await this.pgClient.query(`
      SELECT COUNT(*) as count 
      FROM ${this.config.stagingSchema}.routing_nodes
    `);

    const edgeCountResult = await this.pgClient.query(`
      SELECT COUNT(*) as count 
      FROM ${this.config.stagingSchema}.routing_edges
    `);

    const nodeCount = parseInt(nodeCountResult.rows[0].count);
    const edgeCount = parseInt(edgeCountResult.rows[0].count);

    return {
      nodeCount,
      edgeCount,
      hasValidStructure: nodeCount > 0 && edgeCount > 0
    };
  }

  /**
   * Create pgRouting-compatible nodes table from existing Layer 2 nodes
   */
  private async createPgRoutingNodesTable(): Promise<{ nodeCount: number }> {
    // Drop existing pgRouting nodes table if it exists
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${this.config.stagingSchema}.ways_noded_vertices_pgr CASCADE
    `);

    // Create pgRouting-compatible nodes table from existing Layer 2 nodes
    await this.pgClient.query(`
      CREATE TABLE ${this.config.stagingSchema}.ways_noded_vertices_pgr AS
      SELECT 
        CAST(id AS INTEGER) as id,
        lng as x,
        lat as y,
        elevation,
        node_type,
        degree,
        node_uuid
      FROM ${this.config.stagingSchema}.routing_nodes
      WHERE id IS NOT NULL
      ORDER BY id
    `);

    // Add spatial index
    await this.pgClient.query(`
      CREATE INDEX ON ${this.config.stagingSchema}.ways_noded_vertices_pgr USING GIST (
        ST_SetSRID(ST_MakePoint(x, y), 4326)
      )
    `);

    const nodeCountResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
    `);

    return { nodeCount: parseInt(nodeCountResult.rows[0].count) };
  }

  /**
   * Create pgRouting-compatible edges table from existing Layer 2 edges
   */
  private async createPgRoutingEdgesTable(): Promise<{ edgeCount: number }> {
    // Drop existing pgRouting edges table if it exists
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${this.config.stagingSchema}.ways_noded CASCADE
    `);

    // Create pgRouting-compatible edges table from existing Layer 2 edges
    await this.pgClient.query(`
      CREATE TABLE ${this.config.stagingSchema}.ways_noded AS
      SELECT 
        CAST(id AS INTEGER) as id,
        CAST(source AS INTEGER) as source,
        CAST(target AS INTEGER) as target,
        distance_km as length_km,
        elevation_gain,
        elevation_loss,
        trail_name,
        trail_id as app_uuid,
        geometry as the_geom,
        is_bidirectional
      FROM ${this.config.stagingSchema}.routing_edges
      WHERE source IS NOT NULL AND target IS NOT NULL
      ORDER BY id
    `);

    // Add spatial index
    await this.pgClient.query(`
      CREATE INDEX ON ${this.config.stagingSchema}.ways_noded USING GIST (the_geom)
    `);

    // Add source/target indexes for pgRouting performance
    await this.pgClient.query(`
      CREATE INDEX ON ${this.config.stagingSchema}.ways_noded (source, target)
    `);

    const edgeCountResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.ways_noded
    `);

    return { edgeCount: parseInt(edgeCountResult.rows[0].count) };
  }

  /**
   * Validate that connectivity is preserved in the adapted network
   */
  private async validateConnectivityPreservation(): Promise<{
    isValid: boolean;
    connectedComponents: number;
    isolatedNodes: number;
    averageDegree: number;
  }> {
    // Count connected components using pgRouting
    const componentsResult = await this.pgClient.query(`
      SELECT COUNT(DISTINCT component) as component_count
      FROM pgr_strongComponents(
        'SELECT id, source, target FROM ${this.config.stagingSchema}.ways_noded'
      )
    `);

    const connectedComponents = parseInt(componentsResult.rows[0].component_count);

    // Count isolated nodes (degree 0)
    const isolatedNodesResult = await this.pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
      WHERE NOT EXISTS (
        SELECT 1 FROM ${this.config.stagingSchema}.ways_noded e 
        WHERE e.source = v.id OR e.target = v.id
      )
    `);

    const isolatedNodes = parseInt(isolatedNodesResult.rows[0].count);

    // Calculate average degree
    const averageDegreeResult = await this.pgClient.query(`
      SELECT AVG(degree) as avg_degree
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
      WHERE degree > 0
    `);

    const averageDegree = parseFloat(averageDegreeResult.rows[0].avg_degree) || 0;

    return {
      isValid: connectedComponents > 0 && isolatedNodes === 0,
      connectedComponents,
      isolatedNodes,
      averageDegree
    };
  }

  /**
   * Create pgRouting topology for the adapted network
   */
  private async createPgRoutingTopology(): Promise<void> {
    // Use pgRouting's createTopology function to finalize the network
    await this.pgClient.query(`
      SELECT pgr_createTopology(
        '${this.config.stagingSchema}.ways_noded',
        0.00001,
        'the_geom',
        'id'
      )
    `);

    // Verify topology was created successfully
    const topologyResult = await this.pgClient.query(`
      SELECT COUNT(*) as count 
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
    `);

    if (parseInt(topologyResult.rows[0].count) === 0) {
      throw new Error('pgRouting topology creation failed - no vertices found');
    }
  }

  /**
   * Get pgRouting-compatible edge query for routing functions
   */
  getPgRoutingEdgeQuery(): string {
    return `
      SELECT 
        id, 
        source, 
        target, 
        length_km as cost,
        CASE WHEN is_bidirectional THEN length_km ELSE -1 END as reverse_cost
      FROM ${this.config.stagingSchema}.ways_noded
      WHERE source IS NOT NULL AND target IS NOT NULL
    `;
  }

  /**
   * Get pgRouting-compatible vertex query for routing functions
   */
  getPgRoutingVertexQuery(): string {
    return `
      SELECT 
        id,
        x as lon,
        y as lat,
        elevation
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
      WHERE id IS NOT NULL
    `;
  }

  /**
   * Test pgRouting functionality on the adapted network
   */
  async testPgRoutingFunctionality(): Promise<{
    dijkstraWorks: boolean;
    kspWorks: boolean;
    sampleRoute?: any;
  }> {
    try {
      // Test pgr_dijkstra
      const dijkstraResult = await this.pgClient.query(`
        SELECT * FROM pgr_dijkstra(
          '${this.getPgRoutingEdgeQuery()}',
          1, 2, false
        ) LIMIT 1
      `);

      const dijkstraWorks = dijkstraResult.rows.length > 0;

      // Test pgr_ksp
      const kspResult = await this.pgClient.query(`
        SELECT * FROM pgr_ksp(
          '${this.getPgRoutingEdgeQuery()}',
          1, 2, 3, false
        ) LIMIT 1
      `);

      const kspWorks = kspResult.rows.length > 0;

      return {
        dijkstraWorks,
        kspWorks,
        sampleRoute: dijkstraWorks ? dijkstraResult.rows[0] : undefined
      };

    } catch (error) {
      console.error('❌ pgRouting functionality test failed:', error);
      return {
        dijkstraWorks: false,
        kspWorks: false
      };
    }
  }
}
