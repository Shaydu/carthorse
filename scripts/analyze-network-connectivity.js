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

async function analyzeNetworkConnectivity() {
  try {
    await client.connect();
    console.log('🔍 Analyzing overall network connectivity...');

    // Get network statistics
    const networkStats = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.trails WHERE geometry IS NOT NULL) as total_trails,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded) as total_edges,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr) as total_vertices,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr WHERE cnt = 1) as endpoint_vertices,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr WHERE cnt = 2) as degree2_vertices,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr WHERE cnt >= 3) as intersection_vertices
    `);

    const stats = networkStats.rows[0];
    console.log('\n📊 Network Statistics:');
    console.log(`  Total trails: ${stats.total_trails}`);
    console.log(`  Total edges: ${stats.total_edges}`);
    console.log(`  Total vertices: ${stats.total_vertices}`);
    console.log(`  Endpoint vertices: ${stats.endpoint_vertices}`);
    console.log(`  Degree-2 vertices: ${stats.degree2_vertices}`);
    console.log(`  Intersection vertices: ${stats.intersection_vertices}`);

    // Check bridge edges we created
    console.log('\n🌉 Bridge Edges Analysis:');
    
    const bridgeEdges = await client.query(`
      SELECT 
        COUNT(*) as total_bridges,
        AVG(ST_Length(the_geom::geography)) as avg_bridge_length,
        MAX(ST_Length(the_geom::geography)) as max_bridge_length,
        MIN(ST_Length(the_geom::geography)) as min_bridge_length
      FROM ${STAGING_SCHEMA}.ways_noded
      WHERE app_uuid LIKE 'bridge-edge-%'
    `);

    const bridges = bridgeEdges.rows[0];
    console.log(`  Total bridge edges: ${bridges.total_bridges}`);
    console.log(`  Average bridge length: ${bridges.avg_bridge_length.toFixed(2)}m`);
    console.log(`  Max bridge length: ${bridges.max_bridge_length.toFixed(2)}m`);
    console.log(`  Min bridge length: ${bridges.min_bridge_length.toFixed(2)}m`);

    // Check for any remaining small gaps
    console.log('\n🔍 Checking for remaining small gaps...');
    
    const smallGaps = await client.query(`
      WITH vertex_pairs AS (
        SELECT 
          v1.id as vertex1_id,
          v2.id as vertex2_id,
          ST_Distance(v1.the_geom, v2.the_geom) as distance
        FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr v1
        CROSS JOIN ${STAGING_SCHEMA}.ways_noded_vertices_pgr v2
        WHERE v1.id < v2.id
          AND ST_DWithin(v1.the_geom, v2.the_geom, 0.001)  -- Within ~100m
          AND v1.id != v2.id
      )
      SELECT 
        COUNT(*) as total_small_gaps,
        AVG(distance) as avg_gap_distance,
        MAX(distance) as max_gap_distance
      FROM vertex_pairs
      WHERE distance > 0.001  -- Not exact matches
    `);

    const gaps = smallGaps.rows[0];
    console.log(`  Small gaps between vertices: ${gaps.total_small_gaps}`);
    console.log(`  Average gap distance: ${gaps.avg_gap_distance.toFixed(6)}m`);
    console.log(`  Max gap distance: ${gaps.max_gap_distance.toFixed(6)}m`);

    // Check routing connectivity
    console.log('\n🛣️ Routing Connectivity Check:');
    
    const routingConnectivity = await client.query(`
      SELECT 
        COUNT(*) as total_routing_edges,
        COUNT(CASE WHEN source IS NOT NULL AND target IS NOT NULL THEN 1 END) as valid_edges,
        COUNT(CASE WHEN source IS NULL OR target IS NULL THEN 1 END) as invalid_edges,
        COUNT(CASE WHEN source = target THEN 1 END) as self_loops
      FROM ${STAGING_SCHEMA}.ways_noded
    `);

    const routing = routingConnectivity.rows[0];
    console.log(`  Total routing edges: ${routing.total_routing_edges}`);
    console.log(`  Valid edges: ${routing.valid_edges}`);
    console.log(`  Invalid edges: ${routing.invalid_edges}`);
    console.log(`  Self loops: ${routing.self_loops}`);

    // Check the specific trails we fixed
    console.log('\n🎯 Specific Trail Fix Status:');
    
    const fixedTrails = await client.query(`
      SELECT 
        app_uuid,
        name,
        ST_Length(geometry::geography) as length_meters,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${STAGING_SCHEMA}.trails 
      WHERE app_uuid IN ('6357ecb0-b5b6-4aa8-ba49-27bf6106595b', 'd8ec6e2b-dfd5-49f4-baf7-10c55a6a4377')
      ORDER BY app_uuid
    `);

    console.log('  Fixed trails:');
    fixedTrails.rows.forEach(trail => {
      console.log(`    ${trail.name} (${trail.app_uuid}):`);
      console.log(`      Length: ${trail.length_meters.toFixed(2)}m`);
      console.log(`      Start: ${trail.start_point}`);
      console.log(`      End: ${trail.end_point}`);
    });

    // Overall assessment
    console.log('\n✅ Overall Assessment:');
    
    if (bridges.total_bridges > 0) {
      console.log(`  🌉 ${bridges.total_bridges} bridge edges created to improve connectivity`);
    }

    if (gaps.total_small_gaps === 0) {
      console.log('  ✅ No remaining small gaps detected');
    } else {
      console.log(`  ⚠️ ${gaps.total_small_gaps} small gaps still exist`);
    }

    console.log(`  📈 Network connectivity score: ${Math.round((stats.intersection_vertices / stats.total_vertices) * 100)}%`);

  } catch (error) {
    console.error('❌ Error analyzing network connectivity:', error);
  } finally {
    await client.end();
  }
}

analyzeNetworkConnectivity();
