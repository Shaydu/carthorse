import { Pool } from 'pg';

async function debugUnifiedNetwork() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🔍 Debugging Unified Network Structure...');
    
    const stagingSchema = 'test_vertex_aware_t_split';
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Check ways_noded structure
    console.log('\n📊 Checking ways_noded table structure...');
    const waysNodedStructure = await pgClient.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'ways_noded'
      ORDER BY ordinal_position
    `, [stagingSchema]);
    
    console.log('ways_noded columns:');
    waysNodedStructure.rows.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
    // Check ways_noded_vertices_pgr structure
    console.log('\n📊 Checking ways_noded_vertices_pgr table structure...');
    const verticesStructure = await pgClient.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'ways_noded_vertices_pgr'
      ORDER BY ordinal_position
    `, [stagingSchema]);
    
    console.log('ways_noded_vertices_pgr columns:');
    verticesStructure.rows.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
    // Check sample data from ways_noded
    console.log('\n📊 Sample ways_noded data...');
    const sampleWaysNoded = await pgClient.query(`
      SELECT id, source, target, cost, reverse_cost
      FROM ${stagingSchema}.ways_noded
      WHERE source IS NOT NULL AND target IS NOT NULL
      LIMIT 10
    `);
    
    console.log(`Found ${sampleWaysNoded.rows.length} ways_noded records with source/target:`);
    sampleWaysNoded.rows.forEach(row => {
      console.log(`  ID: ${row.id}, Source: ${row.source}, Target: ${row.target}, Cost: ${row.cost}`);
    });
    
    // Check if source/target are properly assigned
    console.log('\n📊 Checking source/target assignment...');
    const nullSourceTarget = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${stagingSchema}.ways_noded
      WHERE source IS NULL OR target IS NULL
    `);
    
    const totalWaysNoded = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${stagingSchema}.ways_noded
    `);
    
    console.log(`Total ways_noded: ${totalWaysNoded.rows[0].count}`);
    console.log(`With null source/target: ${nullSourceTarget.rows[0].count}`);
    
    // Check ways_noded_vertices_pgr data
    console.log('\n📊 Sample ways_noded_vertices_pgr data...');
    const sampleVertices = await pgClient.query(`
      SELECT id, cnt, chk, ein, eout
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      LIMIT 10
    `);
    
    console.log(`Sample vertices data:`);
    sampleVertices.rows.forEach(row => {
      console.log(`  ID: ${row.id}, cnt: ${row.cnt}, chk: ${row.chk}, ein: ${row.ein}, eout: ${row.eout}`);
    });
    
    // Check if pgr_analyzeGraph was run
    console.log('\n📊 Checking if pgr_analyzeGraph was run...');
    const analyzeResult = await pgClient.query(`
      SELECT pgr_analyzeGraph('${stagingSchema}.ways_noded', 0.000001, 'the_geom', 'id', 'source', 'target')
    `);
    
    console.log('pgr_analyzeGraph result:', analyzeResult.rows[0]);
    
    // Check vertices after analyze
    console.log('\n📊 Checking vertices after pgr_analyzeGraph...');
    const verticesAfterAnalyze = await pgClient.query(`
      SELECT id, cnt, chk, ein, eout
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      WHERE cnt > 0
      LIMIT 10
    `);
    
    console.log(`Found ${verticesAfterAnalyze.rows.length} vertices with cnt > 0:`);
    verticesAfterAnalyze.rows.forEach(row => {
      console.log(`  ID: ${row.id}, cnt: ${row.cnt}, chk: ${row.chk}, ein: ${row.ein}, eout: ${row.eout}`);
    });
    
    // Count connected vs isolated nodes
    const connectedNodes = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      WHERE cnt > 0
    `);
    
    const isolatedNodes = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      WHERE cnt = 0
    `);
    
    console.log(`\n📊 Node Connectivity Summary:`);
    console.log(`  Connected nodes (cnt > 0): ${connectedNodes.rows[0].count}`);
    console.log(`  Isolated nodes (cnt = 0): ${isolatedNodes.rows[0].count}`);
    
    // Test a simple KSP query
    if (connectedNodes.rows[0].count > 0) {
      console.log('\n🧪 Testing simple KSP query...');
      
      // Get two connected nodes
      const testNodes = await pgClient.query(`
        SELECT id FROM ${stagingSchema}.ways_noded_vertices_pgr
        WHERE cnt > 0
        LIMIT 2
      `);
      
      if (testNodes.rows.length >= 2) {
        const startNode = testNodes.rows[0].id;
        const endNode = testNodes.rows[1].id;
        
        console.log(`Testing KSP from node ${startNode} to node ${endNode}...`);
        
        try {
          const kspTest = await pgClient.query(`
            SELECT seq, path_seq, node, edge, cost, agg_cost
            FROM pgr_ksp(
              'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded WHERE cost > 0',
              $1, $2, 2, directed := true
            )
          `, [startNode, endNode]);
          
          console.log(`✅ KSP test successful! Found ${kspTest.rows.length} path segments`);
          
          if (kspTest.rows.length > 0) {
            console.log('Sample path:');
            kspTest.rows.slice(0, 5).forEach(row => {
              console.log(`  Seq: ${row.seq}, Node: ${row.node}, Edge: ${row.edge}, Cost: ${row.cost}`);
            });
          }
          
        } catch (error) {
          console.error('❌ KSP test failed:', error instanceof Error ? error.message : String(error));
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error during unified network debug:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the debug
debugUnifiedNetwork().catch(console.error);
