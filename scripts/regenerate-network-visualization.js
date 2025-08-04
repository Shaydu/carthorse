#!/usr/bin/env node

/**
 * Regenerate Entire Network from Staging with pgRouting Functions
 * 
 * This script:
 * 1. Regenerates the complete pgRouting network from staging data
 * 2. Creates comprehensive visualization with nodes, edges, and trails
 * 3. Outputs to GeoJSON for visualization
 * 4. Validates network connectivity and structure
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuration
const STAGING_SCHEMA = 'staging_boulder_1754318437837';
const OUTPUT_DIR = 'network-visualization';

async function regenerateNetworkVisualization() {
  console.log('🔄 Starting comprehensive network regeneration and visualization...');
  
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
  }

  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    console.log('📊 Step 1: Analyzing current staging schema...');
    
    // Get current statistics
    const stats = await pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.trails) as total_trails,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.routing_nodes) as total_nodes,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.routing_edges) as total_edges,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_native) as total_pgrouting_edges,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_native_vertices_pgr) as total_pgrouting_vertices
    `);
    
    console.log('📈 Current Network Statistics:');
    console.log(JSON.stringify(stats.rows[0], null, 2));

    console.log('\n🔄 Step 2: Regenerating pgRouting network...');
    
    // Drop and recreate pgRouting tables
    await pgClient.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_native`);
    await pgClient.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_native_vertices_pgr`);
    await pgClient.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.node_mapping_native`);
    await pgClient.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.edge_mapping_native`);
    
    console.log('✅ Dropped existing pgRouting tables');

    // Create pgRouting ways table with proper integer IDs
    const waysResult = await pgClient.query(`
      CREATE TABLE ${STAGING_SCHEMA}.ways_native AS
      SELECT 
        ROW_NUMBER() OVER (ORDER BY app_uuid) as id,
        app_uuid as trail_uuid,
        name,
        length_km,
        elevation_gain,
        elevation_loss,
        ST_Force2D(geometry) as the_geom
      FROM ${STAGING_SCHEMA}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
    console.log(`✅ Created ways_native table with ${waysResult.rowCount} trails`);

    // Add source and target columns for pgRouting
    await pgClient.query(`
      ALTER TABLE ${STAGING_SCHEMA}.ways_native 
      ADD COLUMN source INTEGER, 
      ADD COLUMN target INTEGER
    `);

    // Create pgRouting topology
    const topologyResult = await pgClient.query(`
      SELECT pgr_createTopology('${STAGING_SCHEMA}.ways_native', 0.000001, 'the_geom', 'id')
    `);
    console.log('✅ Created pgRouting topology');

    // Create mapping tables
    const nodeMappingResult = await pgClient.query(`
      CREATE TABLE ${STAGING_SCHEMA}.node_mapping_native AS
      SELECT 
        v.id as pg_id,
        v.cnt as connection_count,
        CASE 
          WHEN v.cnt = 1 THEN 'dead_end'
          WHEN v.cnt = 2 THEN 'simple_connection'
          WHEN v.cnt >= 3 THEN 'intersection'
          ELSE 'unknown'
        END as node_type
      FROM ${STAGING_SCHEMA}.ways_native_vertices_pgr v
    `);
    console.log(`✅ Created node mapping with ${nodeMappingResult.rowCount} nodes`);

    const edgeMappingResult = await pgClient.query(`
      CREATE TABLE ${STAGING_SCHEMA}.edge_mapping_native AS
      SELECT 
        w.id as pg_id,
        w.trail_uuid as original_uuid
      FROM ${STAGING_SCHEMA}.ways_native w
      WHERE w.trail_uuid IS NOT NULL
    `);
    console.log(`✅ Created edge mapping with ${edgeMappingResult.rowCount} edges`);

    console.log('\n📊 Step 3: Analyzing regenerated network...');
    
    // Analyze the graph
    const analysisResult = await pgClient.query(`
      SELECT * FROM pgr_analyzeGraph('${STAGING_SCHEMA}.ways_native', 0.000001)
    `);
    console.log('📈 pgRouting Analysis Results:');
    console.log(JSON.stringify(analysisResult.rows[0], null, 2));

    console.log('\n🗺️ Step 4: Generating comprehensive GeoJSON visualization...');
    
    // Generate nodes GeoJSON
    const nodesResult = await pgClient.query(`
      SELECT 
        v.id,
        v.the_geom,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat,
        v.cnt as connection_count,
        nm.node_type,
        nm.pg_id
      FROM ${STAGING_SCHEMA}.ways_native_vertices_pgr v
      LEFT JOIN ${STAGING_SCHEMA}.node_mapping_native nm ON v.id = nm.pg_id
    `);
    
    const nodesGeoJSON = {
      type: 'FeatureCollection',
      features: nodesResult.rows.map(row => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [row.lng, row.lat]
        },
        properties: {
          id: row.id,
          connection_count: row.connection_count,
          node_type: row.node_type,
          pg_id: row.pg_id
        }
      }))
    };
    
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'network-nodes.geojson'), 
      JSON.stringify(nodesGeoJSON, null, 2)
    );
    console.log(`✅ Generated nodes GeoJSON with ${nodesGeoJSON.features.length} nodes`);

    // Generate edges GeoJSON
    const edgesResult = await pgClient.query(`
      SELECT 
        w.id,
        w.source,
        w.target,
        w.length_km,
        w.trail_uuid,
        w.name as trail_name,
        w.elevation_gain,
        w.elevation_loss,
        ST_AsGeoJSON(w.the_geom) as geometry_json,
        em.original_uuid
      FROM ${STAGING_SCHEMA}.ways_native w
      LEFT JOIN ${STAGING_SCHEMA}.edge_mapping_native em ON w.id = em.pg_id
    `);
    
    const edgesGeoJSON = {
      type: 'FeatureCollection',
      features: edgesResult.rows.map(row => ({
        type: 'Feature',
        geometry: JSON.parse(row.geometry_json),
        properties: {
          id: row.id,
          source: row.source,
          target: row.target,
          length_km: row.length_km,
          trail_uuid: row.trail_uuid,
          trail_name: row.trail_name,
          elevation_gain: row.elevation_gain,
          elevation_loss: row.elevation_loss,
          original_uuid: row.original_uuid
        }
      }))
    };
    
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'network-edges.geojson'), 
      JSON.stringify(edgesGeoJSON, null, 2)
    );
    console.log(`✅ Generated edges GeoJSON with ${edgesGeoJSON.features.length} edges`);

    // Generate comprehensive network GeoJSON
    const comprehensiveGeoJSON = {
      type: 'FeatureCollection',
      features: [
        // Add nodes as Point features
        ...nodesResult.rows.map(row => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [row.lng, row.lat]
          },
          properties: {
            type: 'node',
            id: row.id,
            connection_count: row.connection_count,
            node_type: row.node_type,
            pg_id: row.pg_id
          }
        })),
        // Add edges as LineString features
        ...edgesResult.rows.map(row => ({
          type: 'Feature',
          geometry: JSON.parse(row.geometry_json),
          properties: {
            type: 'edge',
            id: row.id,
            source: row.source,
            target: row.target,
            length_km: row.length_km,
            trail_uuid: row.trail_uuid,
            trail_name: row.trail_name,
            elevation_gain: row.elevation_gain,
            elevation_loss: row.elevation_loss,
            original_uuid: row.original_uuid
          }
        }))
      ]
    };
    
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'network-comprehensive.geojson'), 
      JSON.stringify(comprehensiveGeoJSON, null, 2)
    );
    console.log(`✅ Generated comprehensive network GeoJSON with ${comprehensiveGeoJSON.features.length} features`);

    // Generate network statistics
    const networkStats = {
      timestamp: new Date().toISOString(),
      staging_schema: STAGING_SCHEMA,
      statistics: {
        total_trails: stats.rows[0].total_trails,
        total_nodes: nodesGeoJSON.features.length,
        total_edges: edgesGeoJSON.features.length,
        pgrouting_analysis: analysisResult.rows[0]
      },
      node_types: nodesResult.rows.reduce((acc, node) => {
        acc[node.node_type] = (acc[node.node_type] || 0) + 1;
        return acc;
      }, {}),
      connection_distribution: nodesResult.rows.reduce((acc, node) => {
        acc[node.connection_count] = (acc[node.connection_count] || 0) + 1;
        return acc;
      }, {})
    };
    
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'network-statistics.json'), 
      JSON.stringify(networkStats, null, 2)
    );
    console.log('✅ Generated network statistics');

    console.log('\n🎯 Step 5: Network validation...');
    
    // Check for orphaned nodes
    const orphanedNodes = await pgClient.query(`
      SELECT COUNT(*) as orphaned_count
      FROM ${STAGING_SCHEMA}.ways_native_vertices_pgr v
      WHERE v.id NOT IN (
        SELECT DISTINCT source FROM ${STAGING_SCHEMA}.ways_native 
        UNION 
        SELECT DISTINCT target FROM ${STAGING_SCHEMA}.ways_native
      )
    `);
    
    console.log(`🔍 Orphaned nodes: ${orphanedNodes.rows[0].orphaned_count}`);
    
    // Check connectivity
    const connectivity = await pgClient.query(`
      SELECT 
        COUNT(*) as total_nodes,
        COUNT(CASE WHEN cnt > 0 THEN 1 END) as connected_nodes,
        COUNT(CASE WHEN cnt = 0 THEN 1 END) as isolated_nodes
      FROM ${STAGING_SCHEMA}.ways_native_vertices_pgr
    `);
    
    console.log('📊 Connectivity Analysis:');
    console.log(JSON.stringify(connectivity.rows[0], null, 2));

    console.log('\n✅ Network regeneration and visualization complete!');
    console.log(`📁 Output files in: ${OUTPUT_DIR}/`);
    console.log('   - network-nodes.geojson (pgRouting nodes)');
    console.log('   - network-edges.geojson (pgRouting edges)');
    console.log('   - network-comprehensive.geojson (complete network)');
    console.log('   - network-statistics.json (detailed statistics)');

  } catch (error) {
    console.error('❌ Error during network regeneration:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the script
regenerateNetworkVisualization()
  .then(() => {
    console.log('🎉 Network regeneration completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Network regeneration failed:', error);
    process.exit(1);
  }); 