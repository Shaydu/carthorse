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

const STAGING_SCHEMA = 'staging_boulder_test_improved_loops';

async function testImprovedLoopSplittingComplete() {
  try {
    await client.connect();
    console.log('🔧 Testing improved loop splitting with complete pgr_nodeNetwork pipeline...');

    // Step 1: Create staging environment
    console.log('\n📊 Step 1: Creating staging environment...');
    await createStagingEnvironment();

    // Step 2: Copy region data to staging
    console.log('\n📊 Step 2: Copying region data to staging...');
    await copyRegionDataToStaging();

    // Step 3: Apply improved loop splitting
    console.log('\n📊 Step 3: Applying improved loop splitting...');
    const loopSplittingHelpers = createLoopSplittingHelpers(STAGING_SCHEMA, client, 2.0);
    const loopResult = await loopSplittingHelpers.splitLoopTrails();
    
    if (!loopResult.success) {
      throw new Error(`Loop splitting failed: ${loopResult.error}`);
    }
    
    console.log(`✅ Loop splitting completed: ${loopResult.loopCount} loops, ${loopResult.splitSegments} segments`);

    // Step 4: Replace loop trails with split segments
    console.log('\n📊 Step 4: Replacing loop trails with split segments...');
    const replaceResult = await loopSplittingHelpers.replaceLoopTrailsWithSegments();
    
    if (!replaceResult.success) {
      throw new Error(`Loop replacement failed: ${replaceResult.error}`);
    }

    // Step 5: Create pgRouting tables
    console.log('\n📊 Step 5: Creating pgRouting tables...');
    await createPgRoutingTables();

    // Step 6: Run pgr_nodeNetwork
    console.log('\n📊 Step 6: Running pgr_nodeNetwork...');
    await runPgNodeNetwork();

    // Step 7: Simplify edges while preserving connectivity (COMMENTED OUT TO TEST)
    // console.log('\n📊 Step 7: Simplifying edges while preserving connectivity...');
    // await simplifyEdgesPreservingConnectivity();

    // Step 8: Generate complete GeoJSON output
    console.log('\n📊 Step 8: Generating complete network export...');
    await generateCompleteNetworkExport();

    console.log('\n✅ Complete test finished successfully!');

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

  // Create intersection points table
  await client.query(`
    CREATE TABLE ${STAGING_SCHEMA}.intersection_points (
      id SERIAL PRIMARY KEY,
      point GEOMETRY(POINT, 4326),
      point_3d GEOMETRY(POINTZ, 4326),
      connected_trail_ids TEXT[],
      connected_trail_names TEXT[],
      node_type TEXT,
      distance_meters DOUBLE PRECISION,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('✅ Staging environment created');
}

// Update bbox to user-provided values
const bbox = [
  -105.33917192801866, // minLng (west)
  39.95803339005218,   // minLat (south)
  -105.2681945500977,  // maxLng (east)
  40.0288146943966     // maxLat (north)
];

async function copyRegionDataToStaging() {
  // Copy trails from public to staging with user-provided bbox
  await client.query(`
    INSERT INTO ${STAGING_SCHEMA}.trails (
      app_uuid, name, trail_type, surface, difficulty, source_tags, osm_id, region,
      length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
    )
    SELECT 
      app_uuid, name, trail_type, surface, difficulty, source_tags, osm_id, region,
      length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      ST_Force3D(geometry) as geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
    FROM public.trails
    WHERE region = 'boulder'
      AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
      AND geometry IS NOT NULL
      AND ST_IsValid(geometry)
  `, bbox);

  const result = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails`);
  console.log(`✅ Copied ${result.rows[0].count} trails to staging`);
}

async function createPgRoutingTables() {
  // Create ways table for pgRouting
  await client.query(`
    DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways;
    CREATE TABLE ${STAGING_SCHEMA}.ways AS
    SELECT 
      ROW_NUMBER() OVER (ORDER BY app_uuid) as id,
      app_uuid as trail_uuid,
      name,
      length_km,
      elevation_gain,
      elevation_loss,
      CASE 
        WHEN ST_IsSimple(geometry) THEN ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
        ELSE ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
      END as the_geom
    FROM ${STAGING_SCHEMA}.trails
    WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
  `);

  console.log('✅ Created pgRouting ways table');
}

async function runPgNodeNetwork() {
  try {
    // Run pgr_nodeNetwork
    await client.query(`
      SELECT pgr_nodeNetwork('${STAGING_SCHEMA}.ways', 0.000001, 'id', 'the_geom')
    `);
    console.log('✅ pgr_nodeNetwork completed successfully');

    // Create topology (this creates the vertices table)
    await client.query(`
      SELECT pgr_createTopology('${STAGING_SCHEMA}.ways_noded', 0.000001, 'the_geom', 'id')
    `);
    console.log('✅ pgr_createTopology completed successfully');

    // Debug: Check what tables exist
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = '${STAGING_SCHEMA}' 
      ORDER BY table_name
    `;
    const tablesResult = await client.query(tablesQuery);
    console.log('📋 Tables in staging schema:', tablesResult.rows.map(r => r.table_name));

    // Check if ways_noded exists
    const nodedExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = '${STAGING_SCHEMA}' 
        AND table_name = 'ways_noded'
      )
    `);
    
    if (!nodedExists.rows[0].exists) {
      throw new Error('ways_noded table was not created by pgr_nodeNetwork');
    }

    // Check if ways_vertices_pgr exists
    const verticesExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = '${STAGING_SCHEMA}' 
        AND table_name = 'ways_vertices_pgr'
      )
    `);
    
    if (!verticesExists.rows[0].exists) {
      console.log('⚠️  ways_vertices_pgr table was not created, creating it manually...');
      
      // Create vertices table manually from ways_noded
      await client.query(`
        CREATE TABLE ${STAGING_SCHEMA}.ways_vertices_pgr AS
        SELECT DISTINCT
          id,
          the_geom,
          cnt,
          chk,
          ein,
          eout
        FROM (
          SELECT 
            source as id,
            ST_StartPoint(the_geom) as the_geom,
            1 as cnt,
            0 as chk,
            0 as ein,
            1 as eout
          FROM ${STAGING_SCHEMA}.ways_noded
          WHERE source IS NOT NULL
          UNION
          SELECT 
            target as id,
            ST_EndPoint(the_geom) as the_geom,
            1 as cnt,
            0 as chk,
            1 as ein,
            0 as eout
          FROM ${STAGING_SCHEMA}.ways_noded
          WHERE target IS NOT NULL
        ) vertices
        ORDER BY id
      `);
      
      console.log('✅ Created ways_vertices_pgr table manually');
    }

    // Add UUID preservation to ways_noded
    await client.query(`
      ALTER TABLE ${STAGING_SCHEMA}.ways_noded 
      ADD COLUMN IF NOT EXISTS trail_uuid TEXT
    `);

    await client.query(`
      UPDATE ${STAGING_SCHEMA}.ways_noded 
      SET trail_uuid = w.trail_uuid
      FROM ${STAGING_SCHEMA}.ways w
      WHERE ${STAGING_SCHEMA}.ways_noded.old_id = w.id
    `);

    // Get statistics
    const stats = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded) as edges_count,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_pgr) as vertices_count
    `);
    
    console.log(`📊 NodeNetwork stats: ${stats.rows[0].edges_count} edges, ${stats.rows[0].vertices_count} vertices`);

  } catch (error) {
    console.error('❌ pgr_nodeNetwork failed:', error);
    throw error;
  }
}

async function simplifyEdgesPreservingConnectivity() {
  try {
    console.log('  Simplifying edges while preserving connectivity...');

    // Simplify the ways_noded table (the edges created by pgr_nodeNetwork)
    await client.query(`
      UPDATE ${STAGING_SCHEMA}.ways_noded 
      SET the_geom = ST_SimplifyPreserveTopology(the_geom, 0.0005)
      WHERE the_geom IS NOT NULL AND ST_IsValid(the_geom)
    `);
    console.log('  ✅ Simplified ways_noded geometries');

    // Recreate topology from simplified ways_noded
    await client.query(`
      SELECT pgr_createTopology('${STAGING_SCHEMA}.ways_noded', 0.000001, 'the_geom', 'id')
    `);
    console.log('  ✅ pgr_createTopology recreated from simplified ways_noded');

    // Debug: Check what tables exist
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = '${STAGING_SCHEMA}' 
      ORDER BY table_name
    `;
    const tablesResult = await client.query(tablesQuery);
    console.log('📋 Tables in staging schema after simplification:', tablesResult.rows.map(r => r.table_name));

    // Check if ways_vertices_pgr exists
    const verticesExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = '${STAGING_SCHEMA}' 
        AND table_name = 'ways_vertices_pgr'
      )
    `);
    
    if (!verticesExists.rows[0].exists) {
      console.log('⚠️  ways_vertices_pgr table was not created, creating it manually...');
      
      // Create vertices table manually from ways_noded
      await client.query(`
        CREATE TABLE ${STAGING_SCHEMA}.ways_vertices_pgr AS
        SELECT DISTINCT
          id,
          the_geom,
          cnt,
          chk,
          ein,
          eout
        FROM (
          SELECT 
            source as id,
            ST_StartPoint(the_geom) as the_geom,
            1 as cnt,
            0 as chk,
            0 as ein,
            1 as eout
          FROM ${STAGING_SCHEMA}.ways_noded
          WHERE source IS NOT NULL
          UNION
          SELECT 
            target as id,
            ST_EndPoint(the_geom) as the_geom,
            1 as cnt,
            0 as chk,
            1 as ein,
            0 as eout
          FROM ${STAGING_SCHEMA}.ways_noded
          WHERE target IS NOT NULL
        ) vertices
        ORDER BY id
      `);
      
      console.log('✅ Created ways_vertices_pgr table manually');
    }

    // Add UUID preservation to ways_noded
    await client.query(`
      ALTER TABLE ${STAGING_SCHEMA}.ways_noded 
      ADD COLUMN IF NOT EXISTS trail_uuid TEXT
    `);

    await client.query(`
      UPDATE ${STAGING_SCHEMA}.ways_noded 
      SET trail_uuid = w.trail_uuid
      FROM ${STAGING_SCHEMA}.ways w
      WHERE ${STAGING_SCHEMA}.ways_noded.old_id = w.id
    `);

    // Get statistics
    const stats = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded) as edges_count,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_pgr) as vertices_count
    `);
    
    console.log(`📊 Simplified NodeNetwork stats: ${stats.rows[0].edges_count} edges, ${stats.rows[0].vertices_count} vertices`);

  } catch (error) {
    console.error('❌ Edge simplification failed:', error);
    throw error;
  }
}

async function generateCompleteGeoJSON() {
  console.log('  Generating simplified pgRouting GeoJSON output...');

  // 1. Export pgRouting nodes (vertices) - only essential fields
  const nodesQuery = `
    SELECT 
      json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', json_build_object(
              'id', id,
              'cnt', cnt,
              'chk', chk,
              'ein', ein,
              'eout', eout
            ),
            'geometry', ST_AsGeoJSON(the_geom)::json
          )
        )
      ) as geojson
    FROM ${STAGING_SCHEMA}.ways_vertices_pgr
    WHERE the_geom IS NOT NULL
  `;
  
  const nodesResult = await client.query(nodesQuery);
  if (nodesResult.rows[0].geojson) {
    fs.writeFileSync('pgrouting-nodes.geojson', JSON.stringify(nodesResult.rows[0].geojson, null, 2));
    console.log('  ✅ Exported pgRouting nodes to pgrouting-nodes.geojson');
  }

  // 2. Export pgRouting edges - only essential fields
  const edgesQuery = `
    SELECT 
      json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', json_build_object(
              'id', id,
              'source', source,
              'target', target,
              'old_id', old_id,
              'sub_id', sub_id
            ),
            'geometry', ST_AsGeoJSON(the_geom)::json
          )
        )
      ) as geojson
    FROM ${STAGING_SCHEMA}.ways_noded
    WHERE the_geom IS NOT NULL
  `;
  
  const edgesResult = await client.query(edgesQuery);
  if (edgesResult.rows[0].geojson) {
    fs.writeFileSync('pgrouting-edges.geojson', JSON.stringify(edgesResult.rows[0].geojson, null, 2));
    console.log('  ✅ Exported pgRouting edges to pgrouting-edges.geojson');
  }

  // 3. Create combined visualization with pgRouting essentials
  const combinedQuery = `
    SELECT 
      json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(feature)
      ) as geojson
    FROM (
      -- pgRouting edges (red)
      SELECT 
        json_build_object(
          'type', 'Feature',
          'properties', json_build_object(
            'type', 'pgr_edge',
            'id', id,
            'source', source,
            'target', target,
            'color', '#cc0000',
            'weight', 3
          ),
          'geometry', ST_AsGeoJSON(the_geom)::json
        ) as feature
      FROM ${STAGING_SCHEMA}.ways_noded
      WHERE the_geom IS NOT NULL
      
      UNION ALL
      
      -- pgRouting nodes (purple)
      SELECT 
        json_build_object(
          'type', 'Feature',
          'properties', json_build_object(
            'type', 'pgr_node',
            'id', id,
            'cnt', cnt,
            'color', '#6600cc',
            'size', 8
          ),
          'geometry', ST_AsGeoJSON(the_geom)::json
        ) as feature
      FROM ${STAGING_SCHEMA}.ways_vertices_pgr
      WHERE the_geom IS NOT NULL
    ) features
  `;
  
  const combinedResult = await client.query(combinedQuery);
  if (combinedResult.rows[0].geojson) {
    fs.writeFileSync('pgrouting-complete.geojson', JSON.stringify(combinedResult.rows[0].geojson, null, 2));
    console.log('  ✅ Exported complete pgRouting visualization to pgrouting-complete.geojson');
  }

  // 4. Get pgRouting statistics
  const statsQuery = `
    SELECT 
      (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded) as edges_count,
      (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_pgr) as nodes_count,
      (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded WHERE source IS NULL OR target IS NULL) as null_connections
    FROM ${STAGING_SCHEMA}.ways_noded
    LIMIT 1
  `;
  
  const statsResult = await client.query(statsQuery);
  const stats = statsResult.rows[0];
  console.log(`  📊 pgRouting stats: ${stats.edges_count} edges, ${stats.nodes_count} nodes, ${stats.null_connections} null connections`);
}

async function generateCompleteNetworkExport() {
  console.log('  Generating comprehensive network export...');

  // Create comprehensive export with all components
  const comprehensiveQuery = `
    SELECT 
      json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(feature)
      ) as geojson
    FROM (
      -- Original trails (blue)
      SELECT 
        json_build_object(
          'type', 'Feature',
          'properties', json_build_object(
            'type', 'trail',
            'name', name,
            'app_uuid', app_uuid,
            'is_loop_segment', app_uuid LIKE '%_segment_%',
            'length_km', length_km,
            'elevation_gain', elevation_gain,
            'color', '#0066cc',
            'weight', 2,
            'opacity', 0.7
          ),
          'geometry', ST_AsGeoJSON(geometry)::json
        ) as feature
      FROM ${STAGING_SCHEMA}.trails
      WHERE geometry IS NOT NULL
      
      UNION ALL
      
      -- pgRouting edges (red)
      SELECT 
        json_build_object(
          'type', 'Feature',
          'properties', json_build_object(
            'type', 'pgr_edge',
            'id', id,
            'source', source,
            'target', target,
            'old_id', old_id,
            'sub_id', sub_id,
            'color', '#cc0000',
            'weight', 3,
            'opacity', 0.8
          ),
          'geometry', ST_AsGeoJSON(the_geom)::json
        ) as feature
      FROM ${STAGING_SCHEMA}.ways_noded
      WHERE the_geom IS NOT NULL
      
      UNION ALL
      
      -- Intersection nodes (purple)
      SELECT 
        json_build_object(
          'type', 'Feature',
          'properties', json_build_object(
            'type', 'intersection_node',
            'id', id,
            'cnt', cnt,
            'node_type', 'intersection',
            'color', '#6600cc',
            'size', 10,
            'symbol', 'circle'
          ),
          'geometry', ST_AsGeoJSON(the_geom)::json
        ) as feature
      FROM ${STAGING_SCHEMA}.ways_vertices_pgr
      WHERE the_geom IS NOT NULL AND cnt >= 3
      
      UNION ALL
      
      -- Endpoint nodes (orange)
      SELECT 
        json_build_object(
          'type', 'Feature',
          'properties', json_build_object(
            'type', 'endpoint_node',
            'id', id,
            'cnt', cnt,
            'node_type', 'endpoint',
            'color', '#ff6600',
            'size', 8,
            'symbol', 'square'
          ),
          'geometry', ST_AsGeoJSON(the_geom)::json
        ) as feature
      FROM ${STAGING_SCHEMA}.ways_vertices_pgr
      WHERE the_geom IS NOT NULL AND cnt = 1
      
      UNION ALL
      
      -- Connection nodes (green)
      SELECT 
        json_build_object(
          'type', 'Feature',
          'properties', json_build_object(
            'type', 'connection_node',
            'id', id,
            'cnt', cnt,
            'node_type', 'connection',
            'color', '#00cc00',
            'size', 6,
            'symbol', 'triangle'
          ),
          'geometry', ST_AsGeoJSON(the_geom)::json
        ) as feature
      FROM ${STAGING_SCHEMA}.ways_vertices_pgr
      WHERE the_geom IS NOT NULL AND cnt = 2
      
    ) features
  `;
  
  const comprehensiveResult = await client.query(comprehensiveQuery);
  if (comprehensiveResult.rows[0].geojson) {
    fs.writeFileSync('final-split-network-complete.geojson', JSON.stringify(comprehensiveResult.rows[0].geojson, null, 2));
    console.log('  ✅ Exported complete network to final-split-network-complete.geojson');
  }

  // Export network statistics
  await exportNetworkStatistics();
}

async function exportNetworkStatistics() {
  try {
    const statsQuery = `
      SELECT 
        -- Trail statistics
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.trails) as total_trails,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.trails WHERE app_uuid LIKE '%_segment_%') as split_segments,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.trails WHERE app_uuid NOT LIKE '%_segment_%') as original_trails,
        
        -- pgRouting statistics
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded) as total_edges,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_pgr) as total_nodes,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded WHERE source IS NULL OR target IS NULL) as null_connections,
        
        -- Node type statistics
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_pgr WHERE cnt = 1) as endpoint_nodes,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_pgr WHERE cnt = 2) as connection_nodes,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_pgr WHERE cnt >= 3) as intersection_nodes,
        
        -- Loop splitting statistics
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.loop_trails) as loop_trails,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.loop_intersections) as loop_intersections,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.loop_split_segments) as loop_segments
      FROM ${STAGING_SCHEMA}.trails
      LIMIT 1
    `;
    
    const statsResult = await client.query(statsQuery);
    const stats = statsResult.rows[0];
    
    const statsReport = {
      network_summary: {
        total_trails: stats.total_trails,
        original_trails: stats.original_trails,
        split_segments: stats.split_segments,
        total_edges: stats.total_edges,
        total_nodes: stats.total_nodes,
        null_connections: stats.null_connections
      },
      node_types: {
        endpoint_nodes: stats.endpoint_nodes,
        connection_nodes: stats.connection_nodes,
        intersection_nodes: stats.intersection_nodes
      },
      loop_processing: {
        loop_trails: stats.loop_trails,
        loop_intersections: stats.loop_intersections,
        loop_segments: stats.loop_segments
      }
    };
    
    fs.writeFileSync('final-split-network-statistics.json', JSON.stringify(statsReport, null, 2));
    console.log('  ✅ Exported network statistics to final-split-network-statistics.json');
    console.log(`  📊 Network Summary: ${stats.total_trails} trails (${stats.split_segments} split), ${stats.total_edges} edges, ${stats.total_nodes} nodes`);
    console.log(`  📊 Node Types: ${stats.endpoint_nodes} endpoints, ${stats.connection_nodes} connections, ${stats.intersection_nodes} intersections`);
  } catch (error) {
    console.error('  ❌ Statistics export failed:', error);
  }
}

testImprovedLoopSplittingComplete(); 