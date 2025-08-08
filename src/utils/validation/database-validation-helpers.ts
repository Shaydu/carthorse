import { Pool } from 'pg';

export interface ValidationResult {
  success: boolean;
  message: string;
  details?: any;
}

export interface SchemaVersion {
  version: string;
  description: string;
  created_at: string;
}

/**
 * Check PostgreSQL master database schema version
 */
export async function checkMasterSchemaVersion(pgClient: Pool): Promise<ValidationResult> {
  try {
    console.log('🔍 Checking master database schema version...');
    
    const result = await pgClient.query(`
      SELECT version, created_at 
      FROM schema_version 
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    
    if (result.rows.length === 0) {
      return {
        success: false,
        message: '❌ No schema version found in master database',
        details: { error: 'schema_version table is empty or missing' }
      };
    }
    
    const schemaVersion = result.rows[0];
    console.log(`✅ Master schema version: ${schemaVersion.version}`);
    
    return {
      success: true,
      message: `Master schema version: ${schemaVersion.version}`,
      details: schemaVersion
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to check master schema version',
      details: { error: error instanceof Error ? error.message : String(error) }
    };
  }
}

/**
 * Check SQLite database schema version
 */
export async function checkSqliteSchemaVersion(sqlitePath: string): Promise<ValidationResult> {
  try {
    console.log('🔍 Checking SQLite database schema version...');
    
    const { Database } = require('sqlite3');
    const db = new Database(sqlitePath);
    
    return new Promise((resolve) => {
      db.get(`
        SELECT version, created_at 
        FROM schema_version 
        ORDER BY created_at DESC 
        LIMIT 1
      `, (err: any, row: any) => {
        db.close();
        
        if (err) {
          resolve({
            success: false,
            message: '❌ Failed to check SQLite schema version',
            details: { error: err instanceof Error ? err.message : String(err) }
          });
          return;
        }
        
        if (!row) {
          resolve({
            success: false,
            message: '❌ No schema version found in SQLite database',
            details: { error: 'schema_version table is empty or missing' }
          });
          return;
        }
        
        const schemaVersion: SchemaVersion = row;
        console.log(`✅ SQLite schema version: ${schemaVersion.version} - ${schemaVersion.description}`);
        
        resolve({
          success: true,
          message: `SQLite schema version: ${schemaVersion.version}`,
          details: schemaVersion
        });
      });
    });
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to check SQLite schema version',
      details: { error: error instanceof Error ? error.message : String(error) }
    };
  }
}

/**
 * Check required PostgreSQL functions exist
 */
export async function checkRequiredSqlFunctions(pgClient: Pool): Promise<ValidationResult> {
  try {
    console.log('🔍 Checking required PostgreSQL functions...');
    
    const requiredFunctions = [
      // Custom Carthorse functions that must be installed
      'detect_trail_intersections'
    ];
    
    const missingFunctions: string[] = [];
    
    for (const funcName of requiredFunctions) {
      try {
        const result = await pgClient.query(`
          SELECT proname 
          FROM pg_proc 
          WHERE proname = $1 
          AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        `, [funcName]);
        
        if (result.rows.length === 0) {
          missingFunctions.push(funcName);
        }
      } catch (error) {
        // Function check failed, assume it's missing
        missingFunctions.push(funcName);
      }
    }
    
    if (missingFunctions.length > 0) {
      return {
        success: false,
        message: `❌ Missing ${missingFunctions.length} required PostgreSQL functions`,
        details: { missingFunctions }
      };
    }
    
    console.log(`✅ All ${requiredFunctions.length} required PostgreSQL functions are available`);
    
    return {
      success: true,
      message: `All ${requiredFunctions.length} required PostgreSQL functions are available`,
      details: { functionCount: requiredFunctions.length }
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to check required PostgreSQL functions',
      details: { error: error instanceof Error ? error.message : String(error) }
    };
  }
}

/**
 * Validate pgRouting network topology
 */
export async function validateRoutingNetwork(pgClient: Pool, stagingSchema: string): Promise<ValidationResult> {
  try {
    console.log('🔍 Validating pgRouting network topology...');
    
    // Check if ways_noded table exists and has data
    const waysNodedResult = await pgClient.query(`
      SELECT COUNT(*) as count 
      FROM ${stagingSchema}.ways_noded
    `);
    
    const waysNodedCount = parseInt(waysNodedResult.rows[0].count);
    if (waysNodedCount === 0) {
      return {
        success: false,
        message: '❌ No routing edges found in ways_noded table',
        details: { edgeCount: 0 }
      };
    }
    
    // Check if ways_noded_vertices_pgr table exists and has data
    const verticesResult = await pgClient.query(`
      SELECT COUNT(*) as count 
      FROM ${stagingSchema}.ways_noded_vertices_pgr
    `);
    
    const verticesCount = parseInt(verticesResult.rows[0].count);
    if (verticesCount === 0) {
      return {
        success: false,
        message: '❌ No routing vertices found in ways_noded_vertices_pgr table',
        details: { vertexCount: 0 }
      };
    }
    
    // Check for isolated vertices (vertices with no edges)
    const isolatedVerticesResult = await pgClient.query(`
      SELECT COUNT(*) as count 
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      WHERE NOT EXISTS (
        SELECT 1 FROM ${stagingSchema}.ways_noded w 
        WHERE w.source = v.id OR w.target = v.id
      )
    `);
    
    const isolatedVerticesCount = parseInt(isolatedVerticesResult.rows[0].count);
    
    // Check for disconnected components
    const componentsResult = await pgClient.query(`
      SELECT COUNT(DISTINCT component) as component_count
      FROM pgr_connectedComponents(
        'SELECT id, source, target, length_km * 1000 as cost FROM ${stagingSchema}.ways_noded'
      )
    `);
    
    const componentCount = parseInt(componentsResult.rows[0].component_count);
    
    // Check if network is strongly connected (can reach all nodes from any node)
    const reachableNodesResult = await pgClient.query(`
      SELECT COUNT(DISTINCT node) as reachable_count
      FROM pgr_dijkstra(
        'SELECT id, source, target, length_km * 1000 as cost FROM ${stagingSchema}.ways_noded',
        (SELECT id FROM ${stagingSchema}.ways_noded_vertices_pgr LIMIT 1),
        (SELECT array_agg(id) FROM ${stagingSchema}.ways_noded_vertices_pgr)
      )
    `);
    
    const reachableNodesCount = parseInt(reachableNodesResult.rows[0].reachable_count);
    const connectivityPercentage = (reachableNodesCount / verticesCount) * 100;
    
    console.log(`✅ Network validation completed:`);
    console.log(`   📍 Vertices: ${verticesCount}`);
    console.log(`   🛤️ Edges: ${waysNodedCount}`);
    console.log(`   🔗 Components: ${componentCount}`);
    console.log(`   🎯 Connectivity: ${connectivityPercentage.toFixed(1)}%`);
    console.log(`   🚫 Isolated vertices: ${isolatedVerticesCount}`);
    
    return {
      success: true,
      message: `Network validation passed: ${verticesCount} vertices, ${waysNodedCount} edges, ${connectivityPercentage.toFixed(1)}% connectivity`,
      details: {
        vertexCount: verticesCount,
        edgeCount: waysNodedCount,
        componentCount,
        connectivityPercentage,
        isolatedVerticesCount
      }
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to validate routing network',
      details: { error: error instanceof Error ? error.message : String(error) }
    };
  }
}

/**
 * Comprehensive database validation
 */
export async function validateDatabase(pgClient: Pool, stagingSchema: string, sqlitePath?: string): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  
  // Check master schema version
  const masterSchemaResult = await checkMasterSchemaVersion(pgClient);
  results.push(masterSchemaResult);
  
  // Check SQLite schema version if path provided
  if (sqlitePath) {
    const sqliteSchemaResult = await checkSqliteSchemaVersion(sqlitePath);
    results.push(sqliteSchemaResult);
  }
  
  // Check required SQL functions
  const functionsResult = await checkRequiredSqlFunctions(pgClient);
  results.push(functionsResult);
  
  // Validate routing network
  const networkResult = await validateRoutingNetwork(pgClient, stagingSchema);
  results.push(networkResult);
  
  return results;
} 