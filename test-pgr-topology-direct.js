#!/usr/bin/env node

const { Pool } = require('pg');

// Database configuration
const dbConfig = {
  database: 'trail_master_db',
  user: 'shaydu',
  host: 'localhost',
  port: 5432,
};

const STAGING_SCHEMA = 'carthorse_1755964844744';

async function testPgrTopologyDirect() {
  const pool = new Pool(dbConfig);
  
  try {
    console.log('🔍 Testing pgr_createTopology approach directly...');
    
    // Step 1: Create ways table from trail data (same as working commit)
    console.log('📊 Step 1: Creating ways table from trail data...');
    await pool.query(`DROP VIEW IF EXISTS ${STAGING_SCHEMA}.ways CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways CASCADE`);
    await pool.query(`
      CREATE TABLE ${STAGING_SCHEMA}.ways AS
      SELECT 
        ROW_NUMBER() OVER (ORDER BY id) as id,
        app_uuid,  -- Sidecar data for metadata lookup
        name,
        length_km,
        elevation_gain,
        elevation_loss,
        CASE 
          WHEN ST_IsSimple(geometry) THEN ST_Force2D(geometry)
          ELSE ST_Force2D(ST_MakeValid(geometry))
        END as the_geom
      FROM ${STAGING_SCHEMA}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
    
    const waysCount = await pool.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.ways`);
    console.log(`✅ Created ways table with ${waysCount.rows[0].count} rows from trail data`);

    // Step 2: Prepare 2D, valid, simple input (same as working commit)
    console.log('🔧 Step 2: Preparing 2D, valid, simple input...');
    await pool.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_2d`);
    await pool.query(`
      CREATE TABLE ${STAGING_SCHEMA}.ways_2d AS
      SELECT id AS old_id, ST_Force2D(the_geom) AS geom, app_uuid, name, length_km, elevation_gain, elevation_loss
      FROM ${STAGING_SCHEMA}.ways
      WHERE the_geom IS NOT NULL AND ST_IsValid(the_geom)
    `);
    
    const ways2dCount = await pool.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.ways_2d`);
    console.log(`📊 Created ways_2d table with ${ways2dCount.rows[0].count} rows`);

    // Step 3: Create ways_split directly from the already-split trails (same as working commit)
    console.log('🔗 Step 3: Creating ways_split from trail data...');
    await pool.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_split CASCADE`);
    await pool.query(`
      CREATE TABLE ${STAGING_SCHEMA}.ways_split AS
      SELECT 
        geom as the_geom,
        old_id,
        app_uuid,
        name,
        length_km,
        elevation_gain,
        elevation_loss
      FROM ${STAGING_SCHEMA}.ways_2d
      WHERE geom IS NOT NULL AND ST_NumPoints(geom) > 1
    `);
    
    // Add required columns for pgRouting
    await pool.query(`ALTER TABLE ${STAGING_SCHEMA}.ways_split ADD COLUMN id serial PRIMARY KEY`);
    await pool.query(`ALTER TABLE ${STAGING_SCHEMA}.ways_split ADD COLUMN source integer`);
    await pool.query(`ALTER TABLE ${STAGING_SCHEMA}.ways_split ADD COLUMN target integer`);
    
    // Step 4: Use pgRouting to create topology (same as working commit)
    console.log('🔧 Step 4: Creating topology with pgr_createTopology...');
    const topologyResult = await pool.query(`
      SELECT pgr_createTopology('${STAGING_SCHEMA}.ways_split', 0.00001, 'the_geom', 'id')
    `);
    console.log(`   ✅ pgr_createTopology result: ${topologyResult.rows[0].pgr_createtopology}`);
    
    // Step 5: Create ways_noded from the split and topologized table (same as working commit)
    console.log('🛤️ Step 5: Creating ways_noded from topology...');
    await pool.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_noded CASCADE`);
    await pool.query(`
      CREATE TABLE ${STAGING_SCHEMA}.ways_noded AS
      SELECT 
        id,
        the_geom,
        length_km,
        app_uuid,
        name,
        elevation_gain,
        elevation_loss,
        old_id,
        1 AS sub_id,
        source,
        target,
        length_km as cost,
        length_km as reverse_cost
      FROM ${STAGING_SCHEMA}.ways_split
      WHERE source IS NOT NULL AND target IS NOT NULL
    `);

    const edgesCount = await pool.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.ways_noded`);
    console.log(`🛤️ Created ${edgesCount.rows[0].count} edges`);

    // Step 6: Create vertices table from pgRouting topology (same as working commit)
    console.log('📍 Step 6: Creating vertices table from pgRouting topology...');
    await pool.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_noded_vertices_pgr`);
    await pool.query(`
      CREATE TABLE ${STAGING_SCHEMA}.ways_noded_vertices_pgr AS
      SELECT 
        id,
        the_geom,
        ST_X(the_geom) as x,
        ST_Y(the_geom) as y,
        0 as cnt,  -- Will be calculated below
        0 as chk,
        0 as ein,
        0 as eout
      FROM ${STAGING_SCHEMA}.ways_split_vertices_pgr
      ORDER BY id
    `);

    // Step 7: Calculate vertex degrees
    console.log('🔗 Step 7: Calculating vertex degrees...');
    await pool.query(`
      UPDATE ${STAGING_SCHEMA}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*)
        FROM ${STAGING_SCHEMA}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);

    const degreeDistribution = await pool.query(`
      SELECT cnt as degree, COUNT(*) as node_count
      FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    
    console.log('📊 Vertex degree distribution:');
    degreeDistribution.rows.forEach(row => {
      console.log(`   - Degree ${row.degree}: ${row.node_count} nodes`);
    });

    // Now test if we can find Bear Canyon cycles
    console.log('\n🔍 Testing Bear Canyon loop detection...');
    
    const BEAR_CANYON_NODES = [356, 357, 332, 336, 333, 339];
    
    const hawickResult = await pool.query(`
      SELECT 
        path_id,
        seq,
        path_seq,
        node,
        edge,
        cost,
        agg_cost
      FROM pgr_hawickcircuits(
        'SELECT 
          id, 
          source, 
          target, 
          cost,
          reverse_cost
         FROM ${STAGING_SCHEMA}.ways_noded
         WHERE source IS NOT NULL 
           AND target IS NOT NULL 
           AND cost <= 5.0
         ORDER BY id'
      )
      ORDER BY path_id, path_seq
      LIMIT 10000
    `);
    
    console.log(`✅ Found ${hawickResult.rows.length} total edges in Hawick Circuits`);
    
    // Group by cycle
    const cycleGroups = new Map();
    hawickResult.rows.forEach(row => {
      if (!cycleGroups.has(row.path_id)) {
        cycleGroups.set(row.path_id, []);
      }
      cycleGroups.get(row.path_id).push(row);
    });
    
    console.log(`✅ Found ${cycleGroups.size} total cycles`);
    
    // Check for Bear Canyon cycles
    let bearCanyonCycles = 0;
    for (const [pathId, cycleEdges] of cycleGroups) {
      const cycleNodes = new Set(cycleEdges.map(edge => edge.node));
      const bearCanyonNodeCount = BEAR_CANYON_NODES.filter(node => cycleNodes.has(node)).length;
      
      if (bearCanyonNodeCount >= 3) {
        bearCanyonCycles++;
        const totalDistance = Math.max(...cycleEdges.map(edge => edge.agg_cost));
        console.log(`   🐻 Bear Canyon cycle ${pathId}: ${bearCanyonNodeCount}/6 nodes, ${totalDistance.toFixed(2)}km`);
      }
    }
    
    console.log(`🎯 Found ${bearCanyonCycles} cycles containing Bear Canyon nodes!`);
    
    if (bearCanyonCycles > 0) {
      console.log('✅ SUCCESS: Bear Canyon loop detection is working with pgr_createTopology!');
    } else {
      console.log('❌ Still no Bear Canyon cycles found');
      
      // Let's also check what cycles are being found
      console.log('\n📊 Sample of cycles found:');
      let cycleCount = 0;
      for (const [pathId, cycleEdges] of cycleGroups) {
        if (cycleCount >= 5) break;
        
        const totalDistance = Math.max(...cycleEdges.map(edge => edge.agg_cost));
        const nodeCount = new Set(cycleEdges.map(edge => edge.node)).size;
        const edgeCount = cycleEdges.length;
        
        console.log(`   Cycle ${pathId}: ${nodeCount} nodes, ${edgeCount} edges, ${totalDistance.toFixed(2)}km`);
        
        // Show first few nodes in the cycle
        const nodes = cycleEdges.map(edge => edge.node).slice(0, 5);
        console.log(`     Nodes: ${nodes.join(' → ')}...`);
        
        cycleCount++;
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

testPgrTopologyDirect();

const { Pool } = require('pg');

// Database configuration
const dbConfig = {
  database: 'trail_master_db',
  user: 'shaydu',
  host: 'localhost',
  port: 5432,
};

const STAGING_SCHEMA = 'carthorse_1755964844744';

async function testPgrTopologyDirect() {
  const pool = new Pool(dbConfig);
  
  try {
    console.log('🔍 Testing pgr_createTopology approach directly...');
    
    // Step 1: Create ways table from trail data (same as working commit)
    console.log('📊 Step 1: Creating ways table from trail data...');
    await pool.query(`DROP VIEW IF EXISTS ${STAGING_SCHEMA}.ways CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways CASCADE`);
    await pool.query(`
      CREATE TABLE ${STAGING_SCHEMA}.ways AS
      SELECT 
        ROW_NUMBER() OVER (ORDER BY id) as id,
        app_uuid,  -- Sidecar data for metadata lookup
        name,
        length_km,
        elevation_gain,
        elevation_loss,
        CASE 
          WHEN ST_IsSimple(geometry) THEN ST_Force2D(geometry)
          ELSE ST_Force2D(ST_MakeValid(geometry))
        END as the_geom
      FROM ${STAGING_SCHEMA}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
    
    const waysCount = await pool.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.ways`);
    console.log(`✅ Created ways table with ${waysCount.rows[0].count} rows from trail data`);

    // Step 2: Prepare 2D, valid, simple input (same as working commit)
    console.log('🔧 Step 2: Preparing 2D, valid, simple input...');
    await pool.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_2d`);
    await pool.query(`
      CREATE TABLE ${STAGING_SCHEMA}.ways_2d AS
      SELECT id AS old_id, ST_Force2D(the_geom) AS geom, app_uuid, name, length_km, elevation_gain, elevation_loss
      FROM ${STAGING_SCHEMA}.ways
      WHERE the_geom IS NOT NULL AND ST_IsValid(the_geom)
    `);
    
    const ways2dCount = await pool.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.ways_2d`);
    console.log(`📊 Created ways_2d table with ${ways2dCount.rows[0].count} rows`);

    // Step 3: Create ways_split directly from the already-split trails (same as working commit)
    console.log('🔗 Step 3: Creating ways_split from trail data...');
    await pool.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_split CASCADE`);
    await pool.query(`
      CREATE TABLE ${STAGING_SCHEMA}.ways_split AS
      SELECT 
        geom as the_geom,
        old_id,
        app_uuid,
        name,
        length_km,
        elevation_gain,
        elevation_loss
      FROM ${STAGING_SCHEMA}.ways_2d
      WHERE geom IS NOT NULL AND ST_NumPoints(geom) > 1
    `);
    
    // Add required columns for pgRouting
    await pool.query(`ALTER TABLE ${STAGING_SCHEMA}.ways_split ADD COLUMN id serial PRIMARY KEY`);
    await pool.query(`ALTER TABLE ${STAGING_SCHEMA}.ways_split ADD COLUMN source integer`);
    await pool.query(`ALTER TABLE ${STAGING_SCHEMA}.ways_split ADD COLUMN target integer`);
    
    // Step 4: Use pgRouting to create topology (same as working commit)
    console.log('🔧 Step 4: Creating topology with pgr_createTopology...');
    const topologyResult = await pool.query(`
      SELECT pgr_createTopology('${STAGING_SCHEMA}.ways_split', 0.00001, 'the_geom', 'id')
    `);
    console.log(`   ✅ pgr_createTopology result: ${topologyResult.rows[0].pgr_createtopology}`);
    
    // Step 5: Create ways_noded from the split and topologized table (same as working commit)
    console.log('🛤️ Step 5: Creating ways_noded from topology...');
    await pool.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_noded CASCADE`);
    await pool.query(`
      CREATE TABLE ${STAGING_SCHEMA}.ways_noded AS
      SELECT 
        id,
        the_geom,
        length_km,
        app_uuid,
        name,
        elevation_gain,
        elevation_loss,
        old_id,
        1 AS sub_id,
        source,
        target,
        length_km as cost,
        length_km as reverse_cost
      FROM ${STAGING_SCHEMA}.ways_split
      WHERE source IS NOT NULL AND target IS NOT NULL
    `);

    const edgesCount = await pool.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.ways_noded`);
    console.log(`🛤️ Created ${edgesCount.rows[0].count} edges`);

    // Step 6: Create vertices table from pgRouting topology (same as working commit)
    console.log('📍 Step 6: Creating vertices table from pgRouting topology...');
    await pool.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_noded_vertices_pgr`);
    await pool.query(`
      CREATE TABLE ${STAGING_SCHEMA}.ways_noded_vertices_pgr AS
      SELECT 
        id,
        the_geom,
        ST_X(the_geom) as x,
        ST_Y(the_geom) as y,
        0 as cnt,  -- Will be calculated below
        0 as chk,
        0 as ein,
        0 as eout
      FROM ${STAGING_SCHEMA}.ways_split_vertices_pgr
      ORDER BY id
    `);

    // Step 7: Calculate vertex degrees
    console.log('🔗 Step 7: Calculating vertex degrees...');
    await pool.query(`
      UPDATE ${STAGING_SCHEMA}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*)
        FROM ${STAGING_SCHEMA}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);

    const degreeDistribution = await pool.query(`
      SELECT cnt as degree, COUNT(*) as node_count
      FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    
    console.log('📊 Vertex degree distribution:');
    degreeDistribution.rows.forEach(row => {
      console.log(`   - Degree ${row.degree}: ${row.node_count} nodes`);
    });

    // Now test if we can find Bear Canyon cycles
    console.log('\n🔍 Testing Bear Canyon loop detection...');
    
    const BEAR_CANYON_NODES = [356, 357, 332, 336, 333, 339];
    
    const hawickResult = await pool.query(`
      SELECT 
        path_id,
        seq,
        path_seq,
        node,
        edge,
        cost,
        agg_cost
      FROM pgr_hawickcircuits(
        'SELECT 
          id, 
          source, 
          target, 
          cost,
          reverse_cost
         FROM ${STAGING_SCHEMA}.ways_noded
         WHERE source IS NOT NULL 
           AND target IS NOT NULL 
           AND cost <= 5.0
         ORDER BY id'
      )
      ORDER BY path_id, path_seq
      LIMIT 10000
    `);
    
    console.log(`✅ Found ${hawickResult.rows.length} total edges in Hawick Circuits`);
    
    // Group by cycle
    const cycleGroups = new Map();
    hawickResult.rows.forEach(row => {
      if (!cycleGroups.has(row.path_id)) {
        cycleGroups.set(row.path_id, []);
      }
      cycleGroups.get(row.path_id).push(row);
    });
    
    console.log(`✅ Found ${cycleGroups.size} total cycles`);
    
    // Check for Bear Canyon cycles
    let bearCanyonCycles = 0;
    for (const [pathId, cycleEdges] of cycleGroups) {
      const cycleNodes = new Set(cycleEdges.map(edge => edge.node));
      const bearCanyonNodeCount = BEAR_CANYON_NODES.filter(node => cycleNodes.has(node)).length;
      
      if (bearCanyonNodeCount >= 3) {
        bearCanyonCycles++;
        const totalDistance = Math.max(...cycleEdges.map(edge => edge.agg_cost));
        console.log(`   🐻 Bear Canyon cycle ${pathId}: ${bearCanyonNodeCount}/6 nodes, ${totalDistance.toFixed(2)}km`);
      }
    }
    
    console.log(`🎯 Found ${bearCanyonCycles} cycles containing Bear Canyon nodes!`);
    
    if (bearCanyonCycles > 0) {
      console.log('✅ SUCCESS: Bear Canyon loop detection is working with pgr_createTopology!');
    } else {
      console.log('❌ Still no Bear Canyon cycles found');
      
      // Let's also check what cycles are being found
      console.log('\n📊 Sample of cycles found:');
      let cycleCount = 0;
      for (const [pathId, cycleEdges] of cycleGroups) {
        if (cycleCount >= 5) break;
        
        const totalDistance = Math.max(...cycleEdges.map(edge => edge.agg_cost));
        const nodeCount = new Set(cycleEdges.map(edge => edge.node)).size;
        const edgeCount = cycleEdges.length;
        
        console.log(`   Cycle ${pathId}: ${nodeCount} nodes, ${edgeCount} edges, ${totalDistance.toFixed(2)}km`);
        
        // Show first few nodes in the cycle
        const nodes = cycleEdges.map(edge => edge.node).slice(0, 5);
        console.log(`     Nodes: ${nodes.join(' → ')}...`);
        
        cycleCount++;
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

testPgrTopologyDirect();
