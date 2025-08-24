#!/usr/bin/env ts-node

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

interface RouteEdge {
  edge_id: number;
  trail_name: string;
  length_km: number;
  elevation_gain: number;
}

interface RouteRecommendation {
  route_uuid: string;
  route_name: string;
  route_shape: string;
  recommended_length_km: number;
  recommended_elevation_gain: number;
  route_path: any;
  route_edges: RouteEdge[];
}

async function main() {
  console.log('🗺️ Exporting Bear Canyon complex loops to GeoJSON...');
  
  // Connect to database
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'carthorse',
    password: process.env.PGPASSWORD,
  });

  try {
    const stagingSchema = 'bear_canyon_test';
    
    console.log(`🔧 Exporting from staging schema: ${stagingSchema}`);
    
    // Get the Bear Canyon loop routes
    const routesResult = await pool.query(`
      SELECT 
        route_uuid,
        route_name,
        route_shape,
        recommended_length_km,
        recommended_elevation_gain,
        route_path,
        route_edges
      FROM ${stagingSchema}.route_recommendations
      WHERE route_name LIKE '%Bear Canyon Loop%' OR route_name LIKE '%Complex Loop%'
      ORDER BY recommended_length_km DESC
    `);
    
    console.log(`📊 Found ${routesResult.rows.length} complex loop routes`);
    
    if (routesResult.rows.length === 0) {
      console.log('❌ No complex loop routes found');
      return;
    }
    
    // Convert routes to GeoJSON
    const geojson: any = {
      type: 'FeatureCollection',
      features: []
    };
    
    for (const route of routesResult.rows) {
      console.log(`🗺️ Processing route: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km)`);
      
      // Parse route edges (already an object, not a string)
      const routeEdges = route.route_edges;
      
      // Get geometry for each edge
      const edgeIds = routeEdges.map((edge: RouteEdge) => edge.edge_id);
      
      const geometryResult = await pool.query(`
        SELECT 
          id,
          trail_name,
          ST_AsGeoJSON(the_geom) as geometry
        FROM ${stagingSchema}.ways_noded
        WHERE id = ANY($1::integer[])
        ORDER BY id
      `, [edgeIds]);
      
      // Create a combined geometry for the route
      const geometries = geometryResult.rows.map(row => JSON.parse(row.geometry));
      
      // Create GeoJSON feature
      const feature = {
        type: 'Feature',
        properties: {
          route_uuid: route.route_uuid,
          route_name: route.route_name,
          route_shape: route.route_shape,
          length_km: route.recommended_length_km,
          elevation_gain_m: route.recommended_elevation_gain,
          trail_count: routeEdges.length,
          trails: routeEdges.map((edge: RouteEdge) => edge.trail_name).join(', ')
        },
        geometry: {
          type: 'MultiLineString',
          coordinates: geometries.map(geom => geom.coordinates)
        }
      };
      
      geojson.features.push(feature);
      console.log(`✅ Added route: ${route.route_name} with ${routeEdges.length} trail segments`);
    }
    
    // Write to file
    const outputPath = path.join(__dirname, 'test-output', 'bear-canyon-complex-loops.geojson');
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    
    console.log(`🗺️ Exported ${geojson.features.length} complex loops to: ${outputPath}`);
    
    // Also create a detailed summary
    console.log('\n📋 Route Summary:');
    geojson.features.forEach((feature: any, index: number) => {
      console.log(`${index + 1}. ${feature.properties.route_name}`);
      console.log(`   Length: ${feature.properties.length_km.toFixed(2)}km`);
      console.log(`   Elevation: ${feature.properties.elevation_gain_m.toFixed(0)}m`);
      console.log(`   Trails: ${feature.properties.trails}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error exporting Bear Canyon loops:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
