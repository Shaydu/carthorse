#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { config } from 'dotenv';

// Load environment variables
config();

interface EdgeDeletionAnalysis {
  iteration: number;
  totalEdgesBefore: number;
  totalEdgesAfter: number;
  edgesRemoved: number;
  overlappingPairsFound: number;
  mergeSuccessRate: number;
  connectivityBefore: number;
  connectivityAfter: number;
  connectivityChange: number;
  problematicEdges: Array<{
    edge1_id: number;
    edge2_id: number;
    overlap_percentage: number;
    e1_name: string;
    e2_name: string;
    merge_success: boolean;
    error_message?: string;
  }>;
}

async function analyzeEdgeDeletionPatterns(
  pgClient: Pool,
  stagingSchema: string,
  maxIterations: number = 10
): Promise<EdgeDeletionAnalysis[]> {
  const analysis: EdgeDeletionAnalysis[] = [];
  
  console.log('🔍 ANALYZING EDGE DELETION PATTERNS');
  console.log('===================================');
  
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    console.log(`\n📊 Iteration ${iteration}:`);
    
    // Get initial state
    const initialStats = await getNetworkStats(pgClient, stagingSchema);
    const initialConnectivity = await measureConnectivity(pgClient, stagingSchema);
    
    console.log(`   Initial: ${initialStats.edgeCount} edges, ${initialConnectivity.connectivityPercentage.toFixed(1)}% connectivity`);
    
    // Find overlapping edges before any changes
    const overlappingPairs = await findOverlappingEdges(pgClient, stagingSchema);
    
    console.log(`   Found ${overlappingPairs.length} overlapping pairs`);
    
    if (overlappingPairs.length === 0) {
      console.log(`   ✅ No overlapping edges found - stopping analysis`);
      break;
    }
    
    // Analyze each overlapping pair
    const problematicEdges = [];
    let successfulMerges = 0;
    
    for (const pair of overlappingPairs) {
      try {
        // Test if this merge would be successful
        const mergeTest = await testMergeOperation(pgClient, stagingSchema, pair);
        
        if (mergeTest.success) {
          successfulMerges++;
        } else {
          problematicEdges.push({
            edge1_id: pair.edge1_id,
            edge2_id: pair.edge2_id,
            overlap_percentage: pair.overlap_percentage,
            e1_name: pair.e1_name,
            e2_name: pair.e2_name,
            merge_success: false,
            error_message: mergeTest.error
          });
        }
      } catch (error) {
        problematicEdges.push({
          edge1_id: pair.edge1_id,
          edge2_id: pair.edge2_id,
          overlap_percentage: pair.overlap_percentage,
          e1_name: pair.e1_name,
          e2_name: pair.e2_name,
          merge_success: false,
          error_message: error.message
        });
      }
    }
    
    // Calculate merge success rate
    const mergeSuccessRate = overlappingPairs.length > 0 ? (successfulMerges / overlappingPairs.length) * 100 : 100;
    
    console.log(`   Merge success rate: ${mergeSuccessRate.toFixed(1)}% (${successfulMerges}/${overlappingPairs.length})`);
    
    if (problematicEdges.length > 0) {
      console.log(`   ⚠️  ${problematicEdges.length} problematic edge pairs:`);
      problematicEdges.forEach((edge, index) => {
        console.log(`      ${index + 1}. Edge ${edge.edge1_id} (${edge.e1_name}) + ${edge.edge2_id} (${edge.e2_name}) - ${(edge.overlap_percentage * 100).toFixed(1)}% overlap`);
        console.log(`         Error: ${edge.error_message}`);
      });
    }
    
    // Store analysis for this iteration
    analysis.push({
      iteration,
      totalEdgesBefore: initialStats.edgeCount,
      totalEdgesAfter: initialStats.edgeCount - successfulMerges, // Assuming successful merges remove one edge each
      edgesRemoved: successfulMerges,
      overlappingPairsFound: overlappingPairs.length,
      mergeSuccessRate,
      connectivityBefore: initialConnectivity.connectivityPercentage,
      connectivityAfter: 0, // Would need to measure after merge
      connectivityChange: 0, // Would need to measure after merge
      problematicEdges
    });
    
    // If no successful merges, stop
    if (successfulMerges === 0) {
      console.log(`   ❌ No successful merges - stopping analysis`);
      break;
    }
  }
  
  return analysis;
}

async function getNetworkStats(pgClient: Pool, stagingSchema: string): Promise<{ edgeCount: number; vertexCount: number }> {
  const statsResult = await pgClient.query(`
    SELECT COUNT(*) as edge_count FROM ${stagingSchema}.ways_noded
  `);
  const vertexResult = await pgClient.query(`
    SELECT COUNT(*) as vertex_count FROM ${stagingSchema}.ways_noded_vertices_pgr
  `);
  
  return {
    edgeCount: parseInt(statsResult.rows[0].edge_count),
    vertexCount: parseInt(vertexResult.rows[0].vertex_count)
  };
}

async function measureConnectivity(pgClient: Pool, stagingSchema: string): Promise<{ connectivityPercentage: number; reachableNodes: number; totalNodes: number }> {
  const result = await pgClient.query(`
    WITH connectivity_check AS (
      SELECT 
        COUNT(DISTINCT node) as reachable_nodes,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr) as total_nodes
      FROM pgr_dijkstra(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
        (SELECT id FROM ${stagingSchema}.ways_noded_vertices_pgr LIMIT 1),
        (SELECT array_agg(id) FROM ${stagingSchema}.ways_noded_vertices_pgr),
        false
      )
    )
    SELECT 
      reachable_nodes,
      total_nodes,
      CASE 
        WHEN total_nodes > 0 THEN (reachable_nodes::float / total_nodes) * 100
        ELSE 0
      END as connectivity_percentage
    FROM connectivity_check
  `);
  
  return {
    reachableNodes: parseInt(result.rows[0].reachable_nodes),
    totalNodes: parseInt(result.rows[0].total_nodes),
    connectivityPercentage: parseFloat(result.rows[0].connectivity_percentage)
  };
}

async function findOverlappingEdges(pgClient: Pool, stagingSchema: string): Promise<any[]> {
  const overlapDetectionSql = `
    WITH overlapping_edges AS (
      SELECT 
        e1.id as edge1_id,
        e2.id as edge2_id,
        e1.name as e1_name,
        e2.name as e2_name,
        ST_Length(e1.the_geom::geography) as e1_length,
        ST_Length(e2.the_geom::geography) as e2_length,
        ST_Length(ST_Intersection(e1.the_geom, e2.the_geom)::geography) as overlap_length,
        ST_Equals(e1.the_geom, e2.the_geom) as is_exact_duplicate,
        ST_Contains(e1.the_geom, e2.the_geom) as e1_contains_e2,
        ST_Contains(e2.the_geom, e1.the_geom) as e2_contains_e1,
        ST_Overlaps(e1.the_geom, e2.the_geom) as has_overlap,
        CASE 
          WHEN ST_Length(e1.the_geom::geography) > 0 AND ST_Length(e2.the_geom::geography) > 0 THEN
            ST_Length(ST_Intersection(e1.the_geom, e2.the_geom)::geography) / 
            LEAST(ST_Length(e1.the_geom::geography), ST_Length(e2.the_geom::geography))
          ELSE 0
        END as overlap_percentage
      FROM ${stagingSchema}.ways_noded e1
      JOIN ${stagingSchema}.ways_noded e2 ON e1.id < e2.id
      WHERE (
        ST_Equals(e1.the_geom, e2.the_geom)
        OR
        ST_Contains(e1.the_geom, e2.the_geom)
        OR
        ST_Contains(e2.the_geom, e1.the_geom)
        OR
        (
          ST_Overlaps(e1.the_geom, e2.the_geom)
          AND ST_Length(ST_Intersection(e1.the_geom, e2.the_geom)::geography) > 
              LEAST(ST_Length(e1.the_geom::geography), ST_Length(e2.the_geom::geography)) * 0.8
          AND ST_Length(ST_Intersection(e1.the_geom, e2.the_geom)::geography) > 10
        )
      )
    )
    SELECT * FROM overlapping_edges ORDER BY overlap_percentage DESC;
  `;
  
  const result = await pgClient.query(overlapDetectionSql);
  return result.rows;
}

async function testMergeOperation(pgClient: Pool, stagingSchema: string, pair: any): Promise<{ success: boolean; error?: string }> {
  try {
    // Test the merge operation without actually performing it
    const testSql = `
      WITH overlapping_group AS (
        SELECT ARRAY[${pair.edge1_id}, ${pair.edge2_id}] as edge_ids
      ),
      merged_geometry AS (
        SELECT ST_LineMerge(ST_Union(the_geom)) as merged_geom
        FROM ${stagingSchema}.ways_noded, overlapping_group
        WHERE id = ANY(overlapping_group.edge_ids)
      )
      SELECT 
        merged_geom,
        ST_IsValid(merged_geom) as is_valid,
        ST_GeometryType(merged_geom) as geom_type,
        ST_Length(merged_geom::geography) as merged_length
      FROM merged_geometry
    `;
    
    const result = await pgClient.query(testSql);
    
    if (result.rows.length === 0) {
      return { success: false, error: 'No merged geometry produced' };
    }
    
    const mergedGeom = result.rows[0];
    
    if (!mergedGeom.is_valid) {
      return { success: false, error: 'Merged geometry is invalid' };
    }
    
    if (mergedGeom.geom_type !== 'ST_LineString') {
      return { success: false, error: `Unexpected geometry type: ${mergedGeom.geom_type}` };
    }
    
    if (mergedGeom.merged_length <= 0) {
      return { success: false, error: 'Merged geometry has zero or negative length' };
    }
    
    return { success: true };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function main() {
  const pgClient = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'trail_master_db',
    user: process.env.DB_USER || 'tester',
    password: process.env.DB_PASSWORD || 'tester'
  });
  
  try {
    // Get staging schema from command line or use default
    const stagingSchema = process.argv[2] || 'carthorse_test';
    
    console.log(`🔍 Analyzing edge deletion patterns in schema: ${stagingSchema}`);
    
    const analysis = await analyzeEdgeDeletionPatterns(pgClient, stagingSchema);
    
    // Print summary
    console.log('\n📊 ANALYSIS SUMMARY');
    console.log('==================');
    
    analysis.forEach((iter, index) => {
      console.log(`\nIteration ${iter.iteration}:`);
      console.log(`  Edges: ${iter.totalEdgesBefore} → ${iter.totalEdgesAfter} (removed: ${iter.edgesRemoved})`);
      console.log(`  Overlapping pairs found: ${iter.overlappingPairsFound}`);
      console.log(`  Merge success rate: ${iter.mergeSuccessRate.toFixed(1)}%`);
      console.log(`  Connectivity: ${iter.connectivityBefore.toFixed(1)}%`);
      
      if (iter.problematicEdges.length > 0) {
        console.log(`  ⚠️  ${iter.problematicEdges.length} problematic edge pairs`);
      }
    });
    
    // Identify patterns
    const totalEdgesRemoved = analysis.reduce((sum, iter) => sum + iter.edgesRemoved, 0);
    const totalOverlappingPairs = analysis.reduce((sum, iter) => sum + iter.overlappingPairsFound, 0);
    const overallSuccessRate = totalOverlappingPairs > 0 ? (totalEdgesRemoved / totalOverlappingPairs) * 100 : 100;
    
    console.log(`\n🎯 OVERALL PATTERNS:`);
    console.log(`  Total edges removed: ${totalEdgesRemoved}`);
    console.log(`  Total overlapping pairs found: ${totalOverlappingPairs}`);
    console.log(`  Overall merge success rate: ${overallSuccessRate.toFixed(1)}%`);
    
    if (overallSuccessRate < 80) {
      console.log(`  ⚠️  Low merge success rate - investigate problematic edge pairs above`);
    }
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
  } finally {
    await pgClient.end();
  }
}

if (require.main === module) {
  main().catch(console.error);
}
