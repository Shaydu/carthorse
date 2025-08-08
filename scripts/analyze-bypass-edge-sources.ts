#!/usr/bin/env ts-node

import { Client } from 'pg';

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu'
});

const STAGING_SCHEMA = 'staging_boulder_test_improved_loops';

async function analyzeBypassEdgeSources() {
  try {
    await client.connect();
    console.log('🔧 Analyzing bypass edge sources and pgRouting deduplication options...');

    // Step 1: Analyze current bypass edges
    console.log('\n📊 Step 1: Analyzing current bypass edges...');
    
    const bypassAnalysis = await client.query(`
      WITH edge_analysis AS (
        SELECT 
          id,
          source,
          target,
          old_id,
          sub_id,
          the_geom,
          ST_Length(the_geom::geography) as length_meters,
          ST_NumPoints(the_geom) as num_points,
          -- Check if this edge's geometry contains other nodes
          (SELECT COUNT(*) 
           FROM ${STAGING_SCHEMA}.ways_vertices_pgr v 
           WHERE v.id != source AND v.id != target 
           AND ST_DWithin(v.the_geom, the_geom, 0.0001)
           AND ST_Contains(ST_Buffer(the_geom, 0.0001), v.the_geom)
          ) as nodes_bypassed
        FROM ${STAGING_SCHEMA}.ways_noded
        WHERE the_geom IS NOT NULL
      )
      SELECT 
        id,
        source,
        target,
        old_id,
        sub_id,
        length_meters,
        num_points,
        nodes_bypassed,
        CASE 
          WHEN nodes_bypassed > 0 THEN 'BYPASS'
          WHEN length_meters > 1000 THEN 'LONG'
          ELSE 'NORMAL'
        END as edge_type
      FROM edge_analysis
      WHERE nodes_bypassed > 0
      ORDER BY nodes_bypassed DESC, length_meters DESC
      LIMIT 10
    `);
    
    console.log(`🔍 Found ${bypassAnalysis.rows.length} bypass edges to analyze`);
    
    bypassAnalysis.rows.forEach((edge, index) => {
      console.log(`  Bypass ${index + 1}: Edge ${edge.id} (${edge.length_meters.toFixed(1)}m) bypasses ${edge.nodes_bypassed} nodes`);
    });

    // Step 2: Check what pgRouting functions are available for deduplication
    console.log('\n📊 Step 2: Checking pgRouting deduplication functions...');
    
    const pgroutingFunctions = await client.query(`
      SELECT 
        proname as function_name,
        prosrc as source_code
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'pgrouting'
      AND proname LIKE '%dedup%' OR proname LIKE '%clean%' OR proname LIKE '%simplify%'
      ORDER BY proname
    `);
    
    console.log(`🔍 Found ${pgroutingFunctions.rows.length} potential pgRouting deduplication functions:`);
    pgroutingFunctions.rows.forEach(func => {
      console.log(`  - ${func.function_name}`);
    });

    // Step 3: Analyze the original ways vs noded ways
    console.log('\n📊 Step 3: Comparing original ways vs noded ways...');
    
    const comparisonQuery = `
      SELECT 
        'Original Ways' as table_name,
        COUNT(*) as total_edges,
        AVG(ST_Length(the_geom::geography)) as avg_length_m,
        MAX(ST_Length(the_geom::geography)) as max_length_m,
        MIN(ST_Length(the_geom::geography)) as min_length_m
      FROM ${STAGING_SCHEMA}.ways
      WHERE the_geom IS NOT NULL
      UNION ALL
      SELECT 
        'Noded Ways' as table_name,
        COUNT(*) as total_edges,
        AVG(ST_Length(the_geom::geography)) as avg_length_m,
        MAX(ST_Length(the_geom::geography)) as max_length_m,
        MIN(ST_Length(the_geom::geography)) as min_length_m
      FROM ${STAGING_SCHEMA}.ways_noded
      WHERE the_geom IS NOT NULL
    `;
    
    const comparisonResult = await client.query(comparisonQuery);
    console.log('📊 Edge Comparison:');
    comparisonResult.rows.forEach(row => {
      console.log(`  ${row.table_name}: ${row.total_edges} edges, avg ${row.avg_length_m.toFixed(1)}m, max ${row.max_length_m.toFixed(1)}m`);
    });

    // Step 4: Test pgr_analyzeGraph for connectivity analysis
    console.log('\n📊 Step 4: Testing pgr_analyzeGraph for connectivity...');
    
    try {
      const analyzeResult = await client.query(`
        SELECT * FROM pgr_analyzeGraph('${STAGING_SCHEMA}.ways_noded', 0.000001, 'the_geom', 'id')
      `);
      
      console.log('✅ pgr_analyzeGraph results:');
      console.log(`  Dead ends: ${analyzeResult.rows[0].dead_ends}`);
      console.log(`  Isolated segments: ${analyzeResult.rows[0].isolated_segments}`);
      console.log(`  Invalid source: ${analyzeResult.rows[0].invalid_source}`);
      console.log(`  Invalid target: ${analyzeResult.rows[0].invalid_target}`);
      
    } catch (error) {
      console.log(`❌ pgr_analyzeGraph failed: ${error}`);
    }

    // Step 5: Test pgr_analyzeOneway for one-way analysis
    console.log('\n📊 Step 5: Testing pgr_analyzeOneway...');
    
    try {
      const onewayResult = await client.query(`
        SELECT * FROM pgr_analyzeOneway('${STAGING_SCHEMA}.ways_noded', ARRAY[''], ARRAY[''], ARRAY[''], ARRAY[''], one_way:='one_way')
      `);
      
      console.log('✅ pgr_analyzeOneway results:');
      console.log(`  Errors: ${onewayResult.rows[0].errors}`);
      
    } catch (error) {
      console.log(`❌ pgr_analyzeOneway failed: ${error}`);
    }

    // Step 6: Check for pgr_contractGraph (if available)
    console.log('\n📊 Step 6: Checking for pgr_contractGraph...');
    
    try {
      const contractResult = await client.query(`
        SELECT * FROM pgr_contractGraph('${STAGING_SCHEMA}.ways_noded', ARRAY[1,2], 1, ARRAY[1], false)
      `);
      
      console.log('✅ pgr_contractGraph available');
      
    } catch (error) {
      console.log(`❌ pgr_contractGraph not available: ${error}`);
    }

    // Step 7: Test pgr_extractVertices for manual vertex extraction
    console.log('\n📊 Step 7: Testing pgr_extractVertices...');
    
    try {
      const extractResult = await client.query(`
        SELECT COUNT(*) as vertex_count FROM pgr_extractVertices('${STAGING_SCHEMA}.ways_noded')
      `);
      
      console.log(`✅ pgr_extractVertices found ${extractResult.rows[0].vertex_count} vertices`);
      
    } catch (error) {
      console.log(`❌ pgr_extractVertices not available: ${error}`);
    }

    console.log('\n✅ Bypass edge analysis completed!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

analyzeBypassEdgeSources(); 