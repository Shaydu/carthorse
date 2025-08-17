import { Pool } from 'pg';

async function analyzeTopology() {
  console.log('🔍 Analyzing routing network topology...');
  
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'tester',
    password: 'your_password_here',
    database: 'trail_master_db_test'
  });

  try {
    // Find staging schema
    const schemaResult = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);

    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schema found');
      return;
    }

    const schema = schemaResult.rows[0].schema_name;
    console.log(`📋 Using schema: ${schema}`);

    // Check if routing tables exist
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = $1 
        AND table_name IN ('routing_nodes', 'routing_edges', 'ways_noded', 'ways_noded_vertices_pgr')
    `, [schema]);

    console.log('📊 Available routing tables:');
    tablesResult.rows.forEach(row => console.log(`  - ${row.table_name}`));

    // Check routing network stats
    const networkStats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${schema}.routing_nodes) as nodes_count,
        (SELECT COUNT(*) FROM ${schema}.routing_edges) as edges_count,
        (SELECT COUNT(*) FROM ${schema}.ways_noded) as ways_noded_count,
        (SELECT COUNT(*) FROM ${schema}.ways_noded_vertices_pgr) as vertices_count
    `);

    console.log('\n📊 Network Statistics:');
    console.log(`  - Routing nodes: ${networkStats.rows[0].nodes_count}`);
    console.log(`  - Routing edges: ${networkStats.rows[0].edges_count}`);
    console.log(`  - Ways noded: ${networkStats.rows[0].ways_noded_count}`);
    console.log(`  - Vertices: ${networkStats.rows[0].vertices_count}`);

    // Check connectivity
    const connectivityResult = await pool.query(`
      WITH node_degrees AS (
        SELECT 
          source as node_id,
          COUNT(*) as out_degree
        FROM ${schema}.routing_edges
        GROUP BY source
        UNION ALL
        SELECT 
          target as node_id,
          COUNT(*) as in_degree
        FROM ${schema}.routing_edges
        GROUP BY target
      ),
      total_degrees AS (
        SELECT 
          node_id,
          SUM(out_degree) as total_degree
        FROM node_degrees
        GROUP BY node_id
      )
      SELECT 
        COUNT(*) as total_nodes,
        COUNT(CASE WHEN total_degree >= 3 THEN 1 END) as intersection_nodes,
        COUNT(CASE WHEN total_degree = 2 THEN 1 END) as connector_nodes,
        COUNT(CASE WHEN total_degree = 1 THEN 1 END) as endpoint_nodes
      FROM total_degrees
    `);

    console.log('\n🔗 Connectivity Analysis:');
    console.log(`  - Total nodes: ${connectivityResult.rows[0].total_nodes}`);
    console.log(`  - Intersection nodes (3+ connections): ${connectivityResult.rows[0].intersection_nodes}`);
    console.log(`  - Connector nodes (2 connections): ${connectivityResult.rows[0].connector_nodes}`);
    console.log(`  - Endpoint nodes (1 connection): ${connectivityResult.rows[0].endpoint_nodes}`);

    // Check for potential loops
    const loopPotential = await pool.query(`
      WITH node_degrees AS (
        SELECT 
          source as node_id,
          COUNT(*) as out_degree
        FROM ${schema}.routing_edges
        GROUP BY source
        UNION ALL
        SELECT 
          target as node_id,
          COUNT(*) as in_degree
        FROM ${schema}.routing_edges
        GROUP BY target
      ),
      total_degrees AS (
        SELECT 
          node_id,
          SUM(out_degree) as total_degree
        FROM node_degrees
        GROUP BY node_id
      )
      SELECT 
        COUNT(CASE WHEN total_degree >= 3 THEN 1 END) as potential_loop_nodes
      FROM total_degrees
    `);

    console.log(`\n🔄 Loop Potential: ${loopPotential.rows[0].potential_loop_nodes} nodes with 3+ connections (potential loop anchors)`);

    // Check if we have enough connectivity for loops
    if (connectivityResult.rows[0].intersection_nodes >= 3) {
      console.log('✅ Sufficient connectivity for loop generation');
    } else {
      console.log('❌ Insufficient connectivity for loop generation');
    }

  } catch (error) {
    console.error('❌ Error analyzing topology:', error);
  } finally {
    await pool.end();
  }
}

analyzeTopology();
