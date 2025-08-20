#!/usr/bin/env ts-node

import { Client } from 'pg';
import * as fs from 'fs';
import { createLoopSplittingHelpers } from '../src/utils/loop-splitting-helpers';

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu'
});

const STAGING_SCHEMA = 'staging_boulder_region_e2e';

async function testBoulderRegionEndToEnd() {
  try {
    await client.connect();
    console.log('🔧 Testing Boulder region end-to-end pipeline...');

    // Step 1: Create staging environment
    console.log('\n📊 Step 1: Creating staging environment...');
    await createStagingEnvironment();

    // Step 2: Copy entire Boulder region data to staging
    console.log('\n📊 Step 2: Copying Boulder region data to staging...');
    await copyBoulderRegionData();

    // Step 3: Apply loop detection and splitting
    console.log('\n📊 Step 3: Applying loop detection and splitting...');
    await applyLoopDetectionAndSplitting();

    // Step 4: Create pgRouting tables
    console.log('\n📊 Step 4: Creating pgRouting tables...');
    await createPgRoutingTables();

    // Step 5: Run pgr_nodeNetwork
    console.log('\n📊 Step 5: Running pgr_nodeNetwork...');
    await runPgNodeNetwork();

    // Step 6: Remove bypass edges
    console.log('\n📊 Step 6: Removing bypass edges...');
    await removeBypassEdges();

    // Step 7: Test routing functionality
    console.log('\n📊 Step 7: Testing routing functionality...');
    await testRoutingFunctionality();

    // Step 8: Generate comprehensive GeoJSON export
    console.log('\n📊 Step 8: Generating comprehensive GeoJSON export...');
    await generateComprehensiveExport();

    console.log('\n✅ Boulder region end-to-end test completed successfully!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

async function createStagingEnvironment() {
  // Drop existing staging schema
  await client.query(`DROP SCHEMA IF EXISTS ${STAGING_SCHEMA} CASCADE`);
  
  // Create new staging schema
  await client.query(`CREATE SCHEMA ${STAGING_SCHEMA}`);
  
  // Create trails table with 3D geometry support
  await client.query(`
    CREATE TABLE ${STAGING_SCHEMA}.trails (
      id SERIAL PRIMARY KEY,
      app_uuid TEXT UNIQUE NOT NULL,
      name TEXT,
      trail_type TEXT,
      surface TEXT,
      difficulty TEXT,
      source_tags JSONB,
      osm_id TEXT,
      region TEXT,
      length_km DOUBLE PRECISION,
      elevation_gain DOUBLE PRECISION,
      elevation_loss DOUBLE PRECISION,
      max_elevation DOUBLE PRECISION,
      min_elevation DOUBLE PRECISION,
      avg_elevation DOUBLE PRECISION,
      geometry GEOMETRY(LINESTRINGZ, 4326),
      bbox_min_lng DOUBLE PRECISION,
      bbox_max_lng DOUBLE PRECISION,
      bbox_min_lat DOUBLE PRECISION,
      bbox_max_lat DOUBLE PRECISION,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('✅ Staging environment created');
}

async function copyBoulderRegionData() {
  // Copy ALL Boulder region trails (no bbox filter for full region)
  await client.query(`
    INSERT INTO ${STAGING_SCHEMA}.trails (
      app_uuid, name, trail_type, surface, difficulty, source_tags, osm_id, region,
      length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
    )
    SELECT 
      app_uuid, name, trail_type, surface, difficulty, source_tags, osm_id, region,
      length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      ST_Force3D(geometry), bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
    FROM public.trails
    WHERE geometry IS NOT NULL
    AND region = 'boulder'  -- Focus on Boulder region
  `);

  const result = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails`);
  console.log(`✅ Copied ${result.rows[0].count} Boulder region trails to staging`);

  // Show some statistics
  const stats = await client.query(`
    SELECT 
      COUNT(*) as total_trails,
      SUM(length_km) as total_length_km,
      AVG(length_km) as avg_length_km,
      COUNT(CASE WHEN elevation_gain > 0 THEN 1 END) as trails_with_elevation
    FROM ${STAGING_SCHEMA}.trails
  `);
  
  const statsRow = stats.rows[0];
  console.log(`📊 Boulder Region Stats: ${statsRow.total_trails} trails, ${statsRow.total_length_km.toFixed(1)}km total, avg ${statsRow.avg_length_km.toFixed(2)}km`);
}

async function applyLoopDetectionAndSplitting() {
  try {
    console.log('  Applying loop detection and splitting...');
    
    const loopSplittingHelpers = createLoopSplittingHelpers(STAGING_SCHEMA, client, 2.0);
    
    // Step 1: Split loop trails
    const loopResult = await loopSplittingHelpers.splitLoopTrails();
    
    if (!loopResult.success) {
      throw new Error(`Loop splitting failed: ${loopResult.error}`);
    }
    
    console.log(`  ✅ Loop splitting completed: ${loopResult.loopCount} loops, ${loopResult.splitSegments} segments`);

    // Step 2: Replace loop trails with split segments
    const replaceResult = await loopSplittingHelpers.replaceLoopTrailsWithSegments();
    
    if (!replaceResult.success) {
      throw new Error(`Loop replacement failed: ${replaceResult.error}`);
    }

    console.log(`  ✅ Replaced loop trails with ${replaceResult.splitSegments} split segments`);

  } catch (error) {
    console.error('  ❌ Loop detection and splitting failed:', error);
    throw error;
  }
}

async function createPgRoutingTables() {
  // Create ways table for pgRouting
  await client.query(`
    CREATE TABLE ${STAGING_SCHEMA}.ways AS
    SELECT 
      id,
      app_uuid as trail_uuid,
      name,
      length_km,
      elevation_gain,
      elevation_loss,
      geometry as the_geom
    FROM ${STAGING_SCHEMA}.trails
    WHERE geometry IS NOT NULL
  `);

  console.log('✅ Created pgRouting ways table');
}

async function runPgNodeNetwork() {
  try {
    console.log('  Running pgr_nodeNetwork...');

    // Run pgr_nodeNetwork
    await client.query(`
      SELECT pgr_nodeNetwork('${STAGING_SCHEMA}.ways', 0.000001, 'id', 'the_geom')
    `);
    console.log('  ✅ pgr_nodeNetwork completed successfully');

    // Create topology
    await client.query(`
      SELECT pgr_createTopology('${STAGING_SCHEMA}.ways_noded', 0.000001, 'the_geom', 'id')
    `);
    console.log('  ✅ pgr_createTopology completed successfully');

    // Get initial statistics
    const stats = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded) as edges_count,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_pgr) as vertices_count
    `);
    
    console.log(`  📊 Initial pgRouting stats: ${stats.rows[0].edges_count} edges, ${stats.rows[0].vertices_count} vertices`);

  } catch (error) {
    console.error('  ❌ pgRouting failed:', error);
    throw error;
  }
}

async function removeBypassEdges() {
  try {
    console.log('  Removing bypass edges...');

    // Create filtered edges table (remove bypass edges)
    await client.query(`
      DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_noded_filtered;
      CREATE TABLE ${STAGING_SCHEMA}.ways_noded_filtered AS
      SELECT 
        id,
        old_id,
        sub_id,
        source,
        target,
        the_geom
      FROM ${STAGING_SCHEMA}.ways_noded wn
      WHERE NOT EXISTS (
        -- Check if this edge bypasses intermediate nodes
        SELECT 1 
        FROM ${STAGING_SCHEMA}.ways_vertices_pgr v 
        WHERE v.id != wn.source AND v.id != wn.target 
        AND ST_DWithin(v.the_geom, wn.the_geom, 0.0001)
        AND ST_Contains(ST_Buffer(wn.the_geom, 0.0001), v.the_geom)
      )
      AND the_geom IS NOT NULL
    `);
    
    const filteredStats = await client.query(`
      SELECT COUNT(*) as filtered_edges FROM ${STAGING_SCHEMA}.ways_noded_filtered
    `);
    
    const originalStats = await client.query(`
      SELECT COUNT(*) as original_edges FROM ${STAGING_SCHEMA}.ways_noded
    `);
    
    const removedCount = originalStats.rows[0].original_edges - filteredStats.rows[0].filtered_edges;
    
    console.log(`  ✅ Filtered edges: ${filteredStats.rows[0].filtered_edges} kept, ${removedCount} bypass edges removed`);

    // Replace original table with filtered edges
    await client.query(`DROP TABLE ${STAGING_SCHEMA}.ways_noded`);
    await client.query(`ALTER TABLE ${STAGING_SCHEMA}.ways_noded_filtered RENAME TO ways_noded`);
    console.log('  ✅ Replaced ways_noded with filtered edges');

    // Recreate topology
    await client.query(`
      SELECT pgr_createTopology('${STAGING_SCHEMA}.ways_noded', 0.000001, 'the_geom', 'id')
    `);
    console.log('  ✅ Recreated topology');

    // Fix duplicate nodes
    await client.query(`
      DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_vertices_pgr_fixed;
      CREATE TABLE ${STAGING_SCHEMA}.ways_vertices_pgr_fixed AS
      SELECT 
        id,
        the_geom,
        COUNT(*) as cnt,
        SUM(CASE WHEN ein = 1 THEN 1 ELSE 0 END) as ein,
        SUM(CASE WHEN eout = 1 THEN 1 ELSE 0 END) as eout,
        SUM(CASE WHEN chk = 1 THEN 1 ELSE 0 END) as chk
      FROM ${STAGING_SCHEMA}.ways_vertices_pgr
      GROUP BY id, the_geom
      ORDER BY id
    `);
    
    await client.query(`DROP TABLE ${STAGING_SCHEMA}.ways_vertices_pgr`);
    await client.query(`ALTER TABLE ${STAGING_SCHEMA}.ways_vertices_pgr_fixed RENAME TO ways_vertices_pgr`);
    console.log('  ✅ Fixed duplicate nodes');

    // Get final statistics
    const finalStats = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded) as edges_count,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_pgr) as vertices_count,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded WHERE source IS NULL OR target IS NULL) as null_connections
    `);
    
    const stats = finalStats.rows[0];
    console.log(`  📊 Final Network Stats: ${stats.edges_count} edges, ${stats.vertices_count} vertices, ${stats.null_connections} null connections`);

  } catch (error) {
    console.error('  ❌ Bypass edge removal failed:', error);
    throw error;
  }
}

async function testRoutingFunctionality() {
  try {
    console.log('  Testing routing functionality...');

    // Find some test vertices
    const testVertices = await client.query(`
      SELECT id, cnt, the_geom
      FROM ${STAGING_SCHEMA}.ways_vertices_pgr
      WHERE cnt >= 2
      ORDER BY cnt DESC, RANDOM()
      LIMIT 10
    `);
    
    console.log(`  🔍 Found ${testVertices.rows.length} vertices with 2+ connections for testing`);
    
    if (testVertices.rows.length < 2) {
      console.log('  ⚠️  Not enough connected vertices for routing test');
      return;
    }

    // Test a few routes
    let successfulRoutes = 0;
    let failedRoutes = 0;

    for (let i = 0; i < Math.min(3, testVertices.rows.length - 1); i++) {
      const startVertex = testVertices.rows[i];
      const endVertex = testVertices.rows[i + 1];

      try {
        const routeQuery = `
          SELECT COUNT(*) as route_segments
          FROM pgr_dijkstra(
            'SELECT id, source, target, ST_Length(the_geom::geography) as cost FROM ${STAGING_SCHEMA}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL',
            ${startVertex.id}, ${endVertex.id}, false
          )
          WHERE cost IS NOT NULL
        `;
        
        const routeResult = await client.query(routeQuery);
        const route = routeResult.rows[0];
        
        if (route.route_segments > 0) {
          console.log(`    ✅ Route ${i + 1}: ${route.route_segments} segments from vertex ${startVertex.id} to ${endVertex.id}`);
          successfulRoutes++;
        } else {
          console.log(`    ❌ Route ${i + 1}: No route found`);
          failedRoutes++;
        }
        
      } catch (error) {
        console.log(`    ❌ Route ${i + 1}: Failed - ${error}`);
        failedRoutes++;
      }
    }

    console.log(`  📊 Routing Test Summary: ${successfulRoutes} successful, ${failedRoutes} failed`);

  } catch (error) {
    console.error('  ❌ Routing test failed:', error);
  }
}

async function generateComprehensiveExport() {
  console.log('  Generating comprehensive GeoJSON export...');

  // Export nodes
  const nodesQuery = `
    SELECT 
      json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(feature)
      ) as geojson
    FROM (
      SELECT 
        json_build_object(
          'type', 'Feature',
          'properties', json_build_object(
            'type', 'routing_node',
            'id', id,
            'cnt', cnt,
            'node_type', CASE 
              WHEN cnt = 1 THEN 'endpoint'
              WHEN cnt = 2 THEN 'connection'
              ELSE 'intersection'
            END,
            'color', CASE 
              WHEN cnt >= 3 THEN '#6600cc'
              WHEN cnt = 2 THEN '#00cc00'
              ELSE '#ff6600'
            END,
            'size', CASE 
              WHEN cnt >= 3 THEN 10
              WHEN cnt = 2 THEN 6
              ELSE 8
            END
          ),
          'geometry', ST_AsGeoJSON(the_geom)::json
        ) as feature
      FROM ${STAGING_SCHEMA}.ways_vertices_pgr
      WHERE the_geom IS NOT NULL
    ) features
  `;
  
  const nodesResult = await client.query(nodesQuery);
  if (nodesResult.rows[0].geojson) {
    fs.writeFileSync('boulder-region-nodes.geojson', JSON.stringify(nodesResult.rows[0].geojson, null, 2));
    console.log('  ✅ Exported nodes to boulder-region-nodes.geojson');
  }

  // Export edges
  const edgesQuery = `
    SELECT 
      json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(feature)
      ) as geojson
    FROM (
      SELECT 
        json_build_object(
          'type', 'Feature',
          'properties', json_build_object(
            'type', 'routing_edge',
            'id', id,
            'source', source,
            'target', target,
            'old_id', old_id,
            'sub_id', sub_id,
            'length_meters', ST_Length(the_geom::geography),
            'color', '#cc0000',
            'weight', 3
          ),
          'geometry', ST_AsGeoJSON(the_geom)::json
        ) as feature
      FROM ${STAGING_SCHEMA}.ways_noded
      WHERE the_geom IS NOT NULL
    ) features
  `;
  
  const edgesResult = await client.query(edgesQuery);
  if (edgesResult.rows[0].geojson) {
    fs.writeFileSync('boulder-region-edges.geojson', JSON.stringify(edgesResult.rows[0].geojson, null, 2));
    console.log('  ✅ Exported edges to boulder-region-edges.geojson');
  }

  // Export combined network
  const combinedQuery = `
    SELECT 
      json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(feature)
      ) as geojson
    FROM (
      -- Nodes
      SELECT 
        json_build_object(
          'type', 'Feature',
          'properties', json_build_object(
            'type', 'routing_node',
            'id', id,
            'cnt', cnt,
            'node_type', CASE 
              WHEN cnt = 1 THEN 'endpoint'
              WHEN cnt = 2 THEN 'connection'
              ELSE 'intersection'
            END,
            'color', CASE 
              WHEN cnt >= 3 THEN '#6600cc'
              WHEN cnt = 2 THEN '#00cc00'
              ELSE '#ff6600'
            END,
            'size', CASE 
              WHEN cnt >= 3 THEN 10
              WHEN cnt = 2 THEN 6
              ELSE 8
            END
          ),
          'geometry', ST_AsGeoJSON(the_geom)::json
        ) as feature
      FROM ${STAGING_SCHEMA}.ways_vertices_pgr
      WHERE the_geom IS NOT NULL
      
      UNION ALL
      
      -- Edges
      SELECT 
        json_build_object(
          'type', 'Feature',
          'properties', json_build_object(
            'type', 'routing_edge',
            'id', id,
            'source', source,
            'target', target,
            'old_id', old_id,
            'sub_id', sub_id,
            'length_meters', ST_Length(the_geom::geography),
            'color', '#cc0000',
            'weight', 3
          ),
          'geometry', ST_AsGeoJSON(the_geom)::json
        ) as feature
      FROM ${STAGING_SCHEMA}.ways_noded
      WHERE the_geom IS NOT NULL
    ) features
  `;
  
  const combinedResult = await client.query(combinedQuery);
  if (combinedResult.rows[0].geojson) {
    fs.writeFileSync('boulder-region-complete.geojson', JSON.stringify(combinedResult.rows[0].geojson, null, 2));
    console.log('  ✅ Exported complete network to boulder-region-complete.geojson');
  }

  // Export statistics
  const statsQuery = `
    SELECT 
      (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded) as total_edges,
      (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_pgr) as total_nodes,
      (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_pgr WHERE cnt = 1) as endpoint_nodes,
      (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_pgr WHERE cnt = 2) as connection_nodes,
      (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_pgr WHERE cnt >= 3) as intersection_nodes,
      (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded WHERE source IS NULL OR target IS NULL) as null_connections
  `;
  
  const statsResult = await client.query(statsQuery);
  const stats = statsResult.rows[0];
  
  const statsReport = {
    boulder_region_network: {
      total_edges: stats.total_edges,
      total_nodes: stats.total_nodes,
      endpoint_nodes: stats.endpoint_nodes,
      connection_nodes: stats.connection_nodes,
      intersection_nodes: stats.intersection_nodes,
      null_connections: stats.null_connections
    },
    note: "Complete Boulder region routing network with loop splitting and bypass edge removal"
  };
  
  fs.writeFileSync('boulder-region-statistics.json', JSON.stringify(statsReport, null, 2));
  console.log('  ✅ Exported statistics to boulder-region-statistics.json');
  console.log(`  📊 Boulder Region Network: ${stats.total_edges} edges, ${stats.total_nodes} nodes, ${stats.null_connections} null connections`);
}

testBoulderRegionEndToEnd(); 