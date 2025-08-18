import { Pool } from 'pg';

async function debugKspMultitrail() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🔍 Debugging KSP Multi-trail Route Generation...');
    
    const stagingSchema = 'test_vertex_aware_t_split';
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Check the structure of ways_noded to understand trail relationships
    console.log('\n📊 Checking ways_noded structure...');
    const waysNodedStructure = await pgClient.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'ways_noded'
      ORDER BY ordinal_position
    `, [stagingSchema]);
    
    console.log('ways_noded columns:');
    waysNodedStructure.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (${row.is_nullable})`);
    });
    
    // Check if ways_noded has trail information
    console.log('\n📊 Checking ways_noded trail data...');
    const waysNodedSample = await pgClient.query(`
      SELECT id, source, target, cost, reverse_cost, the_geom
      FROM ${stagingSchema}.ways_noded
      LIMIT 5
    `);
    
    console.log('Sample ways_noded rows:');
    waysNodedSample.rows.forEach(row => {
      console.log(`  ID: ${row.id}, Source: ${row.source}, Target: ${row.target}, Cost: ${row.cost}`);
    });
    
    // Check the relationship between ways_noded and ways (original trails)
    console.log('\n📊 Checking ways table structure...');
    const waysStructure = await pgClient.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'ways'
      ORDER BY ordinal_position
    `, [stagingSchema]);
    
    console.log('ways columns:');
    waysStructure.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (${row.is_nullable})`);
    });
    
    // Check if there's a relationship between ways_noded and ways
    console.log('\n📊 Checking ways_noded to ways relationship...');
    const waysNodedWithTrails = await pgClient.query(`
      SELECT 
        wn.id as ways_noded_id,
        wn.source,
        wn.target,
        w.trail_name,
        w.trail_type,
        w.length_km
      FROM ${stagingSchema}.ways_noded wn
      JOIN ${stagingSchema}.ways w ON wn.id = w.id
      LIMIT 10
    `);
    
    console.log('ways_noded with trail info:');
    waysNodedWithTrails.rows.forEach(row => {
      console.log(`  ID: ${row.ways_noded_id}, Trail: ${row.trail_name}, Source: ${row.source}, Target: ${row.target}`);
    });
    
    // Test a simple KSP between two distant nodes to see if it generates multi-trail routes
    console.log('\n🎯 Testing KSP between distant nodes...');
    
    // Find two nodes that are far apart
    const distantNodes = await pgClient.query(`
      SELECT 
        v1.id as node1_id,
        v2.id as node2_id,
        ST_Distance(v1.the_geom::geography, v2.the_geom::geography) as distance_meters
      FROM ${stagingSchema}.ways_noded_vertices_pgr v1
      CROSS JOIN ${stagingSchema}.ways_noded_vertices_pgr v2
      WHERE v1.id != v2.id
        AND v1.cnt >= 2
        AND v2.cnt >= 2
        AND ST_Distance(v1.the_geom::geography, v2.the_geom::geography) > 5000  -- 5km apart
      ORDER BY distance_meters DESC
      LIMIT 1
    `);
    
    if (distantNodes.rows.length > 0) {
      const node1 = distantNodes.rows[0].node1_id;
      const node2 = distantNodes.rows[0].node2_id;
      const distance = distantNodes.rows[0].distance_meters;
      
      console.log(`\n🎯 Testing KSP between nodes ${node1} and ${node2} (${(distance/1000).toFixed(2)}km apart)`);
      
      // Run KSP
      const kspResult = await pgClient.query(`
        SELECT 
          seq,
          path_seq,
          node,
          edge,
          cost,
          agg_cost
        FROM pgr_ksp(
          'SELECT id::integer, source::integer, target::integer, cost::double precision, reverse_cost::double precision FROM ${stagingSchema}.ways_noded WHERE cost > 0',
          $1::integer, $2::integer, 3
        )
        ORDER BY seq, path_seq
      `, [node1, node2]);
      
      console.log(`\n📊 KSP Result: ${kspResult.rows.length} path segments`);
      
      // Group by path
      const paths: any = {};
      kspResult.rows.forEach(row => {
        if (!paths[row.seq]) {
          paths[row.seq] = [];
        }
        paths[row.seq].push(row);
      });
      
      Object.keys(paths).forEach(pathId => {
        const path = paths[pathId];
        const totalCost = path[path.length - 1].agg_cost;
        console.log(`\n🛤️  Path ${pathId} (${totalCost.toFixed(2)}km):`);
        
        // Get trail names for each edge
        const edgeIds = path.map((p: any) => p.edge).filter((id: any) => id !== -1);
        if (edgeIds.length > 0) {
          const trailInfo = await pgClient.query(`
            SELECT DISTINCT w.trail_name
            FROM ${stagingSchema}.ways w
            WHERE w.id = ANY($1)
          `, [edgeIds]);
          
          const trailNames = trailInfo.rows.map(r => r.trail_name).filter(name => name);
          console.log(`   Trails: ${trailNames.join(' → ')}`);
          console.log(`   Trail count: ${trailNames.length}`);
        }
      });
    }
    
    // Check if the issue is that we're selecting endpoints from the same trail
    console.log('\n🔍 Analyzing endpoint selection strategy...');
    
    const endpointAnalysis = await pgClient.query(`
      SELECT 
        v1.id as node1_id,
        v2.id as node2_id,
        ST_Distance(v1.the_geom::geography, v2.the_geom::geography) as distance_meters,
        -- Check if both nodes are on the same trail
        EXISTS (
          SELECT 1 FROM ${stagingSchema}.ways_noded wn1
          JOIN ${stagingSchema}.ways_noded wn2 ON wn1.id = wn2.id
          WHERE (wn1.source = v1.id OR wn1.target = v1.id)
            AND (wn2.source = v2.id OR wn2.target = v2.id)
        ) as same_trail
      FROM ${stagingSchema}.ways_noded_vertices_pgr v1
      CROSS JOIN ${stagingSchema}.ways_noded_vertices_pgr v2
      WHERE v1.id != v2.id
        AND v1.cnt >= 2
        AND v2.cnt >= 2
        AND ST_Distance(v1.the_geom::geography, v2.the_geom::geography) BETWEEN 1000 AND 5000
      ORDER BY distance_meters DESC
      LIMIT 10
    `);
    
    console.log('\n📊 Endpoint Analysis:');
    endpointAnalysis.rows.forEach(row => {
      console.log(`  Nodes ${row.node1_id}-${row.node2_id}: ${(row.distance_meters/1000).toFixed(2)}km, Same trail: ${row.same_trail}`);
    });
    
    // Suggest a better endpoint selection strategy
    console.log('\n💡 Suggested improvements for multi-trail routes:');
    console.log('1. Select endpoints from different trails');
    console.log('2. Use trailheads as endpoints');
    console.log('3. Select endpoints with minimum distance between them');
    console.log('4. Use intersection nodes (degree >= 3) as endpoints');
    
  } catch (error) {
    console.error('❌ Error during KSP multi-trail debug:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the debug
debugKspMultitrail().catch(console.error);
