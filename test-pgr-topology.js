const { Client } = require('pg');

async function testPgrTopology() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: 'carthorse'
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    const schema = 'carthorse_1755382803764';
    
    // Check what we have
    console.log('\n📊 Current state:');
    const waysCount = await client.query(`SELECT COUNT(*) as count FROM ${schema}.ways_noded`);
    console.log(`   ways_noded: ${waysCount.rows[0].count} edges`);
    
    const verticesCount = await client.query(`SELECT COUNT(*) as count FROM ${schema}.ways_noded_vertices_pgr`);
    console.log(`   ways_noded_vertices_pgr: ${verticesCount.rows[0].count} vertices`);

    // Check if ways_noded has source/target columns
    const columns = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = '${schema}' 
        AND table_name = 'ways_noded' 
        AND column_name IN ('source', 'target')
    `);
    console.log(`   ways_noded has source/target: ${columns.rows.length > 0}`);

    // Test pgr_createtopology
    console.log('\n🔧 Testing pgr_createtopology...');
    
    // First, drop existing vertices table
    await client.query(`DROP TABLE IF EXISTS ${schema}.ways_noded_vertices_pgr`);
    console.log('   ✅ Dropped existing vertices table');

    // Run pgr_createtopology
    const result = await client.query(`
      SELECT pgr_createtopology(
        '${schema}.ways_noded',
        3.0,
        'the_geom',
        'id',
        'source',
        'target'
      )
    `);
    console.log(`   ✅ pgr_createtopology result: ${result.rows[0].pgr_createtopology}`);

    // Check results
    const newVerticesCount = await client.query(`SELECT COUNT(*) as count FROM ${schema}.ways_noded_vertices_pgr`);
    console.log(`   New vertices: ${newVerticesCount.rows[0].count}`);

    // Check node 99 specifically
    const node99 = await client.query(`
      SELECT id, cnt as degree, ST_AsText(the_geom) as geom 
      FROM ${schema}.ways_noded_vertices_pgr 
      WHERE id = 99
    `);
    
    if (node99.rows.length > 0) {
      console.log(`   Node 99: degree ${node99.rows[0].degree}`);
    } else {
      console.log('   Node 99: not found');
    }

    // Check degree distribution
    const degreeDist = await client.query(`
      SELECT cnt as degree, COUNT(*) as count 
      FROM ${schema}.ways_noded_vertices_pgr 
      GROUP BY cnt 
      ORDER BY cnt
    `);
    console.log('\n📊 Degree distribution:');
    degreeDist.rows.forEach(row => {
      console.log(`   Degree ${row.degree}: ${row.count} nodes`);
    });

    // Check edges connected to node 99
    const edges99 = await client.query(`
      SELECT id, source, target, name 
      FROM ${schema}.ways_noded 
      WHERE source = 99 OR target = 99
    `);
    console.log(`\n🔗 Edges connected to node 99: ${edges99.rows.length}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

testPgrTopology();
