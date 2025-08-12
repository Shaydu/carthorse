#!/usr/bin/env ts-node

/**
 * Test bridging logic specifically
 */

import { Pool } from 'pg';

const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: ''
};

const TEST_SCHEMA = 'test_bridging_logic_20241215';

async function testBridgingLogic() {
  console.log('🧪 Testing bridging logic...');
  
  const pgClient = new Pool(DB_CONFIG);
  
  try {
    // Create test schema
    await pgClient.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pgClient.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    
    // Create test data based on the GeoJSON you provided
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
    
    // Insert the key edges from your data
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid, old_id) VALUES
      -- Edge 1: Coal Seam Trail (vertex 7 → vertex 30)
      (1, 7, 30, ST_GeomFromText('LINESTRING(-105.232534 39.950435, -105.232399 39.950355, -105.232288 39.950351, -105.232218 39.950308, -105.232196 39.950245, -105.232235 39.950179, -105.232272 39.950158, -105.232434 39.950119, -105.232508 39.950062, -105.232551 39.94997, -105.232587 39.949902, -105.232688 39.949853, -105.232708 39.949825, -105.232703 39.949738, -105.23272 39.949658, -105.232744 39.949599, -105.23278 39.949517, -105.232794 39.949444, -105.232894 39.949388, -105.232946 39.94933, -105.232981 39.949264, -105.233102 39.949217, -105.23317 39.949177, -105.233237 39.949115, -105.233272 39.949053, -105.233284 39.949012, -105.233293 39.948971, -105.233338 39.948941, -105.233452 39.948891, -105.2335 39.948834, -105.233568 39.94877, -105.23359 39.948691, -105.233583 39.948558, -105.233615 39.948501, -105.233798 39.94836, -105.233896 39.948296, -105.233958 39.948224, -105.234082 39.948099, -105.23415 39.948039, -105.234251 39.947889, -105.234283 39.947821, -105.234329 39.947783, -105.234382 39.947734, -105.234412 39.947694, -105.234415 39.947633, -105.234483 39.947567, -105.234594 39.947428, -105.234602 39.947336, -105.234636 39.947283, -105.234608 39.947192, -105.23463 39.947158, -105.234686 39.947148, -105.234788 39.947112, -105.234891 39.946996, -105.234997 39.946882, -105.235048 39.946737, -105.235156 39.946665, -105.235384 39.946611, -105.235478 39.946573, -105.235572 39.946514, -105.235623 39.946468, -105.235707 39.946424, -105.235897 39.946366, -105.236134 39.946341, -105.236228 39.946312, -105.236297 39.946266, -105.236343 39.946148)', 4326), 0.662, 43.68, 43.68, 'Coal Seam Trail', 'coal-seam', NULL),
      
      -- Edge 2: Coal Seam Trail (vertex 10 → vertex 26)
      (2, 10, 26, ST_GeomFromText('LINESTRING(-105.231126 39.951981, -105.231211 39.95195, -105.23134 39.951817, -105.231395 39.95173, -105.231506 39.951694, -105.231608 39.951603, -105.231667 39.951508, -105.231864 39.951376, -105.232204 39.95085, -105.232422 39.950673, -105.23255 39.950527, -105.232558 39.950481, -105.232534 39.950435)', 4326), 0.217, 5.36, 5.36, 'Coal Seam Trail', 'coal-seam', NULL),
      
      -- Edge 4: Community Ditch Trail (vertex 14 → vertex 29)
      (4, 14, 29, ST_GeomFromText('LINESTRING(-105.25673 39.931931, -105.256503 39.931704, -105.256153 39.931428, -105.256088 39.931392, -105.255993 39.931362, -105.255857 39.931358, -105.255739 39.931391, -105.255655 39.931437, -105.255368 39.93174, -105.255054 39.931999, -105.254954 39.932108, -105.254326 39.93309, -105.253975 39.933553, -105.253782 39.93384, -105.253566 39.934094, -105.253141 39.934506, -105.252958 39.934642, -105.252786 39.934734, -105.252543 39.934821, -105.251947 39.934993, -105.251331 39.9352, -105.25072 39.935327, -105.250331 39.935256, -105.249595 39.935184, -105.249358 39.935145, -105.249171 39.9351, -105.248078 39.934758, -105.247943 39.934739, -105.247752 39.934765, -105.247652 39.934811, -105.247507 39.934925, -105.247437 39.935017, -105.24737 39.935233, -105.247351 39.935464, -105.247282 39.935633, -105.247177 39.935739, -105.246874 39.935934, -105.246804 39.936004, -105.24672 39.936142, -105.24654 39.936546, -105.246451 39.936681, -105.246386 39.936743, -105.246266 39.936813, -105.246064 39.93688, -105.245905 39.936905, -105.24572 39.936912, -105.245047 39.936867, -105.244716 39.936827, -105.244218 39.936689, -105.244071 39.936694, -105.243945 39.936754, -105.243848 39.936853, -105.243635 39.937169, -105.243529 39.937297, -105.243393 39.937407, -105.243065 39.937591, -105.242853 39.937663, -105.242094 39.937776, -105.241838 39.937784, -105.241667 39.937763, -105.241364 39.937673, -105.241195 39.937645, -105.241011 39.937649, -105.240275 39.937761, -105.240068 39.937815, -105.239875 39.937899, -105.2397 39.938016, -105.239575 39.938121, -105.239432 39.938284, -105.23939 39.938366, -105.23937 39.938498, -105.239381 39.938596, -105.239429 39.938741, -105.239729 39.939339, -105.239773 39.939486, -105.239761 39.93959, -105.239723 39.939665, -105.239627 39.939763, -105.239464 39.939828, -105.23928 39.939843, -105.238419 39.93975, -105.238226 39.939763, -105.238111 39.939803, -105.238041 39.93985, -105.237442 39.940488, -105.23734 39.940628, -105.237234 39.941008, -105.237166 39.941131, -105.237027 39.941308, -105.23658 39.94176, -105.236476 39.9419, -105.236426 39.942008, -105.236407 39.942149, -105.236452 39.942567, -105.23645 39.942747, -105.236286 39.943488, -105.23626 39.94371, -105.236259 39.943935, -105.236292 39.944064, -105.23648 39.944389, -105.23663 39.944856, -105.236672 39.945105, -105.236675 39.945267, -105.236601 39.94537)', 4326), 2.934, 12.58, 12.58, 'Community Ditch Trail', 'community-ditch', NULL)
    `);
    
    // Create vertices with correct degrees
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded_vertices_pgr (id, cnt, chk, ein, eout, the_geom) VALUES
      (7, 1, 0, 0, 1, ST_GeomFromText('POINT(-105.232534 39.950435)', 4326)),
      (10, 4, 0, 2, 2, ST_GeomFromText('POINT(-105.231126 39.951981)', 4326)),
      (14, 1, 0, 0, 1, ST_GeomFromText('POINT(-105.25673 39.931931)', 4326)),
      (26, 1, 0, 0, 1, ST_GeomFromText('POINT(-105.232534 39.950435)', 4326)),
      (29, 1, 0, 0, 1, ST_GeomFromText('POINT(-105.236601 39.94537)', 4326)),
      (30, 2, 0, 1, 1, ST_GeomFromText('POINT(-105.236343 39.946148)', 4326))
    `);
    
    console.log('✅ Created test data');
    
    // Show before state
    console.log('\n📊 BEFORE BRIDGING:');
    const beforeEdges = await pgClient.query(`SELECT id, source, target, name FROM ${TEST_SCHEMA}.ways_noded ORDER BY id`);
    beforeEdges.rows.forEach(e => {
      console.log(`   Edge ${e.id}: ${e.source} → ${e.target} (${e.name})`);
    });
    
    const beforeVertices = await pgClient.query(`SELECT id, cnt, ST_AsText(the_geom) as geom FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr ORDER BY id`);
    beforeVertices.rows.forEach(v => {
      console.log(`   Vertex ${v.id}: degree-${v.cnt} at ${v.geom}`);
    });
    
    // Test the gap midpoint bridging logic
    console.log('\n🔗 Testing gap midpoint bridging...');
    
    // Import the bridging function
    const { runGapMidpointBridging } = await import('../src/utils/services/network-creation/gap-midpoint-bridging');
    
    const bridgingResult = await runGapMidpointBridging(pgClient, TEST_SCHEMA, 100.0); // 100 meter tolerance
    console.log(`   Bridging result: ${bridgingResult.bridgesInserted} bridges inserted`);
    
    // Show after state
    console.log('\n📊 AFTER BRIDGING:');
    const afterEdges = await pgClient.query(`SELECT id, source, target, name FROM ${TEST_SCHEMA}.ways_noded ORDER BY id`);
    afterEdges.rows.forEach(e => {
      console.log(`   Edge ${e.id}: ${e.source} → ${e.target} (${e.name})`);
    });
    
    const afterVertices = await pgClient.query(`SELECT id, cnt, ST_AsText(the_geom) as geom FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr ORDER BY id`);
    afterVertices.rows.forEach(v => {
      console.log(`   Vertex ${v.id}: degree-${v.cnt} at ${v.geom}`);
    });
    
    // Check if vertex 30 became degree-3 (which would make it a valid endpoint for degree-2 merging)
    const vertex30 = afterVertices.rows.find(v => v.id === 30);
    if (vertex30) {
      console.log(`\n🎯 Vertex 30 degree: ${vertex30.cnt} (should be 3 for valid degree-2 merge endpoint)`);
    }
    
    // Calculate distance between vertex 29 and vertex 30
    const distanceResult = await pgClient.query(`
      SELECT 
        ST_Distance(
          (SELECT the_geom FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr WHERE id = 29),
          (SELECT the_geom FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr WHERE id = 30)
        ) * 111320 as distance_meters
    `);
    const distanceMeters = distanceResult.rows[0].distance_meters;
    console.log(`\n📏 Distance between vertex 29 and vertex 30: ${distanceMeters.toFixed(2)} meters`);
    console.log(`📏 Tolerance: 5.0 meters`);
    console.log(`🔗 Should bridge: ${distanceMeters <= 5.0 ? 'YES' : 'NO'}`);
    
    console.log('\n✅ Bridging test completed!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testBridgingLogic();
