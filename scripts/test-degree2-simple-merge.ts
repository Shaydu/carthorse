#!/usr/bin/env ts-node

/**
 * Simple test to focus on the degree2 merge logic
 */

import { Pool } from 'pg';
import { mergeDegree2Chains } from '../src/utils/services/network-creation/merge-degree2-chains';

const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: ''
};

const TEST_SCHEMA = 'test_degree2_simple_merge_20241215';

async function testSimpleMerge() {
  console.log('🧪 Testing simple degree2 merge...');
  
  const pgClient = new Pool(DB_CONFIG);
  
  try {
    // Create test schema
    await pgClient.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pgClient.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    
    // Create simple test data: just the Marshall Mesa chain
    await pgClient.query(`
      CREATE TABLE ${TEST_SCHEMA}.ways_noded (
        id integer PRIMARY KEY,
        source integer,
        target integer,
        the_geom geometry(LineString,4326),
        length_km real,
        elevation_gain real,
        elevation_loss real,
        name text,
        app_uuid text,
        old_id bigint
      )
    `);
    
    await pgClient.query(`
      CREATE TABLE ${TEST_SCHEMA}.ways_noded_vertices_pgr (
        id bigint PRIMARY KEY,
        cnt integer,
        chk integer,
        ein integer,
        eout integer,
        the_geom geometry(Point,4326)
      )
    `);
    
    // Insert just the Marshall Mesa chain
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid, old_id) VALUES
      -- Edge 12: Marshall Mesa trail
      (12, 6, 19, ST_GeomFromText('LINESTRING(-105.227844 39.948591, -105.217581 39.954282)', 4326), 1.128, 47, 47, 'Marshall Mesa', 'marshall-mesa', NULL),
      
      -- Edge 19: Bridge connector
      (19, 19, 20, ST_GeomFromText('LINESTRING(-105.217581 39.954282, -105.217691 39.954359)', 4326), 0.013, 0, 0, 'bridge-extend', 'bridge-extend', NULL),
      
      -- Edge 13: Marshall Valley Trail
      (13, 10, 20, ST_GeomFromText('LINESTRING(-105.231126 39.951981, -105.217691 39.954359)', 4326), 1.307, 16, 16, 'Marshall Valley Trail', 'marshall-valley', NULL)
    `);
    
    // Create vertices
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded_vertices_pgr (id, cnt, chk, ein, eout, the_geom) VALUES
      (6, 1, 0, 0, 1, ST_GeomFromText('POINT(-105.227844 39.948591)', 4326)),
      (10, 1, 0, 0, 1, ST_GeomFromText('POINT(-105.231126 39.951981)', 4326)),
      (19, 2, 0, 1, 1, ST_GeomFromText('POINT(-105.217581 39.954282)', 4326)),
      (20, 2, 0, 1, 1, ST_GeomFromText('POINT(-105.217691 39.954359)', 4326))
    `);
    
    console.log('✅ Created test data');
    
    // Show before state
    console.log('\n📊 BEFORE:');
    const beforeEdges = await pgClient.query(`SELECT id, source, target, name FROM ${TEST_SCHEMA}.ways_noded ORDER BY id`);
    beforeEdges.rows.forEach(e => {
      console.log(`   Edge ${e.id}: ${e.source} → ${e.target} (${e.name})`);
    });
    
    // Run degree2 merge
    console.log('\n🔄 Running degree2 merge...');
    const result = await mergeDegree2Chains(pgClient, TEST_SCHEMA);
    console.log(`   Result: ${result.chainsMerged} chains merged`);
    
    // Show after state
    console.log('\n📊 AFTER:');
    const afterEdges = await pgClient.query(`SELECT id, source, target, name FROM ${TEST_SCHEMA}.ways_noded ORDER BY id`);
    afterEdges.rows.forEach(e => {
      console.log(`   Edge ${e.id}: ${e.source} → ${e.target} (${e.name})`);
    });
    
    // Check if any merged edges were created
    const mergedEdges = await pgClient.query(`
      SELECT id, source, target, name, app_uuid 
      FROM ${TEST_SCHEMA}.ways_noded 
      WHERE app_uuid LIKE 'merged-degree2-chain-%'
      ORDER BY id
    `);
    
    if (mergedEdges.rows.length > 0) {
      console.log('\n✅ Merged edges created:');
      mergedEdges.rows.forEach(e => {
        console.log(`   Edge ${e.id}: ${e.source} → ${e.target} (${e.name}) - ${e.app_uuid}`);
      });
    } else {
      console.log('\n❌ No merged edges created');
    }
    
    console.log('\n✅ Test completed!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testSimpleMerge();
