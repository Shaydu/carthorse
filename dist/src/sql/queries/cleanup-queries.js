"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CleanupQueries = void 0;
// Cleanup SQL queries
exports.CleanupQueries = {
    // Cleanup staging schema
    cleanupStagingSchema: (schemaName) => `
    DROP SCHEMA IF EXISTS ${schemaName} CASCADE
  `,
    // Find all staging schemas
    findAllStagingSchemas: () => `
    SELECT nspname 
    FROM pg_namespace 
    WHERE nspname LIKE 'carthorse_%' 
    ORDER BY nspname
  `,
    // Cleanup all staging schemas
    cleanupAllStagingSchemas: () => `
    SELECT nspname 
    FROM pg_namespace 
    WHERE nspname LIKE 'carthorse_%' 
    ORDER BY nspname
  `,
    // Cleanup orphaned nodes
    cleanupOrphanedNodes: (schemaName) => `
    DELETE FROM ${schemaName}.ways_noded_vertices_pgr 
    WHERE id NOT IN (
      SELECT DISTINCT source FROM ${schemaName}.ways_noded 
      UNION 
      SELECT DISTINCT target FROM ${schemaName}.ways_noded
    )
  `,
    // Cleanup orphaned edges
    cleanupOrphanedEdges: (schemaName) => `
    DELETE FROM ${schemaName}.ways_noded 
    WHERE source IS NULL OR target IS NULL
  `,
    // Cleanup bridge connector artifacts
    cleanupBridgeConnectorArtifacts: (schemaName) => `
    WITH degree_counts AS (
      SELECT 
        vertex_id,
        COUNT(*) as degree
      FROM (
        SELECT source as vertex_id FROM ${schemaName}.ways_noded WHERE source IS NOT NULL
        UNION ALL
        SELECT target as vertex_id FROM ${schemaName}.ways_noded WHERE target IS NOT NULL
      ) all_vertices
      GROUP BY vertex_id
    ),
    bridge_connector_edges AS (
      SELECT e.id
      FROM ${schemaName}.ways_noded e
      JOIN degree_counts dc1 ON e.source = dc1.vertex_id
      JOIN degree_counts dc2 ON e.target = dc2.vertex_id
      WHERE dc1.degree = 1 AND dc2.degree = 1
    )
    DELETE FROM ${schemaName}.ways_noded 
    WHERE id IN (SELECT id FROM bridge_connector_edges)
  `,
    // Calculate and store node types based on degree
    calculateNodeTypes: (schemaName) => `
    ALTER TABLE ${schemaName}.ways_noded_vertices_pgr 
    ADD COLUMN IF NOT EXISTS node_type VARCHAR(20);
    
    UPDATE ${schemaName}.ways_noded_vertices_pgr 
    SET node_type = CASE 
      WHEN cnt >= 3 THEN 'intersection'
      WHEN cnt = 2 THEN 'connector'
      WHEN cnt = 1 THEN 'endpoint'
      ELSE 'unknown'
    END
  `,
    // Recalculate node connectivity after cleanup
    recalculateNodeConnectivity: (schemaName) => `
    UPDATE ${schemaName}.ways_noded_vertices_pgr 
    SET cnt = (
      SELECT COUNT(*) 
      FROM (
        SELECT source as vertex_id FROM ${schemaName}.ways_noded WHERE source IS NOT NULL
        UNION ALL
        SELECT target as vertex_id FROM ${schemaName}.ways_noded WHERE target IS NOT NULL
      ) all_vertices
      WHERE all_vertices.vertex_id = ways_noded_vertices_pgr.id
    )
  `,
    // Clear routing nodes
    clearRoutingNodes: (schemaName) => `
    DELETE FROM ${schemaName}.ways_noded_vertices_pgr
  `,
    // Clear routing edges
    clearRoutingEdges: (schemaName) => `
    DELETE FROM ${schemaName}.ways_noded
  `,
    // Clear intersection points
    clearIntersectionPoints: (schemaName) => `
    DELETE FROM ${schemaName}.intersection_points
  `,
    // Clear trail hashes
    clearTrailHashes: (schemaName) => `
    DELETE FROM ${schemaName}.trail_hashes
  `,
    // Clear route recommendations
    clearRouteRecommendations: (schemaName) => `
    DELETE FROM ${schemaName}.route_recommendations
  `,
    // Clear all staging data
    clearAllStagingData: (schemaName) => `
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
    dropTestDatabase: (databaseName) => `
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
//# sourceMappingURL=cleanup-queries.js.map