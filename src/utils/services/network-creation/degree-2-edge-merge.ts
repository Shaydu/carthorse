import { Pool } from 'pg';

export interface Degree2MergeResult {
  iterations: number;
  totalChainsMerged: number;
  totalEdgesMerged: number;
  finalEdgeCount: number;
  finalVertexCount: number;
  convergenceReached: boolean;
}

export interface MergeableChain {
  chainId: string;
  edges: number[];
  startVertex: number;
  endVertex: number;
  startDegree: number;
  endDegree: number;
  totalLength: number;
  trailNames: string[];
}

/**
 * Degree-2 Edge Merge Implementation
 * 
 * This function implements the degree-2 edge merge cleanup feature as specified in
 * the requirements document. It iteratively detects and merges chains of edges that
 * pass through degree-2 vertices until convergence.
 */
export async function runDegree2EdgeMerge(
  pgClient: Pool,
  stagingSchema: string,
  maxIterations: number = 10,
  maxChainLength: number = 15,
  tolerance: number = 5.0
): Promise<Degree2MergeResult> {
  console.log('🔗 Starting degree-2 edge merge process...');
  console.log(`   📏 Tolerance: ${tolerance}m`);
  console.log(`   🔄 Max iterations: ${maxIterations}`);
  console.log(`   📏 Max chain length: ${maxChainLength} edges`);

  let iteration = 0;
  let totalChainsMerged = 0;
  let totalEdgesMerged = 0;
  let convergenceReached = false;

  while (iteration < maxIterations && !convergenceReached) {
    iteration++;
    console.log(`\n🔄 Iteration ${iteration}/${maxIterations}`);

    // Get current network statistics
    const networkStats = await getNetworkStatistics(pgClient, stagingSchema);
    console.log(`   📊 Current network: ${networkStats.edgeCount} edges, ${networkStats.vertexCount} vertices`);

    // Detect mergeable chains
    const mergeableChains = await detectMergeableChains(pgClient, stagingSchema, maxChainLength, tolerance);
    console.log(`   🔍 Found ${mergeableChains.length} mergeable chains`);

    if (mergeableChains.length === 0) {
      console.log('   ✅ No more chains to merge - convergence reached!');
      convergenceReached = true;
      break;
    }

    // Merge the chains
    const mergeResult = await mergeChains(pgClient, stagingSchema, mergeableChains);
    totalChainsMerged += mergeResult.chainsMerged;
    totalEdgesMerged += mergeResult.edgesMerged;

    console.log(`   ✅ Merged ${mergeResult.chainsMerged} chains (${mergeResult.edgesMerged} edges)`);

    // Rebuild topology after merging
    await rebuildTopology(pgClient, stagingSchema);
  }

  // Get final statistics
  const finalStats = await getNetworkStatistics(pgClient, stagingSchema);

  console.log(`\n🎯 Degree-2 edge merge complete:`);
  console.log(`   🔄 Iterations: ${iteration}`);
  console.log(`   🔗 Chains merged: ${totalChainsMerged}`);
  console.log(`   🛤️ Edges merged: ${totalEdgesMerged}`);
  console.log(`   📊 Final edges: ${finalStats.edgeCount}`);
  console.log(`   📍 Final vertices: ${finalStats.vertexCount}`);
  console.log(`   ✅ Convergence: ${convergenceReached ? 'Yes' : 'No (max iterations reached)'}`);

  return {
    iterations: iteration,
    totalChainsMerged,
    totalEdgesMerged,
    finalEdgeCount: finalStats.edgeCount,
    finalVertexCount: finalStats.vertexCount,
    convergenceReached
  };
}

/**
 * Get current network statistics
 */
async function getNetworkStatistics(pgClient: Pool, stagingSchema: string) {
  const result = await pgClient.query(`
    SELECT 
      (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as edge_count,
      (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr) as vertex_count
  `);
  
  return {
    edgeCount: parseInt(result.rows[0].edge_count),
    vertexCount: parseInt(result.rows[0].vertex_count)
  };
}

/**
 * Detect mergeable chains using recursive CTE
 */
async function detectMergeableChains(
  pgClient: Pool, 
  stagingSchema: string, 
  maxChainLength: number,
  tolerance: number
): Promise<MergeableChain[]> {
  
  const result = await pgClient.query(`
    WITH RECURSIVE 
    -- Get vertex degrees
    vertex_degrees AS (
      SELECT 
        v.id,
        v.the_geom,
        COUNT(e.id) as degree
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      LEFT JOIN ${stagingSchema}.ways_noded e ON (e.source = v.id OR e.target = v.id)
      GROUP BY v.id, v.the_geom
    ),
    -- Find all possible chain starts (degree-1 or degree-3+ vertices)
    chain_starts AS (
      SELECT 
        e.id as start_edge_id,
        CASE 
          WHEN vd_start.degree = 1 THEN e.source
          WHEN vd_start.degree >= 3 THEN e.source
          ELSE e.target
        END as start_vertex,
        CASE 
          WHEN vd_start.degree = 1 THEN e.target
          WHEN vd_start.degree >= 3 THEN e.target
          ELSE e.source
        END as next_vertex,
        e.id as current_edge_id,
        ARRAY[e.id] as edge_chain,
        ARRAY[e.name] as name_chain,
        e.length_km as total_length,
        1 as chain_length,
        vd_start.degree as start_degree,
        vd_next.degree as next_degree
      FROM ${stagingSchema}.ways_noded e
      JOIN vertex_degrees vd_start ON (
        (vd_start.id = e.source AND vd_start.degree IN (1, 3, 4, 5, 6, 7, 8, 9, 10)) OR
        (vd_start.id = e.target AND vd_start.degree IN (1, 3, 4, 5, 6, 7, 8, 9, 10))
      )
      JOIN vertex_degrees vd_next ON (
        (vd_start.id = e.source AND vd_next.id = e.target) OR
        (vd_start.id = e.target AND vd_next.id = e.source)
      )
      WHERE vd_next.degree = 2  -- Next vertex must be degree-2
    ),
    -- Recursively build chains through degree-2 vertices
    chain_builder AS (
      SELECT 
        start_edge_id,
        start_vertex,
        next_vertex,
        current_edge_id,
        edge_chain,
        name_chain,
        total_length,
        chain_length,
        start_degree,
        next_degree
      FROM chain_starts
      
      UNION ALL
      
      SELECT 
        cb.start_edge_id,
        cb.start_vertex,
        vd_next.id as next_vertex,
        e.id as current_edge_id,
        cb.edge_chain || e.id as edge_chain,
        cb.name_chain || e.name as name_chain,
        cb.total_length + e.length_km as total_length,
        cb.chain_length + 1 as chain_length,
        cb.start_degree,
        vd_next.degree as next_degree
      FROM chain_builder cb
      JOIN ${stagingSchema}.ways_noded e ON (
        (cb.next_vertex = e.source AND vd_next.id = e.target) OR
        (cb.next_vertex = e.target AND vd_next.id = e.source)
      )
      JOIN vertex_degrees vd_next ON vd_next.id = (
        CASE 
          WHEN cb.next_vertex = e.source THEN e.target
          ELSE e.source
        END
      )
      WHERE cb.chain_length < $1  -- Max chain length
        AND vd_next.degree = 2    -- Continue only through degree-2 vertices
        AND e.id != ALL(cb.edge_chain)  -- Avoid cycles
        AND NOT EXISTS (  -- Avoid overlapping chains
          SELECT 1 FROM chain_builder cb2 
          WHERE cb2.start_edge_id != cb.start_edge_id 
            AND e.id = ANY(cb2.edge_chain)
        )
    ),
    -- Find valid chains that end at degree-1 or degree-3+ vertices
    valid_chains AS (
      SELECT DISTINCT
        'chain-' || start_edge_id || '-' || next_vertex as chain_id,
        edge_chain,
        start_vertex,
        next_vertex as end_vertex,
        start_degree,
        next_degree as end_degree,
        total_length,
        name_chain,
        chain_length
      FROM chain_builder
      WHERE next_degree IN (1, 3, 4, 5, 6, 7, 8, 9, 10)  -- End at degree-1 or degree-3+
        AND chain_length >= 2  -- At least 2 edges to be worth merging
        AND start_vertex != next_vertex  -- No self-loops
    )
    SELECT 
      chain_id,
      edge_chain,
      start_vertex,
      end_vertex,
      start_degree,
      end_degree,
      total_length,
      name_chain,
      chain_length
    FROM valid_chains
    ORDER BY total_length DESC, chain_length DESC
  `, [maxChainLength]);

  return result.rows.map(row => ({
    chainId: row.chain_id,
    edges: row.edge_chain,
    startVertex: parseInt(row.start_vertex),
    endVertex: parseInt(row.end_vertex),
    startDegree: parseInt(row.start_degree),
    endDegree: parseInt(row.end_degree),
    totalLength: parseFloat(row.total_length),
    trailNames: row.name_chain
  }));
}

/**
 * Merge the detected chains
 */
async function mergeChains(
  pgClient: Pool, 
  stagingSchema: string, 
  chains: MergeableChain[]
): Promise<{ chainsMerged: number; edgesMerged: number }> {
  
  if (chains.length === 0) {
    return { chainsMerged: 0, edgesMerged: 0 };
  }

  // Create a temporary table for merged edges
  await pgClient.query(`
    DROP TABLE IF EXISTS ${stagingSchema}.temp_merged_edges;
    CREATE TABLE ${stagingSchema}.temp_merged_edges (
      id SERIAL PRIMARY KEY,
      source INTEGER,
      target INTEGER,
      the_geom GEOMETRY(LINESTRING, 4326),
      length_km DOUBLE PRECISION,
      app_uuid TEXT,
      name TEXT,
      elevation_gain DOUBLE PRECISION,
      elevation_loss DOUBLE PRECISION,
              original_trail_id BIGINT,
      sub_id INTEGER,
      merged_from_edges INTEGER[]
    );
  `);

  let chainsMerged = 0;
  let edgesMerged = 0;

  for (const chain of chains) {
    try {
      // Get the edges in this chain
      const edgesResult = await pgClient.query(`
        SELECT 
          id, source, target, the_geom, length_km, app_uuid, name,
          elevation_gain, elevation_loss, original_trail_id, sub_id
        FROM ${stagingSchema}.ways_noded
        WHERE id = ANY($1)
        ORDER BY id
      `, [chain.edges]);

      if (edgesResult.rows.length !== chain.edges.length) {
        console.warn(`⚠️ Chain ${chain.chainId}: Expected ${chain.edges.length} edges, found ${edgesResult.rows.length}`);
        continue;
      }

      // Merge the geometries
      const geometries = edgesResult.rows.map(row => row.the_geom);
      const mergedGeometryResult = await pgClient.query(`
        SELECT 
          ST_LineMerge(ST_Union(ARRAY[${geometries.map((_, i) => `$${i + 1}`).join(', ')}])) as merged_geom
      `, geometries);

      const mergedGeometry = mergedGeometryResult.rows[0].merged_geom;
      
      // Validate the merged geometry
      if (!mergedGeometry || !mergedGeometry.isValid || mergedGeometry.geometryType !== 'LineString') {
        console.warn(`⚠️ Chain ${chain.chainId}: Invalid merged geometry, skipping`);
        continue;
      }

      // Calculate merged properties
      const totalLength = edgesResult.rows.reduce((sum, row) => sum + parseFloat(row.length_km), 0);
      const totalElevationGain = edgesResult.rows.reduce((sum, row) => sum + parseFloat(row.elevation_gain || 0), 0);
      const totalElevationLoss = edgesResult.rows.reduce((sum, row) => sum + parseFloat(row.elevation_loss || 0), 0);
      const primaryName = edgesResult.rows[0].name || 'merged-trail';
      const appUuid = `merged-degree2-chain-${chain.startVertex}-${chain.endVertex}-edges-${chain.edges.join('-')}`;

      // Insert the merged edge
      await pgClient.query(`
        INSERT INTO ${stagingSchema}.temp_merged_edges 
        (source, target, the_geom, length_km, app_uuid, name, elevation_gain, elevation_loss, original_trail_id, sub_id, merged_from_edges)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        chain.startVertex,
        chain.endVertex,
        mergedGeometry,
        totalLength,
        appUuid,
        primaryName,
        totalElevationGain,
        totalElevationLoss,
                  null, // original_trail_id
        1,    // sub_id
        chain.edges
      ]);

      chainsMerged++;
      edgesMerged += chain.edges.length;

    } catch (error) {
      console.warn(`⚠️ Failed to merge chain ${chain.chainId}:`, error);
    }
  }

  // Get remaining edges (not part of any merged chain)
  const mergedEdgeIds = chains.flatMap(chain => chain.edges);
  
  await pgClient.query(`
    INSERT INTO ${stagingSchema}.temp_merged_edges 
            (source, target, the_geom, length_km, app_uuid, name, elevation_gain, elevation_loss, original_trail_id, sub_id, merged_from_edges)
    SELECT 
      source, target, the_geom, length_km, app_uuid, name, 
              elevation_gain, elevation_loss, original_trail_id, sub_id, ARRAY[id] as merged_from_edges
    FROM ${stagingSchema}.ways_noded
    WHERE id != ALL($1)
  `, [mergedEdgeIds]);

  // Replace the original table
  await pgClient.query(`
    DROP TABLE ${stagingSchema}.ways_noded;
    ALTER TABLE ${stagingSchema}.temp_merged_edges RENAME TO ways_noded;
  `);

  return { chainsMerged, edgesMerged };
}

/**
 * Rebuild the network topology after merging
 */
async function rebuildTopology(pgClient: Pool, stagingSchema: string) {
  console.log('   🔧 Rebuilding network topology...');

  // Rebuild vertices table
  await pgClient.query(`
    DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr;
    CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
    SELECT 
      row_number() OVER () AS id,
      geom AS the_geom,
      0::int AS cnt,
      0::int AS chk,
      0::int AS ein,
      0::int AS eout
    FROM (
      SELECT DISTINCT ST_StartPoint(the_geom) AS geom FROM ${stagingSchema}.ways_noded
      UNION ALL
      SELECT DISTINCT ST_EndPoint(the_geom) AS geom FROM ${stagingSchema}.ways_noded
    ) pts;
  `);

  // Update source/target columns to point to the new vertex IDs
  await pgClient.query(`
    ALTER TABLE ${stagingSchema}.ways_noded DROP COLUMN IF EXISTS source;
    ALTER TABLE ${stagingSchema}.ways_noded DROP COLUMN IF EXISTS target;
    ALTER TABLE ${stagingSchema}.ways_noded ADD COLUMN source integer, ADD COLUMN target integer;
  `);

  // Map edge endpoints to vertex IDs
  await pgClient.query(`
    WITH start_nearest AS (
      SELECT wn.id AS edge_id,
             (
               SELECT v.id
               FROM ${stagingSchema}.ways_noded_vertices_pgr v
               ORDER BY ST_Distance(v.the_geom::geography, ST_StartPoint(wn.the_geom)::geography) ASC
               LIMIT 1
             ) AS node_id
      FROM ${stagingSchema}.ways_noded wn
    ),
    end_nearest AS (
      SELECT wn.id AS edge_id,
             (
               SELECT v.id
               FROM ${stagingSchema}.ways_noded_vertices_pgr v
               ORDER BY ST_Distance(v.the_geom::geography, ST_EndPoint(wn.the_geom)::geography) ASC
               LIMIT 1
             ) AS node_id
      FROM ${stagingSchema}.ways_noded wn
    )
    UPDATE ${stagingSchema}.ways_noded wn
    SET source = sn.node_id,
        target = en.node_id
    FROM start_nearest sn
    JOIN end_nearest en ON en.edge_id = sn.edge_id
    WHERE wn.id = sn.edge_id;
  `);

  // Update vertex degree counts
  await pgClient.query(`
    UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
    SET cnt = (
      SELECT COUNT(*)
      FROM ${stagingSchema}.ways_noded e
      WHERE e.source = v.id OR e.target = v.id
    );
  `);
}
