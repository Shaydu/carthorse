#!/usr/bin/env ts-node

/**
 * Compare Y Intersection Results
 * 
 * This script compares the actual results from current vs optimized approaches
 * to verify they produce identical intersections.
 */

import { Pool } from 'pg';

interface IntersectionResult {
  visiting_trail_id: string;
  visiting_trail_name: string;
  visited_trail_id: string;
  visited_trail_name: string;
  distance_meters: number;
  split_point: any;
  intersection_type: string;
}

class IntersectionResultComparator {
  private pgClient: Pool;
  private stagingSchema: string;

  constructor(pgClient: Pool, stagingSchema: string) {
    this.pgClient = pgClient;
    this.stagingSchema = stagingSchema;
  }

  /**
   * Get current CROSS JOIN results
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
   * Get optimized spatial results
   */
  async getOptimizedResults(): Promise<IntersectionResult[]> {
    // Create optimized temp table
    await this.pgClient.query(`DROP TABLE IF EXISTS tmp_optimized_endpoints;`);
    
    await this.pgClient.query(`
      CREATE TEMP TABLE tmp_optimized_endpoints AS
      SELECT 
        app_uuid AS trail_id,
        name AS trail_name,
        ST_Transform(geometry, 3857) AS geom_3857,
        ST_Transform(ST_StartPoint(geometry), 3857) AS start_pt,
        ST_Transform(ST_EndPoint(geometry), 3857) AS end_pt
      FROM ${this.stagingSchema}.trails
      WHERE ST_Length(geometry::geography) >= $1
        AND ST_IsValid(geometry)
      LIMIT 500;
    `, [4.0]);

    // Create spatial indexes
    await this.pgClient.query(`CREATE INDEX IF NOT EXISTS tmp_opt_endpoints_geom_idx ON tmp_optimized_endpoints USING gist (geom_3857);`);
    await this.pgClient.query(`CREATE INDEX IF NOT EXISTS tmp_opt_endpoints_start_idx ON tmp_optimized_endpoints USING gist (start_pt);`);
    await this.pgClient.query(`CREATE INDEX IF NOT EXISTS tmp_opt_endpoints_end_idx ON tmp_optimized_endpoints USING gist (end_pt);`);
    await this.pgClient.query(`ANALYZE tmp_optimized_endpoints;`);

    // Use optimized spatial query
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
    `;

    const result = await this.pgClient.query(query, [10.0]);

    // Cleanup
    await this.pgClient.query(`DROP TABLE IF EXISTS tmp_optimized_endpoints;`);

    return result.rows;
  }

  /**
   * Compare two result sets
   */
  compareResults(current: IntersectionResult[], optimized: IntersectionResult[]): void {
    console.log('🔍 DETAILED RESULT COMPARISON');
    console.log('=============================');
    console.log(`Current approach:    ${current.length} intersections`);
    console.log(`Optimized approach:  ${optimized.length} intersections`);
    console.log('');

    if (current.length !== optimized.length) {
      console.log('⚠️  DIFFERENT RESULT COUNTS!');
      console.log(`   Current: ${current.length}, Optimized: ${optimized.length}`);
      console.log('');
    }

    // Create lookup maps for comparison
    const currentMap = new Map<string, IntersectionResult>();
    const optimizedMap = new Map<string, IntersectionResult>();

    current.forEach(result => {
      const key = `${result.visiting_trail_id}-${result.visited_trail_id}`;
      currentMap.set(key, result);
    });

    optimized.forEach(result => {
      const key = `${result.visiting_trail_id}-${result.visited_trail_id}`;
      optimizedMap.set(key, result);
    });

    // Find intersections in current but not in optimized
    const onlyInCurrent: string[] = [];
    const onlyInOptimized: string[] = [];
    const common: string[] = [];

    for (const [key, result] of currentMap) {
      if (optimizedMap.has(key)) {
        common.push(key);
      } else {
        onlyInCurrent.push(key);
      }
    }

    for (const [key] of optimizedMap) {
      if (!currentMap.has(key)) {
        onlyInOptimized.push(key);
      }
    }

    console.log('📊 INTERSECTION ANALYSIS:');
    console.log(`   Common intersections:    ${common.length}`);
    console.log(`   Only in current:        ${onlyInCurrent.length}`);
    console.log(`   Only in optimized:      ${onlyInOptimized.length}`);
    console.log('');

    if (onlyInCurrent.length > 0) {
      console.log('🔍 Intersections only in CURRENT approach:');
      onlyInCurrent.slice(0, 5).forEach(key => {
        const result = currentMap.get(key)!;
        console.log(`   - ${result.visiting_trail_name} → ${result.visited_trail_name} (${result.distance_meters.toFixed(3)}m)`);
      });
      if (onlyInCurrent.length > 5) {
        console.log(`   ... and ${onlyInCurrent.length - 5} more`);
      }
      console.log('');
    }

    if (onlyInOptimized.length > 0) {
      console.log('🔍 Intersections only in OPTIMIZED approach:');
      onlyInOptimized.slice(0, 5).forEach(key => {
        const result = optimizedMap.get(key)!;
        console.log(`   - ${result.visiting_trail_name} → ${result.visited_trail_name} (${result.distance_meters.toFixed(3)}m)`);
      });
      if (onlyInOptimized.length > 5) {
        console.log(`   ... and ${onlyInOptimized.length - 5} more`);
      }
      console.log('');
    }

    // Compare distance accuracy for common intersections
    let distanceDifferences: number[] = [];
    let significantDifferences = 0;

    common.forEach(key => {
      const currentResult = currentMap.get(key)!;
      const optimizedResult = optimizedMap.get(key)!;
      
      const distanceDiff = Math.abs(currentResult.distance_meters - optimizedResult.distance_meters);
      distanceDifferences.push(distanceDiff);
      
      if (distanceDiff > 0.1) { // More than 10cm difference
        significantDifferences++;
      }
    });

    if (distanceDifferences.length > 0) {
      const avgDifference = distanceDifferences.reduce((a, b) => a + b, 0) / distanceDifferences.length;
      const maxDifference = Math.max(...distanceDifferences);
      
      console.log('📏 DISTANCE ACCURACY COMPARISON:');
      console.log(`   Average difference:     ${avgDifference.toFixed(6)}m`);
      console.log(`   Maximum difference:     ${maxDifference.toFixed(6)}m`);
      console.log(`   Significant differences: ${significantDifferences} (${(significantDifferences/common.length*100).toFixed(1)}%)`);
      console.log('');
    }

    // Overall assessment
    const totalExpected = current.length + onlyInOptimized.length;
    const accuracy = (common.length / totalExpected) * 100;

    console.log('✅ OVERALL ACCURACY ASSESSMENT:');
    console.log(`   Accuracy: ${accuracy.toFixed(1)}%`);
    
    if (accuracy >= 95 && significantDifferences === 0) {
      console.log('   ✅ RESULTS ARE ESSENTIALLY IDENTICAL');
      console.log('   ✅ OPTIMIZATION IS SAFE TO INTEGRATE');
    } else if (accuracy >= 90) {
      console.log('   ⚠️  RESULTS ARE MOSTLY IDENTICAL WITH MINOR DIFFERENCES');
      console.log('   ⚠️  REVIEW DIFFERENCES BEFORE INTEGRATION');
    } else {
      console.log('   ❌ RESULTS HAVE SIGNIFICANT DIFFERENCES');
      console.log('   ❌ OPTIMIZATION NEEDS REFINEMENT');
    }
  }

  /**
   * Run the comparison
   */
  async runComparison(): Promise<void> {
    console.log('🔍 Y INTERSECTION RESULT COMPARISON');
    console.log('===================================');
    console.log(`📊 Schema: ${this.stagingSchema}`);
    console.log('');

    try {
      console.log('🔍 Getting current CROSS JOIN results...');
      const currentResults = await this.getCurrentResults();
      console.log(`   Found ${currentResults.length} intersections`);
      console.log('');

      console.log('🚀 Getting optimized spatial results...');
      const optimizedResults = await this.getOptimizedResults();
      console.log(`   Found ${optimizedResults.length} intersections`);
      console.log('');

      this.compareResults(currentResults, optimizedResults);

    } catch (error) {
      console.error('❌ Comparison failed:', error);
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

  const comparator = new IntersectionResultComparator(pgClient, stagingSchema);
  await comparator.runComparison();

  await pgClient.end();
}

if (require.main === module) {
  main().catch(console.error);
}
