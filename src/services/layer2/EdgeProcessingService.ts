import { Pool } from 'pg';
import { PgRoutingHelpers } from '../../utils/pgrouting-helpers';

export interface EdgeProcessingConfig {
  stagingSchema: string;
  pgClient: Pool;
}

export interface EdgeProcessingResult {
  edgesCreated: number;
  verticesCreated: number;
  chainsMerged: number;
  overlapsRemoved: number;
}

export class EdgeProcessingService {
  private stagingSchema: string;
  private pgClient: Pool;

  constructor(config: EdgeProcessingConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
  }

  /**
   * Process Layer 2: Edges and nodes from clean trails
   */
  async processEdges(): Promise<EdgeProcessingResult> {
    console.log('🛤️ LAYER 2: EDGES - Building fully routable edge network...');
    
    const result: EdgeProcessingResult = {
      edgesCreated: 0,
      verticesCreated: 0,
      chainsMerged: 0,
      overlapsRemoved: 0
    };

    // Step 1: Create pgRouting network from clean trails
    const networkResult = await this.createPgRoutingNetwork();
    result.edgesCreated = networkResult.edges;
    result.verticesCreated = networkResult.vertices;
    
    // Step 2: Add length and elevation columns to ways_noded
    await this.addLengthAndElevationColumns();
    
    // Step 3: Iterative degree-2 chain merge for maximum connectivity
    result.chainsMerged = await this.iterativeDegree2ChainMerge();
    
    // Step 4: Validate edge network connectivity
    await this.validateEdgeNetwork();
    
    console.log('✅ LAYER 2 COMPLETE: Fully routable edge network ready');
    console.log(`📊 Layer 2 Results: ${result.edgesCreated} edges, ${result.verticesCreated} vertices, ${result.chainsMerged} chains merged`);
    
    return result;
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
  private async addLengthAndElevationColumns(): Promise<void> {
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
   * This implements the requirements from the degree-2 edge merge cleanup document
   */
  private async iterativeDegree2ChainMerge(): Promise<number> {
    console.log('🔗 Starting iterative degree-2 chain merge...');
    
    // Import the degree-2 chain merging function
    const { mergeDegree2Chains, analyzeDegree2Chains } = await import('../../utils/services/network-creation/merge-degree2-chains');
    
    const maxIterations = 15; // From config
    let iteration = 1;
    let totalChainsMerged = 0;
    
    while (iteration <= maxIterations) {
      console.log(`🔄 [Degree2 Chain Merge] Iteration ${iteration}/${maxIterations}`);
      
      // Step 1: Analyze what chains would be merged (dry run)
      console.log('   🔍 Analyzing degree-2 chains...');
      const analysisResult = await analyzeDegree2Chains(this.pgClient, this.stagingSchema);
      
      if (analysisResult.chainsFound === 0) {
        console.log('   ✅ No more degree-2 chains found - convergence reached');
        break;
      }
      
      console.log(`   📊 Found ${analysisResult.chainsFound} chains to merge`);
      
      // Step 2: Perform the actual merge
      console.log('   🔗 Merging degree-2 chains...');
      const mergeResult = await mergeDegree2Chains(this.pgClient, this.stagingSchema);
      
      if (mergeResult.chainsMerged === 0) {
        console.log('   ⚠️ No chains were merged despite analysis finding chains - stopping to avoid infinite loop');
        break;
      }
      
      totalChainsMerged += mergeResult.chainsMerged;
      console.log(`   ✅ Merged ${mergeResult.chainsMerged} chains (total: ${totalChainsMerged})`);
      
      // Step 3: Verify network integrity after merge
      await this.verifyNetworkIntegrity();
      
      iteration++;
    }
    
    if (iteration > maxIterations) {
      console.log(`⚠️ Reached maximum iterations (${maxIterations}), stopping`);
    }
    
    console.log(`📊 [Degree2 Chain Merge] Total results: ${totalChainsMerged} chains merged over ${iteration - 1} iterations`);
    
    return totalChainsMerged;
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
}
