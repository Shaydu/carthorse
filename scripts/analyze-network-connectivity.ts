#!/usr/bin/env ts-node

import { Pool } from 'pg';

interface NetworkAnalysis {
  totalNodes: number;
  totalEdges: number;
  connectedComponents: number;
  largestComponentSize: number;
  isolatedNodes: number;
  isolatedEdges: number;
  connectivityScore: number;
  componentDetails: Array<{
    componentId: number;
    nodeCount: number;
    edgeCount: number;
    sampleNodes: number[];
  }>;
  connectivityIssues: string[];
}

async function analyzeNetworkConnectivity(): Promise<void> {
  console.log('🔍 Analyzing network connectivity...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    // Get the current staging schema
    const stagingSchema = 'test_vertex_aware_t_split';
    console.log(`📋 Using staging schema: ${stagingSchema}`);

    // Check if tables exist
    const tablesExist = await pgClient.query(`
      SELECT 
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded') as ways_noded_exists,
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded_vertices_pgr') as vertices_exists
    `, [stagingSchema]);

    if (!tablesExist.rows[0].ways_noded_exists || !tablesExist.rows[0].vertices_exists) {
      console.error('❌ Required tables do not exist!');
      return;
    }

    console.log('✅ Required tables exist');

    // Get basic network statistics
    const stats = await pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr) as total_nodes,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as total_edges
    `);

    const totalNodes = parseInt(stats.rows[0].total_nodes);
    const totalEdges = parseInt(stats.rows[0].total_edges);

    console.log(`📊 Network Statistics:`);
    console.log(`   Total nodes: ${totalNodes}`);
    console.log(`   Total edges: ${totalEdges}`);

    if (totalNodes === 0 || totalEdges === 0) {
      console.error('❌ Network is empty!');
      return;
    }

    // Analyze connected components using pgRouting's pgr_connectedComponents
    console.log('\n🔗 Analyzing connected components...');
    
    // Check if cost columns have values and add them if needed
    const costCheck = await pgClient.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(cost) as edges_with_cost,
        COUNT(reverse_cost) as edges_with_reverse_cost
      FROM ${stagingSchema}.ways_noded
    `);
    
    console.log(`📊 Cost column analysis:`);
    console.log(`   Total edges: ${costCheck.rows[0].total_edges}`);
    console.log(`   Edges with cost: ${costCheck.rows[0].edges_with_cost}`);
    console.log(`   Edges with reverse_cost: ${costCheck.rows[0].edges_with_reverse_cost}`);

    // Add cost columns if they're missing
    if (parseInt(costCheck.rows[0].edges_with_cost) === 0) {
      console.log('🔧 Adding cost columns to ways_noded...');
      await pgClient.query(`
        UPDATE ${stagingSchema}.ways_noded 
        SET cost = ST_Length(the_geom::geography) / 1000.0,
            reverse_cost = ST_Length(the_geom::geography) / 1000.0
        WHERE cost IS NULL OR reverse_cost IS NULL
      `);
      console.log('✅ Cost columns updated');
    }

    // Use pgRouting's pgr_connectedComponents for connectivity analysis
    const components = await pgClient.query(`
      SELECT 
        component,
        COUNT(*) as node_count
      FROM pgr_connectedComponents(
        'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded'
      )
      GROUP BY component
      ORDER BY node_count DESC
    `);

    const connectedComponents = components.rows.length;
    const largestComponentSize = parseInt(components.rows[0]?.node_count || '0');

    console.log(`📈 Connected Components Analysis:`);
    console.log(`   Total components: ${connectedComponents}`);
    console.log(`   Largest component: ${largestComponentSize} nodes`);
    console.log(`   Connectivity score: ${((largestComponentSize / totalNodes) * 100).toFixed(1)}%`);
    
    // If we only found one component, let's check if it's really the whole network
    if (connectedComponents === 1 && largestComponentSize < totalNodes * 0.9) {
      console.log(`   ⚠️  Only one component found but it's small (${largestComponentSize}/${totalNodes} nodes)`);
      console.log(`   🔍 This suggests there might be disconnected parts not reachable from the starting node`);
    }

    // Check for isolated nodes (degree 0)
    const isolatedNodes = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      WHERE NOT EXISTS (
        SELECT 1 FROM ${stagingSchema}.ways_noded e 
        WHERE e.source = v.id OR e.target = v.id
      )
    `);

    const isolatedCount = parseInt(isolatedNodes.rows[0].count);
    console.log(`   Isolated nodes: ${isolatedCount}`);

    // Check for isolated edges (edges that don't connect to the main network)
    const isolatedEdges = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${stagingSchema}.ways_noded e
      WHERE NOT EXISTS (
        SELECT 1 FROM ${stagingSchema}.ways_noded_vertices_pgr v
        WHERE v.id = e.source OR v.id = e.target
      )
    `);

    const isolatedEdgeCount = parseInt(isolatedEdges.rows[0].count);
    console.log(`   Isolated edges: ${isolatedEdgeCount}`);

    // Get detailed component information
    console.log('\n📋 Component Details:');
    for (let i = 0; i < Math.min(components.rows.length, 5); i++) {
      const component = components.rows[i];
      const componentId = component.component;
      const nodeCount = parseInt(component.node_count);

      // Get sample nodes from this component
      const sampleNodes = await pgClient.query(`
        SELECT id, ST_AsText(the_geom) as coordinates
        FROM ${stagingSchema}.ways_noded_vertices_pgr v
        WHERE v.id IN (
          SELECT node FROM pgr_connectedComponents(
            'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded'
          ) WHERE component = $1
        )
        LIMIT 3
      `, [componentId]);

      console.log(`   Component ${componentId}: ${nodeCount} nodes`);
      console.log(`     Sample nodes: ${sampleNodes.rows.map(n => `${n.id} (${n.coordinates})`).join(', ')}`);
    }

    // Check if the largest component contains most of the network
    const connectivityScore = (largestComponentSize / totalNodes) * 100;
    const isWellConnected = connectivityScore > 90;

    console.log(`\n🎯 Connectivity Assessment:`);
    console.log(`   ${isWellConnected ? '✅' : '❌'} Network is ${isWellConnected ? 'well connected' : 'poorly connected'}`);
    console.log(`   ${largestComponentSize}/${totalNodes} nodes (${connectivityScore.toFixed(1)}%) are in the main component`);

    // Check specific connectivity issues
    const connectivityIssues: string[] = [];

    if (connectedComponents > 1) {
      connectivityIssues.push(`Network has ${connectedComponents} disconnected components`);
    }

    if (isolatedCount > 0) {
      connectivityIssues.push(`${isolatedCount} isolated nodes found`);
    }

    if (isolatedEdgeCount > 0) {
      connectivityIssues.push(`${isolatedEdgeCount} isolated edges found`);
    }

    if (connectivityScore < 90) {
      connectivityIssues.push(`Only ${connectivityScore.toFixed(1)}% of nodes are in the main component`);
    }

    // Test routing between random nodes in the largest component
    console.log('\n🧪 Testing routing connectivity...');
    
    if (largestComponentSize > 1) {
      const testNodes = await pgClient.query(`
        SELECT node 
        FROM pgr_connectedComponents(
          'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded'
        ) 
        WHERE component = $1 
        ORDER BY RANDOM() 
        LIMIT 2
      `, [components.rows[0].component]);

      if (testNodes.rows.length >= 2) {
        const startNode = testNodes.rows[0].node;
        const endNode = testNodes.rows[1].node;

        try {
          const route = await pgClient.query(`
            SELECT COUNT(*) as path_length
            FROM pgr_dijkstra(
              'SELECT id, source, target, cost, reverse_cost FROM ${stagingSchema}.ways_noded',
              $1, $2, false
            )
          `, [startNode, endNode]);

          const pathLength = parseInt(route.rows[0].path_length);
          console.log(`   ✅ Routing test: Found path from node ${startNode} to ${endNode} (${pathLength} edges)`);
        } catch (error) {
          console.log(`   ❌ Routing test failed: No path from node ${startNode} to ${endNode}`);
          connectivityIssues.push('Routing test failed between nodes in main component');
        }
      }
    }

    // Summary and recommendations
    console.log('\n📋 Summary:');
    if (connectivityIssues.length === 0) {
      console.log('✅ Network is fully connected and routable!');
    } else {
      console.log('⚠️ Network connectivity issues found:');
      connectivityIssues.forEach(issue => console.log(`   - ${issue}`));
      
      console.log('\n🔧 Recommendations:');
      if (connectedComponents > 1) {
        console.log('   - Add connector edges between disconnected components');
      }
      if (isolatedCount > 0) {
        console.log('   - Remove or connect isolated nodes');
      }
      if (isolatedEdgeCount > 0) {
        console.log('   - Remove or connect isolated edges');
      }
    }

  } catch (error) {
    console.error('❌ Error analyzing network connectivity:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the analysis
analyzeNetworkConnectivity().catch(console.error);
