import { Pool } from 'pg';

export interface MergeDegree2ChainsResult {
  chainsMerged: number;
  edgesRemoved: number;
  finalEdges: number;
}

/**
 * Merge degree-2 chain edges into single edges.
 * This creates continuous edges from dead ends to intersections by merging
 * chains where internal vertices have degree 2.
 * 
 * @param pgClient - PostgreSQL client
 * @param stagingSchema - Staging schema name
 */
export async function mergeDegree2Chains(
  pgClient: Pool,
  stagingSchema: string
): Promise<MergeDegree2ChainsResult> {
  console.log('🔗 Merging degree-2 chains...');
  
  try {
    // Step 1: Find and merge degree-2 chains in a single transaction
    const mergeResult = await pgClient.query(`
      WITH RECURSIVE 
      -- Find all vertices and their degrees (excluding connector edges)
      vertex_degrees AS (
        SELECT 
          v.id as vertex_id,
          COUNT(e.id) as degree
        FROM ${stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN ${stagingSchema}.ways_noded e ON v.id = e.source OR v.id = e.target
        WHERE e.name IS NULL OR e.name NOT LIKE '%Connector%'  -- Exclude connector edges
        GROUP BY v.id
      ),
      
      -- Find chains within the same trail name (excluding connector edges)
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
          e.name as trail_name
        FROM ${stagingSchema}.ways_noded e
        JOIN vertex_degrees vd_source ON e.source = vd_source.vertex_id
        JOIN vertex_degrees vd_target ON e.target = vd_target.vertex_id
        WHERE (vd_source.degree = 1 OR vd_source.degree >= 3 OR vd_target.degree = 1 OR vd_target.degree >= 3)  -- Start from dead ends OR intersections
          AND e.name IS NOT NULL  -- Only process named trails
          AND e.name NOT LIKE '%Connector%'  -- Exclude connector edges
        
        UNION ALL
        
        -- Recursive case: continue through degree-2 vertices within the same trail
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
          ST_LineMerge(ST_Union(tc.chain_geom, next_e.the_geom))::geometry as chain_geom,
          tc.total_length + next_e.length_km as total_length,
          tc.total_elevation_gain + next_e.elevation_gain as total_elevation_gain,
          tc.total_elevation_loss + next_e.elevation_loss as total_elevation_loss,
          tc.trail_name
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
          AND next_e.name = tc.trail_name  -- Same trail name
          AND next_e.name NOT LIKE '%Connector%'  -- Exclude connector edges
          AND (vd.degree = 2 OR vd.degree >= 3)  -- Continue through degree-2 vertices and include final edge to intersection
      ),
      
      -- Get the best chains (prefer shorter chains that end at intersections)
      complete_chains AS (
        SELECT DISTINCT ON (start_vertex)
          start_vertex,
          current_vertex as end_vertex,
          chain_edges,
          chain_vertices,
          chain_geom,
          total_length,
          total_elevation_gain,
          total_elevation_loss,
          trail_name,
          array_length(chain_edges, 1) as chain_length,
          -- Prefer chains that end at intersections (degree 3+)
          CASE 
            WHEN EXISTS (
              SELECT 1 FROM vertex_degrees vd 
              WHERE vd.vertex_id = current_vertex AND vd.degree >= 3
            ) THEN 1
            ELSE 2
          END as priority
        FROM trail_chains
        ORDER BY start_vertex, priority, array_length(chain_edges, 1)
      ),
      
      -- Only process chains with more than 1 edge
      mergeable_chains AS (
        SELECT *
        FROM complete_chains
        WHERE array_length(chain_edges, 1) > 1
      ),
      
      -- Insert merged edges
      inserted_edges AS (
        INSERT INTO ${stagingSchema}.ways_noded (
          id, source, target, the_geom, length_km, elevation_gain, elevation_loss,
          app_uuid, name, old_id
        )
        SELECT 
          (SELECT COALESCE(MAX(id), 0) + row_number() OVER () FROM ${stagingSchema}.ways_noded) as id,
          start_vertex as source,
          end_vertex as target,
          chain_geom as the_geom,
          total_length as length_km,
          total_elevation_gain as elevation_gain,
          total_elevation_loss as elevation_loss,
          'merged-degree2-chain-' || start_vertex || '-' || end_vertex || '-edges-' || array_to_string(chain_edges, ',') as app_uuid,
          trail_name as name,
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
      )
      
      -- Return the count of inserted edges
      SELECT COUNT(*) as chains_merged FROM inserted_edges;
    `);

    // Step 2: Get final counts
    const finalCountResult = await pgClient.query(`
      SELECT COUNT(*) as final_edges FROM ${stagingSchema}.ways_noded;
    `);

    const chainsMerged = parseInt(mergeResult.rows[0].chains_merged);
    const edgesRemoved = chainsMerged * 2; // Each chain typically merges 2 edges
    const finalEdges = parseInt(finalCountResult.rows[0].final_edges);

    console.log(`🔗 Degree-2 chain merge: chainsMerged=${chainsMerged}, edgesRemoved=${edgesRemoved}, finalEdges=${finalEdges}`);

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
