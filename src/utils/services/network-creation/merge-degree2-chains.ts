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
    // Defensive: always recompute vertex degrees before attempting a merge
    // This protects against upstream data issues where stored degrees don't match reality
    console.log('🔄 Recomputing vertex degrees before merge...');
    await pgClient.query(`
      UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);
    
    // Log degree statistics for debugging
    const degreeStats = await pgClient.query(`
      SELECT 
        cnt as degree,
        COUNT(*) as vertex_count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    console.log('📊 Vertex degree distribution:', degreeStats.rows.map(r => `degree-${r.degree}: ${r.vertex_count} vertices`).join(', '));

    // Explicit transaction for atomic insert+delete
    await pgClient.query('BEGIN');
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
      
      -- Select the longest chain for each normalized endpoint pair (s,t)
      mergeable_chains AS (
        SELECT DISTINCT ON (
                 LEAST(start_vertex, end_vertex),
                 GREATEST(start_vertex, end_vertex)
               )
               LEAST(start_vertex, end_vertex) AS s,
               GREATEST(start_vertex, end_vertex) AS t,
               chain_edges,
               chain_vertices,
               chain_geom,
               total_length,
               total_elevation_gain,
               total_elevation_loss,
               name,
               chain_length
        FROM complete_chains
        ORDER BY LEAST(start_vertex, end_vertex),
                 GREATEST(start_vertex, end_vertex),
                 chain_length DESC
      ),
      
      -- Insert merged edges
      inserted_edges AS (
        INSERT INTO ${stagingSchema}.ways_noded (
          id, source, target, the_geom, length_km, elevation_gain, elevation_loss,
          app_uuid, name, old_id
        )
        SELECT 
          (SELECT COALESCE(MAX(id), 0) + row_number() OVER () FROM ${stagingSchema}.ways_noded) as id,
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
        RETURNING 1
      )
      
      -- Return counts for auditing
      SELECT 
        (SELECT COUNT(*) FROM inserted_edges) AS chains_merged,
        (SELECT COUNT(*) FROM deleted_edges) AS edges_removed;
    `);

    // Recompute vertex degrees after merge
    await pgClient.query(`
      UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);

    // Remove orphaned vertices (no incident edges)
    await pgClient.query(`
      DELETE FROM ${stagingSchema}.ways_noded_vertices_pgr v
      WHERE NOT EXISTS (
        SELECT 1 FROM ${stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);

    await pgClient.query('COMMIT');

    // Step 2: Get final counts
    const finalCountResult = await pgClient.query(`
      SELECT COUNT(*) as final_edges FROM ${stagingSchema}.ways_noded;
    `);

    const chainsMerged = Number(mergeResult.rows[0]?.chains_merged || 0);
    const edgesRemoved = Number(mergeResult.rows[0]?.edges_removed || 0);
    const finalEdges = Number(finalCountResult.rows[0]?.final_edges || 0);

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
