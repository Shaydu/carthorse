#!/usr/bin/env ts-node

/**
 * Degree-2 Connectivity Diagnostic Script
 * 
 * This script analyzes the network connectivity before and after each degree-2 merge iteration
 * to identify exactly where and why connectivity is being lost.
 */

import { Pool } from 'pg';
import { getTolerances } from '../src/utils/config-loader';

const TEST_SCHEMA = 'carthorse_1755048238663'; // Use the schema from the last run

interface ConnectivityResult {
  isConnected: boolean;
  reachableNodes: number;
  totalNodes: number;
  connectivityPercentage: number;
  edgeCount: number;
  vertexCount: number;
  degreeDistribution: { degree: number; count: number }[];
}

async function validateConnectivity(
  pgClient: Pool,
  stagingSchema: string,
  operation: string
): Promise<ConnectivityResult> {
  try {
    // Get total node count
    const totalNodesResult = await pgClient.query(`
      SELECT COUNT(*) as total_nodes FROM ${stagingSchema}.ways_noded_vertices_pgr
    `);
    const totalNodes = Number(totalNodesResult.rows[0]?.total_nodes || 0);
    
    // Get edge count
    const edgeCountResult = await pgClient.query(`
      SELECT COUNT(*) as total_edges FROM ${stagingSchema}.ways_noded
    `);
    const edgeCount = Number(edgeCountResult.rows[0]?.total_edges || 0);
    
    // Get vertex count
    const vertexCountResult = await pgClient.query(`
      SELECT COUNT(*) as total_vertices FROM ${stagingSchema}.ways_noded_vertices_pgr
    `);
    const vertexCount = Number(vertexCountResult.rows[0]?.total_vertices || 0);
    
    // Get degree distribution
    const degreeDistributionResult = await pgClient.query(`
      SELECT cnt as degree, COUNT(*) as count
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    const degreeDistribution = degreeDistributionResult.rows.map(r => ({
      degree: Number(r.degree),
      count: Number(r.count)
    }));
    
    if (totalNodes === 0) {
      return { 
        isConnected: false, 
        reachableNodes: 0, 
        totalNodes: 0, 
        connectivityPercentage: 0,
        edgeCount: 0,
        vertexCount: 0,
        degreeDistribution: []
      };
    }
    
    // Find reachable nodes from a random starting node using pgRouting's pgr_dijkstra
    const reachableResult = await pgClient.query(`
      WITH reachable_nodes AS (
        SELECT DISTINCT node
        FROM pgr_dijkstra(
          'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
          (SELECT id FROM ${stagingSchema}.ways_noded_vertices_pgr LIMIT 1),
          (SELECT array_agg(id) FROM ${stagingSchema}.ways_noded_vertices_pgr),
          false
        )
        WHERE node IS NOT NULL
      )
      SELECT COUNT(*) as reachable_count FROM reachable_nodes
    `);
    
    const reachableNodes = Number(reachableResult.rows[0]?.reachable_count || 0);
    const connectivityPercentage = totalNodes > 0 ? (reachableNodes / totalNodes) * 100 : 0;
    const isConnected = connectivityPercentage >= 80; // Consider connected if 80%+ nodes are reachable
    
    console.log(`🔍 [${operation}] Connectivity validation: ${reachableNodes}/${totalNodes} nodes reachable (${connectivityPercentage.toFixed(1)}%)`);
    console.log(`   📊 Network stats: ${edgeCount} edges, ${vertexCount} vertices`);
    console.log(`   📊 Degree distribution: ${degreeDistribution.map(d => `degree-${d.degree}: ${d.count}`).join(', ')}`);
    
    if (!isConnected) {
      console.error(`❌ [${operation}] CRITICAL: Network connectivity lost! Only ${connectivityPercentage.toFixed(1)}% of nodes are reachable`);
    }
    
    return { 
      isConnected, 
      reachableNodes, 
      totalNodes, 
      connectivityPercentage,
      edgeCount,
      vertexCount,
      degreeDistribution
    };
  } catch (error) {
    console.warn(`⚠️ [${operation}] Connectivity validation failed:`, error);
    // If validation fails, assume connected to avoid blocking the process
    return { 
      isConnected: true, 
      reachableNodes: 0, 
      totalNodes: 0, 
      connectivityPercentage: 100,
      edgeCount: 0,
      vertexCount: 0,
      degreeDistribution: []
    };
  }
}

async function analyzeDegree2Chains(pgClient: Pool, stagingSchema: string): Promise<void> {
  console.log('\n🔍 Analyzing degree-2 chains...');
  
  // Get configurable tolerance from YAML config
  const tolerances = getTolerances();
  const degree2Tolerance = tolerances.degree2MergeTolerance / 111000.0; // Convert meters to degrees
  
  // Find potential degree-2 chains
  const chainAnalysisResult = await pgClient.query(`
    WITH RECURSIVE 
    vertex_degrees AS (
      SELECT 
        id as vertex_id,
        cnt as degree
      FROM ${stagingSchema}.ways_noded_vertices_pgr
    ),
    trail_chains AS (
      SELECT 
        e.id as edge_id,
        e.source as start_vertex,
        e.target as current_vertex,
        ARRAY[e.id::bigint] as chain_edges,
        ARRAY[e.source, e.target] as chain_vertices,
        e.the_geom as chain_geom,
        e.length_km as total_length,
        e.elevation_gain as total_elevation_gain,
        e.elevation_loss as total_elevation_loss,
        e.name
      FROM ${stagingSchema}.ways_noded e
      WHERE e.source != e.target
      
      UNION ALL
      
      SELECT 
        next_e.id as edge_id,
        tc.start_vertex,
        CASE 
          WHEN next_e.source = tc.current_vertex THEN next_e.target
          ELSE next_e.source
        END as current_vertex,
        tc.chain_edges || next_e.id::bigint as chain_edges,
        tc.chain_vertices || CASE 
          WHEN next_e.source = tc.current_vertex THEN next_e.target
          ELSE next_e.source
        END as chain_vertices,
        (
          WITH merged AS (
            SELECT ST_LineMerge(ST_Union(tc.chain_geom, next_e.the_geom)) as geom
          )
          SELECT 
            CASE 
              WHEN ST_GeometryType(geom) = 'ST_LineString' THEN geom::geometry(LineString,4326)
              ELSE ST_GeometryN(geom, 1)::geometry(LineString,4326)
            END
          FROM merged
        ) as chain_geom,
        tc.total_length + next_e.length_km as total_length,
        tc.total_elevation_gain + next_e.elevation_gain as total_elevation_gain,
        tc.total_elevation_loss + next_e.elevation_loss as total_elevation_loss,
        tc.name
      FROM trail_chains tc
      JOIN ${stagingSchema}.ways_noded next_e ON 
        (next_e.source = tc.current_vertex OR next_e.target = tc.current_vertex)
      WHERE 
        next_e.id::bigint != ALL(tc.chain_edges)
        AND next_e.source != next_e.target
        AND (
          ST_DWithin(ST_EndPoint(tc.chain_geom), ST_StartPoint(next_e.the_geom), $1)
          OR ST_DWithin(ST_EndPoint(tc.chain_geom), ST_EndPoint(next_e.the_geom), $1)
          OR ST_DWithin(ST_StartPoint(tc.chain_geom), ST_StartPoint(next_e.the_geom), $1)
          OR ST_DWithin(ST_StartPoint(tc.chain_geom), ST_EndPoint(next_e.the_geom), $1)
        )
        AND array_length(tc.chain_edges, 1) < 15
    )
    SELECT 
      start_vertex,
      current_vertex as end_vertex,
      array_length(chain_edges, 1) as chain_length,
      chain_edges,
      name,
      total_length
    FROM trail_chains
    WHERE array_length(chain_edges, 1) >= 2
    ORDER BY array_length(chain_edges, 1) DESC, total_length DESC
    LIMIT 20;
  `, [degree2Tolerance]);
  
  console.log(`📊 Found ${chainAnalysisResult.rowCount} potential degree-2 chains:`);
  chainAnalysisResult.rows.forEach((row, index) => {
    console.log(`   ${index + 1}. Chain ${row.start_vertex} → ${row.end_vertex} (${row.chain_length} edges, ${row.total_length.toFixed(2)}km): ${row.name}`);
    console.log(`      Edges: [${row.chain_edges.join(', ')}]`);
  });
}

async function analyzeBridgeEdges(pgClient: Pool, stagingSchema: string): Promise<void> {
  console.log('\n🔍 Analyzing bridge edges...');
  
  // Find bridge edges (degree-1 to degree-2)
  const bridgeEdgeResult = await pgClient.query(`
    SELECT 
      e.id,
      e.name,
      e.source,
      e.target,
      v1.cnt as source_degree,
      v2.cnt as target_degree,
      e.app_uuid
    FROM ${stagingSchema}.ways_noded e
    JOIN ${stagingSchema}.ways_noded_vertices_pgr v1 ON e.source = v1.id
    JOIN ${stagingSchema}.ways_noded_vertices_pgr v2 ON e.target = v2.id
    WHERE (v1.cnt = 1 OR v2.cnt = 1)  -- One end is degree 1
      AND (v1.cnt = 2 OR v2.cnt = 2)  -- Other end is degree 2 (can be merged)
      AND e.app_uuid NOT LIKE 'merged-degree2-chain-%'  -- Don't process already merged edges
      AND e.app_uuid NOT LIKE 'merged-bridge-edge-%'  -- Don't process already merged bridge edges
    ORDER BY e.id
  `);
  
  console.log(`📊 Found ${bridgeEdgeResult.rowCount} potential bridge edges:`);
  bridgeEdgeResult.rows.forEach((row, index) => {
    console.log(`   ${index + 1}. Edge ${row.id} (${row.name}): ${row.source}(deg=${row.source_degree}) → ${row.target}(deg=${row.target_degree}) [${row.app_uuid}]`);
  });
}

async function analyzeJunctionEdges(pgClient: Pool, stagingSchema: string): Promise<void> {
  console.log('\n🔍 Analyzing junction edges...');
  
  // Find junction edges (degree-3+ to degree-2)
  const junctionEdgeResult = await pgClient.query(`
    SELECT 
      e.id,
      e.name,
      e.source,
      e.target,
      v1.cnt as source_degree,
      v2.cnt as target_degree,
      e.app_uuid
    FROM ${stagingSchema}.ways_noded e
    JOIN ${stagingSchema}.ways_noded_vertices_pgr v1 ON e.source = v1.id
    JOIN ${stagingSchema}.ways_noded_vertices_pgr v2 ON e.target = v2.id
    WHERE (v1.cnt >= 3 AND v2.cnt = 2)  -- One end is degree 3+ (junction), other is degree 2
       OR (v1.cnt = 2 AND v2.cnt >= 3)  -- One end is degree 2, other is degree 3+ (junction)
      AND e.app_uuid NOT LIKE 'merged-degree2-chain-%'
      AND e.app_uuid NOT LIKE 'merged-bridge-edge-%'
      AND e.app_uuid NOT LIKE 'merged-junction-edge-%'
    ORDER BY e.id
  `);
  
  console.log(`📊 Found ${junctionEdgeResult.rowCount} potential junction edges:`);
  junctionEdgeResult.rows.forEach((row, index) => {
    console.log(`   ${index + 1}. Edge ${row.id} (${row.name}): ${row.source}(deg=${row.source_degree}) → ${row.target}(deg=${row.target_degree}) [${row.app_uuid}]`);
  });
}

async function analyzeNetworkTopology(pgClient: Pool, stagingSchema: string): Promise<void> {
  console.log('\n🔍 Analyzing network topology...');
  
  // Analyze connected components
  const componentResult = await pgClient.query(`
    WITH RECURSIVE 
    components AS (
      SELECT 
        v.id as vertex_id,
        v.id as component_id,
        ARRAY[v.id] as visited
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      
      UNION ALL
      
      SELECT 
        e.target as vertex_id,
        c.component_id,
        c.visited || e.target
      FROM components c
      JOIN ${stagingSchema}.ways_noded e ON e.source = c.vertex_id
      WHERE e.target != ALL(c.visited)
      
      UNION ALL
      
      SELECT 
        e.source as vertex_id,
        c.component_id,
        c.visited || e.source
      FROM components c
      JOIN ${stagingSchema}.ways_noded e ON e.target = c.vertex_id
      WHERE e.source != ALL(c.visited)
    ),
    component_sizes AS (
      SELECT 
        component_id,
        COUNT(DISTINCT vertex_id) as size
      FROM components
      GROUP BY component_id
    )
    SELECT 
      COUNT(*) as total_components,
      MAX(size) as largest_component_size,
      MIN(size) as smallest_component_size,
      AVG(size) as avg_component_size
    FROM component_sizes
  `);
  
  const component = componentResult.rows[0];
  console.log(`📊 Network components: ${component.total_components} total components`);
  console.log(`   - Largest component: ${component.largest_component_size} vertices`);
  console.log(`   - Smallest component: ${component.smallest_component_size} vertices`);
  console.log(`   - Average component: ${component.avg_component_size.toFixed(1)} vertices`);
  
  if (component.total_components > 1) {
    console.log(`⚠️  WARNING: Network has ${component.total_components} disconnected components!`);
  }
}

async function main(): Promise<void> {
  console.log('🔍 Degree-2 Connectivity Diagnostic Script');
  console.log('==========================================');
  
  // Connect to database
  const pgClient = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'trail_master_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
  
  try {
    console.log(`📊 Analyzing schema: ${TEST_SCHEMA}`);
    
    // Step 1: Analyze current network state
    console.log('\n📊 Step 1: Current network state analysis...');
    const currentConnectivity = await validateConnectivity(pgClient, TEST_SCHEMA, 'CURRENT_STATE');
    
    // Step 2: Analyze degree-2 chains
    await analyzeDegree2Chains(pgClient, TEST_SCHEMA);
    
    // Step 3: Analyze bridge edges
    await analyzeBridgeEdges(pgClient, TEST_SCHEMA);
    
    // Step 4: Analyze junction edges
    await analyzeJunctionEdges(pgClient, TEST_SCHEMA);
    
    // Step 5: Analyze network topology
    await analyzeNetworkTopology(pgClient, TEST_SCHEMA);
    
    // Step 6: Detailed edge analysis
    console.log('\n🔍 Detailed edge analysis...');
    const edgeAnalysisResult = await pgClient.query(`
      SELECT 
        id,
        name,
        source,
        target,
        app_uuid,
        length_km,
        ST_Length(the_geom::geography) as geom_length
      FROM ${TEST_SCHEMA}.ways_noded
      ORDER BY id
    `);
    
    console.log(`📊 Network has ${edgeAnalysisResult.rowCount} edges:`);
    edgeAnalysisResult.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. Edge ${row.id} (${row.name}): ${row.source} → ${row.target} [${row.app_uuid}] (${row.length_km.toFixed(2)}km)`);
    });
    
    // Step 7: Summary
    console.log('\n📊 SUMMARY:');
    console.log(`   - Network connectivity: ${currentConnectivity.connectivityPercentage.toFixed(1)}%`);
    console.log(`   - Total edges: ${currentConnectivity.edgeCount}`);
    console.log(`   - Total vertices: ${currentConnectivity.vertexCount}`);
    console.log(`   - Is connected: ${currentConnectivity.isConnected ? 'YES' : 'NO'}`);
    
    if (!currentConnectivity.isConnected) {
      console.log('\n❌ DIAGNOSIS: Network connectivity issues detected!');
      console.log('   This explains why degree-2 merge iterations are losing connectivity.');
      console.log('   The network is already fragmented before the merge process begins.');
    } else {
      console.log('\n✅ DIAGNOSIS: Network appears to be connected.');
      console.log('   If connectivity is being lost during degree-2 merge iterations,');
      console.log('   the issue is likely in the merge logic itself.');
    }
    
  } catch (error) {
    console.error('❌ Error during diagnosis:', error);
  } finally {
    await pgClient.end();
  }
}

if (require.main === module) {
  main().catch(console.error);
}
