// Utility function to apply spatial optimizations to any staging schema
// This can be used by any service that creates staging schemas

import { SpatialOptimization } from './spatial-optimization';
import { Pool } from 'pg';

export interface ApplySpatialOptimizationsConfig {
  pgClient: Pool;
  stagingSchema: string;
  toleranceMeters?: number;
  batchSize?: number;
  gridSizeMeters?: number;
  minTrailLengthMeters?: number;
}

/**
 * Apply spatial optimizations to a staging schema
 * This function can be called by any service that creates staging schemas
 */
export async function applySpatialOptimizationsToSchema(config: ApplySpatialOptimizationsConfig): Promise<void> {
  try {
    console.log(`🚀 Applying spatial optimizations to schema: ${config.stagingSchema}`);
    
    const spatialOptimization = new SpatialOptimization({
      stagingSchema: config.stagingSchema,
      toleranceMeters: config.toleranceMeters || 50.0,
      batchSize: config.batchSize || 500,
      gridSizeMeters: config.gridSizeMeters || 100.0,
      minTrailLengthMeters: config.minTrailLengthMeters || 500.0
    });

    // Apply all spatial optimization functions and indexes
    const optimizationSql = spatialOptimization.getAllOptimizationsSql();
    await config.pgClient.query(optimizationSql);
    
    console.log(`✅ Spatial optimizations applied successfully to schema: ${config.stagingSchema}`);
  } catch (error) {
    console.error(`❌ Failed to apply spatial optimizations to schema ${config.stagingSchema}:`, error);
    throw error;
  }
}

/**
 * Check if a staging schema has spatial optimizations applied
 */
export async function hasSpatialOptimizations(pgClient: Pool, stagingSchema: string): Promise<boolean> {
  try {
    const result = await pgClient.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.routines 
        WHERE routine_schema = $1 
        AND routine_name = 'detect_y_intersections_optimized'
      ) as has_optimizations
    `, [stagingSchema]);
    
    return result.rows[0]?.has_optimizations || false;
  } catch (error) {
    console.warn(`Could not check spatial optimizations for schema ${stagingSchema}:`, error);
    return false;
  }
}

/**
 * Get spatial optimization statistics for a staging schema
 */
export async function getSpatialOptimizationStats(pgClient: Pool, stagingSchema: string): Promise<any> {
  try {
    const result = await pgClient.query(`
      SELECT * FROM ${stagingSchema}.get_spatial_query_stats('trails')
    `);
    
    return result.rows;
  } catch (error) {
    console.warn(`Could not get spatial optimization stats for schema ${stagingSchema}:`, error);
    return [];
  }
}
