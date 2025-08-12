// Cleanup SQL queries
export const CleanupQueries = {
  // Cleanup staging schema
  cleanupStagingSchema: (schemaName: string) => `
    DROP SCHEMA IF EXISTS ${schemaName} CASCADE
  `,

  // Find all staging schemas
  findAllStagingSchemas: () => `
    SELECT nspname 
    FROM pg_namespace 
    WHERE nspname LIKE 'staging_%' 
    ORDER BY nspname
  `,

  // Cleanup all staging schemas
  cleanupAllStagingSchemas: () => `
    SELECT nspname 
    FROM pg_namespace 
    WHERE nspname LIKE 'staging_%' 
    ORDER BY nspname
  `,

  // Cleanup orphaned nodes
  cleanupOrphanedNodes: (schemaName: string) => `
    DELETE FROM ${schemaName}.ways_noded_vertices_pgr 
    WHERE id NOT IN (
      SELECT DISTINCT source FROM ${schemaName}.ways_noded 
      UNION 
      SELECT DISTINCT target FROM ${schemaName}.ways_noded
    )
  `,

  // Cleanup orphaned edges
  cleanupOrphanedEdges: (schemaName: string) => `
    DELETE FROM ${schemaName}.ways_noded 
    WHERE source NOT IN (SELECT id FROM ${schemaName}.ways_noded_vertices_pgr) 
    OR target NOT IN (SELECT id FROM ${schemaName}.ways_noded_vertices_pgr)
  `,

  // Cleanup bridge connector artifacts that create isolated degree-1 nodes
  cleanupBridgeConnectorArtifacts: (schemaName: string) => `
    WITH bridge_connector_edges AS (
      SELECT 
        e.id as edge_id,
        e.source,
        e.target,
        e.old_id,
        v1.cnt as source_degree,
        v2.cnt as target_degree,
        -- Check if this edge connects two degree-1 nodes (bridge connector artifact)
        CASE 
          WHEN v1.cnt = 1 AND v2.cnt = 1 THEN true
          ELSE false
        END as is_bridge_connector_artifact
      FROM ${schemaName}.ways_noded e
      JOIN ${schemaName}.ways_noded_vertices_pgr v1 ON e.source = v1.id
      JOIN ${schemaName}.ways_noded_vertices_pgr v2 ON e.target = v2.id
      WHERE e.old_id IS NULL OR e.old_id = 0  -- Bridge connectors typically have no old_id
    )
    DELETE FROM ${schemaName}.ways_noded 
    WHERE id IN (
      SELECT edge_id 
      FROM bridge_connector_edges 
      WHERE is_bridge_connector_artifact = true
    )
  `,

  // Clear routing nodes
  clearRoutingNodes: (schemaName: string) => `
    DELETE FROM ${schemaName}.ways_noded_vertices_pgr
  `,

  // Clear routing edges
  clearRoutingEdges: (schemaName: string) => `
    DELETE FROM ${schemaName}.ways_noded
  `,

  // Clear intersection points
  clearIntersectionPoints: (schemaName: string) => `
    DELETE FROM ${schemaName}.intersection_points
  `,

  // Clear trail hashes
  clearTrailHashes: (schemaName: string) => `
    DELETE FROM ${schemaName}.trail_hashes
  `,

  // Clear route recommendations
  clearRouteRecommendations: (schemaName: string) => `
    DELETE FROM ${schemaName}.route_recommendations
  `,

  // Clear all staging data
  clearAllStagingData: (schemaName: string) => `
    DELETE FROM ${schemaName}.ways_noded;
    DELETE FROM ${schemaName}.ways_noded_vertices_pgr;
    DELETE FROM ${schemaName}.intersection_points;
    DELETE FROM ${schemaName}.trail_hashes;
    DELETE FROM ${schemaName}.route_recommendations;
    DELETE FROM ${schemaName}.trails;
  `,

  // Check for test databases
  findTestDatabases: () => `
    SELECT datname 
    FROM pg_database 
    WHERE datname LIKE '%test%' OR datname LIKE '%tmp%' OR datname LIKE '%temp%'
    ORDER BY datname
  `,

  // Drop test database
  dropTestDatabase: (databaseName: string) => `
    DROP DATABASE IF EXISTS ${databaseName}
  `,

  // Check for SQLite test files
  findSqliteTestFiles: () => `
    SELECT filename 
    FROM pg_ls_dir('.') 
    WHERE filename LIKE '%.db' 
    AND (filename LIKE '%test%' OR filename LIKE '%tmp%' OR filename LIKE '%temp%')
    AND filename NOT LIKE '%boulder-export%' 
    AND filename NOT LIKE '%seattle-export%'
  `
}; 