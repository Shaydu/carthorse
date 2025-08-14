#!/usr/bin/env node

import { Pool } from 'pg';
import { getDatabaseConfig } from '../src/utils/config-loader';

const dbConfig = getDatabaseConfig();

async function testNetworkConnectivity() {
  console.log('🔍 Testing Network Connectivity');
  console.log('===============================');
  
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
    
    // Check if routing tables exist
    const tablesCheck = await pool.query(`
      SELECT 
        EXISTS(SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded') as ways_noded_exists,
        EXISTS(SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded_vertices_pgr') as ways_noded_vertices_pgr_exists
    `, [stagingSchema]);
    
    if (!tablesCheck.rows[0].ways_noded_exists || !tablesCheck.rows[0].ways_noded_vertices_pgr_exists) {
      console.log('❌ No routing tables found - network not created yet');
      return;
    }
    
    // Basic network stats
    const networkStats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as edges,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr) as vertices
    `);
    
    console.log(`📊 Network stats: ${networkStats.rows[0].edges} edges, ${networkStats.rows[0].vertices} vertices`);
    
    // Vertex degree distribution
    const vertexDegrees = await pool.query(`
      SELECT cnt as degree, COUNT(*) as vertex_count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    
    console.log(`📊 Vertex degree distribution:`);
    vertexDegrees.rows.forEach(row => {
      console.log(`   Degree ${row.degree}: ${row.vertex_count} vertices`);
    });
    
    // Test connectivity from multiple starting points
    console.log('\n🔍 Testing connectivity from multiple starting points...');
    
    const startNodes = await pool.query(`
      SELECT id, cnt as degree
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      WHERE cnt >= 2
      ORDER BY cnt DESC, id
      LIMIT 5
    `);
    
    for (let i = 0; i < startNodes.rows.length; i++) {
      const startNode = startNodes.rows[i];
      console.log(`\n📍 Testing from node ${startNode.id} (degree ${startNode.degree})...`);
      
      const connectivityResult = await pool.query(`
        WITH RECURSIVE reachable AS (
          SELECT ${startNode.id} as node_id
          UNION ALL
          SELECT e.target as node_id
          FROM ${stagingSchema}.ways_noded e
          JOIN reachable r ON e.source = r.node_id
          UNION ALL
          SELECT e.source as node_id
          FROM ${stagingSchema}.ways_noded e
          JOIN reachable r ON e.target = r.node_id
        )
        SELECT 
          COUNT(DISTINCT node_id) as reachable_count,
          (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr) as total_nodes
        FROM reachable
      `);
      
      const connectivity = connectivityResult.rows[0];
      const connectivityPercent = (connectivity.reachable_count / connectivity.total_nodes) * 100;
      console.log(`   Reachable: ${connectivity.reachable_count}/${connectivity.total_nodes} nodes (${connectivityPercent.toFixed(1)}%)`);
      console.log(`   Reachable: ${connectivity.reachable_count}/${connectivity.total_nodes} nodes (${connectivity.connectivity_percent.toFixed(1)}%)`);
    }
    
    // Test shortest path between some nodes
    console.log('\n🛤️ Testing shortest path routing...');
    
    const testPaths = await pool.query(`
      SELECT 
        e1.source as start_node,
        e2.target as end_node,
        e1.source_degree,
        e2.target_degree
      FROM ${stagingSchema}.ways_noded e1
      JOIN ${stagingSchema}.ways_noded e2 ON e1.id != e2.id
      JOIN ${stagingSchema}.ways_noded_vertices_pgr v1 ON e1.source = v1.id
      JOIN ${stagingSchema}.ways_noded_vertices_pgr v2 ON e2.target = v2.id
      WHERE v1.cnt >= 2 AND v2.cnt >= 2
      LIMIT 3
    `);
    
    for (let i = 0; i < testPaths.rows.length; i++) {
      const path = testPaths.rows[i];
      console.log(`\n   Testing path: ${path.start_node} → ${path.end_node}...`);
      
      try {
        const pathResult = await pool.query(`
          SELECT pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
            $1, $2, false
          )
        `, [path.start_node, path.end_node]);
        
        if (pathResult.rows.length > 0) {
          const pathLength = pathResult.rows.length;
          const totalCost = pathResult.rows.reduce((sum, row) => sum + parseFloat(row.cost), 0);
          console.log(`   ✅ Path found: ${pathLength} edges, ${totalCost.toFixed(2)}km`);
        } else {
          console.log(`   ❌ No path found`);
        }
      } catch (error) {
        console.log(`   ❌ Path test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    // Component analysis
    console.log('\n🔗 Component analysis...');
    
    const componentResult = await pool.query(`
      WITH RECURSIVE components AS (
        SELECT 
          id as node_id,
          id as component_id,
          1 as depth
        FROM ${stagingSchema}.ways_noded_vertices_pgr
        WHERE cnt >= 1
        
        UNION ALL
        
        SELECT 
          CASE 
            WHEN e.source = c.node_id THEN e.target
            ELSE e.source
          END as node_id,
          c.component_id,
          c.depth + 1
        FROM components c
        JOIN ${stagingSchema}.ways_noded e ON (e.source = c.node_id OR e.target = c.node_id)
        WHERE c.depth < 1000  -- Prevent infinite recursion
      ),
      component_sizes AS (
        SELECT component_id, COUNT(DISTINCT node_id) as size
        FROM components
        GROUP BY component_id
      )
      SELECT 
        COUNT(*) as total_components,
        MAX(size) as largest_component,
        AVG(size) as avg_component_size,
        COUNT(CASE WHEN size = 1 THEN 1 END) as isolated_nodes
      FROM component_sizes
    `);
    
    const components = componentResult.rows[0];
    console.log(`📊 Component analysis:`);
    console.log(`   Total components: ${components.total_components}`);
    console.log(`   Largest component: ${components.largest_component} nodes`);
    console.log(`   Average component size: ${components.avg_component_size.toFixed(1)} nodes`);
    console.log(`   Isolated nodes: ${components.isolated_nodes}`);
    
    console.log('\n✅ Connectivity test completed!');
    
  } catch (error) {
    console.error('❌ Error testing connectivity:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the script
testNetworkConnectivity().catch(console.error);
