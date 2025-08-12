import { Pool, PoolClient } from 'pg';

export interface MergeDegree2ChainsResult {
  chainsMerged: number;
  edgesRemoved: number;
  finalEdges: number;
}

/**
 * Aggressive degree-2 chain merging that prioritizes trail name continuity.
 * This creates continuous edges by merging chains with the same trail name,
 * even through intersections, to better reflect the actual trail network.
 * 
 * @param pgClient - PostgreSQL client (Pool or PoolClient)
 * @param stagingSchema - Staging schema name
 */
export async function mergeDegree2Chains(
  pgClient: Pool | PoolClient,
  stagingSchema: string
): Promise<MergeDegree2ChainsResult> {
  console.log('🔗 Aggressive degree-2 chain merging...');
  
  try {
    // Get the next available ID (assumes we're already in a transaction)
    const maxIdResult = await pgClient.query(`
      SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM ${stagingSchema}.ways_noded
    `);
    const nextId = maxIdResult.rows[0].next_id;
  
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
  
  const mergeResult = await pgClient.query(`
      WITH RECURSIVE 
      -- Use the freshly updated vertex degrees from cnt column
      vertex_degrees AS (
        SELECT 
          id as vertex_id,
          cnt as degree
        FROM ${stagingSchema}.ways_noded_vertices_pgr
      ),
      
      -- Find chains starting from any edge and continue through same-name trails
      trail_chains AS (
        -- Base case: start with any edge that has a valid name
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
        WHERE e.name IS NOT NULL AND e.name != ''
        
        UNION ALL
        
        -- Recursive case: extend chains through same-name trails with geometric continuity
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
        WHERE 
          next_e.id != ALL(tc.chain_edges)  -- Don't revisit edges
          AND next_e.source != next_e.target  -- Exclude self-loops
          AND next_e.name = tc.name  -- Same trail name (primary condition)
          AND next_e.name IS NOT NULL  -- Ensure we have a valid name
          AND (
            -- Check for geometric continuity (endpoints should be close)
            -- INCREASED TOLERANCE: 50 meters to handle cases where noding creates small gaps
            ST_DWithin(
              ST_EndPoint(tc.chain_geom), 
              ST_StartPoint(next_e.the_geom), 
              0.0005  -- ~50 meters tolerance (increased from 15m)
            )
            OR ST_DWithin(
              ST_EndPoint(tc.chain_geom), 
              ST_EndPoint(next_e.the_geom), 
              0.0005  -- ~50 meters tolerance
            )
            OR ST_DWithin(
              ST_StartPoint(tc.chain_geom), 
              ST_StartPoint(next_e.the_geom), 
              0.0005  -- ~50 meters tolerance
            )
            OR ST_DWithin(
              ST_StartPoint(tc.chain_geom), 
              ST_EndPoint(next_e.the_geom), 
              0.0005  -- ~50 meters tolerance
            )
          )
          AND array_length(tc.chain_edges, 1) < 20  -- Increased max chain length to 20 edges
      ),
      
      -- Get all valid chains (any chain with 2+ edges)
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
            LEAST(start_vertex, end_vertex) AS s,
            GREATEST(start_vertex, end_vertex) AS t,
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
      
      -- Insert merged edges
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
          'merged-degree2-chain-' || s || '-' || t || '-edges-' || array_to_string(chain_edges, ',') as app_uuid,
          name,
          NULL::bigint as old_id
        FROM mergeable_chains
        RETURNING 1
      ),
      
      -- Remove the original edges that were merged
      deleted_edges AS (
        DELETE FROM ${stagingSchema}.ways_noded 
        WHERE id IN (
          SELECT unnest(chain_edges) as edge_id
          FROM mergeable_chains
        )
        RETURNING id, source, target, name
      )
      
      -- Return counts for auditing
      SELECT 
        (SELECT COUNT(*) FROM inserted_edges) AS chains_merged,
        (SELECT COUNT(*) FROM deleted_edges) AS edges_removed,
        (SELECT COUNT(*) FROM cleaned_existing_chains) AS existing_chains_cleaned;
    `);

    const chainsMerged = Number(mergeResult.rows[0]?.chains_merged || 0);
    const edgesRemoved = Number(mergeResult.rows[0]?.edges_removed || 0);
    const existingChainsCleanedCount = Number(mergeResult.rows[0]?.existing_chains_cleaned || 0);

    if (existingChainsCleanedCount > 0) {
      console.log(`🧹 Pre-cleaned ${existingChainsCleanedCount} existing merged chains that conflicted with new chains`);
    }

    // Debug logging
    console.log(`🔗 Merge results: chainsMerged=${chainsMerged}, edgesRemoved=${edgesRemoved}, existingChainsCleanedCount=${existingChainsCleanedCount}`);

    // Step 2: Recompute vertex degrees AFTER merge and cleanup (ensure consistency after edge changes)
    console.log('🔄 Recomputing vertex degrees after merge...');
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

    // Step 4: Remove orphaned vertices that no longer have any incident edges (inside transaction)
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
      console.log(`🧹 Cleaned up ${orphanedCount} orphaned vertices after cleanup`);
    }

    // Clean up any self-loops that were created during merging
    await pgClient.query(`DELETE FROM ${stagingSchema}.ways_noded WHERE source = target`);
    
    // Step 2: Get final counts
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
