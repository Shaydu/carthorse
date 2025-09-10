import { Pool } from 'pg';

export interface EdgeDeduplicationResult {
  duplicatesRemoved: number;
  finalEdges: number;
}

/**
 * Remove duplicate edges that connect the exact same nodes.
 * Handles two types of duplicates:
 * 1. Exact duplicates: Same source and target (A→B and A→B)
 * 2. Bidirectional duplicates: Same nodes but opposite directions (A→B and B→A)
 * 
 * Keeps the edge with the shortest geometry and removes longer duplicates.
 * 
 * @param pgClient Database connection
 * @param stagingSchema Schema containing the ways_noded table
 * @returns Statistics about the deduplication process
 */
export async function deduplicateEdges(
  pgClient: Pool, 
  stagingSchema: string
): Promise<EdgeDeduplicationResult> {
  console.log('🔄 Deduplicating edges (exact and bidirectional duplicates)...');

  try {
    // Count initial edges
    const initialCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded
    `);

    // First, analyze what types of duplicates we have
    const duplicateAnalysis = await pgClient.query(`
      WITH edge_analysis AS (
        SELECT 
          id,
          source,
          target,
          length_km,
          ST_Length(the_geom) as geom_length,
          -- Count exact duplicates (same source, same target)
          COUNT(*) OVER (
            PARTITION BY source, target
          ) as exact_duplicates,
          -- Count bidirectional duplicates (same nodes, opposite directions)
          COUNT(*) OVER (
            PARTITION BY LEAST(source, target), GREATEST(source, target)
          ) as bidirectional_duplicates
        FROM ${stagingSchema}.ways_noded
        WHERE source != target  -- Don't consider self-loops as duplicates
      )
      SELECT 
        COUNT(CASE WHEN exact_duplicates > 1 THEN 1 END) as exact_duplicate_pairs,
        COUNT(CASE WHEN bidirectional_duplicates > 1 THEN 1 END) as bidirectional_duplicate_pairs,
        SUM(CASE WHEN exact_duplicates > 1 THEN exact_duplicates - 1 ELSE 0 END) as exact_duplicates_to_remove,
        SUM(CASE WHEN bidirectional_duplicates > 1 THEN bidirectional_duplicates - 1 ELSE 0 END) as bidirectional_duplicates_to_remove
      FROM edge_analysis
    `);

    const analysis = duplicateAnalysis.rows[0];
    console.log(`📊 Duplicate analysis:`);
    console.log(`   Exact duplicates: ${analysis.exact_duplicate_pairs} pairs, ${analysis.exact_duplicates_to_remove} edges to remove`);
    console.log(`   Bidirectional duplicates: ${analysis.bidirectional_duplicate_pairs} pairs, ${analysis.bidirectional_duplicates_to_remove} edges to remove`);

    // Remove exact duplicates first (same source, same target)
    console.log('🔄 Step 1: Removing exact duplicates (same source→target)...');
    const exactDeduplicationResult = await pgClient.query(`
      WITH exact_duplicates AS (
        SELECT 
          id,
          source,
          target,
          length_km,
          ST_Length(the_geom) as geom_length,
          ROW_NUMBER() OVER (
            PARTITION BY source, target
            ORDER BY ST_Length(the_geom) ASC, length_km ASC, id ASC
          ) as rank_by_length
        FROM ${stagingSchema}.ways_noded
        WHERE source != target
      ),
      exact_edges_to_delete AS (
        SELECT id
        FROM exact_duplicates
        WHERE rank_by_length > 1  -- Keep only the shortest edge for each exact (source, target) pair
      )
      DELETE FROM ${stagingSchema}.ways_noded
      WHERE id IN (SELECT id FROM exact_edges_to_delete)
    `);

    // Remove bidirectional duplicates (same nodes, opposite directions)
    console.log('🔄 Step 2: Removing bidirectional duplicates (A→B and B→A)...');
    const bidirectionalDeduplicationResult = await pgClient.query(`
      WITH bidirectional_duplicates AS (
        SELECT 
          id,
          source,
          target,
          length_km,
          ST_Length(the_geom) as geom_length,
          ROW_NUMBER() OVER (
            PARTITION BY LEAST(source, target), GREATEST(source, target)
            ORDER BY ST_Length(the_geom) ASC, length_km ASC, id ASC
          ) as rank_by_length
        FROM ${stagingSchema}.ways_noded
        WHERE source != target
      ),
      bidirectional_edges_to_delete AS (
        SELECT id
        FROM bidirectional_duplicates
        WHERE rank_by_length > 1  -- Keep only the shortest edge for each bidirectional pair
      )
      DELETE FROM ${stagingSchema}.ways_noded
      WHERE id IN (SELECT id FROM bidirectional_edges_to_delete)
    `);

    // Count final edges
    const finalCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded
    `);

    const duplicatesRemoved = parseInt(initialCount.rows[0].count) - parseInt(finalCount.rows[0].count);
    const finalEdges = parseInt(finalCount.rows[0].count);

    console.log(`🔄 Edge deduplication complete: removed ${duplicatesRemoved} duplicate edges, ${finalEdges} final edges (kept shortest geometries)`);

    return {
      duplicatesRemoved,
      finalEdges
    };

  } catch (error) {
    console.error('❌ Error during edge deduplication:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}
