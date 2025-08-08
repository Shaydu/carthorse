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

async function removeBypassEdges() {
  try {
    await client.connect();
    console.log('🔧 Removing bypass edges that span multiple nodes...');

    // Step 1: Analyze current edges to find bypasses
    console.log('\n📊 Step 1: Analyzing current edges for bypasses...');
    
    const analysisQuery = `
      WITH edge_analysis AS (
        SELECT 
          id,
          source,
          target,
          old_id,
          sub_id,
          the_geom,
          ST_Length(the_geom::geography) as length_meters,
          ST_NumPoints(the_geom) as num_points,
          -- Check if this edge's geometry contains other nodes
          (SELECT COUNT(*) 
           FROM ${STAGING_SCHEMA}.ways_vertices_pgr v 
           WHERE v.id != source AND v.id != target 
           AND ST_DWithin(v.the_geom, the_geom, 0.0001)
           AND ST_Contains(ST_Buffer(the_geom, 0.0001), v.the_geom)
          ) as nodes_bypassed
        FROM ${STAGING_SCHEMA}.ways_noded
        WHERE the_geom IS NOT NULL
      )
      SELECT 
        id,
        source,
        target,
        old_id,
        sub_id,
        length_meters,
        num_points,
        nodes_bypassed,
        CASE 
          WHEN nodes_bypassed > 0 THEN 'BYPASS'
          WHEN length_meters > 1000 THEN 'LONG'
          ELSE 'NORMAL'
        END as edge_type
      FROM edge_analysis
      ORDER BY nodes_bypassed DESC, length_meters DESC
    `;
    
    const analysisResult = await client.query(analysisQuery);
    console.log(`📊 Found ${analysisResult.rows.length} edges to analyze`);
    
    // Show bypass edges
    const bypassEdges = analysisResult.rows.filter(row => row.edge_type === 'BYPASS');
    const longEdges = analysisResult.rows.filter(row => row.edge_type === 'LONG');
    
    console.log(`🔍 Found ${bypassEdges.length} bypass edges and ${longEdges.length} long edges`);
    
    if (bypassEdges.length > 0) {
      console.log('\n🚫 Bypass edges to remove:');
      bypassEdges.slice(0, 5).forEach(edge => {
        console.log(`  Edge ${edge.id}: ${edge.length_meters.toFixed(1)}m, bypasses ${edge.nodes_bypassed} nodes`);
      });
    }

    // Step 2: Create a table of edges to keep (non-bypass edges)
    console.log('\n📊 Step 2: Creating filtered edges table...');
    
    await client.query(`
      DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_noded_filtered;
      CREATE TABLE ${STAGING_SCHEMA}.ways_noded_filtered AS
      SELECT 
        id,
        old_id,
        sub_id,
        source,
        target,
        the_geom
      FROM ${STAGING_SCHEMA}.ways_noded wn
      WHERE NOT EXISTS (
        -- Check if this edge bypasses intermediate nodes
        SELECT 1 
        FROM ${STAGING_SCHEMA}.ways_vertices_pgr v 
        WHERE v.id != wn.source AND v.id != wn.target 
        AND ST_DWithin(v.the_geom, wn.the_geom, 0.0001)
        AND ST_Contains(ST_Buffer(wn.the_geom, 0.0001), v.the_geom)
      )
      AND the_geom IS NOT NULL
    `);
    
    const filteredStats = await client.query(`
      SELECT COUNT(*) as filtered_edges FROM ${STAGING_SCHEMA}.ways_noded_filtered
    `);
    
    const originalStats = await client.query(`
      SELECT COUNT(*) as original_edges FROM ${STAGING_SCHEMA}.ways_noded
    `);
    
    const removedCount = originalStats.rows[0].original_edges - filteredStats.rows[0].filtered_edges;
    
    console.log(`✅ Filtered edges: ${filteredStats.rows[0].filtered_edges} kept, ${removedCount} removed`);

    // Step 3: Replace the original table with filtered edges
    console.log('\n📊 Step 3: Replacing original edges with filtered edges...');
    
    await client.query(`DROP TABLE ${STAGING_SCHEMA}.ways_noded`);
    await client.query(`ALTER TABLE ${STAGING_SCHEMA}.ways_noded_filtered RENAME TO ways_noded`);
    console.log('✅ Replaced ways_noded with filtered edges');

    // Step 4: Recreate topology with filtered edges
    console.log('\n📊 Step 4: Recreating topology with filtered edges...');
    
    await client.query(`
      SELECT pgr_createTopology('${STAGING_SCHEMA}.ways_noded', 0.000001, 'the_geom', 'id')
    `);
    console.log('✅ Recreated topology');

    // Step 5: Get final statistics
    console.log('\n📊 Step 5: Getting final statistics...');
    
    const finalStats = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded) as edges_count,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_pgr) as vertices_count,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded WHERE source IS NULL OR target IS NULL) as null_connections
    `);
    
    const stats = finalStats.rows[0];
    console.log(`📊 Final Network Stats: ${stats.edges_count} edges, ${stats.vertices_count} vertices, ${stats.null_connections} null connections`);

    // Step 6: Show node connectivity distribution
    const nodeStats = await client.query(`
      SELECT 
        COUNT(*) as total_nodes,
        COUNT(CASE WHEN cnt = 1 THEN 1 END) as endpoint_nodes,
        COUNT(CASE WHEN cnt = 2 THEN 1 END) as connection_nodes,
        COUNT(CASE WHEN cnt >= 3 THEN 1 END) as intersection_nodes
      FROM ${STAGING_SCHEMA}.ways_vertices_pgr
    `);
    
    const nodeStatsRow = nodeStats.rows[0];
    console.log(`📊 Node Types: ${nodeStatsRow.endpoint_nodes} endpoints, ${nodeStatsRow.connection_nodes} connections, ${nodeStatsRow.intersection_nodes} intersections`);

    console.log('\n✅ Bypass edge removal completed successfully!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

removeBypassEdges(); 