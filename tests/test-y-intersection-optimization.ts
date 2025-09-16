#!/usr/bin/env ts-node

/**
 * Y Intersection Splitting Optimization Prototype
 * 
 * This script tests optimized spatial indexing approaches to replace
 * the expensive CROSS JOIN operations in Y intersection detection.
 */

import { Pool } from 'pg';
import { performance } from 'perf_hooks';

interface TestConfig {
  stagingSchema: string;
  toleranceMeters: number;
  minTrailLengthMeters: number;
  maxTrails: number; // Limit for testing
}

interface IntersectionResult {
  visiting_trail_id: string;
  visiting_trail_name: string;
  visited_trail_id: string;
  visited_trail_name: string;
  distance_meters: number;
  split_point: any;
  intersection_type: string;
}

class YIntersectionOptimizationTest {
  private pgClient: Pool;
  private config: TestConfig;

  constructor(pgClient: Pool, config: TestConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  /**
   * Test 1: Current CROSS JOIN approach (baseline)
   */
  async testCurrentApproach(): Promise<{ results: IntersectionResult[], duration: number, rowCount: number }> {
    console.log('🔍 Testing CURRENT CROSS JOIN approach...');
    
    const startTime = performance.now();
    
    const query = `
      WITH trail_endpoints AS (
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          ST_AsGeoJSON(ST_StartPoint(geometry))::json as start_point,
          ST_AsGeoJSON(ST_EndPoint(geometry))::json as end_point,
          geometry as trail_geom
        FROM ${this.config.stagingSchema}.trails
        WHERE ST_Length(geometry::geography) >= $1
          AND ST_IsValid(geometry)
        LIMIT $3
      ),
      y_intersections AS (
        SELECT DISTINCT ON (e1.trail_id, e2.trail_id)
          e1.trail_id as visiting_trail_id,
          e1.trail_name as visiting_trail_name,
          e2.trail_id as visited_trail_id,
          e2.trail_name as visited_trail_name,
          ST_Distance(ST_GeomFromGeoJSON(e1.start_point)::geography, e2.trail_geom::geography) as distance_meters,
          ST_AsGeoJSON(ST_ClosestPoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.start_point)))::json as split_point,
          'y_intersection' AS intersection_type
        FROM trail_endpoints e1
        CROSS JOIN trail_endpoints e2
        WHERE e1.trail_id != e2.trail_id
          AND ST_Distance(ST_GeomFromGeoJSON(e1.start_point)::geography, e2.trail_geom::geography) <= $2
          AND ST_Distance(ST_GeomFromGeoJSON(e1.start_point)::geography, e2.trail_geom::geography) > 1.0
        ORDER BY e1.trail_id, e2.trail_id, distance_meters
      )
      SELECT * FROM y_intersections
      ORDER BY distance_meters
      LIMIT 50
    `;

    const result = await this.pgClient.query(query, [
      this.config.minTrailLengthMeters,
      this.config.toleranceMeters,
      this.config.maxTrails
    ]);

    const endTime = performance.now();
    const duration = endTime - startTime;

    console.log(`   ⏱️  Duration: ${duration.toFixed(2)}ms`);
    console.log(`   📊 Results: ${result.rows.length} intersections found`);

    return {
      results: result.rows,
      duration,
      rowCount: result.rows.length
    };
  }

  /**
   * Test 2: Optimized spatial indexing approach
   */
  async testOptimizedApproach(): Promise<{ results: IntersectionResult[], duration: number, rowCount: number }> {
    console.log('🚀 Testing OPTIMIZED spatial indexing approach...');
    
    const startTime = performance.now();

    // Step 1: Create optimized temp table with spatial indexes
    await this.pgClient.query(`DROP TABLE IF EXISTS tmp_optimized_endpoints;`);
    
    await this.pgClient.query(`
      CREATE TEMP TABLE tmp_optimized_endpoints AS
      SELECT 
        app_uuid AS trail_id,
        name AS trail_name,
        ST_Transform(geometry, 3857) AS geom_3857,
        ST_Transform(ST_StartPoint(geometry), 3857) AS start_pt,
        ST_Transform(ST_EndPoint(geometry), 3857) AS end_pt
      FROM ${this.config.stagingSchema}.trails
      WHERE ST_Length(geometry::geography) >= $1
        AND ST_IsValid(geometry)
      LIMIT $2;
    `, [this.config.minTrailLengthMeters, this.config.maxTrails]);

    // Step 2: Create spatial indexes
    await this.pgClient.query(`CREATE INDEX IF NOT EXISTS tmp_opt_endpoints_geom_idx ON tmp_optimized_endpoints USING gist (geom_3857);`);
    await this.pgClient.query(`CREATE INDEX IF NOT EXISTS tmp_opt_endpoints_start_idx ON tmp_optimized_endpoints USING gist (start_pt);`);
    await this.pgClient.query(`CREATE INDEX IF NOT EXISTS tmp_opt_endpoints_end_idx ON tmp_optimized_endpoints USING gist (end_pt);`);
    await this.pgClient.query(`ANALYZE tmp_optimized_endpoints;`);

    // Step 3: Use optimized spatial query with LATERAL joins
    const query = `
      WITH visiting AS (
        SELECT trail_id, trail_name, start_pt AS endpoint FROM tmp_optimized_endpoints
        UNION ALL
        SELECT trail_id, trail_name, end_pt AS endpoint FROM tmp_optimized_endpoints
      ),
      y_intersections AS (
        SELECT DISTINCT ON (v.trail_id, t2.trail_id)
          v.trail_id AS visiting_trail_id,
          v.trail_name AS visiting_trail_name,
          ST_Transform(v.endpoint, 4326) AS visiting_endpoint,
          t2.trail_id AS visited_trail_id,
          t2.trail_name AS visited_trail_name,
          ST_Distance(v.endpoint, t2.geom_3857) AS distance_meters,
          ST_Transform(ST_ClosestPoint(t2.geom_3857, v.endpoint), 4326) AS split_point,
          'y_intersection' AS intersection_type
        FROM visiting v
        JOIN tmp_optimized_endpoints e ON e.trail_id = v.trail_id
        JOIN LATERAL (
          SELECT t2.trail_id, t2.trail_name, t2.geom_3857
          FROM tmp_optimized_endpoints t2
          WHERE t2.trail_id <> v.trail_id
            AND ST_DWithin(v.endpoint, t2.geom_3857, $1)
          ORDER BY t2.geom_3857 <-> v.endpoint
          LIMIT 8
        ) t2 ON true
        WHERE ST_Distance(v.endpoint, t2.geom_3857) > 1.0
      )
      SELECT * FROM y_intersections
      ORDER BY distance_meters
      LIMIT 50
    `;

    const result = await this.pgClient.query(query, [this.config.toleranceMeters]);

    const endTime = performance.now();
    const duration = endTime - startTime;

    console.log(`   ⏱️  Duration: ${duration.toFixed(2)}ms`);
    console.log(`   📊 Results: ${result.rows.length} intersections found`);

    // Cleanup
    await this.pgClient.query(`DROP TABLE IF EXISTS tmp_optimized_endpoints;`);

    return {
      results: result.rows,
      duration,
      rowCount: result.rows.length
    };
  }

  /**
   * Test 3: Hybrid approach with batch processing
   */
  async testHybridApproach(): Promise<{ results: IntersectionResult[], duration: number, rowCount: number }> {
    console.log('🔄 Testing HYBRID batch processing approach...');
    
    const startTime = performance.now();
    const batchSize = Math.min(100, this.config.maxTrails);
    let allResults: IntersectionResult[] = [];

    // Process trails in batches
    const batchQuery = `
      SELECT app_uuid, name, geometry
      FROM ${this.config.stagingSchema}.trails
      WHERE ST_Length(geometry::geography) >= $1
        AND ST_IsValid(geometry)
      ORDER BY app_uuid
      LIMIT $2 OFFSET $3
    `;

    let offset = 0;
    let hasMore = true;

    while (hasMore && offset < this.config.maxTrails) {
      const batchResult = await this.pgClient.query(batchQuery, [
        this.config.minTrailLengthMeters,
        batchSize,
        offset
      ]);

      if (batchResult.rows.length === 0) {
        hasMore = false;
        break;
      }

      // Process this batch against all other trails
      const batchIntersections = await this.processBatch(batchResult.rows);
      allResults.push(...batchIntersections);

      offset += batchSize;
      console.log(`   📦 Processed batch ${Math.floor(offset / batchSize)} (${offset} trails)`);
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    console.log(`   ⏱️  Duration: ${duration.toFixed(2)}ms`);
    console.log(`   📊 Results: ${allResults.length} intersections found`);

    return {
      results: allResults.slice(0, 50), // Limit results for comparison
      duration,
      rowCount: allResults.length
    };
  }

  private async processBatch(batchTrails: any[]): Promise<IntersectionResult[]> {
    if (batchTrails.length === 0) return [];

    const trailIds = batchTrails.map(t => `'${t.app_uuid}'`).join(',');
    
    const query = `
      WITH batch_trails AS (
        SELECT app_uuid, name, geometry
        FROM ${this.config.stagingSchema}.trails
        WHERE app_uuid IN (${trailIds})
      ),
      other_trails AS (
        SELECT app_uuid, name, geometry
        FROM ${this.config.stagingSchema}.trails
        WHERE app_uuid NOT IN (${trailIds})
          AND ST_Length(geometry::geography) >= $1
          AND ST_IsValid(geometry)
      )
      SELECT DISTINCT ON (b.app_uuid, o.app_uuid)
        b.app_uuid as visiting_trail_id,
        b.name as visiting_trail_name,
        o.app_uuid as visited_trail_id,
        o.name as visited_trail_name,
        ST_Distance(ST_StartPoint(b.geometry)::geography, o.geometry::geography) as distance_meters,
        ST_AsGeoJSON(ST_ClosestPoint(o.geometry, ST_StartPoint(b.geometry)))::json as split_point,
        'y_intersection' AS intersection_type
      FROM batch_trails b
      CROSS JOIN other_trails o
      WHERE ST_Distance(ST_StartPoint(b.geometry)::geography, o.geometry::geography) <= $2
        AND ST_Distance(ST_StartPoint(b.geometry)::geography, o.geometry::geography) > 1.0
      ORDER BY b.app_uuid, o.app_uuid, distance_meters
    `;

    const result = await this.pgClient.query(query, [
      this.config.minTrailLengthMeters,
      this.config.toleranceMeters
    ]);

    return result.rows;
  }

  /**
   * Run all tests and compare results
   */
  async runComparison(): Promise<void> {
    console.log('🧪 Y INTERSECTION OPTIMIZATION TEST');
    console.log('=====================================');
    console.log(`📊 Test Configuration:`);
    console.log(`   Schema: ${this.config.stagingSchema}`);
    console.log(`   Tolerance: ${this.config.toleranceMeters}m`);
    console.log(`   Min trail length: ${this.config.minTrailLengthMeters}m`);
    console.log(`   Max trails: ${this.config.maxTrails}`);
    console.log('');

    try {
      // Test current approach
      const currentResults = await this.testCurrentApproach();
      console.log('');

      // Test optimized approach
      const optimizedResults = await this.testOptimizedApproach();
      console.log('');

      // Test hybrid approach
      const hybridResults = await this.testHybridApproach();
      console.log('');

      // Compare results
      console.log('📈 PERFORMANCE COMPARISON');
      console.log('==========================');
      console.log(`Current CROSS JOIN:    ${currentResults.duration.toFixed(2)}ms (${currentResults.rowCount} results)`);
      console.log(`Optimized Spatial:     ${optimizedResults.duration.toFixed(2)}ms (${optimizedResults.rowCount} results)`);
      console.log(`Hybrid Batch:          ${hybridResults.duration.toFixed(2)}ms (${hybridResults.rowCount} results)`);
      console.log('');

      const speedup1 = currentResults.duration / optimizedResults.duration;
      const speedup2 = currentResults.duration / hybridResults.duration;

      console.log('🚀 SPEEDUP ANALYSIS');
      console.log('===================');
      console.log(`Optimized vs Current:  ${speedup1.toFixed(2)}x faster`);
      console.log(`Hybrid vs Current:     ${speedup2.toFixed(2)}x faster`);
      console.log('');

      if (speedup1 > 2 || speedup2 > 2) {
        console.log('✅ OPTIMIZATION SUCCESSFUL! Significant performance improvement detected.');
        console.log('   Recommendation: Integrate the best performing approach.');
      } else {
        console.log('⚠️  OPTIMIZATION MARGINAL: Limited performance improvement.');
        console.log('   Recommendation: Further optimization needed or current approach may be acceptable.');
      }

    } catch (error) {
      console.error('❌ Test failed:', error);
    }
  }
}

/**
 * Main execution function
 */
async function main() {
  const pgClient = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'carthorse',
    password: process.env.PGPASSWORD || '',
    max: 5
  });

  // Get the most recent staging schema
  const schemaResult = await pgClient.query(`
    SELECT schema_name 
    FROM information_schema.schemata 
    WHERE schema_name LIKE 'carthorse_%' 
    ORDER BY schema_name DESC 
    LIMIT 1
  `);

  if (schemaResult.rows.length === 0) {
    console.error('❌ No carthorse staging schemas found');
    process.exit(1);
  }

  const stagingSchema = schemaResult.rows[0].schema_name;
  console.log(`🎯 Using staging schema: ${stagingSchema}`);

  // Check trail count in this schema
  const trailCountResult = await pgClient.query(`
    SELECT COUNT(*) as count FROM ${stagingSchema}.trails
  `);
  const trailCount = parseInt(trailCountResult.rows[0].count);
  console.log(`📊 Trails in schema: ${trailCount}`);

  const config: TestConfig = {
    stagingSchema,
    toleranceMeters: 10.0,
    minTrailLengthMeters: 4.0,
    maxTrails: Math.min(500, trailCount) // Limit for testing
  };

  const tester = new YIntersectionOptimizationTest(pgClient, config);
  await tester.runComparison();

  await pgClient.end();
}

if (require.main === module) {
  main().catch(console.error);
}

export { YIntersectionOptimizationTest };
