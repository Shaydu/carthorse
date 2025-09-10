import { Pool } from 'pg';

export interface BypassEdgeRemovalResult {
  bypassEdgesRemoved: number;
  finalEdges: number;
  nodesBypassed: number;
}

/**
 * Remove bypass edges that span multiple nodes, keeping only direct connections.
 * This ensures that if there's a path A→B→C, we keep the individual segments
 * (A→B and B→C) rather than a shortcut edge (A→C).
 * 
 * IMPORTANT: Only removes bypass edges if connectivity is preserved through alternative paths.
 * 
 * @param pgClient Database connection
 * @param stagingSchema Schema containing the ways_noded table
 * @returns Statistics about the bypass edge removal process
 */
export async function removeBypassEdges(
  pgClient: Pool, 
  stagingSchema: string
): Promise<BypassEdgeRemovalResult> {
  console.log('🔄 Removing bypass edges that span multiple nodes (with connectivity verification)...');

  try {
    // Count initial edges
    const initialCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded
    `);

    // Analyze edges to find bypasses
    const analysisResult = await pgClient.query(`
      WITH edge_analysis AS (
        SELECT 
          id,
          source,
          target,
          the_geom,
          ST_Length(the_geom::geography) as length_meters,
          -- Check if this edge's geometry contains other nodes
          (SELECT COUNT(*) 
           FROM ${stagingSchema}.ways_noded_vertices_pgr v 
           WHERE v.id != source AND v.id != target 
           AND ST_DWithin(v.the_geom, the_geom, 0.0001)
           AND ST_Contains(ST_Buffer(the_geom, 0.0001), v.the_geom)
          ) as nodes_bypassed
        FROM ${stagingSchema}.ways_noded
        WHERE the_geom IS NOT NULL
      )
      SELECT 
        id,
        source,
        target,
        length_meters,
        nodes_bypassed
      FROM edge_analysis
      WHERE nodes_bypassed > 0
      ORDER BY nodes_bypassed DESC, length_meters DESC
    `);

    const bypassEdges = analysisResult.rows;
    const totalNodesBypassed = bypassEdges.reduce((sum, edge) => sum + edge.nodes_bypassed, 0);

    console.log(`🔍 Found ${bypassEdges.length} bypass edges that bypass ${totalNodesBypassed} total nodes`);

    if (bypassEdges.length === 0) {
      console.log('✅ No bypass edges found - network is already optimal');
      return {
        bypassEdgesRemoved: 0,
        finalEdges: parseInt(initialCount.rows[0].count),
        nodesBypassed: 0
      };
    }

    // Step 1: Verify connectivity before removing any edges
    console.log('🔍 Step 1: Verifying network connectivity before bypass removal...');
    const connectivityBefore = await verifyNetworkConnectivity(pgClient, stagingSchema);
    console.log(`📊 Initial connectivity: ${connectivityBefore.connectedComponents} components, ${connectivityBefore.totalNodes} nodes`);

    // Step 2: Test each bypass edge for safe removal
    console.log('🔍 Step 2: Testing bypass edges for safe removal...');
    const safeToRemove: number[] = [];
    const unsafeToRemove: number[] = [];

    for (const edge of bypassEdges) {
      const isSafe = await testBypassEdgeRemoval(pgClient, stagingSchema, edge.id, edge.source, edge.target);
      if (isSafe) {
        safeToRemove.push(edge.id);
      } else {
        unsafeToRemove.push(edge.id);
        console.log(`⚠️  Edge ${edge.id} (${edge.source}→${edge.target}) cannot be safely removed - would break connectivity`);
      }
    }

    console.log(`📊 Connectivity analysis: ${safeToRemove.length} safe to remove, ${unsafeToRemove.length} unsafe to remove`);

    // Step 3: Remove only the safe bypass edges
    let bypassEdgesRemoved = 0;
    if (safeToRemove.length > 0) {
      console.log('🔄 Step 3: Removing safe bypass edges...');
      
      const removalResult = await pgClient.query(`
        DELETE FROM ${stagingSchema}.ways_noded
        WHERE id = ANY($1)
      `, [safeToRemove]);

      bypassEdgesRemoved = safeToRemove.length;
      console.log(`✅ Removed ${bypassEdgesRemoved} safe bypass edges`);
    } else {
      console.log('⏭️  No bypass edges were safe to remove - preserving network connectivity');
    }

    // Step 4: Verify connectivity after removal
    console.log('🔍 Step 4: Verifying network connectivity after bypass removal...');
    const connectivityAfter = await verifyNetworkConnectivity(pgClient, stagingSchema);
    console.log(`📊 Final connectivity: ${connectivityAfter.connectedComponents} components, ${connectivityAfter.totalNodes} nodes`);

    // Verify connectivity was preserved
    if (connectivityAfter.connectedComponents > connectivityBefore.connectedComponents) {
      console.warn(`⚠️  Warning: Network connectivity decreased from ${connectivityBefore.connectedComponents} to ${connectivityAfter.connectedComponents} components`);
    } else {
      console.log('✅ Network connectivity preserved after bypass edge removal');
    }

    // Count final edges
    const finalCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded
    `);

    const finalEdges = parseInt(finalCount.rows[0].count);

    console.log(`🔄 Bypass edge removal complete: removed ${bypassEdgesRemoved} bypass edges, ${finalEdges} final edges`);

    return {
      bypassEdgesRemoved,
      finalEdges,
      nodesBypassed: totalNodesBypassed
    };

  } catch (error) {
    console.error('❌ Error during bypass edge removal:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Verify network connectivity by counting connected components
 */
async function verifyNetworkConnectivity(
  pgClient: Pool, 
  stagingSchema: string
): Promise<{ connectedComponents: number; totalNodes: number }> {
  const result = await pgClient.query(`
    WITH reachable_nodes AS (
      -- Start from the first node and find all reachable nodes
      SELECT DISTINCT target as node_id
      FROM ${stagingSchema}.ways_noded
      WHERE source = (SELECT MIN(id) FROM ${stagingSchema}.ways_noded_vertices_pgr)
      UNION
      SELECT source as node_id
      FROM ${stagingSchema}.ways_noded
      WHERE target = (SELECT MIN(id) FROM ${stagingSchema}.ways_noded_vertices_pgr)
      UNION
      SELECT (SELECT MIN(id) FROM ${stagingSchema}.ways_noded_vertices_pgr) as node_id
    ),
    all_nodes AS (
      SELECT id as node_id FROM ${stagingSchema}.ways_noded_vertices_pgr
    )
    SELECT 
      COUNT(DISTINCT r.node_id) as reachable_count,
      COUNT(DISTINCT a.node_id) as total_nodes
    FROM reachable_nodes r
    CROSS JOIN all_nodes a
  `);

  const reachableCount = parseInt(result.rows[0].reachable_count);
  const totalNodes = parseInt(result.rows[0].total_nodes);
  const connectedComponents = reachableCount === totalNodes ? 1 : Math.ceil(totalNodes / reachableCount);

  return { connectedComponents, totalNodes };
}

/**
 * Test if removing a specific bypass edge would break connectivity
 * Specifically checks that if we remove A→C, there must be a path A→B→C through intermediate nodes
 */
async function testBypassEdgeRemoval(
  pgClient: Pool, 
  stagingSchema: string, 
  edgeId: number, 
  source: number, 
  target: number
): Promise<boolean> {
  try {
    // First, get the intermediate nodes that this bypass edge is skipping
    const intermediateNodesResult = await pgClient.query(`
      SELECT 
        v.id as intermediate_node_id
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      JOIN ${stagingSchema}.ways_noded wn ON wn.id = $1
      WHERE v.id != $2 AND v.id != $3
      AND ST_DWithin(v.the_geom, wn.the_geom, 0.0001)
      AND ST_Contains(ST_Buffer(wn.the_geom, 0.0001), v.the_geom)
      ORDER BY v.id
    `, [edgeId, source, target]);

    const intermediateNodes = intermediateNodesResult.rows.map(row => row.intermediate_node_id);
    
    if (intermediateNodes.length === 0) {
      // No intermediate nodes - this isn't actually a bypass edge
      return false;
    }

    console.log(`🔍 Testing bypass edge ${edgeId} (${source}→${target}) that skips nodes: [${intermediateNodes.join(', ')}]`);

    // Check if there's a direct path A→B→C through the intermediate nodes
    const pathExistsResult = await pgClient.query(`
      WITH temp_removal AS (
        -- Create a temporary view without the bypass edge we want to test removing
        SELECT * FROM ${stagingSchema}.ways_noded WHERE id != $1
      ),
      -- Check if there's a direct path from source through intermediate nodes to target
      path_check AS (
        WITH RECURSIVE path_finder AS (
          -- Start from source node
          SELECT $2 as current_node, ARRAY[$2] as path_nodes, 0 as path_length
          UNION ALL
          -- Follow edges to find paths through intermediate nodes
          SELECT 
            CASE WHEN t.source = pf.current_node THEN t.target ELSE t.source END as current_node,
            pf.path_nodes || CASE WHEN t.source = pf.current_node THEN t.target ELSE t.source END,
            pf.path_length + 1
          FROM temp_removal t
          JOIN path_finder pf ON (t.source = pf.current_node OR t.target = pf.current_node)
          WHERE pf.path_length < 10  -- Prevent infinite recursion
            AND NOT (CASE WHEN t.source = pf.current_node THEN t.target ELSE t.source END = ANY(pf.path_nodes))  -- Avoid cycles
        )
        SELECT 
          CASE WHEN $3 = ANY(path_nodes) THEN true ELSE false END as can_reach_target,
          path_nodes,
          path_length
        FROM path_finder
        WHERE $3 = ANY(path_nodes)
        LIMIT 1
      )
      SELECT 
        can_reach_target,
        path_nodes,
        path_length
      FROM path_check
    `, [edgeId, source, target]);

    if (pathExistsResult.rows.length === 0) {
      console.log(`❌ No path found from ${source} to ${target} without bypass edge ${edgeId}`);
      return false;
    }

    const pathResult = pathExistsResult.rows[0];
    const canReachTarget = pathResult.can_reach_target;
    const pathNodes = pathResult.path_nodes;
    const pathLength = pathResult.path_length;

    if (!canReachTarget) {
      console.log(`❌ Cannot reach target ${target} from source ${source} without bypass edge ${edgeId}`);
      return false;
    }

    // Verify that the path goes through the intermediate nodes that the bypass edge was skipping
    const pathGoesThroughIntermediateNodes = intermediateNodes.every(intermediateNode => 
      pathNodes.includes(intermediateNode)
    );

    if (!pathGoesThroughIntermediateNodes) {
      console.log(`❌ Path [${pathNodes.join('→')}] does not go through all intermediate nodes [${intermediateNodes.join(', ')}]`);
      return false;
    }

    // Verify that there are direct edges connecting the path segments
    const directEdgesExist = await verifyDirectEdgesExist(pgClient, stagingSchema, edgeId, pathNodes);
    
    if (!directEdgesExist) {
      console.log(`❌ Direct edges do not exist for path [${pathNodes.join('→')}]`);
      return false;
    }

    console.log(`✅ Safe to remove bypass edge ${edgeId}: path [${pathNodes.join('→')}] (length ${pathLength}) goes through all intermediate nodes`);
    return true;
    
  } catch (error) {
    console.warn(`⚠️  Error testing edge ${edgeId} for safe removal: ${error}`);
    return false; // Conservative: don't remove if we can't verify safety
  }
}

/**
 * Verify that direct edges exist for each segment of the path
 */
async function verifyDirectEdgesExist(
  pgClient: Pool, 
  stagingSchema: string, 
  edgeIdToExclude: number, 
  pathNodes: number[]
): Promise<boolean> {
  try {
    // Check that there are direct edges between consecutive nodes in the path
    for (let i = 0; i < pathNodes.length - 1; i++) {
      const fromNode = pathNodes[i];
      const toNode = pathNodes[i + 1];
      
      const edgeExistsResult = await pgClient.query(`
        SELECT COUNT(*) as edge_count
        FROM ${stagingSchema}.ways_noded
        WHERE id != $1
        AND ((source = $2 AND target = $3) OR (source = $3 AND target = $2))
      `, [edgeIdToExclude, fromNode, toNode]);

      const edgeCount = parseInt(edgeExistsResult.rows[0].edge_count);
      
      if (edgeCount === 0) {
        console.log(`❌ No direct edge found between nodes ${fromNode} and ${toNode}`);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.warn(`⚠️  Error verifying direct edges: ${error}`);
    return false;
  }
}
