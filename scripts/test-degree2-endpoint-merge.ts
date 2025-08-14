#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { EdgeProcessingService } from '../src/services/layer2/EdgeProcessingService';

const TEST_SCHEMA = 'test_degree2_merge';

async function testDegree2EndpointMerge() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || 'your_password_here'
  });

  try {
    console.log('🧪 Testing new degree-2 endpoint merge implementation...');
    console.log(`📊 Using database: ${process.env.PGDATABASE || 'trail_master_db'}`);
    console.log(`👤 Using user: ${process.env.PGUSER || 'tester'}`);
    
    // Create test schema
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    
    // Create test tables
    await pool.query(`
      CREATE TABLE ${TEST_SCHEMA}.ways_noded (
        id SERIAL PRIMARY KEY,
        source INTEGER,
        target INTEGER,
        the_geom GEOMETRY(LINESTRING, 4326),
        length_km DOUBLE PRECISION,
        elevation_gain DOUBLE PRECISION DEFAULT 0.0,
        elevation_loss DOUBLE PRECISION DEFAULT 0.0,
        app_uuid TEXT,
        name TEXT,
        old_id BIGINT
      )
    `);
    
    await pool.query(`
      CREATE TABLE ${TEST_SCHEMA}.ways_noded_vertices_pgr (
        id SERIAL PRIMARY KEY,
        the_geom GEOMETRY(POINT, 4326),
        cnt INTEGER DEFAULT 0
      )
    `);
    
    // Create spatial indexes
    await pool.query(`CREATE INDEX ON ${TEST_SCHEMA}.ways_noded USING GIST (the_geom)`);
    await pool.query(`CREATE INDEX ON ${TEST_SCHEMA}.ways_noded_vertices_pgr USING GIST (the_geom)`);
    
    // Insert test data: Create a network with both coincident and gapped degree-2 vertices
    console.log('📊 Creating test network with coincident and gapped degree-2 vertices...');
    
    // Create vertices - test both coincident and gapped scenarios
    await pool.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded_vertices_pgr (id, the_geom, cnt) VALUES
      -- Coincident case: vertices 1 and 2 share exact same coordinates
      (1, ST_GeomFromText('POINT(-105.276630268 39.97489484)', 4326), 1),  -- degree-1 endpoint
      (2, ST_GeomFromText('POINT(-105.276630268 39.97489484)', 4326), 2),  -- degree-2 (coincident with vertex 1)
      
      -- Gapped case: vertices 3 and 4 are close but not identical (within 0.5m)
      (3, ST_GeomFromText('POINT(-105.277391 39.974848)', 4326), 2),       -- degree-2
      (4, ST_GeomFromText('POINT(-105.2773915 39.9748485)', 4326), 2),     -- degree-2 (close to vertex 3, ~0.5m away)
      
      -- Endpoint vertices
      (5, ST_GeomFromText('POINT(-105.278165 39.97499)', 4326), 3),        -- degree-3 intersection
      (6, ST_GeomFromText('POINT(-105.279000 39.975000)', 4326), 1)        -- degree-1 endpoint
    `);
    
    // Create edges - test both scenarios
    await pool.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded (source, target, the_geom, length_km, name, app_uuid) VALUES
      -- Coincident case: edges 1-2 and 2-5 share vertex 2 at exact same coordinates
      (1, 2, ST_GeomFromText('LINESTRING(-105.276630268 39.97489484, -105.276630268 39.97489484)', 4326), 0.1, 'Coincident Trail 1', 'coincident-trail-1'),
      (2, 5, ST_GeomFromText('LINESTRING(-105.276630268 39.97489484, -105.278165 39.97499)', 4326), 0.2, 'Coincident Trail 2', 'coincident-trail-2'),
      
      -- Gapped case: edges 3-4 and 4-6 have vertices close but not identical
      (3, 4, ST_GeomFromText('LINESTRING(-105.277391 39.974848, -105.2773915 39.9748485)', 4326), 0.15, 'Gapped Trail 1', 'gapped-trail-1'),
      (4, 6, ST_GeomFromText('LINESTRING(-105.2773915 39.9748485, -105.279000 39.975000)', 4326), 0.25, 'Gapped Trail 2', 'gapped-trail-2'),
      
      -- Additional edges to make vertices 3 and 4 degree-2
      (3, 5, ST_GeomFromText('LINESTRING(-105.277391 39.974848, -105.278165 39.97499)', 4326), 0.3, 'Gapped Trail 3', 'gapped-trail-3'),
      (4, 5, ST_GeomFromText('LINESTRING(-105.2773915 39.9748485, -105.278165 39.97499)', 4326), 0.35, 'Gapped Trail 4', 'gapped-trail-4')
    `);
    
    // Show initial state
    console.log('\n📋 Initial network state:');
    const initialEdges = await pool.query(`SELECT id, source, target, name FROM ${TEST_SCHEMA}.ways_noded ORDER BY id`);
    console.log('Edges:', initialEdges.rows);
    
    const initialVertices = await pool.query(`SELECT id, cnt as degree FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr ORDER BY id`);
    console.log('Vertices:', initialVertices.rows);
    
    // Test the new degree-2 endpoint merge
    console.log('\n🔗 Testing degree-2 endpoint merge...');
    
    const edgeService = new EdgeProcessingService({
      stagingSchema: TEST_SCHEMA,
      pgClient: pool
    });
    
    // Call the private method using reflection (for testing)
    const mergeResult = await (edgeService as any).iterativeDegree2ChainMerge();
    
    console.log(`\n✅ Merge completed: ${mergeResult} pairs merged`);
    
    // Show final state
    console.log('\n📋 Final network state:');
    const finalEdges = await pool.query(`SELECT id, source, target, name, app_uuid FROM ${TEST_SCHEMA}.ways_noded ORDER BY id`);
    console.log('Edges:', finalEdges.rows);
    
    const finalVertices = await pool.query(`SELECT id, cnt as degree FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr ORDER BY id`);
    console.log('Vertices:', finalVertices.rows);
    
    // Verify results
    console.log('\n🔍 Verification:');
    
    // Check if degree-2 vertices were removed
    const remainingDegree2 = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr 
      WHERE cnt = 2
    `);
    console.log(`Remaining degree-2 vertices: ${remainingDegree2.rows[0].count}`);
    
    // Check if merged edges were created
    const mergedEdges = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ${TEST_SCHEMA}.ways_noded 
      WHERE app_uuid LIKE 'merged-degree2-pair-%'
    `);
    console.log(`Merged edges created: ${mergedEdges.rows[0].count}`);
    
    // Check specific merge scenarios
    const coincidentMerge = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ${TEST_SCHEMA}.ways_noded 
      WHERE app_uuid LIKE 'merged-degree2-pair-%' 
        AND (source = 1 OR target = 1 OR source = 5 OR target = 5)
    `);
    console.log(`Coincident merge (vertices 1-2): ${coincidentMerge.rows[0].count > 0 ? '✅ PASSED' : '❌ FAILED'}`);
    
    const gappedMerge = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ${TEST_SCHEMA}.ways_noded 
      WHERE app_uuid LIKE 'merged-degree2-pair-%' 
        AND (source = 3 OR target = 3 OR source = 6 OR target = 6)
    `);
    console.log(`Gapped merge (vertices 3-4): ${gappedMerge.rows[0].count > 0 ? '✅ PASSED' : '❌ FAILED'}`);
    
    // Check network connectivity
    const totalEdges = await pool.query(`SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.ways_noded`);
    const totalVertices = await pool.query(`SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr`);
    
    console.log(`Final network: ${totalEdges.rows[0].count} edges, ${totalVertices.rows[0].count} vertices`);
    
    // Overall test result
    const expectedMerges = 2; // Both coincident and gapped should merge
    if (remainingDegree2.rows[0].count === 0 && mergedEdges.rows[0].count >= expectedMerges) {
      console.log('✅ Test PASSED: Both coincident and gapped degree-2 vertices were successfully merged!');
    } else {
      console.log(`❌ Test FAILED: Expected ${expectedMerges} merges, got ${mergedEdges.rows[0].count}`);
    }
    
  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testDegree2EndpointMerge().catch(console.error);
