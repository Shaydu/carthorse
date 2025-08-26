const { Pool } = require('pg');

// Connect to PostgreSQL using the same config as the application
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse_user',
  password: 'carthorse_password'
});

async function checkNodeDegrees() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Checking node degrees in staging schema...\n');
    
    // Check the current degree counts in the vertices table
    const degreeStats = await client.query(`
      SELECT 
        cnt as degree,
        COUNT(*) as count
      FROM staging.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    
    console.log('📊 Current degree distribution:');
    degreeStats.rows.forEach(row => {
      console.log(`  Degree ${row.degree}: ${row.count} nodes`);
    });
    
    // Manually calculate degrees to compare
    console.log('\n🔍 Manually calculating degrees...');
    const manualDegrees = await client.query(`
      WITH vertex_counts AS (
        SELECT vertex_id, COUNT(*) as calculated_degree
        FROM (
          SELECT source as vertex_id FROM staging.ways_noded WHERE source IS NOT NULL
          UNION ALL
          SELECT target as vertex_id FROM staging.ways_noded WHERE target IS NOT NULL
        ) edge_endpoints
        GROUP BY vertex_id
      )
      SELECT 
        v.id,
        v.cnt as stored_degree,
        COALESCE(vc.calculated_degree, 0) as calculated_degree,
        CASE 
          WHEN v.cnt != COALESCE(vc.calculated_degree, 0) THEN 'MISMATCH'
          ELSE 'OK'
        END as status
      FROM staging.ways_noded_vertices_pgr v
      LEFT JOIN vertex_counts vc ON v.id = vc.vertex_id
      WHERE v.cnt != COALESCE(vc.calculated_degree, 0)
      ORDER BY v.id
      LIMIT 20
    `);
    
    console.log(`\n🔍 Found ${manualDegrees.rows.length} nodes with degree mismatches (showing first 20):`);
    manualDegrees.rows.forEach((node, index) => {
      console.log(`  Node ${node.id}: stored=${node.stored_degree}, calculated=${node.calculated_degree} (${node.status})`);
    });
    
    // Check for nodes with NULL degrees
    const nullDegrees = await client.query(`
      SELECT COUNT(*) as null_count
      FROM staging.ways_noded_vertices_pgr
      WHERE cnt IS NULL
    `);
    
    console.log(`\n🔍 Nodes with NULL degrees: ${nullDegrees.rows[0].null_count}`);
    
    // Check for orphaned vertices (no edges connected)
    const orphanedVertices = await client.query(`
      SELECT COUNT(*) as orphaned_count
      FROM staging.ways_noded_vertices_pgr v
      WHERE NOT EXISTS (
        SELECT 1 FROM staging.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);
    
    console.log(`🔍 Orphaned vertices (no edges): ${orphanedVertices.rows[0].orphaned_count}`);
    
    // Check for edges with invalid source/target
    const invalidEdges = await client.query(`
      SELECT COUNT(*) as invalid_count
      FROM staging.ways_noded e
      WHERE NOT EXISTS (
        SELECT 1 FROM staging.ways_noded_vertices_pgr v WHERE v.id = e.source
      )
      OR NOT EXISTS (
        SELECT 1 FROM staging.ways_noded_vertices_pgr v WHERE v.id = e.target
      )
    `);
    
    console.log(`🔍 Edges with invalid source/target: ${invalidEdges.rows[0].invalid_count}`);
    
    // Check total counts
    const totalCounts = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM staging.ways_noded_vertices_pgr) as total_vertices,
        (SELECT COUNT(*) FROM staging.ways_noded) as total_edges
    `);
    
    console.log(`\n📊 Total counts:`);
    console.log(`  Vertices: ${totalCounts.rows[0].total_vertices}`);
    console.log(`  Edges: ${totalCounts.rows[0].total_edges}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkNodeDegrees();
