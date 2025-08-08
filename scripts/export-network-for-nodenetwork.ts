#!/usr/bin/env ts-node

/**
 * Export Network for nodeNetwork Analysis
 * 
 * This script exports the network we're trying to run pgr_nodeNetwork on
 * to GeoJSON for visualization and debugging
 */

import { Pool } from 'pg';
import * as fs from 'fs';

async function exportNetworkForNodeNetwork() {
  console.log('🔄 Exporting network for nodeNetwork analysis...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    const stagingSchema = 'staging_boulder_1754318437837';

    console.log('📊 Step 1: Analyzing original trail data...');
    
    // Get statistics about the original trail data
    const stats = await pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN ST_IsSimple(geometry) THEN 1 END) as simple_trails,
        COUNT(CASE WHEN NOT ST_IsSimple(geometry) THEN 1 END) as non_simple_trails,
        COUNT(CASE WHEN ST_IsValid(geometry) THEN 1 END) as valid_trails,
        COUNT(CASE WHEN NOT ST_IsValid(geometry) THEN 1 END) as invalid_trails
      FROM ${stagingSchema}.trails
      WHERE geometry IS NOT NULL
    `);
    
    console.log('📈 Original Trail Statistics:');
    console.log(JSON.stringify(stats.rows[0], null, 2));

    console.log('🔍 Step 2: Exporting original trails to GeoJSON...');
    
    // Export original trails to GeoJSON
    const trailsGeoJSON = await pgClient.query(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(geometry)::json,
            'properties', json_build_object(
              'id', app_uuid,
              'name', name,
              'length_km', length_km,
              'elevation_gain', elevation_gain,
              'elevation_loss', elevation_loss,
              'is_simple', ST_IsSimple(geometry),
              'is_valid', ST_IsValid(geometry),
              'num_points', ST_NumPoints(geometry),
              'geom_type', ST_GeometryType(geometry)
            )
          )
        )
      ) as geojson
      FROM ${stagingSchema}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
    
    const trailsData = trailsGeoJSON.rows[0].geojson;
    fs.writeFileSync('original-trails-for-nodenetwork.geojson', JSON.stringify(trailsData, null, 2));
    console.log('✅ Exported original trails to original-trails-for-nodenetwork.geojson');

    console.log('🔍 Step 3: Exporting processed ways table to GeoJSON...');
    
    // Export the ways table (after geometry processing) to GeoJSON
    const waysGeoJSON = await pgClient.query(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(the_geom)::json,
            'properties', json_build_object(
              'id', id,
              'trail_uuid', trail_uuid,
              'name', name,
              'length_km', length_km,
              'elevation_gain', elevation_gain,
              'elevation_loss', elevation_loss,
              'is_simple', ST_IsSimple(the_geom),
              'is_valid', ST_IsValid(the_geom),
              'num_points', ST_NumPoints(the_geom),
              'geom_type', ST_GeometryType(the_geom)
            )
          )
        )
      ) as geojson
      FROM ${stagingSchema}.ways
      WHERE the_geom IS NOT NULL AND ST_IsValid(the_geom)
    `);
    
    const waysData = waysGeoJSON.rows[0].geojson;
    fs.writeFileSync('processed-ways-for-nodenetwork.geojson', JSON.stringify(waysData, null, 2));
    console.log('✅ Exported processed ways to processed-ways-for-nodenetwork.geojson');

    console.log('🔍 Step 4: Analyzing geometry issues...');
    
    // Check for specific geometry issues
    const geometryIssues = await pgClient.query(`
      SELECT 
        id,
        trail_uuid,
        name,
        ST_GeometryType(the_geom) as geom_type,
        ST_IsSimple(the_geom) as is_simple,
        ST_IsValid(the_geom) as is_valid,
        ST_NumPoints(the_geom) as num_points,
        ST_NumGeometries(the_geom) as num_geometries
      FROM ${stagingSchema}.ways
      WHERE the_geom IS NOT NULL AND (NOT ST_IsSimple(the_geom) OR NOT ST_IsValid(the_geom))
      LIMIT 10
    `);
    
    if (geometryIssues.rows.length > 0) {
      console.log('⚠️  Geometry Issues Found:');
      console.table(geometryIssues.rows);
    } else {
      console.log('✅ No geometry issues found in processed ways');
    }

    console.log('🔍 Step 5: Creating comprehensive network visualization...');
    
    // Create a comprehensive GeoJSON with both original and processed data
    const comprehensiveGeoJSON = await pgClient.query(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(the_geom)::json,
            'properties', json_build_object(
              'id', id,
              'trail_uuid', trail_uuid,
              'name', name,
              'length_km', length_km,
              'elevation_gain', elevation_gain,
              'elevation_loss', elevation_loss,
              'is_simple', ST_IsSimple(the_geom),
              'is_valid', ST_IsValid(the_geom),
              'num_points', ST_NumPoints(the_geom),
              'geom_type', ST_GeometryType(the_geom),
              'source', 'processed_for_nodenetwork'
            )
          )
        )
      ) as geojson
      FROM ${stagingSchema}.ways
      WHERE the_geom IS NOT NULL AND ST_IsValid(the_geom)
    `);
    
    const comprehensiveData = comprehensiveGeoJSON.rows[0].geojson;
    fs.writeFileSync('nodenetwork-input-network.geojson', JSON.stringify(comprehensiveData, null, 2));
    console.log('✅ Exported comprehensive network to nodenetwork-input-network.geojson');

    console.log('✅ Network export complete!');
    console.log('\n📋 Generated Files:');
    console.log('- original-trails-for-nodenetwork.geojson (original trail data)');
    console.log('- processed-ways-for-nodenetwork.geojson (processed ways table)');
    console.log('- nodenetwork-input-network.geojson (comprehensive network for nodeNetwork)');

  } catch (error) {
    console.error('❌ Export failed:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the export
exportNetworkForNodeNetwork()
  .then(() => {
    console.log('🎉 Network export completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Network export failed:', error);
    process.exit(1);
  }); 