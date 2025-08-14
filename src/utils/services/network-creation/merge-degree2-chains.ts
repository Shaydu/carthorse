import { Pool, PoolClient } from 'pg';

export interface MergeDegree2ChainsResult {
  chainsMerged: number;
  edgesRemoved: number;
  finalEdges: number;
}

export interface Degree2AnalysisResult {
  chainsFound: number;
  edgesThatWouldBeRemoved: number[];
  chainsThatWouldBeCreated: Array<{
    startVertex: number;
    endVertex: number;
    edgeIds: number[];
    totalLength: number;
    name: string;
  }>;
}

/**
 * Analyze what degree-2 chains would be merged without actually merging them.
 * This is useful for debugging and understanding what the merge process would do.
 * 
 * @param pgClient - PostgreSQL client (Pool or PoolClient)
 * @param stagingSchema - Staging schema name
 */
export async function analyzeDegree2Chains(
  pgClient: Pool | PoolClient,
  stagingSchema: string
): Promise<Degree2AnalysisResult> {
  console.log('🔍 Analyzing degree-2 chains (dry run)...');
  
  try {
    // Step 1: Recompute vertex degrees BEFORE analysis
    console.log('🔄 Recomputing vertex degrees before analysis...');
    await pgClient.query(`
      UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);
    
    // Log vertex degree distribution for debugging
    const degreeStats = await pgClient.query(`
      SELECT cnt as degree, COUNT(*) as vertex_count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    console.log('📊 Vertex degrees:', degreeStats.rows.map(r => `degree-${r.degree}: ${r.vertex_count} vertices`).join(', '));
    
    // Step 2: Find all mergeable chains (same logic as mergeDegree2Chains but without actually merging)
    const analysisResult = await pgClient.query(`
      WITH RECURSIVE 
      vertex_degrees AS (
        SELECT 
          id as vertex_id,
          cnt as degree
        FROM ${stagingSchema}.ways_noded_vertices_pgr
      ),
      
      trail_chains AS (
        SELECT 
          e.id as edge_id,
          e.source as start_vertex,
          e.target as current_vertex,
          ARRAY[e.id]::bigint[] as chain_edges,
          ARRAY[e.source, e.target]::int[] as chain_vertices,
          e.the_geom::geometry as chain_geom,
          e.length_km as total_length,
          e.elevation_gain as total_elevation_gain,
          e.elevation_loss as total_elevation_loss,
          e.name
        FROM ${stagingSchema}.ways_noded e
        JOIN vertex_degrees vd_source ON e.source = vd_source.vertex_id
        JOIN vertex_degrees vd_target ON e.target = vd_target.vertex_id
        WHERE (vd_source.degree = 1 OR vd_source.degree >= 3 OR vd_target.degree = 1 OR vd_target.degree >= 3)
        
        UNION ALL
        
        SELECT 
          next_e.id as edge_id,
          tc.start_vertex,
          CASE 
            WHEN next_e.source = tc.current_vertex THEN next_e.target
            ELSE next_e.source
          END as current_vertex,
          tc.chain_edges || next_e.id as chain_edges,
          tc.chain_vertices || CASE 
            WHEN next_e.source = tc.current_vertex THEN next_e.target
            ELSE next_e.source
          END as chain_vertices,
          ST_LineMerge(ST_Union(tc.chain_geom, next_e.the_geom))::geometry(LINESTRING,4326) as chain_geom,
          tc.total_length + next_e.length_km as total_length,
          tc.total_elevation_gain + next_e.elevation_gain as total_elevation_gain,
          tc.total_elevation_loss + next_e.elevation_loss as total_elevation_loss,
          tc.name
        FROM trail_chains tc
        JOIN ${stagingSchema}.ways_noded next_e ON 
          (next_e.source = tc.current_vertex OR next_e.target = tc.current_vertex)
        JOIN vertex_degrees vd ON 
          CASE 
            WHEN next_e.source = tc.current_vertex THEN next_e.target
            ELSE next_e.source
          END = vd.vertex_id
        WHERE 
          next_e.id != ALL(tc.chain_edges)
          AND (
            vd.degree = 2
            OR (vd.degree = 1 OR vd.degree >= 3)
          )
          AND NOT (
            EXISTS (
              SELECT 1 FROM vertex_degrees vd_current 
              WHERE vd_current.vertex_id = tc.current_vertex 
                AND (vd_current.degree = 1 OR vd_current.degree >= 3)
            )
          )
      ),
      
      complete_chains AS (
        SELECT 
          start_vertex,
          current_vertex as end_vertex,
          chain_edges,
          chain_vertices,
          chain_geom,
          total_length,
          total_elevation_gain,
          total_elevation_loss,
          name,
          array_length(chain_edges, 1) as chain_length
        FROM trail_chains
        WHERE array_length(chain_edges, 1) > 1
      ),
      
      mergeable_chains AS (
        WITH ranked_chains AS (
          SELECT 
            start_vertex AS s,
            end_vertex AS t,
            chain_edges,
            chain_vertices,
            chain_geom,
            total_length,
            total_elevation_gain,
            total_elevation_loss,
            name,
            chain_length,
            ROW_NUMBER() OVER (ORDER BY chain_length DESC, total_length DESC) as priority
          FROM complete_chains
          WHERE start_vertex IN (SELECT vertex_id FROM vertex_degrees)
            AND end_vertex IN (SELECT vertex_id FROM vertex_degrees)
        )
        SELECT 
          s, t, chain_edges, chain_vertices, chain_geom,
          total_length, total_elevation_gain, total_elevation_loss,
          name, chain_length
        FROM ranked_chains r1
        WHERE NOT EXISTS (
          SELECT 1 FROM ranked_chains r2
          WHERE r2.priority < r1.priority
            AND r2.chain_edges && r1.chain_edges
        )
      )
      SELECT 
        s as start_vertex,
        t as end_vertex,
        chain_edges,
        total_length,
        name,
        chain_length
      FROM mergeable_chains
      ORDER BY chain_length DESC, total_length DESC
    `);
    
    // Extract the results
    const chainsThatWouldBeCreated = analysisResult.rows.map(row => ({
      startVertex: row.start_vertex,
      endVertex: row.end_vertex,
      edgeIds: row.chain_edges,
      totalLength: row.total_length,
      name: row.name
    }));
    
    // Get all edges that would be removed
    const edgesThatWouldBeRemoved = new Set<number>();
    chainsThatWouldBeCreated.forEach(chain => {
      chain.edgeIds.forEach((edgeId: number) => edgesThatWouldBeRemoved.add(edgeId));
    });
    
    console.log(`🔍 Analysis complete:`);
    console.log(`   📊 Found ${chainsThatWouldBeCreated.length} mergeable chains`);
    console.log(`   🗑️ Would remove ${edgesThatWouldBeRemoved.size} edges`);
    
    // Log details of each chain that would be created
    chainsThatWouldBeCreated.forEach((chain, index) => {
      console.log(`   🔗 Chain ${index + 1}: ${chain.name} (${chain.edgeIds.length} edges, ${chain.totalLength.toFixed(3)}km)`);
      console.log(`      Start: vertex ${chain.startVertex}, End: vertex ${chain.endVertex}`);
      console.log(`      Edge IDs: [${chain.edgeIds.join(', ')}]`);
    });
    
    return {
      chainsFound: chainsThatWouldBeCreated.length,
      edgesThatWouldBeRemoved: Array.from(edgesThatWouldBeRemoved),
      chainsThatWouldBeCreated
    };
    
  } catch (error) {
    console.error('❌ Error analyzing degree-2 chains:', error);
    return {
      chainsFound: 0,
      edgesThatWouldBeRemoved: [],
      chainsThatWouldBeCreated: []
    };
  }
}

/**
 * Merge degree-2 chain edges into single edges.
 * This creates continuous edges from dead ends to intersections by merging
 * chains where internal vertices have degree 2.
 * 
 * @param pgClient - PostgreSQL client (Pool or PoolClient)
 * @param stagingSchema - Staging schema name
 */
export async function mergeDegree2Chains(
  pgClient: Pool | PoolClient,
  stagingSchema: string
): Promise<MergeDegree2ChainsResult> {
  console.log('🔗 Merging degree-2 chains...');
  
  try {
    // Get the next available ID (assumes we're already in a transaction)
    const maxIdResult = await pgClient.query(`
      SELECT COALESCE(MAX(id), 0) as max_id FROM ${stagingSchema}.ways_noded
    `);
    const nextId = parseInt(maxIdResult.rows[0].max_id) + 1;
  
    // Step 1: Recompute vertex degrees BEFORE merge (defensive against upstream inconsistencies)
    console.log('🔄 Recomputing vertex degrees before merge...');
    await pgClient.query(`
      UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);
    
    // Log vertex degree distribution before merge for debugging
    const degreeStatsBefore = await pgClient.query(`
      SELECT cnt as degree, COUNT(*) as vertex_count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    console.log('📊 Vertex degrees BEFORE merge:', degreeStatsBefore.rows.map(r => `degree-${r.degree}: ${r.vertex_count} vertices`).join(', '));
    
    // Step 2: PHASE 1 - MERGE EDGES INTO LONGER CHAINS (keep all vertices)
    console.log('🔄 Phase 1: Merging edges into longer chains...');
    const mergeResult = await pgClient.query(`
      WITH RECURSIVE 
      -- Use the freshly updated vertex degrees from cnt column
      vertex_degrees AS (
        SELECT 
          id as vertex_id,
          cnt as degree
        FROM ${stagingSchema}.ways_noded_vertices_pgr
      ),
      
      -- Find chains starting at degree 1 or degree >= 3 and continue through degree 2
      trail_chains AS (
        -- Base case: start with edges from degree-1 vertices (dead ends) OR degree-3+ vertices (intersections)
        -- Consider both source and target vertices
        SELECT 
          e.id as edge_id,
          e.source as start_vertex,
          e.target as current_vertex,
          ARRAY[e.id]::bigint[] as chain_edges,
          ARRAY[e.source, e.target]::int[] as chain_vertices,
          e.the_geom::geometry as chain_geom,
          e.length_km as total_length,
          e.elevation_gain as total_elevation_gain,
          e.elevation_loss as total_elevation_loss,
          e.name
        FROM ${stagingSchema}.ways_noded e
        JOIN vertex_degrees vd_source ON e.source = vd_source.vertex_id
        JOIN vertex_degrees vd_target ON e.target = vd_target.vertex_id
        WHERE (vd_source.degree = 1 OR vd_source.degree >= 3 OR vd_target.degree = 1 OR vd_target.degree >= 3)
        
        UNION ALL
        
        -- Recursive case: extend chains through degree-2 vertices AND to final endpoints (degree-1 or degree>=3)
        SELECT 
          next_e.id as edge_id,
          tc.start_vertex,
          CASE 
            WHEN next_e.source = tc.current_vertex THEN next_e.target
            ELSE next_e.source
          END as current_vertex,
          tc.chain_edges || next_e.id as chain_edges,
          tc.chain_vertices || CASE 
            WHEN next_e.source = tc.current_vertex THEN next_e.target
            ELSE next_e.source
          END as chain_vertices,
          (
            WITH merged AS (
              SELECT ST_LineMerge(ST_Union(tc.chain_geom, next_e.the_geom)) as geom
            )
            SELECT 
              CASE 
                WHEN ST_GeometryType(geom) = 'ST_LineString' THEN geom
                ELSE ST_GeometryN(geom, 1)
              END
            FROM merged
          )::geometry as chain_geom,
          tc.total_length + next_e.length_km as total_length,
          tc.total_elevation_gain + next_e.elevation_gain as total_elevation_gain,
          tc.total_elevation_loss + next_e.elevation_loss as total_elevation_loss,
          tc.name
        FROM trail_chains tc
        JOIN ${stagingSchema}.ways_noded next_e ON 
          (next_e.source = tc.current_vertex OR next_e.target = tc.current_vertex)
        JOIN vertex_degrees vd ON 
          CASE 
            WHEN next_e.source = tc.current_vertex THEN next_e.target
            ELSE next_e.source
          END = vd.vertex_id
        WHERE 
          next_e.id != ALL(tc.chain_edges)  -- Don't revisit edges
          AND (
            vd.degree = 2  -- Continue through degree-2 vertices
            OR (
              vd.degree = 1 OR vd.degree >= 3  -- OR reach endpoints/intersections but don't continue beyond them
            )
          )
          AND NOT (
            -- Don't continue FROM degree-1 or degree>=3 vertices (they are endpoints)
            EXISTS (
              SELECT 1 FROM vertex_degrees vd_current 
              WHERE vd_current.vertex_id = tc.current_vertex 
                AND (vd_current.degree = 1 OR vd_current.degree >= 3)
            )
          )
      ),
      
      -- Get all valid chains (any degree-2 chain with 2+ edges)
      complete_chains AS (
        SELECT 
          start_vertex,
          current_vertex as end_vertex,
          chain_edges,
          chain_vertices,
          chain_geom,
          total_length,
          total_elevation_gain,
          total_elevation_loss,
          name,
          array_length(chain_edges, 1) as chain_length
        FROM trail_chains
        WHERE array_length(chain_edges, 1) > 1  -- Must have at least 2 edges to merge
      ),
      
      -- Select longest chains ensuring no edge appears in multiple chains
      mergeable_chains AS (
        WITH ranked_chains AS (
          SELECT 
            start_vertex AS s,  -- Use actual start vertex, not LEAST
            end_vertex AS t,    -- Use actual end vertex, not GREATEST
            chain_edges,
            chain_vertices,
            chain_geom,
            total_length,
            total_elevation_gain,
            total_elevation_loss,
            name,
            chain_length,
            ROW_NUMBER() OVER (ORDER BY chain_length DESC, total_length DESC) as priority
          FROM complete_chains
          WHERE start_vertex IN (SELECT vertex_id FROM vertex_degrees)  -- Ensure start vertex exists
            AND end_vertex IN (SELECT vertex_id FROM vertex_degrees)    -- Ensure end vertex exists
        )
        SELECT 
          s, t, chain_edges, chain_vertices, chain_geom,
          total_length, total_elevation_gain, total_elevation_loss,
          name, chain_length
        FROM ranked_chains r1
        WHERE NOT EXISTS (
          -- Ensure no higher priority chain shares any edges with this chain
          SELECT 1 FROM ranked_chains r2
          WHERE r2.priority < r1.priority
            AND r2.chain_edges && r1.chain_edges  -- PostgreSQL array overlap operator
        )
      ),
      
      -- Pre-cleanup: Remove existing merged chains that would conflict with new chains we're about to create
      cleaned_existing_chains AS (
        DELETE FROM ${stagingSchema}.ways_noded
        WHERE app_uuid LIKE 'merged-degree2-chain-%'
          AND EXISTS (
            SELECT 1 FROM mergeable_chains mc
            WHERE mc.chain_edges && (
              string_to_array(
                CASE 
                  WHEN app_uuid LIKE '%edges-%' THEN split_part(app_uuid, 'edges-', 2)
                  ELSE ''
                END,
                ','
              )::bigint[]
            )
          )
        RETURNING id, app_uuid
      ),
      
      -- Insert merged edges and delete constituent edges in one operation
      inserted_edges AS (
        INSERT INTO ${stagingSchema}.ways_noded (
          id, source, target, the_geom, length_km, elevation_gain, elevation_loss,
          app_uuid, name, old_id
        )
        SELECT 
          ${nextId} + row_number() OVER () - 1 as id,
          s as source,
          t as target,
          chain_geom as the_geom,
          total_length as length_km,
          total_elevation_gain as elevation_gain,
          total_elevation_loss as elevation_loss,
          'merged-degree2-chain-' || s || '-' || t || '-' || array_length(chain_edges, 1) || 'edges' as app_uuid,
          name,
          NULL::bigint as old_id
        FROM mergeable_chains
        RETURNING id
      ),
      
      -- Delete constituent edges using the chain_edges from mergeable_chains
      deleted_edges AS (
        DELETE FROM ${stagingSchema}.ways_noded 
        WHERE id IN (
          SELECT unnest(mc.chain_edges) 
          FROM mergeable_chains mc
        )
        RETURNING id
      ),
      
      -- Remove orphaned vertices (degree-0 vertices) in the same transaction
      orphaned_vertices AS (
        DELETE FROM ${stagingSchema}.ways_noded_vertices_pgr v
        WHERE NOT EXISTS (
          SELECT 1 FROM ${stagingSchema}.ways_noded e
          WHERE e.source = v.id OR e.target = v.id
        )
        RETURNING id
      )
      
      -- Return counts for auditing
      SELECT 
        (SELECT COUNT(*) FROM inserted_edges) AS chains_merged,
        (SELECT COUNT(*) FROM deleted_edges) AS edges_removed,
        (SELECT COUNT(*) FROM orphaned_vertices) AS orphaned_vertices_removed,
        (SELECT COUNT(*) FROM cleaned_existing_chains) AS existing_chains_cleaned;
    `);

    const chainsMerged = Number(mergeResult.rows[0]?.chains_merged || 0);
    const edgesRemoved = Number(mergeResult.rows[0]?.edges_removed || 0);
    const orphanedVerticesRemoved = Number(mergeResult.rows[0]?.orphaned_vertices_removed || 0);
    const existingChainsCleanedCount = Number(mergeResult.rows[0]?.existing_chains_cleaned || 0);

    if (existingChainsCleanedCount > 0) {
      console.log(`🧹 Pre-cleaned ${existingChainsCleanedCount} existing merged chains that conflicted with new chains`);
    }
    
    if (orphanedVerticesRemoved > 0) {
      console.log(`🧹 Cleaned up ${orphanedVerticesRemoved} orphaned vertices (handled in same transaction)`);
    }

    // Debug: Show what chains were created
    if (chainsMerged > 0) {
      console.log(`🔍 Created ${chainsMerged} merged chains. Checking details...`);
      const chainDetails = await pgClient.query(`
        SELECT id, source, target, app_uuid, name 
        FROM ${stagingSchema}.ways_noded 
        WHERE app_uuid LIKE 'merged-degree2-chain-%' 
        ORDER BY id DESC 
        LIMIT ${chainsMerged}
      `);
      
      chainDetails.rows.forEach((chain, index) => {
        console.log(`   Chain ${index + 1}: ID ${chain.id}, ${chain.source}→${chain.target}, "${chain.name}", ${chain.app_uuid}`);
      });
    }

    // Step 3: PHASE 2 - DELETION IS NOW HANDLED IN THE SAME TRANSACTION
    if (edgesRemoved > 0) {
      console.log(`🗑️  Deleted ${edgesRemoved} constituent edges (handled in same transaction)`);
    }

    // Step 3: PHASE 3 - RECOMPUTE VERTEX DEGREES AFTER EDGE DELETION
    console.log('🔄 Phase 3: Recomputing vertex degrees after edge deletion...');
    await pgClient.query(`
      UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);
    
    // Log vertex degree distribution after merge for debugging
    const degreeStatsAfter = await pgClient.query(`
      SELECT cnt as degree, COUNT(*) as vertex_count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    console.log('📊 Vertex degrees AFTER merge:', degreeStatsAfter.rows.map(r => `degree-${r.degree}: ${r.vertex_count} vertices`).join(', '));

    // Step 4: PHASE 4 - REMOVE ORPHANED VERTICES (only after all merges and deletions are complete)
    console.log('🔄 Phase 4: Removing orphaned vertices...');
    const orphanedResult = await pgClient.query(`
      DELETE FROM ${stagingSchema}.ways_noded_vertices_pgr v
      WHERE NOT EXISTS (
        SELECT 1 FROM ${stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
      RETURNING id
    `);
    
    const orphanedCount = orphanedResult.rowCount || 0;
    if (orphanedCount > 0) {
      console.log(`🧹 Cleaned up ${orphanedCount} orphaned vertices after all merges completed`);
    }

    // Step 6: Get final counts
    const finalCountResult = await pgClient.query(`
      SELECT COUNT(*) as final_edges FROM ${stagingSchema}.ways_noded;
    `);

    const finalEdges = Number(finalCountResult.rows[0]?.final_edges || 0);

    console.log(`🔗 Degree-2 chain merge: chainsMerged=${chainsMerged}, edgesRemoved=${edgesRemoved}, existingChainsCleanedCount=${existingChainsCleanedCount}, finalEdges=${finalEdges}`);

    // Debug: Check for duplicate IDs after merge
    const duplicateCheck = await pgClient.query(`
      SELECT id, COUNT(*) as count
      FROM ${stagingSchema}.ways_noded
      GROUP BY id
      HAVING COUNT(*) > 1
    `);
    
    if (duplicateCheck.rows.length > 0) {
      console.warn(`⚠️ Found ${duplicateCheck.rows.length} duplicate edge IDs after merge:`, duplicateCheck.rows.map(r => `ID ${r.id} (${r.count} copies)`).join(', '));
    }

    return {
      chainsMerged,
      edgesRemoved,
      finalEdges
    };

  } catch (error) {
    console.error('❌ Error merging degree-2 chains:', error);
    throw error;
  }
}
