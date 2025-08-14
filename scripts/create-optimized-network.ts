#!/usr/bin/env node

import { Pool } from 'pg';
import { PgRoutingHelpers } from '../src/utils/pgrouting-helpers';
import { mergeDegree2Chains } from '../src/utils/services/network-creation/merge-degree2-chains';
import { getDatabaseConfig } from '../src/utils/config-loader';

const dbConfig = getDatabaseConfig();

async function createOptimizedNetwork() {
  console.log('🚀 Creating Optimized Routing Network');
  console.log('=====================================');
  
  const pool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    max: dbConfig.pool.max,
    idleTimeoutMillis: dbConfig.pool.idleTimeoutMillis,
    connectionTimeoutMillis: dbConfig.pool.connectionTimeoutMillis
  });

  try {
    // Get the most recent staging schema
    const schemaResult = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      throw new Error('No staging schema found!');
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Check current trails
    const trailsResult = await pool.query(`
      SELECT COUNT(*) as total_trails, 
             COUNT(CASE WHEN source = 'gap_filler' THEN 1 END) as gap_fillers
      FROM ${stagingSchema}.trails
    `);
    
    console.log(`📊 Current trails: ${trailsResult.rows[0].total_trails} total, ${trailsResult.rows[0].gap_fillers} gap fillers`);
    
    // Step 1: Create the routing network
    console.log('\n🔄 Step 1: Creating routing network from trails...');
    const pgrouting = new PgRoutingHelpers({
      stagingSchema,
      pgClient: pool
    });
    
    const networkCreated = await pgrouting.createPgRoutingViews();
    if (!networkCreated) {
      throw new Error('Failed to create routing network');
    }
    
    // Check network stats
    const networkStats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as edges,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr) as vertices
    `);
    
    console.log(`✅ Network created: ${networkStats.rows[0].edges} edges, ${networkStats.rows[0].vertices} vertices`);
    
    // Step 2: Apply degree-2 merge optimizations
    console.log('\n🔗 Step 2: Applying degree-2 merge optimizations...');
    
    let totalChainsMerged = 0;
    let totalEdgesRemoved = 0;
    let iteration = 0;
    const maxIterations = 10;
    
    while (iteration < maxIterations) {
      iteration++;
      console.log(`\n🔄 Degree-2 merge iteration ${iteration}...`);
      
      const mergeResult = await mergeDegree2Chains(pool, stagingSchema);
      console.log(`   Chains merged: ${mergeResult.chainsMerged}, Edges removed: ${mergeResult.edgesRemoved}, Final edges: ${mergeResult.finalEdges}`);
      
      totalChainsMerged += mergeResult.chainsMerged;
      totalEdgesRemoved += mergeResult.edgesRemoved;
      
      // Stop if no more chains were merged (convergence)
      if (mergeResult.chainsMerged === 0) {
        console.log(`✅ Convergence reached after ${iteration} iterations`);
        break;
      }
    }
    
    if (iteration >= maxIterations) {
      console.log(`⚠️  Stopped after ${maxIterations} iterations to prevent infinite loops`);
    }
    
    // Step 3: Final network analysis
    console.log('\n📊 Step 3: Final network analysis...');
    
    const finalStats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as final_edges,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr) as final_vertices
    `);
    
    const vertexDegrees = await pool.query(`
      SELECT cnt as degree, COUNT(*) as vertex_count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    
    console.log(`📊 Final network: ${finalStats.rows[0].final_edges} edges, ${finalStats.rows[0].final_vertices} vertices`);
    console.log(`📊 Vertex degree distribution:`);
    vertexDegrees.rows.forEach(row => {
      console.log(`   Degree ${row.degree}: ${row.vertex_count} vertices`);
    });
    
    // Step 4: Connectivity analysis
    console.log('\n🔍 Step 4: Connectivity analysis...');
    
    const connectivityResult = await pool.query(`
      WITH reachable_nodes AS (
        SELECT DISTINCT target as node_id
        FROM ${stagingSchema}.ways_noded
        WHERE source = (SELECT MIN(id) FROM ${stagingSchema}.ways_noded_vertices_pgr)
        UNION
        SELECT source as node_id
        FROM ${stagingSchema}.ways_noded
        WHERE target = (SELECT MIN(id) FROM ${stagingSchema}.ways_noded_vertices_pgr)
      ),
      all_nodes AS (
        SELECT id as node_id FROM ${stagingSchema}.ways_noded_vertices_pgr
      )
      SELECT 
        COUNT(DISTINCT r.node_id) as reachable_count,
        COUNT(DISTINCT a.node_id) as total_nodes,
        CASE 
          WHEN COUNT(DISTINCT a.node_id) > 0 
          THEN (COUNT(DISTINCT r.node_id)::float / COUNT(DISTINCT a.node_id)::float) * 100
          ELSE 0
        END as connectivity_percent
      FROM reachable_nodes r
      CROSS JOIN all_nodes a
    `);
    
    const connectivity = connectivityResult.rows[0];
    console.log(`📊 Network connectivity: ${connectivity.reachable_count}/${connectivity.total_nodes} nodes reachable (${connectivity.connectivity_percent.toFixed(1)}%)`);
    
    // Summary
    console.log('\n🎉 Optimization Summary:');
    console.log(`   Total chains merged: ${totalChainsMerged}`);
    console.log(`   Total edges removed: ${totalEdgesRemoved}`);
    console.log(`   Final network: ${finalStats.rows[0].final_edges} edges, ${finalStats.rows[0].final_vertices} vertices`);
    console.log(`   Connectivity: ${connectivity.connectivity_percent.toFixed(1)}%`);
    
    console.log('\n✅ Optimized network creation completed!');
    
  } catch (error) {
    console.error('❌ Error creating optimized network:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the script
createOptimizedNetwork().catch(console.error);
