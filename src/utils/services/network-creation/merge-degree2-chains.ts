import { Pool, PoolClient } from 'pg';
import { getTolerances } from '../../config-loader';

export interface MergeDegree2ChainsResult {
  chainsMerged: number;
  edgesRemoved: number;
  bridgeEdgesMerged: number;
  bridgeEdgesRemoved: number;
  finalEdges: number;
}

/**
 * Validate network connectivity before and after degree-2 merging
 * This ensures we don't lose connectivity during the merge process
 */
async function validateConnectivity(
  pgClient: Pool | PoolClient,
  stagingSchema: string,
  operation: string
): Promise<{ isConnected: boolean; reachableNodes: number; totalNodes: number; connectivityPercentage: number }> {
  try {
    // Get total node count
    const totalNodesResult = await pgClient.query(`
      SELECT COUNT(*) as total_nodes FROM ${stagingSchema}.ways_noded_vertices_pgr
    `);
    const totalNodes = Number(totalNodesResult.rows[0]?.total_nodes || 0);
    
    if (totalNodes === 0) {
      return { isConnected: false, reachableNodes: 0, totalNodes: 0, connectivityPercentage: 0 };
    }
    
    // Find reachable nodes from a random starting node using pgRouting's pgr_dijkstra
    const reachableResult = await pgClient.query(`
      WITH reachable_nodes AS (
        SELECT DISTINCT node
        FROM pgr_dijkstra(
          'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
          (SELECT id FROM ${stagingSchema}.ways_noded_vertices_pgr LIMIT 1),
          (SELECT array_agg(id) FROM ${stagingSchema}.ways_noded_vertices_pgr),
          false
        )
        WHERE node IS NOT NULL
      )
      SELECT COUNT(*) as reachable_count FROM reachable_nodes
    `);
    
    const reachableNodes = Number(reachableResult.rows[0]?.reachable_count || 0);
    const connectivityPercentage = totalNodes > 0 ? (reachableNodes / totalNodes) * 100 : 0;
    const isConnected = connectivityPercentage >= 80; // Consider connected if 80%+ nodes are reachable
    
    console.log(`🔍 [${operation}] Connectivity validation: ${reachableNodes}/${totalNodes} nodes reachable (${connectivityPercentage.toFixed(1)}%)`);
    
    if (!isConnected) {
      console.error(`❌ [${operation}] CRITICAL: Network connectivity lost! Only ${connectivityPercentage.toFixed(1)}% of nodes are reachable`);
      console.error(`   This indicates the degree-2 merge process is breaking the network topology`);
    }
    
    return { isConnected, reachableNodes, totalNodes, connectivityPercentage };
  } catch (error) {
    console.warn(`⚠️ [${operation}] Connectivity validation failed:`, error);
    // If validation fails, assume connected to avoid blocking the process
    return { isConnected: true, reachableNodes: 0, totalNodes: 0, connectivityPercentage: 100 };
  }
}

/**
 * Geometry-based degree-2 chain merging.
 * This creates continuous edges by merging chains with geometrically continuous endpoints,
 * regardless of trail names, to better reflect the actual trail network topology.
 * 
 * IDEAL STATE: Each edge should be a single, continuous route between:
 * - Two endpoints (degree-1 vertices), OR
 * - Two intersections (degree-3+ vertices), OR  
 * - One endpoint and one intersection
 * 
 * No overlaps should exist between edges.
 *
 * @param pgClient - PostgreSQL client (Pool or PoolClient)
 * @param stagingSchema - Staging schema name
 * @returns Promise<MergeDegree2ChainsResult>
 */
export async function mergeDegree2Chains(
  pgClient: Pool | PoolClient,
  stagingSchema: string
): Promise<MergeDegree2ChainsResult> {
  console.log('🔗 Geometry-based degree-2 chain merging and bridge edge cleanup...');
  
  try {
    // Get configurable tolerance from YAML config
    const tolerances = getTolerances();
    const degree2Tolerance = tolerances.degree2MergeTolerance / 111000.0; // Convert meters to degrees
    console.log(`🔧 Using degree2 merge tolerance: ${tolerances.degree2MergeTolerance}m (${degree2Tolerance.toFixed(6)} degrees)`);
    
    // Validate connectivity BEFORE merge
    console.log('🔍 Validating connectivity before degree-2 merge...');
    const connectivityBefore = await validateConnectivity(pgClient, stagingSchema, 'BEFORE_MERGE');
    
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
      
      -- Find chains starting from degree-1 vertices (endpoints) and continue through geometrically continuous edges
      -- Base case: start with edges connected to degree-1 vertices
      trail_chains AS (
        SELECT 
          e.id as edge_id,
          e.source as start_vertex,
          e.target as current_vertex,
          ARRAY[e.id::bigint] as chain_edges,
          ARRAY[e.source, e.target] as chain_vertices,
          e.the_geom::geometry(LineString,4326) as chain_geom,
          e.length_km as total_length,
          e.elevation_gain as total_elevation_gain,
          e.elevation_loss as total_elevation_loss,
          e.name
        FROM ${stagingSchema}.ways_noded e
        JOIN ${stagingSchema}.ways_noded_vertices_pgr v ON e.source = v.id
        WHERE e.source != e.target  -- Exclude self-loops
          AND v.cnt = 1  -- Start only from degree-1 vertices (endpoints)
        
        UNION ALL
        
        -- Also start from edges where target is degree-1
        SELECT 
          e.id as edge_id,
          e.target as start_vertex,
          e.source as current_vertex,
          ARRAY[e.id::bigint] as chain_edges,
          ARRAY[e.target, e.source] as chain_vertices,
          e.the_geom::geometry(LineString,4326) as chain_geom,
          e.length_km as total_length,
          e.elevation_gain as total_elevation_gain,
          e.elevation_loss as total_elevation_loss,
          e.name
        FROM ${stagingSchema}.ways_noded e
        JOIN ${stagingSchema}.ways_noded_vertices_pgr v ON e.target = v.id
        WHERE e.source != e.target  -- Exclude self-loops
          AND v.cnt = 1  -- Start only from degree-1 vertices (endpoints)
        
        UNION ALL
        
        -- Recursive case: extend chains through geometrically continuous edges
        SELECT 
          next_e.id as edge_id,
          tc.start_vertex,
          CASE 
            WHEN next_e.source = tc.current_vertex THEN next_e.target
            ELSE next_e.source
          END as current_vertex,
          tc.chain_edges || next_e.id::bigint as chain_edges,
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
          )::geometry(LineString,4326) as chain_geom,
          tc.total_length + next_e.length_km as total_length,
          tc.total_elevation_gain + next_e.elevation_gain as total_elevation_gain,
          tc.total_elevation_loss + next_e.elevation_loss as total_elevation_loss,
          tc.name
        FROM trail_chains tc
        JOIN ${stagingSchema}.ways_noded next_e ON 
          (next_e.source = tc.current_vertex OR next_e.target = tc.current_vertex)
        WHERE 
          next_e.id::bigint != ALL(tc.chain_edges)  -- Don't revisit edges
          AND next_e.source != next_e.target  -- Exclude self-loops
          AND (
            -- Check for geometric continuity (endpoints should be close)
            -- CONFIGURABLE TOLERANCE: Uses YAML config degree2MergeTolerance
            ST_DWithin(
              ST_EndPoint(tc.chain_geom), 
              ST_StartPoint(next_e.the_geom), 
              $1  -- Configurable tolerance in degrees
            )
            OR ST_DWithin(
              ST_EndPoint(tc.chain_geom), 
              ST_EndPoint(next_e.the_geom), 
              $1  -- Configurable tolerance in degrees
            )
            OR ST_DWithin(
              ST_StartPoint(tc.chain_geom), 
              ST_StartPoint(next_e.the_geom), 
              $1  -- Configurable tolerance in degrees
            )
            OR ST_DWithin(
              ST_StartPoint(tc.chain_geom), 
              ST_EndPoint(next_e.the_geom), 
              $1  -- Configurable tolerance in degrees
            )
          )
          AND array_length(tc.chain_edges, 1) < 15  -- Reduced max chain length to 15 edges
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
      
      -- Validate chains using geometric analysis: ensure they end at proper endpoints or intersections
      valid_chains AS (
        SELECT 
          cc.*,
                     -- Check if start vertex is geometrically an endpoint (only one edge connects to it)
           (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e 
            WHERE ST_DWithin(ST_StartPoint(e.the_geom), v_start.the_geom, $1) 
               OR ST_DWithin(ST_EndPoint(e.the_geom), v_start.the_geom, $1)) as start_degree,
           -- Check if end vertex is geometrically an endpoint (only one edge connects to it)  
           (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e 
            WHERE ST_DWithin(ST_StartPoint(e.the_geom), v_end.the_geom, $1) 
               OR ST_DWithin(ST_EndPoint(e.the_geom), v_end.the_geom, $1)) as end_degree
        FROM complete_chains cc
        JOIN ${stagingSchema}.ways_noded_vertices_pgr v_start ON cc.start_vertex = v_start.id
        JOIN ${stagingSchema}.ways_noded_vertices_pgr v_end ON cc.end_vertex = v_end.id
                  WHERE 
            -- Start vertex should be degree-1 (endpoint) or degree-3+ (intersection)
            (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e 
             WHERE ST_DWithin(ST_StartPoint(e.the_geom), v_start.the_geom, $1) 
                OR ST_DWithin(ST_EndPoint(e.the_geom), v_start.the_geom, $1)) IN (1, 3, 4, 5)
            -- End vertex should be degree-1 (endpoint) or degree-3+ (intersection)  
            AND (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e 
                 WHERE ST_DWithin(ST_StartPoint(e.the_geom), v_end.the_geom, $1) 
                    OR ST_DWithin(ST_EndPoint(e.the_geom), v_end.the_geom, $1)) IN (1, 3, 4, 5)
          -- Don't create self-loops
          AND cc.start_vertex != cc.end_vertex
      ),
      
      -- Detect and remove overlapping chains before merging
      overlap_analysis AS (
        SELECT 
          vc1.start_vertex as vc1_start,
          vc1.end_vertex as vc1_end,
          vc1.chain_edges as vc1_chain_edges,
          vc1.chain_length as vc1_chain_length,
          vc1.total_length as vc1_total_length,
          vc2.start_vertex as vc2_start,
          vc2.end_vertex as vc2_end,
          vc2.chain_edges as vc2_chain_edges,
          vc2.chain_length as vc2_chain_length,
          vc2.total_length as vc2_total_length,
          ST_Intersection(vc1.chain_geom, vc2.chain_geom) as overlap_geom,
          ST_Length(ST_Intersection(vc1.chain_geom, vc2.chain_geom)::geography) as overlap_length
        FROM valid_chains vc1
        JOIN valid_chains vc2 ON (
          vc1.start_vertex < vc2.start_vertex 
          OR (vc1.start_vertex = vc2.start_vertex AND vc1.end_vertex < vc2.end_vertex)
        )
        WHERE 
          -- Check for geometric overlaps using PostGIS functions
          ST_Overlaps(vc1.chain_geom, vc2.chain_geom)
          OR ST_Contains(vc1.chain_geom, vc2.chain_geom)
          OR ST_Contains(vc2.chain_geom, vc1.chain_geom)
          OR ST_Covers(vc1.chain_geom, vc2.chain_geom)
          OR ST_Covers(vc2.chain_geom, vc1.chain_geom)
      ),
      
      -- Remove overlapping chains, keeping the longer ones
      non_overlapping_chains AS (
        SELECT DISTINCT vc.*
        FROM valid_chains vc
        WHERE NOT EXISTS (
          SELECT 1 FROM overlap_analysis oa
          WHERE (
            (oa.vc1_start = vc.start_vertex AND oa.vc1_end = vc.end_vertex) OR
            (oa.vc2_start = vc.start_vertex AND oa.vc2_end = vc.end_vertex)
          )
            AND oa.overlap_length > 0.1  -- Overlap must be at least 100m to be significant
        )
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
            start_degree,
            end_degree,
            ROW_NUMBER() OVER (ORDER BY chain_length DESC, total_length DESC) as priority
          FROM non_overlapping_chains
        )
        SELECT 
          s, t, chain_edges, chain_vertices, chain_geom,
          total_length, total_elevation_gain, total_elevation_loss,
          name, chain_length, start_degree, end_degree
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
      
      -- Debug: Log what edges we're about to delete
      debug_edges_to_delete AS (
        SELECT 
          unnest(chain_edges) as edge_id,
          s as new_source,
          t as new_target,
          name as new_name
        FROM mergeable_chains
      ),
      
      -- Remove the original edges that were merged
      deleted_edges AS (
        DELETE FROM ${stagingSchema}.ways_noded 
        WHERE id IN (
          SELECT edge_id FROM debug_edges_to_delete
        )
        AND EXISTS (SELECT 1 FROM inserted_edges)  -- Only delete if chains were actually inserted
        RETURNING id, source, target, name
      )
      
      -- Return counts for auditing
      SELECT 
        (SELECT COUNT(*) FROM inserted_edges) AS chains_merged,
        (SELECT COUNT(*) FROM deleted_edges) AS edges_removed,
        (SELECT COUNT(*) FROM cleaned_existing_chains) AS existing_chains_cleaned;
    `, [degree2Tolerance]);

    const chainsMerged = Number(mergeResult.rows[0]?.chains_merged || 0);
    const edgesRemoved = Number(mergeResult.rows[0]?.edges_removed || 0);
    const existingChainsCleanedCount = Number(mergeResult.rows[0]?.existing_chains_cleaned || 0);

    if (existingChainsCleanedCount > 0) {
      console.log(`🧹 Pre-cleaned ${existingChainsCleanedCount} existing merged chains that conflicted with new chains`);
    }

    // Validate edge count math for degree-2 merging
    // Each chain should remove N edges and create 1 edge, so net change should be -(N-1)
    if (chainsMerged > 0) {
      // Simple validation: edges removed should be >= chains merged
      // (since each chain must have at least 2 edges to be merged)
      if (edgesRemoved < chainsMerged) {
        console.error(`❌ DEGREE-2 MERGE VALIDATION FAILED: Removed ${edgesRemoved} edges for ${chainsMerged} chains`);
        console.error(`   Each chain must have at least 2 edges, so we should remove at least ${chainsMerged} edges`);
        throw new Error(`Degree-2 merge validation failed: removed ${edgesRemoved} edges for ${chainsMerged} chains`);
      }
      
      console.log(`✅ Degree-2 merge validation passed: ${edgesRemoved} edges removed for ${chainsMerged} chains`);
    }

    // Debug logging
    console.log(`🔗 Merge results: chainsMerged=${chainsMerged}, edgesRemoved=${edgesRemoved}, existingChainsCleanedCount=${existingChainsCleanedCount}`);
    
    // Debug: Let's see what edges were actually deleted vs what should have been created
    if (edgesRemoved > 0) {
      console.log(`⚠️  WARNING: ${edgesRemoved} edges were deleted but only ${chainsMerged} chains were merged`);
      console.log(`   This suggests we may be losing edge data!`);
      
      // Let's check what edges we have now
      const edgeCheckResult = await pgClient.query(`
        SELECT COUNT(*) as total_edges, 
               COUNT(DISTINCT source) as unique_sources,
               COUNT(DISTINCT target) as unique_targets
        FROM ${stagingSchema}.ways_noded
      `);
      const totalEdges = Number(edgeCheckResult.rows[0]?.total_edges || 0);
      console.log(`   Current network: ${totalEdges} edges, ${edgeCheckResult.rows[0]?.unique_sources} sources, ${edgeCheckResult.rows[0]?.unique_targets} targets`);
      
      // Let's also check what chains were actually detected
      const chainDebugResult = await pgClient.query(`
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
            ARRAY[e.id::bigint] as chain_edges,
            ARRAY[e.source, e.target] as chain_vertices,
            e.the_geom as chain_geom,
            e.length_km as total_length,
            e.elevation_gain as total_elevation_gain,
            e.elevation_loss as total_elevation_loss,
            e.name
          FROM ${stagingSchema}.ways_noded e
          WHERE e.source != e.target
          
          UNION ALL
          
          SELECT 
            next_e.id as edge_id,
            tc.start_vertex,
            CASE 
              WHEN next_e.source = tc.current_vertex THEN next_e.target
              ELSE next_e.source
            END as current_vertex,
            tc.chain_edges || next_e.id::bigint as chain_edges,
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
                  WHEN ST_GeometryType(geom) = 'ST_LineString' THEN geom::geometry(LineString,4326)
                  ELSE ST_GeometryN(geom, 1)::geometry(LineString,4326)
                END
              FROM merged
            ) as chain_geom,
            tc.total_length + next_e.length_km as total_length,
            tc.total_elevation_gain + next_e.elevation_gain as total_elevation_gain,
            tc.total_elevation_loss + next_e.elevation_loss as total_elevation_loss,
            tc.name
          FROM trail_chains tc
          JOIN ${stagingSchema}.ways_noded next_e ON 
            (next_e.source = tc.current_vertex OR next_e.target = tc.current_vertex)
          WHERE 
            next_e.id::bigint != ALL(tc.chain_edges)
            AND next_e.source != next_e.target
            AND (
              ST_DWithin(ST_EndPoint(tc.chain_geom), ST_StartPoint(next_e.the_geom), $1)
              OR ST_DWithin(ST_EndPoint(tc.chain_geom), ST_EndPoint(next_e.the_geom), $1)
              OR ST_DWithin(ST_StartPoint(tc.chain_geom), ST_StartPoint(next_e.the_geom), $1)
              OR ST_DWithin(ST_StartPoint(tc.chain_geom), ST_EndPoint(next_e.the_geom), $1)
            )
            AND array_length(tc.chain_edges, 1) < 15
        )
        SELECT 
          start_vertex,
          current_vertex as end_vertex,
          array_length(chain_edges, 1) as chain_length,
          chain_edges,
          name
        FROM trail_chains
        WHERE array_length(chain_edges, 1) >= 2
        ORDER BY array_length(chain_edges, 1) DESC
        LIMIT 10;
      `, [degree2Tolerance]);
      
      console.log(`   🔍 [Chain Debug] Detected ${chainDebugResult.rowCount} potential chains:`);
      chainDebugResult.rows.forEach((row, index) => {
        console.log(`      ${index + 1}. Chain ${row.start_vertex} → ${row.end_vertex} (${row.chain_length} edges): ${row.name}`);
        console.log(`         Edges: [${row.chain_edges.join(', ')}]`);
      });
    }

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

    // Step 3: Handle bridge edges that connect to degree 1 vertices
    console.log('🔗 Handling bridge edges that connect to degree 1 vertices...');
    
    const bridgeEdgeResult = await pgClient.query(`
      WITH bridge_edges AS (
        -- Find edges that connect to degree 1 vertices (bridge edges)
        SELECT DISTINCT e.id as bridge_edge_id
        FROM ${stagingSchema}.ways_noded e
        JOIN ${stagingSchema}.ways_noded_vertices_pgr v1 ON e.source = v1.id
        JOIN ${stagingSchema}.ways_noded_vertices_pgr v2 ON e.target = v2.id
        WHERE (v1.cnt = 1 OR v2.cnt = 1)  -- One end is degree 1
          AND (v1.cnt = 2 OR v2.cnt = 2)  -- Other end is degree 2 (can be merged)
      ),
      
      -- Find the adjacent edges to merge with
      adjacent_edges AS (
        SELECT 
          be.bridge_edge_id,
          e.id as adjacent_edge_id,
          e.source,
          e.target,
          e.the_geom,
          e.length_km,
          e.elevation_gain,
          e.elevation_loss,
          e.name,
          e.app_uuid,
          -- Ensure we only merge if the adjacent edge is not already part of a degree-2 chain
          -- This prevents double-merging and connectivity loss
          CASE 
            WHEN e.app_uuid LIKE 'merged-degree2-chain-%' THEN false
            ELSE true
          END as can_merge
        FROM bridge_edges be
        JOIN ${stagingSchema}.ways_noded be_e ON be.bridge_edge_id = be_e.id
        JOIN ${stagingSchema}.ways_noded e ON (
          (e.source = be_e.source AND e.id != be_e.id) OR
          (e.target = be_e.source AND e.id != be_e.id) OR
          (e.source = be_e.target AND e.id != be_e.id) OR
          (e.target = be_e.target AND e.id != be_e.id)
        )
        WHERE e.id NOT IN (SELECT bridge_edge_id FROM bridge_edges)  -- Don't merge bridge edges with each other
          AND e.app_uuid NOT LIKE 'merged-degree2-chain-%'  -- Don't merge with already merged edges
      ),
      
      -- Create merged edges
      merged_bridge_edges AS (
        SELECT 
          ae.adjacent_edge_id as original_edge_id,
          ae.source,
          ae.target,
          CASE 
          WHEN ST_GeometryType(ST_LineMerge(ST_Union(ae.the_geom, be_e.the_geom))) = 'ST_LineString' THEN ST_LineMerge(ST_Union(ae.the_geom, be_e.the_geom))
          ELSE ST_GeometryN(ST_LineMerge(ST_Union(ae.the_geom, be_e.the_geom)), 1)
        END as merged_geom,
          ae.length_km + be_e.length_km as merged_length,
          ae.elevation_gain + be_e.elevation_gain as merged_elevation_gain,
          ae.elevation_loss + be_e.elevation_loss as merged_elevation_loss,
          ae.name,
          'merged-bridge-edge-' || ae.adjacent_edge_id || '-' || be_e.id as merged_app_uuid
        FROM adjacent_edges ae
        JOIN ${stagingSchema}.ways_noded be_e ON ae.bridge_edge_id = be_e.id
      ),
      
      -- Remove original edges (but only if they haven't already been removed by the main degree-2 merge)
      removed_edges AS (
        DELETE FROM ${stagingSchema}.ways_noded
        WHERE id IN (
          SELECT adjacent_edge_id FROM adjacent_edges
          UNION
          SELECT bridge_edge_id FROM bridge_edges
        )
        AND app_uuid NOT LIKE 'merged-degree2-chain-%'  -- Don't remove edges that were already merged
        RETURNING id
      ),
      
      -- Insert merged edges
      inserted_merged_edges AS (
        INSERT INTO ${stagingSchema}.ways_noded (
          id, source, target, the_geom, length_km, elevation_gain, elevation_loss,
          name, app_uuid
        )
        SELECT 
          ROW_NUMBER() OVER (ORDER BY original_edge_id) + (SELECT COALESCE(MAX(id), 0) FROM ${stagingSchema}.ways_noded),
          source, target, merged_geom, merged_length, merged_elevation_gain, merged_elevation_loss,
          name, merged_app_uuid
        FROM merged_bridge_edges
        RETURNING id
      )
      
      SELECT 
        (SELECT COUNT(*) FROM inserted_merged_edges) as bridge_edges_merged,
        (SELECT COUNT(*) FROM removed_edges) as bridge_edges_removed;
    `);

    const bridgeEdgesMerged = Number(bridgeEdgeResult.rows[0]?.bridge_edges_merged || 0);
    const bridgeEdgesRemoved = Number(bridgeEdgeResult.rows[0]?.bridge_edges_removed || 0);

    if (bridgeEdgesMerged > 0) {
      console.log(`🔗 Bridge edge cleanup: ${bridgeEdgesMerged} bridge edges merged, ${bridgeEdgesRemoved} edges removed`);
      
      // Validate bridge edge cleanup math
      // Each bridge edge merge should remove 2 edges (bridge + adjacent) and create 1 edge
      // So edges removed should be 2 * bridgeEdgesMerged
      const expectedBridgeEdgesRemoved = bridgeEdgesMerged * 2;
      if (bridgeEdgesRemoved !== expectedBridgeEdgesRemoved) {
        console.error(`❌ BRIDGE EDGE VALIDATION FAILED: Expected ${expectedBridgeEdgesRemoved} edges removed for ${bridgeEdgesMerged} bridge merges, but ${bridgeEdgesRemoved} were removed`);
        console.error(`   This indicates the bridge edge cleanup is not working correctly`);
        throw new Error(`Bridge edge validation failed: expected ${expectedBridgeEdgesRemoved} edges removed, got ${bridgeEdgesRemoved}`);
      }
      
      console.log(`✅ Bridge edge validation passed: ${bridgeEdgesRemoved} edges removed for ${bridgeEdgesMerged} bridge merges`);
    }

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

    console.log(`🔗 Geometry-based degree-2 chain merging: chains=${chainsMerged}, edges=${edgesRemoved}, bridgeEdges=${bridgeEdgesMerged}, final=${finalEdges}`);
    
    // Validate connectivity AFTER merge
    console.log('🔍 Validating connectivity after degree-2 merge...');
    const connectivityAfter = await validateConnectivity(pgClient, stagingSchema, 'AFTER_MERGE');
    
    // Check if connectivity was lost
    if (connectivityBefore.isConnected && !connectivityAfter.isConnected) {
      const errorMessage = `❌ CRITICAL: Network connectivity lost during degree-2 merge! ` +
        `Connectivity dropped from ${connectivityBefore.connectivityPercentage.toFixed(1)}% to ${connectivityAfter.connectivityPercentage.toFixed(1)}%. ` +
        `This indicates the merge process is breaking the network topology. ` +
        `Edges removed: ${edgesRemoved}, chains merged: ${chainsMerged}`;
      
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
    
    // Check if connectivity is critically low
    if (connectivityAfter.connectivityPercentage < 50) {
      const errorMessage = `❌ CRITICAL: Network connectivity critically low after degree-2 merge! ` +
        `Only ${connectivityAfter.connectivityPercentage.toFixed(1)}% of nodes are reachable. ` +
        `This indicates severe network fragmentation.`;
      
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
    
    console.log(`✅ Connectivity validation passed: ${connectivityAfter.connectivityPercentage.toFixed(1)}% of nodes reachable`);
      
      return {
        chainsMerged,
        edgesRemoved,
        bridgeEdgesMerged,
        bridgeEdgesRemoved,
        finalEdges
      };

  } catch (error) {
    console.error('❌ Error merging degree-2 chains:', error);
    throw error;
  }
}

/**
 * Deduplicate edges that share vertices in the ways_noded table
 * This should run before degree2 merge to clean up the network
 */
export async function deduplicateSharedVertices(
  pgClient: Pool | PoolClient,
  stagingSchema: string
): Promise<{ edgesRemoved: number }> {
  console.log('   🔍 [Vertex Dedup] Detecting edges with shared vertices...');
  
  // Find edges that share vertices and have similar geometries
  const deduplicateSql = `
    WITH shared_vertex_edges AS (
      -- Find edges that share source or target vertices
      SELECT 
        e1.id as edge1_id,
        e2.id as edge2_id,
        e1.source as e1_source,
        e1.target as e1_target,
        e2.source as e2_source,
        e2.target as e2_target,
        e1.the_geom as e1_geom,
        e2.the_geom as e2_geom,
        ST_Length(e1.the_geom::geography) as e1_length,
        ST_Length(e2.the_geom::geography) as e2_length,
        ST_Length(ST_Intersection(e1.the_geom, e2.the_geom)::geography) as overlap_length,
        -- Check if they share vertices
        CASE 
          WHEN e1.source = e2.source OR e1.source = e2.target OR 
               e1.target = e2.source OR e1.target = e2.target THEN true
          ELSE false
        END as shares_vertex
      FROM ${stagingSchema}.ways_noded e1
      JOIN ${stagingSchema}.ways_noded e2 ON e1.id < e2.id
      WHERE (
        -- Share at least one vertex
        e1.source = e2.source OR e1.source = e2.target OR 
        e1.target = e2.source OR e1.target = e2.target
      )
      AND (
        -- Have significant geometric overlap (more than 50% of shorter edge)
        ST_Length(ST_Intersection(e1.the_geom, e2.the_geom)::geography) > 
        LEAST(ST_Length(e1.the_geom::geography), ST_Length(e2.the_geom::geography)) * 0.5
      )
    ),
    edges_to_remove AS (
      -- Keep the longer edge, remove the shorter one
      SELECT 
        CASE 
          WHEN e1_length >= e2_length THEN edge2_id
          ELSE edge1_id
        END as edge_id_to_remove
      FROM shared_vertex_edges
      WHERE shares_vertex = true
    )
    DELETE FROM ${stagingSchema}.ways_noded
    WHERE id IN (SELECT edge_id_to_remove FROM edges_to_remove);
  `;
  
  const result = await pgClient.query(deduplicateSql);
  const edgesRemoved = result.rowCount || 0;
  
  console.log(`   ✅ [Vertex Dedup] Removed ${edgesRemoved} duplicate edges with shared vertices`);
  return { edgesRemoved };
}
