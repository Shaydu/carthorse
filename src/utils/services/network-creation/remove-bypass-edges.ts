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
 * @param pgClient Database connection
 * @param stagingSchema Schema containing the ways_noded table
 * @returns Statistics about the bypass edge removal process
 */
export async function removeBypassEdges(
  pgClient: Pool, 
  stagingSchema: string
): Promise<BypassEdgeRemovalResult> {
  console.log('🔄 Removing bypass edges that span multiple nodes...');

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
        nodes_bypassed,
        CASE 
          WHEN nodes_bypassed > 0 THEN 'BYPASS'
          ELSE 'NORMAL'
        END as edge_type
      FROM edge_analysis
      WHERE edge_type = 'BYPASS'
      ORDER BY nodes_bypassed DESC, length_meters DESC
    `);

    const bypassEdges = analysisResult.rows;
    const totalNodesBypassed = bypassEdges.reduce((sum, edge) => sum + edge.nodes_bypassed, 0);

    console.log(`🔍 Found ${bypassEdges.length} bypass edges that bypass ${totalNodesBypassed} total nodes`);

    if (bypassEdges.length > 0) {
      console.log('🚫 Removing bypass edges:');
      bypassEdges.slice(0, 5).forEach(edge => {
        console.log(`  Edge ${edge.id}: ${edge.length_meters.toFixed(1)}m, bypasses ${edge.nodes_bypassed} nodes`);
      });
    }

    // Remove bypass edges
    const removalResult = await pgClient.query(`
      DELETE FROM ${stagingSchema}.ways_noded
      WHERE id IN (
        SELECT wn.id
        FROM ${stagingSchema}.ways_noded wn
        WHERE EXISTS (
          -- Check if this edge bypasses intermediate nodes
          SELECT 1 
          FROM ${stagingSchema}.ways_noded_vertices_pgr v 
          WHERE v.id != wn.source AND v.id != wn.target 
          AND ST_DWithin(v.the_geom, wn.the_geom, 0.0001)
          AND ST_Contains(ST_Buffer(wn.the_geom, 0.0001), v.the_geom)
        )
        AND wn.the_geom IS NOT NULL
      )
    `);

    // Count final edges
    const finalCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded
    `);

    const bypassEdgesRemoved = parseInt(initialCount.rows[0].count) - parseInt(finalCount.rows[0].count);
    const finalEdges = parseInt(finalCount.rows[0].count);

    console.log(`🔄 Bypass edge removal: removed ${bypassEdgesRemoved} bypass edges, ${finalEdges} final edges`);

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
