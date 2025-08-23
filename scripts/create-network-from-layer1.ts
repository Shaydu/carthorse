#!/usr/bin/env ts-node

import { Pool } from 'pg';

async function createNetworkFromLayer1() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    console.log('🔄 Creating new network from Layer 1 trail data...');
    
    // Create a new staging schema for this test
    const timestamp = Date.now();
    const stagingSchema = `carthorse_layer1_test_${timestamp}`;
    
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Create the staging schema
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
    
    // Copy Layer 1 trails to the new schema
    console.log('📋 Copying Layer 1 trails to new schema...');
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.trails AS
      SELECT * FROM carthorse_1755975294381.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
    
    const trailCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
    console.log(`✅ Copied ${trailCount.rows[0].count} trails to ${stagingSchema}`);
    
    // Add source and target columns required by pgRouting (as integers)
    console.log('🔧 Adding pgRouting required columns...');
    await pgClient.query(`
      ALTER TABLE ${stagingSchema}.trails 
      DROP COLUMN IF EXISTS source,
      DROP COLUMN IF EXISTS target,
      ADD COLUMN source INTEGER,
      ADD COLUMN target INTEGER
    `);
    
    // Use pgr_createTopology to detect intersections and create nodes/edges
    console.log('🔧 Creating topology with pgr_createTopology...');
    const topologyResult = await pgClient.query(`
      SELECT pgr_createTopology('${stagingSchema}.trails', 0.00001, 'geometry', 'id')
    `);
    console.log(`✅ pgr_createTopology result: ${topologyResult.rows[0].pgr_createtopology}`);
    
    // Check if topology creation was successful
    if (topologyResult.rows[0].pgr_createtopology === 'FAIL') {
      console.log('⚠️ pgr_createTopology failed, creating manual topology...');
      
      // Create vertices manually from trail endpoints
      console.log('🔧 Creating vertices manually from trail endpoints...');
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
        WITH all_points AS (
          SELECT 
            ROW_NUMBER() OVER (ORDER BY point) as id,
            point as the_geom,
            ST_X(point) as x,
            ST_Y(point) as y,
            ST_Z(point) as z,
            COUNT(*) as cnt
          FROM (
            SELECT ST_StartPoint(geometry) as point FROM ${stagingSchema}.trails WHERE geometry IS NOT NULL
            UNION ALL
            SELECT ST_EndPoint(geometry) as point FROM ${stagingSchema}.trails WHERE geometry IS NOT NULL
          ) points
          GROUP BY point
        )
        SELECT * FROM all_points
      `);
      
      // Create ways_noded with manual source/target assignment
      console.log('🛤️ Creating ways_noded with manual topology...');
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded AS
        SELECT 
          t.id,
          t.geometry as the_geom,
          t.length_km,
          t.app_uuid,
          t.name,
          t.elevation_gain,
          t.elevation_loss,
          -- Find closest vertices for source and target
          (SELECT v.id FROM ${stagingSchema}.ways_noded_vertices_pgr v 
           ORDER BY ST_Distance(ST_StartPoint(t.geometry), v.the_geom) 
           LIMIT 1) as source,
          (SELECT v.id FROM ${stagingSchema}.ways_noded_vertices_pgr v 
           ORDER BY ST_Distance(ST_EndPoint(t.geometry), v.the_geom) 
           LIMIT 1) as target,
          -- Add cost and reverse_cost for bidirectional routing
          COALESCE(t.length_km, 0.1) as cost,
          COALESCE(t.length_km, 0.1) as reverse_cost
        FROM ${stagingSchema}.trails t
        WHERE t.geometry IS NOT NULL AND ST_NumPoints(t.geometry) > 1
      `);
    } else {
      // Create ways_noded from the topologized trails
      console.log('🛤️ Creating ways_noded from topologized trails...');
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded AS
        SELECT 
          id,
          geometry as the_geom,
          length_km,
          app_uuid,
          name,
          elevation_gain,
          elevation_loss,
          source,
          target,
          -- Add cost and reverse_cost for bidirectional routing
          COALESCE(length_km, 0.1) as cost,
          COALESCE(length_km, 0.1) as reverse_cost
        FROM ${stagingSchema}.trails
        WHERE geometry IS NOT NULL AND ST_NumPoints(geometry) > 1
          AND source IS NOT NULL AND target IS NOT NULL
          AND source::text != target::text
      `);
      
      // Create vertices table
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
        SELECT * FROM ${stagingSchema}.trails_vertices_pgr
      `);
    }
    
    // Add indexes
    await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_ways_noded_geom ON ${stagingSchema}.ways_noded USING GIST(the_geom)`);
    await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_ways_noded_source ON ${stagingSchema}.ways_noded(source)`);
    await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_ways_noded_target ON ${stagingSchema}.ways_noded(target)`);
    
    // Get network stats
    const edges = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded`);
    const nodes = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded_vertices_pgr`);
    
    console.log(`📊 Network created: ${edges.rows[0].count} edges, ${nodes.rows[0].count} nodes`);
    
    // Check for Bear Canyon loop components
    console.log('🔍 Checking Bear Canyon loop components...');
    const bearCanyonEdges = await pgClient.query(`
      SELECT id, source, target, name, length_km 
      FROM ${stagingSchema}.ways_noded 
      WHERE name ILIKE '%bear%' OR name ILIKE '%fern%' OR name ILIKE '%mesa%'
      ORDER BY name
    `);
    
    console.log(`📋 Found ${bearCanyonEdges.rows.length} Bear Canyon related edges:`);
    bearCanyonEdges.rows.forEach(edge => {
      console.log(`  - ${edge.name}: ${edge.source} → ${edge.target} (${edge.length_km.toFixed(2)}km)`);
    });
    
    // Test loop detection with pgr_hawickcircuits
    console.log('🔄 Testing loop detection with pgr_hawickcircuits...');
    const loops = await pgClient.query(`
      SELECT 
        path_id,
        path_seq,
        node,
        edge,
        cost,
        agg_cost
      FROM pgr_hawickcircuits(
        'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded'
      )
      ORDER BY path_id, path_seq
      LIMIT 1000
    `);
    
    console.log(`🔍 Found ${loops.rows.length} potential loop edges`);
    
    // Group loops by path_id
    const loopGroups = new Map<number, any[]>();
    loops.rows.forEach(row => {
      if (!loopGroups.has(row.path_id)) {
        loopGroups.set(row.path_id, []);
      }
      loopGroups.get(row.path_id)!.push(row);
    });
    
    console.log(`🔍 Found ${loopGroups.size} unique cycles`);
    
    // Look for Bear Canyon loops
    console.log('🔍 Looking for Bear Canyon loops...');
    for (const [pathId, cycleEdges] of loopGroups) {
      const totalDistance = Math.max(...cycleEdges.map(edge => edge.agg_cost));
      
      // Check if this cycle contains Bear Canyon related trails
      const edgeIds = cycleEdges.map(edge => edge.edge).filter(id => id !== -1);
      const bearCanyonTrails = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded 
        WHERE id = ANY($1::integer[]) 
        AND (name ILIKE '%bear%' OR name ILIKE '%fern%' OR name ILIKE '%mesa%')
      `, [edgeIds]);
      
      if (bearCanyonTrails.rows[0].count > 0) {
        console.log(`🎯 Found Bear Canyon loop (path_id: ${pathId}): ${totalDistance.toFixed(2)}km with ${bearCanyonTrails.rows[0].count} Bear Canyon trails`);
        
        // Get the trail names in this loop
        const trailNames = await pgClient.query(`
          SELECT DISTINCT name FROM ${stagingSchema}.ways_noded 
          WHERE id = ANY($1::integer[])
          ORDER BY name
        `, [edgeIds]);
        
        console.log(`  Trails: ${trailNames.rows.map(r => r.name).join(', ')}`);
      }
    }
    
    console.log(`✅ Network creation complete! Schema: ${stagingSchema}`);
    console.log(`💡 To test Bear Canyon loop discovery, run:`);
    console.log(`   npx ts-node scripts/test-bear-canyon-loop-discovery.ts --schema ${stagingSchema}`);
    
  } catch (error) {
    console.error('❌ Error creating network from Layer 1:', error);
  } finally {
    await pgClient.end();
  }
}

if (require.main === module) {
  createNetworkFromLayer1().catch(console.error);
}
