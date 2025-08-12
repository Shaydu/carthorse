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

async function fixNetworkConnectivity() {
  try {
    await client.connect();
    console.log('🔧 Fixing network connectivity issues...');

    // Start transaction
    await client.query('BEGIN');

    // Step 1: Fix coincident vertices (gap bridging)
    console.log('\n🔗 Step 1: Fixing coincident vertices...');
    
    const coincidentVertices = await client.query(`
      WITH vertex_pairs AS (
        SELECT 
          v1.id as vertex1_id,
          v2.id as vertex2_id,
          v1.the_geom as geom1,
          v2.the_geom as geom2,
          ST_Distance(v1.the_geom, v2.the_geom) as distance
        FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr v1
        CROSS JOIN ${STAGING_SCHEMA}.ways_noded_vertices_pgr v2
        WHERE v1.id < v2.id
          AND ST_DWithin(v1.the_geom, v2.the_geom, 0.0001)  -- Within ~10m
          AND v1.id != v2.id
      )
      SELECT 
        vertex1_id,
        vertex2_id,
        distance,
        geom1,
        geom2
      FROM vertex_pairs
      WHERE distance < 0.001  -- Only merge very close vertices (< 100m)
      ORDER BY distance
    `);

    console.log(`Found ${coincidentVertices.rows.length} pairs of coincident vertices to merge`);

    for (const pair of coincidentVertices.rows) {
      console.log(`  Merging vertex ${pair.vertex1_id} into ${pair.vertex2_id} (distance: ${pair.distance.toFixed(6)}m)`);
      
      // Update all edges that reference vertex1 to use vertex2
      await client.query(`
        UPDATE ${STAGING_SCHEMA}.ways_noded 
        SET source = $1
        WHERE source = $2
      `, [pair.vertex2_id, pair.vertex1_id]);
      
      await client.query(`
        UPDATE ${STAGING_SCHEMA}.ways_noded 
        SET target = $1
        WHERE target = $2
      `, [pair.vertex2_id, pair.vertex1_id]);
      
      // Delete the redundant vertex
      await client.query(`
        DELETE FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr
        WHERE id = $1
      `, [pair.vertex1_id]);
    }

    // Step 2: Recompute vertex degrees after merging
    console.log('\n🔄 Step 2: Recomputing vertex degrees...');
    await client.query(`
      UPDATE ${STAGING_SCHEMA}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);

    // Step 3: Create bridge edges for geometrically continuous but topologically disconnected edges
    console.log('\n🌉 Step 3: Creating bridge edges for geometrically continuous edges...');
    
    const bridgeEdges = await client.query(`
      WITH edge_endpoints AS (
        SELECT 
          id as edge_id,
          source,
          target,
          ST_StartPoint(the_geom) as start_pt,
          ST_EndPoint(the_geom) as end_pt
        FROM ${STAGING_SCHEMA}.ways_noded
      ),
      nearby_endpoints AS (
        SELECT 
          e1.edge_id as edge1_id,
          e1.source as edge1_source,
          e1.target as edge1_target,
          e2.edge_id as edge2_id,
          e2.source as edge2_source,
          e2.target as edge2_target,
          ST_Distance(e1.end_pt, e2.start_pt) as distance,
          'end_to_start' as connection_type
        FROM edge_endpoints e1
        CROSS JOIN edge_endpoints e2
        WHERE e1.edge_id < e2.edge_id
          AND ST_DWithin(e1.end_pt, e2.start_pt, 0.001)  -- Within ~100m
          AND e1.target != e2.source  -- Not already connected
          AND e1.target != e2.target
          AND e1.source != e2.source
          AND e1.source != e2.target
      )
      SELECT 
        edge1_id,
        edge2_id,
        edge1_target as bridge_source,
        edge2_source as bridge_target,
        distance,
        connection_type
      FROM nearby_endpoints
      WHERE distance < 0.001  -- Only bridge very close endpoints
      ORDER BY distance
      LIMIT 50  -- Limit to prevent too many bridges
    `);

    console.log(`Found ${bridgeEdges.rows.length} edges to bridge`);

    // Get next available edge ID
    const maxIdResult = await client.query(`
      SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM ${STAGING_SCHEMA}.ways_noded
    `);
    let nextEdgeId = maxIdResult.rows[0].next_id;

    for (const bridge of bridgeEdges.rows) {
      console.log(`  Creating bridge edge ${nextEdgeId}: vertex ${bridge.bridge_source} -> ${bridge.bridge_target} (distance: ${bridge.distance.toFixed(6)}m)`);
      
      // Create a straight line bridge between the vertices
      await client.query(`
        INSERT INTO ${STAGING_SCHEMA}.ways_noded (
          id, source, target, the_geom, length_km, elevation_gain, elevation_loss,
          app_uuid, name, old_id
        )
        SELECT 
          ${nextEdgeId} as id,
          ${bridge.bridge_source} as source,
          ${bridge.bridge_target} as target,
          ST_MakeLine(v1.the_geom, v2.the_geom) as the_geom,
          ST_Distance(v1.the_geom, v2.the_geom) / 1000.0 as length_km,
          0 as elevation_gain,
          0 as elevation_loss,
          'bridge-edge-${bridge.bridge_source}-${bridge.bridge_target}' as app_uuid,
          'Bridge Edge' as name,
          NULL as old_id
        FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr v1
        JOIN ${STAGING_SCHEMA}.ways_noded_vertices_pgr v2 ON v2.id = ${bridge.bridge_target}
        WHERE v1.id = ${bridge.bridge_source}
      `);
      
      nextEdgeId++;
    }

    // Step 4: Recompute vertex degrees after bridging
    console.log('\n🔄 Step 4: Recomputing vertex degrees after bridging...');
    await client.query(`
      UPDATE ${STAGING_SCHEMA}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);

    // Step 5: Run degree 2 chain merging with improved tolerance
    console.log('\n🔗 Step 5: Running degree 2 chain merging...');
    console.log('  Skipping degree 2 chain merging for now (bridge edges created successfully)');
    console.log('  Degree 2 chain merging can be run separately using the orchestrator');

    // Step 6: Final cleanup - remove orphaned vertices
    console.log('\n🧹 Step 6: Cleaning up orphaned vertices...');
    const orphanedResult = await client.query(`
      DELETE FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr v
      WHERE NOT EXISTS (
        SELECT 1 FROM ${STAGING_SCHEMA}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
      RETURNING id
    `);
    
    console.log(`Cleaned up ${orphanedResult.rowCount} orphaned vertices`);

    // Commit transaction
    await client.query('COMMIT');

    // Step 7: Final statistics
    console.log('\n📊 Final Network Statistics:');
    
    const finalStats = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded) as total_edges,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr) as total_vertices,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr WHERE cnt = 1) as endpoint_vertices,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr WHERE cnt = 2) as degree2_vertices,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr WHERE cnt >= 3) as intersection_vertices
    `);
    
    const stats = finalStats.rows[0];
    console.log(`  Total edges: ${stats.total_edges}`);
    console.log(`  Total vertices: ${stats.total_vertices}`);
    console.log(`  Endpoint vertices: ${stats.endpoint_vertices}`);
    console.log(`  Degree-2 vertices: ${stats.degree2_vertices}`);
    console.log(`  Intersection vertices: ${stats.intersection_vertices}`);

    console.log('\n✅ Network connectivity fixes completed!');

  } catch (error) {
    console.error('❌ Error fixing network connectivity:', error);
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
}

fixNetworkConnectivity();
