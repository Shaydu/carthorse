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