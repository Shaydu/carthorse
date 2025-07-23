import { Client } from 'pg';

/**
 * Helper for routing graph creation (nodes and edges), refactored from orchestrator (2024-07-23).
 * Returns node/edge counts and validation results.
 */
export interface RoutingGraphResult {
  nodeCount: number;
  edgeCount: number;
  validation: any[];
  stats: any;
}

export async function buildRoutingGraphHelper(
  pgClient: Client,
  stagingSchema: string,
  trailsTable: string,
  intersectionTolerance: number,
  edgeTolerance: number
): Promise<RoutingGraphResult> {
  // Clear existing routing data
  await pgClient.query(`DELETE FROM ${stagingSchema}.routing_edges`);
  await pgClient.query(`DELETE FROM ${stagingSchema}.routing_nodes`);

  // Create routing nodes using PostGIS function
  const nodeCountRes = await pgClient.query(`
    SELECT ${stagingSchema}.build_routing_nodes('${stagingSchema}', '${trailsTable}', ${intersectionTolerance})
  `);
  const nodeCount = nodeCountRes.rows[0]?.build_routing_nodes ?? 0;

  // Create routing edges using PostGIS function
  const edgeCountRes = await pgClient.query(`
    SELECT ${stagingSchema}.build_routing_edges('${stagingSchema}', '${trailsTable}', ${edgeTolerance})
  `);
  const edgeCount = edgeCountRes.rows[0]?.build_routing_edges ?? 0;

  // Run comprehensive validation using PostGIS functions
  const validationRes = await pgClient.query(`
    SELECT * FROM ${stagingSchema}.validate_spatial_data_integrity('${stagingSchema}')
  `);
  const validation = validationRes.rows;

  // Get intersection statistics
  const statsRes = await pgClient.query(`
    SELECT * FROM ${stagingSchema}.get_intersection_stats('${stagingSchema}')
  `);
  const stats = statsRes.rows[0] || {};

  return { nodeCount, edgeCount, validation, stats };
} 