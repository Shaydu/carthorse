import { Pool } from 'pg';
import { PgRoutingHelpers } from '../../utils/pgrouting-helpers';

export interface NodeEdgeProcessingConfig {
  stagingSchema: string;
  pgClient: Pool;
  region: string;
  nodeTolerance?: number;
  edgeTolerance?: number;
  enableChainMerging?: boolean;
  enableNetworkOptimization?: boolean;
}

export interface NodeEdgeProcessingResult {
  nodesCreated: number;
  edgesCreated: number;
  chainsMerged: number;
  networkOptimized: boolean;
  connectivityMetrics: {
    totalNodes: number;
    totalEdges: number;
    isolatedNodes: number;
    avgDegree: number;
    maxDegree: number;
  };
  success: boolean;
  errors?: string[];
}

export class NodeEdgeProcessingService {
  private stagingSchema: string;
  private pgClient: Pool;
  private config: NodeEdgeProcessingConfig;

  constructor(config: NodeEdgeProcessingConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
    this.config = config;
  }

  /**
   * Process Layer 2: Create nodes and edges from clean trails
   */
  async processNodesAndEdges(): Promise<NodeEdgeProcessingResult> {
    console.log('🛤️ LAYER 2: NODES & EDGES - Building routable network from clean trails...');
    
    const result: NodeEdgeProcessingResult = {
      nodesCreated: 0,
      edgesCreated: 0,
      chainsMerged: 0,
      networkOptimized: false,
      connectivityMetrics: {
        totalNodes: 0,
        totalEdges: 0,
        isolatedNodes: 0,
        avgDegree: 0,
        maxDegree: 0
      },
      success: false,
      errors: []
    };

    try {
      // Step 1: Validate Layer 1 output exists
      await this.validateLayer1Output();
      
      // Step 2: Create pgRouting network from clean trails
      const networkResult = await this.createPgRoutingNetwork();
      result.nodesCreated = networkResult.vertices;
      result.edgesCreated = networkResult.edges;
      
      // Step 3: Add length and elevation data to edges
      await this.addLengthAndElevationData();
      
      // Step 4: Merge degree-2 chains for better connectivity (if enabled)
      if (this.config.enableChainMerging !== false) {
        result.chainsMerged = await this.iterativeDegree2ChainMerge();
      }
      
      // Step 5: Validate edge network connectivity
      await this.validateEdgeNetwork();
      
      // Step 6: Analyze network connectivity
      result.connectivityMetrics = await this.analyzeNetworkConnectivity();
      
      result.success = true;
      
      console.log('✅ LAYER 2 COMPLETE: Routable network ready');
      console.log(`📊 Layer 2 Results: ${result.nodesCreated} nodes, ${result.edgesCreated} edges, ${result.chainsMerged} chains merged`);
      console.log(`🔗 Connectivity: ${result.connectivityMetrics.totalNodes} total nodes, ${result.connectivityMetrics.isolatedNodes} isolated, avg degree ${result.connectivityMetrics.avgDegree.toFixed(2)}`);
      
    } catch (error) {
      console.error('❌ Layer 2 failed:', error);
      result.errors = [error instanceof Error ? error.message : String(error)];
      result.success = false;
    }

    return result;
  }

  /**
   * Validate that Layer 1 output exists and is ready for processing
   */
  private async validateLayer1Output(): Promise<void> {
    console.log('🔍 Validating Layer 1 output...');
    
    const layer1Check = await this.pgClient.query(`
      SELECT 
        EXISTS(SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'trails') as trails_exists,
        (SELECT COUNT(*) FROM ${this.stagingSchema}.trails) as trail_count
    `, [this.stagingSchema]);

    const { trails_exists, trail_count } = layer1Check.rows[0];
    
    if (!trails_exists) {
      throw new Error('Layer 1 trails table not found. Please run Layer 1 first.');
    }

    if (parseInt(trail_count) === 0) {
      throw new Error('Layer 1 trails table is empty. Please run Layer 1 first.');
    }

    console.log(`✅ Layer 1 output validated: ${trail_count} trails ready for processing`);
  }

  /**
   * Create pgRouting network from clean trails
   */
  private async createPgRoutingNetwork(): Promise<{ edges: number; vertices: number }> {
    console.log('🔄 Creating pgRouting network from clean trails...');
    
    const pgrouting = new PgRoutingHelpers({
      stagingSchema: this.stagingSchema,
      pgClient: this.pgClient
    });

    console.log('🔄 Calling pgrouting.createPgRoutingViews()...');
    const networkCreated = await pgrouting.createPgRoutingViews();
    console.log(`🔄 pgrouting.createPgRoutingViews() returned: ${networkCreated}`);
    
    if (!networkCreated) {
      throw new Error('Failed to create pgRouting network');
    }

    // Check if tables were actually created
    const tablesCheck = await this.pgClient.query(`
      SELECT 
        EXISTS(SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded') as ways_noded_exists,
        EXISTS(SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded_vertices_pgr') as ways_noded_vertices_pgr_exists
    `, [this.stagingSchema]);
    
    console.log(`📊 Table existence check:`);
    console.log(`   - ways_noded: ${tablesCheck.rows[0].ways_noded_exists}`);
    console.log(`   - ways_noded_vertices_pgr: ${tablesCheck.rows[0].ways_noded_vertices_pgr_exists}`);

    // Get network statistics
    const statsResult = await this.pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded) as edges,
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded_vertices_pgr) as vertices
    `);
    console.log(`📊 Network created: ${statsResult.rows[0].edges} edges, ${statsResult.rows[0].vertices} vertices`);

    return {
      edges: parseInt(statsResult.rows[0].edges),
      vertices: parseInt(statsResult.rows[0].vertices)
    };
  }

  /**
   * Add length and elevation columns to ways_noded
   */
  private async addLengthAndElevationData(): Promise<void> {
    console.log('📏 Adding length and elevation columns to ways_noded...');
    
    // Add length_km column
    await this.pgClient.query(`
      ALTER TABLE ${this.stagingSchema}.ways_noded 
      ADD COLUMN IF NOT EXISTS length_km double precision
    `);
    
    // Calculate length_km from geometry
    await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.ways_noded 
      SET length_km = ST_Length(the_geom::geography) / 1000.0
      WHERE length_km IS NULL
    `);
    
    // Add elevation columns
    await this.pgClient.query(`
      ALTER TABLE ${this.stagingSchema}.ways_noded 
      ADD COLUMN IF NOT EXISTS elevation_gain double precision DEFAULT 0.0,
      ADD COLUMN IF NOT EXISTS elevation_loss double precision DEFAULT 0.0
    `);
    
    console.log('✅ Length and elevation columns added');
  }

  /**
   * Iterative degree-2 chain merge for maximum connectivity
   * This uses the new simple approach: find any degree-2 vertex and merge its connected edges
   */
  public async iterativeDegree2ChainMerge(): Promise<number> {
    console.log('   🔗 Starting degree-2 chain merge using new simple approach...');
    
    // Get initial counts
    const initialCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.ways_noded`);
    const initialEdges = parseInt(initialCount.rows[0].count);
    
    const initialVertexCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.ways_noded_vertices_pgr`);
    const initialVertices = parseInt(initialVertexCount.rows[0].count);
    
    console.log(`   📊 Initial state: ${initialEdges} edges, ${initialVertices} vertices`);
    
    let totalMerged = 0;
    let iteration = 0;
    const maxIterations = 50; // Prevent infinite loops
    
    while (iteration < maxIterations) {
      iteration++;
      console.log(`   🔄 Degree-2 merge iteration ${iteration}...`);
      
      // Find degree-2 vertices
      const degree2Vertices = await this.pgClient.query(`
        SELECT id, cnt as degree
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr
        WHERE cnt = 2
        ORDER BY id
        LIMIT 100  -- Process in batches
      `);
      
      if (degree2Vertices.rows.length === 0) {
        console.log(`   ✅ No more degree-2 vertices found after ${iteration} iterations`);
        break;
      }
      
      console.log(`   🔍 Found ${degree2Vertices.rows.length} degree-2 vertices to process`);
      
      let iterationMerged = 0;
      
      // Process each degree-2 vertex
      for (const vertex of degree2Vertices.rows) {
        const success = await this.mergeEdgesAtDegree2Vertex(vertex.id);
        if (success) {
          iterationMerged++;
          totalMerged++;
        }
      }
      
      console.log(`   📊 Iteration ${iteration}: ${iterationMerged} vertices merged`);
      
      // Check for convergence
      if (iterationMerged === 0) {
        console.log(`   ✅ Convergence reached: no more merges possible`);
        break;
      }
    }
    
    if (iteration >= maxIterations) {
      console.warn(`   ⚠️ Reached maximum iterations (${maxIterations}), stopping`);
    }
    
    // Get final counts
    const finalCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.ways_noded`);
    const finalEdges = parseInt(finalCount.rows[0].count);
    
    const finalVertexCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.ways_noded_vertices_pgr`);
    const finalVertices = parseInt(finalVertexCount.rows[0].count);
    
    const edgesMerged = initialEdges - finalEdges;
    const verticesRemoved = initialVertices - finalVertices;
    
    console.log(`   ✅ Degree-2 merge completed: ${totalMerged} vertices merged, ${edgesMerged} edges merged, ${verticesRemoved} vertices removed`);
    console.log(`   📊 Final state: ${finalEdges} edges, ${finalVertices} vertices`);
    
    // Verify no degree-2 vertices remain
    const remainingDegree2 = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.ways_noded_vertices_pgr WHERE cnt = 2
    `);
    const remainingCount = parseInt(remainingDegree2.rows[0].count);
    
    if (remainingCount > 0) {
      console.warn(`   ⚠️ Warning: ${remainingCount} degree-2 vertices still remain after merging`);
    } else {
      console.log(`   ✅ All degree-2 vertices successfully merged`);
    }
    
    return totalMerged;
  }

  /**
   * Find degree-2 vertices that can be merged
   */
  private async findDegree2VerticesToMerge(): Promise<Array<{vertexId: number}>> {
    const result = await this.pgClient.query(`
      WITH degree2_vertices AS (
        SELECT 
          v.id as vertex_id,
          v.the_geom,
          v.cnt as degree
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        WHERE v.cnt = 2  -- Only degree-2 vertices
      ),
      -- Ensure vertices are still degree-2 and have exactly 2 edges
      valid_degree2_vertices AS (
        SELECT 
          v.vertex_id
        FROM degree2_vertices v
        JOIN ${this.stagingSchema}.ways_noded_vertices_pgr v_check ON v.vertex_id = v_check.id
        WHERE v_check.cnt = 2  -- Still degree-2
      )
      SELECT vertex_id
      FROM valid_degree2_vertices
      ORDER BY vertex_id
      LIMIT 100  -- Limit to prevent too many merges at once
    `);
    
    return result.rows.map(row => ({
      vertexId: row.vertex_id
    }));
  }

  /**
   * Merge edges connected to a degree-2 vertex
   */
  private async mergeEdgesAtDegree2Vertex(vertexId: number): Promise<boolean> {
    // Perform all operations in a single transaction
    const client = await this.pgClient.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get the next available ID
      const maxIdResult = await client.query(`
        SELECT COALESCE(MAX(id), 0) as max_id FROM ${this.stagingSchema}.ways_noded
      `);
      const nextId = parseInt(maxIdResult.rows[0].max_id) + 1;
      
      // Find edges that connect to this degree-2 vertex
      const edgesResult = await client.query(`
        SELECT 
          e.id as edge_id,
          e.source, e.target,
          e.the_geom,
          e.length_km,
          e.elevation_gain,
          e.elevation_loss,
          e.name,
          e.app_uuid
        FROM ${this.stagingSchema}.ways_noded e
        WHERE e.source = $1 OR e.target = $1
        ORDER BY e.id
      `, [vertexId]);
      
      if (edgesResult.rows.length === 0) {
        console.log(`   ⚠️ No edges found connecting to vertex ${vertexId}`);
        await client.query('ROLLBACK');
        return false;
      }
      
      // We need exactly 2 edges to merge
      if (edgesResult.rows.length !== 2) {
        console.log(`   ⚠️ Expected 2 edges for vertex ${vertexId}, found ${edgesResult.rows.length}`);
        await client.query('ROLLBACK');
        return false;
      }
      
      const edge1 = edgesResult.rows[0];
      const edge2 = edgesResult.rows[1];
      
      // Determine the endpoints of the merged edge (the vertices that are NOT the degree-2 vertex)
      const allVertices = [edge1.source, edge1.target, edge2.source, edge2.target];
      const mergedEndpoints = allVertices.filter(v => v !== vertexId);
      
      if (mergedEndpoints.length !== 2) {
        console.log(`   ⚠️ Expected 2 endpoints for merged edge, found ${mergedEndpoints.length}`);
        await client.query('ROLLBACK');
        return false;
      }
      
      const newSource = mergedEndpoints[0];
      const newTarget = mergedEndpoints[1];
      
      // Step 1: Create the merged edge
      const mergeResult = await client.query(`
        WITH merged_edge AS (
          SELECT 
            ST_LineMerge(ST_Union($1::geometry, $2::geometry)) as merged_geom,
            ($3::numeric + $4::numeric) as total_length,
            ($5::numeric + $6::numeric) as total_elevation_gain,
            ($7::numeric + $8::numeric) as total_elevation_loss,
            $9 as name
        )
        INSERT INTO ${this.stagingSchema}.ways_noded (
          id, source, target, the_geom, length_km, elevation_gain, elevation_loss,
          app_uuid, name, old_id
        )
        SELECT 
          $10, $11, $12, merged_geom, total_length, total_elevation_gain, total_elevation_loss,
          'merged-degree2-vertex-' || $13 || '-edges-' || $14 || '-' || $15 as app_uuid,
          name,
          NULL::bigint as old_id
        FROM merged_edge
        WHERE ST_IsValid(merged_geom) AND NOT ST_IsEmpty(merged_geom)
      `, [
        edge1.the_geom, edge2.the_geom,
        edge1.length_km || 0, edge2.length_km || 0,
        edge1.elevation_gain || 0, edge2.elevation_gain || 0,
        edge1.elevation_loss || 0, edge2.elevation_loss || 0,
        edge1.name || edge2.name,
        nextId, newSource, newTarget,
        vertexId,
        edge1.edge_id, edge2.edge_id
      ]);
      
      if (mergeResult.rowCount === 0) {
        console.log(`   ⚠️ Failed to create merged edge for vertex ${vertexId}`);
        await client.query('ROLLBACK');
        return false;
      }
      
      // Step 2: Delete the original edges
      await client.query(`
        DELETE FROM ${this.stagingSchema}.ways_noded 
        WHERE id IN ($1, $2)
      `, [edge1.edge_id, edge2.edge_id]);
      
      // Step 3: Remove the degree-2 vertex (it's no longer needed)
      await client.query(`
        DELETE FROM ${this.stagingSchema}.ways_noded_vertices_pgr 
        WHERE id = $1
      `, [vertexId]);
      
      // Step 4: Update vertex degrees for remaining vertices
      await client.query(`
        UPDATE ${this.stagingSchema}.ways_noded_vertices_pgr v
        SET cnt = (
          SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded e
          WHERE e.source = v.id OR e.target = v.id
        )
      `);
      
      // Commit the transaction
      await client.query('COMMIT');
      
      console.log(`   ✅ Successfully merged edges at vertex ${vertexId} in single transaction`);
      return true;
      
    } catch (error) {
      // Rollback on any error
      await client.query('ROLLBACK');
      console.error(`   ❌ Error merging edges at vertex ${vertexId}:`, error);
      return false;
    } finally {
      client.release();
    }
  }

  /**
   * Verify network integrity after degree-2 chain merges
   */
  private async verifyNetworkIntegrity(): Promise<void> {
    // Check for orphaned vertices
    const orphanedResult = await this.pgClient.query(`
      SELECT COUNT(*) as orphaned_count
      FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
      WHERE NOT EXISTS (
        SELECT 1 FROM ${this.stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);
    
    const orphanedCount = parseInt(orphanedResult.rows[0].orphaned_count);
    if (orphanedCount > 0) {
      console.log(`   🧹 Found ${orphanedCount} orphaned vertices - cleaning up...`);
      
      // Clean up orphaned vertices
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        WHERE NOT EXISTS (
          SELECT 1 FROM ${this.stagingSchema}.ways_noded e
          WHERE e.source = v.id OR e.target = v.id
        )
      `);
      
      console.log(`   ✅ Cleaned up ${orphanedCount} orphaned vertices`);
    }
    
    // Check for invalid geometries
    const invalidGeomResult = await this.pgClient.query(`
      SELECT COUNT(*) as invalid_count
      FROM ${this.stagingSchema}.ways_noded
      WHERE NOT ST_IsValid(the_geom) OR ST_IsEmpty(the_geom)
    `);
    
    const invalidCount = parseInt(invalidGeomResult.rows[0].invalid_count);
    if (invalidCount > 0) {
      console.warn(`   ⚠️ Found ${invalidCount} edges with invalid geometries`);
    }
  }

  /**
   * Validate edge network connectivity
   */
  private async validateEdgeNetwork(): Promise<void> {
    console.log('🔍 Validating edge network connectivity...');
    
    // Check for isolated components
    const isolatedResult = await this.pgClient.query(`
      SELECT COUNT(*) as isolated_vertices
      FROM ${this.stagingSchema}.ways_noded_vertices_pgr
      WHERE cnt = 0
    `);
    
    const isolatedVertices = parseInt(isolatedResult.rows[0].isolated_vertices);
    console.log(`   Isolated vertices: ${isolatedVertices}`);
    
    // Check for disconnected edges
    const disconnectedResult = await this.pgClient.query(`
      SELECT COUNT(*) as disconnected_edges
      FROM ${this.stagingSchema}.ways_noded
      WHERE source IS NULL OR target IS NULL
    `);
    
    const disconnectedEdges = parseInt(disconnectedResult.rows[0].disconnected_edges);
    console.log(`   Disconnected edges: ${disconnectedEdges}`);
    
    // Check vertex degree distribution
    const degreeStats = await this.pgClient.query(`
      SELECT cnt as degree, COUNT(*) as vertex_count
      FROM ${this.stagingSchema}.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    console.log(`   Vertex degree distribution:`, degreeStats.rows.map(r => `degree-${r.degree}: ${r.vertex_count}`).join(', '));
    
    if (isolatedVertices > 0 || disconnectedEdges > 0) {
      console.warn(`⚠️ Network has connectivity issues: ${isolatedVertices} isolated vertices, ${disconnectedEdges} disconnected edges`);
    } else {
      console.log('✅ Network connectivity validation passed');
    }
  }

  /**
   * Analyze network connectivity metrics
   */
  private async analyzeNetworkConnectivity(): Promise<{
    totalNodes: number;
    totalEdges: number;
    isolatedNodes: number;
    avgDegree: number;
    maxDegree: number;
  }> {
    console.log('📊 Analyzing network connectivity...');
    
    const connectivityStats = await this.pgClient.query(`
      WITH node_degrees AS (
        SELECT 
          v.id,
          COUNT(*) as degree
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN ${this.stagingSchema}.ways_noded w ON v.id = w.source OR v.id = w.target
        GROUP BY v.id
      ),
      connectivity_summary AS (
        SELECT 
          COUNT(*) as total_nodes,
          COUNT(CASE WHEN degree = 0 THEN 1 END) as isolated_nodes,
          AVG(degree) as avg_degree,
          MAX(degree) as max_degree
        FROM node_degrees
      )
      SELECT 
        cs.total_nodes,
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded) as total_edges,
        cs.isolated_nodes,
        cs.avg_degree,
        cs.max_degree
      FROM connectivity_summary cs
    `);
    
    const stats = connectivityStats.rows[0];
    
    console.log(`📊 Connectivity analysis: ${stats.total_nodes} nodes, ${stats.total_edges} edges, ${stats.isolated_nodes} isolated, avg degree ${parseFloat(stats.avg_degree).toFixed(2)}`);
    
    return {
      totalNodes: parseInt(stats.total_nodes),
      totalEdges: parseInt(stats.total_edges),
      isolatedNodes: parseInt(stats.isolated_nodes),
      avgDegree: parseFloat(stats.avg_degree),
      maxDegree: parseInt(stats.max_degree)
    };
  }

  /**
   * Get network statistics for validation
   */
  async getNetworkStatistics(): Promise<{
    nodes: number;
    edges: number;
    isolatedNodes: number;
    avgDegree: number;
  }> {
    const stats = await this.pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded_vertices_pgr) as nodes,
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded) as edges,
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
         WHERE NOT EXISTS (
           SELECT 1 FROM ${this.stagingSchema}.ways_noded w 
           WHERE w.source = v.id OR w.target = v.id
         )) as isolated_nodes
    `);

    const nodeDegrees = await this.pgClient.query(`
      SELECT AVG(degree) as avg_degree
      FROM (
        SELECT COUNT(*) as degree
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN ${this.stagingSchema}.ways_noded w ON v.id = w.source OR v.id = w.target
        GROUP BY v.id
      ) degrees
    `);

    return {
      nodes: parseInt(stats.rows[0].nodes),
      edges: parseInt(stats.rows[0].edges),
      isolatedNodes: parseInt(stats.rows[0].isolated_nodes),
      avgDegree: parseFloat(nodeDegrees.rows[0].avg_degree || '0')
    };
  }
}
