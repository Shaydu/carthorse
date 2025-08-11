#!/usr/bin/env node

/**
 * Comprehensive pgRouting Network Analysis
 * 
 * This script runs pgr_analyzeGraph and other pgRouting analysis functions
 * to validate network connectivity and coherence
 */

const { Pool } = require('pg');

// Configuration
const STAGING_SCHEMA = 'staging_boulder_1754318437837';

async function analyzePgRoutingNetwork() {
  console.log('🔍 Starting comprehensive pgRouting network analysis...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    console.log('📊 Step 1: Basic network statistics...');
    
    // Get basic network statistics
    const basicStats = await pgClient.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(DISTINCT source) + COUNT(DISTINCT target) - COUNT(DISTINCT CASE WHEN source = target THEN source END) as unique_nodes,
        AVG(length_km) as avg_length_km,
        SUM(length_km) as total_length_km,
        MIN(length_km) as min_length_km,
        MAX(length_km) as max_length_km
      FROM ${STAGING_SCHEMA}.ways_native
    `);
    
    console.log('📈 Basic Network Statistics:');
    console.log(JSON.stringify(basicStats.rows[0], null, 2));

    console.log('\n🔍 Step 2: Running pgr_analyzeGraph...');
    
    // Run pgr_analyzeGraph for comprehensive analysis
    const analyzeGraphResult = await pgClient.query(`
      SELECT * FROM pgr_analyzeGraph('${STAGING_SCHEMA}.ways_native', 0.000001, 'the_geom', 'id', 'source', 'target')
    `);
    
    console.log('📊 pgr_analyzeGraph Results:');
    console.log(JSON.stringify(analyzeGraphResult.rows[0], null, 2));

    console.log('\n🔍 Step 3: Checking for isolated segments...');
    
    // Check isolated segments
    const isolatedSegments = await pgClient.query(`
      SELECT COUNT(*) as isolated_count
      FROM ${STAGING_SCHEMA}.ways_native_vertices_pgr_analysis
      WHERE isolated = true
    `);
    
    console.log(`🔍 Isolated segments: ${isolatedSegments.rows[0].isolated_count}`);

    console.log('\n🔍 Step 4: Checking for dead ends...');
    
    // Check dead ends
    const deadEnds = await pgClient.query(`
      SELECT COUNT(*) as dead_end_count
      FROM ${STAGING_SCHEMA}.ways_native_vertices_pgr_analysis
      WHERE dead_end = true
    `);
    
    console.log(`🔍 Dead ends: ${deadEnds.rows[0].dead_end_count}`);

    console.log('\n🔍 Step 5: Checking for gaps...');
    
    // Check gaps
    const gaps = await pgClient.query(`
      SELECT COUNT(*) as gap_count
      FROM ${STAGING_SCHEMA}.ways_native_vertices_pgr_analysis
      WHERE gap = true
    `);
    
    console.log(`🔍 Gaps: ${gaps.rows[0].gap_count}`);

    console.log('\n🔍 Step 6: Checking for ring geometries...');
    
    // Check ring geometries
    const rings = await pgClient.query(`
      SELECT COUNT(*) as ring_count
      FROM ${STAGING_SCHEMA}.ways_native_vertices_pgr_analysis
      WHERE ring = true
    `);
    
    console.log(`🔍 Ring geometries: ${rings.rows[0].ring_count}`);

    console.log('\n🔍 Step 7: Checking for intersections...');
    
    // Check intersections
    const intersections = await pgClient.query(`
      SELECT COUNT(*) as intersection_count
      FROM ${STAGING_SCHEMA}.ways_native_vertices_pgr_analysis
      WHERE intersection = true
    `);
    
    console.log(`🔍 Intersections: ${intersections.rows[0].intersection_count}`);

    console.log('\n🔍 Step 8: Node connectivity analysis...');
    
    // Analyze node connectivity
    const nodeConnectivity = await pgClient.query(`
      SELECT 
        cnt as connection_count,
        COUNT(*) as node_count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
      FROM ${STAGING_SCHEMA}.ways_native_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    
    console.log('📊 Node Connectivity Distribution:');
    console.table(nodeConnectivity.rows);

    console.log('\n🔍 Step 9: Checking for disconnected components...');
    
    // Check for disconnected components using pgr_strongComponents
    const componentsResult = await pgClient.query(`
      SELECT 
        component_id,
        COUNT(*) as node_count,
        MIN(cnt) as min_connections,
        MAX(cnt) as max_connections,
        AVG(cnt) as avg_connections
      FROM ${STAGING_SCHEMA}.ways_native_vertices_pgr v
      JOIN pgr_strongComponents('SELECT id, source, target FROM ${STAGING_SCHEMA}.ways_native') sc 
        ON v.id = sc.node
      GROUP BY component_id
      ORDER BY node_count DESC
    `);
    
    console.log('📊 Connected Components Analysis:');
    console.table(componentsResult.rows);

    console.log('\n🔍 Step 10: Edge connectivity analysis...');
    
    // Analyze edge connectivity
    const edgeConnectivity = await pgClient.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(CASE WHEN source = target THEN 1 END) as self_loops,
        COUNT(CASE WHEN source != target THEN 1 END) as normal_edges,
        COUNT(DISTINCT source) as unique_sources,
        COUNT(DISTINCT target) as unique_targets
      FROM ${STAGING_SCHEMA}.ways_native
    `);
    
    console.log('📊 Edge Connectivity Analysis:');
    console.log(JSON.stringify(edgeConnectivity.rows[0], null, 2));

    console.log('\n🔍 Step 11: Trail connectivity analysis...');
    
    // Analyze trail connectivity
    const trailConnectivity = await pgClient.query(`
      SELECT 
        COUNT(DISTINCT trail_uuid) as unique_trails,
        COUNT(*) as total_segments,
        AVG(length_km) as avg_trail_length,
        SUM(length_km) as total_trail_length
      FROM ${STAGING_SCHEMA}.ways_native
      WHERE trail_uuid IS NOT NULL
    `);
    
    console.log('📊 Trail Connectivity Analysis:');
    console.log(JSON.stringify(trailConnectivity.rows[0], null, 2));

    console.log('\n🔍 Step 12: Spatial coverage analysis...');
    
    // Analyze spatial coverage
    const spatialCoverage = await pgClient.query(`
      SELECT 
        ST_AsText(ST_Centroid(ST_Collect(the_geom))) as network_center,
        ST_Area(ST_ConvexHull(ST_Collect(the_geom))) as coverage_area_sq_meters,
        ST_Length(ST_Collect(the_geom)) as total_network_length_meters
      FROM ${STAGING_SCHEMA}.ways_native
    `);
    
    console.log('📊 Spatial Coverage Analysis:');
    console.log(JSON.stringify(spatialCoverage.rows[0], null, 2));

    console.log('\n🔍 Step 13: Network coherence validation...');
    
    // Validate network coherence
    const coherenceChecks = await pgClient.query(`
      SELECT 
        -- Check for orphaned nodes
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_native_vertices_pgr v
         WHERE v.id NOT IN (
           SELECT DISTINCT source FROM ${STAGING_SCHEMA}.ways_native 
           UNION 
           SELECT DISTINCT target FROM ${STAGING_SCHEMA}.ways_native
         )) as orphaned_nodes,
        
        -- Check for disconnected edges
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_native w
         WHERE w.source NOT IN (SELECT id FROM ${STAGING_SCHEMA}.ways_native_vertices_pgr)
         OR w.target NOT IN (SELECT id FROM ${STAGING_SCHEMA}.ways_native_vertices_pgr)) as disconnected_edges,
        
        -- Check for null geometries
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_native WHERE the_geom IS NULL) as null_geometries,
        
        -- Check for invalid geometries
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_native WHERE NOT ST_IsValid(the_geom)) as invalid_geometries
    `);
    
    console.log('📊 Network Coherence Validation:');
    console.log(JSON.stringify(coherenceChecks.rows[0], null, 2));

    console.log('\n✅ Network analysis complete!');
    console.log('\n📋 Summary:');
    console.log('- Network has been analyzed using pgr_analyzeGraph');
    console.log('- Connectivity patterns have been identified');
    console.log('- Spatial coverage has been calculated');
    console.log('- Coherence validation has been performed');

  } catch (error) {
    console.error('❌ Error during network analysis:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the analysis
analyzePgRoutingNetwork()
  .then(() => {
    console.log('🎉 Network analysis completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Network analysis failed:', error);
    process.exit(1);
  }); 