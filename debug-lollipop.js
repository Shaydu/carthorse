const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  user: 'carthorse',
  database: 'trail_master_db',
  password: 'carthorse',
  port: 5432,
});

const stagingSchema = 'carthorse_1757465639927';

async function debugLollipop() {
  console.log('🔍 Debugging lollipop route generation...');
  
  try {
    // Test anchor nodes query
    console.log('1. Testing anchor nodes query...');
    const anchorNodes = await pool.query(`
      SELECT id, 
             (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) as connection_count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      WHERE (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) >= 3
      ORDER BY connection_count DESC
      LIMIT 5
    `);
    
    console.log(`   Found ${anchorNodes.rows.length} anchor nodes`);
    anchorNodes.rows.forEach(node => {
      console.log(`   - Node ${node.id}: ${node.connection_count} connections`);
    });
    
    if (anchorNodes.rows.length === 0) {
      console.log('❌ No anchor nodes found!');
      return;
    }
    
    // Test reachable nodes query for first anchor
    const anchorNode = anchorNodes.rows[0].id;
    console.log(`\n2. Testing reachable nodes query for anchor ${anchorNode}...`);
    
    const reachableNodes = await pool.query(`
      WITH direct_reachable AS (
        SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
        FROM pgr_dijkstra(
          'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${stagingSchema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
          $1::bigint,
          (SELECT array_agg(id) FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) >= 2),
          false
        )
        WHERE agg_cost BETWEEN $2 * 0.2 AND $2 * 0.8
        AND end_vid != $1
      ),
      nearby_nodes AS (
        SELECT DISTINCT rn2.id as node_id,
               ST_Distance(ST_SetSRID(ST_MakePoint(rn1.x, rn1.y), 4326), ST_SetSRID(ST_MakePoint(rn2.x, rn2.y), 4326)) as distance_meters
        FROM ${stagingSchema}.ways_noded_vertices_pgr rn1
        JOIN ${stagingSchema}.ways_noded_vertices_pgr rn2 ON rn2.id != rn1.id
        WHERE rn1.id = $1
        AND (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded WHERE source = rn2.id OR target = rn2.id) >= 2
        AND ST_Distance(ST_SetSRID(ST_MakePoint(rn1.x, rn1.y), 4326), ST_SetSRID(ST_MakePoint(rn2.x, rn2.y), 4326)) <= 100
      )
      SELECT node_id, distance_km, 'direct' as connection_type
      FROM direct_reachable
      UNION ALL
      SELECT node_id, distance_meters/1000.0 as distance_km, 'nearby' as connection_type
      FROM nearby_nodes
      ORDER BY distance_km DESC
      LIMIT 25
    `, [anchorNode, 150]);
    
    console.log(`   Found ${reachableNodes.rows.length} reachable destinations`);
    reachableNodes.rows.slice(0, 5).forEach(dest => {
      console.log(`   - Destination ${dest.node_id}: ${dest.distance_km.toFixed(2)}km (${dest.connection_type})`);
    });
    
    if (reachableNodes.rows.length === 0) {
      console.log('❌ No reachable destinations found!');
      return;
    }
    
    // Test outbound path for first destination
    const destNode = reachableNodes.rows[0].node_id;
    console.log(`\n3. Testing outbound path from ${anchorNode} to ${destNode}...`);
    
    const outboundPaths = await pool.query(`
      SELECT seq, node, edge, cost, agg_cost
      FROM pgr_dijkstra(
        'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${stagingSchema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
        $1::bigint, $2::bigint, false
      )
      WHERE edge != -1
      ORDER BY seq
    `, [anchorNode, destNode]);
    
    console.log(`   Found ${outboundPaths.rows.length} outbound path segments`);
    if (outboundPaths.rows.length > 0) {
      const outboundDistance = outboundPaths.rows[outboundPaths.rows.length - 1].agg_cost;
      console.log(`   Outbound distance: ${outboundDistance.toFixed(2)}km`);
      
      if (outboundDistance >= 20) {
        console.log('✅ Outbound distance meets minimum threshold');
        
        // Test return path
        console.log(`\n4. Testing return path from ${destNode} to ${anchorNode}...`);
        
        const returnPaths = await pool.query(`
          SELECT seq, node, edge, cost, agg_cost, path_id
          FROM pgr_ksp(
            'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${stagingSchema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
            $1::bigint, $2::bigint, 15, false, false
          )
          WHERE edge != -1
          ORDER BY path_id, agg_cost ASC
        `, [destNode, anchorNode]);
        
        console.log(`   Found ${returnPaths.rows.length} return path segments`);
        
        if (returnPaths.rows.length > 0) {
          console.log('✅ Return paths found - route generation should work!');
          
          // Group by path_id
          const returnPathGroups = new Map();
          for (const row of returnPaths.rows) {
            if (!returnPathGroups.has(row.path_id)) {
              returnPathGroups.set(row.path_id, []);
            }
            returnPathGroups.get(row.path_id).push(row);
          }
          
          console.log(`   Found ${returnPathGroups.size} return path alternatives`);
          
          // Test edge overlap calculation
          const outboundEdges = outboundPaths.rows
            .filter(row => row.edge !== -1)
            .map(row => row.edge);
          
          let minEdgeOverlap = Infinity;
          for (const [pathId, pathRows] of returnPathGroups) {
            const returnEdges = pathRows
              .filter(row => row.edge !== -1)
              .map(row => row.edge);
            
            const edgeOverlap = outboundEdges.filter(edge => returnEdges.includes(edge)).length;
            const overlapPercentage = (edgeOverlap / Math.max(outboundEdges.length, returnEdges.length)) * 100;
            
            console.log(`   Path ${pathId}: ${edgeOverlap} overlapping edges (${overlapPercentage.toFixed(1)}%)`);
            
            if (edgeOverlap < minEdgeOverlap) {
              minEdgeOverlap = edgeOverlap;
            }
          }
          
          console.log(`   Minimum edge overlap: ${minEdgeOverlap} edges`);
          console.log('✅ Route generation should work - all components are functioning!');
        } else {
          console.log('❌ No return paths found!');
        }
      } else {
        console.log(`❌ Outbound distance too short: ${outboundDistance.toFixed(2)}km (need >= 20km)`);
      }
    } else {
      console.log('❌ No outbound path found!');
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  } finally {
    await pool.end();
  }
}

debugLollipop();
