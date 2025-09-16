#!/usr/bin/env ts-node

/**
 * Refined Y Intersection Splitting Optimization
 * 
 * This script creates an optimized version that produces IDENTICAL results
 * to the current CROSS JOIN approach, but with much better performance.
 */

import { Pool } from 'pg';
import { performance } from 'perf_hooks';

interface IntersectionResult {
  visiting_trail_id: string;
  visiting_trail_name: string;
  visited_trail_id: string;
  visited_trail_name: string;
  distance_meters: number;
  split_point: any;
  intersection_type: string;
}

class RefinedYIntersectionOptimization {
  private pgClient: Pool;
  private stagingSchema: string;

  constructor(pgClient: Pool, stagingSchema: string) {
    this.pgClient = pgClient;
    this.stagingSchema = stagingSchema;
  }

  /**
   * Current CROSS JOIN approach (baseline)
   */
  async getCurrentResults(): Promise<IntersectionResult[]> {
    const query = `
      WITH trail_endpoints AS (
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          ST_AsGeoJSON(ST_StartPoint(geometry))::json as start_point,
          ST_AsGeoJSON(ST_EndPoint(geometry))::json as end_point,
          geometry as trail_geom
        FROM ${this.stagingSchema}.trails
        WHERE ST_Length(geometry::geography) >= $1
          AND ST_IsValid(geometry)
        LIMIT 500
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
    `;

    const result = await this.pgClient.query(query, [4.0, 10.0]);
    return result.rows;
  }

  /**
   * Refined optimized approach - IDENTICAL results but faster
   */
  async getRefinedOptimizedResults(): Promise<IntersectionResult[]> {
    // Create optimized temp table with EXACT same data as current approach
    await this.pgClient.query(`DROP TABLE IF EXISTS tmp_refined_endpoints;`);
    
    await this.pgClient.query(`
      CREATE TEMP TABLE tmp_refined_endpoints AS
      SELECT 
        app_uuid as trail_id,
        name as trail_name,
        ST_AsGeoJSON(ST_StartPoint(geometry))::json as start_point,
        ST_AsGeoJSON(ST_EndPoint(geometry))::json as end_point,
        geometry as trail_geom,
        -- Pre-calculate start point geometry for distance calculations
        ST_GeomFromGeoJSON(ST_AsGeoJSON(ST_StartPoint(geometry))::text) as start_point_geom,
        ST_GeomFromGeoJSON(ST_AsGeoJSON(ST_EndPoint(geometry))::text) as end_point_geom
      FROM ${this.stagingSchema}.trails
      WHERE ST_Length(geometry::geography) >= $1::float
        AND ST_IsValid(geometry)
      LIMIT 500;
    `, [4.0]);

    // Create spatial indexes on the geometries (not the GeoJSON)
    await this.pgClient.query(`CREATE INDEX IF NOT EXISTS tmp_refined_trail_geom_idx ON tmp_refined_endpoints USING gist (trail_geom);`);
    await this.pgClient.query(`CREATE INDEX IF NOT EXISTS tmp_refined_start_geom_idx ON tmp_refined_endpoints USING gist (start_point_geom);`);
    await this.pgClient.query(`CREATE INDEX IF NOT EXISTS tmp_refined_end_geom_idx ON tmp_refined_endpoints USING gist (end_point_geom);`);
    await this.pgClient.query(`ANALYZE tmp_refined_endpoints;`);

    // Use optimized spatial query that matches EXACT logic of current approach
    const query = `
      WITH y_intersections AS (
        SELECT DISTINCT ON (e1.trail_id, e2.trail_id)
          e1.trail_id as visiting_trail_id,
          e1.trail_name as visiting_trail_name,
          e2.trail_id as visited_trail_id,
          e2.trail_name as visited_trail_name,
          -- Use EXACT same distance calculation as current approach
          ST_Distance(e1.start_point_geom::geography, e2.trail_geom::geography) as distance_meters,
          -- Use EXACT same split point calculation as current approach
          ST_AsGeoJSON(ST_ClosestPoint(e2.trail_geom, e1.start_point_geom))::json as split_point,
          'y_intersection' AS intersection_type
        FROM tmp_refined_endpoints e1
        JOIN LATERAL (
          -- Use spatial index to find candidates, but don't limit results
          SELECT e2.*
          FROM tmp_refined_endpoints e2
          WHERE e2.trail_id != e1.trail_id
            -- Use spatial bounding box pre-filter for performance (10 meters = ~0.00009 degrees)
            AND e2.trail_geom && ST_Expand(e1.start_point_geom, 0.00009)
            -- Then apply exact same distance filter as current approach
            AND ST_Distance(e1.start_point_geom::geography, e2.trail_geom::geography) <= 10.0
            AND ST_Distance(e1.start_point_geom::geography, e2.trail_geom::geography) > 1.0
          ORDER BY e2.trail_geom <-> e1.start_point_geom
        ) e2 ON true
        ORDER BY e1.trail_id, e2.trail_id, distance_meters
      )
      SELECT * FROM y_intersections
      ORDER BY distance_meters
    `;

    const result = await this.pgClient.query(query);

    // Cleanup
    await this.pgClient.query(`DROP TABLE IF EXISTS tmp_refined_endpoints;`);

    return result.rows;
  }

  /**
   * Alternative approach using spatial clustering to avoid CROSS JOIN
   */
  async getClusteredOptimizedResults(): Promise<IntersectionResult[]> {
    // Create temp table with spatial clustering
    await this.pgClient.query(`DROP TABLE IF EXISTS tmp_clustered_endpoints;`);
    
    await this.pgClient.query(`
      CREATE TEMP TABLE tmp_clustered_endpoints AS
      SELECT 
        app_uuid as trail_id,
        name as trail_name,
        ST_AsGeoJSON(ST_StartPoint(geometry))::json as start_point,
        ST_AsGeoJSON(ST_EndPoint(geometry))::json as end_point,
        geometry as trail_geom,
        ST_GeomFromGeoJSON(ST_AsGeoJSON(ST_StartPoint(geometry))::text) as start_point_geom,
        ST_GeomFromGeoJSON(ST_AsGeoJSON(ST_EndPoint(geometry))::text) as end_point_geom,
        -- Add spatial clustering for better performance
        ST_ClusterKMeans(geometry, 10) OVER() as cluster_id
      FROM ${this.stagingSchema}.trails
      WHERE ST_Length(geometry::geography) >= $1::float
        AND ST_IsValid(geometry)
      LIMIT 500;
    `, [4.0]);

    // Create indexes
    await this.pgClient.query(`CREATE INDEX IF NOT EXISTS tmp_clustered_geom_idx ON tmp_clustered_endpoints USING gist (trail_geom);`);
    await this.pgClient.query(`CREATE INDEX IF NOT EXISTS tmp_clustered_start_idx ON tmp_clustered_endpoints USING gist (start_point_geom);`);
    await this.pgClient.query(`CREATE INDEX IF NOT EXISTS tmp_clustered_cluster_idx ON tmp_clustered_endpoints (cluster_id);`);
    await this.pgClient.query(`ANALYZE tmp_clustered_endpoints;`);

    // Process by clusters to reduce comparisons
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
        FROM tmp_clustered_endpoints e1
        JOIN tmp_clustered_endpoints e2 ON (
          e2.trail_id != e1.trail_id
          AND (
            -- Compare within same cluster OR nearby clusters
            e2.cluster_id = e1.cluster_id 
            OR e2.cluster_id = e1.cluster_id + 1 
            OR e2.cluster_id = e1.cluster_id - 1
          )
          AND ST_Distance(e1.start_point_geom::geography, e2.trail_geom::geography) <= $1::float
          AND ST_Distance(e1.start_point_geom::geography, e2.trail_geom::geography) > 1.0
        )
        ORDER BY e1.trail_id, e2.trail_id, distance_meters
      )
      SELECT * FROM y_intersections
      ORDER BY distance_meters
    `;

    const result = await this.pgClient.query(query, [10.0]);

    // Cleanup
    await this.pgClient.query(`DROP TABLE IF EXISTS tmp_clustered_endpoints;`);

    return result.rows;
  }

  /**
   * Compare results to verify they are identical
   */
  compareResults(current: IntersectionResult[], optimized: IntersectionResult[]): boolean {
    if (current.length !== optimized.length) {
      console.log(`❌ Different result counts: ${current.length} vs ${optimized.length}`);
      return false;
    }

    // Create lookup maps
    const currentMap = new Map<string, IntersectionResult>();
    current.forEach(result => {
      const key = `${result.visiting_trail_id}-${result.visited_trail_id}`;
      currentMap.set(key, result);
    });

    const optimizedMap = new Map<string, IntersectionResult>();
    optimized.forEach(result => {
      const key = `${result.visiting_trail_id}-${result.visited_trail_id}`;
      optimizedMap.set(key, result);
    });

    // Check if all keys match
    for (const key of currentMap.keys()) {
      if (!optimizedMap.has(key)) {
        console.log(`❌ Missing intersection in optimized: ${key}`);
        return false;
      }
    }

    for (const key of optimizedMap.keys()) {
      if (!currentMap.has(key)) {
        console.log(`❌ Extra intersection in optimized: ${key}`);
        return false;
      }
    }

    // Check distance accuracy for common intersections
    let maxDistanceDiff = 0;
    for (const [key, currentResult] of currentMap) {
      const optimizedResult = optimizedMap.get(key)!;
      const distanceDiff = Math.abs(currentResult.distance_meters - optimizedResult.distance_meters);
      maxDistanceDiff = Math.max(maxDistanceDiff, distanceDiff);
      
      if (distanceDiff > 0.001) { // More than 1mm difference
        console.log(`❌ Distance difference for ${key}: ${distanceDiff.toFixed(6)}m`);
        return false;
      }
    }

    console.log(`✅ Results are IDENTICAL!`);
    console.log(`   Count: ${current.length}`);
    console.log(`   Max distance difference: ${maxDistanceDiff.toFixed(6)}m`);
    return true;
  }

  /**
   * Run performance comparison with identical results verification
   */
  async runComparison(): Promise<void> {
    console.log('🔧 REFINED Y INTERSECTION OPTIMIZATION TEST');
    console.log('==========================================');
    console.log(`📊 Schema: ${this.stagingSchema}`);
    console.log('');

    try {
      // Test current approach
      console.log('🔍 Testing current CROSS JOIN approach...');
      const currentStart = performance.now();
      const currentResults = await this.getCurrentResults();
      const currentDuration = performance.now() - currentStart;
      console.log(`   ⏱️  Duration: ${currentDuration.toFixed(2)}ms`);
      console.log(`   📊 Results: ${currentResults.length} intersections`);
      console.log('');

      // Test refined optimized approach
      console.log('🚀 Testing refined optimized approach...');
      const optimizedStart = performance.now();
      const optimizedResults = await this.getRefinedOptimizedResults();
      const optimizedDuration = performance.now() - optimizedStart;
      console.log(`   ⏱️  Duration: ${optimizedDuration.toFixed(2)}ms`);
      console.log(`   📊 Results: ${optimizedResults.length} intersections`);
      console.log('');

      // Test clustered approach
      console.log('🔄 Testing clustered approach...');
      const clusteredStart = performance.now();
      const clusteredResults = await this.getClusteredOptimizedResults();
      const clusteredDuration = performance.now() - clusteredStart;
      console.log(`   ⏱️  Duration: ${clusteredDuration.toFixed(2)}ms`);
      console.log(`   📊 Results: ${clusteredResults.length} intersections`);
      console.log('');

      // Compare results
      console.log('📈 PERFORMANCE COMPARISON');
      console.log('==========================');
      console.log(`Current CROSS JOIN:    ${currentDuration.toFixed(2)}ms (${currentResults.length} results)`);
      console.log(`Refined Optimized:    ${optimizedDuration.toFixed(2)}ms (${optimizedResults.length} results)`);
      console.log(`Clustered Approach:   ${clusteredDuration.toFixed(2)}ms (${clusteredResults.length} results)`);
      console.log('');

      const speedup1 = currentDuration / optimizedDuration;
      const speedup2 = currentDuration / clusteredDuration;

      console.log('🚀 SPEEDUP ANALYSIS');
      console.log('===================');
      console.log(`Refined vs Current:   ${speedup1.toFixed(2)}x faster`);
      console.log(`Clustered vs Current: ${speedup2.toFixed(2)}x faster`);
      console.log('');

      // Verify result accuracy
      console.log('🔍 RESULT ACCURACY VERIFICATION');
      console.log('===============================');
      
      const refinedAccurate = this.compareResults(currentResults, optimizedResults);
      console.log('');
      
      const clusteredAccurate = this.compareResults(currentResults, clusteredResults);
      console.log('');

      if (refinedAccurate && speedup1 > 2) {
        console.log('✅ REFINED OPTIMIZATION SUCCESSFUL!');
        console.log('   - Results are identical to current approach');
        console.log(`   - Performance improvement: ${speedup1.toFixed(2)}x faster`);
        console.log('   - Ready for integration');
      } else if (clusteredAccurate && speedup2 > 2) {
        console.log('✅ CLUSTERED OPTIMIZATION SUCCESSFUL!');
        console.log('   - Results are identical to current approach');
        console.log(`   - Performance improvement: ${speedup2.toFixed(2)}x faster`);
        console.log('   - Ready for integration');
      } else {
        console.log('⚠️  OPTIMIZATION NEEDS FURTHER REFINEMENT');
        console.log('   - Results accuracy or performance needs improvement');
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

  const optimizer = new RefinedYIntersectionOptimization(pgClient, stagingSchema);
  await optimizer.runComparison();

  await pgClient.end();
}

if (require.main === module) {
  main().catch(console.error);
}

export { RefinedYIntersectionOptimization };
