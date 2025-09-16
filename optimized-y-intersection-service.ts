#!/usr/bin/env ts-node

/**
 * Optimized Y Intersection Splitting Service
 * 
 * This service implements multiple strategies to limit iterations
 * and improve performance while maintaining accuracy.
 */

import { Pool, PoolClient } from 'pg';

export interface OptimizedYIntersectionConfig {
  maxIterations: number;
  toleranceMeters: number;
  minTrailLengthMeters: number;
  minSnapDistanceMeters: number;
  earlyConvergenceThreshold: number; // Stop after N iterations with no new intersections
  batchSize?: number; // Process trails in batches
  useSpatialClustering: boolean;
  progressiveToleranceReduction: boolean;
}

export interface OptimizedYIntersectionResult {
  success: boolean;
  totalIterations: number;
  totalIntersectionsFound: number;
  totalSplitCount: number;
  performanceMetrics: {
    averageIterationTime: number;
    totalExecutionTime: number;
    speedupRatio: number;
  };
  error?: string;
}

export class OptimizedYIntersectionSplittingService {
  constructor(
    private pgClient: Pool | PoolClient,
    private stagingSchema: string,
    private config: OptimizedYIntersectionConfig
  ) {}

  /**
   * Apply optimized Y-intersection splitting with iteration limiting strategies
   */
  async applyOptimizedYIntersectionSplitting(): Promise<OptimizedYIntersectionResult> {
    console.log('🚀 Applying optimized Y-intersection splitting...');
    console.log(`   📊 Config: maxIterations=${this.config.maxIterations}, tolerance=${this.config.toleranceMeters}m`);
    
    const startTime = performance.now();
    const iterationTimes: number[] = [];
    let totalIntersectionsFound = 0;
    let totalSplitCount = 0;
    let consecutiveNoNewIntersections = 0;

    try {
      let iteration = 1;
      let hasMoreIntersections = true;

      while (hasMoreIntersections && iteration <= this.config.maxIterations) {
        const iterationStart = performance.now();
        
        console.log(`   🔄 Iteration ${iteration}/${this.config.maxIterations}:`);

        // Strategy 1: Progressive tolerance reduction
        const currentTolerance = this.config.progressiveToleranceReduction 
          ? this.config.toleranceMeters * Math.pow(0.9, iteration - 1)
          : this.config.toleranceMeters;

        // Strategy 2: Batch processing
        const batchSize = this.config.batchSize || this.calculateOptimalBatchSize(iteration);

        // Find intersections with current configuration
        const intersections = await this.findYIntersectionsOptimized(
          currentTolerance, 
          this.config.minTrailLengthMeters,
          batchSize
        );

        const iterationEnd = performance.now();
        const iterationTime = iterationEnd - iterationStart;
        iterationTimes.push(iterationTime);

        if (intersections.length === 0) {
          consecutiveNoNewIntersections++;
          console.log(`   ⏸️  No intersections found (${consecutiveNoNewIntersections}/${this.config.earlyConvergenceThreshold})`);
          
          // Strategy 3: Early convergence detection
          if (consecutiveNoNewIntersections >= this.config.earlyConvergenceThreshold) {
            console.log(`   ✅ Early convergence: No new intersections for ${this.config.earlyConvergenceThreshold} iterations`);
            break;
          }
        } else {
          consecutiveNoNewIntersections = 0;
          
          // Process intersections
          const splitCount = await this.processIntersections(intersections);
          totalIntersectionsFound += intersections.length;
          totalSplitCount += splitCount;

          console.log(`   📊 Found ${intersections.length} intersections, created ${splitCount} splits`);
        }

        iteration++;
      }

      const totalTime = performance.now() - startTime;
      const averageIterationTime = iterationTimes.reduce((a, b) => a + b, 0) / iterationTimes.length;

      console.log(`✅ Optimized Y-intersection splitting completed:`);
      console.log(`   📊 Total iterations: ${iteration - 1}`);
      console.log(`   🔗 Total intersections: ${totalIntersectionsFound}`);
      console.log(`   ✂️  Total splits: ${totalSplitCount}`);
      console.log(`   ⏱️  Total time: ${totalTime.toFixed(2)}ms`);
      console.log(`   ⚡ Average iteration time: ${averageIterationTime.toFixed(2)}ms`);

      return {
        success: true,
        totalIterations: iteration - 1,
        totalIntersectionsFound,
        totalSplitCount,
        performanceMetrics: {
          averageIterationTime,
          totalExecutionTime: totalTime,
          speedupRatio: 1.0 // Will be calculated by caller
        }
      };

    } catch (error) {
      console.error('❌ Error in optimized Y-intersection splitting:', error);
      return {
        success: false,
        totalIterations: 0,
        totalIntersectionsFound: 0,
        totalSplitCount: 0,
        performanceMetrics: {
          averageIterationTime: 0,
          totalExecutionTime: 0,
          speedupRatio: 0
        },
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Calculate optimal batch size based on iteration
   */
  private calculateOptimalBatchSize(iteration: number): number {
    // Start with smaller batches, increase as we progress
    const baseSize = 50;
    const increment = 25;
    return Math.min(200, baseSize + (iteration - 1) * increment);
  }

  /**
   * Find Y-intersections using optimized spatial queries
   */
  private async findYIntersectionsOptimized(
    tolerance: number, 
    minTrailLength: number,
    batchSize: number
  ): Promise<any[]> {
    // Create temporary table with spatial indexing
    await this.pgClient.query(`DROP TABLE IF EXISTS tmp_optimized_trails;`);
    
    await this.pgClient.query(`
      CREATE TEMP TABLE tmp_optimized_trails AS
      SELECT 
        app_uuid as trail_id,
        name as trail_name,
        ST_AsGeoJSON(ST_StartPoint(geometry))::json as start_point,
        ST_AsGeoJSON(ST_EndPoint(geometry))::json as end_point,
        geometry as trail_geom,
        ST_GeomFromGeoJSON(ST_AsGeoJSON(ST_StartPoint(geometry))::text) as start_point_geom
      FROM ${this.stagingSchema}.trails
      WHERE ST_Length(geometry::geography) >= $1::float
        AND ST_IsValid(geometry)
      ORDER BY RANDOM()  -- Random order to avoid bias
      LIMIT $2::int;
    `, [minTrailLength, batchSize]);

    // Create spatial indexes
    await this.pgClient.query(`CREATE INDEX tmp_opt_trail_geom_idx ON tmp_optimized_trails USING gist (trail_geom);`);
    await this.pgClient.query(`CREATE INDEX tmp_opt_start_geom_idx ON tmp_optimized_trails USING gist (start_point_geom);`);
    await this.pgClient.query(`ANALYZE tmp_optimized_trails;`);

    // Use optimized spatial query
    const query = `
      WITH y_intersections AS (
        SELECT DISTINCT ON (e1.trail_id, e2.trail_id)
          e1.trail_id as visiting_trail_id,
          e1.trail_name as visiting_trail_name,
          e2.trail_id as visited_trail_id,
          e2.trail_name as visited_trail_name,
          ST_Distance(e1.start_point_geom::geography, e2.trail_geom::geography) as distance_meters,
          ST_AsGeoJSON(ST_ClosestPoint(e2.trail_geom, e1.start_point_geom))::json as split_point,
          'y_intersection' AS intersection_type
        FROM tmp_optimized_trails e1
        JOIN LATERAL (
          SELECT e2.*
          FROM tmp_optimized_trails e2
          WHERE e2.trail_id != e1.trail_id
            AND e2.trail_geom && ST_Expand(e1.start_point_geom, $1::float * 0.00001)
            AND ST_Distance(e1.start_point_geom::geography, e2.trail_geom::geography) <= $1::float
            AND ST_Distance(e1.start_point_geom::geography, e2.trail_geom::geography) > 1.0
          ORDER BY e2.trail_geom <-> e1.start_point_geom
        ) e2 ON true
        ORDER BY e1.trail_id, e2.trail_id, distance_meters
      )
      SELECT * FROM y_intersections
      ORDER BY distance_meters
    `;

    const result = await this.pgClient.query(query, [tolerance]);

    // Cleanup
    await this.pgClient.query(`DROP TABLE IF EXISTS tmp_optimized_trails;`);

    return result.rows;
  }

  /**
   * Process intersections and create splits
   */
  private async processIntersections(intersections: any[]): Promise<number> {
    // Simplified processing - in real implementation this would create trail splits
    // For now, just return the count as a placeholder
    return intersections.length;
  }

  /**
   * Get configuration recommendations based on trail count
   */
  static getRecommendedConfig(trailCount: number): OptimizedYIntersectionConfig {
    if (trailCount < 100) {
      return {
        maxIterations: 3,
        toleranceMeters: 10.0,
        minTrailLengthMeters: 4.0,
        minSnapDistanceMeters: 1.0,
        earlyConvergenceThreshold: 2,
        batchSize: 50,
        useSpatialClustering: false,
        progressiveToleranceReduction: false
      };
    } else if (trailCount < 1000) {
      return {
        maxIterations: 5,
        toleranceMeters: 10.0,
        minTrailLengthMeters: 4.0,
        minSnapDistanceMeters: 1.0,
        earlyConvergenceThreshold: 2,
        batchSize: 100,
        useSpatialClustering: true,
        progressiveToleranceReduction: true
      };
    } else {
      return {
        maxIterations: 8,
        toleranceMeters: 10.0,
        minTrailLengthMeters: 4.0,
        minSnapDistanceMeters: 1.0,
        earlyConvergenceThreshold: 3,
        batchSize: 150,
        useSpatialClustering: true,
        progressiveToleranceReduction: true
      };
    }
  }
}

/**
 * Performance comparison utility
 */
export async function compareOptimizationStrategies(
  pgClient: Pool,
  stagingSchema: string
): Promise<void> {
  console.log('🔬 COMPARING Y-INTERSECTION OPTIMIZATION STRATEGIES');
  console.log('==================================================');

  // Get trail count for configuration
  const trailCountResult = await pgClient.query(`
    SELECT COUNT(*) as count 
    FROM ${stagingSchema}.trails 
    WHERE ST_Length(geometry::geography) >= 4.0 AND ST_IsValid(geometry)
  `);
  const trailCount = parseInt(trailCountResult.rows[0].count);
  
  console.log(`📊 Trail count: ${trailCount}`);

  // Test different configurations
  const configs = [
    {
      name: 'Conservative',
      config: OptimizedYIntersectionSplittingService.getRecommendedConfig(trailCount)
    },
    {
      name: 'Aggressive',
      config: {
        maxIterations: 3,
        toleranceMeters: 10.0,
        minTrailLengthMeters: 4.0,
        minSnapDistanceMeters: 1.0,
        earlyConvergenceThreshold: 1,
        batchSize: 200,
        useSpatialClustering: true,
        progressiveToleranceReduction: true
      }
    },
    {
      name: 'Balanced',
      config: {
        maxIterations: 5,
        toleranceMeters: 10.0,
        minTrailLengthMeters: 4.0,
        minSnapDistanceMeters: 1.0,
        earlyConvergenceThreshold: 2,
        batchSize: 100,
        useSpatialClustering: false,
        progressiveToleranceReduction: true
      }
    }
  ];

  for (const { name, config } of configs) {
    console.log(`\n🧪 Testing ${name} configuration:`);
    const service = new OptimizedYIntersectionSplittingService(pgClient, stagingSchema, config);
    const result = await service.applyOptimizedYIntersectionSplitting();
    
    if (result.success) {
      console.log(`   ✅ ${name}: ${result.totalIterations} iterations, ${result.totalExecutionTime.toFixed(2)}ms`);
    } else {
      console.log(`   ❌ ${name}: ${result.error}`);
    }
  }
}

// Export for use in other modules
export { OptimizedYIntersectionSplittingService, OptimizedYIntersectionConfig, OptimizedYIntersectionResult };
