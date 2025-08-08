#!/usr/bin/env node

/**
 * Extract pgRouting Network Data for Specific Bbox
 * 
 * This script extracts the pgRouting-generated network data (ways_native and vertices)
 * for a specific bounding box and outputs it as GeoJSON
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuration
const STAGING_SCHEMA = 'staging_boulder_1754318437837';
const OUTPUT_DIR = 'pgrouting-bbox-extract';

// Bbox coordinates from user
const BBOX = {
  minLng: -105.32047300758535,
  maxLng: -105.26687332281577,
  minLat: 39.97645469545003,
  maxLat: 40.01589890417776
};

async function extractPgRoutingBbox() {
  console.log('🗺️ Extracting pgRouting network data for bbox...');
  console.log(`📍 Bbox: ${BBOX.minLng}, ${BBOX.minLat} to ${BBOX.maxLng}, ${BBOX.maxLat}`);
  
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
    console.log('📊 Step 1: Extracting pgRouting ways within bbox...');
    
    // Extract pgRouting ways (edges) within bbox
    const waysResult = await pgClient.query(`
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
      WHERE ST_Intersects(w.the_geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    `, [BBOX.minLng, BBOX.minLat, BBOX.maxLng, BBOX.maxLat]);
    
    console.log(`✅ Found ${waysResult.rows.length} pgRouting ways in bbox`);

    // Extract pgRouting vertices within bbox
    const verticesResult = await pgClient.query(`
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
      WHERE ST_Intersects(v.the_geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    `, [BBOX.minLng, BBOX.minLat, BBOX.maxLng, BBOX.maxLat]);
    
    console.log(`✅ Found ${verticesResult.rows.length} pgRouting vertices in bbox`);

    console.log('\n🗺️ Step 2: Generating GeoJSON files...');
    
    // Generate ways GeoJSON
    const waysGeoJSON = {
      type: 'FeatureCollection',
      features: waysResult.rows.map(row => ({
        type: 'Feature',
        geometry: JSON.parse(row.geometry_json),
        properties: {
          type: 'pgrouting_way',
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
      path.join(OUTPUT_DIR, 'pgrouting-ways-bbox.geojson'), 
      JSON.stringify(waysGeoJSON, null, 2)
    );
    console.log(`✅ Generated ways GeoJSON with ${waysGeoJSON.features.length} features`);

    // Generate vertices GeoJSON
    const verticesGeoJSON = {
      type: 'FeatureCollection',
      features: verticesResult.rows.map(row => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [row.lng, row.lat]
        },
        properties: {
          type: 'pgrouting_vertex',
          id: row.id,
          connection_count: row.connection_count,
          node_type: row.node_type,
          pg_id: row.pg_id
        }
      }))
    };
    
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'pgrouting-vertices-bbox.geojson'), 
      JSON.stringify(verticesGeoJSON, null, 2)
    );
    console.log(`✅ Generated vertices GeoJSON with ${verticesGeoJSON.features.length} features`);

    // Generate comprehensive network GeoJSON
    const comprehensiveGeoJSON = {
      type: 'FeatureCollection',
      features: [
        // Add vertices as Point features
        ...verticesResult.rows.map(row => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [row.lng, row.lat]
          },
          properties: {
            type: 'pgrouting_vertex',
            id: row.id,
            connection_count: row.connection_count,
            node_type: row.node_type,
            pg_id: row.pg_id
          }
        })),
        // Add ways as LineString features
        ...waysResult.rows.map(row => ({
          type: 'Feature',
          geometry: JSON.parse(row.geometry_json),
          properties: {
            type: 'pgrouting_way',
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
      path.join(OUTPUT_DIR, 'pgrouting-network-bbox.geojson'), 
      JSON.stringify(comprehensiveGeoJSON, null, 2)
    );
    console.log(`✅ Generated comprehensive network GeoJSON with ${comprehensiveGeoJSON.features.length} features`);

    // Generate statistics
    const stats = {
      timestamp: new Date().toISOString(),
      bbox: BBOX,
      staging_schema: STAGING_SCHEMA,
      statistics: {
        total_ways: waysGeoJSON.features.length,
        total_vertices: verticesGeoJSON.features.length,
        total_features: comprehensiveGeoJSON.features.length
      },
      connection_distribution: verticesResult.rows.reduce((acc, node) => {
        acc[node.connection_count] = (acc[node.connection_count] || 0) + 1;
        return acc;
      }, {}),
      node_types: verticesResult.rows.reduce((acc, node) => {
        acc[node.node_type] = (acc[node.node_type] || 0) + 1;
        return acc;
      }, {})
    };
    
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'pgrouting-bbox-statistics.json'), 
      JSON.stringify(stats, null, 2)
    );
    console.log('✅ Generated bbox statistics');

    console.log('\n✅ Bbox extraction complete!');
    console.log(`📁 Output files in: ${OUTPUT_DIR}/`);
    console.log('   - pgrouting-ways-bbox.geojson (pgRouting edges in bbox)');
    console.log('   - pgrouting-vertices-bbox.geojson (pgRouting nodes in bbox)');
    console.log('   - pgrouting-network-bbox.geojson (complete pgRouting network in bbox)');
    console.log('   - pgrouting-bbox-statistics.json (bbox statistics)');

  } catch (error) {
    console.error('❌ Error during bbox extraction:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the extraction
extractPgRoutingBbox()
  .then(() => {
    console.log('🎉 Bbox extraction completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Bbox extraction failed:', error);
    process.exit(1);
  }); 