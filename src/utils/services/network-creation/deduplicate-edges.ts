import { Pool } from 'pg';

export interface EdgeDeduplicationResult {
  duplicatesRemoved: number;
  finalEdges: number;
}

/**
 * Remove duplicate edges that connect the same source and target vertices.
 * Keeps the edge with the longest geometry and removes shorter duplicates.
 * 
 * @param pgClient Database connection
 * @param stagingSchema Schema containing the ways_noded table
 * @returns Statistics about the deduplication process
 */
export async function deduplicateEdges(
  pgClient: Pool, 
  stagingSchema: string
): Promise<EdgeDeduplicationResult> {
  console.log('🔄 Deduplicating edges...');

  try {
    // Count initial edges
    const initialCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded
    `);

    // Use window function to identify duplicates and mark the longest one to keep
    const deduplicationResult = await pgClient.query(`
      WITH edge_duplicates AS (
        SELECT 
          id,
          source,
          target,
          length_km,
          ST_Length(the_geom) as geom_length,
          ROW_NUMBER() OVER (
            PARTITION BY LEAST(source, target), GREATEST(source, target)
            ORDER BY ST_Length(the_geom) DESC, length_km DESC, id ASC
          ) as rank_by_length
        FROM ${stagingSchema}.ways_noded
        WHERE source != target  -- Don't consider self-loops as duplicates
      ),
      edges_to_delete AS (
        SELECT id
        FROM edge_duplicates
        WHERE rank_by_length > 1  -- Keep only the longest edge for each (source, target) pair
      )
      DELETE FROM ${stagingSchema}.ways_noded
      WHERE id IN (SELECT id FROM edges_to_delete)
    `);

    // Count final edges
    const finalCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded
    `);

    const duplicatesRemoved = parseInt(initialCount.rows[0].count) - parseInt(finalCount.rows[0].count);
    const finalEdges = parseInt(finalCount.rows[0].count);

    console.log(`🔄 Edge deduplication: removed ${duplicatesRemoved} duplicate edges, ${finalEdges} final edges`);

    return {
      duplicatesRemoved,
      finalEdges
    };

  } catch (error) {
    console.error('❌ Error during edge deduplication:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}
