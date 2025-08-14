#!/usr/bin/env ts-node

import { Pool } from 'pg';

// Test configuration
const TEST_SCHEMA = 'test_degree2_merge_bug';
const TEST_CONFIG = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'tester',
  password: process.env.PGPASSWORD || 'your_password_here'
};

async function testDegree2MergeBug() {
  console.log('🐛 Testing Degree-2 Merge Bug with Real Data');
  console.log('============================================');
  
  const pgClient = new Pool(TEST_CONFIG);
  
  try {
    // Step 1: Create test schema
    console.log('📋 Creating test schema...');
    await pgClient.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pgClient.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    
    // Step 2: Create tables
    console.log('📋 Creating test tables...');
    await pgClient.query(`
      CREATE TABLE ${TEST_SCHEMA}.ways_noded (
        id BIGINT PRIMARY KEY,
        source BIGINT,
        target BIGINT,
        the_geom GEOMETRY(LINESTRING, 4326),
        length_km NUMERIC,
        elevation_gain NUMERIC,
        elevation_loss NUMERIC,
        name TEXT,
        app_uuid TEXT,
        old_id BIGINT
      )
    `);
    
    await pgClient.query(`
      CREATE TABLE ${TEST_SCHEMA}.ways_noded_vertices_pgr (
        id BIGINT PRIMARY KEY,
        the_geom GEOMETRY(POINT, 4326),
        cnt INTEGER
      )
    `);
    
    // Step 3: Insert test data - the exact problematic case from user
    console.log('📋 Inserting test data...');
    
    // Insert vertices
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded_vertices_pgr (id, the_geom, cnt) VALUES
      (44, ST_GeomFromText('POINT(-105.267434 39.976661)', 4326), 1),
      (35, ST_GeomFromText('POINT(-105.276630268 39.97489484)', 4326), 2),
      (17, ST_GeomFromText('POINT(-105.283775 39.973602)', 4326), 1)
    `);
    
    // Insert edges - the exact data from user
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid) VALUES
      (916, 44, 35, ST_GeomFromText('LINESTRING(-105.267434 39.976661, -105.267549 39.97661, -105.267584 39.97652, -105.267488 39.975826, -105.26751 39.975484, -105.267497 39.975142, -105.267613 39.974988, -105.26787 39.974852, -105.268268 39.974734, -105.268724 39.974526, -105.269214 39.974074, -105.269424 39.973957, -105.269891 39.973487, -105.270008 39.973406, -105.270148 39.973351, -105.270382 39.973324, -105.271062 39.973484, -105.271168 39.973502, -105.271343 39.973493, -105.27153 39.973447, -105.272103 39.973203, -105.272606 39.973021, -105.272887 39.973021, -105.273532 39.973145, -105.274107 39.97363, -105.274518 39.973747, -105.274717 39.973827, -105.274917 39.973998, -105.27514 39.974241, -105.275258 39.97433, -105.275446 39.974429, -105.275985 39.974662, -105.276372 39.974778, -105.27663 39.974895)', 4326), 1.1252481604316273, 135, 2.759999990463257, 'NCAR - Bear Canyon Trail', '76650245-8959-475b-9527-40d86ffd2200'),
      (546, 35, 17, ST_GeomFromText('LINESTRING(-105.27663 39.974895, -105.277391 39.974848, -105.277813 39.974955, -105.278165 39.97499, -105.27888 39.97525, -105.279782 39.975185, -105.280215 39.97512, -105.280625 39.975156, -105.280976 39.975236, -105.281105 39.975235, -105.281292 39.975199, -105.281398 39.975226, -105.281598 39.975351, -105.281738 39.975333, -105.281901 39.975225, -105.282205 39.974926, -105.282497 39.974682, -105.283196 39.973951, -105.283593 39.973734, -105.283775 39.973602)', 4326), 0.7149166600315213, 38.59000015258789, 225.13999938964844, 'Mallory Cave Trail', '8f4446af-38fd-4a41-b489-ccb7a09a6055')
    `);
    
    // Step 4: Verify initial state
    console.log('📋 Verifying initial state...');
    const initialState = await pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${TEST_SCHEMA}.ways_noded) as edges,
        (SELECT COUNT(*) FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr) as vertices,
        (SELECT COUNT(*) FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr WHERE cnt = 2) as degree2_vertices
    `);
    
    console.log(`   Initial state: ${initialState.rows[0].edges} edges, ${initialState.rows[0].vertices} vertices, ${initialState.rows[0].degree2_vertices} degree-2 vertices`);
    
    // Step 5: Test the merge logic directly
    console.log('🔧 Testing merge logic...');
    
    // Find degree-2 vertices
    const degree2Vertices = await pgClient.query(`
      SELECT id, cnt as degree
      FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr
      WHERE cnt = 2
      ORDER BY id
    `);
    
    console.log(`   Found ${degree2Vertices.rows.length} degree-2 vertices:`, degree2Vertices.rows.map(v => `ID ${v.id} (degree ${v.degree})`));
    
    if (degree2Vertices.rows.length === 0) {
      console.log('   ❌ No degree-2 vertices found - this is the bug!');
      return;
    }
    
    // Test merging each degree-2 vertex
    for (const vertex of degree2Vertices.rows) {
      console.log(`   🔍 Testing merge for vertex ${vertex.id}...`);
      
      // Find edges connected to this vertex
      const edgesResult = await pgClient.query(`
        SELECT 
          e.id as edge_id,
          e.source, e.target,
          e.the_geom,
          e.length_km,
          e.elevation_gain,
          e.elevation_loss,
          e.name,
          e.app_uuid
        FROM ${TEST_SCHEMA}.ways_noded e
        WHERE e.source = $1 OR e.target = $1
        ORDER BY e.id
      `, [vertex.id]);
      
      console.log(`   Found ${edgesResult.rows.length} edges connected to vertex ${vertex.id}:`);
      edgesResult.rows.forEach(edge => {
        console.log(`     Edge ${edge.edge_id}: ${edge.source} -> ${edge.target} (${edge.name})`);
      });
      
      if (edgesResult.rows.length === 2) {
        console.log(`   ✅ Vertex ${vertex.id} has exactly 2 edges - should be mergeable`);
        
        // Test the actual merge
        const success = await testMergeEdgesAtDegree2Vertex(pgClient, TEST_SCHEMA, vertex.id);
        console.log(`   Merge result: ${success ? 'SUCCESS' : 'FAILED'}`);
        
        if (success) {
          // Verify the merge worked
          const finalState = await pgClient.query(`
            SELECT 
              (SELECT COUNT(*) FROM ${TEST_SCHEMA}.ways_noded) as edges,
              (SELECT COUNT(*) FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr) as vertices,
              (SELECT COUNT(*) FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr WHERE cnt = 2) as degree2_vertices
          `);
          
          console.log(`   Final state: ${finalState.rows[0].edges} edges, ${finalState.rows[0].vertices} vertices, ${finalState.rows[0].degree2_vertices} degree-2 vertices`);
          
          // Check if vertex 35 was removed
          const vertex35Exists = await pgClient.query(`
            SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr WHERE id = 35
          `);
          
          if (parseInt(vertex35Exists.rows[0].count) === 0) {
            console.log('   ✅ Vertex 35 was successfully removed');
          } else {
            console.log('   ❌ Vertex 35 still exists - merge failed');
          }
          
          // Check if edges 916 and 546 were replaced with a new edge
          const oldEdgesExist = await pgClient.query(`
            SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.ways_noded WHERE id IN (916, 546)
          `);
          
          if (parseInt(oldEdgesExist.rows[0].count) === 0) {
            console.log('   ✅ Original edges 916 and 546 were removed');
          } else {
            console.log('   ❌ Original edges still exist - merge failed');
          }
          
          // Check for new merged edge
          const newEdge = await pgClient.query(`
            SELECT id, source, target, length_km FROM ${TEST_SCHEMA}.ways_noded WHERE app_uuid LIKE 'merged-degree2-vertex-%'
          `);
          
          if (newEdge.rows.length > 0) {
            const edge = newEdge.rows[0];
            console.log(`   ✅ New merged edge created: ID ${edge.id}, ${edge.source} -> ${edge.target}, length: ${edge.length_km}`);
          } else {
            console.log('   ❌ No new merged edge found');
          }
        }
      } else {
        console.log(`   ❌ Vertex ${vertex.id} has ${edgesResult.rows.length} edges - cannot merge`);
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pgClient.end();
  }
}

async function testMergeEdgesAtDegree2Vertex(pgClient: Pool, schema: string, vertexId: number): Promise<boolean> {
  const client = await pgClient.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get the next available ID
    const maxIdResult = await client.query(`
      SELECT COALESCE(MAX(id), 0) as max_id FROM ${schema}.ways_noded
    `);
    const nextId = parseInt(maxIdResult.rows[0].max_id) + 1;
    
    // Find edges that connect to this degree-2 vertex
    const edgesResult = await client.query(`
      SELECT 
        e.id as edge_id,
        e.source, e.target,
        e.the_geom,
        e.length_km,
        e.elevation_gain,
        e.elevation_loss,
        e.name,
        e.app_uuid
      FROM ${schema}.ways_noded e
      WHERE e.source = $1 OR e.target = $1
      ORDER BY e.id
    `, [vertexId]);
    
    if (edgesResult.rows.length !== 2) {
      console.log(`     Expected 2 edges for vertex ${vertexId}, found ${edgesResult.rows.length}`);
      await client.query('ROLLBACK');
      return false;
    }
    
    const edge1 = edgesResult.rows[0];
    const edge2 = edgesResult.rows[1];
    
    // Determine the endpoints of the merged edge
    const allVertices = [edge1.source, edge1.target, edge2.source, edge2.target];
    const mergedEndpoints = allVertices.filter(v => v !== vertexId);
    
    if (mergedEndpoints.length !== 2) {
      console.log(`     Expected 2 endpoints for merged edge, found ${mergedEndpoints.length}`);
      await client.query('ROLLBACK');
      return false;
    }
    
    const newSource = mergedEndpoints[0];
    const newTarget = mergedEndpoints[1];
    
    // Create the merged edge
    const mergeResult = await client.query(`
      WITH merged_edge AS (
        SELECT 
          ST_LineMerge(ST_Union($1::geometry, $2::geometry)) as merged_geom,
          ($3::numeric + $4::numeric) as total_length,
          ($5::numeric + $6::numeric) as total_elevation_gain,
          ($7::numeric + $8::numeric) as total_elevation_loss,
          $9 as name
      )
      INSERT INTO ${schema}.ways_noded (
        id, source, target, the_geom, length_km, elevation_gain, elevation_loss,
        app_uuid, name, old_id
      )
      SELECT 
        $10, $11, $12, merged_geom, total_length, total_elevation_gain, total_elevation_loss,
        'merged-degree2-vertex-' || $13 || '-edges-' || $14 || '-' || $15 as app_uuid,
        name,
        NULL::bigint as old_id
      FROM merged_edge
      WHERE ST_IsValid(merged_geom) AND NOT ST_IsEmpty(merged_geom)
    `, [
      edge1.the_geom, edge2.the_geom,
      edge1.length_km || 0, edge2.length_km || 0,
      edge1.elevation_gain || 0, edge2.elevation_gain || 0,
      edge1.elevation_loss || 0, edge2.elevation_loss || 0,
      edge1.name || edge2.name,
      nextId, newSource, newTarget,
      vertexId,
      edge1.edge_id, edge2.edge_id
    ]);
    
    if (mergeResult.rowCount === 0) {
      console.log(`     Failed to create merged edge for vertex ${vertexId}`);
      await client.query('ROLLBACK');
      return false;
    }
    
    // Delete the original edges
    await client.query(`
      DELETE FROM ${schema}.ways_noded 
      WHERE id IN ($1, $2)
    `, [edge1.edge_id, edge2.edge_id]);
    
    // Remove the degree-2 vertex
    await client.query(`
      DELETE FROM ${schema}.ways_noded_vertices_pgr 
      WHERE id = $1
    `, [vertexId]);
    
    // Update vertex degrees for remaining vertices
    await client.query(`
      UPDATE ${schema}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${schema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);
    
    await client.query('COMMIT');
    return true;
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`     Error merging edges at vertex ${vertexId}:`, error);
    return false;
  } finally {
    client.release();
  }
}

// Run the test
testDegree2MergeBug().catch(console.error);
