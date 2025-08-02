#!/usr/bin/env node

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuration
const TEST_CONFIG = {
  database: 'trail_master_db',
  user: 'tester',
  password: 'your_password_here',
  host: 'localhost',
  port: 5432,
  stagingSchema: 'staging_boulder_test',
  testLimit: 100, // Larger limit for more meaningful results
  iterations: 3   // Number of test iterations for averaging
};

class PerformanceTester {
  constructor() {
    this.client = new Client(TEST_CONFIG);
    this.results = {};
  }

  async connect() {
    await this.client.connect();
    console.log('✅ Connected to database');
  }

  async disconnect() {
    await this.client.end();
    console.log('✅ Disconnected from database');
  }

  async createTestSchema() {
    const schemaName = TEST_CONFIG.stagingSchema;
    console.log(`🔧 Creating test schema: ${schemaName}`);
    
    // Drop if exists
    await this.client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    
    // Create schema
    await this.client.query(`CREATE SCHEMA ${schemaName}`);
    
    // Create tables with UUID primary keys
    const createTablesSQL = `
      CREATE TABLE ${schemaName}.trails (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        app_uuid TEXT UNIQUE NOT NULL,
        osm_id TEXT,
        name TEXT,
        region TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        source_tags JSONB,
        bbox_min_lng DOUBLE PRECISION,
        bbox_max_lng DOUBLE PRECISION,
        bbox_min_lat DOUBLE PRECISION,
        bbox_max_lat DOUBLE PRECISION,
        length_km DOUBLE PRECISION,
        elevation_gain DOUBLE PRECISION,
        elevation_loss DOUBLE PRECISION,
        max_elevation DOUBLE PRECISION,
        min_elevation DOUBLE PRECISION,
        avg_elevation DOUBLE PRECISION,
        source TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        geometry GEOMETRY(LINESTRINGZ, 4326)
      );

      CREATE TABLE ${schemaName}.routing_nodes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        node_uuid TEXT UNIQUE NOT NULL,
        node_type TEXT,
        connected_trails TEXT,
        elevation DOUBLE PRECISION,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        geometry GEOMETRY(POINTZ, 4326)
      );

      CREATE TABLE ${schemaName}.routing_edges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source UUID REFERENCES ${schemaName}.routing_nodes(id),
        target UUID REFERENCES ${schemaName}.routing_nodes(id),
        trail_id TEXT,
        trail_name TEXT,
        length_km DOUBLE PRECISION,
        elevation_gain DOUBLE PRECISION,
        elevation_loss DOUBLE PRECISION,
        geometry GEOMETRY(LINESTRING, 4326),
        geojson TEXT
      );
    `;
    
    await this.client.query(createTablesSQL);
    console.log('✅ Test schema created');
  }

  async createOptimizedIndexes() {
    const schemaName = TEST_CONFIG.stagingSchema;
    console.log('🔧 Creating optimized indexes...');
    
    const indexesSQL = `
      -- Spatial indexes
      CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_geometry ON ${schemaName}.trails USING GIST(geometry);
      CREATE INDEX IF NOT EXISTS idx_${schemaName}_nodes_geometry ON ${schemaName}.routing_nodes USING GIST(geometry);
      CREATE INDEX IF NOT EXISTS idx_${schemaName}_edges_geometry ON ${schemaName}.routing_edges USING GIST(geometry);
      
      -- B-tree indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_app_uuid ON ${schemaName}.trails(app_uuid);
      CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_region ON ${schemaName}.trails(region);
      CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_length ON ${schemaName}.trails(length_km) WHERE length_km > 0;
      
      -- Composite indexes for intersection queries
      CREATE INDEX IF NOT EXISTS idx_${schemaName}_trails_bbox ON ${schemaName}.trails USING GIST(ST_MakeEnvelope(bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat, 4326));
      
      -- Node indexes
      CREATE INDEX IF NOT EXISTS idx_${schemaName}_nodes_node_uuid ON ${schemaName}.routing_nodes(node_uuid);
      CREATE INDEX IF NOT EXISTS idx_${schemaName}_nodes_elevation ON ${schemaName}.routing_nodes(elevation);
      
      -- Edge indexes
      CREATE INDEX IF NOT EXISTS idx_${schemaName}_edges_source ON ${schemaName}.routing_edges(source);
      CREATE INDEX IF NOT EXISTS idx_${schemaName}_edges_target ON ${schemaName}.routing_edges(target);
      CREATE INDEX IF NOT EXISTS idx_${schemaName}_edges_trail_id ON ${schemaName}.routing_edges(trail_id);
    `;
    
    await this.client.query(indexesSQL);
    console.log('✅ Optimized indexes created');
  }

  async loadTestData() {
    const schemaName = TEST_CONFIG.stagingSchema;
    console.log(`📊 Loading test data (limit: ${TEST_CONFIG.testLimit})...`);
    
    const loadSQL = `
      INSERT INTO ${schemaName}.trails (
        app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
        created_at, updated_at, geometry
      )
      SELECT 
        gen_random_uuid()::text as app_uuid,
        osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
        created_at, updated_at, geometry
      FROM trails 
      WHERE region = 'boulder' 
      LIMIT ${TEST_CONFIG.testLimit}
    `;
    
    const result = await this.client.query(loadSQL);
    console.log(`✅ Loaded ${result.rowCount} test trails`);
  }

  async benchmarkQuery(queryName, sql, params = []) {
    const times = [];
    let lastResult = null;
    
    for (let i = 0; i < TEST_CONFIG.iterations; i++) {
      const start = process.hrtime.bigint();
      
      const result = await this.client.query(sql, params);
      lastResult = result;
      
      const end = process.hrtime.bigint();
      const duration = Number(end - start) / 1000000; // Convert to milliseconds
      times.push(duration);
      
      console.log(`  ${queryName} iteration ${i + 1}: ${duration.toFixed(2)}ms (${result.rowCount} rows)`);
    }
    
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    
    return {
      queryName,
      avgTime,
      minTime,
      maxTime,
      iterations: TEST_CONFIG.iterations,
      rowCount: lastResult ? lastResult.rowCount : 0
    };
  }

  async runBaselineTests() {
    console.log('\n📊 Running baseline performance tests...');
    
    const schemaName = TEST_CONFIG.stagingSchema;
    
    // Test 1: Simple trail query
    const trailQuery = `
      SELECT COUNT(*) as trail_count, 
             AVG(length_km) as avg_length,
             SUM(length_km) as total_length
      FROM ${schemaName}.trails
      WHERE region = 'boulder'
    `;
    
    // Test 2: Spatial intersection query (simulating our intersection detection)
    const intersectionQuery = `
      SELECT COUNT(*) as intersection_count
      FROM ${schemaName}.trails t1
      JOIN ${schemaName}.trails t2 ON (
        t1.app_uuid != t2.app_uuid 
        AND ST_Intersects(t1.geometry, t2.geometry)
        AND ST_Length(t1.geometry::geography) > 10
        AND ST_Length(t2.geometry::geography) > 10
      )
    `;
    
    // Test 3: Bounding box query
    const bboxQuery = `
      SELECT COUNT(*) as bbox_count
      FROM ${schemaName}.trails
      WHERE ST_Intersects(
        geometry, 
        ST_MakeEnvelope(-105.5, 39.9, -105.1, 40.2, 4326)
      )
    `;
    
    // Test 4: Elevation range query
    const elevationQuery = `
      SELECT COUNT(*) as elevation_count,
             AVG(avg_elevation) as avg_elevation
      FROM ${schemaName}.trails
      WHERE avg_elevation BETWEEN 1500 AND 2000
    `;
    
    const tests = [
      { name: 'Trail Summary Query', sql: trailQuery },
      { name: 'Spatial Intersection Query', sql: intersectionQuery },
      { name: 'Bounding Box Query', sql: bboxQuery },
      { name: 'Elevation Range Query', sql: elevationQuery }
    ];
    
    for (const test of tests) {
      const result = await this.benchmarkQuery(test.name, test.sql);
      this.results[test.name] = result;
    }
  }

  async runOptimizationTests() {
    console.log('\n🚀 Running optimization tests...');
    
    const schemaName = TEST_CONFIG.stagingSchema;
    
    // Test 1: Pre-computed intersection table
    console.log('Testing pre-computed intersection table...');
    await this.client.query(`
      CREATE TABLE ${schemaName}.trail_intersections AS
      SELECT 
        t1.app_uuid as trail1_uuid,
        t2.app_uuid as trail2_uuid,
        ST_Intersection(t1.geometry, t2.geometry) as intersection_geom
      FROM ${schemaName}.trails t1
      JOIN ${schemaName}.trails t2 ON (
        t1.app_uuid != t2.app_uuid 
        AND ST_Intersects(t1.geometry, t2.geometry)
        AND ST_Length(t1.geometry::geography) > 10
        AND ST_Length(t2.geometry::geography) > 10
      )
    `);
    
    await this.client.query(`
      CREATE INDEX idx_${schemaName}_intersections_geom 
      ON ${schemaName}.trail_intersections USING GIST(intersection_geom)
    `);
    
    const precomputedQuery = `
      SELECT COUNT(*) as precomputed_count
      FROM ${schemaName}.trail_intersections
      WHERE ST_GeometryType(intersection_geom) IN ('ST_Point', 'ST_MultiPoint')
    `;
    
    const precomputedResult = await this.benchmarkQuery('Pre-computed Intersections', precomputedQuery);
    this.results['Pre-computed Intersections'] = precomputedResult;
    
    // Test 2: Materialized view for common queries
    console.log('Testing materialized view...');
    await this.client.query(`
      CREATE MATERIALIZED VIEW ${schemaName}.trail_summary AS
      SELECT 
        region,
        trail_type,
        COUNT(*) as trail_count,
        AVG(length_km) as avg_length,
        SUM(length_km) as total_length,
        AVG(avg_elevation) as avg_elevation
      FROM ${schemaName}.trails
      GROUP BY region, trail_type
    `);
    
    await this.client.query(`
      CREATE INDEX idx_${schemaName}_summary_region 
      ON ${schemaName}.trail_summary(region)
    `);
    
    const materializedQuery = `
      SELECT * FROM ${schemaName}.trail_summary
      WHERE region = 'boulder'
    `;
    
    const materializedResult = await this.benchmarkQuery('Materialized View Query', materializedQuery);
    this.results['Materialized View Query'] = materializedResult;
    
    // Test 3: Partitioned table (simulated)
    console.log('Testing partitioned approach...');
    await this.client.query(`
      CREATE TABLE ${schemaName}.trails_partitioned (
        id UUID DEFAULT gen_random_uuid(),
        app_uuid TEXT,
        osm_id TEXT,
        name TEXT,
        region TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        source_tags JSONB,
        bbox_min_lng DOUBLE PRECISION,
        bbox_max_lng DOUBLE PRECISION,
        bbox_min_lat DOUBLE PRECISION,
        bbox_max_lat DOUBLE PRECISION,
        length_km DOUBLE PRECISION,
        elevation_gain DOUBLE PRECISION,
        elevation_loss DOUBLE PRECISION,
        max_elevation DOUBLE PRECISION,
        min_elevation DOUBLE PRECISION,
        avg_elevation DOUBLE PRECISION,
        source TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        geometry GEOMETRY(LINESTRINGZ, 4326)
      ) PARTITION BY RANGE (avg_elevation)
    `);
    
    await this.client.query(`
      CREATE TABLE ${schemaName}.trails_low_elevation 
      PARTITION OF ${schemaName}.trails_partitioned 
      FOR VALUES FROM (0) TO (1500)
    `);
    
    await this.client.query(`
      CREATE TABLE ${schemaName}.trails_high_elevation 
      PARTITION OF ${schemaName}.trails_partitioned 
      FOR VALUES FROM (1500) TO (9999)
    `);
    
    await this.client.query(`
      INSERT INTO ${schemaName}.trails_partitioned 
      SELECT * FROM ${schemaName}.trails
    `);
    
    const partitionedQuery = `
      SELECT COUNT(*) as partitioned_count
      FROM ${schemaName}.trails_partitioned
      WHERE avg_elevation BETWEEN 1500 AND 2000
    `;
    
    const partitionedResult = await this.benchmarkQuery('Partitioned Table Query', partitionedQuery);
    this.results['Partitioned Table Query'] = partitionedResult;
  }

  async analyzeQueryPlans() {
    console.log('\n🔍 Analyzing query execution plans...');
    
    const schemaName = TEST_CONFIG.stagingSchema;
    
    const queries = [
      {
        name: 'Trail Query with EXPLAIN',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) 
               SELECT COUNT(*) FROM ${schemaName}.trails WHERE region = 'boulder'`
      },
      {
        name: 'Intersection Query with EXPLAIN',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
               SELECT COUNT(*) FROM ${schemaName}.trails t1
               JOIN ${schemaName}.trails t2 ON ST_Intersects(t1.geometry, t2.geometry)
               WHERE t1.app_uuid != t2.app_uuid`
      }
    ];
    
    for (const query of queries) {
      console.log(`\n📋 ${query.name}:`);
      const result = await this.client.query(query.sql);
      console.log(JSON.stringify(result.rows[0]['QUERY PLAN'], null, 2));
    }
  }

  async generateReport() {
    console.log('\n📈 Performance Test Results');
    console.log('=' .repeat(50));
    
    const report = {
      testConfig: TEST_CONFIG,
      results: this.results,
      summary: {
        totalTests: Object.keys(this.results).length,
        fastestQuery: null,
        slowestQuery: null,
        averageTime: 0
      }
    };
    
    let totalTime = 0;
    let fastest = { name: '', time: Infinity };
    let slowest = { name: '', time: 0 };
    
    for (const [queryName, result] of Object.entries(this.results)) {
      console.log(`\n${queryName}:`);
      console.log(`  Average: ${result.avgTime.toFixed(2)}ms`);
      console.log(`  Range: ${result.minTime.toFixed(2)}ms - ${result.maxTime.toFixed(2)}ms`);
      console.log(`  Rows: ${result.rowCount}`);
      
      totalTime += result.avgTime;
      
      if (result.avgTime < fastest.time) {
        fastest = { name: queryName, time: result.avgTime };
      }
      
      if (result.avgTime > slowest.time) {
        slowest = { name: queryName, time: result.avgTime };
      }
    }
    
    report.summary.averageTime = totalTime / Object.keys(this.results).length;
    report.summary.fastestQuery = fastest;
    report.summary.slowestQuery = slowest;
    
    console.log('\n📊 Summary:');
    console.log(`  Total tests: ${report.summary.totalTests}`);
    console.log(`  Average time: ${report.summary.averageTime.toFixed(2)}ms`);
    console.log(`  Fastest: ${fastest.name} (${fastest.time.toFixed(2)}ms)`);
    console.log(`  Slowest: ${slowest.name} (${slowest.time.toFixed(2)}ms)`);
    
    // Save report to file
    const reportPath = path.join(__dirname, 'performance-test-results.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n💾 Detailed report saved to: ${reportPath}`);
    
    return report;
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test data...');
    const schemaName = TEST_CONFIG.stagingSchema;
    await this.client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    console.log('✅ Cleanup complete');
  }

  async run() {
    try {
      await this.connect();
      await this.createTestSchema();
      await this.createOptimizedIndexes();
      await this.loadTestData();
      
      await this.runBaselineTests();
      await this.runOptimizationTests();
      await this.analyzeQueryPlans();
      
      const report = await this.generateReport();
      
      console.log('\n🎯 Recommendations:');
      if (report.summary.slowestQuery.time > 100) {
        console.log('  ⚠️  Some queries are slow - consider adding more indexes');
      }
      if (report.results['Pre-computed Intersections']?.avgTime < report.results['Spatial Intersection Query']?.avgTime) {
        console.log('  ✅ Pre-computed intersections show promise');
      }
      if (report.results['Materialized View Query']?.avgTime < 10) {
        console.log('  ✅ Materialized views are effective for summary queries');
      }
      
    } catch (error) {
      console.error('❌ Test failed:', error);
    } finally {
      await this.cleanup();
      await this.disconnect();
    }
  }
}

// Run the test
if (require.main === module) {
  const tester = new PerformanceTester();
  tester.run().catch(console.error);
}

module.exports = PerformanceTester; 