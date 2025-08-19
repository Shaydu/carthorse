#!/usr/bin/env ts-node

import { Client } from 'pg';

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu'
});

async function testMinimalNodeNetwork() {
  try {
    await client.connect();
    console.log('🔧 Testing minimal pgr_nodeNetwork on single simple trail...');

    // Get a single, simple trail
    const simpleTrailQuery = `
      SELECT 
        app_uuid,
        name,
        geometry,
        ST_NumPoints(geometry) as num_points,
        ST_IsSimple(geometry) as is_simple,
        ST_IsValid(geometry) as is_valid
      FROM staging_boulder_1754318437837.trails 
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND ST_IsSimple(geometry)
        AND ST_NumPoints(geometry) > 5
      ORDER BY app_uuid
      LIMIT 1
    `;
    
    const simpleTrail = await client.query(simpleTrailQuery);
    
    if (simpleTrail.rows.length === 0) {
      console.log('❌ No simple trails found');
      return;
    }
    
    const trail = simpleTrail.rows[0];
    console.log(`Testing with: ${trail.name} (${trail.num_points} points)`);
    
    // Create minimal test table
    const tableName = 'test_minimal_trail';
    await client.query(`DROP TABLE IF EXISTS staging_boulder_1754318437837.${tableName}`);
    
    const createQuery = `
      CREATE TABLE staging_boulder_1754318437837.${tableName} AS
      SELECT 
        1 as id,
        '${trail.app_uuid}' as trail_uuid,
        '${trail.name}' as name,
        ST_Force2D(ST_Force2D(geometry)) as the_geom
      FROM staging_boulder_1754318437837.trails 
      WHERE app_uuid = '${trail.app_uuid}'
    `;
    
    await client.query(createQuery);
    
    // Check table was created
    const countResult = await client.query(`SELECT COUNT(*) as count FROM staging_boulder_1754318437837.${tableName}`);
    console.log(`Created table with ${countResult.rows[0].count} rows`);
    
    // Test pgr_nodeNetwork
    console.log('Running pgr_nodeNetwork...');
    try {
      await client.query(`SELECT pgr_nodeNetwork('staging_boulder_1754318437837.${tableName}', 0.000001, 'id', 'the_geom')`);
      console.log('✅ pgr_nodeNetwork completed');
      
      // Check if output tables were created
      const nodeTableExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'staging_boulder_1754318437837' 
          AND table_name = '${tableName}_noded_vertices_pgr'
        )
      `);
      
      const edgeTableExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'staging_boulder_1754318437837' 
          AND table_name = '${tableName}_noded'
        )
      `);
      
      console.log(`Vertices table exists: ${nodeTableExists.rows[0].exists}`);
      console.log(`Edges table exists: ${edgeTableExists.rows[0].exists}`);
      
      if (nodeTableExists.rows[0].exists && edgeTableExists.rows[0].exists) {
        const nodeCount = await client.query(`SELECT COUNT(*) as count FROM staging_boulder_1754318437837.${tableName}_noded_vertices_pgr`);
        const edgeCount = await client.query(`SELECT COUNT(*) as count FROM staging_boulder_1754318437837.${tableName}_noded`);
        
        console.log(`✅ Success: ${nodeCount.rows[0].count} nodes, ${edgeCount.rows[0].count} edges`);
      } else {
        console.log('❌ Output tables not created despite successful pgr_nodeNetwork call');
      }
      
    } catch (error) {
      console.log(`❌ pgr_nodeNetwork failed: ${(error as Error).message}`);
    }
    
    // Test pgr_createTopology as comparison
    console.log('\nTesting pgr_createTopology for comparison...');
    const topologyTableName = 'test_minimal_topology';
    await client.query(`DROP TABLE IF EXISTS staging_boulder_1754318437837.${topologyTableName}`);
    
    const topologyCreateQuery = `
      CREATE TABLE staging_boulder_1754318437837.${topologyTableName} AS
      SELECT 
        1 as id,
        '${trail.app_uuid}' as trail_uuid,
        '${trail.name}' as name,
        ST_Force2D(ST_Force2D(geometry)) as the_geom
      FROM staging_boulder_1754318437837.trails 
      WHERE app_uuid = '${trail.app_uuid}'
    `;
    
    await client.query(topologyCreateQuery);
    
    try {
      await client.query(`SELECT pgr_createTopology('staging_boulder_1754318437837.${topologyTableName}', 0.000001, 'the_geom', 'id')`);
      console.log('✅ pgr_createTopology completed');
      
      // Check if output tables were created
      const topologyNodeTableExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'staging_boulder_1754318437837' 
          AND table_name = '${topologyTableName}_vertices_pgr'
        )
      `);
      
      console.log(`Topology vertices table exists: ${topologyNodeTableExists.rows[0].exists}`);
      
      if (topologyNodeTableExists.rows[0].exists) {
        const topologyNodeCount = await client.query(`SELECT COUNT(*) as count FROM staging_boulder_1754318437837.${topologyTableName}_vertices_pgr`);
        console.log(`✅ Topology success: ${topologyNodeCount.rows[0].count} nodes`);
      } else {
        console.log('❌ Topology output table not created');
      }
      
    } catch (error) {
      console.log(`❌ pgr_createTopology failed: ${(error as Error).message}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

testMinimalNodeNetwork(); 