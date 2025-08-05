#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// Test script using 1-meter tolerance PgRoutingHelpers
async function test1MeterTolerance(skipCleanup = false) {
  console.log('🧪 Testing pgRouting with 1-meter tolerance...');

  // Database connection
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu',
    password: 'password'
  });

  try {
    // Create a test staging schema
    const stagingSchema = `test_1meter_tolerance_${Date.now()}`;
    console.log(`📁 Creating staging schema: ${stagingSchema}`);

    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);

    // Create staging tables with integer IDs
    console.log('📊 Creating staging tables with integer IDs...');
    
    // Create trails table with integer ID
    await pool.query(`
      CREATE TABLE ${stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        length_km REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        geometry GEOMETRY(LINESTRINGZ, 4326)
      )
    `);

    // Copy real trail data from master database to staging with specific bbox
    console.log('📊 Copying real trail data from master database for specific bbox...');
    await pool.query(`
      INSERT INTO ${stagingSchema}.trails (
        app_uuid, name, region, trail_type, surface, difficulty,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry
      )
      SELECT 
        app_uuid, name, region, trail_type, surface, difficulty,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry
      FROM public.trails
      WHERE region = 'boulder' 
      AND geometry IS NOT NULL 
      AND ST_IsValid(geometry)
      AND ST_Intersects(geometry, ST_MakeEnvelope(-105.33917192801866, 39.95803339005218, -105.2681945500977, 40.0288146943966, 4326))
    `);

    const trailCount = await pool.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
    console.log(`✅ Copied ${trailCount.rows[0].count} real trails from master database`);

    // Import the 1-meter tolerance PgRoutingHelpers
    const { PgRoutingHelpers } = await import('./pgrouting-helpers-1-meter-tolerance');
    
    // Create pgRouting helpers instance
    const pgrouting = new PgRoutingHelpers({
      stagingSchema,
      pgClient: pool
    });

    // Create the pgRouting network
    console.log('🔄 Creating pgRouting network with 1-meter tolerance...');
    const success = await pgrouting.createPgRoutingViews();
    
    if (!success) {
      throw new Error('Failed to create pgRouting network');
    }

    console.log('✅ pgRouting network created successfully');

    // Test boundary translation by getting some app_uuids
    console.log('🔄 Testing boundary translation...');
    const appUuids = await pool.query(`
      SELECT app_uuid FROM ${stagingSchema}.trails LIMIT 3
    `);

    if (appUuids.rows.length > 0) {
      const testUuid = appUuids.rows[0].app_uuid;
      console.log(`🧪 Testing with app_uuid: ${testUuid}`);

      // Test ID mapping
      const mappingResult = await pool.query(`
        SELECT pgrouting_id, app_uuid, trail_name 
        FROM ${stagingSchema}.id_mapping 
        WHERE app_uuid = $1
      `, [testUuid]);

      if (mappingResult.rows.length > 0) {
        console.log(`✅ Boundary translation works: app_uuid ${testUuid} → pgrouting_id ${mappingResult.rows[0].pgrouting_id}`);
      } else {
        console.log(`⚠️ No mapping found for app_uuid: ${testUuid}`);
      }
    }

    // Export network statistics
    console.log('📊 Network Statistics:');
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as edges_count,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr) as vertices_count,
        (SELECT COUNT(*) FROM ${stagingSchema}.id_mapping) as mapping_count
    `);
    
    console.log(`   Edges: ${stats.rows[0].edges_count}`);
    console.log(`   Vertices: ${stats.rows[0].vertices_count}`);
    console.log(`   ID Mappings: ${stats.rows[0].mapping_count}`);

    // Export nodes as GeoJSON
    console.log('📤 Exporting nodes as GeoJSON...');
    const nodesResult = await pool.query(`
      SELECT 
        v.id,
        v.cnt as connection_count,
        v.chk,
        v.ein,
        v.eout,
        CASE 
          WHEN v.cnt = 1 THEN 'dead_end'
          WHEN v.cnt = 2 THEN 'simple_connection'
          WHEN v.cnt >= 3 THEN 'intersection'
          ELSE 'unknown'
        END as node_type,
        ST_AsGeoJSON(v.the_geom) as geometry
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      WHERE v.the_geom IS NOT NULL
    `);

    // Export edges as GeoJSON
    console.log('📤 Exporting edges as GeoJSON...');
    const edgesResult = await pool.query(`
      SELECT 
        w.id,
        w.source,
        w.target,
        ST_Length(w.the_geom::geography) / 1000 as length_km,
        ST_AsGeoJSON(w.the_geom) as geometry
      FROM ${stagingSchema}.ways_noded w
      WHERE w.the_geom IS NOT NULL
    `);

    // Export original trails for comparison
    console.log('📤 Exporting original trails as GeoJSON...');
    const trailsResult = await pool.query(`
      SELECT 
        app_uuid,
        name,
        length_km,
        elevation_gain,
        elevation_loss,
        ST_AsGeoJSON(geometry) as geometry
      FROM ${stagingSchema}.trails
      WHERE geometry IS NOT NULL
    `);

    // Create combined GeoJSON with all layers
    const combinedGeoJSON = {
      type: 'FeatureCollection',
      features: [
        // Add nodes with layer identifier and color based on type
        ...nodesResult.rows.map(row => ({
          type: 'Feature',
          properties: {
            layer: 'nodes',
            color: row.node_type === 'intersection' ? '#000000' : '#FF0000', // Black for intersections, red for endpoints
            id: row.id,
            connection_count: row.connection_count,
            node_type: row.node_type
          },
          geometry: JSON.parse(row.geometry)
        })),
        // Add edges with layer identifier and color
        ...edgesResult.rows.map(row => ({
          type: 'Feature',
          properties: {
            layer: 'edges',
            color: '#FF00FF',
            id: row.id,
            source: row.source,
            target: row.target,
            length_km: row.length_km
          },
          geometry: JSON.parse(row.geometry)
        })),
        // Add original trails with layer identifier and color
        ...trailsResult.rows.map(row => ({
          type: 'Feature',
          properties: {
            layer: 'trails',
            color: '#00FF00',
            app_uuid: row.app_uuid,
            name: row.name,
            length_km: row.length_km,
            elevation_gain: row.elevation_gain,
            elevation_loss: row.elevation_loss
          },
          geometry: JSON.parse(row.geometry)
        }))
      ]
    };

    // Write combined GeoJSON file
    const outputDir = 'test-output';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    fs.writeFileSync(
      path.join(outputDir, 'pgrouting-network-1meter-tolerance.geojson'),
      JSON.stringify(combinedGeoJSON, null, 2)
    );

    // Debug: Check node type distribution and cnt values
    const nodeTypeCounts = nodesResult.rows.reduce((acc, row) => {
      acc[row.node_type] = (acc[row.node_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log('📊 Node Type Distribution:');
    Object.entries(nodeTypeCounts).forEach(([type, count]) => {
      console.log(`   ${type}: ${count} nodes`);
    });

    // Check actual cnt values and other topology fields
    const cntValues = nodesResult.rows.map(row => row.connection_count).sort((a, b) => a - b);
    const uniqueCnts = [...new Set(cntValues)];
    console.log('📊 Connection Count Values:', uniqueCnts);
    console.log('📊 Sample cnt values:', cntValues.slice(0, 10));
    console.log('📊 Sample topology data:', nodesResult.rows.slice(0, 3).map(row => ({
      id: row.id,
      cnt: row.connection_count,
      chk: row.chk,
      ein: row.ein,
      eout: row.eout
    })));

    console.log(`✅ Exported combined GeoJSON with ${nodesResult.rows.length} nodes, ${edgesResult.rows.length} edges, and ${trailsResult.rows.length} original trails to test-output/pgrouting-network-1meter-tolerance.geojson`);

    // Clean up (unless skipCleanup is true)
    if (!skipCleanup) {
      await pgrouting.cleanupViews();
      await pool.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
      console.log('✅ Cleaned up staging tables');
    } else {
      console.log(`🔍 Preserving staging schema: ${stagingSchema}`);
      console.log('📋 You can inspect the tables with:');
      console.log(`   psql -d trail_master_db -c "SELECT table_name FROM information_schema.tables WHERE table_schema = '${stagingSchema}' ORDER BY table_name;"`);
      console.log(`   psql -d trail_master_db -c "SELECT * FROM ${stagingSchema}.ways_noded_vertices_pgr LIMIT 5;"`);
    }

    console.log('✅ Test completed successfully!');
    console.log('\n🌐 To visualize:');
    console.log('   1. Open https://geojson.io/');
    console.log('   2. Drag and drop test-output/pgrouting-network-1meter-tolerance.geojson');
    console.log('   3. Use the "layer" property to filter by nodes/edges/trails');

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Parse command line arguments
const skipCleanup = process.argv.includes('--skip-cleanup');

// Run the test
test1MeterTolerance(skipCleanup).catch(console.error); 