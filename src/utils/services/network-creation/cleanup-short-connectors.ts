/**
 * Cleanup Short Connectors
 * 
 * Removes very short connector edges that lead to dead-end nodes, which can
 * artificially create degree-3 vertices and prevent proper degree-2 chain merging.
 * 
 * This addresses cases where:
 * - A connector edge is very short (< threshold meters)  
 * - The connector leads to a degree-1 (dead-end) node
 * - This creates an artificial intersection that prevents merging
 * 
 * Example:
 *   Edge A: 13 → 10 (2934m, main trail)
 *   Edge B: 10 → 24 (105m, main trail)  
 *   Edge C: 10 → 23 (23m, connector to dead-end)
 * 
 * Without cleanup: Node 10 appears degree-3, no merging possible
 * With cleanup: Edge C removed, Node 10 becomes degree-2, Edges A+B can merge
 */

import { Pool, PoolClient } from 'pg';

export interface ShortConnectorCleanupResult {
  connectorsRemoved: number;
  deadEndNodesRemoved: number;
  finalEdges: number;
}

/**
 * Remove short connector edges that lead to dead-end nodes
 */
export async function cleanupShortConnectors(
  pgClient: Pool | PoolClient, 
  stagingSchema: string,
  maxConnectorLengthMeters: number = 50
): Promise<ShortConnectorCleanupResult> {
  
  console.log(`🧹 Starting short connector cleanup (threshold: ${maxConnectorLengthMeters}m)...`);
  
  // First, update vertex degrees to ensure accuracy
  await pgClient.query(`
    UPDATE ${stagingSchema}.ways_noded_vertices_pgr v 
    SET cnt = (
      SELECT COUNT(*)
      FROM ${stagingSchema}.ways_noded e
      WHERE e.source = v.id OR e.target = v.id
    )
  `);
  
  // Find short connector edges that lead to dead-end nodes
  const shortConnectorQuery = `
    WITH short_connectors AS (
      SELECT 
        e.id,
        e.source,
        e.target,
        e.name,
        ST_Length(ST_Transform(e.geom, 3857)) as length_meters,
        vs.cnt as source_degree,
        vt.cnt as target_degree
      FROM ${stagingSchema}.ways_noded e
      JOIN ${stagingSchema}.ways_noded_vertices_pgr vs ON vs.id = e.source
      JOIN ${stagingSchema}.ways_noded_vertices_pgr vt ON vt.id = e.target
      WHERE 
        -- Edge is short
        ST_Length(ST_Transform(e.geom, 3857)) <= $1
        -- Edge is a connector
        AND (e.name ILIKE '%connector%' OR e.app_uuid ILIKE '%connector%')
        -- At least one endpoint is degree-1 (dead end)
        AND (vs.cnt = 1 OR vt.cnt = 1)
    )
    SELECT * FROM short_connectors
    ORDER BY length_meters ASC
  `;
  
  const shortConnectors = await pgClient.query(shortConnectorQuery, [maxConnectorLengthMeters]);
  
  if (shortConnectors.rows.length === 0) {
    console.log('✅ No short connectors to dead-end nodes found');
    
    const finalCount = await pgClient.query(`SELECT COUNT(*)::int AS c FROM ${stagingSchema}.ways_noded`);
    return {
      connectorsRemoved: 0,
      deadEndNodesRemoved: 0,
      finalEdges: finalCount.rows[0].c
    };
  }
  
  console.log(`🔍 Found ${shortConnectors.rows.length} short connector(s) to dead-end nodes:`);
  
  let connectorsRemoved = 0;
  let deadEndNodesRemoved = 0;
  
  for (const connector of shortConnectors.rows) {
    console.log(`  📌 Edge ${connector.id}: ${connector.source}→${connector.target} (${connector.length_meters.toFixed(1)}m)`);
    console.log(`     Name: ${connector.name}`);
    console.log(`     Degrees: source=${connector.source_degree}, target=${connector.target_degree}`);
    
    // Determine which node is the dead-end
    const deadEndNodeId = connector.source_degree === 1 ? connector.source : connector.target;
    const otherNodeId = connector.source_degree === 1 ? connector.target : connector.source;
    
    // Remove the connector edge
    await pgClient.query(`
      DELETE FROM ${stagingSchema}.ways_noded 
      WHERE id = $1
    `, [connector.id]);
    
    connectorsRemoved++;
    console.log(`     ✅ Removed connector edge ${connector.id}`);
    
    // Check if the dead-end node is now orphaned (no remaining edges)
    const remainingEdges = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${stagingSchema}.ways_noded e
      WHERE e.source = $1 OR e.target = $1
    `, [deadEndNodeId]);
    
    if (remainingEdges.rows[0].count === 0) {
      // Remove the orphaned node
      await pgClient.query(`
        DELETE FROM ${stagingSchema}.ways_noded_vertices_pgr 
        WHERE id = $1
      `, [deadEndNodeId]);
      
      deadEndNodesRemoved++;
      console.log(`     ✅ Removed orphaned dead-end node ${deadEndNodeId}`);
    }
    
    console.log('');
  }
  
  // Update vertex degrees after cleanup
  await pgClient.query(`
    UPDATE ${stagingSchema}.ways_noded_vertices_pgr v 
    SET cnt = (
      SELECT COUNT(*)
      FROM ${stagingSchema}.ways_noded e
      WHERE e.source = v.id OR e.target = v.id
    )
  `);
  
  const finalCount = await pgClient.query(`SELECT COUNT(*)::int AS c FROM ${stagingSchema}.ways_noded`);
  
  console.log(`🧹 Short connector cleanup complete:`);
  console.log(`   - Connectors removed: ${connectorsRemoved}`);
  console.log(`   - Dead-end nodes removed: ${deadEndNodesRemoved}`);
  console.log(`   - Final edges: ${finalCount.rows[0].c}`);
  
  return {
    connectorsRemoved,
    deadEndNodesRemoved,
    finalEdges: finalCount.rows[0].c
  };
}
