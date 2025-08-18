import { Pool } from 'pg';

async function debugEndpoints() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🔍 Debugging Endpoint Selection...');
    
    const stagingSchema = 'test_vertex_aware_t_split';
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Check export_nodes structure and data
    console.log('\n📊 Checking export_nodes table...');
    const exportNodesStructure = await pgClient.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'export_nodes'
      ORDER BY ordinal_position
    `, [stagingSchema]);
    
    console.log('export_nodes columns:');
    exportNodesStructure.rows.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
    // Check total count
    const totalExportNodes = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.export_nodes
    `);
    console.log(`\nTotal export_nodes: ${totalExportNodes.rows[0].count}`);
    
    // Check degree distribution
    console.log('\n📊 Checking degree distribution in export_nodes...');
    const degreeDistribution = await pgClient.query(`
      SELECT degree, COUNT(*) as count
      FROM ${stagingSchema}.export_nodes
      GROUP BY degree
      ORDER BY degree
    `);
    
    console.log('Degree distribution:');
    degreeDistribution.rows.forEach(row => {
      console.log(`  Degree ${row.degree}: ${row.count} nodes`);
    });
    
    // Check nodes with degree >= 2
    const nodesWithDegree2Plus = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${stagingSchema}.export_nodes
      WHERE degree >= 2
    `);
    console.log(`\nNodes with degree >= 2: ${nodesWithDegree2Plus.rows[0].count}`);
    
    // Sample nodes with degree >= 2
    const sampleNodes = await pgClient.query(`
      SELECT id, node_uuid, lat, lng, node_type, degree
      FROM ${stagingSchema}.export_nodes
      WHERE degree >= 2
      LIMIT 10
    `);
    
    console.log('\nSample nodes with degree >= 2:');
    sampleNodes.rows.forEach(node => {
      console.log(`  ID: ${node.id}, UUID: ${node.node_uuid}, Type: ${node.node_type}, Degree: ${node.degree}, Lat: ${node.lat}, Lng: ${node.lng}`);
    });
    
    // Check if degree is calculated correctly by comparing with ways_noded_vertices_pgr
    console.log('\n📊 Comparing degree calculation...');
    const degreeComparison = await pgClient.query(`
      SELECT 
        en.id as export_node_id,
        en.degree as export_degree,
        wn.cnt as ways_degree
      FROM ${stagingSchema}.export_nodes en
      JOIN ${stagingSchema}.ways_noded_vertices_pgr wn ON en.id = wn.id
      WHERE en.degree >= 2
      LIMIT 10
    `);
    
    console.log('Degree comparison (export_nodes vs ways_noded_vertices_pgr):');
    degreeComparison.rows.forEach(row => {
      console.log(`  Node ${row.export_node_id}: export_degree=${row.export_degree}, ways_degree=${row.ways_degree}`);
    });
    
    // Check if we can get endpoints from ways_noded_vertices_pgr directly
    console.log('\n📊 Checking ways_noded_vertices_pgr for endpoints...');
    const waysNodesWithDegree2Plus = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      WHERE cnt >= 2
    `);
    console.log(`Nodes with cnt >= 2 in ways_noded_vertices_pgr: ${waysNodesWithDegree2Plus.rows[0].count}`);
    
    // Sample from ways_noded_vertices_pgr
    const sampleWaysNodes = await pgClient.query(`
      SELECT id, cnt, chk, ein, eout
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      WHERE cnt >= 2
      LIMIT 10
    `);
    
    console.log('\nSample nodes from ways_noded_vertices_pgr with cnt >= 2:');
    sampleWaysNodes.rows.forEach(node => {
      console.log(`  ID: ${node.id}, cnt: ${node.cnt}, chk: ${node.chk}, ein: ${node.ein}, eout: ${node.eout}`);
    });
    
    // Test the actual query that getValidEndpoints uses
    console.log('\n🧪 Testing getValidEndpoints query...');
    const testEndpoints = await pgClient.query(`
      SELECT 
        id,
        node_uuid,
        lat,
        lng,
        node_type,
        degree
      FROM ${stagingSchema}.export_nodes
      WHERE degree >= 2  -- Only nodes with multiple connections
      ORDER BY RANDOM()
      LIMIT 50  -- Limit to avoid too many combinations
    `);
    
    console.log(`Query returned ${testEndpoints.rows.length} endpoints`);
    
    if (testEndpoints.rows.length > 0) {
      console.log('Sample endpoints:');
      testEndpoints.rows.slice(0, 5).forEach(endpoint => {
        console.log(`  ID: ${endpoint.id}, Type: ${endpoint.node_type}, Degree: ${endpoint.degree}`);
      });
    }
    
    // Alternative: use ways_noded_vertices_pgr directly
    console.log('\n🧪 Testing alternative endpoint selection from ways_noded_vertices_pgr...');
    const alternativeEndpoints = await pgClient.query(`
      SELECT 
        id,
        cnt as degree,
        the_geom
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      WHERE cnt >= 2  -- Only nodes with multiple connections
      ORDER BY RANDOM()
      LIMIT 50
    `);
    
    console.log(`Alternative query returned ${alternativeEndpoints.rows.length} endpoints`);
    
    if (alternativeEndpoints.rows.length > 0) {
      console.log('Sample alternative endpoints:');
      alternativeEndpoints.rows.slice(0, 5).forEach(endpoint => {
        console.log(`  ID: ${endpoint.id}, Degree: ${endpoint.degree}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error during endpoint debug:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the debug
debugEndpoints().catch(console.error);
