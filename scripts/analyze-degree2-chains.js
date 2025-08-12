#!/usr/bin/env node

const { Client } = require('pg');

const client = new Client({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'shaydu',
  password: process.env.PGPASSWORD || 'shaydu'
});

const STAGING_SCHEMA = 'carthorse_1754992253411';

async function analyzeDegree2Chains() {
  try {
    await client.connect();
    console.log('🔍 Analyzing degree 2 chain merging issue...');

    // Check the specific edges mentioned (4, 56, 5)
    const specificEdges = await client.query(`
      SELECT 
        id,
        source,
        target,
        app_uuid,
        name,
        ST_Length(the_geom::geography) as length_meters,
        ST_AsText(ST_StartPoint(the_geom)) as start_point,
        ST_AsText(ST_EndPoint(the_geom)) as end_point
      FROM ${STAGING_SCHEMA}.ways_noded
      WHERE id IN (4, 56, 5)
      ORDER BY id
    `);

    console.log('\n📊 Specific Edges (4, 56, 5):');
    specificEdges.rows.forEach(edge => {
      console.log(`\nEdge ${edge.id}: ${edge.name} (${edge.app_uuid})`);
      console.log(`  Source: ${edge.source}, Target: ${edge.target}`);
      console.log(`  Length: ${edge.length_meters.toFixed(2)}m`);
      console.log(`  Start: ${edge.start_point}`);
      console.log(`  End: ${edge.end_point}`);
    });

    // Check vertex degrees for these edges
    if (specificEdges.rows.length > 0) {
      const vertexIds = specificEdges.rows.flatMap(edge => [edge.source, edge.target]);
      const vertexDegrees = await client.query(`
        SELECT 
          id,
          cnt as degree,
          ST_AsText(the_geom) as coordinates
        FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr
        WHERE id = ANY($1)
        ORDER BY id
      `, [vertexIds]);

      console.log('\n🎯 Vertex Degrees for Edges 4, 56, 5:');
      vertexDegrees.rows.forEach(vertex => {
        console.log(`  Vertex ${vertex.id}: degree ${vertex.degree} at ${vertex.coordinates}`);
      });
    }

    // Check if these edges form a chain
    const chainAnalysis = await client.query(`
      WITH edge_chain AS (
        SELECT 
          e1.id as edge1_id,
          e1.source as edge1_source,
          e1.target as edge1_target,
          e2.id as edge2_id,
          e2.source as edge2_source,
          e2.target as edge2_target,
          e3.id as edge3_id,
          e3.source as edge3_source,
          e3.target as edge3_target,
          -- Check if edges are connected
          CASE 
            WHEN e1.target = e2.source THEN 'e1->e2'
            WHEN e1.target = e2.target THEN 'e1->e2_reversed'
            WHEN e1.source = e2.source THEN 'e1_reversed->e2'
            WHEN e1.source = e2.target THEN 'e1_reversed->e2_reversed'
            ELSE 'not_connected'
          END as e1_e2_connection,
          CASE 
            WHEN e2.target = e3.source THEN 'e2->e3'
            WHEN e2.target = e3.target THEN 'e2->e3_reversed'
            WHEN e2.source = e3.source THEN 'e2_reversed->e3'
            WHEN e2.source = e3.target THEN 'e2_reversed->e3_reversed'
            ELSE 'not_connected'
          END as e2_e3_connection
        FROM ${STAGING_SCHEMA}.ways_noded e1
        CROSS JOIN ${STAGING_SCHEMA}.ways_noded e2
        CROSS JOIN ${STAGING_SCHEMA}.ways_noded e3
        WHERE e1.id = 4 AND e2.id = 56 AND e3.id = 5
      )
      SELECT 
        edge1_id,
        edge2_id,
        edge3_id,
        e1_e2_connection,
        e2_e3_connection,
        CASE 
          WHEN e1_e2_connection != 'not_connected' AND e2_e3_connection != 'not_connected'
          THEN 'forms_chain'
          ELSE 'not_chain'
        END as chain_status
      FROM edge_chain
    `);

    console.log('\n🔗 Chain Analysis:');
    if (chainAnalysis.rows.length > 0) {
      const chain = chainAnalysis.rows[0];
      console.log(`  Edge 4 -> Edge 56: ${chain.e1_e2_connection}`);
      console.log(`  Edge 56 -> Edge 5: ${chain.e2_e3_connection}`);
      console.log(`  Chain Status: ${chain.chain_status}`);
    }

    // Check for geometric continuity
    const geometricContinuity = await client.query(`
      WITH edge_geometries AS (
        SELECT 
          id,
          the_geom,
          ST_StartPoint(the_geom) as start_pt,
          ST_EndPoint(the_geom) as end_pt
        FROM ${STAGING_SCHEMA}.ways_noded
        WHERE id IN (4, 56, 5)
      )
      SELECT 
        e1.id as edge1_id,
        e2.id as edge2_id,
        ST_Distance(e1.end_pt, e2.start_pt) as end_to_start_distance,
        ST_Distance(e1.end_pt, e2.end_pt) as end_to_end_distance,
        ST_Distance(e1.start_pt, e2.start_pt) as start_to_start_distance,
        ST_Distance(e1.start_pt, e2.end_pt) as start_to_end_distance,
        CASE 
          WHEN ST_DWithin(e1.end_pt, e2.start_pt, 0.001) THEN 'end_to_start_continuous'
          WHEN ST_DWithin(e1.end_pt, e2.end_pt, 0.001) THEN 'end_to_end_continuous'
          WHEN ST_DWithin(e1.start_pt, e2.start_pt, 0.001) THEN 'start_to_start_continuous'
          WHEN ST_DWithin(e1.start_pt, e2.end_pt, 0.001) THEN 'start_to_end_continuous'
          ELSE 'not_continuous'
        END as continuity_type
      FROM edge_geometries e1
      CROSS JOIN edge_geometries e2
      WHERE e1.id < e2.id
      ORDER BY e1.id, e2.id
    `);

    console.log('\n📏 Geometric Continuity Analysis:');
    geometricContinuity.rows.forEach(row => {
      console.log(`\n  Edge ${row.edge1_id} -> Edge ${row.edge2_id}:`);
      console.log(`    End-to-Start: ${row.end_to_start_distance.toFixed(6)}m`);
      console.log(`    End-to-End: ${row.end_to_end_distance.toFixed(6)}m`);
      console.log(`    Start-to-Start: ${row.start_to_start_distance.toFixed(6)}m`);
      console.log(`    Start-to-End: ${row.start_to_end_distance.toFixed(6)}m`);
      console.log(`    Continuity: ${row.continuity_type}`);
    });

    // Check current degree 2 chain merge function tolerance
    console.log('\n⚙️ Degree 2 Chain Merge Analysis:');
    console.log('  Current tolerance in merge-degree2-chains.ts: 0.001 (~100m)');
    
    // Check if any edges are already merged
    const mergedEdges = await client.query(`
      SELECT 
        id,
        app_uuid,
        name,
        source,
        target
      FROM ${STAGING_SCHEMA}.ways_noded
      WHERE app_uuid LIKE 'merged-degree2-chain-%'
      ORDER BY app_uuid
    `);

    console.log('\n🔗 Existing Merged Chains:');
    if (mergedEdges.rows.length === 0) {
      console.log('  ❌ No merged degree 2 chains found');
    } else {
      mergedEdges.rows.forEach(edge => {
        console.log(`  ✅ ${edge.name} (${edge.app_uuid}): edge ${edge.id}, source=${edge.source}, target=${edge.target}`);
      });
    }

  } catch (error) {
    console.error('❌ Error analyzing degree 2 chains:', error);
  } finally {
    await client.end();
  }
}

analyzeDegree2Chains();
