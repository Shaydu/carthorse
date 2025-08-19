const { Pool } = require('pg');
const fs = require('fs');
const yaml = require('js-yaml');

// Load configuration from carthorse.config.yaml
let config;
try {
  const configPath = './configs/carthorse.config.yaml';
  const configFile = fs.readFileSync(configPath, 'utf8');
  const yamlConfig = yaml.load(configFile);
  config = yamlConfig.database.environments.test;
} catch (error) {
  console.error('❌ Error loading config:', error.message);
  process.exit(1);
}

const pool = new Pool(config);

async function analyzeEdgeMinusOneErrors() {
  try {
    console.log('🔍 Finding most recent staging schema...');
    
    // Use the most recent staging schema
    const stagingSchema = 'carthorse_1755613649495';
    console.log(`📁 Using staging schema: ${stagingSchema}`);

    console.log('\n🔍 Step 1: Analyzing pgRouting network structure...');
    
    // Check basic network statistics
    const networkStats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as total_edges,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr) as total_nodes,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded WHERE source IS NULL OR target IS NULL) as edges_with_null_endpoints,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded WHERE source = target) as self_loops,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded WHERE source < 0 OR target < 0) as edges_with_negative_ids
    `);
    
    const stats = networkStats.rows[0];
    console.log(`📊 Network Statistics:`);
    console.log(`  Total edges: ${stats.total_edges}`);
    console.log(`  Total nodes: ${stats.total_nodes}`);
    console.log(`  Edges with null endpoints: ${stats.edges_with_null_endpoints}`);
    console.log(`  Self loops: ${stats.self_loops}`);
    console.log(`  Edges with negative IDs: ${stats.edges_with_negative_ids}`);

    console.log('\n🔍 Step 2: Finding edges that might cause -1 errors...');
    
    // Find edges with potential connectivity issues
    const problematicEdges = await pool.query(`
      SELECT 
        wn.id as edge_id,
        wn.source,
        wn.target,
        wn.old_id,
        wn.sub_id,
        wn.length_km,
        wn.the_geom,
        -- Check if source node exists
        CASE WHEN v1.id IS NULL THEN 'MISSING_SOURCE' ELSE 'OK' END as source_status,
        -- Check if target node exists  
        CASE WHEN v2.id IS NULL THEN 'MISSING_TARGET' ELSE 'OK' END as target_status,
        -- Check if nodes are connected to the edge geometry
        CASE 
          WHEN v1.id IS NOT NULL AND NOT ST_DWithin(ST_StartPoint(wn.the_geom), v1.the_geom, 0.0001) 
          THEN 'SOURCE_NOT_CONNECTED'
          ELSE 'OK'
        END as source_connection,
        CASE 
          WHEN v2.id IS NOT NULL AND NOT ST_DWithin(ST_EndPoint(wn.the_geom), v2.the_geom, 0.0001) 
          THEN 'TARGET_NOT_CONNECTED'
          ELSE 'OK'
        END as target_connection,
        -- Check for orphaned nodes
        CASE 
          WHEN v1.id IS NOT NULL AND v1.cnt = 0 THEN 'ORPHANED_SOURCE'
          ELSE 'OK'
        END as source_orphan_status,
        CASE 
          WHEN v2.id IS NOT NULL AND v2.cnt = 0 THEN 'ORPHANED_TARGET'
          ELSE 'OK'
        END as target_orphan_status
      FROM ${stagingSchema}.ways_noded wn
      LEFT JOIN ${stagingSchema}.ways_noded_vertices_pgr v1 ON wn.source = v1.id
      LEFT JOIN ${stagingSchema}.ways_noded_vertices_pgr v2 ON wn.target = v2.id
      WHERE 
        wn.source IS NULL OR wn.target IS NULL OR
        v1.id IS NULL OR v2.id IS NULL OR
        NOT ST_DWithin(ST_StartPoint(wn.the_geom), v1.the_geom, 0.0001) OR
        NOT ST_DWithin(ST_EndPoint(wn.the_geom), v2.the_geom, 0.0001) OR
        v1.cnt = 0 OR v2.cnt = 0
      ORDER BY 
        CASE WHEN wn.source IS NULL OR wn.target IS NULL THEN 1 ELSE 0 END DESC,
        wn.id
    `);

    console.log(`🔍 Found ${problematicEdges.rows.length} problematic edges:`);
    
    if (problematicEdges.rows.length > 0) {
      console.log('\n📋 Problematic Edge Details:');
      problematicEdges.rows.forEach((edge, index) => {
        console.log(`\n  Edge ${index + 1}:`);
        console.log(`    Edge ID: ${edge.edge_id}`);
        console.log(`    Source: ${edge.source} (${edge.source_status})`);
        console.log(`    Target: ${edge.target} (${edge.target_status})`);
        console.log(`    Source Connection: ${edge.source_connection}`);
        console.log(`    Target Connection: ${edge.target_connection}`);
        console.log(`    Source Orphan: ${edge.source_orphan_status}`);
        console.log(`    Target Orphan: ${edge.target_orphan_status}`);
        console.log(`    Length: ${edge.length_km} km`);
      });
    }

    console.log('\n🔍 Step 3: Analyzing pgRouting function results for -1 edges...');
    
    // Test pgRouting functions to see which edges produce -1 results
    const testRouting = await pool.query(`
      WITH test_routes AS (
        SELECT 
          wn.id as edge_id,
          wn.source,
          wn.target,
          wn.length_km,
          -- Test dijkstra from source to target
          (SELECT COUNT(*) FROM pgr_dijkstra(
            'SELECT id, source, target, length_km * 1000 as cost FROM ${stagingSchema}.ways_noded',
            wn.source, wn.target, false
          ) WHERE edge = -1) as dijkstra_minus_one_count,
          -- Test ksp from source to target  
          (SELECT COUNT(*) FROM pgr_ksp(
            'SELECT id, source, target, length_km * 1000 as cost FROM ${stagingSchema}.ways_noded',
            wn.source, wn.target, 1, false
          ) WHERE edge = -1) as ksp_minus_one_count
        FROM ${stagingSchema}.ways_noded wn
        WHERE wn.source IS NOT NULL AND wn.target IS NOT NULL
        LIMIT 10
      )
      SELECT * FROM test_routes
      WHERE dijkstra_minus_one_count > 0 OR ksp_minus_one_count > 0
    `);

    console.log(`🔍 Found ${testRouting.rows.length} edges that produce -1 results in routing:`);
    
    if (testRouting.rows.length > 0) {
      console.log('\n📋 Routing Test Results:');
      testRouting.rows.forEach((route, index) => {
        console.log(`\n  Route ${index + 1}:`);
        console.log(`    Edge ID: ${route.edge_id}`);
        console.log(`    Source: ${route.source}`);
        console.log(`    Target: ${route.target}`);
        console.log(`    Dijkstra -1 count: ${route.dijkstra_minus_one_count}`);
        console.log(`    KSP -1 count: ${route.ksp_minus_one_count}`);
      });
    }

    console.log('\n🔍 Step 4: Checking for disconnected components...');
    
    // Analyze connected components
    const components = await pool.query(`
      SELECT 
        component,
        COUNT(*) as node_count,
        COUNT(CASE WHEN cnt = 1 THEN 1 END) as endpoint_count,
        COUNT(CASE WHEN cnt >= 2 THEN 1 END) as intersection_count
      FROM pgr_connectedComponents(
        'SELECT id, source, target, length_km * 1000 as cost FROM ${stagingSchema}.ways_noded'
      ) cc
      JOIN ${stagingSchema}.ways_noded_vertices_pgr v ON cc.node = v.id
      GROUP BY component
      ORDER BY node_count DESC
    `);

    console.log(`📊 Found ${components.rows.length} connected components:`);
    components.rows.forEach((comp, index) => {
      console.log(`  Component ${comp.component}: ${comp.node_count} nodes (${comp.endpoint_count} endpoints, ${comp.intersection_count} intersections)`);
    });

    console.log('\n🔍 Step 5: Checking for isolated nodes...');
    
    // Find isolated nodes (nodes with no edges)
    const isolatedNodes = await pool.query(`
      SELECT 
        v.id,
        v.cnt,
        v.the_geom
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      WHERE NOT EXISTS (
        SELECT 1 FROM ${stagingSchema}.ways_noded w 
        WHERE w.source = v.id OR w.target = v.id
      )
    `);

    console.log(`🔍 Found ${isolatedNodes.rows.length} isolated nodes:`);
    if (isolatedNodes.rows.length > 0) {
      isolatedNodes.rows.forEach((node, index) => {
        console.log(`  Node ${index + 1}: ID ${node.id}, degree ${node.cnt}`);
      });
    }

    console.log('\n🔍 Step 6: Checking for edges with invalid geometry...');
    
    // Check for edges with invalid geometry
    const invalidGeometry = await pool.query(`
      SELECT 
        id,
        source,
        target,
        ST_IsValid(the_geom) as is_valid,
        ST_IsEmpty(the_geom) as is_empty,
        ST_NumPoints(the_geom) as num_points,
        ST_Length(the_geom::geography) as length_meters
      FROM ${stagingSchema}.ways_noded
      WHERE NOT ST_IsValid(the_geom) OR ST_IsEmpty(the_geom) OR ST_NumPoints(the_geom) < 2
    `);

    console.log(`🔍 Found ${invalidGeometry.rows.length} edges with invalid geometry:`);
    if (invalidGeometry.rows.length > 0) {
      invalidGeometry.rows.forEach((edge, index) => {
        console.log(`  Edge ${index + 1}: ID ${edge.id}, Valid: ${edge.is_valid}, Empty: ${edge.is_empty}, Points: ${edge.num_points}, Length: ${edge.length_meters}m`);
      });
    }

    // Generate summary report
    const summary = {
      total_edges: parseInt(stats.total_edges),
      total_nodes: parseInt(stats.total_nodes),
      problematic_edges: problematicEdges.rows.length,
      routing_minus_one_edges: testRouting.rows.length,
      connected_components: components.rows.length,
      isolated_nodes: isolatedNodes.rows.length,
      invalid_geometry_edges: invalidGeometry.rows.length,
      issues: []
    };

    if (stats.edges_with_null_endpoints > 0) {
      summary.issues.push(`Found ${stats.edges_with_null_endpoints} edges with null endpoints`);
    }
    if (problematicEdges.rows.length > 0) {
      summary.issues.push(`Found ${problematicEdges.rows.length} edges with connectivity issues`);
    }
    if (testRouting.rows.length > 0) {
      summary.issues.push(`Found ${testRouting.rows.length} edges that produce -1 results in routing`);
    }
    if (components.rows.length > 1) {
      summary.issues.push(`Network has ${components.rows.length} disconnected components`);
    }
    if (isolatedNodes.rows.length > 0) {
      summary.issues.push(`Found ${isolatedNodes.rows.length} isolated nodes`);
    }
    if (invalidGeometry.rows.length > 0) {
      summary.issues.push(`Found ${invalidGeometry.rows.length} edges with invalid geometry`);
    }

    console.log('\n📋 SUMMARY REPORT:');
    console.log(`  Total Edges: ${summary.total_edges}`);
    console.log(`  Total Nodes: ${summary.total_nodes}`);
    console.log(`  Connected Components: ${summary.connected_components}`);
    console.log(`  Issues Found: ${summary.issues.length}`);
    
    if (summary.issues.length > 0) {
      console.log('\n🚨 ISSUES DETECTED:');
      summary.issues.forEach(issue => console.log(`  - ${issue}`));
    } else {
      console.log('\n✅ No major issues detected');
    }

    // Save detailed report to file
    const reportPath = 'test-output/edge-minus-one-analysis.json';
    fs.writeFileSync(reportPath, JSON.stringify({
      summary,
      problematic_edges: problematicEdges.rows,
      routing_test_results: testRouting.rows,
      connected_components: components.rows,
      isolated_nodes: isolatedNodes.rows,
      invalid_geometry: invalidGeometry.rows
    }, null, 2));

    console.log(`\n📄 Detailed report saved to: ${reportPath}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

analyzeEdgeMinusOneErrors();
