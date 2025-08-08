#!/usr/bin/env ts-node

import { Client } from 'pg';

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu'
});

const STAGING_SCHEMA = 'staging_boulder_test_improved_loops';

async function fixMissingVertices() {
  try {
    await client.connect();
    console.log('🔧 Fixing missing vertices and connectivity...');

    // Step 1: Create a proper vertices table by merging duplicates
    console.log('\n📊 Step 1: Creating proper vertices table...');
    await client.query(`
      DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_vertices_pgr_fixed;
      CREATE TABLE ${STAGING_SCHEMA}.ways_vertices_pgr_fixed AS
      SELECT 
        id,
        the_geom,
        COUNT(*) as cnt,
        SUM(CASE WHEN ein = 1 THEN 1 ELSE 0 END) as ein,
        SUM(CASE WHEN eout = 1 THEN 1 ELSE 0 END) as eout,
        SUM(CASE WHEN chk = 1 THEN 1 ELSE 0 END) as chk
      FROM ${STAGING_SCHEMA}.ways_vertices_pgr
      GROUP BY id, the_geom
      ORDER BY id
    `);
    console.log('✅ Created fixed vertices table');

    // Step 2: Get statistics on the fixed table
    const statsQuery = `
      SELECT 
        COUNT(*) as total_nodes,
        COUNT(CASE WHEN cnt = 1 THEN 1 END) as endpoint_nodes,
        COUNT(CASE WHEN cnt = 2 THEN 1 END) as connection_nodes,
        COUNT(CASE WHEN cnt >= 3 THEN 1 END) as intersection_nodes
      FROM ${STAGING_SCHEMA}.ways_vertices_pgr_fixed
    `;
    
    const statsResult = await client.query(statsQuery);
    const stats = statsResult.rows[0];
    
    console.log(`📊 Fixed Network Stats:`);
    console.log(`  Total nodes: ${stats.total_nodes}`);
    console.log(`  Endpoint nodes: ${stats.endpoint_nodes}`);
    console.log(`  Connection nodes: ${stats.connection_nodes}`);
    console.log(`  Intersection nodes: ${stats.intersection_nodes}`);

    // Step 3: Show some examples of high-connectivity nodes
    const highConnectivityQuery = `
      SELECT id, cnt, ein, eout, the_geom
      FROM ${STAGING_SCHEMA}.ways_vertices_pgr_fixed
      WHERE cnt >= 3
      ORDER BY cnt DESC
      LIMIT 5
    `;
    
    const highConnectivityResult = await client.query(highConnectivityQuery);
    console.log('\n🔗 High-connectivity nodes (intersections):');
    highConnectivityResult.rows.forEach(row => {
      console.log(`  Node ${row.id}: ${row.cnt} connections (${row.ein} in, ${row.eout} out)`);
    });

    // Step 4: Replace the original vertices table
    console.log('\n📊 Step 4: Replacing original vertices table...');
    await client.query(`DROP TABLE ${STAGING_SCHEMA}.ways_vertices_pgr`);
    await client.query(`ALTER TABLE ${STAGING_SCHEMA}.ways_vertices_pgr_fixed RENAME TO ways_vertices_pgr`);
    console.log('✅ Replaced original vertices table with fixed version');

    // Step 5: Verify the fix
    const verifyQuery = `
      SELECT 
        COUNT(*) as total_nodes,
        COUNT(CASE WHEN cnt = 1 THEN 1 END) as endpoint_nodes,
        COUNT(CASE WHEN cnt = 2 THEN 1 END) as connection_nodes,
        COUNT(CASE WHEN cnt >= 3 THEN 1 END) as intersection_nodes
      FROM ${STAGING_SCHEMA}.ways_vertices_pgr
    `;
    
    const verifyResult = await client.query(verifyQuery);
    const verifyStats = verifyResult.rows[0];
    
    console.log(`\n✅ Final Network Stats:`);
    console.log(`  Total nodes: ${verifyStats.total_nodes}`);
    console.log(`  Endpoint nodes: ${verifyStats.endpoint_nodes}`);
    console.log(`  Connection nodes: ${verifyStats.connection_nodes}`);
    console.log(`  Intersection nodes: ${verifyStats.intersection_nodes}`);

    console.log('\n✅ Vertices fix completed successfully!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

fixMissingVertices(); 