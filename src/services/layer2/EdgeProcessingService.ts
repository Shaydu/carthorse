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
    
    // Step 3: Merge degree-2 chains for maximum connectivity
    result.chainsMerged = await this.mergeDegree2ChainsIteration();
    
    // Step 4: Iterative deduplication and merging for optimal network
    result.overlapsRemoved = await this.iterativeDeduplicationAndMerging();
    
    // Step 5: Validate edge network connectivity
    await this.validateEdgeNetwork();
    
    console.log('✅ LAYER 2 COMPLETE: Fully routable edge network ready');
    console.log(`📊 Layer 2 Results: ${result.edgesCreated} edges, ${result.verticesCreated} vertices, ${result.chainsMerged} chains merged, ${result.overlapsRemoved} overlaps removed`);
    
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
   * Merge degree-2 chains for maximum connectivity
   */
  private async mergeDegree2Chains(): Promise<number> {
    console.log('🔗 Merging degree-2 chains...');
    
    // Import the degree-2 chain merging function
    const { mergeDegree2Chains } = await import('../../utils/services/network-creation/merge-degree2-chains');
    
    const result = await mergeDegree2Chains(this.pgClient, this.stagingSchema);
    console.log(`✅ Merged ${result.chainsMerged} degree-2 chains`);
    
    return result.chainsMerged;
  }

  /**
   * Iterative deduplication and merging for optimal network
   */
  private async iterativeDeduplicationAndMerging(): Promise<number> {
    console.log('🔄 Starting iterative deduplication and merging...');
    
    const maxIterations = 10;
    let iteration = 1;
    let totalDeduplicated = 0;
    let totalMerged = 0;
    
    while (iteration <= maxIterations) {
      console.log(`🔄 [Degree2 Chaining] Iteration ${iteration}/${maxIterations}`);
      
      // Step 1: Deduplicate overlaps in trails table (if enabled)
      let dedupeResult = { overlapsRemoved: 0 };
      const enableOverlapDeduplication = true; // TODO: Make configurable
      if (enableOverlapDeduplication) {
        dedupeResult = await this.deduplicateOverlaps();
        console.log(`   [Overlap] Deduplicated ${dedupeResult.overlapsRemoved} overlaps`);
      } else {
        console.log(`   [Overlap] Skipped - overlap deduplication disabled`);
      }
      
      // Step 2: Skip vertex deduplication (was causing connectivity issues)
      console.log(`   [Vertex Dedup] Skipped - was causing connectivity issues`);
      
      // Step 3: Merge degree-2 chains (if enabled)
      let mergeResult = { chainsMerged: 0 };
      const enableDegree2Merging = true; // TODO: Make configurable
      if (enableDegree2Merging) {
        mergeResult = await this.mergeDegree2ChainsIteration();
        console.log(`   [Degree2] Merged ${mergeResult.chainsMerged} degree-2 chains`);
      } else {
        console.log(`   [Degree2] Skipped - degree-2 merging disabled`);
      }
      
      totalDeduplicated += dedupeResult.overlapsRemoved;
      totalMerged += mergeResult.chainsMerged;
      
      // Comprehensive verification step: check if any overlaps or degree-2 chains remain
      const verificationResult = await this.verifyNoOverlapsOrDegree2Chains();
      console.log(`   [Verification] ${verificationResult.remainingOverlaps} overlaps, ${verificationResult.remainingDegree2Chains} degree-2 chains remain`);
      
      // Check for convergence (no more changes AND no remaining issues)
      if (dedupeResult.overlapsRemoved === 0 && mergeResult.chainsMerged === 0 && 
          verificationResult.remainingOverlaps === 0 && verificationResult.remainingDegree2Chains === 0) {
        console.log(`✅ [Degree2 Chaining] Convergence reached after ${iteration} iterations - no overlaps or degree-2 chains remain`);
        break;
      }
      
      // If we're not making progress, stop to avoid infinite loops
      if (dedupeResult.overlapsRemoved === 0 && mergeResult.chainsMerged === 0) {
        console.log(`⚠️  [Degree2 Chaining] No progress made in iteration ${iteration}, but issues remain. Stopping to avoid infinite loop.`);
        console.log(`   [Degree2 Chaining] Remaining issues: ${verificationResult.remainingOverlaps} overlaps, ${verificationResult.remainingDegree2Chains} degree-2 chains`);
        break;
      }
      
      iteration++;
    }
    
    if (iteration > maxIterations) {
      console.log(`⚠️  [Degree2 Chaining] Reached maximum iterations (${maxIterations}), stopping`);
    }
    
    console.log(`📊 [Degree2 Chaining] Total results: ${totalDeduplicated} overlaps removed, ${totalMerged} chains merged`);
    
    return totalDeduplicated;
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
    
    if (isolatedVertices > 0 || disconnectedEdges > 0) {
      console.warn(`⚠️  Network has connectivity issues: ${isolatedVertices} isolated vertices, ${disconnectedEdges} disconnected edges`);
    } else {
      console.log('✅ Network connectivity validation passed');
    }
  }

  /**
   * Deduplicate overlaps in the current trails table
   */
  private async deduplicateOverlaps(): Promise<{ overlapsRemoved: number }> {
    console.log('   🔍 [Overlap] STAGE 1: Detecting overlaps...');
    
    // Debug: Check for overlapping segments before processing
    const debugOverlapsSql = `
      SELECT 
        t1.id as id1, 
        t2.id as id2,
        t1.name as name1,
        t2.name as name2,
        ST_Length(t1.geometry::geography) as length1,
        ST_Length(t2.geometry::geography) as length2,
        ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) as overlap_length,
        -- Use PostGIS native overlap functions
        ST_Overlaps(t1.geometry, t2.geometry) as has_overlap,
        ST_Contains(t1.geometry, t2.geometry) as t1_contains_t2,
        ST_Contains(t2.geometry, t1.geometry) as t2_contains_t1,
        ST_Covers(t1.geometry, t2.geometry) as t1_covers_t2,
        ST_Covers(t2.geometry, t1.geometry) as t2_covers_t1
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE (
        -- Use PostGIS native overlap detection
        ST_Overlaps(t1.geometry, t2.geometry) OR
        ST_Contains(t1.geometry, t2.geometry) OR
        ST_Contains(t2.geometry, t1.geometry) OR
        ST_Covers(t1.geometry, t2.geometry) OR
        ST_Covers(t2.geometry, t1.geometry)
      )
      AND NOT ST_Equals(t1.geometry, t2.geometry)  -- Not identical
      ORDER BY overlap_length DESC
      LIMIT 10;
    `;
    
    const debugResult = await this.pgClient.query(debugOverlapsSql);
    
    console.log(`   📊 [Overlap] STAGE 1 RESULTS: Found ${debugResult.rows.length} overlapping segment pairs`);
    if (debugResult.rows.length > 0) {
      console.log('   📋 [Overlap] Overlap details:');
      debugResult.rows.forEach((row, index) => {
        const overlapType = row.t1_contains_t2 ? 'CONTAINS' : 
                           row.t2_contains_t1 ? 'CONTAINED' : 
                           row.has_overlap ? 'OVERLAPS' : 'OTHER';
        console.log(`      ${index + 1}. ${row.name1} (${row.id1}, ${row.length1.toFixed(2)}m) ${overlapType} ${row.name2} (${row.id2}, ${row.length2.toFixed(2)}m) - overlap: ${row.overlap_length.toFixed(2)}m`);
      });
    }
    
    if (debugResult.rows.length === 0) {
      console.log('   ✅ [Overlap] No overlaps detected, skipping deduplication');
      return { overlapsRemoved: 0 };
    }
    
    console.log('   🧹 [Overlap] STAGE 2: Deduplicating overlaps...');
    
    // Deduplicate overlapping segments by removing overlaps from the shorter edge
    const deduplicateOverlapsSql = `
      WITH overlapping_segments AS (
        -- Find segments that have significant overlap using PostGIS native functions
        SELECT
          t1.id as id1, t1.geometry as geom1,
          t2.id as id2, t2.geometry as geom2,
          ST_Intersection(t1.geometry, t2.geometry) as overlap_geom,
          ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) as overlap_length
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
        WHERE (
          -- Use PostGIS native overlap detection
          ST_Overlaps(t1.geometry, t2.geometry) OR
          ST_Contains(t1.geometry, t2.geometry) OR
          ST_Contains(t2.geometry, t1.geometry)
        )
        AND NOT ST_Equals(t1.geometry, t2.geometry)  -- Not identical
      ),
      deduplicated_geometries AS (
        -- Remove overlap from the shorter edge (keep the longer one intact)
        SELECT 
          id1,
          CASE 
            WHEN ST_Length(geom1::geography) <= ST_Length(geom2::geography) THEN
              -- Remove overlap from the shorter edge, but only if result is a valid LineString
              CASE 
                WHEN ST_GeometryType(ST_Difference(geom1, overlap_geom)) = 'ST_LineString'
                  AND ST_IsValid(ST_Difference(geom1, overlap_geom))
                THEN ST_Difference(geom1, overlap_geom)
                -- If difference produces MultiLineString or invalid geometry, keep original
                ELSE geom1
              END
            ELSE geom1
            END as deduplicated_geom,
          overlap_length
        FROM overlapping_segments
        WHERE ST_IsValid(
          CASE 
            WHEN ST_Length(geom1::geography) <= ST_Length(geom2::geography) THEN
              CASE 
                WHEN ST_GeometryType(ST_Difference(geom1, overlap_geom)) = 'ST_LineString'
                  AND ST_IsValid(ST_Difference(geom1, overlap_geom))
                THEN ST_Difference(geom1, overlap_geom)
                ELSE geom1
              END
            ELSE geom1
          END
        )
      )
      UPDATE ${this.stagingSchema}.trails t
      SET geometry = dg.deduplicated_geom
      FROM deduplicated_geometries dg
      WHERE t.id = dg.id1
        AND ST_Length(dg.deduplicated_geom::geography) > 0.1  -- Minimum 0.1m length
    `;
    
    const dedupeResult = await this.pgClient.query(deduplicateOverlapsSql);
    console.log(`   ✅ [Overlap] Deduplicated ${dedupeResult.rowCount} overlaps`);
    
    return { overlapsRemoved: dedupeResult.rowCount };
  }

  /**
   * Merge degree-2 chains iteration
   */
  private async mergeDegree2ChainsIteration(): Promise<{ chainsMerged: number }> {
    // Import the degree-2 chain merging function
    const { mergeDegree2Chains } = await import('../../utils/services/network-creation/merge-degree2-chains');
    
    const result = await mergeDegree2Chains(this.pgClient, this.stagingSchema);
    return { chainsMerged: result.chainsMerged };
  }

  /**
   * Verify no overlaps or degree-2 chains remain
   */
  private async verifyNoOverlapsOrDegree2Chains(): Promise<{ remainingOverlaps: number; remainingDegree2Chains: number }> {
    // Check for remaining overlaps
    const overlapsResult = await this.pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE (
        ST_Overlaps(t1.geometry, t2.geometry) OR
        ST_Contains(t1.geometry, t2.geometry) OR
        ST_Contains(t2.geometry, t1.geometry)
      )
      AND NOT ST_Equals(t1.geometry, t2.geometry)
    `);
    
    // Check for remaining degree-2 chains
    const degree2Result = await this.pgClient.query(`
      WITH degree_counts AS (
        SELECT 
          v.id,
          COUNT(*) as degree
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        JOIN ${this.stagingSchema}.ways_noded e ON v.id = e.source OR v.id = e.target
        GROUP BY v.id
      )
      SELECT COUNT(*) as count
      FROM degree_counts
      WHERE degree = 2
    `);
    
    return {
      remainingOverlaps: parseInt(overlapsResult.rows[0].count),
      remainingDegree2Chains: parseInt(degree2Result.rows[0].count)
    };
  }
}
